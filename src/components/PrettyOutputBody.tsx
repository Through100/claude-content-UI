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
        className={`inline-flex items-center gap-1 mx-0.5 px-2 py-0.5 rounded-md border text-[13px] font-medium align-baseline ${tagShell(p.tagKind)}`}
        title={p.raw}
      >
        {tagIcon(p.tagKind)}
        <span className="text-[11px] font-bold uppercase tracking-wide opacity-80">{tagLabel(p.tagKind)}</span>
        {p.detail ? (
          <span className="font-normal normal-case opacity-95 truncate max-w-[14rem]">{p.detail}</span>
        ) : null}
      </span>
    );
  });
}

function TitleBlock({ text }: { text: string }) {
  return (
    <header className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/90 to-white px-5 py-4 md:px-6 md:py-5 shadow-sm">
      <h1 className="text-2xl md:text-[1.65rem] font-bold text-gray-900 tracking-tight leading-snug border-b-2 border-indigo-200/80 pb-3">
        {renderInlineParts(parseInline(text), 'title')}
      </h1>
    </header>
  );
}

function MetaPanelBlock({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2.5 md:px-4 md:py-3">
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2 text-[13px] md:text-sm">
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
    <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 px-3 py-2 text-[13px] md:text-sm flex flex-wrap gap-x-2 gap-y-0.5">
      <span className="font-semibold text-slate-900 shrink-0">{label}:</span>
      <span className="text-slate-700 min-w-0 break-words">{renderInlineParts(parseInline(value), 'mr')}</span>
    </div>
  );
}

function TagBlockCard({ tagKind, detail, raw }: { tagKind: TagKind; detail: string; raw: string }) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 md:px-4 md:py-3 flex gap-3 text-[14px] leading-snug shadow-sm ${tagShell(tagKind)}`}
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

function CalloutBlock({ body }: { body: string }) {
  const lines = body.split('\n');
  return (
    <aside className="rounded-xl border-l-4 border-indigo-500 bg-indigo-50/70 border border-indigo-100/80 px-4 py-3 text-[15px] leading-7 text-gray-800 space-y-2">
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
        className="m-0 p-4 text-[13px] leading-relaxed font-mono text-zinc-100 overflow-x-auto whitespace-pre"
      >
        {body}
      </pre>
    </div>
  );
}

function ListBlock({ items, ordered }: { items: InlinePart[][]; ordered?: boolean }) {
  if (ordered) {
    return (
      <ol className="list-decimal pl-6 space-y-2 text-[15px] leading-7 text-gray-800 marker:font-medium marker:text-gray-600">
        {items.map((item, j) => (
          <li key={j} className="pl-1">
            {renderInlineParts(item, `oli-${j}`)}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ul className="list-disc pl-5 space-y-1.5 text-[15px] leading-7 text-gray-800 marker:text-gray-400">
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
        className="w-full flex items-start gap-3 text-left px-4 py-3 md:px-4 md:py-3.5 hover:bg-gray-50/90 transition-colors"
      >
        <span className="mt-0.5 text-indigo-600 font-bold text-sm shrink-0">{id}</span>
        <span className="flex-1 min-w-0 text-[15px] font-semibold text-gray-900 leading-snug">
          {renderInlineParts(qParts, 'faq-q')}
        </span>
        <ChevronDown
          size={20}
          className={`shrink-0 text-gray-500 transition-transform mt-0.5 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && answer ? (
        <div className="px-4 pb-4 pt-0 md:px-4 border-t border-gray-100 bg-gray-50/50">
          <div className="text-[15px] leading-7 text-gray-700 space-y-2 pt-3">
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
        <h3 key={k} className="text-lg md:text-xl font-semibold text-gray-900 pt-2 scroll-mt-16">
          {renderInlineParts(parseInline(child.text), `${k}-h2`)}
        </h3>
      ) : (
        <h4 key={k} className="text-base font-semibold text-gray-800 pt-1 border-l-2 border-gray-200 pl-3">
          {renderInlineParts(parseInline(child.text), `${k}-h3`)}
        </h4>
      );
    case 'paragraph':
      return (
        <p key={k} className="text-[15px] leading-7 text-gray-800 whitespace-pre-wrap break-words">
          {renderInlineParts(child.parts, `${k}-p`)}
        </p>
      );
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
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {heading ? (
        <div className="px-4 py-3 md:px-5 md:py-3.5 border-b border-gray-100 bg-gray-50/80">
          <h2 className="text-lg md:text-xl font-semibold text-gray-900 leading-snug">
            {renderInlineParts(parseInline(heading.text), 'sec-h')}
          </h2>
        </div>
      ) : null}
      <div className={`space-y-4 px-4 py-4 md:px-6 md:py-5 ${heading ? '' : ''}`}>
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
    <div className={`pretty-output-doc space-y-6 max-w-none text-gray-900 ${className}`.trim()} aria-label="Formatted output">
      {doc.map((b, i) => (
        <DocumentBlockView key={`top-${i}`} block={b} index={i} />
      ))}
    </div>
  );
}
