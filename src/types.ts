export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'passed';

export interface Finding {
  severity: Severity;
  issue: string;
  recommendation: string;
  /** From `- **Issue:**` (or `- Issue:`) bullet under the finding title */
  issueDetail?: string;
  impact?: string;
  fix?: string;
  example?: string;
  /** Raw issue body when structured bullets were not detected (expand fallback) */
  detailNotes?: string;
}

export interface ReportSection {
  title: string;
  score: number;
  findings: Finding[];
}

export interface ScoreCategory {
  label: string;
  score: number;
}

/** Count of parsed findings per severity (executive summary third column). */
export interface IssuesBySeverity {
  critical: number;
  high: number;
  medium: number;
  low: number;
  passed: number;
}

export interface ParsedReport {
  summary: {
    overallScore: number;
    /** Score-based label only (e.g. Excellent … Critical); not tied to issue severity mix. */
    status: string;
    /** Critical + high finding counts; kept for older stored runs and simple totals. */
    highPriorityIssues: number;
    issuesBySeverity: IssuesBySeverity;
    categories?: ScoreCategory[];
  };
  sections: ReportSection[];
  rawSummary?: string;
}

export interface RunStats {
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  /**
   * Directory name under `workspace-files/<this>/` for this run (command + target + per-run token).
   * Used to load the correct Full Report and downloads for a specific history entry.
   */
  workspaceOutputSegment?: string;
}

export interface RunResponse {
  success: boolean;
  commandExecuted: string;
  rawOutput: string;
  parsedReport?: ParsedReport;
  stats: RunStats;
  error?: string;
}

export interface HistoryItem {
  id: string;
  timestamp: string; // ISO string
  commandKey: string;
  commandLabel: string;
  target: string;
  status: 'success' | 'error';
  durationMs: number;
  rawOutput?: string;
  parsedReport?: ParsedReport;
  /** Same as {@link RunStats.workspaceOutputSegment}; persisted for History Full Report / downloads. */
  workspaceOutputSegment?: string;
}

export interface GroupedHistory {
  target: string;
  items: HistoryItem[];
  latestTimestamp: string;
}

export interface SystemStatus {
  version: string;
  sessionName: string;
  sessionId: string;
  cwd: string;
  authToken: string;
  apiKey: string;
  organization: string;
  email: string;
  model: string;
  /** Status tab, e.g. "Claude Pro Account" */
  loginMethod?: string;
  /** Status tab: e.g. "Project local settings" */
  settingSources?: string;
}

export interface ModelUsage {
  model: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
  cost: string;
}

export interface CostInfo {
  totalCost: string;
  apiDuration: string;
  wallDuration: string;
  codeChanges: {
    added: number;
    removed: number;
  };
  usageByModel: ModelUsage[];
}

export interface ContextCategory {
  label: string;
  tokens: string;
  percentage: number;
}

export interface ContextAgentRow {
  name: string;
  source?: string;
  tokens: string;
}

export interface ContextSkillRow {
  name: string;
  source?: string;
  tokens: string;
}

export interface ContextUsage {
  model: string;
  modelFull: string;
  totalTokens: string;
  maxTokens: string;
  percentage: number;
  categories: ContextCategory[];
  agents: ContextAgentRow[];
  skills: ContextSkillRow[];
}

/**
 * Parsed **Usage** tab of interactive `/usage` (plan limits, rolling window, weekly quotas — not Status/Config/Stats).
 */
export interface UsageTabInfo {
  currentSessionUsage: string;
  weeklyUsageAllModels: string;
  weeklyUsageOpus: string;
  contextWindow: string;
  rateLimitsAndResets: string;
}

export type UsageBillingMode = 'api_credits' | 'subscription';

export type UsageQuotaSectionId = 'current_session' | 'current_week' | 'extra_usage';

/** Parsed Usage tab rows (Current session / Current week / Extra usage) from TUI text. */
export interface UsageQuotaSection {
  id: UsageQuotaSectionId;
  title: string;
  percentUsed: number | null;
  /** Raw progress line from the terminal, when detected. */
  barLine?: string;
  /** Lines below the bar: resets, spend, UTC, etc. */
  detailLines: string[];
  /** False when this slot was not found in the captured output (placeholder row). */
  matched?: boolean;
}

