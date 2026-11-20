// State machine diagrams: parsing (errors with lines, the TAM rules) and the source edits of uml-state-edit.ts.
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseStateDiagram } from "../../src/uml-state.ts";
import { UmlError } from "../../src/uml.ts";
import {
  addStatePiece,
  attachState,
  connectState,
  connectStates,
  duplicateState,
  isGeneratedStateId,
  labelTransition,
  moveStateInto,
  removeStates,
  renameState,
  renameStateId,
  retitleState,
  reverseTransition,
  setNoteSide,
  setStateDescription,
  stateDescription,
  stateStructure,
  ungroupComposite,
  whyNotState,
} from "../../src/uml-state-edit.ts";

const STARTER = `stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted : submit
  Submitted --> Approved : approve
  Submitted --> Draft : reject
  Approved --> [*]`;

const NESTED = `---
title: Editing
---
stateDiagram-v2
    %% the outer machine
    state "Edit Mode" as Edit {
        [*] --> Unsaved
        Unsaved --> Saved : apply

        state Check {
            [*] --> Inner
        }
        Saved --> [*]
    }
    state pick <<choice>>
    [*] --> Idle
    Idle --> Edit: open
    Edit --> pick

    %% where it ends
    pick --> Idle : again
    pick --> Done
    Done --> [*]
    note right of Idle : waits
    note left of Done
        all
        over
    end note
    class Done bold`;

const REGIONS = `stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> NumOff
    NumOff --> NumOn : press
    --
    [*] --> CapsOff
    CapsOff --> CapsOn : press
    CapsOn --> [*]
  }
  Active --> [*]`;

/** The transitions of a source as `source>target:label`; parsing it also checks that it reads. */
const transitions = (source: string) =>
  parseStateDiagram(source).transitions.map(
    (item) => `${item.source}>${item.target}${item.label ? `:${item.label}` : ""}`,
  );

const parentOf = (source: string, id: string) => parseStateDiagram(source).states.get(id)?.parent;

/** The lines of `before` that `after` no longer has, and the ones it has anew. */
function changed(before: string, after: string) {
  const old = before.split("\n"),
    now = after.split("\n");
  return {
    lost: old.filter((line) => !now.includes(line)),
    added: now.filter((line) => !old.includes(line)),
  };
}

/** The error a source fails to parse with. */
function parseError(source: string): UmlError {
  try {
    parseStateDiagram(source);
  } catch (error) {
    assert.ok(error instanceof UmlError);
    return error;
  }
  throw new Error("parsed");
}

test("reads states, aliases, descriptions and transitions with labels", () => {
  const diagram = parseStateDiagram(`stateDiagram-v2
  state "Waiting for payment" as Waiting
  Waiting : entry / start timer
  [*] --> Waiting
  Waiting --> Paid : payment [ok] / ship
  Paid --> [*]
  Waiting --> [*]`);
  const waiting = diagram.states.get("Waiting");
  assert.equal(waiting?.label, "Waiting for payment");
  assert.deepEqual(waiting.descriptions, ["entry / start timer"]);
  assert.deepEqual(
    diagram.transitions.map((item) => [item.source, item.target, item.label]),
    [
      ["root#initial", "Waiting", undefined],
      ["Waiting", "Paid", "payment [ok] / ship"],
      ["Paid", "root#final1", undefined],
      ["Waiting", "root#final2", undefined],
    ],
  );
});

test("gives each composite and region its own initial state", () => {
  const diagram = parseStateDiagram(REGIONS);
  const active = diagram.states.get("Active")!;
  assert.deepEqual(active.children, ["Active#region1", "Active#region2"]);
  assert.deepEqual(diagram.states.get("Active#region1")!.children, [
    "Active#initial",
    "NumOff",
    "NumOn",
  ]);
  assert.deepEqual(diagram.states.get("Active#region2")!.children, [
    "Active#region2#initial",
    "CapsOff",
    "CapsOn",
    "Active#region2#final1",
  ]);
});

test("reads choice, fork and join pseudo-states and notes", () => {
  const diagram = parseStateDiagram(`stateDiagram-v2
  state c <<choice>>
  state f <<fork>>
  state j [[join]]
  note right of c : decide
  note left of f
    two lines
    of text
  end note`);
  assert.deepEqual(
    ["c", "f", "j"].map((id) => diagram.states.get(id)?.kind),
    ["choice", "fork", "join"],
  );
  assert.deepEqual(
    diagram.notes.map((note) => [note.target, note.side, note.text]),
    [
      ["c", "right", "decide"],
      ["f", "left", "two lines<br>of text"],
    ],
  );
});

