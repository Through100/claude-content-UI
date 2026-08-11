import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDown, Image as ImageIcon, BarChart3, Quote, Link2, Tag } from 'lucide-react';
import {
  buildPrettyDocument,
  parseInline,
  parseLinearBlocks,
  parsePrettyDocument,
  type DocumentBlock,
  type InlinePart,
  type SectionChild,
  type TagKind
} from '../lib/parseTerminalMarkdown';
import { sanitizeRunOutputForChat } from '../lib/dashboardChatHistory';

type PrettyOutputBodyProps = {
  text: string;
  className?: string;
  /** Live PTY Pretty: decorative `---` / Ink separator lines are visual noise — omit divider blocks. */
  omitDividers?: boolean;
};

/** Dense body copy for Pretty Output (PTY transcripts are long). */
const PRETTY_BODY = 'text-xs leading-5 text-gray-800';
const PRETTY_BODY_RELAXED = 'text-xs leading-[1.6] text-gray-800';

function tagIcon(kind: TagKind) {
  switch (kind) {
    case 'image':
      return <ImageIcon size={14} className="shrink-0 text-sky-600" aria-hidden />;
    case 'chart':
      return <BarChart3 size={14} className="shrink-0 text-violet-600" aria-hidden />;
    case 'citation':
      return <Quote size={14} className="shrink-0 text-amber-700" aria-hidden />;
    case 'internal-link':
      return <Link2 size={14} className="shrink-0 text-indigo-600" aria-hidden />;
    default:
      return <Tag size={14} className="shrink-0 text-gray-500" aria-hidden />;
  }
}

function tagLabel(kind: TagKind): string {
  switch (kind) {
    case 'image':
      return 'Image';
    case 'chart':
      return 'Chart';
    case 'citation':
      return 'Citation';
    case 'internal-link':
      return 'Internal link';
    default:
      return 'Tag';
  }
}

function tagShell(kind: TagKind): string {
  switch (kind) {
    case 'image':
      return 'border-sky-200 bg-sky-50/90 text-sky-950';
    case 'chart':
      return 'border-violet-200 bg-violet-50/90 text-violet-950';
    case 'citation':
      return 'border-amber-200 bg-amber-50/90 text-amber-950';
    case 'internal-link':
      return 'border-indigo-200 bg-indigo-50/90 text-indigo-950';
    default:
      return 'border-gray-200 bg-gray-50 text-gray-800';
  }
}

function renderInlineParts(parts: InlinePart[], keyPrefix: string): React.ReactNode[] {
  return parts.map((p, i) => {
    const k = `${keyPrefix}-${i}`;
    if (p.kind === 'text') {
      return (
        <span key={k} className="whitespace-pre-wrap">
          {p.text}
        </span>
      );
    }
    if (p.kind === 'bold') {
      return (
        <strong key={k} className="font-semibold text-gray-900">
          {p.text}
        </strong>
      );
    }
    return (
      <span
        key={k}
        className={`mx-0.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline text-xs font-medium ${tagShell(p.tagKind)}`}
        title={p.raw}
      >
        {tagIcon(p.tagKind)}
        <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">{tagLabel(p.tagKind)}</span>
        {p.detail ? (
          <span className="font-normal normal-case opacity-95 truncate max-w-[14rem]">{p.detail}</span>
        ) : null}
      </span>
    );
  });
}

function TitleBlock({ text }: { text: string }) {
  return (
    <header className="min-w-0 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/90 to-white px-2.5 py-2.5 shadow-sm sm:rounded-2xl sm:px-3 md:px-4 md:py-3">
      <h1 className="break-words border-b-2 border-indigo-200/80 pb-2 text-base font-bold leading-snug tracking-tight text-gray-900 [overflow-wrap:anywhere] md:text-xl">
        {renderInlineParts(parseInline(text), 'title')}
      </h1>
    </header>
  );
}

