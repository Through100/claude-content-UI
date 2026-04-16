import { normalizeTeletypeLines, stripAnsi } from './stripAnsi';

export type ChatTurn = { role: 'user' | 'assistant'; text: string; id: string };

/**
 * Split a PTY plain-text transcript into alternating assistant / user turns.
 * User lines are detected via the Claude Code prompt (`❯` at line start).
 */
export function parsePtyTranscriptToMessages(raw: string): ChatTurn[] {
  const t = normalizeTeletypeLines(stripAnsi(raw ?? ''))
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trimEnd();
  if (!t) return [];

  const parts = t
    .split(/(?=^\s*❯\s+)/m)
    .map((p) => p.replace(/^\n+/, '').trimEnd())
    .filter((p) => p.length > 0);

  const out: ChatTurn[] = [];
  let n = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const lines = part.split('\n');
    const first = lines[0] ?? '';
    const userMatch = first.match(/^\s*❯\s*(.*)$/);

    if (userMatch) {
      const userLine = userMatch[1].trim();
      const rest = lines.slice(1).join('\n').trimEnd();
      if (userLine) {
        out.push({ role: 'user', text: userLine, id: `u-${n++}` });
      }
      if (rest) {
        out.push({ role: 'assistant', text: rest, id: `a-${n++}` });
      }
    } else {
      out.push({ role: 'assistant', text: part.trimEnd(), id: `a-${n++}` });
    }
  }

  return out;
}
