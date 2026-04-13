import { RunResponse, ParsedReport, HistoryItem, GroupedHistory, SEO_COMMANDS, ReportSection, Severity, Finding, SystemStatus, CostInfo, ContextUsage } from '../types';

const MOCK_STATUS: SystemStatus = {
  version: '2.1.104',
  sessionName: 'SEO Analysis Session',
  sessionId: 'a7a3de04-410b-4ff6-b0c9-1df08cc4fd33',
  cwd: '/',
  authToken: 'none',
  apiKey: 'managed key',
  organization: 'Karry‘s Individual Org',
  email: 'karry.kai.lim@gmail.com',
  model: 'haiku (claude-haiku-4-5-20251001)'
};

const MOCK_COST: CostInfo = {
  totalCost: '$0.79',
  apiDuration: '3m 27s',
  wallDuration: '2h 3m 39s',
  codeChanges: { added: 0, removed: 0 },
  usageByModel: [
    { model: 'claude-sonnet-4-6', input: '14', output: '9.5k', cacheRead: '180.0k', cacheWrite: '35.1k', cost: '$0.3276' },
    { model: 'claude-haiku-4-5', input: '203.7k', output: '4.5k', cacheRead: '166.1k', cacheWrite: '172.1k', cost: '$0.4581' }
  ]
};

const MOCK_CONTEXT: ContextUsage = {
  model: 'Haiku 4.5',
  modelFull: 'claude-haiku-4-5-20251001',
  totalTokens: '60.3k',
  maxTokens: '200k',
  percentage: 30,
  categories: [
    { label: 'System prompt', tokens: '6k', percentage: 3.0 },
    { label: 'System tools', tokens: '20k', percentage: 10.0 },
    { label: 'Custom agents', tokens: '651', percentage: 0.3 },
    { label: 'Skills', tokens: '2.5k', percentage: 1.3 },
    { label: 'Messages', tokens: '31.1k', percentage: 15.5 },
    { label: 'Free space', tokens: '106.7k', percentage: 53.3 },
    { label: 'Autocompact buffer', tokens: '33k', percentage: 16.5 }
  ],
  agents: [
    { name: 'seo-geo', tokens: 75 },
    { name: 'seo-backlinks', tokens: 65 },
    { name: 'seo-dataforseo', tokens: 62 },
    { name: 'seo-local', tokens: 62 },
    { name: 'seo-image-gen', tokens: 57 },
    { name: 'seo-maps', tokens: 53 },
    { name: 'seo-google', tokens: 51 },
    { name: 'seo-technical', tokens: 44 },
    { name: 'seo-content', tokens: 43 },
    { name: 'seo-sitemap', tokens: 40 },
    { name: 'seo-visual', tokens: 35 },
    { name: 'seo-schema', tokens: 35 },
    { name: 'seo-performance', tokens: 29 }
  ],
  skills: [
    { name: 'seo-maps', tokens: 149 },
    { name: 'seo-google', tokens: 146 },
    { name: 'seo-local', tokens: 143 },
    { name: 'seo-dataforseo', tokens: 140 },
    { name: 'seo', tokens: 129 },
    { name: 'seo-geo', tokens: 119 },
    { name: 'seo-image-gen', tokens: 119 },
    { name: 'seo-images', tokens: 115 },
    { name: 'seo-competitor-pages', tokens: 91 },
    { name: 'seo-programmatic', tokens: 89 },
    { name: 'seo-backlinks', tokens: 89 },
    { name: 'seo-plan', tokens: 80 },
    { name: 'seo-technical', tokens: 79 },
    { name: 'seo-hreflang', tokens: 76 },
    { name: 'seo-page', tokens: 70 },
    { name: 'seo-audit', tokens: 69 },
    { name: 'seo-firecrawl', tokens: 63 },
    { name: 'seo-content', tokens: 53 },
    { name: 'seo-sitemap', tokens: 53 },
    { name: 'seo-schema', tokens: 46 }
  ]
};

