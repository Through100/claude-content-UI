/**
 * Find likely artifact file paths in Claude run stdout so the UI can offer "download article".
 * Conservative: markdown / text / html under common layouts (absolute Unix, backticks, or relative segments).
 */

/** Ink/PTY often breaks long `Write(workspace-files/.../file.md)` across lines — rejoin before parsing. */
function collapsePtyWrappedPathSegments(s: string): string {
  let t = s.replace(/\r\n/g, '\n');
  for (let i = 0; i < 48; i++) {
    const next = t.replace(/([a-z0-9._/-])\n[ \t]+([a-z0-9./-])/gi, '$1$2');
    if (next === t) break;
    t = next;
  }
  /** Ink often breaks after a whole word: `…wholesale` / `       -suppliers/…` — merge hyphen slug in one shot. */
  for (let i = 0; i < 24; i++) {
    const next = t.replace(/([a-z0-9/._-])\n[ \t]+(-[a-z0-9._/-]+)/gi, '$1$2');
    if (next === t) break;
    t = next;
  }
  return t;
}

export function extractArtifactPathsFromRunText(text: string): string[] {
  const raw = text?.replace(/\r\n/g, '\n') ?? '';
  if (!raw.trim()) return [];

  const found = new Set<string>();
  const push = (s: string | undefined) => {
    if (!s) return;
    const folded = collapsePtyWrappedPathSegments(s.trim());
    const t = folded.replace(/^["'`]+|["'`]+$/g, '').replace(/\)+$/, '').replace(/,$/, '');
    if (!t || t.length > 4096) return;
    if (t.includes('://')) return;
    if (!/\.(?:markdown|md|txt|html|htm)$/i.test(t)) return;
    found.add(t);
  };

  for (const m of raw.matchAll(/`([^`\n]+?\.(?:markdown|md|txt|html|htm))`/gi)) {
    push(m[1]);
  }

  for (const m of raw.matchAll(/\*\*([^*\n]+?\.(?:markdown|md|txt|html|htm))\*\*/gi)) {
    push(m[1]);
  }

  /** Allow newlines inside `Write(…)` so wrapped workspace paths still parse as one string. */
  for (const m of raw.matchAll(
    /\bWrite\s*\(\s*([\s\S]{0,16000}?\.(?:markdown|md|txt|html|htm))\s*\)/gi
  )) {
    push(m[1]);
  }

  for (const m of raw.matchAll(
    /(?:^|[\s>"'([{,;:])([A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?\.(?:markdown|md|txt|html|htm))\b/gim
  )) {
    push(m[1]);
  }

  for (const m of raw.matchAll(
    /(?:^|[\s>:([*"'“‘])(\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:markdown|md|txt|html|htm))(?=[\s`'",).<\]]|$)/gim
  )) {
    push(m[1]);
  }

  for (const m of raw.matchAll(
    /(?:^|[\s>:([*"'“‘])((?:[A-Za-z0-9_.-]+\/){1,12}[A-Za-z0-9_.-]+\.(?:markdown|md|txt|html|htm))(?=[\s`'",).<\]]|$)/gim
  )) {
    push(m[1]);
  }

  const filtered = [...found].filter((p) => !/CLAUDE\.md$/i.test(p));

  /**
   * Weak path regexes can match a *suffix* of a long directory (e.g. `…/ipping-wholesale-suppliers/…`)
   * that shares the same basename as the real `workspace-files/…/analysis-report.md`. Prefer real
   * workspace paths whenever any exist.
   */
  const workspaceAnchored = filtered.filter((p) => /workspace-files\//i.test(p.replace(/\\/g, '/')));
  const pool = workspaceAnchored.length > 0 ? workspaceAnchored : filtered;

  const pickBetter = (a: string, b: string): string => {
    const an = /workspace-files\//i.test(a.replace(/\\/g, '/'));
    const bn = /workspace-files\//i.test(b.replace(/\\/g, '/'));
    if (an && !bn) return a;
    if (bn && !an) return b;
    return a.length >= b.length ? a : b;
  };

  // Deduplicate by filename: if we have both "file.md" and "/opt/path/file.md", keep the better path
  const byName = new Map<string, string>();
  for (const p of pool) {
    const name = p.split(/[/\\]/).pop() ?? p;
    const existing = byName.get(name);
    if (!existing) byName.set(name, p);
    else byName.set(name, pickBetter(existing, p));
  }

  return Array.from(byName.values());
}
