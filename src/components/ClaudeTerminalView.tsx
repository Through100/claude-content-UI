/**
 * ClaudeTerminalView — real PTY-backed terminal using xterm.js + WebSocket.
 *
 * Architecture:
 *   Browser  ←──WebSocket──→  Express  ←──pipe──→  pty-proxy.py  ←──PTY──→  claude
 *
 * The Python pty-proxy.py script allocates a real pseudo-terminal via os.openpty(),
 * forks claude into it, and proxies raw bytes between its own stdin/stdout and the
 * PTY master.  This makes claude's isatty(1) return true, so the interactive REPL
 * activates with proper /login, /usage, /help, etc.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/terminal/ws`;
}

export type ClaudeTerminalViewProps = {
  /** Sent to the PTY immediately after the session is created (e.g. `"/login\\r"`). Omit for a blank shell. */
  initialInput?: string;
  /** Title shown in the chrome bar (default: Claude Code — PTY Terminal). */
  title?: string;
  /** When true, use a shorter fixed height suitable for Account Info (default: full-page style). */
  compact?: boolean;
};

export default function ClaudeTerminalView({
  initialInput,
  title = 'Claude Code — PTY Terminal',
  compact = false
}: ClaudeTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [exited, setExited] = useState(false);
  const [restartKey, setRestartKey] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#030712',
        foreground: '#f3f4f6',
        cursor: '#4ade80',
        selectionBackground: '#374151'
      },
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowProposedApi: true
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    const ws = new WebSocket(wsUrl());
    let sessionCreated = false;
    let destroyed = false;

    ws.onopen = () => {
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: 'create', cols, rows }));
    };

    ws.onmessage = (e: MessageEvent<string>) => {
      if (destroyed) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(e.data) as Record<string, unknown>;
      } catch {
        return;
      }

      if (msg.type === 'created') {
        sessionCreated = true;
        if (initialInput && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data: initialInput }));
        }
        return;
      }

      if (msg.type === 'data' && typeof msg.data === 'string') {
        term.write(msg.data as string);
        return;
      }

      if (msg.type === 'error' && typeof msg.message === 'string') {
        term.writeln(`\r\n\x1b[31m[Server: ${msg.message}]\x1b[0m`);
        setExited(true);
        return;
      }

      if (msg.type === 'exit') {
        term.writeln('\r\n\x1b[33m[Claude process exited — click Restart to reconnect]\x1b[0m');
        setExited(true);
      }
    };

    ws.onclose = () => {
      if (destroyed) return;
      if (sessionCreated) {
        term.writeln('\r\n\x1b[31m[Connection closed]\x1b[0m');
      }
    };

    ws.onerror = () => {
      if (destroyed) return;
      term.writeln('\r\n\x1b[31m[WebSocket error — is the API running and is PTY enabled?]\x1b[0m');
    };

    const sendToPty = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    };

    term.onData(sendToPty);

    /** Right-click → paste (same path as typing). Shift+right-click keeps the browser menu. */
    const onContextMenu = async (ev: MouseEvent) => {
      if (ev.shiftKey) return;
      ev.preventDefault();
      term.focus();
      try {
        const text = await navigator.clipboard.readText();
        if (text) term.paste(text);
      } catch {
        term.writeln(
          '\r\n\x1b[33m[Paste failed — try Ctrl+Shift+V, or allow clipboard (HTTPS). Shift+right-click opens the browser menu.]\x1b[0m'
        );
      }
    };
    term.element?.addEventListener('contextmenu', onContextMenu);

    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        const { cols, rows } = term;
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });
    ro.observe(containerRef.current);

    return () => {
      destroyed = true;
      term.element?.removeEventListener('contextmenu', onContextMenu);
      ro.disconnect();
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      term.dispose();
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [restartKey, initialInput]);

  return (
    <div
      className="flex flex-col rounded-2xl overflow-hidden border border-gray-800 shadow-2xl bg-gray-950"
      style={
        compact
          ? { height: 'min(70vh, 560px)', minHeight: '360px' }
          : { height: 'calc(100vh - 9rem)' }
      }
    >
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500 opacity-80" />
          <span className="w-3 h-3 rounded-full bg-yellow-400 opacity-80" />
          <span className="w-3 h-3 rounded-full bg-green-500 opacity-80" />
        </div>
        <span className="flex-1 text-center text-xs font-medium text-gray-500 select-none truncate px-2">
          {title}
        </span>
        {exited ? (
          <button
            type="button"
            onClick={() => {
              setExited(false);
              setRestartKey((k) => k + 1);
            }}
            className="text-[11px] font-medium px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/40 border border-yellow-500/30 transition-colors shrink-0"
          >
            Restart
          </button>
        ) : (
          <span className="text-[11px] font-mono text-gray-600 shrink-0">linked to tty ✓</span>
        )}
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 px-1 py-1" style={{ overflow: 'hidden' }} />
    </div>
  );
}
