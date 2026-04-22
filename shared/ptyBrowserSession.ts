/** Per-tab keys for resuming the server PTY after a full page reload (sessionStorage). */

export const PTY_BROWSER_SESSION_ID_KEY = 'claude-content-ui-pty-session-id';

/** When set to "1", the next Logon terminal unmount sends `destroy` so the PTY is killed (Dashboard Restart). */
export const PTY_BROWSER_KILL_BEFORE_UNMOUNT_KEY = 'claude-content-ui-pty-kill-next';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readStoredPtySessionId(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  const s = sessionStorage.getItem(PTY_BROWSER_SESSION_ID_KEY)?.trim() ?? '';
  return UUID_RE.test(s) ? s : null;
}
