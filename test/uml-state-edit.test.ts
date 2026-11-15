import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseUml } from "../src/index.ts";
import { STATE_EXAMPLES } from "../src/samples/uml-examples.ts";
import { parseStateDiagram } from "../src/uml-state.ts";
import {
  addStatePiece,
  connectStates,
  labelTransition,
  removeStates,
  renameState,
  stateStructure,
} from "../src/uml-state-edit.ts";

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

/** The ids of the shapes and the wires of the scene a source is laid out as. */
async function sceneIds(source: string) {
  const scene = await parseUml(source).layout(arialMeasure);
  return {
    shapes: new Set(scene.shapes.map((shape) => shape.id)),
    wires: new Set(scene.wires.map((wire) => wire.edge)),
  };
}

describe("editing a state diagram as text", () => {
  it("adds states, composite states, choices and bars", () => {
    const state = addStatePiece(STARTER, { kind: "state" });
    expect(state.id).toBe("state1");
    expect(state.source).toBe(`${STARTER}\n  state "State" as state1`);
    // A name that can be an id is the id; any other name gets an id beside it.
    const named = addStatePiece(STARTER, { kind: "state", label: "Paid" });
    expect(named).toEqual({ id: "Paid", source: `${STARTER}\n  Paid` });
    const spaced = addStatePiece(STARTER, { kind: "state", label: "Paid in full" });
    expect(spaced.source.endsWith('\n  state "Paid in full" as state1')).toBe(true);
    expect(addStatePiece(STARTER, { kind: "state", label: "Draft" }).id).toBe("state1");
    expect(addStatePiece(STARTER, { kind: "state", label: "note" }).source).toContain(
      "\n  state note",
    );
    const composite = addStatePiece(STARTER, { kind: "composite", label: "Review" });
    expect(composite.source.endsWith("\n  state Review {\n  }")).toBe(true);
    expect(addStatePiece(STARTER, { kind: "composite" }).source).toContain(
      'state "Composite" as composite1 {',
    );
    for (const kind of ["choice", "fork", "join"] as const) {
      const bar = addStatePiece(STARTER, { kind });
      expect(bar.id).toBe(`${kind}1`);
      expect(bar.source.endsWith(`\n  state ${kind}1 <<${kind}>>`)).toBe(true);
      expect(parseStateDiagram(bar.source).states.get(bar.id)!.kind).toBe(kind);
    }
    // A conceptual diagram has no bars: nothing is added.
    const conceptual = STARTER.replace("\n", "\n  %% level conceptual\n");
    expect(addStatePiece(conceptual, { kind: "fork" })).toEqual({ source: conceptual, id: "" });
  });

  it("adds inside composite states and regions, in the indentation of the source", () => {
    const inside = addStatePiece(NESTED, { kind: "state", label: "Dirty", parent: "Edit" });
    expect(parentOf(inside.source, "Dirty")).toBe("Edit");
    expect(changed(NESTED, inside.source)).toEqual({ lost: [], added: ["        Dirty"] });
    const deep = addStatePiece(NESTED, { kind: "choice", parent: "Check" });
    expect(parentOf(deep.source, "choice1")).toBe("Check");
    expect(deep.source).toContain(
      "            [*] --> Inner\n            state choice1 <<choice>>\n        }",
    );
    // A composite state in regions takes it in its last region, a region in itself.
    const last = addStatePiece(REGIONS, { kind: "state", label: "Scroll", parent: "Active" });
    expect(parentOf(last.source, "Scroll")).toBe("Active#region2");
    const first = addStatePiece(REGIONS, {
      kind: "state",
      label: "Scroll",
      parent: "Active#region1",
    });
    expect(parentOf(first.source, "Scroll")).toBe("Active#region1");
    expect(first.source).toContain("    NumOff --> NumOn : press\n    Scroll\n    --");
    // A plain state that is added to becomes a composite state.
    const opened = addStatePiece(STARTER, { kind: "state", label: "Typing", parent: "Draft" });
    expect(opened.source).toContain("  [*] --> Draft\n  state Draft {\n    Typing\n  }\n");
    expect(parentOf(opened.source, "Typing")).toBe("Draft");
    const aliased = addStatePiece(NESTED.replace("state Check {", 'state "C" as Check {'), {
      kind: "state",
      parent: "Inner",
    });
    expect(parentOf(aliased.source, "state1")).toBe("Inner");
    const declared = addStatePiece(`stateDiagram-v2\n\tstate "A b" as a\n\ta --> c`, {
      kind: "composite",
      label: "In",
      parent: "a",
    });
    expect(declared.source).toBe(
      `stateDiagram-v2\n\tstate "A b" as a {\n\t\tstate In {\n\t\t}\n\t}\n\ta --> c`,
    );
  });

  it("adds notes and regions", () => {
    const note = addStatePiece(STARTER, { kind: "note", label: "Look\nhere", parent: "Draft" });
    expect(note.id).toBe("note1");
    expect(note.source.endsWith("\n  note right of Draft : Look<br>here")).toBe(true);
    expect(parseStateDiagram(note.source).notes[0]).toMatchObject({
      target: "Draft",
      text: "Look<br>here",
    });
    // Without a part to stand beside it takes the last state.
    expect(addStatePiece(NESTED, { kind: "note" })).toMatchObject({ id: "note3" });
    expect(addStatePiece(NESTED, { kind: "note" }).source).toContain("note right of Done : Note");
    expect(addStatePiece("stateDiagram-v2", { kind: "note" })).toEqual({
      source: "stateDiagram-v2",
      id: "",
    });
    const region = addStatePiece(REGIONS, { kind: "region", parent: "CapsOn" });
    expect(region.id).toBe("Active#region3");
    expect(region.source).toContain('    CapsOn --> [*]\n    --\n    state "State" as state1\n  }');
    expect(parentOf(region.source, "state1")).toBe("Active#region3");
    const split = addStatePiece(NESTED, { kind: "region", parent: "Check" });
    expect(split.id).toBe("Check#region2");
    expect(parentOf(split.source, "Inner")).toBe("Check#region1");
    const made = addStatePiece(STARTER, { kind: "region" });
    expect(made.id).toBe("composite1#region2");
    expect(parseStateDiagram(made.source).states.get("composite1")!.children).toEqual([
      "composite1#region1",
      "composite1#region2",
    ]);
  });

  it("names the initial and final state a start or an end becomes when connected", () => {
    const start = addStatePiece(NESTED, { kind: "start", parent: "Check" });
    expect(start).toEqual({ source: NESTED, id: "Check#initial" });
    expect(addStatePiece("stateDiagram-v2\n  A", { kind: "start" }).id).toBe("root#initial");
    expect(addStatePiece(REGIONS, { kind: "start", parent: "Active" }).id).toBe(
      "Active#region2#initial",
    );
    expect(addStatePiece(REGIONS, { kind: "start", parent: "NumOn" }).id).toBe("Active#initial");
    // The final states are numbered through the source: one in `Check` comes before two others.
    const end = addStatePiece(NESTED, { kind: "end", parent: "Check" });
    expect(end).toEqual({ source: NESTED, id: "Check#final1" });
    const joined = connectStates(NESTED, "Inner", end.id);
    expect(joined).toContain("            [*] --> Inner\n            Inner --> [*]\n        }");
    expect(transitions(joined)).toContain("Inner>Check#final1");
    const root = addStatePiece(STARTER, { kind: "end" });
    expect(root.id).toBe("root#final2");
    expect(transitions(connectStates(STARTER, "Draft", root.id))).toContain("Draft>root#final2");
  });

  it("connects states, with and without a label", () => {
    const plain = connectStates(STARTER, "Approved", "Draft");
    expect(plain).toBe(`${STARTER}\n  Approved --> Draft`);
    expect(connectStates(STARTER, "Draft", "Draft", "edit")).toBe(
      `${STARTER}\n  Draft --> Draft : edit`,
    );
    // Two states of one composite state are joined inside it, others at the end.
    const inner = connectStates(NESTED, "Saved", "Unsaved", "change");
    expect(changed(NESTED, inner)).toEqual({
      lost: [],
      added: ["        Saved --> Unsaved : change"],
    });
    expect(inner).toContain("        Saved --> [*]\n        Saved --> Unsaved : change\n    }");
    const across = connectStates(NESTED, "Inner", "Done");
    expect(across.endsWith("\n    class Done bold\n    Inner --> Done")).toBe(true);
    expect(parentOf(across, "Inner")).toBe("Check");
    expect(parentOf(across, "Done")).toBeNull();
    expect(connectStates(STARTER, "Draft", "Nowhere")).toBe(STARTER);
    // A choice is left at once: no transition to itself.
    expect(connectStates(NESTED, "pick", "pick")).toBe(NESTED);
  });

  it("connects from initial and to final states in their composite state", () => {
    expect(transitions(connectStates(STARTER, "root#initial", "Approved"))).toContain(
      "root#initial>Approved",
    );
    expect(connectStates(STARTER, "Submitted", "root#final1")).toBe(
      `${STARTER}\n  Submitted --> [*]`,
    );
    const start = connectStates(NESTED, "Edit#initial", "Saved");
    expect(changed(NESTED, start)).toEqual({ lost: [], added: ["        [*] --> Saved"] });
    expect(transitions(start)).toContain("Edit#initial>Saved");
    const end = connectStates(NESTED, "Unsaved", "Edit#final1", "give up");
    expect(transitions(end)).toContain("Unsaved>Edit#final2:give up");
    expect(parentOf(end, "Edit#final2")).toBe("Edit");
    // Each region has its own.
    const caps = connectStates(REGIONS, "Active#region2#initial", "CapsOn");
    expect(caps).toContain("    CapsOn --> [*]\n    [*] --> CapsOn\n  }");
    const num = connectStates(REGIONS, "Active#initial", "NumOn");
    expect(num).toContain("    NumOff --> NumOn : press\n    [*] --> NumOn\n    --");
    expect(transitions(num)).toContain("Active#initial>NumOn");
    // A state named first after the composite state stays outside it: the composite opens once more.
    const late = connectStates(NESTED, "Edit#initial", "Done");
    expect(late.endsWith("\n    state Edit {\n        [*] --> Done\n    }")).toBe(true);
    expect(transitions(late)).toContain("Edit#initial>Done");
    expect(parentOf(late, "Done")).toBeNull();
    // What the syntax cannot say.
    expect(connectStates(STARTER, "root#final1", "Draft")).toBe(STARTER);
    expect(connectStates(STARTER, "Draft", "root#initial")).toBe(STARTER);
    expect(connectStates(REGIONS, "Active#region1", "Active")).toBe(REGIONS);
  });

  it("moves a note beside the state it is connected with", () => {
    const moved = connectStates(NESTED, "Edit", "note1");
    expect(changed(NESTED, moved)).toEqual({
      lost: ["    note right of Idle : waits"],
      added: ["    note right of Edit : waits"],
    });
    // Before the line that names the state first the note cannot stay.
    const early = `stateDiagram-v2\n  A --> B\n  note left of A\n    two\n    lines\n  end note\n  state C {\n    D\n  }`;
    const late = connectStates(early, "note1", "D");
    expect(late).toBe(
      `stateDiagram-v2\n  A --> B\n  state C {\n    D\n  }\n  note left of D\n    two\n    lines\n  end note`,
    );
    expect(parentOf(late, "D")).toBe("C");
    expect(connectStates(NESTED, "root#initial", "note1")).toBe(NESTED);
  });

  it('renames states with a `state "Name" as id` line and leaves their id', () => {
    const first = renameState(STARTER, "Draft", "First draft");
    expect(first).toBe(STARTER.replace("  [*]", '  state "First draft" as Draft\n  [*]'));
    expect(transitions(first)).toEqual(transitions(STARTER));
    expect(renameState(first, "Draft", "Sketch")).toBe(
      STARTER.replace("  [*]", '  state "Sketch" as Draft\n  [*]'),
    );
    expect(renameState(NESTED, "Edit", "Editing")).toContain('    state "Editing" as Edit {\n');
    expect(renameState(NESTED, "Check", "Checking")).toContain(
      '        state "Checking" as Check {\n',
    );
    const inner = renameState(NESTED, "Inner", "Inside");
    expect(inner).toContain('            state "Inside" as Inner\n            [*] --> Inner\n');
    expect(parentOf(inner, "Inner")).toBe("Check");
    // Quotes, markup and line breaks are written so that they read back as typed.
    const odd = renameState(STARTER, "Draft", 'A "big" <b>one</b> & #35; x < y\nmore: [1] {2}');
    expect(parseStateDiagram(odd).states.get("Draft")!.label).toBe(
      'A "big" <b>one</b> & #35; x < y<br>more: [1] {2}',
    );
    expect(renameState(STARTER, "Draft", "Draft")).toBe(STARTER);
    expect(renameState(STARTER, "root#initial", "x")).toBe(STARTER);
    expect(renameState(NESTED, "pick", "x")).toBe(NESTED);
    expect(renameState(REGIONS, "Active#region1", "x")).toBe(REGIONS);
  });

  it("renames notes by their text", () => {
    expect(renameState(NESTED, "note1", "waits: long")).toContain(
      "    note right of Idle : waits: long\n",
    );
    const block = renameState(NESTED, "note2", "done\nnow");
    expect(changed(NESTED, block)).toEqual({
      lost: ["    note left of Done", "        all", "        over", "    end note"],
      added: ["    note left of Done : done<br>now"],
    });
    expect(parseStateDiagram(block).notes[1].text).toBe("done<br>now");
  });

  it("labels transitions after the colon", () => {
    expect(labelTransition(STARTER, "t2", "send")).toContain("  Draft --> Submitted : send\n");
    expect(labelTransition(STARTER, "t1", "create")).toContain("  [*] --> Draft : create\n");
    expect(labelTransition(STARTER, "t2", " ")).toContain("  Draft --> Submitted\n");
    // The colon stays as it is written.
    expect(labelTransition(NESTED, "t6", "enter [ok] / log")).toContain(
      "    Idle --> Edit: enter [ok] / log\n",
    );
    const odd = labelTransition(STARTER, "t3", '"quoted" <i>x</i>\nif n < 0 --> y');
    expect(parseStateDiagram(odd).transitions[2].label).toBe('"quoted" <i>x</i><br>if n < 0 --> y');
    expect(changed(STARTER, odd).lost).toEqual(["  Submitted --> Approved : approve"]);
    expect(labelTransition(STARTER, "t9", "x")).toBe(STARTER);
  });

  it("removes transitions and keeps their states where they are", () => {
    // `Submitted` is named again in the same scope, `Approved` only on lines that also go.
    expect(removeStates(STARTER, ["t2"])).toBe(
      STARTER.replace("  Draft --> Submitted : submit\n", ""),
    );
    expect(removeStates(STARTER, ["t3", "t5"])).toBe(
      `stateDiagram-v2\n  [*] --> Draft\n  Draft --> Submitted : submit\n  Approved\n  Submitted --> Draft : reject`,
    );
    // A state named first inside a composite state stays inside it.
    const inner = removeStates(NESTED, ["t1", "t2"]);
    expect(changed(NESTED, inner)).toEqual({
      lost: ["        [*] --> Unsaved", "        Unsaved --> Saved : apply"],
      added: ["        Unsaved"],
    });
    expect(parentOf(inner, "Unsaved")).toBe("Edit");
    expect(parentOf(inner, "Saved")).toBe("Edit");
    expect(parseStateDiagram(inner).states.has("Edit#initial")).toBe(false);
  });

  it("removes states with their transitions, descriptions, notes and styles", () => {
    const without = removeStates(STARTER, ["Submitted"]);
    expect(without).toBe(`stateDiagram-v2\n  [*] --> Draft\n  Approved --> [*]`);
    const done = removeStates(NESTED, ["Done"]);
    expect(changed(NESTED, done)).toEqual({
      lost: [
        "    pick --> Done",
        "    Done --> [*]",
        "    note left of Done",
        "        all",
        "        over",
        "    end note",
        "    class Done bold",
      ],
      added: [],
    });
    expect(done).toContain("    %% where it ends\n");
    const described = `stateDiagram-v2\n  state "Waiting" as W\n  W : entry / start\n  W --> X\n  X : stays`;
    expect(removeStates(described, ["W"])).toBe(`stateDiagram-v2\n  X : stays`);
    expect(removeStates(NESTED, ["note2", "t4"])).not.toContain("over");
    expect(removeStates(NESTED, ["nothing"])).toBe(NESTED);
  });

  it("removes initial and final states with the transitions that write them", () => {
    expect(removeStates(STARTER, ["root#initial"])).toBe(STARTER.replace("  [*] --> Draft\n", ""));
    expect(removeStates(STARTER, ["root#final1"])).toBe(
      STARTER.replace("\n  Approved --> [*]", ""),
    );
    const inner = removeStates(NESTED, ["Edit#final1", "Check#initial"]);
    expect(changed(NESTED, inner)).toEqual({
      lost: ["            [*] --> Inner", "        Saved --> [*]"],
      added: ["            Inner"],
    });
    expect(parentOf(inner, "Inner")).toBe("Check");
    expect(transitions(removeStates(REGIONS, ["Active#region2#initial"]))).toEqual([
      "root#initial>Active",
      "Active#initial>NumOff",
      "NumOff>NumOn:press",
      "CapsOff>CapsOn:press",
      "CapsOn>Active#region2#final1",
      "Active>root#final2",
    ]);
  });

  it("removes composite states and regions with what they hold", () => {
    const without = removeStates(NESTED, ["Edit"]);
    const { states } = parseStateDiagram(without);
    for (const id of ["Edit", "Unsaved", "Saved", "Check", "Inner", "Edit#initial"])
      expect(states.has(id), id).toBe(false);
    expect(transitions(without)).toEqual([
      "root#initial>Idle",
      "pick>Idle:again",
      "pick>Done",
      "Done>root#final1",
    ]);
    expect(without).toContain(
      "    %% the outer machine\n    state pick <<choice>>\n    [*] --> Idle\n\n    %% where it ends\n",
    );
    const check = removeStates(NESTED, ["Check"]);
    expect(changed(NESTED, check)).toEqual({
      lost: ["        state Check {", "            [*] --> Inner", "        }"],
      added: [],
    });
    // A region goes with one separator; the composite state stays.
    expect(removeStates(REGIONS, ["Active#region2"])).toBe(
      `stateDiagram-v2\n  [*] --> Active\n  state Active {\n    [*] --> NumOff\n    NumOff --> NumOn : press\n  }\n  Active --> [*]`,
    );
    expect(removeStates(REGIONS, ["Active#region1"])).toBe(
      `stateDiagram-v2\n  [*] --> Active\n  state Active {\n    [*] --> CapsOff\n    CapsOff --> CapsOn : press\n    CapsOn --> [*]\n  }\n  Active --> [*]`,
    );
    expect(removeStates(REGIONS, ["Active"])).toBe("stateDiagram-v2");
  });
});

