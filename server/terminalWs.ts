import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  attachDetachedSession,
  createPtySession,
  detachSession,
  killSession,
  resizePty,
  writeToPty,
  type PtySession
} from './claudePty';
import { usageProbeCleanEnv } from './usageShellProbe';
import { normalizeRunModel } from '../shared/modelCatalog';

export type TerminalWsOpts = {
  enabled: () => boolean;
  claudeBin: () => string;
  workdir: () => string;
};

const WS_PATH = '/api/terminal/ws';

function bindClaudePtySocket(ws: WebSocket, opts: TerminalWsOpts): void {
  let session: PtySession | null = null;

  /** Keep idle WebSockets warm so reverse proxies (nginx, ALB, etc.) do not drop long-running PTY sessions. */
  const pingMsRaw = parseInt(process.env.CLAUDE_TERMINAL_WS_PING_MS ?? '20000', 10);
  const pingMs = Number.isFinite(pingMsRaw) && pingMsRaw >= 5000 ? pingMsRaw : 20_000;
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }
  }, pingMs);

  const safeSend = (obj: unknown) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(obj));
      } catch {
        /* ignore */
      }
    }
  };

  ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
    let msg: {
      type?: string;
      cols?: number;
      rows?: number;
      data?: string;
      sessionId?: string;
      model?: string;
    };
    try {
      msg = JSON.parse(String(raw)) as typeof msg;
    } catch {
      return;
    }

    if (msg.type === 'destroy') {
      if (session) {
        killSession(session.id);
        session = null;
      }
      return;
    }

    if (msg.type === 'resume') {
      if (session) return;
      const sid = typeof msg.sessionId === 'string' ? msg.sessionId.trim() : '';
      const attached = attachDetachedSession(sid, {
        onData: (chunk) => safeSend({ type: 'data', data: chunk }),
        onExit: () => {
          safeSend({ type: 'exit' });
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }
      });
      if (!attached) {
        safeSend({ type: 'error', message: 'SESSION_NOT_FOUND' });
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        return;
      }
      session = attached;
      if (attached.model !== normalizeRunModel(typeof msg.model === 'string' ? msg.model : undefined, 'default')) {
        detachSession(attached.id);
        session = null;
        safeSend({ type: 'error', message: 'SESSION_NOT_FOUND' });
        ws.close();
        return;
      }
      const cols = typeof msg.cols === 'number' ? msg.cols : attached.cols;
      const rows = typeof msg.rows === 'number' ? msg.rows : attached.rows;
      resizePty(attached, cols, rows);
      safeSend({ type: 'created', sessionId: attached.id, resumed: true, model: attached.model });
      return;
    }

    if (msg.type === 'create') {
      if (session) return;
      try {
        session = createPtySession({
          claudeBin: opts.claudeBin(),
          cwd: opts.workdir(),
          env: usageProbeCleanEnv(),
          model: typeof msg.model === 'string' ? msg.model : undefined,
          cols: typeof msg.cols === 'number' ? msg.cols : undefined,
          rows: typeof msg.rows === 'number' ? msg.rows : undefined,
          onData: (chunk) => safeSend({ type: 'data', data: chunk }),
          onExit: () => {
            safeSend({ type: 'exit' });
            try {
              ws.close();
            } catch {
              /* ignore */
            }
          }
        });
        safeSend({ type: 'created', sessionId: session.id, model: session.model });
      } catch (e) {
        safeSend({ type: 'error', message: String(e) });
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    if (msg.type === 'input' && session && typeof msg.data === 'string') {
      writeToPty(session, msg.data);
      return;
    }

    if (msg.type === 'resize' && session && typeof msg.cols === 'number' && typeof msg.rows === 'number') {
      resizePty(session, msg.cols, msg.rows);
    }
  });

  const cleanup = () => {
    clearInterval(heartbeat);
    if (session) {
      detachSession(session.id);
      session = null;
    }
  };

  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

/**
 * Browser xterm.js ↔ WebSocket ↔ Python pty-proxy ↔ real PTY ↔ `claude`.
 * Upgrade path: {@link WS_PATH}
 */
export function attachClaudeTerminalWebSocket(server: Server, opts: TerminalWsOpts): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = (req.url ?? '').split('?')[0];
    if (url !== WS_PATH && url !== `${WS_PATH}/`) {
      return;
    }
    if (!opts.enabled()) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      bindClaudePtySocket(ws, opts);
    });
  });
}
