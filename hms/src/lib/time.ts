/**
 * Time helpers. Storage is UTC; display and "business day" logic use the hospital timezone.
 * Africa/Lagos is UTC+1 with no DST today, but we go through Intl rather than hardcoding +1.
 */
export const HOSPITAL_TZ = "Africa/Lagos";

function partsInTz(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset (ms) of tz relative to UTC at the given instant. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = partsInTz(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a wall-clock time in the hospital timezone to a UTC Date. */
export function zonedWallTimeToUtc(
  y: number,
  m: number,
  d: number,
  hh = 0,
  mm = 0,
  tz: string = HOSPITAL_TZ,
): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = tzOffsetMs(guess, tz);
  return new Date(guess.getTime() - offset);
}

/** "YYYY-MM-DD" of the instant as seen in the hospital timezone. */
export function toLocalDateString(date: Date, tz: string = HOSPITAL_TZ): string {
  const p = partsInTz(date, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:mm" in the hospital timezone. */
export function toLocalTimeString(date: Date, tz: string = HOSPITAL_TZ): string {
  const p = partsInTz(date, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function parseLocalDate(value: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid date: ${value}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return { y, m, d };
}

/** UTC range [start, end) covering a local calendar day in the hospital timezone. */
export function localDayRange(localDate: string, tz: string = HOSPITAL_TZ): { start: Date; end: Date } {
  const { y, m, d } = parseLocalDate(localDate);
  const start = zonedWallTimeToUtc(y, m, d, 0, 0, tz);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = zonedWallTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz);
  return { start, end };
}

/** Parse "YYYY-MM-DD" + "HH:mm" local wall time to UTC. */
export function localDateTimeToUtc(localDate: string, localTime: string, tz: string = HOSPITAL_TZ): Date {
  const { y, m, d } = parseLocalDate(localDate);
  const t = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!t) throw new Error(`Invalid time: ${localTime}`);
  const hh = Number(t[1]);
  const mm = Number(t[2]);
  if (hh > 23 || mm > 59) throw new Error(`Invalid time: ${localTime}`);
  return zonedWallTimeToUtc(y, m, d, hh, mm, tz);
}

export function todayLocal(now: Date = new Date(), tz: string = HOSPITAL_TZ): string {
  return toLocalDateString(now, tz);
}

/**
 * Age in completed years on `asOf` (in hospital-local calendar terms). DOB is a calendar date
 * stored as UTC midnight (Postgres DATE).
 */
export function ageInYears(dob: Date, asOf: Date = new Date(), tz: string = HOSPITAL_TZ): number {
  const today = parseLocalDate(toLocalDateString(asOf, tz));
  const by = dob.getUTCFullYear();
  const bm = dob.getUTCMonth() + 1;
  const bd = dob.getUTCDate();
  let age = today.y - by;
  if (today.m < bm || (today.m === bm && today.d < bd)) age -= 1;
  return age;
}

/** Human readable age: "3 days", "7 months", "34 years". */
export function formatAge(dob: Date, asOf: Date = new Date(), tz: string = HOSPITAL_TZ): string {
  const years = ageInYears(dob, asOf, tz);
  if (years >= 2) return `${years} yrs`;
  const today = parseLocalDate(toLocalDateString(asOf, tz));
  let months = (today.y - dob.getUTCFullYear()) * 12 + (today.m - (dob.getUTCMonth() + 1));
  if (today.d < dob.getUTCDate()) months -= 1;
  if (months >= 1) return `${months} mo`;
  const todayUtc = Date.UTC(today.y, today.m - 1, today.d);
  const days = Math.round((todayUtc - dob.getTime()) / 86_400_000);
  return `${Math.max(days, 0)} d`;
}

const dateFmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions, tz: string) {
  const key = JSON.stringify(opts) + tz;
  let f = dateFmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-NG", { ...opts, timeZone: tz });
    dateFmtCache.set(key, f);
  }
  return f;
}

export function formatDateTime(date: Date | string, tz: string = HOSPITAL_TZ): string {
  return fmt({ day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }, tz).format(
    new Date(date),
  );
}

export function formatDate(date: Date | string, tz: string = HOSPITAL_TZ): string {
  return fmt({ day: "2-digit", month: "short", year: "numeric" }, tz).format(new Date(date));
}

/** For DATE columns (stored as UTC midnight) - format without timezone shifting. */
export function formatCalendarDate(date: Date | string): string {
  return fmt({ day: "2-digit", month: "short", year: "numeric" }, "UTC").format(new Date(date));
}

export function formatTime(date: Date | string, tz: string = HOSPITAL_TZ): string {
  return fmt({ hour: "2-digit", minute: "2-digit", hour12: false }, tz).format(new Date(date));
}

/** Convert "YYYY-MM-DD" to a Date at UTC midnight (for Postgres DATE columns). */
export function calendarDateToUtcMidnight(value: string): Date {
  const { y, m, d } = parseLocalDate(value);
  return new Date(Date.UTC(y, m - 1, d));
}
