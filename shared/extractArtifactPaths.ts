/**
 * Find likely artifact file paths in Claude run stdout so the UI can offer "download article".
 * Conservative: markdown / text / html under common layouts (absolute Unix, backticks, or relative segments).
 */
export function extractArtifactPathsFromRunText(text: string): string[] {
  const raw = text?.replace(/\r\n/g, '\n') ?? '';
  if (!raw.trim()) return [];

  const found = new Set<string>();
  const push = (s: string | undefined) => {
    if (!s) return;
    const t = s.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\)+$/, '').replace(/,$/, '');
    if (!t || t.length > 4096) return;
    if (t.includes('://')) return;
    if (!/\.(?:md|markdown|txt|html|htm)$/i.test(t)) return;
    found.add(t);
  };

  for (const m of raw.matchAll(/`([^`\n]+?\.(?:md|markdown|txt|html|htm))`/gi)) {
    push(m[1]);
  }

  for (const m of raw.matchAll(/\*\*([^*\n]+?\.(?:md|markdown|txt|html|htm))\*\*/gi)) {
    push(m[1]);
  }

  for (const m of raw.matchAll(
    /\bWrite\s*\(\s*([^)\n]+\.(?:md|markdown|txt|html|htm))\s*\)/gi
  )) {
    push(m[1]);
  }

  for (const m of raw.matchAll(
    /(?:^|[\s>"'([{,;:])([A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?\.(?:md|markdown|txt|html|htm))\b/gim
  )) {
    push(m[1]);
  }

  for (const m of raw.matchAll(
    /(?:^|[\s>:([*"'“‘])(\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:md|markdown|txt|html|htm))(?=[\s`'",).<\]]|$)/gim
  )) {
    push(m[1]);
  }

  for (const m of raw.matchAll(
    /(?:^|[\s>:([*"'“‘])((?:[A-Za-z0-9_.-]+\/){1,12}[A-Za-z0-9_.-]+\.(?:md|markdown|txt|html|htm))(?=[\s`'",).<\]]|$)/gim
  )) {
    push(m[1]);
  }

  const filtered = [...found].filter((p) => !/CLAUDE\.md$/i.test(p));

  // Deduplicate by filename: if we have both "file.md" and "/opt/path/file.md", keep the longer/absolute one
  const byName = new Map<string, string>();
  for (const p of filtered) {
    const name = p.split(/[/\\]/).pop() ?? p;
    const existing = byName.get(name);
    // Prefer longer paths (more specific/absolute)
    if (!existing || p.length > existing.length) {
      byName.set(name, p);
    }
  }

  return Array.from(byName.values());
}