const MOCK_REPORT: ParsedReport = {
  summary: {
    overallScore: 78,
    status: "Needs Improvement",
    highPriorityIssues: 4
  },
  sections: [
    {
      title: "Technical SEO",
      score: 82,
      findings: [
        {
          severity: "high",
          issue: "Missing canonical tags on 12 pages",
          recommendation: "Add self-referencing canonicals"
        },
        {
          severity: "medium",
          issue: "Slow Time to First Byte (TTFB)",
          recommendation: "Optimize server response time or use a CDN"
        }
      ]
    },
    {
      title: "Content Quality",
      score: 65,
      findings: [
        {
          severity: "critical",
          issue: "Duplicate content detected on 5 product pages",
          recommendation: "Rewrite unique descriptions for each product"
        },
        {
          severity: "low",
          issue: "Meta descriptions are slightly too long",
          recommendation: "Keep meta descriptions under 160 characters"
        }
      ]
    }
  ]
};

const MOCK_RAW_OUTPUT = `
[Claude SEO] Starting audit for https://example.com...
[Step 1/5] Crawling site... Done.
[Step 2/5] Analyzing technical factors...
  - Checking canonicals... [FAIL]
  - Checking robots.txt... [PASS]
  - Checking sitemap.xml... [PASS]
[Step 3/5] Evaluating content quality...
  - Checking for duplicates... [FAIL]
  - Checking keyword density... [PASS]
[Step 4/5] Running Lighthouse metrics...
  - Performance: 82
  - Accessibility: 95
  - Best Practices: 100
  - SEO: 92
[Step 5/5] Generating final report...
Audit complete. Duration: 12.4s
`;

