import { extractLastChoiceMenuSnapshotForArchive } from './shared/segmentPtyDiffBlocks';

const text = `   EOF

   Calculate final scores across all 5 categories

 This command requires approval

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don’t ask again for: python3 *
   3. No

 Esc to cancel · Tab to amend · ctrl+e to explain`;

console.log(extractLastChoiceMenuSnapshotForArchive(text));