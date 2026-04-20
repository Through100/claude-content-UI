/**
 * xterm / Claude Code often hard-wraps prose at ~80–120 columns: each buffer row becomes its own
 * line with a newline, but there is no space at the wrap boundary. Downstream markdown joins those
 * rows into one paragraph with `\\n`; browsers keep the newline, but many wrapped fragments read as
 * missing spaces (`alreadya previous…`). Join **likely** wrap continuations with a single space.
 */
function isMarkdownOrTableLine(s: string): boolean {
  const t = s.trimStart();
  return (
    /^#{1,6}\s/.test(t) ||
    /^[-*]\s+\S/.test(t) ||
    /^\d+\.\s+\S/.test(t) ||
    /^●\s/.test(t) ||
    /^>\s/.test(t) ||
    /^```/.test(t) ||
    /^\|/.test(t) ||
    /^[│┌├└┐┘┬┴┼]/.test(t) ||
    /^[─═━┄┅]{4,}\s*$/.test(t) ||
    /^[\s\-]{3,}$/.test(t)
  );
}

export function reflowSoftWrappedPlainLines(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  const maxWrapCol = 132;

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i] ?? '';
    if (!L.trim()) {
      out.push(L);
      continue;
    }
    if (isMarkdownOrTableLine(L)) {
      out.push(L);
      continue;
    }
    if (out.length === 0) {
      out.push(L);
      continue;
    }
    const prev = out[out.length - 1] ?? '';
    if (!prev.trim()) {
      out.push(L);
      continue;
    }
    if (isMarkdownOrTableLine(prev)) {
      out.push(L);
      continue;
    }

    const p = prev.trimEnd();
    const c = L.trimStart();

    /** Broken markdown like `- [PERSONAL EXPERIENCE]` then `+ [UNIQUE INSIGHT]` on the next row. */
    if (/\]\s*$/.test(p) && /^\s*\+/.test(L)) {
      out[out.length - 1] = `${p} ${c}`;
      continue;
    }

    /** Wrapped `- item …` or `1. item …` body (second row starts lowercase, no new marker). */
    if (
      /^\s*[-*]\s+\S/.test(prev) &&
      prev.length >= 28 &&
      !/[.!?:]\s*$/.test(p) &&
      /^[a-z("'`“‘]/.test(c)
    ) {
      out[out.length - 1] = `${p} ${c}`;
      continue;
    }
    if (
      /^\s*\d+\.\s+\S/.test(prev) &&
      prev.length >= 28 &&
      !/[.!?:]\s*$/.test(p) &&
      /^[a-z("'`“‘]/.test(c)
    ) {
      out[out.length - 1] = `${p} ${c}`;
      continue;
    }

    if (p.length > maxWrapCol && L.trimEnd().length > maxWrapCol) {
      out.push(L);
      continue;
    }

    if (/[-–—]\s*$/.test(p)) {
      out.push(L);
      continue;
    }

    const prevNoSentenceEnd = !/[.!?:]\s*$/.test(p);
    const looksLikeWrapContinuation =
      /^[a-z("'`“‘]/.test(c) ||
      /^[,;]/.test(c) ||
      /^\s*(and|or|of|the|to|for|with|in|on|at|is|are|was|were)\b/i.test(c);

    if (prevNoSentenceEnd && looksLikeWrapContinuation) {
      out[out.length - 1] = `${p} ${c}`;
      continue;
    }

    out.push(L);
  }

  return out.join('\n');
}
