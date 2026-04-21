import { plainTailShowsAnswerablePermissionMenu } from './claudeCodePtyPermissionMenu';

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
let _snapTailMatchLogAt = 0;

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
    /** Overlap can miss rapid stacked Ink prompts; align tail to live before keeping stale `prev`. */
    const healed = snapMergedPtyTailToLiveFullSnapshot(p, f, 280_000);
    if (healed !== p) {
      fetch('http://127.0.0.1:7823/ingest/0f30680b-0aa0-4d4a-ba6d-262bf6a78290', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '456dbf' },
        body: JSON.stringify({
          sessionId: '456dbf',
          hypothesisId: 'H17',
          location: 'mergePtyPlainArchive.ts:mergePtyPlainArchive',
          message: 'merge fallback healed via snap tail',
          data: { pLen: p.length, fLen: f.length, healedLen: healed.length },
          timestamp: Date.now()
        })
      }).catch(() => {});
      return healed;
    }
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

function countFetchConsentPrompts(s: string): number {
  return (s.match(/\bDo you want to allow Claude to fetch\b/gi) ?? []).length;
}

/** Rough signal for stacked fetch consent UIs (3rd/4th prompt in one Ink run). */
function countMenuMarkersInTail(s: string, tailBytes: number): number {
  const t = s.slice(-Math.min(tailBytes, s.length));
  const fetchLines = (t.match(/\bFetch\s+https?:\/\//gi) ?? []).length;
  return fetchLines + countFetchConsentPrompts(t);
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

  const markerWin = Math.min(280_000, maxTailScan, m.length, live.length);
  const liveMarkers = countMenuMarkersInTail(live, markerWin);
  const mergedMarkers = countMenuMarkersInTail(m, markerWin);
  /** Live shows more stacked consent UIs than merged in the same tail window — do not trust cheap exits. */
  const forceTailResync = liveMarkers > mergedMarkers;
  if (forceTailResync) {
    // #region agent log
    fetch('http://127.0.0.1:7823/ingest/0f30680b-0aa0-4d4a-ba6d-262bf6a78290', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '456dbf' },
      body: JSON.stringify({
        sessionId: '456dbf',
        hypothesisId: 'H18',
        location: 'mergePtyPlainArchive.ts:snapMergedPtyTailToLiveFullSnapshot',
        message: 'live tail has more menu markers than merged; forcing tail resync',
        data: { liveMarkers, mergedMarkers, markerWin, mergedLen: m.length, liveLen: live.length },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    dbg('force-tail-resync-markers', { liveMarkers, mergedMarkers, markerWin });
  }

  if (!forceTailResync && (m === live || m.endsWith(live))) {
    dbg(m === live ? 'early-m-eq-live' : 'early-m-endsWith-live', { mLen: m.length, liveLen: live.length });
    return merged;
  }

  let tEff = Math.min(maxTailScan, live.length, m.length);
  if (tEff < 200) {
    return merged;
  }

  const mTailEq = (t: number) => {
    const mTail = m.slice(-t);
    const liveTail = live.slice(-t);
    return mTail === liveTail;
  };

  if (!forceTailResync && mTailEq(tEff)) {
    const now = Date.now();
    if (now - _snapTailMatchLogAt > 800) {
      _snapTailMatchLogAt = now;
      dbg('early-tail-match', { t: tEff, liveLen: live.length, mLen: m.length });
    }
    return merged;
  }

  /**
   * Newline alignment can widen the replaced suffix beyond `live.length` (abort-suffix-bounds), which
   * left Pretty stuck on an old fetch menu while Raw still showed the next prompt. Shrink the scan
   * window until the suffix fits in `live`, then splice the live tail in.
   */
  while (tEff >= 200) {
    const approxCut = m.length - tEff;
    const cut = alignCutBackwardToNewline(m, approxCut);
    const suffixLen = m.length - cut;
    if (suffixLen <= 0) {
      tEff = Math.floor(tEff * 0.82);
      continue;
    }
    if (suffixLen > live.length) {
      // #region agent log
      fetch('http://127.0.0.1:7823/ingest/0f30680b-0aa0-4d4a-ba6d-262bf6a78290', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '456dbf' },
        body: JSON.stringify({
          sessionId: '456dbf',
          hypothesisId: 'H15',
          location: 'mergePtyPlainArchive.ts:snapMergedPtyTailToLiveFullSnapshot',
          message: 'suffixLen exceeds live; shrinking tail scan',
          data: { tEff, suffixLen, liveLen: live.length, mergedLen: m.length },
          timestamp: Date.now()
        })
      }).catch(() => {});
      // #endregion
      tEff = Math.floor(tEff * 0.82);
      continue;
    }

    const liveSuffix = live.slice(-suffixLen);
    if (m.slice(cut) === liveSuffix) {
      dbg('abort-slice-already-live-suffix', { suffixLen, tEff });
      return merged;
    }

    dbg('patched', { cut, suffixLen, tEff, outLen: cut + liveSuffix.length });
    return m.slice(0, cut) + liveSuffix;
  }

  /**
   * Still could not align (e.g. live shorter than any line-safe window). Graft the full live buffer as
   * the authoritative tail if live clearly shows more fetch consent prompts than the merged
   * tail we would replace, OR if live ends with an answerable permission menu that the merged tail lacks.
   */
  if (live.length >= 200 && m.length > live.length && !m.endsWith(live)) {
    const tailM = m.slice(-live.length);
    const liveHasMenuAtTail = plainTailShowsAnswerablePermissionMenu(live);
    const mergedHasSameMenuAtTail = plainTailShowsAnswerablePermissionMenu(tailM) && tailM.slice(-1000) === live.slice(-1000);
    
    if (
      countMenuMarkersInTail(live, live.length) > countMenuMarkersInTail(tailM, tailM.length) ||
      countFetchConsentPrompts(live) > countFetchConsentPrompts(tailM) ||
      (liveHasMenuAtTail && !mergedHasSameMenuAtTail)
    ) {
      // #region agent log
      fetch('http://127.0.0.1:7823/ingest/0f30680b-0aa0-4d4a-ba6d-262bf6a78290', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '456dbf' },
        body: JSON.stringify({
          sessionId: '456dbf',
          hypothesisId: 'H16',
          location: 'mergePtyPlainArchive.ts:snapMergedPtyTailToLiveFullSnapshot',
          message: 'graft full live buffer onto merged head',
          data: {
            mergedLen: m.length,
            liveLen: live.length,
            liveFetch: countFetchConsentPrompts(live),
            mergedTailFetch: countFetchConsentPrompts(tailM)
          },
          timestamp: Date.now()
        })
      }).catch(() => {});
      // #endregion
      dbg('graft-full-live', { mergedLen: m.length, liveLen: live.length });
      return m.slice(0, m.length - live.length) + live;
    }
  }

  dbg('snap-gave-up', { mergedLen: m.length, liveLen: live.length });
  return merged;
}
