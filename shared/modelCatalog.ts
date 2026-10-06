/** Reviewed against official Claude documentation and Ollama's live catalog. */
export const MODEL_CATALOG_REVIEWED_AT = '2026-10-06';
export const DEFAULT_CLAUDE_MODEL = 'claude-fable-5-1';
export const DEFAULT_OLLAMA_MODEL = 'deepseek-v4-pro:0813-cloud';
export const REPORT_VALIDATION_MODEL = 'kimi-k3:cloud';
export const REPORT_ARBITER_MODEL = 'glm-5.3:cloud';

interface RunModelOption {
  id: string;
  label: string;
  description?: string;
}

export const OLLAMA_MODELS: RunModelOption[] = [
  { id: DEFAULT_OLLAMA_MODEL, label: 'DeepSeek V4 Pro 0813 (Ollama cloud)', description: 'Updated Pro model for detailed research' },
  { id: 'deepseek-v4.1-flash:cloud', label: 'DeepSeek V4.1 Flash (Ollama cloud)', description: 'Fast research and tool use' },
  { id: 'glm-5.3:cloud', label: 'GLM 5.3 (Ollama cloud)', description: 'Complex reasoning and agent tasks' },
  { id: 'glm-5.3-flash:cloud', label: 'GLM 5.3 Flash (Ollama cloud)', description: 'Fast, economical agent tasks' },
  { id: 'minimax-m3:cloud', label: 'MiniMax M3 (Ollama cloud)', description: 'Coding and tool use' },
  { id: 'kimi-k3:cloud', label: 'Kimi K3 (Ollama cloud)', description: 'Research and long tasks' },
  { id: 'nemotron-3-ultra:cloud', label: 'Nemotron 3 Ultra (Ollama cloud)', description: 'Large agent workloads' },
  { id: 'nemotron-3-super:cloud', label: 'Nemotron 3 Super (Ollama cloud)', description: 'Efficient reasoning and tool use' },
  { id: 'gemma4:31b-cloud', label: 'Gemma 4 31B (Ollama cloud)', description: 'General analysis and tool use' },
  { id: 'gpt-oss:120b-cloud', label: 'gpt-oss 120B (Ollama cloud)', description: 'OpenAI open-weight reasoning model' },
];

export const RUN_MODELS: RunModelOption[] = [
  { id: DEFAULT_CLAUDE_MODEL, label: 'Claude Fable 5.1', description: 'Demanding research and long tasks' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: 'Complex coding and knowledge work' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', description: 'Balanced speed and capability' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Fast, efficient tasks' },
  { id: 'default', label: 'Account default', description: 'Use the account model setting' },
  ...OLLAMA_MODELS,
];

/** Preserve saved choices and old clients while moving retired models to available replacements. */
const MODEL_REPLACEMENTS: Record<string, string> = {
  best: DEFAULT_CLAUDE_MODEL,
  'claude-fable-5': DEFAULT_CLAUDE_MODEL,
  opus: 'claude-opus-5-5',
  'opus[1m]': 'claude-opus-5-5',
  'claude-opus-5': 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  'sonnet[1m]': 'claude-sonnet-5-5',
  'claude-sonnet-5': 'claude-sonnet-5-5',
  haiku: 'claude-haiku-4-5',
  'deepseek-v4-pro:cloud': DEFAULT_OLLAMA_MODEL,
  'glm-5.2:cloud': 'glm-5.3:cloud',
  'kimi-k2.5:cloud': 'kimi-k3:cloud',
  'kimi-k2.7-code:cloud': 'kimi-k3:cloud',
  'gemma4:cloud': 'gemma4:31b-cloud',
  'qwen3.5:397b-cloud': REPORT_VALIDATION_MODEL,
  'gemini-3-flash-preview:cloud': 'deepseek-v4.1-flash:cloud',
};

export function normalizeRunModel(model: string | undefined, fallback: string): string {
  const candidate = model?.trim() || fallback;
  return MODEL_REPLACEMENTS[candidate] ?? candidate;
}

/** The direct cloud API uses catalog names; :cloud / -cloud belong to the local CLI. */
export function ollamaApiModelId(model: string): string {
  return normalizeRunModel(model, DEFAULT_OLLAMA_MODEL).replace(/(?::cloud|-cloud)$/, '');
}

export const OLLAMA_MODEL_IDS = [
  ...OLLAMA_MODELS.map((model) => model.id),
  ...Object.keys(MODEL_REPLACEMENTS).filter((id) => id.includes(':')),
];
