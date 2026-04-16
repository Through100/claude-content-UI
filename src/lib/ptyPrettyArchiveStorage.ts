const KEY_PREFIX = 'claude-content-ui-pty-pretty-archive-v1';
const MAX_CHARS = 900_000;

export function ptyPrettyArchiveStorageKey(threadKey: string): string {
  return `${KEY_PREFIX}::${threadKey}`;
}

export function loadPtyPrettyArchive(threadKey: string): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(ptyPrettyArchiveStorageKey(threadKey)) ?? '';
  } catch {
    return '';
  }
}

export function savePtyPrettyArchive(threadKey: string, text: string): void {
  if (typeof localStorage === 'undefined' || !threadKey.trim()) return;
  try {
    const v = text.length > MAX_CHARS ? text.slice(-MAX_CHARS) : text;
    localStorage.setItem(ptyPrettyArchiveStorageKey(threadKey), v);
  } catch {
    /* quota / private mode */
  }
}
