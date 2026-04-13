import type {
  SystemStatus,
  CostInfo,
  ContextUsage,
  ContextCategory,
  ModelUsage,
  ContextAgentRow,
  ContextSkillRow,
  UsageTabInfo,
  UsageQuotaSlot,
  UsageQuotasPanel
} from '../src/types';
import { formatRefreshCountdown, parseResetToUtcDate } from './usageResetCountdown';

function lineValue(raw: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}\\s*[:：]\\s*(.+)$`, 'im');
  const m = raw.match(re);
  return m?.[1]?.trim();
}

/**
 * Headless probe for the **Status** tab of interactive `/usage` (or `/status` settings): version, session, account, model.
 * Slash commands do not work under `claude -p`.
 */
export const STATUS_TAB_HEADLESS_PROMPT = `You are filling a read-only web dashboard for Claude Code.

CRITICAL: Do NOT use slash commands (/status, /usage, etc.). This is non-interactive print (-p) mode — they become "Unknown skill" errors.

Reproduce ONLY what a user would see on the **Status** tab after opening /usage (or the Status tab in settings) — NOT the Usage, Config, or Stats tabs.

You MAY use Bash (e.g. \`claude --version\` or \`claude -v\`) and Read on \`.claude\` / project config if readable.

Reply with NOTHING else — no markdown, no preamble. Exactly 9 lines, this shape (real values; use — when unknown):

Version: 2.1.104
Session name: —
Session ID: —
cwd: /path/to/project
Login method: Claude Pro Account
Organization: —
Email: —
Model: Sonnet
Setting sources: Project local settings`;

/**
 * Headless probe for the **Usage** tab only (plan limits, rolling window, weekly quotas, resets) — not Status/Config/Stats.
 */
export const USAGE_TAB_HEADLESS_PROMPT = `You are filling a read-only web dashboard for Claude Code.

CRITICAL: Do NOT use slash commands. This is non-interactive print (-p) mode.

Reproduce ONLY what appears on the **Usage** tab when a user runs interactive \`/usage\` — rate-limit window ("current session" usage), weekly usage for all models, weekly Opus usage, context window %, and reset timers / rate-limit notes. Do NOT include Version, Session ID, Email, cwd, Login method, or other **Status** tab fields.

You MAY use Bash, Read, and if present readable files such as \`~/.claude/usage-exact.json\` for accurate numbers.

Reply with NOTHING else — no markdown, no preamble. Exactly 5 lines:

Current session usage: 46% · resets in 3h 20m
Weekly usage all models: 42% · resets Mon 14:00
Weekly usage Opus: — 
Context window: 34% used
Rate limits and resets: (extra usage, plan notes, or —)

Use — on a line when that metric does not apply (e.g. no Opus line).`;

/**
 * One headless run for both tabs (saves a full parallel Claude spawn; wall time ≈ max of probes, not sum).
 * Output order: Status block first, blank line, Usage block (same line shapes as the two prompts above).
 */
export const STATUS_AND_USAGE_TAB_HEADLESS_PROMPT = `You are filling a read-only web dashboard for Claude Code.

CRITICAL: Do NOT use slash commands (/status, /usage, etc.). This is non-interactive print (-p) mode — they become "Unknown skill" errors.

First reproduce the **Status** tab (after opening /usage or Status in settings). Then a single blank line. Then reproduce the **Usage** tab only (plan limits, session %, weekly quotas, context %, rate-limit notes) — NOT Config or Stats.

If the prompt begins with a LOCAL_USAGE_JSON code block, the API server read that from your machine's Claude config (same data many setups use for /usage). Prefer it over guessing; do not claim the file is missing when that JSON is present. You MAY use Bash/Read only for fields still missing.

Reply with NOTHING else — no markdown, no preamble. Exactly 14 lines in this order (real values; use — when unknown):

Version: 2.1.104
Session name: —
Session ID: —
cwd: /path/to/project
Login method: Claude Pro Account
Organization: —
Email: —
Model: Sonnet
Setting sources: Project local settings

Current session usage: 46% · resets in 3h 20m
Weekly usage all models: 42% · resets Mon 14:00
Weekly usage Opus: —
Context window: 34% used
Rate limits and resets: (extra usage, plan notes, or —)`;

/** Split combined probe output into Status vs Usage raw text for separate parsing and terminal panels. */
export function splitCombinedStatusUsageRaw(raw: string): { status: string; usage: string } {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const usageStart = lines.findIndex(
    (l) =>
      /^\s*Current session usage\s*:/i.test(l) ||
      /^\s*Session usage\s*:/i.test(l)
  );
  if (usageStart <= 0) {
    const t = raw.trim();
    return { status: t, usage: t };
  }
  return {
    status: lines.slice(0, usageStart).join('\n').trim(),
    usage: lines.slice(usageStart).join('\n').trim()
  };
}

/**
 * Strip model chatter; keep lines that look like "Label: value" for reliable parsing.
 */
export function extractSessionKeyValueLines(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return text;
  const lines = text.split('\n');
  const kv = lines.filter((line) => {
    const t = line.trim();
    if (!t || t.startsWith('```') || /^#{1,6}\s/.test(t)) return false;
    return /^[A-Za-z][A-Za-z0-9 /&.+\-]*\s*[:：]\s*\S/.test(t);
  });
  return kv.length >= 2 ? kv.join('\n') : text;
}

/** Best-effort parse of `/status` style text into dashboard fields. */
export function parseStatusOutput(raw: string): SystemStatus {
  const text = raw.trim() || '(empty)';
  if (/unknown skill:/im.test(text)) {
    return {
      version: '—',
      sessionName: '—',
      sessionId: '—',
      cwd: '—',
      authToken: '—',
      apiKey: '—',
      organization: '—',
      email: '—',
      model: '—',
      loginMethod: undefined,
      settingSources: undefined
    };
  }
  return {
    version: lineValue(raw, 'Version') || lineValue(raw, 'Claude Code') || text.split('\n')[0]?.slice(0, 80) || '—',
    sessionName:
      lineValue(raw, 'Session name') ||
      lineValue(raw, 'Session Name') ||
      lineValue(raw, 'Session') ||
      lineValue(raw, 'Name') ||
      '—',
    sessionId: lineValue(raw, 'Session ID') || lineValue(raw, 'session id') || '—',
    cwd: lineValue(raw, 'cwd') || lineValue(raw, 'CWD') || lineValue(raw, 'Working directory') || '—',
    authToken: lineValue(raw, 'Auth') || lineValue(raw, 'Token') || '—',
    apiKey: lineValue(raw, 'API key') || lineValue(raw, 'API Key') || '—',
    organization: lineValue(raw, 'Organization') || lineValue(raw, 'Org') || '—',
    email: lineValue(raw, 'Email') || lineValue(raw, 'Account') || '—',
    model: lineValue(raw, 'Model') || lineValue(raw, 'Current model') || '—',
    loginMethod: lineValue(raw, 'Login method') || lineValue(raw, 'Login Method') || undefined,
    settingSources: lineValue(raw, 'Setting sources') || lineValue(raw, 'Setting Sources') || undefined
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

/** True when `/cost` indicates Pro/subscription billing (no per-token dollar table). */
export function isSubscriptionBillingMode(costRaw: string): boolean {
  const t = costRaw.toLowerCase();
  if (/using your subscription\b/i.test(costRaw)) return true;
  if (/subscription to power your claude code/i.test(t)) return true;
  if (/power your claude code usage/i.test(t)) return true;
  return false;
}

const emptyUsageTab = (): UsageTabInfo => ({
  currentSessionUsage: '—',
  weeklyUsageAllModels: '—',
  weeklyUsageOpus: '—',
  contextWindow: '—',
  rateLimitsAndResets: '—'
});

/** Parsed **Usage** tab lines from headless probe (see USAGE_TAB_HEADLESS_PROMPT). */
export function parseUsageTabOutput(raw: string): UsageTabInfo {
  const text = raw.trim() || '';
  if (!text || /^unknown skill:/im.test(text)) {
    return emptyUsageTab();
  }
  return {
    currentSessionUsage:
      lineValue(raw, 'Current session usage') ||
      lineValue(raw, 'Current Session Usage') ||
      lineValue(raw, 'Session usage') ||
      '—',
    weeklyUsageAllModels:
      lineValue(raw, 'Weekly usage all models') ||
      lineValue(raw, 'Current Week Usage (All Models)') ||
      lineValue(raw, 'Weekly usage (all models)') ||
      '—',
    weeklyUsageOpus:
      lineValue(raw, 'Weekly usage Opus') ||
      lineValue(raw, 'Current Week Usage (Opus)') ||
      lineValue(raw, 'Weekly usage (Opus)') ||
      '—',
    contextWindow:
      lineValue(raw, 'Context window') ||
      lineValue(raw, 'Context Window') ||
      lineValue(raw, 'Context') ||
      '—',
    rateLimitsAndResets:
      lineValue(raw, 'Rate limits and resets') ||
      lineValue(raw, 'Rate limits') ||
      lineValue(raw, 'Resets') ||
      '—'
  };
}

function pctUsedFromLine(line: string): string | null {
  const m = line.match(/(\d+(?:\.\d+)?)\s*%\s*used/i);
  return m ? `${m[1]}% used` : null;
}

function findLineIndex(lines: string[], re: RegExp): number {
  return lines.findIndex((l) => re.test(l.trim()));
}

function sliceUntilNextHeadings(lines: string[], startExclusive: number, stopRes: RegExp[]): string[] {
  const out: string[] = [];
  for (let i = startExclusive; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t && stopRes.some((re) => re.test(t))) break;
    out.push(lines[i]);
  }
  return out;
}

function emptyQuotaSlot(label: string): UsageQuotaSlot {
  return {
    label,
    percentUsed: null,
    resetRaw: null,
    resetAtIso: null,
    refreshCountdown: null
  };
}

function buildQuotaSlotFromLines(label: string, blockLines: string[], now: Date): UsageQuotaSlot {
  let percentUsed: number | null = null;
  let resetRaw: string | null = null;
  for (const line of blockLines) {
    const pm = line.match(/(\d+(?:\.\d+)?)\s*%\s*used/i);
    if (pm && percentUsed === null) percentUsed = parseFloat(pm[1]);
    const rm = line.trim().match(/^Resets\s+(.+)/i);
    if (rm) resetRaw = rm[1].trim();
  }
  const target = parseResetToUtcDate(resetRaw, now);
  const resetAtIso = target ? target.toISOString() : null;
  const refreshCountdown = formatRefreshCountdown(target, now);
  return { label, percentUsed, resetRaw, resetAtIso, refreshCountdown };
}

/**
 * Parse `/stats` (interactive-style /usage summary): Status key lines, Usage blocks, optional Stats/Config headings.
 */
export function parseStatsCommandOutput(
  raw: string,
  now: Date = new Date()
): {
  status: SystemStatus;
  usageTab: UsageTabInfo;
  usageQuotas: UsageQuotasPanel;
} {
  const emptyU = (): UsageTabInfo => ({
    currentSessionUsage: '—',
    weeklyUsageAllModels: '—',
    weeklyUsageOpus: '—',
    contextWindow: '—',
    rateLimitsAndResets: '—'
  });

  const emptyQuotas = (): UsageQuotasPanel => ({
    session: emptyQuotaSlot('Current session'),
    weekAllModels: emptyQuotaSlot('Current week (all models)'),
    extraUsageLine: null
  });

  const norm = raw.replace(/\r\n/g, '\n');
  if (!norm.trim() || /^unknown skill:/im.test(norm)) {
    return {
      status: parseStatusOutput(norm),
      usageTab: emptyU(),
      usageQuotas: emptyQuotas()
    };
  }

  const lines = norm.split('\n');

  let usageStart = findLineIndex(lines, /^(#*\s*)?Current session(?:\s+usage)?\s*:?\s*$/i);
  if (usageStart < 0) {
    usageStart = findLineIndex(lines, /^Current session usage\s*:/i);
  }

  const idxWeek = findLineIndex(lines, /^#*\s*Current week\s*\(\s*all models\s*\)/i);
  const idxExtra = findLineIndex(lines, /^#*\s*Extra usage/i);
  const idxStats = findLineIndex(lines, /^#*\s*Stats\b/i);
  const idxConfig = findLineIndex(lines, /^#*\s*Config\b/i);

  const statusStop =
    usageStart >= 0
      ? usageStart
      : idxWeek >= 0
        ? idxWeek
        : idxExtra >= 0
          ? idxExtra
          : idxStats >= 0
            ? idxStats
            : idxConfig >= 0
              ? idxConfig
              : lines.length;
  const statusSlice = lines.slice(0, Math.max(0, statusStop)).join('\n');
  const status = parseStatusOutput(extractSessionKeyValueLines(statusSlice) || statusSlice);

  let currentSessionUsage = '—';
  if (usageStart >= 0 && /^Current session usage\s*:/i.test(lines[usageStart].trim())) {
    currentSessionUsage =
      lineValue(lines.slice(usageStart, usageStart + 6).join('\n'), 'Current session usage') ||
      lineValue(norm, 'Current session usage') ||
      '—';
  } else if (usageStart >= 0) {
    const sessionBlock = sliceUntilNextHeadings(lines, usageStart + 1, [
      /^Current week\s*\(\s*all models\s*\)/i,
      /^Extra usage/i,
      /^Stats\b/i,
      /^Config\b/i,
      /^Current session\b/i
    ]);
    const block = sessionBlock;
    const pcts: string[] = [];
    const resets: string[] = [];
    for (const line of block) {
      const p = pctUsedFromLine(line);
      if (p && !pcts.includes(p)) pcts.push(p);
      const rm = line.trim().match(/^Resets\s+(.+)/i);
      if (rm) resets.push(rm[1].trim());
    }
    if (pcts.length) {
      currentSessionUsage = pcts[0] + (resets[0] ? ` · Resets ${resets[0]}` : '');
    } else {
      const summary = block
        .map((l) => l.trim())
        .filter((t) => t && !/^⎿/.test(t))
        .slice(0, 5)
        .join(' · ');
      if (summary) currentSessionUsage = summary;
    }
  }

  let weeklyUsageAllModels = '—';
  let weeklyUsageOpus = '—';
  if (idxWeek >= 0) {
    const weekBlock = sliceUntilNextHeadings(lines, idxWeek + 1, [
      /^Current week\s*\(\s*opus\s*\)/i,
      /^Extra usage/i,
      /^Stats\b/i,
      /^Config\b/i,
      /^Current session\b/i
    ]);
    const block = weekBlock;
    const pcts: string[] = [];
    const resets: string[] = [];
    for (const line of block) {
      const p = pctUsedFromLine(line);
      if (p && !pcts.includes(p)) pcts.push(p);
      const rm = line.trim().match(/^Resets\s+(.+)/i);
      if (rm) resets.push(rm[1].trim());
    }
    if (pcts[0]) {
      weeklyUsageAllModels = pcts[0] + (resets[0] ? ` · Resets ${resets[0]}` : '');
    }

    const relOpus = findLineIndex(lines.slice(idxWeek), /^#*\s*Current week\s*\(\s*opus\s*\)/i);
    if (relOpus >= 0) {
      const abs = idxWeek + relOpus;
      const ob = sliceUntilNextHeadings(lines, abs + 1, [/^Extra usage/i, /^Stats\b/i, /^Current week\s*\(\s*all models\s*\)/i]);
      const op = ob
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 8)
        .join(' · ');
      if (op) weeklyUsageOpus = op;
    }
  }

  let rateLimitsAndResets = '—';
  if (idxExtra >= 0) {
    const block = sliceUntilNextHeadings(lines, idxExtra + 1, [
      /^Stats\b/i,
      /^Config\b/i,
      /^Current session\b/i,
      /^Current week\b/i
    ]);
    const t = block
      .map((l) => l.trim())
      .filter((x) => x && !/^Esc to cancel/i.test(x))
      .join(' · ');
    if (t) rateLimitsAndResets = t;
  }

  const sessionBlockLines =
    usageStart >= 0 && !/^Current session usage\s*:/i.test(lines[usageStart].trim())
      ? sliceUntilNextHeadings(lines, usageStart + 1, [
          /^Current week\s*\(\s*all models\s*\)/i,
          /^Extra usage/i,
          /^Stats\b/i,
          /^Config\b/i,
          /^Current session\b/i
        ])
      : [];
  const weekBlockLines =
    idxWeek >= 0
      ? sliceUntilNextHeadings(lines, idxWeek + 1, [
          /^Current week\s*\(\s*opus\s*\)/i,
          /^Extra usage/i,
          /^Stats\b/i,
          /^Config\b/i,
          /^Current session\b/i
        ])
      : [];

  const fb = parseUsageTabOutput(norm);
  const merge = (a: string, b: string) => (a === '—' && b && b !== '—' ? b : a);

  const usageTab: UsageTabInfo = {
    currentSessionUsage: merge(currentSessionUsage, fb.currentSessionUsage),
    weeklyUsageAllModels: merge(weeklyUsageAllModels, fb.weeklyUsageAllModels),
    weeklyUsageOpus: merge(weeklyUsageOpus, fb.weeklyUsageOpus),
    contextWindow: fb.contextWindow,
    rateLimitsAndResets: merge(rateLimitsAndResets, fb.rateLimitsAndResets)
  };

  const usageQuotas: UsageQuotasPanel = {
    session:
      sessionBlockLines.length > 0
        ? buildQuotaSlotFromLines('Current session', sessionBlockLines, now)
        : emptyQuotaSlot('Current session'),
    weekAllModels:
      weekBlockLines.length > 0
        ? buildQuotaSlotFromLines('Current week (all models)', weekBlockLines, now)
        : emptyQuotaSlot('Current week (all models)'),
    extraUsageLine:
      usageTab.rateLimitsAndResets && usageTab.rateLimitsAndResets !== '—'
        ? usageTab.rateLimitsAndResets
        : null
  };

  if (usageQuotas.session.percentUsed === null && usageTab.currentSessionUsage !== '—') {
    const m = usageTab.currentSessionUsage.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) {
      const r = usageTab.currentSessionUsage.match(/Resets\s+([^·]+)/i);
      const resetRaw = r?.[1]?.trim() ?? null;
      const target = parseResetToUtcDate(resetRaw, now);
      usageQuotas.session = {
        label: 'Current session',
        percentUsed: parseFloat(m[1]),
        resetRaw,
        resetAtIso: target ? target.toISOString() : null,
        refreshCountdown: formatRefreshCountdown(target, now)
      };
    }
  }
  if (usageQuotas.weekAllModels.percentUsed === null && usageTab.weeklyUsageAllModels !== '—') {
    const m = usageTab.weeklyUsageAllModels.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) {
      const r = usageTab.weeklyUsageAllModels.match(/Resets\s+([^·]+)/i);
      const resetRaw = r?.[1]?.trim() ?? null;
      const target = parseResetToUtcDate(resetRaw, now);
      usageQuotas.weekAllModels = {
        label: 'Current week (all models)',
        percentUsed: parseFloat(m[1]),
        resetRaw,
        resetAtIso: target ? target.toISOString() : null,
        refreshCountdown: formatRefreshCountdown(target, now)
      };
    }
  }

  return { status, usageTab, usageQuotas };
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
  if (m) {
    return {
      used: m[1].trim(),
      max: m[2].trim(),
      pct: m[3] != null && m[3] !== '' ? parseFloat(m[3]) : 0
    };
  }
  const m2 = raw.match(
    /([\d.,]+[kKmM]?)\s*\/\s*([\d.,]+[kKmM]?)\s+tokens?\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)/i
  );
  if (m2) {
    return {
      used: m2[1].trim(),
      max: m2[2].trim(),
      pct: parseFloat(m2[3])
    };
  }
  return null;
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

/** Tree lines like "└ agent-name: 75 tokens" under Custom agents / Skills headings. */
function parseContextAgentsSkillsFromTree(raw: string): {
  agents: ContextAgentRow[];
  skills: ContextSkillRow[];
} {
  const agents: ContextAgentRow[] = [];
  const skills: ContextSkillRow[] = [];
  let mode: 'none' | 'agents' | 'skills' = 'none';
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (/estimated usage by category/i.test(t)) {
      mode = 'none';
      continue;
    }
    if (/Custom agents\b/i.test(t)) {
      mode = 'agents';
      continue;
    }
    if (/^Skills\b/i.test(t) || /\bSkills\s*·\s*\/skills/i.test(t)) {
      mode = 'skills';
      continue;
    }
    if (/^#{1,3}\s/.test(t) && !/agents|skills/i.test(t)) {
      mode = 'none';
    }
    const m = t.match(/^[\u2514\u251c│├└\-–]\s*([^:]+):\s*([\d.,]+[kKmM]?)\s*tokens?/i);
    if (!m) continue;
    const name = m[1].trim();
    if (/^user$/i.test(name)) continue;
    const tokens = m[2].trim();
    if (mode === 'agents') agents.push({ name, tokens });
    else if (mode === 'skills') skills.push({ name, tokens });
  }
  return { agents: agents.slice(0, 48), skills: skills.slice(0, 48) };
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
  let agents = agentsFromTableRows(agentTable);

  const skillTable = parsePipeTableAfterHeading(raw, /#{2,3}\s*Skills\b/i);
  let skills = skillsFromTableRows(skillTable);

  if (agents.length === 0 || skills.length === 0) {
    const tree = parseContextAgentsSkillsFromTree(raw);
    if (agents.length === 0) agents = tree.agents;
    if (skills.length === 0) skills = tree.skills;
  }

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
