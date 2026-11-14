// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Box, Point } from "../src/scene.ts";
import { CLEAR } from "../src/swimlane-place.ts";
import {
  clearanceAt,
  type PortStubs,
  segmentBlocker,
  stubClearGrid,
  stubEnds,
} from "../src/swimlane-stub-clear.ts";

/**
 * Two wires, e1 from (0,0) to (100,0) and e2 from (0,50) to (100,50); each stub ends 10.2 px along x,
 * the second one 5 px further (stub length).
 */
const placed: PortStubs = {
  portPoints: new Map<string, [Point, Point]>([
    ["e1", [{ x: 0, y: 0 }, { x: 100, y: 0 }]],
    ["e2", [{ x: 0, y: 50 }, { x: 100, y: 50 }]],
  ]),
  sides: new Map([
    ["e1", ["left", "right"]],
    ["e2", ["left", "right"]],
  ]),
  stub: (point, _side, extra = 0) => ({ x: point.x + 10.2 + extra, y: point.y }),
  stubLength: new Map([
    ["e1:0", 0],
    ["e1:1", 5],
    ["e2:0", 0],
    ["e2:1", 5],
  ]),
};

describe("the stub ends of a wire", () => {
  it("are its two rounded stub points, not those of the other wires", () => {
    expect([...stubEnds(placed, "e1")].toSorted()).toEqual(["10,0", "115,0"]);
    expect([...stubEnds(placed, "e2")].toSorted()).toEqual(["10,50", "115,50"]);
  });
});

describe("the clearance a unit segment keeps from shapes", () => {
  const ends = stubEnds(placed, "e1");

  it("is 1 px when either endpoint is a stub end, so the wire never touches a shape", () => {
    expect(clearanceAt(ends, { x: 10, y: 0 }, { x: 20, y: 0 })).toBe(1);
    expect(clearanceAt(ends, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(1);
    expect(clearanceAt(ends, { x: 115, y: 0 }, { x: 115, y: 5 })).toBe(1);
  });

  it("stays CLEAR when neither endpoint is one, also on the stub end's row", () => {
    expect(clearanceAt(ends, { x: 20, y: 0 }, { x: 30, y: 0 })).toBe(CLEAR);
    expect(clearanceAt(ends, { x: 10, y: 5 }, { x: 20, y: 5 })).toBe(CLEAR);
  });
});

describe("the grid blocked with the clearance lowered at a wire's stub ends", () => {
  it("blocks a segment exactly when it keeps CLEAR from shapes, so only that wire's stub ends are freed", () => {
    const xs = [0, 10, 20, 30, 115, 130],
      ys = [0, 5, 50];
    // A neighbour that blocks every segment unless the segment keeps a lowered clearance.
    const grid = stubClearGrid(placed, "e1", xs, ys, (_a, _b, clearance) => clearance === CLEAR);
    expect(grid.h).toEqual([
      [false, false, true, false, false],
      [true, true, true, true, true],
      // e2's stub ends (10,50) and (115,50) stay blocked: they are not this wire's.
      [true, true, true, true, true],
    ]);
    expect(grid.v).toEqual([
      [true, true],
      [false, true],
      [true, true],
      [true, true],
      [false, true],
      [true, true],
    ]);
  });

  it("hands the lowered clearance to the shape test along with the segment", () => {
    const seen: [Point, Point, number][] = [];
    stubClearGrid(placed, "e1", [10, 20], [0], (a, b, clearance) => {
      seen.push([a, b, clearance]);
      return false;
    });
    expect(seen).toEqual([[{ x: 10, y: 0 }, { x: 20, y: 0 }, 1]]);
  });
});

describe("the test for a blocked unit segment", () => {
  const shape: Box = { x: 100, y: 100, width: 50, height: 50 },
    head: Box = { x: 200, y: 0, width: 20, height: 20 },
    header: Box = { x: 0, y: 300, width: 100, height: 30 };
  const blocked = segmentBlocker([shape], [head], [header]);
  const hits = (a: Point, b: Point) => [0, 1, CLEAR].map((clearance) => blocked(a, b, clearance));

  it("keeps a segment CLEAR from a shape by default, and only the given clearance otherwise", () => {
    // Ends 5 px short of the shape: inside CLEAR, outside 1 px.
    const a = { x: 80, y: 125 },
      b = { x: 95, y: 125 };
    expect(blocked(a, b)).toBe(true);
    expect(hits(a, b)).toEqual([false, false, true]);
    expect(hits({ x: 80, y: 125 }, { x: 110, y: 125 })).toEqual([true, true, true]);
  });

  it("blocks a segment through a marker at any clearance, and does not grow the marker", () => {
    expect(hits({ x: 190, y: 10 }, { x: 210, y: 10 })).toEqual([true, true, true]);
    expect(hits({ x: 190, y: 10 }, { x: 199, y: 10 })).toEqual([false, false, false]);
  });

  it("blocks a segment through a lane header at any clearance, and does not grow the header", () => {
    expect(hits({ x: 50, y: 290 }, { x: 50, y: 310 })).toEqual([true, true, true]);
    expect(hits({ x: 50, y: 290 }, { x: 50, y: 299 })).toEqual([false, false, false]);
  });

  it("lets a segment pass that is clear of everything", () => {
    expect(hits({ x: 160, y: 125 }, { x: 180, y: 125 })).toEqual([false, false, false]);
  });
});
