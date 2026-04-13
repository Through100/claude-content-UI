import type { GroupedHistory, ModelOption, RunResponse, UsageInfo } from '../types';

const apiBase = () => (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
}

export const apiService = {
  async runSeoCommand(commandKey: string, target: string, model?: string): Promise<RunResponse> {
    const res = await fetch(`${apiBase()}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandKey, target, model: model || 'default' })
    });
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
    const res = await fetch(`${apiBase()}/api/usage`);
    if (!res.ok) {
      throw new Error(`Usage request failed (${res.status})`);
    }
    return parseJson<UsageInfo>(res);
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
      usageRaw: info.terminals?.usage ?? '',
      statsRaw: info.terminals?.stats ?? ''
    };
  }
};
