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

