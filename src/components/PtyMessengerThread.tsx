import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  getPtyParseNormalizedPlain,
  isAwaitingPtyAssistantResponse,
  parsePtyTranscriptToMessages,
  parsePtyTranscriptToMessagesForPrettyLayout,
  trimTrailingTrivialAssistantTurns,
  type ChatTurn,
  type ChatTurnWithEnd
} from '../../shared/parsePtyTranscriptToMessages';
import { segmentPtyAssistantDisplayBlocks } from '../../shared/segmentPtyDiffBlocks';
import { extractPtyLiveFooterLine } from '../../shared/extractPtyLiveFooterLine';
import PtyAssistantBody, { PtyChoicePromptCard, type PtyMenuSlotBundle } from './PtyAssistantBody';

export type PtyManualReplyBubble = {
  id: string;
  /** Text shown in the right-aligned bubble. */
  text: string;
  /** When the user clicked Send (for ordering among same anchor + clock label). */
  sentAt: number;
  /**
   * `getPtyParseNormalizedPlain(transcript)` length at send time — places the bubble after the PTY
   * content that was already on screen.
   */
  transcriptLenAtSend: number;
};

export type PtyArchivedChoiceMenu = {
  id: string;
  /** Plain text of the yellow menu card at send time (same segmentation as live Pretty). */
  menuPlain: string;
  sentAt: number;
  transcriptLenAtSend: number;
};

type PtyMessengerThreadProps = {
  transcript: string;
  /**
   * Optional unsanitized PTY text (e.g. merged archive before Pretty sanitizer). Used only to decide
   * whether to show “Claude is responding…” while spinners are stripped from `transcript`.
   */
  awaitingHintSource?: string;
  /**
   * Logon xterm display slice (same cadence as Raw). Prefer this for the live footer so timer/tokens
   * match Raw; merged archive can lag on in-place CR redraws.
   */
  liveFooterPlainSource?: string;
  /**
   * Each Pretty “Reply via PTY” send is merged by transcript anchor so back-to-back answers stay
   * after the menu they answered, not at the very bottom.
   */
  manualReplyBubbles?: PtyManualReplyBubble[];
  /** Frozen yellow menus captured when the user replied (live buffer may clear the menu). */
  archivedChoiceMenus?: PtyArchivedChoiceMenu[];
};

/** Re-run footer extraction on this cadence so the status bar catches buffer updates even if React skips a frame. */
const PRETTY_FOOTER_POLL_MS = 4000;

function formatBubbleTime(sentAt: number): string {
  try {
    return new Date(sentAt).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return '';
  }
}

/** After turn index `i` (0-based), i.e. before turn `i+1`; `-1` = before all parsed turns. */
function slotAfterTranscriptOffset(offset: number, base: ChatTurnWithEnd[]): number {
  let slot = -1;
  for (let i = 0; i < base.length; i++) {
    if (base[i].endOffset <= offset) slot = i;
    else break;
  }
  return slot;
}

type MergedRow =
  | { kind: 'pty'; turn: ChatTurn }
  | { kind: 'manual'; manual: PtyManualReplyBubble }
  | { kind: 'archivedMenu'; archived: PtyArchivedChoiceMenu };

function menuSnapshotStillInAssistantText(assistantPlain: string, menuPlain: string): boolean {
  const want = menuPlain.replace(/\r\n/g, '\n').trim();
  if (!want) return false;
  for (const p of segmentPtyAssistantDisplayBlocks(assistantPlain)) {
    if (p.kind === 'menu' && p.text.replace(/\r\n/g, '\n').trim() === want) return true;
  }
  return false;
}

/** Avoid two identical yellow cards while the live buffer still contains the same menu block. */
function filterArchivedMenusHiddenWhileLiveDuplicate(rows: MergedRow[]): MergedRow[] {
  const out: MergedRow[] = [];
  for (const row of rows) {
    if (row.kind === 'archivedMenu') {
      const prev = out[out.length - 1];
      if (
        prev?.kind === 'pty' &&
        prev.turn.role === 'assistant' &&
        menuSnapshotStillInAssistantText(prev.turn.text, row.archived.menuPlain)
      ) {
        continue;
      }
    }
    out.push(row);
  }
  return out;
}

type AnchoredForMerge =
  | { flavour: 'manual'; transcriptLenAtSend: number; sentAt: number; id: string; manual: PtyManualReplyBubble }
  | { flavour: 'archived'; transcriptLenAtSend: number; sentAt: number; id: string; archived: PtyArchivedChoiceMenu };

