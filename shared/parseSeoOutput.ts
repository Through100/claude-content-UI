import type { ParsedReport, ReportSection, Finding, Severity } from '../src/types';

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

export const parseSeoOutput = (raw: string): ParsedReport => {
  const summary: ParsedReport['summary'] = {
    overallScore: 0,
    status: 'Unknown',
    highPriorityIssues: 0,
    categories: []
  };

  const sections: ReportSection[] = [];

  const overallMatch = raw.match(/Overall Score:\s+(\d+)\/100/);
  if (overallMatch) {
    summary.overallScore = parseInt(overallMatch[1], 10);
    if (summary.overallScore >= 90) summary.status = 'Healthy';
    else if (summary.overallScore >= 70) summary.status = 'Needs Improvement';
    else summary.status = 'Critical';
  }

  const categoryLines = raw.matchAll(/([A-Za-z\s-]+):\s+(\d+)\/100\s+█/g);
  for (const match of categoryLines) {
    summary.categories?.push({
      label: match[1].trim(),
      score: parseInt(match[2], 10)
    });
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
        if (key === 'critical' || key === 'high') {
          summary.highPriorityIssues += issues.length;
        }

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

  const summaryMatch = raw.match(/Summary\n\n([\s\S]*?)(?=\n\n---|$)/);
  const rawSummary = summaryMatch ? summaryMatch[1].trim() : undefined;

  return { summary, sections, rawSummary };
};
