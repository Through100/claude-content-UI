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

/** Claude Code permission / multi-choice footer (Pretty markdown was turning `1. Yes…` into a fake “reply”). */
function isLikelyClaudePermissionMenuFooter(line: string): boolean {
  const t = line.replace(/\r$/, '');
  return /\bEsc to cancel\b/i.test(t) && /\bTab to amend\b/i.test(t);
}

/**
 * Split prose segments so Claude Code “Do you want to proceed / 1. Yes / Esc to cancel” blocks are not fed
 * through markdown list rendering (which looked like an auto-sent user choice).
 */
function splitProseMenuAndRest(prose: string): { kind: 'menu' | 'prose'; text: string }[] {
  const lines = prose.replace(/\r\n/g, '\n').split('\n');
  const n = lines.length;
  const out: { kind: 'menu' | 'prose'; text: string }[] = [];
  let i = 0;

  const flushProse = (buf: string[]) => {
    const t = buf.join('\n').trim();
    if (t) out.push({ kind: 'prose', text: buf.join('\n') });
    buf.length = 0;
  };

  while (i < n) {
    let footerJ = -1;
    const windowEnd = Math.min(n, i + 80);
    for (let j = i; j < windowEnd; j++) {
      if (isLikelyClaudePermissionMenuFooter(lines[j] ?? '')) {
        footerJ = j;
        break;
      }
    }
    if (footerJ < 0) {
      const rest = lines.slice(i).join('\n');
      if (rest.trim()) out.push({ kind: 'prose', text: rest });
      break;
    }

    let start = i;
    let foundQuestion = false;
    for (let s = footerJ; s >= i; s--) {
      if (/Do you want to proceed\?/i.test(lines[s] ?? '')) {
        start = s;
        foundQuestion = true;
        break;
      }
    }
    if (!foundQuestion) {
      for (let s = footerJ - 1; s >= i; s--) {
        if (/^\s*\d+\.\s+Yes,/i.test(lines[s] ?? '')) {
          start = s;
          break;
        }
      }
    }

    const candidate = lines.slice(start, footerJ + 1).join('\n');
    const looksMenu =
      /Do you want to proceed/i.test(candidate) || /^\s*\d+\.\s+Yes,/m.test(candidate);

    if (!looksMenu) {
      const buf: string[] = [];
      buf.push(...lines.slice(i, footerJ + 1));
      flushProse(buf);
      i = footerJ + 1;
      continue;
    }

    if (start > i) {
      const before = lines.slice(i, start);
      flushProse(before);
    }
    out.push({ kind: 'menu', text: lines.slice(start, footerJ + 1).join('\n') });
    i = footerJ + 1;
  }

  return out;
}

/** Diff chunks + prose chunks, with permission menus peeled out of prose (monospace like diffs). */
export function segmentPtyAssistantDisplayBlocks(raw: string): { kind: 'diff' | 'menu' | 'prose'; text: string }[] {
  const coarse = segmentDiffAndProse(raw);
  const out: { kind: 'diff' | 'menu' | 'prose'; text: string }[] = [];
  for (const c of coarse) {
    if (c.kind === 'diff') {
      out.push(c);
      continue;
    }
    out.push(...splitProseMenuAndRest(c.text));
  }
  return out;
}
