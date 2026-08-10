import 'dotenv/config';

/** Avoid process exit on transient proxy/client socket drops during long SSE runs. */
function bindProcessCrashLogging(): void {
  const isBenignSocketErr = (err: unknown): boolean => {
    const code = (err as NodeJS.ErrnoException)?.code;
    return code === 'ECONNRESET' || code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
  };
  process.on('uncaughtException', (err) => {
    if (isBenignSocketErr(err)) {
      console.warn('[claude-seo-ui] Ignoring transient socket error:', (err as Error).message);
      return;
    }
    console.error('[claude-seo-ui] uncaughtException:', err);
  });
  process.on('unhandledRejection', (reason) => {
    if (isBenignSocketErr(reason)) {
      console.warn('[claude-seo-ui] Ignoring transient socket rejection:', (reason as Error).message);
      return;
    }
    console.error('[claude-seo-ui] unhandledRejection:', reason);
  });
}

bindProcessCrashLogging();

import express, { type Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  formatClaudeSpawnError,
  logClaudeAutoPermissionPolicy,
  runClaudeInitOnly,
  runClaudePrint,
  runClaudePrintWithOptionalOllamaFollowup,
  runClaudeVersion,
  type ClaudeRunResult
} from './claudeRunner';
import { isOllamaHeadlessModel } from './ollamaEnsure';
import { appendHistoryItem, groupHistory, loadHistory } from './historyStore';
import { parseSeoOutput } from '../shared/parseSeoOutput';
import { enrichUsagePanelWithLocalJsonWhenCliFails } from './usageLocalSnapshot';
import { parseUsageCostSnapshot } from './usageCostParse';
import { parseUsageQuotaSnapshot, usagePanelMainText } from './usageQuotaParse';
import { attachClaudeTerminalWebSocket } from './terminalWs';
import { runAccountStatusProbeDeduped } from './accountStatusProbe';
import { runBashCost, runBashUsage } from './usageShellProbe';
import {
  BLOG_COMMANDS,
  buildBlogPrompt,
  formatWorkspaceRunDirSegment,
  isLikelyHttpUrl,
  type BlogCommand,
  type HistoryItem,
  type RunResponse
} from '../src/types';

const SSE_DONE_RAW_CAP = 200_000;

/** Large blog runs can exceed proxy/SSE frame limits — cap `rawOutput` in the terminal `done` event. */
function slimRunResponseForSse(body: RunResponse): RunResponse {
  if (body.rawOutput.length <= SSE_DONE_RAW_CAP) return body;
  return {
    ...body,
    rawOutput:
      body.rawOutput.slice(0, SSE_DONE_RAW_CAP) +
      '\n\n[Truncated for stream delivery — full output is in History and workspace-files.]'
  };
}

function safeSseEnd(res: Response): void {
  if (res.writableEnded) return;
  try {
    res.end();
  } catch {
    /* client already gone */
  }
}

/** Nudge headless runs when the target is a URL so the model does not ask for interactive WebFetch / paste (no TTY). */
function appendHeadlessHttpUrlHint(prompt: string, targetTrimmed: string): string {
  if (!isLikelyHttpUrl(targetTrimmed)) return prompt;
  if (['1', 'true', 'yes'].includes((process.env.CLAUDE_DISABLE_HTTP_TARGET_HINT ?? '').toLowerCase())) {
    return prompt;
  }
  return (
    `${prompt}\n\n` +
    '[Dashboard headless: this run is non-interactive; the server already applies normal headless tool permission settings. ' +
    'The target is an HTTP(S) URL — fetch it with WebFetch (or your environment’s URL/read tool) as soon as you need the content. ' +
    'Do not ask the operator to grant WebFetch, choose numbered menu options, or paste the full article unless a fetch actually failed or the site blocked access.]'
  );
}

