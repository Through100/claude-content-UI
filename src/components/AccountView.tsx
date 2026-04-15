import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Keyboard, Terminal } from 'lucide-react';
import { apiService } from '../services/api';
import type { AccountStatusInfo, AccountStatusSnapshot } from '../types';
import ClaudeTerminalView from './ClaudeTerminalView';

const EMPTY_SNAPSHOT: AccountStatusSnapshot = { parseOk: false };

const ROW_DEFS: { key: keyof Omit<AccountStatusSnapshot, 'parseOk'>; label: string }[] = [
  { key: 'version', label: 'Version' },
  { key: 'sessionName', label: 'Session name' },
  { key: 'sessionId', label: 'Session ID' },
  { key: 'cwd', label: 'cwd' },
  { key: 'loginMethod', label: 'Login method' },
  { key: 'organization', label: 'Organization' },
  { key: 'email', label: 'Email' },
  { key: 'model', label: 'Model' },
  { key: 'settingSources', label: 'Setting sources' }
];

function AccountPrettyPanel({ data }: { data: AccountStatusInfo }) {
  const snap = data.statusSnapshot ?? EMPTY_SNAPSHOT;
  return (
    <div className="space-y-4">
      {!snap.parseOk && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 leading-relaxed">
          The Status tab fields could not be read reliably from this capture. Open the Raw tab for the full terminal
          output, or try Refresh after <code className="text-xs bg-white/80 px-1 rounded">/status</code> has finished in
          the PTY.
        </p>
      )}
      <dl className="rounded-2xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100 overflow-hidden">
        {ROW_DEFS.map(({ key, label }) => {
          const v = snap[key];
          return (
            <div key={key} className="grid gap-1 sm:grid-cols-[minmax(140px,200px)_1fr] px-5 py-4 sm:items-start">
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
              <dd className="text-sm text-gray-900 font-mono break-all leading-relaxed">{v?.trim() ? v : '—'}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export default function AccountView() {
  const [data, setData] = useState<AccountStatusInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadElapsedSec, setLoadElapsedSec] = useState(0);
  const [activeTab, setActiveTab] = useState<'pretty' | 'raw' | 'login'>('pretty');
  const [terminalWsEnabled, setTerminalWsEnabled] = useState(true);

  const refresh = useCallback(async () => {
    setFetchError(null);
    setIsRunning(true);
    try {
      const [info, health] = await Promise.all([apiService.getAccountStatus(), apiService.getSystemStatus()]);
      setData(info);
      setTerminalWsEnabled(
        typeof (health as { terminalWebSocket?: boolean }).terminalWebSocket === 'boolean'
          ? (health as { terminalWebSocket: boolean }).terminalWebSocket
          : true
      );
    } catch (error) {
      console.error('Account GET failed:', error);
      setFetchError(error instanceof Error ? error.message : String(error));
      try {
        const health = await apiService.getSystemStatus();
        setTerminalWsEnabled(
          typeof (health as { terminalWebSocket?: boolean }).terminalWebSocket === 'boolean'
            ? (health as { terminalWebSocket: boolean }).terminalWebSocket
            : true
        );
      } catch {
        setTerminalWsEnabled(false);
      }
    } finally {
      setIsLoading(false);
      setIsRunning(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isLoading) return;
    const t0 = Date.now();
    setLoadElapsedSec(0);
    const id = window.setInterval(() => {
      setLoadElapsedSec(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isLoading]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 bg-white rounded-2xl border border-gray-200 border-dashed max-w-lg mx-auto">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-700 font-medium">Running /status…</p>
        <p className="text-sm font-mono text-indigo-600 mt-2">{loadElapsedSec}s elapsed</p>
        <p className="text-sm text-gray-500 text-center mt-4 leading-relaxed">
          Same PTY setup as Usage: on Linux the server uses <code className="text-xs bg-gray-100 px-1 rounded">script -qec &apos;timeout … claude &quot;/status&quot;&apos; /dev/null</code> when <code className="text-xs bg-gray-100 px-1 rounded">script</code> is available so <code className="text-xs bg-gray-100 px-1 rounded">/status</code> runs interactively (avoids{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">Unknown skill: status</code> from piped I/O). Inner timeout defaults to 4s — raise <code className="text-xs bg-gray-100 px-1 rounded">CLAUDE_ACCOUNT_STATUS_TIMEOUT_SPEC</code> if the capture is often cut short.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12 max-w-4xl">
      {fetchError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-800 text-sm">
          <p className="font-bold">Request failed</p>
          <p className="mt-2 font-mono text-xs">{fetchError}</p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-gray-600 leading-relaxed">
          <span className="text-gray-700 font-medium">Pretty</span> / <span className="text-gray-700 font-medium">Raw</span>{' '}
          use the same bash + <code className="text-xs bg-gray-100 px-1 rounded">script</code> probe as Usage (inner timeout default <strong>4s</strong>).{' '}
          <span className="text-gray-700 font-medium">Interactive terminal</span> opens a real PTY to <code className="text-xs bg-gray-100 px-1 rounded">claude</code> in{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">CLAUDE_WORKDIR</code> (type <code className="text-xs bg-gray-100 px-1 rounded">/login</code> yourself). Requires{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">python3</code> and <code className="text-xs bg-gray-100 px-1 rounded">scripts/pty-proxy.py</code> on the server).
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isRunning}
          className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50 shrink-0 self-start sm:self-auto"
        >
          {isRunning ? 'Running…' : 'Refresh'}
        </button>
      </div>

      <div className="flex flex-wrap bg-gray-100 p-1 rounded-xl w-full gap-1 sm:w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('pretty')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'pretty' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileText size={16} />
          Pretty view
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('raw')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'raw' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Terminal size={16} />
          Raw output
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('login')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            activeTab === 'login' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Keyboard size={16} />
          Interactive terminal
        </button>
      </div>

      {activeTab === 'pretty' && data && <AccountPrettyPanel data={data} />}

      {activeTab === 'raw' && data && (
        <div className="bg-[#1e1e1e] rounded-2xl border border-gray-800 shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-gray-800 gap-2">
            <div className="flex gap-1.5 shrink-0">
              <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
              <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
            </div>
            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest shrink-0">
              Terminal output
            </span>
            <code className="text-[10px] font-mono text-amber-200/90 truncate text-right max-w-[55%]">
              {data.argv?.length ? JSON.stringify(data.argv) : 'bash'}
            </code>
          </div>
          <pre className="p-6 text-sm font-mono text-gray-300 overflow-auto max-h-[min(75vh,720px)] leading-relaxed whitespace-pre-wrap">
            {data.output.trim() ? data.output : '(no output)'}
          </pre>
        </div>
      )}

      {activeTab === 'raw' && !data && (
        <p className="text-sm text-gray-500">No /status capture yet — fix the error above or press Refresh.</p>
      )}

      {activeTab === 'pretty' && !data && (
        <p className="text-sm text-gray-500">No parsed snapshot — fix the error above or press Refresh.</p>
      )}

      {activeTab === 'login' && (
        <div className="space-y-3">
          {!terminalWsEnabled ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              Interactive terminal is disabled on the server (<code className="text-xs bg-white/70 px-1 rounded">CLAUDE_TERMINAL_WS=0</code>). Remove it to allow the WebSocket PTY.
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500 leading-relaxed">
                Starts <code className="bg-gray-100 px-1 rounded">claude</code> in a real PTY with no extra commands — type <code className="bg-gray-100 px-1 rounded">/login</code> (or anything else) yourself. Complete browser auth when prompted, then paste codes here. Trusted internal networks only — full shell as the API user.
              </p>
              <ClaudeTerminalView compact title="Claude — interactive (PTY)" />
            </>
          )}
        </div>
      )}

      {data && activeTab !== 'login' && (
        <p className="text-[10px] font-mono text-gray-400 px-1 break-all">
          Last /status probe: exitCode={String(data.exitCode)} argv={JSON.stringify(data.argv)}
        </p>
      )}
    </div>
  );
}
