/**
 * Best-effort inference of what Claude Code is doing from streamed stdout/stderr.
 * Works for default text output and for `--output-format stream-json` lines.
 */

const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export type RunActivityPhase = {
  /** Short status for the UI */
  label: string;
  /** Recent line or snippet (for tooltip / secondary text) */
  detail?: string;
};

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/** TUI spinners often use `\r` to overwrite the same line — keep the final segment. */
function normalizeTerminalLine(line: string): string {
  const parts = line.split(/\r/);
  return (parts[parts.length - 1] ?? line).trim();
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function tryLabelFromStreamJson(line: string): string | null {
  const t = line.trim();
  if (!t.startsWith('{') || t.length > 500_000) return null;
  let o: unknown;
  try {
    o = JSON.parse(t);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const rec = o as Record<string, unknown>;

  if (rec.type === 'system' && rec.subtype === 'api_retry') {
    const a = rec.attempt;
    const m = rec.max_retries;
    if (typeof a === 'number' && typeof m === 'number') {
      return `Retrying API request (${a}/${m})`;
    }
    return 'Retrying API request';
  }

  if (rec.type === 'stream_event' && rec.event && typeof rec.event === 'object') {
    const ev = rec.event as Record<string, unknown>;
    const delta = ev.delta as Record<string, unknown> | undefined;
    const dt = delta?.type;
    if (dt === 'thinking_delta') return 'Thinking';
    if (dt === 'text_delta') return 'Writing response';

    const name = ev.name ?? ev.tool_name;
    if (typeof name === 'string') {
      if (/bash/i.test(name)) return 'Running shell command';
      if (/read|view|file/i.test(name)) return 'Reading files';
      if (/edit|write|apply/i.test(name)) return 'Editing files';
    }
  }

  if (rec.type === 'tool_use' || rec.subtype === 'tool_use') return 'Using a tool';
  if (rec.type === 'tool_result') return 'Tool finished';
  if (rec.type === 'message_stop') return 'Run output complete';
  if (rec.type === 'result') return 'Run output complete';

  return null;
}

type Matcher = { label: string; test: (line: string) => boolean };

/** First match wins when scanning from the most recent line upward. */
const LINE_MATCHERS: Matcher[] = [
  { label: 'Retrying or waiting on API', test: (l) => /api_retry|retrying|rate\s*limit|backoff|429\b|503\b/i.test(l) },
  { label: 'Building or compiling', test: (l) => /compil(?:e|ing|ation)|\btsc\b|webpack|vite|esbuild|rollup|transpil/i.test(l) },
  {
    label: 'Package manager',
    test: (l) => /\b(?:npm|pnpm|yarn|bun)\s+(?:run|exec|install|ci|add|remove)\b/i.test(l),
  },
  { label: 'Running shell command', test: (l) => /\bbash\b|\bsh\b|^\$\s|executing:\s*|running:\s*|\brun:\s*`?/i.test(l) },
  { label: 'Reading files', test: (l) => /\breading\b.*\b(file|path|src)|\bread\s*\(|tool.*read/i.test(l) },
  { label: 'Editing files', test: (l) => /\bwriting\b|\bedit(?:ing)?\b|\bwrote\b|\bapply_patch\b/i.test(l) },
  {
    label: 'Thinking',
    test: (l) => /thinking|reasoning|extended\s+think|[✻✦•]\s*think/i.test(l),
  },
  { label: 'Improvising', test: (l) => /improvis/i.test(l) },
  { label: 'Searching', test: (l) => /\bsearching\b|\bgrep\b|\bglob\b|semantic\s+search|ripgrep|\brg\b/i.test(l) },
  { label: 'Fetching or web', test: (l) => /\bwebfetch\b|\bfetching\b.*\burl\b|curl\s+|wget\s+/i.test(l) },
  { label: 'MCP / plugin', test: (l) => /\bmcp\b|mcp_/i.test(l) },
];

/**
 * Derive a human-readable activity label from the tail of the live stream.
 * Returns null when there is no output yet.
 */
export function inferClaudeActivity(buffer: string): RunActivityPhase | null {
  const text = stripAnsi(buffer);
  if (!text.trim()) return null;

  const tail = text.length > 16_000 ? text.slice(-16_000) : text;
  const lines: string[] = [];
  for (const raw of tail.split(/\n/)) {
    const n = normalizeTerminalLine(raw);
    if (n) lines.push(n);
  }

  const scan = lines.slice(-50);

  /** Claude Code often prints this right before the `claude -p` process exits — avoid showing endless “Working”. */
  const tailJoined = scan.slice(-24).join('\n');
  if (/\|\s*cost:\s*\$/m.test(tailJoined)) {
    return {
      label: 'Run output complete',
      detail: 'Cost line seen — Claude should be finishing; waiting for the API to confirm the run.'
    };
  }

  for (let i = scan.length - 1; i >= 0; i--) {
    const line = scan[i];

    const jsonLabel = tryLabelFromStreamJson(line);
    if (jsonLabel) {
      return { label: jsonLabel };
    }

    for (const m of LINE_MATCHERS) {
      if (m.test(line)) {
        return { label: m.label, detail: truncate(line, 220) };
      }
    }
  }

  return {
    label: 'Working',
    detail: 'Still streaming — if this lasts many minutes after output stopped, check the API / proxy or set VITE_RUN_STREAM=0 for buffered /api/run.'
  };
}
