import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  getPtyParseNormalizedPlain,
  isAwaitingPtyAssistantResponse,
  isPtyAssistantNoiseLine,
  parsePtyTranscriptToMessages,
  parsePtyTranscriptToMessagesForPrettyLayout,
  trimTrailingTrivialAssistantTurns,
  type ChatTurn,
  type ChatTurnWithEnd
} from '../../shared/parsePtyTranscriptToMessages';
import { textContainsClaudePermissionMenu } from '../../shared/claudeCodePtyPermissionMenu';
import { isInkSpinnerTokenStatusLine } from '../../shared/inkSpinnerTokenStatusLine';
import { segmentPtyAssistantDisplayBlocks } from '../../shared/segmentPtyDiffBlocks';
import {
  extractPtyLiveFooterLine,
  stripInkStatusFooterLinesFromAssistantPlain
} from '../../shared/extractPtyLiveFooterLine';
import { splitPinnedAssistantStreamHeadTail } from '../../shared/splitPtyPinnedThinkingTail';
import PtyAssistantBody, {
  PtyChoicePromptCard,
  shouldRenderPtyAssistantBubble,
  type PtyAssistantMenusRender,
  type PtyMenuSlotBundle
} from './PtyAssistantBody';

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

/** PTY thread labels — include milliseconds so back-to-back menus/replies in the same second stay distinguishable. */
function formatBubbleTime(sentAt: number): string {
  try {
    return new Date(sentAt).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  } catch {
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

/** Last assistant row in document order whose segmented body includes a live choice menu (Pretty yellow card). */
function findLastAssistantRowIndexWithMenu(rows: MergedRow[]): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.kind === 'pty' && r.turn.role === 'assistant') {
      if (segmentPtyAssistantDisplayBlocks(r.turn.text).some((p) => p.kind === 'menu')) return i;
    }
  }
  return null;
}

function findLastAssistantRowIndex(rows: MergedRow[]): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.kind === 'pty' && r.turn.role === 'assistant') return i;
  }
  return null;
}

function menuSnapshotStillInAssistantText(assistantPlain: string, menuPlain: string): boolean {
  const want = menuPlain.replace(/\r\n/g, '\n').trim();
  if (!want) return false;
  for (const p of segmentPtyAssistantDisplayBlocks(assistantPlain)) {
    if (p.kind === 'menu' && p.text.replace(/\r\n/g, '\n').trim() === want) return true;
  }
  return false;
}

/**
 * Avoid two identical yellow cards while the live buffer still contains the same menu block.
 * After interleave, the live menu may sit in the `__post` assistant while archived rows sit between
 * `__pre` and `__post`, so we also scan **forward** for the next assistant chunk.
 */
