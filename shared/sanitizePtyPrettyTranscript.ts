import { normalizeTeletypeLines, stripAnsi } from './stripAnsi';
import { isPtyAssistantNoiseLine } from './parsePtyTranscriptToMessages';
import { reflowSoftWrappedPlainLines } from './reflowSoftWrappedPlainLines';

/** Table / rule lines typical of the Claude Code TUI splash header. */
function isSplashOrChromeLine(line: string): boolean {
  const s = line.trim();
  if (!s) return true;
  if (/^───.*Claude Code/i.test(s)) return true;
  if (/Claude Code v[\d.]+\s*[─-]/i.test(s)) return true;
  if (/Welcome back/i.test(s)) return true;
  if (/Tips for getting started/i.test(s)) return true;
  if (/Run \/init to create/i.test(s)) return true;
  if (/Recent activity/i.test(s)) return true;
  if (/No recent activity/i.test(s)) return true;
  if (/Sonnet.*(API|Usage|Billing)/i.test(s)) return true;
  if (/API Usage Billing/i.test(s)) return true;
  if (/\/opt\/[\w./-]+\s*$/i.test(s) && s.length < 140) return true;
  if (/^[│┃|].+[│┃|]\s*$/.test(s)) return true;
  if (/^[├└┌┐┘┬┴┼─\-_\s|│┃]{4,}$/.test(s)) return true;
  if (/^>\s*$/.test(s)) return true;
  return false;
}

/**
 * Drop the fixed Claude Code welcome / status header so Pretty “Live PTY” starts at real chat.
 * Stops at the first `❯` prompt with user text, or a late `●` assistant line after the header block.
 */
export function stripClaudeCodeSplashPrefix(text: string): string {
  const t = text.replace(/\r\n/g, '\n');
  if (!t.trim()) return t;
  const probe = t.slice(0, 6000);
  const looksSplash =
    /Claude Code v[\d.]+\s*[─-]/i.test(probe) ||
    (/Welcome back/i.test(probe) && /Recent activity|Tips for getting started/i.test(probe));
  if (!looksSplash) return t;

  const lines = t.split('\n');
  let i = 0;
  const maxScan = Math.min(lines.length, 70);
  while (i < maxScan) {
    const L = lines[i];
    /** Do not treat Ink’s `❯ 1. Yes` pointer as the shell prompt — keeps Fetch choice lines above it. */
    if (/^\s*❯\s+(?!\d+\.\s)\S/.test(L)) break;
    if (/^\s*●\s/.test(L) && i > 10) break;
    if (!isSplashOrChromeLine(L) && L.trim().length > 0) {
      const letters = (L.match(/[A-Za-z]/g) ?? []).length;
      if (letters > 35 && !/^[│┃|]/.test(L.trim())) break;
    }
    i++;
  }
  if (i === 0) return t;
  const rest = lines.slice(i).join('\n').trimStart();
  return rest.length > 0 ? rest : t;
}

/** Inline / full-line Claude Code “working” indicators (Undulating, Thinking, …). */
export function stripPtyEphemeralLines(text: string): string {
  const spinner =
    /(?:Undulating|Thinking|Bouncing|Pulsing|Compacting|Scribbling|Catapulting|Warping|Drizzling|Twirling|Cerebrating|Percolating|Simmering|Ruminating|Marinating|Brooding|Festooning|Moonwalking|Hashing|Propagating|Actioning)/i;
  return text
    .split('\n')
    .map((line) => {
      if (isPtyAssistantNoiseLine(line)) return null;
      if (!spinner.test(line)) return line;
      if (/[✽✻✶✢✿]/.test(line)) {
        let s = line.replace(
          /\s*[✽✻✶✢✿]\s*(?:Undulating|Thinking|Bouncing|Pulsing|Compacting|Scribbling|Catapulting|Warping|Drizzling|Twirling|Cerebrating|Percolating|Simmering|Ruminating|Marinating|Brooding|Festooning|Moonwalking|Hashing|Propagating|Actioning)[·….\s]*/gi,
          ''
        );
        s = s.replace(/^\s*⎿\s+/g, '').trimEnd();
        if (!s.trim()) return null;
        return s;
      }
      if (/^\s*⠋|^\s*⠙|^\s*⠹|^\s*⠸|^\s*⠼|^\s*⠴|^\s*⠦|^\s*⠧|^\s*⠇|^\s*⠏/.test(line) && line.trim().length < 90) {
        return null;
      }
      return line;
    })
    .filter((l): l is string => l != null)
    .join('\n');
}

/**
 * Removes the long “save under workspace-files/…” paragraph appended by {@link buildBlogPrompt} in the
 * Command Runner. PTY soft-wraps it across many lines; Pretty should show `/blog …` + target only.
 * Kept in sync with `src/types.ts` `buildBlogPrompt` instruction text (start + end anchors).
 */
export function stripWorkspaceFilesTaskInstruction(text: string): string {
  const t = text.replace(/\r\n/g, '\n');
  const re =
    /(?:^|\n)\s*Please create a directory named[\s\S]{0,12000}?exact paths to the saved files in your final response so it is recorded in the history\.?\s*/gi;
  let out = t.replace(re, '\n');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}

/** Normalize + strip splash + strip ephemeral status lines for Pretty PTY only (Logon / Raw unchanged). */
export function sanitizePtyPrettyTranscript(raw: string): string {
  let t = normalizeTeletypeLines(stripAnsi(raw ?? '')).replace(/\r\n/g, '\n');
  t = stripClaudeCodeSplashPrefix(t);
  t = stripPtyEphemeralLines(t);
  t = reflowSoftWrappedPlainLines(t);
  t = stripWorkspaceFilesTaskInstruction(t);
  return t.replace(/\n{4,}/g, '\n\n\n').trim();
}
