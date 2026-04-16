/**
 * Merge a previous Pretty/PTY plain archive with the latest full xterm buffer snapshot (from line 0).
 * When xterm scrollback drops lines from the top, `fullPlain` becomes a suffix of `prev` — keep `prev`.
 * When new lines append at the bottom, `fullPlain` extends `prev` — take `fullPlain`.
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
