import React, { useMemo } from 'react';
import { segmentDiffAndProse } from '../../shared/segmentPtyDiffBlocks';
import PrettyOutputBody from './PrettyOutputBody';

/** Renders Live PTY assistant text: terminal diffs as monospace pre, everything else as Pretty markdown. */
export default function PtyAssistantBody({ text }: { text: string }) {
  const parts = useMemo(() => segmentDiffAndProse(text), [text]);

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
        ) : (
          <PrettyOutputBody key={`p-${idx}`} text={p.text} />
        )
      )}
    </div>
  );
}
