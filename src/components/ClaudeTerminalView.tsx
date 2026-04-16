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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { PtyWelcomeNameScanner } from '../../shared/ptyWelcomeDetect';
import { usePtyBridge } from '../context/PtyBridgeContext';

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
  /** Fired once when Claude Code prints `Welcome back {name}!` in PTY output. */
  onWelcomeBackDetected?: (name: string) => void;
  /** PTY/WebSocket session ended or component unmounted — clear header-derived welcome name. */
  onPtySessionEnd?: () => void;
};

/** Best-effort copy without Clipboard API (helps on some HTTP / locked-down setups). */
function copyTextExecCommand(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function ClaudeTerminalView({
  initialInput,
  title = 'Claude Code — PTY Terminal',
  compact = false,
  onWelcomeBackDetected,
  onPtySessionEnd
}: ClaudeTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onWelcomeRef = useRef(onWelcomeBackDetected);
  const onEndRef = useRef(onPtySessionEnd);
  onWelcomeRef.current = onWelcomeBackDetected;
  onEndRef.current = onPtySessionEnd;
  const [exited, setExited] = useState(false);
  const [restartKey, setRestartKey] = useState(0);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const pasteFieldRef = useRef<HTMLTextAreaElement>(null);
  const insertIntoPtyRef = useRef<(text: string) => void>(() => {});
  const ptyBridge = usePtyBridge();
  const ptyBridgeRef = useRef(ptyBridge);
  ptyBridgeRef.current = ptyBridge;

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
    ptyBridgeRef.current.registerPtyTerminal(term);

    const ws = new WebSocket(wsUrl());
    let sessionCreated = false;
    let destroyed = false;
    const welcomeScanner = new PtyWelcomeNameScanner();
    let ptyHeaderEnded = false;
    const endPtyHeader = () => {
      if (ptyHeaderEnded) return;
      ptyHeaderEnded = true;
      welcomeScanner.reset();
      onEndRef.current?.();
    };

    const sendRawToPty = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    };

    insertIntoPtyRef.current = (data: string) => {
      sendRawToPty(data);
    };
    ptyBridgeRef.current.registerTransport(sendRawToPty);
    ptyBridgeRef.current.setSessionConnected(false);

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
        ptyBridgeRef.current.clearLiveTranscript();
        ptyBridgeRef.current.setSessionConnected(true);
        if (initialInput && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data: initialInput }));
        }
        return;
      }

      if (msg.type === 'data' && typeof msg.data === 'string') {
        const d = msg.data as string;
        welcomeScanner.feed(d, (name) => {
          if (!destroyed) onWelcomeRef.current?.(name);
        });
        term.write(d);
        ptyBridgeRef.current.appendTerminalOutput(d);
        ptyBridgeRef.current.refreshPtyScreenSnapshot();
        return;
      }

      if (msg.type === 'error' && typeof msg.message === 'string') {
        ptyBridgeRef.current.setSessionConnected(false);
        ptyBridgeRef.current.flushLiveTranscriptNow();
        term.writeln(`\r\n\x1b[31m[Server: ${msg.message}]\x1b[0m`);
        setExited(true);
        return;
      }

      if (msg.type === 'exit') {
        ptyBridgeRef.current.setSessionConnected(false);
        ptyBridgeRef.current.flushLiveTranscriptNow();
        endPtyHeader();
        term.writeln('\r\n\x1b[33m[Claude process exited — click Restart to reconnect]\x1b[0m');
        setExited(true);
      }
    };

    ws.onclose = () => {
      if (destroyed) return;
      ptyBridgeRef.current.setSessionConnected(false);
      if (sessionCreated) {
        ptyBridgeRef.current.flushLiveTranscriptNow();
        endPtyHeader();
        term.writeln('\r\n\x1b[31m[Connection closed]\x1b[0m');
      }
    };

    ws.onerror = () => {
      if (destroyed) return;
      ptyBridgeRef.current.setSessionConnected(false);
      ptyBridgeRef.current.flushLiveTranscriptNow();
      term.writeln('\r\n\x1b[31m[WebSocket error — is the API running and is PTY enabled?]\x1b[0m');
    };

    term.onData(sendRawToPty);

    const host = containerRef.current as HTMLElement;
    let swallowNextPasteFromChord = false;
    let chordPasteTimer: number | undefined;

    const focusTerminal = () => {
      term.focus();
      term.textarea?.focus();
    };

    const openPasteModal = () => {
      setPasteModalOpen(true);
    };

    const tryClipboardPaste = () => {
      void navigator.clipboard.readText().then((t) => {
        if (t && !destroyed) term.paste(t);
        else if (!destroyed) openPasteModal();
      }, () => {
        if (!destroyed) openPasteModal();
      });
    };

    /** Clicks often land on the renderer canvas; xterm needs the hidden textarea focused for native Paste / keys. */
    const onPointerDown = () => {
      focusTerminal();
    };
    host.addEventListener('pointerdown', onPointerDown, true);

    /**
     * Browser "Paste" (menu or Ctrl/Cmd+V) delivers a ClipboardEvent with text.
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
      if (ev.shiftKey && (ev.ctrlKey || ev.metaKey) && !ev.altKey) return true;
      if (ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) return true;
      return false;
    };

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
      void navigator.clipboard.readText().then(
        (t) => {
          if (t && !destroyed) term.paste(t);
          else if (!destroyed) openPasteModal();
        },
        () => {
          if (!destroyed) openPasteModal();
        }
      );
    };
    document.addEventListener('keydown', onDocumentKeyDownCapture, true);

    /**
     * Default right-click shows the native browser menu (Copy / Paste / Inspect).
     * Ctrl+right-click = copy terminal selection (Clipboard API, then execCommand fallback).
     */
    const onContextMenu = (ev: MouseEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      focusTerminal();
      if (!term.hasSelection()) return;
      const selected = term.getSelection();
      if (!selected) return;
      void navigator.clipboard.writeText(selected).then(
        () => {
          term.clearSelection();
        },
        () => {
          if (copyTextExecCommand(selected)) {
            term.clearSelection();
          } else {
            term.writeln(
              '\r\n\x1b[33m[Copy failed — try right-click → Copy in the browser menu, use HTTPS, or "Paste from PC…" for pasting.]\x1b[0m'
            );
          }
        }
      );
    };
    term.element?.addEventListener('contextmenu', onContextMenu);

    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        const { cols, rows } = term;
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
      ptyBridgeRef.current.refreshPtyScreenSnapshot();
    });
    ro.observe(containerRef.current);

    return () => {
      destroyed = true;
      ptyBridgeRef.current.registerPtyTerminal(null);
      ptyBridgeRef.current.setSessionConnected(false);
      ptyBridgeRef.current.registerTransport(() => {});
      if (sessionCreated || welcomeScanner.didEmit) {
        endPtyHeader();
      } else {
        welcomeScanner.reset();
      }
      insertIntoPtyRef.current = () => {};
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

  const insertPasteFromModal = useCallback(() => {
    const raw = pasteFieldRef.current?.value ?? '';
    insertIntoPtyRef.current(raw);
    setPasteModalOpen(false);
  }, []);

  useEffect(() => {
    if (!pasteModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPasteModalOpen(false);
    };
    document.addEventListener('keydown', onKey);
    queueMicrotask(() => {
      const el = pasteFieldRef.current;
      if (el) {
        el.value = '';
        el.focus();
      }
    });
    return () => document.removeEventListener('keydown', onKey);
  }, [pasteModalOpen]);

  return (
    <div
      className="flex flex-col rounded-2xl overflow-hidden border border-gray-800 shadow-2xl bg-gray-950 relative"
      style={
        compact
          ? { height: 'min(70vh, 560px)', minHeight: '360px' }
          : { height: 'calc(100vh - 9rem)' }
      }
    >
      <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-900 border-b border-gray-800 shrink-0 flex-wrap">
        <div className="flex gap-1.5 shrink-0">
          <span className="w-3 h-3 rounded-full bg-red-500 opacity-80" />
          <span className="w-3 h-3 rounded-full bg-yellow-400 opacity-80" />
          <span className="w-3 h-3 rounded-full bg-green-500 opacity-80" />
        </div>
        <span className="flex-1 text-center text-xs font-medium text-gray-500 select-none truncate px-2 min-w-[8rem]">
          {title}
        </span>
        {!exited && (
          <button
            type="button"
            onClick={() => setPasteModalOpen(true)}
            className="text-[11px] font-medium px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/25 shrink-0"
          >
            Paste from PC…
          </button>
        )}
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
          <span className="text-[11px] font-mono text-gray-600 shrink-0 hidden sm:inline">linked to tty ✓</span>
        )}
      </div>

      <div
        ref={containerRef}
        className="flex-1 min-h-0 px-1 py-1"
        style={{ overflow: 'hidden' }}
        title="Right-click: browser menu (Copy / Paste). Ctrl+right-click: copy selection from terminal. Paste from PC… for HTTP or blocked clipboard. Ctrl+Shift+V / Cmd+V when HTTPS."
      />

      {pasteModalOpen && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Paste into terminal"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPasteModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-gray-600 bg-gray-900 p-4 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-xs text-gray-400 mb-2">
              Paste from your PC with <kbd className="text-gray-300">Ctrl+V</kbd> /{' '}
              <kbd className="text-gray-300">Cmd+V</kbd> here (works without HTTPS clipboard access). Then Insert.
            </p>
            <textarea
              ref={pasteFieldRef}
              className="w-full min-h-[120px] rounded-lg border border-gray-700 bg-gray-950 text-gray-100 text-sm font-mono p-2 mb-3 resize-y"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:bg-gray-800"
                onClick={() => setPasteModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 font-medium"
                onClick={insertPasteFromModal}
              >
                Insert into terminal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
