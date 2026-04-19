import { normalizeTeletypeLines, stripAnsi } from './stripAnsi';

/** Plain PTY text (ANSI stripped, teletype lines normalized) shows Claude Code’s numbered permission menu. */
export function plainTextShowsClaudePermissionMenu(plainNormalized: string): boolean {
  const tail = plainNormalized.slice(-8000);
  if (!/\bEsc to cancel\b/i.test(tail) || !/\bTab to amend\b/i.test(tail)) return false;
  return (
    /Do you want to proceed\?/i.test(tail) || /(^|\n)\s*\d+\.\s+Yes,/im.test(tail) || /Yes, and don't ask again/i.test(tail)
  );
}

export function stripAnsiNormalizePtyMirror(raw: string): string {
  return normalizeTeletypeLines(stripAnsi(raw));
}

/**
 * Which menu index to send for "affirm" — Claude Code often uses **2** for "Yes, and don't ask again" with **1** as a one-shot Yes.
 */
export function inferPermissionMenuAffirmativeIndex(plainNormalized: string): string {
  const tail = plainNormalized.slice(-8000);
  if (!/\bEsc to cancel\b/i.test(tail)) return '1';

  const footerMatch = tail.match(/\bEsc to cancel\b/i);
  const footerIdx = footerMatch?.index ?? tail.length;
  const menuBody = tail.slice(0, footerIdx);

  const proceed = /Do you want to proceed\?/i.exec(menuBody);
  const sliceStart =
    proceed && proceed.index !== undefined ? proceed.index : Math.max(0, menuBody.length - 2800);
  const slice = menuBody.slice(sliceStart);

  const ranked: { n: number; line: string }[] = [];
  for (const line of slice.split('\n')) {
    const m = line.trim().match(/^(\d+)\.\s+(.+)$/);
    if (!m) continue;
    const n = parseInt(m[1] ?? '', 10);
    const rest = (m[2] ?? '').trim();
    if (n >= 1 && n <= 20 && rest.length > 0) ranked.push({ n, line: rest });
  }

  const dontAsk = ranked.find((r) => /Yes, and don't ask again/i.test(r.line));
  if (dontAsk) return String(dontAsk.n);

  const yesOnly = ranked.find((r) => /^Yes\b/i.test(r.line) && !/^No\b/i.test(r.line));
  if (yesOnly) return String(yesOnly.n);

  return ranked.length ? String(ranked[0].n) : '1';
}
