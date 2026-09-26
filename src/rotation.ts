// The Rotation core: the pure rules for whose Turn it is. It does no I/O and has no
// clock; every input is passed in.
//
// It's generic on purpose: participants are Rooms and completions are Purchases
// today, but nothing here depends on that, so other rotations can reuse it.

export interface Rotation<P> {
  /** Every participant that could take part, in their fixed order (the Room Order). */
  order: readonly P[];
  /** The participant who completed first; the order is counted from it. Null before anyone has. */
  start: P | null;
  /** The participants taking part now, each with its count of completions. */
  counts: ReadonlyMap<P, number>;
}

/**
 * Whose Turn it is: the participant with the fewest completions, ties broken by the
 * order counted cyclically from the start. Null when nobody has completed yet, or
 * when nobody takes part.
 */
export function turn<P>({ order, start, counts }: Rotation<P>): P | null {
  if (start === null) return null;
  const startPosition = order.indexOf(start);
  if (startPosition === -1) throw new Error("The start isn't in the order");

  // The order counted from the start: with start C in A→B→C→D, that's C→D→A→B.
  const fromStart = [...order.slice(startPosition), ...order.slice(0, startPosition)];
  let holder: P | null = null;
  for (const participant of fromStart) {
    const count = counts.get(participant);
    if (count === undefined) continue;
    if (holder === null || count < counts.get(holder)!) holder = participant;
  }
  return holder;
}

/**
 * The count a participant gets when it (re-)enters a Rotation: the lowest count of those
 * taking part, so it inherits neither a debt nor a credit. Zero when nobody takes part.
 */
export function reentryCount(counts: Iterable<number>): number {
  const all = [...counts];
  return all.length === 0 ? 0 : Math.min(...all);
}

/** What one completion did to a Rotation. */
export interface Completion<P> {
  /** The Rotation after it. */
  rotation: Rotation<P>;
  /** True for the first completion, which made its participant the start. */
  startedRotation: boolean;
  /** For a completion out of turn: the participant that held the Turn, and still does. */
  outOfTurn: P | null;
  /** Whose Turn it is after it. */
  turn: P | null;
  /** The participant the Turn passed to, or null when it stayed where it was. */
  passedTo: P | null;
}

/** Counts one completion by a participant taking part in the Rotation. */
export function complete<P>(rotation: Rotation<P>, participant: P): Completion<P> {
  const count = rotation.counts.get(participant);
  if (count === undefined) throw new Error("Only participants taking part can complete");

  const turnBefore = turn(rotation);
  const counts = new Map(rotation.counts).set(participant, count + 1);
  const after: Rotation<P> = { ...rotation, start: rotation.start ?? participant, counts };
  const turnAfter = turn(after);
  return {
    rotation: after,
    startedRotation: rotation.start === null,
    outOfTurn: turnBefore !== null && turnBefore !== participant ? turnBefore : null,
    turn: turnAfter,
    passedTo: turnAfter !== participant && turnAfter !== turnBefore ? turnAfter : null,
  };
}
