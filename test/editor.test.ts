import { describe, expect, it, vi } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseTam } from "../src/tam.ts";
import { readPlaces, setPlaces } from "../src/uml-places.ts";
import { Doc } from "../editor/document.ts";
import { boxOf, dropTarget, elementsIn, partAt, wireOf } from "../editor/hit.ts";

const SOURCE = `agent shop[Shop] @0,0 400x200 {
  agent api[API] @40,60
  storage db[DB] @240,60
}
agent late[Late] ... @0,300
api -- reads/writes --> db
late -- calls: ping --> api`;

const doc = async (source: string) => {
  const made = new Doc(arialMeasure);
  await made.open(source);
  return made;
};

describe("the editor's document", () => {
  it("lays a placed source out at once, and an unplaced one automatically", async () => {
    const placed = await doc(SOURCE);
    expect(placed.picture).toMatchObject({ placed: true, source: SOURCE });
    expect(placed.placedSource()).toBe(SOURCE);
    const auto = await doc("agent a[A]\nstorage s[S]\na -- reads --> s");
    expect(auto.picture!.placed).toBe(false);
    // A gesture starts from the same picture, with every element placed.
    const pinned = auto.placedSource()!;
    expect([...parseTam(pinned).nodes.values()].every((node) => node.at)).toBe(true);
  });

  it("keeps a broken source as text, with the picture before it, and undoes it", async () => {
    const made = await doc(SOURCE);
    await made.apply(`${SOURCE}\nnonsense here`);
    expect(made.problem).toMatchObject({ line: 8 });
    expect(made.picture!.source).toBe(SOURCE);
    expect(made.placedSource()).toBeUndefined();
    made.undo();
    expect(made.source).toBe(SOURCE);
    expect(made.problem).toBeUndefined();
    made.redo();
    expect(made.source).toContain("nonsense");
  });

  it("refuses an edit the notation forbids and says why", async () => {
    const made = await doc(SOURCE);
    expect(made.tryApply(`${SOURCE}\ndb -- calls --> api`)?.message).toContain("storage");
    expect(made.source).toBe(SOURCE);
    expect(made.canUndo).toBe(false);
  });

  it("shows a preview without committing it", async () => {
    const made = await doc(SOURCE);
    expect(made.preview(SOURCE.replace("@40,60", "@60,80"))).toBe(true);
    expect(boxOf(made.picture!, "api")).toMatchObject({ x: 60, y: 80 });
    expect(made.source).toBe(SOURCE);
    made.cancel();
    expect(boxOf(made.picture!, "api")).toMatchObject({ x: 40, y: 60 });
  });
});

describe("what lies at a point of the picture", () => {
  it("finds leaves, containers, wires and their circles and labels", async () => {
    const { picture } = await doc(SOURCE);
    expect(partAt(picture!, { x: 50, y: 70 })).toEqual({ type: "element", id: "api" });
    expect(partAt(picture!, { x: 200, y: 180 })).toEqual({ type: "element", id: "shop" });
    expect(partAt(picture!, { x: 900, y: 900 })).toBeUndefined();
    // On the line between the two: the access.
    const [line] = picture!.scene.wires.filter((wire) => wire.edge === "e1"),
      middle = line.points[Math.floor(line.points.length / 2)];
    expect(partAt(picture!, middle)).toEqual({ type: "wire", id: "e1" });
    // The copy of an element drawn as several is the element; its wire is the original's.
    const copy = boxOf(picture!, "late#2")!;
    expect(partAt(picture!, { x: copy.x + 5, y: copy.y + 5 })).toEqual({
      type: "element",
      id: "late",
    });
    expect(wireOf(picture!.diagram, "e2#2")).toBe("e2");
    const circle = picture!.scene.shapes.find((shape) => shape.id === "e2#node")!.box;
    expect(partAt(picture!, { x: circle.x + 8, y: circle.y + 8 })).toEqual({
      type: "wire",
      id: "e2",
    });
  });

  it("finds what a frame catches and where a dragged element would drop", async () => {
    const { picture } = await doc(SOURCE);
    expect(elementsIn(picture!, { x: 20, y: 40, width: 400, height: 100 }).toSorted()).toEqual([
      "api",
      "db",
    ]);
    expect(dropTarget(picture!, { x: 200, y: 180 }, new Set(), false)).toBe("shop");
    expect(dropTarget(picture!, { x: 50, y: 70 }, new Set(), false)).toBe("shop");
    expect(dropTarget(picture!, { x: 50, y: 70 }, new Set(), true)).toBe("api");
    expect(dropTarget(picture!, { x: 200, y: 180 }, new Set(["shop"]), false)).toBeNull();
  });
});