/** Snapshot extracted from `/usage` raw output for the Pretty Usage view. */
export interface UsageQuotaSnapshot {
  sections: UsageQuotaSection[];
  /** True when at least one section header and a usable % were detected. */
  parseOk: boolean;
}

/** Parsed `/cost` panel (API-key accounts); per-session totals. */
export interface UsageCostSnapshot {
  parseOk: boolean;
  totalCost?: string;
  totalDurationApi?: string;
  totalDurationWall?: string;
  totalCodeChanges?: string;
  /** e.g. "0 input, 0 output, 0 cache read, 0 cache write" */
  usageSummary?: string;
}

/** API GET /api/usage and POST /api/usage/exec — merged stdout/stderr. */
export interface UsageInfo {
  /** Probes run for this response (subscription-style `/usage` plus API-style `/cost`). */
  line: string;
  execMode: 'bash_quoted_usage' | 'bash_quoted_usage_cost';
  /**
   * Full capture for the Raw tab: `/usage` block, separator, then `/cost` block.
   * Quota parsing still uses only the usage portion server-side.
   */
  output: string;
  /** Exit code from the `claude "/usage"` probe. */
  exitCode: number | null;
  argv: string[];
  /** Parsed quota rows from the Usage tab portion of `output` (before any appended local JSON snapshot). */
  quotaSnapshot?: UsageQuotaSnapshot;
  /** Parsed `/cost` summary when the CLI returned the API billing panel. */
  costSnapshot?: UsageCostSnapshot;
  /** Exit code from the `claude "/cost"` probe. */
  costExitCode?: number | null;
  /** argv for the cost bash wrapper (same shape as `argv` for usage). */
  costArgv?: string[];
}

/** Fields parsed from the Status tab of interactive `claude "/status"`. */
export interface AccountStatusSnapshot {
  version?: string;
  sessionName?: string;
  sessionId?: string;
  cwd?: string;
  loginMethod?: string;
  organization?: string;
  email?: string;
  model?: string;
  settingSources?: string;
  /** True when several labeled rows were found (TUI text was readable). */
  parseOk: boolean;
}

/** API GET /api/account — same bash/script PTY tactic as Usage, for `claude "/status"`. */
export interface AccountStatusInfo {
  line: string;
  execMode: 'bash_quoted_status';
  output: string;
  exitCode: number | null;
  argv: string[];
  statusSnapshot?: AccountStatusSnapshot;
}

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
}

/** Dashboard slash-command (blog skill). */
export interface BlogCommand {
  key: string;
  label: string;
  command: string;
  placeholder: string;
  /** When true, the target field may be left empty (prompt is just `command`). */
  targetOptional: boolean;
}

