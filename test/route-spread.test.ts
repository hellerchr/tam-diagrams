// @vitest-environment node
import { describe, expect, it } from "vitest";
import { umlColors } from "./fixtures";
import { renderUml } from "../src/index";
import { auditScene } from "../src/audit";
import { balanceElements } from "../src/route-spread";
import type { Geometry } from "../src/route";
import type { Box } from "../src/scene";
import { generateStateDiagram } from "../src/samples/fuzz";

/** Text widths without a font: the same estimate the browser-less tests use, scaled by `scale`. */
const estimate = (scale: number) => (text: string, size: number, weight: number) =>
  text.length * size * (weight >= 600 ? 0.62 : 0.58) * scale;

const defects = async (source: string, scale: number) => {
  const { scene } = await renderUml(source, umlColors, { measure: estimate(scale) });
  return auditScene(scene).filter((finding) => !finding.note);
};

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

/**
 * A is held in place by a pinned wire to P and wired straight down to B, which sits right of A's
 * middle with a note on its left. C and D stand beside the note and B, on the same row.
 */
const column = (obstacles: { C: Box; D: Box }): Geometry => {
  const boxes = {
    P: box(100, -100, 100, 40),
    A: box(100, 0, 100, 40),
    B: box(180, 100, 60, 40),
    ...obstacles,
  };
  return {
    boxes: new Map(Object.entries(boxes)),
    routes: new Map([
      ["e", [{ x: 190, y: 40 }, { x: 190, y: 100 }]],
      ["p", [{ x: 150, y: -60 }, { x: 150, y: 0 }]],
    ]),
    nodeLabels: new Map([["B", [box(100, 110, 70, 20)]]]),
    edgeLabels: new Map(),
    ends: new Map([
      ["e", ["A", "B"]],
      ["p", ["P", "A"]],
    ]),
    leaves: new Set(Object.keys(boxes)),
    markers: new Set(),
    round: new Map(),
    ancestors: new Map(),
    containers: new Set(),
    titles: [],
    spacing: { node: 20, edge: 10 },
    pinned: new Set(["p"]),
    widths: new Map(),
  };
};

describe("balancing elements moves their notes along", () => {
  it("moves the note with its element and keeps the spacing to what lies beside it", () => {
    const geometry = column({ C: box(20, 100, 40, 40), D: box(400, 100, 40, 40) });
    balanceElements(geometry, true);
    const [element, note] = [geometry.boxes.get("B")!, geometry.nodeLabels.get("B")![0]];
    // The element would move 60px toward A's middle; its note stops it 20px short, at the spacing from C.
    expect(note.x).toBe(geometry.boxes.get("C")!.x + geometry.boxes.get("C")!.width + 20);
    expect(element.x - note.x).toBe(80);
    expect(note.y).toBe(110);
  });

  it("leaves an element where it is when it and its note do not fit the free space", () => {
    const geometry = column({ C: box(60, 100, 40, 40), D: box(250, 100, 40, 40) });
    balanceElements(geometry, true);
    expect(geometry.boxes.get("B")).toEqual(box(180, 100, 60, 40));
    expect(geometry.nodeLabels.get("B")).toEqual([box(100, 110, 70, 20)]);
  });

  it("stops an element at a foreign wire that runs between it and its note", () => {
    const geometry = column({ C: box(-200, 100, 40, 40), D: box(600, 100, 40, 40) });
    geometry.nodeLabels.set("B", [box(80, 110, 70, 20)]);
    geometry.routes.set("w", [
      { x: 165, y: 60 },
      { x: 165, y: 180 },
    ]);
    geometry.ends.set("w", ["X", "Y"]);
    balanceElements(geometry, true);
    // The wire (x = 165, gap 10) lies low of B (180..240): shift >= 165 + 10 - 180 = -5. It lies
    // high of the note (80..150): shift <= 165 - 10 - 150 = 5. The wanted shift of -60 clamps to -5.
    expect(geometry.boxes.get("B")).toEqual(box(175, 100, 60, 40));
    expect(geometry.nodeLabels.get("B")).toEqual([box(75, 110, 70, 20)]);
  });

  it("leaves the notes where they were when a connection cannot follow the moved element", () => {
    const geometry = column({ C: box(-200, 100, 40, 40), D: box(600, 100, 40, 40) });
    geometry.boxes.set("Q", box(225, 200, 20, 40));
    geometry.leaves.add("Q");
    geometry.routes.set("f", [
      { x: 235, y: 140 },
      { x: 235, y: 200 },
    ]);
    geometry.ends.set("f", ["B", "Q"]);
    // A pinned wire holds Q, so only B moves.
    geometry.routes.set("q", [
      { x: 235, y: 240 },
      { x: 235, y: 300 },
    ]);
    geometry.ends.set("q", ["Q", "Z"]);
    geometry.pinned!.add("q");
    const before = {
      boxes: new Map(geometry.boxes),
      routes: new Map(geometry.routes),
      notes: new Map(geometry.nodeLabels),
    };
    balanceElements(geometry, true);
    // B would move 17.5px left, toward the middle of A and Q, but then overlaps Q by under 16px.
    expect(geometry.boxes).toEqual(before.boxes);
    expect(geometry.routes).toEqual(before.routes);
    expect(geometry.nodeLabels).toEqual(before.notes);
  });

  it("keeps a note at its distance from the state ELK made room for it beside", async () => {
    expect(await defects(generateStateDiagram(21), 1)).toEqual([]);
  });

  it("leaves no note too close to a state across generated state diagrams", async () => {
    const found: string[] = [];
    for (let seed = 1; seed <= 30; seed++)
      for (const scale of [1, 1.1])
        for (const finding of await defects(generateStateDiagram(seed), scale))
          if (finding.check === "note-too-close") found.push(`${seed}@${scale}: ${finding.detail}`);
    expect(found).toEqual([]);
  }, 60_000);
});

