/** Local Ollama lifecycle for dashboard runs using Ollama cloud models. */
import http from 'node:http';
import { spawn } from 'node:child_process';

/** Keep in sync with the Ollama entries in the API and dashboard model lists. */
export const OLLAMA_HEADLESS_MODELS = [
  'deepseek-v4-pro:cloud',
  'minimax-m3:cloud',
  'kimi-k3:cloud',
  'glm-5.2:cloud',
  'nemotron-3-super:cloud',
  'gemma4:cloud',
  'qwen3.5:397b-cloud',
  'gemini-3-flash-preview:cloud',
  'gpt-oss:120b-cloud'
] as const;

const OLLAMA_HEADLESS_SET = new Set<string>(OLLAMA_HEADLESS_MODELS);

export function isOllamaHeadlessModel(model?: string): boolean {
  return model !== undefined && OLLAMA_HEADLESS_SET.has(model);
}

export function ollamaBin(): string {
  return process.env.OLLAMA_BIN?.trim() || 'ollama';
}

function serveMaxWaitMs(): number {
  const raw = process.env.OLLAMA_SERVE_MAX_WAIT_MS;
  if (raw === undefined || raw === '') return 30_000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1000 ? n : 30_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function probeOllamaListening(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/tags',
        timeout: 2500,
        headers: { Connection: 'close' }
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

let ollamaServeSpawnAttempted = false;

/** Start Ollama once when it is not already managed by the container entrypoint. */
export async function ensureOllamaServeForDashboard(): Promise<void> {
  if (await probeOllamaListening()) return;

  if (!ollamaServeSpawnAttempted) {
    ollamaServeSpawnAttempted = true;
    try {
      const child = spawn(ollamaBin(), ['serve'], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env }
      });
      child.unref();
    } catch (error) {
      console.warn('[claude-content-ui] ollama serve spawn failed:', error);
    }
  }

  const waitMs = serveMaxWaitMs();
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (await probeOllamaListening()) return;
    await sleep(400);
  }

  throw new Error(
    `Ollama did not become reachable at http://127.0.0.1:11434 within ${waitMs}ms. Start ollama manually or set OLLAMA_SERVE_MAX_WAIT_MS.`
  );
}
