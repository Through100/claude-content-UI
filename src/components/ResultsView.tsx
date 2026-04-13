import React, { useState, useRef, useEffect } from 'react';
import { FileText, Terminal, Copy, Download, ChevronRight, AlertTriangle, CheckCircle, Info, ExternalLink } from 'lucide-react';
import { RunResponse, Severity } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface ResultsViewProps {
  result: RunResponse | null;
  isLoading: boolean;
  /** Date.now() when the current run started; drives elapsed label while loading */
  loadingStartedAt?: number | null;
  /** Live stdout/stderr from Claude while the run is in progress (SSE) */
  liveTerminal?: string;
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
  const livePreRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = livePreRef.current;
    if (!el || !liveTerminal) return;
    el.scrollTop = el.scrollHeight;
  }, [liveTerminal]);

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 md:p-12 flex flex-col items-stretch space-y-6 max-w-6xl mx-auto w-full">
        <div className="flex flex-col items-center space-y-4">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
            <Terminal className="absolute inset-0 m-auto text-indigo-600" size={24} />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900">Executing SEO Command</h3>
            <p className="text-sm text-gray-500">Live output from Claude appears below as it is produced.</p>
            {loadingStartedAt != null && (
              <p className="text-sm font-mono text-indigo-600 mt-3">Elapsed: {formatElapsed(loadingStartedAt)}</p>
            )}
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
      <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
          <FileText className="text-gray-400" size={32} />
        </div>
        <h3 className="text-lg font-medium text-gray-900">No Results Yet</h3>
        <p className="text-sm text-gray-500 max-w-xs mx-auto mt-2">
          Run a command above to see the SEO audit report and terminal output.
        </p>
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
            <Terminal size={16} />
            Raw Output
          </button>
        </div>

        <div className="flex items-center gap-3">
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
            {result.parsedReport ? (
              <PrettyReport report={result.parsedReport} stats={result.stats} />
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
                <Info className="mx-auto text-gray-400 mb-3" size={32} />
                <h4 className="font-semibold text-gray-900">Structured Report Unavailable</h4>
                <p className="text-sm text-gray-500 mt-1">
                  The command executed successfully, but did not return a structured report. 
                  Please check the Raw Output tab for details.
                </p>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="raw"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-[#1e1e1e] rounded-2xl border border-gray-800 shadow-xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-gray-800">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
                <div className="w-3 h-3 rounded-full bg-[#27c93f]"></div>
              </div>
              <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Terminal Output</span>
              <div className="w-12"></div>
            </div>
            <pre className="p-6 text-sm font-mono text-gray-300 overflow-auto max-h-[500px] leading-relaxed">
              {result.rawOutput?.trim()
                ? result.rawOutput
                : `(no terminal output captured)\n\n${result.error ? `Summary: ${result.error}` : ''}`}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PrettyReport({ report, stats }: { report: any, stats: any }) {
  return (
    <div className="space-y-6">
      {/* Executive Summary */}
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
                report.summary.overallScore >= 90 ? 'bg-green-500' : 
                report.summary.overallScore >= 70 ? 'bg-yellow-500' : 'bg-red-500'
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
            Based on {report.sections.length} audit sections and technical analysis.
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">High Priority Issues</span>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-4xl font-bold text-red-600">{report.summary.highPriorityIssues}</span>
            <AlertTriangle className="text-red-500" size={24} />
          </div>
          <p className="text-sm text-gray-500 mt-4">
            Immediate action recommended for these critical findings.
          </p>
        </div>
      </div>

      {/* Score Categories (Page Score Card) */}
      {report.summary.categories && report.summary.categories.length > 0 && (
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
      {report.rawSummary && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6">
          <h4 className="text-sm font-bold text-indigo-900 uppercase tracking-widest mb-3">Analysis Summary</h4>
          <p className="text-sm text-indigo-800 leading-relaxed whitespace-pre-wrap">
            {report.rawSummary}
          </p>
        </div>
      )}

      {/* Sections */}
      <div className="space-y-4">
        {(report.sections || []).map((section: any, idx: number) => (
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
              {section.findings.map((finding: any, fIdx: number) => (
                <div key={fIdx} className="p-6 hover:bg-gray-50/50 transition-colors">
                  <div className="flex gap-4">
                    <SeverityBadge severity={finding.severity} />
                    <div className="flex-1 space-y-2">
                      <h5 className="font-semibold text-gray-900 text-sm">{finding.issue}</h5>
                      <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3 flex gap-3">
                        <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                        <p className="text-sm text-indigo-900 leading-relaxed">
                          <span className="font-bold">Recommendation:</span> {finding.recommendation}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors = {
    'Healthy': 'bg-green-100 text-green-700 border-green-200',
    'Needs Improvement': 'bg-yellow-100 text-yellow-700 border-yellow-200',
    'Critical': 'bg-red-100 text-red-700 border-red-200',
  };
  
  const colorClass = colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-700 border-gray-200';
  
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
