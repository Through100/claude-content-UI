/** Client-side countdown from an ISO instant (matches server phrasing). */
export function countdownFromIso(resetAtIso: string | null | undefined, now: Date): string | null {
  if (!resetAtIso) return null;
  const target = new Date(resetAtIso).getTime();
  if (Number.isNaN(target)) return null;
  const ms = target - now.getTime();
  if (ms <= 0) return 'Refresh time reached';
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) {
    return `Refreshes in ${days} day${days === 1 ? '' : 's'}, ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (hours > 0) {
    return `Refreshes in ${hours} hour${hours === 1 ? '' : 's'}, ${mins} minute${mins === 1 ? '' : 's'}`;
  }
  return `Refreshes in ${mins} minute${mins === 1 ? '' : 's'}`;
}