test("reports errors with their lines, and the TAM rules", () => {
  const cases: [string, number, string][] = [
    ["stateDiagram-v2\n  state A {\n    B --> C", 2, "`A` is missing its closing `}`."],
    [
      "stateDiagram-v2\n  A --> B\n  --",
      3,
      "Concurrent regions (`--`) belong inside a composite state.",
    ],
    ["stateDiagram-v2\n  note right of A\n  text", 2, "The note is missing its `end note`."],
    ["stateDiagram-v2\n  A ==> B", 2, "Cannot read `A ==> B`."],
    [
      "stateDiagram-v2\n  state A {\n    B --> C\n  }\n  A : busy",
      2,
      "The composite state `A` has a name only, no description.",
    ],
    ["stateDiagram-v2\n  }", 2, "Unmatched `}`."],
    [
      "stateDiagram-v2\n  %% level conceptual\n  state f <<fork>>",
      3,
      "TAM state machines have no fork bars; use an activity diagram for parallel flows.",
    ],
  ];
  for (const [source, line, message] of cases) {
    const error = parseError(source);
    assert.equal(error.line, line, source);
    assert.equal(error.message, `Line ${line}: ${message}`);
  }
  assert.match(
    parseError("stateDiagram-v2\n  %% level design\n  A --> B").message,
    /belong to the conceptual level/,
  );
  // Valid Mermaid that the renderer leaves to Mermaid.
  const looped = parseError("stateDiagram-v2\n  state c <<choice>>\n  c --> c");
  assert.equal(looped.unsupported, true);
  assert.equal(looped.line, 3);
});

test("adds states, composites, regions, notes and bars in the indentation of the source", () => {
  // A plain state that is added to becomes a composite state.
  const opened = addStatePiece(STARTER, { kind: "state", label: "Typing", parent: "Draft" });
  assert.equal(
    opened.source,
    STARTER.replace("Draft\n", "Draft\n  state Draft {\n    Typing\n  }\n"),
  );
  assert.equal(parentOf(opened.source, "Typing"), "Draft");
  const region = addStatePiece(REGIONS, { kind: "region", parent: "Active#region1" });
  assert.equal(region.id, "Active#region3");
  assert.equal(parentOf(region.source, "state1"), "Active#region3");
  const note = addStatePiece(NESTED, { kind: "note", parent: "Edit" });
  assert.ok(
    note.source.includes("    }\n    note right of Edit : Note\n    state pick <<choice>>"),
  );
  // A conceptual diagram has no bars, a plain state no region.
  const conceptual = STARTER.replace("\n", "\n  %% level conceptual\n");
  assert.deepEqual(addStatePiece(conceptual, { kind: "fork" }), { source: conceptual, id: "" });
  assert.deepEqual(addStatePiece(STARTER, { kind: "region", parent: "Draft" }), {
    source: STARTER,
    id: "",
  });
});

test("connects states in their scope, once, and says which transition it wrote", () => {
  const inner = connectState(NESTED, "Unsaved", "Edit#final1", "give up");
  assert.deepEqual(changed(NESTED, inner.source), {
    lost: [],
    added: ["        Unsaved --> [*] : give up"],
  });
  assert.equal(inner.edge, "t5");
  assert.equal(transitions(inner.source)[4], "Unsaved>Edit#final2:give up");
  // A state named first after its composite: the composite opens once more.
  assert.ok(
    connectStates(NESTED, "Edit#initial", "Done").endsWith(
      "\n    state Edit {\n        [*] --> Done\n    }\n    class Done bold",
    ),
  );
  assert.deepEqual(connectState(STARTER, "root#initial", "Draft"), { source: STARTER, edge: "t1" });
  assert.deepEqual(connectState(STARTER, "root#final1", "Draft"), { source: STARTER, edge: "" });
});

test("attaches a piece to a part in as few lines as the syntax has", () => {
  assert.deepEqual(attachState(STARTER, { kind: "state", label: "In review" }, "Draft"), {
    id: "InReview",
    edge: "t6",
    source: `${STARTER}\n  state "In review" as InReview\n  Draft --> InReview`,
  });
  const region = attachState(REGIONS, { kind: "state", label: "NumLock" }, "NumOn");
  assert.ok(region.source.includes("    NumOff --> NumOn : press\n    NumOn --> NumLock\n    --"));
  assert.equal(parentOf(region.source, "NumLock"), "Active#region1");
});