describe("a state diagram as a structure", () => {
  it("reads parts and joins, parents before what they hold", () => {
    const { nodes, edges } = stateStructure.read(NESTED);
    expect(nodes.map((node) => `${node.id}:${node.kind}:${node.parent}:${node.line}`)).toEqual([
      "Edit:composite:null:6",
      "Edit#initial:start:Edit:7",
      "Unsaved:state:Edit:7",
      "Saved:state:Edit:8",
      "Check:composite:Edit:10",
      "Check#initial:start:Check:11",
      "Inner:state:Check:11",
      "Edit#final1:end:Edit:13",
      "pick:choice:null:15",
      "root#initial:start:null:16",
      "Idle:state:null:16",
      "Done:state:null:22",
      "root#final2:end:null:23",
      "note1:note:null:24",
      "note2:note:null:25",
    ]);
    expect(nodes.filter((node) => node.group).map((node) => node.id)).toEqual(["Edit", "Check"]);
    expect(nodes.find((node) => node.id === "Edit")!.label).toBe("Edit Mode");
    expect(nodes.find((node) => node.id === "note2")!.label).toBe("all<br>over");
    expect(edges[5]).toEqual({
      id: "t6",
      source: "Idle",
      target: "Edit",
      label: "open",
      line: 17,
      kind: "transition",
    });
    expect(
      stateStructure
        .read(REGIONS)
        .nodes.map((node) => `${node.id}:${node.kind}:${node.parent}:${node.group}`),
    ).toEqual([
      "root#initial:start:null:false",
      "Active:composite:null:true",
      "Active#region1:region:Active:true",
      "Active#initial:start:Active#region1:false",
      "NumOff:state:Active#region1:false",
      "NumOn:state:Active#region1:false",
      "Active#region2:region:Active:true",
      "Active#region2#initial:start:Active#region2:false",
      "CapsOff:state:Active#region2:false",
      "CapsOn:state:Active#region2:false",
      "Active#region2#final1:end:Active#region2:false",
      "root#final2:end:null:false",
    ]);
    const kinds = new Set(stateStructure.pieces.map((piece) => piece.kind));
    for (const source of [NESTED, REGIONS, ...STATE_EXAMPLES.map(([, text]) => text)])
      for (const node of stateStructure.read(source).nodes)
        expect(kinds.has(node.kind), node.kind).toBe(true);
  });

  it("names every part as its shape in the scene and every join as its wire", async () => {
    for (const source of [STARTER, NESTED, REGIONS]) {
      const { nodes, edges } = stateStructure.read(source),
        { shapes, wires } = await sceneIds(source);
      for (const node of nodes) expect(shapes.has(node.id), node.id).toBe(true);
      for (const edge of edges) expect(wires.has(edge.id), edge.id).toBe(true);
    }
    // The starter has no shape and no wire beyond its parts and joins.
    const { nodes, edges } = stateStructure.read(STARTER),
      { shapes, wires } = await sceneIds(STARTER);
    expect(nodes.map((node) => node.id).toSorted()).toEqual([...shapes].toSorted());
    expect(edges.map((edge) => edge.id).toSorted()).toEqual([...wires].toSorted());
  });

  it("gives what it adds the id of its shape", async () => {
    const added: { source: string; id: string }[] = [
      stateStructure.add(NESTED, { kind: "state", label: "Paid in full", parent: "Check" }),
      stateStructure.add(NESTED, { kind: "composite", label: "Review" }),
      stateStructure.add(NESTED, { kind: "choice", parent: "Edit" }),
      stateStructure.add(NESTED, { kind: "note", label: "Why", parent: "Saved" }),
      stateStructure.add(REGIONS, { kind: "region", parent: "Active" }),
      stateStructure.add(REGIONS, { kind: "join", parent: "Active#region1" }),
    ];
    // A start and an end are shapes once they are joined to a state.
    const start = stateStructure.add(REGIONS, { kind: "start", parent: "Active#region2" }),
      end = stateStructure.add(REGIONS, { kind: "end", parent: "Active#region1" }),
      first = stateStructure.add("stateDiagram-v2\n  A --> B", { kind: "start" });
    expect(end.id).toBe("Active#final1");
    added.push(
      { id: start.id, source: stateStructure.connect(REGIONS, start.id, "CapsOn") },
      { id: end.id, source: stateStructure.connect(REGIONS, "NumOn", end.id) },
      { id: first.id, source: stateStructure.connect(first.source, first.id, "A") },
    );
    for (const { source, id } of added) {
      expect(
        stateStructure.read(source).nodes.some((node) => node.id === id),
        id,
      ).toBe(true);
      expect((await sceneIds(source)).shapes.has(id), id).toBe(true);
    }
  });

  it("edits through one interface", () => {
    const joined = stateStructure.connect(STARTER, "Approved", "Draft", "transition");
    expect(stateStructure.read(joined).edges.at(-1)).toMatchObject({
      id: "t6",
      source: "Approved",
      target: "Draft",
      kind: "transition",
    });
    expect(stateStructure.relink(STARTER, "t2", "transition")).toBe(STARTER);
    expect(stateStructure.label(STARTER, "t5", "archive")).toContain("Approved --> [*] : archive");
    expect(stateStructure.rename(STARTER, "Approved", "Signed off")).toContain(
      'state "Signed off" as Approved',
    );
    expect(stateStructure.remove(STARTER, ["Draft", "t5"])).toBe(
      `stateDiagram-v2\n  Submitted --> Approved : approve`,
    );
    expect(stateStructure.pieces[0].kind).toBe("state");
    expect(stateStructure.links.map((link) => link.kind)).toEqual(["transition"]);
  });

  it("keeps line ends of a source with carriage returns readable", () => {
    const windows = STARTER.replace(/\n/g, "\r\n");
    expect(transitions(removeStates(windows, ["t2"]))).toHaveLength(4);
  });
});

