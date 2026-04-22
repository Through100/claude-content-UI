import { parsePrettyDocument } from './src/lib/parseTerminalMarkdown';

const text = `Read 1 file, listed 1 directory (ctrl+o to expand)
● I'll create the workspace directory and then spawn the blog-reviewer agent to run the full 100-point quality analysis.
──────────────────────────────────────────────────────────────────────────────────────────────────
 Bash command

   mkdir -p /opt/claude-content-UI/workspace-files/ui-uploads-bing-seo-guide-2026-2-md/
   Create workspace directory for analysis output`;

const doc = parsePrettyDocument(text);
console.log(JSON.stringify(doc, null, 2));
