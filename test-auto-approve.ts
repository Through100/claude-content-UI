import { plainTailShowsAnswerablePermissionMenu } from './shared/claudeCodePtyPermissionMenu';

const text = `──────────────────────────────────────────────────────────────────────────────────────────────────
 Bash command                                                                                     
                 
   mkdir -p /opt/claude-content-UI/workspace-files/ui-uploads-bing-seo-guide-2026-2-md/
   Create workspace directory for analysis output

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to workspace-files/ from this project
   3. No

 Esc to cancel · Tab to amend · ctrl+e to explain`;

console.log(plainTailShowsAnswerablePermissionMenu(text));
