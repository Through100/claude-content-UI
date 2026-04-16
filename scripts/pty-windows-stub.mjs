/**
 * Native Windows cannot run pty-proxy.py (no termios/fcntl). This stub runs
 * instead so the Logon terminal shows a clear message instead of a Python traceback.
 */
const lines = [
  '',
  '\x1b[33;1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m',
  '\x1b[33;1m  Logon PTY is not available on native Windows\x1b[0m',
  '\x1b[33;1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m',
  '',
  'The PTY proxy is written for POSIX (Linux, macOS, or WSL). Python\'s',
  '"termios" module does not exist on Microsoft Windows.',
  '',
  '\x1b[1mOption A — Use WSL (recommended for full Logon)\x1b[0m',
  '  1. Install WSL + Ubuntu from Microsoft Store (or: wsl --install).',
  '  2. In Ubuntu: install Node, Python 3, and Claude Code; clone or use /mnt/c/.../this-repo.',
  '  3. Run `npm run dev` from that Linux shell.',
  '  Or on native Windows with WSL already set up, add to .env:',
  '    CLAUDE_PTY_WSL=1',
  '  (optional: CLAUDE_WSL_DISTRO=Ubuntu) and ensure `python3` and `claude` work inside WSL.',
  '',
  '\x1b[1mOption B — Stay on native Windows without Logon\x1b[0m',
  '  In .env set:  CLAUDE_TERMINAL_WS=0',
  '  You can still use dashboard headless runs if `claude` and ANTHROPIC_API_KEY are configured.',
  '',
  '\x1b[33;1m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m',
  ''
];
process.stdout.write(lines.join('\r\n'));
process.exit(1);
