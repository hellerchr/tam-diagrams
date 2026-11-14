// @vitest-environment node
import { describe, expect, it } from "vitest";
import { umlColors } from "./fixtures.ts";
import { renderUml } from "../src/index.ts";
import {
  emptyScene,
  type Box,
  type Point,
  type Scene,
  type SceneShape,
  type ShapeKind,
} from "../src/scene.ts";
import { straightenScene } from "../src/wires.ts";
import { auditScene } from "../src/audit.ts";
import { generateFlowchart } from "../src/samples/fuzz.ts";

/** Text widths without a font: the same estimate the browser-less tests use, scaled by `scale`. */
const estimate = (scale: number) => (text: string, size: number, weight: number) =>
  text.length * size * (weight >= 600 ? 0.62 : 0.58) * scale;

const render = async (seed: number, scale: number) => {
  const source = generateFlowchart(seed, { swimlanes: true });
  return (await renderUml(source, umlColors, { measure: estimate(scale) })).scene;
};

/** The defects of the two checks a straightened wire end can break: off the outline, off a diamond's vertex. */
const endDefects = (scene: Scene) =>
  auditScene(scene).filter(
    (finding) =>
      (finding.check === "wire-end-off-shape" || finding.check === "diamond-off-vertex") &&
      !finding.note,
  );

describe("straightening a wire between two shapes in generated swimlane diagrams", () => {
  it("keeps a wire end on the outline of a shape that is not a box", async () => {
    // Seed 116, e3: a straight line on the edge of a circle's bounding box misses the circle.
    expect(endDefects(await render(116, 1))).toEqual([]);
  });

  it("meets a symbol diamond on a vertex", async () => {
    // Seed 102: a line through one diamond's center meets the other diamond off its vertex.
    expect(endDefects(await render(102, 1))).toEqual([]);
  });
});

