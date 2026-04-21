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

  const fallback = f.length > p.length ? f : p;
  // #region agent log
  if (fallback === p && f.trim() && f !== p) {
    fetch('http://127.0.0.1:7823/ingest/0f30680b-0aa0-4d4a-ba6d-262bf6a78290', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '456dbf' },
      body: JSON.stringify({
        sessionId: '456dbf',
        hypothesisId: 'H3',
        location: 'mergePtyPlainArchive.ts:mergePtyPlainArchive',
        message: 'merge fallback kept prev',
        data: { pLen: p.length, fLen: f.length },
        timestamp: Date.now()
      })
    }).catch(() => {});
  }
  // #endregion
  return fallback;
}

function alignCutBackwardToNewline(s: string, approxCut: number): number {
  let c = Math.max(0, Math.min(approxCut, s.length));
  const floor = Math.max(0, c - 4000);
  while (c > floor && c > 0 && s[c - 1] !== '\n') c--;
  return c;
}

/**
 * Pretty merges scrollback + live xterm snapshots; when Ink redraws a permission menu in place, the merged
 * string can keep an old tail while {@link mergePtyPlainArchive} still thinks the buffer is unchanged.
 * If the last `maxTailScan` chars of the live full snapshot differ from the merged tail, replace that
 * merged suffix with the live one (line-aligned cut) so Pretty matches Logon / Raw.
 */
export function snapMergedPtyTailToLiveFullSnapshot(
  merged: string,
  liveFullPlain: string,
  maxTailScan: number
): string {
  // #region agent log
  const dbg = (branch: string, extra: Record<string, unknown> = {}) => {
    fetch('http://127.0.0.1:7823/ingest/0f30680b-0aa0-4d4a-ba6d-262bf6a78290', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '456dbf' },
      body: JSON.stringify({
        sessionId: '456dbf',
        hypothesisId: 'H1',
        location: 'mergePtyPlainArchive.ts:snapMergedPtyTailToLiveFullSnapshot',
        message: branch,
        data: {
          mergedLen: merged.length,
          liveLen: (liveFullPlain ?? '').length,
          ...extra
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
  };
  // #endregion
  if (!liveFullPlain?.trim()) {
    dbg('early-no-live');
    return merged;
  }
  const m = merged.replace(/\r\n/g, '\n');
  const live = liveFullPlain.replace(/\r\n/g, '\n');
  if (!m.trim()) {
    dbg('early-empty-merged');
    return merged;
  }
  if (m === live || m.endsWith(live)) {
    dbg(m === live ? 'early-m-eq-live' : 'early-m-endsWith-live', { mLen: m.length, liveLen: live.length });
    return merged;
  }

  const t = Math.min(maxTailScan, live.length, m.length);
  if (t < 200) {
    return merged;
  }

  const mTail = m.slice(-t);
  const liveTail = live.slice(-t);
  if (mTail === liveTail) {
    return merged;
  }

  const approxCut = m.length - t;
  const cut = alignCutBackwardToNewline(m, approxCut);
  const suffixLen = m.length - cut;
  if (suffixLen <= 0 || suffixLen > live.length) {
    dbg('abort-suffix-bounds', { cut, suffixLen, liveLen: live.length });
    return merged;
  }

  const liveSuffix = live.slice(-suffixLen);
  if (m.slice(cut) === liveSuffix) {
    dbg('abort-slice-already-live-suffix');
    return merged;
  }

  dbg('patched', { cut, suffixLen, outLen: cut + liveSuffix.length });
  return m.slice(0, cut) + liveSuffix;
}