function appendOllamaCompatibilityHint(prompt: string, model: string): string {
  if (!isOllamaHeadlessModel(model)) return prompt;
  return (
    `${prompt}\n\n` +
    '[Ollama model compatibility: treat this headless run as text-only. Do not attach or inspect image bytes. ' +
    'When a workflow normally requires screenshot or image inspection, use HTML, DOM text, metadata, links, and other text evidence instead, and clearly note the omitted visual check.]'
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function claudeBin(): string {
  return process.env.CLAUDE_BIN || 'claude';
}

function workdir(): string {
  const w = process.env.CLAUDE_WORKDIR || process.cwd();
  return path.resolve(w);
}

const UI_UPLOAD_SUBDIR = 'ui-uploads';

function uploadMaxBytes(): number {
  const raw = process.env.UI_UPLOAD_MAX_BYTES;
  if (raw === undefined || raw === '') return 32 * 1024 * 1024;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1024 || n > 200 * 1024 * 1024) return 32 * 1024 * 1024;
  return n;
}

/** Safe basename for uploads (no path segments). */
function sanitizeUploadBasename(name: string): string {
  let b = path.basename(String(name).replace(/\\/g, '/')).replace(/\0/g, '').trim();
  if (!b || b === '.' || b === '..') return `upload-${randomUUID().slice(0, 8)}.txt`;
  b = b.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!b) return `upload-${randomUUID().slice(0, 8)}.txt`;
  return b.length > 200 ? b.slice(0, 200) : b;
}

async function uniqueUploadFilename(dir: string, baseName: string): Promise<string> {
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  let candidate = baseName;
  let i = 0;
  while (fs.existsSync(path.join(dir, candidate))) {
    i++;
    candidate = `${stem}-${i}${ext}`;
  }
  return candidate;
}

/** Resolve client-supplied path to a real file only when it stays under CLAUDE_WORKDIR. */
function resolveSafePathUnderWorkdir(userPath: string): string | null {
  const root = path.resolve(workdir());
  const trimmed = String(userPath).trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!trimmed) return null;
  const candidate = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed);
  const rel = path.relative(root, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return candidate;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.md': 'text/markdown; charset=utf-8',
    '.markdown': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8'
  };
  return map[ext] || 'application/octet-stream';
}

type MarkdownReportCandidate = {
  abs: string;
  rel: string;
  name: string;
  size: number;
  mtimeMs: number;
};

type WorkspaceFileCandidate = MarkdownReportCandidate & {
  contentType: string;
};

async function listWorkspaceFiles(dir: string, relBase: string, depth = 0): Promise<WorkspaceFileCandidate[]> {
  if (depth > 3) return [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: WorkspaceFileCandidate[] = [];
  for (const entry of entries.slice(0, 500)) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const rel = `${relBase}/${entry.name}`.replace(/\\/g, '/');
    if (entry.isDirectory()) {
      out.push(...(await listWorkspaceFiles(abs, rel, depth + 1)));
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const st = await fsp.stat(abs);
      out.push({
        abs,
        rel,
        name: entry.name,
        size: st.size,
        mtimeMs: st.mtimeMs,
        contentType: guessContentType(abs)
      });
    } catch {
      /* ignore disappearing files */
    }
  }
  return out;
}

async function listFilesInWorkspaceSegment(segment: string): Promise<WorkspaceFileCandidate[]> {
  const safeSegment = segment.trim().replace(/^workspace-files[\\/]+/i, '').replace(/^["'`]+|["'`]+$/g, '');
  if (!safeSegment || safeSegment.includes('..')) return [];
  const relDir = `workspace-files/${safeSegment}`.replace(/\\/g, '/');
  const absDir = resolveSafePathUnderWorkdir(relDir);
  if (!absDir) return [];
  let st: fs.Stats;
  try {
    st = await fsp.stat(absDir);
  } catch {
    return [];
  }
  if (!st.isDirectory()) return [];
  return listWorkspaceFiles(absDir, relDir);
}

function scoreMarkdownReportCandidate(c: MarkdownReportCandidate): number {
  const n = c.name.toLowerCase();
  let score = 0;
  if (/\b(full[-_ ]?)?report\b/.test(n)) score += 80;
  if (/\baudit\b/.test(n)) score += 55;
  if (/\bhealth\b/.test(n)) score += 45;
  if (/\banalysis\b/.test(n)) score += 35;
  if (/\bsummary\b/.test(n)) score += 15;
  if (/\breadme\b/.test(n)) score -= 80;
  score += Math.min(30, Math.floor(c.size / 4000));
  return score;
}

async function findBestMarkdownReportInWorkspaceSegment(segment: string): Promise<MarkdownReportCandidate | null> {
  const files = await listFilesInWorkspaceSegment(segment);
  const candidates = files.filter((f) => /\.md(?:own)?$/i.test(f.name));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => {
    const byScore = scoreMarkdownReportCandidate(b) - scoreMarkdownReportCandidate(a);
    if (byScore !== 0) return byScore;
    const bySize = b.size - a.size;
    if (bySize !== 0) return bySize;
    return b.mtimeMs - a.mtimeMs;
  })[0] ?? null;
}

const DEFAULT_RUN_TIMEOUT_MS = 3_600_000;
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

function killClaudeOnSseDisconnect(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.CLAUDE_KILL_ON_SSE_DISCONNECT ?? '').toLowerCase());
}

