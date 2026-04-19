import React, { useMemo } from 'react';
import { segmentPtyAssistantDisplayBlocks } from '../../shared/segmentPtyDiffBlocks';
import PrettyOutputBody from './PrettyOutputBody';

/** Renders Live PTY assistant text: terminal diffs as monospace pre, everything else as Pretty markdown. */
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
              This is what the terminal is showing — Pretty does not send input. <strong>Logon</strong> usually auto-sends{' '}
              <kbd className="px-1 py-0.5 rounded bg-amber-200/80 text-[10px] font-mono">1</kbd> once for this style of
              menu; if it stays stuck, use <strong>Reply below</strong> or type in Logon. Disable auto-pick with{' '}
              <code className="text-[10px] bg-amber-200/70 px-1 rounded">VITE_DISABLE_PTY_AUTO_OPTION_ONE=1</code>.
            </p>
            <pre className="m-0 max-h-[min(40vh,420px)] overflow-auto px-3 py-3 text-[11px] sm:text-[12px] leading-[1.45] font-mono text-amber-950 whitespace-pre">
              {p.text}
            </pre>
          </div>
        ) : (
          <PrettyOutputBody key={`p-${idx}`} text={p.text} />
        )
      )}
    </div>
  );
}
