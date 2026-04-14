import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Terminal } from 'lucide-react';
import { apiService } from '../services/api';
import type { AccountStatusInfo, AccountStatusSnapshot } from '../types';

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
  const [activeTab, setActiveTab] = useState<'pretty' | 'raw'>('pretty');

  const refresh = useCallback(async () => {
    setFetchError(null);
    setIsRunning(true);
    try {
      const info = await apiService.getAccountStatus();
      setData(info);
    } catch (error) {
      console.error('Account GET failed:', error);
      setFetchError(error instanceof Error ? error.message : String(error));
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
          <code className="text-xs bg-gray-100 px-1 rounded">Unknown skill: status</code> from piped I/O).
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
          Runs <code className="text-xs bg-gray-100 px-1 rounded">bash -c …</code> on the server with the same{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">script</code>-based PTY as Usage Info.{' '}
          <span className="text-gray-700 font-medium">Pretty view</span> extracts the Status tab fields;{' '}
          <span className="text-gray-700 font-medium">Raw</span> shows the full capture.
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

      {data && (
        <>
          <div className="flex bg-gray-100 p-1 rounded-xl w-full sm:w-fit">
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
          </div>

          {activeTab === 'pretty' ? (
            <AccountPrettyPanel data={data} />
          ) : (
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

          <p className="text-[10px] font-mono text-gray-400 px-1 break-all">
            exitCode={String(data.exitCode)} argv={JSON.stringify(data.argv)}
          </p>
        </>
      )}
    </div>
  );
}
