import { BLOG_COMMANDS } from '../types';

export const DASHBOARD_CHAT_STORAGE_KEY = 'claude-content-ui-dashboard-chat-v1';
const MAX_TURNS = 50;

export type DashboardChatTurn = {
  id: string;
  user: string;
  assistant: string;
  at: number;
};

/** Strip common run wrappers so markdown renders cleanly in chat. */
export function sanitizeRunOutputForChat(raw: string): string {
  return raw
    .replace(/^---\s*stdout\s*---\s*/gim, '')
    .replace(/^---\s*stderr\s*---\s*/gim, '')
    .replace(/\n---\s*stdout\s*---\s*/gim, '\n')
    .replace(/\n---\s*stderr\s*---\s*/gim, '\n')
    .trim();
}

export function formatRunUserSummary(commandKey: string, target: string, model?: string): string {
  const cmd = BLOG_COMMANDS.find((c) => c.key === commandKey);
  const label = cmd?.label ?? commandKey;
  const t = target.trim();
  const tail = t ? ` — ${t}` : '';
  const m = model && model !== 'haiku' ? ` · ${model}` : '';
  return `${label}${tail}${m}`;
}

export function loadDashboardChatHistory(): DashboardChatTurn[] {
  try {
    const raw = localStorage.getItem(DASHBOARD_CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is DashboardChatTurn =>
        x &&
        typeof x === 'object' &&
        typeof (x as DashboardChatTurn).id === 'string' &&
        typeof (x as DashboardChatTurn).user === 'string' &&
        typeof (x as DashboardChatTurn).assistant === 'string'
    );
  } catch {
    return [];
  }
}

export function appendDashboardChatTurn(user: string, assistant: string): void {
  const list = loadDashboardChatHistory();
  const body = sanitizeRunOutputForChat(assistant);
  list.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    user: user.trim(),
    assistant: body,
    at: Date.now()
  });
  while (list.length > MAX_TURNS) {
    list.shift();
  }
  try {
    localStorage.setItem(DASHBOARD_CHAT_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode */
  }
}

export function clearDashboardChatHistory(): void {
  try {
    localStorage.removeItem(DASHBOARD_CHAT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
