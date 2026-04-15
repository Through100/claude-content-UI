import type { UsageCostSnapshot } from '../src/types';

/** Strip Ink / box-drawing leaders (e.g. ⎿) from a probe line. */
function normalizeCostLine(line: string): string {
  return line
    .replace(/\r/g, '')
    .replace(/^[\s\u2500-\u257f\u23a0-\u23af⎿]+/u, '')
    .trim();
}

/** `0input,0output,0cacheread,0cachewrite` → readable token counts (not a secret key). */
function prettifyUsageTokenSummary(s: string): string {
  const t = s.trim();
  const glued = t.match(/^(\d+)input,(\d+)output,(\d+)cacheread,(\d+)cachewrite$/i);
  if (glued) {
    return `${glued[1]} input, ${glued[2]} output, ${glued[3]} cache read, ${glued[4]} cache write`;
  }
  const spaced = t.match(
    /^(\d+)\s*input\s*,\s*(\d+)\s*output\s*,\s*(\d+)\s*cache\s*read\s*,\s*(\d+)\s*cache\s*write$/i
  );
  if (spaced) {
    return `${spaced[1]} input, ${spaced[2]} output, ${spaced[3]} cache read, ${spaced[4]} cache write`;
  }
  return t;
}

function firstCaptureAcrossLines(raw: string, regexes: RegExp[]): string | undefined {
  const lines = raw.split('\n').map(normalizeCostLine).filter(Boolean);
  for (const line of lines) {
    for (const re of regexes) {
      const m = line.match(re);
      if (m?.[1] !== undefined) {
        const v = m[1].trim();
        if (v.length) return v;
      }
    }
  }
  return undefined;
}

/** Footer line like `| cost: $0.0000` (may appear without normal "Total cost" spacing). */
function parsePipeCostLine(raw: string): string | undefined {
  const m = raw.match(/\|\s*cost\s*:\s*(\S+)/i);
  return m?.[1]?.trim() || undefined;
}

/**
 * Parse `claude "/cost"` text (API account session cost panel).
 * Subscription accounts often yield no matching lines — returns parseOk: false.
 */
export function parseUsageCostSnapshot(raw: string): UsageCostSnapshot {
  const t = raw.trim();
  if (!t) {
    return { parseOk: false };
  }
  if (/unknown skill:\s*cost/i.test(t)) {
    return { parseOk: false };
  }

  const totalCost =
    firstCaptureAcrossLines(t, [
      /^Total\s*cost\s*:\s*(.+)$/i,
      /^Totalcost\s*:\s*(.+)$/i
    ]) || parsePipeCostLine(t);

  const totalDurationApi = firstCaptureAcrossLines(t, [
    /^Total\s*duration\s*\(\s*API\s*\)\s*:\s*(.+)$/i,
    /^Totalduration\s*\(\s*API\s*\)\s*:\s*(.+)$/i
  ]);

  const totalDurationWall = firstCaptureAcrossLines(t, [
    /^Total\s*duration\s*\(\s*wall\s*\)\s*:\s*(.+)$/i,
    /^Totalduration\s*\(\s*wall\s*\)\s*:\s*(.+)$/i
  ]);

  const totalCodeChanges = firstCaptureAcrossLines(t, [
    /^Total\s*code\s*changes\s*:\s*(.+)$/i,
    /^Totalcodechanges\s*:\s*(.+)$/i
  ]);

  const usageRaw = firstCaptureAcrossLines(t, [/^Usage\s*:\s*(.+)$/i]);
  const usageSummary = usageRaw !== undefined ? prettifyUsageTokenSummary(usageRaw) : undefined;

  const parseOk = Boolean(totalCost || usageSummary);

  return {
    parseOk,
    totalCost,
    totalDurationApi,
    totalDurationWall,
    totalCodeChanges,
    usageSummary
  };
}
