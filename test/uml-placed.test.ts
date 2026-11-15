import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { auditScene } from "../src/audit.ts";
import { parseUml, renderUml } from "../src/index.ts";
import * as examples from "../src/samples/uml-examples.ts";
import { grow, overlaps, type Point, type Scene } from "../src/scene.ts";
import { chainOf, sceneTree } from "../src/scene-tree.ts";
import { placeable, placeScene, placesOf } from "../src/uml-placed.ts";
import { removePlaces, setPlaces } from "../src/uml-places.ts";
import { umlColors } from "./fixtures.ts";

const corpus = Object.values(examples).flat() as [string, string][];

const layout = (source: string) => parseUml(source).layout(arialMeasure);
const boxOf = (scene: Scene, id: string) => scene.shapes.find((shape) => shape.id === id)!.box;
const defects = (scene: Scene) => auditScene(scene).filter((finding) => !finding.note);

/**
 * Whether no part lies on another or on a container that does not hold it, and none nearer to a
 * note than notes keep: only then is a layout by hand free of defects.
 */
function apart(scene: Scene): boolean {
  // The frames and boxes of a sequence diagram lie around lifelines, which are no shapes.
  const lifelines = scene.shapes.some((shape) => shape.id.startsWith("head:"));
  const tree = sceneTree(scene),
    shapes = scene.shapes.filter(
      (shape) => !shape.passable && shape.kind !== "region" && !(lifelines && shape.container),
    );
  return shapes.every((a) =>
    shapes.every(
      (b) =>
        a === b ||
        chainOf(tree, a.id).includes(b.id) ||
        chainOf(tree, b.id).includes(a.id) ||
        !overlaps(grow(a.box, a.kind === "note" || b.kind === "note" ? 16 : 0), b.box),
    ),
  );
}

/** Ways to stand the parts of a scene elsewhere: all of them further apart, and single ones moved out. */
function variations(scene: Scene): [string, Map<string, Point>][] {
  const pinned = placesOf(scene),
    ids = [...pinned.keys()],
    { bounds } = scene;
  const scaled = (fx: number, fy: number) =>
    new Map(
      [...pinned].map(([id, at]) => [id, { x: Math.round(at.x * fx), y: Math.round(at.y * fy) }]),
    );
  const moved = (id: string, at: Point) => new Map(pinned).set(id, at);
  const picks = [...new Set([0, Math.floor(ids.length / 2), ids.length - 1])].map((k) => ids[k]),
    third = ids[Math.floor(ids.length / 3)];
  return [
    ["spread", scaled(1.4, 1.3)],
    ["wide", scaled(1.5, 1)],
    ["tall", scaled(1, 1.5)],
    ...picks.map((id): [string, Map<string, Point>] => [
      `${id} to the right`,
      moved(id, { x: bounds.x + bounds.width + 60, y: pinned.get(id)!.y + 20 }),
    ]),
    [`${third} below`, moved(third, { x: pinned.get(third)!.x, y: bounds.y + bounds.height + 50 })],
  ];
}

/**
 * Use case lines are one straight line or one curve each. Where a part stands so that no single
 * curve clears what lies between its ends, the line passes over a use case: these two layouts.
 */
const CROSSED = new Set([
  "usecase: TAM standard figure 2-7 / User to the right",
  "usecase: bank (large) / open below",
]);

describe("UML corpus placed by hand", () => {
  it.each(corpus)("%s: pinned where it lies, it is the automatic scene", async (_name, source) => {
    const auto = await layout(source),
      pinned = await layout(setPlaces(source, placesOf(auto)));
    expect(pinned).toEqual(auto);
    expect(defects(pinned)).toEqual([]);
  });

  it.each(corpus)("%s: has no defects with its parts moved", async (name, source) => {
    const auto = await layout(source);
    let audited = 0;
    for (const [how, places] of variations(auto)) {
      const scene = await layout(setPlaces(source, places));
      // Moved onto another part, or grown over one, a layout is the author's to mend.
      if (!apart(scene)) continue;
      audited++;
      const found = defects(scene).map((finding) => `${how}: ${finding.check} ${finding.detail}`);
      if (CROSSED.has(`${name} / ${how}`))
        expect(found.every((text) => /wire-through-(shape|text)/.test(text))).toBe(true);
      else expect(found).toEqual([]);
    }
    expect(audited).toBeGreaterThan(0);
  });
});

