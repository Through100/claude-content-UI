import { BLOG_COMMANDS } from '../types';

/** Legacy flat list (pre per-target threads). */
export const DASHBOARD_CHAT_STORAGE_KEY = 'claude-content-ui-dashboard-chat-v1';

/** Single JSON object: all headless conversation threads keyed by `formatChatThreadKey`. */
export const DASHBOARD_CHATS_STORE_KEY = 'claude-content-ui-dashboard-chats-v2';

/** Same-tab refresh: `storage` events do not fire in the tab that wrote localStorage. */
export const DASHBOARD_CHATS_CHANGED_EVENT = 'dashboard-chats-changed';

export type DashboardChatsChangedDetail = { threadKey?: string };

const MAX_TURNS_PER_THREAD = 50;
const MAX_THREAD_KEYS = 80;

export type DashboardChatTurn = {
  id: string;
  user: string;
  assistant: string;
  at: number;
};

type ChatsStoreV2 = {
  v: 2;
  threads: Record<string, DashboardChatTurn[]>;
};

function emptyStore(): ChatsStoreV2 {
  return { v: 2, threads: {} };
}

/** Stable id: same command + same target text (trimmed, spaces collapsed) = same thread. */
export function formatChatThreadKey(commandKey: string, target: string): string {
  const t = target.trim().replace(/\s+/g, ' ');
  return `${commandKey}::${t}`;
}

/** Human-readable target portion for UI labels. */
export function formatThreadKeyForDisplay(threadKey: string): string {
  const i = threadKey.indexOf('::');
  if (i < 0) return threadKey.trim() || '(no target)';
  const t = threadKey.slice(i + 2).trim();
  if (!t) return '(no target)';
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

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

function loadStore(): ChatsStoreV2 {
  try {
    const raw = localStorage.getItem(DASHBOARD_CHATS_STORE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as ChatsStoreV2).v === 2 &&
      typeof (parsed as ChatsStoreV2).threads === 'object' &&
      (parsed as ChatsStoreV2).threads !== null &&
      !Array.isArray((parsed as ChatsStoreV2).threads)
    ) {
      return { v: 2, threads: { ...(parsed as ChatsStoreV2).threads } };
    }
  } catch {
    /* ignore */
  }
  return emptyStore();
}