describe("balancing an element with a note on its leading side inside a container", () => {
  /** B and its note, which reaches 80px before B, inside a container K of the given frame. */
  const inK = (frame: Box) => {
    const geometry = column({ C: box(-200, 100, 40, 40), D: box(600, 100, 40, 40) });
    geometry.boxes.set("K", frame);
    geometry.containers.add("K");
    geometry.ancestors.set("B", ["K"]);
    return geometry;
  };

  it("keeps the note inside the container's start", () => {
    // B would start at 120 (the middle of A); K's 6px inset starts at 66, so B starts 80px after it.
    const geometry = inK(box(60, 60, 400, 200));
    balanceElements(geometry, true);
    expect(geometry.boxes.get("B")!.x).toBe(146);
    expect(geometry.nodeLabels.get("B")![0].x).toBe(66);
  });

  it("keeps B inside the container's end", () => {
    // A is 300px wide, so B would start at 220; K's inset ends at 254, which B's 60px leave at 194.
    const geometry = inK(box(60, 60, 200, 200));
    geometry.boxes.set("A", box(100, 0, 300, 40));
    balanceElements(geometry, true);
    expect(geometry.boxes.get("B")!.x).toBe(194);
    expect(geometry.nodeLabels.get("B")![0].x).toBe(114);
  });
});

describe("balancing elements without notes", () => {
  it("moves an element to the nearest start in free space too narrow for it", () => {
    const geometry = column({ C: box(100, 100, 60, 40), D: box(240, 100, 40, 40) });
    geometry.nodeLabels.clear();
    balanceElements(geometry, true);
    // C and D leave 180..220 (spacing 20), 40px for B's 60. The start is
    // min(max(target - size / 2, low), high - size) = min(max(150 - 30, 180), 220 - 60) = 160.
    expect(geometry.boxes.get("B")).toEqual(box(160, 100, 60, 40));
  });

  it("keeps the node spacing to an element that starts below it, within that spacing", () => {
    // C starts 10px below B, inside the spacing of 20, and ends at 110: B stops at 130, not at 120.
    const geometry = column({ C: box(70, 150, 40, 40), D: box(600, 100, 40, 40) });
    geometry.nodeLabels.clear();
    balanceElements(geometry, true);
    expect(geometry.boxes.get("B")).toEqual(box(130, 100, 60, 40));
  });
});