const SALEHOO_SAMPLE_OUTPUT = `
❯ /seo page https://www.salehoo.com/uses/starting-ecommerce

● Skill(seo-page)
  ⎿  Successfully loaded skill

● Fetch(https://www.salehoo.com/uses/starting-ecommerce)
  ⎿  Received 196KB (200 OK)

● Fetch(https://www.salehoo.com/uses/starting-ecommerce)
  ⎿  Received 196KB (200 OK)

● Fetch(https://www.salehoo.com/uses/starting-ecommerce)
  ⎿  Received 196KB (200 OK)

● Now I have enough data to compile the full analysis. Let me run one more targeted fetch for content depth and any additional signals:

● Fetch(https://www.salehoo.com/uses/starting-ecommerce)
  ⎿  Received 196KB (200 OK)

● ---
  Single-Page SEO Analysis: https://www.salehoo.com/uses/starting-ecommerce

  ---
  Page Score Card

  Overall Score:       48/100

  On-Page SEO:         55/100  ███████████░░░░░░░░░
  Content Quality:     68/100  █████████████░░░░░░░
  Technical:           42/100  ████████░░░░░░░░░░░░
  Schema:              10/100  ██░░░░░░░░░░░░░░░░░░
  Images:              35/100  ███████░░░░░░░░░░░░░
  Performance:         40/100  ████████░░░░░░░░░░░░
  AI Search Readiness: 38/100  ███████░░░░░░░░░░░░░

  Weighted score (On-Page 20% · Content 23% · Technical 22% · Schema 10% · Performance 10% · AI 10% · Images 5%)

  ---
  Issues Found

  Critical

  1. Meta description is missing
  No <meta name="description"> tag detected. Google will auto-generate a snippet — often poorly — directly harming click-through rate from SERPs.
  - Fix: Write a 150–160 character description with the primary keyword and a compelling hook.
  - Suggested copy: "Learn how to start a profitable ecommerce business with SaleHoo. Access 8,000+ vetted suppliers, find winning products, and launch your dropshipping store from $9/mo."
  (160 chars)

  2. Open Graph tags are entirely absent
  No og:title, og:description, og:image, or og:url tags. When shared on Facebook, LinkedIn, or Slack, the link will render with no preview — a significant conversion and brand signal loss.

  3. Hero image has no alt attribute
  landing-img-hero-fs.png renders with no alt text. This is a WCAG accessibility violation and a missed keyword placement opportunity for Google Image Search.

  4. Zero structured data (JSON-LD)
  No schema markup of any kind was detected on the page. This is a critical gap given the page has content perfectly suited for WebPage, FAQPage, and SoftwareApplication schemas.

  ---
  High

  5. Twitter Card meta tags missing
  No twitter:card, twitter:title, or twitter:description. X/Twitter shares show no preview card.

  6. Title tag contains "SaleHoo" twice
  Current title: "How to start an ecommerce business using SaleHoo | SaleHoo"
  The brand name appears in both the descriptive phrase and after the pipe separator, wasting ~8 characters. The phrase "using SaleHoo" also signals a branded/navigational intent, which
  competes with the page's apparent goal of ranking for informational queries like "how to start an ecommerce business".
  - Suggested rewrite: "How to Start a Profitable Ecommerce Business | SaleHoo" (53 chars)

  7. Multiple render-blocking 3rd-party scripts in <head>
  New Relic, VWO (A/B testing), Facebook Pixel, and Customer.io all load synchronously before first paint. VWO is particularly damaging to LCP — it pauses rendering while fetching
  experiment configurations. Each one adds 100–400ms to Time to First Byte / First Contentful Paint.
  - Fix: Move non-critical scripts to defer or load after DOMContentLoaded. VWO should implement async snippet pattern.

  8. No publication or "last updated" date
  Content freshness is a ranking signal for informational queries. Competing pages in the "how to start ecommerce" space frequently display dates. No date also weakens E-E-A-T for
  YMYL-adjacent topics.

  9. No breadcrumb navigation
  The page exists at /uses/starting-ecommerce with no breadcrumb. This hurts both UX navigation and the opportunity to add BreadcrumbList schema for SERP breadcrumb display.

  ---
  Medium

  10. H1 / title tag mismatch
  - Title: "How to start an ecommerce business using SaleHoo | SaleHoo"
  - H1: "How to start a profitable ecommerce business"

  The word "profitable" appears in the H1 but not the title. Aligning these improves semantic consistency for crawlers.

  11. Author mention not structured
  Simon Slade is referenced as the founder with 20+ years experience, but there is no dedicated author bio section with credentials, links to social profiles, or a photo. This is a missed
  E-E-A-T signal — Google's QRG explicitly evaluates author expertise for advice content.

  12. No external citations or sources
  The content makes several empirical claims (e.g., startup cost ranges, time-to-profit) with no citations. External links to authoritative sources (industry reports, Shopify data)
  strengthen E-E-A-T and are a positive trust signal.

  13. Canonical tag not confirmed
  A canonical tag was not extractable during analysis. If absent, the page risks duplicate content issues (e.g., http:// vs https://, www vs non-www, trailing slash variants).

  14. Image dimensions not set
  No width and height attributes detected on images. Without these, the browser cannot reserve layout space before images load, causing Cumulative Layout Shift (CLS) — a Core Web Vitals
  metric.

  15. JavaScript-based lazy loading instead of native
  The page uses the LazyLoad JS library rather than the browser-native loading="lazy" attribute. Native lazy loading is zero-JS, faster, and more reliable across modern browsers.

  ---
  Low

  16. URL path taxonomy (/uses/) is non-standard
  The /uses/ subfolder is unconventional for a guide page. Competitor content in this space typically lives under /blog/, /guides/, /learn/, or /how-to/. While not a ranking blocker, the
  taxonomy doesn't signal content type clearly to crawlers. (Note: changing URLs carries redirect risk — only worth doing if restructuring the full /uses/ section.)

  17. FAQ section content not marked up
  The page has a clear Q&A section ("Are You Worried About...") with 5 explicit questions and answers. While FAQPage schema won't earn Google FAQ rich results on commercial sites
  (restricted since Aug 2023), it is highly valuable for AI Overview and LLM citation parsing.

  18. Testimonials lack structured review signals
  Three customer testimonials are present without star ratings or Review schema. Adding these (even as a SoftwareApplication > aggregateRating) can trigger star display in SERPs.

  ---
  Summary

  The page has solid content foundations — ~2,200 words, a clear 5-step guide structure, FAQ-style objection handling, and founder credibility — but is let down almost entirely by missing
  technical metadata. The three most impactful fixes (meta description, Open Graph tags, JSON-LD schema) require no content changes and could be deployed in under a day, yet collectively
  they affect SERP CTR, social sharing reach, and AI Overview citation eligibility. The render-blocking scripts (especially VWO) are the highest-effort fix but likely the most impactful for
   Core Web Vitals and user experience scores.

  ---
`;

