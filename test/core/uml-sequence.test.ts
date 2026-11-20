// Sequence diagrams: parsing (errors with their lines, activations, what is left to Mermaid) and the source edits.
import { test } from "vitest";
import assert from "node:assert/strict";
import { type MessageEvent, parseSequenceDiagram } from "../../src/uml-sequence.ts";
import * as edit from "../../src/uml-sequence-edit.ts";
import { UmlError } from "../../src/uml.ts";

const { sequenceStructure: structure } = edit;

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

const TRIAGE =
  "sequenceDiagram\n  A->>B: how are you\n  alt is sick\n    B-->>A: not so good\n  else is well\n    B-->>A: fine\n  else\n    B-->>A: no answer\n  end\n  loop Every minute\n    A->>B: ping\n  end\n  rect rgb(240, 240, 240)\n    B-->>A: pong\n  end";

/** The messages of a source as `from>to:text`, joined by `|`; parsing it is the check that it still reads. */
const messages = (source: string) =>
  parseSequenceDiagram(source)
    .events.flatMap((event) =>
      event.type === "message"
        ? [`${event.from}>${event.to}${event.text ? `:${event.text}` : ""}`]
        : [],
    )
    .join("|");

/** The participants of a source, in column order, joined by commas. */
const columns = (source: string) => [...parseSequenceDiagram(source).participants.keys()].join();

/** Lines `from` to `to` (exclusive) of a source, from 0. */
const at = (source: string, from: number, to = from + 1) =>
  source.split("\n").slice(from, to).join("\n");

/** The lines `after` has that `before` has not (`+`), then those it lost (`-`). */
const changed = (before: string, after: string) => {
  const was = before.split("\n"),
    now = after.split("\n");
  const added = now.filter((line) => !was.includes(line)).map((line) => `+${line}`),
    lost = was.filter((line) => !now.includes(line)).map((line) => `-${line}`);
  return [...added, ...lost].join("\n");
};

/** The UmlError parsing `source` throws. */
const parseError = (source: string): UmlError => {
  try {
    parseSequenceDiagram(source);
  } catch (error) {
    assert.ok(error instanceof UmlError);
    return error;
  }
  return assert.fail(`parsed: ${source}`);
};

const node = (source: string, id: string) =>
  structure.read(source).nodes.find((item) => item.id === id);

test("reads participants, actors, aliases and every arrow", () => {
  const diagram = parseSequenceDiagram(
    "sequenceDiagram\n  participant A as Alice\n  actor B as Bob\n  A->B: a\n  A-->B: b\n  A->>B: c\n  A-->>B: d\n  A-xB: e\n  A--xB: f\n  A-)B: g\n  A--)B: h\n  A<<->>B: i\n  A<<-->>B: j",
  );
  const heads = [...diagram.participants.values()].map(
    (item) => `${item.id}:${item.label}:${item.actor}`,
  );
  assert.equal(heads.join(), "A:Alice:false,B:Bob:true");
  const arrows = diagram.events.flatMap((event) =>
    event.type === "message"
      ? [`${event.text}:${event.dashed ? "--" : "-"}${event.head}:${event.tail}`]
      : [],
  );
  assert.equal(
    arrows.join(),
    "a:-null:null,b:--null:null,c:-arrow:null,d:--open:null,e:-cross:null,f:--cross:null,g:-open:null,h:--open:null,i:-arrow:arrow,j:--open:open",
  );
});

test("reads activations, notes, fragments, numbering, creation and destruction", () => {
  const diagram = parseSequenceDiagram(
    "sequenceDiagram\n  autonumber 10 5\n  A->>+B: call\n  B-->>-A: done\n  note over A,B: both\n  alt ok\n    A->>B: yes\n  else not ok\n    A->>B: no\n  end\n  create participant C\n  A->>C: new\n  destroy C\n  A-xC: bye",
  );
  assert.equal(
    diagram.events.map((event) => event.type).join(),
    "message,message,note,start,message,else,message,end,create,message,destroy,message",
  );
  const sent = diagram.events.filter((event): event is MessageEvent => event.type === "message");
  assert.equal(
    sent
      .map((event) => `${event.number}${event.activate ? "+" : ""}${event.deactivate ? "-" : ""}`)
      .join(),
    "10+,15-,20,25,30,35",
  );
  assert.partialDeepStrictEqual(diagram.participants.get("C"), { created: true, destroyed: true });
});

