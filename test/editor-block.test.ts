// Block diagrams in the editor: plain block diagrams, whose palette and choices leave out the
// design level that the parser still reads.
import { describe, expect, it } from "vitest";
import type { Box } from "../src/scene.ts";
import { parseTam } from "../src/tam.ts";
import { ICONS } from "../editor/icons.ts";
import { WIRES } from "../editor/menus.ts";
import { Palette } from "../editor/palette.ts";
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
      "note",
    ]);
    expect([...PLAIN_KINDS]).toEqual(["agent", "human", "storage", "group", "note"]);
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

const SHOP = `agent web[Web] @0,0
agent api[API] @300,0
storage db[Orders] @0,200`;

/** The middle of an element's box. */
const middle = (picture: { scene: { shapes: { id: string; box: Box }[] } }, id: string) => {
  const { box } = picture.scene.shapes.find((shape) => shape.id === id)!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

describe("the connections of a block diagram's palette", () => {
  it("are the conceptual connections of the notation, each with a drawing of its own", () => {
    const links = TYPES[0].links!;
    expect(links.map((link) => link.kind)).toEqual([
      "calls",
      "sends data",
      "calls both",
      "---",
      "reads",
      "writes",
      "reads/writes",
    ]);
    const icons = links.map((link) => link.icon);
    expect(new Set(icons.map((name) => ICONS[name])).size).toBe(icons.length);
    for (const link of links) expect(link.hint).toMatch(/\(.*(--|---).*\)$/);
  });

  it("stand in the Shapes tab under Connections, and the one picked is pressed", async () => {
    const { editor } = await editorAt(SHOP),
      palette = new Palette(editor, () => {});
    palette.update();
    const groups = [...palette.element.querySelectorAll(".palette-group")];
    const connections = groups.find((group) => group.textContent!.startsWith("Connections"))!;
    const tiles = [...connections.querySelectorAll<HTMLButtonElement>(".tile")];
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      "Request",
      "Data flow",
      "Both ways",
      "Channel",
      "Read",
      "Write",
      "Read/write",
    ]);
    tiles[4].click();
    palette.update();
    expect(editor.link).toBe("reads");
    expect(editor.tool).toBe("connect");
    expect(tiles.map((tile) => tile.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "false",
      "false",
      "true",
      "false",
      "false",
    ]);
    // Picked again, the connection is the one that fits again.
    tiles[4].click();
    expect(editor.link).toBeUndefined();
    expect(editor.tool).toBe("select");
  });

  it("draws the kind picked from element to element", async () => {
    const { doc, editor, drag } = await editorAt(SHOP);
    editor.setLink("sends data");
    await drag(middle(doc.picture!, "web"), middle(doc.picture!, "api"));
    expect(doc.source.trimEnd().split("\n").at(-1)).toBe("web -- sends data --> api");
    expect(editor.selectedWires).toHaveLength(1);
    editor.setLink("calls both");
    await drag(middle(doc.picture!, "api"), middle(doc.picture!, "web"));
    expect(doc.source.trimEnd().split("\n").at(-1)).toBe("api <-- calls --> web");
    editor.setLink("writes");
    await drag(middle(doc.picture!, "web"), middle(doc.picture!, "db"));
    expect(doc.source.trimEnd().split("\n").at(-1)).toBe("web -- writes --> db");
    // Undo takes the connection back.
    doc.undo();
    expect(doc.source).not.toContain("web -- writes --> db");
  });

  it("draws the kind picked from the dots beside a selected element", async () => {
    const { doc, editor, drag } = await editorAt(SHOP);
    editor.setLink("---");
    editor.setTool("select");
    editor.select([{ type: "element", id: "web" }]);
    const box = doc.picture!.scene.shapes.find((shape) => shape.id === "web")!.box;
    // The dot off the middle of the right side.
    await drag(
      { x: box.x + box.width + 22, y: box.y + box.height / 2 },
      middle(doc.picture!, "api"),
    );
    expect(doc.source.trimEnd().split("\n").at(-1)).toBe("web --- api");
  });

  it("connects a pair the kind does not fit with what fits them, and says so", async () => {
    const { doc, editor, drag, notes } = await editorAt(SHOP);
    const last = () => doc.source.trimEnd().split("\n").at(-1);
    // A read drawn from the storage is written from the agent, without a word about it.
    editor.setLink("reads");
    await drag(middle(doc.picture!, "db"), middle(doc.picture!, "web"));
    expect(last()).toBe("web -- reads --> db");
    // A request drawn to a storage is the write the drag means.
    const said = notes.length;
    editor.setLink("calls");
    await drag(middle(doc.picture!, "web"), middle(doc.picture!, "db"));
    expect(last()).toBe("web -- writes --> db");
    expect(notes.slice(said).at(-1)).toMatch(/storage.*Drawn as a write access instead\./);
  });

  it("leaves the selected connection as it is: the one drawn last stays what it was drawn as", async () => {
    const { doc, editor, settled } = await editorAt(`${SHOP}\nweb -- calls --> api`);
    editor.select([{ type: "wire", id: "e1" }]);
    editor.setLink("sends data");
    await settled();
    expect(doc.source.trimEnd().split("\n").at(-1)).toBe("web -- calls --> api");
  });

  it("ends a connection dropped on the empty canvas at a new element of the kind it reaches", async () => {
    const { doc, editor, drag } = await editorAt(SHOP);
    editor.setLink("writes");
    await drag(middle(doc.picture!, "web"), { x: 600, y: 300 });
    const [, last] = doc.source.trimEnd().split("\n").slice(-2);
    expect(last).toBe("web -- writes --> storage1");
    expect(doc.source).toMatch(/^storage storage1\[Storage\] @/m);
  });
});
