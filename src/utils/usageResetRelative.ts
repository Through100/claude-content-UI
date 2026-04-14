const MONTH: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

const WD: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };

/** Parse "9am", "9:30am", "14:00", "9:00 am" → { h, m } 24h UTC. */
function parseTimeToHm(s: string): { h: number; m: number } | null {
  const t = s.trim().toLowerCase().replace(/\s+/g, ' ');
  const m12 = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m12) {
    let h = Number(m12[1]);
    const min = m12[2] ? Number(m12[2]) : 0;
    const ap = m12[3];
    if (ap === 'am') {
      if (h === 12) h = 0;
    } else {
      if (h !== 12) h += 12;
    }
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return { h, m: min };
  }
  const m24 = t.match(/^(\d{1,2}):(\d{2})\b/);
  if (m24) {
    const h = Number(m24[1]);
    const min = Number(m24[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return { h, m: min };
  }
  return null;
}

function utcFromMonthDayTime(monthIdx: number, day: number, hm: { h: number; m: number }, ref: Date): Date {
  const y = ref.getUTCFullYear();
  let t = Date.UTC(y, monthIdx, day, hm.h, hm.m, 0, 0);
  if (t < ref.getTime()) t = Date.UTC(y + 1, monthIdx, day, hm.h, hm.m, 0, 0);
  return new Date(t);
}

/**
 * Best-effort parse of a reset instant from Usage tab detail text (UTC-oriented strings from Claude).
 */
export function parseUsageResetTargetUtc(line: string, ref: Date = new Date()): Date | null {
  const s = line.trim();
  if (!s) return null;

  const inRel = s.match(/\bResets?\s+in\s+((?:\d+\s*(?:d|h|m|s)\s*)+)/i);
  if (inRel) {
    const total = parseRelativeDurationMs(inRel[1]);
    if (total !== null && total >= 0) return new Date(ref.getTime() + total);
  }

  const minsSpaced = s.match(/\bReses(?:ts?)?\s*(?:in\s*)?(\d{1,4})\s*m\s*\([Uu][Tt][Cc]\)/);
  if (minsSpaced) {
    const m = Number(minsSpaced[1]);
    if (m >= 0 && m < 10_000) return new Date(ref.getTime() + m * 60_000);
  }
  const minsGlued = s.match(/\bReses(?:t)?(\d{1,4})\s*m\s*\([Uu][Tt][Cc]\)/i);
  if (minsGlued) {
    const m = Number(minsGlued[1]);
    if (m >= 0 && m < 10_000) return new Date(ref.getTime() + m * 60_000);
  }

  const cal = s.match(
    /\bResets?\s+([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*([^\(\)\n·]+?))?\s*\([Uu][Tt][Cc]\)/i
  );
  if (cal) {
    const mon = MONTH[cal[1].toLowerCase()];
    if (mon === undefined) return null;
    const day = Number(cal[2]);
    if (day < 1 || day > 31) return null;
    const timePart = cal[3]?.trim();
    const hm = timePart ? parseTimeToHm(timePart) : { h: 0, m: 0 };
    if (!hm) return null;
    return utcFromMonthDayTime(mon, day, hm, ref);
  }

  const wd = s.match(/\bResets?\s+([A-Za-z]{3,9})\s+(\d{1,2}:\d{2})\b/i);
  if (wd) {
    const d = WD[wd[1].toLowerCase()];
    if (d === undefined) return null;
    const hm = parseTimeToHm(wd[2]);
    if (!hm) return null;
    const target = nextWeekdayUtc(d, hm, ref);
    return target;
  }

  return null;
}

function parseRelativeDurationMs(chunk: string): number | null {
  let ms = 0;
  const re = /(\d+)\s*([dhms])/gi;
  let m: RegExpExecArray | null;
  let any = false;
  while ((m = re.exec(chunk)) !== null) {
    any = true;
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (!Number.isFinite(n) || n < 0) return null;
    if (u === 'd') ms += n * 86_400_000;
    else if (u === 'h') ms += n * 3_600_000;
    else if (u === 'm') ms += n * 60_000;
    else if (u === 's') ms += n * 1000;
  }
  return any ? ms : null;
}

function nextWeekdayUtc(weekday: number, hm: { h: number; m: number }, ref: Date): Date {
  const refWd = ref.getUTCDay();
  let add = (weekday - refWd + 7) % 7;
  const cand = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() + add, hm.h, hm.m, 0, 0);
  if (cand <= ref.getTime()) add += 7;
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() + add, hm.h, hm.m, 0, 0));
}

/** Human-readable countdown until target (UTC wall clock semantics). */
export function formatResetCountdown(target: Date, now: Date = new Date()): string {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return 'Reset due (refresh for latest)';
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (days > 0) return `in ${days}d ${h}h ${m}m`;
  if (h > 0) return `in ${h}h ${m}m`;
  if (m > 0) return `in ${m}m ${sec}s`;
  return `in ${sec}s`;
}