describe("diagram types in the editor", () => {
  it("draws a UML source as a picture to look at, and says what type it is", async () => {
    const { TYPES, typeOf } = await import("../editor/types.ts");
    for (const info of TYPES.filter((item) => item.type !== "tam")) {
      expect(typeOf(info.starter)).toBe(info.type);
      const made = await doc(info.starter);
      expect(made.problem, info.name).toBeUndefined();
      expect(made.picture).toMatchObject({ type: info.type, placed: false });
      expect(made.picture!.scene.shapes.length).toBeGreaterThan(0);
      // Nothing of it is placed by hand; an activity diagram's nodes are there to select and change.
      expect(made.placedSource()).toBeUndefined();
      const nodes = made.picture!.diagram.nodes.size;
      if (info.mode === "structure") expect(nodes).toBeGreaterThan(0);
      else expect(nodes).toBe(0);
      // Every snippet adds statements the type reads.
      for (const snippet of info.snippets) {
        await made.apply(`${info.starter}\n${snippet.text}\n`);
        expect(made.problem, `${info.name}: ${snippet.name}`).toBeUndefined();
      }
    }
  });

  it("reports the line of an error in a UML source", async () => {
    const made = await doc("classDiagram\n  class A\n  A --> ");
    expect(made.problem?.line).toBe(3);
  });
});

describe("an activity diagram in the editor", () => {
  it("shows its nodes, groups and edges as parts to select", async () => {
    const made = await doc(
      "flowchart TB\n  a[A] --> b{B?}\n  subgraph g [G]\n    c[C]\n  end\n  b -->|yes| c",
    );
    const { picture } = made;
    expect(picture!.diagram.roots).toEqual(["a", "b", "g"]);
    expect(picture!.diagram.nodes.get("g")).toMatchObject({ kind: "group", children: ["c"] });
    const box = boxOf(picture!, "a")!;
    expect(partAt(picture!, { x: box.x + 5, y: box.y + 5 })).toEqual({ type: "element", id: "a" });
    const [wire] = picture!.scene.wires.filter((item) => item.edge === "e2"),
      middle = wire.points[Math.floor(wire.points.length / 2)];
    expect(partAt(picture!, middle)).toEqual({ type: "wire", id: "e2" });
  });
});

describe("the positions of a diagram with a structure", () => {
  const CHART = "flowchart TB\n  a[A] --> b{B?}\n  b -->|yes| c[C]\n  b -->|no| a";
  /** Waits for a picture that comes after the call that asked for it. */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("pins every part where the picture shows it, and shows the same picture", async () => {
    const made = await doc(CHART),
      auto = made.picture!;
    expect(auto.placed).toBe(false);
    const pinned = made.pinnedSource()!;
    expect(pinned.startsWith(`${CHART}\n%% @`)).toBe(true);
    expect([...readPlaces(pinned).keys()].toSorted()).toEqual(
      auto.scene.shapes.map((shape) => shape.id).toSorted(),
    );
    await made.apply(pinned);
    expect(made.picture).toMatchObject({ placed: true, overlaps: [] });
    expect(made.picture!.scene).toEqual(auto.scene);
    // A block diagram is pinned in its own syntax, a source with an error not at all.
    expect(made.placedSource()).toBeUndefined();
    await made.apply(`${pinned}\n  b -->`);
    expect(made.pinnedSource()).toBeUndefined();
  });

  it("previews a move from the picture on show, and returns to it", async () => {
    const made = await doc(CHART),
      before = made.picture!,
      was = boxOf(before, "c")!;
    const moved = setPlaces(made.pinnedSource()!, {
      c: { x: Math.round(was.x) + 200, y: Math.round(was.y) },
    });
    expect(made.preview(moved)).toBe(true);
    await settled();
    expect(boxOf(made.picture!, "c")!.x).toBe(Math.round(was.x) + 200);
    expect(boxOf(made.picture!, "a")).toEqual(boxOf(before, "a"));
    expect(made.source).toBe(CHART);
    expect(made.canUndo).toBe(false);
    made.cancel();
    expect(made.picture).toBe(before);
    expect(made.preview(`${moved}\n  c -->`)).toBe(false);
  });

  it("says which parts lie on each other once they are placed", async () => {
    const made = await doc(CHART),
      a = boxOf(made.picture!, "a")!;
    await made.apply(
      setPlaces(made.pinnedSource()!, { c: { x: Math.round(a.x) + 5, y: Math.round(a.y) + 5 } }),
    );
    expect(made.picture!.overlaps).toEqual([["a", "c"]]);
    // Undo returns to the source without places, and its automatic layout.
    made.undo();
    expect(made.source).toBe(CHART);
    await vi.waitFor(() => expect(made.picture!.source).toBe(CHART));
    expect(made.picture!.placed).toBe(false);
  });
});
