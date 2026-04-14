import { spawn } from 'node:child_process';
import { runClaudePrint, watchClaudeProcess, type ClaudeRunResult } from './claudeRunner';
import { USAGE_TAB_HEADLESS_PROMPT } from './usageParse';

export type UsageSlash = '/status' | '/usage' | '/stats';

/**
 * Child env for Usage probes: Node/npm often sets `npm_config_prefix`, which breaks `nvm` when `bash -l` sources
 * ~/.nvm/nvm.sh (see screenshot: "nvm is not compatible with the npm_config_prefix environment variable").
 */
export function usageProbeCleanEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(e)) {
    if (k.toLowerCase() === 'npm_config_prefix') delete e[k];
  }
  delete e.NPM_CONFIG_PREFIX;
  return e;
}

/** Strip ANSI SGR sequences so Usage panels render cleanly in HTML `<pre>`. */
export function stripAnsiForWeb(text: string): string {
  return text.replace(/\u001b\[[\d;]*[mGKH]/g, '').replace(/\u001b\]8;;[^\u0007]*\u0007/g, '');
}

function shSingleQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\"'\"'`)}'`;
}

function middleArgvPieces(model?: string): string[] {
  const parts: string[] = [];
  const m = model?.trim();
  if (m && m !== 'default') {
    parts.push('--model', m);
  }
  const extra = process.env.CLAUDE_EXTRA_ARGS?.trim();
  if (extra) {
    parts.push(...extra.split(/\s+/).filter(Boolean));
  }
  return parts;
}

/**
 * Run `claude /usage` (etc.) as argv — same *argv idea* as `! claude /usage` in a shell.
 *
 * Default: spawn `claude` directly with a **cleaned env** (avoids nvm vs `npm_config_prefix` when the API was started
 * from npm/node). Set `CLAUDE_USAGE_BASH_LC=1` to wrap in bash: use `CLAUDE_USAGE_BASH_LOGIN=1` for `bash -lc`
 * (sources profile/nvm); default bash wrapper is `bash -c` (non-login) to reduce profile side effects.
 */
