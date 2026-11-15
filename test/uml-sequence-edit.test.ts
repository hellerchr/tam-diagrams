import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseUml } from "../src/index.ts";
import { SEQUENCE_EXAMPLES } from "../src/samples/uml-examples.ts";
import { parseSequenceDiagram } from "../src/uml-sequence.ts";
import {
  addSequencePiece,
  insertMessage,
  labelMessage,
  moveMessage,
  relinkMessage,
  removeSequence,
  renameSequence,
  sequenceStructure,
} from "../src/uml-sequence-edit.ts";

const SHOP = `sequenceDiagram
  participant U as User
  participant S as Shop
  participant P as Payment
  U->>S: place order
  S->>P: charge
  P-->>S: paid
  S-->>U: confirmation`;

const BARS = `sequenceDiagram
  %% who takes part
  actor U as Customer
  participant W as Web shop

  box Purple Back office
    participant I as Inventory
    participant O as Orders
  end
  U->>W: checkout
  W->>+I: reserve items
  alt all in stock
    I-->>W: reserved
    %% the order is created only now
    W->>+O: create order
    O-->>-W: order id
  else something missing
    I-->>W: missing items
  end
  deactivate I
  note over W,O: both keep a log
  note right of O: alone
  loop until shipped
    O->>I: poll status
  end
  W-->>U: done`;

const LIFE = `sequenceDiagram
  participant web
  web->>+dyn: requestEditPage()
  create participant link as newLink
  dyn-)link: create
  dyn-->>-web: Edit Page
  destroy link
  web-xlink: delete`;

const messages = (source: string) =>
  parseSequenceDiagram(source).events.flatMap((event) =>
    event.type === "message"
      ? [`${event.from}>${event.to}${event.text ? `:${event.text}` : ""}`]
      : [],
  );

/** The lines of `after` that `before` does not have, and the other way round. */
const changed = (before: string, after: string) => {
  const was = before.split("\n"),
    now = after.split("\n");
  return {
    added: now.filter((line) => !was.includes(line)),
    lost: was.filter((line) => !now.includes(line)),
  };
};

const parses = (source: string) => expect(() => parseUml(source), source).not.toThrow();

