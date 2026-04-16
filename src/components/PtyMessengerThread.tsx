import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parsePtyTranscriptToMessages } from '../../shared/parsePtyTranscriptToMessages';

type PtyMessengerThreadProps = {
  transcript: string;
};

/** Prose styling for assistant turns when the PTY text looks like Markdown (ChatGPT-like). */
const CHAT_ASSISTANT_PROSE = [
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
  'prose-blockquote:border-l-indigo-400 prose-blockquote:text-gray-700',
].join(' ');

function looksLikeMarkdown(text: string): boolean {
  if (/```/.test(text)) return true;
  if (/^\s*#{1,3}\s+\S/m.test(text)) return true;
  if (/\*\*[^*\n]{2,80}\*\*/.test(text)) return true;
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

function AssistantMessageBody({ text }: { text: string }) {
  const useMd = useMemo(() => looksLikeMarkdown(text), [text]);
  if (useMd) {
    return (
      <div className={`${CHAT_ASSISTANT_PROSE}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlockWithCopy }}>
          {text}
        </ReactMarkdown>
      </div>
    );
  }
  return (
    <div className="text-[15px] md:text-[15px] leading-7 text-gray-900 whitespace-pre-wrap break-words font-sans">
      {text}
    </div>
  );
}

/**
 * ChatGPT-style thread: assistant on the left (markdown or plain), you on the right (pill).
 */
export default function PtyMessengerThread({ transcript }: PtyMessengerThreadProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const turns = useMemo(() => parsePtyTranscriptToMessages(transcript), [transcript]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottomRef.current = gap < 120;
  };

  if (turns.length === 0) {
    const fallback = transcript?.trim();
    if (!fallback) {
      return (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
          No messages yet — use Logon or Raw, or send a reply below.
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <p className="text-xs text-gray-500 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
          No <code className="text-[11px] bg-gray-100 px-1 rounded">❯</code> prompts detected — showing the full
          capture as one reply.
        </p>
        <div className="px-4 py-6 md:px-8 max-h-[min(75vh,720px)] overflow-y-auto bg-white">
          <div className="flex justify-start">
            <div className="w-full max-w-[48rem]">
              <AssistantMessageBody text={fallback} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden"
      aria-label="Chat session"
    >
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex flex-col gap-10 md:gap-12 px-4 py-6 md:px-10 md:py-8 max-h-[min(75vh,720px)] min-h-[220px] overflow-y-auto bg-white"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {turns.map((m) =>
          m.role === 'assistant' ? (
            <div key={m.id} className="flex justify-start w-full">
              <div className="w-full max-w-[min(100%,40rem)] md:max-w-[48rem] pr-2 md:pr-16">
                <AssistantMessageBody text={m.text} />
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-end w-full">
              <div className="max-w-[min(100%,85%)] sm:max-w-[32rem] pl-8 sm:pl-12">
                <div className="rounded-[1.35rem] bg-[#ececec] text-gray-900 px-4 py-2.5 md:px-5 md:py-3 text-[15px] leading-6 whitespace-pre-wrap break-words shadow-sm">
                  {m.text}
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </section>
  );
}
