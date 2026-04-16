/**
 * Merge a saved PTY plain transcript with the latest full xterm snapshot (from line 0).
 * When scrollback drops lines from the top, `fullPlain` is a suffix of `prev` — keep `prev`.
 * When new output appends, `fullPlain` extends `prev` — use `fullPlain`.
 */
export function mergePtyPlainArchive(prev: string, fullPlain: string): string {
  const p = prev.replace(/\r\n/g, '\n');
  const f = fullPlain.replace(/\r\n/g, '\n');
  if (!f.trim()) return p;
  if (!p.trim()) return f;
  if (f === p) return p;
  if (f.length >= p.length && f.startsWith(p)) return f;
  if (p.endsWith(f)) return p;
  return f.length > p.length ? f : p;
}
