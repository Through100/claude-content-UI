import { spawn } from 'node:child_process';
import process from 'node:process';

const children = [
  spawn('npm', ['run', 'dev:vite'], { stdio: 'inherit', shell: true, env: process.env }),
  spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', shell: true, env: process.env })
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (c.exitCode === null && !c.killed) {
      c.kill('SIGTERM');
    }
  }
  process.exit(code);
}

for (const c of children) {
  c.on('error', err => {
    console.error('[run-dev]', err);
    shutdown(1);
  });
  c.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const exitCode = code ?? (signal ? 1 : 0);
    if (exitCode !== 0) {
      console.error(`[run-dev] child exited with ${exitCode}${signal ? ` (${signal})` : ''}`);
    }
    shutdown(exitCode);
  });
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
