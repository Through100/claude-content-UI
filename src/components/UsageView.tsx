import React, { useState, useEffect } from 'react';
import {
  Clock,
  BarChart3,
  Sparkles,
  PieChart,
  RefreshCw,
  Cpu,
  Layers,
  Terminal
} from 'lucide-react';
import { apiService } from '../services/api';
import type { UsageInfo, UsageTabInfo, SystemStatus, ContextUsage } from '../types';

const EMPTY_USAGE_TAB: UsageTabInfo = {
  currentSessionUsage: '—',
  weeklyUsageAllModels: '—',
  weeklyUsageOpus: '—',
  contextWindow: '—',
  rateLimitsAndResets: '—'
};

export default function UsageView() {
  const [data, setData] = useState<UsageInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadElapsedSec, setLoadElapsedSec] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      setFetchError(null);
      try {
        const usageInfo = await apiService.getUsageInfo();
        setData(usageInfo);
      } catch (error) {
        console.error('Failed to fetch usage info:', error);
        setFetchError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

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
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-700 font-medium">Loading usage information…</p>
        <p className="text-sm font-mono text-indigo-600 mt-2">{loadElapsedSec}s elapsed</p>
        <p className="text-sm text-gray-500 text-center mt-4 leading-relaxed">
          The server runs <code className="text-xs bg-gray-100 px-1 rounded">/stats</code>,{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">/cost</code>, and{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">/context</code> in parallel (no slow metadata prompts).
          First load is usually much faster than before; the browser still caps total wait time.
        </p>
      </div>
    );
  }

  if (!data && !fetchError) return null;

  if (fetchError && !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-800 text-sm">
        <p className="font-bold">Could not load usage from Claude Code</p>
        <p className="mt-2 font-mono text-xs">{fetchError}</p>
      </div>
    );
  }

  if (!data) return null;

  const t = data.terminals;
  const usageTab = data.usageTab ?? EMPTY_USAGE_TAB;

  return (
    <div className="space-y-8 pb-12">
      {fetchError && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-amber-900 text-sm">
          Partial load: {fetchError}
        </div>
      )}

      <section className="space-y-4">
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
          <Terminal size={16} className="text-gray-400" />
          Status
        </h2>
        <StatusGrid status={data.status} />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
          <BarChart3 size={16} className="text-gray-400" />
          Usage
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <StatusCard
            icon={<Clock className="text-amber-600" size={18} />}
            label="Current session"
            value={usageTab.currentSessionUsage}
          />
          <StatusCard
            icon={<BarChart3 className="text-indigo-600" size={18} />}
            label="Current week (all models)"
            value={usageTab.weeklyUsageAllModels}
          />
          <StatusCard
            icon={<Sparkles className="text-violet-600" size={18} />}
            label="Current week (Opus)"
            value={usageTab.weeklyUsageOpus}
          />
          <StatusCard
            icon={<PieChart className="text-teal-600" size={18} />}
            label="Context window"
            value={usageTab.contextWindow}
          />
          <StatusCard
            icon={<RefreshCw className="text-slate-600" size={18} />}
            label="Extra usage & limits"
            value={usageTab.rateLimitsAndResets}
          />
        </div>
      </section>

      {data.configTabText ? (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Config</h2>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap overflow-auto max-h-72">
              {data.configTabText}
            </pre>
          </div>
        </section>
      ) : null}

      {data.statsTabText ? (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Stats</h2>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap overflow-auto max-h-96">
              {data.statsTabText}
            </pre>
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
          <Layers size={16} className="text-gray-400" />
          Context (<code className="text-xs font-normal text-gray-400">/context</code>)
        </h2>
        <ContextSection ctx={data.context} />
      </section>

      {t?.stats && (
        <details className="bg-white rounded-2xl border border-gray-200 p-4 text-sm">
          <summary className="cursor-pointer font-bold text-gray-700">Raw /stats</summary>
          <pre className="mt-3 text-xs font-mono text-gray-600 overflow-auto max-h-72 whitespace-pre-wrap">
            {t.stats}
          </pre>
        </details>
      )}

      {t?.context && (
        <details className="bg-white rounded-2xl border border-gray-200 p-4 text-sm">
          <summary className="cursor-pointer font-bold text-gray-700">Raw /context</summary>
          <pre className="mt-3 text-xs font-mono text-gray-600 overflow-auto max-h-72 whitespace-pre-wrap">
            {t.context}
          </pre>
        </details>
      )}

      {data.exitCodes && (
        <p className="text-[10px] font-mono text-gray-400 px-1">
          Process exit codes: {JSON.stringify(data.exitCodes)}
        </p>
      )}
    </div>
  );
}