describe("editing a sequence diagram as text", () => {
  it("adds participants and actors after the last declaration, or at the top", () => {
    const added = addSequencePiece(SHOP, { kind: "participant", label: "Mailer" });
    expect(added.id).toBe("head:participant1");
    expect(changed(SHOP, added.source)).toEqual({
      added: ["  participant participant1 as Mailer"],
      lost: [],
    });
    expect(added.source.split("\n")[4]).toBe("  participant participant1 as Mailer");
    const actor = addSequencePiece(added.source, { kind: "actor" });
    expect(actor.id).toBe("head:actor1");
    expect(actor.source.split("\n")[5]).toBe("  actor actor1 as Actor");
    expect(parseSequenceDiagram(actor.source).participants.get("actor1")).toMatchObject({
      actor: true,
      label: "Actor",
    });
    // Participants that only messages name: the new one is declared at the top.
    const implied = addSequencePiece("sequenceDiagram\n  autonumber\n\tA->>B: hi", {
      kind: "participant",
      label: "C",
    });
    expect(implied.source).toBe(
      "sequenceDiagram\n  autonumber\n\tparticipant participant1 as C\n\tA->>B: hi",
    );
    expect(addSequencePiece("sequenceDiagram", { kind: "participant" }).source).toBe(
      "sequenceDiagram\n  participant participant1 as Participant",
    );
    // A second one takes the next free id.
    expect(addSequencePiece(added.source, { kind: "participant" }).id).toBe("head:participant2");
    // A participant created on the way is not where new ones are declared.
    expect(addSequencePiece(LIFE, { kind: "participant" }).source.split("\n")[2]).toBe(
      "  participant participant1 as Participant",
    );
  });

  it("adds participants inside a box, after it, and boxes with a first participant", () => {
    const inside = addSequencePiece(BARS, { kind: "participant", label: "Stock", parent: "box0" });
    expect(changed(BARS, inside.source)).toEqual({
      added: ["    participant participant1 as Stock"],
      lost: [],
    });
    expect(parseSequenceDiagram(inside.source).participants.get("participant1")!.box).toBe(0);
    expect(inside.source.split("\n")[8]).toBe("    participant participant1 as Stock");
    // The last declaration stands in a box: a new participant without one comes after its `end`.
    const outside = addSequencePiece(BARS, { kind: "actor", label: "Clerk" });
    expect(outside.source.split("\n").slice(8, 10)).toEqual(["  end", "  actor actor1 as Clerk"]);
    expect(parseSequenceDiagram(outside.source).participants.get("actor1")!.box).toBe(null);
    // Boxes do not nest: a box asked for inside another stands beside it.
    const box = addSequencePiece(BARS, { kind: "box", label: "Red team", parent: "box0" });
    expect(box.id).toBe("box1");
    expect(changed(BARS, box.source).added).toEqual([
      "  box transparent Red team",
      "    participant participant1 as Participant",
    ]);
    const read = sequenceStructure.read(box.source);
    expect(read.nodes.find((node) => node.id === "box1")).toMatchObject({
      label: "Red team",
      group: true,
      kind: "box",
    });
    expect(read.nodes.find((node) => node.id === "head:participant1")!.parent).toBe("box1");
    const first = addSequencePiece("sequenceDiagram\n  A->>B: hi", { kind: "box" });
    expect(first).toEqual({
      id: "box0",
      source:
        "sequenceDiagram\n  box Group\n    participant participant1 as Participant\n  end\n  A->>B: hi",
    });
  });

  it("sends messages at the end and after a message", () => {
    const sent = insertMessage(SHOP, "head:U", "head:P");
    expect(sent).toBe(`${SHOP}\n  U->>P: message`);
    expect(insertMessage(`${SHOP}\n\n`, "head:P", "head:P", { kind: "reply", label: "" })).toBe(
      `${SHOP}\n  P-->>P\n\n`,
    );
    const after = insertMessage(SHOP, "head:S", "head:U", {
      kind: "async",
      label: "wait",
      after: "m2",
    });
    expect(changed(SHOP, after)).toEqual({ added: ["  S-)U: wait"], lost: [] });
    expect(messages(after)[2]).toBe("S>U:wait");
    // After a message of a fragment, the new one stands in the fragment too.
    const fragment = insertMessage(BARS, "head:O", "head:U", { after: "m4" });
    expect(fragment.split("\n")[15]).toBe("    O->>U: message");
    // At the end it stands in no fragment, whatever the last line is.
    const ended = insertMessage(`${BARS}\n  opt more\n    U->>W: again\n  end`, "head:U", "head:W");
    expect(ended.endsWith("  end\n  U->>W: message")).toBe(true);
    // Parts that are no participants are not sent to.
    expect(insertMessage(BARS, "head:U", "box0")).toBe(BARS);
    expect(insertMessage(BARS, "head:U", "head:nobody")).toBe(BARS);
    expect(insertMessage(SHOP, "head:U", "head:S", { after: "m99" })).toBe(
      `${SHOP}\n  U->>S: message`,
    );
  });

  it("moves a message past its neighbour", () => {
    expect(messages(moveMessage(SHOP, "m2", 1))).toEqual([
      "U>S:place order",
      "P>S:paid",
      "S>P:charge",
      "S>U:confirmation",
    ]);
    expect(moveMessage(SHOP, "m2", -1).split("\n").slice(4, 6)).toEqual([
      "  S->>P: charge",
      "  U->>S: place order",
    ]);
    // Beside a declaration, and at the end, a message stays.
    expect(moveMessage(SHOP, "m1", -1)).toBe(SHOP);
    expect(moveMessage(SHOP, "m4", 1)).toBe(SHOP);
    expect(moveMessage(SHOP, "m9", 1)).toBe(SHOP);
    // Into a fragment and out of it, taking the indent of where it comes to stand.
    const into = moveMessage(BARS, "m2", 1);
    expect(into.split("\n").slice(10, 13)).toEqual([
      "  alt all in stock",
      "    W->>+I: reserve items",
      "    I-->>W: reserved",
    ]);
    expect(moveMessage(into, "m2", -1)).toBe(BARS);
    const out = moveMessage(BARS, "m7", 1);
    expect(out.split("\n").slice(22, 25)).toEqual([
      "  loop until shipped",
      "  end",
      "  O->>I: poll status",
    ]);
    expect(moveMessage(out, "m7", -1)).toBe(BARS);
    // Past the line that divides a fragment, and past a note; comments stay where they are.
    const branch = moveMessage(BARS, "m5", 1);
    expect(branch.split("\n").slice(13, 18)).toEqual([
      "    %% the order is created only now",
      "    W->>+O: create order",
      "  else something missing",
      "    O-->>-W: order id",
      "    I-->>W: missing items",
    ]);
    expect(moveMessage(BARS, "m8", -1).split("\n").slice(22, 26)).toEqual([
      "  loop until shipped",
      "    O->>I: poll status",
      "    W-->>U: done",
      "  end",
    ]);
    // A move that would close a bar before it opens is not made.
    expect(moveMessage(BARS, "m4", 1)).toBe(BARS);
    expect(moveMessage(BARS, "m5", -1)).toBe(BARS);
    // The message that creates or destroys a participant stays with its statement.
    for (const edge of ["m2", "m4"])
      for (const delta of [-1, 1] as const) expect(moveMessage(LIFE, edge, delta)).toBe(LIFE);
    expect(moveMessage(LIFE, "m3", -1)).toBe(LIFE);
    expect(moveMessage(LIFE, "m3", 1)).toBe(LIFE);
    expect(moveMessage(LIFE, "m1", 1)).toBe(LIFE);
    for (const source of [SHOP, BARS, LIFE, ...SEQUENCE_EXAMPLES.map(([, text]) => text)])
      for (const edge of sequenceStructure.read(source).edges)
        for (const delta of [-1, 1] as const) {
          const moved = moveMessage(source, edge.id, delta);
          parses(moved);
          expect(messages(moved).toSorted()).toEqual(messages(source).toSorted());
        }
  });

  it("renames participants by their alias and boxes by their label", () => {
    expect(changed(SHOP, renameSequence(SHOP, "head:S", "Web shop"))).toEqual({
      added: ["  participant S as Web shop"],
      lost: ["  participant S as Shop"],
    });
    // Without an alias the declaration gets one; an empty name takes it away again.
    const web = renameSequence(LIFE, "head:web", "Web server");
    expect(web.split("\n")[1]).toBe("  participant web as Web server");
    expect(renameSequence(web, "head:web", "")).toBe(LIFE);
    expect(renameSequence(LIFE, "head:web", "web")).toBe(LIFE);
    expect(renameSequence(BARS, "head:U", "Client").split("\n")[2]).toBe("  actor U as Client");
    expect(renameSequence(LIFE, "head:link", "Link").split("\n")[3]).toBe(
      "  create participant link as Link",
    );
    // A participant only messages name is declared where it first stands: the columns keep their order.
    const dyn = renameSequence(LIFE, "head:dyn", "Renderer");
    expect(changed(LIFE, dyn)).toEqual({ added: ["  participant dyn as Renderer"], lost: [] });
    expect(dyn.split("\n")[2]).toBe("  participant dyn as Renderer");
    const both = renameSequence("sequenceDiagram\n  A->>B: hi\n  C->>A: ho", "head:B", "Bee");
    expect(both).toBe(
      "sequenceDiagram\n  participant A\n  participant B as Bee\n  A->>B: hi\n  C->>A: ho",
    );
    expect([...parseSequenceDiagram(both).participants.keys()]).toEqual(["A", "B", "C"]);
    // A box keeps its colour.
    expect(renameSequence(BARS, "box0", "Warehouse").split("\n")[5]).toBe("  box Purple Warehouse");
    expect(renameSequence(BARS, "box0", "").split("\n")[5]).toBe("  box Purple");
    const grey = renameSequence(
      "sequenceDiagram\n  box Old\n  participant A\n  end",
      "box0",
      "Grey zone",
    );
    expect(grey).toContain("box transparent Grey zone");
    expect(parseSequenceDiagram(grey).boxes[0].label).toBe("Grey zone");
    expect(renameSequence(SHOP, "head:nobody", "X")).toBe(SHOP);
  });

  it("writes names and texts with special characters so that they read back the same", () => {
    for (const text of [
      "a: b; c",
      "#1 & more",
      "x < y > z",
      "<b>bold</b>",
      '"quoted"',
      "R&D; AT&T &amp; co",
      "two<br>lines",
      "Größe à 1,5 kg 注文",
      "f(x) -> y",
      "as if",
    ]) {
      const labelled = labelMessage(SHOP, "m2", text);
      expect(sequenceStructure.read(labelled).edges[1].label, labelled).toBe(text);
      const renamed = renameSequence(SHOP, "head:S", text);
      expect(sequenceStructure.read(renamed).nodes[1].label, renamed).toBe(text);
      const sent = insertMessage(SHOP, "head:U", "head:P", { label: text });
      expect(sequenceStructure.read(sent).edges.at(-1)!.label, sent).toBe(text);
      const boxed = renameSequence(BARS, "box0", text);
      expect(sequenceStructure.read(boxed).nodes[2].label, boxed).toBe(text);
      for (const source of [labelled, renamed, sent, boxed]) parses(source);
    }
    expect(sequenceStructure.read(labelMessage(SHOP, "m1", "one\ntwo")).edges[0].label).toBe(
      "one<br>two",
    );
  });

  it("labels and relinks messages, keeping their activations", () => {
    expect(changed(BARS, labelMessage(BARS, "m2", "hold"))).toEqual({
      added: ["  W->>+I: hold"],
      lost: ["  W->>+I: reserve items"],
    });
    expect(labelMessage(SHOP, "m3", "").split("\n")[6]).toBe("  P-->>S");
    expect(messages(labelMessage(SHOP, "m3", ""))[2]).toBe("P>S");
    expect(labelMessage(labelMessage(SHOP, "m3", ""), "m3", "paid")).toBe(SHOP);
    expect(changed(BARS, relinkMessage(BARS, "m5", "async-reply"))).toEqual({
      added: ["    O--)-W: order id"],
      lost: ["    O-->>-W: order id"],
    });
    const kinds = sequenceStructure.links.map((link) => link.kind);
    for (const kind of kinds) {
      const relinked = relinkMessage(SHOP, "m1", kind);
      expect(sequenceStructure.read(relinked).edges[0]).toMatchObject({
        kind,
        source: "head:U",
        target: "head:S",
        label: "place order",
      });
      expect(relinked.split("\n").slice(5)).toEqual(SHOP.split("\n").slice(5));
    }
    expect(relinkMessage(SHOP, "m1", "sync")).toBe(SHOP);
    expect(relinkMessage(SHOP, "m1", "wavy")).toBe(SHOP);
    expect(relinkMessage(SHOP, "m7", "reply")).toBe(SHOP);
    expect(labelMessage(SHOP, "m7", "x")).toBe(SHOP);
    // Spaces around the arrow stay as they are written.
    const spaced = "sequenceDiagram\n  A ->> + B : hi";
    expect(relinkMessage(spaced, "m1", "lost")).toBe("sequenceDiagram\n  A -x + B: hi");
    expect(parseSequenceDiagram(relinkMessage(spaced, "m1", "lost")).events[0]).toMatchObject({
      from: "A",
      to: "B",
      activate: true,
      head: "cross",
    });
  });

  it("removes messages with the other end of their activation bars", () => {
    expect(changed(SHOP, removeSequence(SHOP, ["m2", "m3"]))).toEqual({
      added: [],
      lost: ["  S->>P: charge", "  P-->>S: paid"],
    });
    // The message that opens a bar: the reply keeps all but its `-`.
    expect(changed(BARS, removeSequence(BARS, ["m4"]))).toEqual({
      added: ["    O-->>W: order id"],
      lost: ["    W->>+O: create order", "    O-->>-W: order id"],
    });
    // The message that closes a bar: the call keeps all but its `+`.
    expect(changed(BARS, removeSequence(BARS, ["m5"]))).toEqual({
      added: ["    W->>O: create order"],
      lost: ["    W->>+O: create order", "    O-->>-W: order id"],
    });
    // A bar closed by a statement: the statement goes with the message.
    expect(changed(BARS, removeSequence(BARS, ["m2"]))).toEqual({
      added: [],
      lost: ["  W->>+I: reserve items", "  deactivate I"],
    });
    // A bar opened by a statement and closed by a message.
    const opened =
      "sequenceDiagram\n  activate A\n  A->>+B: ask\n  B-->>-A: answer\n  A-->>-C: tell";
    expect(removeSequence(opened, ["m3"])).toBe(
      "sequenceDiagram\n  A->>+B: ask\n  B-->>-A: answer",
    );
    expect(removeSequence(opened, ["m1", "m2"])).toBe(
      "sequenceDiagram\n  activate A\n  A-->>-C: tell",
    );
    // The last message or note of a fragment takes the fragment with it.
    expect(changed(BARS, removeSequence(BARS, ["m7"])).lost).toEqual([
      "  loop until shipped",
      "    O->>I: poll status",
    ]);
    expect(removeSequence(BARS, ["m7"]).split("\n").slice(-3)).toEqual([
      "  note over W,O: both keep a log",
      "  note right of O: alone",
      "  W-->>U: done",
    ]);
    // One branch emptied leaves the fragment with its other branch.
    expect(changed(BARS, removeSequence(BARS, ["m6"])).lost).toEqual(["    I-->>W: missing items"]);
    // Without the message that creates it a participant stands at the top; a destruction needs its message.
    expect(removeSequence(LIFE, ["m2"])).toBe(LIFE.replace("  dyn-)link: create\n", ""));
    expect(removeSequence(LIFE, ["m2", "m4"])).toBe(
      "sequenceDiagram\n  participant web\n  web->>+dyn: requestEditPage()\n  participant link as newLink\n  dyn-->>-web: Edit Page",
    );
    expect(changed(LIFE, removeSequence(LIFE, ["m4"])).lost).toEqual([
      "  destroy link",
      "  web-xlink: delete",
    ]);
    expect(removeSequence(SHOP, ["m9", "head:nobody", "box3"])).toBe(SHOP);
  });

  it("removes participants with their messages, notes and activations", () => {
    const without = removeSequence(SHOP, ["head:P"]);
    expect(changed(SHOP, without)).toEqual({
      added: [],
      lost: ["  participant P as Payment", "  S->>P: charge", "  P-->>S: paid"],
    });
    const orders = removeSequence(BARS, ["head:O"]);
    expect(changed(BARS, orders)).toEqual({
      added: ["  note over W: both keep a log"],
      lost: [
        "    participant O as Orders",
        "    W->>+O: create order",
        "    O-->>-W: order id",
        "  note over W,O: both keep a log",
        "  note right of O: alone",
        "  loop until shipped",
        "    O->>I: poll status",
      ],
    });
    // The comment of a fragment that stays is kept.
    expect(orders).toContain("    %% the order is created only now");
    const inventory = removeSequence(BARS, ["head:I"]);
    expect(messages(inventory)).toEqual([
      "U>W:checkout",
      "W>O:create order",
      "O>W:order id",
      "W>U:done",
    ]);
    expect(inventory).not.toContain("deactivate I");
    expect(inventory).toContain("  else something missing");
    // A created and destroyed participant goes with its `create` and `destroy`.
    expect(removeSequence(LIFE, ["head:link"])).toBe(
      "sequenceDiagram\n  participant web\n  web->>+dyn: requestEditPage()\n  dyn-->>-web: Edit Page",
    );
    // The receiver of an activation that the removed participant's reply closed.
    expect(removeSequence(LIFE, ["head:web"])).toBe(
      "sequenceDiagram\n  create participant link as newLink\n  dyn-)link: create",
    );
    expect(
      removeSequence(
        "sequenceDiagram\n  A->>B: hi\n  link A: Docs @ https://a.example\n  links B: {}",
        ["head:A"],
      ),
    ).toBe("sequenceDiagram\n  links B: {}");
  });

  it("removes boxes with their participants, and a box that keeps none", () => {
    const without = removeSequence(BARS, ["box0"]);
    expect(messages(without)).toEqual(["U>W:checkout", "W>U:done"]);
    expect(parseSequenceDiagram(without).boxes).toEqual([]);
    expect(without.split("\n").slice(0, 6)).toEqual([
      "sequenceDiagram",
      "  %% who takes part",
      "  actor U as Customer",
      "  participant W as Web shop",
      "",
      "  U->>W: checkout",
    ]);
    expect(parseSequenceDiagram(removeSequence(BARS, ["head:I", "head:O"])).boxes).toEqual([]);
    expect(parseSequenceDiagram(removeSequence(BARS, ["head:I"])).boxes).toHaveLength(1);
    // The `end` of a box is told from the `end` of a fragment.
    const mixed = `sequenceDiagram
  box One
    participant A
    loop inside
      A->>A: think
    end
  end
  box Two
    participant B
  end
  B->>B: wait`;
    expect(removeSequence(mixed, ["box0"])).toBe(
      "sequenceDiagram\n  box Two\n    participant B\n  end\n  B->>B: wait",
    );
    expect(sequenceStructure.read(removeSequence(mixed, ["box1", "m1"])).nodes).toEqual([
      { id: "box0", label: "One", parent: null, line: 2, group: true, kind: "box" },
      { id: "head:A", label: "A", parent: "box0", line: 3, group: false, kind: "participant" },
    ]);
  });
});

