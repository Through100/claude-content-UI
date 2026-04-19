import { textContainsClaudePermissionMenu } from '../../shared/claudeCodePtyPermissionMenu';
import {
  isPtyAssistantNoiseLine,
  isTrivialAssistantTail,
  parsePtyTranscriptToMessages,
  stripEphemeralAssistantEdges,
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

/** Stable compare so tiny whitespace / ZWSP differences do not bypass dedupe. */
function normalizeTurnText(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/[\u00a0\u200b\ufeff]/g, '')
    .trim();
}

function turnSignature(user: string, assistant: string): string {
  return `${normalizeTurnText(user)}::${normalizeTurnText(assistant)}`;
}

/** True when every non-empty line is PTY chrome (covers verbs we have not listed yet). */
function assistantIsEphemeralNoiseOnly(raw: string): boolean {
  if (textContainsClaudePermissionMenu(raw)) return false;
  const t = stripEphemeralAssistantEdges(sanitizeRunOutputForChat(raw)).trim();
  if (!t) return true;
  const lines = t.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return lines.length > 0 && lines.every((l) => isPtyAssistantNoiseLine(l));
}

function ptyTurnsToUserAssistantPairs(turns: ChatTurn[]): { user: string; assistant: string }[] {
  const out: { user: string; assistant: string }[] = [];
  let i = 0;
  const leadingChunks: string[] = [];
  while (i < turns.length && turns[i].role === 'assistant') {
    leadingChunks.push(turns[i].text);
    i++;
  }
  let pendingLeadingAssistant = leadingChunks.join('\n\n').trimEnd();

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
    let assistant = asst.join('\n\n').trimEnd();
    if (pendingLeadingAssistant) {
      assistant = [pendingLeadingAssistant, assistant].filter(Boolean).join('\n\n').trimEnd();
      pendingLeadingAssistant = '';
    }
    if (!user && assistant) {
      if (out.length > 0) {
        out[out.length - 1].assistant = [out[out.length - 1].assistant, assistant].filter(Boolean).join('\n\n');
      }
      continue;
    }
    if (!user && !assistant) continue;
    out.push({ user, assistant });
  }
  if (pendingLeadingAssistant.trim() && out.length > 0) {
    const last = out[out.length - 1];
    last.assistant = [last.assistant, pendingLeadingAssistant].filter(Boolean).join('\n\n').trimEnd();
  }
  return out;
}

/**
 * True when every non-empty line is PTY noise, spinners, or inline terminal tips
 * (so a duplicate `❯ same` block in the transcript is almost certainly TUI echo, not a second send).
 */
function assistantIsPtyChromeOrTipsOnly(raw: string): boolean {
  if (textContainsClaudePermissionMenu(raw)) return false;
  const t = stripEphemeralAssistantEdges(sanitizeRunOutputForChat(raw)).trim();
  if (!t) return true;
  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.length > 0 && lines.every((l) => isPtyAssistantNoiseLine(l));
}

/**
 * Transcript repaints sometimes emit back-to-back `❯ user` with only spinners/tips between.
 * Merge those into one pair so the dashboard does not show duplicate user bubbles.
 */
function mergeConsecutivePtyEchoUserTurns(
  pairs: { user: string; assistant: string }[]
): { user: string; assistant: string }[] {
  const out: { user: string; assistant: string }[] = [];
  for (const p of pairs) {
    const nu = normalizeTurnText(p.user);
    const last = out[out.length - 1];
    if (!last || !nu || nu !== normalizeTurnText(last.user)) {
      out.push({ ...p });
      continue;
    }
    if (assistantIsPtyChromeOrTipsOnly(last.assistant)) {
      last.assistant = [last.assistant, p.assistant].filter(Boolean).join('\n\n');
      continue;
    }
    out.push({ ...p });
  }
  return out;
}

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
  pairs = mergeConsecutivePtyEchoUserTurns(pairs);

  /** Same transcript often contains back-to-back identical ❯ blocks after merge/scrollback. */
  const collapsedPairs: { user: string; assistant: string }[] = [];
  let prevSig = '';
  for (const p of pairs) {
    const u0 = p.user.trim();
    const b0 = stripEphemeralAssistantEdges(sanitizeRunOutputForChat(p.assistant));
    if (!u0 || !b0.trim() || isTrivialAssistantTail(b0)) continue;
    const sig0 = turnSignature(u0, b0);
    if (sig0 === prevSig) continue;
    prevSig = sig0;
    collapsedPairs.push(p);
  }
  pairs = collapsedPairs;

  const seenThisPass = new Set<string>();

  for (const p of pairs) {
    const u = p.user.trim();
    let body = sanitizeRunOutputForChat(p.assistant);
    body = stripEphemeralAssistantEdges(body);
    if (!u) continue;
    if (!body.trim() || isTrivialAssistantTail(body)) continue;

    const sig = turnSignature(u, body);
    if (seenThisPass.has(sig)) continue;
    seenThisPass.add(sig);

    const ex = loadDashboardChatHistory(threadKey);
    if (ex.some((t) => turnSignature(t.user, t.assistant) === sig)) continue;

    const last = ex[ex.length - 1];
    if (last && last.user === u) {
      if (assistantIsEphemeralNoiseOnly(last.assistant)) {
        updateLastDashboardAssistant(threadKey, body);
        continue;
      }
      const lastRaw = last.assistant.trim();
      const la = stripEphemeralAssistantEdges(lastRaw).trim();
      const nb = body.trim();
      if (nb.startsWith(lastRaw) && nb.length >= lastRaw.length && nb !== last.assistant) {
        updateLastDashboardAssistant(threadKey, body);
        continue;
      }
      if (nb === lastRaw) continue;
      if (!la || isTrivialAssistantTail(lastRaw) || isTrivialAssistantTail(la)) {
        updateLastDashboardAssistant(threadKey, body);
        continue;
      }
    }

    appendDashboardChatTurn(u, body, threadKey);
  }
}
