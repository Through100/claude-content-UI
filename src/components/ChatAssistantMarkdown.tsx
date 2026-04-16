import React, { useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Prose + code styling for assistant chat bubbles (ChatGPT-like). */
export const CHAT_ASSISTANT_PROSE = [
  'prose prose-slate max-w-none',
  'prose-base',
  'prose-headings:font-semibold prose-headings:text-gray-900 prose-headings:scroll-mt-20',
  'prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-2',
  'prose-h3:text-base prose-h3:mt-4',
  'prose-p:text-[15px] prose-p:leading-7 prose-p:text-gray-900',
  'prose-strong:text-gray-900',
  'prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline',
  'prose-code:text-indigo-900 prose-code:bg-indigo-50/90 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.88em] prose-code:before:content-none prose-code:after:content-none',
  'prose-pre:bg-[#1e1e1e] prose-pre:text-gray-100 prose-pre:border prose-pre:border-gray-800 prose-pre:rounded-xl prose-pre:shadow-inner',
  'prose-hr:border-gray-200',
  'prose-ul:my-3 prose-ol:my-3 prose-li:my-0.5',
  'prose-blockquote:border-l-indigo-400 prose-blockquote:text-gray-700'
].join(' ');

function looksLikeMarkdown(text: string): boolean {
  if (/```/.test(text)) return true;
  if (/^\s*#{1,3}\s+\S/m.test(text)) return true;
  if (/\*\*[^*\n]{2,120}\*\*/.test(text)) return true;
  if (/^\s*[-*]\s+\S/m.test(text)) return true;
  return false;
}

function CodeBlockWithCopy({ children, ...rest }: React.ComponentProps<'pre'>) {
  const preRef = useRef<HTMLPreElement>(null);
  const onCopy = useCallback(() => {
    const t = preRef.current?.innerText ?? '';
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
  }, []);

  return (
    <div className="relative my-4 rounded-xl border border-gray-800 bg-[#1e1e1e] overflow-hidden not-prose">
      <button
        type="button"
        onClick={onCopy}
        className="absolute top-2 right-2 z-10 text-[11px] font-medium px-2 py-1 rounded-md bg-white/10 text-gray-200 hover:bg-white/20 border border-white/10"
        aria-label="Copy code"
      >
        Copy
      </button>
      <pre
        ref={preRef}
        className="m-0 p-4 pt-11 text-[13px] leading-relaxed font-mono text-gray-100 overflow-x-auto"
        {...rest}
      >
        {children}
      </pre>
    </div>
  );
}

/** One assistant message: markdown when it looks structured, else plain pre-wrap. */
export function ChatAssistantMarkdown({ text }: { text: string }) {
  const useMd = useMemo(() => looksLikeMarkdown(text), [text]);
  if (useMd) {
    return (
      <div className={CHAT_ASSISTANT_PROSE}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlockWithCopy }}>
          {text}
        </ReactMarkdown>
      </div>
    );
  }
  return (
    <div className="text-[15px] leading-7 text-gray-900 whitespace-pre-wrap break-words font-sans">{text}</div>
  );
}