/**
 * Split raw assistant text so the normalized prefix up to `prefixNormLen` maps to the first chunk
 * (monotonic in raw length after stripAnsi / normalize).
 */
function splitTurnAtNormalizedLength(raw: string, prefixNormLen: number): [string, string] {
  if (prefixNormLen <= 0) return ['', raw];
  const fullLen = getPtyParseNormalizedPlain(raw).length;
  if (prefixNormLen >= fullLen) return [raw, ''];
  let lo = 0;
  let hi = raw.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const len = getPtyParseNormalizedPlain(raw.slice(0, mid)).length;
    if (len <= prefixNormLen) lo = mid;
    else hi = mid - 1;
  }
  return [raw.slice(0, lo), raw.slice(lo)];
}

/**
 * When Pretty Reply archives land in the bucket *after* a growing assistant turn, the live PTY tail
 * (newer fetch) appears above older yellow cards. Split the assistant at the earliest archived anchor
 * so chronological order is: assistant prefix → recorded menus / replies → assistant tail (live menus).
 */
function interleaveArchivedWithinLastAssistant(
  rows: MergedRow[],
  transcript: string,
  baseFiltered: ChatTurnWithEnd[]
): MergedRow[] {
  if (!getPtyParseNormalizedPlain(transcript).trim() || rows.length === 0) return rows;

  const asstRowIdx: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === 'pty' && row.turn.role === 'assistant') asstRowIdx.push(i);
  }
  if (asstRowIdx.length === 0) return rows;
  const mergedAsstIdx = asstRowIdx[asstRowIdx.length - 1]!;
  const asstRow = rows[mergedAsstIdx];
  if (asstRow.kind !== 'pty') return rows;
  const turn = asstRow.turn;
  if (turn.role !== 'assistant' || turn.id.includes('__')) return rows;

  const kb = baseFiltered.findIndex((b) => b.role === 'assistant' && b.id === turn.id);
  if (kb < 0) return rows;
  const turnStart = kb > 0 ? baseFiltered[kb - 1].endOffset : 0;
  const turnEnd = baseFiltered[kb].endOffset;

  const tail: MergedRow[] = [];
  let j = mergedAsstIdx + 1;
  while (j < rows.length && (rows[j].kind === 'archivedMenu' || rows[j].kind === 'manual')) {
    tail.push(rows[j]);
    j++;
  }
  if (tail.length === 0) return rows;

  const anchorLens = tail.map((r) =>
    r.kind === 'manual' ? r.manual.transcriptLenAtSend : r.kind === 'archivedMenu' ? r.archived.transcriptLenAtSend : 0
  );
  const minAnchor = Math.min(...anchorLens);
  if (minAnchor <= turnStart || minAnchor >= turnEnd) return rows;

  /**
   * `turnStart`/`turnEnd` are offsets in the full normalized transcript; `turn.text` is a slice whose
   * own normalized length can differ (trimEnd, etc.). Map the global anchor into this turn’s
   * coordinate system before splitting — otherwise the live tail can stay in `head` and render
   * above archived cards.
   */
  const gSpan = turnEnd - turnStart;
  const tn = getPtyParseNormalizedPlain(turn.text).length;
  const relCut =
    gSpan <= 0 ? 0 : Math.min(tn, Math.max(0, Math.round(((minAnchor - turnStart) * tn) / gSpan)));
  const [headText, tailText] = splitTurnAtNormalizedLength(turn.text, relCut);
  if (!tailText.trim()) return rows;

  const headTurn: ChatTurn | null = headText.trim()
    ? { ...turn, text: headText, id: `${turn.id}__pre` }
    : null;
  const tailTurn: ChatTurn = { ...turn, text: tailText, id: `${turn.id}__post` };

  const tailSorted = [...tail].sort((a, b) => {
    const ta = a.kind === 'manual' ? a.manual.sentAt : a.kind === 'archivedMenu' ? a.archived.sentAt : 0;
    const tb = b.kind === 'manual' ? b.manual.sentAt : b.kind === 'archivedMenu' ? b.archived.sentAt : 0;
    if (ta !== tb) return ta - tb;
    if (a.kind !== b.kind) return a.kind === 'archivedMenu' ? -1 : 1;
    const ida = a.kind === 'manual' ? a.manual.id : a.kind === 'archivedMenu' ? a.archived.id : '';
    const idb = b.kind === 'manual' ? b.manual.id : b.kind === 'archivedMenu' ? b.archived.id : '';
    return ida.localeCompare(idb);
  });

  const out: MergedRow[] = [...rows.slice(0, mergedAsstIdx)];
  if (headTurn) out.push({ kind: 'pty', turn: headTurn });
  for (const r of tailSorted) out.push(r);
  out.push({ kind: 'pty', turn: tailTurn });
  out.push(...rows.slice(mergedAsstIdx + 1 + tail.length));
  return out;
}

