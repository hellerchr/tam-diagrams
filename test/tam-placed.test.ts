import { describe, expect, it } from "vitest";
import { isPlaced, parseTam } from "../src/tam.ts";
import { bestLayout, layoutPlaced, renderTam } from "../src/tam-layout.ts";
import { elementBoxes, pin } from "../src/tam-pin.ts";
import { unplace } from "../src/tam-edit.ts";
import { arialMeasure } from "../src/arial-measure.ts";
import { TAM_EXAMPLES } from "../src/samples/tam-examples.ts";
import { segmentHits } from "../src/scene.ts";
import { colors, parseError } from "./fixtures.ts";

const boxes = (source: string) => {
  const diagram = parseTam(source);
  return elementBoxes(diagram, layoutPlaced(diagram, arialMeasure));
};

describe("placements in the TAM syntax", () => {
  it("reads a position, and a size, among an element's modifiers", () => {
    const diagram = parseTam(`agent a[A] @120,40
storage s "S":::blue stack @-10.5,20 300x200 {
  storage t @ 1, 2
}
agent b[B] @5,6:::red ...`);
    expect(diagram.nodes.get("a")!.at).toEqual({ x: 120, y: 40 });
    expect(diagram.nodes.get("s")).toMatchObject({
      color: "blue",
      stack: true,
      at: { x: -10.5, y: 20, width: 300, height: 200 },
    });
    expect(diagram.nodes.get("t")!.at).toEqual({ x: 1, y: 2 });
    expect(diagram.nodes.get("b")).toMatchObject({ color: "red", at: { x: 5, y: 6 } });
    expect(isPlaced(diagram)).toBe(true);
  });

  it("leaves sources without placements as they were", () => {
    const diagram = parseTam("agent a[A]\nagent b[B]\na -- calls: x @HTTP --> b");
    expect(isPlaced(diagram)).toBe(false);
    expect([...diagram.nodes.values()].every((node) => node.at === undefined)).toBe(true);
    // The `@` of a protocol is no placement.
    expect(diagram.edges[0]).toMatchObject({ label: "x", protocol: "HTTP" });
  });

  it("rejects placements that cannot be drawn", () => {
    expect(parseError(parseTam, "agent a @1,2 @3,4").message).toContain("placed twice");
    expect(parseError(parseTam, "agent a @1,2 0x4").message).toContain("no drawable size");
    expect(parseError(parseTam, "agent a @999999,2").message).toContain("too far out");
    expect(parseError(parseTam, "agent a @1").line).toBe(1);
  });
});

describe("layout by hand", () => {
  it("puts every element where the source says, at the size it asks for or needs", () => {
    const placed = boxes(`agent a[A] @100,50
storage s[S] @300,200 200x80
agent tiny[A very long name indeed] @0,300 10x10`);
    expect(placed.get("a")).toMatchObject({ x: 100, y: 50, width: 96, height: 40 });
    expect(placed.get("s")).toEqual({ x: 300, y: 200, width: 200, height: 80 });
    expect(placed.get("tiny")!.width).toBeGreaterThan(100);
  });

  it("fits a container around its parts, and no smaller than its placement asks", () => {
    const placed = boxes(`agent outer[Outer] {
  agent a[A] @100,100
  agent b[B] @300,200
}
agent sized[Sized] @600,0 400x300 {
  agent c[C] @620,60
}`);
    const outer = placed.get("outer")!;
    expect(outer.x).toBeLessThan(100);
    expect(outer.y).toBeLessThan(100);
    expect(outer.x + outer.width).toBeGreaterThan(396);
    expect(outer.y + outer.height).toBeGreaterThan(240);
    expect(placed.get("sized")).toEqual({ x: 600, y: 0, width: 400, height: 300 });
  });

  it("stands elements the source does not place below the placed ones", () => {
    const placed = boxes("agent a[A] @100,50\nagent b[B]\nstorage c[C]");
    expect(placed.get("b")!.y).toBeGreaterThan(90);
    expect(placed.get("c")!.x).toBeGreaterThan(placed.get("b")!.x + 96);
  });

  it("routes a wire around an element between its ends", () => {
    const diagram = parseTam(`agent a[A] @0,0
agent wall[Wall] @200,-100 96x300
agent b[B] @400,0
a -- calls --> b`);
    const scene = layoutPlaced(diagram, arialMeasure),
      wall = scene.shapes.find((shape) => shape.id === "wall")!.box;
    expect(scene.wires.length).toBeGreaterThan(0);
    for (const wire of scene.wires)
      for (let index = 1; index < wire.points.length; index++)
        expect(segmentHits(wire.points[index - 1], wire.points[index], wall)).toBe(false);
  });

  it("draws a placed source without ELK, and the same source twice the same", async () => {
    const source = "agent a[A] @0,0\nstorage s[S] @0,200\na -- reads/writes: x --> s";
    const never = () => Promise.reject(new Error("ELK ran"));
    const first = await renderTam(source, colors, { measure: arialMeasure, layout: never });
    const second = await renderTam(source, colors, { measure: arialMeasure, layout: never });
    expect(first.svg).toBe(second.svg);
    expect(first.svg).toContain(">x<");
  });
});

describe("pinning a layout", () => {
  const samples = TAM_EXAMPLES.filter(([name]) => !name.startsWith("error"));

  it.each(samples)(
    "%s: keeps every element in place, and unplacing gives the source back",
    async (_, source) => {
      const diagram = parseTam(source),
        scene = await bestLayout(diagram, arialMeasure),
        pinned = pin(source, scene, arialMeasure);
      expect(unplace(pinned)).toBe(source.replace(/\r\n?/g, "\n"));
      const before = elementBoxes(diagram, scene),
        after = boxes(pinned);
      expect([...after.keys()]).toEqual([...before.keys()]);
      for (const [id, box] of after) {
        const was = before.get(id)!;
        // Leaves keep their middle to the pixel positions are rounded to; containers fit what they hold,
        // and a copy (`...`) stands beside its original wherever the automatic layout had it.
        if (diagram.nodes.get(id)!.children.length) continue;
        expect(Math.abs(box.x + box.width / 2 - was.x - was.width / 2), id).toBeLessThanOrEqual(
          1.5,
        );
        expect(Math.abs(box.y + box.height / 2 - was.y - was.height / 2), id).toBeLessThanOrEqual(
          1.5,
        );
      }
      // Every connection is drawn.
      const drawn = new Set(
        layoutPlaced(parseTam(pinned), arialMeasure).wires.map((wire) => wire.edge),
      );
      for (const edge of diagram.edges) expect(drawn.has(edge.id), edge.id).toBe(true);
    },
  );
});
