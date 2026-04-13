import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_JSON_CHARS = 48_000;
const MAX_FILE_BYTES = 512_000;

const LOCAL_HEADER = `LOCAL_USAGE_JSON — read by the API server from this machine's Claude user config (not by the headless agent). Use these values for the five Usage-tab lines when they contain real numbers or reset times. Do not say the file was not found when this block is present.

`;

/**
 * Directories to check for usage-exact.json (interactive Claude Code / statusline caches).
 * Override with CLAUDE_CONFIG_DIR to match Docker or a non-default home.
 */
export function claudeUserConfigDirs(): string[] {
  const env = process.env.CLAUDE_CONFIG_DIR?.trim();
  const home = os.homedir();
  const dirs = [...(env ? [env] : []), path.join(home, '.claude'), path.join(home, '.config', 'claude')];
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

function stringifyForPrompt(value: unknown): string {
  const pretty = JSON.stringify(value, null, 2);
  if (pretty.length <= MAX_JSON_CHARS) return pretty;
  const mini = JSON.stringify(value);
  if (mini.length <= MAX_JSON_CHARS) return mini;
  return `${mini.slice(0, MAX_JSON_CHARS - 48)}\n/* …truncated … */`;
}

/** Return parsed JSON string for prompt injection, or null if missing/unreadable. */
export function tryReadUsageExactJsonForProbe(): string | null {
  const fileName = 'usage-exact.json';
  for (const dir of claudeUserConfigDirs()) {
    const full = path.join(dir, fileName);
    try {
      const st = fs.statSync(full);
      if (!st.isFile() || st.size === 0 || st.size > MAX_FILE_BYTES) continue;
      const raw = fs.readFileSync(full, 'utf8').trim();
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      return stringifyForPrompt(parsed);
    } catch {
      /* ENOENT, invalid JSON, etc. */
    }
  }
  return null;
}

export function augmentUsageTabsPromptWithLocalCache(basePrompt: string): string {
  const json = tryReadUsageExactJsonForProbe();
  if (!json) return basePrompt;
  return `${LOCAL_HEADER}\`\`\`json\n${json}\n\`\`\`\n\n${basePrompt}`;
}