test("reports errors with their lines, and leaves what it does not draw to Mermaid", () => {
  const cases: [string, number, RegExp][] = [
    ["sequenceDiagram\n  loop forever\n  A->>B: x", 2, /`loop` is missing its `end`/],
    ["sequenceDiagram\n  A->>B: x\n  else", 3, /`else` belongs inside `alt`/],
    ["sequenceDiagram\n  A->>B: x\n  end", 3, /Unmatched `end`/],
    ["sequenceDiagram\n  box A\n  box B", 3, /Boxes cannot be nested/],
    ["sequenceDiagram\n  note left of A,B: x", 2, /at most two participants/],
    ["sequenceDiagram\n  A ? B", 2, /Cannot read/],
    [
      "sequenceDiagram\n  %% level conceptual\n  create participant A\n  B->>A: x",
      3,
      /creation belongs to the design level/,
    ],
  ];
  for (const [source, line, message] of cases) {
    const error = parseError(source);
    assert.equal(error.line, line, source);
    assert.match(error.message, message);
    assert.equal(error.unsupported, false);
  }
  for (const source of [
    'sequenceDiagram\n  participant A@{ "type": "database" }',
    "sequenceDiagram\n  par_over A\n  end",
  ])
    assert.equal(parseError(source).unsupported, true, source);
});

test("rejects a bar closed that is not open, on the line that closes it", () => {
  const cases: [string, number][] = [
    ["A->>B: hi\ndeactivate B", 3],
    ["activate A\ndeactivate A\ndeactivate A", 4],
    ["A->>-B: hi", 2],
    ["A->>-A: hi", 2],
    ["A->>+B: a\nB-->>-A: b\nB-->>-A: c", 4],
    ["create participant B\nA->>-B: new", 3],
    ["alt x\nA->>B: m\ndeactivate B\nend", 4],
  ];
  for (const [body, line] of cases) {
    const error = parseError(`sequenceDiagram\n${body}`);
    assert.equal(error.line, line, body);
    assert.match(error.message, /is not active/);
  }
});

test("reads participants, boxes, fragments, notes and messages as parts and joins", () => {
  const { nodes, edges } = structure.read(BARS);
  assert.equal(
    nodes
      .map((item) => `${item.id}:${item.kind}:${item.parent}:${item.line}:${item.label}`)
      .join("|"),
    "head:U:actor:null:3:Customer|head:W:participant:null:4:Web shop|box0:box:null:6:Back office|head:I:participant:box0:7:Inventory|head:O:participant:box0:8:Orders|block1:fragment:null:12:all in stock|note1:note:null:21:both keep a log|note2:note:null:22:alone|block2:fragment:null:23:until shipped",
  );
  assert.equal(
    edges.map((item) => `${item.id}:${item.source}>${item.target}:${item.kind}`).join("|"),
    "m1:head:U>head:W:sync|m2:head:W>head:I:sync|m3:head:I>head:W:reply|m4:head:W>head:O:sync|m5:head:O>head:W:reply|m6:head:I>head:W:reply|m7:head:O>head:I:sync|m8:head:W>head:U:reply",
  );
});

test("adds participants, actors and boxes", () => {
  const added = edit.addSequencePiece(SHOP, { kind: "participant", label: "Mailer" });
  assert.equal(added.id, "head:participant1");
  assert.equal(at(added.source, 4), "  participant participant1 as Mailer");
  // Declared after the box; a box asked for in a box stands beside it.
  assert.equal(
    at(edit.addSequencePiece(BARS, { kind: "actor", label: "Clerk" }).source, 8, 10),
    "  end\n  actor actor1 as Clerk",
  );
  const box = edit.addSequencePiece(BARS, { kind: "box", label: "Red team", parent: "box0" });
  assert.equal(box.id, "box1");
  assert.equal(
    changed(BARS, box.source),
    "+  box transparent Red team\n+    participant participant1 as Participant",
  );
  assert.deepEqual(edit.addSequencePiece("sequenceDiagram\n  A->>B: hi", { kind: "box" }), {
    id: "box0",
    source:
      "sequenceDiagram\n  box Group\n    participant participant1 as Participant\n  end\n  A->>B: hi",
  });
});

