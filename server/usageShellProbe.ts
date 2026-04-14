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

/** Strip ANSI SGR sequences so Usage panels render cleanly in HTML `<pre>`. */
export function stripAnsiForWeb(text: string): string {
  return text.replace(/\u001b\[[\d;]*[mGKH]/g, '').replace(/\u001b\]8;;[^\u0007]*\u0007/g, '');
}

function shSingleQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\"'\"'`)}'`;
}

function usageInnerTimeoutSpec(): string {
  const raw = (process.env.CLAUDE_USAGE_BASH_USAGE_TIMEOUT_SPEC ?? '5s').trim() || '5s';
  return /^[0-9]+(?:\.[0-9]+)?\s*(?:s|m|h|ms)?$/i.test(raw) ? raw.replace(/\s+/g, '') : '5s';
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
  const env = usageProbeCleanEnv();
  const dur = usageInnerTimeoutSpec();
  const inner = `timeout ${dur} ${shSingleQuote(opts.claudeBin)} "/usage"`;

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
