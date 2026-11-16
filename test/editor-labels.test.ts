// Labels on the canvas: the label of a connection or a message is dragged where it should stand,
// the source keeps that place, and Undo and Redo step through it as through any move.
import { describe, expect, it } from "vitest";
import { labelGroups, lineMiddle } from "../src/label-places.ts";
import { centerOf, type Scene } from "../src/scene.ts";
import { textGroupBox } from "../src/text.ts";
import { readLabels } from "../src/uml-places.ts";
import { editorAt } from "./editor-at.ts";

/** The middle of the label a wire carries in a scene. */
const labelMiddle = (scene: Scene, wire: string) =>
  centerOf(textGroupBox(labelGroups(scene).get(wire)!));

/** Where the label of a wire is drawn from the middle of its line, in whole pixels. */
const offsetOf = (scene: Scene, wire: string) => {
  const at = labelMiddle(scene, wire),
    middle = lineMiddle(scene, wire)!;
  return { x: Math.round(at.x - middle.x), y: Math.round(at.y - middle.y) };
};

const BLOCK = `agent web[Web] @0,0
agent api[API] @300,0
web -- calls: order --> api`;

describe("dragging a label on the canvas", () => {
  it("stands a channel's label of a block diagram where it is dropped, behind its connection", async () => {
    const { doc, editor, drag } = await editorAt(BLOCK),
      before = offsetOf(doc.picture!.scene, "e1"),
      from = labelMiddle(doc.picture!.scene, "e1");
    await drag(from, { x: from.x + 40, y: from.y - 30 });
    expect(editor.selectedWires).toEqual(["e1"]);
    const after = { x: before.x + 40, y: before.y - 30 },
      sign = (value: number) => `${value < 0 ? "-" : "+"}${Math.abs(value)}`;
    expect(doc.source.split("\n").at(-1)).toBe(
      `web -- calls: order --> api @${sign(after.x)},${sign(after.y)}`,
    );
    expect(offsetOf(doc.picture!.scene, "e1")).toEqual(after);
    expect(labelMiddle(doc.picture!.scene, "e1").x).toBeCloseTo(from.x + 40, 0);
    expect(editor.labelPlaced("e1")).toBe(true);
    // One step back, and forth again.
    doc.undo();
    expect(doc.source).toBe(BLOCK);
    doc.redo();
    expect(doc.source).toContain("@+");
    // Put back, the layout places it again.
    editor.unplaceLabel("e1");
    expect(doc.source).toBe(BLOCK);
  });

  it("keeps a click on a label a selection, and moves nothing", async () => {
    const { doc, editor, fire, settled } = await editorAt(BLOCK),
      at = labelMiddle(doc.picture!.scene, "e1");
    fire("pointerdown", at.x, at.y);
    fire("pointerup", at.x, at.y);
    await settled();
    expect(editor.selectedWires).toEqual(["e1"]);
    expect(doc.source).toBe(BLOCK);
    expect(doc.canUndo).toBe(false);
  });

  it("keeps the label beside its line when an end moves", async () => {
    const { doc, editor, drag } = await editorAt(BLOCK),
      from = labelMiddle(doc.picture!.scene, "e1");
    await drag(from, { x: from.x, y: from.y - 50 });
    const offset = offsetOf(doc.picture!.scene, "e1");
    editor.select([{ type: "element", id: "api" }]);
    editor.nudge(0, 100);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(doc.source).toContain("agent api[API] @300,100");
    expect(offsetOf(doc.picture!.scene, "e1")).toEqual(offset);
  });

  it("stands a message's label of a sequence diagram where it is dropped, on a comment line", async () => {
    const source = `sequenceDiagram
  participant U as User
  participant S as Shop
  participant P as Payment
  U->>S: place order
  S->>P: charge`;
    const { doc, editor, drag } = await editorAt(source),
      before = offsetOf(doc.picture!.scene, "m2"),
      from = labelMiddle(doc.picture!.scene, "m2");
    await drag(from, { x: from.x + 30, y: from.y + 20 });
    expect(editor.selectedWires).toEqual(["m2"]);
    expect(doc.source.startsWith(`${source}\n%% @label:m2 `)).toBe(true);
    expect(readLabels(doc.source)).toEqual(
      new Map([["m2", { x: before.x + 30, y: before.y + 20 }]]),
    );
    expect(offsetOf(doc.picture!.scene, "m2")).toEqual({ x: before.x + 30, y: before.y + 20 });
    doc.undo();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(doc.source).toBe(source);
  });

  it("stands the label of a flow of an activity diagram where it is dropped", async () => {
    const source = "flowchart TB\n  a[Ask] -->|yes| b[Do]\n  a -->|no| c[Stop]";
    const { doc, drag } = await editorAt(source),
      from = labelMiddle(doc.picture!.scene, "e1"),
      before = offsetOf(doc.picture!.scene, "e1");
    await drag(from, { x: from.x - 50, y: from.y });
    expect(readLabels(doc.source).get("e1")).toEqual({ x: before.x - 50, y: before.y });
    expect(offsetOf(doc.picture!.scene, "e1").x).toBe(before.x - 50);
  });
});
