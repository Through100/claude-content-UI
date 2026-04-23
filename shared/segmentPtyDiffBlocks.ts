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
  const t = (line ?? '').replace(/\r$/, '').trim();
  /** Long “tips” paragraphs can mention both phrases — real footers are one short Ink line (allow ctrl+e chrome). */
  if (t.length > 240) return false;
  return /\bEsc to cancel\b/i.test(t) && /\bTab to (?:amend|edit|change)\b/i.test(t);
}

/**
 * Fetch / tool consent often ends at the last numbered option without an Esc/Tab footer line in the buffer.
 * Returns the line index of that last `1./2./3.` row, or -1.
 */
function findNumberedConsentMenuFooterJ(
  lines: string[],
  i: number,
  windowEnd: number,
  anchor: RegExp
): number {
  /** Prefer the *last* matching anchor so embedded code / citations cannot steal the match from the real tail menu. */
  let bestLastNum = -1;
  for (let j = i; j < windowEnd; j++) {
    const t = (lines[j] ?? '').trim();
    if (!anchor.test(t)) continue;
    const maxK = Math.min(lines.length, j + 120);
    let sawYes1 = false;
    let lastNum = -1;
    for (let k = j; k < maxK; k++) {
      const u = (lines[k] ?? '').trim();
      if (/^\s*(?:[❯›>]\s*)?1\.\s+Yes\b/i.test(u)) sawYes1 = true;
      if (/^\s*(?:[❯›>]\s*)?\d+\.\s+\S/m.test(u)) lastNum = k;
    }
    if (sawYes1 && lastNum >= j) bestLastNum = lastNum;
  }
  return bestLastNum;
}

/** Any single-line “Do you want to …?” used before numbered Yes/No rows (proceed, make this edit, run tool, …). */
function isClaudeMenuQuestionLine(line: string): boolean {
  const L = line ?? '';
  /** ASCII `?` or fullwidth `？` (Ink / locale); fetch consent often uses “allow … ?”. */
  if (/Do you want to[^?\n\uFF1F]*(?:\?|？)/i.test(L)) return true;
  /** Single-line “Do you …?” when “want to” is not literal (Ink rewrap). */
  if (/Do you[^?\n]{0,120}(?:\?|？)/i.test(L)) return true;
  return false;
}

/**
 * Lines directly above “Do you want to …?” that belong in the yellow PTY menu card (fetch URL, tool read line, etc.).
 * Kept narrow (length + patterns) so random prose above a menu is not swallowed.
 */
