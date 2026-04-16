/**
 * Detect Claude Code / terminal unified-diff style lines (column numbers + +/-, ⎿, etc.)
 * so Live PTY Pretty can render those blocks as monospace pre instead of markdown paragraphs.
 */
export function isLikelyTerminalDiffLine(line: string): boolean {
  const t = line.replace(/\r$/, '');
  if (!t.trim()) return false;
  if (/^\s*⎿/.test(t)) return true;
  const tr = t.trim();
  if (/^@@(?:\s|$)/.test(tr)) return true;
  if (/^diff --git\s/.test(tr)) return true;
  if (/^index\s+[0-9a-f]{7,}/i.test(tr)) return true;
  if (/^---\s+[ab]\//.test(tr) || /^\+\+\+\s+[ab]\//.test(tr)) return true;
  // "  12    " or "      15 -text" / "      15 +text"
  if (/^\s{1,16}\d+\s*$/.test(t)) return true;
  if (/^\s{0,12}\d+\s+[+-]\s*\S/.test(t) || /^\s{0,12}\d+\s+[+-]$/.test(t)) return true;
  // Wrapped diff body: deep indent then +/- (not shallow markdown bullets)
  if (/^\s{10,}[+]/.test(t) || /^\s{10,}-\s*\S/.test(t)) return true;
  return false;
}

function nextNonEmptyLine(lines: string[], j: number): string | undefined {
  while (j < lines.length) {
    const s = lines[j] ?? '';
    if (s.trim()) return s;
    j++;
  }
  return undefined;
}

function nextNonEmptyIsDiff(lines: string[], j: number): boolean {
  const n = nextNonEmptyLine(lines, j);
  return n !== undefined && isLikelyTerminalDiffLine(n);
}

/**
 * Split assistant text into alternating prose (markdown) and terminal diff (fixed-width) runs.
 */
export function segmentDiffAndProse(raw: string): { kind: 'diff' | 'prose'; text: string }[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: { kind: 'diff' | 'prose'; text: string }[] = [];
  let i = 0;

  while (i < lines.length) {
    const L = lines[i] ?? '';
    const startDiff =
      isLikelyTerminalDiffLine(L) || ((L.trim() === '' || /^\s+$/.test(L)) && nextNonEmptyIsDiff(lines, i));

    if (startDiff) {
      const start = i;
      i++;
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        if (isLikelyTerminalDiffLine(cur)) {
          i++;
          continue;
        }
        if (!cur.trim()) {
          if (nextNonEmptyIsDiff(lines, i + 1)) {
            i++;
            continue;
          }
        }
        // Wrapped continuation: deep indent, not a markdown heading
        if (/^\s{8,}\S/.test(cur) && !/^#{1,6}\s+\S/.test(cur.trim()) && cur.length < 520) {
          i++;
          continue;
        }
        break;
      }
      const text = lines.slice(start, i).join('\n');
      if (text.trim()) out.push({ kind: 'diff', text });
    } else {
      const start = i;
      i++;
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        if (isLikelyTerminalDiffLine(cur)) break;
        if (!cur.trim() && nextNonEmptyIsDiff(lines, i + 1)) break;
        i++;
      }
      const text = lines.slice(start, i).join('\n');
      if (text.trim()) out.push({ kind: 'prose', text });
    }
  }

  return out;
}
