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

/** Any single-line “Do you want to …?” used before numbered Yes/No rows (proceed, make this edit, run tool, …). */
function isClaudeMenuQuestionLine(line: string): boolean {
  const L = line ?? '';
  return /Do you want to[^?\n]*\?/i.test(L);
}

/**
 * Split prose segments so Claude Code permission rows (`Do you want to …?`, `1. Yes`, `Esc to cancel`) are not fed
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

    let questionLine = -1;
    for (let s = footerJ; s >= i; s--) {
      if (isClaudeMenuQuestionLine(lines[s] ?? '')) {
        questionLine = s;
        break;
      }
    }

    let firstYesLine = -1;
    for (let s = i; s < footerJ; s++) {
      if (/^\s*(?:❯\s*|[>]\s*)?1\.\s+Yes\b/i.test(lines[s] ?? '')) {
        firstYesLine = s;
        break;
      }
    }

    let start = i;
    if (questionLine >= 0) {
      start = questionLine;
    } else if (firstYesLine >= 0) {
      start = firstYesLine;
    } else {
      /** Legacy: numbered “Yes,” rows without a matched question line (comma required to avoid false positives). */
      for (let s = footerJ - 1; s >= i; s--) {
        if (/^\s*(?:❯\s*|[>]\s*)?\d+\.\s+Yes,/i.test(lines[s] ?? '')) {
          start = s;
          break;
        }
      }
    }

    const candidate = lines.slice(start, footerJ + 1).join('\n');
    const looksMenu =
      /Do you want to[^?\n]*\?/i.test(candidate) ||
      /^\s*(?:❯\s*|[>]\s*)?\d+\.\s+Yes\b/im.test(candidate);

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

function countPipes(s: string): number {
  return (s.match(/\|/g) ?? []).length;
}

function isAsciiBoxGridSeparatorLine(s: string): boolean {
  const t = (s ?? '').trim();
  return t.length >= 6 && /^[+\-|:\s]+$/.test(t) && /\+/.test(t) && /-/.test(t);
}

function atAsciiGridBlockStart(line: string): boolean {
  const s = line ?? '';
  if (!s.trim()) return false;
  if (isAsciiBoxGridSeparatorLine(s)) return true;
  const t = s.trimStart();
  if (/^[┌├└]/.test(t)) return true;
  return t.startsWith('|') && countPipes(s) >= 2;
}

function isAsciiGridTableLine(s: string): boolean {
  if (!(s ?? '').trim()) return false;
  if (isAsciiBoxGridSeparatorLine(s)) return true;
  const t = (s ?? '').trimStart();
  if (/^[│┌├└┐┘┬┴┼]/.test(t)) return true;
  return countPipes(s) >= 2;
}

/** Notes column often wraps as a long indented run without a leading `|` on continuations. */
function isLikelyAsciiGridCellWrapLine(line: string, prevNonBlank: string): boolean {
  if (!(line ?? '').trim()) return false;
  if (isAsciiGridTableLine(line)) return false;
  if (countPipes(prevNonBlank) < 2) return false;
  return /^\s{6,}\S/.test(line) && line.length < 260;
}

/**
 * Split prose so TUI / ASCII pipe grids render as monospace blocks in Pretty (same alignment as Raw).
 */
function splitProseAsciiGridBlocks(prose: string): { kind: 'grid' | 'prose'; text: string }[] {
  const lines = prose.replace(/\r\n/g, '\n').split('\n');
  const n = lines.length;
  const out: { kind: 'grid' | 'prose'; text: string }[] = [];

  const flushProse = (buf: string[]) => {
    const joined = buf.join('\n');
    if (joined.trim()) out.push({ kind: 'prose', text: joined });
    buf.length = 0;
  };

  const skipEmpty = (from: number) => {
    let j = from;
    while (j < n && !(lines[j] ?? '').trim()) j++;
    return j;
  };

  let i = 0;
  while (i < n) {
    if (!atAsciiGridBlockStart(lines[i] ?? '')) {
      const proseBuf: string[] = [];
      while (i < n && !atAsciiGridBlockStart(lines[i] ?? '')) {
        proseBuf.push(lines[i] ?? '');
        i++;
      }
      flushProse(proseBuf);
      continue;
    }

    const start = i;
    let j = start + 1;
    let prevNonBlank = lines[start] ?? '';

    while (j < n) {
      const cur = lines[j] ?? '';
      if (!cur.trim()) {
        const nextJ = skipEmpty(j);
        if (nextJ >= n) break;
        const nextLine = lines[nextJ] ?? '';
        if (!isAsciiGridTableLine(nextLine) && !isLikelyAsciiGridCellWrapLine(nextLine, prevNonBlank)) {
          break;
        }
        j = nextJ;
        continue;
      }
      if (isAsciiGridTableLine(cur)) {
        prevNonBlank = cur;
        j++;
        continue;
      }
      if (isLikelyAsciiGridCellWrapLine(cur, prevNonBlank)) {
        j++;
        continue;
      }
      break;
    }

    const gridText = lines.slice(start, j).join('\n');
    const nonempty = gridText.split('\n').filter((ln) => ln.trim());
    const ok =
      gridText.trim().length > 0 &&
      nonempty.length >= 2 &&
      (/\+[-+]+\+/.test(gridText) || countPipes(gridText) >= 3 || /[┌└├┐┘]/.test(gridText));

    if (!ok) {
      /** Do not drop lines when the block looked like a grid but failed validation (e.g. too short). */
      flushProse(lines.slice(start, j));
      i = j;
      continue;
    }

    out.push({ kind: 'grid', text: gridText });
    i = j;
  }

  return out;
}

/** Diff chunks + prose chunks, with permission menus peeled out of prose (monospace like diffs). */
export function segmentPtyAssistantDisplayBlocks(
  raw: string
): { kind: 'diff' | 'menu' | 'prose' | 'grid'; text: string }[] {
  const coarse = segmentDiffAndProse(raw);
  const out: { kind: 'diff' | 'menu' | 'prose' | 'grid'; text: string }[] = [];
  for (const c of coarse) {
    if (c.kind === 'diff') {
      out.push(c);
      continue;
    }
    for (const m of splitProseMenuAndRest(c.text)) {
      if (m.kind === 'menu') {
        out.push(m);
        continue;
      }
      out.push(...splitProseAsciiGridBlocks(m.text));
    }
  }
  return out;
}
