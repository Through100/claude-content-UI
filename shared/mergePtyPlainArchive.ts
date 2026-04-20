/**
 * Merge a saved PTY plain transcript with the latest full xterm snapshot (from line 0).
 * When scrollback drops lines from the top, `fullPlain` is a suffix of `prev` — keep `prev`.
 * When new output appends, `fullPlain` extends `prev` — use `fullPlain`.
 *
 * When `prev` already contains a long merged history (localStorage + prior merges) and the live
 * buffer is shorter, `fullPlain` is usually a **suffix** of the tail of `prev`, then grows with
 * new lines. The naive `f.length > p.length ? f : p` branch kept `prev` and **never appended**
 * new turns — Pretty stopped after the first exchange while Raw still grew.
 */
const MAX_OVERLAP_SCAN = 250_000;

export function mergePtyPlainArchive(prev: string, fullPlain: string): string {
  const p = prev.replace(/\r\n/g, '\n');
  const f = fullPlain.replace(/\r\n/g, '\n');
  if (!f.trim()) return p;
  if (!p.trim()) return f;
  if (f === p) return p;
  if (f.length >= p.length && f.startsWith(p)) return f;
  if (p.endsWith(f)) return p;

  /** Largest k where p ends with f[0:k] — then new bytes are f[k:]. */
  const maxK = Math.min(p.length, f.length, MAX_OVERLAP_SCAN);
  for (let k = maxK; k > 0; k--) {
    if (p.slice(-k) === f.slice(0, k)) {
      return p + f.slice(k);
    }
  }

  return f.length > p.length ? f : p;
}
