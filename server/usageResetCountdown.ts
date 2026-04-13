const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

function clampHour12(h: number, ap: string | undefined): number {
  let hour = h;
  const apm = (ap || '').toLowerCase();
  if (apm === 'pm' && hour < 12) hour += 12;
  if (apm === 'am' && hour === 12) hour = 0;
  return hour;
}

/**
 * Parse common Claude `/usage` reset lines into a UTC instant (best-effort).
 * Examples: "1am (UTC)", "Apr 20, 9am (UTC)", "in 3h 20m".
 */
export function parseResetToUtcDate(resetLine: string | null | undefined, reference: Date): Date | null {
  if (!resetLine?.trim()) return null;
  const t = resetLine.replace(/^Resets\s+/i, '').trim();

  const rel = t.match(/^in\s+(\d+)\s*h(?:\s*(\d+)\s*m)?/i);
  if (rel) {
    const h = parseInt(rel[1], 10) || 0;
    const m = rel[2] ? parseInt(rel[2], 10) : 0;
    return new Date(reference.getTime() + (h * 60 + m) * 60_000);
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const monDayTime = t.match(
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)/i
  );
  if (monDayTime) {
    const mon = MONTHS[monDayTime[1].toLowerCase().slice(0, 3) as keyof typeof MONTHS];
    if (mon === undefined) return null;
    const day = parseInt(monDayTime[2], 10);
    let hour = parseInt(monDayTime[3], 10);
    const min = monDayTime[4] ? parseInt(monDayTime[4], 10) : 0;
    hour = clampHour12(hour, monDayTime[5]);
    const y = reference.getUTCFullYear();
    let d = new Date(Date.UTC(y, mon, day, hour, min, 0, 0));
    if (d.getTime() <= reference.getTime()) {
      d = new Date(Date.UTC(y + 1, mon, day, hour, min, 0, 0));
    }
    return d;
  }

  const utcClock = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)/i);
  if (utcClock) {
    let hour = parseInt(utcClock[1], 10);
    const min = utcClock[2] ? parseInt(utcClock[2], 10) : 0;
    hour = clampHour12(hour, utcClock[3]);
    const y = reference.getUTCFullYear();
    const mo = reference.getUTCMonth();
    const da = reference.getUTCDate();
    let d = new Date(Date.UTC(y, mo, da, hour, min, 0, 0));
    if (d.getTime() <= reference.getTime()) {
      d = new Date(Date.UTC(y, mo, da + 1, hour, min, 0, 0));
    }
    return d;
  }

  const tryDate = new Date(t);
  if (!Number.isNaN(tryDate.getTime()) && tryDate.getTime() > reference.getTime()) {
    return tryDate;
  }

  return null;
}

export function formatRefreshCountdown(target: Date | null, reference: Date): string | null {
  if (!target) return null;
  const ms = target.getTime() - reference.getTime();
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