describe("a source with places", () => {
  it("is valid Mermaid, whatever its type", async () => {
    const mermaid = (await import("mermaid")).default;
    for (const list of Object.values(examples) as [string, string][][]) {
      const [, source] = list[0],
        placed = setPlaces(source, placesOf(await layout(source)));
      await expect(mermaid.parse(placed)).resolves.toBeTruthy();
    }
  }, 60_000);
});

describe("a layout by hand", () => {
  const CLASSES = `classDiagram
  namespace billing {
    class Invoice {
      +total: Money
    }
    class Line
  }
  namespace empty {
  }
  class Order
  class Customer
  Order "1" *-- "many" Line : contains
  Order --> Invoice : bills
  Order --> Invoice : pays
  Customer <|-- Order
  Order --> Order : parent
  note for Order "the root"`;

  it("leaves a source without places exactly as it was", async () => {
    const auto = await renderUml(CLASSES, umlColors, { measure: arialMeasure }),
      placed = setPlaces(CLASSES, placesOf(auto.scene));
    expect((await renderUml(removePlaces(placed), umlColors, { measure: arialMeasure })).svg).toBe(
      auto.svg,
    );
    expect((await renderUml(placed, umlColors, { measure: arialMeasure })).svg).toBe(auto.svg);
  });

  it("stands a part at its place with its texts, and nothing else moves", async () => {
    const auto = await layout(CLASSES),
      was = boxOf(auto, "Customer"),
      scene = await layout(setPlaces(CLASSES, { Customer: { x: was.x + 300, y: was.y + 40 } }));
    expect(boxOf(scene, "Customer")).toEqual({ ...was, x: was.x + 300, y: was.y + 40 });
    const names = (from: Scene) => from.texts.filter((text) => text.owner === "Customer");
    names(scene).forEach((text, index) => {
      expect(text.box.x - names(auto)[index].box.x).toBeCloseTo(300);
      expect(text.box.y - names(auto)[index].box.y).toBeCloseTo(40);
    });
    for (const id of ["Order", "Invoice", "Line", "ns:billing", "ns:empty", "note1"])
      expect(boxOf(scene, id)).toEqual(boxOf(auto, id));
    // Only the wire of the part that moved is laid again, and it ends on both shapes.
    const wire = (from: Scene, edge: string) => from.wires.find((item) => item.edge === edge)!;
    expect(wire(scene, "r1")).toEqual(wire(auto, "r1"));
    expect(wire(scene, "r4")).not.toEqual(wire(auto, "r4"));
    expect(scene.markers.filter((marker) => marker.wire === "r4")).toHaveLength(1);
    expect(defects(scene)).toEqual([]);
    expect(scene.bounds.width).toBeGreaterThan(auto.bounds.width);
  });

  it("fits a container around what it holds, with the room it had, and places an empty one", async () => {
    const auto = await layout(CLASSES),
      line = boxOf(auto, "Line"),
      space = boxOf(auto, "ns:billing"),
      empty = boxOf(auto, "ns:empty");
    const scene = await layout(
      setPlaces(CLASSES, {
        Line: { x: Math.round(line.x) - 200, y: Math.round(line.y) },
        "ns:empty": { x: 900, y: 40 },
      }),
    );
    const grown = boxOf(scene, "ns:billing");
    expect(grown.x).toBeCloseTo(space.x - (line.x - Math.round(line.x)) - 200, 0);
    expect(grown.x + grown.width).toBeCloseTo(space.x + space.width);
    expect(grown.y).toBe(space.y);
    expect(boxOf(scene, "ns:empty")).toEqual({ ...empty, x: 900, y: 40 });
    const title = (from: Scene, id: string) => from.texts.find((text) => text.owner === id)!;
    expect(title(scene, "ns:empty").x - title(auto, "ns:empty").x).toBeCloseTo(900 - empty.x);
    // A container with content takes no place of its own.
    expect(placeable(auto)).toContain("ns:empty");
    expect(placeable(auto)).not.toContain("ns:billing");
  });

  it("moves a part without a place off the placed part it would lie on", async () => {
    const auto = await layout(CLASSES),
      order = boxOf(auto, "Order");
    const scene = await layout(
      setPlaces(CLASSES, {
        Customer: { x: Math.round(order.x) + 10, y: Math.round(order.y) + 10 },
      }),
    );
    expect(overlaps(boxOf(scene, "Customer"), boxOf(scene, "Order"))).toBe(false);
    expect(boxOf(scene, "Customer")).toMatchObject({
      x: Math.round(order.x) + 10,
      y: Math.round(order.y) + 10,
    });
    expect(boxOf(scene, "Order")).not.toEqual(order);
  });

  it("keeps several wires between two parts apart, and a loop at its part", async () => {
    const auto = await layout(CLASSES),
      order = boxOf(auto, "Order");
    const scene = await layout(
      setPlaces(CLASSES, { Order: { x: Math.round(order.x) + 260, y: Math.round(order.y) - 30 } }),
    );
    const wire = (edge: string) => scene.wires.find((item) => item.edge === edge)!;
    const [bills, pays] = [wire("r2"), wire("r3")];
    expect(
      Math.hypot(bills.points[0].x - pays.points[0].x, bills.points[0].y - pays.points[0].y),
    ).toBeGreaterThan(8);
    const loop = (from: Scene) => from.wires.find((item) => item.edge === "r5")!.points;
    loop(scene).forEach((point, index) => {
      expect(point.x - loop(auto)[index].x).toBeCloseTo(boxOf(scene, "Order").x - order.x);
    });
    expect(defects(scene)).toEqual([]);
  });

  it("is the pass placeScene over the automatic scene, whatever the type", async () => {
    const auto = await layout(CLASSES),
      places = new Map([["Customer", { x: 700, y: 300 }]]);
    expect(placeScene(auto, places, arialMeasure)).toEqual(
      await layout(setPlaces(CLASSES, places)),
    );
    // Places of ids the scene does not have change nothing.
    expect(placeScene(auto, new Map([["Nobody", { x: 1, y: 2 }]]), arialMeasure)).toBe(auto);
  });
});

