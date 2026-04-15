/**
 * Detect Claude Code post-login banner: "Welcome back {name}!" from streamed PTY output.
 * Output may contain ANSI SGR; we strip common sequences before matching.
 */

const TAIL_MAX = 24_000;

/** Strip CSI/OSC-style escapes enough for plain-text matching (not full ECMA-48). */
export function stripAnsiForPtyMatch(s: string): string {
  let t = s;
  for (let i = 0; i < 8; i++) {
    const before = t;
    t = t
      .replace(/\u001b\[[\d;?]*[A-Za-z]/g, '')
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\x5c)/g, '')
      .replace(/\u001b[\][()#][\d?A-Za-z]/g, '')
      .replace(/\u001b[\x20-\x2f][\x30-\x7e]/g, '')
      .replace(/\u001b[\x30-\x7e]/g, '');
    if (t === before) break;
  }
  return t.replace(/\u001b/g, '');
}

/** First capture group = display name between "Welcome back" and "!". */
const WELCOME_BACK_RE = /Welcome back\s+([^\n\r!]+?)\s*!/i;

export class PtyWelcomeNameScanner {
  private tail = '';
  private emitted = false;

  /** Append UTF-16 chunk from PTY; invokes callback at most once per scanner lifetime. */
  feed(chunk: string, onName: (name: string) => void): void {
    if (this.emitted || !chunk) return;
    this.tail = (this.tail + chunk).slice(-TAIL_MAX);
    const plain = stripAnsiForPtyMatch(this.tail);
    const m = plain.match(WELCOME_BACK_RE);
    if (!m) return;
    const name = m[1].replace(/\s+/g, ' ').trim();
    if (name.length < 1 || name.length > 120) return;
    this.emitted = true;
    onName(name);
  }

  reset(): void {
    this.tail = '';
    this.emitted = false;
  }

  get didEmit(): boolean {
    return this.emitted;
  }
}
