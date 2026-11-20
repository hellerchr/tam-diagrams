// The diagram canvas's marks and drag math: handles and dots on screen, the grid, one axis, the least size.
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  alongOneAxis,
  awayFromView,
  dropPlace,
  endNear,
  HANDLES,
  handleAt,
  handlePoints,
  linkPoints,
  moveStep,
  onGrid,
  resized,
} from "./diagram-marks.ts";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const view = { x: 10, y: 20, zoom: 2 };

test("handles grab on the box's corners and middles, and a press within their size takes one", () => {
  const spots = handlePoints(view, box(0, 0, 50, 20));
  assert.deepEqual(spots[0], { handle: HANDLES[0], x: 10, y: 20 });
  assert.deepEqual(spots[4], { handle: HANDLES[4], x: 110, y: 60 });
  assert.equal(handleAt(view, box(0, 0, 50, 20), { x: 112, y: 60 })?.cursor, "nwse-resize");
  assert.equal(handleAt(view, box(0, 0, 50, 20), { x: 60, y: 40 }), undefined);
});

test("the connection dots stand 22 pixels out from the middle of each side, at every zoom", () => {
  assert.deepEqual(linkPoints(view, box(0, 0, 50, 20)), [
    { x: 60, y: -2 },
    { x: 132, y: 40 },
    { x: 60, y: 82 },
    { x: -12, y: 40 },
  ]);
});

test("the grid, one axis with Shift, and where a new element stands", () => {
  assert.equal(onGrid(14, false), 10);
  assert.equal(onGrid(15.4, true), 15);
  assert.deepEqual(alongOneAxis({ x: 5, y: -9 }, true), { x: 0, y: -9 });
  assert.deepEqual(alongOneAxis({ x: 5, y: -9 }, false), { x: 5, y: -9 });
  assert.deepEqual(dropPlace("agent", { x: 100, y: 100 }, false), { x: 50, y: 80 });
  assert.deepEqual(dropPlace("agent", { x: 101, y: 103 }, true), { x: 53, y: 83 });
});

test("a move lines up with an edge nearby, else its first element lands on the grid", () => {
  const base = {
    moving: box(3, 100, 40, 20),
    lead: { x: 3, y: 100 },
    others: [box(100, 0, 40, 20)],
  };
  const lined = moveStep(base, { x: 95, y: 4 }, 8, false);
  assert.deepEqual(lined.delta, { x: 97, y: 0 });
  assert.ok(lined.guides.length > 0);
  assert.deepEqual(moveStep(base, { x: 40, y: 44 }, 8, false).delta, { x: 37, y: 40 });
  assert.deepEqual(moveStep(base, { x: 40.4, y: 44 }, 8, true), {
    delta: { x: 40, y: 44 },
    guides: [],
  });
});

test("a resize snaps a dragged edge to another's, keeps a leaf's least size and a container round its parts", () => {
  const handle = HANDLES[4];
  const leaf = {
    box: box(0, 0, 100, 40),
    handle,
    others: [box(200, 0, 50, 50)],
    least: box(0, 0, 60, 30),
    container: false,
  };
  assert.deepEqual(resized(leaf, { x: 97, y: -3 }, 8, false).box, box(0, 0, 200, 40));
  assert.deepEqual(resized(leaf, { x: -90, y: -30 }, 8, false).box, box(0, 0, 60, 30));
  const holder = { ...leaf, least: box(20, 10, 70, 25), container: true };
  assert.deepEqual(resized(holder, { x: -60, y: -30 }, 8, false).box, box(0, 0, 90, 35));
});

test("the nearest point of a wire to an element is where it ends, and the way back shows off the view", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 90 },
  ];
  assert.deepEqual(endNear(points, box(40, 100, 20, 20)), { x: 50, y: 90 });
  assert.equal(awayFromView(box(-300, 10, 200, 100), 800, 600), true);
  assert.equal(awayFromView(box(-150, 10, 200, 100), 800, 600), false);
});
