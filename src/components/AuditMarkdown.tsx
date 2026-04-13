import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

/** Split markdown on level-2 headings (`## `), not `###`. */
export function splitMarkdownByH2(md: string): { title: string; body: string }[] {
  const text = stripAnsi(md).replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const chunks = text.split(/(?=^##\s+)/m).map((c) => c.trim()).filter(Boolean);
  const out: { title: string; body: string }[] = [];

  for (const chunk of chunks) {
    const firstNl = chunk.indexOf('\n');
    const firstLine = firstNl === -1 ? chunk : chunk.slice(0, firstNl);
    const rest = firstNl === -1 ? '' : chunk.slice(firstNl + 1).trim();

    const m = firstLine.match(/^##\s+(.+)$/);
    if (!m) {
      if (out.length === 0) {
        out.push({ title: 'Overview', body: chunk });
      } else {
        const last = out[out.length - 1];
        last.body = last.body ? `${last.body}\n\n${chunk}` : chunk;
      }
      continue;
    }

    out.push({ title: m[1].trim(), body: rest });
  }

  return out;
}

export function hasH2Sections(md: string): boolean {
  return /^##\s+/m.test(stripAnsi(md).replace(/\r\n/g, '\n'));
}

const PROSE_CLASSES = [
  'prose prose-slate max-w-none',
  'prose-sm md:prose-base',
  'prose-headings:scroll-mt-24 prose-headings:font-semibold prose-headings:text-gray-900',
  'prose-h2:text-lg prose-h2:border-b prose-h2:border-gray-200 prose-h2:pb-2 prose-h2:mt-8',
  'prose-h3:text-base prose-h3:mt-6',
  'prose-h4:text-sm prose-h4:mt-4',
  'prose-p:text-gray-700 prose-p:leading-relaxed',
  'prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline',
  'prose-strong:text-gray-900',
  'prose-code:text-indigo-900 prose-code:bg-indigo-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none',
  'prose-pre:bg-[#1e1e1e] prose-pre:text-gray-200 prose-pre:border prose-pre:border-gray-800 prose-pre:rounded-xl',
  'prose-blockquote:border-l-indigo-500 prose-blockquote:text-gray-600',
  'prose-table:text-sm prose-th:bg-gray-50 prose-th:text-gray-900 prose-td:border-gray-200',
  'prose-hr:border-gray-200',
  'prose-li:marker:text-indigo-400',
].join(' ');

function MarkdownBody({ markdown }: { markdown: string }) {
  const src = markdown.trim() || '\u00a0';
  return (
    <div className={`${PROSE_CLASSES} max-w-none`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{src}</ReactMarkdown>
    </div>
  );
}

/** One scrollable markdown block (legacy / no H2 structure). */
export function AuditMarkdown({ source, title = 'Full report' }: { source: string; title?: string }) {
  const text = stripAnsi(source ?? '').trim();
  if (!text) return null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-gray-100 bg-gray-50/80 px-6 py-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">{title}</h3>
        <p className="text-xs text-gray-500 mt-1">
          Same content as Raw Output, formatted for reading (headings, tables, and code blocks).
        </p>
      </div>
      <div className="px-6 py-6 md:px-8 md:py-8 overflow-x-auto custom-scrollbar">
        <MarkdownBody markdown={text} />
      </div>
    </section>
  );
}

/** Pretty narrative: each `## …` block is a titled card; body keeps ###, tables, and code fences. */
export function AuditMarkdownSections({ source }: { source: string }) {
  const text = stripAnsi(source ?? '').trim();
  if (!text) return null;

  if (!hasH2Sections(text)) {
    return <AuditMarkdown source={text} title="Full audit narrative" />;
  }

  const sections = splitMarkdownByH2(text);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-800">Structured narrative</p>
        <p className="text-xs text-indigo-900/80 mt-1">
          Sections follow each <code className="rounded bg-white/80 px-1 text-[11px]">##</code> heading from Claude (e.g. Strengths, Critical Issues). Same text as Raw Output.
        </p>
      </div>

      {sections.map((sec, idx) => (
        <article
          key={`${sec.title}-${idx}`}
          className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden scroll-mt-4"
        >
          <header className="px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white">
            <h2 className="text-lg md:text-xl font-bold text-gray-900 tracking-tight">{sec.title}</h2>
          </header>
          <div className="px-5 py-5 md:px-7 md:py-6 overflow-x-auto custom-scrollbar">
            <MarkdownBody markdown={sec.body} />
          </div>
        </article>
      ))}
    </div>
  );
}
