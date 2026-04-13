import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import type { UsageInfo } from '../types';

/** Empty or Claude Code "Unknown skill" (unless we appended a local usage-exact.json snapshot). */
function isUnusableProbe(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true;
  if (/usage-exact\.json \(local snapshot/i.test(s)) return false;
  return /unknown skill:/i.test(s);
}

function TerminalPanel({
  command,
  text,
  large
}: {
  command: string;
  text: string;
  /** Taller panel for the main Usage output. */
  large?: boolean;
}) {
  const body = text.trim() ? text : '(no output)';
  const maxH = large ? 'max-h-[min(75vh,720px)]' : 'max-h-[min(480px,55vh)]';
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
      <pre
        className={`p-6 text-sm font-mono text-gray-300 overflow-auto ${maxH} leading-relaxed whitespace-pre-wrap`}
      >
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
          Default: one <code className="text-xs bg-gray-100 px-1 rounded">claude /usage</code> subprocess (argv like{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">! claude /usage</code>), cleaned env (no{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">npm_config_prefix</code>), optional{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">CLAUDE_USAGE_BASH_LC=1</code>. If the CLI still cannot draw
          the TUI here, the API may append <code className="text-xs bg-gray-100 px-1 rounded">~/.claude/usage-exact.json</code>.
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
  const allSlashUnusable = data.usageOnlyPrimary
    ? usageUn
    : statusUn && usageUn && isUnusableProbe(statsText);
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
          <p className="font-bold text-rose-900">
            {data.usageOnlyPrimary
              ? 'Why you see “hit your limit” here'
              : 'Why every panel shows “hit your limit”'}
          </p>
          <p>
            {data.usageProbeMode === 'nl' ? (
              <>
                {data.usageOnlyPrimary ? (
                  <>
                    The <code className="text-xs bg-white/80 px-1 rounded">claude -p</code> natural-language /usage probe
                    is a full model session; the CLI can return your plan&apos;s rate-limit message (exit code 1).
                  </>
                ) : (
                  <>
                    Each panel is a separate <code className="text-xs bg-white/80 px-1 rounded">claude -p</code> run
                    (natural-language probes). Those are full model sessions, so this page can hit your limit{' '}
                    <strong>three times in parallel</strong> (exit code 1). The message comes from the Claude Code CLI.
                  </>
                )}
              </>
            ) : data.usageOnlyPrimary ? (
              <>
                The server ran one <code className="text-xs bg-white/80 px-1 rounded">claude /usage</code> subprocess
                (shell-style). The CLI can still print the same rate-limit line you would see in a real terminal (exit
                code 1), depending on your plan and how Claude Code handles non-interactive usage.
              </>
            ) : (
              <>
                Each panel is a separate <code className="text-xs bg-white/80 px-1 rounded">claude</code> subprocess
                (<code className="text-xs bg-white/80 px-1 rounded">/status</code>,{' '}
                <code className="text-xs bg-white/80 px-1 rounded">/usage</code>,{' '}
                <code className="text-xs bg-white/80 px-1 rounded">/stats</code>). The CLI can refuse with the same
                limit message for each process (exit code 1).
              </>
            )}
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
          <strong>Default:</strong> the API runs a single <code className="text-xs bg-gray-100 px-1 rounded">claude /usage</code>{' '}
          subprocess (raw stdout/stderr here — same as <code className="text-xs bg-gray-100 px-1 rounded">! claude /usage</code> in
          the TUI). The child environment clears <code className="text-xs bg-gray-100 px-1 rounded">npm_config_prefix</code> so
          nvm inside an optional bash wrapper does not error. Set{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">CLAUDE_USAGE_ONLY_USAGE=0</code> to add{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">/status</code> and <code className="text-xs bg-gray-100 px-1 rounded">/stats</code>.{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">CLAUDE_USAGE_NL_PROBES=1</code> uses natural-language{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">claude -p</code> instead; optional{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">CLAUDE_USAGE_NL_FALLBACK=1</code> adds a combined{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">-p</code> fallback when primaries look unusable. The bordered
          TUI (welcome box, tabs) only renders in a real interactive terminal; here you get plain text, or{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">usage-exact.json</code> when the CLI cannot print /usage.
        </p>
        {hasHeadless ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-emerald-950">
            <strong className="font-semibold">Fallback panel:</strong> the API ran the combined{' '}
            <strong>natural-language</strong> <code className="text-xs bg-white/80 px-1 rounded">claude -p</code> run
            because the primary {data.usageOnlyPrimary ? 'probe' : 'probes'} did not return usable text.
          </p>
        ) : null}
        {!data.usageOnlyPrimary && statsLooksUseful && (statusUn || usageUn) ? (
          <p className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-indigo-950">
            <strong className="font-semibold">Tip:</strong> check the third panel (header{' '}
            <code className="text-xs bg-white/80 px-1 rounded">! claude /stats</code>) — its raw output is sometimes
            useful when the first two panels look empty or like <code className="text-xs bg-white/80 px-1 rounded">Unknown skill</code>.
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

      {data.usageOnlyPrimary ? (
        <p className="text-xs text-gray-500 -mt-2 mb-1">
          Showing only the <code className="bg-gray-100 px-1 rounded">/usage</code> probe (default). Set{' '}
          <code className="bg-gray-100 px-1 rounded">CLAUDE_USAGE_ONLY_USAGE=0</code> on the API for Status and Stats panels
          too.
        </p>
      ) : null}

      <h2 className="text-base font-semibold text-gray-800 tracking-tight">Usage</h2>
      <TerminalPanel command="! claude /usage" text={t?.usage ?? ''} large />

      {!data.usageOnlyPrimary ? (
        <>
          <h2 className="text-base font-semibold text-gray-800 tracking-tight pt-2">Status</h2>
          <TerminalPanel command="! claude /status" text={t?.status ?? ''} />
          <h2 className="text-base font-semibold text-gray-800 tracking-tight pt-2">Stats</h2>
          <TerminalPanel command="! claude /stats" text={statsText} />
        </>
      ) : null}
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
