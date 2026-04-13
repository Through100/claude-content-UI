import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { watchClaudeProcess } from './claudeRunner';

const READ_CAP = 96_000;

/** Best-effort read of Claude Code local usage file (no model call). */
export function readUsageExactJsonFromHome(): string | null {
  const p = path.join(os.homedir(), '.claude', 'usage-exact.json');
  try {
    const buf = fs.readFileSync(p);
    const txt = buf.toString('utf8');
    if (txt.length > READ_CAP) return `${txt.slice(0, READ_CAP)}\n\n…(truncated)`;
    return txt.trim() || null;
  } catch {
    return null;
  }
}

/** `claude auth status` is a local CLI check (not an NL `-p` session). */
export async function runClaudeAuthStatusText(
  claudeBin: string,
  cwd: string,
  timeoutMs: number
): Promise<string | null> {
  const argv = [claudeBin, 'auth', 'status', '--text'];
  const child = spawn(claudeBin, ['auth', 'status', '--text'], {
    cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const r = await watchClaudeProcess(child, timeoutMs, argv);
    const out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
    return out || null;
  } catch {
    return null;
  }
}
