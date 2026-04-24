import { plainTailShowsAnswerablePermissionMenu } from './claudeCodePtyPermissionMenu';
import { collectChoiceMenuSnapshotsInDisplayOrder } from './segmentPtyDiffBlocks';

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

  // 1. Fast path: f is an updated version of the current session (or a dropped-lines continuation).
  // The start of f should be found somewhere in p. If we find it, we can just replace everything after it with f.
  const prefixLen = Math.min(200, f.length);
  if (prefixLen >= 40) {
    const prefix = f.slice(0, prefixLen);
    const idx = p.lastIndexOf(prefix);
    if (idx >= 0) {
      return p.slice(0, idx) + f;
    }
  }

  /** Largest k where p ends with f[0:k] — then new bytes are f[k:]. */
  const maxK = Math.min(p.length, f.length, MAX_OVERLAP_SCAN);
  const minK = 200; // Require a minimum overlap to avoid false positives (e.g. matching just a newline)
  for (let k = maxK; k > minK; k--) {
    if (p.slice(-k) === f.slice(0, k)) {
      return p + f.slice(k);
    }
  }

  const fallback = f.length > p.length ? f : p;
  if (fallback === p && f.trim() && f !== p) {
    /** Overlap can miss rapid stacked Ink prompts; align tail to live before keeping stale `prev`. */
    const healed = snapMergedPtyTailToLiveFullSnapshot(p, f, 280_000);
    if (healed !== p) {
      return healed;
    }
  }
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

function countProceedConsentPrompts(s: string): number {
  return (s.match(/Do you want to proceed\?/gi) ?? []).length;
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
  if (!liveFullPlain?.trim()) {
    return merged;
  }
  const m = merged.replace(/\r\n/g, '\n');
  const live = liveFullPlain.replace(/\r\n/g, '\n');
  if (!m.trim()) {
    return merged;
  }

  const markerWin = Math.min(280_000, maxTailScan, m.length, live.length);
  const liveMarkers = countMenuMarkersInTail(live, markerWin);
  const mergedMarkers = countMenuMarkersInTail(m, markerWin);
  /** Live shows more stacked consent UIs than merged in the same tail window — do not trust cheap exits. */
  const forceTailResync = liveMarkers > mergedMarkers;

  if (!forceTailResync && (m === live || m.endsWith(live))) {
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
    const chunk = m.slice(cut, cut + 100);

    // If chunk is too small, we can't reliably match it
    if (chunk.length < 40) {
      tEff = Math.floor(tEff * 0.82);
      continue;
    }

    const liveCut = live.lastIndexOf(chunk);
    if (liveCut >= 0) {
      const liveSuffix = live.slice(liveCut);
      if (m.slice(cut) === liveSuffix) {
        return merged;
      }

      return m.slice(0, cut) + liveSuffix;
    }

    tEff = Math.floor(tEff * 0.82);
  }

  /**
   * Still could not align (e.g. live shorter than any line-safe window). Graft the full live buffer as
   * the authoritative tail if live clearly shows more fetch consent prompts than the merged
   * tail we would replace, OR if live ends with an answerable permission menu that the merged tail lacks.
   */
  if (live.length >= 200 && m.length > live.length && !m.endsWith(live)) {
    const tailM = m.slice(-live.length);
    const liveScan = live.slice(-Math.min(live.length, 180_000));
    const tailMScan = tailM.slice(-Math.min(tailM.length, 180_000));
    const liveHasMenuAtTail =
      plainTailShowsAnswerablePermissionMenu(liveScan) || collectChoiceMenuSnapshotsInDisplayOrder(liveScan).length > 0;
    const mergedHasSameMenuAtTail =
      (plainTailShowsAnswerablePermissionMenu(tailMScan) ||
        collectChoiceMenuSnapshotsInDisplayOrder(tailMScan).length > 0) &&
      tailM.slice(-1000) === live.slice(-1000);

    if (
      countMenuMarkersInTail(live, live.length) > countMenuMarkersInTail(tailM, tailM.length) ||
      countFetchConsentPrompts(live) > countFetchConsentPrompts(tailM) ||
      countProceedConsentPrompts(live) > countProceedConsentPrompts(tailM) ||
      (liveHasMenuAtTail && !mergedHasSameMenuAtTail)
    ) {
      return m.slice(0, m.length - live.length) + live;
    }
  }

  return merged;
}
