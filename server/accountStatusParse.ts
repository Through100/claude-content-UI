import type { AccountStatusSnapshot } from '../src/types';

/** Strip TUI box-drawing / block noise from the start of a line before matching `Label:`. */
function stripLeadingTuiNoise(line: string): string {
  let s = line;
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/^[\s·•│┃║┆┊├┤┬┴┼╭╮╰╯▘▝─═╞╡▛▜▌▗▖▀▄░▒▓█\u2500-\u25FF]+/u, '');
    if (next === s) break;
    s = next;
  }
  return s.trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const STATUS_LABELS: { key: keyof Omit<AccountStatusSnapshot, 'parseOk'>; label: string }[] = [
  { key: 'version', label: 'Version' },
  { key: 'sessionName', label: 'Session name' },
  { key: 'sessionId', label: 'Session ID' },
  { key: 'cwd', label: 'cwd' },
  { key: 'loginMethod', label: 'Login method' },
  { key: 'organization', label: 'Organization' },
  { key: 'email', label: 'Email' },
  { key: 'model', label: 'Model' },
  { key: 'settingSources', label: 'Setting sources' }
];

/**
 * Parse the Status tab block from interactive `claude "/status"` (ANSI-stripped) for the Pretty Account view.
 */
export function parseAccountStatusSnapshot(raw: string): AccountStatusSnapshot {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');

  const snap: AccountStatusSnapshot = {
    parseOk: false
  };

  for (const rawLine of lines) {
    if (/^\s*esc\s+to\s+cancel\s*$/i.test(rawLine.trim())) continue;
    const t = stripLeadingTuiNoise(rawLine);
    if (!t || !/:/.test(t)) continue;

    for (const { key, label } of STATUS_LABELS) {
      if (snap[key]) continue;
      const re = new RegExp(`^${escapeRe(label)}\\s*:\\s*(.+)$`, 'i');
      const m = t.match(re);
      if (m?.[1]) {
        snap[key] = m[1].trim();
        break;
      }
    }
  }

  const filled = STATUS_LABELS.filter(({ key }) => snap[key] !== undefined && snap[key] !== '').length;
  snap.parseOk = filled >= 3;
  return snap;
}