export const BLOG_COMMANDS: BlogCommand[] = [
  {
    key: 'write',
    label: 'Write — new post from scratch',
    command: '/blog write',
    placeholder: 'Topic or angle, e.g. "Rust async for web APIs"',
    targetOptional: false
  },
  {
    key: 'rewrite',
    label: 'Rewrite — optimize existing post',
    command: '/blog rewrite',
    placeholder: 'Path to file, e.g. content/posts/guide.md',
    targetOptional: false
  },
  {
    key: 'analyze',
    label: 'Analyze — quality audit (0–100)',
    command: '/blog analyze',
    placeholder: 'Path to file, e.g. content/posts/guide.md',
    targetOptional: false
  },
  {
    key: 'brief',
    label: 'Brief — detailed content brief',
    command: '/blog brief',
    placeholder: 'Topic, e.g. "email onboarding for SaaS"',
    targetOptional: false
  },
  {
    key: 'calendar',
    label: 'Calendar — editorial calendar',
    command: '/blog calendar',
    placeholder: 'Optional: quarter, theme, or leave empty',
    targetOptional: true
  },
  {
    key: 'strategy',
    label: 'Strategy — blog strategy & topics',
    command: '/blog strategy',
    placeholder: 'Niche, e.g. "B2B analytics for manufacturers"',
    targetOptional: false
  },
  {
    key: 'outline',
    label: 'Outline — SERP-informed outline',
    command: '/blog outline',
    placeholder: 'Topic, e.g. "best CRM for agencies"',
    targetOptional: false
  },
  {
    key: 'seo-check',
    label: 'SEO check — post-writing validation',
    command: '/blog seo-check',
    placeholder: 'Path to file, e.g. content/posts/guide.md',
    targetOptional: false
  },
  {
    key: 'schema',
    label: 'Schema — JSON-LD markup',
    command: '/blog schema',
    placeholder: 'Path to file, e.g. content/posts/guide.md',
    targetOptional: false
  },
  {
    key: 'repurpose',
    label: 'Repurpose — social, email, YouTube',
    command: '/blog repurpose',
    placeholder: 'Path to file, e.g. content/posts/guide.md',
    targetOptional: false
  },
  {
    key: 'geo',
    label: 'GEO — AI citation readiness',
    command: '/blog geo',
    placeholder: 'Path to file, e.g. content/posts/guide.md',
    targetOptional: false
  },
  {
    key: 'image',
    label: 'Image — Gemini image generation',
    command: '/blog image',
    placeholder: 'Optional prompt or leave empty',
    targetOptional: true
  },
  {
    key: 'site-health',
    label: 'Audit — full-site blog health',
    command: '/blog audit',
    placeholder: 'Optional directory, e.g. content/ (or leave empty for default)',
    targetOptional: true
  },
  {
    key: 'cannibalization',
    label: 'Cannibalization — keyword overlap',
    command: '/blog cannibalization',
    placeholder: 'Optional directory to scan (or leave empty)',
    targetOptional: true
  },
  {
    key: 'factcheck',
    label: 'Factcheck — verify statistics',
    command: '/blog factcheck',
    placeholder: 'Path to file, e.g. content/posts/guide.md',
    targetOptional: false
  },
  {
    key: 'persona',
    label: 'Persona — voice & personas',
    command: '/blog persona',
    placeholder: 'Optional: persona name or subcommand (or leave empty)',
    targetOptional: true
  },
  {
    key: 'taxonomy',
    label: 'Taxonomy — tags & categories',
    command: '/blog taxonomy',
    placeholder: 'Optional: action or leave empty',
    targetOptional: true
  }
];

/**
 * Directory name under `workspace-files/<segment>/` so outputs never collide when the same target
 * is used with different blog commands (matches `formatChatThreadKey(commandKey, target)` intent).
 */
export function workspaceFilesDirSegment(commandKey: string, targetTrimmed: string): string {
  const t = targetTrimmed.trim();
  let targetSlug = t
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!targetSlug) targetSlug = 'output';
  const maxTarget = 80;
  if (targetSlug.length > maxTarget) {
    let hash = 0;
    for (let i = 0; i < t.length; i++) {
      hash = (hash << 5) - hash + t.charCodeAt(i);
      hash |= 0;
    }
    const hashStr = Math.abs(hash).toString(36).slice(0, 6);
    targetSlug = targetSlug.slice(0, maxTarget - hashStr.length - 1).replace(/-+$/, '') + '-' + hashStr;
  }
  const cmdPart = commandKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const cmdSlug = cmdPart || 'cmd';
  return `${cmdSlug}--${targetSlug}`;
}

/** Makes a single-run token safe as part of a directory name (e.g. ISO timestamps). */
export function sanitizeWorkspaceRunToken(token: string): string {
  return token
    .trim()
    .replace(/:/g, '-')
    .replace(/\./g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 96);
}

/**
 * UTC folder stamp so each run gets its own workspace directory: date + clock time to the minute,
 * plus seconds and milliseconds so repeated scans in the same minute never collide.
 * Example: `2026-05-01-1430-52-847` → 1 May 2026 14:30:52.847 UTC.
 */
