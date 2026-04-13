import type {
  SystemStatus,
  CostInfo,
  ContextUsage,
  ContextCategory,
  ModelUsage,
  ContextAgentRow,
  ContextSkillRow
} from '../src/types';

function lineValue(raw: string, label: string): string | undefined {
  const re = new RegExp(`^${label}\\s*[:：]\\s*(.+)$`, 'im');
  const m = raw.match(re);
  return m?.[1]?.trim();
}

/** Best-effort parse of `/status` style text into dashboard fields. */
export function parseStatusOutput(raw: string): SystemStatus {
  const text = raw.trim() || '(empty)';
  if (/^unknown skill:/im.test(text)) {
    return {
      version: '—',
      sessionName: '—',
      sessionId: '—',
      cwd: '—',
      authToken: '—',
      apiKey: '—',
      organization: '—',
      email: '—',
      model: '—'
    };
  }
  return {
    version: lineValue(raw, 'Version') || lineValue(raw, 'Claude Code') || text.split('\n')[0]?.slice(0, 80) || '—',
    sessionName: lineValue(raw, 'Session') || lineValue(raw, 'Name') || '—',
    sessionId: lineValue(raw, 'Session ID') || lineValue(raw, 'session id') || '—',
    cwd: lineValue(raw, 'cwd') || lineValue(raw, 'CWD') || lineValue(raw, 'Working directory') || '—',
    authToken: lineValue(raw, 'Auth') || lineValue(raw, 'Token') || '—',
    apiKey: lineValue(raw, 'API key') || lineValue(raw, 'API Key') || '—',
    organization: lineValue(raw, 'Organization') || lineValue(raw, 'Org') || '—',
    email: lineValue(raw, 'Email') || lineValue(raw, 'Account') || '—',
    model: lineValue(raw, 'Model') || lineValue(raw, 'Current model') || '—'
  };
}

function parseMoneyTable(raw: string): ModelUsage[] {
  const rows: ModelUsage[] = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    const parts = line.trim().split(/\s{2,}|\t+/).filter(Boolean);
    if (parts.length >= 2 && /\$[\d.]+/.test(parts[parts.length - 1])) {
      rows.push({
        model: parts[0],
        input: parts[1] || '—',
        output: parts[2] || '—',
        cacheRead: parts[3] || '—',
        cacheWrite: parts[4] || '—',
        cost: parts[parts.length - 1]
      });
    }
  }
  return rows.slice(0, 20);
}

export function parseCostOutput(raw: string): CostInfo {
  const total =
    lineValue(raw, 'Total') ||
    lineValue(raw, 'Total cost') ||
    (raw.match(/\$[\d.,]+\s*total/i)?.[0] ?? '—');
  const apiDuration = lineValue(raw, 'API duration') || lineValue(raw, 'API Duration') || '—';
  const wallDuration = lineValue(raw, 'Wall') || lineValue(raw, 'Wall duration') || '—';
  const usageByModel = parseMoneyTable(raw);
  return {
    totalCost: total,
    apiDuration,
    wallDuration,
    codeChanges: { added: 0, removed: 0 },
    usageByModel: usageByModel.length
      ? usageByModel
      : [{ model: '(see raw output)', input: '—', output: '—', cacheRead: '—', cacheWrite: '—', cost: '—' }]
  };
}

function splitPipeRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function isSeparatorCells(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s+/g, '')));
}

