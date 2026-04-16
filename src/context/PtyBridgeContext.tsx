import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from 'react';
import type { Terminal } from '@xterm/xterm';
import { serializeXtermBufferPlain } from '../../shared/serializeXtermBuffer';

const MAX_LIVE_TRANSCRIPT = 600_000;

export type PtyBridgeContextValue = {
  sendToPty: (text: string) => void;
  ptySessionReady: boolean;
  registerTransport: (fn: (text: string) => void) => void;
  setSessionConnected: (connected: boolean) => void;
  /**
   * Plain text snapshot of the Logon xterm buffer (Dashboard Raw / Pretty live).
   * Same PTY session as Logon; line breaks match xterm layout, not raw byte chunks.
   */
  ptyDisplayPlain: string;
  /** Full buffer from line 0 — used to merge Pretty transcript when scrollback trims the top. */
  ptyFullSnapshotPlain: string;
  /** Incremented when a new PTY WebSocket session starts (re-seed per-topic archive from localStorage). */
  ptySessionGeneration: number;
  /** Same as `ptyDisplayPlain` (legacy name). */
  liveTranscript: string;
  /** Append raw PTY bytes (internal scrollback / future export). */
  appendTerminalOutput: (chunk: string) => void;
  /** Register the interactive Logon `Terminal` (null on dispose). */
  registerPtyTerminal: (term: Terminal | null) => void;
  /** Re-read the registered xterm buffer into `ptyDisplayPlain` (call after `term.write`). */
  refreshPtyScreenSnapshot: () => void;
  /**
   * Dashboard-only: show only xterm lines from the current buffer row onward (same PTY; Logon unchanged).
   * Used by Raw “From here only”. Do not call before every keystroke — that would hide prior Pretty scrollback.
   */
  clearLiveTranscript: (opts?: { resetPrettySession?: boolean }) => void;
  /** Force an immediate snapshot read (e.g. session end). */
  flushLiveTranscriptNow: () => void;
  /** Current raw PTY byte capture (for mirror xterm replay). */
  peekPtyTranscriptBuffer: () => string;
  /** Receive every new PTY chunk after primary xterm writes it (for Raw mirror terminal). */
  subscribePtyMirrorWrite: (fn: (chunk: string) => void) => () => void;
  /** Fired when the transcript buffer is cleared or the primary terminal unregisters (mirror should reset). */
  subscribePtyMirrorReset: (fn: () => void) => () => void;
};

const PtyBridgeContext = createContext<PtyBridgeContextValue | null>(null);

const noopTransport = () => {};

