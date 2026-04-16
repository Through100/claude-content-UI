import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { mergePtyPlainArchive } from '../../shared/mergePtyPlainArchive';
import { sanitizePtyPrettyTranscript } from '../../shared/sanitizePtyPrettyTranscript';
import { loadPtyPrettyArchive, savePtyPrettyArchive } from '../lib/ptyPrettyArchiveStorage';
import {
  FileText,
  Terminal as TerminalIcon,
  Copy,
  Download,
  FileDown,
  Send
} from 'lucide-react';
import { BLOG_COMMANDS, RunResponse } from '../types';
import { formatChatThreadKey, sanitizeRunOutputForChat } from '../lib/dashboardChatHistory';
import { syncPrettyPtyTranscriptToDashboardThread } from '../lib/syncPtyTranscriptToDashboardChat';
import { motion, AnimatePresence } from 'motion/react';
import { inferClaudeActivity } from '../../shared/inferClaudeActivity';
import { downloadElementAsPdf } from '../utils/downloadReportPdf';
import { usePtyBridge } from '../context/PtyBridgeContext';
import PtyMessengerThread from './PtyMessengerThread';
import DashboardHeadlessChat from './DashboardHeadlessChat';
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
  /** Bump after each headless run completes so Pretty reloads saved conversation from localStorage. */
  chatHistoryTick?: number;
  /** Headless Pretty conversation thread = blog command key + target (matches Command Runner). */
  chatThreadKey?: string;
  /** Latest finished Command Runner line + thread key so Live PTY Pretty can show the `claude -p` turn (not in the xterm buffer). */
  lastRunThreadMeta?: { threadKey: string; userSummary: string } | null;
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
  chatHistoryTick = 0,
  chatThreadKey = formatChatThreadKey(BLOG_COMMANDS[0].key, ''),
  lastRunThreadMeta = null
}: ResultsViewProps) {
  const [activeTab, setActiveTab] = useState<'pretty' | 'raw'>('pretty');
  const [pdfExporting, setPdfExporting] = useState(false);
  const livePreRef = useRef<HTMLPreElement>(null);
  const prettyReportRef = useRef<HTMLDivElement>(null);
  const pdfAfterPrettySwitchRef = useRef(false);
  const { ptyDisplayPlain, ptyFullSnapshotPlain, ptySessionGeneration } = usePtyBridge();

  /** Merged PTY transcript: grows with new terminal output and survives scrollback trimming; saved per topic. */
  const [ptyMergedArchive, setPtyMergedArchive] = useState(() => loadPtyPrettyArchive(chatThreadKey));
  const ptyArchiveAnchorRef = useRef('');
  /** When the Logon WebSocket reconnects, avoid merging a long saved transcript with a short new buffer (Pretty would miss the first exchange). */
  const ptyPrevSessionGenerationRef = useRef<number | null>(null);

  useEffect(() => {
    const nextAnchor = `${chatThreadKey}|${ptySessionGeneration}`;
    const anchorChanged = nextAnchor !== ptyArchiveAnchorRef.current;
    ptyArchiveAnchorRef.current = nextAnchor;

    const prevGen = ptyPrevSessionGenerationRef.current;
    const ptySessionRestarted = prevGen !== null && ptySessionGeneration !== prevGen;
    ptyPrevSessionGenerationRef.current = ptySessionGeneration;

    setPtyMergedArchive((prev) => {
      let base: string;
      if (ptySessionRestarted) {
        base = '';
      } else if (anchorChanged) {
        base = loadPtyPrettyArchive(chatThreadKey);
      } else {
        base = prev;
      }
      return mergePtyPlainArchive(base, ptyFullSnapshotPlain);
    });
  }, [chatThreadKey, ptySessionGeneration, ptyFullSnapshotPlain]);

  useEffect(() => {
    if (!ptyMergedArchive.trim()) return;
    const id = window.setTimeout(() => savePtyPrettyArchive(chatThreadKey, ptyMergedArchive), 500);
    return () => window.clearTimeout(id);
  }, [chatThreadKey, ptyMergedArchive]);

  const hasFreshPtyCapture =
    ptyDisplayPlain.trim().length > 0 || ptyFullSnapshotPlain.trim().length > 0;
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

  if (isLoading) {
    const elapsedMs = loadingStartedAt != null ? Date.now() - loadingStartedAt : 0;
    const showLongRunHint = elapsedMs > 40_000;

    return (
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
              ) : (
                <p className="text-sm text-gray-500">Waiting for the first bytes from Claude…</p>
              )}
              {showLongRunHint ? (
                <p className="text-xs text-amber-800/90 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 max-w-lg">
                  Long blog skill runs can take several minutes. If the timer above keeps increasing and the terminal
                  scrolls, the run is still active—not frozen.
                </p>
              ) : null}
            </div>

            <p className="text-xs text-gray-400 mt-4 max-w-lg mx-auto">
              Uses <code className="bg-gray-100 px-1 rounded">/api/run/stream</code>. Ensure the API is running; set{' '}
              <code className="bg-gray-100 px-1 rounded">VITE_RUN_STREAM=0</code> to fall back to buffered{' '}
              <code className="bg-gray-100 px-1 rounded">/api/run</code> if your proxy blocks streaming.
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
    );
  }

  if (!result) {
    return (
      <div className="space-y-8">
        <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
            <FileText className="text-gray-400" size={32} />
          </div>
          <h3 className="text-lg font-medium text-gray-900">No headless run yet</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto mt-2">
            Run a command above for <code className="text-xs bg-gray-100 px-1 rounded">claude -p</code> output, or use
            the live PTY stream below (same session as Logon).
          </p>
        </div>
        <LivePtyRawMirror />
        {ptyMergedArchive.trim() ? (
          <PrettyOutputView
            key={`pty-pretty-empty-run-${chatThreadKey}`}
            prettyMode="pty"
            ptyTranscript={ptyMergedArchive}
            chatHistoryTick={chatHistoryTick}
            chatThreadKey={chatThreadKey}
            lastRunThreadMeta={lastRunThreadMeta}
          />
        ) : null}
        <PtyReplyPanel hasCompletedHeadlessRun={false} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
              <PrettyOutputView
                key={`pretty-${prettyMode}-${chatThreadKey}`}
                prettyMode={prettyMode}
                ptyTranscript={ptyMergedArchive}
                chatHistoryTick={chatHistoryTick}
                chatThreadKey={chatThreadKey}
                lastRunThreadMeta={lastRunThreadMeta}
                headlessResult={result}
              />
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
              headlessStdout={result.rawOutput ?? ''}
              headlessError={result.error ?? ''}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <PtyReplyPanel hasCompletedHeadlessRun />
    </div>
  );
}

