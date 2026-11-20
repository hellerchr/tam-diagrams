// The UML canvas's geometry: structure parts as the boxes the editor hits, lanes, what moves with a part, and how many
// places a dragged participant or message moves.
import assert from "node:assert/strict";
import { test } from "vitest";
import type { StructureNode } from "../../src/structure.ts";
import {
  laneBorderAt,
  laneBoxes,
  lifelineAt,
  movingShapes,
  partOf,
  reorderSteps,
  shiftedPlaces,
  umlHits,
} from "./diagram-uml-hits.ts";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const node = (id: string, parent: string | null, group = false): StructureNode => ({
  id,
  label: id,
  parent,
  line: 1,
  group,
  kind: group ? "package" : "class",
});

const read = {
  nodes: [
    node("shop", null, true),
    node("Order", "shop"),
    node("Item", "shop"),
    node("Gate", null),
  ],
  edges: [{ id: "r1", source: "Order", target: "Item", line: 3, kind: "association" }],
};
const scene = {
  shapes: [
    { id: "shop", box: box(0, 0, 300, 200) },
    { id: "Order", box: box(20, 40, 100, 40) },
    { id: "Item", box: box(160, 40, 100, 40) },
    { id: "Gate", box: box(400, 40, 40, 40) },
    { id: "Gate#merge", box: box(400, 140, 40, 40) },
    { id: "badge:m1", box: box(0, 300, 10, 10) },
  ],
  wires: [
    {
      edge: "r1",
      points: [
        { x: 120, y: 60 },
        { x: 160, y: 60 },
      ],
    },
    {
      edge: "r1#2",
      points: [
        { x: 160, y: 60 },
        { x: 170, y: 60 },
      ],
    },
    { edge: "note-line", points: [] },
  ],
};

test("every drawing of a part is the part, with its depth, holder and parent; other shapes and lines are left out", () => {
  const hits = umlHits(read, scene);
  assert.deepEqual(
    hits.elements.map((e) => [e.id, e.depth, e.holder, e.parent]),
    [
      ["shop", 0, true, null],
      ["Order", 1, false, "shop"],
      ["Item", 1, false, "shop"],
      ["Gate", 0, false, null],
      ["Gate", 0, false, null],
    ],
  );
  assert.deepEqual(hits.elements[4]!.box, box(400, 140, 40, 40));
  assert.deepEqual(
    hits.wires.map((w) => w.id),
    ["r1", "r1"],
  );
  assert.equal(partOf("Gate#2", new Set(["Gate"])), "Gate");
  assert.equal(partOf("Gateway", new Set(["Gate"])), undefined);
});

test("lanes are the boxes between their borders, across the frame", () => {
  const frame = {
    across: "x" as const,
    bounds: [0, 100, 250],
    ids: ["ops", undefined],
    frame: box(0, 0, 250, 400),
  };
  assert.deepEqual(laneBoxes(frame), [{ id: "ops", box: box(0, 0, 100, 400) }]);
  const rows = {
    across: "y" as const,
    bounds: [10, 60, 90],
    ids: ["a", "b"],
    frame: box(0, 10, 300, 80),
  };
  assert.deepEqual(
    laneBoxes(rows).map((lane) => lane.box),
    [box(0, 10, 300, 50), box(0, 60, 300, 30)],
  );
  assert.deepEqual(laneBorderAt(frame, { x: 103, y: 200 }, 4), {
    index: 0,
    width: 100,
    across: "x",
  });
  assert.equal(laneBorderAt(frame, { x: 250, y: 200 }, 4), undefined);
  assert.equal(laneBorderAt(frame, { x: 100, y: 500 }, 4), undefined);
  const lane = { ...node("ops", null, true), kind: "lane" };
  const lanes = umlHits(
    { nodes: [lane, node("check", "ops")], edges: [] },
    { shapes: [{ id: "check", box: box(10, 40, 50, 20) }], wires: [] },
    frame,
  );
  assert.deepEqual(
    lanes.elements.map((e) => [e.id, e.depth, e.holder]),
    [
      ["check", 1, false],
      ["ops", 0, true],
    ],
  );
});

test("a moved group takes what it holds and their drawings; places move in whole numbers", () => {
  const parents = new Map(read.nodes.map((n) => [n.id, n.parent]));
  assert.deepEqual(movingShapes(["Order", "Item", "Gate", "Gate#merge"], parents, ["shop"]), [
    "Order",
    "Item",
  ]);
  assert.deepEqual(movingShapes(["Order", "Item", "Gate", "Gate#merge"], parents, ["Gate"]), [
    "Gate",
    "Gate#merge",
  ]);
  const places = new Map([["Order", { x: 20, y: 40 }]]);
  assert.deepEqual(
    shiftedPlaces(places, { x: 10.4, y: -5.6 }),
    new Map([["Order", { x: 30, y: 34 }]]),
  );
});

test("a dragged item moves as many places as it passes others in its row", () => {
  const middles = [50, 150, 250, 350];
  assert.equal(reorderSteps(middles, 0, 60), 0);
  assert.equal(reorderSteps(middles, 0, 260), 2);
  assert.equal(reorderSteps(middles, 3, 100), -2);
  assert.equal(reorderSteps(middles, 1, 10), -1);
  assert.equal(reorderSteps(middles, 1, 999), 2);
});

test("a lifeline runs down from its participant's head", () => {
  const hits = {
    elements: [{ id: "head:A", box: box(0, 0, 80, 30), depth: 0, holder: false }],
    wires: [],
  };
  assert.equal(lifelineAt(hits, { x: 40, y: 200 }), "head:A");
  assert.equal(lifelineAt(hits, { x: 120, y: 200 }), undefined);
});
