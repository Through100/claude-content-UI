import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../services/api';
import type { UsageInfo } from '../types';

const DEFAULT_LINE = '/usage';

export default function UsageView() {
  const [line, setLine] = useState(DEFAULT_LINE);
  const [data, setData] = useState<UsageInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadElapsedSec, setLoadElapsedSec] = useState(0);

  const refreshDefault = useCallback(async () => {
    setFetchError(null);
    setIsRunning(true);
    try {
      const info = await apiService.getUsageInfo();
      setData(info);
      setLine(info.line);
    } catch (error) {
      console.error('Usage GET failed:', error);
      setFetchError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
      setIsRunning(false);
    }
  }, []);

  const runCurrentLine = useCallback(async () => {
    const trimmed = line.trim() || DEFAULT_LINE;
    setFetchError(null);
    setIsRunning(true);
    try {
      const info = await apiService.postUsageExec(trimmed);
      setData(info);
      setLine(info.line);
    } catch (error) {
      console.error('Usage exec failed:', error);
      setFetchError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRunning(false);
    }
  }, [line]);

  useEffect(() => {
    void refreshDefault();
  }, [refreshDefault]);

  useEffect(() => {
    if (!isLoading) return;
    const t0 = Date.now();
    setLoadElapsedSec(0);
    const id = window.setInterval(() => {
      setLoadElapsedSec(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isLoading]);

  const onRun = () => {
    void runCurrentLine();
  };

  const onRefreshDefault = () => {
    setLine(DEFAULT_LINE);
    void refreshDefault();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 bg-white rounded-2xl border border-gray-200 border-dashed max-w-lg mx-auto">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-700 font-medium">Running {DEFAULT_LINE}…</p>
        <p className="text-sm font-mono text-indigo-600 mt-2">{loadElapsedSec}s elapsed</p>
        <p className="text-sm text-gray-500 text-center mt-4 leading-relaxed">
          On Linux/macOS the API usually runs <code className="text-xs bg-gray-100 px-1 rounded">bash</code> with{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">timeout … claude &quot;/usage&quot;</code> (same idea as
          your terminal) and shows that stdout here. If that output is not recognized, it falls back to headless{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">claude -p</code> (uses API quota). Windows skips bash and
          uses <code className="text-xs bg-gray-100 px-1 rounded">-p</code>. Set{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">CLAUDE_USAGE_BASH_QUOTED_USAGE=0</code> to force headless
          only, or <code className="text-xs bg-gray-100 px-1 rounded">CLAUDE_USAGE_USAGE_INTERACTIVE_SLASH=1</code> for
          stdin slash.
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

      <p className="text-sm text-gray-600 leading-relaxed">
        Enter a single slash command. <strong>Run</strong> executes it on the server. Default{' '}
        <code className="text-xs bg-gray-100 px-1 rounded">/usage</code> on Unix prefers real TUI text from{' '}
        <code className="text-xs bg-gray-100 px-1 rounded">bash</code> + <code className="text-xs bg-gray-100 px-1 rounded">timeout</code> +{' '}
        <code className="text-xs bg-gray-100 px-1 rounded">claude &quot;/usage&quot;</code>; fallback is headless{' '}
        <code className="text-xs bg-gray-100 px-1 rounded">-p</code> (quota). <code className="text-xs bg-gray-100 px-1 rounded">/context</code> and similar use stdin like the REPL.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRun();
          }}
          className="flex-1 min-w-[200px] rounded-xl border border-gray-300 px-3 py-2 font-mono text-sm bg-white"
          placeholder="/usage"
          spellCheck={false}
          autoComplete="off"
          aria-label="Slash command"
        />
        <button
          type="button"
          onClick={onRun}
          disabled={isRunning}
          className="rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {isRunning ? 'Running…' : 'Run'}
        </button>
        <button
          type="button"
          onClick={onRefreshDefault}
          disabled={isRunning}
          className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50"
        >
          Refresh /usage
        </button>
      </div>

      {data && (
        <>
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
              <code className="text-[10px] font-mono text-amber-200/90 truncate text-right">{data.line}</code>
            </div>
            {data.execMode === 'bash_quoted_usage' ? (
              <div className="px-4 py-2 bg-emerald-950/35 border-b border-emerald-900/50 text-[11px] text-emerald-50/95 leading-relaxed">
                <strong className="text-emerald-100">execMode=bash_quoted_usage</strong> — Output came from{' '}
                <code className="text-[10px] px-1 rounded bg-black/30">bash</code> running{' '}
                <code className="text-[10px] px-1 rounded bg-black/30">timeout … claude &quot;/usage&quot;</code> (or
                without <code className="text-[10px] px-1 rounded bg-black/30">timeout</code> if not installed), like your
                shell workaround. This is <strong>not</strong> the headless <code className="text-[10px] px-1 rounded bg-black/30">-p</code> quota path; you may see &quot;Esc to cancel&quot; in the text because the process was stopped early.
              </div>
            ) : null}
            {data.execMode === 'headless_usage_tab' ? (
              <div className="px-4 py-2 bg-amber-950/40 border-b border-amber-900/50 text-[11px] text-amber-100/95 leading-relaxed space-y-2">
                <p>
                  <strong className="text-amber-50">execMode=headless_usage_tab</strong> — The server used{' '}
                  <code className="text-[10px] px-1 rounded bg-black/30">claude -p</code> (model / quota), not only your
                  bash one-liner in the browser. When the API runs on Linux, it still tries{' '}
                  <code className="text-[10px] px-1 rounded bg-black/30">bash</code> +{' '}
                  <code className="text-[10px] px-1 rounded bg-black/30">timeout … claude &quot;/usage&quot;</code> first;
                  if that capture is rejected or bash is skipped (<code className="text-[10px] px-1 rounded bg-black/30">win32</code> /{' '}
                  <code className="text-[10px] px-1 rounded bg-black/30">CLAUDE_USAGE_BASH_QUOTED_USAGE=0</code>), you see this mode.
                </p>
                {data.usageNote ? (
                  <p className="text-amber-50/95 font-mono text-[10px] leading-snug whitespace-pre-wrap break-words">
                    {data.usageNote}
                  </p>
                ) : null}
              </div>
            ) : null}
            <pre className="p-6 text-sm font-mono text-gray-300 overflow-auto max-h-[min(75vh,720px)] leading-relaxed whitespace-pre-wrap">
              {data.output.trim() ? data.output : '(no output)'}
            </pre>
          </div>
          <p className="text-[10px] font-mono text-gray-400 px-1 break-all">
            execMode={data.execMode} exitCode={String(data.exitCode)} argv={JSON.stringify(data.argv)}
          </p>
        </>
      )}
    </div>
  );
}
