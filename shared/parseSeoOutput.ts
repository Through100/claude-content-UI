import type {
  ParsedReport,
  ReportSection,
  Finding,
  Severity,
  ScoreCategory,
  IssuesBySeverity
} from '../src/types';

/** Shown when no Fix / structured bullets could be parsed (UI compares to this). */
export const GENERIC_FINDING_RECOMMENDATION =
  'Review the full terminal output for specific fix instructions.';

function stripOuterMarkdownBold(s: string): string {
  let t = s.trim();
  if (t.startsWith('**') && t.endsWith('**') && t.length >= 4) {
    t = t.slice(2, -2).trim();
  }
  return t;
}

/** Parses lines like `- **Issue:** …` / `- Issue:` with continuation until the next bullet. */
function parseStructuredBullets(body: string): Pick<
  Finding,
  'issueDetail' | 'impact' | 'fix' | 'example'
> {
  const out: Pick<Finding, 'issueDetail' | 'impact' | 'fix' | 'example'> = {};
  if (!body.trim()) return out;

  const labelLine =
    /^\s*-\s*(?:\*\*)?(Issue|Impact|Fix|Example)(?:\*\*)?\s*:\s*(.*)$/i;
  let current: keyof Pick<Finding, 'issueDetail' | 'impact' | 'fix' | 'example'> | null =
    null;
  const buf: string[] = [];

  const flush = () => {
    if (!current) return;
    const text = buf.join('\n').trim();
    if (text) out[current] = text;
    current = null;
    buf.length = 0;
  };

  const mapLabel = (
    label: string
  ): keyof Pick<Finding, 'issueDetail' | 'impact' | 'fix' | 'example'> | null => {
    const u = label.toLowerCase();
    if (u === 'issue') return 'issueDetail';
    if (u === 'impact') return 'impact';
    if (u === 'fix') return 'fix';
    if (u === 'example') return 'example';
    return null;
  };

  for (const line of body.split('\n')) {
    const m = line.match(labelLine);
    if (m) {
      flush();
      current = mapLabel(m[1]);
      if (current && m[2] != null) buf.push(m[2]);
    } else if (current) {
      buf.push(line);
    }
  }
  flush();

  return out;
}

const EMPTY_ISSUES_BY_SEVERITY: IssuesBySeverity = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  passed: 0
};

/** Status badge text from overall score only (independent of parsed issue sections). */
function applyStatusForScore(summary: ParsedReport['summary'], score: number): void {
  summary.overallScore = score;
  if (!Number.isFinite(score) || score <= 0) {
    summary.status = 'Unknown';
    return;
  }
  if (score >= 90) summary.status = 'Excellent';
  else if (score >= 80) summary.status = 'Good';
  else if (score >= 70) summary.status = 'Fair';
  else if (score >= 55) summary.status = 'Needs work';
  else if (score >= 40) summary.status = 'Poor';
  else summary.status = 'Critical';
}

function countIssuesBySeverity(sections: ReportSection[]): IssuesBySeverity {
  const out: IssuesBySeverity = { ...EMPTY_ISSUES_BY_SEVERITY };
  for (const s of sections) {
    for (const f of s.findings) {
      out[f.severity] += 1;
    }
  }
  return out;
}

function finalizeSummaryFromSections(summary: ParsedReport['summary'], sections: ReportSection[]): void {
  summary.issuesBySeverity = countIssuesBySeverity(sections);
  summary.highPriorityIssues = summary.issuesBySeverity.critical + summary.issuesBySeverity.high;
  if (summary.overallScore > 0) {
    applyStatusForScore(summary, summary.overallScore);
  }
}