test("inserts a participant beside another, declaring the implied ones the order needs", () => {
  assert.equal(
    columns(
      edit.insertParticipant(SHOP, { kind: "participant", label: "Cart", after: "head:U" }).source,
    ),
    "U,participant1,S,P",
  );
  const implied = "sequenceDiagram\n  autonumber\n  A->>B: one\n  B->>C: two\n  C->>D: three";
  assert.equal(
    edit.insertParticipant(implied, { kind: "participant", label: "New", after: "head:B" }).source,
    "sequenceDiagram\n  autonumber\n  participant A\n  participant B\n  participant participant1 as New\n  A->>B: one\n  B->>C: two\n  C->>D: three",
  );
  assert.equal(
    columns(edit.insertParticipant(LIFE, { kind: "participant", before: "head:link" }).source),
    "web,dyn,participant1,link",
  );
});

test("moves a participant a column, into a box and out of it", () => {
  const right = edit.moveParticipant(SHOP, "head:U", 1);
  assert.equal(columns(right), "S,U,P");
  const into = edit.moveParticipant(BARS, "head:W", 1);
  assert.equal(parseSequenceDiagram(into).participants.get("W")?.box, 0);
  // The box it leaves empty goes; a created participant stays in its column.
  const single =
    "sequenceDiagram\n  box One\n    participant A\n  end\n  participant B\n  A->>B: hi";
  assert.equal(
    edit.moveParticipant(single, "head:A", 1),
    "sequenceDiagram\n  participant A\n  participant B\n  A->>B: hi",
  );
  assert.equal(edit.moveParticipant(LIFE, "head:link", -1), LIFE);
});

test("frames participants side by side in a box", () => {
  const boxed = edit.boxParticipants(SHOP, ["head:S", "head:P"], "Back office");
  assert.equal(boxed.id, "box0");
  assert.equal(
    at(boxed.source, 2, 6),
    "  box Back office\n    participant S as Shop\n    participant P as Payment\n  end",
  );
  assert.equal(
    edit.boxParticipants("sequenceDiagram\n  A->>B: one\n  B->>C: two", ["head:C", "head:B"], "")
      .source,
    "sequenceDiagram\n  participant A\n  box Group\n    participant B\n    participant C\n  end\n  A->>B: one\n  B->>C: two",
  );
  assert.deepEqual(edit.boxParticipants(SHOP, ["head:U", "head:P"], "x"), { source: SHOP, id: "" });
  assert.equal(edit.boxParticipants(BARS, ["head:W", "head:I"], "x").id, "");
});

test("sends messages at the end, after a message, before a part, and first in a branch", () => {
  assert.equal(edit.insertMessage(SHOP, "head:U", "head:P"), `${SHOP}\n  U->>P: message`);
  const inside = edit.connectSequence(BARS, "head:O", "head:U", undefined, { after: "m4" });
  assert.equal(inside.edge, "m5");
  assert.equal(at(inside.source, 15), "    O->>U: message");
  assert.deepEqual(edit.messageContext(inside.source, inside.edge), {
    fragment: "block1",
    index: 4,
  });
  assert.equal(edit.messageContext(BARS, "m99"), null);
  const second = edit.insertMessageAt(BARS, "head:W", "head:O", "sync", {
    into: "block1",
    branch: 1,
  });
  assert.equal(second.edge, "m6");
  assert.equal(at(second.source, 16, 18), "  else something missing\n    W->>O: message");
  // Before the message a `create` belongs to: before the `create`.
  const created = edit.insertMessageAt(LIFE, "head:web", "head:dyn", "sync", { before: "m2" });
  assert.equal(
    at(created.source, 3, 5),
    "  web->>dyn: message\n  create participant link as newLink",
  );
});

test("answers a message, closing the bar it opens", () => {
  const reply = edit.replyTo(SHOP, "m2");
  assert.equal(reply.edge, "m3");
  assert.equal(at(reply.source, 6), "  P-->>S: reply");
  assert.equal(
    edit.replyTo("sequenceDiagram\n  A->>+B: ask", "m1").source,
    "sequenceDiagram\n  A->>+B: ask\n  B-->>-A: reply",
  );
  assert.deepEqual(edit.replyTo(SHOP, "m9"), { source: SHOP, edge: "" });
});

test("moves a message past its neighbour, into and out of fragments, never before its bar opens", () => {
  assert.equal(
    messages(edit.moveMessage(SHOP, "m2", 1)),
    "U>S:place order|P>S:paid|S>P:charge|S>U:confirmation",
  );
  const into = edit.moveMessage(BARS, "m2", 1);
  assert.equal(at(into, 10, 12), "  alt all in stock\n    W->>+I: reserve items");
  assert.equal(edit.moveMessage(BARS, "m4", 1), BARS);
  // The id it has after the move.
  const down = edit.moveMessageTo(SHOP, "m1", 1);
  assert.equal(down.edge, "m2");
  assert.deepEqual(edit.moveMessageTo(down.source, down.edge, -1), { source: SHOP, edge: "m1" });
});

