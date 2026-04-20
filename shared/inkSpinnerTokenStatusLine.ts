/**
 * Claude Code / Ink redraws a one-line status with a leading “sparkle” glyph and a token readout.
 * Matching on glyph + `tokens` avoids maintaining an ever-growing list of coined verbs (Fluttering, Beboppin', …).
 */
const INK_SPINNER_HEAD =
  /^\s*[\u2722\u2726\u2727\u2731\u2733\u2736\u273B\u273C\u273D\u2741\u274B\u2042✽✻✶✢✿·*•⎿✽]/u;

/** Same compact counts as Pretty footer (`1.2k tokens`, `588 tokens`). */
function lineHasTokenCount(t: string): boolean {
  return /\b(?:\d{1,3}(?:\.\d+)?k|\d[\d,]*)\s*tokens?\b/i.test(t);
}

export function isInkSpinnerTokenStatusLine(line: string): boolean {
  const t = (line ?? '').replace(/\r/g, '').trim();
  if (t.length < 8 || t.length > 480) return false;
  if (!lineHasTokenCount(t)) return false;
  return INK_SPINNER_HEAD.test(t);
}
