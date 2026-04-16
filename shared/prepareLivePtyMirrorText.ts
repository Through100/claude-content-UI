import { stripAnsi } from './stripAnsi';

/** Claude Code style user input line (non-empty prompt). */
function lastContentPromptIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (/^❯\s+\S/.test(t)) return i;
  }
  return -1;
}

/**
 * Keep text after the last non-empty `❯ …` line so the mirror focuses on the latest
 * assistant turn instead of the whole session (welcome banner, older prompts).
 */
export function latestAssistantSlice(stripped: string): string {
  const lines = stripped.split(/\r?\n/);
  const idx = lastContentPromptIndex(lines);
  if (idx < 0) return stripped.trim();
  return lines.slice(idx + 1).join('\n').trim();
}

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^\s*(thinking|effecting|leavening)\b/i.test(t) && t.length < 120) return true;
  if (/^\|\s*cost:\s*\$/i.test(t)) return true;
  if (/^\s*●\s*$/.test(t)) return true;
  if (t.length < 64 && /[✢✻✽✶∗⋆·▪▫]{3,}/.test(t) && t.replace(/[\s✢✻✽✶∗⋆·▪▫│]/g, '').length < 12) {
    return true;
  }
  return false;
}

function isTuiBoxLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 8) return false;
  const box = t.match(/[\u2500-\u257F╭╮╯│╰╱╲▛▜▘▝▐▀▄█░▒▓]/g);
  if (!box) return false;
  const nonSpace = t.replace(/\s/g, '');
  if (!nonSpace.length) return false;
  const ratio = box.join('').length / nonSpace.length;
  if (ratio > 0.55) return true;
  if (/^[╭╰│╯]/.test(t) && ratio > 0.35) return true;
  return false;
}

/** Drop TUI frames, spinner lines, and excessive separators from PTY mirror text. */
export function sanitizePtyMirrorText(s: string): string {
  const lines = s.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (isTuiBoxLine(line)) continue;
    if (isNoiseLine(line)) continue;
    out.push(line);
  }
  let t = out.join('\n');
  t = t.replace(/(?:[─\-═]{24,}\s*\n){2,}/g, '\n');
  t = t.replace(/\n{5,}/g, '\n\n\n');
  return t.trim();
}

/**
 * Strip ANSI, focus on the latest `❯` turn when possible, and remove obvious TUI noise.
 */
export function prepareLivePtyMirrorText(liveTranscript: string): string {
  const stripped = stripAnsi(liveTranscript).trim();
  if (!stripped) return '';
  const sliced = latestAssistantSlice(stripped);
  const a = sanitizePtyMirrorText(sliced);
  const b = sanitizePtyMirrorText(stripped);
  if (a.length < 80 && b.length > a.length + 200) return b;
  return a.length ? a : b;
}
