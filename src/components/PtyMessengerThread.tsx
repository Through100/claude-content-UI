import React, { useEffect, useMemo, useRef } from 'react';
import { parsePtyTranscriptToMessages } from '../../shared/parsePtyTranscriptToMessages';

type PtyMessengerThreadProps = {
  transcript: string;
};

/**
 * Chat-style view of the interactive PTY transcript: assistant on the left,
 * your prompts (❯ lines) on the right, scrollable history.
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
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
          No messages yet — use Logon or Raw, or send a reply below.
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50/80 px-4 py-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">Session</h3>
          <p className="text-xs text-gray-500 mt-1">
            No <code className="text-[11px] bg-gray-100 px-1 rounded">❯</code> prompts detected — showing the full
            capture as one assistant message.
          </p>
        </div>
        <SingleAssistantBubble text={fallback} />
      </div>
    );
  }

  return (
    <section
      className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden"
      aria-label="Interactive session messages"
    >
      <div className="border-b border-gray-100 bg-gray-50/80 px-4 py-3 md:px-6">
        <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">Session messages</h3>
        <p className="text-xs text-gray-500 mt-1">
          Claude on the left, your lines after <code className="text-[11px] bg-gray-100 px-1 rounded">❯</code> on the
          right. Scroll up for earlier turns.
        </p>
      </div>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex flex-col gap-4 p-4 md:p-5 max-h-[min(72vh,680px)] min-h-[220px] overflow-y-auto bg-gradient-to-b from-slate-100/90 to-slate-50/95"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {turns.map((m) =>
          m.role === 'assistant' ? (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[min(100%,34rem)]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1 pl-1">Claude</p>
                <div className="rounded-2xl rounded-bl-md border border-gray-200/90 bg-white px-4 py-3 shadow-sm text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
                  {m.text}
                </div>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[min(100%,28rem)]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600/80 mb-1 pr-1 text-right">
                  You
                </p>
                <div className="rounded-2xl rounded-br-md bg-indigo-600 px-4 py-3 shadow-md text-sm text-white whitespace-pre-wrap break-words leading-relaxed">
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

function SingleAssistantBubble({ text }: { text: string }) {
  return (
    <div className="p-4 md:p-5 max-h-[min(72vh,680px)] overflow-y-auto bg-slate-50/90">
      <div className="flex justify-start">
        <div className="max-w-[min(100%,36rem)]">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1 pl-1">Claude</p>
          <div className="rounded-2xl rounded-bl-md border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
            {text}
          </div>
        </div>
      </div>
    </div>
  );
}
