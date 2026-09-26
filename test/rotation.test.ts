// Seam 2: the pure Rotation core. Rooms are plain letters in Room Order A→B→C→D.
import { expect, test } from "vitest";
import { complete, reentryCount, turn } from "../src/rotation.ts";

const ROOM_ORDER = ["A", "B", "C", "D"];

test("nobody has the Turn before the first Purchase", () => {
  expect(turn({ order: ROOM_ORDER, start: null, counts: new Map([["A", 0], ["B", 0], ["C", 0], ["D", 0]]) })).toBe(
    null,
  );
});

/** A Rotation over Room Order A→B→C→D where every Room takes part, with these counts. */
function rotation(start: string | null, counts: Record<string, number>) {
  return { order: ROOM_ORDER, start, counts: new Map(Object.entries(counts)) };
}

test("the Room with the fewest Purchases has the Turn", () => {
  expect(turn(rotation("A", { A: 2, B: 2, C: 1, D: 2 }))).toBe("C");
});

test("ties go by Room Order counted from the Rotation Start: Start A, A bought, so it's B's Turn", () => {
  expect(turn(rotation("A", { A: 1, B: 0, C: 0, D: 0 }))).toBe("B");
});

test("C buying early doesn't take the Turn from B", () => {
  expect(turn(rotation("A", { A: 1, B: 0, C: 1, D: 0 }))).toBe("B");
});

test("the Room Order wraps around after the last Room: Start C, C and D bought, so it's A's Turn", () => {
  expect(turn(rotation("C", { A: 0, B: 0, C: 1, D: 1 }))).toBe("A");
});

test("a Room buying out of turn is skipped once the others catch up", () => {
  // Start A. A bought, then C bought early while it was B's Turn.
  const early = { A: 1, B: 0, C: 1, D: 0 };
  expect(turn(rotation("A", early))).toBe("B");
  expect(turn(rotation("A", { ...early, B: 1 }))).toBe("D");
  expect(turn(rotation("A", { ...early, B: 1, D: 1 }))).toBe("A");
});

test("only the Rooms taking part can have the Turn", () => {
  // B is empty, so it isn't in the counts.
  expect(turn(rotation("A", { A: 1, C: 0, D: 0 }))).toBe("C");
});

test("a Rotation Start that no longer takes part still anchors the Room Order", () => {
  expect(turn(rotation("C", { A: 1, B: 1, D: 1 }))).toBe("D");
});

test("nobody has the Turn when no Room takes part", () => {
  expect(turn(rotation("A", {}))).toBe(null);
});

test("a Room re-entering a Rotation gets the lowest current count", () => {
  expect(reentryCount([3, 1, 2])).toBe(1);
});

test("a Room entering a Rotation nobody takes part in starts at zero", () => {
  expect(reentryCount([])).toBe(0);
});

test("the first Purchase makes its Room the Rotation Start and passes the Turn on", () => {
  const purchase = complete(rotation(null, { A: 0, B: 0, C: 0, D: 0 }), "C");

  expect(purchase.startedRotation).toBe(true);
  expect(purchase.rotation.start).toBe("C");
  expect(purchase.turn).toBe("D");
  expect(purchase.passedTo).toBe("D");
  expect(purchase.outOfTurn).toBe(null);
});

test("a Purchase by the Turn Room passes the Turn to the next Room", () => {
  const purchase = complete(rotation("A", { A: 1, B: 0, C: 0, D: 0 }), "B");

  expect(purchase.startedRotation).toBe(false);
  expect(purchase.rotation.counts.get("B")).toBe(1);
  expect(purchase.turn).toBe("C");
  expect(purchase.passedTo).toBe("C");
  expect(purchase.outOfTurn).toBe(null);
});

test("a Purchase out of turn names the Room that still holds the Turn, and passes nothing on", () => {
  const purchase = complete(rotation("A", { A: 1, B: 0, C: 0, D: 0 }), "C");

  expect(purchase.rotation.counts.get("C")).toBe(1);
  expect(purchase.outOfTurn).toBe("B");
  expect(purchase.turn).toBe("B");
  expect(purchase.passedTo).toBe(null);
});

test("the only Room taking part keeps the Turn, so it doesn't pass", () => {
  const purchase = complete(rotation("A", { A: 3 }), "A");

  expect(purchase.turn).toBe("A");
  expect(purchase.passedTo).toBe(null);
});
