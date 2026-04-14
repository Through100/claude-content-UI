/**
 * PTY session management via Python pty-proxy.py
 *
 * node-pty requires a compiled native addon (make/gcc) that isn't available here.
 * Instead we spawn `scripts/pty-proxy.py` with piped stdio; the Python script
 * uses os.openpty() to allocate a real PTY, forks the claude child into it, and
 * proxies raw bytes between its own stdin/stdout and the PTY master.
 *
 * The server writes resize commands as newline-terminated JSON to a pipe that
 * the Python script reads on fd 3 (passed as `stdio[3]`).
 *
 * Each WebSocket connection maps to one PtySession.  Sessions are killed when
 * the WebSocket closes, or after PTY_SESSION_IDLE_MS of inactivity.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'pty-proxy.py');

const PTY_SESSION_IDLE_MS = 10 * 60 * 1000; // 10 minutes

export interface PtySession {
  id: string;
  child: ChildProcess;
  lastActivity: number;
  cols: number;
  rows: number;
  onData: (chunk: string) => void;
  onExit: (code: number | null) => void;
}

const sessions = new Map<string, PtySession>();

// Idle cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActivity > PTY_SESSION_IDLE_MS) {
      killSession(id);
    }
  }
}, 60_000).unref();

export function createPtySession(opts: {
  claudeBin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
  onData: (chunk: string) => void;
  onExit: (code: number | null) => void;
}): PtySession {
  const id = randomUUID();
  const cols = opts.cols ?? 220;
  const rows = opts.rows ?? 50;

  const child = spawn(
    'python3',
    [PROXY_SCRIPT, opts.claudeBin],
    {
      cwd: opts.cwd,
      env: { ...opts.env, PTY_COLS: String(cols), PTY_ROWS: String(rows) },
      // fd 0: stdin from server → PTY  (piped)
      // fd 1: PTY output → server      (piped)
      // fd 2: stderr for diagnostics   (piped — we forward to onData)
      // fd 3: resize control pipe      (pipe — server writes JSON resize cmds)
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    }
  );

  const session: PtySession = {
    id,
    child,
    lastActivity: Date.now(),
    cols,
    rows,
    onData: opts.onData,
    onExit: opts.onExit,
  };

  child.stdout?.on('data', (buf: Buffer) => {
    session.lastActivity = Date.now();
    opts.onData(buf.toString('binary'));
  });

  child.stderr?.on('data', (buf: Buffer) => {
    session.lastActivity = Date.now();
    // Only forward non-empty stderr so diagnostics reach the terminal
    const text = buf.toString('utf8');
    if (text.trim()) opts.onData(text);
  });

  child.on('close', (code) => {
    sessions.delete(id);
    opts.onExit(code);
  });

  sessions.set(id, session);
  return session;
}

/** Send raw bytes to the PTY (keyboard input from the user). */
export function writeToPty(session: PtySession, data: string): void {
  session.lastActivity = Date.now();
  try {
    session.child.stdin?.write(Buffer.from(data, 'binary'));
  } catch {
    /* ignore broken pipe */
  }
}

/** Send a resize command to the Python proxy on fd 3. */
export function resizePty(session: PtySession, cols: number, rows: number): void {
  session.cols = cols;
  session.rows = rows;
  try {
    const pipe = (session.child.stdio as (NodeJS.WritableStream | null)[])[3];
    if (pipe && 'write' in pipe) {
      (pipe as NodeJS.WritableStream).write(
        JSON.stringify({ cols, rows }) + '\n'
      );
    }
  } catch {
    /* ignore */
  }
}

export function killSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try {
    s.child.stdin?.end();
    s.child.kill('SIGTERM');
  } catch {
    /* ignore */
  }
}

export function getSession(id: string): PtySession | undefined {
  return sessions.get(id);
}
