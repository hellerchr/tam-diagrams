// @vitest-environment node
import { describe, expect, it } from "vitest";
import { auditScene } from "../src/audit";
import { markerBounds } from "../src/markers";
import {
  type Box,
  emptyScene,
  type Point,
  type Scene,
  type SceneText,
  type SceneWire,
} from "../src/scene";
import { ACCEPTED, hasRoom, labelLine } from "../src/uml-usecase-label";

const line = (edge: string, a: Point, b: Point): SceneWire => ({
  edge,
  points: [a, b],
  ends: [],
  home: [],
});
const wire = (edge: string, y: number) => line(edge, { x: 0, y }, { x: 200, y });

// A label 20px wide and 17px high.
const measure = () => 20;

describe("label placement beside a line", () => {
  it("puts the label on the roomy side, though the nearer side is one the audit accepts", () => {
    // The first spot, below the middle of the line, spans y 106-123, so the foreign wire at y 122
    // runs through its last pixel. The audit lets that pass (it shrinks the box by 2px), but it is
    // less room than a label wants all round, so the spot above is taken.
    const scene = emptyScene();
    scene.wires.push(wire("own", 100), wire("other", 122));
    labelLine(scene, measure, "own", "x");
    expect(scene.texts).toHaveLength(1);
    expect(scene.texts[0].y).toBeLessThan(100);
  });

  it("takes the spot crossed by the fewest wires when every spot is crossed", () => {
    // The line is 1px long, so all spots stand beside one point: below at y 106-123, 112-129,
    // 120-137 and 130-147, above likewise, at x 90-110. Two vertical wires cross the spots through
    // their middles; the second ends at y 128, so the lowest spot is crossed by one wire only.
    const scene = emptyScene();
    scene.wires.push(
      line("own", { x: 100, y: 100 }, { x: 101, y: 100 }),
      line("a", { x: 95, y: 50 }, { x: 95, y: 150 }),
      line("b", { x: 105, y: 50 }, { x: 105, y: 128 }),
    );
    labelLine(scene, measure, "own", "x");
    expect(scene.texts[0].y).toBeCloseTo(138.5, 6);
  });
});

/** The label box the obstacles below press on. */
const BOX: Box = { x: 100, y: 100, width: 20, height: 17 };

const label = (box: Box, role: SceneText["role"], owner: string): SceneText => ({
  text: "t",
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
  size: 11,
  weight: 400,
  anchor: "middle",
  tone: "text",
  halo: "background",
  box,
  role,
  owner,
});

/** A box of the label's size whose left edge lies `depth` inside BOX's right edge. */
const beside = (depth: number): Box => ({ ...BOX, x: BOX.x + BOX.width - depth });

/**
 * One obstacle entering BOX by `depth` px (negative: a gap), per check of the room. `tolerance` is
 * the depth up to which the audit lets it be.
 */
const OBSTACLES: Record<
  keyof typeof ACCEPTED,
  { tolerance: number; check: string | undefined; add: (scene: Scene, depth: number) => void }
> = {
  shape: {
    tolerance: 1,
    check: "text-on-shape",
    add: (scene, depth) =>
      scene.shapes.push({
        id: "s",
        kind: "rect",
        box: beside(depth),
        container: false,
        depth: 0,
        fill: "page",
      }),
  },
  container: {
    tolerance: 0,
    check: undefined,
    add: (scene, depth) =>
      scene.shapes.push({
        id: "c",
        kind: "rect",
        box: { ...beside(depth), width: 100 },
        container: true,
        depth: 0,
        fill: "none",
      }),
  },
  text: {
    tolerance: 1,
    check: "text-collision",
    add: (scene, depth) => scene.texts.push(label(beside(depth), "node", "n")),
  },
  label: {
    tolerance: 1,
    check: "text-collision",
    add: (scene, depth) => scene.texts.push(label(beside(depth), "label", "other")),
  },
  marker: {
    tolerance: 0.5,
    check: "marker-on-text",
    add: (scene, depth) => {
      const direction = { x: -1, y: 0 };
      const reach = markerBounds("arrow", { x: 0, y: 108 }, direction, true);
      scene.markers.push({
        kind: "arrow",
        tip: { x: BOX.x + BOX.width - depth - reach.x, y: 108 },
        direction,
        wire: "m",
        small: true,
      });
    },
  },
  wire: {
    tolerance: 2,
    check: "wire-through-text",
    add: (scene, depth) => scene.wires.push(wire("other", BOX.y + depth)),
  },
  ownWire: {
    tolerance: -3,
    check: "halo-on-wire",
    add: (scene, depth) => {
      scene.wires[0].points = wire("own", BOX.y + depth).points;
    },
  },
};

/** A scene with the label's own wire far off, and one obstacle entering the label by `depth`. */
function pressed(key: keyof typeof ACCEPTED, depth: number) {
  const scene = emptyScene();
  scene.wires.push(wire("own", 300));
  OBSTACLES[key].add(scene, depth);
  return { scene, own: scene.wires[0] };
}

describe("the room a label is accepted with", () => {
  // A quarter pixel either side of the audit's tolerance: looser room takes the spot the audit
  // rejects, tighter room loses one it accepts.
  it.each(Object.keys(OBSTACLES) as (keyof typeof ACCEPTED)[])(
    "takes %s up to the audit's tolerance and no further",
    (key) => {
      const { tolerance } = OBSTACLES[key];
      const within = pressed(key, tolerance - 0.25),
        past = pressed(key, tolerance + 0.25);
      expect(hasRoom(within.scene, within.own, BOX, ACCEPTED)).toBe(true);
      expect(hasRoom(past.scene, past.own, BOX, ACCEPTED)).toBe(false);
    },
  );

  it.each(
    (Object.keys(OBSTACLES) as (keyof typeof ACCEPTED)[]).filter((key) => OBSTACLES[key].check),
  )("agrees with the audit about %s", (key) => {
    const { tolerance, check } = OBSTACLES[key];
    for (const depth of [tolerance - 0.25, tolerance + 0.25]) {
      const { scene, own } = pressed(key, depth);
      const accepted = hasRoom(scene, own, BOX, ACCEPTED);
      scene.texts.push(label(BOX, "label", "own"));
      expect(auditScene(scene).some((finding) => finding.check === check)).toBe(!accepted);
    }
  });
});
