/** Strip common ANSI escape sequences for plain-text previews (PTY mirror, logs). */
export function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\[[\d;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][\d;]*(?:[^\x07\x1b]*\x1b\\|[^\x07]*\x07)/g, '')
    .replace(/\x1b[>@]/g, '');
}

/**
 * Apply readline-style handling of CR/LF after escape stripping.
 * Many TUIs (including Claude Code) use `\r` to redraw the same line while streaming;
 * if we only strip ANSI, each redraw can look like a new line in a plain-text mirror.
 *
 * Rules: `\r` clears the current logical line buffer; `\n` commits it.
 */
export function normalizeTeletypeLines(input: string): string {
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '\r') {
      // If it's \r\n, don't clear the line, just let the \n handle it
      if (i + 1 < input.length && input[i + 1] === '\n') {
        continue;
      }
      line = '';
    } else if (c === '\n') {
      lines.push(line);
      line = '';
    } else {
      line += c;
    }
  }
  if (line.length) lines.push(line);
  return lines.join('\n');
}