test("places a note in time and moves it", () => {
  const note = edit.insertNote(SHOP, { over: ["head:S", "head:P"], text: "by card", after: "m2" });
  assert.equal(note.id, "note1");
  assert.equal(at(note.source, 6), "  note over S,P: by card");
  assert.deepEqual(edit.insertNote(SHOP, { over: ["head:U", "head:S"], side: "right of" }), {
    source: SHOP,
    id: "",
  });
  const up = edit.moveNote(note.source, "note1", -1);
  assert.equal(at(up.source, 5, 7), "  note over S,P: by card\n  S->>P: charge");
  assert.deepEqual(edit.moveNote(up.source, "note1", 1), note);
  const into = edit.moveNote(BARS, "note2", 1);
  assert.partialDeepStrictEqual(node(into.source, into.id), { label: "alone", parent: "block2" });
});

test("moves a fragment as a block, into the one before it", () => {
  const down = edit.moveFragment(BARS, "block2", 1);
  assert.equal(
    at(down.source, 22, 26),
    "  W-->>U: done\n  loop until shipped\n    O->>I: poll status\n  end",
  );
  assert.deepEqual(edit.moveFragment(down.source, "block2", -1), { source: BARS, id: "block2" });
  const two =
    "sequenceDiagram\n  opt a\n    A->>B: one\n  end\n  A->>B: mid\n  loop b\n    B->>A: two\n  end";
  const passed = edit.moveFragment(edit.moveFragment(two, "block2", -1).source, "block2", -1);
  assert.equal(
    passed.source,
    "sequenceDiagram\n  opt a\n    A->>B: one\n    loop b\n      B->>A: two\n    end\n  end\n  A->>B: mid",
  );
  assert.equal(edit.fragmentKind(passed.source, passed.id), "loop");
});

test("renames participants, boxes and fragments", () => {
  assert.equal(
    changed(SHOP, edit.renameSequence(SHOP, "head:S", "Web shop")),
    "+  participant S as Web shop\n-  participant S as Shop",
  );
  const web = edit.renameSequence(LIFE, "head:web", "Web server");
  assert.equal(at(web, 1), "  participant web as Web server");
  assert.equal(edit.renameSequence(web, "head:web", ""), LIFE);
  // One only messages name is declared where it first stands.
  assert.equal(
    edit.renameSequence("sequenceDiagram\n  A->>B: hi\n  C->>A: ho", "head:B", "Bee"),
    "sequenceDiagram\n  participant A\n  participant B as Bee\n  A->>B: hi\n  C->>A: ho",
  );
  assert.equal(at(edit.renameSequence(BARS, "box0", "Warehouse"), 5), "  box Purple Warehouse");
  assert.equal(at(edit.renameSequence(BARS, "block1", "enough"), 11), "  alt enough");
});

test("writes texts with special characters so that they read back the same", () => {
  for (const text of ["a: b; c", 'x < y > "z" & as if', "f(x) -> y"]) {
    const labelled = edit.labelMessage(SHOP, "m2", text);
    assert.equal(structure.read(labelled).edges[1]?.label, text, labelled);
    const renamed = edit.renameSequence(SHOP, "head:S", text);
    assert.equal(structure.read(renamed).nodes[1]?.label, text, renamed);
  }
  assert.equal(edit.textOf("a; b"), "a#59; b");
});

test("labels, relinks and turns round messages, keeping their activations", () => {
  assert.equal(
    changed(BARS, edit.labelMessage(BARS, "m2", "hold")),
    "+  W->>+I: hold\n-  W->>+I: reserve items",
  );
  assert.equal(at(edit.labelMessage(SHOP, "m3", ""), 6), "  P-->>S: ");
  assert.equal(
    changed(BARS, edit.relinkMessage(BARS, "m5", "async-reply")),
    "+    O--)-W: order id\n-    O-->>-W: order id",
  );
  assert.equal(
    edit.relinkMessage("sequenceDiagram\n  A ->> + B : hi", "m1", "lost"),
    "sequenceDiagram\n  A -x + B: hi",
  );
  assert.equal(edit.relinkMessage(SHOP, "m1", "wavy"), SHOP);
  assert.equal(at(edit.reverseMessage(SHOP, "m2"), 5), "  P->>S: charge");
  // A bar that no longer matches goes with its other end.
  assert.equal(
    changed(BARS, edit.reverseMessage(BARS, "m4")),
    "+    O->>W: create order\n+    O-->>W: order id\n-    W->>+O: create order\n-    O-->>-W: order id",
  );
});

