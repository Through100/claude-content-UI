import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from 'react';

const MAX_LIVE_TRANSCRIPT = 600_000;

export type PtyBridgeContextValue = {
  sendToPty: (text: string) => void;
  ptySessionReady: boolean;
  registerTransport: (fn: (text: string) => void) => void;
  setSessionConnected: (connected: boolean) => void;
  /** Plain mirror of PTY output (for Dashboard Raw / Pretty). */
  liveTranscript: string;
  /** Append PTY output chunk (batched with requestAnimationFrame). */
  appendTerminalOutput: (chunk: string) => void;
  /** Clear mirror (new PTY session or manual reset). */
  clearLiveTranscript: () => void;
};

const PtyBridgeContext = createContext<PtyBridgeContextValue | null>(null);

const noopTransport = () => {};

export function PtyBridgeProvider({ children }: { children: React.ReactNode }) {
  const transportRef = useRef<(text: string) => void>(noopTransport);
  const [ptySessionReady, setPtySessionReady] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const transcriptBuf = useRef('');
  const rafFlushRef = useRef<number | null>(null);

  const flushTranscript = useCallback(() => {
    rafFlushRef.current = null;
    setLiveTranscript(transcriptBuf.current);
  }, []);

  const appendTerminalOutput = useCallback(
    (chunk: string) => {
      if (!chunk) return;
      transcriptBuf.current = (transcriptBuf.current + chunk).slice(-MAX_LIVE_TRANSCRIPT);
      if (rafFlushRef.current == null) {
        rafFlushRef.current = requestAnimationFrame(flushTranscript);
      }
    },
    [flushTranscript]
  );

  const clearLiveTranscript = useCallback(() => {
    if (rafFlushRef.current != null) {
      cancelAnimationFrame(rafFlushRef.current);
      rafFlushRef.current = null;
    }
    transcriptBuf.current = '';
    setLiveTranscript('');
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
      liveTranscript,
      appendTerminalOutput,
      clearLiveTranscript
    }),
    [
      sendToPty,
      ptySessionReady,
      registerTransport,
      setSessionConnected,
      liveTranscript,
      appendTerminalOutput,
      clearLiveTranscript
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
