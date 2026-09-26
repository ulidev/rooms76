export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A calendar date in the Apartment time zone, formatted YYYY-MM-DD. */
export type CalendarDate = string;

/** The calendar date of an instant in the given IANA time zone. */
export function dateIn(timeZone: string, instant: Date): CalendarDate {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    instant,
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** A calendar date as people read it, e.g. "26 Sep 2026". */
export function formatDate(date: CalendarDate): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month! - 1]} ${year}`;
}

/** An instant as people read it in the given IANA time zone, e.g. "26 Sep 2026, 09:05". */
export function formatInstant(timeZone: string, instant: Date): string {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    instant,
  );
  return `${formatDate(dateIn(timeZone, instant))}, ${time}`;
}

/** The instant a calendar date starts in the given IANA time zone. */
export function startOfDay(timeZone: string, date: CalendarDate): Date {
  const midnightUtc = Date.parse(`${date}T00:00:00Z`);
  // The zone's offset at UTC midnight, corrected once more in case it differs at local midnight.
  const guess = midnightUtc - offsetAt(timeZone, midnightUtc);
  return new Date(midnightUtc - offsetAt(timeZone, guess));
}

/** How far ahead of UTC the time zone's clocks are at an instant, in milliseconds. */
function offsetAt(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  const wallClock = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return wallClock - (instant - (instant % 1000));
}

/** The calendar date this many days after (or, when negative, before) the given one. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

/**
 * Reads a calendar date the way people type it: "12 Sep 2026" (month names in English,
 * any case, abbreviated or not) or "2026-09-12". Returns null for anything else,
 * including days that don't exist, like 31 Sep.
 */
export function parseDate(text: string): CalendarDate | null {
  const iso = text.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const written = text.trim().match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/i);
  let year: number, month: number, day: number;
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (written) {
    // "Sep", "Sept" and "September" all read as September; at least three letters are needed.
    const name = written[2]!.toLowerCase();
    month = MONTH_NAMES.findIndex((full) => name.length >= 3 && full.startsWith(name)) + 1;
    if (month === 0) return null;
    [year, day] = [Number(written[3]), Number(written[1])];
  } else {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

