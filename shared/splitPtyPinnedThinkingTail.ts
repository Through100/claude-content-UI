/**
 * When Pretty pins the live choice menu, peel the in-flight “tool / subagent” stream off the `__pre` chunk so
 * it can render at the bottom (Web Search lines, +N more tool uses, * Foobaring…, etc.).
 */

function isThinkingActivityStartLine(line: string): boolean {
  const t = (line ?? '').replace(/\r/g, '').trim();
  if (!t) return false;
  if (/^\s*●\s+.+\(/u.test(t) && t.length < 420) return true;
  if (
    /^\s*●\s+[A-Za-z]{4,40}ing\b/i.test(t) &&
    t.length < 420 &&
    (/\b\d+\s*tokens?\b/i.test(t) || /\(\s*\d+[smh]/i.test(t))
  ) {
    return true;
  }
  if (/^\s*Web Search\(/i.test(t)) return true;
  if (/^\s*WebFetch\(/i.test(t)) return true;
  if (/^\s*⎿\s*Fetch\b/i.test(t)) return true;
  if (/^\s*⎿\s*Bash\b/i.test(t)) return true;
  if (/^\s*⎿\s*Read\b/i.test(t)) return true;
  if (/^\s*⎿\s*Glob\b/i.test(t)) return true;
  if (/^\s*⎿\s*Grep\b/i.test(t)) return true;
  if (/^\s*⎿\s*Write\b/i.test(t)) return true;
  if (/^\s*⎿\s*Edit\b/i.test(t)) return true;
  if (/^\s*⎿\s*NotebookEdit\b/i.test(t)) return true;
  if (/^\s*⎿\s*TodoWrite\b/i.test(t)) return true;
  if (/^\s*⎿\s*Task\b/i.test(t)) return true;
  if (/^\s*⎿\s*SlashCommand\b/i.test(t)) return true;
  if (/^\s*⎿\s*Mcp\b/i.test(t)) return true;
  if (/^\s*⎿\s*Agent\b/i.test(t)) return true;
  if (/^\s*⎿\s*ListMcpResources\b/i.test(t)) return true;
  if (/^\s*⎿\s*ReadMcpResource\b/i.test(t)) return true;
  if (/^\s*⎿\s*KillShell\b/i.test(t)) return true;
  if (/^\s*⎿\s*ExitPlanMode\b/i.test(t)) return true;
  if (/^\s*⎿\s*AskUserQuestion\b/i.test(t)) return true;
  /**
   * Lowercase `foo(` tool lines — exclude Python / shell builtins so a heredoc body starting with
   * `print(` does not peel the whole script (and the permission menu) into the hidden “Terminal activity” tail.
   */
  if (
    /^\s*[a-z0-9_-]{2,40}\(/i.test(t) &&
    !/^\s*(?:print|len|str|int|float|bool|list|dict|set|tuple|range|enumerate|open|input|exec|eval|compile|super|type|isinstance|hasattr|getattr|setattr|vars|id|hash|iter|next|abs|all|any|bin|chr|hex|oct|ord|pow|round|sum|sorted|repr|format|min|max|delattr|callable)\s*\(/i.test(
      t
    )
  ) {
    return true;
  }
  if (/^\s*Fetching[….]?\s*$/i.test(t)) return true;
  if (/^\+\d+\s+more\s+tool\s+uses\b/i.test(t)) return true;
  if (/\bctrl\+o\s+to\s+expand\b/i.test(t)) return true;
  if (/\bctrl\+b\s+to\s+run\s+in\s+background\b/i.test(t)) return true;
  return false;
}

/**
 * Split `__pre` assistant text into stable head (stays in thread order) and a tail that should render in the
 * pinned “activity” well. If no recognizable tool stream start, returns `{ head: raw, tail: '' }`.
 */
export function splitPinnedAssistantStreamHeadTail(raw: string): { head: string; tail: string } {
  const lines = (raw ?? '').replace(/\r\n/g, '\n').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isThinkingActivityStartLine(lines[i] ?? '')) {
      start = i;
      break;
    }
  }
  if (start < 0) return { head: raw, tail: '' };
  const head = lines.slice(0, start).join('\n').trimEnd();
  const tail = lines.slice(start).join('\n').trimEnd();
  return { head, tail };
}
