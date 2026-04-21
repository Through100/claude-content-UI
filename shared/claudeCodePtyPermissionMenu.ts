import { normalizeTeletypeLines, stripAnsi } from './stripAnsi';

/** Web / tool permission menu (Fetch + Esc to cancel footer) — must survive “trivial tail” / chrome filters for dashboard sync. */
export function textContainsClaudePermissionMenu(text: string): boolean {
  const t = (text || '').replace(/\r/g, '');
  /** Fetch consent often omits the Esc/Tab chrome line in the same PTY capture as the numbered choices. */
  if (
    /\bDo you want to allow\b/i.test(t) &&
    /^\s*(?:[❯›>]\s*)?1\.\s+Yes\b/im.test(t)
  ) {
    return true;
  }
  if (
    /\bDo you want to proceed\b/i.test(t) &&
    /^\s*(?:[❯›>]\s*)?1\.\s+Yes\b/im.test(t)
  ) {
    return true;
  }
  if (!/\bEsc to cancel\b/i.test(t) || !/\bTab to (?:amend|edit|change)\b/i.test(t)) return false;
  return (
    /Do you want/i.test(t) ||
    /\bClaude wants to fetch\b/i.test(t) ||
    /^fetch\b/im.test(t) ||
    /\bfetch content from\b/i.test(t)
  );
}

/** Plain PTY text (ANSI stripped, teletype lines normalized) shows Claude Code’s numbered permission menu. */
export function plainTextShowsClaudePermissionMenu(plainNormalized: string): boolean {
  const tail = plainNormalized.slice(-8000);
  if (!/\bEsc to cancel\b/i.test(tail) || !/\bTab to (?:amend|edit|change)\b/i.test(tail)) return false;
  /** Require a numbered option line so we never auto-send on stray footer text alone (e.g. after a PTY restart). */
  if (!/(^|\n)\s*(?:[❯›>]\s*)?\d+\.\s+\S/m.test(tail)) return false;
  return (
    /Do you want to proceed\?/i.test(tail) ||
      /(^|\n)\s*(?:[❯›>]\s*)?\d+\.\s+Yes,/im.test(tail) ||
      /Yes, and don't ask again/i.test(tail)
  );
}

const NUMBERED_MENU_ROW = /(^|\n)\s*(?:[❯›>]\s*)?\d+\.\s+\S/m;

/**
 * True when the PTY tail shows a permission menu we can answer (Esc/Tab “proceed” UI **or** Fetch / compact consent
 * without that footer in the same capture). Used for Reply yes→digit mapping and Logon auto-pick reset/trigger.
 */
export function plainTailShowsAnswerablePermissionMenu(plainNormalized: string): boolean {
  if (plainTextShowsClaudePermissionMenu(plainNormalized)) return true;
  const tail = plainNormalized.slice(-14000);
  if (!NUMBERED_MENU_ROW.test(tail)) return false;
  if (/\bDo you want to allow\b/i.test(tail) && /^\s*(?:[❯›>]\s*)?1\.\s+Yes\b/im.test(tail)) return true;
  if (/\bDo you want to proceed\b/i.test(tail) && /^\s*(?:[❯›>]\s*)?1\.\s+Yes\b/im.test(tail)) return true;
  return false;
}

export function stripAnsiNormalizePtyMirror(raw: string): string {
  return normalizeTeletypeLines(stripAnsi(raw));
}

/** Count “Do you want to proceed?” in PTY text — increments usually mean a new permission ask after the last reply. */
export function countPtyProceedPrompts(raw: string): number {
  const t = stripAnsiNormalizePtyMirror(raw ?? '');
  return (t.match(/Do you want to proceed\?/gi) ?? []).length;
}

/** Numbered options under a permission prompt (`1. Yes`, `❯ 2. No`, `> 3. Yes, …`). */
export function parsePermissionMenuNumberedOptions(menuSlice: string): { n: number; line: string }[] {
  const ranked: { n: number; line: string }[] = [];
  for (const line of menuSlice.split('\n')) {
    const m = line.trim().match(/^(?:[❯›>]\s*)?(\d+)\.\s+(.+)$/);
    if (!m) continue;
    const n = parseInt(m[1] ?? '', 10);
    const rest = (m[2] ?? '').trim();
    if (n >= 1 && n <= 20 && rest.length > 0) ranked.push({ n, line: rest });
  }
  return ranked;
}

