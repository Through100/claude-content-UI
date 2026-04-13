import React, { useState, useEffect } from 'react';
import {
  Clock,
  BarChart3,
  Sparkles,
  PieChart,
  RefreshCw
} from 'lucide-react';
import { apiService } from '../services/api';
import type { UsageInfo, UsageTabInfo } from '../types';

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
    return () => clearInterval(id);
  }, [isLoading]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 bg-white rounded-2xl border border-gray-200 border-dashed max-w-lg mx-auto">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-700 font-medium">Loading usage information…</p>
        <p className="text-sm font-mono text-indigo-600 mt-2">{loadElapsedSec}s elapsed</p>
        <p className="text-sm text-gray-500 text-center mt-4 leading-relaxed">
          The server runs several Claude Code processes in parallel (Status probe, Usage probe,{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">/cost</code>,{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">/context</code>). This often takes 1–3 minutes; the browser
          will stop waiting after a capped timeout and show an error instead of spinning forever.
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
    <div className="space-y-6 pb-12">
      {fetchError && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-amber-900 text-sm">
          Partial load: {fetchError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatusCard
          icon={<Clock className="text-amber-600" size={18} />}
          label="Current session usage"
          value={usageTab.currentSessionUsage}
        />
        <StatusCard
          icon={<BarChart3 className="text-indigo-600" size={18} />}
          label="Weekly usage (all models)"
          value={usageTab.weeklyUsageAllModels}
        />
        <StatusCard
          icon={<Sparkles className="text-violet-600" size={18} />}
          label="Weekly usage (Opus)"
          value={usageTab.weeklyUsageOpus}
        />
        <StatusCard
          icon={<PieChart className="text-teal-600" size={18} />}
          label="Context window"
          value={usageTab.contextWindow}
        />
        <StatusCard
          icon={<RefreshCw className="text-slate-600" size={18} />}
          label="Rate limits & resets"
          value={usageTab.rateLimitsAndResets}
        />
      </div>

      {t?.usage && (
        <details className="bg-white rounded-2xl border border-gray-200 p-4 text-sm">
          <summary className="cursor-pointer font-bold text-gray-700">Raw Usage tab (headless probe)</summary>
          <pre className="mt-3 text-xs font-mono text-gray-600 overflow-auto max-h-64 whitespace-pre-wrap">
            {t.usage}
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

function StatusCard({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-start gap-4 hover:border-indigo-200 transition-colors">
      <div className="p-2.5 bg-gray-50 rounded-xl">
        {icon}
      </div>
      <div className="min-w-0">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">{label}</span>
        <span className="text-sm font-bold text-gray-900 mt-1 block truncate">{value}</span>
      </div>
    </div>
  );
}