function emptyRunDiagnosticHints(result: ClaudeRunResult, durationMs: number): string[] {
  const hints: string[] = [];
  const min = Math.round(durationMs / 60_000);
  if (result.signal === 'SIGKILL' && durationMs >= 540_000 && durationMs <= 960_000) {
    hints.push(
      `Duration ~${min} minutes with SIGKILL often means the OS OOM killer, a force-kill (pkill -9), or an upstream proxy idle timeout near 900s (15 min). Raise reverse-proxy read timeouts for /api/run/stream to at least 3600s and check dmesg or pm2 logs for OOM.`
    );
  } else if (result.signal === 'SIGTERM' && durationMs >= 540_000) {
    hints.push(
      `Long run (${min} min) ended with SIGTERM. A browser tab close, client timeout, or proxy may have dropped the SSE connection${
        killClaudeOnSseDisconnect()
          ? ' — this API is configured to kill Claude when that happens (CLAUDE_KILL_ON_SSE_DISCONNECT=1).'
          : ' — Claude should keep running unless CLAUDE_KILL_ON_SSE_DISCONNECT=1.'
      }`
    );
  } else if (result.signal === 'SIGTERM' && durationMs < 60_000) {
    hints.push(
      `Very short run + SIGTERM often means the API timeout fired (see CLAUDE_TIMEOUT_MS; must be unset or an integer >= ${MIN_TIMEOUT_MS}ms, default ${DEFAULT_RUN_TIMEOUT_MS}ms).`
    );
  }
  return hints;
}

const USAGE_RAW_SEPARATOR = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';

/** Run `claude "/usage"` then `claude "/cost"` (same PTY/script wrapper as each standalone probe). */
async function runCombinedUsageProbes() {
  const cwd = workdir();
  const bin = claudeBin();
  const t = usageTimeoutMs();

  const usageResult = await runBashUsage({ claudeBin: bin, cwd, timeoutMs: t });
  const mergedUsage = enrichUsagePanelWithLocalJsonWhenCliFails(usageResult.output, { treatEmptyAsFailure: true });
  const quotaSnapshot = parseUsageQuotaSnapshot(usagePanelMainText(mergedUsage));

  const costResult = await runBashCost({ claudeBin: bin, cwd, timeoutMs: t });
  const costSnapshot = parseUsageCostSnapshot(costResult.output);

  const output = `## claude "/usage"\n\n${mergedUsage.trim()}${USAGE_RAW_SEPARATOR}## claude "/cost"\n\n${costResult.output.trim()}`;

  return {
    line: '/usage + /cost',
    execMode: 'bash_quoted_usage_cost' as const,
    output,
    exitCode: usageResult.exitCode,
    argv: usageResult.argv,
    quotaSnapshot,
    costSnapshot,
    costExitCode: costResult.exitCode,
    costArgv: costResult.argv
  };
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
  | { ok: true; cmd: BlogCommand; targetTrimmed: string; model: string }
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
  const cmd = BLOG_COMMANDS.find(c => c.key === commandKey);
  if (!cmd) return { ok: false as const, error: 'Unknown commandKey' };
  const targetTrimmed = target.trim();
  if (!cmd.targetOptional && !targetTrimmed) {
    return { ok: false as const, error: 'Target is required for this command' };
  }
  const rawModel = b.model;
  const model =
    typeof rawModel === 'string' && rawModel.trim() !== '' ? rawModel.trim() : 'claude-fable-5';
  return { ok: true as const, cmd, targetTrimmed, model };
}

