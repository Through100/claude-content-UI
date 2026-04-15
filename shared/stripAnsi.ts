/** Strip common ANSI escape sequences for plain-text previews (PTY mirror, logs). */
export function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\[[\d;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][\d;]*(?:[^\x07\x1b]*\x1b\\|[^\x07]*\x07)/g, '')
    .replace(/\x1b[>@]/g, '');
}
