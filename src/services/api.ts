import type { AccountStatusInfo, GroupedHistory, ModelOption, RunResponse, UsageInfo } from '../types';

const apiBase = () => (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';

const DEFAULT_CLIENT_TIMEOUT_MS = 1_800_000;
const MIN_CLIENT_TIMEOUT_MS = 1_000;

function runTimeoutMs(): number {
  const raw = import.meta.env.VITE_RUN_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_CLIENT_TIMEOUT_MS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_CLIENT_TIMEOUT_MS) return DEFAULT_CLIENT_TIMEOUT_MS;
  return n;
}

/** Browser abort for GET /api/usage (server runs one Claude child). */
const DEFAULT_USAGE_FETCH_TIMEOUT_MS = 360_000;

function usageFetchTimeoutMs(): number {
  const raw = import.meta.env.VITE_USAGE_FETCH_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_USAGE_FETCH_TIMEOUT_MS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 15_000) return DEFAULT_USAGE_FETCH_TIMEOUT_MS;
  return n;
}

function useRunStream(): boolean {
  return import.meta.env.VITE_RUN_STREAM !== '0';
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
}

function parseSseDataBlocks(buffer: string): { rest: string; events: unknown[] } {
  const events: unknown[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf('\n\n')) >= 0) {
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const dataLines = raw
      .split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n');
    try {
      events.push(JSON.parse(payload));
    } catch {
      /* incomplete or non-JSON — leave in rest by not consuming? Too late. Skip. */
    }
  }
  return { rest, events };
}

