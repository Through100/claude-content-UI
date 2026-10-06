import { DEFAULT_CLAUDE_MODEL, normalizeRunModel } from './modelCatalog';

const KEY = 'claude-blog.pty-model.v1';

export function readPtyModelSelection(): string {
  try {
    return normalizeRunModel(sessionStorage.getItem(KEY) ?? undefined, DEFAULT_CLAUDE_MODEL);
  } catch {
    return DEFAULT_CLAUDE_MODEL;
  }
}

export function savePtyModelSelection(model: string): void {
  try {
    sessionStorage.setItem(KEY, model);
  } catch {
    // The current session still works when browser storage is unavailable.
  }
}
