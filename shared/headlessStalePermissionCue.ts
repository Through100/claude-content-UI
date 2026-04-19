/**
 * Detect headless stdout that asks the operator for WebFetch / paste / permission — not actionable after `claude -p` exits.
 */
export function headlessOutputLooksLikeInteractivePermissionAsk(text: string): boolean {
  const s = text || '';
  if (!s.trim()) return false;
  if (/\bwebfetch\b|\bweb fetch\b/i.test(s) && /\b(grant|permission|authorize)\b/i.test(s)) return true;
  if (/\bpaste\b.*\b(article|content|text|html)\b/i.test(s) && /\b(url|http|https:)\b/i.test(s)) return true;
  if (/\bI need (permission|to fetch)\b/i.test(s) && /\b(url|article|content)\b/i.test(s)) return true;
  if (/\bcould you (either|grant)\b/i.test(s) && /\b(webfetch|web fetch|paste)\b/i.test(s)) return true;
  return false;
}