function buildRunBody(input: {
  result: ClaudeRunResult;
  prompt: string;
  cmd: BlogCommand;
  targetTrimmed: string;
  startedAt: string;
  t0: number;
  cwd: string;
  workspaceOutputSegment: string;
}): { body: RunResponse; item: HistoryItem } {
  const { result, prompt, cmd, targetTrimmed, startedAt, t0, cwd, workspaceOutputSegment } = input;
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
    const hintLines = emptyRunDiagnosticHints(result, durationMs);
    rawOutput = [
      '(Claude exited before any stdout/stderr was captured. If this persists, the process may be failing immediately — e.g. missing auth, wrong cwd, or claude not on PATH.)',
      '',
      '--- diagnostics ---',
      `exit code: ${result.code}`,
      result.signal ? `signal: ${result.signal}` : null,
      `duration_ms: ${durationMs}`,
      ...hintLines,
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
    stats: { durationMs, startedAt, finishedAt, workspaceOutputSegment },
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
    parsedReport,
    workspaceOutputSegment
  };
  return { body, item };
}

const DEFAULT_MODELS = [
  { id: 'claude-fable-5', label: 'Claude Fable 5', description: 'Latest highest-capability Claude' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', description: 'Latest Opus; 1M context' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', description: 'Latest Sonnet; 1M context' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Latest Haiku; fast and efficient' },
  { id: 'default', label: 'Account default', description: 'Clears override; tier default' },
  { id: 'deepseek-v4-pro:cloud', label: 'DeepSeek V4 Pro (Ollama cloud)', description: 'Uses Ollama cloud API' },
  { id: 'minimax-m3:cloud', label: 'MiniMax M3 (Ollama cloud)', description: 'Uses Ollama cloud API' },
  { id: 'kimi-k3:cloud', label: 'Kimi K3 (Ollama cloud)', description: 'Uses Ollama cloud API' },
  { id: 'glm-5.2:cloud', label: 'GLM 5.2 (Ollama cloud)', description: 'Uses Ollama cloud API' },
  {
    id: 'nemotron-3-super:cloud',
    label: 'Nemotron 3 Super (Ollama cloud)',
    description: 'Uses Ollama cloud API'
  },
  { id: 'gemma4:cloud', label: 'Gemma 4 (Ollama cloud)', description: 'Uses Ollama cloud API' },
  { id: 'qwen3.5:397b-cloud', label: 'Qwen3.5 397B (Ollama cloud)', description: 'Uses Ollama cloud API' },
  {
    id: 'gemini-3-flash-preview:cloud',
    label: 'Gemini 3 Flash Preview (Ollama cloud)',
    description: 'Uses Ollama cloud API'
  },
  { id: 'gpt-oss:120b-cloud', label: 'gpt-oss 120B (Ollama cloud)', description: 'Uses Ollama cloud API' },
];

const app = express();
app.use(express.json({ limit: '2mb' }));

/** Raw file bytes from the dashboard “Upload” button; path returned is under CLAUDE_WORKDIR. */
app.post(
  '/api/upload-target',
  express.raw({ type: 'application/octet-stream', limit: uploadMaxBytes() }),
  async (req, res) => {
    try {
      const buf = req.body as Buffer;
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({
          error:
            'Empty upload. Send the file as the request body with Content-Type: application/octet-stream and header X-Upload-Filename.'
        });
        return;
      }
      const rawHeader = req.get('x-upload-filename');
      const decoded = rawHeader ? decodeURIComponent(rawHeader) : 'upload.txt';
      const safeBase = sanitizeUploadBasename(decoded);
      const cwd = workdir();
      const dir = path.join(cwd, UI_UPLOAD_SUBDIR);
      await fsp.mkdir(dir, { recursive: true });
      const finalName = await uniqueUploadFilename(dir, safeBase);
      const abs = path.join(dir, finalName);
      await fsp.writeFile(abs, buf, { mode: 0o644 });
      const relativePath = `${UI_UPLOAD_SUBDIR}/${finalName}`.replace(/\\/g, '/');
      res.json({ relativePath, bytesWritten: buf.length });
    } catch (e) {
      const msg = String(e);
      if (msg.includes('request entity too large') || /too large/i.test(msg)) {
        res.status(413).json({ error: `Upload exceeds UI_UPLOAD_MAX_BYTES (${uploadMaxBytes()} bytes).` });
        return;
      }
      console.error('[claude-seo-ui] POST /api/upload-target:', msg);
      res.status(500).json({ error: msg });
    }
  }
);

