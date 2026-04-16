import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Terminal } from 'lucide-react';
import { apiService } from '../services/api';

/**
 * Dedicated page for Claude Code browser / OAuth login via the real PTY terminal.
 * Kept separate from Account Info (/status snapshot) so operators have clear guidance.
 * The xterm PTY is mounted once in Layout (below this content) so it stays alive across views.
 */
export type LogonViewProps = {
  /** Run when the Logon page mounts (re-read /status snapshot for the shell header). */
  onVisible?: () => void;
};

export default function LogonView({ onVisible }: LogonViewProps) {
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

  useEffect(() => {
    onVisible?.();
  }, [onVisible]);

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
          Use the interactive terminal below to sign in to Claude Code in the same environment as dashboard runs (
          <code className="text-xs bg-gray-100 px-1 rounded">CLAUDE_WORKDIR</code>). Account Info shows a one-shot{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">/status</code> snapshot (use Refresh there so the header can show your email). This page
          is for live <code className="text-xs bg-gray-100 px-1 rounded">/login</code> in the PTY.
        </p>
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 leading-relaxed max-w-3xl mt-4">
          This interactive terminal runs as the direct Claude CLI session on the host container. Anyone who can open this page can use
          the Claude Code terminal with the associated account used for Logon.
        </p>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2 bg-gray-50/80">
          <Terminal size={18} className="text-indigo-600 shrink-0" />
          <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">How to sign in</h3>
        </div>
        <div className="px-5 py-5 space-y-4 text-sm text-gray-700 leading-relaxed">
          <ol className="list-decimal list-inside space-y-3 marker:font-semibold marker:text-indigo-700">
            <li>
              Click inside the terminal, type <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">/login</code>, and press{' '}
              <kbd className="text-xs font-mono bg-gray-200 px-1 rounded">Enter</kbd>. When Claude shows the <strong>browser login URL</strong> in the
              terminal, select it and use <strong>right-click → Copy</strong> (browser menu) so you have the link on your PC if you need it in another
              window.
            </li>
            <li>
              To paste a URL, device code, or OAuth value from your PC: click <strong>Paste from PC…</strong>, paste into the box, then{' '}
              <strong>Insert into terminal</strong>. <strong>Click inside the interactive PTY</strong> so the cursor is in the session, then press{' '}
              <kbd className="text-xs font-mono bg-gray-200 px-1 rounded">Enter</kbd> when prompted to continue the login flow. Accept the{' '}
              <strong>Notice</strong> prompt when Claude shows it.
            </li>
            <li>
              Once you are signed in, you can use all Claude Code features from this terminal. If you need to sign out, run{' '}
              <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono">/logout</code> and press{' '}
              <kbd className="text-xs font-mono bg-gray-200 px-1 rounded">Enter</kbd>. To start a fresh Claude Code session for the next login, click{' '}
              <strong>Restart</strong> on the terminal (reconnects the PTY).
            </li>
          </ol>
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
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-950 leading-relaxed">
          <strong>Interactive terminal</strong> is shown <strong>below</strong> this page. It uses one persistent session
          for the whole app — the Dashboard <strong>Raw output</strong> tab reads the same xterm buffer (plain text), and
          the <strong>Pretty Report</strong> tab parses that same live text. Use <strong>Paste from PC…</strong> on the
          terminal chrome when the browser blocks clipboard paste.
        </div>
      )}
    </div>
  );
}
