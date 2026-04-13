import { spawn } from 'node:child_process';

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
}

function buildArgs(prompt: string, model?: string): string[] {
  const args = ['-p', prompt];
  if (model && model !== 'default') {
    args.push('--model', model);
  }
  const mode = process.env.CLAUDE_PERMISSION_MODE || 'bypassPermissions';
  args.push('--permission-mode', mode);
  const extra = process.env.CLAUDE_EXTRA_ARGS?.trim();
  if (extra) {
    args.push(...extra.split(/\s+/).filter(Boolean));
  }
  return args;
}

function collectProcess(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
  argv: string[]
): Promise<ClaudeRunResult> {
  let stdout = '';
  let stderr = '';

  child.stdout?.on('data', (c: Buffer) => {
    stdout += c.toString('utf8');
  });
  child.stderr?.on('data', (c: Buffer) => {
    stderr += c.toString('utf8');
  });

  const timer = setTimeout(() => {
    child.kill('SIGTERM');
  }, timeoutMs);

  return new Promise((resolve, reject) => {
    child.once('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    // Use 'close' so stdout/stderr are fully flushed (exit can fire too early).
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        code: typeof code === 'number' ? code : null,
        signal: signal || null,
        argv
      });
    });
  });
}

export async function runClaudePrint(opts: RunClaudePrintOptions): Promise<ClaudeRunResult> {
  const args = buildArgs(opts.prompt, opts.model);
  const argv = [opts.claudeBin, ...args];
  const child = spawn(opts.claudeBin, args, {
    cwd: opts.cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return collectProcess(child, opts.timeoutMs, argv);
}

export async function runClaudeVersion(claudeBin: string): Promise<ClaudeRunResult> {
  const argv = [claudeBin, '-v'];
  const child = spawn(claudeBin, ['-v'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return collectProcess(child, 30_000, argv);
}

export async function runClaudeInitOnly(claudeBin: string, cwd: string): Promise<ClaudeRunResult> {
  const argv = [claudeBin, '--init-only'];
  const child = spawn(claudeBin, ['--init-only'], {
    cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return collectProcess(child, 120_000, argv);
}