/** Parse the first GFM pipe table after a heading (skips header + separator rows). */
function parsePipeTableAfterHeading(raw: string, headingRe: RegExp): string[][] {
  const m = raw.match(headingRe);
  if (!m || m.index === undefined) return [];
  const block = raw.slice(m.index + m[0].length);
  const lines = block.split('\n');
  const rows: string[][] = [];
  type Phase = 'seek' | 'header' | 'body';
  let phase: Phase = 'seek';
  for (const line of lines) {
    const t = line.trim();
    if (phase === 'seek') {
      if (!t) continue;
      if (t.includes('|')) {
        phase = 'header';
        continue;
      }
      continue;
    }
    if (phase === 'header') {
      phase = 'body';
      continue;
    }
    if (!t) break;
    if (/^#{2,3}\s/.test(t)) break;
    if (!t.includes('|')) break;
    const cells = splitPipeRow(line);
    if (cells.length < 2) break;
    if (isSeparatorCells(cells)) continue;
    rows.push(cells);
  }
  return rows;
}

function parsePctCell(cell: string): number {
  const n = parseFloat(cell.replace(/%/g, '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function parseTokensLine(raw: string): { used: string; max: string; pct: number } | null {
  const m = raw.match(
    /\*?\*?Tokens\*?\*?\s*:\s*([\d.,kKmM]+)\s*\/\s*([\d.,kKmM]+)\s*(?:\(\s*(\d+(?:\.\d+)?)\s*%\s*\))?/i
  );
  if (!m) return null;
  return {
    used: m[1].trim(),
    max: m[2].trim(),
    pct: m[3] != null && m[3] !== '' ? parseFloat(m[3]) : 0
  };
}

function parseModelFromContext(raw: string): string | null {
  const m = raw.match(/\*?\*?Model\*?\*?\s*:\s*([^\n\r]+)/i);
  if (!m) return null;
  return m[1]
    .replace(/\*+$/, '')
    .replace(/^\*+/, '')
    .trim();
}

function parseContextCategoriesLegacy(raw: string): ContextCategory[] {
  const cats: ContextCategory[] = [];
  const block = raw.split(/categories|breakdown/i)[1] || raw;
  for (const line of block.split('\n')) {
    const rowMatch = line.match(/(.+?)\s+([\d.,]+[kKmM]?)\s+tokens?\s*\(?\s*([\d.]+)\s*%/i);
    if (rowMatch) {
      cats.push({ label: rowMatch[1].trim(), tokens: rowMatch[2], percentage: parseFloat(rowMatch[3]) });
    }
  }
  return cats.slice(0, 24);
}

function categoriesFromTableRows(table: string[][]): ContextCategory[] {
  const cats: ContextCategory[] = [];
  for (const row of table) {
    if (row.length < 3) continue;
    const [label, tokens, pct] = row;
    if (/^category$/i.test(label.trim())) continue;
    cats.push({
      label: label.trim(),
      tokens: tokens.trim(),
      percentage: parsePctCell(pct)
    });
  }
  return cats;
}

function agentsFromTableRows(table: string[][]): ContextAgentRow[] {
  const agents: ContextAgentRow[] = [];
  for (const row of table) {
    if (row.length < 2) continue;
    if (/^agent\b/i.test(row[0].trim())) continue;
    if (row.length >= 3) {
      agents.push({ name: row[0].trim(), source: row[1].trim(), tokens: row[2].trim() });
    } else {
      agents.push({ name: row[0].trim(), tokens: row[1].trim() });
    }
  }
  return agents;
}

function skillsFromTableRows(table: string[][]): ContextSkillRow[] {
  const skills: ContextSkillRow[] = [];
  for (const row of table) {
    if (row.length < 2) continue;
    if (/^skill\b/i.test(row[0].trim())) continue;
    if (row.length >= 3) {
      skills.push({ name: row[0].trim(), source: row[1].trim(), tokens: row[2].trim() });
    } else {
      skills.push({ name: row[0].trim(), tokens: row[1].trim() });
    }
  }
  return skills;
}

export function parseContextOutput(raw: string): ContextUsage {
  const model = parseModelFromContext(raw) || lineValue(raw, 'Model') || '—';
  const tokensInfo = parseTokensLine(raw);
  const totalTokens = tokensInfo?.used ?? lineValue(raw, 'Total') ?? lineValue(raw, 'Used') ?? '—';
  const maxTokens = tokensInfo?.max ?? lineValue(raw, 'Max') ?? lineValue(raw, 'Limit') ?? '—';
  const pctFromLine = tokensInfo?.pct ?? 0;
  const pctFromField = parseFloat(lineValue(raw, '% used') || lineValue(raw, 'used') || '0') || 0;
  const percentage = pctFromLine > 0 ? pctFromLine : pctFromField;

  const catTable = parsePipeTableAfterHeading(raw, /#{2,3}\s*Estimated usage by category/i);
  let categories = categoriesFromTableRows(catTable);
  if (categories.length === 0) {
    categories = parseContextCategoriesLegacy(raw);
  }
  if (categories.length === 0) {
    categories = [{ label: 'Full output', tokens: `${raw.length} chars`, percentage: 100 }];
  }

  const agentTable = parsePipeTableAfterHeading(raw, /#{2,3}\s*Custom Agents\b/i);
  const agents = agentsFromTableRows(agentTable);

  const skillTable = parsePipeTableAfterHeading(raw, /#{2,3}\s*Skills\b/i);
  const skills = skillsFromTableRows(skillTable);

  return {
    model,
    modelFull: lineValue(raw, 'model id') || lineValue(raw, 'Model ID') || model,
    totalTokens,
    maxTokens,
    percentage,
    categories,
    agents,
    skills
  };
}
