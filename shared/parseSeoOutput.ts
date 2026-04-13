import type { ParsedReport, ReportSection, Finding, Severity } from '../src/types';

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
          const title = lines[0].trim();
          const description = lines.slice(1).join('\n').trim();

          const recMatch =
            description.match(/- Fix:\s*([\s\S]*?)(?=\n-|$)/) ||
            description.match(/Suggested rewrite:\s*([\s\S]*?)(?=\n|$)/) ||
            description.match(/- Suggested copy:\s*([\s\S]*?)(?=\n|$)/);

          return {
            severity: key,
            issue: title,
            recommendation: recMatch ? recMatch[1].trim() : 'Review the full terminal output for specific fix instructions.'
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
