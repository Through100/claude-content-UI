import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  runClaudeInitOnly,
  runClaudePrint,
  runClaudeVersion,
  spawnClaudeChild,
  type ClaudeRunResult
} from './claudeRunner';
import { appendHistoryItem, groupHistory, loadHistory } from './historyStore';
import { parseCostOutput, parseContextOutput, parseStatusOutput } from './usageParse';
import { parseSeoOutput } from '../shared/parseSeoOutput';
import { SEO_COMMANDS, type HistoryItem, type RunResponse, type SeoCommand } from '../src/types';

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

/** Echo full Claude stdout/stderr to the API process terminal (see npm run dev:server). */
function shouldLogClaudeRuns(): boolean {
  return process.env.CLAUDE_LOG_RUNS !== '0';
}

function logClaudeRun(meta: {
  prompt: string;
  cwd: string;
  argv: string[];
  durationMs: number;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}) {
  if (!shouldLogClaudeRuns()) return;
  const sep = '='.repeat(80);
  const lines = [
    '',
    sep,
    `[claude-seo-ui] POST /api/run — ${new Date().toISOString()}`,
    `prompt: ${meta.prompt}`,
    `cwd: ${meta.cwd}`,
    `duration_ms: ${meta.durationMs}`,
    `exit_code: ${meta.code ?? 'null'}  signal: ${meta.signal ?? ''}`,
    `argv: ${JSON.stringify(meta.argv)}`,
    sep,
    '--- stdout ---',
    meta.stdout.length ? meta.stdout : '(empty)',
    sep,
    '--- stderr ---',
    meta.stderr.length ? meta.stderr : '(empty)',
    sep,
    ''
  ];
  console.log(lines.join('\n'));
}

type ParsedRunRequest =
  | { ok: true; cmd: SeoCommand; prompt: string; targetTrimmed: string; model?: string }
  | { ok: false; error: string };

function parseRunRequest(body: unknown): ParsedRunRequest {
  if (!body || typeof body !== 'object') {
    return { ok: false as const, error: 'Invalid JSON body' };
  }
  const b = body as Record<string, unknown>;
  const commandKey = b.commandKey;
  const target = b.target;
  if (typeof commandKey !== 'string' || typeof target !== 'string') {
    return { ok: false as const, error: 'commandKey and target are required' };
  }
  const cmd = SEO_COMMANDS.find(c => c.key === commandKey);
  if (!cmd) return { ok: false as const, error: 'Unknown commandKey' };
  const prompt = `${cmd.command} ${target.trim()}`.trim();
  const model = typeof b.model === 'string' ? b.model : undefined;
  return { ok: true as const, cmd, prompt, targetTrimmed: target.trim(), model };
}

