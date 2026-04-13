import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GroupedHistory, HistoryItem } from '../src/types';

const defaultPath = () => process.env.HISTORY_PATH || 'data/history.json';

async function ensureDir(path: string) {
  await mkdir(dirname(path), { recursive: true });
}

export async function loadHistory(): Promise<HistoryItem[]> {
  const path = defaultPath();
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as HistoryItem[];
  } catch {
    return [];
  }
}

export async function appendHistoryItem(item: HistoryItem): Promise<void> {
  const path = defaultPath();
  await ensureDir(path);
  const existing = await loadHistory();
  existing.unshift(item);
  const max = parseInt(process.env.HISTORY_MAX_ITEMS || '500', 10);
  const trimmed = existing.slice(0, Number.isFinite(max) ? max : 500);
  await writeFile(path, JSON.stringify(trimmed, null, 2), 'utf8');
}

export function groupHistory(items: HistoryItem[]): GroupedHistory[] {
  const groups: Record<string, HistoryItem[]> = {};
  for (const item of items) {
    const key = item.target;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return Object.entries(groups)
    .map(([target, groupItems]) => {
      const sorted = [...groupItems].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return {
        target,
        items: sorted,
        latestTimestamp: sorted[0]?.timestamp || ''
      };
    })
    .sort((a, b) => new Date(b.latestTimestamp).getTime() - new Date(a.latestTimestamp).getTime());
}
