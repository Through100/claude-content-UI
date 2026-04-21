import { isInkSpinnerTokenStatusLine } from './inkSpinnerTokenStatusLine';
import { normalizeTeletypeLines, stripAnsi } from './stripAnsi';

/**
 * True when this `●` line is clearly the main answer body (Pretty should treat the stream as “got output”
 * and hide the live Raw-style footer bar).
 */
function isSubstantiveAssistantTailLine(line: string): boolean {
  const t = line.trim();
  if (!/^\s*●\s+/.test(t)) return false;
  if (/^\s*●\s*Thinking\b/i.test(t)) return false;
  if (/^\s*●\s*Skill\s*\(/i.test(t)) return false;
  if (t.length < 96) return false;
  return true;
}

/** Matches token counts in Claude Code footers, including Ink abbreviations like `1.2k tokens`. */
function lineHasTokenCountFooter(t: string): boolean {
  return /\b(?:\d{1,3}(?:\.\d+)?k|\d[\d,]*)\s*tokens?\b/i.test(t);
}

/** Claude Code one-line footer: timer + tokens + optional “thinking” (matches Raw TUI). */
function isTokenTimerFooterLine(line: string): boolean {
  const t = line.trim();
  if (isInkSpinnerTokenStatusLine(t)) return true;
  if (t.length < 14 || t.length > 420) return false;
  if (!lineHasTokenCountFooter(t)) return false;
  if (!/\(\s*\d+[smh]/i.test(t)) return false;
  if (/\bthinking\b/i.test(t)) return true;
  if (/^\s*[·*•✻✶⎿✢✿✽]\s+\S+ing\b/i.test(t)) return true;
  return false;
}

function shouldSkipWhenScanningFromBottom(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^\|\s*cost:/i.test(t)) return true;
  if (/^\s*>\s*\|?\s*$/i.test(t)) return true;
  if (/^\s*❯\s*$/.test(t)) return true;
  if (/^\s*(?:⎿\s*)?L\s*Tip:/i.test(t)) return true;
  return false;
}

/**
 * Returns the live status footer line shown at the bottom of Claude Code (timer, tokens, “thinking”),
 * or null when the PTY tail already shows substantive `●` answer text.
 */
export function extractPtyLiveFooterLine(raw: string): string | null {
  /** Same as Logon path: CR redraws collapse so the last in-place footer (36s → 1m 33s) is visible. */
  const plain = normalizeTeletypeLines(stripAnsi(raw ?? '')).replace(/\r\n/g, '\n');
  const lines = plain.split('\n');
  const tail = lines.slice(-40);
  for (let i = tail.length - 1; i >= 0; i--) {
    const L = tail[i] ?? '';
    const t = L.trim();
    if (shouldSkipWhenScanningFromBottom(L)) continue;
    if (isSubstantiveAssistantTailLine(L)) return null;
    if (isTokenTimerFooterLine(L)) return t;
  }
  return null;
}

/**
 * Removes Claude Code / Ink one-line status rows (`* Shenaniganing… (1m · ↓ 4k tokens)`) from assistant text so
 * Pretty can show them only in `TerminalLiveFooterBar` at the thread bottom (pinned layout).
 */
export function stripInkStatusFooterLinesFromAssistantPlain(raw: string): string {
  const lines = (raw ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const t = normalizeTeletypeLines(stripAnsi(line)).replace(/\r/g, '').trim();
    if (t && isTokenTimerFooterLine(t)) continue;
    out.push(line);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
