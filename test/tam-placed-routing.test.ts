import { describe, expect, it } from "vitest";
import { parseTam, type TamDiagram } from "../src/tam.ts";
import { bestLayout, layoutPlaced } from "../src/tam-layout.ts";
import { declaredElements, overlapping, pin } from "../src/tam-pin.ts";
import { place } from "../src/tam-edit.ts";
import { auditScene } from "../src/audit.ts";
import { arialMeasure } from "../src/arial-measure.ts";
import { TAM_EXAMPLES } from "../src/samples/tam-examples.ts";
import { type Box, centerOf, overlaps, type Point, type Scene, segmentHits } from "../src/scene.ts";
import { detour } from "../src/tam-placed-detour.ts";
import { STARTER } from "../editor/starter.ts";

const laid = (source: string) => {
  const diagram = parseTam(source);
  return { diagram, scene: layoutPlaced(diagram, arialMeasure) };
};

const boxOf = (scene: Scene, id: string) => scene.shapes.find((shape) => shape.id === id)!.box;
const wiresOf = (scene: Scene, edge: string) => scene.wires.filter((wire) => wire.edge === edge);
const runsOf = (points: Point[]) =>
  points.slice(1).map((point, index) => [points[index], point] as const);

/** The defects the audit finds in a scene, without the compromises it only notes. */
const defects = (scene: Scene) =>
  auditScene(scene)
    .filter((finding) => !finding.note)
    .map((finding) => `${finding.check}: ${finding.detail}`);

/** The id of the connection `source -> target` with the given label, or the first between them. */
const edgeId = (diagram: TamDiagram, source: string, target: string, nth = 0) =>
  diagram.edges.filter((edge) => edge.source === source && edge.target === target)[nth].id;

/**
 * What the audit does not look for: a wire that runs along a container's border closer than 8 px,
 * a wire between two parts of a container that leaves it, and a wire through another connection's circle.
 */
