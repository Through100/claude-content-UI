import { textContainsClaudePermissionMenu } from './claudeCodePtyPermissionMenu';
import { normalizeTeletypeLines, stripAnsi } from './stripAnsi';

export type ChatTurn = { role: 'user' | 'assistant'; text: string; id: string };

/** One line of Claude Code TUI noise (spinners, tool hints, cost footer). */
export function isPtyAssistantNoiseLine(line: string): boolean {
  const l = line.trim();
  if (!l) return true;
  if (/^[─\-_\s|]+$/.test(l)) return true;
  if (/^\|\s*cost:/i.test(l)) return true;
  if (/^\s*❯\s*$/.test(l)) return true;
  // Spinners: ✽, ✻, ✶, middle dot ·, bullet *, or bare “Catapulting…” style status.
  if (
    /^\s*[✽✻✶·*•⎿✢✿]?\s*(?:Undulating|Thinking|Bouncing|Pulsing|Compacting|Scribbling|Catapulting|Warping|Drizzling|Twirling|Cerebrating|Percolating|Simmering|Ruminating|Marinating|Brooding|Festooning|Moonwalking|Hashing|Propagating|Actioning)[·….\s]*(?:\([^)]*\))?\s*$/i.test(
      l
    )
  ) {
    return true;
  }
  // Claude Code invents new one-word “* Foobaring…” status lines often; keep tight to avoid real bullets.
  if (
    l.length < 140 &&
    /^\s*[·*•✻✶⎿✢✿]\s*[A-Za-z]{4,26}ing\b(?:[·….]\s*)*(?:\([^)]*\))?\s*$/i.test(l) &&
    !/\s(and|or|the|for|with|your|you|from|that|this)\s/i.test(l)
  ) {
    return true;
  }
  // e.g. "* Drizzling… (17s · ↑ 635 tokens)" — usage footer on one line.
  if (
    /^\s*[·*•✻✶⎿✢✿]\s*\w+ing\b/i.test(l) &&
    /\b\d+\s*tokens?\b/i.test(l) &&
    (/\(\s*\d+s/i.test(l) || /↑\s*\d+/.test(l) || /↓\s*\d+/.test(l))
  ) {
    return true;
  }
  if (/^\s*[·*•✻✶⎿✢✿✽]\s*\w+ing\b/i.test(l) && l.length < 160) return true;
  if (/\(thought for \d+s?\)/i.test(l) && l.length < 140) return true;
  // e.g. "> Thinking a bit longer... still working on it..."
  if (/^\s*>\s*Thinking\b/i.test(l) && l.length < 220) return true;
  // Claude Code skill line + inline tip (still TUI chrome, not the answer body).
  if (/^\s*●\s*Skill\s*\(/i.test(l) && l.length < 260) return true;
  if (/Double-tap esc to rewind/i.test(l) && l.length < 220) return true;
  // Claude Code terminal widget hints (not model prose).
  if (/^\s*(?:⎿\s*)?L\s*Tip:/i.test(l)) return true;
  if (l.length < 240 && /\bDid you know\b/i.test(l) && /\bterminal\b/i.test(l)) return true;
  // Client-injected banners when the Logon WebSocket PTY session ends (not model output).
  if (/^\[\s*Claude process exited/i.test(l)) return true;
  if (/^\[\s*Connection closed\]/i.test(l)) return true;
  if (/^\(\s*This is only the live PTY/i.test(l)) return true;
  return false;
}

/** Drop leading/trailing spinner and status lines; keeps main assistant prose. */
export function stripEphemeralAssistantEdges(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  while (lines.length && isPtyAssistantNoiseLine(lines[0] ?? '')) lines.shift();
  while (lines.length && isPtyAssistantNoiseLine(lines[lines.length - 1] ?? '')) lines.pop();
  return lines.join('\n').trim();
}

/** Footer / status-only assistant chunks (not a real reply yet / trailing UI noise). */
export function isTrivialAssistantTail(text: string): boolean {
  const t = text.replace(/\r/g, '').trim();
  if (!t) return true;
  if (textContainsClaudePermissionMenu(t)) return false;
  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return true;
  const toolEcho = (l: string) =>
    /^Reading\b/i.test(l) || /^Listed\b/i.test(l) || /^Globbed\b/i.test(l);
  if (lines.every((l) => isPtyAssistantNoiseLine(l) || toolEcho(l))) return true;
  // Previously this was < 6; but short replies like "Ok." or "Done." were being hidden.
  const letters = (t.match(/[A-Za-z]/g) ?? []).length;
  return letters < 1;
}

/** Drop trailing assistant bubbles that are only cost lines / rules / spinner hints. */
export function trimTrailingTrivialAssistantTurns(turns: ChatTurn[]): ChatTurn[] {
  const out = [...turns];
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last.role !== 'assistant' || !isTrivialAssistantTail(last.text)) break;
    out.pop();
  }
  return out;
}

/** After the user sent a ❯ line, assistant reply not captured yet (or only noise so far). */
export function isAwaitingPtyAssistantResponse(turns: ChatTurn[]): boolean {
  const t = trimTrailingTrivialAssistantTurns(turns);
  return t.length > 0 && t[t.length - 1].role === 'user';
}

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
        if (!userLine && isTrivialAssistantTail(rest)) {
          /* e.g. `❯` + whitespace then only rules / cost — no real user text */
        } else {
          out.push({ role: 'assistant', text: rest, id: `a-${n++}` });
        }
      }
    } else {
      out.push({ role: 'assistant', text: part.trimEnd(), id: `a-${n++}` });
    }
  }

  return out;
}
