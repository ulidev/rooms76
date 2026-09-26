// The Urgency core: the pure rules for how long a Purchase of a Common Item lasts and how
// pressing it is to buy it. Like the Rotation core, it does no I/O and has no clock; every
// input is passed in. Instants are milliseconds since the epoch.
import { DAY } from "./clock.ts";

/** How many of the latest intervals between Purchases are learned from. */
const INTERVALS_LEARNED = 5;

/** While there are fewer real intervals than this, the rough guess counts as one more. */
const INTERVALS_TO_DROP_GUESS = 3;

/** The share of the Expected Duration after which a Common Item is Due soon. */
const DUE_SOON_SHARE = 0.75;

/** A time someone taking part lived in the Apartment: from an instant, until another one (excluded) or still. */
export interface StaySpan {
  from: number;
  to: number | null;
}

/** What Expected Duration is learned from. */
export interface DurationHistory {
  /** When each Purchase that still counts was made, in any order. */
  purchases: readonly number[];
  /** When each Resident of the Rooms taking part lived here, one entry per Stay. */
  stays: readonly StaySpan[];
  /** The rough guess in person-days, or null when there's none. */
  roughGuess: number | null;
  /** How many Residents take part now. */
  headcountNow: number;
}

export type Urgency = "run-out" | "due-soon" | "not-yet";

/** How pressing a Common Item is at an instant. */
export interface Assessment {
  /** The Expected Duration in days for the Residents taking part now, or null when there's no estimate. */
  expectedDuration: number | null;
  urgency: Urgency;
  /**
   * What ranks it within its Urgency, higher first: for Run Out, how long it has stood (ms);
   * otherwise the share of its Expected Duration that has passed since the last Purchase.
   * Null when it has no estimate or was never bought.
   */
  score: number | null;
}

/**
 * How long a Purchase lasts, in days, for the Residents taking part now. Each interval between
 * consecutive Purchases is learned in person-days; the learned value is the median of the last
 * few, with the rough guess as one more while there are few. Null when there's no estimate.
 */
export function expectedDuration({ purchases, stays, roughGuess, headcountNow }: DurationHistory): number | null {
  if (headcountNow <= 0) return null;
  const sorted = [...purchases].sort((a, b) => a - b);
  const intervals = sorted.slice(1).map((end, index) => personDays(stays, sorted[index]!, end));
  const learned = intervals.slice(-INTERVALS_LEARNED);
  if (learned.length < INTERVALS_TO_DROP_GUESS && roughGuess !== null) learned.push(roughGuess);
  if (learned.length === 0) return null;
  return median(learned) / headcountNow;
}

/** A Common Item's Expected Duration, Urgency and ranking score at an instant. */
export function assess(input: DurationHistory & { runOutSince: number | null; now: number }): Assessment {
  const duration = expectedDuration(input);
  if (input.runOutSince !== null) {
    return { expectedDuration: duration, urgency: "run-out", score: input.now - input.runOutSince };
  }
  const lastPurchase = input.purchases.length === 0 ? null : Math.max(...input.purchases);
  if (duration === null || lastPurchase === null) return { expectedDuration: duration, urgency: "not-yet", score: null };
  const elapsed = (input.now - lastPurchase) / DAY;
  // Something that lasts no time at all is due as soon as it's bought.
  const share = duration > 0 ? elapsed / duration : Infinity;
  return { expectedDuration: duration, urgency: share >= DUE_SOON_SHARE ? "due-soon" : "not-yet", score: share };
}

const URGENCY_RANK: Record<Urgency, number> = { "run-out": 0, "due-soon": 1, "not-yet": 2 };

/** Orders assessments most pressing first: by Urgency, then by score, those without a score last. */
export function byUrgency(a: Assessment, b: Assessment): number {
  const levels = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
  if (levels !== 0) return levels;
  if (a.score === null || b.score === null) return (a.score === null ? 1 : 0) - (b.score === null ? 1 : 0);
  return b.score - a.score;
}

/** The person-days lived between two instants: each Resident's days here, added up. */
function personDays(stays: readonly StaySpan[], from: number, to: number): number {
  let lived = 0;
  for (const stay of stays) {
    const overlap = Math.min(stay.to ?? Infinity, to) - Math.max(stay.from, from);
    if (overlap > 0) lived += overlap;
  }
  return lived / DAY;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