function MetaPanelBlock({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2.5 md:px-4 md:py-3">
      <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2 md:text-[13px]">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2 min-w-0">
            <dt className="font-semibold text-slate-800 shrink-0">{row.label}:</dt>
            <dd className="text-slate-700 min-w-0 break-words">{renderInlineParts(parseInline(row.value), `mp-${i}`)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MetaRowBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 rounded-lg border border-slate-200/80 bg-slate-50/60 px-2.5 py-2 text-xs md:px-3 md:text-[13px]">
      <span className="font-semibold text-slate-900 shrink-0">{label}:</span>
      <span className="text-slate-700 min-w-0 break-words">{renderInlineParts(parseInline(value), 'mr')}</span>
    </div>
  );
}

function TagBlockCard({ tagKind, detail, raw }: { tagKind: TagKind; detail: string; raw: string }) {
  return (
    <div
      className={`flex gap-2.5 rounded-xl border px-2.5 py-2 text-xs leading-snug shadow-sm md:px-3 md:py-2.5 ${tagShell(tagKind)}`}
      title={raw}
    >
      <span className="pt-0.5">{tagIcon(tagKind)}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide opacity-75">{tagLabel(tagKind)}</p>
        {detail ? <p className="mt-1 font-medium break-words">{detail}</p> : null}
      </div>
    </div>
  );
}

/** Strip markdown decoration from header cells for width heuristics. */
function normalizeTableHeaderLabel(raw: string): string {
  return raw
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Relative weights for wide narrative columns vs narrow score bands (blog audit tables).
 * Normalized to 100% — avoids the old bug that gave 50% width only to the last column.
 */
function markdownTableColWeights(header: string[]): number[] {
  return header.map((raw) => {
    const h = normalizeTableHeaderLabel(raw);
    if (h === '#' || h === 'no.' || /^#\s*$/.test(raw.trim())) return 3;
    if (h === 'max' || h === 'weight') return 8;
    if (
      h.includes('notes') ||
      h.includes('finding') ||
      h.includes('recommendation') ||
      h.includes('assessment') ||
      h.includes('result') ||
      h.includes('description') ||
      h.includes('details')
    )
      return 30;
    if (h.includes('category') || h.includes('check') || h.includes('issue') || h.includes('claim')) return 16;
    if (h.includes('article') && !h.includes('url')) return 22;
    if (h.includes('slug') || h.includes('url slug') || (h.includes('url') && h.includes('path'))) return 26;
    if ((h.includes('score') || /\b\d+\s*\/\s*100\b/.test(h)) && !h.includes('article') && !h.includes('site'))
      return 8;
    if (
      h === 'content' ||
      h === 'seo' ||
      h.includes('e-e-a-t') ||
      h === 'technical' ||
      h.includes('ai citation')
    )
      return 6;
    if (h.includes('rating')) return 9;
    return 10;
  });
}

function markdownTableColPercent(i: number, header: string[]): string {
  const n = header.length;
  if (n <= 1) return '100%';
  const weights = markdownTableColWeights(header);
  const sum = weights.reduce((a, b) => a + b, 0);
  return `${((weights[i] / sum) * 100).toFixed(3)}%`;
}

function isNarrativeTableColumn(headerLabel: string): boolean {
  const h = normalizeTableHeaderLabel(headerLabel);
  return (
    h.includes('notes') ||
    h.includes('finding') ||
    h.includes('recommendation') ||
    h.includes('assessment') ||
    h.includes('result') ||
    h.includes('description') ||
    h.includes('details')
  );
}

function isLabelTableColumn(headerLabel: string): boolean {
  const h = normalizeTableHeaderLabel(headerLabel);
  return h.includes('category') || h.includes('check') || h.includes('issue') || h.includes('claim');
}

/**
 * Compact audit tables work best with content-aware bands: score fields only need a few characters,
 * the row label gets a modest share, and the long narrative column absorbs all remaining width.
 */
function compactTableColWidth(headerLabel: string): string {
  const h = normalizeTableHeaderLabel(headerLabel);
  if (h === '#' || h === 'no.') return '1.75rem';
  if (h === 'max' || h === 'weight') return '2.125rem';
  if ((h.includes('score') || /\bscore\b/.test(h)) && !h.includes('article')) return '2.5rem';
  if (isLabelTableColumn(headerLabel)) return '22%';
  if (isNarrativeTableColumn(headerLabel)) return 'auto';
  return '14%';
}

/** Columns that participate in score-matrix width / tabular styling. */
function isNumericScoreColumn(headerLabel: string): boolean {
  const h = normalizeTableHeaderLabel(headerLabel);
  return (
    h === '#' ||
    h === 'no.' ||
    h === 'max' ||
    h === 'weight' ||
    ((h.includes('score') || /\bscore\b/.test(h)) && !h.includes('article')) ||
    h === 'content' ||
    h === 'seo' ||
    h.includes('e-e-a-t') ||
    h === 'technical' ||
    h.includes('ai citation') ||
    h.includes('rating')
  );
}

/** Short numeric cells only — Rating can hold “Below Standard” etc., so allow wrap there. */
function isCompactNumericCell(headerLabel: string): boolean {
  const h = normalizeTableHeaderLabel(headerLabel);
  if (h.includes('rating')) return false;
  return isNumericScoreColumn(headerLabel);
}

function MarkdownTableBlock({ header, rows }: { header: string[]; rows: string[][] }) {
  const n = header.length;
  const wideMatrix = n >= 8;
  const compactNarrativeTable = !wideMatrix && header.some(isNarrativeTableColumn);
  return (
    <div className="my-1 w-full max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table
        className={`w-full border-collapse text-left text-[11px] text-slate-800 md:text-xs ${
          wideMatrix
            ? 'min-w-[1080px] table-fixed lg:min-w-[1180px]'
            : compactNarrativeTable
              ? 'min-w-full table-fixed'
              : 'min-w-full table-auto'
        }`}
      >
        <colgroup>
          {header.map((h, i) => (
            <col
              key={i}
              style={{ width: compactNarrativeTable ? compactTableColWidth(h) : markdownTableColPercent(i, header) }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th
                key={i}
                scope="col"
                className={`border-b border-slate-200 bg-slate-100/95 py-1.5 align-bottom font-semibold leading-snug text-slate-900 sm:py-2 ${
                  isCompactNumericCell(h)
                    ? 'whitespace-nowrap px-1 text-center tabular-nums sm:px-1.5'
                    : 'break-words px-2 sm:px-2.5'
                }`}
              >
                {renderInlineParts(parseInline(h), `tbl-h-${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70">
              {row.map((cell, ci) => {
                const hc = header[ci] ?? '';
                const compact = isCompactNumericCell(hc);
                return (
                  <td
                    key={ci}
                    className={`py-1.5 align-top leading-snug text-slate-800 sm:py-2 ${
                      compact
                        ? 'whitespace-nowrap px-1 text-center tabular-nums sm:px-1.5'
                        : 'break-words px-2 sm:px-2.5'
                    }`}
                  >
                    {renderInlineParts(parseInline(cell), `tbl-${ri}-${ci}`)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalloutBlock({ body }: { body: string }) {
  const lines = body.split('\n');
  return (
    <aside className={`rounded-xl border-l-4 border-indigo-500 bg-indigo-50/70 border border-indigo-100/80 px-3 py-2.5 space-y-1.5 ${PRETTY_BODY_RELAXED}`}>
      {lines.map((ln, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {renderInlineParts(parseInline(ln), `co-${i}`)}
        </p>
      ))}
    </aside>
  );
}

function CodeFenceBlock({ lang, body }: { lang?: string; body: string }) {
  const preRef = useRef<HTMLPreElement>(null);
  const onCopy = useCallback(() => {
    const t = preRef.current?.innerText ?? body;
    void navigator.clipboard.writeText(t).catch(() => {
      try {
        const ta = document.createElement('textarea');
        ta.value = t;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        /* ignore */
      }
    });
  }, [body]);

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-950 overflow-hidden not-prose shadow-inner">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-zinc-900/90 border-b border-zinc-800">
        <span className="text-[11px] font-mono text-zinc-500">{lang || 'code'}</span>
        <button
          type="button"
          onClick={onCopy}
          className="text-[11px] font-medium px-2 py-1 rounded-md bg-white/10 text-zinc-200 hover:bg-white/15 border border-white/10"
        >
          Copy
        </button>
      </div>
      <pre
        ref={preRef}
        className="m-0 p-3 text-[12px] leading-relaxed font-mono text-zinc-100 overflow-x-auto whitespace-pre"
      >
        {body}
      </pre>
    </div>
  );
}

function ListBlock({ items, ordered }: { items: InlinePart[][]; ordered?: boolean }) {
  if (ordered) {
    return (
      <ol className={`list-decimal pl-5 space-y-1.5 marker:font-medium marker:text-gray-600 ${PRETTY_BODY}`}>
        {items.map((item, j) => (
          <li key={j} className="pl-1">
            {renderInlineParts(item, `oli-${j}`)}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ul className={`list-disc pl-4 space-y-1 marker:text-gray-400 ${PRETTY_BODY}`}>
      {items.map((item, j) => (
        <li key={j}>{renderInlineParts(item, `uli-${j}`)}</li>
      ))}
    </ul>
  );
}

function FaqCollapsibleBlock({ id, question, answer }: { id: string; question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const qParts = parseInline(question);
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-start gap-2.5 text-left px-3 py-2.5 md:px-3.5 md:py-3 hover:bg-gray-50/90 transition-colors"
      >
        <span className="mt-0.5 text-indigo-600 font-bold text-xs shrink-0">{id}</span>
        <span className={`flex-1 min-w-0 font-semibold text-gray-900 leading-snug ${PRETTY_BODY}`}>
          {renderInlineParts(qParts, 'faq-q')}
        </span>
        <ChevronDown
          size={20}
          className={`shrink-0 text-gray-500 transition-transform mt-0.5 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && answer ? (
        <div className="px-3 pb-3 pt-0 md:px-3.5 border-t border-gray-100 bg-gray-50/50">
          <div className={`text-gray-700 space-y-1.5 pt-2 ${PRETTY_BODY_RELAXED}`}>
            {answer.split('\n').map((ln, li) => (
              <p key={li} className="whitespace-pre-wrap">
                {renderInlineParts(parseInline(ln), `faq-a-${li}`)}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionChildView({ child, index }: { child: SectionChild; index: number }) {
  const k = `sc-${index}`;
  switch (child.type) {
    case 'heading':
      return child.level === 2 ? (
        <h3 key={k} className="scroll-mt-16 pt-1.5 text-sm font-semibold text-gray-900 md:text-[15px]">
          {renderInlineParts(parseInline(child.text), `${k}-h2`)}
        </h3>
      ) : (
        <h4 key={k} className="text-sm font-semibold text-gray-800 pt-1 border-l-2 border-gray-200 pl-2.5">
          {renderInlineParts(parseInline(child.text), `${k}-h3`)}
        </h4>
      );
    case 'paragraph':
      return (
        <p key={k} className={`${PRETTY_BODY_RELAXED} whitespace-pre-wrap break-words`}>
          {renderInlineParts(child.parts, `${k}-p`)}
        </p>
      );
    case 'table':
      return <MarkdownTableBlock key={k} header={child.header} rows={child.rows} />;
    case 'list':
      return <ListBlock key={k} items={child.items} ordered={child.ordered} />;
    case 'divider':
      return <hr key={k} className="my-4 border-0 border-t border-gray-200" />;
    case 'callout':
      return <CalloutBlock key={k} body={child.body} />;
    case 'code':
      return <CodeFenceBlock key={k} lang={child.lang} body={child.body} />;
    case 'meta':
      return <MetaRowBlock key={k} label={child.label} value={child.value} />;
    case 'metaPanel':
      return <MetaPanelBlock key={k} rows={child.rows} />;
    case 'tag':
      return <TagBlockCard key={k} tagKind={child.tagKind} detail={child.detail} raw={child.raw} />;
    case 'faq':
      return <FaqCollapsibleBlock key={k} id={child.id} question={child.question} answer={child.answer} />;
    default:
      return null;
  }
}

function SectionCard({ heading, children }: { heading: { level: 2; text: string } | null; children: SectionChild[] }) {
  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm sm:rounded-2xl">
      {heading ? (
        <div className="border-b border-gray-100 bg-gray-50/80 px-2.5 py-2 md:px-3 md:py-2.5">
          <h2 className="break-words text-sm font-semibold leading-snug text-gray-900 [overflow-wrap:anywhere] md:text-[15px]">
            {renderInlineParts(parseInline(heading.text), 'sec-h')}
          </h2>
        </div>
      ) : null}
      <div className={`space-y-2.5 px-2.5 py-2.5 md:space-y-3 md:px-3 md:py-3 ${heading ? '' : ''}`}>
        {children.map((c, i) => (
          <SectionChildView key={`sec-${heading?.text ?? 'preamble'}-${i}-${c.type}`} child={c} index={i} />
        ))}
      </div>
    </section>
  );
}

function DocumentBlockView({ block, index }: { block: DocumentBlock; index: number }) {
  if (block.type === 'title') {
    return <TitleBlock key={`doc-${index}`} text={block.text} />;
  }
  return <SectionCard key={`doc-${index}`} heading={block.heading} children={block.children} />;
}

/**
 * Two-stage Pretty Output: parse → structured document blocks → card-based UI.
 */
export default function PrettyOutputBody({ text, className = '', omitDividers = false }: PrettyOutputBodyProps) {
  const cleaned = useMemo(() => sanitizeRunOutputForChat(text), [text]);
  const doc = useMemo(() => {
    if (!omitDividers) return parsePrettyDocument(cleaned);
    const linear = parseLinearBlocks(cleaned).filter((b) => b.type !== 'divider');
    return buildPrettyDocument(linear);
  }, [cleaned, omitDividers]);

  if (!cleaned.trim()) {
    return <p className="text-sm text-gray-500">No content to show.</p>;
  }

  return (
    <div
      className={`pretty-output-doc min-w-0 max-w-full space-y-2.5 break-words text-xs leading-5 text-gray-900 [overflow-wrap:anywhere] sm:space-y-3 ${className}`.trim()}
      aria-label="Formatted output"
    >
      {doc.map((b, i) => (
        <DocumentBlockView key={`top-${i}`} block={b} index={i} />
      ))}
    </div>
  );
}