function buildRunBody(input: {
  result: ClaudeRunResult;
  prompt: string;
  cmd: SeoCommand;
  targetTrimmed: string;
  startedAt: string;
  t0: number;
  cwd: string;
}): { body: RunResponse; item: HistoryItem } {
  const { result, prompt, cmd, targetTrimmed, startedAt, t0, cwd } = input;
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;
  logClaudeRun({
    prompt,
    cwd,
    argv: result.argv,
    durationMs,
    code: result.code,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr
  });
  let rawOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const ok = result.code === 0;
  if (!ok && !rawOutput.trim()) {
    rawOutput = [
      '(Claude exited before any stdout/stderr was captured. If this persists, the process may be failing immediately — e.g. missing auth, wrong cwd, or claude not on PATH.)',
      '',
      '--- diagnostics ---',
      `exit code: ${result.code}`,
      result.signal ? `signal: ${result.signal}` : null,
      `cwd: ${cwd}`,
      `argv: ${JSON.stringify(result.argv)}`,
      `CLAUDE_BIN: ${claudeBin()}`,
      `ANTHROPIC_API_KEY set: ${process.env.ANTHROPIC_API_KEY ? 'yes' : 'no'}`,
      '',
      'Try the same argv in a shell from CLAUDE_WORKDIR to see the real error.'
    ]
      .filter(Boolean)
      .join('\n');
  }
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
    target: targetTrimmed,
    status: ok ? 'success' : 'error',
    durationMs,
    rawOutput,
    parsedReport
  };
  return { body, item };
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
    const [statusR, costR, contextR] = await Promise.all([
      runClaudePrint({ prompt: '/status', cwd, model: modelArg, timeoutMs: t, claudeBin: bin }),
      runClaudePrint({ prompt: '/cost', cwd, model: modelArg, timeoutMs: t, claudeBin: bin }),
      runClaudePrint({ prompt: '/context', cwd, model: modelArg, timeoutMs: t, claudeBin: bin })
    ]);

    const statusText = [statusR.stdout, statusR.stderr].filter(Boolean).join('\n');
    const costText = [costR.stdout, costR.stderr].filter(Boolean).join('\n');
    const contextText = [contextR.stdout, contextR.stderr].filter(Boolean).join('\n');

    res.json({
      status: parseStatusOutput(statusText),
      cost: parseCostOutput(costText),
      context: parseContextOutput(contextText),
      terminals: {
        status: statusText,
        cost: costText,
        context: contextText
      },
      exitCodes: {
        status: statusR.code,
        cost: costR.code,
        context: contextR.code
      }
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/run', async (req, res) => {
  const parsed = parseRunRequest(req.body);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { cmd, prompt, targetTrimmed, model } = parsed;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const cwd = workdir();

  try {
    const result = await runClaudePrint({
      prompt,
      cwd,
      model,
      timeoutMs: runTimeoutMs(),
      claudeBin: claudeBin()
    });
    const { body, item } = buildRunBody({
      result,
      prompt,
      cmd,
      targetTrimmed,
      startedAt,
      t0,
      cwd
    });
    await appendHistoryItem(item);
    res.json(body);
  } catch (e) {
    const durationMs = Date.now() - t0;
    const finishedAt = new Date().toISOString();
    const message = e instanceof Error ? e.message : String(e);
    console.error('[claude-seo-ui] POST /api/run spawn error:', message);
    res.status(500).json({
      success: false,
      commandExecuted: prompt,
      rawOutput: message,
      stats: { durationMs, startedAt, finishedAt },
      error: message
    } satisfies RunResponse);
  }
});

app.post('/api/run/stream', async (req, res) => {
  const parsed = parseRunRequest(req.body);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { cmd, prompt, targetTrimmed, model } = parsed;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const cwd = workdir();

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sse = (obj: unknown) => {
    if (res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch {
      /* client gone */
    }
  };

  const { child, argv } = spawnClaudeChild({
    prompt,
    cwd,
    model,
    claudeBin: claudeBin()
  });

  let stdout = '';
  let stderr = '';
  let timersCleaned = false;
  const cleanupTimers = () => {
    if (timersCleaned) return;
    timersCleaned = true;
    clearTimeout(runTimer);
    clearInterval(heartbeat);
  };

  const runTimer = setTimeout(() => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }, runTimeoutMs());

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        /* ignore */
      }
    }
  }, 15000);

  const killOnClient = () => {
    try {
      if (!child.killed) child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };
  req.on('close', killOnClient);
  req.on('aborted', killOnClient);

  child.stdout?.on('data', (c: Buffer) => {
    const t = c.toString('utf8');
    stdout += t;
    sse({ type: 'stdout', chunk: t });
  });
  child.stderr?.on('data', (c: Buffer) => {
    const t = c.toString('utf8');
    stderr += t;
    sse({ type: 'stderr', chunk: t });
  });

  child.once('error', err => {
    sse({ type: 'error', message: String(err) });
  });

  try {
    await once(child, 'close');
  } finally {
    cleanupTimers();
    req.off('close', killOnClient);
    req.off('aborted', killOnClient);
  }

  const result: ClaudeRunResult = {
    stdout,
    stderr,
    code: typeof child.exitCode === 'number' ? child.exitCode : null,
    signal: child.signalCode ?? null,
    argv
  };

  try {
    const { body, item } = buildRunBody({
      result,
      prompt,
      cmd,
      targetTrimmed,
      startedAt,
      t0,
      cwd
    });
    await appendHistoryItem(item);
    sse({ type: 'done', result: body });
  } catch (e) {
    sse({ type: 'error', message: String(e) });
  }
  res.end();
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
  if (shouldLogClaudeRuns()) {
    console.log(
      '[claude-seo-ui] Each POST /api/run will print full Claude stdout/stderr above (set CLAUDE_LOG_RUNS=0 to disable).'
    );
  }
});