function saveStore(store: ChatsStoreV2): void {
  try {
    localStorage.setItem(DASHBOARD_CHATS_STORE_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode */
  }
}

export function dispatchDashboardChatsChanged(detail?: DashboardChatsChangedDetail): void {
  try {
    window.dispatchEvent(new CustomEvent(DASHBOARD_CHATS_CHANGED_EVENT, { detail }));
  } catch {
    /* ignore */
  }
}

let migratedLegacy = false;

/** One-time: move old flat array into a legacy thread so nothing is lost. */
function migrateLegacyFlatIfNeeded(): void {
  if (migratedLegacy) return;
  migratedLegacy = true;
  try {
    const store = loadStore();
    if (Object.keys(store.threads).length > 0) {
      localStorage.removeItem(DASHBOARD_CHAT_STORAGE_KEY);
      return;
    }
    const raw = localStorage.getItem(DASHBOARD_CHAT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    const list = parsed.filter(
      (x): x is DashboardChatTurn =>
        x &&
        typeof x === 'object' &&
        typeof (x as DashboardChatTurn).id === 'string' &&
        typeof (x as DashboardChatTurn).user === 'string' &&
        typeof (x as DashboardChatTurn).assistant === 'string'
    );
    if (list.length === 0) return;
    store.threads['legacy::imported-from-v1'] = list.slice(-MAX_TURNS_PER_THREAD);
    saveStore(store);
    localStorage.removeItem(DASHBOARD_CHAT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function pruneOldestThreads(store: ChatsStoreV2): void {
  const keys = Object.keys(store.threads);
  if (keys.length <= MAX_THREAD_KEYS) return;
  const scored = keys.map((k) => {
    const turns = store.threads[k] ?? [];
    const lastAt = turns.length ? Math.max(...turns.map((t) => t.at || 0)) : 0;
    return { k, lastAt };
  });
  scored.sort((a, b) => a.lastAt - b.lastAt);
  const drop = scored.slice(0, keys.length - MAX_THREAD_KEYS);
  for (const { k } of drop) {
    delete store.threads[k];
  }
}

export function loadDashboardChatHistory(threadKey: string): DashboardChatTurn[] {
  migrateLegacyFlatIfNeeded();
  const store = loadStore();
  const list = store.threads[threadKey];
  if (!Array.isArray(list)) return [];
  return list.filter(
    (x): x is DashboardChatTurn =>
      x &&
      typeof x === 'object' &&
      typeof x.id === 'string' &&
      typeof x.user === 'string' &&
      typeof x.assistant === 'string'
  );
}

export function appendDashboardChatTurn(user: string, assistant: string, threadKey: string): void {
  migrateLegacyFlatIfNeeded();
  const store = loadStore();
  const body = sanitizeRunOutputForChat(assistant);
  const list = [...(store.threads[threadKey] ?? [])];
  list.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    user: user.trim(),
    assistant: body,
    at: Date.now()
  });
  while (list.length > MAX_TURNS_PER_THREAD) {
    list.shift();
  }
  store.threads[threadKey] = list;
  pruneOldestThreads(store);
  saveStore(store);
  dispatchDashboardChatsChanged({ threadKey });
}

/**
 * Optimistically record the user turn before the run starts (assistant = '').
 * Returns the turn id so the caller can fill in the assistant response later.
 */
export function appendDashboardChatTurnPending(user: string, threadKey: string): string {
  migrateLegacyFlatIfNeeded();
  const store = loadStore();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const list = [...(store.threads[threadKey] ?? [])];
  list.push({ id, user: user.trim(), assistant: '', at: Date.now() });
  while (list.length > MAX_TURNS_PER_THREAD) {
    list.shift();
  }
  store.threads[threadKey] = list;
  pruneOldestThreads(store);
  saveStore(store);
  dispatchDashboardChatsChanged({ threadKey });
  return id;
}

/** Fill in the assistant text for a specific turn id (companion to appendDashboardChatTurnPending). */
export function updateDashboardChatTurnById(
  threadKey: string,
  id: string,
  assistant: string
): void {
  migrateLegacyFlatIfNeeded();
  const store = loadStore();
  const list = [...(store.threads[threadKey] ?? [])];
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], assistant: sanitizeRunOutputForChat(assistant), at: Date.now() };
  store.threads[threadKey] = list;
  saveStore(store);
  dispatchDashboardChatsChanged({ threadKey });
}

export function updateLastDashboardAssistant(threadKey: string, assistant: string): void {
  migrateLegacyFlatIfNeeded();
  const store = loadStore();
  const list = [...(store.threads[threadKey] ?? [])];
  if (list.length === 0) return;
  const body = sanitizeRunOutputForChat(assistant);
  list[list.length - 1] = {
    ...list[list.length - 1],
    assistant: body,
    at: Date.now()
  };
  store.threads[threadKey] = list;
  saveStore(store);
  dispatchDashboardChatsChanged({ threadKey });
}

/** Clear one thread, or the entire store when `threadKey` is omitted. */
export function clearDashboardChatHistory(threadKey?: string): void {
  try {
    if (threadKey === undefined) {
      localStorage.removeItem(DASHBOARD_CHATS_STORE_KEY);
      localStorage.removeItem(DASHBOARD_CHAT_STORAGE_KEY);
      dispatchDashboardChatsChanged({});
      return;
    }
    const store = loadStore();
    delete store.threads[threadKey];
    saveStore(store);
    dispatchDashboardChatsChanged({ threadKey });
  } catch {
    /* ignore */
  }
}