/** Download a single file from the Claude workspace (browser cannot read the server disk otherwise). */
app.get('/api/workspace-file', (req, res) => {
  try {
    const raw = String(req.query.path ?? '').trim();
    if (!raw) {
      res.status(400).send('Missing path query parameter');
      return;
    }
    const decoded = decodeURIComponent(raw);
    const abs = resolveSafePathUnderWorkdir(decoded);
    if (!abs) {
      res.status(400).json({ error: 'Path escapes CLAUDE_WORKDIR or is invalid.' });
      return;
    }
    if (!fs.existsSync(abs)) {
      /** When set, missing files return 204 so the UI can poll without Chrome logging repeated 404 network errors. */
      if (String(req.query.ifMissing ?? '').trim() === '204') {
        res.status(204).end();
        return;
      }
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const st = fs.statSync(abs);
    if (!st.isFile()) {
      res.status(400).send('Not a regular file');
      return;
    }
    const name = path.basename(abs);
    res.setHeader('Content-Type', guessContentType(abs));
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
    const stream = fs.createReadStream(abs);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  } catch (e) {
    console.error('[claude-seo-ui] GET /api/workspace-file:', e);
    res.status(500).json({ error: String(e) });
  }
});

/** Locate and download the best markdown report inside one workspace output folder. */
app.get('/api/workspace-report', async (req, res) => {
  try {
    const segment = String(req.query.segment ?? '').trim();
    if (!segment) {
      res.status(400).json({ error: 'Missing segment query parameter' });
      return;
    }
    const found = await findBestMarkdownReportInWorkspaceSegment(segment);
    if (!found) {
      if (String(req.query.ifMissing ?? '').trim() === '204') {
        res.status(204).end();
        return;
      }
      res.status(404).json({ error: 'No markdown report found in workspace segment' });
      return;
    }
    const name = path.basename(found.abs);
    res.setHeader('Content-Type', guessContentType(found.abs));
    res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
    res.setHeader('X-Workspace-Path', encodeURIComponent(found.rel));
    const stream = fs.createReadStream(found.abs);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  } catch (e) {
    console.error('[claude-seo-ui] GET /api/workspace-report:', e);
    res.status(500).json({ error: String(e) });
  }
});

/** List downloadable files inside one workspace output folder. */
app.get('/api/workspace-files', async (req, res) => {
  try {
    const segment = String(req.query.segment ?? '').trim();
    if (!segment) {
      res.status(400).json({ error: 'Missing segment query parameter' });
      return;
    }
    const files = await listFilesInWorkspaceSegment(segment);
    res.json({
      segment,
      files: files
        .sort((a, b) => a.rel.localeCompare(b.rel))
        .map((f) => ({
          path: f.rel,
          name: f.name,
          size: f.size,
          mtimeMs: f.mtimeMs,
          contentType: f.contentType
        }))
    });
  } catch (e) {
    console.error('[claude-seo-ui] GET /api/workspace-files:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/health', (_req, res) => {
  try {
    res.json({
      ok: true,
      claudeBin: claudeBin(),
      workdir: workdir(),
      runTimeoutMs: runTimeoutMs(),
      usageTimeoutMs: usageTimeoutMs(),
      /** When false, `/api/terminal/ws` upgrades are refused (set `CLAUDE_TERMINAL_WS=0`). */
      terminalWebSocket: process.env.CLAUDE_TERMINAL_WS !== '0',
      time: new Date().toISOString()
    });
  } catch (e) {
    console.error('[claude-seo-ui] GET /api/health failed:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
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

type PtyHistoryAppendBody = {
  commandKey: string;
  target: string;
  rawOutput: string;
  startedAt: string;
  finishedAt: string;
  workspaceOutputSegment?: string;
};

function parsePtyHistoryAppend(
  body: unknown
): { ok: true; data: PtyHistoryAppendBody } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false as const, error: 'Invalid JSON body' };
  }
  const b = body as Record<string, unknown>;
  const commandKeyRaw = b.commandKey;
  if (typeof commandKeyRaw !== 'string' || !commandKeyRaw.trim()) {
    return { ok: false as const, error: 'commandKey is required' };
  }
  if (typeof b.target !== 'string') {
    return { ok: false as const, error: 'target is required' };
  }
  if (typeof b.rawOutput !== 'string') {
    return { ok: false as const, error: 'rawOutput is required' };
  }
  if (typeof b.startedAt !== 'string' || typeof b.finishedAt !== 'string') {
    return { ok: false as const, error: 'startedAt and finishedAt must be ISO strings' };
  }
  const cmd = BLOG_COMMANDS.find((c) => c.key === commandKeyRaw.trim());
  if (!cmd) return { ok: false as const, error: 'Unknown commandKey' };
  const targetTrimmed = b.target.trim();
  if (!cmd.targetOptional && !targetTrimmed) {
    return { ok: false as const, error: 'Target is required for this command' };
  }
  const maxOut = 4_000_000;
  if (b.rawOutput.length > maxOut) {
    return { ok: false as const, error: `rawOutput exceeds ${maxOut} characters` };
  }
  const ws =
    typeof b.workspaceOutputSegment === 'string' && b.workspaceOutputSegment.trim()
      ? b.workspaceOutputSegment.trim()
      : formatWorkspaceRunDirSegment(cmd.key, targetTrimmed, String(b.startedAt));
  return {
    ok: true as const,
    data: {
      commandKey: cmd.key,
      target: targetTrimmed,
      rawOutput: b.rawOutput,
      startedAt: b.startedAt,
      finishedAt: b.finishedAt,
      workspaceOutputSegment: ws
    }
  };
}

/** Persists interactive PTY sessions (dashboard Command Runner) into the same History store as headless `/api/run`. */
app.post('/api/history/pty', async (req, res) => {
  const parsed = parsePtyHistoryAppend(req.body);
  if (parsed.ok === false) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { data } = parsed;
  const t0 = new Date(data.startedAt).getTime();
  const t1 = new Date(data.finishedAt).getTime();
  const durationMs = Math.max(0, Number.isFinite(t1 - t0) ? t1 - t0 : 0);
  const cmd = BLOG_COMMANDS.find((c) => c.key === data.commandKey)!;
  const parsedReport = parseSeoOutput(data.rawOutput);
  try {
    await appendHistoryItem({
      id: randomUUID(),
      timestamp: data.startedAt,
      commandKey: cmd.key,
      commandLabel: cmd.label,
      target: data.target,
      status: 'success',
      durationMs,
      rawOutput: data.rawOutput,
      parsedReport,
      workspaceOutputSegment: data.workspaceOutputSegment
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[claude-seo-ui] POST /api/history/pty:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/usage', async (_req, res) => {
  try {
    res.json(await runCombinedUsageProbes());
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/usage/exec', async (_req, res) => {
  try {
    res.json(await runCombinedUsageProbes());
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/account', async (_req, res) => {
  const cwd = workdir();
  const bin = claudeBin();
  try {
    res.json(await runAccountStatusProbeDeduped(bin, cwd));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/account/exec', async (_req, res) => {
  const cwd = workdir();
  const bin = claudeBin();
  try {
    res.json(await runAccountStatusProbeDeduped(bin, cwd));
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
  const { cmd, targetTrimmed, model } = parsed;
  const startedAt = new Date().toISOString();
  const workspaceOutputSegment = formatWorkspaceRunDirSegment(cmd.key, targetTrimmed, startedAt);
  const prompt = appendOllamaCompatibilityHint(
    appendHeadlessHttpUrlHint(
      buildBlogPrompt(cmd, targetTrimmed, { runToken: startedAt }),
      targetTrimmed
    ),
    model
  );
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
      cwd,
      workspaceOutputSegment
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
      stats: { durationMs, startedAt, finishedAt, workspaceOutputSegment },
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
  const { cmd, targetTrimmed, model } = parsed;
  const startedAt = new Date().toISOString();
  const workspaceOutputSegment = formatWorkspaceRunDirSegment(cmd.key, targetTrimmed, startedAt);
  const prompt = appendOllamaCompatibilityHint(
    appendHeadlessHttpUrlHint(
      buildBlogPrompt(cmd, targetTrimmed, { runToken: startedAt }),
      targetTrimmed
    ),
    model
  );
  const t0 = Date.now();
  const cwd = workdir();

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let clientGone = false;
  const markClientGone = (reason: string, err?: unknown) => {
    if (clientGone) return;
    clientGone = true;
    if (err) {
      console.warn(`[claude-seo-ui] SSE client disconnected (${reason}):`, err);
    } else {
      console.warn(`[claude-seo-ui] SSE client disconnected (${reason})`);
    }
  };
  req.on('error', (err) => markClientGone('request error', err));
  res.on('error', (err) => markClientGone('response error', err));

  const sse = (obj: unknown) => {
    if (clientGone || res.writableEnded || res.destroyed) return;
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch (err) {
      markClientGone('write failed', err);
    }
  };

  const streamRunId = randomUUID();
  sse({ type: 'started', runId: streamRunId, workspaceOutputSegment, startedAt });
  sse({ type: 'run_accepted', startedAt });

  const SSE_STREAM_CHUNK_CAP = 24 * 1024;
  const sseStreamChunk = (streamType: 'stdout' | 'stderr', text: string) => {
    if (text.length <= SSE_STREAM_CHUNK_CAP) {
      sse({ type: streamType, chunk: text });
      return;
    }
    for (let i = 0; i < text.length; i += SSE_STREAM_CHUNK_CAP) {
      sse({ type: streamType, chunk: text.slice(i, i + SSE_STREAM_CHUNK_CAP) });
    }
  };

  let timersCleaned = false;
  const cleanupTimers = () => {
    if (timersCleaned) return;
    timersCleaned = true;
    clearInterval(heartbeat);
  };

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !clientGone) {
      try {
        sse({ type: 'ping', ts: Date.now() });
        sse({ type: 'keepalive', t: Date.now() });
      } catch {
        /* ignore */
      }
    }
  }, 10_000);

  let activeChild: ChildProcess | undefined;
  let claudePhase: 'running' | 'finished' = 'running';
  const killOnClient = () => {
    if (claudePhase !== 'running' || !killClaudeOnSseDisconnect()) return;
    try {
      if (activeChild && !activeChild.killed) activeChild.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };
  res.on('close', () => {
    markClientGone('response close');
    if (killClaudeOnSseDisconnect()) {
      killOnClient();
    } else {
      console.log(
        `[claude-seo-ui] SSE client disconnected during run ${streamRunId} — Claude keeps running (set CLAUDE_KILL_ON_SSE_DISCONNECT=1 to stop on disconnect).`
      );
    }
  });

  let result: ClaudeRunResult;
  const fallbackArgv = [claudeBin(), '-p', prompt];
  try {
    result = await runClaudePrintWithOptionalOllamaFollowup(
      {
        prompt,
        cwd,
        model,
        timeoutMs: runTimeoutMs(),
        claudeBin: claudeBin(),
        registerChild: (child) => {
          activeChild = child;
        }
      },
      {
        onStdoutChunk: (text) => sseStreamChunk('stdout', text),
        onStderrChunk: (text) => sseStreamChunk('stderr', text)
      }
    );
  } catch (e) {
    const spawnDiag = formatClaudeSpawnError(e, fallbackArgv);
    sse({ type: 'error', message: spawnDiag });
    result = {
      stdout: '',
      stderr: spawnDiag,
      code: null,
      signal: null,
      argv: fallbackArgv
    };
  } finally {
    claudePhase = 'finished';
    cleanupTimers();
  }

  try {
    const { body, item } = buildRunBody({
      result,
      prompt,
      cmd,
      targetTrimmed,
      startedAt,
      t0,
      cwd,
      workspaceOutputSegment
    });
    await appendHistoryItem(item);
    if (!clientGone) {
      sse({ type: 'done', result: slimRunResponseForSse(body) });
    } else {
      console.log(
        `[claude-seo-ui] Run ${item.id} saved to history after client disconnect (workspace: ${workspaceOutputSegment})`
      );
    }
  } catch (e) {
    if (!clientGone) sse({ type: 'error', message: String(e) });
    console.error('[claude-seo-ui] POST /api/run/stream post-run failed:', e);
  }
  safeSseEnd(res);
});

/** Best-effort kill of lingering `claude` processes (e.g. stuck `claude /status` from legacy probes). */
app.post('/api/session/restart', async (_req, res) => {
  const cwd = workdir();
  if (process.platform !== 'linux') {
    res.json({
      ok: true,
      attempted: false,
      message: `No-op on ${process.platform}; client state was reset.`
    });
    return;
  }
  const command = `pkill -TERM -f '(^|[[:space:]])claude([[:space:]]|$)' || true; pgrep -fa '(^|[[:space:]])claude([[:space:]]|$)' >/tmp/claude-restart-leftovers.txt || true; if [ -s /tmp/claude-restart-leftovers.txt ]; then pkill -KILL -f '(^|[[:space:]])claude([[:space:]]|$)' || true; fi; rm -f /tmp/claude-restart-leftovers.txt`;
  const argv = ['-lc', command];
  const child = spawn('bash', argv, {
    cwd,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const chunks: Buffer[] = [];
  child.stdout?.on('data', (d) => chunks.push(d));
  child.stderr?.on('data', (d) => chunks.push(d));
  child.on('close', (code) => {
    const output = Buffer.concat(chunks).toString().trim();
    res.json({
      ok: code === 0 || code === 1,
      attempted: true,
      exitCode: code,
      output: output || '(no output)'
    });
  });
  child.on('error', (err) => {
    res.status(500).json({ ok: false, error: String(err) });
  });
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
  console.log(
    `[claude-seo-ui] SSE disconnect kills Claude: ${killClaudeOnSseDisconnect() ? 'yes (CLAUDE_KILL_ON_SSE_DISCONNECT=1)' : 'no (default — Claude continues after proxy/tab drop)'}`
  );
  logClaudeAutoPermissionPolicy();

  // Validate workdir exists — a missing directory causes spawn ENOENT (misleadingly blames the binary).
  if (!fs.existsSync(cwd)) {
    console.error(
      `[claude-seo-ui] ERROR: CLAUDE_WORKDIR does not exist: "${cwd}"\n` +
      `  All dashboard runs will fail with "spawn claude ENOENT" until this is fixed.\n` +
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

const server = http.createServer(app);

attachClaudeTerminalWebSocket(server, {
  enabled: () => process.env.CLAUDE_TERMINAL_WS !== '0',
  claudeBin,
  workdir
});

server.listen(port, async () => {
  await startupClaude();
  console.log(`[claude-seo-ui] API + static listening on http://0.0.0.0:${port}`);
  const rawTw = process.env.CLAUDE_TERMINAL_WS;
  const ptyWsOn = process.env.CLAUDE_TERMINAL_WS !== '0';
  console.log(
    `[claude-seo-ui] PTY WebSocket: ${ptyWsOn ? 'enabled' : 'disabled'} (CLAUDE_TERMINAL_WS=${JSON.stringify(rawTw ?? '(unset)')} — unset or non-0 enables; only exact "0" disables)`
  );
  if (ptyWsOn) {
    console.log('[claude-seo-ui] PTY path: /api/terminal/ws (set CLAUDE_TERMINAL_WS=0 to disable upgrades)');
  }
  if (shouldLogClaudeRuns()) {
    console.log(
      '[claude-seo-ui] Each POST /api/run will print full Claude stdout/stderr above (set CLAUDE_LOG_RUNS=0 to disable).'
    );
  }
});
