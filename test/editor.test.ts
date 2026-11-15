import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseTam } from "../src/tam.ts";
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
