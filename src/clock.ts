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

/** A calendar date as people read it, e.g. "26 Sep 2026". */
export function formatDate(date: CalendarDate): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month! - 1]} ${year}`;
}
