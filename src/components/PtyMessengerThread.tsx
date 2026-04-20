import React, { useEffect, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import {
  isAwaitingPtyAssistantResponse,
  parsePtyTranscriptToMessages,
  trimTrailingTrivialAssistantTurns
} from '../../shared/parsePtyTranscriptToMessages';
import PtyAssistantBody from './PtyAssistantBody';

type PtyMessengerThreadProps = {
  transcript: string;
  /**
   * Optional unsanitized PTY text (e.g. merged archive before Pretty sanitizer). Used only to decide
   * whether to show “Claude is responding…” while spinners are stripped from `transcript`.
   */
  awaitingHintSource?: string;
  lastManualInput?: { text: string; time: number } | null;
};

function PtyAssistantPending() {
  return (
    <div className="flex justify-start w-full">
      <div className="w-full max-w-[min(100%,40rem)] md:max-w-[48rem] pr-2 md:pr-16">
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/90 px-5 py-4 shadow-sm flex items-start gap-3 text-indigo-950">
          <Loader2 className="h-5 w-5 animate-spin shrink-0 text-indigo-600 mt-0.5" aria-hidden />
          <div>
            <p className="text-sm font-semibold">Executing...</p>
            <p className="text-xs text-indigo-900/80 mt-1 leading-relaxed">
              Waiting for the next lines from the interactive session.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ChatGPT-style thread: assistant on the left (markdown or plain), you on the right (pill).
 * Shows a loading card when the last parsed turn is the user (assistant still thinking / not yet in buffer).
 */
export default function PtyMessengerThread({ transcript, awaitingHintSource, lastManualInput }: PtyMessengerThreadProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const turnsRaw = useMemo(() => parsePtyTranscriptToMessages(transcript), [transcript]);
  const displayTurns = useMemo(() => trimTrailingTrivialAssistantTurns(turnsRaw), [turnsRaw]);
  const turnsForAwaiting = useMemo(
    () => parsePtyTranscriptToMessages(awaitingHintSource ?? transcript),
    [awaitingHintSource, transcript]
  );
  const showThinking = useMemo(
    () => isAwaitingPtyAssistantResponse(turnsForAwaiting),
    [turnsForAwaiting]
  );

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript, showThinking]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottomRef.current = gap < 120;
  };

  const visibleTurns = useMemo(() => {
    const base = displayTurns.filter((m) => m.role === 'user' || m.text.trim().length > 0);
    if (!lastManualInput) return base;
    
    // If the manual input was already naturally echoed by the terminal, we don't append it again.
    const lastUser = base.slice().reverse().find((m) => m.role === 'user');
    const naturallyEchoed = lastUser && lastUser.text.trim() === lastManualInput.text.trim();
    
    // Show the optimistic bubble for recent inputs (30s) or indefinitely as the last action.
    if (!naturallyEchoed && Date.now() - lastManualInput.time < 45000) {
      return [...base, { id: `manual-${lastManualInput.time}`, role: 'user', text: lastManualInput.text }];
    }
    return base;
  }, [displayTurns, lastManualInput]);

  if (visibleTurns.length === 0) {
    const fallback = transcript?.trim();
    if (!fallback) {
      return (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
          No messages yet — use Logon or Raw, or send a reply below.
        </div>
      );
    }
    if (showThinking) {
      return (
        <div className="rounded-2xl border border-indigo-100 bg-white shadow-sm overflow-hidden">
          <p className="text-xs text-indigo-800 px-4 py-3 border-b border-indigo-100 bg-indigo-50/60">
            Live PTY — waiting for the assistant after your last line.
          </p>
          <div className="px-4 py-8 md:px-8 max-h-[min(75vh,720px)] overflow-y-auto bg-white">
            <PtyAssistantPending />
          </div>
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
              <div className="rounded-2xl border border-gray-100 bg-white px-4 py-5 md:px-6 md:py-5 shadow-sm">
                <PtyAssistantBody text={fallback} />
              </div>
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
        {visibleTurns.map((m) =>
          m.role === 'assistant' ? (
            <div key={m.id} className="flex justify-start w-full">
              <div className="w-full max-w-[min(100%,44rem)] md:max-w-[56rem] pr-2 md:pr-16">
                <div className="rounded-2xl border border-gray-100 bg-white px-4 py-5 md:px-6 md:py-5 shadow-sm">
                  <PtyAssistantBody text={m.text} />
                </div>
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
        {showThinking ? <PtyAssistantPending /> : null}
      </div>
    </section>
  );
}
