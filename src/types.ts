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

/** Prompt string sent to Claude for this dashboard run. */
export function buildBlogPrompt(cmd: BlogCommand, targetTrimmed: string): string {
  const t = targetTrimmed.trim();
  if (!t) return cmd.command.trim();

  // Create a safe directory name from the target
  let safeDir = t.replace(/^https?:\/\//i, '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!safeDir) safeDir = 'output';

  const instruction = `Please create a directory named \`workspace-files/${safeDir}/\` if it does not exist, and save all files generated by this task inside that directory. Do not save files to the root directory. After saving the files, please print a detailed summary of the changes and the exact paths to the saved files in your final response so it is recorded in the history.`;

  return `${cmd.command} ${t}\n\n${instruction}`.trim();
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