function mergeParsedTurnsWithManualAndArchived(
  base: ChatTurnWithEnd[],
  manuals: PtyManualReplyBubble[],
  archivedMenus: PtyArchivedChoiceMenu[]
): MergedRow[] {
  const anchored: AnchoredForMerge[] = [
    ...manuals.map((m) => ({
      flavour: 'manual' as const,
      transcriptLenAtSend: m.transcriptLenAtSend,
      sentAt: m.sentAt,
      id: m.id,
      manual: m
    })),
    ...archivedMenus.map((a) => ({
      flavour: 'archived' as const,
      transcriptLenAtSend: a.transcriptLenAtSend,
      sentAt: a.sentAt,
      id: a.id,
      archived: a
    }))
  ];
  const sortedAnchored = [...anchored].sort((x, y) => {
    const sx = slotAfterTranscriptOffset(x.transcriptLenAtSend, base);
    const sy = slotAfterTranscriptOffset(y.transcriptLenAtSend, base);
    if (sx !== sy) return sx - sy;
    if (x.sentAt !== y.sentAt) return x.sentAt - y.sentAt;
    if (x.flavour === y.flavour) return x.id.localeCompare(y.id);
    return x.flavour === 'archived' ? -1 : 1;
  });

  const buckets: AnchoredForMerge[][] = Array.from({ length: base.length }, () => []);
  const beforeAll: AnchoredForMerge[] = [];
  for (const item of sortedAnchored) {
    const s = slotAfterTranscriptOffset(item.transcriptLenAtSend, base);
    if (s < 0) beforeAll.push(item);
    else buckets[s].push(item);
  }

  const out: MergedRow[] = [];
  for (const item of beforeAll) {
    if (item.flavour === 'manual') out.push({ kind: 'manual', manual: item.manual });
    else out.push({ kind: 'archivedMenu', archived: item.archived });
  }
  for (let i = 0; i < base.length; i++) {
    const { endOffset, ...turn } = base[i];
    void endOffset;
    out.push({ kind: 'pty', turn });
    for (const item of buckets[i]) {
      if (item.flavour === 'manual') out.push({ kind: 'manual', manual: item.manual });
      else out.push({ kind: 'archivedMenu', archived: item.archived });
    }
  }
  return out;
}

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
export default function PtyMessengerThread({
  transcript,
  awaitingHintSource,
  liveFooterPlainSource,
  manualReplyBubbles = [],
  archivedChoiceMenus = []
}: PtyMessengerThreadProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  /** Per assistant `turn.id` — survives `PtyAssistantBody` remounts so menu clocks stay honest. */
  const ptyMenuSlotBundlesRef = useRef(new Map<string, PtyMenuSlotBundle>());
  const [footerPollTick, setFooterPollTick] = useState(0);

  useEffect(() => {
    if (!transcript.trim()) ptyMenuSlotBundlesRef.current.clear();
  }, [transcript]);

  const menuSlotBundleForTurn = (turnId: string): PtyMenuSlotBundle => {
    const m = ptyMenuSlotBundlesRef.current;
    if (!m.has(turnId)) m.set(turnId, { slots: [], nextId: 0 });
    return m.get(turnId)!;
  };

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

  const footerPlainSource =
    liveFooterPlainSource && liveFooterPlainSource.trim().length > 0
      ? liveFooterPlainSource
      : (awaitingHintSource ?? transcript);
  const liveFooterLine = useMemo(
    () => extractPtyLiveFooterLine(footerPlainSource),
    [footerPlainSource, footerPollTick]
  );

  /**
   * Ink leaves the final timer/tokens “Thinking…” line in the xterm tail even after the answer is done;
   * the same line is often already inside the last assistant bubble. Hide the duplicate mirror footer.
   */
  const liveFooterLineDeduped = useMemo(() => {
    const line = liveFooterLine?.trim();
    if (!line || line.length < 16) return liveFooterLine;
    const turns = displayTurns;
    const last = turns[turns.length - 1];
    if (!last || last.role !== 'assistant') return liveFooterLine;
    const body = last.text.replace(/\r\n/g, '\n');
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    if (norm(body).includes(norm(line))) return null;
    return liveFooterLine;
  }, [liveFooterLine, displayTurns]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setFooterPollTick((n) => n + 1);
    }, PRETTY_FOOTER_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  const showActivityRow = showThinking || Boolean(liveFooterLineDeduped);

  const mergedRows = useMemo(() => {
    const baseWithEnds = parsePtyTranscriptToMessagesForPrettyLayout(transcript);
    const baseFiltered = baseWithEnds.filter((m) => m.role === 'user' || m.text.trim().length > 0);
    const manuals = (manualReplyBubbles ?? []).filter((b) => b.text.length > 0);
    const archived = (archivedChoiceMenus ?? []).filter((a) => a.menuPlain.trim().length > 0);
    if (manuals.length === 0 && archived.length === 0) {
      return displayTurns
        .filter((m) => m.role === 'user' || m.text.trim().length > 0)
        .map((turn) => ({ kind: 'pty' as const, turn }));
    }
    const merged = filterArchivedMenusHiddenWhileLiveDuplicate(
      mergeParsedTurnsWithManualAndArchived(baseFiltered, manuals, archived)
    );
    return interleaveArchivedWithinLastAssistant(merged, transcript, baseFiltered);
  }, [transcript, manualReplyBubbles, archivedChoiceMenus, displayTurns]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript, showThinking, liveFooterLineDeduped, manualReplyBubbles, archivedChoiceMenus, mergedRows]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottomRef.current = gap < 120;
  };

  if (mergedRows.length === 0) {
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
            {liveFooterLineDeduped ? <TerminalLiveFooterBar text={liveFooterLineDeduped} /> : null}
            {!liveFooterLineDeduped ? <PtyAssistantPending /> : null}
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
        {mergedRows.map((row) =>
          row.kind === 'pty' ? (
            row.turn.role === 'assistant' ? (
              <div key={row.turn.id} className="flex justify-start w-full">
                <div className="w-full max-w-[min(100%,44rem)] md:max-w-[56rem] pr-2 md:pr-16">
                  <div className="rounded-2xl border border-gray-100 bg-white px-4 py-5 md:px-6 md:py-5 shadow-sm">
                    <PtyAssistantBody text={row.turn.text} menuSlotBundle={menuSlotBundleForTurn(row.turn.id)} />
                  </div>
                </div>
              </div>
            ) : (
              <div key={row.turn.id} className="flex justify-end w-full">
                <div className="max-w-[min(100%,85%)] sm:max-w-[32rem] pl-8 sm:pl-12">
                  <div className="rounded-[1.35rem] bg-[#ececec] text-gray-900 px-4 py-2.5 md:px-5 md:py-3 text-[15px] leading-6 whitespace-pre-wrap break-words shadow-sm">
                    {row.turn.text}
                  </div>
                </div>
              </div>
            )
          ) : row.kind === 'archivedMenu' ? (
            <div key={row.archived.id} className="flex justify-start w-full">
              <div className="w-full max-w-[min(100%,44rem)] md:max-w-[56rem] pr-2 md:pr-16">
                <PtyChoicePromptCard
                  text={row.archived.menuPlain}
                  recorded
                  shownAt={row.archived.sentAt}
                />
              </div>
            </div>
          ) : (
            <div key={row.manual.id} className="flex justify-end w-full">
              <div className="max-w-[min(100%,85%)] sm:max-w-[32rem] pl-8 sm:pl-12 flex flex-col items-end gap-1">
                <div className="rounded-[1.35rem] bg-indigo-100/90 text-gray-900 px-4 py-2.5 md:px-5 md:py-3 text-[15px] leading-6 whitespace-pre-wrap break-words shadow-sm border border-indigo-200/80">
                  {row.manual.text}
                </div>
                <time
                  className="text-[10px] font-medium text-gray-500 tabular-nums pr-1"
                  dateTime={new Date(row.manual.sentAt).toISOString()}
                  title={`Sent at ${new Date(row.manual.sentAt).toISOString()}`}
                >
                  {formatBubbleTime(row.manual.sentAt)}
                </time>
              </div>
            </div>
          )
        )}
        {showActivityRow ? (
          <div className="space-y-3">
            {liveFooterLineDeduped ? <TerminalLiveFooterBar text={liveFooterLineDeduped} /> : null}
            {showThinking && !liveFooterLineDeduped ? <PtyAssistantPending /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
