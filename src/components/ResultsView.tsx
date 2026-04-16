import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  FileText,
  Terminal as TerminalIcon,
  Copy,
  Download,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  Info,
  ExternalLink,
  FileDown,
  Send
} from 'lucide-react';
import {
  Finding,
  IssuesBySeverity,
  ParsedReport,
  ReportSection,
  RunResponse,
  RunStats,
  Severity
} from '../types';
import { AuditMarkdownSections, hasVisibleAuditNarrative } from './AuditMarkdown';
import { motion, AnimatePresence } from 'motion/react';
import { GENERIC_FINDING_RECOMMENDATION, parseSeoOutput } from '../../shared/parseSeoOutput';
import { inferClaudeActivity } from '../../shared/inferClaudeActivity';
import { downloadElementAsPdf } from '../utils/downloadReportPdf';
import { usePtyBridge } from '../context/PtyBridgeContext';
import PtyMessengerThread from './PtyMessengerThread';
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
}

const ZERO_ISSUES: IssuesBySeverity = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  passed: 0
};

const EMPTY_PARSED_REPORT: ParsedReport = {
  summary: {
    overallScore: 0,
    status: 'Unknown',
    highPriorityIssues: 0,
    issuesBySeverity: { ...ZERO_ISSUES },
    categories: []
  },
  sections: []
};

