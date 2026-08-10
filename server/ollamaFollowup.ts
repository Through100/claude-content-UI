export function ollamaHeadlessFollowupEnabled(): boolean {
  const value = (process.env.CLAUDE_OLLAMA_HEADLESS_FOLLOWUP ?? '1').toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(value);
}

function needsSkillDispatchFollowup(stdout: string): boolean {
  const text = stdout.trim();
  if (!text || text.length > 120_000) return false;
  if (!/"tool"\s*:\s*"Skill"/.test(text)) return false;
  return !(text.length > 12_000 && /\n##\s+\S/.test(text));
}

function needsPlanningStubFollowup(stdout: string): boolean {
  const text = stdout.trim();
  if (text.length < 80 || text.length > 48_000) return false;
  if (/\n##\s+\S/.test(text)) return false;
  if (/workspace-files\/[^\s"')]+\.(md|html|txt|json|csv)/i.test(text)) return false;

  const echoedCommand = /<command-name>/i.test(text) || /<command-args>/i.test(text);
  const delegationOnly = /\bI will perform\b/i.test(text) && /\b(subagents?|delegat(?:e|ing))\b/i.test(text);
  return echoedCommand || delegationOnly;
}

export function needsOllamaHeadlessFollowup(stdout: string): boolean {
  return needsSkillDispatchFollowup(stdout) || needsPlanningStubFollowup(stdout);
}

export function buildOllamaFollowupPrompt(originalPrompt: string): string {
  return `${originalPrompt}\n\n[Headless follow-up] The previous response only planned, routed to a Skill, or echoed the command. Execute the requested blog workflow fully in this workspace, write every deliverable under the requested workspace path, and include the substantive result in your output. Do not stop at an outline, delegation promise, or command echo.`;
}

export function mergeOllamaFollowupResults(
  first: {
    stdout: string;
    stderr: string;
    code: number | null;
    signal: NodeJS.Signals | null;
    argv: string[];
  },
  second: typeof first
): typeof first {
  const banner = '\n\n--- claude-content-ui: Ollama headless follow-up pass ---\n\n';
  return {
    stdout: first.stdout + banner + second.stdout,
    stderr: [first.stderr, second.stderr].filter(Boolean).join('\n'),
    code:
      second.code !== null && second.code !== 0
        ? second.code
        : first.code !== null && first.code !== 0
          ? first.code
          : second.code,
    signal: second.signal ?? first.signal,
    argv: second.argv
  };
}
