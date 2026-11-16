import { describe, expect, it } from "vitest";
import { parseTam } from "../src/tam.ts";
import { layoutPlaced, renderTam } from "../src/tam-layout.ts";
import { auditScene } from "../src/audit.ts";
import { arialMeasure } from "../src/arial-measure.ts";
import { TAM_EXAMPLES } from "../src/samples/tam-examples.ts";
import type { Scene } from "../src/scene.ts";
import { colors } from "./fixtures.ts";

const NOTES = `human clerk[Sales Clerk]
agent shop[Order Service] {
  agent api[Order API]
  storage orders[Orders]
  note retention[Orders are kept<br>for ten years]
}
note peak[Up to 200 orders a minute]
clerk -- calls --> api
api -- reads/writes --> orders
peak -.- api
orders -.- retention`;

const defects = (scene: Scene) => auditScene(scene).filter((finding) => !finding.note);

/** Whether a point lies on the outline of a box. */
const onOutline = (point: { x: number; y: number }, box: Scene["shapes"][number]["box"]) =>
  point.x >= box.x - 1.5 &&
  point.x <= box.x + box.width + 1.5 &&
  point.y >= box.y - 1.5 &&
  point.y <= box.y + box.height + 1.5 &&
  (Math.abs(point.x - box.x) < 1.5 ||
    Math.abs(point.x - box.x - box.width) < 1.5 ||
    Math.abs(point.y - box.y) < 1.5 ||
    Math.abs(point.y - box.y - box.height) < 1.5);

/** What the notes and their lines look like in a scene: a folded corner with its text, a dashed line without heads. */
function expectNotes(scene: Scene) {
  const diagram = parseTam(NOTES);
  for (const id of ["retention", "peak"]) {
    const shape = scene.shapes.find((item) => item.id === id)!;
    expect(shape).toMatchObject({ kind: "note", thin: true, container: false });
    const texts = scene.texts.filter((text) => text.owner === id);
    expect(texts.map((text) => text.text).join(" ")).toBe(
      diagram.nodes.get(id)!.label.replace("<br>", " "),
    );
    // Left-aligned in the note, small, as UML notes are.
    expect(texts.every((text) => text.anchor === "start" && text.size < 14)).toBe(true);
  }
  for (const edge of diagram.edges.filter((item) => item.kind === "anchor")) {
    const wires = scene.wires.filter((wire) => wire.edge === edge.id);
    expect(wires).toHaveLength(1);
    expect(wires[0].dashed).toBe(true);
    expect(scene.markers.filter((marker) => marker.wire === edge.id)).toEqual([]);
    const [start, end] = [wires[0].points[0], wires[0].points.at(-1)!];
    const box = (id: string) => scene.shapes.find((shape) => shape.id === id)!.box;
    expect(
      (onOutline(start, box(edge.source)) && onOutline(end, box(edge.target))) ||
        (onOutline(end, box(edge.source)) && onOutline(start, box(edge.target))),
    ).toBe(true);
  }
  expect(defects(scene)).toEqual([]);
}

describe("notes in a block diagram", () => {
  it("lays notes out beside what they remark on, attached by dashed lines", async () => {
    const { scene, svg } = await renderTam(NOTES, colors);
    expectNotes(scene);
    // The note in the container stands in it.
    const [shop, retention] = ["shop", "retention"].map(
      (id) => scene.shapes.find((shape) => shape.id === id)!.box,
    );
    expect(retention.x).toBeGreaterThan(shop.x);
    expect(retention.y + retention.height).toBeLessThan(shop.y + shop.height);
    expect(svg).toContain('stroke-dasharray="5 4"');
  });

  it("stands a placed note where the source says, as large as it says", () => {
    const placed = `human clerk[Sales Clerk] @40,20
agent shop[Order Service] @20,160 420x240 {
  agent api[Order API] @40,220
  storage orders[Orders] @40,320
  note retention[Orders are kept<br>for ten years]:::yellow @240,300
}
note peak[Up to 200 orders a minute] @260,20 180x50
clerk -- calls --> api
api -- reads/writes --> orders
peak -.- api
orders -.- retention`;
    const scene = layoutPlaced(parseTam(placed), arialMeasure);
    expectNotes(scene);
    expect(scene.shapes.find((shape) => shape.id === "peak")!.box).toEqual({
      x: 260,
      y: 20,
      width: 180,
      height: 50,
    });
    expect(scene.shapes.find((shape) => shape.id === "retention")).toMatchObject({
      box: { x: 240, y: 300 },
      color: "yellow",
    });
  });

  it("keeps notes out of the dots between two elements", async () => {
    const { scene } = await renderTam(
      "agent w1[Worker]\nnote n[Up to ten]\n...\nagent w2[Worker]\nn -.- w1",
      colors,
    );
    expect(scene.shapes.filter((shape) => shape.kind === "dots")).toHaveLength(1);
    expect(defects(scene)).toEqual([]);
  });
});

describe("three dots between two declared elements", () => {
  it("are drawn when the layout did not keep the two level", async () => {
    const source = TAM_EXAMPLES.find(([name]) => name === "reference: FMC travel agency")![1];
    const { scene } = await renderTam(source, colors);
    const dots = scene.shapes.filter((shape) => shape.kind === "dots");
    expect(dots.map((shape) => shape.id).toSorted()).toEqual(["dots#1", "dots#2"]);
    // Between the two adapters, clear of both.
    const [one, two] = ["adapter1", "adapter2"]
        .map((id) => scene.shapes.find((shape) => shape.id === id)!.box)
        .toSorted((a, b) => a.x - b.x),
      mark = dots.find((shape) => shape.id === "dots#2")!.box;
    expect(mark.x).toBeGreaterThan(one.x + one.width);
    expect(mark.x + mark.width).toBeLessThan(two.x);
    expect(defects(scene)).toEqual([]);
  });
});