function FindingDetailsExpand({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);

  const rows: { key: string; label: string; value: string }[] = [];
  if (finding.issueDetail?.trim()) {
    rows.push({ key: 'issue', label: 'Issue', value: finding.issueDetail.trim() });
  }
  if (finding.impact?.trim()) {
    rows.push({ key: 'impact', label: 'Impact', value: finding.impact.trim() });
  }
  if (finding.fix?.trim()) {
    rows.push({ key: 'fix', label: 'Fix', value: finding.fix.trim() });
  }
  if (finding.example?.trim()) {
    rows.push({ key: 'example', label: 'Example', value: finding.example.trim() });
  }

  const isGenericRec = finding.recommendation === GENERIC_FINDING_RECOMMENDATION;
  if (rows.length === 0 && !isGenericRec && finding.recommendation?.trim()) {
    rows.push({
      key: 'recommendation',
      label: 'Recommendation',
      value: finding.recommendation.trim(),
    });
  }
  if (rows.length === 0 && finding.detailNotes?.trim()) {
    rows.push({ key: 'notes', label: 'Details', value: finding.detailNotes.trim() });
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-indigo-900/70 leading-relaxed">
        No structured Issue / Impact / Fix / Example bullets were detected. Check the raw output tab for the full
        text.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-semibold text-indigo-900 hover:bg-indigo-50/80 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Info size={16} className="text-indigo-600 shrink-0" />
          <span className="truncate">{open ? 'Hide details' : 'Show details'}</span>
        </span>
        <ChevronRight
          className={`shrink-0 text-indigo-600 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          size={18}
          aria-hidden
        />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-0 space-y-4 border-t border-indigo-100/80">
          {rows.map((row) => (
            <div key={row.key}>
              <p className="text-xs font-bold uppercase tracking-wide text-indigo-800/90">{row.label}</p>
              <p className="text-sm text-indigo-950 leading-relaxed mt-1 whitespace-pre-wrap">{row.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function hasParsedScorecard(report: ParsedReport): boolean {
  if (report.summary.overallScore > 0) return true;
  if (report.summary.categories && report.summary.categories.length > 0) return true;
  if (report.rawSummary && report.rawSummary.trim().length > 0) return true;
  if (report.sections.some((s) => s.findings && s.findings.length > 0)) return true;
  return false;
}

function formatElapsed(startedAt: number) {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

export default function ResultsView({ result, isLoading, loadingStartedAt, liveTerminal = '' }: ResultsViewProps) {
  const [activeTab, setActiveTab] = useState<'pretty' | 'raw'>('pretty');
  const [pdfExporting, setPdfExporting] = useState(false);
  const livePreRef = useRef<HTMLPreElement>(null);
  const prettyReportRef = useRef<HTMLDivElement>(null);
  const pdfAfterPrettySwitchRef = useRef(false);
  const { ptyDisplayPlain } = usePtyBridge();

  /** Prefer live interactive PTY text when present so Pretty stays in sync with Logon. */
  const narrativeRaw = useMemo(() => {
    if (ptyDisplayPlain.trim().length > 0) return ptyDisplayPlain;
    return result?.rawOutput ?? '';
  }, [ptyDisplayPlain, result?.rawOutput]);

  const narrativeParsed = useMemo(() => parseSeoOutput(narrativeRaw), [narrativeRaw]);
  const isLivePtyNarrative = ptyDisplayPlain.trim().length > 0;

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
        'Could not create PDF. If the report is very long, try the Raw Output tab and save from your browser, or try again after scrolling through the full Pretty Report once.'
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
        {narrativeRaw.trim() ? (
          <PrettyReport
            key="pty-pretty-empty-run"
            report={narrativeParsed}
            stats={PLACEHOLDER_LIVE_STATS}
            rawOutput={narrativeRaw}
            narrativeSource="pty"
          />
        ) : null}
        <PtyReplyPanel />
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
            Pretty Report
          </button>
          <button
            onClick={() => setActiveTab('raw')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'raw' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <TerminalIcon size={16} />
            Raw Output
          </button>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
          <button
            type="button"
            onClick={handlePdfClick}
            disabled={pdfExporting}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            title="Save the Pretty Report as a PDF"
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
              <PrettyReport
                key={isLivePtyNarrative ? 'narrative-pty' : 'narrative-headless'}
                report={narrativeParsed}
                stats={result.stats}
                rawOutput={narrativeRaw}
                narrativeSource={isLivePtyNarrative ? 'pty' : 'headless'}
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
            <LivePtyRawMirror />
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-gray-100 border-b border-gray-200">
                <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                  Last headless run (claude -p)
                </span>
              </div>
              <div className="bg-[#1e1e1e]">
                <pre className="p-6 text-sm font-mono text-gray-300 overflow-auto max-h-[320px] leading-relaxed whitespace-pre-wrap break-words">
                  {result.rawOutput?.trim()
                    ? result.rawOutput
                    : `(no terminal output captured)\n\n${result.error ? `Summary: ${result.error}` : ''}`}
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PtyReplyPanel />
    </div>
  );
}

const PLACEHOLDER_LIVE_STATS: RunStats = {
  durationMs: 0,
  startedAt: '',
  finishedAt: ''
};

function LivePtyRawMirror() {
  const {
    clearLiveTranscript,
    sendToPty,
    peekPtyTranscriptBuffer,
    subscribePtyMirrorWrite,
    subscribePtyMirrorReset
  } = usePtyBridge();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
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
            Interactive PTY (same session as Logon)
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
        resets this panel and Pretty/Rich text from new output onward; it does not clear the Logon terminal scrollback.
      </p>
      <div
        ref={hostRef}
        className="px-2 py-2 overflow-hidden max-h-[min(55vh,560px)] min-h-[200px]"
        title="Focus the terminal to type. Same PTY as Logon."
      />
    </div>
  );
}

function PtyReplyPanel() {
  const { sendToPty, ptySessionReady, clearLiveTranscript } = usePtyBridge();
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
    clearLiveTranscript();
    sendToPty(appendEnter ? `${t}\r` : t);
    setHint(
      'Dashboard view reset from this point; Logon terminal unchanged. Raw and Pretty will show only new lines.'
    );
    setText('');
  };

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5 space-y-3">
      <h4 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
        <Send size={16} className="text-indigo-600 shrink-0" aria-hidden />
        Reply via interactive PTY
      </h4>
      <p className="text-xs text-indigo-900/85 leading-relaxed">
        Sends keystrokes to the <strong>same</strong> persistent PTY as Logon (not to the finished{' '}
        <code className="bg-white/70 px-1 rounded text-[11px]">claude -p</code> run). <strong>Raw</strong> is a second
        xterm on the same PTY stream; <strong>Pretty</strong> follows that live text when the PTY has output. Open{' '}
        <strong>Logon</strong> if you prefer the primary terminal layout.
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

function issuesBySeverityOrLegacy(report: ParsedReport): IssuesBySeverity {
  return report.summary.issuesBySeverity ?? { ...ZERO_ISSUES };
}

/** Shows a short “Receiving…” pulse while PTY narrative text is changing. */
function PtyNarrativeLiveBadge({ rawOutput }: { rawOutput: string }) {
  const [receiving, setReceiving] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setReceiving(true);
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setReceiving(false);
    }, 1000);
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

function PrettyReport({
  report,
  stats,
  rawOutput,
  narrativeSource = 'headless'
}: {
  report: ParsedReport;
  stats: RunStats;
  rawOutput: string;
  narrativeSource?: 'pty' | 'headless';
}) {
  const scorecard = hasParsedScorecard(report);
  const bySev = issuesBySeverityOrLegacy(report);
  const findingTotal =
    bySev.critical + bySev.high + bySev.medium + bySev.low + (bySev.passed ?? 0);
  const hidePageScoreCardNarrative =
    scorecard &&
    !!report.summary.categories &&
    report.summary.categories.length > 0;
  const showAuditNarrativeCaption =
    !!rawOutput?.trim() && hasVisibleAuditNarrative(rawOutput, hidePageScoreCardNarrative);

  return (
    <div className="space-y-6">
      {!scorecard && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex gap-3">
          <Info className="text-amber-600 shrink-0 mt-0.5" size={20} />
          <div>
            <h4 className="font-semibold text-amber-950 text-sm">No score-card pattern detected</h4>
            <p className="text-sm text-amber-900/80 mt-1 leading-relaxed">
              This output does not match the classic &quot;Overall Score&quot; layout. The full narrative is rendered
              below — use the Raw Output tab if you need the exact terminal text.
            </p>
          </div>
        </div>
      )}

      {/* Executive Summary */}
      {scorecard && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Overall Score</span>
              <div className="flex items-end gap-2 mt-1">
                <span className="text-4xl font-bold text-gray-900">{report.summary.overallScore}</span>
                <span className="text-gray-400 font-medium mb-1">/ 100</span>
              </div>
            </div>
            <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ${
                  report.summary.overallScore >= 90
                    ? 'bg-green-500'
                    : report.summary.overallScore >= 70
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                }`}
                style={{ width: `${report.summary.overallScore}%` }}
              ></div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Status</span>
            <div className="flex items-center gap-2 mt-2">
              <StatusBadge status={report.summary.status} />
            </div>
            <p className="text-sm text-gray-500 mt-4 leading-relaxed">
              {report.summary.overallScore > 0 ? (
                <>
                  Tier from <strong>overall score</strong> ({report.summary.overallScore}/100), not from issue counts
                  or section headers.
                </>
              ) : (
                <>No overall score was detected in the output; status stays unknown until a score line is parsed.</>
              )}
            </p>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Issues by priority</span>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <SeverityCountRow label="Critical" count={bySev.critical} tone="critical" />
              <SeverityCountRow label="High" count={bySev.high} tone="high" />
              <SeverityCountRow label="Medium" count={bySev.medium} tone="medium" />
              <SeverityCountRow label="Low" count={bySev.low} tone="low" />
              {(bySev.passed ?? 0) > 0 ? (
                <SeverityCountRow label="Passed" count={bySev.passed} tone="passed" />
              ) : null}
            </div>
            <p className="text-sm text-gray-500 mt-4 leading-relaxed">
              {findingTotal > 0
                ? `${findingTotal} total — structured findings below, plus any extra rows counted from numbered lists (1. 2. …) per severity block in the raw output.`
                : 'No structured findings and no numbered list lines (e.g. 1. …) were detected under Critical / High / Medium / Low in the captured output.'}
            </p>
          </div>
        </div>
      )}

      {/* Score Categories (Page Score Card) */}
      {scorecard && report.summary.categories && report.summary.categories.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-6">Page Score Card</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {report.summary.categories.map((cat: any, idx: number) => (
              <div key={idx} className="space-y-2">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-gray-600">{cat.label}</span>
                  <span className="text-gray-900">{cat.score}/100</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-indigo-500 transition-all duration-700" 
                    style={{ width: `${cat.score}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Text */}
      {scorecard && report.rawSummary && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6">
          <h4 className="text-sm font-bold text-indigo-900 uppercase tracking-widest mb-3">Analysis Summary</h4>
          <p className="text-sm text-indigo-800 leading-relaxed whitespace-pre-wrap">
            {report.rawSummary}
          </p>
        </div>
      )}

      {/* Sections */}
      {scorecard && (
      <div className="space-y-4">
        {(report.sections || []).map((section: ReportSection, idx: number) => (
          <div key={idx} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/30">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-600 font-bold text-xs">
                  {idx + 1}
                </div>
                <h4 className="font-bold text-gray-900">{section.title}</h4>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-sm font-semibold text-gray-600">Score: {section.score}%</div>
                <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500" style={{ width: `${section.score}%` }}></div>
                </div>
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {section.findings.map((finding: Finding, fIdx: number) => (
                <div key={fIdx} className="p-6 hover:bg-gray-50/50 transition-colors">
                  <div className="flex gap-4">
                    <SeverityBadge severity={finding.severity} />
                    <div className="flex-1 space-y-2">
                      <h5 className="font-semibold text-gray-900 text-sm">{finding.issue}</h5>
                      <FindingDetailsExpand finding={finding} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      )}

      {rawOutput?.trim() ? (
        <div className="space-y-2">
          {narrativeSource === 'pty' ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-emerald-900/90 px-2 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100">
              <span>
                Live interactive PTY — narrative matches Logon / Raw and refreshes as output arrives.
              </span>
              <PtyNarrativeLiveBadge rawOutput={rawOutput} />
            </div>
          ) : showAuditNarrativeCaption ? (
            <p className="text-xs text-gray-400 px-1">
              Run finished in {(stats.durationMs / 1000).toFixed(1)}s — narrative below matches captured stdout/stderr.
            </p>
          ) : null}
          {narrativeSource === 'pty' ? (
            <PtyMessengerThread transcript={rawOutput} />
          ) : (
            <AuditMarkdownSections source={rawOutput} hidePageScoreCardNarrative={hidePageScoreCardNarrative} />
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500 px-1">No stdout/stderr was captured for this run.</p>
      )}
    </div>
  );
}

function SeverityCountRow({
  label,
  count,
  tone
}: {
  label: string;
  count: number;
  tone: 'critical' | 'high' | 'medium' | 'low' | 'passed';
}) {
  const ring: Record<typeof tone, string> = {
    critical: 'border-red-200 bg-red-50/80 text-red-900',
    high: 'border-orange-200 bg-orange-50/80 text-orange-950',
    medium: 'border-amber-200 bg-amber-50/80 text-amber-950',
    low: 'border-sky-200 bg-sky-50/80 text-sky-950',
    passed: 'border-emerald-200 bg-emerald-50/80 text-emerald-950'
  };
  return (
    <div
      className={`flex items-center justify-between rounded-xl border px-3 py-2 ${ring[tone]}`}
    >
      <span className="font-medium">{label}</span>
      <span className="tabular-nums font-bold text-lg">{count}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Unknown: 'bg-gray-100 text-gray-700 border-gray-200',
    Excellent: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    Good: 'bg-green-100 text-green-800 border-green-200',
    Fair: 'bg-lime-100 text-lime-900 border-lime-200',
    'Needs work': 'bg-yellow-100 text-yellow-900 border-yellow-200',
    Poor: 'bg-orange-100 text-orange-900 border-orange-200',
    Critical: 'bg-red-100 text-red-800 border-red-200',
    Healthy: 'bg-green-100 text-green-700 border-green-200',
    'Needs Improvement': 'bg-yellow-100 text-yellow-800 border-yellow-200'
  };

  const colorClass = colors[status] || 'bg-gray-100 text-gray-700 border-gray-200';
  
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${colorClass}`}>
      {status}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const configs = {
    critical: { color: 'bg-red-100 text-red-700 border-red-200', icon: <AlertTriangle size={12} /> },
    high: { color: 'bg-orange-100 text-orange-700 border-orange-200', icon: <AlertTriangle size={12} /> },
    medium: { color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: <Info size={12} /> },
    low: { color: 'bg-blue-100 text-blue-700 border-blue-200', icon: <Info size={12} /> },
    passed: { color: 'bg-green-100 text-green-700 border-green-200', icon: <CheckCircle size={12} /> },
  };

  const config = configs[severity];

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border h-fit shrink-0 ${config.color}`}>
      {config.icon}
      <span className="text-[10px] font-bold uppercase tracking-wider">{severity}</span>
    </div>
  );
}
