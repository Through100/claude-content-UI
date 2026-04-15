import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Terminal } from 'lucide-react';
import { apiService } from '../services/api';
import ClaudeTerminalView from './ClaudeTerminalView';

/**
 * Dedicated page for Claude Code browser / OAuth login via the real PTY terminal.
 * Kept separate from Account Info (/status snapshot) so operators have clear guidance.
 */
export default function LogonView() {
  const [terminalWsEnabled, setTerminalWsEnabled] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    setHealthError(null);
    try {
      const health = await apiService.getSystemStatus();
      setTerminalWsEnabled(
        typeof (health as { terminalWebSocket?: boolean }).terminalWebSocket === 'boolean'
          ? (health as { terminalWebSocket: boolean }).terminalWebSocket
          : true
      );
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : String(e));
      setTerminalWsEnabled(false);
    }
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  return (
    <div className="space-y-8 pb-16 max-w-4xl">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-xl bg-indigo-100 text-indigo-700">
            <KeyRound size={22} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Logon</h2>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed max-w-3xl">
          Use the interactive terminal below to sign in or out of Claude Code in the same environment as SEO runs
          (<code className="text-xs bg-gray-100 px-1 rounded">CLAUDE_WORKDIR</code>, API user). Account Info still shows a
          one-shot <code className="text-xs bg-gray-100 px-1 rounded">/status</code> snapshot; this page is only for live
          <code className="text-xs bg-gray-100 px-1 rounded">/login</code> / <code className="text-xs bg-gray-100 px-1 rounded">/logout</code>.
        </p>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2 bg-gray-50/80">
          <Terminal size={18} className="text-indigo-600 shrink-0" />
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">How to log in and out</h3>
        </div>
        <div className="px-5 py-5 space-y-4 text-sm text-gray-700 leading-relaxed">
          <ol className="list-decimal list-inside space-y-3 marker:font-semibold marker:text-indigo-700">
            <li>
              Click inside the terminal, then type <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">/login</code> and press{' '}
              <kbd className="text-xs font-mono bg-gray-200 px-1 rounded">Enter</kbd>. Follow the prompts (browser window or URL + paste code).
            </li>
            <li>
              To paste an OAuth or device code from your PC, use the green <strong>Paste from PC…</strong> button above the terminal if the normal
              browser paste shortcut is blocked (common on plain HTTP).
            </li>
            <li>
              When you are done with this session, type <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">/logout</code> and press{' '}
              <kbd className="text-xs font-mono bg-gray-200 px-1 rounded">Enter</kbd> to sign out of Claude Code in this PTY. You can run{' '}
              <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">/login</code> again later to authenticate as a different user if
              your workflow allows it.
            </li>
          </ol>
          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 leading-relaxed">
            This shell runs as the API server user on the host. Use only on trusted internal networks; anyone who can open this page can use the
            terminal while it is connected.
          </p>
          <p className="text-xs text-gray-500">
            Right-click in the terminal for the normal browser menu (Copy / Paste). The server needs <code className="bg-gray-100 px-1 rounded">python3</code> and{' '}
            <code className="bg-gray-100 px-1 rounded">scripts/pty-proxy.py</code>. Set <code className="bg-gray-100 px-1 rounded">CLAUDE_TERMINAL_WS=0</code> to disable the WebSocket entirely.
          </p>
        </div>
      </section>

      {healthError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Could not read server health ({healthError}). The terminal may still work if the API is up.
        </div>
      )}

      {!terminalWsEnabled ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Interactive terminal is disabled on the server (<code className="text-xs bg-white/70 px-1 rounded">CLAUDE_TERMINAL_WS=0</code>). Remove it
          to allow the WebSocket PTY.
        </div>
      ) : (
        <ClaudeTerminalView compact title="Claude — interactive (PTY)" />
      )}
    </div>
  );
}
