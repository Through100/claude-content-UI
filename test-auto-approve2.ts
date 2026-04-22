import { extractLastChoiceMenuSnapshotForArchive } from './shared/segmentPtyDiffBlocks';

const text = `      "Directory ready")                                                                          
  ⎿  Running…
                                                                                                  
──────────────────────────────────────────────────────────────────────────────────────────────────
 Bash command

   mkdir -p /opt/claude-content-UI/workspace-files/www-salehoo-com-learn-dollar-store-suppliers
    && echo "Directory ready"
   Create workspace directory

 Do you want to proceed?
 ❯ 1. Yes
  2.Yes, and always allow access to www-salehoo-com-learn-dollar-store-suppliers/ from this
    project
   3. No

 Esc to cancel · Tab to amend · ctrl+e to explain`;

console.log(extractLastChoiceMenuSnapshotForArchive(text));