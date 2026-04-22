import { mergePtyPlainArchive, snapMergedPtyTailToLiveFullSnapshot } from './shared/mergePtyPlainArchive';

const p = "Welcome back!\nLine 1\nLine 2\nLine 3\nThinking...";
const f = "Welcome back!\nLine 1\nLine 2\nLine 3\nDone.";

const merged = mergePtyPlainArchive(p, f);
console.log(JSON.stringify(merged));
