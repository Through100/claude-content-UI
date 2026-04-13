import type { SystemStatus, CostInfo, ContextUsage, ContextCategory, ModelUsage } from '../src/types';

function lineValue(raw: string, label: string): string | undefined {
  const re = new RegExp(`^${label}\\s*[:：]\\s*(.+)$`, 'im');
  const m = raw.match(re);
  return m?.[1]?.trim();
}

/** Best-effort parse of `/status` style text into dashboard fields. */
export function parseStatusOutput(raw: string): SystemStatus {
  const text = raw.trim() || '(empty)';
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

function parseContextCategories(raw: string): ContextCategory[] {
  const cats: ContextCategory[] = [];
  const block = raw.split(/categories|breakdown/i)[1] || raw;
  for (const line of block.split('\n')) {
    const m = line.match(/(.+?)\s+([\d.,]+[kKmM]?)\s+tokens?\s*\(?\s*([\d.]+)\s*%/i);
    if (m) {
      cats.push({ label: m[1].trim(), tokens: m[2], percentage: parseFloat(m[3]) });
    }
  }
  return cats.slice(0, 24);
}

export function parseContextOutput(raw: string): ContextUsage {
  const categories = parseContextCategories(raw);
  const padded =
    categories.length > 0
      ? categories
      : [{ label: 'Full output', tokens: `${raw.length} chars`, percentage: 100 }];

  return {
    model: lineValue(raw, 'Model') || '—',
    modelFull: lineValue(raw, 'model id') || lineValue(raw, 'Model ID') || '—',
    totalTokens: lineValue(raw, 'Total') || lineValue(raw, 'Used') || '—',
    maxTokens: lineValue(raw, 'Max') || lineValue(raw, 'Limit') || '—',
    percentage: parseFloat(lineValue(raw, '% used') || lineValue(raw, 'used') || '0') || 0,
    categories: padded,
    agents: [],
    skills: []
  };
}
