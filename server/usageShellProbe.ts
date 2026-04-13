import { spawn } from 'node:child_process';
import { watchClaudeProcess, type ClaudeRunResult } from './claudeRunner';

export type UsageSlash = '/status' | '/usage' | '/stats';

/**
 * Run Claude Code the same way the interactive TUI does after `!` → shell:
 * `claude /usage` (argv: `claude`, `/usage`), not `claude -p "/usage"` (skill lookup in print mode).
 */
export async function runClaudeSlashShellProbe(opts: {
  claudeBin: string;
  cwd: string;
  slash: UsageSlash;
  model?: string;
  timeoutMs: number;
}): Promise<ClaudeRunResult> {
  const args: string[] = [];
  const m = opts.model?.trim();
  if (m && m !== 'default') {
    args.push('--model', m);
  }
  const extra = process.env.CLAUDE_EXTRA_ARGS?.trim();
  if (extra) {
    args.push(...extra.split(/\s+/).filter(Boolean));
  }
  args.push(opts.slash);
  const argv = [opts.claudeBin, ...args];
  const child = spawn(opts.claudeBin, args, {
    cwd: opts.cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return watchClaudeProcess(child, opts.timeoutMs, argv);
}
