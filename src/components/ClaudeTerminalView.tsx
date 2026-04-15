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

    const host = containerRef.current as HTMLElement;
    let swallowNextPasteFromChord = false;
    let chordPasteTimer: number | undefined;

    const focusTerminal = () => {
      term.focus();
      term.textarea?.focus();
    };

    /** Clicks often land on the renderer canvas; xterm needs the hidden textarea focused for native Paste / keys. */
    const onPointerDown = () => {
      focusTerminal();
    };
    host.addEventListener('pointerdown', onPointerDown, true);

    /**
     * Browser "Paste" (menu or Ctrl/Cmd+V) delivers a ClipboardEvent with text — no async permission edge cases.
     * Capture so we run before children and can send one paste to the PTY.
     */
    const onDocumentPasteCapture = (ev: ClipboardEvent) => {
      if (destroyed) return;
      const target = ev.target as Node | null;
      if (!target || !host.contains(target as Node)) return;
      if (swallowNextPasteFromChord) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      const text = ev.clipboardData?.getData('text/plain') ?? '';
      ev.preventDefault();
      ev.stopPropagation();
      if (text) term.paste(text);
    };
    document.addEventListener('paste', onDocumentPasteCapture, true);

    const pasteChordActive = (ev: KeyboardEvent) => {
      const v = ev.key === 'v' || ev.key === 'V';
      if (!v) return false;
      // Windows/Linux terminal paste; macOS often uses Cmd+Shift+V here too
      if (ev.shiftKey && (ev.ctrlKey || ev.metaKey) && !ev.altKey) return true;
      // macOS: Cmd+V paste into PTY (Ctrl+V stays as literal for shells)
      if (ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) return true;
      return false;
    };

    /** Ctrl+Shift+V / Cmd+Shift+V / Cmd+V when focus is already in the terminal host. */
    const onDocumentKeyDownCapture = (ev: KeyboardEvent) => {
      if (destroyed) return;
      if (!pasteChordActive(ev)) return;
      if (!host.matches(':focus-within')) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      swallowNextPasteFromChord = true;
      if (chordPasteTimer !== undefined) window.clearTimeout(chordPasteTimer);
      chordPasteTimer = window.setTimeout(() => {
        swallowNextPasteFromChord = false;
        chordPasteTimer = undefined;
      }, 200);
      void navigator.clipboard.readText().then((t) => {
        if (t && !destroyed) term.paste(t);
      });
    };
    document.addEventListener('keydown', onDocumentKeyDownCapture, true);

    /**
     * Right-click uses a real user gesture so the browser allows Clipboard API calls.
     * - Selection active → copy to OS clipboard (then clear selection).
     * - No selection → paste from OS clipboard into the PTY.
     * Shift+right-click keeps the native browser menu (e.g. Inspect).
     */
    const onContextMenu = async (ev: MouseEvent) => {
      if (ev.shiftKey) return;
      ev.preventDefault();
      focusTerminal();

      if (term.hasSelection()) {
        const selected = term.getSelection();
        if (!selected) return;
        try {
          await navigator.clipboard.writeText(selected);
          term.clearSelection();
        } catch {
          term.writeln(
            '\r\n\x1b[33m[Copy failed — use HTTPS/localhost, or allow clipboard permission. Shift+right-click for the browser menu.]\x1b[0m'
          );
        }
        return;
      }

      try {
        const clip = await navigator.clipboard.readText();
        if (clip) term.paste(clip);
      } catch {
        term.writeln(
          '\r\n\x1b[33m[Clipboard read blocked — click inside the terminal, then Shift+right-click → Paste, or Ctrl+Shift+V (Cmd+Shift+V / Cmd+V on Mac).]\x1b[0m'
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
      if (chordPasteTimer !== undefined) window.clearTimeout(chordPasteTimer);
      host.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('paste', onDocumentPasteCapture, true);
      document.removeEventListener('keydown', onDocumentKeyDownCapture, true);
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

      <div
        ref={containerRef}
        className="flex-1 min-h-0 px-1 py-1"
        style={{ overflow: 'hidden' }}
        title="Click inside first. Paste: Ctrl+Shift+V (Windows/Linux), Cmd+V or Cmd+Shift+V (Mac), or Shift+right-click → Paste. Right-click without selection: paste; with selection: copy."
      />
    </div>
  );
}
