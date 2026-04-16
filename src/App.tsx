import React, { useState, useReducer, useEffect, useCallback } from 'react';
import Layout, { type HeaderSessionSnapshot } from './components/Layout';
import SeoCommandForm from './components/SeoCommandForm';
import ResultsView from './components/ResultsView';
import HistoryView from './components/HistoryView';
import AccountView from './components/AccountView';
import LogonView from './components/LogonView';
import UsageView from './components/UsageView';
import { apiService } from './services/api';
import { RunResponse } from './types';
import { appendDashboardChatTurn, formatRunUserSummary } from './lib/dashboardChatHistory';
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
        setTerminalWsEnabled((health as { terminalWebSocket: boolean }).terminalWebSocket);
      } else {
        setTerminalWsEnabled(true);
      }
    } catch {
      apiOk = false;
      setTerminalWsEnabled(false);
    }
    let email: string | null = null;
    try {
      const acc = await apiService.getAccountStatus();
      const raw = acc.statusSnapshot?.email?.trim() ?? '';
      if (raw.includes('@')) email = raw;
    } catch {
      /* leave null — e.g. API down or /status parse failed */
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
  const [isLoading, setIsLoading] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [, tickLoading] = useReducer((n: number) => n + 1, 0);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveTerminal, setLiveTerminal] = useState('');
  const [chatHistoryTick, setChatHistoryTick] = useState(0);

  useEffect(() => {
    if (!isLoading || runStartedAt == null) return;
    const id = window.setInterval(() => tickLoading(), 1000);
    return () => window.clearInterval(id);
  }, [isLoading, runStartedAt]);

  const handleRun = async (commandKey: string, target: string, model?: string) => {
    setIsLoading(true);
    setRunStartedAt(Date.now());
    setLiveTerminal('');
    setError(null);
    try {
      const response = await apiService.runBlogCommand(commandKey, target, model, (_ch, text) => {
        setLiveTerminal(prev => prev + text);
      });
      setResult(response);
      const userLine = formatRunUserSummary(commandKey, target, model);
      const out = response.rawOutput?.trim() ?? '';
      const err = response.error?.trim() ?? '';
      const assistant = out || (err ? `Error: ${err}` : '') || '(no output captured)';
      appendDashboardChatTurn(userLine, assistant);
      setChatHistoryTick((n) => n + 1);
      if (!response.success && response.error) {
        setError(response.error);
      }
    } catch (err) {
      console.error('Failed to run blog command:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'The backend terminal environment is unreachable or returned an error.');
    } finally {
      setIsLoading(false);
      setRunStartedAt(null);
      setLiveTerminal('');
    }
  };

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
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Blog Command Center</h2>
                <p className="text-gray-500 mt-1">Run the blog skill (/blog …) via Claude Code in your project workdir.</p>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-widest bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                Terminal: AlmaLinux 9 / Docker
              </div>
            </div>

            {/* Error Alert */}
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
                    <h4 className="text-sm font-bold text-red-900">Execution Failed</h4>
                    <p className="text-sm text-red-700 mt-1">{error}</p>
                  </div>
                  <button 
                    onClick={() => setError(null)}
                    className="text-red-400 hover:text-red-600 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main Form */}
            <SeoCommandForm onRun={handleRun} isLoading={isLoading} />

            {/* Results Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest">Run results</h3>
                <div className="flex-1 h-px bg-gray-100"></div>
              </div>
              <ResultsView
              result={result}
              isLoading={isLoading}
              loadingStartedAt={runStartedAt}
              liveTerminal={liveTerminal}
              chatHistoryTick={chatHistoryTick}
            />
            </div>
          </motion.div>
        ) : activeView === 'history' ? (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <HistoryView />
          </motion.div>
        ) : activeView === 'usage' ? (
          <motion.div
            key="usage"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <UsageView />
          </motion.div>
        ) : activeView === 'logon' ? (
          <motion.div
            key="logon"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <LogonView onVisible={refreshHeaderSession} />
          </motion.div>
        ) : (
          <motion.div
            key="account"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <AccountView onAfterRefresh={refreshHeaderSession} />
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  );
}