describe("straightenScene on two shapes laid out by hand", () => {
  const shape = (id: string, kind: ShapeKind, box: Box): SceneShape => ({
    id,
    kind,
    box,
    container: false,
    depth: 0,
    fill: "page",
  });
  /** The scene with wire a>b between shapes `a` and `b`, after straightening. */
  const straighten = (kinds: [ShapeKind, ShapeKind], boxes: [Box, Box], route: Point[]) => {
    const scene = emptyScene();
    scene.shapes.push(shape("a", kinds[0], boxes[0]), shape("b", kinds[1], boxes[1]));
    scene.wires.push({
      edge: "a>b",
      points: route,
      ends: ["a", "b"],
      home: [],
      from: "a",
      to: "b",
    });
    straightenScene(scene);
    return scene;
  };
  const xs = (scene: Scene) => scene.wires[0].points.map((point) => point.x);
  const square = (x: number, y: number, size: number): Box => ({ x, y, width: size, height: size });

  it.each<[string, ShapeKind, ShapeKind, Box, Box, Point[], number]>([
    [
      "circle above a circle",
      "circle",
      "circle",
      square(0, 0, 60),
      square(60, 100, 60),
      [{ x: 30, y: 60 }, { x: 30, y: 80 }, { x: 90, y: 80 }, { x: 90, y: 100 }],
      60,
    ],
    [
      "circle above a box",
      "circle",
      "rect",
      square(0, 0, 60),
      square(54, 100, 96),
      [{ x: 30, y: 60 }, { x: 30, y: 80 }, { x: 100, y: 80 }, { x: 100, y: 100 }],
      60,
    ],
    [
      "box above a circle",
      "rect",
      "circle",
      square(0, 0, 96),
      square(90, 100, 60),
      [{ x: 30, y: 96 }, { x: 30, y: 98 }, { x: 120, y: 98 }, { x: 120, y: 100 }],
      90,
    ],
  ])(
    "draws no line on a box edge that misses the outline: %s",
    (_, a, b, boxA, boxB, route, edge) => {
      // The boxes overlap across x only along `edge`, where a circle's outline is absent.
      const scene = straighten([a, b], [boxA, boxB], route);
      expect(xs(scene)).not.toContain(edge);
      expect(endDefects(scene)).toEqual([]);
    },
  );

  it("clips the end of a line onto a stadium's rounded corner", () => {
    // x = 86 is 6 px in from the stadium's left edge, where its rounded corner lies below the box top.
    const route = [
      { x: 86, y: 40 },
      { x: 86, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 60 },
    ];
    const boxes: [Box, Box] = [
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 80, y: 60, width: 100, height: 30 },
    ];
    const scene = straighten(["rect", "stadium"], boxes, route);
    expect(xs(scene)).toEqual([86, 86]);
    expect(scene.wires[0].points[1].y).toBeGreaterThan(60);
    expect(endDefects(scene)).toEqual([]);
  });

  it("keeps a line that ends on a polygon's corner, where the outline is only grazed", () => {
    // y = 38 runs along the bottom edge of the parallelogram and ends on its corner (100, 38).
    const route = [
      { x: 100, y: 19 },
      { x: 125, y: 19 },
      { x: 125, y: 60 },
      { x: 150, y: 60 },
    ];
    const boxes: [Box, Box] = [
      { x: 0, y: 0, width: 100, height: 38 },
      { x: 150, y: 32, width: 150, height: 58 },
    ];
    const scene = straighten(["lean-left", "rect"], boxes, route);
    expect(scene.wires[0].points).toEqual([
      { x: 100, y: 38 },
      { x: 150, y: 38 },
    ]);
    expect(endDefects(scene)).toEqual([]);
  });

  describe("on the audit's tolerance for an end off the outline", () => {
    const route = (x: number, bendX: number): Point[] => [
      { x, y: 60 },
      { x, y: 65 },
      { x: bendX, y: 65 },
      { x: bendX, y: 70 },
    ];

    it("keeps a line whose end is 1.1 px off the outline, a hair under 1.5", () => {
      // The line x = 100 meets the flat parallelogram 1.1 px off its top edge.
      const boxes: [Box, Box] = [
        { x: 94, y: 0, width: 100, height: 60 },
        { x: 100, y: 70, width: 100, height: 3 },
      ];
      const scene = straighten(["rect", "lean-right"], boxes, route(100, 103));
      expect(xs(scene)).toEqual([100, 100]);
      expect(endDefects(scene)).toEqual([]);
    });

    it("drops a line whose end is further off the outline, and takes the next one", () => {
      // The flat parallelogram is 5 px high: x = 100 meets it more than 1.5 px off, x = 103 within.
      const boxes: [Box, Box] = [
        { x: 94, y: 0, width: 100, height: 60 },
        { x: 100, y: 70, width: 100, height: 5 },
      ];
      const scene = straighten(["rect", "lean-right"], boxes, route(100, 103));
      expect(xs(scene)).toEqual([103, 103]);
      expect(endDefects(scene)).toEqual([]);
    });
  });

  describe("on a diamond's vertices", () => {
    const route = (x: number, bendX: number): Point[] => [
      { x, y: 18 },
      { x, y: 40 },
      { x: bendX, y: 40 },
      { x: bendX, y: 60 },
    ];

    it("does not run through one diamond's center when the other's is elsewhere", () => {
      const original = route(9, 14);
      const boxes: [Box, Box] = [square(0, 0, 18), square(5, 60, 18)];
      const scene = straighten(["diamond", "diamond"], boxes, original);
      expect(scene.wires[0].points).toEqual(original);
      expect(endDefects(scene)).toEqual([]);
    });

    it("runs through the diamond's center when the other symbol is no diamond", () => {
      const boxes: [Box, Box] = [square(0, 0, 18), square(4, 60, 17)];
      const scene = straighten(["diamond", "final"], boxes, route(9, 12.5));
      expect(xs(scene)).toEqual([9, 9]);
      expect(endDefects(scene)).toEqual([]);
    });

    // The audit measures the end's distance to the vertex: offset times the square root of 2 here.
    it.each([
      [0.3, true],
      [0.35, true],
      [0.36, false],
      [0.4, false],
    ])("with centers %s px apart, keeps the line: %s", (offset, kept) => {
      const original = route(9, 9 + offset);
      const boxes: [Box, Box] = [square(0, 0, 18), square(offset, 60, 18)];
      const scene = straighten(["diamond", "diamond"], boxes, original);
      expect(scene.wires[0].points).toHaveLength(kept ? 2 : 4);
      if (!kept) expect(scene.wires[0].points).toEqual(original);
      expect(endDefects(scene)).toEqual([]);
    });

    it("meets a diamond too large for a symbol on a vertex as well", () => {
      // The route's own x = 43 is the first line tried and meets the 60 px diamond 13 px off its top vertex.
      const original: Point[] = [
        { x: 43, y: 40 },
        { x: 43, y: 70 },
        { x: 30, y: 70 },
        { x: 30, y: 100 },
      ];
      const boxes: [Box, Box] = [{ x: 20, y: 0, width: 100, height: 40 }, square(0, 100, 60)];
      const scene = straighten(["rect", "diamond"], boxes, original);
      expect(xs(scene)).toEqual([30, 30]);
      expect(endDefects(scene)).toEqual([]);
    });
  });
});
