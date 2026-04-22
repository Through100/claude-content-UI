import { plainTextShowsClaudePermissionMenu } from './shared/claudeCodePtyPermissionMenu';

const text = ` Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don’t ask again for: python3 *
   3. No

 Esc to cancel · Tab to amend · ctrl+e to explain` + '\n'.repeat(50) + ' '.repeat(500);

console.log(plainTextShowsClaudePermissionMenu(text));