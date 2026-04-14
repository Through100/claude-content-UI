import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Terminal } from 'lucide-react';
import { apiService } from '../services/api';
import type { UsageInfo, UsageQuotaSection, UsageQuotaSnapshot } from '../types';
import { formatResetCountdown, parseUsageResetTargetUtc } from '../utils/usageResetRelative';

const EMPTY_QUOTA_SNAPSHOT: UsageQuotaSnapshot = {
  parseOk: false,
  sections: [
    { id: 'current_session', title: 'Current session', percentUsed: null, detailLines: [], matched: false },
    { id: 'current_week', title: 'Current week (all models)', percentUsed: null, detailLines: [], matched: false },
    { id: 'extra_usage', title: 'Extra usage', percentUsed: null, detailLines: [], matched: false }
  ]
};

function UsageDetailLine({ line }: { line: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const target = parseUsageResetTargetUtc(line, now);
  return (
    <li className="space-y-1">
      <div className="font-mono text-xs sm:text-sm text-gray-600 leading-snug">{line}</div>
      {target ? (
        <p className="text-xs font-medium text-indigo-600 tabular-nums pl-0.5">
          <span className="text-gray-500 font-normal">Time until reset </span>
          {formatResetCountdown(target, now)}
        </p>
      ) : null}
    </li>
  );
}

function UsageQuotaCard({ section }: { section: UsageQuotaSection }) {
  const isPlaceholder = section.matched === false;
  const pct = section.percentUsed;

  return (
    <div
      className={`rounded-2xl border p-5 bg-white shadow-sm ${
        isPlaceholder ? 'border-dashed border-gray-300' : 'border-gray-200'
      }`}
    >
      <h3 className="text-sm font-semibold text-gray-900 tracking-tight">{section.title}</h3>
      {isPlaceholder ? (
        <p className="mt-4 text-sm text-gray-500">Not found in this capture.</p>
      ) : (
        <>
          <p className="mt-3 text-3xl font-bold tabular-nums text-indigo-700">
            {pct !== null ? `${pct}%` : '—'}
            {pct !== null && <span className="text-base font-medium text-gray-500 ml-1.5">used</span>}
          </p>
          {pct !== null && (
            <div className="mt-3 h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all"
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          )}
          {section.barLine ? (
            <pre className="mt-4 text-[10px] leading-snug text-gray-600 font-mono overflow-x-auto whitespace-pre border-t border-gray-100 pt-3">
              {section.barLine}
            </pre>
          ) : null}
          {section.detailLines.length > 0 ? (
            <ul className="mt-3 space-y-2.5 text-sm text-gray-600 leading-snug">
              {section.detailLines.map((l, i) => (
                <UsageDetailLine key={`${i}:${l.slice(0, 48)}`} line={l} />
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

function UsagePrettyPanel({ data }: { data: UsageInfo }) {
  const quotaSnapshot = data.quotaSnapshot ?? EMPTY_QUOTA_SNAPSHOT;
  return (
    <div className="space-y-4">
      {!quotaSnapshot.parseOk && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 leading-relaxed">
          The Usage tab quotas could not be read reliably from this capture (for example when only the JSON fallback
          block is present). Use the Raw tab for the full terminal output, or try Refresh once{' '}
          <code className="text-xs bg-white/80 px-1 rounded">/usage</code> has finished drawing in the PTY.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {quotaSnapshot.sections.map((s) => (
          <UsageQuotaCard key={s.id} section={s} />
        ))}
      </div>
    </div>
  );
}

export default function UsageView() {
  const [data, setData] = useState<UsageInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadElapsedSec, setLoadElapsedSec] = useState(0);
  const [activeTab, setActiveTab] = useState<'pretty' | 'raw'>('pretty');

  const refresh = useCallback(async () => {
    setFetchError(null);
    setIsRunning(true);
    try {
      const info = await apiService.getUsageInfo();
      setData(info);
    } catch (error) {
      console.error('Usage GET failed:', error);
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
        <p className="text-gray-700 font-medium">Running /usage…</p>
        <p className="text-sm font-mono text-indigo-600 mt-2">{loadElapsedSec}s elapsed</p>
        <p className="text-sm text-gray-500 text-center mt-4 leading-relaxed">
          On Linux the server wraps <code className="text-xs bg-gray-100 px-1 rounded">script -qec &apos;timeout … claude &quot;/usage&quot;&apos; /dev/null</code> so
          <code className="text-xs bg-gray-100 px-1 rounded"> claude</code> gets a PTY (avoids <code className="text-xs bg-gray-100 px-1 rounded">Unknown skill: usage</code> from piped I/O). Otherwise the same inner{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">timeout … claude &quot;/usage&quot;</code> runs without <code className="text-xs bg-gray-100 px-1 rounded">script</code>.
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
          Runs <code className="text-xs bg-gray-100 px-1 rounded">bash -c …</code> on the server (Linux: inside{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">script -qec … /dev/null</code> for a PTY when <code className="text-xs bg-gray-100 px-1 rounded">script</code> exists).{' '}
          <span className="text-gray-700 font-medium">Pretty view</span> reads Current session / week / extra usage from the capture; <span className="text-gray-700 font-medium">Raw</span> is the full text.
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
            <UsagePrettyPanel data={data} />
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
