import { spawn } from 'node:child_process';

/**
 * Child env for Usage probes: strip npm_config_prefix to avoid nvm compatibility issues.
 */
export function usageProbeCleanEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(e)) {
    if (k.toLowerCase() === 'npm_config_prefix') delete e[k];
  }
  delete e.NPM_CONFIG_PREFIX;
  return e;
}

/**
 * Strip terminal escape sequences (CSI, OSC, DCS, etc.) so Usage output is plain text in HTML `<pre>`.
 * Box-drawing and Unicode text are preserved; cursor movement and TUI redraw codes are removed.
 */
export function stripAnsiForWeb(text: string): string {
  let s = text;
  for (let pass = 0; pass < 12; pass++) {
    const before = s;
    s = s
      // CSI (cursor, SGR, modes, etc.): ESC [ … final byte @–~
      .replace(/\u001b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '')
      // 8-bit CSI introducer (C1), rare but safe to remove
      .replace(/\u009b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '')
      // OSC … BEL or ST (ESC + backslash), including hyperlinks
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\x5c)/g, '')
      // DCS / APC / PM / SOS … ST
      .replace(/\u001bP[\s\S]*?\u001b\x5c/g, '')
      .replace(/\u001b_[\s\S]*?\u001b\x5c/g, '')
      .replace(/\u001b\^[\s\S]*?\u001b\x5c/g, '')
      .replace(/\u001bX[\s\S]*?\u001b\x5c/g, '')
      // Charset selects and SS2/SS3
      .replace(/\u001b[\(\)][\x20-\x7f]/g, '')
      .replace(/\u001b[NO][\x20-\x7f]/g, '')
      // DEC save/restore cursor
      .replace(/\u001b[78]/g, '')
      // Other common Fe escapes (single letter / symbol after ESC)
      .replace(/\u001b[@-Z\\-_]/g, '')
      // DEC line attributes: ESC # {3,4,5,6,8}
      .replace(/\u001b#[\x20-\x7f]/g, '');
    if (s === before) break;
  }
  s = s.replace(/\u001b\x5c/g, '');
  // Any remaining ESC + one 7-bit follow-up (partial sequences)
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(/\u001b[\x00-\x7f]/g, '');
    if (s === before) break;
  }
  s = s.replace(/\u009b/g, '');
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/\n{5,}/g, '\n\n\n\n');
  return s;
}

function shSingleQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\"'\"'`)}'`;
}

function usageInnerTimeoutSpec(): string {
  const raw = (process.env.CLAUDE_USAGE_BASH_USAGE_TIMEOUT_SPEC ?? '5s').trim() || '5s';
  return /^[0-9]+(?:\.[0-9]+)?\s*(?:s|m|h|ms)?$/i.test(raw) ? raw.replace(/\s+/g, '') : '5s';
}

/** Inner `timeout` duration for `claude "/status"` (PTY probe). */
export function accountStatusInnerTimeoutSpec(): string {
  const raw = (process.env.CLAUDE_ACCOUNT_STATUS_TIMEOUT_SPEC ?? '2s').trim() || '2s';
  return /^[0-9]+(?:\.[0-9]+)?\s*(?:s|m|h|ms)?$/i.test(raw) ? raw.replace(/\s+/g, '') : '2s';
}

type SlashQuoted = '"/usage"' | '"/status"';

/**
 * Run `timeout … claude "/usage"` or `… "/status"` in bash, optionally under `script` for a PTY on Linux.
 */
async function runBashClaudeSlashProbe(opts: {
  claudeBin: string;
  cwd: string;
  timeoutMs: number;
  slashQuoted: SlashQuoted;
  innerTimeoutSpec: string;
}): Promise<{ output: string; exitCode: number | null; argv: string[] }> {
  const env = usageProbeCleanEnv();
  const inner = `timeout ${opts.innerTimeoutSpec} ${shSingleQuote(opts.claudeBin)} ${opts.slashQuoted}`;

  const forceScript = ['1', 'true', 'yes'].includes((process.env.CLAUDE_USAGE_SCRIPT_PTY ?? '').toLowerCase());
  const skipScript = ['1', 'true', 'yes'].includes((process.env.CLAUDE_USAGE_NO_SCRIPT_PTY ?? '').toLowerCase());
  const useScript = !skipScript && (process.platform === 'linux' || forceScript);

  const cmd = useScript
    ? `if command -v script >/dev/null 2>&1; then script -qec ${shSingleQuote(inner)} /dev/null; else ${inner}; fi`
    : inner;

  const argv = ['bash', '-c', cmd];

  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', cmd], {
      cwd: opts.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const chunks: Buffer[] = [];
    child.stdout?.on('data', (d: Buffer) => chunks.push(d));
    child.stderr?.on('data', (d: Buffer) => chunks.push(d));

    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs);

    child.on('error', () => {
      clearTimeout(timer);
      resolve({
        output: stripAnsiForWeb(Buffer.concat(chunks).toString()),
        exitCode: null,
        argv
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        output: stripAnsiForWeb(Buffer.concat(chunks).toString()),
        exitCode: code,
        argv
      });
    });
  });
}

/**
 * Run the same idea as `timeout 5s claude "/usage"` in bash.
 *
 * When stdout/stderr are pipes (Node spawn), `claude` often treats `/usage` as a **skill** and prints
 * `Unknown skill: usage`. In a real terminal it is an interactive slash command. On Linux we wrap with
 * **`script -qec '…' /dev/null`** (util-linux) so the child gets a **PTY**, matching your manual bash test.
 */
export async function runBashUsage(opts: {
  claudeBin: string;
  cwd: string;
  timeoutMs: number;
}): Promise<{ output: string; exitCode: number | null; argv: string[] }> {
  return runBashClaudeSlashProbe({
    claudeBin: opts.claudeBin,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    slashQuoted: '"/usage"',
    innerTimeoutSpec: usageInnerTimeoutSpec()
  });
}

/** Same PTY tactic as {@link runBashUsage} for interactive `claude "/status"`. */
export async function runBashAccountStatus(opts: {
  claudeBin: string;
  cwd: string;
  timeoutMs: number;
}): Promise<{ output: string; exitCode: number | null; argv: string[] }> {
  return runBashClaudeSlashProbe({
    claudeBin: opts.claudeBin,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    slashQuoted: '"/status"',
    innerTimeoutSpec: accountStatusInnerTimeoutSpec()
  });
}
