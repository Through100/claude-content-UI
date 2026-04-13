import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import type { UsageInfo } from '../types';

/** Claude Code print mode often returns this instead of running the interactive slash. */
function isUnknownSkillFor(raw: string, slug: string): boolean {
  return new RegExp(`unknown\\s+skill:\\s*${slug}\\b`, 'i').test(raw.trim());
}

function TerminalPanel({ command, text }: { command: string; text: string }) {
  const body = text.trim() ? text : '(no output)';
  return (
    <div className="bg-[#1e1e1e] rounded-2xl border border-gray-800 shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-gray-800">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
          <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
          <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
        </div>
        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Terminal Output</span>
        <code className="text-[10px] font-mono text-amber-200/90 truncate max-w-[40%] text-right">{command}</code>
      </div>
      <pre className="p-6 text-sm font-mono text-gray-300 overflow-auto max-h-[min(480px,55vh)] leading-relaxed whitespace-pre-wrap">
        {body}
      </pre>
    </div>
  );
}

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
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-700 font-medium">Loading usage…</p>
        <p className="text-sm font-mono text-indigo-600 mt-2">{loadElapsedSec}s elapsed</p>
        <p className="text-sm text-gray-500 text-center mt-4 leading-relaxed">
          Fetching raw <code className="text-xs bg-gray-100 px-1 rounded">/status</code>,{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">/usage</code>, and{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">/stats</code> in parallel.
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
  const statsText = t?.stats ?? '';
  const statusUn = isUnknownSkillFor(t?.status ?? '', 'status');
  const usageUn = isUnknownSkillFor(t?.usage ?? '', 'usage');
  const statsUn = isUnknownSkillFor(statsText, 'stats');
  const statsLooksUseful = statsText.trim().length > 0 && !statsUn;
  const allSlashBroken = statusUn && usageUn && statsUn;

  return (
    <div className="space-y-6 pb-12 max-w-4xl">
      {fetchError && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-amber-900 text-sm">
          Partial load: {fetchError}
        </div>
      )}

      <div className="space-y-3 text-sm text-gray-600 leading-relaxed">
        <p>
          In <code className="text-xs bg-gray-100 px-1 rounded">claude -p</code> (print mode), many builds treat tokens
          like <code className="text-xs bg-gray-100 px-1 rounded">/status</code> and{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">/usage</code> as <strong>skill names</strong>, not the same
          slash commands as the interactive TUI — so you often see{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">Unknown skill: status</code> even though the command works
          in an interactive session. Exit code can still be <code className="text-xs bg-gray-100 px-1 rounded">0</code>.
        </p>
        {statsLooksUseful && (statusUn || usageUn) ? (
          <p className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-indigo-950">
            <strong className="font-semibold">Tip:</strong> use the third panel — raw{' '}
            <code className="text-xs bg-white/80 px-1 rounded">/stats</code> output usually includes the same status and
            usage-style block in one stream when the first two lines fail in print mode.
          </p>
        ) : null}
        {allSlashBroken ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
            None of these slash probes returned usable text. Open an <strong>interactive</strong> Claude Code session
            and run <code className="text-xs bg-white/70 px-1 rounded">/usage</code> there, or upgrade the CLI on the
            machine that runs this API.
          </p>
        ) : null}
      </div>

      <TerminalPanel command="/status" text={t?.status ?? ''} />
      <TerminalPanel command="/usage" text={t?.usage ?? ''} />
      <TerminalPanel command="/stats" text={statsText} />

      {data.exitCodes && (
        <p className="text-[10px] font-mono text-gray-400 px-1">
          Process exit codes: {JSON.stringify(data.exitCodes)}
        </p>
      )}
    </div>
  );
}
