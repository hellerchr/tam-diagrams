import { describe, expect, it } from "vitest";
import { occupiedPoints } from "../src/swimlane-points";
import type { Tier } from "../src/swimlane-tiers";

describe("the points wires end or turn at", () => {
  // Columns at half-pixel spacing next to one far off; two rows.
  const xs = [0, 0.5, 1, 10],
    ys = [0, 5];
  const tiers: Tier[] = ["strict", "apart", "relaxed"];
  const row = (taken: (i: number, j: number) => boolean, j: number) =>
    [0, 1, 2, 3].map((i) => taken(i, j));

  it("reserve the grid points within half a pixel of a bend, and no others", () => {
    const occupied = occupiedPoints(xs, ys);
    occupied.bend({ x: 0.5, y: 0 });
    const taken = occupied.view(true, "strict");
    expect(row(taken, 0)).toEqual([true, true, true, false]);
    expect(row(taken, 1)).toEqual([false, false, false, false]);
  });

  it("reserve the grid points above and below a bend as well, but not those a pixel away", () => {
    const occupied = occupiedPoints([0, 10], [0, 0.5, 1, 1.5]);
    occupied.bend({ x: 0, y: 0.5 });
    const taken = occupied.view(true, "strict");
    expect([0, 1, 2, 3].map((j) => taken(0, j))).toEqual([true, true, true, false]);
    expect([0, 1, 2, 3].map((j) => taken(1, j))).toEqual([false, false, false, false]);
  });

  it("reserve a bend in strict and apart but never in relaxed", () => {
    const occupied = occupiedPoints(xs, ys);
    occupied.bend({ x: 10, y: 5 });
    expect(tiers.map((tier) => occupied.view(true, tier)(3, 1))).toEqual([true, true, false]);
  });

  it("reach around a stub end in strict and apart, and only its own cell otherwise", () => {
    const occupied = occupiedPoints(xs, ys);
    occupied.terminal({ x: 0.5, y: 0 });
    expect(tiers.map((tier) => occupied.view(true, tier)(0, 0))).toEqual([true, true, false]);
    for (const tier of tiers)
      expect(row(occupied.view(false, tier), 0)).toEqual([false, true, false, false]);
    expect(row(occupied.view(true, "relaxed"), 0)).toEqual([false, true, false, false]);
  });

  it("send a route back only when it passes through another wire's point", () => {
    const occupied = occupiedPoints(xs, ys);
    occupied.bend({ x: 1, y: 0 });
    const clear = [
        { x: 0, y: 0 },
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ],
      across = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 10, y: 0 },
      ];
    expect(occupied.crossed(clear)).toBe(false);
    expect(occupied.crossed(across)).toBe(true);
    const again = [{ x: 0, y: 0 }];
    expect(occupied.settle(clear, () => again)).toBe(clear);
    expect(occupied.settle(across, () => again)).toBe(again);
    expect(occupied.settle(null, () => again)).toBeNull();
  });

  it("keep the route as found when searching again does not get clear of them", () => {
    const occupied = occupiedPoints(xs, ys);
    occupied.bend({ x: 1, y: 0 });
    occupied.bend({ x: 10, y: 5 });
    const found = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 10, y: 0 },
      ],
      stillAcross = [
        { x: 0, y: 0 },
        { x: 0, y: 5 },
        { x: 10, y: 5 },
        { x: 10, y: 0 },
      ];
    expect(occupied.crossed(stillAcross)).toBe(true);
    expect(occupied.settle(found, () => stillAcross)).toBe(found);
    expect(occupied.settle(found, () => null)).toBe(found);
  });

  it("let a route end on a reserved point of its own", () => {
    const occupied = occupiedPoints(xs, ys);
    occupied.terminal({ x: 10, y: 5 });
    const own = [
      { x: 0, y: 0 },
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ];
    expect(occupied.crossed(own)).toBe(false);
  });

  it("let a route leave its own stub end past the grid point beside it", () => {
    const occupied = occupiedPoints(xs, ys);
    occupied.terminal({ x: 0.5, y: 0 });
    const leaving = [
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(occupied.crossed(leaving)).toBe(false);
    expect(occupied.crossed([{ x: 10, y: 5 }, ...leaving.slice(1, 2), { x: 10, y: 0 }])).toBe(true);
  });
});
