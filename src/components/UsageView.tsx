import React, { useCallback, useEffect, useState } from 'react';
import { apiService } from '../services/api';
import type { UsageInfo } from '../types';

export default function UsageView() {
  const [data, setData] = useState<UsageInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadElapsedSec, setLoadElapsedSec] = useState(0);

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

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600 leading-relaxed">
          Runs <code className="text-xs bg-gray-100 px-1 rounded">bash -c …</code> on the server (Linux: inside{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">script -qec … /dev/null</code> for a PTY when <code className="text-xs bg-gray-100 px-1 rounded">script</code> exists) and shows the combined stdout/stderr. See <code className="text-xs bg-gray-100 px-1 rounded">argv</code> below for the exact command.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isRunning}
          className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-50 shrink-0 ml-4"
        >
          {isRunning ? 'Running…' : 'Refresh'}
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
              <code className="text-[10px] font-mono text-amber-200/90 truncate text-right max-w-[55%]">
                {data.argv?.length ? JSON.stringify(data.argv) : 'bash'}
              </code>
            </div>
            <pre className="p-6 text-sm font-mono text-gray-300 overflow-auto max-h-[min(75vh,720px)] leading-relaxed whitespace-pre-wrap">
              {data.output.trim() ? data.output : '(no output)'}
            </pre>
          </div>
          <p className="text-[10px] font-mono text-gray-400 px-1 break-all">
            exitCode={String(data.exitCode)} argv={JSON.stringify(data.argv)}
          </p>
        </>
      )}
    </div>
  );
}
