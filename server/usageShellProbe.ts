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

/**
 * Run `bash -c 'timeout 5s claude "/usage"'` and return the raw stdout+stderr.
 */
export async function runBashUsage(opts: {
  claudeBin: string;
  cwd: string;
  timeoutMs: number;
}): Promise<{ output: string; exitCode: number | null; argv: string[] }> {
  const env = usageProbeCleanEnv();
  const cmd = `timeout 5s ${shSingleQuote(opts.claudeBin)} "/usage"`;
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
