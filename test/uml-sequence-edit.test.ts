import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseUml } from "../src/index.ts";
import { SEQUENCE_EXAMPLES } from "../src/samples/uml-examples.ts";
import { parseSequenceDiagram } from "../src/uml-sequence.ts";
import {
  addSequencePiece,
  boxParticipants,
  connectSequence,
  insertMessage,
  insertParticipant,
  labelMessage,
  messageContext,
  moveMessage,
  moveParticipant,
  relinkMessage,
  removalSummary,
  removeSequence,
  renameParticipantId,
  renameSequence,
  replyTo,
  retitleSequence,
  sequenceStructure,
  setAutonumber,
  toggleActivation,
  unwrapFragment,
  wrapMessages,
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
      `${SHOP}\n  P-->>P: \n\n`,
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
    // An empty text keeps the colon and a space: Mermaid reads no message without them.
    expect(labelMessage(SHOP, "m3", "").split("\n")[6]).toBe("  P-->>S: ");
    expect(labelMessage("sequenceDiagram\n  A->>B", "m1", "").split("\n")[1]).toBe("  A->>B: ");
    // A message written without a colon keeps none when its arrow changes.
    expect(relinkMessage("sequenceDiagram\n  A->>B", "m1", "reply")).toBe(
      "sequenceDiagram\n  A-->>B",
    );
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
    // A participant that loses its only message keeps its column, declared where the message stood.
    expect(removeSequence(opened, ["m3"])).toBe(
      "sequenceDiagram\n  A->>+B: ask\n  B-->>-A: answer\n  participant C",
    );
    expect(removeSequence(opened, ["m1", "m2"])).toBe(
      "sequenceDiagram\n  activate A\n  participant B\n  A-->>-C: tell",
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
    // `dyn` keeps its column before `link`, which is declared before the message that is left.
    expect(removeSequence(LIFE, ["head:web"])).toBe(
      "sequenceDiagram\n  participant dyn\n  create participant link as newLink\n  dyn-)link: create",
    );
    expect(
      removeSequence(
        "sequenceDiagram\n  A->>B: hi\n  link A: Docs @ https://a.example\n  links B: {}",
        ["head:A"],
      ),
    ).toBe("sequenceDiagram\n  participant B\n  links B: {}");
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

const FRAGMENTS = SEQUENCE_EXAMPLES.find(([name]) => /fragment/i.test(name))![1];

const columnsOf = (source: string) => [...parseSequenceDiagram(source).participants.keys()];

describe("placing participants, and what the canvas does with notes, fragments and bars", () => {
  it("keeps the other participants when one goes, and says what goes with it", () => {
    const implied =
      "sequenceDiagram\n  Alice->>John: hello\n  loop daily\n    John->>Bob: ping\n  end\n  Alice->>Bob: bye";
    const john = removeSequence(implied, ["head:John"]);
    expect(john).toBe("sequenceDiagram\n  Alice->>Bob: bye");
    const alice = removeSequence(implied, ["head:Alice"]);
    expect(alice).toBe("sequenceDiagram\n  loop daily\n    John->>Bob: ping\n  end");
    const bob = removeSequence(implied, ["head:Bob"]);
    expect(bob).toBe("sequenceDiagram\n  Alice->>John: hello");
    // The one that loses every mention is declared where it stood first, as deep as the fragment that goes.
    const lost = removeSequence(
      "sequenceDiagram\n  A->>B: one\n  opt maybe\n    C->>D: two\n  end\n  A->>D: three",
      ["head:D"],
    );
    expect(lost).toBe("sequenceDiagram\n  A->>B: one\n  participant C");
    // A message that goes takes no participant with it, and the columns keep their order.
    const first = removeSequence("sequenceDiagram\n  A->>B: one\n  C->>A: two", ["m1"]);
    expect(first).toBe("sequenceDiagram\n  participant A\n  participant B\n  C->>A: two");
    expect(columnsOf(first)).toEqual(["A", "B", "C"]);
    // No declaration where the columns stay as they are without one.
    expect(removeSequence("sequenceDiagram\n  A->>B: one\n  A->>B: two", ["m1"])).toBe(
      "sequenceDiagram\n  A->>B: two",
    );
    // The example of the fragments: John and Bob are named by messages only.
    const before = parseSequenceDiagram(FRAGMENTS),
      who = [...before.participants.keys()],
      without = removeSequence(FRAGMENTS, [`head:${who[0]}`]);
    expect(columnsOf(without)).toEqual(who.slice(1));
    expect(messages(without)).toEqual(
      messages(FRAGMENTS).filter((message) => !message.split(":")[0].split(">").includes(who[0])),
    );
    const summary = removalSummary(FRAGMENTS, [`head:${who[0]}`]);
    expect(summary).toMatch(
      new RegExp(`^${who[0]}, \\d+ messages(, \\d+ notes?)?, \\d+ fragments$`),
    );
    expect(removalSummary(SHOP, ["head:P"])).toBe("Payment, 2 messages");
    expect(removalSummary(SHOP, ["m1"])).toBe("1 message");
    expect(removalSummary(BARS, ["box0"])).toBe(
      "Inventory, Orders, 6 messages, 1 note, 2 fragments, 1 box",
    );
    expect(removalSummary(BARS, ["head:O"])).toBe("Orders, 3 messages, 1 note, 1 fragment");
    expect(removalSummary(BARS, ["block1"])).toBe("1 fragment");
    expect(removalSummary(SHOP, ["head:nobody"])).toBe("");
  });

  it("inserts a participant beside another", () => {
    const after = insertParticipant(SHOP, { kind: "participant", label: "Cart", after: "head:U" });
    expect(after.id).toBe("head:participant1");
    expect(changed(SHOP, after.source)).toEqual({
      added: ["  participant participant1 as Cart"],
      lost: [],
    });
    expect(columnsOf(after.source)).toEqual(["U", "participant1", "S", "P"]);
    const before = insertParticipant(SHOP, { kind: "actor", before: "head:U" });
    expect(before.source.split("\n")[1]).toBe("  actor actor1 as Actor");
    expect(columnsOf(before.source)).toEqual(["actor1", "U", "S", "P"]);
    // Through the structure: at a participant, in the column after it.
    const added = sequenceStructure.add(SHOP, { kind: "participant", parent: "head:S" });
    expect(columnsOf(added.source)).toEqual(["U", "S", "participant1", "P"]);
    expect(
      columnsOf(sequenceStructure.add(SHOP, { kind: "actor", parent: "head:P" }).source),
    ).toEqual(["U", "S", "P", "actor1"]);
    // Beside a participant of a box it stands in the box.
    const boxed = insertParticipant(BARS, { kind: "participant", after: "head:I" });
    expect(boxed.source.split("\n").slice(6, 9)).toEqual([
      "    participant I as Inventory",
      "    participant participant1 as Participant",
      "    participant O as Orders",
    ]);
    expect(parseSequenceDiagram(boxed.source).participants.get("participant1")!.box).toBe(0);
    // Participants that only messages name are declared first, as far as the order needs it.
    const implied = "sequenceDiagram\n  autonumber\n  A->>B: one\n  B->>C: two\n  C->>D: three";
    const middle = insertParticipant(implied, {
      kind: "participant",
      label: "New",
      after: "head:B",
    });
    expect(middle.source).toBe(
      "sequenceDiagram\n  autonumber\n  participant A\n  participant B\n  participant participant1 as New\n  A->>B: one\n  B->>C: two\n  C->>D: three",
    );
    expect(columnsOf(middle.source)).toEqual(["A", "B", "participant1", "C", "D"]);
    const front = insertParticipant(implied, { kind: "participant", before: "head:A" });
    expect(front.source.split("\n").slice(2, 4)).toEqual([
      "  participant participant1 as Participant",
      "  participant A",
    ]);
    expect(
      columnsOf(insertParticipant(implied, { kind: "participant", before: "head:D" }).source),
    ).toEqual(["A", "B", "C", "participant1", "D"]);
    const mixed = insertParticipant(`${SHOP}\n  P->>Bank: debit\n  Bank->>Log: note`, {
      kind: "participant",
      after: "head:Bank",
    });
    expect(changed(SHOP, mixed.source).added.slice(0, 2)).toEqual([
      "  participant Bank",
      "  participant participant1 as Participant",
    ]);
    expect(columnsOf(mixed.source)).toEqual(["U", "S", "P", "Bank", "participant1", "Log"]);
    // Beside a participant that a message creates.
    expect(
      columnsOf(insertParticipant(LIFE, { kind: "participant", after: "head:link" }).source),
    ).toEqual(["web", "dyn", "link", "participant1"]);
    expect(
      columnsOf(insertParticipant(LIFE, { kind: "participant", before: "head:link" }).source),
    ).toEqual(["web", "dyn", "participant1", "link"]);
    // Without another participant it is the last one.
    expect(insertParticipant(SHOP, { kind: "participant", label: "Mailer" })).toEqual(
      addSequencePiece(SHOP, { kind: "participant", label: "Mailer" }),
    );
    expect(insertParticipant(SHOP, { kind: "participant", after: "head:nobody" }).id).toBe(
      "head:participant1",
    );
  });

  it("moves a participant to the column beside it, and over the border of a box", () => {
    const right = moveParticipant(SHOP, "head:U", 1);
    expect(right.split("\n").slice(1, 3)).toEqual([
      "  participant S as Shop",
      "  participant U as User",
    ]);
    expect(columnsOf(right)).toEqual(["S", "U", "P"]);
    expect(moveParticipant(right, "head:U", -1)).toBe(SHOP);
    expect(columnsOf(moveParticipant(SHOP, "head:P", -1))).toEqual(["U", "P", "S"]);
    expect(moveParticipant(SHOP, "head:U", -1)).toBe(SHOP);
    expect(moveParticipant(SHOP, "head:P", 1)).toBe(SHOP);
    expect(moveParticipant(SHOP, "head:nobody", 1)).toBe(SHOP);
    // Participants that only messages name are declared first.
    const implied = "sequenceDiagram\n  A->>B: one\n  B->>C: two";
    expect(moveParticipant(implied, "head:B", -1)).toBe(
      "sequenceDiagram\n  participant B\n  participant A\n  A->>B: one\n  B->>C: two",
    );
    expect(columnsOf(moveParticipant(implied, "head:B", 1))).toEqual(["A", "C", "B"]);
    expect(columnsOf(moveParticipant(implied, "head:C", -1))).toEqual(["A", "C", "B"]);
    // Into the box beside it, through it, and out at the other side.
    const into = moveParticipant(BARS, "head:W", 1);
    expect(columnsOf(into)).toEqual(["U", "W", "I", "O"]);
    expect(parseSequenceDiagram(into).participants.get("W")!.box).toBe(0);
    expect(into.split("\n").slice(4, 7)).toEqual([
      "  box Purple Back office",
      "    participant W as Web shop",
      "    participant I as Inventory",
    ]);
    const swapped = moveParticipant(into, "head:W", 1);
    expect(columnsOf(swapped)).toEqual(["U", "I", "W", "O"]);
    const last = moveParticipant(swapped, "head:W", 1);
    expect(columnsOf(last)).toEqual(["U", "I", "O", "W"]);
    expect(parseSequenceDiagram(last).participants.get("W")!.box).toBe(0);
    const out = moveParticipant(last, "head:W", 1);
    expect(parseSequenceDiagram(out).participants.get("W")!.box).toBeNull();
    expect(out.split("\n").slice(6, 9)).toEqual([
      "    participant O as Orders",
      "  end",
      "  participant W as Web shop",
    ]);
    expect(moveParticipant(out, "head:W", 1)).toBe(out);
    expect(moveParticipant(moveParticipant(into, "head:W", -1), "head:W", 1)).toBe(into);
    // The box a participant leaves empty goes.
    const single =
      "sequenceDiagram\n  box One\n    participant A\n  end\n  participant B\n  A->>B: hi";
    expect(moveParticipant(single, "head:A", 1)).toBe(
      "sequenceDiagram\n  participant A\n  participant B\n  A->>B: hi",
    );
    // A participant that a message creates stays in its column.
    expect(moveParticipant(LIFE, "head:link", -1)).toBe(LIFE);
    expect(moveParticipant(LIFE, "head:dyn", 1)).toBe(LIFE);
    expect(columnsOf(moveParticipant(LIFE, "head:dyn", -1))).toEqual(["dyn", "web", "link"]);
  });

  it("frames participants in a box", () => {
    const boxed = boxParticipants(SHOP, ["head:S", "head:P"], "Back office");
    expect(boxed.id).toBe("box0");
    expect(boxed.source).toBe(
      `sequenceDiagram\n  participant U as User\n  box Back office\n    participant S as Shop\n    participant P as Payment\n  end\n${SHOP.split("\n").slice(4).join("\n")}`,
    );
    const read = sequenceStructure.read(boxed.source);
    expect(read.nodes.filter((node) => node.parent === "box0").map((node) => node.id)).toEqual([
      "head:S",
      "head:P",
    ]);
    // Through the structure: a box added at a participant frames it.
    const one = sequenceStructure.add(BARS, { kind: "box", label: "Front", parent: "head:W" });
    expect(one.id).toBe("box0");
    expect(changed(BARS, one.source)).toEqual({
      added: ["  box Front", "    participant W as Web shop"],
      lost: ["  participant W as Web shop"],
    });
    expect(parseSequenceDiagram(one.source).participants.get("I")!.box).toBe(1);
    // Participants that only messages name are declared in the box.
    const implied = "sequenceDiagram\n  A->>B: one\n  B->>C: two";
    expect(boxParticipants(implied, ["head:C", "head:B"], "")).toEqual({
      id: "box0",
      source:
        "sequenceDiagram\n  participant A\n  box Group\n    participant B\n    participant C\n  end\n  A->>B: one\n  B->>C: two",
    });
    // Not side by side, in a box already, created by a message, or no participant.
    for (const ids of [["head:U", "head:P"], ["head:nobody"], [], ["head:U", "box0"]])
      expect(boxParticipants(SHOP, ids, "x")).toEqual({ source: SHOP, id: "" });
    expect(boxParticipants(BARS, ["head:W", "head:I"], "x").id).toBe("");
    expect(boxParticipants(LIFE, ["head:dyn", "head:link"], "x").id).toBe("");
    expect(sequenceStructure.add(BARS, { kind: "box", parent: "head:I" })).toEqual({
      source: BARS,
      id: "",
    });
  });

  it("returns the message it wrote, and answers a message", () => {
    expect(connectSequence(SHOP, "head:U", "head:P")).toEqual({
      source: `${SHOP}\n  U->>P: message`,
      edge: "m5",
    });
    const middle = connectSequence(SHOP, "head:S", "head:U", "async", {
      after: "m2",
      label: "wait",
    });
    expect(middle.edge).toBe("m3");
    expect(sequenceStructure.read(middle.source).edges[2]).toMatchObject({
      id: "m3",
      source: "head:S",
      target: "head:U",
      label: "wait",
      kind: "async",
    });
    // A message to the sender itself.
    expect(sequenceStructure.connect(SHOP, "head:S", "head:S")).toBe(`${SHOP}\n  S->>S: message`);
    expect(connectSequence(SHOP, "head:U", "box0")).toEqual({ source: SHOP, edge: "" });
    // Inside the fragment of the message it follows.
    const inside = connectSequence(BARS, "head:O", "head:U", undefined, { after: "m4" });
    expect(messageContext(inside.source, inside.edge)).toEqual({ fragment: "block1", index: 4 });
    expect(messageContext(BARS, "m1")).toEqual({ fragment: null, index: 0 });
    expect(messageContext(BARS, "m7")).toEqual({ fragment: "block2", index: 6 });
    expect(messageContext(BARS, "m99")).toBeNull();
    const reply = replyTo(SHOP, "m2");
    expect(reply.edge).toBe("m3");
    expect(changed(SHOP, reply.source)).toEqual({ added: ["  P-->>S: reply"], lost: [] });
    expect(reply.source.split("\n")[6]).toBe("  P-->>S: reply");
    expect(replyTo(BARS, "m7").source.split("\n").slice(23, 26)).toEqual([
      "    O->>I: poll status",
      "    I-->>O: reply",
      "  end",
    ]);
    // It closes the bar the message opens, when nothing closes that yet.
    expect(replyTo("sequenceDiagram\n  A->>+B: ask", "m1").source).toBe(
      "sequenceDiagram\n  A->>+B: ask\n  B-->>-A: reply",
    );
    expect(replyTo(BARS, "m4").source.split("\n")[15]).toBe("    O-->>W: reply");
    expect(replyTo(SHOP, "m9")).toEqual({ source: SHOP, edge: "" });
  });

  it("reads notes and fragments as parts, and renames and removes them", async () => {
    const nested =
      "sequenceDiagram\n  A->>B: one\n  loop daily\n    note over A: wake\n    opt awake\n      A->>B: two\n      note right of B: got it\n    end\n  end\n  rect rgb(240, 240, 240)\n    B-->>A: three\n  end";
    const { nodes } = sequenceStructure.read(nested);
    expect(
      nodes.slice(2).map((node) => `${node.id}:${node.kind}:${node.parent}:${node.label}`),
    ).toEqual([
      "block1:fragment:null:loop daily",
      "note1:note:block1:wake",
      "block2:fragment:block1:opt awake",
      "note2:note:block2:got it",
      "block3:fragment:null:rect",
    ]);
    const scene = await parseUml(nested).layout(arialMeasure),
      shapes = new Set(scene.shapes.map((shape) => shape.id));
    for (const node of nodes) expect(shapes.has(node.id), node.id).toBe(true);
    // A note by its text, a fragment by its condition.
    expect(changed(nested, renameSequence(nested, "note1", "get up; now"))).toEqual({
      added: ["    note over A: get up#59; now"],
      lost: ["    note over A: wake"],
    });
    expect(renameSequence(nested, "note1", " ")).toBe(nested);
    expect(changed(nested, renameSequence(nested, "block2", "wide awake"))).toEqual({
      added: ["    opt wide awake"],
      lost: ["    opt awake"],
    });
    // The name as the part is labelled, with its keyword, gives the same.
    expect(renameSequence(nested, "block2", "opt wide awake")).toBe(
      renameSequence(nested, "block2", "wide awake"),
    );
    expect(renameSequence(nested, "block1", "").split("\n")[2]).toBe("  loop");
    expect(renameSequence(nested, "block3", "grey")).toBe(nested);
    expect(renameSequence(BARS, "block1", "enough").split("\n")[11]).toBe("  alt enough");
    // Removing a note; removing a fragment takes the frame and leaves what it holds.
    expect(changed(nested, removeSequence(nested, ["note2"]))).toEqual({
      added: [],
      lost: ["      note right of B: got it"],
    });
    expect(unwrapFragment(nested, "block2")).toBe(
      "sequenceDiagram\n  A->>B: one\n  loop daily\n    note over A: wake\n    A->>B: two\n    note right of B: got it\n  end\n  rect rgb(240, 240, 240)\n    B-->>A: three\n  end",
    );
    expect(sequenceStructure.remove(nested, ["block1"])).toBe(
      "sequenceDiagram\n  A->>B: one\n  note over A: wake\n  opt awake\n    A->>B: two\n    note right of B: got it\n  end\n  rect rgb(240, 240, 240)\n    B-->>A: three\n  end",
    );
    expect(messages(removeSequence(nested, ["block1", "block2", "block3", "m1"]))).toEqual([
      "A>B:two",
      "B>A:three",
    ]);
    expect(removeSequence(nested, ["block1", "block2", "block3"])).not.toMatch(/loop|opt|rect|end/);
    // The lines that divide a fragment go with its frame.
    const flat = unwrapFragment(BARS, "block1");
    expect(changed(BARS, flat)).toEqual({
      added: [
        "  I-->>W: reserved",
        "  %% the order is created only now",
        "  W->>+O: create order",
        "  O-->>-W: order id",
        "  I-->>W: missing items",
      ],
      lost: [
        "  alt all in stock",
        "    I-->>W: reserved",
        "    %% the order is created only now",
        "    W->>+O: create order",
        "    O-->>-W: order id",
        "  else something missing",
        "    I-->>W: missing items",
      ],
    });
    expect(flat.split("\n")).toHaveLength(BARS.split("\n").length - 3);
    expect(unwrapFragment(BARS, "block9")).toBe(BARS);
    expect(unwrapFragment(BARS, "note1")).toBe(BARS);
  });

  it("adds a note over a participant and moves it to another", () => {
    const note = sequenceStructure.add(SHOP, {
      kind: "note",
      label: "Pays by card",
      parent: "head:P",
    });
    expect(note).toEqual({ id: "note1", source: `${SHOP}\n  note over P: Pays by card` });
    expect(sequenceStructure.add(note.source, { kind: "note", parent: "head:U" })).toEqual({
      id: "note2",
      source: `${note.source}\n  note over U: Note`,
    });
    for (const parent of [undefined, null, "box0", "block1", "note1", "head:nobody"])
      expect(sequenceStructure.add(BARS, { kind: "note", parent })).toEqual({
        source: BARS,
        id: "",
      });
    const piece = sequenceStructure.pieces.find((item) => item.kind === "note")!;
    expect(piece).toMatchObject({ joins: "after", joinsTo: ["participant", "actor"], named: true });
    // Connected with a participant, the note stands over that one.
    const moved = sequenceStructure.connect(note.source, "head:U", "note1");
    expect(moved).toBe(`${SHOP}\n  note over U: Pays by card`);
    expect(sequenceStructure.connect(moved, "note1", "head:S")).toBe(
      `${SHOP}\n  note over S: Pays by card`,
    );
    expect(connectSequence(BARS, "note2", "head:U").source.split("\n")[21]).toBe(
      "  note right of U: alone",
    );
    expect(connectSequence(BARS, "note1", "note2")).toEqual({ source: BARS, edge: "" });
  });

  it("wraps a run of messages in a fragment", () => {
    const wrapped = wrapMessages(SHOP, ["m3", "m2"], "opt", "card accepted");
    expect(wrapped).toEqual({
      id: "block1",
      source: `sequenceDiagram
  participant U as User
  participant S as Shop
  participant P as Payment
  U->>S: place order
  opt card accepted
    S->>P: charge
    P-->>S: paid
  end
  S-->>U: confirmation`,
    });
    expect(unwrapFragment(wrapped.source, wrapped.id)).toBe(SHOP);
    expect(wrapMessages(SHOP, ["m1"], "loop", "").source.split("\n").slice(4, 7)).toEqual([
      "  loop",
      "    U->>S: place order",
      "  end",
    ]);
    // With what stands between them: whole fragments, notes, activations.
    const around = wrapMessages(BARS, ["m2", "m3", "m4", "m5", "m6"], "critical", "stock");
    expect(around.id).toBe("block1");
    expect(
      sequenceStructure.read(around.source).nodes.find((node) => node.id === "block2"),
    ).toMatchObject({ parent: "block1", label: "alt all in stock" });
    expect(around.source.split("\n").slice(10, 13)).toEqual([
      "  critical stock",
      "    W->>+I: reserve items",
      "    alt all in stock",
    ]);
    expect(messages(around.source)).toEqual(messages(BARS));
    const inner = wrapMessages(BARS, ["m4", "m5"], "loop", "retry");
    expect(inner.id).toBe("block2");
    expect(inner.source.split("\n").slice(13, 18)).toEqual([
      "    %% the order is created only now",
      "    loop retry",
      "      W->>+O: create order",
      "      O-->>-W: order id",
      "    end",
    ]);
    expect(messageContext(inner.source, "m4")).toEqual({ fragment: "block2", index: 3 });
    // The statement that creates a participant goes into the fragment with its message.
    expect(wrapMessages(LIFE, ["m2"], "opt", "new").source.split("\n").slice(3, 7)).toEqual([
      "  opt new",
      "    create participant link as newLink",
      "    dyn-)link: create",
      "  end",
    ]);
    // No run: another message between, or across the border of a fragment.
    expect(wrapMessages(SHOP, ["m1", "m3"], "alt", "x")).toEqual({ source: SHOP, id: "" });
    expect(wrapMessages(BARS, ["m2", "m3"], "alt", "x")).toEqual({ source: BARS, id: "" });
    expect(wrapMessages(BARS, ["m5", "m6"], "alt", "x")).toEqual({ source: BARS, id: "" });
    expect(wrapMessages(SHOP, ["m9"], "alt", "x")).toEqual({ source: SHOP, id: "" });
    expect(wrapMessages(SHOP, [], "alt", "x")).toEqual({ source: SHOP, id: "" });
    expect(wrapMessages(SHOP, ["m1"], "rect" as "alt", "x")).toEqual({ source: SHOP, id: "" });
  });

  it("sets and takes away the activation of a message", () => {
    const on = toggleActivation(SHOP, "m2");
    expect(changed(SHOP, on)).toEqual({
      added: ["  S->>+P: charge", "  P-->>-S: paid"],
      lost: ["  S->>P: charge", "  P-->>S: paid"],
    });
    expect(toggleActivation(on, "m2")).toBe(SHOP);
    // From the reply that closes the bar as well.
    expect(toggleActivation(on, "m3")).toBe(SHOP);
    // Without a reply the bar stays open.
    expect(toggleActivation(SHOP, "m4").split("\n")[7]).toBe("  S-->>+U: confirmation");
    expect(toggleActivation("sequenceDiagram\n  A->>A: think", "m1")).toBe(
      "sequenceDiagram\n  A->>+A: think",
    );
    // A bar closed by a statement, and one opened by a statement.
    expect(changed(BARS, toggleActivation(BARS, "m2"))).toEqual({
      added: ["  W->>I: reserve items"],
      lost: ["  W->>+I: reserve items", "  deactivate I"],
    });
    const stated = "sequenceDiagram\n  A->>B: ask\n  activate B\n  B-->>A: answer\n  deactivate B";
    expect(toggleActivation(stated, "m1")).toBe("sequenceDiagram\n  A->>B: ask\n  B-->>A: answer");
    const mixed = "sequenceDiagram\n  A->>B: ask\n  activate B\n  B-->>-A: answer";
    expect(toggleActivation(mixed, "m1")).toBe("sequenceDiagram\n  A->>B: ask\n  B-->>A: answer");
    expect(toggleActivation(mixed, "m2")).toBe("sequenceDiagram\n  A->>B: ask\n  B-->>A: answer");
    expect(toggleActivation(SHOP, "m9")).toBe(SHOP);
    for (const source of [SHOP, BARS, LIFE, ...SEQUENCE_EXAMPLES.map(([, text]) => text)])
      for (const edge of sequenceStructure.read(source).edges) {
        const toggled = toggleActivation(source, edge.id);
        parses(toggled);
        expect(messages(toggled)).toEqual(messages(source));
      }
  });

  it("numbers the messages", () => {
    const on = setAutonumber(SHOP, true);
    expect(on).toBe(SHOP.replace("sequenceDiagram\n", "sequenceDiagram\n  autonumber\n"));
    expect(setAutonumber(on, true)).toBe(on);
    expect(setAutonumber(on, false)).toBe(SHOP);
    expect(setAutonumber(SHOP, false)).toBe(SHOP);
    const titled = "sequenceDiagram\n  title: Order\n  A->>B: hi";
    expect(setAutonumber(titled, true)).toBe(
      "sequenceDiagram\n  title: Order\n  autonumber\n  A->>B: hi",
    );
    const stepped = "sequenceDiagram\n  autonumber 10 5\n  A->>B: hi";
    expect(setAutonumber(stepped, true)).toBe(stepped);
    expect(setAutonumber(stepped, false)).toBe("sequenceDiagram\n  A->>B: hi");
    expect(setAutonumber("sequenceDiagram\n  autonumber off\n  A->>B: hi", true)).toBe(
      "sequenceDiagram\n  autonumber\n  A->>B: hi",
    );
    expect(setAutonumber("sequenceDiagram", true)).toBe("sequenceDiagram\n  autonumber");
    expect(parseSequenceDiagram(on).events.find((event) => event.type === "message")).toMatchObject(
      {
        number: 1,
      },
    );
  });

  it("lets the id of a new participant follow its first name", () => {
    const added = addSequencePiece(SHOP, { kind: "participant" }),
      sent = insertMessage(added.source, "head:S", added.id, { label: "add item" }),
      noted = `${sent}\n  note over participant1,S: both\n  activate participant1\n  deactivate participant1\n  link participant1: Docs @ https://a.example`;
    const cart = retitleSequence(noted, added.id, "Cart");
    expect(cart.id).toBe("head:Cart");
    expect(changed(noted, cart.source)).toEqual({
      added: [
        "  participant Cart",
        "  S->>Cart: add item",
        "  note over Cart,S: both",
        "  activate Cart",
        "  deactivate Cart",
        "  link Cart: Docs @ https://a.example",
      ],
      lost: [
        "  participant participant1 as Participant",
        "  S->>participant1: add item",
        "  note over participant1,S: both",
        "  activate participant1",
        "  deactivate participant1",
        "  link participant1: Docs @ https://a.example",
      ],
    });
    // A name of several words gives an id of its words, with the name beside it.
    const shop = retitleSequence(sent, added.id, "Web shop");
    expect(shop.id).toBe("head:WebShop");
    expect(shop.source).toContain("  participant WebShop as Web shop\n");
    expect(shop.source).toContain("  S->>WebShop: add item");
    expect(retitleSequence(sent, added.id, "Größe 2").source).toContain(
      "  participant Größe2 as Größe 2\n",
    );
    const actor = addSequencePiece(SHOP, { kind: "actor" });
    expect(retitleSequence(actor.source, actor.id, "Clerk")).toEqual({
      id: "head:Clerk",
      source: actor.source.replace("actor actor1 as Actor", "actor Clerk"),
    });
    // A name that gives no id, a keyword or an id that is taken: the generated id stays.
    for (const name of ["U", "!!!", "end", "2nd", "a name that is far too long to be an id"]) {
      const kept = retitleSequence(sent, added.id, name);
      expect(kept.id, name).toBe(name === "2nd" || name === "!!!" ? added.id : kept.id);
      expect(
        sequenceStructure.read(kept.source).nodes.find((node) => node.id === kept.id)!.label,
      ).toBe(name);
      parses(kept.source);
    }
    expect(retitleSequence(sent, added.id, "U").id).toBe(added.id);
    expect(retitleSequence(sent, added.id, "end").id).toBe(added.id);
    // Only a generated id follows the name.
    expect(retitleSequence(SHOP, "head:S", "Store")).toEqual({
      id: "head:S",
      source: renameSequence(SHOP, "head:S", "Store"),
    });
    expect(retitleSequence(BARS, "box0", "Stock")).toEqual({
      id: "box0",
      source: renameSequence(BARS, "box0", "Stock"),
    });
    expect(sequenceStructure.retitle!(sent, added.id, "Cart").id).toBe("head:Cart");
    // An id by itself.
    expect(renameParticipantId(SHOP, "head:S", "Store")).toBe(
      "sequenceDiagram\n  participant U as User\n  participant Store as Shop\n  participant P as Payment\n  U->>Store: place order\n  Store->>P: charge\n  P-->>Store: paid\n  Store-->>U: confirmation",
    );
    expect(
      renameParticipantId("sequenceDiagram\n  A ->> + AB : A to AB\n  AB-->>-A: A", "head:A", "C"),
    ).toBe("sequenceDiagram\n  C ->> + AB : A to AB\n  AB-->>-C: A");
    for (const id of ["U", "two words", "a-b", "end", "", "x:y"])
      expect(renameParticipantId(SHOP, "head:S", id), id).toBe(SHOP);
    expect(renameParticipantId(SHOP, "head:nobody", "X")).toBe(SHOP);
  });

  it("keeps every example readable through every new edit, with the ids of the scene", async () => {
    const drawn = async (source: string, hint: string) => {
      const scene = await parseUml(source).layout(arialMeasure),
        shapes = new Set(scene.shapes.map((shape) => shape.id)),
        wires = new Set(scene.wires.map((wire) => wire.edge)),
        read = sequenceStructure.read(source);
      for (const node of read.nodes) expect(shapes.has(node.id), `${hint} ${node.id}`).toBe(true);
      for (const edge of read.edges) expect(wires.has(edge.id), `${hint} ${edge.id}`).toBe(true);
    };
    /** Every line of `before` is in `after`, in its order, but for `gone` of them. */
    const keeps = (before: string, after: string, hint: string, gone = 0) => {
      const now = after.split("\n");
      let at = 0,
        missing = 0;
      for (const line of before.split("\n")) {
        const found = now.indexOf(line, at);
        if (found < 0) missing++;
        else at = found + 1;
      }
      expect(missing, hint).toBeLessThanOrEqual(gone);
    };
    for (const [name, source] of SEQUENCE_EXAMPLES) {
      const { nodes, edges } = sequenceStructure.read(source),
        heads = nodes.filter((node) => node.id.startsWith("head:")),
        order = columnsOf(source);
      for (const head of heads) {
        const who = head.id.slice(5),
          at = order.indexOf(who);
        for (const side of ["after", "before"] as const) {
          const added = insertParticipant(source, { kind: "participant", [side]: head.id }),
            columns = columnsOf(added.source);
          expect(
            columns.filter((id) => id !== "participant1"),
            `${name} ${side} ${who}`,
          ).toEqual(order);
          expect(columns.indexOf("participant1")).toBe(side === "after" ? at + 1 : at);
          keeps(source, added.source, `${name} ${side} ${who}`);
          await drawn(added.source, `${name} ${side} ${who}`);
          const named = retitleSequence(added.source, added.id, "Fresh one");
          expect(named.id).toBe("head:FreshOne");
          expect(named.source).not.toContain("participant1");
          expect(columnsOf(named.source).indexOf("FreshOne")).toBe(columns.indexOf("participant1"));
        }
        for (const delta of [-1, 1] as const) {
          const moved = moveParticipant(source, head.id, delta);
          parses(moved);
          expect(columnsOf(moved).toSorted(), `${name} move ${who}`).toEqual(order.toSorted());
          expect(messages(moved)).toEqual(messages(source));
          if (moved !== source) await drawn(moved, `${name} move ${who} ${delta}`);
        }
        const boxed = boxParticipants(source, [head.id], "Frame");
        if (boxed.id) {
          expect(columnsOf(boxed.source)).toEqual(order);
          expect(
            sequenceStructure.read(boxed.source).nodes.find((node) => node.id === head.id)!.parent,
          ).toBe(boxed.id);
          await drawn(boxed.source, `${name} box ${who}`);
        } else
          expect(
            head.parent !== null || parseSequenceDiagram(source).participants.get(who)!.created,
          ).toBe(true);
        const note = sequenceStructure.add(source, { kind: "note", parent: head.id });
        expect(note.source).toBe(
          `${source}\n  note over ${who}: Note`.replace(/\n+(?=\n {2}note over)/, ""),
        );
        await drawn(note.source, `${name} note ${who}`);
        const renamed = renameParticipantId(source, head.id, "Zz9");
        expect(columnsOf(renamed)).toEqual(order.map((id) => (id === who ? "Zz9" : id)));
        expect(messages(renamed)).toHaveLength(edges.length);
        expect(removalSummary(source, [head.id])).toContain(head.label.replace(/<br>/g, " "));
      }
      for (const edge of edges) {
        const reply = replyTo(source, edge.id);
        expect(
          sequenceStructure.read(reply.source).edges.find((item) => item.id === reply.edge),
        ).toMatchObject({
          source: edge.target,
          target: edge.source,
          kind: "reply",
        });
        keeps(source, reply.source, `${name} reply ${edge.id}`);
        expect(messageContext(reply.source, reply.edge)!.fragment).toBe(
          messageContext(source, edge.id)!.fragment,
        );
        const wrapped = wrapMessages(source, [edge.id], "opt", "if so");
        if (wrapped.id) {
          expect(messageContext(wrapped.source, edge.id)!.fragment).toBe(wrapped.id);
          expect(messages(wrapped.source)).toEqual(messages(source));
          expect(unwrapFragment(wrapped.source, wrapped.id)).toBe(source);
          await drawn(wrapped.source, `${name} wrap ${edge.id}`);
        }
        const self = connectSequence(source, edge.source, edge.source);
        expect(
          sequenceStructure.read(self.source).edges.find((item) => item.id === self.edge),
        ).toMatchObject({
          source: edge.source,
          target: edge.source,
        });
      }
      for (const node of nodes.filter((item) => item.kind === "fragment")) {
        const flat = unwrapFragment(source, node.id);
        expect(messages(flat)).toEqual(messages(source));
        expect(
          sequenceStructure.read(flat).nodes.filter((item) => item.kind === "fragment"),
        ).toHaveLength(nodes.filter((item) => item.kind === "fragment").length - 1);
        expect(sequenceStructure.remove(source, [node.id])).toBe(flat);
        await drawn(flat, `${name} unwrap ${node.id}`);
      }
      for (const node of nodes.filter((item) => item.kind === "note")) {
        const without = sequenceStructure.remove(source, [node.id]);
        expect(
          sequenceStructure.read(without).nodes.filter((item) => item.kind === "note"),
        ).toHaveLength(nodes.filter((item) => item.kind === "note").length - 1);
        expect(columnsOf(without)).toEqual(order);
      }
      for (const on of [true, false]) {
        const numbered = setAutonumber(source, on);
        parses(numbered);
        expect(
          parseSequenceDiagram(numbered).events.some(
            (event) => event.type === "message" && event.number !== undefined,
          ),
        ).toBe(on && edges.length > 0);
      }
    }
  }, 120_000);
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
      "block1:fragment:null:12",
      "note1:note:null:21",
      "note2:note:null:22",
      "block2:fragment:null:23",
    ]);
    expect(nodes.map((node) => node.label)).toEqual([
      "Customer",
      "Web shop",
      "Back office",
      "Inventory",
      "Orders",
      "alt all in stock",
      "both keep a log",
      "alone",
      "loop until shipped",
    ]);
    expect(nodes.map((node) => node.group)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
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
        // A fragment is a part and no piece: `wrapMessages` makes one.
        expect(kinds.has(node.kind) || node.kind === "fragment", node.kind).toBe(true);
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
        // Every participant that was not removed keeps its column, in the order they had.
        const taken =
            "group" in part && part.kind === "box"
              ? nodes.filter((node) => node.parent === part.id).map((node) => node.id)
              : [part.id],
          heads = (list: typeof nodes) =>
            list.filter((node) => node.id.startsWith("head:")).map((node) => node.id);
        expect(heads(left.nodes), `${name} ${part.id}`).toEqual(
          heads(nodes).filter((id) => !taken.includes(id)),
        );
      }
      for (const node of nodes) {
        parses(sequenceStructure.rename(source, node.id, "Another name"));
        const renamed = sequenceStructure.read(
          sequenceStructure.rename(source, node.id, "Another name"),
        );
        expect(renamed.nodes.map((item) => item.id)).toEqual(nodes.map((item) => item.id));
        // A fragment is labelled with its keyword before the name; a `rect` has no name.
        const label = renamed.nodes.find((item) => item.id === node.id)!.label;
        if (node.kind !== "fragment") expect(label).toBe("Another name");
        else if (!node.label.startsWith("rect"))
          expect(label).toBe(`${node.label.split(" ")[0]} Another name`);
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
        // A note stands over a participant; the other pieces stand alone.
        const added = sequenceStructure.add(source, {
          kind: piece.kind,
          label: "New one",
          parent: piece.kind === "note" ? nodes.find((node) => !node.group)!.id : undefined,
        });
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