const MOCK_HISTORY: HistoryItem[] = [
  {
    id: '1',
    timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 mins ago
    commandKey: 'audit',
    commandLabel: 'Full Website Audit',
    target: 'https://google.com',
    status: 'success',
    durationMs: 12435
  },
  {
    id: '2',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
    commandKey: 'audit',
    commandLabel: 'Full Website Audit',
    target: 'https://google.com',
    status: 'success',
    durationMs: 11200
  },
  {
    id: '3',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
    commandKey: 'schema',
    commandLabel: 'Schema Audit / Generate',
    target: 'https://google.com',
    status: 'success',
    durationMs: 4500
  },
  {
    id: '4',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(), // 25 hours ago
    commandKey: 'page',
    commandLabel: 'Single Page Analysis',
    target: 'https://apple.com',
    status: 'success',
    durationMs: 8100
  },
  {
    id: '5',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 2 days ago
    commandKey: 'technical',
    commandLabel: 'Technical SEO Audit',
    target: 'https://amazon.com',
    status: 'error',
    durationMs: 2300
  }
];

const parseSeoOutput = (raw: string): ParsedReport => {
  const summary: ParsedReport['summary'] = {
    overallScore: 0,
    status: 'Unknown',
    highPriorityIssues: 0,
    categories: []
  };

  const sections: ReportSection[] = [];

  // Parse Overall Score
  const overallMatch = raw.match(/Overall Score:\s+(\d+)\/100/);
  if (overallMatch) {
    summary.overallScore = parseInt(overallMatch[1]);
    if (summary.overallScore >= 90) summary.status = 'Healthy';
    else if (summary.overallScore >= 70) summary.status = 'Needs Improvement';
    else summary.status = 'Critical';
  }

  // Parse Categories
  const categoryLines = raw.matchAll(/([A-Za-z\s-]+):\s+(\d+)\/100\s+█/g);
  for (const match of categoryLines) {
    summary.categories?.push({
      label: match[1].trim(),
      score: parseInt(match[2])
    });
  }

  // Parse Issues by Severity
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
          
          // Try to extract recommendation
          const recMatch = description.match(/- Fix:\s*([\s\S]*?)(?=\n-|$)/) || 
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
          score: 0, // Score is handled at summary level in this format
          findings
        });
      }
    }
  });

  // Extract Summary text
  const summaryMatch = raw.match(/Summary\n\n([\s\S]*?)(?=\n\n---|$)/);
  const rawSummary = summaryMatch ? summaryMatch[1].trim() : undefined;

  return { summary, sections, rawSummary };
};

export const apiService = {
  async runSeoCommand(commandKey: string, input: string): Promise<RunResponse> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 2500));

    // For this demo, we'll use the user's provided sample if the URL matches salehoo
    const useSample = input.includes('salehoo.com');
    const rawOutput = useSample ? SALEHOO_SAMPLE_OUTPUT : MOCK_RAW_OUTPUT;
    const parsedReport = parseSeoOutput(rawOutput);

    const startedAt = new Date().toISOString();
    const durationMs = 12435;
    const finishedAt = new Date(Date.now() + durationMs).toISOString();

    return {
      success: true,
      commandExecuted: `/seo ${commandKey} ${input}`,
      rawOutput,
      parsedReport,
      stats: {
        durationMs,
        startedAt,
        finishedAt
      }
    };
  },

  async getHistory(): Promise<GroupedHistory[]> {
    // Grouping logic
    const groups: { [url: string]: HistoryItem[] } = {};
    
    MOCK_HISTORY.forEach(item => {
      if (!groups[item.target]) {
        groups[item.target] = [];
      }
      groups[item.target].push({
        ...item,
        // Ensure parsedReport and rawOutput are present for the view
        rawOutput: item.rawOutput || MOCK_RAW_OUTPUT,
        parsedReport: item.parsedReport || MOCK_REPORT
      });
    });

    return Object.entries(groups).map(([target, items]) => {
      // Sort items by timestamp descending
      const sortedItems = [...items].sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      return {
        target,
        items: sortedItems,
        latestTimestamp: sortedItems[0].timestamp
      };
    }).sort((a, b) => 
      new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime()
    );
  },

  async getSystemStatus() {
    return {
      docker: 'Connected',
      terminal: 'Available',
      container: 'Running',
      plugin: 'SEO v1.2.0',
      heartbeat: new Date().toISOString()
    };
  },

  async getUsageStats() {
    return {
      totalRuns: 142,
      avgDuration: '14.2s',
      todayRuns: 8,
      lastRun: '2 mins ago',
      tokensUsed: '1.2M'
    };
  },

  async getUsageInfo() {
    return {
      status: MOCK_STATUS,
      cost: MOCK_COST,
      context: MOCK_CONTEXT
    };
  }
};