function StatusGrid({ status }: { status: SystemStatus }) {
  const rows: { k: string; v: string }[] = [
    { k: 'Version', v: status.version },
    { k: 'Session name', v: status.sessionName },
    { k: 'Session ID', v: status.sessionId },
    { k: 'cwd', v: status.cwd },
    { k: 'Login method', v: status.loginMethod ?? '—' },
    { k: 'Organization', v: status.organization },
    { k: 'Email', v: status.email },
    { k: 'Model', v: status.model },
    { k: 'Setting sources', v: status.settingSources ?? '—' }
  ];
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100">
      {rows.map(({ k, v }) => (
        <div key={k} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 py-3">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide sm:w-40 shrink-0">{k}</span>
          <span className="text-sm text-gray-900 font-medium break-all">{v || '—'}</span>
        </div>
      ))}
    </div>
  );
}

function ContextSection({ ctx }: { ctx: ContextUsage }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
        <Cpu className="text-indigo-500 shrink-0" size={20} />
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Model</p>
          <p className="text-sm font-semibold text-gray-900">{ctx.model}</p>
          {ctx.modelFull && ctx.modelFull !== ctx.model && (
            <p className="text-xs font-mono text-gray-500">{ctx.modelFull}</p>
          )}
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Window</p>
          <p className="text-sm font-bold text-indigo-700">
            {ctx.percentage > 0 ? `${ctx.percentage}%` : '—'}{' '}
            <span className="text-gray-500 font-normal text-xs">
              {ctx.totalTokens} / {ctx.maxTokens}
            </span>
          </p>
        </div>
      </div>

      {ctx.categories.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-50">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Estimated usage by category</p>
          <ul className="space-y-2">
            {ctx.categories.map((c, i) => (
              <li key={i} className="flex justify-between gap-4 text-sm">
                <span className="text-gray-700 truncate">{c.label}</span>
                <span className="text-gray-500 shrink-0 font-mono text-xs">
                  {c.tokens} ({c.percentage}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ctx.agents.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-50">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Custom agents</p>
          <ul className="space-y-1.5 text-sm text-gray-700 max-h-48 overflow-y-auto">
            {ctx.agents.map((a, i) => (
              <li key={i} className="flex justify-between gap-2 font-mono text-xs">
                <span className="truncate">{a.name}</span>
                <span className="text-gray-500 shrink-0">{a.tokens}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ctx.skills.length > 0 && (
        <div className="px-5 py-3">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Skills</p>
          <ul className="space-y-1.5 text-sm text-gray-700 max-h-48 overflow-y-auto">
            {ctx.skills.map((s, i) => (
              <li key={i} className="flex justify-between gap-2 font-mono text-xs">
                <span className="truncate">{s.name}</span>
                <span className="text-gray-500 shrink-0">{s.tokens}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-start gap-4 hover:border-indigo-200 transition-colors">
      <div className="p-2.5 bg-gray-50 rounded-xl">{icon}</div>
      <div className="min-w-0">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">{label}</span>
        <span className="text-sm font-bold text-gray-900 mt-1 block whitespace-pre-wrap break-words">{value}</span>
      </div>
    </div>
  );
}
