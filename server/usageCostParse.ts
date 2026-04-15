import type { UsageCostSnapshot } from '../src/types';

/** Strip Ink / box-drawing leaders (e.g. ⎿) from a probe line. */
function normalizeCostLine(line: string): string {
  return line
    .replace(/\r/g, '')
    .replace(/^[\s\u2500-\u257f\u23a0-\u23af⎿]+/u, '')
    .trim();
}

function parseLabeledRow(raw: string, labelRe: RegExp): string | undefined {
  for (const line of raw.split('\n')) {
    const s = normalizeCostLine(line);
    if (!s) continue;
    const m = s.match(labelRe);
    if (m?.[1] !== undefined) {
      const v = m[1].trim();
      return v.length ? v : undefined;
    }
  }
  return undefined;
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

  const totalCost = parseLabeledRow(t, /^Total cost\s*:\s*(.+)$/i);
  const totalDurationApi = parseLabeledRow(t, /^Total duration \(API\)\s*:\s*(.+)$/i);
  const totalDurationWall = parseLabeledRow(t, /^Total duration \(wall\)\s*:\s*(.+)$/i);
  const totalCodeChanges = parseLabeledRow(t, /^Total code changes\s*:\s*(.+)$/i);
  const usageSummary = parseLabeledRow(t, /^Usage\s*:\s*(.+)$/i);

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
