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
import { clearDashboardChatHistory, formatChatThreadKey } from './lib/dashboardChatHistory';
import { savePtyPrettyArchive } from './lib/ptyPrettyArchiveStorage';
import { usePtyBridge } from './context/PtyBridgeContext';
import { PTY_BROWSER_KILL_BEFORE_UNMOUNT_KEY, PTY_BROWSER_SESSION_ID_KEY } from '../shared/ptyBrowserSession';
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

  const { sendToPty, clearLiveTranscript, ptySessionReady, requestPtyReconnect, flushLiveTranscriptNow } =
    usePtyBridge();

  const handleRestartPtySession = useCallback(() => {
    try {
      sessionStorage.removeItem(PTY_BROWSER_SESSION_ID_KEY);
      sessionStorage.setItem(PTY_BROWSER_KILL_BEFORE_UNMOUNT_KEY, '1');
    } catch {
      /* ignore */
    }
    clearLiveTranscript({ resetPrettySession: true });
    requestPtyReconnect();
  }, [clearLiveTranscript, requestPtyReconnect]);

  const [error, setError] = useState<string | null>(null);
  const [chatThreadKey, setChatThreadKey] = useState(() => formatChatThreadKey(BLOG_COMMANDS[0].key, ''));
  const [ptySentAt, setPtySentAt] = useState<number | null>(null);
  const ptySentAtRef = useRef<number | null>(null);
  /** Prevents double/triple Run clicks from pasting the same /blog prompt into the PTY multiple times. */
  const [commandRunnerLocked, setCommandRunnerLocked] = useState(false);
  const commandRunnerUnlockTimerRef = useRef<number | null>(null);
  const commandRunnerCooldownRef = useRef(false);
  /** Latest merged Pretty transcript (ResultsView); read synchronously before clearing for the next Run. */
  const ptyMergedCaptureRef = useRef<() => string>(() => '');
  /** Metadata for the Command Runner turn currently accumulating in the PTY (saved when the next Run starts or tab hides). */
  const lastPtyHistoryMetaRef = useRef<{ commandKey: string; target: string; startedAt: string } | null>(null);
  const recordedPtyHistoryStartsRef = useRef<Set<string>>(new Set());

  const tryAppendPtyConversationToHistory = useCallback(async () => {
    const prev = lastPtyHistoryMetaRef.current;
    if (!prev || recordedPtyHistoryStartsRef.current.has(prev.startedAt)) return;
    const merged = (ptyMergedCaptureRef.current?.() ?? '').trim();
    if (merged.length < 120) return;
    const finishedAt = new Date().toISOString();
    try {
      await apiService.appendPtyHistoryRun({
        commandKey: prev.commandKey,
        target: prev.target,
        rawOutput: merged,
        startedAt: prev.startedAt,
        finishedAt
      });
      recordedPtyHistoryStartsRef.current.add(prev.startedAt);
    } catch (e) {
      console.warn('[claude-content-ui] PTY history append failed:', e);
    }
  }, []);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'hidden') return;
      void tryAppendPtyConversationToHistory();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [tryAppendPtyConversationToHistory]);

  useEffect(() => {
    return () => {
      if (commandRunnerUnlockTimerRef.current != null) {
        window.clearTimeout(commandRunnerUnlockTimerRef.current);
        commandRunnerUnlockTimerRef.current = null;
      }
      commandRunnerCooldownRef.current = false;
    };
  }, []);

  const onRunnerSessionChange = useCallback((commandKey: string, target: string) => {
    setChatThreadKey(formatChatThreadKey(commandKey, target));
  }, []);

  const handleRun = useCallback(
    (commandKey: string, target: string) => {
    setError(null);
    if (commandRunnerCooldownRef.current) {
      return;
    }
    if (!ptySessionReady) {
      setError('PTY session disconnected, Click Restart to start the claude terminal.');
      return;
    }
    const cmd = BLOG_COMMANDS.find((c) => c.key === commandKey);
    if (!cmd) {
      setError(`Unknown command key: ${commandKey}`);
      return;
    }
    void tryAppendPtyConversationToHistory();
    const threadKey = formatChatThreadKey(commandKey, target.trim());
    clearDashboardChatHistory(threadKey);
    savePtyPrettyArchive(threadKey, '');
    const prompt = buildBlogPrompt(cmd, target);
    clearLiveTranscript({ resetPrettySession: true });

    const releaseRunnerUi = () => {
      commandRunnerCooldownRef.current = false;
      setCommandRunnerLocked(false);
      if (commandRunnerUnlockTimerRef.current != null) {
        window.clearTimeout(commandRunnerUnlockTimerRef.current);
        commandRunnerUnlockTimerRef.current = null;
      }
    };

    const armRunnerUi = () => {
      commandRunnerCooldownRef.current = true;
      setCommandRunnerLocked(true);
      if (commandRunnerUnlockTimerRef.current != null) {
        window.clearTimeout(commandRunnerUnlockTimerRef.current);
      }
      commandRunnerUnlockTimerRef.current = window.setTimeout(releaseRunnerUi, 2800);
    };

    armRunnerUi();

    /** Send prompt then CR on a timer: one combined write often echoes the line but never submits for long /blog … URLs. */
    const scheduleEnter = () => {
      window.setTimeout(() => {
        void sendToPty('\r');
      }, 100);
    };

    const onSentToPty = () => {
      const now = Date.now();
      setPtySentAt(now);
      ptySentAtRef.current = now;
      lastPtyHistoryMetaRef.current = {
        commandKey,
        target: target.trim(),
        startedAt: new Date().toISOString()
      };
    };

    const ok = sendToPty(prompt);
    if (ok) {
      scheduleEnter();
      onSentToPty();
      return;
    }
    requestAnimationFrame(() => {
      if (sendToPty(prompt)) {
        scheduleEnter();
        onSentToPty();
        return;
      }
      window.setTimeout(() => {
        if (sendToPty(prompt)) {
          scheduleEnter();
          onSentToPty();
        } else {
          setError('PTY session disconnected, Click Restart to start the claude terminal.');
          releaseRunnerUi();
        }
      }, 120);
    });
  },
  [ptySessionReady, sendToPty, clearLiveTranscript, tryAppendPtyConversationToHistory]
  );

  /**
   * Dashboard PTY runs are open-ended; do not keep ResultsView in a perpetual “loading” state after the first Run
   * (that broke Pretty badges and gated report auto-switch). Activity comes from the transcript + `ptySentAt`.
   */
  const ptyIsProcessing = false;

  /** Persist the latest Pretty merge before leaving the dashboard (append only ran on tab-hide or next Run before). */
  const handleViewChange = useCallback(
    (view: 'dashboard' | 'history' | 'usage' | 'account' | 'logon') => {
      void (async () => {
        if (activeView === 'dashboard' && view !== 'dashboard') {
          try {
            flushLiveTranscriptNow();
            await new Promise((r) => setTimeout(r, 0));
            await tryAppendPtyConversationToHistory();
          } catch {
            /* non-fatal: History still opens; user may see an older capture until next append */
          }
        }
        setActiveView(view);
      })();
    },
    [activeView, flushLiveTranscriptNow, tryAppendPtyConversationToHistory]
  );

  return (
    <Layout
      activeView={activeView}
      onViewChange={handleViewChange}
      headerSession={headerSession}
      terminalWsEnabled={terminalWsEnabled}
      onPtyWelcomeBackDetected={onPtyWelcomeName}
      onPtySessionEnd={onPtySessionEnd}
      onRestartPtySession={terminalWsEnabled ? handleRestartPtySession : undefined}
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
              isLoading={commandRunnerLocked}
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
                ptyMergedCaptureRef={ptyMergedCaptureRef}
                onRestartPtySession={terminalWsEnabled ? handleRestartPtySession : undefined}
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
