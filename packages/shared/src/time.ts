/**
 * Business-day helpers. A "business date" is the calendar date (YYYY-MM-DD) in the
 * platform time zone (default Asia/Hebron), computed on the server from the server clock.
 * Days run from local midnight to the next local midnight — not a rolling 24h window.
 */

export const DEFAULT_TIMEZONE = 'Asia/Hebron';

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Local calendar date string (YYYY-MM-DD) of `instant` in `timeZone`. */
export function businessDate(instant: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Offset (ms) of the zone relative to UTC at the given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * UTC instant at which the local calendar day `dateStr` starts in `timeZone`.
 * Handles DST gaps (if midnight doesn't exist, returns the first valid instant of that day).
 */
export function startOfBusinessDay(dateStr: string, timeZone: string = DEFAULT_TIMEZONE): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Two iterations converge for all real-world offsets.
  let ts = guess - zoneOffsetMs(new Date(guess), timeZone);
  ts = guess - zoneOffsetMs(new Date(ts), timeZone);
  // If DST gap pushed us into the previous day, walk forward to the first instant of dateStr.
  if (businessDate(new Date(ts), timeZone) !== dateStr) {
    let probe = ts;
    for (let i = 0; i < 48 && businessDate(new Date(probe), timeZone) !== dateStr; i++) probe += 30 * 60 * 1000;
    // Binary-search back to the exact boundary within the last 30 minutes.
    let lo = probe - 30 * 60 * 1000;
    let hi = probe;
    while (hi - lo > 1000) {
      const mid = Math.floor((lo + hi) / 2);
      if (businessDate(new Date(mid), timeZone) === dateStr) hi = mid;
      else lo = mid;
    }
    ts = hi;
  }
  return new Date(ts);
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** UTC instant when the next business day starts (i.e. the next local midnight). */
export function nextBusinessDayStart(instant: Date, timeZone: string = DEFAULT_TIMEZONE): Date {
  return startOfBusinessDay(addDays(businessDate(instant, timeZone), 1), timeZone);
}

/** Whole calendar days remaining until `endsAt`, counted in the platform zone (0 on the final day). */
export function daysRemaining(now: Date, endsAt: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  if (endsAt.getTime() <= now.getTime()) return 0;
  const a = businessDate(now, timeZone);
  const b = businessDate(new Date(endsAt.getTime() - 1), timeZone);
  const diff = (Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000;
  return Math.max(0, Math.round(diff));
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export interface OpeningInterval {
  day: Weekday;
  /** "HH:MM" local time */
  open: string;
  /** "HH:MM" local time; may be "24:00". If close <= open the interval runs past midnight. */
  close: string;
}

/** Whether a branch is open at `instant` given weekly intervals in `timeZone`. */
export function isOpenAt(hours: OpeningInterval[] | null | undefined, instant: Date, timeZone: string = DEFAULT_TIMEZONE): boolean | null {
  if (!hours || hours.length === 0) return null; // unknown
  const p = zonedParts(instant, timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() as Weekday;
  const minutes = p.hour * 60 + p.minute;
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  };
  for (const iv of hours) {
    const o = toMin(iv.open);
    const c = toMin(iv.close);
    if (c > o) {
      if (iv.day === weekday && minutes >= o && minutes < c) return true;
    } else {
      // overnight: open part today, remainder next day
      if (iv.day === weekday && minutes >= o) return true;
      if ((iv.day + 1) % 7 === weekday && minutes < c) return true;
    }
  }
  return false;
}
