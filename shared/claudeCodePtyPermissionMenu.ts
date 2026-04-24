import { isInkSpinnerTokenStatusLine } from './inkSpinnerTokenStatusLine';
import { normalizeTeletypeLines, stripAnsi } from './stripAnsi';

/** Ink menus can wrap huge command text on “2. Yes…” — keep question + “1. Yes” + Esc footer in one window. */
const PTY_PERMISSION_MENU_TAIL_CHARS = 16_000;
/**
 * Last N chars for numbered-choice / Esc detection. Long bash/heredoc + Ink status redraws can leave the
 * permission block many KB above a final “Scurrying… tokens” line — 2.8k was too small for long runs.
 */
const PTY_PERMISSION_MENU_VERY_TAIL_CHARS = 14_000;
/** When the last line is an Ink spinner, scan this far up for a pending menu (spinner sits below the consent UI). */
const PTY_PERMISSION_MENU_SPINNER_LOOKBACK_CHARS = 52_000;

/** Web / tool permission menu (Fetch + Esc to cancel footer) — must survive “trivial tail” / chrome filters for dashboard sync. */
export function textContainsClaudePermissionMenu(text: string): boolean {
  const t = (text || '').replace(/\r/g, '');
  /** Fetch consent often omits the Esc/Tab chrome line in the same PTY capture as the numbered choices. */
  if (
    /Do you want to/i.test(t) &&
    /^\s*(?:[❯›>]\s*)?1\.\s+Yes\b/im.test(t)
  ) {
    return true;
  }
  /** Ink wraps “Do you want” / “to allow …?” across rows — no contiguous `Do you want to` substring. */
  if (
    /Do you want to\b[\s\S]{0,1400}(?:\?|？)/i.test(t) &&
    /^\s*(?:[❯›>]\s*)?1\.\s+Yes\b/im.test(t)
  ) {
    return true;
  }
  if (!/\bEsc to cancel\b/i.test(t) || !/\bTab to (?:amend|edit|change)\b/i.test(t)) return false;
  return (
    /Do you want/i.test(t) ||
    /\bClaude wants to fetch\b/i.test(t) ||
    /\bClaude wants to search\b/i.test(t) ||
    /^fetch\b/im.test(t) ||
    /\bfetch content from\b/i.test(t)
  );
}

/** Plain PTY text (ANSI stripped, teletype lines normalized) shows Claude Code’s numbered permission menu. */
export function plainTextShowsClaudePermissionMenu(plainNormalized: string): boolean {
  const trimmed = plainNormalized.trimEnd();
  const tail = trimmed.slice(-PTY_PERMISSION_MENU_TAIL_CHARS);
  const veryTail = trimmed.slice(-PTY_PERMISSION_MENU_VERY_TAIL_CHARS);
  if (!/\bEsc to cancel\b/i.test(veryTail) || !/\bTab to (?:amend|edit|change)\b/i.test(veryTail)) return false;
  /** Require a numbered option line so we never auto-send on stray footer text alone (e.g. after a PTY restart). */
  if (!/(^|\n)\s*(?:[❯›>]\s*)?\d+\.\s+\S/m.test(veryTail)) return false;
  return (
    plainTailHasDoYouPermissionQuestion(tail) ||
      /(^|\n)\s*(?:[❯›>]\s*)?\d+\.\s+Yes,/im.test(veryTail) ||
      /Yes, and don't ask again/i.test(veryTail) ||
      /Yes, and don’t ask again/i.test(veryTail) ||
      /Yes, allow all edits/i.test(veryTail) ||
      /\bClaude wants to search\b/i.test(veryTail)
  );
}

const NUMBERED_MENU_ROW = /(^|\n)\s*(?:[❯›>]\s*)?\d+\.\s+\S/m;

/**
 * Ink often wraps long “Do you want to create … .md?” prompts across terminal rows — `Do you` and `?` are not on one
 * line, so a single-line regex misses and auto-approve / tail gating never arms.
 */
function plainTailHasDoYouPermissionQuestion(tailSlice: string): boolean {
  if (/Do you[^\n]*\?/i.test(tailSlice)) return true;
  if (/Do you want to create[\s\S]{0,1400}\?/i.test(tailSlice)) return true;
  if (/Do you want to\b[\s\S]{0,1400}\?/i.test(tailSlice)) return true;
  return false;
}

/**
 * True when the PTY tail shows a permission menu (Esc/Tab “proceed” UI **or** Fetch / compact consent without that
 * footer). Used so dashboard copy (e.g. welcome splash) does not warn while a real menu is visible.
 */

/**
 * True when the last Pretty-segmented choice menu is still present in this PTY tail and the default
 * `1. Yes` row appears in the answerable tail window. Pairs with {@link extractLastChoiceMenuSnapshotForArchive}
 * so Auto-Approve can follow the same “yellow card” the user sees, even when {@link plainTailShowsAnswerablePermissionMenu}
 * is overly strict (e.g. unusual Ink chrome or tail layout).
 */
export function plainTailShowsLivePrettyChoiceMenu(
  plainNormalizedTail: string,
  menuSnapshot: string | null | undefined
): boolean {
  const snap = (menuSnapshot ?? '').replace(/\r/g, '').trim();
  if (!snap || !textContainsClaudePermissionMenu(snap)) return false;
  const t = (plainNormalizedTail ?? '').replace(/\r/g, '');
  if (!t.includes(snap)) return false;
  const veryTail = t.slice(-Math.min(t.length, PTY_PERMISSION_MENU_VERY_TAIL_CHARS));
  return /(^|\n)\s*(?:[?❯›>]\s*)?1\.\s+Yes\b/im.test(veryTail);
}

export function plainTailShowsAnswerablePermissionMenu(plainNormalized: string): boolean {
  const trimmed = plainNormalized.trimEnd();
  const tail = trimmed.slice(-PTY_PERMISSION_MENU_TAIL_CHARS);
  const veryTail = trimmed.slice(-PTY_PERMISSION_MENU_VERY_TAIL_CHARS);

  const lines = trimmed.split('\n');
  let lastNonEmpty = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    if ((lines[i] ?? '').replace(/\r$/, '').trim()) {
      lastNonEmpty = lines[i] ?? '';
      break;
    }
  }
  /**
   * Ink often draws a token/spinner line after the Esc footer while the menu is still pending.
   * Treat as inactive only when that line is a spinner *and* we do not see a consent shape in the tail window.
   */
  if (lastNonEmpty && isInkSpinnerTokenStatusLine(lastNonEmpty)) {
    const wideForMenu = trimmed.slice(
      -Math.min(trimmed.length, Math.max(PTY_PERMISSION_MENU_VERY_TAIL_CHARS, PTY_PERMISSION_MENU_SPINNER_LOOKBACK_CHARS))
    );
    const menuDespiteSpinner =
      NUMBERED_MENU_ROW.test(wideForMenu) &&
      plainTailHasDoYouPermissionQuestion(tail) &&
      /^\s*(?:[?❯›>]\s*)?1\.\s+Yes\b/im.test(wideForMenu);
    if (!menuDespiteSpinner) return false;
  }

  if (plainTextShowsClaudePermissionMenu(plainNormalized)) return true;
  if (!NUMBERED_MENU_ROW.test(veryTail)) return false;
  if (plainTailHasDoYouPermissionQuestion(tail) && /^\s*(?:[?❯›>]\s*)?1\.\s+Yes\b/im.test(veryTail)) return true;
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