describe("a sequence diagram as a structure", () => {
  const ids = async (source: string) => {
    const scene = await parseUml(source).layout(arialMeasure);
    return {
      shapes: new Set(scene.shapes.map((shape) => shape.id)),
      wires: new Set(scene.wires.map((wire) => wire.edge)),
    };
  };

  it("reads participants, boxes and messages under the ids of the scene", async () => {
    const { nodes, edges } = sequenceStructure.read(BARS);
    expect(nodes.map((node) => `${node.id}:${node.kind}:${node.parent}:${node.line}`)).toEqual([
      "head:U:actor:null:3",
      "head:W:participant:null:4",
      "box0:box:null:6",
      "head:I:participant:box0:7",
      "head:O:participant:box0:8",
    ]);
    expect(nodes.map((node) => node.label)).toEqual([
      "Customer",
      "Web shop",
      "Back office",
      "Inventory",
      "Orders",
    ]);
    expect(nodes.map((node) => node.group)).toEqual([false, false, true, false, false]);
    expect(edges.map((edge) => `${edge.id}:${edge.source}>${edge.target}:${edge.kind}`)).toEqual([
      "m1:head:U>head:W:sync",
      "m2:head:W>head:I:sync",
      "m3:head:I>head:W:reply",
      "m4:head:W>head:O:sync",
      "m5:head:O>head:W:reply",
      "m6:head:I>head:W:reply",
      "m7:head:O>head:I:sync",
      "m8:head:W>head:U:reply",
    ]);
    expect(edges[1]).toMatchObject({ label: "reserve items", line: 11 });
    const kinds = new Set(sequenceStructure.pieces.map((piece) => piece.kind)),
      links = new Set(sequenceStructure.links.map((link) => link.kind));
    for (const source of [SHOP, BARS, LIFE]) {
      const read = sequenceStructure.read(source),
        scene = await ids(source);
      for (const node of read.nodes) {
        expect(scene.shapes.has(node.id), node.id).toBe(true);
        expect(kinds.has(node.kind), node.kind).toBe(true);
      }
      for (const edge of read.edges) {
        expect(scene.wires.has(edge.id), edge.id).toBe(true);
        expect(links.has(edge.kind), edge.kind).toBe(true);
      }
    }
    // Every arrow the parser reads is a kind of its own.
    const arrows = sequenceStructure.read(SEQUENCE_EXAMPLES[5][1]).edges.map((edge) => edge.kind);
    expect(arrows).toEqual([
      "line",
      "dotted",
      "sync",
      "reply",
      "lost",
      "dotted-lost",
      "async",
      "async-reply",
      "both",
      "sync",
    ]);
  });

  it("edits through one interface, and what it adds is in the scene", async () => {
    const added = sequenceStructure.add(SHOP, { kind: "actor", label: "Courier" });
    expect((await ids(added.source)).shapes.has(added.id)).toBe(true);
    const joined = sequenceStructure.connect(added.source, "head:S", added.id, "async");
    expect(sequenceStructure.read(joined).edges.at(-1)).toMatchObject({
      id: "m5",
      source: "head:S",
      target: "head:actor1",
      label: "message",
      kind: "async",
    });
    expect((await ids(joined)).wires.has("m5")).toBe(true);
    expect(
      sequenceStructure.read(sequenceStructure.connect(SHOP, "head:U", "head:P")).edges[4].kind,
    ).toBe("sync");
    const box = sequenceStructure.add(BARS, { kind: "box", label: "Partners" });
    expect((await ids(box.source)).shapes.has(box.id)).toBe(true);
    const inside = sequenceStructure.add(box.source, { kind: "participant", parent: box.id });
    expect(
      sequenceStructure.read(inside.source).nodes.find((node) => node.id === inside.id)!.parent,
    ).toBe(box.id);
    const renamed = sequenceStructure.rename(SHOP, "head:P", "Bank");
    expect(sequenceStructure.read(renamed).nodes[2].label).toBe("Bank");
    expect(sequenceStructure.read(sequenceStructure.label(SHOP, "m1", "buy")).edges[0].label).toBe(
      "buy",
    );
    expect(sequenceStructure.read(sequenceStructure.relink(SHOP, "m1", "lost")).edges[0].kind).toBe(
      "lost",
    );
    expect(sequenceStructure.read(sequenceStructure.remove(SHOP, ["head:S", "m9"])).edges).toEqual(
      [],
    );
  });

  it("reads every example, and every edit of one leaves a source that parses", async () => {
    for (const [name, source] of SEQUENCE_EXAMPLES) {
      const { nodes, edges } = sequenceStructure.read(source),
        scene = await ids(source);
      for (const node of nodes) expect(scene.shapes.has(node.id), `${name} ${node.id}`).toBe(true);
      for (const edge of edges) expect(scene.wires.has(edge.id), `${name} ${edge.id}`).toBe(true);
      expect(edges).toHaveLength(scene.wires.size);
      for (const part of [...nodes, ...edges]) {
        const without = sequenceStructure.remove(source, [part.id]);
        await parseUml(without).layout(arialMeasure);
        const left = sequenceStructure.read(without);
        // What is left is drawn: no box without a participant, no head that no message creates.
        const after = await ids(without);
        for (const node of left.nodes)
          expect(after.shapes.has(node.id), `${name} ${part.id}`).toBe(true);
        if ("group" in part) {
          expect(left.nodes.some((node) => node.id === part.id && node.label === part.label)).toBe(
            false,
          );
          const who = part.id.replace(/^head:/, "");
          if (!part.group)
            expect(left.edges.length).toBe(
              edges.filter((edge) => edge.source !== part.id && edge.target !== part.id).length,
            );
          if (!part.group) expect(parseSequenceDiagram(without).participants.has(who)).toBe(false);
        } else expect(left.edges).toHaveLength(edges.length - 1);
        // Lines are only dropped or rewritten, none is added out of nothing.
        expect(without.split("\n").length).toBeLessThan(source.split("\n").length);
      }
      for (const node of nodes) {
        parses(sequenceStructure.rename(source, node.id, "Another name"));
        const renamed = sequenceStructure.read(
          sequenceStructure.rename(source, node.id, "Another name"),
        );
        expect(renamed.nodes.map((item) => item.id)).toEqual(nodes.map((item) => item.id));
        expect(renamed.nodes.find((item) => item.id === node.id)!.label).toBe("Another name");
        expect(renamed.edges).toHaveLength(edges.length);
      }
      for (const edge of edges) {
        const labelled = sequenceStructure.read(
          sequenceStructure.label(source, edge.id, "another text"),
        );
        expect(labelled.edges.find((item) => item.id === edge.id)).toMatchObject({
          ...edge,
          label: "another text",
        });
        const relinked = sequenceStructure.read(
          sequenceStructure.relink(source, edge.id, "dotted"),
        );
        expect(relinked.edges.find((item) => item.id === edge.id)).toMatchObject({
          ...edge,
          kind: "dotted",
        });
        const sent = insertMessage(source, edge.target, edge.source, { after: edge.id });
        await parseUml(sent).layout(arialMeasure);
        expect(sequenceStructure.read(sent).edges).toHaveLength(edges.length + 1);
      }
      for (const piece of sequenceStructure.pieces) {
        const added = sequenceStructure.add(source, { kind: piece.kind, label: "New one" });
        expect((await ids(added.source)).shapes.has(added.id), `${name} ${piece.kind}`).toBe(true);
        expect(
          sequenceStructure.read(added.source).nodes.find((node) => node.id === added.id),
        ).toMatchObject({
          label: "New one",
          kind: piece.kind,
          group: !!piece.group,
        });
        const joined = sequenceStructure.connect(added.source, nodes[0].id, nodes.at(-1)!.id);
        await parseUml(joined).layout(arialMeasure);
      }
    }
  });
});
