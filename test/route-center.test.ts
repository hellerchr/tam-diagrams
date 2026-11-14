// @vitest-environment node
import { describe, expect, it } from "vitest";
import { alignLayers, centerElements } from "../src/route-center.ts";
import type { Geometry } from "../src/route.ts";
import type { Box, Point } from "../src/scene.ts";

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

/** A straight wire down from one element to the next, along the layout direction, `at` from the left of the first. */
const wire = (from: Box, to: Box, at = from.width / 2): Point[] => {
  const x = from.x + at;
  return [
    { x, y: from.y + from.height },
    { x, y: to.y },
  ];
};

/** A vertical layout: each wire names its two elements and where it runs; `notes` are the nodes' own labels. */
const layout = (
  boxes: Record<string, Box>,
  wires: Record<string, [string, string, number?]>,
  notes: Record<string, Box[]>,
): Geometry => ({
  boxes: new Map(Object.entries(boxes)),
  routes: new Map(
    Object.entries(wires).map(([edge, [from, to, at]]) => [edge, wire(boxes[from], boxes[to], at)]),
  ),
  nodeLabels: new Map(Object.entries(notes)),
  edgeLabels: new Map(),
  ends: new Map(Object.entries(wires).map(([edge, [from, to]]) => [edge, [from, to]])),
  leaves: new Set(Object.keys(boxes)),
  markers: new Set(),
  round: new Map(),
  ancestors: new Map(),
  containers: new Set(),
  titles: [],
  spacing: { node: 20, edge: 10 },
  widths: new Map(),
});

/** The note's offset to its node along the layout direction, as the state diagram's connector sees it. */
const offset = (geometry: Geometry, id: string) =>
  geometry.nodeLabels.get(id)![0].y - geometry.boxes.get(id)!.y;

/**
 * A sits 20px under P and 200px above Q, so centering moves it 90px down. Its note stands 28px to its
 * right, centered on it; `D` is whatever else lies where the note would land.
 */
const centered = (obstacle: Record<string, Box> = {}, notes = true) =>
  layout(
    { P: box(100, 0, 100, 40), A: box(100, 60, 100, 40), Q: box(100, 300, 100, 40), ...obstacle },
    { p: ["P", "A", 30], q: ["A", "Q", 70] },
    notes ? { A: [box(228, 70, 70, 20)] } : {},
  );