function filterArchivedMenusHiddenWhileLiveDuplicate(rows: MergedRow[]): MergedRow[] {
  const out: MergedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === 'archivedMenu') {
      let prevAsst = '';
      for (let j = out.length - 1; j >= 0; j--) {
        const r = out[j];
        if (r.kind === 'pty' && r.turn.role === 'assistant') {
          prevAsst = r.turn.text;
          break;
        }
      }
      let nextAsst = '';
      for (let j = i + 1; j < rows.length; j++) {
        const r = rows[j];
        if (r.kind === 'pty' && r.turn.role === 'assistant') {
          nextAsst = r.turn.text;
          break;
        }
      }
      if (
        menuSnapshotStillInAssistantText(prevAsst, row.archived.menuPlain) ||
        menuSnapshotStillInAssistantText(nextAsst, row.archived.menuPlain)
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

/** Claude Code compact “+N more tool uses (ctrl+o…)” — live status chrome, not narrative. */
function isPtyInlineMoreToolUsesLine(line: string): boolean {
  const t = (line ?? '').replace(/\r/g, '').trim();
  if (t.length < 8 || t.length > 160) return false;
  return (
    /^\+\d+\s+more\s+tool\s+uses\b/i.test(t) ||
    /\bctrl\+o\s+to\s+expand\b/i.test(t) ||
    /\bctrl\+b\s+to\s+run\s+in\s+background\b/i.test(t)
  );
}

/**
 * Move Ink / spinner / tip / “+N more tools” lines out of `__pre` into the live tail **in document order**.
 * Trailing-only peel misses “* Crunching…” when a `PATCH / DIFF` banner or other non-noise line follows it
 * in the same head chunk — those status lines must still render below recorded menus + Reply bubbles.
 */
function partitionInterleavedHeadNoiseToTail(raw: string): [string, string] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  const pulled: string[] = [];
  for (const line of lines) {
    if (
      isPtyAssistantNoiseLine(line) ||
      isInkSpinnerTokenStatusLine(line) ||
      isPtyInlineMoreToolUsesLine(line)
    ) {
      pulled.push(line);
    } else {
      kept.push(line);
    }
  }
  const headJoined = kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  return [headJoined, pulled.join('\n')];
}

/** Last permission menu block from the **same** segmentation as Pretty cards — substring-safe in `headPlain`. */
function findLastPermissionMenuTextFromSegments(plain: string): string | null {
  const parts = segmentPtyAssistantDisplayBlocks(plain);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.kind === 'menu' && textContainsClaudePermissionMenu(p.text)) {
      return p.text;
    }
  }
  return null;
}

function splitAtLastOccurrenceOfMenu(hay: string, menuText: string): { before: string; menu: string; after: string } | null {
  const h = hay.replace(/\r\n/g, '\n');
  const want = menuText.replace(/\r\n/g, '\n');
  let from = h.lastIndexOf(want);
  let matchLen = want.length;
  if (from < 0) {
    const w2 = want.trim();
    from = h.lastIndexOf(w2);
    if (from < 0) return null;
    matchLen = w2.length;
  }
  return {
    before: h.slice(0, from),
    menu: h.slice(from, from + matchLen),
    after: h.slice(from + matchLen)
  };
}

/**
 * After several fetch prompts, `__pre` can still contain one or more permission menus (anchor/split
 * drift). Peel **iteratively** from the end of `head`: each pass removes the last segmented menu.
 * Uses `segmentPtyAssistantDisplayBlocks` (not the archive tail window) so `lastIndexOf` always matches
 * the same bytes Pretty renders — otherwise the live card stays stuck above recorded rows.
 * - Menus whose plain text matches a frozen archived snapshot are stripped from `__pre` only (dedupe
 *   with the yellow card) and are not re-appended to the tail.
 * - All other menus are collected in chronological order and prepended to the live tail.
 * - Any text *after* the menu in `head` logically belongs in the tail (it was generated after the menu),
 *   so it is also moved to the tail.
 */
function reconcileInterleavedAssistantHeadMenus(headPlain: string, tailRows: MergedRow[]): [string, string, number] {
  const archivedNorm = new Set(
    tailRows
      .filter((r): r is MergedRow & { kind: 'archivedMenu' } => r.kind === 'archivedMenu')
      .map((r) => r.archived.menuPlain.replace(/\r\n/g, '\n').trim())
  );
  let head = headPlain;
  const toTailPieces: string[] = [];
  let movedLiveChunks = 0;
  for (let iter = 0; iter < 12; iter++) {
    const prev = head;
    const snapRaw = findLastPermissionMenuTextFromSegments(head);
    if (!snapRaw?.trim() || !textContainsClaudePermissionMenu(snapRaw)) break;
    const trimChunk = snapRaw.replace(/\r\n/g, '\n').trim();
    
    const split = splitAtLastOccurrenceOfMenu(head, snapRaw);
    if (!split) break;
    
    head = split.before.replace(/\s+$/, '');
    
    if (split.after.trim()) {
      toTailPieces.unshift(split.after.replace(/^\s+/, ''));
    }
    
    if (!archivedNorm.has(trimChunk)) {
      toTailPieces.unshift(split.menu);
      movedLiveChunks++;
    }
    
    if (head === prev) break;
  }
  return [head, toTailPieces.join('\n\n'), movedLiveChunks];
}

