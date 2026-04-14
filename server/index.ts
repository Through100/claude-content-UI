import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import {
  formatClaudeSpawnError,
  logClaudeAutoPermissionPolicy,
  runClaudeInitOnly,
  runClaudePrint,
  runClaudeVersion,
  spawnClaudeChild,
  watchClaudeProcess,
  type ClaudeRunResult
} from './claudeRunner';
import { appendHistoryItem, groupHistory, loadHistory } from './historyStore';
import { parseSeoOutput } from '../shared/parseSeoOutput';
import { enrichUsagePanelWithLocalJsonWhenCliFails } from './usageLocalSnapshot';
import { runBashUsage, stripAnsiForWeb } from './usageShellProbe';
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

const DEFAULT_RUN_TIMEOUT_MS = 1_800_000;
const DEFAULT_USAGE_TIMEOUT_MS = 180_000;
/** Reject 0/NaN/tiny values — they schedule SIGTERM immediately and look like "broken" Claude runs. */
const MIN_TIMEOUT_MS = 1_000;

let warnedRunTimeout = false;
let warnedUsageTimeout = false;

function runTimeoutMs(): number {
  const raw = process.env.CLAUDE_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_RUN_TIMEOUT_MS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_TIMEOUT_MS) {
    if (!warnedRunTimeout) {
      warnedRunTimeout = true;
      console.warn(
        `[claude-seo-ui] CLAUDE_TIMEOUT_MS=${JSON.stringify(raw)} is invalid or <${MIN_TIMEOUT_MS}ms; using ${DEFAULT_RUN_TIMEOUT_MS}ms`
      );
    }
    return DEFAULT_RUN_TIMEOUT_MS;
  }
  return n;
}

function usageTimeoutMs(): number {
  const raw = process.env.CLAUDE_USAGE_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_USAGE_TIMEOUT_MS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_TIMEOUT_MS) {
    if (!warnedUsageTimeout) {
      warnedUsageTimeout = true;
      console.warn(
        `[claude-seo-ui] CLAUDE_USAGE_TIMEOUT_MS=${JSON.stringify(raw)} is invalid or <${MIN_TIMEOUT_MS}ms; using ${DEFAULT_USAGE_TIMEOUT_MS}ms`
      );
    }
    return DEFAULT_USAGE_TIMEOUT_MS;
  }
  return n;
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
  const rawModel = b.model;
  const model =
    typeof rawModel === 'string' && rawModel.trim() !== '' ? rawModel.trim() : 'haiku';
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
    const sigHint =
      result.signal === 'SIGTERM' && durationMs < 60_000
        ? `Very short run + SIGTERM often means the API timeout fired (see CLAUDE_TIMEOUT_MS; must be unset or an integer >= ${MIN_TIMEOUT_MS}ms, default ${DEFAULT_RUN_TIMEOUT_MS}ms).`
        : null;
    rawOutput = [
      '(Claude exited before any stdout/stderr was captured. If this persists, the process may be failing immediately — e.g. missing auth, wrong cwd, or claude not on PATH.)',
      '',
      '--- diagnostics ---',
      `exit code: ${result.code}`,
      result.signal ? `signal: ${result.signal}` : null,
      `duration_ms: ${durationMs}`,
      sigHint,
      `cwd: ${cwd}`,
      `argv: ${JSON.stringify(result.argv)}`,
      `CLAUDE_BIN: ${claudeBin()}`,
      `CLAUDE_TIMEOUT_MS effective: ${runTimeoutMs()}ms`,
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
  { id: 'haiku', label: 'Haiku', description: 'Fast, efficient — default in this UI' },
  { id: 'default', label: 'Account default', description: 'Clears override; tier default' },
  { id: 'sonnet', label: 'Sonnet', description: 'Latest Sonnet for daily work' },
  { id: 'sonnet[1m]', label: 'Sonnet (1M context)', description: 'Long context Sonnet' },
  { id: 'opus', label: 'Opus', description: 'Most capable default Opus' },
  { id: 'opus[1m]', label: 'Opus (1M context)', description: 'Long context Opus' },
  { id: 'best', label: 'Best available', description: 'Alias for most capable (opus-class)' }
];

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    claudeBin: claudeBin(),
    workdir: workdir(),
    runTimeoutMs: runTimeoutMs(),
    usageTimeoutMs: usageTimeoutMs(),
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
  try {
    const { output, exitCode, argv } = await runBashUsage({ claudeBin: bin, cwd, timeoutMs: t });
    res.json({
      line: '/usage',
      execMode: 'bash_quoted_usage',
      output: enrichUsagePanelWithLocalJsonWhenCliFails(output, { treatEmptyAsFailure: true }),
      exitCode,
      argv
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/usage/exec', async (req, res) => {
  const cwd = workdir();
  const bin = claudeBin();
  const t = usageTimeoutMs();
  try {
    const { output, exitCode, argv } = await runBashUsage({ claudeBin: bin, cwd, timeoutMs: t });
    res.json({
      line: '/usage',
      execMode: 'bash_quoted_usage',
      output: enrichUsagePanelWithLocalJsonWhenCliFails(output, { treatEmptyAsFailure: true }),
      exitCode,
      argv
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
    const argv = [claudeBin(), '-p', prompt];
    const message = formatClaudeSpawnError(e, argv);
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

  let timersCleaned = false;
  const cleanupTimers = () => {
    if (timersCleaned) return;
    timersCleaned = true;
    clearInterval(heartbeat);
  };

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
  // Listen on res, not req: req 'close' can fire as soon as the POST body is
  // consumed (TCP half-close), killing Claude before it starts.  res 'close'
  // only fires when the SSE response stream itself is torn down.
  res.on('close', killOnClient);

  let result: ClaudeRunResult;
  try {
    result = await watchClaudeProcess(child, runTimeoutMs(), argv, {
      onStdoutChunk: (t) => sse({ type: 'stdout', chunk: t }),
      onStderrChunk: (t) => sse({ type: 'stderr', chunk: t })
    });
  } catch (e) {
    const spawnDiag = formatClaudeSpawnError(e, argv);
    sse({ type: 'error', message: spawnDiag });
    result = {
      stdout: '',
      stderr: spawnDiag,
      code: null,
      signal: null,
      argv
    };
  } finally {
    cleanupTimers();
    res.off('close', killOnClient);
  }

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
  console.log(
    `[claude-seo-ui] Effective timeouts: CLAUDE_TIMEOUT_MS=${runTimeoutMs()}ms, CLAUDE_USAGE_TIMEOUT_MS=${usageTimeoutMs()}ms`
  );
  logClaudeAutoPermissionPolicy();

  // Validate workdir exists — a missing directory causes spawn ENOENT (misleadingly blames the binary).
  if (!fs.existsSync(cwd)) {
    console.error(
      `[claude-seo-ui] ERROR: CLAUDE_WORKDIR does not exist: "${cwd}"\n` +
      `  All SEO runs will fail with "spawn claude ENOENT" until this is fixed.\n` +
      `  Set CLAUDE_WORKDIR in your .env to an existing directory.`
    );
  }
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
