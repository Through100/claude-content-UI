import { normalizeTeletypeLines, stripAnsi } from './stripAnsi';

/** Plain PTY text (ANSI stripped, teletype lines normalized) shows Claude Code’s numbered permission menu. */
export function plainTextShowsClaudePermissionMenu(plainNormalized: string): boolean {
  const tail = plainNormalized.slice(-8000);
  if (!/\bEsc to cancel\b/i.test(tail) || !/\bTab to amend\b/i.test(tail)) return false;
  return /Do you want to proceed\?/i.test(tail) || /(^|\n)\s*1\.\s+Yes,/im.test(tail);
}

export function stripAnsiNormalizePtyMirror(raw: string): string {
  return normalizeTeletypeLines(stripAnsi(raw));
}
