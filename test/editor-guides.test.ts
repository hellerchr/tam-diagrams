import { describe, expect, it } from "vitest";
import { arrange, snapEdge, snapMove } from "../editor/guides.ts";

const box = (x: number, y: number, width = 100, height = 40) => ({ x, y, width, height });

describe("alignment help", () => {
  it("lines a moved box up with the edges and middles of others", () => {
    // Its left edge is 4 off another's left edge, its top 3 off another's top.
    const snapped = snapMove(box(204, 103), [box(200, 0), box(400, 100)], 6);
    expect(snapped).toMatchObject({ dx: -4, dy: -3 });
    expect(snapped.guides).toHaveLength(2);
    // Below another in its column it comes to rest a gap away, never touching, and an edge takes
    // no middle of another.
    expect(snapMove(box(200, 63), [box(200, 0)], 6)).toMatchObject({ dx: 0, dy: -3 });
    expect(snapMove(box(200, 43), [box(200, 0)], 6).dy).toBe(0);
    expect(snapMove(box(500, 23), [box(200, 0)], 6).dy).toBe(0);
    // The middle on a middle: 150 wide next to 100 wide.
    expect(snapMove(box(178, 200, 150), [box(200, 0)], 6).dx).toBe(-3);
    expect(snapMove(box(250, 300), [box(0, 0)], 6)).toEqual({
      dx: 0,
      dy: 0,
      x: false,
      y: false,
      guides: [],
    });
  });

  it("stands a moved box halfway between its neighbours, or a gap on from them", () => {
    // Between two in its row: gaps of 55 on both sides.
    expect(snapMove(box(158, 5), [box(0, 0), box(310, 0)], 6).dx).toBe(-3);
    // After two in a row that stand 30 apart: 30 from the second.
    const rhythm = snapMove(box(263, 5), [box(0, 0), box(130, 0)], 6);
    expect(rhythm.dx).toBe(-3);
    // Two lines across the equal gaps, and one for the tops in line.
    expect(rhythm.guides).toHaveLength(3);
    // Boxes out of its row do not count.
    expect(snapMove(box(158, 500), [box(0, 0), box(310, 0)], 6).dx).toBe(0);
  });

  it("rests a dragged edge on the edges of others", () => {
    expect(snapEdge(297, "x", box(100, 0, 197), [box(0, 200, 300)], 6).value).toBe(300);
    expect(snapEdge(250, "x", box(100, 0, 150), [box(0, 200, 300)], 6)).toEqual({ value: 250 });
  });

  it("aligns boxes on the box around them and spreads them evenly", () => {
    const boxes = new Map([
      ["a", box(0, 0)],
      ["b", box(130, 20, 60)],
      ["c", box(400, 50)],
    ]);
    expect(arrange(boxes, "left")).toEqual(
      new Map([
        ["b", { x: -130, y: 0 }],
        ["c", { x: -400, y: 0 }],
      ]),
    );
    expect(arrange(boxes, "middle").get("b")).toEqual({ x: 0, y: 5 });
    expect(arrange(boxes, "right").get("b")).toEqual({ x: 310, y: 0 });
    // 500 across, 260 filled: gaps of 120. The outermost stay.
    expect(arrange(boxes, "spread-x")).toEqual(new Map([["b", { x: 90, y: 0 }]]));
    expect(arrange(new Map([...boxes].slice(0, 2)), "spread-x").size).toBe(0);
  });
});
