import React, { useMemo, useRef } from 'react';
import { segmentPtyAssistantDisplayBlocks } from '../../shared/segmentPtyDiffBlocks';
import { normalizeAsciiTableForPretty } from '../../shared/normalizeAsciiTableForPretty';
import PrettyOutputBody from './PrettyOutputBody';

function formatChoiceCardTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return '';
  }
}

type PtyChoicePromptCardProps = {
  text: string;
  recorded?: boolean;
  /**
   * Wall clock for ordering next to Reply bubbles: recorded = when the user sent; live = first time
   * Pretty showed this menu block (streaming updates keep the same stamp until the prompt is replaced).
   */
  shownAt?: number | null;
};

/** Shared amber “choice prompt” card — live menus and recorded snapshots after Reply. */
export function PtyChoicePromptCard({ text, recorded = false, shownAt = null }: PtyChoicePromptCardProps) {
  const iso = shownAt != null ? new Date(shownAt).toISOString() : '';
  const title =
    shownAt == null
      ? undefined
      : recorded
        ? `Recorded when you sent your reply (${iso})`
        : `First shown in Pretty at ${iso}`;

  return (
    <div className="rounded-xl border border-amber-200/90 bg-amber-50/90 overflow-hidden shadow-sm">
      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-950/90 bg-amber-100/95 border-b border-amber-200">
        {recorded ? 'PTY choice prompt (recorded)' : 'PTY choice prompt (live)'}
      </div>
      <p className="m-0 px-3 py-2 text-[11px] leading-snug text-amber-950 border-b border-amber-100/80 bg-amber-50/95">
        {recorded ? (
          <>
            Frozen copy from when you sent your reply below — the live PTY buffer may redraw; this keeps the menu
            visible in the thread for context.
          </>
        ) : (
          <>
            Pretty mirrors this menu from the <strong>same live PTY</strong> as Logon / Raw (fetch or tool lines above
            the question appear when segmentation can include them). You cannot activate options by clicking here — use{' '}
            <strong>Logon</strong> or <strong>Reply via PTY</strong> below to send input; Claude Code applies your reply
            to this menu.
          </>
        )}
      </p>
      <pre className="m-0 max-h-[min(40vh,420px)] overflow-auto px-3 py-3 text-[11px] sm:text-[12px] leading-[1.45] font-mono text-amber-950 whitespace-pre">
        {text}
      </pre>
      {shownAt != null ? (
        <time
          className="block text-[10px] font-medium text-amber-900/55 tabular-nums px-3 pb-2.5 pt-0 border-t border-amber-100/70 bg-amber-50/90"
          dateTime={iso}
          title={title}
        >
          {formatChoiceCardTime(shownAt)}
        </time>
      ) : null}
    </div>
  );
}

export type PtyLiveMenuSlot = { id: number; shownAt: number; text: string };

/** Mutable bundle so first-seen menu clocks survive `PtyAssistantBody` remounts (parent key changes). */
export type PtyMenuSlotBundle = { slots: PtyLiveMenuSlot[]; nextId: number };

function wallMsFromPerformanceNow(): number {
  return Math.round(performance.timeOrigin + performance.now());
}

/** Same logical menu while the PTY buffer grows or shrinks slightly; not a new prompt. */
function sameMenuEvolution(prevText: string, curText: string): boolean {
  if (prevText === curText) return true;
  if (curText.startsWith(prevText)) return true;
  if (prevText.startsWith(curText)) return true;
  return false;
}

function findPrevSlotIndex(
  curText: string,
  orderIndex: number,
  prev: PtyLiveMenuSlot[],
  used: Set<number>
): number | null {
  if (orderIndex < prev.length && !used.has(orderIndex) && sameMenuEvolution(prev[orderIndex].text, curText)) {
    return orderIndex;
  }
  for (let j = 0; j < prev.length; j++) {
    if (used.has(j)) continue;
    if (sameMenuEvolution(prev[j].text, curText)) return j;
  }
  return null;
}

/**
 * One stamp per menu *appearance*: new prompts get a fresh time as soon as segmentation exposes them;
 * streaming the same prompt keeps the first time. Multiple new menus in one update get distinct
 * high-resolution times via performance.now().
 */
function reconcileLiveMenuSlots(
  curTexts: string[],
  prevSlots: PtyLiveMenuSlot[],
  nextId: { current: number }
): PtyLiveMenuSlot[] {
  if (curTexts.length === 0) return [];
  const used = new Set<number>();
  const out: PtyLiveMenuSlot[] = [];
  for (let i = 0; i < curTexts.length; i++) {
    const text = curTexts[i];
    const k = findPrevSlotIndex(text, i, prevSlots, used);
    if (k !== null) {
      used.add(k);
      const p = prevSlots[k];
      out.push({ id: p.id, shownAt: p.shownAt, text });
    } else {
      out.push({ id: nextId.current++, shownAt: wallMsFromPerformanceNow(), text });
    }
  }
  return out;
}