async function consumeRunStream(
  body: Record<string, unknown>,
  onChunk: (channel: 'stdout' | 'stderr', text: string) => void
): Promise<RunResponse> {
  const ms = runTimeoutMs();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/run/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted =
      (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
      (e instanceof Error && e.name === 'AbortError');
    if (aborted) {
      const min = Math.round(ms / 60000);
      throw new Error(
        `Request timed out after ${min} minute(s). The API may still be running Claude — check the server terminal. Increase VITE_RUN_TIMEOUT_MS if needed.`
      );
    }
    throw e;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Request failed (${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('No response body (streaming not supported?)');
  }

  const dec = new TextDecoder();
  let buf = '';
  let final: RunResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const { events, rest } = parseSseDataBlocks(buf);
    buf = rest;
    for (const ev of events) {
      const o = ev as { type?: string; chunk?: string; result?: RunResponse; message?: string };
      if (o.type === 'stdout' && typeof o.chunk === 'string') onChunk('stdout', o.chunk);
      else if (o.type === 'stderr' && typeof o.chunk === 'string') onChunk('stderr', o.chunk);
      else if (o.type === 'error') throw new Error(o.message || 'Stream error');
      else if (o.type === 'done' && o.result) final = o.result;
    }
  }
  buf += dec.decode();
  const tail = parseSseDataBlocks(buf.endsWith('\n\n') ? buf : buf + '\n\n');
  for (const ev of tail.events) {
    const o = ev as { type?: string; chunk?: string; result?: RunResponse; message?: string };
    if (o.type === 'stdout' && typeof o.chunk === 'string') onChunk('stdout', o.chunk);
    else if (o.type === 'stderr' && typeof o.chunk === 'string') onChunk('stderr', o.chunk);
    else if (o.type === 'error') throw new Error(o.message || 'Stream error');
    else if (o.type === 'done' && o.result) final = o.result;
  }

  if (!final) {
    throw new Error('Stream ended without a final result (check API logs).');
  }
  return final;
}

export const apiService = {
  async runBlogCommand(
    commandKey: string,
    target: string,
    model?: string,
    onStreamChunk?: (channel: 'stdout' | 'stderr', text: string) => void
  ): Promise<RunResponse> {
    const payload = { commandKey, target, model: model || 'haiku' };

    if (useRunStream()) {
      return consumeRunStream(payload, (ch, text) => {
        onStreamChunk?.(ch, text);
      });
    }

    const ms = runTimeoutMs();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    let res: Response;
    try {
      res = await fetch(`${apiBase()}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted =
        (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError');
      if (aborted) {
        const min = Math.round(ms / 60000);
        throw new Error(
          `Request timed out after ${min} minute(s). The API may still be running Claude in the background — check the server terminal. To wait longer, set VITE_RUN_TIMEOUT_MS in .env (e.g. 3600000 for 60 minutes).`
        );
      }
      throw e;
    }
    clearTimeout(timer);
    const data = await parseJson<RunResponse>(res);
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  },

  async getHistory(): Promise<GroupedHistory[]> {
    const res = await fetch(`${apiBase()}/api/history`);
    if (!res.ok) {
      throw new Error(`History request failed (${res.status})`);
    }
    return parseJson<GroupedHistory[]>(res);
  },

  async getModels(): Promise<ModelOption[]> {
    const res = await fetch(`${apiBase()}/api/models`);
    if (!res.ok) {
      throw new Error(`Models request failed (${res.status})`);
    }
    const body = await parseJson<{ models: ModelOption[] }>(res);
    return body.models;
  },

  async getUsageInfo(): Promise<UsageInfo> {
    const ms = usageFetchTimeoutMs();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    let res: Response;
    try {
      res = await fetch(`${apiBase()}/api/usage`, { signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      const aborted =
        (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError');
      if (aborted) {
        const min = Math.round(ms / 60000);
        throw new Error(
          `Usage request timed out after ${min} minute(s). Raise CLAUDE_USAGE_TIMEOUT_MS on the server and VITE_USAGE_FETCH_TIMEOUT_MS in the client (keep the client value higher than the server timeout).`
        );
      }
      throw e;
    }
    clearTimeout(timer);
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `Usage request failed (${res.status})`);
    }
    return parseJson<UsageInfo>(res);
  },

  async getAccountStatus(): Promise<AccountStatusInfo> {
    const ms = usageFetchTimeoutMs();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    let res: Response;
    try {
      res = await fetch(`${apiBase()}/api/account`, { signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      const aborted =
        (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError');
      if (aborted) {
        const min = Math.round(ms / 60000);
        throw new Error(
          `Account status request timed out after ${min} minute(s). Raise CLAUDE_USAGE_TIMEOUT_MS on the server and VITE_USAGE_FETCH_TIMEOUT_MS in the client.`
        );
      }
      throw e;
    }
    clearTimeout(timer);
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || `Account request failed (${res.status})`);
    }
    return parseJson<AccountStatusInfo>(res);
  },

  async postUsageExec(line: string): Promise<UsageInfo> {
    const ms = usageFetchTimeoutMs();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    let res: Response;
    try {
      res = await fetch(`${apiBase()}/api/usage/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line }),
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted =
        (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError');
      if (aborted) {
        const min = Math.round(ms / 60000);
        throw new Error(
          `Usage exec timed out after ${min} minute(s). Raise CLAUDE_USAGE_TIMEOUT_MS and VITE_USAGE_FETCH_TIMEOUT_MS.`
        );
      }
      throw e;
    }
    clearTimeout(timer);
    const data = await parseJson<UsageInfo & { error?: string }>(res);
    if (!res.ok) {
      throw new Error(data.error || `Usage exec failed (${res.status})`);
    }
    return data;
  },

  async getSystemStatus() {
    const res = await fetch(`${apiBase()}/api/health`);
    if (!res.ok) {
      throw new Error(`Health request failed (${res.status})`);
    }
    return parseJson(res);
  },

  async getUsageStats() {
    const info = await this.getUsageInfo();
    return {
      totalRuns: 0,
      avgDuration: '—',
      todayRuns: 0,
      lastRun: '—',
      tokensUsed: '—',
      costRaw: '',
      statusRaw: info.output || ''
    };
  }
};