function isPermissionPromptLeadInLine(line: string): boolean {
  const t = (line ?? '').replace(/\r$/, '').trim();
  if (!t || t.length > 260) return false;
  if (/\bClaude wants to fetch\b/i.test(t)) return true;
  /** Raw Ink often uses a title line `Fetch` and puts the URL on the next line — not `Fetch https://…`. */
  if (/^fetch$/i.test(t)) return true;
  if (/^Fetch\s+\S+/i.test(t)) return true;
  /** Indented URL-only line directly under that `Fetch` title (same card as Logon / Raw). */
  if (/^https?:\/\/\S/i.test(t) && t.length < 220) return true;
  if (/^Read\s*\(/i.test(t)) return true;
  if (/^Read\s+file\b/i.test(t)) return true;
  if (/^Listed\s+\d+\s+files?\b/i.test(t)) return true;
  if (/^Globbed\s+\S+/i.test(t)) return true;
  if (/^Grep\s+\S+/i.test(t) && t.length < 140) return true;
  if (/^⎿/.test(t)) return true;
  if (/^\s*Bash command\b/i.test(t)) return true;
  if (/^[─\-_\s|]{10,}$/.test(t)) return true;
  if (/This command requires approval/i.test(t)) return true;
  return false;
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
    /** Last Esc/Tab footer in this slice — long diff + menu chunks can mention the same chrome earlier in prose. */
    let footerJ = -1;
    for (let j = i; j < n; j++) {
      if (isLikelyClaudePermissionMenuFooter(lines[j] ?? '')) footerJ = j;
    }
    if (footerJ < 0) {
      footerJ = findNumberedConsentMenuFooterJ(lines, i, n, /Do you want to/i);
    }
    if (footerJ < 0) {
      /** Fetch consent body line when the explicit “Do you want…” row was redrawn away or wrapped oddly. */
      footerJ = findNumberedConsentMenuFooterJ(lines, i, n, /\bClaude wants to fetch\b/i);
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

    /** Nearest `1. Yes` above the footer (scan backward) so earlier doc/examples cannot steal the start line. */
    let firstYesLine = -1;
    for (let s = footerJ - 1; s >= i; s--) {
      if (/^\s*(?:[❯›>]\s*)?1\.\s+Yes\b/i.test(lines[s] ?? '')) {
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
        if (/^\s*(?:[❯›>]\s*)?\d+\.\s+Yes,/i.test(lines[s] ?? '')) {
          start = s;
          break;
        }
      }
    }

    const candidate = lines.slice(start, footerJ + 1).join('\n');
    const looksMenu =
      /Do you want to[^?\n\uFF1F]*(?:\?|？)/i.test(candidate) ||
      /\bDo you want to allow\b/i.test(candidate) ||
      /^\s*(?:[❯›>]\s*)?\d+\.\s+Yes\b/im.test(candidate);

    if (!looksMenu) {
      const buf: string[] = [];
      buf.push(...lines.slice(i, footerJ + 1));
      flushProse(buf);
      i = footerJ + 1;
      continue;
    }

    /** Pull short tool/fetch context lines above the question (skip blank lines between). */
    let menuStart = start;
    for (let step = 0; step < 500 && menuStart > i; step++) {
      let scan = menuStart - 1;
      while (scan >= i && !(lines[scan] ?? '').trim()) scan--;
      if (scan < i) break;
      const prev = lines[scan] ?? '';
      if (isPermissionPromptLeadInLine(prev)) {
        menuStart = scan;
      } else {
        // Allow arbitrary lines if we are inside a Bash command block
        let foundBashK = -1;
        let valid = true;
        for (let k = scan; k >= Math.max(i, scan - 500); k--) {
          const t = (lines[k] ?? '').trim();
          if (/^\s*[●⎿]\s*/.test(t)) {
            valid = false;
            break;
          }
          if (/^\s*Bash command\b/i.test(t) || /^[─\-_\s|]{10,}$/.test(t)) {
            foundBashK = k;
            break;
          }
        }
        if (valid && foundBashK >= 0) {
          menuStart = foundBashK;
        } else {
          break;
        }
      }
    }

    if (menuStart > i) {
      const before = lines.slice(i, menuStart);
      flushProse(before);
    }
    const menuText = lines.slice(menuStart, footerJ + 1).join('\n');
    out.push({ kind: 'menu', text: menuText });
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

/**
 * Write/previews often use `  123` line-number columns, so the whole tail (including Ink
 * `Do you want to create …?` / `1. Yes`) is one `diff` chunk. Run the same menu splitter on it.
 */
function splitDiffChunkWithEmbeddedMenus(diffText: string): { kind: 'diff' | 'menu'; text: string }[] {
  const parts = splitProseMenuAndRest(diffText);
  if (parts.length === 0) return [{ kind: 'diff', text: diffText }];
  const out: { kind: 'diff' | 'menu'; text: string }[] = [];
  for (const p of parts) {
    if (p.kind === 'menu') {
      out.push({ kind: 'menu', text: p.text });
    } else if (p.text.replace(/\r/g, '').trim().length > 0) {
      out.push({ kind: 'diff', text: p.text });
    }
  }
  return out.length > 0 ? out : [{ kind: 'diff', text: diffText }];
}

/** Diff chunks + prose chunks, with permission menus peeled out of prose (monospace like diffs). */
export function segmentPtyAssistantDisplayBlocks(
  raw: string
): { kind: 'diff' | 'menu' | 'prose' | 'grid'; text: string }[] {
  const coarse = segmentDiffAndProse(raw);
  const out: { kind: 'diff' | 'menu' | 'prose' | 'grid'; text: string }[] = [];
  for (const c of coarse) {
    if (c.kind === 'diff') {
      for (const d of splitDiffChunkWithEmbeddedMenus(c.text)) {
        out.push(d);
      }
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

/** Permission menus live at the PTY tail — avoid O(full transcript) segmentation on every Reply send. */
const MENU_ARCHIVE_TAIL_MAX = 120_000;

function slicePlainTailForMenuSnapshot(plain: string): string {
  const fullLen = plain.length;
  if (fullLen <= MENU_ARCHIVE_TAIL_MAX) return plain;
  let start = fullLen - MENU_ARCHIVE_TAIL_MAX;
  const nl = plain.indexOf('\n', start);
  if (nl !== -1 && nl - start < 12_000) start = nl + 1;
  return plain.slice(start);
}

/** Last permission-menu block from the same segmentation as Pretty — used to archive the yellow card when the user replies. */
export function extractLastChoiceMenuSnapshotForArchive(plain: string): string | null {
  const window = slicePlainTailForMenuSnapshot(plain);
  const parts = segmentPtyAssistantDisplayBlocks(window);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].kind === 'menu') {
      const t = parts[i].text.trim();
      if (t.length > 0) {
        return parts[i].text;
      }
    }
  }
  return null;
}
