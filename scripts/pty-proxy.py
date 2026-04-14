#!/usr/bin/env python3
"""
PTY proxy — allocates a pseudo-terminal, forks to run the given command inside it,
then proxies raw bytes between the child PTY and this process's own stdin/stdout.

The Node.js server spawns this script with piped stdio and writes resize commands
as single-line JSON on a dedicated control channel (fd 3 on Linux).

Protocol (stdin → child PTY):
  - All bytes written to this script's stdin are forwarded to the PTY master.

Protocol (child PTY → stdout):
  - All bytes read from the PTY master are written to stdout.

Resize messages arrive as newline-terminated JSON on fd 3 (if available):
  {"cols": 220, "rows": 50}

Exit: when the child process exits this script exits with the same code.
"""
import sys
import os
import select
import signal
import struct
import termios
import fcntl
import json

CHUNK = 4096


def set_winsize(fd: int, rows: int, cols: int) -> None:
    try:
        size = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, size)
    except OSError:
        pass


def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit("Usage: pty-proxy.py <command> [args...]")

    rows = int(os.environ.get("PTY_ROWS", "50"))
    cols = int(os.environ.get("PTY_COLS", "220"))

    # Open a PTY pair
    master_fd, slave_fd = os.openpty()
    set_winsize(master_fd, rows, cols)
    set_winsize(slave_fd, rows, cols)

    pid = os.fork()
    if pid == 0:
        # ── child ────────────────────────────────────────────────────────────
        os.close(master_fd)
        # Become a new session leader and make slave our controlling terminal
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        # Pass environment through unchanged
        os.execvp(args[0], args)
        os._exit(127)

    # ── parent ───────────────────────────────────────────────────────────────
    os.close(slave_fd)

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()

    # Make master non-blocking so we can poll without hanging
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    # fd 3 is an optional JSON control pipe for resize messages from Node.js
    ctrl_fd: int | None = None
    try:
        ctrl_fd = os.open("/proc/self/fd/3", os.O_RDONLY | os.O_NONBLOCK)
    except OSError:
        ctrl_fd = None

    ctrl_buf = b""
    child_alive = True

    def reap() -> int:
        try:
            _, status = os.waitpid(pid, os.WNOHANG)
            return os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
        except ChildProcessError:
            return -1

    exit_code = 0
    read_fds_base = [stdin_fd, master_fd]
    if ctrl_fd is not None:
        read_fds_base.append(ctrl_fd)

    while True:
        try:
            r, _, _ = select.select(read_fds_base, [], [], 0.1)
        except (ValueError, OSError):
            break

        # stdin → PTY
        if stdin_fd in r:
            try:
                data = os.read(stdin_fd, CHUNK)
                if not data:
                    break
                os.write(master_fd, data)
            except OSError:
                break

        # PTY → stdout
        if master_fd in r:
            try:
                data = os.read(master_fd, CHUNK)
                if data:
                    os.write(stdout_fd, data)
            except OSError:
                # Master closed — child exited
                child_alive = False
                break

        # Resize control messages
        if ctrl_fd is not None and ctrl_fd in r:
            try:
                chunk = os.read(ctrl_fd, 256)
                if chunk:
                    ctrl_buf += chunk
                    while b"\n" in ctrl_buf:
                        line, ctrl_buf = ctrl_buf.split(b"\n", 1)
                        try:
                            msg = json.loads(line.decode())
                            if isinstance(msg, dict):
                                new_cols = int(msg.get("cols", cols))
                                new_rows = int(msg.get("rows", rows))
                                set_winsize(master_fd, new_rows, new_cols)
                                cols, rows = new_cols, new_rows
                        except (json.JSONDecodeError, ValueError, KeyError):
                            pass
            except OSError:
                pass

        # Drain remaining PTY output after child exits
        if not child_alive:
            while True:
                try:
                    data = os.read(master_fd, CHUNK)
                    if not data:
                        break
                    os.write(stdout_fd, data)
                except OSError:
                    break
            break

        # Non-blocking child status check
        ec = reap()
        if ec >= 0:
            exit_code = ec
            # Drain
            while True:
                try:
                    data = os.read(master_fd, CHUNK)
                    if not data:
                        break
                    os.write(stdout_fd, data)
                except OSError:
                    break
            break

    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
    try:
        _, status = os.waitpid(pid, 0)
        exit_code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1
    except ChildProcessError:
        pass

    os.close(master_fd)
    if ctrl_fd is not None:
        try:
            os.close(ctrl_fd)
        except OSError:
            pass

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
