import { normalizeTeletypeLines, stripAnsi } from './stripAnsi';

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
    /Do you want to/i.test(tail) ||
      /(^|\n)\s*(?:[❯›>]\s*)?\d+\.\s+Yes,/im.test(tail) ||
      /Yes, and don't ask again/i.test(tail) ||
      /Yes, allow all edits/i.test(tail)
  );
}

const NUMBERED_MENU_ROW = /(^|\n)\s*(?:[❯›>]\s*)?\d+\.\s+\S/m;

/**
 * True when the PTY tail shows a permission menu (Esc/Tab “proceed” UI **or** Fetch / compact consent without that
 * footer). Used so dashboard copy (e.g. welcome splash) does not warn while a real menu is visible.
 */
export function plainTailShowsAnswerablePermissionMenu(plainNormalized: string): boolean {
  if (plainTextShowsClaudePermissionMenu(plainNormalized)) return true;
  const tail = plainNormalized.slice(-14000);
  if (!NUMBERED_MENU_ROW.test(tail)) return false;
  if (/Do you want to/i.test(tail) && /^\s*(?:[❯›>]\s*)?1\.\s+Yes\b/im.test(tail)) return true;
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
