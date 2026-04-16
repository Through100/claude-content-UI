/**
 * Two-stage pipeline for Pretty Output:
 * 1) parseLinearBlocks — tolerant line scan (fenced ``` first; exact code body newlines preserved)
 * 2) buildPrettyDocument — group H2 regions into `section`, merge consecutive `meta` into `metaPanel`
 */

export type TagKind = 'image' | 'chart' | 'citation' | 'internal-link' | 'other';

export type InlinePart =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'tag'; tagKind: TagKind; raw: string; detail: string };

/** Stage-1 blocks (flat stream). */
export type LinearBlock =
  | { type: 'title'; text: string }
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; parts: InlinePart[] }
  | { type: 'list'; items: InlinePart[][] }
  | { type: 'divider' }
  | { type: 'callout'; body: string }
  | { type: 'code'; lang?: string; body: string }
  | { type: 'meta'; label: string; value: string }
  | { type: 'tag'; tagKind: TagKind; raw: string; detail: string }
  | { type: 'faq'; id: string; question: string; answer: string };

/** Blocks nested inside a `section`. */
export type SectionChild =
  | Exclude<LinearBlock, 'title'>
  | { type: 'metaPanel'; rows: { label: string; value: string }[] };

/** Stage-2 top-level document nodes. */
export type DocumentBlock =
  | { type: 'title'; text: string }
  | { type: 'section'; heading: { level: 2; text: string } | null; children: SectionChild[] };

const HR_LINE = /^[\s]*-{3,}[\s]*$/;
const H3 = /^###\s+(.*)$/;
const H2 = /^##\s+(.*)$/;
const H1_TITLE = /^#\s+(.*)$/;
const BQUOTE = /^>\s?(.*)$/;
const BULLET = /^(\s*)[-*]\s+(.*)$/;
const METADATA = /^\s*\*\*([^*]+)\*\*\s*:\s*(.*)$/;
const FAQ_Q = /^\s*\*\*(Q\d+|Q)\s*:\s*(.+?)\*\*\s*(.*)$/;
const FAQ_Q2 = /^\s*\*\*(Q\d+|Q)\s*:\s*\*\*\s*(.+)$/;
const ANSWER_START = /^\s*Answer\s*:\s*(.*)$/i;
const TAG_LINE_KNOWN =
  /^\s*\[(IMAGE|CHART|CITATION\s+CAPSULE|INTERNAL-LINK)\s*:\s*(.*?)\]\s*$/i;
/** Any `[LABEL]` or `[LABEL: detail]` whole line → tag (tolerant). */
const TAG_LINE_ANY = /^\s*\[([^\]\n]+)\]\s*$/;

function mapTagKind(s: string): TagKind {
  const u = s.toUpperCase().replace(/\s+/g, ' ').trim();
  if (u.startsWith('IMAGE')) return 'image';
  if (u.startsWith('CHART')) return 'chart';
  if (u.startsWith('CITATION')) return 'citation';
  if (u.startsWith('INTERNAL-LINK') || u.startsWith('INTERNAL LINK')) return 'internal-link';
  return 'other';
}

function parseBracketTagInner(inner: string): { tagKind: TagKind; detail: string } {
  const m = inner.match(/^(IMAGE|CHART|CITATION\s+CAPSULE|INTERNAL-LINK)\s*:\s*(.*)$/i);
  if (m) {
    return { tagKind: mapTagKind(m[1] ?? ''), detail: (m[2] ?? '').trim() };
  }
  const colon = inner.indexOf(':');
  if (colon >= 0) {
    const label = inner.slice(0, colon).trim();
    const detail = inner.slice(colon + 1).trim();
    return { tagKind: mapTagKind(label), detail: detail || label };
  }
  return { tagKind: 'other', detail: inner.trim() };
}

/** Split `**bold**` and bracket tags inside a line (for use outside fenced code). */
export function parseInline(line: string): InlinePart[] {
  if (!line) return [{ kind: 'text', text: '' }];
  const parts: InlinePart[] = [];
  let rest = line;

  const pushTag = (raw: string, inner: string) => {
    const { tagKind, detail } = parseBracketTagInner(inner);
    parts.push({ kind: 'tag', tagKind, raw, detail });
  };

  while (rest.length > 0) {
    const star = rest.indexOf('**');
    const brack = rest.indexOf('[');

    const pickStar = star >= 0 && (brack < 0 || star < brack);
    if (pickStar) {
      if (star > 0) parts.push({ kind: 'text', text: rest.slice(0, star) });
      const after = rest.slice(star + 2);
      const close = after.indexOf('**');
      if (close < 0) {
        parts.push({ kind: 'text', text: rest.slice(star) });
        break;
      }
      const boldText = after.slice(0, close);
      parts.push({ kind: 'bold', text: boldText });
      rest = after.slice(close + 2);
      continue;
    }

    if (brack >= 0) {
      if (brack > 0) parts.push({ kind: 'text', text: rest.slice(0, brack) });
      const after = rest.slice(brack);
      const closeIdx = after.indexOf(']');
      if (closeIdx < 0) {
        parts.push({ kind: 'text', text: after });
        break;
      }
      const token = after.slice(0, closeIdx + 1);
      const inner = after.slice(1, closeIdx);
      pushTag(token, inner);
      rest = after.slice(closeIdx + 1);
      continue;
    }

    parts.push({ kind: 'text', text: rest });
    break;
  }

  return mergeAdjacentText(parts);
}

