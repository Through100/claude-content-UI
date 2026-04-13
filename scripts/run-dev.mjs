import { spawn } from 'node:child_process';
import process from 'node:process';

// Load crypto polyfill before any child processes
import { webcrypto } from 'node:crypto';
if (webcrypto) {
  const g = globalThis;
  if (!g.crypto) {
    g.crypto = webcrypto;
  }
  if (typeof g.crypto.getRandomValues !== 'function' && typeof webcrypto.getRandomValues === 'function') {
    g.crypto.getRandomValues = webcrypto.getRandomValues.bind(webcrypto);
  }
}

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectDir = dirname(__dirname);
const polyfillPath = `${projectDir}/scripts/webcrypto-polyfill.cjs`;

const children = [
  spawn('node', ['-r', polyfillPath, `${projectDir}/node_modules/vite/bin/vite.js`, '--port=3000', '--host=0.0.0.0'], { stdio: 'inherit', shell: false, env: process.env, cwd: projectDir }),
  spawn('npm', ['run', 'dev:server'], { stdio: 'inherit', shell: true, env: process.env, cwd: projectDir })
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
