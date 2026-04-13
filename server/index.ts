import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runClaudeInitOnly, runClaudePrint, runClaudeVersion } from './claudeRunner';
import { appendHistoryItem, groupHistory, loadHistory } from './historyStore';
import { parseCostOutput, parseContextOutput, parseStatusOutput } from './usageParse';
import { parseSeoOutput } from '../shared/parseSeoOutput';
import { SEO_COMMANDS, type HistoryItem, type RunResponse } from '../src/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function claudeBin(): string {
  return process.env.CLAUDE_BIN || 'claude';
}

function workdir(): string {
  const w = process.env.CLAUDE_WORKDIR || process.cwd();
  return path.resolve(w);
}

function runTimeoutMs(): number {
  const n = parseInt(process.env.CLAUDE_TIMEOUT_MS || '1800000', 10);
  return Number.isFinite(n) ? n : 1_800_000;
}

function usageTimeoutMs(): number {
  const n = parseInt(process.env.CLAUDE_USAGE_TIMEOUT_MS || '180000', 10);
  return Number.isFinite(n) ? n : 180_000;
}

const DEFAULT_MODELS = [
  { id: 'default', label: 'Default (recommended)', description: 'Clears override; tier default' },
  { id: 'sonnet', label: 'Sonnet', description: 'Latest Sonnet for daily work' },
  { id: 'sonnet[1m]', label: 'Sonnet (1M context)', description: 'Long context Sonnet' },
  { id: 'opus', label: 'Opus', description: 'Most capable default Opus' },
  { id: 'opus[1m]', label: 'Opus (1M context)', description: 'Long context Opus' },
  { id: 'haiku', label: 'Haiku', description: 'Fast, efficient' },
  { id: 'best', label: 'Best available', description: 'Alias for most capable (opus-class)' }
];

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    claudeBin: claudeBin(),
    workdir: workdir(),
    time: new Date().toISOString()
  });
});

app.get('/api/models', (_req, res) => {
  try {
    const raw = process.env.CLAUDE_MODELS_JSON;
    if (raw) {
      const parsed = JSON.parse(raw) as { id: string; label: string; description?: string }[];
      res.json({ models: parsed });
      return;
    }
  } catch {
    /* fall through */
  }
  res.json({ models: DEFAULT_MODELS });
});

app.get('/api/history', async (_req, res) => {
  try {
    const items = await loadHistory();
    res.json(groupHistory(items));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/usage', async (_req, res) => {
  const cwd = workdir();
  const bin = claudeBin();
  const t = usageTimeoutMs();
  const modelArg = process.env.CLAUDE_USAGE_MODEL;
  try {
    const [statusR, costR, contextR, usageR, statsR] = await Promise.all([
      runClaudePrint({ prompt: '/status', cwd, model: modelArg, timeoutMs: t, claudeBin: bin }),
      runClaudePrint({ prompt: '/cost', cwd, model: modelArg, timeoutMs: t, claudeBin: bin }),
      runClaudePrint({ prompt: '/context', cwd, model: modelArg, timeoutMs: t, claudeBin: bin }),
      runClaudePrint({ prompt: '/usage', cwd, model: modelArg, timeoutMs: t, claudeBin: bin }),
      runClaudePrint({ prompt: '/stats', cwd, model: modelArg, timeoutMs: t, claudeBin: bin })
    ]);

    const statusText = [statusR.stdout, statusR.stderr].filter(Boolean).join('\n');
    const costText = [costR.stdout, costR.stderr].filter(Boolean).join('\n');
    const contextText = [contextR.stdout, contextR.stderr].filter(Boolean).join('\n');
    const usageText = [usageR.stdout, usageR.stderr].filter(Boolean).join('\n');
    const statsText = [statsR.stdout, statsR.stderr].filter(Boolean).join('\n');

    res.json({
      status: parseStatusOutput(statusText),
      cost: parseCostOutput(costText),
      context: parseContextOutput(contextText),
      terminals: {
        status: statusText,
        cost: costText,
        context: contextText,
        usage: usageText,
        stats: statsText
      },
      exitCodes: {
        status: statusR.code,
        cost: costR.code,
        context: contextR.code,
        usage: usageR.code,
        stats: statsR.code
      }
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/run', async (req, res) => {
  const { commandKey, target, model } = req.body as {
    commandKey?: string;
    target?: string;
    model?: string;
  };
  if (!commandKey || typeof target !== 'string') {
    res.status(400).json({ error: 'commandKey and target are required' });
    return;
  }
  const cmd = SEO_COMMANDS.find(c => c.key === commandKey);
  if (!cmd) {
    res.status(400).json({ error: 'Unknown commandKey' });
    return;
  }

  const prompt = `${cmd.command} ${target.trim()}`.trim();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const cwd = workdir();

  try {
    const result = await runClaudePrint({
      prompt,
      cwd,
      model: typeof model === 'string' ? model : undefined,
      timeoutMs: runTimeoutMs(),
      claudeBin: claudeBin()
    });
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - t0;
    const rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const ok = result.code === 0;
    const parsedReport = parseSeoOutput(rawOutput);

    const body: RunResponse = {
      success: ok,
      commandExecuted: prompt,
      rawOutput,
      parsedReport,
      stats: { durationMs, startedAt, finishedAt },
      error: ok ? undefined : `claude exited ${result.code}${result.signal ? ` (${result.signal})` : ''}`.trim()
    };

    const item: HistoryItem = {
      id: randomUUID(),
      timestamp: startedAt,
      commandKey: cmd.key,
      commandLabel: cmd.label,
      target: target.trim(),
      status: ok ? 'success' : 'error',
      durationMs,
      rawOutput,
      parsedReport
    };
    await appendHistoryItem(item);

    res.json(body);
  } catch (e) {
    const durationMs = Date.now() - t0;
    const finishedAt = new Date().toISOString();
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({
      success: false,
      commandExecuted: prompt,
      rawOutput: message,
      stats: { durationMs, startedAt, finishedAt },
      error: message
    } satisfies RunResponse);
  }
});

const port = parseInt(process.env.PORT || '8787', 10);
const staticDir = path.resolve(rootDir, 'dist');

async function startupClaude(): Promise<void> {
  const bin = claudeBin();
  const cwd = workdir();
  console.log(`[claude-seo-ui] Claude binary: ${bin}`);
  console.log(`[claude-seo-ui] CLAUDE_WORKDIR: ${cwd}`);
  try {
    const v = await runClaudeVersion(bin);
    console.log(`[claude-seo-ui] claude -v:\n${v.stdout || v.stderr || '(no output)'}`);
  } catch (e) {
    console.warn('[claude-seo-ui] claude -v failed (is Claude Code installed on PATH?)', e);
  }
  if (process.env.CLAUDE_RUN_INIT_ONLY === '1') {
    try {
      const init = await runClaudeInitOnly(bin, cwd);
      console.log(
        `[claude-seo-ui] claude --init-only finished code=${init.code}\n${(init.stdout + init.stderr).slice(0, 2000)}`
      );
    } catch (e) {
      console.warn('[claude-seo-ui] claude --init-only failed', e);
    }
  }
}

app.use(express.static(staticDir));

app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(port, async () => {
  await startupClaude();
  console.log(`[claude-seo-ui] API + static listening on http://0.0.0.0:${port}`);
});
