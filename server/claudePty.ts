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
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROXY_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'pty-proxy.py');
const WIN_STUB = path.resolve(__dirname, '..', 'scripts', 'pty-windows-stub.mjs');

const PTY_SESSION_IDLE_MS = 10 * 60 * 1000; // 10 minutes

function envTruthy(v: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase());
}

/** execvp does not expand `~`; normalize so pty-proxy receives a real path when .env uses ~/. */
function resolveClaudeBinForPty(bin: string): string {
  const t = bin.trim();
  if (t.startsWith('~/')) return path.join(os.homedir(), t.slice(2));
  if (t === '~') return os.homedir();
  return t;
}

/** `C:\\foo\\bar` → `/mnt/c/foo/bar` for WSL default mounts. */
function windowsPathToWsl(p: string): string {
  const resolved = path.resolve(p);
  const norm = resolved.replace(/\//g, '\\');
  const m = /^([a-zA-Z]):\\(.*)$/.exec(norm);
  if (!m) return resolved.replace(/\\/g, '/');
  const drive = m[1].toLowerCase();
  const rest = m[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest.replace(/^\//, '')}`;
}

/**
 * How to spawn Python for `pty-proxy.py`.
 * Windows: plain `python3` often resolves to the Microsoft Store stub — default to `py -3` (python.org launcher).
 * Set `PTY_PYTHON` to a full path, or e.g. `py -3.12`, or `python` if that is your real interpreter.
 */
function resolvePtyPythonSpawn(): { file: string; args: string[] } {
  const raw = process.env.PTY_PYTHON?.trim();
  if (raw) {
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { file: parts[0]!, args: [] };
    return { file: parts[0]!, args: parts.slice(1) };
  }
  if (process.platform === 'win32') {
    return { file: 'py', args: ['-3'] };
  }
  return { file: 'python3', args: [] };
}

function ptySpawnFailureHint(): string {
  if (process.platform !== 'win32') {
    return '[pty-proxy] Install Python 3 so `python3` is on PATH, or set PTY_PYTHON to your interpreter (see .env.example).';
  }
  return (
    '[pty-proxy] Windows: install Python 3 from https://www.python.org/downloads/ (enable “Add python.exe to PATH” and the py launcher), ' +
    'or set PTY_PYTHON in .env to your real python.exe (full path). ' +
    'If you see the Microsoft Store message, disable App execution aliases for python.exe/python3.exe ' +
    '(Settings → Apps → Advanced app settings → App execution aliases), or keep using `py -3` (default when PTY_PYTHON is unset). ' +
    'Native Windows cannot run the PTY proxy (no termios): use WSL (`CLAUDE_PTY_WSL=1` in .env) or set CLAUDE_TERMINAL_WS=0.'
  );
}

/** argv for the PTY child: POSIX Python proxy, WSL-wrapped proxy, or Windows help stub. */
function resolvePtyChildArgv(claudeBin: string): { file: string; args: string[] } {
  const claudeResolved = resolveClaudeBinForPty(claudeBin);
  if (process.platform === 'win32' && !envTruthy(process.env.CLAUDE_PTY_WSL)) {
    return { file: process.execPath, args: [WIN_STUB] };
  }
  if (process.platform === 'win32' && envTruthy(process.env.CLAUDE_PTY_WSL)) {
    const proxyWsl = windowsPathToWsl(PROXY_SCRIPT);
    const claudeWsl =
      /^[a-zA-Z]:\\/.test(claudeResolved) || claudeResolved.startsWith('\\\\')
        ? windowsPathToWsl(claudeResolved)
        : claudeResolved;
    const distro = process.env.CLAUDE_WSL_DISTRO?.trim();
    const args = distro
      ? ['-d', distro, '-e', 'python3', proxyWsl, claudeWsl]
      : ['-e', 'python3', proxyWsl, claudeWsl];
    return { file: 'wsl.exe', args };
  }
  const py = resolvePtyPythonSpawn();
  return { file: py.file, args: [...py.args, PROXY_SCRIPT, claudeResolved] };
}

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

  const ptyEnv: NodeJS.ProcessEnv = { ...opts.env, PTY_COLS: String(cols), PTY_ROWS: String(rows) };
  // Match a normal SSH session: UTF-8 locale so Unicode borders and bullets are not mojibake.
  if (!ptyEnv.LC_ALL?.trim()) {
    if (!ptyEnv.LANG?.trim()) ptyEnv.LANG = 'C.UTF-8';
    if (!ptyEnv.LC_CTYPE?.trim()) ptyEnv.LC_CTYPE = ptyEnv.LANG ?? 'C.UTF-8';
  }

  const utf8Decoder = new StringDecoder('utf8');

  const { file: childFile, args: childArgs } = resolvePtyChildArgv(opts.claudeBin);
  const child = spawn(childFile, childArgs, {
    cwd: opts.cwd,
    env: ptyEnv,
    // fd 0: stdin from server → PTY  (piped)
    // fd 1: PTY output → server      (piped)
    // fd 2: stderr for diagnostics   (piped — we forward to onData)
    // fd 3: resize control pipe      (pipe — server writes JSON resize cmds)
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
  });

  const session: PtySession = {
    id,
    child,
    lastActivity: Date.now(),
    cols,
    rows,
    onData: opts.onData,
    onExit: opts.onExit,
  };
  sessions.set(id, session);

  let finished = false;
  const finish = (code: number | null) => {
    if (finished) return;
    finished = true;
    const tail = utf8Decoder.end();
    if (tail) opts.onData(tail);
    sessions.delete(id);
    opts.onExit(code);
  };

  child.on('error', (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    opts.onData(`\r\n\x1b[31m[pty-proxy] ${msg}\x1b[0m\r\n${ptySpawnFailureHint()}\r\n`);
    finish(127);
  });

  child.stdout?.on('data', (buf: Buffer) => {
    session.lastActivity = Date.now();
    const chunk = utf8Decoder.write(buf);
    if (chunk) opts.onData(chunk);
  });

  child.stderr?.on('data', (buf: Buffer) => {
    session.lastActivity = Date.now();
    // Only forward non-empty stderr so diagnostics reach the terminal
    const text = buf.toString('utf8');
    if (text.trim()) opts.onData(text);
  });

  child.on('close', (code) => {
    finish(code);
  });

  return session;
}

/** Send raw bytes to the PTY (keyboard input from the user). */
export function writeToPty(session: PtySession, data: string): void {
  session.lastActivity = Date.now();
  try {
    session.child.stdin?.write(Buffer.from(data, 'utf8'));
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