test("says why an edit is refused", () => {
  assert.match(whyNotState(STARTER, { connect: ["root#final1", "Draft"] }) ?? "", /final state/);
  assert.match(whyNotState(STARTER, { add: "region", at: "Draft" }) ?? "", /composite state/);
  assert.match(whyNotState(STARTER, { add: "note" }) ?? "", /select a state/);
  assert.equal(whyNotState(STARTER, { connect: ["Draft", "Approved"] }), undefined);
});

test("renames states, notes and transitions so they read back as typed", () => {
  const odd = renameState(NESTED, "Inner", 'A "big" <b>one</b> & #35; x < y\nmore: [1] {2}');
  assert.equal(
    parseStateDiagram(odd).states.get("Inner")?.label,
    'A "big" <b>one</b> & #35; x < y<br>more: [1] {2}',
  );
  assert.equal(parentOf(odd, "Inner"), "Check");
  // A note block becomes one line.
  assert.deepEqual(changed(NESTED, renameState(NESTED, "note2", "done\nnow")), {
    lost: ["    note left of Done", "        all", "        over", "    end note"],
    added: ["    note left of Done : done<br>now"],
  });
  const label = labelTransition(NESTED, "t6", '"quoted"\nif n < 0 --> y');
  assert.deepEqual(changed(NESTED, label).lost, ["    Idle --> Edit: open"]);
  assert.equal(parseStateDiagram(label).transitions[5]?.label, '"quoted"<br>if n < 0 --> y');
});

test("removes transitions, states, pseudo-states, composites and regions", () => {
  // A state named only on removed lines stays, in its composite.
  assert.equal(
    removeStates(STARTER, ["Submitted"]),
    `stateDiagram-v2\n  [*] --> Draft\n  Approved --> [*]`,
  );
  const inner = removeStates(NESTED, ["Edit#final1", "Check#initial", "note2"]);
  assert.deepEqual(changed(NESTED, inner), {
    lost: [
      "            [*] --> Inner",
      "        Saved --> [*]",
      "    note left of Done",
      "        all",
      "        over",
      "    end note",
    ],
    added: ["            Inner"],
  });
  assert.equal(parentOf(inner, "Inner"), "Check");
  assert.equal(
    removeStates(REGIONS, ["Active#region1"]),
    `stateDiagram-v2\n  [*] --> Active\n  state Active {\n    [*] --> CapsOff\n    CapsOff --> CapsOn : press\n    CapsOn --> [*]\n  }\n  Active --> [*]`,
  );
});

test("retitles a generated id after its first name, and only a generated one", () => {
  const joined = `${STARTER}\n  state "State" as state1\n  Draft --> state1\n  style state1 fill:#eee`;
  assert.equal(isGeneratedStateId(joined, "state1"), true);
  assert.equal(isGeneratedStateId(joined, "Draft"), false);
  assert.deepEqual(retitleState(joined, "state1", "Paid in full"), {
    id: "PaidInFull",
    source: `${STARTER}\n  state "Paid in full" as PaidInFull\n  Draft --> PaidInFull\n  style PaidInFull fill:#eee`,
  });
  assert.equal(retitleState(joined, "state1", "Größe: über 9").id, "GrosseUber9");
  assert.equal(retitleState(joined, "state1", "Draft").id, "state1");
  assert.equal(retitleState(STARTER, "Draft", "Sketch").id, "Draft");
});

test("renames an id at every mention where it stands as one", () => {
  assert.equal(
    renameStateId(
      `stateDiagram-v2\n  A:::hot --> AB : A\n  A : entry / A\n  note right of A : A is A\n  class A bold`,
      "A",
      "C",
    ),
    `stateDiagram-v2\n  C:::hot --> AB : A\n  C : entry / A\n  note right of C : A is A\n  class C bold`,
  );
  assert.equal(parentOf(renameStateId(REGIONS, "Active", "On"), "CapsOn"), "On#region2");
  assert.equal(renameStateId(NESTED, "Done", "Idle"), NESTED);
});