type LivePtyRawMirrorProps = {
  /** When provided, last `claude -p` capture is shown below the PTY in the same card (no separate panel). */
  headlessStdout?: string;
  headlessError?: string;
};

function LivePtyRawMirror({ headlessStdout, headlessError }: LivePtyRawMirrorProps = {}) {
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
      if (buf) term.write(buf);
    };
    replay();

    const unsubWrite = subscribePtyMirrorWrite((chunk) => {
      term.write(chunk);
    });
    const unsubReset = subscribePtyMirrorReset(() => {
      term.reset();
      fitAddon.fit();
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
  }, [peekPtyTranscriptBuffer, sendToPty, subscribePtyMirrorReset, subscribePtyMirrorWrite]);

  return (
    <div className="rounded-2xl border border-gray-800 bg-[#0c0c0c] shadow-inner overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a1a] border-b border-gray-800 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex gap-1.5 shrink-0">
            <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
            <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
          </div>
          <span className="text-[10px] font-mono text-gray-400 uppercase tracking-widest truncate">
            {mergeHeadless
              ? 'PTY (Logon) + last claude -p capture'
              : 'Interactive PTY (same session as Logon)'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => clearLiveTranscript()}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 shrink-0"
        >
          From here only
        </button>
      </div>
      <p className="text-[11px] text-gray-500 px-4 py-2 bg-[#111] border-b border-gray-800 leading-relaxed">
        xterm.js fed from the same WebSocket PTY as Logon — type here or on Logon. <strong>From here only</strong>{' '}
        resets this panel’s slice and the Raw byte buffer from new output onward; it does not clear Logon. Pretty
        Output still keeps a merged transcript (and localStorage for this command + target) so earlier turns usually
        stay scrollable there.
        {mergeHeadless ? (
          <>
            {' '}
            The <strong>first</strong> block (when present) is the latest dashboard{' '}
            <code className="text-[10px] text-gray-400">claude -p</code> capture (read-only). The dark terminal below
            is the live PTY only.
          </>
        ) : null}
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
      <div
        ref={hostRef}
        className={`px-2 py-2 overflow-hidden max-h-[min(55vh,560px)] min-h-[200px] ${mergeHeadless ? 'border-t border-gray-800' : ''}`}
        title="Focus the terminal to type. Same PTY as Logon."
      />
    </div>
  );
}

