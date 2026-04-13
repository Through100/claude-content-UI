import { spawn, type ChildProcess } from 'node:child_process';

export interface ClaudeRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Full argv for diagnostics when output is empty */
  argv: string[];
}

export interface RunClaudePrintOptions {
  prompt: string;
  cwd: string;
  model?: string;
  timeoutMs: number;
  claudeBin: string;
  /** When true, passes \`--bare\` before \`-p\` (skips skills/MCP/hooks discovery; see Claude Code headless docs). */
  bare?: boolean;
}

export type ClaudeStreamChunkHandlers = {
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
};

/** Claude Code maps bypassPermissions to dangerously-skip-permissions, which is refused when uid is 0. */
function isUnixSuperuser(): boolean {
  if (process.platform === 'win32') return false;
  try {
    return typeof process.getuid === 'function' && process.getuid() === 0;
  } catch {
    return false;
  }
}

/** Log once at startup how auto --permission-mode behaves for this process. */
export function logClaudeAutoPermissionPolicy(): void {
  const disableAutoPerm = ['1', 'true', 'yes'].includes(
    (process.env.CLAUDE_DISABLE_AUTO_PERMISSION_MODE ?? '').toLowerCase()
  );
  const extra = process.env.CLAUDE_EXTRA_ARGS ?? '';
  if (/--permission-mode\b/.test(` ${extra} `)) {
    console.log('[claude-seo-ui] Permission-mode: using CLAUDE_EXTRA_ARGS (auto append skipped).');
    return;
  }
  if (disableAutoPerm) {
    console.log('[claude-seo-ui] Permission-mode: auto append disabled (CLAUDE_DISABLE_AUTO_PERMISSION_MODE).');
    return;
  }
  if (isUnixSuperuser()) {
    console.warn(
      '[claude-seo-ui] Permission-mode: not appending bypassPermissions — this process is root and Claude Code rejects it. Run Node as a non-root user (e.g. USER node in Docker) so headless WebFetch/MCP can use --permission-mode bypassPermissions.'
    );
    return;
  }
  console.log(
    `[claude-seo-ui] Permission-mode: appending --permission-mode ${
      process.env.CLAUDE_PERMISSION_MODE?.trim() || 'bypassPermissions'
    } for headless runs (opt out: CLAUDE_DISABLE_AUTO_PERMISSION_MODE=1).`
  );
}

/** Human-readable spawn failure (ENOENT, etc.) for logs and API responses. */
export function formatClaudeSpawnError(err: unknown, argv: string[]): string {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') {
    const bin = argv[0] ?? 'claude';
    return `${msg}\n\nExecutable not found: ${JSON.stringify(
      bin
    )}. The API process must be able to spawn Claude Code — set CLAUDE_BIN to the full path (same as \`which claude\` / \`where claude\` on the host that runs Node).`;
  }
  return msg;
}

function buildArgs(prompt: string, model?: string, bare?: boolean): string[] {
  const args: string[] = [];
  if (bare) args.push('--bare');
  args.push('-p', prompt);
  if (model && model !== 'default') {
    args.push('--model', model);
  }
  const extra = process.env.CLAUDE_EXTRA_ARGS?.trim();
  const extraForScan = ` ${extra ?? ''} `;
  const disableAutoPerm = ['1', 'true', 'yes'].includes(
    (process.env.CLAUDE_DISABLE_AUTO_PERMISSION_MODE ?? '').toLowerCase()
  );
  const extraAlreadyHasPermission = /--permission-mode\b/.test(extraForScan);
  if (!disableAutoPerm && !extraAlreadyHasPermission && !isUnixSuperuser()) {
    const mode = process.env.CLAUDE_PERMISSION_MODE?.trim() || 'bypassPermissions';
    args.push('--permission-mode', mode);
  }
  if (extra) {
    args.push(...extra.split(/\s+/).filter(Boolean));
  }
  return args;
}

/**
 * Attach stdout/stderr capture and wait for exit or spawn error.
 * Handles ENOENT ordering: if `close` fires before `error`, a later `error` must not become an uncaught exception.
 */
export function watchClaudeProcess(
  child: ChildProcess,
  timeoutMs: number,
  argv: string[],
  stream?: ClaudeStreamChunkHandlers
): Promise<ClaudeRunResult> {
  let stdout = '';
  let stderr = '';

  const timer = setTimeout(() => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }, timeoutMs);

  const clearTimer = () => clearTimeout(timer);

  return new Promise((resolve, reject) => {
    let settled = false;

    const detach = () => {
      child.off('error', onError);
      child.off('close', onClose);
      child.stdout?.removeAllListeners('data');
      child.stderr?.removeAllListeners('data');
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimer();
      detach();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimer();
      detach();
      child.on('error', () => {});
      resolve({
        stdout,
        stderr,
        code: typeof code === 'number' ? code : null,
        signal: signal || null,
        argv
      });
    };

    child.on('error', onError);
    child.on('close', onClose);

    child.stdout?.on('data', (c: Buffer) => {
      const t = c.toString('utf8');
      stdout += t;
      stream?.onStdoutChunk?.(t);
    });
    child.stderr?.on('data', (c: Buffer) => {
      const t = c.toString('utf8');
      stderr += t;
      stream?.onStderrChunk?.(t);
    });
  });
}

export interface SpawnClaudeOpts {
  prompt: string;
  cwd: string;
  model?: string;
  claudeBin: string;
  bare?: boolean;
}

/** Spawn `claude -p …` without waiting (for SSE streaming). */
export function spawnClaudeChild(opts: SpawnClaudeOpts): { child: ChildProcess; argv: string[] } {
  const args = buildArgs(opts.prompt, opts.model, opts.bare);
  const argv = [opts.claudeBin, ...args];
  const child = spawn(opts.claudeBin, args, {
    cwd: opts.cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { child, argv };
}

export async function runClaudePrint(opts: RunClaudePrintOptions): Promise<ClaudeRunResult> {
  const { child, argv } = spawnClaudeChild({
    prompt: opts.prompt,
    cwd: opts.cwd,
    model: opts.model,
    claudeBin: opts.claudeBin,
    bare: opts.bare
  });
  return watchClaudeProcess(child, opts.timeoutMs, argv);
}

export async function runClaudeVersion(claudeBin: string): Promise<ClaudeRunResult> {
  const argv = [claudeBin, '-v'];
  const child = spawn(claudeBin, ['-v'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return watchClaudeProcess(child, 30_000, argv);
}

export async function runClaudeInitOnly(claudeBin: string, cwd: string): Promise<ClaudeRunResult> {
  const argv = [claudeBin, '--init-only'];
  const child = spawn(claudeBin, ['--init-only'], {
    cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return watchClaudeProcess(child, 120_000, argv);
}