export function formatWorkspaceRunMinuteToken(runInstant: string | number | Date): string {
  const d =
    runInstant instanceof Date
      ? runInstant
      : typeof runInstant === 'number'
        ? new Date(runInstant)
        : new Date(runInstant);
  const ts = d.getTime();
  if (!Number.isFinite(ts)) {
    return sanitizeWorkspaceRunToken(String(runInstant));
  }
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${da}-${h}${mi}-${s}-${ms}`;
}

/**
 * Directory segment for one dashboard/API run: `command--target--run-<minute-token>` so outputs do not collide
 * across reruns the same day. `runToken` is typically `stats.startedAt` (ISO); it is normalized via
 * {@link formatWorkspaceRunMinuteToken}.
 */
export function formatWorkspaceRunDirSegment(commandKey: string, targetTrimmed: string, runToken: string): string {
  const base = workspaceFilesDirSegment(commandKey, targetTrimmed);
  const stamped = formatWorkspaceRunMinuteToken(runToken.trim());
  const t = sanitizeWorkspaceRunToken(stamped);
  if (!t) return base;
  return `${base}--run-${t}`;
}

export type WorkspaceReportCandidatesOptions = {
  /**
   * Directory name only (no `workspace-files/` prefix), e.g.
   * `site-health--example-com--run-2026-05-01-1430-52-847`.
   * When set, paths under this run folder are preferred; fallback guesses use this folder first, then the legacy command+target folder.
   */
  runDirSegment?: string;
};

/**
 * Ordered relative paths under CLAUDE_WORKDIR to try for Full Report when loading History or when
 * the saved transcript never mentions the final `Write(.../*.md)` line (common for long PTY runs).
 * Extracted paths from the transcript are tried first (paths under the run-specific folder first);
 * then command-specific guesses under `workspace-files/<runDirSegment>/`, then legacy `workspace-files/<cmd--target>/`.
 */
export function workspaceReportMarkdownCandidates(
  commandKey: string,
  targetTrimmed: string,
  extractedRelativeMdPaths: string[],
  options?: WorkspaceReportCandidatesOptions
): string[] {
  const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  const legacySlug = workspaceFilesDirSegment(commandKey, targetTrimmed);
  const primarySlug = (options?.runDirSegment?.trim() || legacySlug).trim() || legacySlug;

  const out: string[] = [];
  const add = (p: string) => {
    const t = normPath(p);
    if (!t || !/\.md$/i.test(t)) return;
    if (!out.includes(t)) out.push(t);
  };

  const lower = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  const extracted = [...new Set(extractedRelativeMdPaths.map(normPath).filter(Boolean))].filter((p) =>
    /\.md$/i.test(p)
  );

  const primaryNeedle = `workspace-files/${primarySlug}/`.toLowerCase();
  const inRun = extracted.filter((p) => lower(p).includes(primaryNeedle));
  const outOfRun = extracted.filter((p) => !lower(p).includes(primaryNeedle));

  const addGeoAnalysisRest = (pool: string[]) => {
    const geo = pool.find((p) => /geo-audit-report\.md$/i.test(lower(p)));
    const analysis = pool.find((p) => /analysis-report\.md$/i.test(lower(p)));
    const rest = pool.filter((p) => p !== geo && p !== analysis);
    if (geo) add(geo);
    if (analysis) add(analysis);
    for (const p of rest) add(p);
  };
  addGeoAnalysisRest(inRun);
  addGeoAnalysisRest(outOfRun);

  const bases: string[] =
    primarySlug === legacySlug
      ? [`workspace-files/${primarySlug}/`]
      : [`workspace-files/${primarySlug}/`, `workspace-files/${legacySlug}/`];

  const k = commandKey.trim().toLowerCase();
  const addFallbacksForBase = (base: string) => {
    if (k === 'geo') {
      add(`${base}geo-audit-report.md`);
    }
    if (k === 'analyze') {
      add(`${base}analysis-report.md`);
    }
    if (k === 'site-health') {
      add(`${base}site-health-report.md`);
      add(`${base}blog-health-report.md`);
      add(`${base}full-site-health-report.md`);
      add(`${base}site-health-audit.md`);
      add(`${base}audit-report.md`);
      add(`${base}analysis-report.md`);
    }
    if (k === 'write') {
      /** Use legacy cmd–target slug only; run-specific `dirName` includes `--run-…` and must not become the filename stem. */
      const tail = legacySlug.includes('--') ? legacySlug.slice(legacySlug.indexOf('--') + 2) : 'output';
      add(`${base}${tail}.md`);
    }
    if (k === 'brief' || k === 'strategy' || k === 'outline' || k === 'calendar' || k === 'seo-check') {
      add(`${base}analysis-report.md`);
      add(`${base}report.md`);
    }

    add(`${base}analysis-report.md`);
    add(`${base}report.md`);
  };

  for (const base of bases) {
    addFallbacksForBase(base);
  }

  return out;
}

/** Prompt string sent to Claude for this dashboard run. */
function siteOriginFromTarget(targetTrimmed: string): string | null {
  const t = targetTrimmed.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    return new URL(t).origin;
  } catch {
    return null;
  }
}

function buildAiCrawlerVerificationInstruction(cmd: BlogCommand, targetTrimmed: string): string {
  if (cmd.key !== 'site-health' && cmd.key !== 'geo') return '';
  const origin = siteOriginFromTarget(targetTrimmed);
  if (!origin) return '';
  return (
    `\n\nBefore scoring AI citation readiness / AI crawler accessibility, explicitly fetch and verify ` +
    `\`${origin}/llms.txt\` and \`${origin}/robots.txt\`. Report the observed status/content summary for both. ` +
    `If \`${origin}/llms.txt\` returns a valid file with brand context or resource links, treat llms.txt as present and do not recommend creating it. ` +
    `If robots.txt lacks AI-specific user-agent directives, state that separately from llms.txt availability.`
  );
}

export function buildBlogPrompt(
  cmd: BlogCommand,
  targetTrimmed: string,
  options?: { runToken?: string }
): string {
  const t = targetTrimmed.trim();
  if (!t) return cmd.command.trim();

  const token = options?.runToken?.trim();
  const safeDir = token
    ? formatWorkspaceRunDirSegment(cmd.key, t, token)
    : workspaceFilesDirSegment(cmd.key, t);

  const instruction = token
    ? `Please create a directory named \`workspace-files/${safeDir}/\` if it does not exist, and save **all** files generated by this task **only** inside that directory (do not use \`workspace-files/${workspaceFilesDirSegment(cmd.key, t)}/\` or any path without the \`--run-\` suffix — those folders are shared across runs). Do not save files to the root directory. If a file you want to write already exists, do not overwrite or edit it; instead, create a new file with a unique name (e.g., by appending a number or timestamp). After saving the files, please print a detailed summary of the changes and the exact paths to the saved files in your final response so it is recorded in the history.`
    : `Please create a directory named \`workspace-files/${safeDir}/\` if it does not exist, and save all files generated by this task inside that directory. Do not save files to the root directory. If a file you want to write already exists, do not overwrite or edit it; instead, create a new file with a unique name (e.g., by appending a number or timestamp). After saving the files, please print a detailed summary of the changes and the exact paths to the saved files in your final response so it is recorded in the history.`;

  return `${cmd.command} ${t}${buildAiCrawlerVerificationInstruction(cmd, t)}\n\n${instruction}`.trim();
}

/** Reconstruct a display line for history (supports legacy SEO keys not in BLOG_COMMANDS). */
export function historyCommandLine(item: Pick<HistoryItem, 'commandKey' | 'commandLabel' | 'target'>): string {
  const def = BLOG_COMMANDS.find((c) => c.key === item.commandKey);
  if (def) {
    const t = item.target.trim();
    return t ? `${def.command} ${t}` : def.command;
  }
  const parts = [item.commandLabel, item.target].filter((p) => (p || '').trim().length > 0);
  return parts.join(' — ') || item.commandLabel;
}

export function isLikelyHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test((s || '').trim());
}