function PtyReplyPanel({ hasCompletedHeadlessRun = false }: { hasCompletedHeadlessRun?: boolean }) {
  const { sendToPty, ptySessionReady } = usePtyBridge();
  const [text, setText] = useState('');
  const [appendEnter, setAppendEnter] = useState(true);
  const [hint, setHint] = useState<string | null>(null);

  const handleSend = () => {
    const t = text.trim();
    if (!t) {
      setHint('Type a reply first (e.g. answers to Claude’s questions).');
      return;
    }
    if (!ptySessionReady) {
      setHint('PTY is not ready yet. Wait for the session to connect, or open Logon and check the terminal.');
      return;
    }
    sendToPty(appendEnter ? `${t}\r` : t);
    setHint(
      'Sent to the same PTY as Logon. Pretty Output merges the full PTY buffer for this topic (saved in the browser) so earlier lines stay in the conversation — scroll up in Pretty or use Raw / Logon.'
    );
    setText('');
  };

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5 space-y-3">
      <h4 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
        <Send size={16} className="text-indigo-600 shrink-0" aria-hidden />
        Reply via interactive PTY
      </h4>
      {hasCompletedHeadlessRun ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2.5 text-xs text-amber-950 leading-relaxed">
          <strong className="font-semibold">Headless vs PTY:</strong> Command Runner uses{' '}
          <code className="text-[10px] bg-white/80 px-1 rounded">claude -p</code> — a new process per run that exits
          when done, so there is <strong>no open stdin</strong> to send <code className="text-[10px]">1</code> back to
          that transcript. The box below is a <strong>different</strong> interactive Claude (same WebSocket PTY as
          Logon). To answer a multiple-choice prompt you saw in Pretty Output, either paste the full question plus your
          choice into <strong>Logon</strong> / this PTY if you started that work there, or run the command again with
          your selection in the target field.
        </div>
      ) : null}
      <p className="text-xs text-indigo-900/85 leading-relaxed">
        Sends keystrokes to the <strong>same</strong> persistent PTY as Logon — not to any finished{' '}
        <code className="bg-white/70 px-1 rounded text-[11px]">claude -p</code> run. <strong>Raw View</strong> mirrors
        that PTY; <strong>Pretty Output</strong> can show the live PTY transcript when it has focus. Open{' '}
        <strong>Logon</strong> for the primary terminal layout.
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (hint) setHint(null);
        }}
        rows={4}
        spellCheck={false}
        placeholder="e.g. Answers: 1) Beginners 2) How-to guide 3) ~2000 words 4) Markdown"
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
          disabled={!ptySessionReady}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          <Send size={16} aria-hidden />
          Send to PTY
        </button>
      </div>
      {!ptySessionReady ? (
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Waiting for the PTY WebSocket session (starts automatically when the app loads). If this persists, open{' '}
          <strong>Logon</strong> and confirm the terminal is not showing an error.
        </p>
      ) : null}
      {hint ? <p className="text-xs text-indigo-800 font-medium">{hint}</p> : null}
    </div>
  );
}

/** Shows a short “Receiving…” pulse while PTY narrative text is changing. */
function PtyNarrativeLiveBadge({ rawOutput }: { rawOutput: string }) {
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
    }, 900);
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [rawOutput]);

  return (
    <span className="inline-flex items-center gap-1.5 shrink-0 text-[11px] font-semibold text-emerald-900">
      {receiving ? (
        <>
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
          </span>
          <span className="tabular-nums animate-pulse">Receiving…</span>
        </>
      ) : (
        <span className="text-emerald-800/85">Live</span>
      )}
    </span>
  );
}

