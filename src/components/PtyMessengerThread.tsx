import React, { useEffect, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import {
  isAwaitingPtyAssistantResponse,
  parsePtyTranscriptToMessages,
  trimTrailingTrivialAssistantTurns
} from '../../shared/parsePtyTranscriptToMessages';
import { extractPtyLiveFooterLine } from '../../shared/extractPtyLiveFooterLine';
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

/** Raw TUI-style footer (timer, tokens, thinking) — same line family as Logon / Raw. */
function TerminalLiveFooterBar({ text }: { text: string }) {
  return (
    <div className="flex justify-start w-full">
      <div className="w-full max-w-[min(100%,44rem)] md:max-w-[56rem] pr-2 md:pr-16">
        <div className="rounded-xl border border-zinc-700/95 bg-[#09090b] px-3 py-2.5 shadow-inner ring-1 ring-zinc-800/80">
          <p className="text-[11px] sm:text-[12px] leading-snug font-mono text-zinc-200 whitespace-pre-wrap break-words">
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}

function PtyAssistantPending() {
  return (
    <div className="flex justify-start w-full">
      <div className="w-full max-w-[min(100%,40rem)] md:max-w-[48rem] pr-2 md:pr-16">
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/90 px-5 py-4 shadow-sm flex items-start gap-4 text-indigo-950">
          <div className="flex flex-col items-center shrink-0 mt-0.5">
            <span
              className="text-xl leading-none animate-spin-slow text-indigo-600 select-none"
              style={{ animationDuration: '3s' }}
            >
              ✽
            </span>
            <Loader2 className="h-3 w-3 animate-spin text-indigo-400 mt-1" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight text-indigo-950">Claude is responding…</p>
            <p className="text-xs font-medium text-indigo-900/70 mt-1.5 leading-relaxed">
              Waiting for the next lines from the interactive session. Open <strong>Raw</strong> for the full TTY.
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

  const rawForFooter = awaitingHintSource ?? transcript;
  const liveFooterLine = useMemo(() => extractPtyLiveFooterLine(rawForFooter), [rawForFooter]);

  const showActivityRow = showThinking || Boolean(liveFooterLine);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript, showThinking, liveFooterLine]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottomRef.current = gap < 120;
  };

  const visibleTurns = useMemo(() => {
    const base = displayTurns.filter((m) => m.role === 'user' || m.text.trim().length > 0);
    if (!lastManualInput) return base;

    const lastUser = base.slice().reverse().find((m) => m.role === 'user');
    const naturallyEchoed = lastUser && lastUser.text.trim() === lastManualInput.text.trim();

    if (!naturallyEchoed && Date.now() - lastManualInput.time < 45000) {
      return [...base, { id: `manual-${lastManualInput.time}`, role: 'user' as const, text: lastManualInput.text }];
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
    if (showActivityRow) {
      return (
        <div className="rounded-2xl border border-indigo-100 bg-white shadow-sm overflow-hidden">
          <p className="text-xs text-indigo-800 px-4 py-3 border-b border-indigo-100 bg-indigo-50/60">
            Live PTY — waiting for the assistant after your last line.
          </p>
          <div className="px-4 py-8 md:px-8 max-h-[min(75vh,720px)] overflow-y-auto bg-white space-y-4">
            {liveFooterLine ? <TerminalLiveFooterBar text={liveFooterLine} /> : null}
            {!liveFooterLine ? <PtyAssistantPending /> : null}
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
        {showActivityRow ? (
          <div className="space-y-3">
            {liveFooterLine ? <TerminalLiveFooterBar text={liveFooterLine} /> : null}
            {showThinking && !liveFooterLine ? <PtyAssistantPending /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
