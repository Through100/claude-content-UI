import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { watchClaudeProcess } from './claudeRunner';
import { usageProbeCleanEnv } from './usageShellProbe';

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
    env: usageProbeCleanEnv(),
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

export type EnrichUsageSnapshotOpts = {
  /** When set (e.g. only for `/usage`), also append `usage-exact.json` if stdout/stderr merged to nothing useful. */
  treatEmptyAsFailure?: boolean;
};

/** When usage probes fail (Unknown skill, nvm noise) or optionally empty `/usage` output, append on-disk usage JSON if present. */
export function enrichUsagePanelWithLocalJsonWhenCliFails(
  raw: string,
  opts?: EnrichUsageSnapshotOpts
): string {
  const empty = !raw.trim();
  const bad =
    /unknown skill:\s*usage/i.test(raw) ||
    /nvm is not compatible/i.test(raw) ||
    /npm_config_prefix/i.test(raw);
  const wantSnapshot = bad || (opts?.treatEmptyAsFailure === true && empty);
  if (!wantSnapshot) return raw;
  const j = readUsageExactJsonFromHome();
  if (!j) return raw;
  return `${raw.trimEnd()}\n\n--- ~/.claude/usage-exact.json (local snapshot; CLI did not return usable /usage text here) ---\n${j}`;
}