test("removes messages with the other end of their bars, and fragments they empty", () => {
  assert.equal(
    changed(BARS, edit.removeSequence(BARS, ["m4"])),
    "+    O-->>W: order id\n-    W->>+O: create order\n-    O-->>-W: order id",
  );
  assert.equal(
    changed(BARS, edit.removeSequence(BARS, ["m7"])),
    "-  loop until shipped\n-    O->>I: poll status",
  );
  // A participant that loses every message keeps its column.
  const first = edit.removeSequence("sequenceDiagram\n  A->>B: one\n  C->>A: two", ["m1"]);
  assert.equal(first, "sequenceDiagram\n  participant A\n  participant B\n  C->>A: two");
  assert.equal(
    changed(LIFE, edit.removeSequence(LIFE, ["m4"])),
    "-  destroy link\n-  web-xlink: delete",
  );
  assert.equal(edit.removalSummary(SHOP, ["m1"]), "1 message");
});

test("removes participants and boxes with what is theirs", () => {
  assert.equal(
    changed(SHOP, edit.removeSequence(SHOP, ["head:P"])),
    "-  participant P as Payment\n-  S->>P: charge\n-  P-->>S: paid",
  );
  assert.equal(
    edit.removeSequence(LIFE, ["head:link"]),
    "sequenceDiagram\n  participant web\n  web->>+dyn: requestEditPage()\n  dyn-->>-web: Edit Page",
  );
  assert.equal(
    edit.removalSummary(BARS, ["box0"]),
    "Inventory, Orders, 6 messages, 1 note, 2 fragments, 1 box",
  );
  assert.equal(edit.removalSummary(SHOP, ["head:nobody"]), "");
});

test("renames an id everywhere, gives a new participant its first name as id, and copies one", () => {
  const added = edit.addSequencePiece(SHOP, { kind: "participant" });
  const sent = edit.insertMessage(added.source, "head:S", added.id, { label: "add item" });
  assert.ok(edit.isGeneratedParticipantId(sent, added.id));
  const shop = edit.retitleSequence(sent, added.id, "Web shop");
  assert.equal(shop.id, "head:WebShop");
  assert.equal(
    changed(sent, shop.source),
    "+  participant WebShop as Web shop\n+  S->>WebShop: add item\n-  participant participant1 as Participant\n-  S->>participant1: add item",
  );
  const store = edit.retitleSequence(SHOP, "head:S", "Store");
  assert.deepEqual(store, { id: "head:S", source: edit.renameSequence(SHOP, "head:S", "Store") });
  assert.equal(
    edit.renameParticipantId(
      "sequenceDiagram\n  A ->> + AB : A to AB\n  AB-->>-A: A",
      "head:A",
      "C",
    ),
    "sequenceDiagram\n  C ->> + AB : A to AB\n  AB-->>-C: A",
  );
  for (const id of ["U", "two words"])
    assert.equal(edit.renameParticipantId(SHOP, "head:S", id), SHOP, id);
  const copy = edit.duplicateParticipant(SHOP, "head:S");
  assert.equal(copy.id, "head:S2");
  assert.equal(columns(copy.source), "U,S,S2,P");
  assert.ok(edit.isGeneratedParticipantId(copy.source, copy.id));
});

test("wraps a run of messages in a fragment, and unwraps it", () => {
  const wrapped = edit.wrapMessages(SHOP, ["m3", "m2"], "opt", "card accepted");
  assert.equal(wrapped.id, "block1");
  assert.equal(
    at(wrapped.source, 5, 9),
    "  opt card accepted\n    S->>P: charge\n    P-->>S: paid\n  end",
  );
  assert.equal(edit.unwrapFragment(wrapped.source, wrapped.id), SHOP);
  const created = edit.wrapMessages(LIFE, ["m2"], "opt", "new").source;
  assert.equal(
    at(created, 3, 6),
    "  opt new\n    create participant link as newLink\n    dyn-)link: create",
  );
  assert.deepEqual(edit.wrapMessages(SHOP, ["m1", "m3"], "alt", "x"), { source: SHOP, id: "" });
  const flat = edit.unwrapFragment(BARS, "block1");
  assert.equal(flat.split("\n").length, BARS.split("\n").length - 3);
  assert.equal(structure.remove(BARS, ["block1"]), flat);
});

