/** Strip CSI sequences (same idea as AuditMarkdown). */
function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

/**
 * True when a single line is part of a file listing, diff, or TUI frame — not normal prompt text.
 */
export function isCodeishLine(line: string): boolean {
  const t = line.replace(/\r$/, '');
  const tr = t.trim();
  if (!tr) return false;

  if (/^╌{6,}$/.test(tr)) return true;
  if (/^[╭╮╰╯]/.test(tr)) return true;
  if (/^[│].*[│]/.test(tr)) return true;

  if (/^@@\s/.test(tr)) return true;
  if (/^diff --git\b/.test(tr)) return true;
  if (/^index\s+[0-9a-f]{7,}/.test(tr)) return true;
  if (/^(---|\+\+\+)\s/.test(tr)) return true;
  if (/^={7,}$/.test(tr) || /^-{7,}$/.test(tr)) return true;

  // Menu options "1. Yes" — prose
  if (/^\d{1,3}\.\s/.test(tr)) return false;

  if (/^\s*\d{1,4}\s+[-+]\s/.test(t)) return true;
  if (/^\s*\d{1,4}\s+\|/.test(t)) return true;
  if (/^\s*\d{1,4}\s+[</{%]/.test(t)) return true;

  // Continuation lines without a leading line number (tab-indented diff, or deep indent + long line)
  if (/^[-+]\t\s*\S/.test(t)) return true;
  if (/^[-+]\s{3,}\S/.test(t) && (/\s\|\s/.test(t) || tr.length > 100)) return true;

  return false;
}

export type NarrativeSegment = { type: 'prose' | 'code'; body: string };

/**
 * Split Claude Code / terminal capture into alternating prose (prompts, questions)
 * and code (numbered listings, diffs, box separators) for mixed Pretty rendering.
 */
export function segmentTerminalNarrative(raw: string): NarrativeSegment[] {
  const text = stripAnsi(raw).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const out: NarrativeSegment[] = [];
  let i = 0;
  const n = lines.length;

  const push = (type: 'prose' | 'code', start: number, end: number) => {
    const slice = lines.slice(start, end).join('\n').trimEnd();
    if (!slice.trim()) return;
    out.push({ type, body: slice });
  };

  while (i < n) {
    if (isCodeishLine(lines[i])) {
      const start = i;
      let j = i;
      while (j < n) {
        const L = lines[j];
        if (isCodeishLine(L)) {
          j++;
          continue;
        }
        if (L.trim() === '' && j + 1 < n && isCodeishLine(lines[j + 1])) {
          j++;
          continue;
        }
        break;
      }
      push('code', start, j);
      i = j;
    } else {
      const start = i;
      let j = i;
      while (j < n && !isCodeishLine(lines[j])) {
        j++;
      }
      push('prose', start, j);
      i = j;
    }
  }

  return out;
}