describe("centering an element moves its notes along", () => {
  it("keeps the note's offset to its element", () => {
    const geometry = centered();
    centerElements(geometry, true);
    expect(geometry.boxes.get("A")!.y).toBe(150);
    expect(offset(geometry, "A")).toBe(10);
  });

  it("leaves the element where it is when its note would land on another element", () => {
    const geometry = centered({ D: box(228, 150, 70, 40) });
    centerElements(geometry, true);
    expect(geometry.boxes.get("A")!.y).toBe(60);
    expect(offset(geometry, "A")).toBe(10);
  });

  it("leaves the element where it is when its note would land on another wire", () => {
    const geometry = centered({ R: box(400, 0, 40, 40), S: box(400, 300, 40, 40) });
    geometry.routes.set("r", [
      { x: 260, y: 160 },
      { x: 260, y: 200 },
    ]);
    geometry.ends.set("r", ["R", "S"]);
    centerElements(geometry, true);
    expect(geometry.boxes.get("A")!.y).toBe(60);
  });

  it("leaves the element where it is when its note would land on another element's note", () => {
    const geometry = centered({ D: box(500, 400, 40, 40) });
    geometry.nodeLabels.set("D", [box(228, 150, 70, 20)]);
    centerElements(geometry, true);
    expect(geometry.boxes.get("A")!.y).toBe(60);
  });

  it("leaves the element where it is when its note would land on another container", () => {
    const geometry = centered({ X: box(240, 150, 200, 100) });
    geometry.leaves.delete("X");
    geometry.containers.add("X");
    centerElements(geometry, true);
    expect(geometry.boxes.get("A")!.y).toBe(60);
  });

  it("leaves the element where it is when its note would leave its container", () => {
    // A is 6px above Q inside K and moves up 21px; its 140px note, now inside K, would stick out above it.
    const geometry = layout(
      {
        K: box(60, 0, 300, 400),
        P: box(100, -80, 100, 40),
        A: box(100, 54, 100, 40),
        Q: box(100, 100, 100, 40),
      },
      { p: ["P", "A", 30], q: ["A", "Q", 70] },
      { A: [box(228, 4, 70, 140)] },
    );
    geometry.leaves.delete("K");
    geometry.containers.add("K");
    geometry.ancestors.set("A", ["K"]).set("Q", ["K"]);
    centerElements(geometry, true);
    expect(geometry.boxes.get("A")!.y).toBe(54);
  });

  /** The layout with A and Q inside a container K of the given frame. */
  const insideK = (frame: Box) => {
    const geometry = centered({ K: frame });
    geometry.leaves.delete("K");
    geometry.containers.add("K");
    geometry.ancestors.set("A", ["K"]).set("Q", ["K"]);
    return geometry;
  };

  // K's top and bottom insets leave A free from y = 56 to Q's top at 300: it moves 98px down.
  it("moves the element when its note stays inside the container it is in", () => {
    const geometry = insideK(box(60, 50, 300, 300));
    centerElements(geometry, true);
    expect(geometry.boxes.get("A")!.y).toBe(158);
    expect(offset(geometry, "A")).toBe(10);
  });

  it("moves the element when its note already stands outside the container it is in", () => {
    const geometry = insideK(box(60, 50, 160, 300));
    centerElements(geometry, true);
    expect(geometry.boxes.get("A")!.y).toBe(158);
  });

  it("keeps the node spacing from an element beside where the note would land", () => {
    // The note would stand at x 228..298; D starts 10px right of it, the spacing is 20.
    const geometry = centered({ D: box(308, 150, 40, 40) });
    centerElements(geometry, true);
    expect(geometry.boxes.get("A")!.y).toBe(60);
  });

  it("moves an element without notes exactly as before, whatever lies beside it", () => {
    const geometry = centered({ D: box(228, 150, 70, 40) }, false);
    centerElements(geometry, true);
    expect(geometry.boxes.get("A")!.y).toBe(150);
  });
});

describe("aligning a layer moves the notes of the elements that move", () => {
  /** Three elements of one size; the middle one stands 8px lower than the others. */
  const layer = () =>
    layout(
      {
        P1: box(0, 0, 100, 40),
        P2: box(300, 0, 100, 40),
        P3: box(600, 0, 100, 40),
        A1: box(0, 100, 100, 40),
        A2: box(300, 108, 100, 40),
        A3: box(600, 100, 100, 40),
      },
      { w1: ["P1", "A1"], w2: ["P2", "A2"], w3: ["P3", "A3"] },
      { A2: [box(428, 118, 70, 20)] },
    );

  it("keeps the note's offset to its element", () => {
    const geometry = layer();
    alignLayers(geometry, true);
    expect(geometry.boxes.get("A2")!.y).toBe(100);
    expect(offset(geometry, "A2")).toBe(10);
  });

  it("lets a note land on the label of the element's own connection", () => {
    const geometry = layer();
    geometry.edgeLabels.set("w2", box(428, 105, 70, 20));
    alignLayers(geometry, true);
    expect(geometry.boxes.get("A2")!.y).toBe(100);
  });

  it("lets a note land on the wire of the element's own connection", () => {
    const geometry = layer();
    // The wire runs down at x = 350; the note, moving up 8px, would stand on it.
    geometry.nodeLabels.set("A2", [box(320, 80, 70, 20)]);
    alignLayers(geometry, true);
    expect(geometry.boxes.get("A2")!.y).toBe(100);
  });
});
