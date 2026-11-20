// Tests of the diagram editor's alignment help: snapping a moved box, arranging a selection, the selection band.
import assert from "node:assert/strict";
import { test } from "vitest";
import { arrange, around, band, encloses, snapMove } from "./diagram-arrange.ts";

const box = (x: number, y: number, width = 100, height = 40) => ({ x, y, width, height });

test("around is the box around all", () => {
  assert.deepEqual(around([box(10, 20), box(200, 0, 50, 100)]), {
    x: 10,
    y: 0,
    width: 240,
    height: 100,
  });
});

test("a moved box snaps its left edge onto a neighbour's within reach, with a guide", () => {
  const moved = snapMove(box(103, 200), [box(100, 0)], 5);
  assert.equal(moved.dx, -3);
  assert.equal(moved.guides.length >= 1, true);
  assert.equal(moved.guides[0]![0].x, 100);
});

test("a box out of reach does not snap", () => {
  const moved = snapMove(box(150, 300), [box(0, 0)], 5);
  assert.deepEqual([moved.dx, moved.dy, moved.guides.length], [0, 0, 0]);
});

test("a box beside another keeps the gap rather than touching it", () => {
  // Facing edges: 100+100 = 200, the gap is 20, so the left edge comes to rest at 220.
  const moved = snapMove(box(217, 0), [box(100, 0)], 5);
  assert.equal(moved.dx, 3);
});

test("align left moves every box to the leftmost edge; one that stands there is left out", () => {
  const steps = arrange(
    new Map([
      ["a", box(10, 0)],
      ["b", box(50, 100)],
    ]),
    "left",
  );
  assert.deepEqual([...steps], [["b", { x: -40, y: 0 }]]);
});

test("align middle centers boxes of different heights on one line", () => {
  const steps = arrange(
    new Map([
      ["a", box(0, 0, 100, 100)],
      ["b", box(200, 0, 100, 20)],
    ]),
    "middle",
  );
  assert.deepEqual(steps.get("b"), { x: 0, y: 40 });
});

test("spreading evens out the gaps and keeps the outermost; two boxes are not spread", () => {
  const boxes = new Map([
    ["a", box(0, 0)],
    ["b", box(110, 0)],
    ["c", box(400, 0)],
  ]);
  assert.deepEqual([...arrange(boxes, "spread-x")], [["b", { x: 90, y: 0 }]]);
  assert.equal(arrange(new Map([...boxes].slice(0, 2)), "spread-x").size, 0);
});

test("a band covers its corners in any order and encloses what lies wholly inside", () => {
  const b = band({ x: 100, y: 100 }, { x: 0, y: 0 });
  assert.deepEqual(b, { x: 0, y: 0, width: 100, height: 100 });
  assert.equal(encloses(b, box(10, 10, 50, 50)), true);
  assert.equal(encloses(b, box(60, 10, 50, 50)), false);
});