export function PtyBridgeProvider({ children }: { children: React.ReactNode }) {
  const transportRef = useRef<(text: string) => void>(noopTransport);
  const [ptySessionReady, setPtySessionReady] = useState(false);
  const [ptyDisplayPlain, setPtyDisplayPlain] = useState('');
  const [ptyFullSnapshotPlain, setPtyFullSnapshotPlain] = useState('');
  const [ptySessionGeneration, setPtySessionGeneration] = useState(0);
  const transcriptBuf = useRef('');
  const terminalRef = useRef<Terminal | null>(null);
  const serializeStartLineRef = useRef(0);
  const snapshotRafRef = useRef<number | null>(null);
  const mirrorWriteRef = useRef(new Set<(chunk: string) => void>());
  const mirrorResetRef = useRef(new Set<() => void>());

  const peekPtyTranscriptBuffer = useCallback(() => transcriptBuf.current, []);

  const subscribePtyMirrorWrite = useCallback((fn: (chunk: string) => void) => {
    mirrorWriteRef.current.add(fn);
    return () => {
      mirrorWriteRef.current.delete(fn);
    };
  }, []);

  const subscribePtyMirrorReset = useCallback((fn: () => void) => {
    mirrorResetRef.current.add(fn);
    return () => {
      mirrorResetRef.current.delete(fn);
    };
  }, []);

  const emitMirrorReset = useCallback(() => {
    mirrorResetRef.current.forEach((f) => {
      try {
        f();
      } catch {
        /* ignore listener errors */
      }
    });
  }, []);

  const refreshPtyScreenSnapshot = useCallback(() => {
    if (snapshotRafRef.current != null) {
      return;
    }
    snapshotRafRef.current = requestAnimationFrame(() => {
      snapshotRafRef.current = null;
      const t = terminalRef.current;
      if (!t) {
        setPtyDisplayPlain('');
        setPtyFullSnapshotPlain('');
        return;
      }
      const n = t.buffer.active.length;
      if (serializeStartLineRef.current > n) {
        serializeStartLineRef.current = 0;
      }
      const plain = serializeXtermBufferPlain(t, serializeStartLineRef.current);
      const full = serializeXtermBufferPlain(t, 0);
      setPtyDisplayPlain(plain);
      setPtyFullSnapshotPlain(full);
    });
  }, []);

  const registerPtyTerminal = useCallback(
    (term: Terminal | null) => {
      terminalRef.current = term;
      if (!term) {
        serializeStartLineRef.current = 0;
        if (snapshotRafRef.current != null) {
          cancelAnimationFrame(snapshotRafRef.current);
          snapshotRafRef.current = null;
        }
        setPtyDisplayPlain('');
        setPtyFullSnapshotPlain('');
        emitMirrorReset();
      } else {
        refreshPtyScreenSnapshot();
      }
    },
    [refreshPtyScreenSnapshot, emitMirrorReset]
  );

  const appendTerminalOutput = useCallback((chunk: string) => {
    if (!chunk) return;
    transcriptBuf.current = (transcriptBuf.current + chunk).slice(-MAX_LIVE_TRANSCRIPT);
    mirrorWriteRef.current.forEach((f) => {
      try {
        f(chunk);
      } catch {
        /* ignore */
      }
    });
  }, []);

  const clearLiveTranscript = useCallback((opts?: { resetPrettySession?: boolean }) => {
    transcriptBuf.current = '';
    const t = terminalRef.current;
    serializeStartLineRef.current = t ? t.buffer.active.length : 0;
    setPtyDisplayPlain('');
    setPtyFullSnapshotPlain('');
    emitMirrorReset();
    if (opts?.resetPrettySession) {
      setPtySessionGeneration((g) => g + 1);
    }
    refreshPtyScreenSnapshot();
  }, [refreshPtyScreenSnapshot, emitMirrorReset]);

  const flushLiveTranscriptNow = useCallback(() => {
    if (snapshotRafRef.current != null) {
      cancelAnimationFrame(snapshotRafRef.current);
      snapshotRafRef.current = null;
    }
    const t = terminalRef.current;
    if (!t) {
      setPtyDisplayPlain('');
      setPtyFullSnapshotPlain('');
      return;
    }
    const n = t.buffer.active.length;
    if (serializeStartLineRef.current > n) {
      serializeStartLineRef.current = 0;
    }
    setPtyDisplayPlain(serializeXtermBufferPlain(t, serializeStartLineRef.current));
    setPtyFullSnapshotPlain(serializeXtermBufferPlain(t, 0));
  }, []);

  const registerTransport = useCallback((fn: (text: string) => void) => {
    transportRef.current = fn;
  }, []);

  const setSessionConnected = useCallback((connected: boolean) => {
    setPtySessionReady(connected);
  }, []);

  const sendToPty = useCallback((text: string) => {
    transportRef.current(text);
  }, []);

  const value = useMemo(
    () => ({
      sendToPty,
      ptySessionReady,
      registerTransport,
      setSessionConnected,
      ptyDisplayPlain,
      ptyFullSnapshotPlain,
      ptySessionGeneration,
      liveTranscript: ptyDisplayPlain,
      appendTerminalOutput,
      registerPtyTerminal,
      refreshPtyScreenSnapshot,
      clearLiveTranscript,
      flushLiveTranscriptNow,
      peekPtyTranscriptBuffer,
      subscribePtyMirrorWrite,
      subscribePtyMirrorReset
    }),
    [
      sendToPty,
      ptySessionReady,
      registerTransport,
      setSessionConnected,
      ptyDisplayPlain,
      ptyFullSnapshotPlain,
      ptySessionGeneration,
      appendTerminalOutput,
      registerPtyTerminal,
      refreshPtyScreenSnapshot,
      clearLiveTranscript,
      flushLiveTranscriptNow,
      peekPtyTranscriptBuffer,
      subscribePtyMirrorWrite,
      subscribePtyMirrorReset
    ]
  );

  return <PtyBridgeContext.Provider value={value}>{children}</PtyBridgeContext.Provider>;
}

export function usePtyBridge(): PtyBridgeContextValue {
  const ctx = useContext(PtyBridgeContext);
  if (!ctx) {
    throw new Error('usePtyBridge must be used within PtyBridgeProvider');
  }
  return ctx;
}
