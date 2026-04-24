import type { Terminal } from '@xterm/xterm';
import { reflowSoftWrappedPlainLines } from './reflowSoftWrappedPlainLines';

/**
 * Plain text from the active xterm buffer (trimmed trailing empty rows).
 * Matches what you see in the Logon terminal, minus SGR colors (cells are plain strings).
 *
 * After joining buffer rows, applies the same soft-wrap merge as Pretty’s sanitizer so
 * logical lines do not depend on xterm column count (zoom / resize refit otherwise changes
 * where hard wraps fall, which broke permission-menu segmentation on the Dashboard).
 *
 * @param startLine — First buffer line index to include (0-based). Use buffer length at
 *   "clear mirror" time so only lines appended after that point are shown.
 */
export function serializeXtermBufferPlain(term: Terminal, startLine = 0): string {
  const b = term.buffer.active;
  const n = b.length;
  let start = Math.max(0, startLine);
  if (start > n) {
    start = 0;
  }
  const lines: string[] = [];
  for (let y = start; y < n; y++) {
    const line = b.getLine(y);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  return reflowSoftWrappedPlainLines(lines.join('\n'));
}