describe("the state diagram examples as structures", () => {
  for (const [name, source] of STATE_EXAMPLES) {
    it(name, async () => {
      const { nodes, edges } = stateStructure.read(source),
        { shapes, wires } = await sceneIds(source);
      for (const node of nodes) expect(shapes.has(node.id), node.id).toBe(true);
      for (const edge of edges) expect(wires.has(edge.id), edge.id).toBe(true);
      const ids = (text: string) =>
        stateStructure
          .read(text)
          .nodes.filter((node) => !["start", "end", "note"].includes(node.kind))
          .map((node) => node.id);
      for (const node of nodes) {
        const without = stateStructure.remove(source, [node.id]);
        expect(() => parseUml(without), node.id).not.toThrow();
        const rest = parseStateDiagram(without);
        // Final states, regions and notes are numbered anew: one fewer of the kind is left.
        if (node.kind === "end" || node.kind === "region" || node.kind === "note") {
          const count = (text: string) =>
            stateStructure.read(text).nodes.filter((item) => item.kind === node.kind).length;
          expect(count(without), node.id).toBe(count(source) - 1);
        } else expect(rest.states.has(node.id), node.id).toBe(false);
        // What it did not hold stays, each in its composite state.
        if (node.kind === "state" || node.kind === "choice") {
          expect(ids(without).length, node.id).toBe(ids(source).length - 1);
          for (const other of nodes)
            if (other.id !== node.id && (other.kind === "state" || other.kind === "composite"))
              expect(rest.states.get(other.id)?.parent, other.id).toBe(other.parent);
        }
      }
      for (const edge of edges) {
        const without = stateStructure.remove(source, [edge.id]);
        expect(parseStateDiagram(without).transitions).toHaveLength(edges.length - 1);
        // Every part stays, in its composite state.
        expect(ids(without).toSorted(), edge.id).toEqual(ids(source).toSorted());
        for (const node of stateStructure.read(without).nodes)
          if (node.kind === "state" || node.kind === "composite")
            expect(node.parent, node.id).toBe(nodes.find((item) => item.id === node.id)!.parent);
        const labelled = stateStructure.label(source, edge.id, "now: [x] / y");
        expect(stateStructure.read(labelled).edges.find((item) => item.id === edge.id)!.label).toBe(
          "now: [x] / y",
        );
      }
      for (const node of nodes.filter(
        (item) => item.kind === "state" || item.kind === "composite",
      )) {
        const renamed = stateStructure.rename(source, node.id, "Other name");
        const read = stateStructure.read(renamed);
        expect(read.nodes.find((item) => item.id === node.id)).toMatchObject({
          label: "Other name",
          parent: node.parent,
        });
        expect(read.edges).toEqual(
          edges.map((edge) => ({ ...edge, line: expect.any(Number) as number })),
        );
        const inside = stateStructure.add(source, { kind: "state", parent: node.id });
        if (inside.id)
          expect(parseStateDiagram(inside.source).states.get(inside.id)!.parent).toMatch(
            new RegExp(`^${node.id}(#region\\d+)?$`),
          );
      }
    });
  }
});
