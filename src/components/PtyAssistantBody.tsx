import React, { useMemo } from 'react';
import { segmentPtyAssistantDisplayBlocks } from '../../shared/segmentPtyDiffBlocks';
import { normalizeAsciiTableForPretty } from '../../shared/normalizeAsciiTableForPretty';
import PrettyOutputBody from './PrettyOutputBody';

/** Renders Live PTY assistant text: diffs / ASCII pipe grids as monospace pre, everything else as Pretty markdown. */
export default function PtyAssistantBody({ text }: { text: string }) {
  const parts = useMemo(() => segmentPtyAssistantDisplayBlocks(text), [text]);

  if (parts.length === 0) {
    return <PrettyOutputBody text={text} />;
  }

  if (parts.length === 1 && parts[0].kind === 'prose') {
    return <PrettyOutputBody text={parts[0].text} />;
  }

  return (
    <div className="space-y-4">
      {parts.map((p, idx) =>
        p.kind === 'diff' ? (
          <div
            key={`d-${idx}`}
            className="rounded-xl border border-zinc-800/90 bg-[#09090b] overflow-hidden shadow-inner"
          >
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-900/95 border-b border-zinc-800">
              Patch / diff (monospace)
            </div>
            <pre className="m-0 max-h-[min(65vh,720px)] overflow-auto px-3 py-3 text-[11px] sm:text-[12px] leading-[1.45] font-mono text-zinc-100 whitespace-pre tabular-nums">
              {p.text}
            </pre>
          </div>
        ) : p.kind === 'menu' ? (
          <div
            key={`m-${idx}`}
            className="rounded-xl border border-amber-200/90 bg-amber-50/90 overflow-hidden shadow-sm"
          >
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-950/90 bg-amber-100/95 border-b border-amber-200">
              PTY choice prompt (display only)
            </div>
            <p className="m-0 px-3 py-2 text-[11px] leading-snug text-amber-950 border-b border-amber-100/80 bg-amber-50/95">
              This is what the terminal is showing — Pretty does not send input. Choose an option in{' '}
              <strong>Logon</strong>, or use <strong>Reply below</strong> to send text to the same PTY (Claude Code
              interprets your reply against the menu).
            </p>
            <pre className="m-0 max-h-[min(40vh,420px)] overflow-auto px-3 py-3 text-[11px] sm:text-[12px] leading-[1.45] font-mono text-amber-950 whitespace-pre">
              {p.text}
            </pre>
          </div>
        ) : p.kind === 'grid' ? (
          <div
            key={`g-${idx}`}
            className="rounded-xl border border-slate-200 bg-slate-50/95 overflow-hidden shadow-sm"
          >
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 bg-slate-100/95 border-b border-slate-200">
              Table (fixed width)
            </div>
            <pre
              className="m-0 max-h-[min(70vh,680px)] overflow-x-auto px-3 py-3 text-[12px] leading-[1.35] font-mono text-slate-900 whitespace-pre break-normal [overflow-wrap:normal] tracking-normal select-text"
              style={{ fontVariantLigatures: 'none', fontFeatureSettings: '"liga" 0, "calt" 0' }}
            >
              {normalizeAsciiTableForPretty(p.text)}
            </pre>
          </div>
        ) : (
          <PrettyOutputBody key={`p-${idx}`} text={p.text} />
        )
      )}
    </div>
  );
}
