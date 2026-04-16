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
  /** Same as `ptyDisplayPlain` (legacy name). */
  liveTranscript: string;
  /** Append raw PTY bytes (internal scrollback / future export). */
  appendTerminalOutput: (chunk: string) => void;
  /** Register the interactive Logon `Terminal` (null on dispose). */
  registerPtyTerminal: (term: Terminal | null) => void;
  /** Re-read the registered xterm buffer into `ptyDisplayPlain` (call after `term.write`). */
  refreshPtyScreenSnapshot: () => void;
  /** Show only xterm lines appended after this call (same session; does not clear the real PTY). */
  clearLiveTranscript: () => void;
  /** Force an immediate snapshot read (e.g. session end). */
  flushLiveTranscriptNow: () => void;
};

const PtyBridgeContext = createContext<PtyBridgeContextValue | null>(null);

const noopTransport = () => {};

export function PtyBridgeProvider({ children }: { children: React.ReactNode }) {
  const transportRef = useRef<(text: string) => void>(noopTransport);
  const [ptySessionReady, setPtySessionReady] = useState(false);
  const [ptyDisplayPlain, setPtyDisplayPlain] = useState('');
  const transcriptBuf = useRef('');
  const terminalRef = useRef<Terminal | null>(null);
  const serializeStartLineRef = useRef(0);
  const snapshotRafRef = useRef<number | null>(null);

  const refreshPtyScreenSnapshot = useCallback(() => {
    if (snapshotRafRef.current != null) {
      return;
    }
    snapshotRafRef.current = requestAnimationFrame(() => {
      snapshotRafRef.current = null;
      const t = terminalRef.current;
      if (!t) {
        setPtyDisplayPlain('');
        return;
      }
      const n = t.buffer.active.length;
      if (serializeStartLineRef.current > n) {
        serializeStartLineRef.current = 0;
      }
      const plain = serializeXtermBufferPlain(t, serializeStartLineRef.current);
      setPtyDisplayPlain(plain);
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
      } else {
        refreshPtyScreenSnapshot();
      }
    },
    [refreshPtyScreenSnapshot]
  );

  const appendTerminalOutput = useCallback((chunk: string) => {
    if (!chunk) return;
    transcriptBuf.current = (transcriptBuf.current + chunk).slice(-MAX_LIVE_TRANSCRIPT);
  }, []);

  const clearLiveTranscript = useCallback(() => {
    transcriptBuf.current = '';
    const t = terminalRef.current;
    serializeStartLineRef.current = t ? t.buffer.active.length : 0;
    setPtyDisplayPlain('');
    refreshPtyScreenSnapshot();
  }, [refreshPtyScreenSnapshot]);

  const flushLiveTranscriptNow = useCallback(() => {
    if (snapshotRafRef.current != null) {
      cancelAnimationFrame(snapshotRafRef.current);
      snapshotRafRef.current = null;
    }
    const t = terminalRef.current;
    if (!t) {
      setPtyDisplayPlain('');
      return;
    }
    const n = t.buffer.active.length;
    if (serializeStartLineRef.current > n) {
      serializeStartLineRef.current = 0;
    }
    setPtyDisplayPlain(serializeXtermBufferPlain(t, serializeStartLineRef.current));
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
      liveTranscript: ptyDisplayPlain,
      appendTerminalOutput,
      registerPtyTerminal,
      refreshPtyScreenSnapshot,
      clearLiveTranscript,
      flushLiveTranscriptNow
    }),
    [
      sendToPty,
      ptySessionReady,
      registerTransport,
      setSessionConnected,
      ptyDisplayPlain,
      appendTerminalOutput,
      registerPtyTerminal,
      refreshPtyScreenSnapshot,
      clearLiveTranscript,
      flushLiveTranscriptNow
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
