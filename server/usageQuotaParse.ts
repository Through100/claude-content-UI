import type { UsageQuotaSection, UsageQuotaSectionId, UsageQuotaSnapshot } from '../src/types';

const SNAPSHOT_MARKER = '\n--- ~/.claude/usage-exact.json';

/** Strip appended local JSON snapshot so we only parse real /usage TUI text. */
export function usagePanelMainText(full: string): string {
  const i = full.indexOf(SNAPSHOT_MARKER);
  if (i >= 0) return full.slice(0, i).trimEnd();
  return full.trimEnd();
}

/** Block / shade glyphs used in Ink-style quota bars. */
const BLOCK_OR_SHADE = /[\u2580-\u259f]/;

function extractPercentUsed(line: string): number | null {
  const glued = line.match(/(\d{1,3})\s*%\s*used\b/i);
  if (glued) {
    const n = Number(glued[1]);
    return n >= 0 && n <= 100 ? n : null;
  }
  const spaced = line.match(/(\d{1,3})\s*%\s+used\b/i);
  if (spaced) {
    const n = Number(spaced[1]);
    return n >= 0 && n <= 100 ? n : null;
  }
  const pctOnly = line.match(/(\d{1,3})\s*%/);
  if (pctOnly && BLOCK_OR_SHADE.test(line)) {
    const n = Number(pctOnly[1]);
    return n >= 0 && n <= 100 ? n : null;
  }
  return null;
}

function pickBarLine(body: string[]): { barLine: string | undefined; percent: number | null } {
  let best: { line: string; percent: number; score: number } | undefined;
  for (const line of body) {
    const p = extractPercentUsed(line);
    if (p === null) continue;
    const blocks = (line.match(BLOCK_OR_SHADE) ?? []).length;
    const score = blocks * 10 + line.length;
    if (!best || score > best.score) best = { line, percent: p, score };
  }
  if (best) return { barLine: best.line, percent: best.percent };
  for (const line of body) {
    const m = line.match(/(\d{1,3})\s*%/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 0 && n <= 100) return { barLine: undefined, percent: n };
    }
  }
  return { barLine: undefined, percent: null };
}

const HEADER_SPECS: { id: UsageQuotaSectionId; re: RegExp; defaultTitle: string }[] = [
  { id: 'current_session', re: /^Current\s+session\b/i, defaultTitle: 'Current session' },
  {
    id: 'current_week',
    re: /^Current\s+week(?:\s*\(\s*all\s+models\s*\))?\b/i,
    defaultTitle: 'Current week (all models)'
  },
  { id: 'extra_usage', re: /^Extra\s+usage\b/i, defaultTitle: 'Extra usage' }
];

/**
 * Best-effort parse of the interactive `/usage` Usage tab: session / week / extra rows with % used.
 */
export function parseUsageQuotaSnapshot(raw: string): UsageQuotaSnapshot {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');

  const hits: { id: UsageQuotaSectionId; lineIndex: number; headerText: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    for (const spec of HEADER_SPECS) {
      if (!spec.re.test(t)) continue;
      if (hits.some((h) => h.id === spec.id)) continue;
      hits.push({ id: spec.id, lineIndex: i, headerText: t });
      break;
    }
  }

  hits.sort((a, b) => a.lineIndex - b.lineIndex);

  const sections: UsageQuotaSection[] = [];
  for (let h = 0; h < hits.length; h++) {
    const { id, lineIndex, headerText } = hits[h];
    const spec = HEADER_SPECS.find((s) => s.id === id)!;
    const end = h + 1 < hits.length ? hits[h + 1].lineIndex : lines.length;
    const body = lines
      .slice(lineIndex + 1, end)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const { barLine, percent } = pickBarLine(body);
    const detailLines = barLine ? body.filter((l) => l !== barLine) : [...body];

    sections.push({
      id,
      title: headerText || spec.defaultTitle,
      percentUsed: percent,
      barLine,
      detailLines,
      matched: true
    });
  }

  const canonical: UsageQuotaSectionId[] = ['current_session', 'current_week', 'extra_usage'];
  const byId = new Map(sections.map((s) => [s.id, s]));
  const ordered: UsageQuotaSection[] = canonical.map((id) => {
    const hit = byId.get(id);
    if (hit) return { ...hit, matched: true as const };
    const def = HEADER_SPECS.find((s) => s.id === id)!;
    return {
      id,
      title: def.defaultTitle,
      percentUsed: null,
      barLine: undefined,
      detailLines: [],
      matched: false as const
    };
  });

  const anyMatched = sections.length > 0;
  const anyPercent = ordered.some((s) => s.percentUsed !== null);
  return {
    sections: ordered,
    parseOk: anyMatched && anyPercent
  };
}