test("changes the kind and the branches of a fragment", () => {
  assert.equal(
    ["block1", "block2", "block3", "note1"].map((id) => edit.fragmentKind(TRIAGE, id)).join(),
    "alt,loop,rect,",
  );
  assert.equal(edit.fragmentKinds(TRIAGE, "block1").join(), "alt,par,critical");
  assert.equal(edit.fragmentKinds(TRIAGE, "block3").join(), "rect");
  const par = edit.setFragmentKind(TRIAGE, "block1", "par");
  assert.equal(
    changed(TRIAGE, par),
    "+  par is sick\n+  and is well\n+  and\n-  alt is sick\n-  else is well\n-  else",
  );
  assert.equal(edit.setFragmentKind(par, "block1", "alt"), TRIAGE);
  assert.deepEqual(edit.fragmentBranches(TRIAGE, "block1"), [
    { label: "is sick" },
    { label: "is well" },
    { label: "" },
  ]);
  assert.equal(
    at(edit.setFragmentBranch(TRIAGE, "block1", 1, "fine; really"), 4),
    "  else fine#59; really",
  );
  const added = edit.addFragmentBranch(TRIAGE, "block1", "asleep");
  assert.equal(at(added, 8, 10), "  else asleep\n  end");
  assert.equal(edit.addFragmentBranch(TRIAGE, "block2", "x"), TRIAGE);
  assert.equal(edit.removeFragmentBranch(added, "block1", 3), TRIAGE);
});

test("toggles a bar and the numbering", () => {
  const on = edit.toggleActivation(SHOP, "m2");
  assert.equal(
    changed(SHOP, on),
    "+  S->>+P: charge\n+  P-->>-S: paid\n-  S->>P: charge\n-  P-->>S: paid",
  );
  assert.equal(edit.toggleActivation(on, "m3"), SHOP);
  assert.equal(
    changed(BARS, edit.toggleActivation(BARS, "m2")),
    "+  W->>I: reserve items\n-  W->>+I: reserve items\n-  deactivate I",
  );
  const numbered = edit.setAutonumber(SHOP, true);
  assert.equal(numbered, SHOP.replace("sequenceDiagram\n", "sequenceDiagram\n  autonumber\n"));
  assert.ok(edit.hasAutonumber(numbered) && !edit.hasAutonumber(SHOP));
  assert.equal(edit.setAutonumber(numbered, false), SHOP);
  assert.equal(
    edit.setAutonumber("sequenceDiagram\n  autonumber 10 5\n  A->>B: hi", false),
    "sequenceDiagram\n  A->>B: hi",
  );
});

test("makes a participant an actor, declaring an implied one in its column", () => {
  assert.equal(
    changed(SHOP, edit.setParticipantKind(SHOP, "head:U", "actor")),
    "+  actor U as User\n-  participant U as User",
  );
  const dyn = edit.setParticipantKind(LIFE, "head:dyn", "actor");
  assert.equal(changed(LIFE, dyn), "+  actor dyn");
  assert.equal(columns(dyn), columns(LIFE));
  assert.equal(
    at(edit.setParticipantKind(LIFE, "head:link", "actor"), 3),
    "  create actor link as newLink",
  );
});

test("joins parts, says why not, and adds a piece at a part", () => {
  assert.equal(edit.whyNotSequence(SHOP, "head:U", "head:S"), undefined);
  assert.match(edit.whyNotSequence(BARS, "head:U", "block1") ?? "", /between two participants/);
  // A note connected to a participant stands over it.
  assert.equal(
    at(edit.connectSequence(BARS, "note2", "head:U").source, 21),
    "  note right of U: alone",
  );
  const joined = edit.attachSequence(
    SHOP,
    { kind: "participant", label: "Mailer" },
    "head:S",
    "async",
  );
  assert.deepEqual([joined.id, joined.edge], ["head:participant1", "m5"]);
  assert.equal(
    changed(SHOP, joined.source),
    "+  participant participant1 as Mailer\n+  S-)participant1: message",
  );
  const note = structure.add(SHOP, { kind: "note", label: "Checks", parent: "m2" });
  assert.deepEqual(note, {
    id: "note1",
    source: SHOP.replace("  S->>P: charge", "  S->>P: charge\n  note over S,P: Checks"),
  });
  assert.equal(at(structure.add(SHOP, { kind: "loop", parent: "m2" }).source, 5), "  loop");
  assert.deepEqual(edit.attachSequence(SHOP, { kind: "loop" }, "head:U"), {
    source: SHOP,
    id: "",
    edge: "",
  });
});