export async function runClaudeSlashShellProbe(opts: {
  claudeBin: string;
  cwd: string;
  slash: UsageSlash;
  model?: string;
  timeoutMs: number;
}): Promise<ClaudeRunResult> {
  const env = usageProbeCleanEnv();
  const mid = middleArgvPieces(opts.model);
  const useBash =
    process.platform !== 'win32' &&
    ['1', 'true', 'yes'].includes((process.env.CLAUDE_USAGE_BASH_LC ?? '').toLowerCase());

  if (useBash) {
    const login = ['1', 'true', 'yes'].includes((process.env.CLAUDE_USAGE_BASH_LOGIN ?? '').toLowerCase());
    const flag = login ? '-lc' : '-c';
    const midStr = mid.map(shSingleQuote).join(' ');
    const inner = `cd ${shSingleQuote(opts.cwd)} && exec ${shSingleQuote(opts.claudeBin)}${
      midStr ? ` ${midStr}` : ''
    } ${opts.slash}`;
    const bashArgv = ['bash', flag, inner];
    const child = spawn('bash', [flag, inner], {
      cwd: opts.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return watchClaudeProcess(child, opts.timeoutMs, bashArgv);
  }

  const args = [...mid, opts.slash];
  const argv = [opts.claudeBin, ...args];
  const child = spawn(opts.claudeBin, args, {
    cwd: opts.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return watchClaudeProcess(child, opts.timeoutMs, argv);
}

/**
 * Send a slash line on **stdin** (like typing `/usage` in an interactive Claude session). This avoids argv paths
 * where the CLI treats `/usage` as a skill slug and prints `Unknown skill: usage` (slash stripped for lookup).
 */
export async function runClaudeWithSlashViaStdin(opts: {
  claudeBin: string;
  cwd: string;
  /** e.g. `/usage` — leading slash preserved in the bytes written to stdin */
  line: string;
  model?: string;
  timeoutMs: number;
}): Promise<ClaudeRunResult> {
  const env = usageProbeCleanEnv();
  const args = middleArgvPieces(opts.model);
  const argv = [opts.claudeBin, ...args];
  const child = spawn(opts.claudeBin, args, {
    cwd: opts.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const payload = opts.line.endsWith('\n') ? opts.line : `${opts.line}\n`;
  try {
    child.stdin?.write(payload);
  } catch {
    /* ignore broken pipe */
  }
  try {
    child.stdin?.end();
  } catch {
    /* ignore */
  }
  return watchClaudeProcess(child, opts.timeoutMs, argv);
}

/** Allowed single-line slash commands from the Usage terminal (no spaces, no shell metacharacters). */
const SAFE_SLASH_LINE = /^\/[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export function assertSafeSlashLine(line: unknown): string | null {
  if (typeof line !== 'string') return null;
  const t = line.trim();
  if (!SAFE_SLASH_LINE.test(t)) return null;
  return t;
}

function usageBareProbes(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.CLAUDE_USAGE_BARE_PROBES ?? '').toLowerCase());
}

/** Force stdin/argv slash for `/usage` (opens the interactive TUI; often hangs without a TTY). Default: off. */
function usageUsagePreferInteractiveSlash(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.CLAUDE_USAGE_USAGE_INTERACTIVE_SLASH ?? '').toLowerCase());
}

/**
 * On Unix, run `timeout … claude "/usage"` under bash (real Usage TUI frame before SIGTERM). Default on; set
 * `CLAUDE_USAGE_BASH_QUOTED_USAGE=0` to skip. Windows: off (no bash); use WSL or headless `-p` instead.
 */
function usageBashQuotedUsageEnabled(): boolean {
  if (process.platform === 'win32') return false;
  return !['0', 'false', 'no'].includes((process.env.CLAUDE_USAGE_BASH_QUOTED_USAGE ?? '1').toLowerCase());
}

function safeTimeoutSpec(): string {
  const raw = (process.env.CLAUDE_USAGE_BASH_USAGE_TIMEOUT_SPEC ?? '5s').trim() || '5s';
  return /^[0-9]+(?:\.[0-9]+)?\s*(?:s|m|h|ms)?$/i.test(raw) ? raw.replace(/\s+/g, '') : '5s';
}

/** Parse GNU-timeout-style duration for outer watch slack (e.g. 5s → 5000). */
function parseTimeoutSpecToMs(spec: string): number {
  const t = spec.trim();
  const m = t.match(/^([0-9]+(?:\.[0-9]+)?)(s|m|h|ms)?$/i);
  if (!m) return 5000;
  const n = parseFloat(m[1]);
  const u = (m[2] || 's').toLowerCase();
  if (u === 'ms') return Math.max(100, Math.round(n));
  if (u === 'm') return Math.round(n * 60_000);
  if (u === 'h') return Math.round(n * 3_600_000);
  return Math.max(100, Math.round(n * 1000));
}

function usageOutputLooksLikeUsageTui(blob: string): boolean {
  const s = blob.trim();
  if (s.length < 30) return false;
  if (/unknown skill:/i.test(s)) return false;
  return /% used|Current session|current week|weekly|extra usage|resets|UTC|█/i.test(s);
}

/** Accept partial Usage TUI (GNU timeout exit 124, tab strip, Esc hint, etc.) so we do not always run slow headless -p. */
function usageOutputAcceptableFromBash(r: ClaudeRunResult, blob: string): boolean {
  if (usageOutputLooksLikeUsageTui(blob)) return true;
  const t = blob.trim();
  if (t.length < 15 || /unknown skill:/i.test(t)) return false;
  if (r.code === 124) return true;
  if (/status\s+config\s+usage|usage\s+stats|esc to cancel|current session|extra usage/i.test(t)) return true;
  return false;
}

/** How the server satisfied this slash line (for UI / debugging). */
export type UsageExecMode = 'bash_quoted_usage' | 'headless_usage_tab' | 'repl_stdin';

/**
 * Bash + optional GNU `timeout` + `claude "/usage"` — captures the same TUI-ish stdout as your shell workaround
 * (`timeout 5s claude "/usage"`). Uses `timeout` when `command -v timeout` succeeds; otherwise relies on the API
 * watch cap to SIGTERM the child.
 */
async function runClaudeQuotedUsageViaBash(opts: {
  claudeBin: string;
  cwd: string;
  model?: string;
  timeoutMs: number;
}): Promise<ClaudeRunResult> {
  const env = usageProbeCleanEnv();
  const mid = middleArgvPieces(opts.model);
  const midStr = mid.length ? ` ${mid.map(shSingleQuote).join(' ')}` : '';
  const dur = safeTimeoutSpec();
  const binQ = shSingleQuote(opts.claudeBin);
  const inner = `cd ${shSingleQuote(opts.cwd)} && if command -v timeout >/dev/null 2>&1; then timeout ${dur} ${binQ}${midStr} "/usage"; else ${binQ}${midStr} "/usage"; fi`;
  const login = ['1', 'true', 'yes'].includes((process.env.CLAUDE_USAGE_BASH_LOGIN ?? '').toLowerCase());
  const flag = login ? '-lc' : '-c';
  const child = spawn('bash', [flag, inner], {
    cwd: opts.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const argv = ['bash', flag, inner];
  const innerMs = parseTimeoutSpecToMs(dur);
  const capRaw = parseInt(process.env.CLAUDE_USAGE_BASH_WATCH_CAP_MS ?? '', 10);
  /** Outer SIGTERM must be only slightly above inner `timeout` so the UI does not sit at ~30s. */
  const derivedCap = Math.min(20_000, Math.max(7000, innerMs + 4000));
  const cap = Math.min(
    opts.timeoutMs,
    Number.isFinite(capRaw) && capRaw >= 3000 ? capRaw : derivedCap
  );
  return watchClaudeProcess(child, cap, argv);
}

/**
 * Interactive `/usage` is a tabbed TUI that expects keys (e.g. Esc) and often never exits under piped stdio.
 * Default: one `claude -p` headless run that reproduces the **Usage** tab text and exits (same idea as dashboard NL probes).
 */
async function runUsageTabNonInteractive(
  opts: {
    claudeBin: string;
    cwd: string;
    model?: string;
    timeoutMs: number;
  },
  /** After bash `/usage` looked unusable — cap so total wait is not bash + full CLAUDE_USAGE_TIMEOUT_MS. */
  capAsHeadlessFallback = false
): Promise<ClaudeRunResult> {
  let timeoutMs = opts.timeoutMs;
  if (capAsHeadlessFallback) {
    const fbRaw = parseInt(process.env.CLAUDE_USAGE_HEADLESS_FALLBACK_MS ?? '', 10);
    timeoutMs = Math.min(
      opts.timeoutMs,
      Number.isFinite(fbRaw) && fbRaw >= 5000 ? fbRaw : 25_000
    );
  }
  return runClaudePrint({
    prompt: USAGE_TAB_HEADLESS_PROMPT,
    cwd: opts.cwd,
    model: opts.model,
    timeoutMs,
    claudeBin: opts.claudeBin,
    bare: usageBareProbes()
  });
}

/**
 * Prefer stdin `/…` (interactive-style). If output still looks like `Unknown skill:` for /status|/usage|/stats,
 * retry once with argv `claude /…` (shell-style).
 *
 * `/usage` (default): on Unix try `bash -c 'timeout … claude "/usage"'` for real TUI stdout; if unusable, fall back to
 * headless `-p` Usage-tab fill. Opt out of bash with `CLAUDE_USAGE_BASH_QUOTED_USAGE=0`. Opt in to stdin slash with
 * `CLAUDE_USAGE_USAGE_INTERACTIVE_SLASH=1`.
 */
export async function runUsageInteractiveLine(opts: {
  claudeBin: string;
  cwd: string;
  line: string;
  model?: string;
  timeoutMs: number;
}): Promise<{ result: ClaudeRunResult; execMode: UsageExecMode }> {
  if (opts.line === '/usage' && !usageUsagePreferInteractiveSlash()) {
    const triedBash = usageBashQuotedUsageEnabled();
    if (triedBash) {
      const br = await runClaudeQuotedUsageViaBash(opts);
      const blob = `${br.stdout}\n${br.stderr}`;
      if (usageOutputAcceptableFromBash(br, blob)) {
        return { result: br, execMode: 'bash_quoted_usage' };
      }
    }
    const hr = await runUsageTabNonInteractive(opts, triedBash);
    return { result: hr, execMode: 'headless_usage_tab' };
  }

  const stdinR = await runClaudeWithSlashViaStdin(opts);
  const blob = `${stdinR.stdout}\n${stdinR.stderr}`;
  if (!/unknown skill:/i.test(blob)) return { result: stdinR, execMode: 'repl_stdin' };
  if (opts.line === '/status' || opts.line === '/usage' || opts.line === '/stats') {
    const ar = await runClaudeSlashShellProbe({
      claudeBin: opts.claudeBin,
      cwd: opts.cwd,
      slash: opts.line as UsageSlash,
      model: opts.model,
      timeoutMs: opts.timeoutMs
    });
    return { result: ar, execMode: 'repl_stdin' };
  }
  return { result: stdinR, execMode: 'repl_stdin' };
}
