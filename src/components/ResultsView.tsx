import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { extractArtifactPathsFromRunText } from '../../shared/extractArtifactPaths';
import { mergePtyPlainArchive } from '../../shared/mergePtyPlainArchive';
import { sanitizePtyPrettyTranscript } from '../../shared/sanitizePtyPrettyTranscript';
import { loadPtyPrettyArchive, savePtyPrettyArchive } from '../lib/ptyPrettyArchiveStorage';
import {
  FileText,
  Terminal as TerminalIcon,
  Copy,
  Download,
  FileDown,
  Send,
  FileCode,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { BLOG_COMMANDS, RunResponse } from '../types';
import { formatChatThreadKey, sanitizeRunOutputForChat } from '../lib/dashboardChatHistory';
import { syncPrettyPtyTranscriptToDashboardThread } from '../lib/syncPtyTranscriptToDashboardChat';
import {
  getPtyParseNormalizedPlain,
  isAwaitingPtyAssistantResponse,
  parsePtyTranscriptToMessages
} from '../../shared/parsePtyTranscriptToMessages';
import { extractLastChoiceMenuSnapshotForArchive } from '../../shared/segmentPtyDiffBlocks';
import type { PtyArchivedChoiceMenu } from './PtyMessengerThread';
import { motion, AnimatePresence } from 'motion/react';
import { stripAnsi } from '../../shared/stripAnsi';
import { inferClaudeActivity } from '../../shared/inferClaudeActivity';
import { headlessOutputLooksLikeInteractivePermissionAsk } from '../../shared/headlessStalePermissionCue';
import {
  plainTailShowsAnswerablePermissionMenu,
  plainTextShowsClaudePermissionMenu,
  stripAnsiNormalizePtyMirror
} from '../../shared/claudeCodePtyPermissionMenu';
import { downloadElementAsPdf } from '../utils/downloadReportPdf';
import { apiService } from '../services/api';
import { usePtyBridge } from '../context/PtyBridgeContext';
import PtyMessengerThread from './PtyMessengerThread';
import DashboardHeadlessChat from './DashboardHeadlessChat';
import PrettyOutputBody from './PrettyOutputBody';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface ResultsViewProps {
  result: RunResponse | null;
  isLoading: boolean;
  /** Date.now() when the current run started; drives elapsed label while loading */
  loadingStartedAt?: number | null;
  /** Live stdout/stderr from Claude while the run is in progress (SSE) */
  liveTerminal?: string;
  /** SSE stream delivered run_accepted or keepalive (server link works; Claude may still be silent). */
  headlessStreamPrimed?: boolean;
  /** Bump after each headless run completes so Pretty reloads saved conversation from localStorage. */
  chatHistoryTick?: number;
  /** Headless Pretty conversation thread = blog command key + target (matches Command Runner). */
  chatThreadKey?: string;
  /** Latest finished Command Runner line + thread key so Live PTY Pretty can show the turn (not in the xterm buffer). */
  lastRunThreadMeta?: { threadKey: string; userSummary: string } | null;
  /** History detail: show saved rawOutput in Pretty/Raw without binding to the live Logon PTY. */
  embedMode?: 'live' | 'history';
  /** Date.now() when the last command was sent to PTY; used to show a brief waiting hint. */
  ptySentAt?: number | null;
  /** Parent reads merged Pretty PTY transcript before the next Run (server History for interactive sessions). */
  ptyMergedCaptureRef?: React.MutableRefObject<() => string>;
}

function formatElapsed(startedAt: number) {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

export default function ResultsView({
  result,
  isLoading,
  loadingStartedAt,
  liveTerminal = '',
  headlessStreamPrimed = false,
  chatHistoryTick = 0,
  chatThreadKey = formatChatThreadKey(BLOG_COMMANDS[0].key, ''),
  lastRunThreadMeta = null,
  embedMode = 'live',
  ptySentAt = null,
  ptyMergedCaptureRef
}: ResultsViewProps) {
  const isHistoryEmbed = embedMode === 'history';
  const [activeTab, setActiveTab] = useState<'pretty' | 'raw'>('pretty');
  const [pdfExporting, setPdfExporting] = useState(false);
  const [manualReplyBubbles, setManualReplyBubbles] = useState<
    { id: string; text: string; sentAt: number; transcriptLenAtSend: number }[]
  >([]);
  const [archivedChoiceMenus, setArchivedChoiceMenus] = useState<PtyArchivedChoiceMenu[]>([]);
  const livePreRef = useRef<HTMLPreElement>(null);
  const prettyReportRef = useRef<HTMLDivElement>(null);
  const pdfAfterPrettySwitchRef = useRef(false);
  const { ptyDisplayPlain, ptyFullSnapshotPlain, ptySessionGeneration, ptySessionReady } = usePtyBridge();
  /** `mergePtyPlainArchive` expects a full-buffer snapshot (line 0). `ptyDisplayPlain` can start mid-buffer after “From here only”, which breaks overlap and drops new tails (e.g. permission menus) from Pretty while the status bar still updates. */
  const ptyPlainForMerge =
    ptyFullSnapshotPlain.trim().length > 0 ? ptyFullSnapshotPlain : ptyDisplayPlain;

  /** Merged PTY transcript: grows with new terminal output and survives scrollback trimming; saved per topic. */
  const [ptyMergedArchive, setPtyMergedArchive] = useState(() => loadPtyPrettyArchive(chatThreadKey));
  /** Last Command Runner topic key we merged against (empty = not yet initialized). */
  const ptyArchiveThreadKeyRef = useRef('');
  /**
   * After the user changes Target without Run, the live PTY still shows the prior topic — freeze Pretty updates
   * until `ptySessionGeneration` bumps on the next Run (`clearLiveTranscript`).
   */
  const topicLiveHoldRef = useRef<string | null>(null);
  const ptyPrevSessionGenerationRef = useRef<number | null>(null);

  useEffect(() => {
    if (isHistoryEmbed) return;
    const prevThreadKey = ptyArchiveThreadKeyRef.current;
    const prevGen = ptyPrevSessionGenerationRef.current;
    const generationChanged = prevGen !== null && ptySessionGeneration !== prevGen;
    ptyPrevSessionGenerationRef.current = ptySessionGeneration;

    const threadKeyChanged = prevThreadKey !== '' && chatThreadKey !== prevThreadKey;

    setPtyMergedArchive((prev) => {
      if (generationChanged) {
        topicLiveHoldRef.current = null;
        return mergePtyPlainArchive('', ptyPlainForMerge);
      }
      if (threadKeyChanged && !generationChanged) {
        topicLiveHoldRef.current = chatThreadKey;
        return loadPtyPrettyArchive(chatThreadKey);
      }
      if (topicLiveHoldRef.current === chatThreadKey) {
        return prev;
      }
      return mergePtyPlainArchive(prev, ptyPlainForMerge);
    });

    ptyArchiveThreadKeyRef.current = chatThreadKey;
  }, [isHistoryEmbed, chatThreadKey, ptySessionGeneration, ptyPlainForMerge]);

  useEffect(() => {
    if (isHistoryEmbed) return;
    if (!ptyMergedArchive.trim()) return;
    const id = window.setTimeout(() => savePtyPrettyArchive(chatThreadKey, ptyMergedArchive), 500);
    return () => window.clearTimeout(id);
  }, [isHistoryEmbed, chatThreadKey, ptyMergedArchive]);

  useEffect(() => {
    if (isHistoryEmbed || !ptyMergedCaptureRef) return;
    ptyMergedCaptureRef.current = () => ptyMergedArchive;
  }, [isHistoryEmbed, ptyMergedArchive, ptyMergedCaptureRef]);

  useEffect(() => {
    if (isHistoryEmbed) return;
    setManualReplyBubbles([]);
    setArchivedChoiceMenus([]);
  }, [isHistoryEmbed, chatThreadKey, ptySessionGeneration]);

  const hasFreshPtyCapture =
    !isHistoryEmbed &&
    (ptyDisplayPlain.trim().length > 0 || ptyFullSnapshotPlain.trim().length > 0);
  const hasHeadlessRunCapture =
    Boolean(result?.rawOutput?.trim()) || Boolean(result?.error?.trim());

  /**
   * Pretty: when both a finished `claude -p` capture and live PTY text exist, show both — otherwise PTY-only hid
   * headless answers behind the Logon splash (same issue in Raw if the buffered block was easy to miss below).
   */
  const prettyMode = useMemo<'headless' | 'pty' | 'both'>(() => {
    if (hasFreshPtyCapture && hasHeadlessRunCapture) return 'both';
    if (hasFreshPtyCapture) return 'pty';
    return 'headless';
  }, [hasFreshPtyCapture, hasHeadlessRunCapture]);

  /** Same plain string Pretty uses for the thread — anchors Reply bubbles in transcript order. */
  const replyOrderingPlain = useMemo(() => {
    const ptyForPretty = (() => {
      const s = sanitizePtyPrettyTranscript(ptyMergedArchive);
      if (!s.trim() && ptyMergedArchive.trim()) return ptyMergedArchive;
      return s;
    })();
    return buildPtyForDisplayPlain({
      prettyMode,
      ptyForPretty,
      headlessResult: result ?? null,
      lastRunThreadMeta,
      chatThreadKey
    });
  }, [prettyMode, ptyMergedArchive, result, lastRunThreadMeta, chatThreadKey]);

  const headlessBlobForPermissionCue = useMemo(() => {
    const out = sanitizeRunOutputForChat(result?.rawOutput ?? '').trim();
    const err = result?.error?.trim();
    return out || (err ? `Error: ${err}` : '') || '';
  }, [result?.rawOutput, result?.error]);

  /** Pretty shows a finished run that looks like an interactive Fetch ask — Reply below still hits the *live* PTY only. */
  const replyPanelWarnHeadlessMenuReadOnly = useMemo(
    () => prettyMode === 'both' && headlessOutputLooksLikeInteractivePermissionAsk(headlessBlobForPermissionCue),
    [prettyMode, headlessBlobForPermissionCue]
  );

  /** Live PTY tail shows a numbered Esc/Tab menu — Reply UX hint (Ink rarely accepts the word “yes”). */
  const replyPanelNumberedMenuHint = useMemo(() => {
    const chunk = `${ptyFullSnapshotPlain}\n${ptyDisplayPlain}`.slice(-14000);
    const plain = stripAnsiNormalizePtyMirror(chunk);
    return plainTailShowsAnswerablePermissionMenu(plain);
  }, [ptyFullSnapshotPlain, ptyDisplayPlain]);

  /** Logon buffer tail looks like Claude Code’s idle welcome — “yes” has no pending question there. */
  const replyPanelWarnWelcomeSplash = useMemo(() => {
    const chunk = `${ptyFullSnapshotPlain}\n${ptyDisplayPlain}`.slice(-12000);
    /** Welcome text can linger in scrollback while a live permission menu is at the tail — don’t warn then. */
    const plain = stripAnsiNormalizePtyMirror(chunk);
    if (plainTailShowsAnswerablePermissionMenu(plain)) return false;
    if (plainTextShowsClaudePermissionMenu(plain)) return false;
    const tail = stripAnsi(chunk).toLowerCase();
    if (tail.length < 120) return false;
    return (
      tail.includes('welcome back') &&
      (tail.includes('no recent activity') || tail.includes('tips for getting started'))
    );
  }, [ptyFullSnapshotPlain, ptyDisplayPlain]);

  /** Headless capture plus live PTY transcript so workspace files mentioned only in interactive mode still get top download links. */
  const artifactPaths = useMemo(() => {
    const headless = [result?.rawOutput ?? '', result?.error ?? ''].filter(Boolean).join('\n\n');
    const chunks = [headless, !isHistoryEmbed ? ptyMergedArchive : ''].filter((s) => s.trim().length > 0);
    return extractArtifactPathsFromRunText(chunks.join('\n\n'));
  }, [result?.rawOutput, result?.error, ptyMergedArchive, isHistoryEmbed]);

  const historyPrettySource = useMemo(() => {
    if (!isHistoryEmbed || !result) return '';
    const out = sanitizeRunOutputForChat(result.rawOutput ?? '').trim();
    const err = result.error?.trim();
    return out || (err ? `Error: ${err}` : '') || '(no output captured)';
  }, [isHistoryEmbed, result]);

  const liveActivity = useMemo(() => inferClaudeActivity(liveTerminal), [liveTerminal]);

  const runPdfExport = useCallback(async () => {
    const el = prettyReportRef.current;
    if (!el) return;
    setPdfExporting(true);
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      await downloadElementAsPdf(el, `blog-run-report-${stamp}.pdf`);
    } catch (e) {
      console.error(e);
      window.alert(
        'Could not create PDF. If the output is very long, try the Raw View tab and save from your browser, or try again after scrolling through the full Pretty Output once.'
      );
    } finally {
      setPdfExporting(false);
    }
  }, []);

  const handlePdfClick = () => {
    if (activeTab !== 'pretty') {
      pdfAfterPrettySwitchRef.current = true;
      setActiveTab('pretty');
      return;
    }
    void runPdfExport();
  };

  useEffect(() => {
    if (!pdfAfterPrettySwitchRef.current || activeTab !== 'pretty') return;
    pdfAfterPrettySwitchRef.current = false;
    const t = window.setTimeout(() => {
      void runPdfExport();
    }, 450);
    return () => clearTimeout(t);
  }, [activeTab, runPdfExport]);

  useEffect(() => {
    const el = livePreRef.current;
    if (!el || !liveTerminal) return;
    el.scrollTop = el.scrollHeight;
  }, [liveTerminal]);

  const ptyTranscriptTrimmed = (ptyFullSnapshotPlain + ptyDisplayPlain).trim();
  const showBigSpinner = isLoading && !ptySessionReady && !ptyTranscriptTrimmed;
  const elapsedMs = loadingStartedAt != null ? Date.now() - loadingStartedAt : 0;
  const showLongRunHint = isLoading && elapsedMs > 40_000;
  const showNoSseYetHint = isLoading && !headlessStreamPrimed && elapsedMs > 60_000;
  const showClaudeSilentHint =
    isLoading && headlessStreamPrimed && liveTerminal.trim().length === 0 && elapsedMs > 120_000;

  if (showBigSpinner) {
    return (
      <>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 md:p-12 flex flex-col items-stretch space-y-6 max-w-6xl mx-auto w-full">
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
              <TerminalIcon className="absolute inset-0 m-auto text-indigo-600" size={24} />
            </div>
            <div className="text-center w-full max-w-xl mx-auto">
              <h3 className="text-lg font-semibold text-gray-900">Executing blog command</h3>
              <p className="text-sm text-gray-500">Live output from Claude appears below as it is produced.</p>
              {loadingStartedAt != null && (
                <p className="text-sm font-mono text-indigo-600 mt-3">Elapsed: {formatElapsed(loadingStartedAt)}</p>
              )}

              <div
                className="mt-4 flex flex-col items-center gap-2 text-left w-full"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {liveActivity ? (
                  <div className="inline-flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-3 w-full max-w-lg">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-40" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-600" />
                      </span>
                      <span className="text-sm font-semibold text-indigo-950 truncate">{liveActivity.label}…</span>
                    </div>
                    {liveActivity.detail ? (
                      <p
                        className="text-xs text-indigo-900/75 leading-snug sm:border-l sm:border-indigo-200 sm:pl-3 sm:ml-0 line-clamp-2 sm:line-clamp-3 text-center sm:text-left break-words"
                        title={liveActivity.detail}
                      >
                        {liveActivity.detail}
                      </p>
                    ) : null}
                  </div>
                ) : headlessStreamPrimed ? (
                  <p className="text-sm text-gray-600">
                    Server accepted the run — waiting for the first line of output from{' '}
                    <code className="text-xs bg-gray-100 px-1 rounded">claude -p</code>…
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">Waiting for the response stream from the API…</p>
                )}
                {showNoSseYetHint ? (
                  <p className="text-xs text-amber-900/90 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-lg">
                    No stream events yet. A reverse proxy often buffers server-sent events until the response ends. Try{' '}
                    <code className="text-[10px] bg-white/80 px-1 rounded">VITE_RUN_STREAM=0</code> (rebuild) to use
                    buffered <code className="text-[10px] bg-white/80 px-1 rounded">/api/run</code>, or inspect this
                    request in the browser Network tab.
                  </p>
                ) : null}
                {showClaudeSilentHint ? (
                  <p className="text-xs text-amber-900/90 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-lg">
                    The stream is alive but Claude has not printed anything for a long time. Check the API host logs
                    (Docker: <code className="text-[10px] bg-white/80 px-1 rounded">docker logs</code>) for auth, network,
                    or a stuck <code className="text-[10px] bg-white/80 px-1 rounded">claude</code> process.
                  </p>
                ) : null}
                {showLongRunHint ? (
                  <p className="text-xs text-amber-800/90 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 max-w-lg">
                    Long blog skill runs can take several minutes. If the timer increases and the terminal scrolls, the
                    run is still active. If the timer increases with an empty terminal, use the hints above.
                  </p>
                ) : null}
              </div>

              <p className="text-xs text-gray-400 mt-4 max-w-lg mx-auto">
                Uses <code className="bg-gray-100 px-1 rounded">/api/run/stream</code>. Ensure the API is reachable; set{' '}
                <code className="bg-gray-100 px-1 rounded">VITE_RUN_STREAM=0</code> to fall back to buffered{' '}
                <code className="bg-gray-100 px-1 rounded">/api/run</code> if your proxy buffers streaming.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-[#1e1e1e] overflow-hidden shadow-inner">
            <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-gray-800">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
              </div>
              <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Claude (live)</span>
              <div className="w-12" />
            </div>
            <pre
              ref={livePreRef}
              className="p-4 md:p-6 text-xs md:text-sm font-mono text-gray-200 overflow-auto max-h-[min(55vh,520px)] min-h-[120px] leading-relaxed whitespace-pre-wrap break-words"
            >
              {liveTerminal.length > 0
                ? liveTerminal
                : 'Waiting for output from claude…\n'}
            </pre>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-6">
      {artifactPaths.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-900 shrink-0">
            Workspace files
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {artifactPaths.map((p) => {
              const label = p.split(/[/\\]/).filter(Boolean).pop() ?? p;
              return (
                <a
                  key={p}
                  href={apiService.workspaceFileDownloadUrl(p)}
                  download={label}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-emerald-200 bg-white text-emerald-950 shadow-sm hover:bg-emerald-100 hover:border-emerald-300 transition-colors max-w-[min(100%,14rem)]"
                  title={p}
                >
                  <FileCode size={16} className="text-emerald-700 shrink-0" aria-hidden />
                  <span className="truncate">Download {label}</span>
                </a>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <div className="flex bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('pretty')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'pretty' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileText size={16} />
            Pretty Output
          </button>
          <button
            onClick={() => setActiveTab('raw')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'raw' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <TerminalIcon size={16} />
            Raw View
          </button>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
          <button
            type="button"
            onClick={handlePdfClick}
            disabled={pdfExporting}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            title="Save the Pretty Output as a PDF"
          >
            <FileDown size={16} className="text-indigo-600 shrink-0" aria-hidden />
            <span className="whitespace-nowrap">{pdfExporting ? 'Preparing PDF…' : 'Download Report in PDF'}</span>
          </button>
          <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title="Copy results">
            <Copy size={18} />
          </button>
          <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors" title="Download report">
            <Download size={18} />
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'pretty' ? (
          <motion.div
            key="pretty"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            <div ref={prettyReportRef} className="space-y-6">
              {isHistoryEmbed ? (
                <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                  <div className="px-4 py-3 md:px-6 border-b border-gray-100 bg-gray-50/80">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Saved run (Pretty)</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      From history — not the live Logon PTY. Same text as Raw, formatted for reading.
                    </p>
                  </div>
                  <div className="px-4 py-6 md:px-8 md:py-8">
                    <PrettyOutputBody text={historyPrettySource} />
                  </div>
                </div>
              ) : (
                <PrettyOutputView
                  key={`pretty-${prettyMode}-${chatThreadKey}`}
                  prettyMode={prettyMode}
                  ptyTranscript={ptyMergedArchive}
                  liveFooterPlainSource={ptyDisplayPlain}
                  chatHistoryTick={chatHistoryTick}
                  chatThreadKey={chatThreadKey}
                  lastRunThreadMeta={lastRunThreadMeta}
                  headlessResult={result}
                  ptySessionReady={ptySessionReady}
                  ptySentAt={ptySentAt}
                  isLoading={isLoading}
                  manualReplyBubbles={manualReplyBubbles}
                  archivedChoiceMenus={archivedChoiceMenus}
                />
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="raw"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            <LivePtyRawMirror
              headlessStdout={result?.rawOutput}
              headlessError={result?.error}
              livePtyMirror={!isHistoryEmbed}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {!isHistoryEmbed ? (
        <PtyReplyPanel
          warnHeadlessMenuReadOnly={replyPanelWarnHeadlessMenuReadOnly}
          warnWelcomeSplash={replyPanelWarnWelcomeSplash}
          showNumberedMenuHint={replyPanelNumberedMenuHint}
          replyOrderingPlain={replyOrderingPlain}
          onReplySent={(payload) => {
            const snap = payload.choiceMenuSnapshot?.trim();
            if (snap) {
              // #region agent log
              fetch('http://127.0.0.1:7823/ingest/0f30680b-0aa0-4d4a-ba6d-262bf6a78290', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '456dbf' },
                body: JSON.stringify({
                  sessionId: '456dbf',
                  hypothesisId: 'H3',
                  location: 'ResultsView.tsx:onReplySent',
                  message: 'archived choice menu',
                  data: { snapLen: snap.length, snapHead: snap.slice(0, 100) },
                  timestamp: Date.now()
                })
              }).catch(() => {});
              // #endregion
              setArchivedChoiceMenus((prev) => [
                ...prev,
                {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-menu`,
                  menuPlain: snap,
                  sentAt: payload.sentAt,
                  transcriptLenAtSend: payload.transcriptLenAtSend
                }
              ]);
            }
            if (!payload.text) return;
            setManualReplyBubbles((prev) => [
              ...prev,
              {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
                text: payload.text,
                sentAt: payload.sentAt,
                transcriptLenAtSend: payload.transcriptLenAtSend
              }
            ]);
          }}
        />
      ) : null}
    </div>
  );
}

type LivePtyRawMirrorProps = {
  /** When provided, last `claude -p` capture is shown below the PTY in the same card (no separate panel). */
  headlessStdout?: string;
  headlessError?: string;
  /** When false (History raw), only the saved stdout block is shown — no live xterm. */
  livePtyMirror?: boolean;
};

function LivePtyRawMirror({
  headlessStdout,
  headlessError,
  livePtyMirror = true
}: LivePtyRawMirrorProps = {}) {
  const mergeHeadless = headlessStdout !== undefined;
  const {
    clearLiveTranscript,
    sendToPty,
    peekPtyTranscriptBuffer,
    subscribePtyMirrorWrite,
    subscribePtyMirrorReset
  } = usePtyBridge();
  const hostRef = useRef<HTMLDivElement>(null);

  const headlessBody =
    headlessStdout?.trim() ||
    (headlessError?.trim()
      ? `(no terminal output captured)\n\nSummary: ${headlessError.trim()}`
      : '(no terminal output captured)');

  useEffect(() => {
    if (!livePtyMirror) return;
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      scrollback: 50_000,
      theme: {
        background: '#030712',
        foreground: '#f3f4f6',
        cursor: '#4ade80',
        selectionBackground: '#374151'
      },
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowProposedApi: true
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    fitAddon.fit();

    const replay = () => {
      const buf = peekPtyTranscriptBuffer();
      term.reset();
      fitAddon.fit();
      /**
       * Only replay the rolling **raw** PTY capture. Pretty’s merged plain buffer is ANSI-free; feeding it here
       * then streaming live escape sequences corrupts cursor state (fragmented Ink UI), especially at session start
       * when merged history can be longer than the byte buffer.
       */
      if (buf.length > 0) {
        term.write(buf);
      }
    };
    replay();

    const unsubWrite = subscribePtyMirrorWrite((chunk) => {
      term.write(chunk);
    });
    const unsubReset = subscribePtyMirrorReset(() => {
      replay();
    });

    term.onData((data) => {
      sendToPty(data);
    });

    const ro = new ResizeObserver(() => {
      fitAddon.fit();
    });
    ro.observe(host);

    const focusTerm = () => {
      term.focus();
      term.textarea?.focus();
    };
    host.addEventListener('pointerdown', focusTerm, true);

    return () => {
      host.removeEventListener('pointerdown', focusTerm, true);
      ro.disconnect();
      unsubWrite();
      unsubReset();
      term.dispose();
      host.innerHTML = '';
    };
  }, [livePtyMirror, peekPtyTranscriptBuffer, sendToPty, subscribePtyMirrorReset, subscribePtyMirrorWrite]);

  return (
    <div className="rounded-2xl border border-gray-800 bg-[#0c0c0c] shadow-inner overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a1a] border-b border-gray-800 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {livePtyMirror ? (
            <div className="flex gap-1.5 shrink-0">
              <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
              <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
            </div>
          ) : null}
          <span className="text-[10px] font-mono text-gray-400 uppercase tracking-widest truncate">
            {!livePtyMirror && mergeHeadless
              ? 'Saved run (raw)'
              : mergeHeadless
                ? 'PTY (Logon) + last claude -p capture'
                : 'Interactive PTY (same session as Logon)'}
          </span>
        </div>
        {livePtyMirror ? (
          <button
            type="button"
            onClick={() => clearLiveTranscript()}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 shrink-0"
          >
            From here only
          </button>
        ) : (
          <div className="w-12 shrink-0" aria-hidden />
        )}
      </div>
      <p className="text-[11px] text-gray-500 px-4 py-2 bg-[#111] border-b border-gray-800 leading-relaxed">
        {livePtyMirror ? (
          <>
            xterm.js is driven by the same <strong>raw PTY stream</strong> as Logon (ANSI and cursor control preserved).
            This mirror only replays that byte buffer, not the merged plain buffer from Pretty Output, so the layout stays aligned
            with Logon at cold start. <strong>From here only</strong> clears the byte buffer and resets this mirror; use
            Pretty Output for long merged scrollback after scrollback trims.
            {mergeHeadless ? (
              <>
                {' '}
                The <strong>first</strong> block (when present) is the latest dashboard{' '}
                <code className="text-[10px] text-gray-400">claude -p</code> capture (read-only). The dark terminal below
                is the live PTY only. If Logon just restarted at <strong>Welcome back</strong>, only what you type in
                Logon / Raw (live tail) applies — generic “yes” does not answer the gray read-only block above.
              </>
            ) : null}
          </>
        ) : (
          <>Read-only capture from History — open the Dashboard to use the live PTY.</>
        )}
      </p>
      {mergeHeadless ? (
        <>
          <div
            className="flex items-center gap-2 px-3 py-2 bg-[#0a0a0a] border-t border-gray-800 text-[10px] font-mono text-gray-500 uppercase tracking-widest"
            role="separator"
            aria-label="Headless run output"
          >
            <span className="text-gray-600 select-none" aria-hidden>
              ──
            </span>
            <span>Last claude -p (buffered run)</span>
          </div>
          <pre className="m-0 px-4 py-4 md:px-6 md:py-5 text-xs md:text-sm font-mono text-gray-300 overflow-auto max-h-[min(45vh,480px)] min-h-[80px] leading-relaxed whitespace-pre-wrap break-words border-t border-gray-900 bg-[#050505]">
            {headlessBody}
          </pre>
        </>
      ) : null}
      {livePtyMirror ? (
        <div
          ref={hostRef}
          className={`px-2 py-2 overflow-hidden max-h-[min(55vh,560px)] min-h-[200px] ${mergeHeadless ? 'border-t border-gray-800' : ''}`}
          title="Focus the terminal to type. Same PTY as Logon."
        />
      ) : null}
    </div>
  );
}

type PtyReplyPanelProps = {
  /** Finished headless output in Pretty looks like a Fetch/permission ask — Reply still targets the live PTY only. */
  warnHeadlessMenuReadOnly?: boolean;
  warnWelcomeSplash?: boolean;
  /** Live PTY tail looks like a numbered Ink menu — show how to answer reliably. */
  showNumberedMenuHint?: boolean;
  /** Plain transcript Pretty shows (same normalization as the thread) — snapshot length anchors bubbles. */
  replyOrderingPlain: string;
  onReplySent?: (payload: {
    text: string;
    sentAt: number;
    transcriptLenAtSend: number;
    choiceMenuSnapshot?: string | null;
  }) => void;
};

function PtyReplyPanel({
  warnHeadlessMenuReadOnly = false,
  warnWelcomeSplash = false,
  showNumberedMenuHint = false,
  replyOrderingPlain,
  onReplySent
}: PtyReplyPanelProps) {
  const { sendToPty, ptySessionReady } = usePtyBridge();
  const [text, setText] = useState('');
  const [appendEnter, setAppendEnter] = useState(true);
  const [hint, setHint] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [sending, setSending] = useState(false);

  const handleSend = () => {
    /** Only CRLF → LF; no trim — send exactly what is in the field (spaces, digits, words). */
    const normalized = text.replace(/\r\n/g, '\n');
    const sentAt = Date.now();
    if (normalized.length === 0 && !appendEnter) {
      setHint({ message: 'Type a reply first.', type: 'info' });
      return;
    }
    if (!ptySessionReady) {
      setHint({
        message: 'PTY is not ready (Connecting…). Wait for the dot in the header to turn green.',
        type: 'error'
      });
      return;
    }

    const transcriptLenAtSend = getPtyParseNormalizedPlain(replyOrderingPlain).length;
    const choiceMenuSnapshot = extractLastChoiceMenuSnapshotForArchive(replyOrderingPlain);

    setSending(true);
    setHint(null);

    /**
     * Claude Code Ink “1. Yes” lists read the digit, not the letters y-e-s. Send `1` to the PTY when the
     * field is only “yes” (trimmed, case-insensitive); bubbles still record what they typed.
     */
    const forPty = normalized.trim().toLowerCase() === 'yes' ? '1' : normalized;

    const afterDelivered = () => {
      setHint({ message: 'Sent to the interactive PTY.', type: 'success' });
      if (normalized.length > 0) {
        onReplySent?.({ text: normalized, sentAt, transcriptLenAtSend, choiceMenuSnapshot });
      }
      setText('');
      setTimeout(() => setHint((h) => (h?.type === 'success' ? null : h)), 4000);
      setSending(false);
    };

    /**
     * Ink / Claude Code list prompts often ignore one big WebSocket write (unlike Logon xterm, which
     * sends one message per key). Replay one character at a time; lone “yes” uses `forPty` (`1`).
     */
    const tryDeliver = async (): Promise<boolean> => {
      const interKeyMs = 22;
      const beforeCrMs = 95;
      const bulkBeforeCrMs = 220;
      const flatLen = forPty.replace(/\n/g, '').length;
      const shortEnough = flatLen <= 512;

      if (forPty.length > 0 && shortEnough) {
        for (const ch of forPty) {
          const out = ch === '\n' ? '\r' : ch;
          if (!sendToPty(out)) return false;
          await new Promise<void>((r) => setTimeout(r, interKeyMs));
        }
        if (appendEnter) {
          await new Promise<void>((r) => setTimeout(r, beforeCrMs));
          return sendToPty('\r');
        }
        return true;
      }

      let bulk = forPty.replace(/\n/g, '\r');
      if (appendEnter && !bulk.endsWith('\r')) {
        bulk += '\r';
      }
      if (!bulk) {
        return true;
      }
      if (appendEnter && forPty.length > 0 && !shortEnough) {
        const body = forPty.replace(/\n/g, '\r');
        if (!sendToPty(body)) return false;
        await new Promise<void>((r) => setTimeout(r, bulkBeforeCrMs));
        return sendToPty('\r');
      }
      return sendToPty(bulk);
    };

    void (async () => {
      try {
        let ok = await tryDeliver();
        if (!ok) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
          ok = await tryDeliver();
        }
        if (!ok) {
          await new Promise<void>((r) => setTimeout(r, 120));
          ok = await tryDeliver();
        }
        if (!ok) {
          setHint({
            message:
              'Could not send to the PTY (socket not open yet). Wait a moment and try again, or open Logon to confirm the terminal is connected.',
            type: 'error'
          });
          setSending(false);
          return;
        }
        afterDelivered();
      } catch (err) {
        setHint({ message: `Failed to send: ${String(err)}`, type: 'error' });
        setSending(false);
      }
    })();
  };

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5 space-y-3 shadow-inner">
      <h4 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
        <Send size={16} className="text-indigo-600 shrink-0" aria-hidden />
        Reply via interactive PTY
      </h4>
      
      {warnHeadlessMenuReadOnly && (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-600" />
          <p className="leading-relaxed">
            The finished <strong>Fetch</strong> block above is read-only. Answer only if a <strong>live numbered menu</strong> is visible in the bubble below (or the terminal in Logon).
          </p>
        </div>
      )}

      {warnWelcomeSplash && (
        <div className="text-xs text-slate-800 bg-white border border-slate-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <TerminalIcon size={14} className="shrink-0 mt-0.5 text-slate-500" />
          <p className="leading-relaxed">
            PTY is idling at <strong>Welcome back</strong>. Replies only apply when the live session is waiting for input — describe your goal or switch to <strong>Logon</strong>.
          </p>
        </div>
      )}

      {showNumberedMenuHint && (
        <div className="text-xs text-indigo-950 bg-indigo-50/90 border border-indigo-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5 text-indigo-600" aria-hidden />
          <p className="leading-relaxed">
            <strong>Numbered menu (❯ 1. Yes …):</strong> You can type <code className="text-[11px] px-1 rounded bg-white/80">yes</code> — we send <code className="text-[11px] px-1 rounded bg-white/80">1</code> to Ink for you (bubble still shows “yes”). Or type <code className="text-[11px] px-1 rounded bg-white/80">1</code>, or leave the box empty with{' '}
            <strong>Append Enter</strong> for Enter on the highlighted row. Raw / Logon may not echo every character.
          </p>
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (hint) setHint(null);
        }}
        rows={4}
        spellCheck={false}
        placeholder="Sent as typed (CRLF→LF). Lone “yes” → 1 for Ink menus. Short lines one key per message; empty + Append Enter = Enter."
        className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-y font-mono"
      />
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-indigo-900 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={appendEnter}
            onChange={(e) => setAppendEnter(e.target.checked)}
            className="rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
          />
          Append Enter (↵) after text
        </label>
        
        <button
          type="button"
          onClick={handleSend}
          disabled={!ptySessionReady || sending}
          className="inline-flex items-center justify-center gap-2 px-6 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
        >
          {sending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} aria-hidden />
          )}
          Send to PTY
        </button>
      </div>

      <AnimatePresence>
        {hint && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={`text-xs font-medium px-1 ${
              hint.type === 'error' ? 'text-red-600' : hint.type === 'success' ? 'text-emerald-600' : 'text-indigo-800'
            }`}
          >
            {hint.message}
          </motion.p>
        )}
      </AnimatePresence>

      {!ptySessionReady && !sending && (
        <p className="text-xs text-amber-700 bg-amber-50/50 rounded-lg px-3 py-2 border border-amber-100">
          PTY Connecting… Open <strong>Logon</strong> to check the terminal state. 
          Sending input requires an active WebSocket.
        </p>
      )}
    </div>
  );
}

/** Shows a short “Receiving…” pulse while PTY narrative text is changing. */
function PtyNarrativeLiveBadge({ rawOutput, executing }: { rawOutput: string; executing: boolean }) {
  const [receiving, setReceiving] = useState(false);
  const timerRef = useRef<number | null>(null);
  const prevOutRef = useRef<string | null>(null);

  useEffect(() => {
    if (rawOutput === prevOutRef.current) return;
    prevOutRef.current = rawOutput;
    setReceiving(true);
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setReceiving(false);
    }, 1200);
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [rawOutput]);

  const showPulse = receiving || executing;
  const label = receiving ? 'Receiving…' : executing ? 'Claude is Thinking…' : 'Live';

  return (
    <span className="inline-flex items-center gap-1.5 shrink-0 text-[11px] font-semibold text-emerald-900">
      {showPulse ? (
        <>
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
          </span>
          <span className="tabular-nums animate-pulse">{label}</span>
        </>
      ) : (
        <span className="text-emerald-800/85">Live</span>
      )}
    </span>
  );
}


type PrettyOutputMode = 'headless' | 'pty' | 'both';

/**
 * Append the latest Command Runner (`claude -p`) turn after the live PTY transcript so Pretty order matches
 * real time (PTY first, then dashboard run). Auto-scroll stays at the bottom, so prepending hid new output above.
 */
function appendDashboardRunAsPtyPlain(ptyHead: string, userSummary: string, assistantRaw: string): string {
  const u = userSummary.replace(/\r\n/g, '\n').trim();
  const a = assistantRaw.replace(/\r\n/g, '\n').trim();
  const runParts: string[] = [];
  if (u) runParts.push(`❯ ${u}`);
  if (a) runParts.push(a);
  const runBlock = runParts.join('\n\n');
  const head = ptyHead.replace(/\r\n/g, '\n').trim();
  if (!runBlock) return head;
  if (!head) return runBlock;
  return `${head}\n\n${runBlock}`;
}

function buildPtyForDisplayPlain(opts: {
  prettyMode: 'headless' | 'pty' | 'both';
  ptyForPretty: string;
  headlessResult: RunResponse | null;
  lastRunThreadMeta: { threadKey: string; userSummary: string } | null;
  chatThreadKey: string;
}): string {
  const { prettyMode, ptyForPretty, headlessResult, lastRunThreadMeta, chatThreadKey } = opts;
  if (
    prettyMode !== 'both' ||
    !headlessResult ||
    !lastRunThreadMeta ||
    lastRunThreadMeta.threadKey !== chatThreadKey
  ) {
    return ptyForPretty;
  }
  const cleaned = sanitizeRunOutputForChat(headlessResult.rawOutput ?? '').trim();
  const err = headlessResult.error?.trim();
  const assistant = cleaned || (err ? `Error: ${err}` : '') || '(no output captured)';
  if (!assistant.trim() && !lastRunThreadMeta.userSummary.trim()) return ptyForPretty;
  return appendDashboardRunAsPtyPlain(ptyForPretty, lastRunThreadMeta.userSummary, assistant);
}

function PrettyOutputView({
  prettyMode,
  ptyTranscript,
  liveFooterPlainSource = '',
  chatHistoryTick = 0,
  chatThreadKey,
  lastRunThreadMeta = null,
  headlessResult = null,
  ptySessionReady,
  ptySentAt = null,
  isLoading = false,
  manualReplyBubbles = [],
  archivedChoiceMenus = []
}: {
  prettyMode: PrettyOutputMode;
  ptyTranscript: string;
  /** Logon xterm “display” slice — updates every rAF with PTY chunks; fresher than merged archive for footer. */
  liveFooterPlainSource?: string;
  chatHistoryTick?: number;
  chatThreadKey: string;
  lastRunThreadMeta?: { threadKey: string; userSummary: string } | null;
  headlessResult?: RunResponse | null;
  ptySessionReady?: boolean;
  ptySentAt?: number | null;
  isLoading?: boolean;
  manualReplyBubbles?: { id: string; text: string; sentAt: number; transcriptLenAtSend: number }[];
  archivedChoiceMenus?: PtyArchivedChoiceMenu[];
}) {
  /** Splash + spinner lines hidden here only; Logon / Raw stay full-fidelity. */
  const ptyForPretty = useMemo(() => {
    const s = sanitizePtyPrettyTranscript(ptyTranscript);
    if (!s.trim() && ptyTranscript.trim()) return ptyTranscript;
    return s;
  }, [ptyTranscript]);

  /** Command Runner output is not in the Logon xterm; append it after PTY here when both panes are shown for this topic. */
  const ptyForDisplay = useMemo(
    () =>
      buildPtyForDisplayPlain({
        prettyMode,
        ptyForPretty,
        headlessResult,
        lastRunThreadMeta,
        chatThreadKey
      }),
    [prettyMode, ptyForPretty, headlessResult, lastRunThreadMeta, chatThreadKey]
  );

  useEffect(() => {
    if (prettyMode === 'headless') return;
    if (!ptyTranscript?.trim()) return;
    const id = window.setTimeout(() => {
      syncPrettyPtyTranscriptToDashboardThread(chatThreadKey, ptyForPretty);
    }, 750);
    return () => window.clearTimeout(id);
  }, [prettyMode, chatThreadKey, ptyForPretty, ptyTranscript]);

  // Show the temporary banner if we're in a loading state and the assistant hasn't replied with any real text yet.
  const isRecentSent = ptySentAt != null && Date.now() - ptySentAt < 15000;
  const showSentWaiting = isLoading && isRecentSent && (!ptyForDisplay.trim() || ptyForDisplay.trim() === ptyTranscript.trim());
  const isPtyActivelyExecuting = useMemo(() => {
    if (!ptyTranscript.trim()) return isLoading;
    return isAwaitingPtyAssistantResponse(parsePtyTranscriptToMessages(ptyTranscript));
  }, [ptyTranscript, isLoading]);


  const emptySection = showSentWaiting ? (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-5 py-6 flex items-start gap-4 shadow-sm animate-pulse">
      <div className="relative flex h-3 w-3 shrink-0 mt-1">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-50" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-indigo-600" />
      </div>
      <div>
        <p className="text-sm font-semibold text-indigo-950">Executing...</p>
        <p className="text-xs text-indigo-800/80 mt-1 leading-relaxed">
          Claude is processing your command in the interactive session. 
          Real-time updates are visible in <strong>Raw View</strong>.
        </p>
      </div>
    </div>
  ) : (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
      No conversation yet — run a command above, or type in <strong>Logon</strong> / <strong>Reply via PTY</strong> below.
    </div>
  );


  const ptySection =
    ptyForDisplay.trim().length > 0 ? (
      <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-emerald-900/90 px-2 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100">
          <span>
            <strong>Interactive PTY (Pretty)</strong>: hides splash and short spinner lines. While work is in
            progress, the <strong>dark status bar</strong> under the thread mirrors Raw (timer, tokens, thinking) and
            disappears once substantive <code className="text-[10px] font-mono bg-emerald-950/10 px-1 rounded">●</code>{' '}
            output reaches the PTY tail. Full fidelity stays in <strong>Logon</strong> / <strong>Raw</strong>. Reply
            below uses the same session.
          </span>
          <PtyNarrativeLiveBadge rawOutput={ptyForDisplay} executing={isPtyActivelyExecuting} />
        </div>
        <PtyMessengerThread
          transcript={ptyForDisplay}
          awaitingHintSource={ptyTranscript}
          liveFooterPlainSource={liveFooterPlainSource}
          manualReplyBubbles={manualReplyBubbles}
          archivedChoiceMenus={archivedChoiceMenus}
        />
      </>
    ) : (
      emptySection
    );

  if (prettyMode === 'headless') {
    // Hidden per user request
    return null;
  }

  return <div className="space-y-3">{ptySection}</div>;
}
