import { spawn } from 'node:child_process';
import { watchClaudeProcess, type ClaudeRunResult } from './claudeRunner';

export type UsageSlash = '/status' | '/usage' | '/stats';

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
 * Run Claude Code the same way the interactive TUI does after `!` → shell:
 * `claude /usage` (argv: `claude`, `/usage`), not `claude -p "/usage"` (skill lookup in print mode).
 *
 * On non-Windows hosts, default is `bash -lc 'cd … && exec claude … /usage'` so PATH and cwd match a login shell
 * more closely than a bare Node `spawn`. Set `CLAUDE_USAGE_BASH_LC=0` to spawn `claude` directly.
 */
export async function runClaudeSlashShellProbe(opts: {
  claudeBin: string;
  cwd: string;
  slash: UsageSlash;
  model?: string;
  timeoutMs: number;
}): Promise<ClaudeRunResult> {
  const mid = middleArgvPieces(opts.model);
  const useBash =
    process.platform !== 'win32' &&
    !['0', 'false', 'no'].includes((process.env.CLAUDE_USAGE_BASH_LC ?? '1').toLowerCase());

  if (useBash) {
    const midStr = mid.map(shSingleQuote).join(' ');
    const inner = `cd ${shSingleQuote(opts.cwd)} && exec ${shSingleQuote(opts.claudeBin)}${
      midStr ? ` ${midStr}` : ''
    } ${opts.slash}`;
    const bashArgv = ['bash', '-lc', inner];
    const child = spawn('bash', ['-lc', inner], {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return watchClaudeProcess(child, opts.timeoutMs, bashArgv);
  }

  const args = [...mid, opts.slash];
  const argv = [opts.claudeBin, ...args];
  const child = spawn(opts.claudeBin, args, {
    cwd: opts.cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return watchClaudeProcess(child, opts.timeoutMs, argv);
}