function menuOptionSlice(plainNormalized: string): string {
  const tail = plainNormalized.slice(-12000);
  if (/\bEsc to cancel\b/i.test(tail)) {
    const footerMatch = tail.match(/\bEsc to cancel\b/i);
    const footerIdx = footerMatch?.index ?? tail.length;
    const menuBody = tail.slice(0, footerIdx);
    const proceed = /Do you want to proceed\?/i.exec(menuBody);
    const sliceStart =
      proceed && proceed.index !== undefined ? proceed.index : Math.max(0, menuBody.length - 2800);
    return menuBody.slice(sliceStart);
  }
  const allow = /\bDo you want to allow\b/i.exec(tail);
  if (allow && allow.index !== undefined) return tail.slice(allow.index);
  const proc = /\bDo you want to proceed\b/i.exec(tail);
  if (proc && proc.index !== undefined) return tail.slice(proc.index);
  return '';
}

/**
 * Which menu index to send for "affirm" — Claude Code often uses **2** for "Yes, and don't ask again" with **1** as a one-shot Yes.
 */
export function inferPermissionMenuAffirmativeIndex(plainNormalized: string): string {
  const slice = menuOptionSlice(plainNormalized);
  if (!slice) return '1';

  const ranked = parsePermissionMenuNumberedOptions(slice);

  const dontAsk = ranked.find((r) => /Yes, and don't ask again/i.test(r.line));
  if (dontAsk) return String(dontAsk.n);

  const yesOnly = ranked.find((r) => /^Yes\b/i.test(r.line) && !/^No\b/i.test(r.line));
  if (yesOnly) return String(yesOnly.n);

  return ranked.length ? String(ranked[0].n) : '1';
}

export type PermissionMenuReplyPayload =
  | { mode: 'digit'; digit: string }
  | { mode: 'enter_default' }
  | { mode: 'verbatim'; text: string };

/**
 * Map Reply-box input to what the PTY should receive for a numbered permission / Fetch consent menu.
 * Default Ink choice is the first “Yes” row — unknown text is treated like option 1 (digit), not raw letters.
 */
export function resolvePermissionMenuReplyPayload(plainHint: string, typed: string): PermissionMenuReplyPayload {
  const slice = menuOptionSlice(plainHint) || plainHint.slice(-8000);
  const ranked = parsePermissionMenuNumberedOptions(slice);
  if (ranked.length === 0) {
    return { mode: 'verbatim', text: typed };
  }

  const t = typed.trim();
  if (!t) {
    return { mode: 'enter_default' };
  }

  const tl = t.toLowerCase().replace(/\s+/g, ' ');

  const onlyNum = t.match(/^\s*(\d{1,2})\s*[.!?…\s]*$/);
  if (onlyNum) {
    const n = parseInt(onlyNum[1] ?? '', 10);
    if (ranked.some((r) => r.n === n)) {
      return { mode: 'digit', digit: String(n) };
    }
  }

  const noRow = ranked.find((r) => /^no\b/i.test(r.line));
  if (noRow && /\bno\b/.test(tl) && !/\byes\b/.test(tl)) {
    return { mode: 'digit', digit: String(noRow.n) };
  }

  const dontAskRow = ranked.find((r) => /Yes, and don['\u2019]t ask again/i.test(r.line));
  if (dontAskRow) {
    const needle = dontAskRow.line.toLowerCase().replace(/\s+/g, ' ');
    const head = needle.slice(0, Math.min(80, needle.length));
    if (
      /don['\u2019]t ask again/.test(tl) ||
      /dont ask again/.test(tl) ||
      (head.length >= 14 && tl.includes(head))
    ) {
      return { mode: 'digit', digit: String(dontAskRow.n) };
    }
  }

  const oneShotYes = ranked.find((r) => /^yes\b/i.test(r.line) && !/^no\b/i.test(r.line));
  const defaultN = oneShotYes?.n ?? ranked[0]?.n ?? 1;
  return { mode: 'digit', digit: String(defaultN) };
}
