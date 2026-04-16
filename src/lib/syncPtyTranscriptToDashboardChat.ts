import {
  isTrivialAssistantTail,
  parsePtyTranscriptToMessages,
  trimTrailingTrivialAssistantTurns,
  type ChatTurn
} from '../../shared/parsePtyTranscriptToMessages';
import {
  appendDashboardChatTurn,
  loadDashboardChatHistory,
  sanitizeRunOutputForChat,
  updateLastDashboardAssistant,
  type DashboardChatTurn
} from './dashboardChatHistory';

function ptyTurnsToUserAssistantPairs(turns: ChatTurn[]): { user: string; assistant: string }[] {
  const out: { user: string; assistant: string }[] = [];
  let i = 0;
  while (i < turns.length) {
    if (turns[i].role === 'assistant') {
      i++;
      continue;
    }
    const user = turns[i].text.trim();
    i++;
    const asst: string[] = [];
    while (i < turns.length && turns[i].role === 'assistant') {
      asst.push(turns[i].text);
      i++;
    }
    const assistant = asst.join('\n\n').trimEnd();
    if (!user && assistant) {
      if (out.length > 0) {
        out[out.length - 1].assistant = [out[out.length - 1].assistant, assistant].filter(Boolean).join('\n\n');
      }
      continue;
    }
    if (!user && !assistant) continue;
    out.push({ user, assistant });
  }
  return out;
}

/** Drop the first PTY pair when it is clearly the initial `/blog …` exchange already mirrored by the headless turn. */
function skipHeadlessDuplicateLeadingPair(
  pairs: { user: string; assistant: string }[],
  headlessTurn: DashboardChatTurn | undefined
): { user: string; assistant: string }[] {
  if (!pairs.length || !headlessTurn) return pairs;
  const p = pairs[0];
  const ha = headlessTurn.assistant.trim();
  const pa = p.assistant.trim();
  if (ha.length < 60 || pa.length < 60) return pairs;
  const head = (s: string, n: number) => s.slice(0, Math.min(n, s.length));
  const textSimilar =
    head(ha, 360) === head(pa, 360) ||
    ha.startsWith(head(pa, 140)) ||
    pa.startsWith(head(ha, 140));
  if (!textSimilar) return pairs;
  const u = p.user.trim();
  const looksShellish =
    /^\/[^\s]+/.test(u) ||
    /blog\s+write\b/i.test(u) ||
    u.length < 2 ||
    /^claude\b/i.test(u);
  if (looksShellish) return pairs.slice(1);
  return pairs;
}

/**
 * Merge Pretty-sanitized PTY transcript into the dashboard thread for the same command+target.
 * Idempotent: safe to call on a debounced timer while the PTY buffer grows.
 */
export function syncPrettyPtyTranscriptToDashboardThread(threadKey: string, sanitizedPty: string): void {
  const raw = sanitizedPty?.trim() ?? '';
  if (!raw) return;

  const existingAll = loadDashboardChatHistory(threadKey);
  if (existingAll.length === 0) return;

  let turns = trimTrailingTrivialAssistantTurns(parsePtyTranscriptToMessages(raw));
  turns = trimTrailingTrivialAssistantTurns(turns);
  let pairs = ptyTurnsToUserAssistantPairs(turns);
  if (pairs.length === 0) return;

  const headlessFirst = existingAll[0];
  pairs = skipHeadlessDuplicateLeadingPair(pairs, headlessFirst);

  for (const p of pairs) {
    const u = p.user.trim();
    const body = sanitizeRunOutputForChat(p.assistant);
    if (!u) continue;
    if (!body.trim() || isTrivialAssistantTail(body)) continue;

    const ex = loadDashboardChatHistory(threadKey);
    if (ex.some((t) => t.user === u && t.assistant === body)) continue;

    const last = ex[ex.length - 1];
    if (last && last.user === u) {
      const la = last.assistant.trim();
      const nb = body.trim();
      if (nb.startsWith(la) && nb.length >= la.length && nb !== last.assistant) {
        updateLastDashboardAssistant(threadKey, body);
        continue;
      }
      if (nb === la) continue;
    }

    appendDashboardChatTurn(u, body, threadKey);
  }
}