/**
 * When Pretty Reply archives land in the bucket *after* a growing assistant turn, the live PTY tail
 * (newer fetch) appears above older yellow cards. Split the assistant at the earliest archived anchor
 * so chronological order is: assistant prefix → recorded menus / replies → assistant tail (live menus).
 */
function interleaveArchivedWithinLastAssistant(
  rows: MergedRow[],
  transcript: string,
  baseFiltered: ChatTurnWithEnd[],
  sortTailBySentAt: boolean
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
  if (minAnchor <= turnStart) {
    // #region agent log
    fetch('http://127.0.0.1:7823/ingest/0f30680b-0aa0-4d4a-ba6d-262bf6a78290', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '456dbf' },
      body: JSON.stringify({
        sessionId: '456dbf',
        runId: 'verify-v1',
        hypothesisId: 'H2',
        location: 'PtyMessengerThread.tsx:interleave',
        message: 'skip split — anchor outside turn span',
        data: { turnId: turn.id, turnStart, turnEnd, minAnchor },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    return rows;
  }

  /**
   * `turnStart`/`turnEnd` are offsets in the full normalized transcript; `turn.text` is a slice whose
   * own normalized length can differ (trimEnd, etc.). Map the global anchor into this turn’s
   * coordinate system before splitting — otherwise the live tail can stay in `head` and render
   * above archived cards.
   */
  const tFull = getPtyParseNormalizedPlain(transcript);
  const sliceInT = tFull.slice(turnStart, turnEnd);
  const sliceTrim = sliceInT.trimEnd();
  const nt = getPtyParseNormalizedPlain(turn.text);
  const tn = nt.length;
  const gSpan = turnEnd - turnStart;
  const gLocal = minAnchor - turnStart;
  /**
   * `endOffset` spans the full normalized segment in `tFull`, while `turn.text` is the parsed assistant slice
   * (often `trimEnd`). A linear ratio across mismatched lengths maps the anchor into the wrong place and keeps
   * the live PTY tail in `headText` (newer menu above archived rows). Prefer exact / trim / prefix alignment.
   */
  let relCut: number;
  if (gSpan > 0 && tn > 0 && nt === sliceInT) {
    relCut = Math.max(0, Math.min(tn, gLocal));
  } else if (gSpan > 0 && tn > 0 && nt === sliceTrim) {
    const eff = Math.min(gLocal, sliceTrim.length);
    relCut = Math.max(0, Math.min(tn, eff));
  } else if (tn > 0 && sliceTrim.startsWith(nt)) {
    relCut = Math.max(0, Math.min(tn, gLocal));
  } else if (tn > 0 && sliceTrim.endsWith(nt)) {
    const skip = sliceTrim.length - tn;
    relCut = Math.max(0, Math.min(tn, gLocal - skip));
  } else {
    relCut = gSpan <= 0 ? 0 : Math.min(tn, Math.max(0, Math.round((gLocal * tn) / gSpan)));
  }
  let [headText, tailText] = splitTurnAtNormalizedLength(turn.text, relCut);
  const [headParted, noisePulled] = partitionInterleavedHeadNoiseToTail(headText);
  if (noisePulled.trim()) {
    headText = headParted;
    tailText = [noisePulled, tailText].filter((x) => x.trim().length > 0).join('\n');
  }
  let menuPeelLen = 0;
  let menuPeelIters = 0;
  if (tail.length > 0) {
    const [hMenu, menusToTail, liveChunks] = reconcileInterleavedAssistantHeadMenus(headText, tail);
    menuPeelIters = liveChunks;
    menuPeelLen = menusToTail.trim().length;
    if (hMenu !== headText || menusToTail.trim()) {
      headText = hMenu;
      if (menusToTail.trim()) {
        tailText = [menusToTail, tailText].filter((x) => x.trim().length > 0).join('\n');
      }
    }
  }

  // NEW: Push the thinking stream to the tail so it renders below the recorded prompts!
  const { head: thinkHead, tail: thinkTail } = splitPinnedAssistantStreamHeadTail(headText);
  if (thinkTail.trim()) {
    headText = thinkHead;
    tailText = [thinkTail, tailText].filter((x) => x.trim().length > 0).join('\n');
  }

  // #region agent log
  fetch('http://127.0.0.1:7823/ingest/0f30680b-0aa0-4d4a-ba6d-262bf6a78290', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '456dbf' },
    body: JSON.stringify({
      sessionId: '456dbf',
      runId: 'verify-v3',
      hypothesisId: 'H5',
      location: 'PtyMessengerThread.tsx:interleave',
      message: 'split last assistant for archived/manual',
      data: {
        turnId: turn.id,
        turnStart,
        turnEnd,
        gSpan,
        minAnchor,
        gLocal,
        sliceLen: sliceInT.length,
        sliceTrimLen: sliceTrim.length,
        tn,
        eqSlice: nt === sliceInT,
        eqTrim: nt === sliceTrim,
        pref: sliceTrim.startsWith(nt),
        suff: sliceTrim.endsWith(nt),
        relCut,
        partPulledLines: noisePulled ? noisePulled.split('\n').filter((l) => l.trim()).length : 0,
        partPulledNormLen: getPtyParseNormalizedPlain(noisePulled).length,
        menuPeelLen,
        menuPeelIters,
        headNormLen: getPtyParseNormalizedPlain(headText).length,
        tailNormLen: getPtyParseNormalizedPlain(tailText).length,
        tailHasFetch: /\bFetch\s+https?:/i.test(tailText),
        headHasFetch: /\bFetch\s+https?:/i.test(headText),
        headInkLineCount: headText.split('\n').filter((l) => isInkSpinnerTokenStatusLine(l)).length,
        tailEmpty: !tailText.trim()
      },
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
  if (!tailText.trim()) return rows;

  const headTurn: ChatTurn | null = headText.trim()
    ? { ...turn, text: headText, id: `${turn.id}__pre` }
    : null;
  const tailTurn: ChatTurn = { ...turn, text: tailText, id: `${turn.id}__post` };

  /** While Claude is still “thinking” (awaiting assistant), keep merge order so status/footer can stay visually stable at the bottom; re-sort by `sentAt` once thinking stops. */
  const tailSorted = sortTailBySentAt
    ? [...tail].sort((a, b) => {
        const ta = a.kind === 'manual' ? a.manual.sentAt : a.kind === 'archivedMenu' ? a.archived.sentAt : 0;
        const tb = b.kind === 'manual' ? b.manual.sentAt : b.kind === 'archivedMenu' ? b.archived.sentAt : 0;
        if (ta !== tb) return ta - tb;
        if (a.kind !== b.kind) return a.kind === 'archivedMenu' ? -1 : 1;
        const ida = a.kind === 'manual' ? a.manual.id : a.kind === 'archivedMenu' ? a.archived.id : '';
        const idb = b.kind === 'manual' ? b.manual.id : b.kind === 'archivedMenu' ? b.archived.id : '';
        return ida.localeCompare(idb);
      })
    : [...tail];

  const out: MergedRow[] = [...rows.slice(0, mergedAsstIdx)];
  if (headTurn) out.push({ kind: 'pty', turn: headTurn });
  for (const r of tailSorted) out.push(r);
  out.push({ kind: 'pty', turn: tailTurn });
  out.push(...rows.slice(mergedAsstIdx + 1 + tail.length));
  return out;
}

type AnchoredWithSeq = AnchoredForMerge & { mergeSeq: number };

function mergeParsedTurnsWithManualAndArchived(
  base: ChatTurnWithEnd[],
  manuals: PtyManualReplyBubble[],
  archivedMenus: PtyArchivedChoiceMenu[],
  sortAnchoredBySentAt: boolean
): MergedRow[] {
  let mergeSeq = 0;
  const anchored: AnchoredWithSeq[] = [
    ...manuals.map((m) => ({
      flavour: 'manual' as const,
      transcriptLenAtSend: m.transcriptLenAtSend,
      sentAt: m.sentAt,
      id: m.id,
      manual: m,
      mergeSeq: mergeSeq++
    })),
    ...archivedMenus.map((a) => ({
      flavour: 'archived' as const,
      transcriptLenAtSend: a.transcriptLenAtSend,
      sentAt: a.sentAt,
      id: a.id,
      archived: a,
      mergeSeq: mergeSeq++
    }))
  ];
  const sortedAnchored = [...anchored].sort((x, y) => {
    const sx = slotAfterTranscriptOffset(x.transcriptLenAtSend, base);
    const sy = slotAfterTranscriptOffset(y.transcriptLenAtSend, base);
    if (sx !== sy) return sx - sy;
    if (sortAnchoredBySentAt) {
      if (x.sentAt !== y.sentAt) return x.sentAt - y.sentAt;
    } else if (x.mergeSeq !== y.mergeSeq) {
      return x.mergeSeq - y.mergeSeq;
    }
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
  const [stampMs, setStampMs] = useState(() => Date.now());
  useEffect(() => {
    setStampMs(Date.now());
  }, [text]);

  return (
    <div className="flex justify-start w-full">
      <div className="w-full max-w-[min(100%,44rem)] md:max-w-[56rem] pr-2 md:pr-16">
        <div className="rounded-xl border border-zinc-700/95 bg-[#09090b] px-3 py-2.5 shadow-inner ring-1 ring-zinc-800/80 min-h-[5.25rem] flex flex-col">
          <p className="text-[11px] sm:text-[12px] leading-snug font-mono text-zinc-200 whitespace-nowrap overflow-hidden text-ellipsis min-h-[2.75rem] flex-1">
            {text}
          </p>
          <time
            className="mt-1.5 block text-[9px] font-medium tabular-nums text-zinc-500 shrink-0"
            dateTime={new Date(stampMs).toISOString()}
            title="When this status line last changed in Pretty"
          >
            Status — {formatBubbleTime(stampMs)}
          </time>
        </div>
      </div>
    </div>
  );
}

/** Same gray outer ring as Logon-style assistant bubbles — live menus sit inside this; recorded snapshots use it too so cards don’t look “stripped”. */
function PtyThreadAssistantShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white px-4 py-5 md:px-6 md:py-5 shadow-sm">
      {children}
    </div>
  );
}

/** Assistant bubble in the thread; `__post` interleaved tails get a small wall-clock stamp when the PTY tail updates. */
function PtyThreadAssistantBubble({
  turn,
  menuSlotBundle,
  menusRender = 'inline'
}: {
  turn: ChatTurn;
  menuSlotBundle: PtyMenuSlotBundle;
  menusRender?: PtyAssistantMenusRender;
}) {
  if (!shouldRenderPtyAssistantBubble(turn.text, menusRender)) return null;

  const [tailStampMs, setTailStampMs] = useState(() => Date.now());
  useEffect(() => {
    if (turn.id.endsWith('__post')) setTailStampMs(Date.now());
  }, [turn.text, turn.id]);

  const showTailStamp = turn.id.endsWith('__post');

  return (
    <PtyThreadAssistantShell>
      <PtyAssistantBody text={turn.text} menuSlotBundle={menuSlotBundle} menusRender={menusRender} />
      {showTailStamp ? (
        <p className="mt-2 mb-0 text-[10px] font-medium text-gray-500 tabular-nums text-right">
          <time dateTime={new Date(tailStampMs).toISOString()} title="When this live PTY tail last changed in Pretty">
            Live tail — {formatBubbleTime(tailStampMs)}
          </time>
        </p>
      ) : null}
    </PtyThreadAssistantShell>
  );
}

/** Tool / subagent stream peeled from `__pre` while thinking — above pinned live menus, below merge-order bubbles. */
function PtyThinkingActivityStrip({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="flex justify-start w-full">
      <div className="w-full max-w-[min(100%,44rem)] md:max-w-[56rem] pr-2 md:pr-16">
        <div className="rounded-xl border border-zinc-700/95 bg-[#09090b] overflow-hidden shadow-inner ring-1 ring-zinc-800/80">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 bg-zinc-900/95 border-b border-zinc-800">
            Live PTY activity
          </div>
          <pre className="m-0 max-h-[min(50vh,480px)] overflow-auto px-3 py-3 text-[11px] sm:text-[12px] leading-[1.45] font-mono text-zinc-100 whitespace-pre-wrap break-words">
            {text}
          </pre>
        </div>
      </div>
    </div>
  );
}

/** When live menus are pinned below the thread, the inline `__post` bubble may be omitted (menu-only tail); keep the stamp once on the pinned shell. */
function PtyLivePostTailStampUnderShell({ turn }: { turn: ChatTurn }) {
  if (!turn.id.endsWith('__post')) return null;
  const [tailStampMs, setTailStampMs] = useState(() => Date.now());
  useEffect(() => {
    setTailStampMs(Date.now());
  }, [turn.text, turn.id]);
  return (
    <p className="mt-2 mb-0 text-[10px] font-medium text-gray-500 tabular-nums text-right">
      <time dateTime={new Date(tailStampMs).toISOString()} title="When this live PTY tail last changed in Pretty">
        Live tail — {formatBubbleTime(tailStampMs)}
      </time>
    </p>
  );
}

function PtyAssistantPending() {
  return (
    <div className="flex justify-start w-full min-h-[7rem]">
      <div className="w-full max-w-[min(100%,40rem)] md:max-w-[48rem] pr-2 md:pr-16">
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/90 px-5 py-4 shadow-sm flex items-start gap-4 text-indigo-950 min-h-[7rem]">
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
  /** Once Ink/footer or “responding” has shown, keep a fixed bottom band so redraws / dedupe do not shrink the scroller. */
  const [statusWellLatched, setStatusWellLatched] = useState(false);

  useEffect(() => {
    if (!transcript.trim()) {
      ptyMenuSlotBundlesRef.current.clear();
      setStatusWellLatched(false);
    }
  }, [transcript]);

  /** `interleaveArchivedWithinLastAssistant` uses `a-3__pre` / `a-3__post`; share one slot bundle so menu clocks survive the split. */
  const menuBundleTurnKey = (turnId: string) => turnId.replace(/__(?:pre|post)$/u, '');

  const menuSlotBundleForTurn = (turnId: string): PtyMenuSlotBundle => {
    const m = ptyMenuSlotBundlesRef.current;
    const key = menuBundleTurnKey(turnId);
    if (!m.has(key)) m.set(key, { slots: [], nextId: 0 });
    return m.get(key)!;
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

  useEffect(() => {
    const id = window.setInterval(() => {
      setFooterPollTick((n) => n + 1);
    }, PRETTY_FOOTER_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

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
    const sortReplayBySentAt = !showThinking;
    const merged = mergeParsedTurnsWithManualAndArchived(
      baseFiltered,
      manuals,
      archived,
      sortReplayBySentAt
    );
    const filtered = filterArchivedMenusHiddenWhileLiveDuplicate(merged);
    const interleaved = interleaveArchivedWithinLastAssistant(
      filtered,
      transcript,
      baseFiltered,
      sortReplayBySentAt
    );
    return filterArchivedMenusHiddenWhileLiveDuplicate(interleaved);
  }, [transcript, manualReplyBubbles, archivedChoiceMenus, displayTurns, showThinking]);

  /**
   * Live yellow menus: pin to bottom when present.
   */
  const prettyPinnedMenusLayout = useMemo(() => {
    const liveIdx = findLastAssistantRowIndexWithMenu(mergedRows);
    const hasLiveMenuPin = liveIdx !== null;
    const liveDetachTurn =
      hasLiveMenuPin && liveIdx !== null && mergedRows[liveIdx]!.kind === 'pty'
        ? mergedRows[liveIdx]!.turn
        : null;

    return {
      hasLiveMenuPin,
      usePrettyTailWell: hasLiveMenuPin,
      liveIdx,
      liveDetachTurn
    };
  }, [mergedRows]);

  /**
   * Ink leaves the final timer/tokens “Thinking…” line in the xterm tail even after the answer is done;
   * the same line is often already inside the last assistant bubble. Hide the duplicate mirror footer.
   * When menus are pinned, assistant text is stripped of those lines for display — dedupe against stripped text
   * so the mirrored footer still shows at the bottom.
   */
  const liveFooterLineDeduped = useMemo(() => {
    const line = liveFooterLine?.trim();
    if (!line || line.length < 16) return liveFooterLine;
    const turns = displayTurns;
    const last = turns[turns.length - 1];
    if (!last || last.role !== 'assistant') return liveFooterLine;
    const bodyRaw = last.text.replace(/\r\n/g, '\n');
    const body = stripInkStatusFooterLinesFromAssistantPlain(bodyRaw);
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    if (norm(body).includes(norm(line))) return null;
    return liveFooterLine;
  }, [liveFooterLine, displayTurns]);

  const showActivityRow = showThinking || Boolean(liveFooterLineDeduped);

  useEffect(() => {
    if (showActivityRow) setStatusWellLatched(true);
  }, [showActivityRow]);

  const renderPrettyThreadRow = (row: MergedRow, detachLiveMenus: boolean): React.ReactNode =>
    row.kind === 'pty' ? (
      row.turn.role === 'assistant' ? (() => {
        const displayTurn = { ...row.turn, text: stripInkStatusFooterLinesFromAssistantPlain(row.turn.text) };
        return shouldRenderPtyAssistantBubble(displayTurn.text, detachLiveMenus ? 'omit' : 'inline') ? (
          <div key={row.turn.id} className="flex justify-start w-full">
            <div className="w-full max-w-[min(100%,44rem)] md:max-w-[56rem] pr-2 md:pr-16">
              <PtyThreadAssistantBubble
                turn={displayTurn}
                menuSlotBundle={menuSlotBundleForTurn(row.turn.id)}
                menusRender={detachLiveMenus ? 'omit' : 'inline'}
              />
            </div>
          </div>
        ) : (
          <Fragment key={row.turn.id} />
        );
      })() : (
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
          <PtyThreadAssistantShell>
            <PtyChoicePromptCard
              text={row.archived.menuPlain}
              recorded
              shownAt={row.archived.sentAt}
            />
          </PtyThreadAssistantShell>
        </div>
      </div>
    ) : (
      <div key={row.manual.id} className="flex justify-end w-full">
        <div className="max-w-[min(100%,85%)] sm:max-w-[32rem] pl-8 sm:pl-12 w-full flex flex-col items-end">
          {/*
            Not an “unboxed” fetch menu — this is the synthetic row from “Reply via interactive PTY”.
            Amber cards only come from `PtyChoicePromptCard` (live assistant menus + recorded snapshots).
          */}
          <article
            className="w-full rounded-xl border border-indigo-200/95 bg-indigo-50/50 overflow-hidden shadow-sm"
            aria-label="PTY reply sent from Pretty"
          >
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-950/90 bg-indigo-100/90 border-b border-indigo-200/80">
              PTY reply
            </div>
            <div className="px-3 py-3 flex flex-col items-end gap-1">
              <div className="rounded-[1.35rem] bg-indigo-100/90 text-gray-900 px-4 py-2.5 md:px-5 md:py-3 text-[15px] leading-6 whitespace-pre-wrap break-words border border-indigo-200/80">
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
          </article>
        </div>
      </div>
    );

  /** Indigo “responding” card, then Ink timer/tokens line — footer is the last thing in the scroll (below live menus). */
  const tailStatusStack =
    showActivityRow || statusWellLatched ? (
      <div className="space-y-3 w-full flex flex-col justify-end min-h-[5.25rem]">
        {showThinking ? <PtyAssistantPending /> : null}
        <div className="min-h-[5.25rem] w-full flex flex-col justify-end">
          {liveFooterLineDeduped ? <TerminalLiveFooterBar text={liveFooterLineDeduped} /> : null}
        </div>
      </div>
    ) : null;

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
          <div className="px-4 py-8 md:px-8 max-h-[min(45vh,450px)] overflow-y-auto bg-white space-y-4">
            {showThinking ? <PtyAssistantPending /> : null}
            <div className="min-h-[5.25rem] w-full flex flex-col justify-end">
              {liveFooterLineDeduped ? <TerminalLiveFooterBar text={liveFooterLineDeduped} /> : null}
            </div>
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
        <div className="px-4 py-6 md:px-8 max-h-[min(45vh,450px)] overflow-y-auto bg-white">
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
        className="flex flex-col gap-10 md:gap-12 px-4 py-6 md:px-10 md:py-8 max-h-[min(45vh,450px)] min-h-[220px] overflow-y-auto bg-white"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {prettyPinnedMenusLayout.hasLiveMenuPin ? (
          <>
            {mergedRows.map((row, i) =>
              renderPrettyThreadRow(
                row,
                prettyPinnedMenusLayout.liveIdx === i &&
                  row.kind === 'pty' &&
                  row.turn.role === 'assistant'
              )
            )}
            <div className="flex flex-col gap-4 md:gap-5 w-full">
              {prettyPinnedMenusLayout.liveDetachTurn &&
              shouldRenderPtyAssistantBubble(
                stripInkStatusFooterLinesFromAssistantPlain(prettyPinnedMenusLayout.liveDetachTurn.text),
                'menusOnly'
              ) ? (
                <div
                  key={`${prettyPinnedMenusLayout.liveDetachTurn.id}--pinned-live-menus`}
                  className="flex justify-start w-full"
                >
                  <div className="w-full max-w-[min(100%,44rem)] md:max-w-[56rem] pr-2 md:pr-16">
                    <PtyThreadAssistantShell>
                      <PtyAssistantBody
                        text={stripInkStatusFooterLinesFromAssistantPlain(
                          prettyPinnedMenusLayout.liveDetachTurn.text
                        )}
                        menuSlotBundle={menuSlotBundleForTurn(prettyPinnedMenusLayout.liveDetachTurn.id)}
                        menusRender="menusOnly"
                      />
                      {!shouldRenderPtyAssistantBubble(
                        stripInkStatusFooterLinesFromAssistantPlain(prettyPinnedMenusLayout.liveDetachTurn.text),
                        'omit'
                      ) ? (
                        <PtyLivePostTailStampUnderShell
                          turn={{
                            ...prettyPinnedMenusLayout.liveDetachTurn,
                            text: stripInkStatusFooterLinesFromAssistantPlain(
                              prettyPinnedMenusLayout.liveDetachTurn.text
                            )
                          }}
                        />
                      ) : null}
                    </PtyThreadAssistantShell>
                  </div>
                </div>
              ) : null}
              {tailStatusStack}
            </div>
          </>
        ) : (
          mergedRows.map((row) => renderPrettyThreadRow(row, false))
        )}
        {!prettyPinnedMenusLayout.hasLiveMenuPin && (showActivityRow || statusWellLatched) ? (
          <div className="flex flex-col justify-start shrink-0 w-full">
            {tailStatusStack}
          </div>
        ) : null}
      </div>
    </section>
  );
}
