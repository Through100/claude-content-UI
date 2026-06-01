import { spawn } from 'node:child_process';
import type { AccountStatusSnapshot } from '../src/types';
import { parseAccountStatusSnapshot } from './accountStatusParse';
import { runClaudeAuthStatusText } from './usageLocalSnapshot';
import { runBashAccountStatus, stripAnsiForWeb } from './usageShellProbe';
import { watchClaudeProcess } from './claudeRunner';

export type AccountStatusProbeResult = {
  line: string;
  execMode: string;
  output: string;
  exitCode: number | null;
  argv: string[];
  statusSnapshot: AccountStatusSnapshot;
};

function accountProbeTimeoutMs(): number {
  const raw = process.env.CLAUDE_ACCOUNT_PROBE_TIMEOUT_MS;
  if (raw === undefined || raw === '') return 20_000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 5_000 ? n : 20_000;
}

function useInteractiveStatusProbe(): boolean {
  return ['1', 'true', 'yes'].includes(
    (process.env.CLAUDE_ACCOUNT_USE_INTERACTIVE_STATUS ?? '').toLowerCase()
  );
}

async function runClaudeVersionLine(claudeBin: string, cwd: string): Promise<string> {
  const argv = [claudeBin, '-v'];
  const child = spawn(claudeBin, ['-v'], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const r = await watchClaudeProcess(child, 8_000, argv);
    return [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
  } catch {
    return '';
  }
}

/**
 * Account / header snapshot without spawning interactive `claude /status` (which can ignore `timeout` and leak processes).
 * Default: `claude auth status --text` + `claude -v`. Optional: `CLAUDE_ACCOUNT_USE_INTERACTIVE_STATUS=1` for legacy PTY `/status`.
 */
async function runAccountStatusProbeOnce(
  claudeBin: string,
  cwd: string
): Promise<AccountStatusProbeResult> {
  if (useInteractiveStatusProbe()) {
    const t = accountProbeTimeoutMs();
    const { output, exitCode, argv } = await runBashAccountStatus({ claudeBin, cwd, timeoutMs: t });
    return {
      line: '/status',
      execMode: 'bash_quoted_status',
      output,
      exitCode,
      argv,
      statusSnapshot: parseAccountStatusSnapshot(output)
    };
  }

  const parts: string[] = [];
  const argv: string[] = [claudeBin, 'auth', 'status', '--text'];
  let exitCode: number | null = 0;

  const authText = await runClaudeAuthStatusText(claudeBin, cwd, accountProbeTimeoutMs());
  if (authText) {
    parts.push('## claude auth status --text\n\n', authText.trim());
  } else {
    parts.push('(claude auth status --text returned no output)\n');
    exitCode = null;
  }

  const ver = await runClaudeVersionLine(claudeBin, cwd);
  if (ver) {
    parts.push('\n\n## claude -v\n\n', ver);
    const first = ver.split('\n').find((l) => l.trim())?.trim();
    if (first) parts.push(`\nVersion: ${first}`);
  }

  const output = stripAnsiForWeb(parts.join(''));
  const statusSnapshot = parseAccountStatusSnapshot(output);

  return {
    line: 'auth status --text',
    execMode: 'auth_status_text',
    output,
    exitCode,
    argv,
    statusSnapshot
  };
}

let accountProbeInFlight: Promise<AccountStatusProbeResult> | null = null;

/** Coalesce concurrent GET /api/account calls (header refresh + Account tab) into one probe. */
export function runAccountStatusProbeDeduped(claudeBin: string, cwd: string): Promise<AccountStatusProbeResult> {
  if (!accountProbeInFlight) {
    accountProbeInFlight = runAccountStatusProbeOnce(claudeBin, cwd).finally(() => {
      accountProbeInFlight = null;
    });
  }
  return accountProbeInFlight;
}
