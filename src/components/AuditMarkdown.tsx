import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

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
        <div
          className={[
            'prose prose-slate max-w-none',
            'prose-sm md:prose-base',
            'prose-headings:scroll-mt-24 prose-headings:font-semibold prose-headings:text-gray-900',
            'prose-h2:text-xl prose-h2:border-b prose-h2:border-gray-200 prose-h2:pb-2',
            'prose-h3:text-lg prose-h3:mt-8',
            'prose-h4:text-base prose-h4:mt-6',
            'prose-p:text-gray-700 prose-p:leading-relaxed',
            'prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline',
            'prose-strong:text-gray-900',
            'prose-code:text-indigo-900 prose-code:bg-indigo-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none',
            'prose-pre:bg-[#1e1e1e] prose-pre:text-gray-200 prose-pre:border prose-pre:border-gray-800 prose-pre:rounded-xl',
            'prose-blockquote:border-l-indigo-500 prose-blockquote:text-gray-600',
            'prose-table:text-sm prose-th:bg-gray-50 prose-th:text-gray-900 prose-td:border-gray-200',
            'prose-hr:border-gray-200',
            'prose-li:marker:text-indigo-400',
          ].join(' ')}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      </div>
    </section>
  );
}
