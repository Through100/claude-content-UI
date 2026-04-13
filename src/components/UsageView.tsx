import React, { useState, useEffect, useMemo } from 'react';
import { Terminal } from 'lucide-react';
import { apiService } from '../services/api';
import type { UsageInfo, SystemStatus, UsageQuotasPanel, UsageQuotaSlot } from '../types';
import { countdownFromIso } from '../utils/formatCountdown';

function defaultQuotas(): UsageQuotasPanel {
  const empty = (label: string): UsageQuotaSlot => ({
    label,
    percentUsed: null,
    resetRaw: null,
    resetAtIso: null,
    refreshCountdown: null
  });
  return {
    session: empty('Current session'),
    weekAllModels: empty('Current week (all models)'),
    extraUsageLine: null
  };
}

export default function UsageView() {
  const [data, setData] = useState<UsageInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadElapsedSec, setLoadElapsedSec] = useState(0);
  const [tick, setTick] = useState(0);

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

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const now = useMemo(() => new Date(), [tick]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 bg-white rounded-2xl border border-gray-200 border-dashed max-w-lg mx-auto">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-700 font-medium">Loading usage…</p>
        <p className="text-sm font-mono text-indigo-600 mt-2">{loadElapsedSec}s elapsed</p>
        <p className="text-sm text-gray-500 text-center mt-4 leading-relaxed">
          The server runs <code className="text-xs bg-gray-100 px-1 rounded">/stats</code> plus a quick version check.
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
  const quotas = data.usageQuotas ?? defaultQuotas();

  return (
    <div className="space-y-10 pb-12 max-w-3xl">
      {fetchError && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-amber-900 text-sm">
          Partial load: {fetchError}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
          <Terminal size={15} className="text-gray-400" />
          Account
        </h2>
        <StatusGrid status={data.status} />
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Usage quota</h2>
        </div>
        <p className="text-xs text-gray-500 -mt-2">
          Same idea as interactive <code className="text-[11px] bg-gray-100 px-1 rounded">/usage</code> → Usage tab. Bars
          are four segments (~25% each). Countdown uses parsed reset times when possible.
        </p>
        <div className="space-y-5">
          <QuotaCard slot={quotas.session} now={now} />
          <QuotaCard slot={quotas.weekAllModels} now={now} />
        </div>
        {quotas.extraUsageLine ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 text-sm text-gray-800">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
              Extra usage
            </span>
            {quotas.extraUsageLine}
          </div>
        ) : null}
      </section>

      {t?.stats && (
        <details className="bg-white rounded-2xl border border-gray-200 p-4 text-sm">
          <summary className="cursor-pointer font-bold text-gray-700">Raw /stats</summary>
          <pre className="mt-3 text-xs font-mono text-gray-600 overflow-auto max-h-64 whitespace-pre-wrap">
            {t.stats}
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

function SegmentedQuotaBar({ pct }: { pct: number | null }) {
  const p = pct == null || !Number.isFinite(pct) ? 0 : Math.max(0, Math.min(100, pct));
  const filled = Math.min(4, Math.round((p / 100) * 4));
  const saturated = p >= 99;
  return (
    <div className="flex gap-1.5 w-full mt-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`h-2.5 flex-1 rounded-sm transition-colors ${
            i < filled ? (saturated ? 'bg-neutral-800' : 'bg-amber-400') : 'bg-gray-200'
          }`}
        />
      ))}
    </div>
  );
}

function QuotaCard({ slot, now }: { slot: UsageQuotaSlot; now: Date }) {
  const pctLabel =
    slot.percentUsed != null && Number.isFinite(slot.percentUsed)
      ? `${Math.round(slot.percentUsed * 10) / 10}% used`
      : '—';
  const live = countdownFromIso(slot.resetAtIso, now) || slot.refreshCountdown;

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{slot.label}</h3>
          <p className="text-lg font-bold text-gray-900 mt-0.5 tabular-nums">{pctLabel}</p>
        </div>
        {live ? (
          <p className="text-xs text-gray-500 text-right shrink-0 max-w-[11rem] leading-snug">{live}</p>
        ) : null}
      </div>
      <SegmentedQuotaBar pct={slot.percentUsed} />
      {slot.resetRaw ? (
        <p className="text-xs text-gray-500 mt-2">
          Resets <span className="font-medium text-gray-700">{slot.resetRaw}</span>
        </p>
      ) : null}
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
