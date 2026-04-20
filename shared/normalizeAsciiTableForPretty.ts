/**
 * Pretty “ASCII table” blocks: TUI output often mixes Unicode box drawing with US-ASCII `|+-`.
 * Those glyphs rarely share the same advance width even under `font-mono`, which makes columns look
 * shifted. Normalize to ASCII and expand tabs so browser rendering matches Raw / Logon more closely.
 */
function expandLineTabs(line: string, tabWidth: number): string {
  if (!line.includes('\t')) return line;
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i] ?? '';
    if (c === '\t') {
      const col = out.length;
      const pad = tabWidth - (col % tabWidth);
      out += ' '.repeat(pad === 0 ? tabWidth : pad);
    } else {
      out += c;
    }
  }
  return out;
}

export function expandTabsForAsciiBlock(text: string, tabWidth = 8): string {
  return text.split('\n').map((ln) => expandLineTabs(ln, tabWidth)).join('\n');
}

/** Strip invisible width / space oddities that break fixed-column layouts. */
export function normalizeAsciiTableForPretty(text: string): string {
  let t = text.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').replace(/\ufeff/g, '');

  const pairs: [RegExp, string][] = [
    [/\u2503/g, '|'],
    [/\u2502/g, '|'],
    [/\u2551/g, '|'],
    [/\u2501/g, '-'],
    [/\u2500/g, '-'],
    [/\u2550/g, '-'],
    [/\u2574/g, '-'],
    [/\u2575/g, '-'],
    [/\u250c/g, '+'],
    [/\u2510/g, '+'],
    [/\u2514/g, '+'],
    [/\u2518/g, '+'],
    [/\u251c/g, '+'],
    [/\u2524/g, '+'],
    [/\u252c/g, '+'],
    [/\u2534/g, '+'],
    [/\u253c/g, '+']
  ];
  for (const [re, ch] of pairs) t = t.replace(re, ch);

  return expandTabsForAsciiBlock(t);
}