function strays(diagram: TamDiagram, scene: Scene): string[] {
  const found = new Set<string>();
  const containers = scene.shapes.filter((shape) => shape.container);
  const chain = (id: string) => {
    const ids: string[] = [];
    for (
      let node = diagram.nodes.get(id);
      node;
      node = node.parent ? diagram.nodes.get(node.parent) : undefined
    )
      ids.push(node.id);
    return ids;
  };
  for (const wire of scene.wires) {
    if (wire.path) continue;
    for (const [a, b] of runsOf(wire.points)) {
      const across = Math.abs(a.y - b.y) < 0.5;
      for (const { id, box } of containers) {
        const at = across ? a.y : a.x,
          borders = across ? [box.y, box.y + box.height] : [box.x, box.x + box.width],
          [low, high] = across
            ? [Math.min(a.x, b.x), Math.max(a.x, b.x)]
            : [Math.min(a.y, b.y), Math.max(a.y, b.y)],
          [from, to] = across ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
        if (
          Math.min(high, to) - Math.max(low, from) > 12 &&
          borders.some((border) => Math.abs(border - at) < 7.5)
        )
          found.add(`${wire.edge} runs along the border of ${id}`);
      }
    }
    const edge = diagram.edges.find((item) => item.id === wire.edge);
    if (!edge) continue;
    const around = new Set(chain(edge.target).slice(1)),
      home = chain(edge.source)
        .slice(1)
        .find((id) => around.has(id) && !id.endsWith("#row")),
      box = home ? boxOf(scene, home) : undefined;
    if (
      box &&
      wire.points.some(
        (point) =>
          point.x < box.x - 0.5 ||
          point.x > box.x + box.width + 0.5 ||
          point.y < box.y - 0.5 ||
          point.y > box.y + box.height + 0.5,
      )
    )
      found.add(`${wire.edge} leaves ${home}`);
  }
  for (const shape of scene.shapes) {
    if (shape.kind !== "circle") continue;
    const center = centerOf(shape.box),
      radius = shape.box.width / 2 + 1;
    for (const wire of scene.wires) {
      if (wire.ends.includes(shape.id)) continue;
      for (const [a, b] of runsOf(wire.points)) {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          t = Math.max(
            0,
            Math.min(1, ((center.x - a.x) * dx + (center.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
          );
        if (Math.hypot(a.x + t * dx - center.x, a.y + t * dy - center.y) < radius)
          found.add(`${wire.edge} runs through ${shape.id}`);
      }
    }
  }
  return [...found];
}

const samples: [string, string][] = [
  ["the editor's starter", STARTER.replace(/ @-?\d+,-?\d+( \d+x\d+)?/g, "")],
  ...TAM_EXAMPLES.filter(([name]) => !name.startsWith("error")),
];

/** Where one element of a pinned source moves to by hand: the first leaf and offset that lie on no other element. */
function moved(pinned: string, turn: number): string | undefined {
  const MOVES = [
    [60, -30],
    [-50, 40],
    [40, 60],
    [-70, -40],
    [80, 0],
    [0, 60],
  ];
  const leaves = declaredElements(parseTam(pinned)).filter(
    (node) => !node.children.length && node.at,
  );
  for (let attempt = 0; attempt < leaves.length * MOVES.length; attempt++) {
    const node = leaves[(turn + attempt) % leaves.length],
      [dx, dy] = MOVES[(turn + Math.floor(attempt / leaves.length)) % MOVES.length];
    const next = place(
      pinned,
      new Map([[node.id, { ...node.at!, x: node.at!.x + dx, y: node.at!.y + dy }]]),
    );
    const diagram = parseTam(next);
    if (!overlapping(diagram, layoutPlaced(diagram, arialMeasure)).length) return next;
  }
  return undefined;
}

describe("wires of a pinned layout", () => {
  it.each(samples.map(([name, source], index) => [name, source, index] as const))(
    "%s: no wire through an element, a foreign container, a circle or a label, none along a border",
    async (_, source, index) => {
      const pinned = pin(source, await bestLayout(parseTam(source), arialMeasure), arialMeasure);
      const { diagram, scene } = laid(pinned);
      expect(defects(scene)).toEqual([]);
      expect(strays(diagram, scene)).toEqual([]);
      // The same after one element moved by hand, as a drag in the editor leaves it.
      const next = moved(pinned, index);
      if (!next) return;
      const after = laid(next);
      expect(defects(after.scene)).toEqual([]);
      expect(strays(after.diagram, after.scene)).toEqual([]);
    },
  );
});

describe("a wire and the containers around it", () => {
  it("runs around a container neither of its ends lies in, with its circle and label outside", () => {
    const { diagram, scene } = laid(`${STARTER}customer -- calls --> erp\n`);
    const shop = boxOf(scene, "shop"),
      id = edgeId(diagram, "customer", "erp");
    for (const wire of wiresOf(scene, id))
      for (const [a, b] of runsOf(wire.points)) expect(segmentHits(a, b, shop)).toBe(false);
    expect(overlaps(boxOf(scene, `${id}#node`), shop)).toBe(false);
    for (const text of scene.texts.filter((item) => item.owner === `${id}#node`))
      expect(overlaps(text.box, shop)).toBe(false);
    expect(defects(scene)).toEqual([]);
  });

  it("crosses a foreign container only where nothing else leads to its end", () => {
    // The target is walled in by the container on every side but the one the wire cannot reach.
    const { scene } = laid(`agent a[A] @0,100
agent ring[Ring] @200,0 300x300 {
  agent in[In] @300,130
}
agent b[B] @600,100
a -- calls --> b`);
    const ring = boxOf(scene, "ring");
    for (const wire of scene.wires)
      for (const [a, b] of runsOf(wire.points)) expect(segmentHits(a, b, ring)).toBe(false);
  });

  it("keeps a wire between two parts of a container inside it", async () => {
    const source = TAM_EXAMPLES.find(([name]) => name.startsWith("design level"))![1],
      pinned = pin(source, await bestLayout(parseTam(source), arialMeasure), arialMeasure),
      { diagram, scene } = laid(pinned),
      shop = boxOf(scene, "shop");
    for (const edge of diagram.edges) {
      const [a, b] = [edge.source, edge.target].map((end) => diagram.nodes.get(end)!.parent);
      if (a !== "shop" || b !== "shop") continue;
      for (const wire of wiresOf(scene, edge.id))
        for (const point of wire.points) {
          expect(point.x).toBeGreaterThan(shop.x);
          expect(point.x).toBeLessThan(shop.x + shop.width);
          expect(point.y).toBeGreaterThan(shop.y);
          expect(point.y).toBeLessThan(shop.y + shop.height);
        }
      // The ball of a connector stands inside the container, too.
      const ball = scene.shapes.find((shape) => shape.id === `${edge.id}#node`);
      if (ball) expect(overlaps(ball.box, shop) && !segmentOutside(ball.box, shop)).toBe(true);
    }
    expect(strays(diagram, scene)).toEqual([]);
  });

  it("keeps a wire off the border of the container it runs in", () => {
    // The way around the wall is shorter on its left, where only the container's padding is free.
    const { diagram, scene } = laid(`agent box[Box] @0,0 420x320 {
  agent a[A] @20,60
  agent wall[Wall] @20,130 340x40
  storage s[S] @20,250
}
a -- writes --> s`);
    expect(strays(diagram, scene)).toEqual([]);
    expect(defects(scene)).toEqual([]);
  });

  it("stands an interface on another side of its element where its own is taken", () => {
    const { scene } = laid(`direction TB
component a[A] @0,0
component below[Below] @0,70
a provides IThing`);
    const ball = scene.shapes.find((shape) => shape.kind === "circle")!;
    expect(overlaps(ball.box, boxOf(scene, "below"))).toBe(false);
    expect(ball.box.y).toBeLessThan(boxOf(scene, "below").y);
    expect(defects(scene)).toEqual([]);
  });
});

/** Whether a box reaches out of another. */
function segmentOutside(box: Box, container: Box) {
  return (
    box.x < container.x ||
    box.y < container.y ||
    box.x + box.width > container.x + container.width ||
    box.y + box.height > container.y + container.height
  );
}

describe("circles and labels on the wires", () => {
  it("keeps every wire off the circles and labels of the others", () => {
    // The parts of the starter's container as an automatic layout inside it leaves them.
    const { diagram, scene } = laid(`title Order system
human customer[Customer] @40,60
agent shop[Web Shop] {
  agent api[Order API] @281,90
  agent worker[Fulfillment] @250,227
  storage cart[Cart] @378,229
  storage orders[Orders] @266,303
}
agent erp[ERP System]:::orange @700,90
customer -- calls: place order @HTTPS --> api
api -- sends data: order events --> worker
api -- reads/writes --> cart
api -- writes --> orders
worker -- reads --> orders
worker -- calls: IDoc @RFC --> erp
`);
    expect(defects(scene)).toEqual([]);
    expect(strays(diagram, scene)).toEqual([]);
  });

  it("keeps a label off the border of a container its wire crosses", () => {
    const { scene } = laid(STARTER),
      shop = boxOf(scene, "shop"),
      label = scene.texts.find((text) => text.text === "place order")!.box;
    expect(label.x + label.width).toBeLessThan(shop.x);
    expect(defects(scene)).toEqual([]);
  });

  it("stands the circles of several channels between one pair apart", () => {
    const { diagram, scene } = laid(`${STARTER}api -- calls --> worker\napi -- calls --> worker\n`);
    const circles = [0, 1, 2].map((nth) =>
      boxOf(scene, `${edgeId(diagram, "api", "worker", nth)}#node`),
    );
    circles.forEach((circle, index) => {
      for (const other of circles.slice(index + 1)) expect(overlaps(circle, other)).toBe(false);
    });
    expect(defects(scene)).toEqual([]);
    expect(strays(diagram, scene)).toEqual([]);
  });

  it("takes another line where the gap between two elements has no room for a circle", () => {
    // The long name leaves 8 px between the two agents.
    const { diagram, scene } = laid(
      STARTER.replace("[Order API]", "[Order API with a very long name that goes on]"),
    );
    const circle = boxOf(scene, `${edgeId(diagram, "api", "worker")}#node`);
    expect(boxOf(scene, "worker").x - boxOf(scene, "api").x - boxOf(scene, "api").width).toBe(8);
    for (const id of ["api", "worker"]) expect(overlaps(circle, boxOf(scene, id))).toBe(false);
    expect(defects(scene)).toEqual([]);
  });

  it("keeps the circle of the wire to a copy off the element and its copy", () => {
    for (const copy of ["@700,90", "@700,90 @700,170"]) {
      const { diagram, scene } = laid(STARTER.replace("@700,90", `... ${copy}`));
      const second = diagram.edges.find((edge) => edge.target === "erp#2")!;
      const circle = boxOf(scene, `${second.id}#node`);
      for (const id of ["erp", "erp#2", "worker"])
        expect(overlaps(circle, boxOf(scene, id), -4)).toBe(false);
      expect(defects(scene)).toEqual([]);
    }
  });

  it("keeps the labels of two channels in a row apart", () => {
    const { scene } = laid(STARTER.replace("@700,90", "@620,90").replace("380x260", "540x260"));
    const [events, idoc] = ["order events", "IDoc"].map(
      (name) => scene.texts.find((text) => text.text === name)!.box,
    );
    expect(overlaps(events, idoc, -4)).toBe(false);
    expect(defects(scene)).toEqual([]);
  });
});

describe("a way around", () => {
  const a = { x: 0, y: 0, width: 80, height: 40 },
    b = { x: 400, y: 0, width: 80, height: 40 },
    between = { x: 200, y: -100, width: 80, height: 240 };

  it("passes a container it may cross at a price where the way around is short", () => {
    const line = detour(a, b, [], { costly: [{ box: between, cost: 600 }] })!;
    for (const [p, q] of runsOf(line.points)) expect(segmentHits(p, q, between)).toBe(false);
  });

  it("crosses it where the way around costs more than the crossing", () => {
    const line = detour(a, b, [], { costly: [{ box: between, cost: 10 }] })!;
    expect(line.points).toHaveLength(2);
  });

  it("stays in the container of both ends where a way inside exists", () => {
    const home = { x: -40, y: -150, width: 560, height: 340 },
      line = detour(a, b, [{ box: between }], { home: { box: home, cost: 500 } })!;
    for (const point of line.points) {
      expect(point.y).toBeGreaterThan(home.y);
      expect(point.y).toBeLessThan(home.y + home.height);
    }
    // Above the element in the way there is room inside; below it the way leads out.
    expect(Math.min(...line.points.map((point) => point.y))).toBeLessThan(between.y);
  });

  it("keeps off the border of a container it runs in", () => {
    const home = { x: -40, y: -120, width: 560, height: 300 },
      line = detour(a, b, [{ box: between }], { borders: [home] })!;
    for (const [p, q] of runsOf(line.points))
      if (Math.abs(p.y - q.y) < 0.5 && Math.abs(p.x - q.x) > 1) {
        expect(Math.abs(p.y - home.y)).toBeGreaterThanOrEqual(8);
        expect(Math.abs(p.y - home.y - home.height)).toBeGreaterThanOrEqual(8);
      }
  });
});
