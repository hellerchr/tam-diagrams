// Block diagrams in the editor: plain block diagrams, whose palette and choices leave out the
// design level that the parser still reads.
import { describe, expect, it } from "vitest";
import { parseTam } from "../src/tam.ts";
import { WIRES } from "../editor/menus.ts";
import { PLAIN_KINDS, TYPES } from "../editor/types.ts";
import { editorAt } from "./editor-at.ts";

const DESIGN = `level design
agent shop[Shop] {
  component cart[Cart]
  component checkout[Checkout]
}
checkout -- requires ICart --> cart`;

describe("a block diagram in the editor", () => {
  it("offers the shapes of a plain block diagram only", () => {
    const [block] = TYPES;
    expect(block.palette.map((group) => group.title)).not.toContain("Design level");
    expect(block.palette.flatMap((group) => group.items.map((item) => item.kind))).toEqual([
      "agent",
      "human",
      "storage",
      "group",
    ]);
    expect([...PLAIN_KINDS]).toEqual(["agent", "human", "storage", "group"]);
  });

  it("starts from examples without the design level or packages", () => {
    const [block] = TYPES;
    expect(block.examples.length).toBeGreaterThanOrEqual(3);
    for (const [name, source] of block.examples) {
      const diagram = parseTam(source);
      expect(diagram.level, name).not.toBe("design");
      for (const node of diagram.nodes.values())
        expect(["component", "subsystem", "class", "package", "interface"], name).not.toContain(
          node.kind,
        );
    }
  });

  it("marks the kinds of connection of the design level, which it offers no connection", () => {
    expect(WIRES.filter((kind) => kind.design).map((kind) => kind.value)).toEqual([
      "requires",
      "delegates",
      "dependency:use",
      "dependency:import",
    ]);
  });

  it("opens, draws and edits a source of the design level, and knows it is one", async () => {
    const { doc, editor, settled } = await editorAt(DESIGN);
    expect(doc.problem).toBeUndefined();
    expect(doc.picture!.scene.shapes.some((shape) => shape.id === "cart")).toBe(true);
    expect(editor.designLevel).toBe(true);
    editor.select([{ type: "element", id: "cart" }]);
    editor.setElements({ label: "Basket" });
    await settled();
    expect(doc.source).toContain("component cart[Basket]");

    const plain = await editorAt("agent a[A]\nstorage s[S]\na -- reads --> s");
    expect(plain.editor.designLevel).toBe(false);
  });
});
