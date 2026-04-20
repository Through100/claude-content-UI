import React, { useState, useEffect, useCallback, useRef } from 'react';
import Layout, { type HeaderSessionSnapshot } from './components/Layout';
import SeoCommandForm from './components/SeoCommandForm';
import ResultsView from './components/ResultsView';
import HistoryView from './components/HistoryView';
import AccountView from './components/AccountView';
import LogonView from './components/LogonView';
import UsageView from './components/UsageView';
import { apiService } from './services/api';
import { BLOG_COMMANDS, buildBlogPrompt } from './types';
import { formatChatThreadKey } from './lib/dashboardChatHistory';
import { usePtyBridge } from './context/PtyBridgeContext';
import { AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const HEADER_SESSION_REFRESH_MS = 4 * 60 * 1000;

export default function App() {
  const [activeView, setActiveView] = useState<'dashboard' | 'history' | 'usage' | 'account' | 'logon'>('dashboard');
  const [headerSession, setHeaderSession] = useState<HeaderSessionSnapshot>({
    apiReachable: null,
    claudeEmail: null,
    accountLoading: true,
    ptyWelcomeName: null
  });
  const [terminalWsEnabled, setTerminalWsEnabled] = useState(true);

  const refreshHeaderSession = useCallback(async () => {
    setHeaderSession((prev) => ({ ...prev, accountLoading: true }));
    let apiOk = false;
    try {
      const health = await apiService.getSystemStatus();
      apiOk = true;
      if (typeof (health as { terminalWebSocket?: boolean }).terminalWebSocket === 'boolean') {
        const val = (health as { terminalWebSocket: boolean }).terminalWebSocket;
        setTerminalWsEnabled((prev) => (prev === val ? prev : val));
      } else {
        setTerminalWsEnabled(true);
      }
    } catch {
      apiOk = false;
    }
    let email: string | null = null;
    try {
      const acc = await apiService.getAccountStatus();
      const raw = acc.statusSnapshot?.email?.trim() ?? '';
      if (raw.includes('@')) email = raw;
    } catch {
      /* leave null */
    }
    setHeaderSession((prev) => ({
      apiReachable: apiOk,
      claudeEmail: email,
      accountLoading: false,
      ptyWelcomeName: prev.ptyWelcomeName
    }));
  }, []);

  const onPtyWelcomeName = useCallback((name: string) => {
    const t = name.trim();
    if (!t) return;
    setHeaderSession((prev) => ({ ...prev, ptyWelcomeName: t }));
  }, []);

  const onPtySessionEnd = useCallback(() => {
    setHeaderSession((prev) => ({ ...prev, ptyWelcomeName: null }));
  }, []);

  useEffect(() => {
    void refreshHeaderSession();
  }, [refreshHeaderSession]);

  useEffect(() => {
    const id = window.setInterval(() => void refreshHeaderSession(), HEADER_SESSION_REFRESH_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshHeaderSession();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refreshHeaderSession]);

  const { sendToPty, clearLiveTranscript, ptySessionReady } = usePtyBridge();

  const [error, setError] = useState<string | null>(null);
  const [chatThreadKey, setChatThreadKey] = useState(() => formatChatThreadKey(BLOG_COMMANDS[0].key, ''));
  const [ptySentAt, setPtySentAt] = useState<number | null>(null);
  const ptySentAtRef = useRef<number | null>(null);

  const onRunnerSessionChange = useCallback((commandKey: string, target: string) => {
    setChatThreadKey(formatChatThreadKey(commandKey, target));
  }, []);

  const handleRun = useCallback((commandKey: string, target: string) => {
    setError(null);
    if (!ptySessionReady) {
      setError('PTY session is not connected yet. Open the Logon tab to start the terminal, then try again.');
      return;
    }
    const cmd = BLOG_COMMANDS.find((c) => c.key === commandKey);
    if (!cmd) {
      setError(`Unknown command key: ${commandKey}`);
      return;
    }
    const prompt = buildBlogPrompt(cmd, target);
    clearLiveTranscript({ resetPrettySession: true });
    sendToPty(`${prompt}\r`);
    const now = Date.now();
    setPtySentAt(now);
    ptySentAtRef.current = now;
  }, [ptySessionReady, sendToPty, clearLiveTranscript]);

  const ptyIsProcessing = ptySentAt != null && (Date.now() - ptySentAt < 45000); // 45s timeout for the "Executing" hint


  return (
    <Layout
      activeView={activeView}
      onViewChange={setActiveView}
      headerSession={headerSession}
      terminalWsEnabled={terminalWsEnabled}
      onPtyWelcomeBackDetected={onPtyWelcomeName}
      onPtySessionEnd={onPtySessionEnd}
    >
      <AnimatePresence mode="wait">
        {activeView === 'dashboard' ? (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-10 pb-20"
          >
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Blog Command Center</h2>
                <p className="text-gray-500 mt-1">Run the blog skill (/blog …) via the interactive Claude session.</p>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-widest bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm">
                <span className={`w-2 h-2 rounded-full ${ptySessionReady ? 'bg-green-500' : 'bg-amber-400 animate-pulse'}`}></span>
                {ptySessionReady ? 'PTY Connected' : 'PTY Connecting…'}
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-4"
                >
                  <div className="bg-red-100 p-2 rounded-lg">
                    <AlertCircle className="text-red-600" size={20} />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-bold text-red-900">Failed to Send Command</h4>
                    <p className="text-sm text-red-700 mt-1">{error}</p>
                  </div>
                  <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 transition-colors">
                    <X size={20} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <SeoCommandForm
              onRun={handleRun}
              onSessionChange={onRunnerSessionChange}
              isLoading={false}
            />

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Conversation</h3>
                <div className="flex-1 h-px bg-gray-100"></div>
              </div>
              <ResultsView 
                result={null} 
                isLoading={ptyIsProcessing} 
                loadingStartedAt={ptySentAt}
                chatThreadKey={chatThreadKey} 
                ptySentAt={ptySentAt} 
              />
            </div>
          </motion.div>
        ) : activeView === 'history' ? (
          <HistoryView key="history" />
        ) : activeView === 'usage' ? (
          <UsageView key="usage" />
        ) : activeView === 'account' ? (
          <AccountView key="account" />
        ) : activeView === 'logon' ? (
          <LogonView key="logon" />
        ) : null}
      </AnimatePresence>
    </Layout>
  );
}
