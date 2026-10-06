import assert from 'node:assert/strict';
import { RUN_MODELS, OLLAMA_MODELS, DEFAULT_CLAUDE_MODEL, DEFAULT_OLLAMA_MODEL, normalizeRunModel, ollamaApiModelId } from '../shared/modelCatalog';
import { isOllamaHeadlessModel } from '../server/ollamaEnsure';
import { spawnClaudeChild, buildInteractiveClaudeCommand } from '../server/claudeRunner';

assert.equal(new Set(RUN_MODELS.map((model) => model.id)).size, RUN_MODELS.length);
for (const model of OLLAMA_MODELS) {
  assert.ok(isOllamaHeadlessModel(model.id), `Cloud picker choice must use Ollama routing: ${model.id}`);
}
assert.ok(!isOllamaHeadlessModel(DEFAULT_CLAUDE_MODEL));
for (const retired of ['qwen3.5:397b-cloud', 'gemini-3-flash-preview:cloud']) {
  assert.ok(!RUN_MODELS.some((model) => model.id === retired));
  const replacement = normalizeRunModel(retired, DEFAULT_OLLAMA_MODEL);
  assert.ok(RUN_MODELS.some((model) => model.id === replacement));
  assert.ok(isOllamaHeadlessModel(replacement));
}
for (const [old, current] of [
  ['claude-fable-5', DEFAULT_CLAUDE_MODEL],
  ['deepseek-v4-pro:cloud', DEFAULT_OLLAMA_MODEL],
  ['glm-5.2:cloud', 'glm-5.3:cloud'],
]) {
  assert.equal(normalizeRunModel(old, DEFAULT_CLAUDE_MODEL), current);
}
assert.equal(normalizeRunModel('default', DEFAULT_CLAUDE_MODEL), 'default');
assert.equal(normalizeRunModel(' custom-account-model ', DEFAULT_CLAUDE_MODEL), 'custom-account-model');
assert.equal(ollamaApiModelId(DEFAULT_OLLAMA_MODEL), 'deepseek-v4-pro:0813');
assert.equal(ollamaApiModelId('gemma4:31b-cloud'), 'gemma4:31b');
assert.equal(ollamaApiModelId('glm-5.3-flash:cloud'), 'glm-5.3-flash');
assert.equal(ollamaApiModelId('gpt-oss:120b-cloud'), 'gpt-oss:120b');
assert.equal(ollamaApiModelId('qwen3.5:397b-cloud'), 'kimi-k3');

// Exercise real runner argument construction using Node as a harmless stand-in
// for both binaries. No provider request or workspace output is created.
const savedEnv = { ...process.env };
try {
  process.env.CLAUDE_HEADLESS_NO_SCRIPT_PTY = '1';
  process.env.OLLAMA_BIN = process.execPath;
  for (const directApi of [true, false]) {
    process.env.CLAUDE_OLLAMA_API_KEY_MODE = directApi ? '1' : '0';
    process.env.OLLAMA_API_KEY = 'runtime-test-placeholder';
    for (const model of [DEFAULT_OLLAMA_MODEL, 'gemma4:31b-cloud', 'glm-5.3-flash:cloud']) {
      const { child, argv } = spawnClaudeChild({
        prompt: 'Runtime routing test', cwd: process.cwd(), model,
        claudeBin: process.execPath, bare: true,
      });
      child.stdout?.resume();
      child.stderr?.resume();
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', () => resolve());
      });
      if (!directApi) assert.equal(argv[1], 'launch');
      assert.equal(argv[argv.indexOf('--model') + 1], directApi ? ollamaApiModelId(model) : model);
      const interactive = buildInteractiveClaudeCommand(process.execPath, model,
        ['--permission-mode', 'bypassPermissions'], { ANTHROPIC_API_KEY: 'account-test-placeholder' });
      assert.equal(interactive.args[interactive.args.indexOf('--model') + 1], directApi ? ollamaApiModelId(model) : model);
      assert.ok(interactive.args.includes('bypassPermissions'));
      if (directApi) {
        assert.equal(interactive.env.ANTHROPIC_AUTH_TOKEN, 'runtime-test-placeholder');
        assert.equal(interactive.env.ANTHROPIC_API_KEY, undefined);
        assert.equal(interactive.env.ANTHROPIC_BASE_URL, 'https://ollama.com');
      } else {
        assert.equal(interactive.args[0], 'launch');
        assert.equal(interactive.env.ANTHROPIC_API_KEY, 'account-test-placeholder');
      }
    }
  }
} finally {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}
const accountDefault = buildInteractiveClaudeCommand('claude', 'default', [], { ANTHROPIC_API_KEY: 'account-test-placeholder' });
assert.ok(!accountDefault.args.includes('--model'));
assert.equal(accountDefault.env.ANTHROPIC_API_KEY, 'account-test-placeholder');
const claudeInteractive = buildInteractiveClaudeCommand('claude', DEFAULT_CLAUDE_MODEL, [], {});
assert.deepEqual(claudeInteractive.args, ['--model', DEFAULT_CLAUDE_MODEL]);
import { BLOG_COMMANDS, buildBlogPrompt, formatWorkspaceRunDirSegment } from '../src/types';
const oldKeys = ['write','rewrite','update','style','outline','brief','analyze','analyze-rubric','analyze-cognitive-load','factcheck','decay','geo','seo-check','calendar','strategy','site-health','cannibalization','cluster','schema','repurpose','image','audio','persona','taxonomy','brand','discourse','notebooklm','google','multilingual','translate','localize','locale-audit','flow'];
for (const key of oldKeys) assert.ok(BLOG_COMMANDS.some((command) => command.key === key), `Existing command removed: ${key}`);
const write = BLOG_COMMANDS.find((command) => command.key === 'write')!;
const first = formatWorkspaceRunDirSegment('write', 'A topic', 'run-one');
const second = formatWorkspaceRunDirSegment('write', 'A topic', 'run-two');
assert.notEqual(first, second);
const prompt = buildBlogPrompt(write, 'A topic', { runToken: 'run-one' });
assert.ok(prompt.includes(`workspace-files/${first}/`));
assert.ok(prompt.includes('do not overwrite or edit it'));
const geo = BLOG_COMMANDS.find((command) => command.key === 'geo')!;
assert.ok(buildBlogPrompt(geo, 'https://example.com/blog', { runToken: 'run-one' }).includes('https://example.com/llms.txt'));
const calendar = BLOG_COMMANDS.find((command) => command.key === 'calendar')!;
assert.equal(buildBlogPrompt(calendar, ''), '/blog calendar');
console.log(`Runtime checks passed: ${RUN_MODELS.length} models, ${BLOG_COMMANDS.length} commands; history output isolation retained.`);