type PtyAssistantBodyProps = {
  text: string;
  /**
   * When provided, live menu first-seen timestamps are stored on this object (keyed by parent turn),
   * so they survive remounts when the Pretty pane’s React key changes.
   */
  menuSlotBundle?: PtyMenuSlotBundle | null;
};

/** Renders Live PTY assistant text: diffs / ASCII pipe grids as monospace pre, everything else as Pretty markdown. */
export default function PtyAssistantBody({ text, menuSlotBundle = null }: PtyAssistantBodyProps) {
  const internalSlotsRef = useRef<PtyLiveMenuSlot[]>([]);
  const internalNextIdRef = useRef(0);
  const parts = useMemo(() => segmentPtyAssistantDisplayBlocks(text), [text]);

  if (parts.length === 0) {
    if (menuSlotBundle) {
      menuSlotBundle.slots = [];
      menuSlotBundle.nextId = 0;
    } else {
      internalSlotsRef.current = [];
    }
    return <PrettyOutputBody text={text} />;
  }

  if (parts.length === 1 && parts[0].kind === 'prose') {
    if (menuSlotBundle) {
      menuSlotBundle.slots = [];
      menuSlotBundle.nextId = 0;
    } else {
      internalSlotsRef.current = [];
    }
    return <PrettyOutputBody text={parts[0].text} />;
  }

  const curMenuTexts: string[] = [];
  for (const p of parts) {
    if (p.kind === 'menu') curMenuTexts.push(p.text);
  }

  const nextIdRef = menuSlotBundle
    ? { get current() {
        return menuSlotBundle.nextId;
      }, set current(v: number) {
        menuSlotBundle.nextId = v;
      } }
    : internalNextIdRef;

  const slotsRefTarget = menuSlotBundle ? menuSlotBundle.slots : internalSlotsRef.current;
  const reconciled = reconcileLiveMenuSlots(curMenuTexts, slotsRefTarget, nextIdRef);
  if (menuSlotBundle) {
    menuSlotBundle.slots = reconciled;
  } else {
    internalSlotsRef.current = reconciled;
  }
  const menuSlots = reconciled;

  const menuSlotAtPartIdx = new Map<number, PtyLiveMenuSlot>();
  let mi = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].kind === 'menu') {
      const slot = menuSlots[mi++];
      if (slot) menuSlotAtPartIdx.set(i, slot);
    }
  }

  return (
    <div className="space-y-4">
      {parts.map((p, idx) => {
        if (p.kind === 'diff') {
          return (
            <div
              key={`d-${idx}`}
              className="rounded-xl border border-zinc-800/90 bg-[#09090b] overflow-hidden shadow-inner"
            >
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-900/95 border-b border-zinc-800">
                Patch / diff (monospace)
              </div>
              <pre className="m-0 max-h-[min(65vh,720px)] overflow-auto px-3 py-3 text-[11px] sm:text-[12px] leading-[1.45] font-mono text-zinc-100 whitespace-pre tabular-nums">
                {p.text}
              </pre>
            </div>
          );
        }
        if (p.kind === 'menu') {
          const slot = menuSlotAtPartIdx.get(idx);
          return (
            <div key={slot ? `m-${slot.id}` : `m-${idx}`}>
              <PtyChoicePromptCard text={p.text} shownAt={slot?.shownAt ?? null} />
            </div>
          );
        }
        if (p.kind === 'grid') {
          return (
            <div
              key={`g-${idx}`}
              className="rounded-xl border border-slate-200 bg-slate-50/95 overflow-hidden shadow-sm"
            >
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 bg-slate-100/95 border-b border-slate-200">
                Table (fixed width)
              </div>
              <pre
                className="m-0 max-h-[min(70vh,680px)] overflow-x-auto px-3 py-3 text-[12px] leading-[1.35] font-mono text-slate-900 whitespace-pre break-normal [overflow-wrap:normal] tracking-normal select-text"
                style={{ fontVariantLigatures: 'none', fontFeatureSettings: '"liga" 0, "calt" 0' }}
              >
                {normalizeAsciiTableForPretty(p.text)}
              </pre>
            </div>
          );
        }
        return <PrettyOutputBody key={`p-${idx}`} text={p.text} />;
      })}
    </div>
  );
}