type PrettyOutputMode = 'headless' | 'pty' | 'both';

/** Synthesize a PTY-shaped transcript so Pretty uses the same `❯` parser as Logon-only lines. */
function prependDashboardRunAsPtyPlain(userSummary: string, assistantRaw: string, ptyTail: string): string {
  const u = userSummary.replace(/\r\n/g, '\n').trim();
  const a = assistantRaw.replace(/\r\n/g, '\n').trim();
  const headParts: string[] = [];
  if (u) headParts.push(`❯ ${u}`);
  if (a) headParts.push(a);
  const head = headParts.join('\n\n');
  const tail = ptyTail.replace(/\r\n/g, '\n').trim();
  if (!head) return tail;
  if (!tail) return head;
  return `${head}\n\n${tail}`;
}

function PrettyOutputView({
  prettyMode,
  ptyTranscript,
  chatHistoryTick = 0,
  chatThreadKey,
  lastRunThreadMeta = null,
  headlessResult = null
}: {
  prettyMode: PrettyOutputMode;
  ptyTranscript: string;
  chatHistoryTick?: number;
  chatThreadKey: string;
  lastRunThreadMeta?: { threadKey: string; userSummary: string } | null;
  headlessResult?: RunResponse | null;
}) {
  /** Splash + spinner lines hidden here only; Logon / Raw stay full-fidelity. */
  const ptyForPretty = useMemo(() => {
    const s = sanitizePtyPrettyTranscript(ptyTranscript);
    if (!s.trim() && ptyTranscript.trim()) return ptyTranscript;
    return s;
  }, [ptyTranscript]);

  /** Command Runner output is not in the Logon xterm; prepend it here when both panes are shown for this topic. */
  const ptyForDisplay = useMemo(() => {
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
    return prependDashboardRunAsPtyPlain(lastRunThreadMeta.userSummary, assistant, ptyForPretty);
  }, [prettyMode, headlessResult, lastRunThreadMeta, chatThreadKey, ptyForPretty]);

  useEffect(() => {
    if (prettyMode === 'headless') return;
    if (!ptyTranscript?.trim()) return;
    const id = window.setTimeout(() => {
      syncPrettyPtyTranscriptToDashboardThread(chatThreadKey, ptyForPretty);
    }, 750);
    return () => window.clearTimeout(id);
  }, [prettyMode, chatThreadKey, ptyForPretty, ptyTranscript]);

  const ptySection =
    ptyForDisplay.trim().length > 0 ? (
      <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-emerald-900/90 px-2 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100">
          <span>
            Live PTY (Pretty): hides the Claude Code welcome chrome and short “thinking” lines (e.g. ✻ Undulating…).
            Full terminal stays in <strong>Logon</strong> / <strong>Raw</strong>. When a dashboard{' '}
            <code className="text-[10px] font-mono bg-emerald-950/10 px-1 rounded">claude -p</code> run exists for this
            topic, its first turn is prepended here (the PTY never receives that spawn). Merged buffer + local save per
            command + target as before.
          </span>
          <PtyNarrativeLiveBadge rawOutput={ptyForDisplay} />
        </div>
        <PtyMessengerThread transcript={ptyForDisplay} />
      </>
    ) : (
      <p className="text-sm text-gray-500 px-1">No PTY output yet — open Logon or send a reply below.</p>
    );

  if (prettyMode === 'headless') {
    return <DashboardHeadlessChat threadKey={chatThreadKey} refreshKey={chatHistoryTick} />;
  }

  if (prettyMode === 'pty') {
    return <div className="space-y-3">{ptySection}</div>;
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 px-1">
          Dashboard run (<code className="text-[10px] font-mono bg-gray-100 px-1 rounded">claude -p</code>)
        </p>
        <DashboardHeadlessChat threadKey={chatThreadKey} refreshKey={chatHistoryTick} />
      </section>
      <section className="space-y-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-900 px-1">Live PTY (Logon)</p>
        {ptySection}
      </section>
    </div>
  );
}