function mergeAdjacentText(parts: InlinePart[]): InlinePart[] {
  const out: InlinePart[] = [];
  for (const p of parts) {
    if (p.kind === 'text' && out.length && out[out.length - 1].kind === 'text') {
      (out[out.length - 1] as { kind: 'text'; text: string }).text += p.text;
    } else {
      out.push(p);
    }
  }
  return out;
}

function flushParagraph(buf: string[], blocks: LinearBlock[]) {
  if (buf.length === 0) return;
  const text = buf.join(' ').trim();
  buf.length = 0;
  if (!text) return;
  blocks.push({ type: 'paragraph', parts: parseInline(text) });
}

function parseFAQ(lines: string[], i: number): { block: LinearBlock; next: number } | null {
  const line = lines[i];
  let qId = '';
  let qText = '';
  let extra = '';

  let m = line.match(FAQ_Q);
  if (m) {
    qId = (m[1] ?? '').trim();
    qText = (m[2] ?? '').trim();
    extra = (m[3] ?? '').trim();
  } else {
    m = line.match(FAQ_Q2);
    if (!m) return null;
    qId = (m[1] ?? '').trim();
    qText = (m[2] ?? '').trim();
  }

  let j = i + 1;
  let answer = extra;
  if (j < lines.length) {
    const al = lines[j];
    const am = al.match(ANSWER_START);
    if (am) {
      answer = [answer, am[1] ?? ''].filter(Boolean).join(' ').trim();
      j++;
      while (j < lines.length) {
        const L = lines[j];
        if (/^\s*\*\*(Q\d+|Q)\s*:/i.test(L)) break;
        if (L.trim() === '' && answer.length > 0) {
          j++;
          break;
        }
        if (L.trim() === '' && !answer) {
          j++;
          continue;
        }
        if (/^#{1,3}\s/.test(L.trim())) break;
        if (HR_LINE.test(L)) break;
        if (BULLET.test(L)) break;
        if (L.trim().startsWith('```')) break;
        answer += (answer ? '\n' : '') + L;
        j++;
      }
    }
  }

  return {
    block: {
      type: 'faq',
      id: qId,
      question: qText || qId,
      answer: answer.trim()
    },
    next: j
  };
}

/** Stage 1: flat tolerant parse. */
export function parseLinearBlocks(source: string): LinearBlock[] {
  const raw = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');
  const blocks: LinearBlock[] = [];
  const paraBuf: string[] = [];
  let i = 0;

  const flush = () => flushParagraph(paraBuf, blocks);

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();
    const t = trimmed.trim();

    if (t === '') {
      flush();
      i++;
      continue;
    }

    if (t.startsWith('```')) {
      flush();
      const lang = t.slice(3).trim() || undefined;
      i++;
      const bodyLines: string[] = [];
      while (i < lines.length) {
        const L = lines[i];
        const lt = L.trim();
        if (lt === '```' || (lt.startsWith('```') && lt.slice(3).trim() === '')) {
          i++;
          break;
        }
        bodyLines.push(L);
        i++;
      }
      blocks.push({ type: 'code', lang, body: bodyLines.join('\n') });
      continue;
    }

    const h3 = trimmed.match(H3);
    if (h3) {
      flush();
      blocks.push({ type: 'heading', level: 3, text: (h3[1] ?? '').trim() });
      i++;
      continue;
    }

    const h2 = trimmed.match(H2);
    if (h2) {
      flush();
      blocks.push({ type: 'heading', level: 2, text: (h2[1] ?? '').trim() });
      i++;
      continue;
    }

    const h1 = trimmed.match(H1_TITLE);
    if (h1) {
      flush();
      blocks.push({ type: 'title', text: (h1[1] ?? '').trim() });
      i++;
      continue;
    }

    if (HR_LINE.test(trimmed)) {
      flush();
      blocks.push({ type: 'divider' });
      i++;
      continue;
    }

    if (trimmed.match(BQUOTE)) {
      flush();
      const bqLines: string[] = [];
      while (i < lines.length) {
        const L = lines[i];
        const m = L.match(BQUOTE);
        if (!m) break;
        bqLines.push(m[1] ?? '');
        i++;
      }
      blocks.push({ type: 'callout', body: bqLines.join('\n') });
      continue;
    }

    const bm = trimmed.match(BULLET);
    if (bm) {
      flush();
      const items: InlinePart[][] = [];
      while (i < lines.length) {
        const L = lines[i];
        const mm = L.trim().match(BULLET);
        if (!mm) break;
        items.push(parseInline((mm[2] ?? '').trim()));
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    const faq = parseFAQ(lines, i);
    if (faq) {
      flush();
      blocks.push(faq.block);
      i = faq.next;
      continue;
    }

    const mm = trimmed.match(METADATA);
    if (mm && !/^\*\*Q\d/i.test(trimmed)) {
      flush();
      blocks.push({
        type: 'meta',
        label: (mm[1] ?? '').trim(),
        value: (mm[2] ?? '').trim()
      });
      i++;
      continue;
    }

    let tm = trimmed.match(TAG_LINE_KNOWN);
    if (tm) {
      flush();
      const kind = mapTagKind(tm[1] ?? '');
      blocks.push({
        type: 'tag',
        tagKind: kind,
        raw: trimmed,
        detail: (tm[2] ?? '').trim()
      });
      i++;
      continue;
    }

    tm = trimmed.match(TAG_LINE_ANY);
    if (tm) {
      flush();
      const inner = (tm[1] ?? '').trim();
      const { tagKind, detail } = parseBracketTagInner(inner);
      blocks.push({ type: 'tag', tagKind, raw: trimmed, detail });
      i++;
      continue;
    }

    paraBuf.push(trimmed);
    i++;
  }

  flush();
  return blocks;
}

function mergeMetaRuns(children: SectionChild[]): SectionChild[] {
  const out: SectionChild[] = [];
  let buf: { label: string; value: string }[] = [];
  const flushMeta = () => {
    if (buf.length === 0) return;
    if (buf.length === 1) {
      out.push({ type: 'meta', ...buf[0] });
    } else {
      out.push({ type: 'metaPanel', rows: [...buf] });
    }
    buf = [];
  };
  for (const c of children) {
    if (c.type === 'meta') {
      buf.push({ label: c.label, value: c.value });
    } else {
      flushMeta();
      out.push(c);
    }
  }
  flushMeta();
  return out;
}

function isSectionable(b: LinearBlock): b is Exclude<LinearBlock, 'title'> {
  return b.type !== 'title';
}

/**
 * Stage 2: wrap each `##` … until next `##` into a `section` card; preamble before first `##` gets its own section.
 * Merges consecutive `meta` rows into `metaPanel`.
 */
export function buildPrettyDocument(linear: LinearBlock[]): DocumentBlock[] {
  const doc: DocumentBlock[] = [];
  let i = 0;

  while (i < linear.length && linear[i].type === 'title') {
    doc.push({ type: 'title', text: linear[i].text });
    i++;
  }

  const preamble: Exclude<LinearBlock, 'title'>[] = [];
  while (i < linear.length) {
    const b = linear[i];
    if (b.type === 'heading' && b.level === 2) break;
    if (b.type === 'title') {
      doc.push({ type: 'title', text: b.text });
      i++;
      continue;
    }
    preamble.push(b as Exclude<LinearBlock, 'title'>);
    i++;
  }

  if (preamble.length) {
    doc.push({
      type: 'section',
      heading: null,
      children: mergeMetaRuns(preamble as SectionChild[])
    });
  }

  while (i < linear.length) {
    const b = linear[i];
    if (b.type === 'heading' && b.level === 2) {
      i++;
      const chunk: Exclude<LinearBlock, 'title'>[] = [];
      while (i < linear.length) {
        const n = linear[i];
        if (n.type === 'heading' && n.level === 2) break;
        if (n.type === 'title') break;
        chunk.push(n as Exclude<LinearBlock, 'title'>);
        i++;
      }
      doc.push({
        type: 'section',
        heading: { level: 2, text: b.text },
        children: mergeMetaRuns(chunk as SectionChild[])
      });
      continue;
    }
    if (b.type === 'title') {
      doc.push({ type: 'title', text: b.text });
      i++;
      continue;
    }
    const orphan: Exclude<LinearBlock, 'title'>[] = [];
    while (i < linear.length && !(linear[i].type === 'heading' && linear[i].level === 2)) {
      const x = linear[i];
      if (x.type === 'title') break;
      orphan.push(x as Exclude<LinearBlock, 'title'>);
      i++;
    }
    if (orphan.length) {
      doc.push({
        type: 'section',
        heading: null,
        children: mergeMetaRuns(orphan as SectionChild[])
      });
    }
  }

  return doc;
}

/** Full pipeline: linear parse + document tree. */
export function parsePrettyDocument(source: string): DocumentBlock[] {
  return buildPrettyDocument(parseLinearBlocks(source));
}

/** @deprecated use parseLinearBlocks + buildPrettyDocument or parsePrettyDocument */
export function parseTerminalMarkdown(source: string): LinearBlock[] {
  return parseLinearBlocks(source);
}
