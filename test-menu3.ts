import { segmentPtyAssistantDisplayBlocks } from './shared/segmentPtyDiffBlocks';
import { splitPinnedAssistantStreamHeadTail } from './shared/splitPtyPinnedThinkingTail';

const text = `Read 1 file, listed 1 directory (ctrl+o to expand)
● I'll create the workspace directory and then spawn the blog-reviewer agent to run the full 100-point quality analysis.
──────────────────────────────────────────────────────────────────────────────────────────────────
 Bash command

   mkdir -p /opt/claude-content-UI/workspace-files/ui-uploads-bing-seo-guide-2026-2-md/
   Create workspace directory for analysis output
──────────────────────────────────────────────────────────────────────────────────────────────────
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to workspace-files/ from this project
   3. No`;

const parts = segmentPtyAssistantDisplayBlocks(text);
console.log(JSON.stringify(parts, null, 2));

if (parts.length === 1 && parts[0].kind === 'prose') {
  const { head, tail } = splitPinnedAssistantStreamHeadTail(parts[0].text);
  console.log('TAIL:\n' + tail);
}