/** Classic `Overall Score: 62/100` line. */
function parseClassicOverallScore(raw: string): number | null {
  const m = raw.match(/Overall\s+Score:\s*(\d+)\s*\/\s*100/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Markdown audits: `## Content Quality Score: **78/100**`, `Overall E-E-A-T: 78/100`, etc.
 * Picks the first strong match in a sensible order.
 */
function parseMarkdownOverallScore(raw: string): number | null {
  const patterns: RegExp[] = [
    /(?:##\s*)?Content\s+Quality\s+Score:\s*(?:\*\*)?(\d+)\s*\/\s*100(?:\*\*)?/i,
    /(?:\*\*)?Overall\s+E-E-A-T:\s*(\d+)\s*\/\s*100(?:\*\*)?/i,
    /##\s*Page\s+Score:\s*(?:\*\*)?(\d+)\s*\/\s*100(?:\*\*)?/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function stripMarkdownTableCell(s: string): string {
  return s.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
}

/** E-E-A-T style table: `| **Experience** | 22/25 |` → score /100. */
function parseEeatFactorTable(raw: string): ScoreCategory[] {
  const out: ScoreCategory[] = [];
  const re = /\|\s*([^|\n]+?)\s*\|\s*(\d+)\s*\/\s*25\s*\|/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const label = stripMarkdownTableCell(m[1]);
    if (!label || /^(factor|score|key\s*signals)$/i.test(label)) continue;
    const num = parseInt(m[2], 10);
    if (Number.isNaN(num)) continue;
    out.push({ label, score: Math.round((num / 25) * 100) });
  }
  return out;
}

/** `## Some Label: **72/100**` score strips (excludes structural sections). */
function parseMarkdownScoreHeadings(raw: string): ScoreCategory[] {
  const out: ScoreCategory[] = [];
  const skip = /issues\s+found|recommendations|summary|analysis:\s*$/i;
  const re = /^##\s*([^:\n]+):\s*(?:\*\*)?(\d+)\s*\/\s*100(?:\*\*)?/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const label = m[1].trim();
    if (label.length > 80 || skip.test(label)) continue;
    const score = parseInt(m[2], 10);
    if (Number.isNaN(score)) continue;
    out.push({ label, score });
  }
  return out;
}

function tryParseIssueTitleLine(line: string): string | null {
  const t = line.trim();
  if (!t || t.startsWith('|') || t.startsWith('```')) return null;
  const m = t.match(/^(?:🔴|🟠|🟡|🟢|⚪|⚠️)?\s*\*\*(.+?)\*\*\s*$/);
  return m ? m[1].trim() : null;
}

function parseMarkdownIssueFindings(body: string, severity: Severity): Finding[] {
  const findings: Finding[] = [];
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length) {
    const title = tryParseIssueTitleLine(lines[i]);
    if (title) {
      const detailLines: string[] = [];
      i++;
      while (i < lines.length) {
        if (tryParseIssueTitleLine(lines[i])) break;
        if (/^###\s/.test(lines[i]) || /^##\s/.test(lines[i])) break;
        detailLines.push(lines[i]);
        i++;
      }
      const description = detailLines.join('\n').trim();
      const structured = parseStructuredBullets(description);
      const hasStructured = !!(
        structured.issueDetail ||
        structured.impact ||
        structured.fix ||
        structured.example
      );
      const recMatch =
        description.match(/-\s*(?:\*\*)?Fix(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*-|$)/i) ||
        description.match(/- Fix:\s*([\s\S]*?)(?=\n-|$)/);
      let recommendation: string;
      if (structured.fix?.trim()) recommendation = structured.fix.trim();
      else if (recMatch) recommendation = recMatch[1].trim();
      else recommendation = GENERIC_FINDING_RECOMMENDATION;

      findings.push({
        severity,
        issue: title,
        recommendation,
        ...structured,
        detailNotes:
          !hasStructured && description.trim().length > 0 ? description.trim() : undefined,
      });
      continue;
    }
    i++;
  }
  return findings;
}

function mapIssuesSubheadingToSeverity(heading: string): Severity | null {
  const h = heading.trim().toLowerCase();
  if (h === 'critical') return 'critical';
  if (h === 'high' || /^high\s+priority/.test(h)) return 'high';
  if (h === 'medium' || /^medium\s+priority/.test(h)) return 'medium';
  if (h === 'low' || /^low\s+priority/.test(h)) return 'low';
  return null;
}

const ISSUES_FOUND_SECTION = /##\s*Issues\s+Found\s*\n+([\s\S]*?)(?=^##\s+|$)/im;

/**
 * Markdown `## Issues Found` / `### Critical` / `### High Priority` blocks with `🔴 **Title**` lines.
 */
function parseMarkdownIssuesFound(raw: string): { sections: ReportSection[] } {
  const m = raw.match(ISSUES_FOUND_SECTION);
  if (!m) return { sections: [] };

  const block = m[1];
  const re = /^###\s+(.+)$/gm;
  const matches: { title: string; start: number; len: number }[] = [];
  let x: RegExpExecArray | null;
  while ((x = re.exec(block)) !== null) {
    matches.push({ title: x[1].trim(), start: x.index, len: x[0].length });
  }
  if (matches.length === 0) return { sections: [] };

  const bySeverity = new Map<Severity, Finding[]>();
  for (let i = 0; i < matches.length; i++) {
    const sev = mapIssuesSubheadingToSeverity(matches[i].title);
    if (!sev) continue;
    const bodyStart = matches[i].start + matches[i].len;
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].start : block.length;
    const body = block.slice(bodyStart, bodyEnd);
    const findings = parseMarkdownIssueFindings(body, sev);
    if (findings.length === 0) continue;
    const prev = bySeverity.get(sev) ?? [];
    bySeverity.set(sev, prev.concat(findings));
  }

  const order: Severity[] = ['critical', 'high', 'medium', 'low'];
  const sections: ReportSection[] = [];
  const labels: Record<Severity, string> = {
    critical: 'Critical Issues',
    high: 'High Issues',
    medium: 'Medium Issues',
    low: 'Low Issues',
    passed: 'Passed',
  };

  for (const sev of order) {
    const findings = bySeverity.get(sev);
    if (!findings?.length) continue;
    sections.push({ title: labels[sev], score: 0, findings });
  }

  return { sections };
}

function parseMarkdownSummary(raw: string): string | undefined {
  const m = raw.match(/^##\s*Summary\s*\n+([\s\S]*?)(?=^##\s+|$)/im);
  return m ? m[1].trim() : undefined;
}

export const parseSeoOutput = (raw: string): ParsedReport => {
  const summary: ParsedReport['summary'] = {
    overallScore: 0,
    status: 'Unknown',
    highPriorityIssues: 0,
    issuesBySeverity: { ...EMPTY_ISSUES_BY_SEVERITY },
    categories: []
  };

  const sections: ReportSection[] = [];

  const classicOverall = parseClassicOverallScore(raw);
  if (classicOverall != null) {
    applyStatusForScore(summary, classicOverall);
  } else {
    const mdOverall = parseMarkdownOverallScore(raw);
    if (mdOverall != null) applyStatusForScore(summary, mdOverall);
  }

  const categoryLines = raw.matchAll(/([A-Za-z\s-]+):\s+(\d+)\/100\s+█/g);
  for (const match of categoryLines) {
    summary.categories?.push({
      label: match[1].trim(),
      score: parseInt(match[2], 10)
    });
  }

  if (!summary.categories?.length) {
    const tableCats = parseEeatFactorTable(raw);
    if (tableCats.length > 0) {
      summary.categories = [...tableCats];
      const ai = raw.match(/##\s*AI\s+Citation\s+Readiness:\s*(?:\*\*)?(\d+)\s*\/\s*100(?:\*\*)?/i);
      if (ai) {
        summary.categories.push({
          label: 'AI Citation Readiness',
          score: parseInt(ai[1], 10)
        });
      }
    } else {
      summary.categories = parseMarkdownScoreHeadings(raw);
    }
  }

  const severities: { key: Severity; label: string }[] = [
    { key: 'critical', label: 'Critical' },
    { key: 'high', label: 'High' },
    { key: 'medium', label: 'Medium' },
    { key: 'low', label: 'Low' }
  ];

  severities.forEach(({ key, label }) => {
    const sectionRegex = new RegExp(`${label}\\n\\n([\\s\\S]*?)(?=\\n\\s*---)`, 'g');
    const sectionMatch = sectionRegex.exec(raw);

    if (sectionMatch) {
      const content = sectionMatch[1];
      const issues = content.split(/\d+\./).filter(s => s.trim());

      if (issues.length > 0) {
        const findings: Finding[] = issues.map(issueText => {
          const lines = issueText.trim().split('\n');
          const title = stripOuterMarkdownBold(lines[0].trim());
          const description = lines.slice(1).join('\n').trim();

          const structured = parseStructuredBullets(description);
          const hasStructured = !!(
            structured.issueDetail ||
            structured.impact ||
            structured.fix ||
            structured.example
          );

          const recMatch =
            description.match(/-\s*(?:\*\*)?Fix(?:\*\*)?\s*:\s*([\s\S]*?)(?=\n\s*-|$)/i) ||
            description.match(/- Fix:\s*([\s\S]*?)(?=\n-|$)/) ||
            description.match(/Suggested rewrite:\s*([\s\S]*?)(?=\n|$)/) ||
            description.match(/- Suggested copy:\s*([\s\S]*?)(?=\n|$)/);

          let recommendation: string;
          if (structured.fix?.trim()) {
            recommendation = structured.fix.trim();
          } else if (recMatch) {
            recommendation = recMatch[1].trim();
          } else {
            recommendation = GENERIC_FINDING_RECOMMENDATION;
          }

          return {
            severity: key,
            issue: title,
            recommendation,
            ...structured,
            detailNotes:
              !hasStructured && description.trim().length > 0
                ? description.trim()
                : undefined,
          };
        });

        sections.push({
          title: `${label} Issues`,
          score: 0,
          findings
        });
      }
    }
  });

  if (sections.length === 0) {
    const mdIssues = parseMarkdownIssuesFound(raw);
    if (mdIssues.sections.length > 0) {
      sections.push(...mdIssues.sections);
    }
  }

  finalizeSummaryFromSections(summary, sections);

  const summaryMatch = raw.match(/Summary\n\n([\s\S]*?)(?=\n\n---|$)/);
  let rawSummary = summaryMatch ? summaryMatch[1].trim() : undefined;
  if (!rawSummary) {
    rawSummary = parseMarkdownSummary(raw);
  }

  return { summary, sections, rawSummary };
};