test("reads and writes descriptions, and puts a note on the other side", () => {
  const described = `stateDiagram-v2\n  state "Waiting" as W\n  W : entry / start\n  W --> X\n  W : exit / stop`;
  assert.equal(stateDescription(described, "W"), "entry / start\nexit / stop");
  const written = setStateDescription(described, "W", 'do / "wait"\n\n  a: b ');
  assert.equal(
    written,
    `stateDiagram-v2\n  state "Waiting" as W\n  W : do / "wait"\n  W : a: b\n  W --> X`,
  );
  assert.deepEqual(parseStateDiagram(written).states.get("W")?.descriptions, [
    'do / "wait"',
    "a: b",
  ]);
  const block = setNoteSide(NESTED, "note2", "right");
  assert.deepEqual(changed(NESTED, block), {
    lost: ["    note left of Done"],
    added: ["    note right of Done"],
  });
});

test("duplicates a composite with what it holds, under new ids", () => {
  const edit = duplicateState(NESTED, "Edit");
  assert.equal(edit.id, "Edit2");
  assert.deepEqual(changed(NESTED, edit.source).added, [
    '    state "Edit Mode" as Edit2 {',
    "        [*] --> Unsaved2",
    "        Unsaved2 --> Saved2 : apply",
    "        state Check2 {",
    "            [*] --> Inner2",
    "        Saved2 --> [*]",
  ]);
  assert.equal(parentOf(edit.source, "Inner2"), "Check2");
});

test("moves a state into a composite and out, with its declaration", () => {
  const declared = `stateDiagram-v2\n  state "Waiting" as W\n  W : entry / start\n  state Box {\n    A --> B\n  }\n  W --> A`;
  assert.equal(
    moveStateInto(declared, "W", "Box"),
    `stateDiagram-v2\n  state Box {\n    A --> B\n    state "Waiting" as W\n    W : entry / start\n  }\n  W --> A`,
  );
  // A composite added last moves up before the line that names the state.
  const review = moveStateInto(`${STARTER}\n  state Review {\n  }`, "Submitted", "Review");
  assert.ok(
    review.startsWith(
      "stateDiagram-v2\n  [*] --> Draft\n  state Review {\n    Submitted\n  }\n  Draft --> Submitted",
    ),
  );
  assert.equal(parentOf(review, "Submitted"), "Review");
  const out = moveStateInto(NESTED, "Inner", null);
  assert.deepEqual(changed(NESTED, out), { lost: [], added: ["    Inner"] });
  assert.equal(moveStateInto(NESTED, "Edit", "Check"), NESTED);
});

test("ungroups a composite and reverses transitions", () => {
  assert.equal(
    ungroupComposite(REGIONS, "Active"),
    `stateDiagram-v2\n  [*] --> NumOff\n  NumOff --> NumOn : press\n  [*] --> CapsOff\n  CapsOff --> CapsOn : press\n  CapsOn --> [*]`,
  );
  // An initial state becomes a final one; styles and labels stay with their ends.
  assert.equal(transitions(reverseTransition(STARTER, "t1"))[0], "Draft>root#final1");
  assert.equal(
    reverseTransition("stateDiagram-v2\n  A:::hot-->B:::cold:go", "t1"),
    "stateDiagram-v2\n  B:::cold-->A:::hot:go",
  );
});

test("reads parts and joins as a structure, parents before what they hold", () => {
  const { nodes, edges } = stateStructure.read(NESTED);
  assert.deepEqual(
    nodes.map((node) => `${node.id}:${node.kind}:${node.parent}:${node.line}:${node.label}`),
    [
      "Edit:composite:null:6:Edit Mode",
      "Edit#initial:start:Edit:7:Start",
      "Unsaved:state:Edit:7:Unsaved",
      "Saved:state:Edit:8:Saved",
      "Check:composite:Edit:10:Check",
      "Check#initial:start:Check:11:Start",
      "Inner:state:Check:11:Inner",
      "Edit#final1:end:Edit:13:End",
      "pick:choice:null:15:Choice",
      "root#initial:start:null:16:Start",
      "Idle:state:null:16:Idle",
      "Done:state:null:22:Done",
      "root#final2:end:null:23:End",
      "note1:note:null:24:waits",
      "note2:note:null:25:all<br>over",
    ],
  );
  assert.deepEqual(edges[5], {
    id: "t6",
    source: "Idle",
    target: "Edit",
    label: "open",
    line: 17,
    kind: "transition",
  });
});