describe("places in the types with a flow of their own", () => {
  const SEQUENCE = `sequenceDiagram
  participant A as Alice
  participant B as Bob
  participant C as Carol
  A->>B: a long message that needs its room
  B->>C: hi`;

  it("orders the participants of a sequence diagram by x and keeps the room messages need", async () => {
    const auto = await layout(SEQUENCE),
      x = (scene: Scene, id: string) => boxOf(scene, `head:${id}`).x;
    expect(placeable(auto)).toEqual(["head:A", "head:B", "head:C"]);
    const placed = await layout(
      setPlaces(SEQUENCE, {
        "head:A": { x: 600, y: 500 },
        "head:B": { x: 0, y: -90 },
        "head:C": { x: 10, y: 0 },
      }),
    );
    // Bob, Carol, Alice: by their x; y does not count, time runs down.
    expect(x(placed, "B")).toBe(0);
    expect(x(placed, "C")).toBeGreaterThan(x(placed, "B") + 80);
    expect(x(placed, "A")).toBeGreaterThanOrEqual(600);
    expect(boxOf(placed, "head:A").y).toBe(boxOf(auto, "head:A").y);
    expect(defects(placed)).toEqual([]);
    // Pinned where they stand, nothing moves.
    expect(await layout(setPlaces(SEQUENCE, placesOf(auto)))).toEqual(auto);
    // Further apart than needed, they stand where they are placed.
    const wide = await layout(
      setPlaces(SEQUENCE, { "head:A": { x: 0, y: 0 }, "head:B": { x: 500, y: 0 } }),
    );
    expect(x(wide, "B")).toBe(500);
    expect(x(wide, "C")).toBeGreaterThan(500);
  });

  const LANES = `swimlane-beta TB
  subgraph Customer
    start((Start)) --> order(Place Order)
  end
  subgraph Shop
    check(Check Order) --> ship(Ship Goods)
  end
  order --> check`;

  it("keeps a node of a swimlane diagram in its lane, and the lanes as long as their nodes", async () => {
    const auto = await layout(LANES),
      ship = boxOf(auto, "ship"),
      frame = (scene: Scene) => scene.lines[0].points;
    const scene = await layout(
      setPlaces(LANES, { ship: { x: -400, y: Math.round(ship.y) + 300 } }),
    );
    const moved = boxOf(scene, "ship"),
      border = auto.lines[1].points[0].x;
    expect(moved.x).toBeGreaterThan(border);
    expect(moved.x).toBeLessThan(ship.x);
    expect(moved.y).toBe(Math.round(ship.y) + 300);
    expect(Math.max(...frame(scene).map((point) => point.y))).toBeGreaterThan(
      moved.y + moved.height,
    );
    expect(scene.lines[1].points[1].y).toBe(Math.max(...frame(scene).map((point) => point.y)));
    expect(defects(scene)).toEqual([]);
  });
});
