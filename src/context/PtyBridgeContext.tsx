import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type PtyBridgeContextValue = {
  /** Send raw bytes to the PTY (same path as xterm); caller may append `\r` for Enter. */
  sendToPty: (text: string) => void;
  /** True after the server sends `created` for the current WebSocket session. */
  ptySessionReady: boolean;
  /** Wired by the singleton {@link ClaudeTerminalView}. */
  registerTransport: (fn: (text: string) => void) => void;
  setSessionConnected: (connected: boolean) => void;
};

const PtyBridgeContext = createContext<PtyBridgeContextValue | null>(null);

const noopTransport = () => {};

export function PtyBridgeProvider({ children }: { children: React.ReactNode }) {
  const transportRef = useRef<(text: string) => void>(noopTransport);
  const [ptySessionReady, setPtySessionReady] = useState(false);

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
      setSessionConnected
    }),
    [sendToPty, ptySessionReady, registerTransport, setSessionConnected]
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
