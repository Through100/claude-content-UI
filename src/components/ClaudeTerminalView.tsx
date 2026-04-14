/**
 * ClaudeTerminalView — real PTY-backed terminal using xterm.js + WebSocket.
 *
 * Architecture:
 *   Browser  ←──WebSocket──→  Express  ←──pipe──→  pty-proxy.py  ←──PTY──→  claude
 *
 * The Python pty-proxy.py script allocates a real pseudo-terminal via os.openpty(),
 * forks claude into it, and proxies raw bytes between its own stdin/stdout and the
 * PTY master.  This makes claude's isatty(1) return true, so the interactive REPL
 * activates with proper /usage, /help, etc. TUI support.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

function wsUrl(): string {
  // In production, same host/port as the page.  In dev, Vite proxies /api/terminal/ws → port 8787.
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/terminal/ws`;
}

export default function ClaudeTerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [exited, setExited] = useState(false);
  // Increment to re-run the setup effect (restart)
  const [restartKey, setRestartKey] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    // ── xterm.js terminal ─────────────────────────────────────────────────
    const term = new Terminal({
      theme: {
        background: '#030712',   // gray-950
        foreground: '#f3f4f6',   // gray-100
        cursor: '#4ade80',       // green-400
        selectionBackground: '#374151',
      },
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // ── WebSocket connection ───────────────────────────────────────────────
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;
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
        // Auto-run /usage so the user sees live quota immediately
        ws.send(JSON.stringify({ type: 'input', data: '/usage\r' }));
        return;
      }

      if (msg.type === 'data' && typeof msg.data === 'string') {
        // PTY output is binary-encoded as a JS string; write as binary to xterm
        term.write(msg.data);
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
      term.writeln('\r\n\x1b[31m[WebSocket error — is the server running?]\x1b[0m');
    };

    // ── Forward keyboard input to the PTY ─────────────────────────────────
    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // ── Resize ────────────────────────────────────────────────────────────
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
      ro.disconnect();
      // Null handlers before closing so no callbacks fire on the disposed terminal
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      term.dispose();
      // Clear xterm DOM so a fresh terminal can mount into the same container
      if (containerRef.current) containerRef.current.innerHTML = '';
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  // restartKey triggers a fresh session when the user clicks Restart
  }, [restartKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="flex flex-col rounded-2xl overflow-hidden border border-gray-800 shadow-2xl bg-gray-950"
      style={{ height: 'calc(100vh - 9rem)' }}
    >
      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-500 opacity-80" />
          <span className="w-3 h-3 rounded-full bg-yellow-400 opacity-80" />
          <span className="w-3 h-3 rounded-full bg-green-500 opacity-80" />
        </div>
        <span className="flex-1 text-center text-xs font-medium text-gray-500 select-none">
          Claude Code — PTY Terminal
        </span>
        {exited ? (
          <button
            onClick={() => { setExited(false); setRestartKey(k => k + 1); }}
            className="text-[11px] font-medium px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/40 border border-yellow-500/30 transition-colors"
          >
            Restart
          </button>
        ) : (
          <span className="text-[11px] font-mono text-gray-600">linked to tty ✓</span>
        )}
      </div>

      {/* xterm.js container — fills all remaining height */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 px-1 py-1"
        style={{ overflow: 'hidden' }}
      />
    </div>
  );
}
