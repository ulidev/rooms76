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
