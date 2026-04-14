import { spawn } from 'node:child_process';
import { watchClaudeProcess, type ClaudeRunResult } from './claudeRunner';

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

/**
 * Prefer stdin `/…` (interactive-style). If output still looks like `Unknown skill:` for /status|/usage|/stats,
 * retry once with argv `claude /…` (shell-style).
 */
export async function runUsageInteractiveLine(opts: {
  claudeBin: string;
  cwd: string;
  line: string;
  model?: string;
  timeoutMs: number;
}): Promise<ClaudeRunResult> {
  const stdinR = await runClaudeWithSlashViaStdin(opts);
  const blob = `${stdinR.stdout}\n${stdinR.stderr}`;
  if (!/unknown skill:/i.test(blob)) return stdinR;
  if (opts.line === '/status' || opts.line === '/usage' || opts.line === '/stats') {
    return runClaudeSlashShellProbe({
      claudeBin: opts.claudeBin,
      cwd: opts.cwd,
      slash: opts.line as UsageSlash,
      model: opts.model,
      timeoutMs: opts.timeoutMs
    });
  }
  return stdinR;
}
