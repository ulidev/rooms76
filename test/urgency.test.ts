// Seam 2: the pure Urgency core. Instants are counted in days from day 0.
import { expect, test } from "vitest";
import { DAY } from "../src/clock.ts";
import { assess, byUrgency, expectedDuration, type DurationHistory } from "../src/urgency.ts";


/** The instant this many days after day 0. */
const day = (days: number) => days * DAY;

/** Someone living here the whole time. */
const ALWAYS = { from: day(-1000), to: null };

/** A history with these Purchases (on these days), where `residents` people always live here. */
function history(purchaseDays: number[], residents: number, roughGuess: number | null = null): DurationHistory {
  return {
    purchases: purchaseDays.map(day),
    stays: Array.from({ length: residents }, () => ALWAYS),
    roughGuess,
    headcountNow: residents,
  };
}

test("with no rough guess and fewer than 2 Purchases there's no estimate", () => {
  expect(expectedDuration(history([], 3))).toBe(null);
  expect(expectedDuration(history([0], 3))).toBe(null);
});

test("with only a rough guess, it's the guess shared by the Residents taking part now", () => {
  expect(expectedDuration(history([], 3, 21))).toBe(7);
  expect(expectedDuration(history([0], 3, 21))).toBe(7);
});

test("an interval is learned in person-days and scaled to the Residents taking part now", () => {
  // 2 Residents made one Purchase last 10 days: 20 person-days. Now there are 4 of them.
  expect(expectedDuration({ ...history([0, 10], 2), headcountNow: 4 })).toBe(5);
});

test("an interval's headcount is the time-weighted average number of Residents during it", () => {
  // 2 Residents for the first 5 days, 4 for the next 5: 3 on average, so 30 person-days.
  const stays = [ALWAYS, ALWAYS, { from: day(5), to: null }, { from: day(5), to: null }];
  expect(expectedDuration({ purchases: [day(0), day(10)], stays, roughGuess: null, headcountNow: 3 })).toBe(10);
});

test("a Resident who moved out only counts while they lived here", () => {
  // 1 Resident all along, another only for the first 4 of 8 days: 1.5 on average, so 12 person-days.
  const stays = [ALWAYS, { from: day(-3), to: day(4) }];
  expect(expectedDuration({ purchases: [day(0), day(8)], stays, roughGuess: null, headcountNow: 1 })).toBe(12);
});

test("the rough guess counts as one more interval while there are fewer than 3 real ones", () => {
  // 1 Resident, so days are person-days. One interval of 10 and the guess of 60: median 35.
  expect(expectedDuration(history([0, 10], 1, 60))).toBe(35);
  // Intervals of 10 and 20 and the guess of 90: median 20.
  expect(expectedDuration(history([0, 10, 30], 1, 90))).toBe(20);
});

test("the rough guess drops out at the third real interval", () => {
  // Intervals of 10, 20 and 30: median 20. With the guess of 90 it would be 25.
  expect(expectedDuration(history([0, 10, 30, 60], 1, 90))).toBe(20);
});

test("only the last 5 intervals are learned from, and their median is taken", () => {
  // Intervals of 100, then 10, 20, 30, 40 and 50: the last 5 have median 30. All 6 would give 35.
  expect(expectedDuration(history([0, 100, 110, 130, 160, 200, 250], 1))).toBe(30);
});

test("the order Purchases are handed in doesn't matter", () => {
  expect(expectedDuration(history([30, 0, 10], 1))).toBe(15);
});

test("with nobody taking part now there's no estimate", () => {
  expect(expectedDuration({ ...history([0, 10], 2), headcountNow: 0 })).toBe(null);
});

/** A Common Item bought on these days by 1 Resident, assessed on day `now`. */
function assessed(purchaseDays: number[], now: number, { roughGuess = null as number | null, runOutSince = null as number | null } = {}) {
  return assess({ ...history(purchaseDays, 1, roughGuess), runOutSince: runOutSince === null ? null : day(runOutSince), now: day(now) });
}

test("a Common Item becomes Due soon once 75% of its Expected Duration has passed since the last Purchase", () => {
  // Expected Duration 8 days, last bought on day 8: Due soon from day 14.
  expect(assessed([0, 8], 13.99).urgency).toBe("not-yet");
  expect(assessed([0, 8], 14).urgency).toBe("due-soon");
});

test("there's no Overdue: past its Expected Duration a Common Item stays Due soon, ranked higher", () => {
  const dueSoon = assessed([0, 8], 14);
  const pastIt = assessed([0, 8], 30);
  expect(pastIt.urgency).toBe("due-soon");
  expect(pastIt.elapsedShare).toBeGreaterThan(dueSoon.elapsedShare!);
});

test("a Common Item not Run Out is ranked by the share of its Expected Duration that has passed", () => {
  const item = assessed([0, 8], 12);
  expect(item.expectedDuration).toBe(8);
  expect(item.elapsedShare).toBe(0.5);
  expect(item.runOutFor).toBe(null);
});

test("an uncleared Run Out makes a Common Item Run Out, whatever the clock says", () => {
  const item = assessed([0, 8], 9, { runOutSince: 8.5 });
  expect(item.urgency).toBe("run-out");
  expect(item.runOutFor).toBe(0.5 * DAY);
});

test("a Common Item without an estimate is Not yet and has no share of it passed", () => {
  const item = assessed([0], 400);
  expect(item).toEqual({ expectedDuration: null, urgency: "not-yet", runOutFor: null, elapsedShare: null });
});

test("a Common Item that was never bought has no share of its Expected Duration passed, even with a rough guess", () => {
  const item = assessed([], 400, { roughGuess: 7 });
  expect(item.expectedDuration).toBe(7);
  expect(item.urgency).toBe("not-yet");
  expect(item.elapsedShare).toBe(null);
});

test("Common Items rank Run Out first, longest-standing first, then by share of Expected Duration, and no estimate last", () => {
  const items = {
    newRunOut: assessed([0, 8], 20, { runOutSince: 19 }),
    oldRunOut: assessed([0, 8], 20, { runOutSince: 10 }),
    halfway: assessed([0, 8], 12),
    dueSoon: assessed([0, 8], 15),
    noEstimate: assessed([0], 20),
    barelyStarted: assessed([0, 8], 9),
  };

  const ranked = Object.entries(items)
    .sort(([, a], [, b]) => byUrgency(a, b))
    .map(([name]) => name);

  expect(ranked).toEqual(["oldRunOut", "newRunOut", "dueSoon", "halfway", "barelyStarted", "noEstimate"]);
});
