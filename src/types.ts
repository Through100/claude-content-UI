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

export interface ParsedReport {
  summary: {
    overallScore: number;
    status: string;
    highPriorityIssues: number;
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

/** API GET /api/usage — raw `claude -p` output for `/status` and `/usage` (same style as audit Raw Output). */
export interface UsageInfo {
  terminals: {
    status: string;
    usage: string;
  };
  exitCodes?: Record<string, number | null>;
}

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
}

export interface SeoCommand {
  key: string;
  label: string;
  command: string;
  placeholder: string;
  requiresUrl: boolean;
}

export const SEO_COMMANDS: SeoCommand[] = [
  { key: 'audit', label: 'Full Website Audit', command: '/seo audit', placeholder: 'https://example.com', requiresUrl: true },
  { key: 'page', label: 'Single Page Analysis', command: '/seo page', placeholder: 'https://example.com', requiresUrl: true },
  { key: 'sitemap', label: 'Sitemap Analyze / Generate', command: '/seo sitemap', placeholder: 'https://example.com or generate', requiresUrl: false },
  { key: 'schema', label: 'Schema Audit / Generate', command: '/seo schema', placeholder: 'https://example.com', requiresUrl: true },
  { key: 'images', label: 'Image SEO', command: '/seo images', placeholder: 'https://example.com or optimize', requiresUrl: false },
  { key: 'technical', label: 'Technical SEO Audit', command: '/seo technical', placeholder: 'https://example.com', requiresUrl: true },
  { key: 'content', label: 'Content Quality Audit', command: '/seo content', placeholder: 'https://example.com', requiresUrl: true },
  { key: 'geo', label: 'GEO / AI Overviews Audit', command: '/seo geo', placeholder: 'https://example.com', requiresUrl: true },
  { key: 'plan', label: 'Strategic SEO Plan', command: '/seo plan', placeholder: 'holiday park, saas booking platform, etc.', requiresUrl: false },
  { key: 'programmatic', label: 'Programmatic SEO', command: '/seo programmatic', placeholder: 'https://example.com or plan', requiresUrl: false },
  { key: 'competitor-pages', label: 'Competitor Pages', command: '/seo competitor-pages', placeholder: 'https://example.com or generate', requiresUrl: false },
  { key: 'local', label: 'Local SEO Audit', command: '/seo local', placeholder: 'https://example.com', requiresUrl: true },
  { key: 'maps', label: 'Maps Intelligence', command: '/seo maps', placeholder: 'e.g. gbp-audit Auckland plumber', requiresUrl: false },
  { key: 'hreflang', label: 'Hreflang Audit', command: '/seo hreflang', placeholder: 'https://example.com', requiresUrl: true },
  { key: 'google', label: 'Google SEO APIs', command: '/seo google', placeholder: 'e.g. pagespeed https://example.com', requiresUrl: false },
  { key: 'backlinks', label: 'Backlink Analysis', command: '/seo backlinks', placeholder: 'https://example.com', requiresUrl: true },
];
