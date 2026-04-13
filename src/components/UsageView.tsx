import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import type { UsageInfo } from '../types';

/** Empty or Claude Code "Unknown skill" (print mode treats many /commands as skill names). */
function isUnusableProbe(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true;
  return /unknown skill:/i.test(s);
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
        <code className="text-[10px] font-mono text-amber-200/90 truncate max-w-[55%] text-right">{command}</code>
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
          Running three parallel <code className="text-xs bg-gray-100 px-1 rounded">claude -p</code> jobs with
          natural-language prompts — each is a <strong>full model session</strong> and uses your plan or API limits (same
          information as interactive{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">! claude /status</code>,{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">! claude /usage</code>,{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">! claude /stats</code> — not raw{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">/usage</code> strings, which print mode treats as skills).
          If all panels are empty or unusable, the server runs one more combined <strong>headless</strong> probe — that can
          take a minute or two.
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
  const hints = data.hints ?? [];
  const conflicts = data.skillConflicts ?? [];
  const statsText = t?.stats ?? '';
  const statusUn = isUnusableProbe(t?.status ?? '');
  const usageUn = isUnusableProbe(t?.usage ?? '');
  const statsLooksUseful = statsText.trim().length > 0 && !isUnusableProbe(statsText);
  const allSlashUnusable = statusUn && usageUn && isUnusableProbe(statsText);
  const hasHeadless = !!(t?.headless && t.headless.trim());

  return (
    <div className="space-y-6 pb-12 max-w-4xl">
      {fetchError && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-amber-900 text-sm">
          Partial load: {fetchError}
        </div>
      )}

      {conflicts.length > 0 ? (
        <div className="rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-950">
          <p className="font-bold text-red-900">Possible skill / slash conflict</p>
          <p className="mt-1">
            Folders under <code className="text-xs bg-white/70 px-1 rounded">.claude/skills/</code> match built-in
            names: <span className="font-mono font-semibold">{conflicts.join(', ')}</span>. That often breaks{' '}
            <code className="text-xs bg-white/70 px-1 rounded">! claude /status</code>,{' '}
            <code className="text-xs bg-white/70 px-1 rounded">! claude /usage</code>, etc. Rename or remove them and
            restart Claude Code.
          </p>
        </div>
      ) : null}

      {data.rateLimitBlocked ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/95 px-4 py-3 text-sm text-rose-950 space-y-2">
          <p className="font-bold text-rose-900">Why every panel shows “hit your limit”</p>
          <p>
            Each panel is a separate <code className="text-xs bg-white/80 px-1 rounded">claude -p</code> run. Claude
            Code bills those like normal agent work, so loading this page can trip your limit <strong>three times in
            parallel</strong> (exit code 1). That message is from the CLI, not a bug in the JSON parser.
          </p>
          <p>
            For a lighter check, use interactive Claude Code and{' '}
            <code className="text-xs bg-white/80 px-1 rounded">! claude /usage</code>, or wait for the reset time shown.
          </p>
          {data.localUsageExactJson ? (
            <div className="mt-2 rounded-xl border border-rose-100 bg-white/90 overflow-hidden">
              <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wide text-rose-800/80 bg-rose-100/80">
                Local file (no model call): ~/.claude/usage-exact.json
              </div>
              <pre className="p-3 text-xs font-mono text-gray-800 max-h-[min(280px,40vh)] overflow-auto whitespace-pre-wrap">
                {data.localUsageExactJson}
              </pre>
            </div>
          ) : null}
          {data.claudeAuthStatusText ? (
            <div className="mt-2 rounded-xl border border-rose-100 bg-white/90 overflow-hidden">
              <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wide text-rose-800/80 bg-rose-100/80">
                claude auth status --text (no -p session)
              </div>
              <pre className="p-3 text-xs font-mono text-gray-800 max-h-[200px] overflow-auto whitespace-pre-wrap">
                {data.claudeAuthStatusText}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {hints.length > 0 ? (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-950">
          <p className="font-bold text-indigo-900 mb-2">How to get real output (not only “Unknown skill”)</p>
          <ol className="list-decimal list-inside space-y-2 leading-relaxed">
            {hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="space-y-3 text-sm text-gray-600 leading-relaxed">
        <p>
          Claude Code documents that <strong>built-in slash commands are interactive-only</strong>. This page does not
          pass <code className="text-xs bg-gray-100 px-1 rounded">/usage</code> (or similar) as the{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">-p</code> prompt — that path is resolved as a{' '}
          <strong>skill name</strong> and often yields <code className="text-xs bg-gray-100 px-1 rounded">Unknown skill</code>.
          The API uses natural-language print probes instead; panel titles show{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">! claude /…</code> so you can match the same tabs in your
          own interactive session. Optional server env <code className="text-xs bg-gray-100 px-1 rounded">CLAUDE_USAGE_BARE_PROBES=1</code> adds{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">--bare</code> on those runs (see Claude Code headless docs).
        </p>
        {hasHeadless ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-emerald-950">
            <strong className="font-semibold">Fourth panel:</strong> the API ran the combined <strong>natural-language</strong>{' '}
            fallback because the three primary probes above did not return usable text.
          </p>
        ) : null}
        {statsLooksUseful && (statusUn || usageUn) ? (
          <p className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-indigo-950">
            <strong className="font-semibold">Tip:</strong> check the third panel (header{' '}
            <code className="text-xs bg-white/80 px-1 rounded">! claude /stats</code>) — its raw output often mirrors what
            you see for <code className="text-xs bg-white/80 px-1 rounded">! claude /usage</code> in an interactive
            session when the first two panels fail in print mode.
          </p>
        ) : null}
        {allSlashUnusable && !hasHeadless ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
            No usable probe output and no headless fallback arrived. Open an <strong>interactive</strong> Claude Code
            session and run <code className="text-xs bg-white/70 px-1 rounded">! claude /usage</code>, or raise{' '}
            <code className="text-xs bg-white/70 px-1 rounded">CLAUDE_USAGE_TIMEOUT_MS</code> if the headless step timed
            out on the server.
          </p>
        ) : null}
      </div>

      <TerminalPanel command="! claude /status" text={t?.status ?? ''} />
      <TerminalPanel command="! claude /usage" text={t?.usage ?? ''} />
      <TerminalPanel command="! claude /stats" text={statsText} />
      {hasHeadless ? (
        <TerminalPanel
          command="Status + Usage (combined NL fallback)"
          text={t.headless ?? ''}
        />
      ) : null}

      {data.exitCodes && (
        <p className="text-[10px] font-mono text-gray-400 px-1">
          Process exit codes: {JSON.stringify(data.exitCodes)}
        </p>
      )}
    </div>
  );
}
