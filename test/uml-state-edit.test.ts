import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseUml } from "../src/index.ts";
import { STATE_EXAMPLES } from "../src/samples/uml-examples.ts";
import { parseStateDiagram } from "../src/uml-state.ts";
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
    // After the line that names its state first.
    expect(changed(STARTER, note.source)).toEqual({
      lost: [],
      added: ["  note right of Draft : Look<br>here"],
    });
    expect(note.source.split("\n")[2]).toBe("  note right of Draft : Look<br>here");
    expect(parseStateDiagram(note.source).notes[0]).toMatchObject({
      target: "Draft",
      text: "Look<br>here",
    });
    // A second note of a state follows the first, a note of a composite state its block; notes
    // are numbered in the order of the source.
    const second = addStatePiece(NESTED, { kind: "note", parent: "Idle" });
    expect(second.id).toBe("note2");
    expect(second.source).toContain(
      "    note right of Idle : waits\n    note right of Idle : Note\n    note left of Done\n",
    );
    const outer = addStatePiece(NESTED, { kind: "note", parent: "Edit" });
    expect(outer.id).toBe("note1");
    expect(outer.source).toContain(
      "    }\n    note right of Edit : Note\n    state pick <<choice>>",
    );
    expect(addStatePiece(NESTED, { kind: "note", parent: "pick" }).source).toContain(
      "    state pick <<choice>>\n    note right of pick : Note\n",
    );
    // Without a state to stand beside there is no note.
    for (const parent of [undefined, null, "root#initial", "note1", "nothing"])
      expect(addStatePiece(NESTED, { kind: "note", parent })).toEqual({ source: NESTED, id: "" });
    expect(addStatePiece(REGIONS, { kind: "note", parent: "Active#region1" }).id).toBe("");
    const region = addStatePiece(REGIONS, { kind: "region", parent: "Active#region1" });
    expect(region.id).toBe("Active#region3");
    expect(region.source).toContain('    CapsOn --> [*]\n    --\n    state "State" as state1\n  }');
    expect(parentOf(region.source, "state1")).toBe("Active#region3");
    const split = addStatePiece(NESTED, { kind: "region", parent: "Check" });
    expect(split.id).toBe("Check#region2");
    expect(parentOf(split.source, "Inner")).toBe("Check#region1");
    expect(addStatePiece(REGIONS, { kind: "region", parent: "Active" }).id).toBe("Active#region3");
    // A region is a part of a composite state: there is none at a plain state, and none alone.
    for (const parent of [undefined, null, "Draft", "root#initial"])
      expect(addStatePiece(STARTER, { kind: "region", parent })).toEqual({
        source: STARTER,
        id: "",
      });
    expect(addStatePiece(REGIONS, { kind: "region", parent: "CapsOn" }).id).toBe("");
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
    // At the end, before the styling a source closes with.
    expect(across.endsWith("\n    end note\n    Inner --> Done\n    class Done bold")).toBe(true);
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
    expect(
      late.endsWith("\n    state Edit {\n        [*] --> Done\n    }\n    class Done bold"),
    ).toBe(true);
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

describe("naming new states, and what the canvas does with a state", () => {
  it("lets the id of a new state follow its first name", () => {
    const added = addStatePiece(STARTER, { kind: "state", parent: null }),
      joined = connectStates(added.source, "Draft", added.id);
    expect(joined.endsWith('\n  state "State" as state1\n  Draft --> state1')).toBe(true);
    const named = retitleState(joined, added.id, "Paid");
    expect(named).toEqual({ id: "Paid", source: `${STARTER}\n  Paid\n  Draft --> Paid` });
    // A name of several words gives the id its words and stays as the name.
    expect(retitleState(joined, "state1", "Paid in full")).toEqual({
      id: "PaidInFull",
      source: `${STARTER}\n  state "Paid in full" as PaidInFull\n  Draft --> PaidInFull`,
    });
    expect(retitleState(joined, "state1", "Processing order").source).toContain(
      '  state "Processing order" as ProcessingOrder\n  Draft --> ProcessingOrder',
    );
    expect(retitleState(joined, "state1", "Größe: über 9 (neu)").id).toBe("GrosseUber9Neu");
    // A name that gives no id, or one another state has, is written beside the id.
    expect(retitleState(joined, "state1", "?!")).toEqual({
      id: "state1",
      source: `${STARTER}\n  state "?!" as state1\n  Draft --> state1`,
    });
    expect(retitleState(joined, "state1", "9 lives").id).toBe("state1");
    expect(retitleState(`${joined}\n  PaidInFull`, "state1", "Paid in full").id).toBe("state1");
    expect(retitleState(joined, "state1", "Draft").id).toBe("state1");
    expect(retitleState(joined, "state1", "note").id).toBe("state1");
    expect(retitleState(joined, "state1", "end").source).toContain('state "end" as state1');
    // Composite states, with what stands in them and every line that names them.
    const composite = addStatePiece(STARTER, { kind: "composite" }),
      filled = addStatePiece(composite.source, { kind: "state", parent: composite.id }),
      noted = addStatePiece(connectStates(filled.source, "Approved", composite.id), {
        kind: "note",
        parent: composite.id,
      }),
      styled = `${noted.source}\n  class Draft,composite1 bold\n  style composite1 fill:#eee`;
    const review = retitleState(styled, "composite1", "Review");
    expect(review.id).toBe("Review");
    expect(changed(styled, review.source)).toEqual({
      lost: [
        '  state "Composite" as composite1 {',
        "  note right of composite1 : Note",
        "  Approved --> composite1",
        "  class Draft,composite1 bold",
        "  style composite1 fill:#eee",
      ],
      added: [
        "  state Review {",
        "  note right of Review : Note",
        "  Approved --> Review",
        "  class Draft,Review bold",
        "  style Review fill:#eee",
      ],
    });
    expect(parentOf(review.source, "state1")).toBe("Review");
    // Only a generated id follows the name; a state the user named keeps its id.
    expect(retitleState(STARTER, "Draft", "Sketch")).toEqual({
      id: "Draft",
      source: renameState(STARTER, "Draft", "Sketch"),
    });
    // Notes and what has no name go the way of `rename`.
    expect(retitleState(NESTED, "note1", "long")).toEqual({
      id: "note1",
      source: renameState(NESTED, "note1", "long"),
    });
    expect(retitleState(NESTED, "pick", "x")).toEqual({ id: "pick", source: NESTED });
    expect(stateStructure.retitle!(joined, "state1", "Paid").id).toBe("Paid");
  });

  it("lets the first name of a copy become its id", () => {
    const copy = duplicateState(STARTER, "Draft");
    expect(isGeneratedStateId(copy.source, copy.id)).toBe(true);
    expect(isGeneratedStateId(copy.source, "Draft")).toBe(false);
    expect(isGeneratedStateId(copy.source, "nothing")).toBe(false);
    expect(isGeneratedStateId("not a diagram", "Draft")).toBe(false);
    expect(retitleState(copy.source, copy.id, "Sketch")).toEqual({
      id: "Sketch",
      source: `${STARTER}\n  Sketch`,
    });
    expect(retitleState(copy.source, copy.id, "Second draft")).toEqual({
      id: "SecondDraft",
      source: `${STARTER}\n  state "Second draft" as SecondDraft`,
    });
    // A copy of a state with a name carries that name until it gets its own.
    const aliased = duplicateState(renameState(STARTER, "Draft", "First draft"), "Draft");
    expect(aliased.source).toContain('  state "First draft" as Draft2');
    expect(retitleState(aliased.source, aliased.id, "Outline").source).toContain("\n  Outline");
    expect(retitleState(aliased.source, aliased.id, "Outline").source).not.toContain("Draft2");
    // What a copied composite state holds is a copy too.
    const edit = duplicateState(NESTED, "Edit");
    expect(isGeneratedStateId(edit.source, "Unsaved2")).toBe(true);
    expect(retitleState(edit.source, "Edit2", "View Mode").id).toBe("ViewMode");
    // A numbered state that was named apart from its neighbour is no copy.
    const apart =
      'stateDiagram-v2\n  state "One" as Step1\n  state "Two" as Step2\n  Step1 --> Step2';
    expect(isGeneratedStateId(apart, "Step2")).toBe(false);
    expect(retitleState(apart, "Step2", "Second").id).toBe("Step2");
  });

  it("adds a piece joined to a part in as few lines as the syntax has", () => {
    const state = attachState(STARTER, { kind: "state" }, "Approved");
    expect(state).toEqual({
      id: "state1",
      edge: "t6",
      source: `${STARTER}\n  Approved --> state1`,
    });
    // The first name of a state that only its transition names.
    expect(retitleState(state.source, "state1", "Shipped")).toEqual({
      id: "Shipped",
      source: `${STARTER}\n  Approved --> Shipped`,
    });
    expect(retitleState(state.source, "state1", "Processing order")).toEqual({
      id: "ProcessingOrder",
      source: `${STARTER}\n  state "Processing order" as ProcessingOrder\n  Approved --> ProcessingOrder`,
    });
    expect(attachState(STARTER, { kind: "state", label: "Shipped" }, "Approved").source).toBe(
      `${STARTER}\n  Approved --> Shipped`,
    );
    expect(attachState(STARTER, { kind: "state", label: "In review" }, "Draft")).toEqual({
      id: "InReview",
      edge: "t6",
      source: `${STARTER}\n  state "In review" as InReview\n  Draft --> InReview`,
    });
    // A name another state has is written beside a fresh id.
    expect(attachState(STARTER, { kind: "state", label: "Draft" }, "Approved").source).toBe(
      `${STARTER}\n  state "Draft" as state1\n  Approved --> state1`,
    );
    // After the initial state, and in the scope of the part it follows.
    expect(attachState(STARTER, { kind: "state", label: "Idle" }, "root#initial").source).toBe(
      `${STARTER}\n  [*] --> Idle`,
    );
    const inner = attachState(NESTED, { kind: "state", label: "Kept" }, "Saved");
    expect(changed(NESTED, inner.source)).toEqual({ lost: [], added: ["        Saved --> Kept"] });
    expect(parentOf(inner.source, "Kept")).toBe("Edit");
    expect(
      parseStateDiagram(inner.source).transitions.find((item) => item.id === inner.edge),
    ).toMatchObject({ source: "Saved", target: "Kept" });
    const region = attachState(REGIONS, { kind: "state", label: "NumLock" }, "NumOn");
    expect(region.source).toContain("    NumOff --> NumOn : press\n    NumOn --> NumLock\n    --");
    expect(parentOf(region.source, "NumLock")).toBe("Active#region1");
    const beside = attachState(REGIONS, { kind: "state", label: "Off" }, "Active");
    expect(beside.source).toBe(`${REGIONS}\n  Active --> Off`);
    expect(parentOf(beside.source, "Off")).toBeNull();
    const first = attachState(NESTED, { kind: "state", label: "Fresh" }, "Edit#initial");
    expect(first.source).toContain("        Saved --> [*]\n        [*] --> Fresh\n    }");
    // A start and an end are the `[*]` of their transition.
    expect(attachState(STARTER, { kind: "start" }, "Approved")).toEqual({
      id: "root#initial",
      edge: "t6",
      source: `${STARTER}\n  [*] --> Approved`,
    });
    expect(attachState(STARTER, { kind: "end" }, "Draft")).toEqual({
      id: "root#final2",
      edge: "t6",
      source: `${STARTER}\n  Draft --> [*]`,
    });
    expect(attachState(NESTED, { kind: "end" }, "Edit").source).toContain(
      "    end note\n    Edit --> [*]\n    class Done bold",
    );
    // What needs a line that says what it is gets that line, and its transition.
    expect(attachState(STARTER, { kind: "choice" }, "Draft")).toEqual({
      id: "choice1",
      edge: "t6",
      source: `${STARTER}\n  state choice1 <<choice>>\n  Draft --> choice1`,
    });
    const composite = attachState(STARTER, { kind: "composite", label: "Review" }, "Draft");
    expect(composite.source).toBe(`${STARTER}\n  state Review {\n  }\n  Draft --> Review`);
    const note = attachState(STARTER, { kind: "note", label: "hm" }, "Draft");
    expect(note).toMatchObject({ id: "note1", edge: "" });
    expect(note.source).toContain("  [*] --> Draft\n  note right of Draft : hm\n");
    // What cannot be.
    const none = (source: string) => ({ source, id: "", edge: "" });
    expect(attachState(STARTER, { kind: "state" }, "root#final1")).toEqual(none(STARTER));
    expect(attachState(STARTER, { kind: "start" }, "root#final1")).toEqual(none(STARTER));
    expect(attachState(STARTER, { kind: "state" }, "nothing")).toEqual(none(STARTER));
    expect(attachState(REGIONS, { kind: "state" }, "Active#region1")).toEqual(none(REGIONS));
    expect(attachState(STARTER, { kind: "region" }, "Draft")).toEqual(none(STARTER));
  });

  it("says why an edit is refused", () => {
    expect(whyNotState(STARTER, { connect: ["root#final1", "Draft"] })).toMatch(/final state/);
    expect(whyNotState(STARTER, { connect: ["Draft", "root#initial"] })).toMatch(/initial state/);
    expect(whyNotState(REGIONS, { connect: ["Active#region1", "Active"] })).toMatch(/region/);
    expect(whyNotState(STARTER, { connect: ["Draft", "Approved"] })).toBeUndefined();
    expect(whyNotState(NESTED, { connect: ["note1", "Done"] })).toBeUndefined();
    expect(whyNotState(NESTED, { connect: ["note1", "note2"] })).toMatch(/note/);
    expect(whyNotState(STARTER, { add: "region", at: "Draft" })).toMatch(/composite state/);
    expect(whyNotState(REGIONS, { add: "region", at: "Active" })).toBeUndefined();
    expect(whyNotState(REGIONS, { add: "region", at: "Active#region2" })).toBeUndefined();
    expect(whyNotState(STARTER, { add: "note" })).toMatch(/select a state/);
    expect(whyNotState(STARTER, { add: "note", at: "root#initial" })).toMatch(/select a state/);
    expect(whyNotState(STARTER, { add: "note", at: "Draft" })).toBeUndefined();
    expect(whyNotState(STARTER, { add: "start", at: "root#final1" })).toMatch(/start leads/);
    expect(whyNotState(STARTER, { add: "end", at: "root#initial" })).toMatch(/end follows/);
    expect(whyNotState(STARTER, { add: "state", at: "root#final1" })).toMatch(/final state/);
    expect(whyNotState(STARTER, { add: "state", at: "root#initial" })).toBeUndefined();
    expect(
      whyNotState("stateDiagram-v2\n  %% level conceptual\n  A --> B", { add: "fork", at: "A" }),
    ).toMatch(/conceptual/);
    expect(whyNotState("stateDiagram-v2\n  A -->", { add: "state" })).toMatch(/error/);
    // Each refusal is one the edits make.
    expect(connectState(STARTER, "root#final1", "Draft").edge).toBe("");
    expect(addStatePiece(STARTER, { kind: "region", parent: "Draft" }).id).toBe("");
    expect(addStatePiece(STARTER, { kind: "note" }).id).toBe("");
  });

  it("writes a state by its id alone when its name is the id or empty", () => {
    const aliased = renameState(STARTER, "Draft", "First draft");
    expect(renameState(aliased, "Draft", "")).toBe(STARTER.replace("  [*]", "  Draft\n  [*]"));
    expect(renameState(aliased, "Draft", "Draft")).not.toContain('"');
    const cleared = renameState(NESTED, "Edit", "");
    expect(changed(NESTED, cleared)).toEqual({
      lost: ['    state "Edit Mode" as Edit {'],
      added: ["    state Edit {"],
    });
    expect(parseStateDiagram(cleared).states.get("Edit")!.label).toBe("Edit");
  });

  it("renames an id with all its mentions", () => {
    const renamed = renameStateId(NESTED, "Done", "Finished");
    expect(changed(NESTED, renamed)).toEqual({
      lost: [
        "    pick --> Done",
        "    Done --> [*]",
        "    note left of Done",
        "    class Done bold",
      ],
      added: [
        "    pick --> Finished",
        "    Finished --> [*]",
        "    note left of Finished",
        "    class Finished bold",
      ],
    });
    expect(transitions(renamed)).toEqual(
      transitions(NESTED).map((item) => item.replace("Done", "Finished")),
    );
    const described = `stateDiagram-v2\n  W:::hot --> W : again\n  W : entry / start\n  state W\n  W`;
    expect(renameStateId(described, "W", "Waiting")).toBe(
      `stateDiagram-v2\n  Waiting:::hot --> Waiting : again\n  Waiting : entry / start\n  state Waiting\n  Waiting`,
    );
    // An id only where it stands as one: not inside another id, a label or a note.
    const alike = `stateDiagram-v2\n  A --> AB : A\n  note right of A : A is A`;
    expect(renameStateId(alike, "A", "C")).toBe(
      `stateDiagram-v2\n  C --> AB : A\n  note right of C : A is A`,
    );
    for (const id of ["Idle", "two words", "a-b", "[*]", "x:y", "note3", "class", "end", "", "a#b"])
      expect(renameStateId(NESTED, "Done", id), id).toBe(NESTED);
    expect(renameStateId(NESTED, "root#initial", "Begin")).toBe(NESTED);
    expect(renameStateId(NESTED, "nothing", "Begin")).toBe(NESTED);
    expect(renameStateId(REGIONS, "Active#region1", "Begin")).toBe(REGIONS);
    // A composite state keeps what it holds, its regions under their new ids.
    const active = renameStateId(REGIONS, "Active", "On");
    expect(parentOf(active, "CapsOn")).toBe("On#region2");
  });

  it("does not write a transition that is there already", () => {
    expect(connectState(STARTER, "root#initial", "Draft")).toEqual({ source: STARTER, edge: "t1" });
    expect(connectState(STARTER, "Draft", "Submitted", "submit")).toEqual({
      source: STARTER,
      edge: "t2",
    });
    expect(connectState(STARTER, "Approved", "root#final1")).toEqual({
      source: STARTER,
      edge: "t5",
    });
    // Another label, another direction or another scope is another transition.
    expect(connectState(STARTER, "Draft", "Submitted").edge).toBe("t6");
    expect(connectState(STARTER, "Draft", "Submitted", "resubmit").edge).toBe("t6");
    expect(connectState(STARTER, "Submitted", "root#final1").edge).toBe("t6");
    expect(connectState(NESTED, "Saved", "Edit#final1")).toEqual({ source: NESTED, edge: "t4" });
    expect(connectState(NESTED, "Edit#initial", "Unsaved").edge).toBe("t1");
    expect(stateStructure.connect(STARTER, "root#initial", "Draft")).toBe(STARTER);
  });

  it("returns the transition it wrote, wherever it stands", () => {
    // In the middle of the source: the transitions after it are numbered anew.
    const inner = connectState(NESTED, "Unsaved", "Edit#final1");
    expect(inner.edge).toBe("t5");
    expect(stateStructure.read(inner.source).edges.find((edge) => edge.id === "t5")).toMatchObject({
      source: "Unsaved",
      target: "Edit#final2",
      line: 14,
    });
    expect(stateStructure.read(inner.source).edges.at(-1)).toMatchObject({ source: "Done" });
    const caps = connectState(REGIONS, "CapsOff", "CapsOn", "shift");
    expect(caps.edge).toBe("t7");
    expect(transitions(caps.source)[6]).toBe("CapsOff>CapsOn:shift");
    // In a composite state opened once more.
    const late = connectState(NESTED, "Edit#initial", "Done");
    expect(transitions(late.source)[Number(late.edge.slice(1)) - 1]).toBe("Edit#initial>Done");
    // No transition for what moves a note or is refused.
    expect(connectState(NESTED, "Edit", "note1").edge).toBe("");
    expect(connectState(NESTED, "Edit", "note1").source).not.toBe(NESTED);
    expect(connectState(STARTER, "root#final1", "Draft")).toEqual({ source: STARTER, edge: "" });
  });

  it("joins a start or an end to a composite state beside it", () => {
    for (const parent of ["Edit", "Check"]) {
      const end = addStatePiece(NESTED, { kind: "end", parent });
      expect(end.id).toMatch(new RegExp(`^${parent}#final\\d$`));
      const ended = connectState(end.source, parent, end.id),
        made = stateStructure.read(ended.source).edges.find((edge) => edge.id === ended.edge)!;
      expect(made.source).toBe(parent);
      expect(parentOf(ended.source, made.target)).toBe(parentOf(NESTED, parent));
      const start = addStatePiece(NESTED, { kind: "start", parent });
      expect(start.id).toBe(`${parent}#initial`);
      const started = connectState(start.source, start.id, parent);
      expect(transitions(started.source)[Number(started.edge.slice(1)) - 1]).toBe(
        `${parentOf(NESTED, parent) ?? "root"}#initial>${parent}`,
      );
    }
    expect(changed(NESTED, connectStates(NESTED, "Edit", "Edit#final1"))).toEqual({
      lost: [],
      added: ["    Edit --> [*]"],
    });
    expect(changed(NESTED, connectStates(NESTED, "Check#initial", "Check"))).toEqual({
      lost: [],
      added: ["        [*] --> Check"],
    });
    // A composite state in regions: the pseudo-state of any of its regions.
    const regions = addStatePiece(REGIONS, { kind: "start", parent: "Active" });
    expect(regions.id).toBe("Active#region2#initial");
    // `[*] --> Active` is there already.
    expect(connectState(REGIONS, regions.id, "Active")).toEqual({ source: REGIONS, edge: "t1" });
    const twice = connectState(
      REGIONS.replace("\n  Active --> [*]", ""),
      "Active",
      "Active#final9",
    );
    expect(twice.source.endsWith("  }\n  Active --> [*]")).toBe(true);
  });

  it("says which parts a new piece joins", () => {
    const joinsTo = (kind: string) =>
      stateStructure.pieces.find((piece) => piece.kind === kind)!.joinsTo;
    for (const kind of ["state", "choice", "fork", "join", "start", "end", "note"]) {
      expect(joinsTo(kind), kind).toEqual(expect.arrayContaining(["state", "composite", "choice"]));
      expect(joinsTo(kind), kind).not.toContain("note");
      expect(joinsTo(kind), kind).not.toContain("region");
      expect(joinsTo(kind), kind).not.toContain("end");
    }
    expect(joinsTo("state")).toContain("start");
    expect(joinsTo("start")).not.toContain("start");
    // A note changes its state only when it is one end of a connection.
    const added = addStatePiece(NESTED, { kind: "state", parent: null });
    expect(parseStateDiagram(added.source).notes).toEqual(parseStateDiagram(NESTED).notes);
  });

  it("labels the parts that have no name by what they are", () => {
    const labels = (source: string) =>
      Object.fromEntries(stateStructure.read(source).nodes.map((node) => [node.id, node.label]));
    expect(labels(NESTED)).toMatchObject({
      "root#initial": "Start",
      "Edit#initial": "Start",
      "Edit#final1": "End",
      "root#final2": "End",
      pick: "Choice",
      Edit: "Edit Mode",
      Idle: "Idle",
    });
    expect(labels(REGIONS)).toMatchObject({
      "Active#region1": "Region 1",
      "Active#region2": "Region 2",
    });
    const bars = labels("stateDiagram-v2\n  state f <<fork>>\n  state j <<join>>\n  f --> j");
    expect(bars).toEqual({ f: "Fork", j: "Join" });
    for (const source of [NESTED, REGIONS, ...STATE_EXAMPLES.map(([, text]) => text)])
      for (const node of stateStructure.read(source).nodes) {
        expect(node.label, node.id).not.toMatch(/#|^$/);
        if (!["state", "composite", "note"].includes(node.kind))
          expect(stateStructure.rename(source, node.id, "Named")).toBe(source);
      }
  });

  it("puts new statements before the styling a source closes with", () => {
    const styled = `${STARTER}\n\n  %% colours\n  classDef hot fill:#f96\n  class Draft hot\n`;
    const state = addStatePiece(styled, { kind: "state", label: "Paid" });
    expect(state.source).toBe(
      `${STARTER}\n  Paid\n\n  %% colours\n  classDef hot fill:#f96\n  class Draft hot\n`,
    );
    expect(connectStates(styled, "Approved", "Draft")).toContain(
      "  Approved --> [*]\n  Approved --> Draft\n\n  %% colours\n",
    );
    expect(addStatePiece(styled, { kind: "composite", label: "Review" }).source).toContain(
      "  state Review {\n  }\n\n  %% colours\n",
    );
    // Styling in the middle stays where it is, and a source of styling alone takes lines after it.
    const middle = "stateDiagram-v2\n  classDef hot fill:#f96\n  A --> B";
    expect(addStatePiece(middle, { kind: "state", label: "C" }).source).toBe(`${middle}\n  C`);
    const only = "stateDiagram-v2\n  classDef hot fill:#f96";
    expect(addStatePiece(only, { kind: "state", label: "C" }).source).toBe(`${only}\n  C`);
  });

  it("reads and writes the description of a state", () => {
    const described = `stateDiagram-v2\n  state "Waiting" as W\n  W : entry / start\n  W --> X\n  W : exit / stop\n  X : stays`;
    expect(stateDescription(described, "W")).toBe("entry / start\nexit / stop");
    expect(stateDescription(described, "nothing")).toBe("");
    expect(stateDescription(STARTER, "Draft")).toBe("");
    expect(setStateDescription(described, "W", "do / wait\n\n  a: b ")).toBe(
      `stateDiagram-v2\n  state "Waiting" as W\n  W : do / wait\n  W : a: b\n  W --> X\n  X : stays`,
    );
    expect(setStateDescription(described, "W", "")).toBe(
      `stateDiagram-v2\n  state "Waiting" as W\n  W --> X\n  X : stays`,
    );
    // A state without one gets it after the line that names it first.
    const draft = setStateDescription(STARTER, "Draft", "entry / open form");
    expect(changed(STARTER, draft)).toEqual({ lost: [], added: ["  Draft : entry / open form"] });
    expect(draft.split("\n")[2]).toBe("  Draft : entry / open form");
    expect(stateDescription(draft, "Draft")).toBe("entry / open form");
    // The description that names a state first leaves the state where it is.
    const inner = "stateDiagram-v2\n  state A {\n    B : busy\n  }\n  A --> B";
    expect(setStateDescription(inner, "B", "")).toBe(
      "stateDiagram-v2\n  state A {\n    B\n  }\n  A --> B",
    );
    for (const text of ['say "hi" <b>now</b>', "a < b", "x --> y"])
      expect(stateDescription(setStateDescription(STARTER, "Draft", text), "Draft")).toBe(text);
    // Composite states and what is no state have none.
    expect(setStateDescription(NESTED, "Edit", "x")).toBe(NESTED);
    expect(setStateDescription(NESTED, "pick", "x")).toBe(NESTED);
    expect(setStateDescription(NESTED, "root#initial", "x")).toBe(NESTED);
  });

  it("puts a note on the other side", () => {
    expect(changed(NESTED, setNoteSide(NESTED, "note1", "left"))).toEqual({
      lost: ["    note right of Idle : waits"],
      added: ["    note left of Idle : waits"],
    });
    const block = setNoteSide(NESTED, "note2", "right");
    expect(changed(NESTED, block)).toEqual({
      lost: ["    note left of Done"],
      added: ["    note right of Done"],
    });
    expect(parseStateDiagram(block).notes[1]).toMatchObject({ side: "right", text: "all<br>over" });
    expect(setNoteSide(NESTED, "note1", "right")).toBe(NESTED);
    expect(setNoteSide(NESTED, "note9", "left")).toBe(NESTED);
  });

  it("duplicates a state beside it", () => {
    const copy = duplicateState(STARTER, "Draft");
    expect(copy).toEqual({ id: "Draft2", source: `${STARTER}\n  Draft2` });
    expect(duplicateState(copy.source, "Draft").id).toBe("Draft3");
    const described = `stateDiagram-v2\n  state "Waiting" as W1\n  W1 : entry / start\n  W1 --> X`;
    expect(duplicateState(described, "W1")).toEqual({
      id: "W2",
      source: `${described}\n  state "Waiting" as W2\n  W2 : entry / start`,
    });
    const inner = duplicateState(NESTED, "Saved");
    expect(parentOf(inner.source, inner.id)).toBe("Edit");
    expect(changed(NESTED, inner.source)).toEqual({ lost: [], added: ["        Saved2"] });
    expect(duplicateState(NESTED, "pick").source).toContain("    state pick2 <<choice>>\n");
    // A composite state with what it holds, under new ids.
    const edit = duplicateState(NESTED, "Edit");
    expect(edit.id).toBe("Edit2");
    expect(changed(NESTED, edit.source).lost).toEqual([]);
    expect(changed(NESTED, edit.source).added).toEqual([
      '    state "Edit Mode" as Edit2 {',
      "        [*] --> Unsaved2",
      "        Unsaved2 --> Saved2 : apply",
      "        state Check2 {",
      "            [*] --> Inner2",
      "        Saved2 --> [*]",
    ]);
    const read = parseStateDiagram(edit.source);
    expect(read.states.get("Edit2")).toMatchObject({ label: "Edit Mode", parent: null });
    expect(read.states.get("Inner2")!.parent).toBe("Check2");
    expect(read.states.get("Inner")!.parent).toBe("Check");
    expect(read.transitions).toHaveLength(parseStateDiagram(NESTED).transitions.length + 4);
    const active = duplicateState(REGIONS, "Active");
    expect(parentOf(active.source, "CapsOn2")).toBe("Active2#region4");
    for (const id of ["root#initial", "Active#region1", "note1", "nothing"])
      expect(duplicateState(REGIONS, id)).toEqual({ source: REGIONS, id: "" });
  });

  it("moves a state into a composite state and out of it", () => {
    const moved = moveStateInto(NESTED, "Idle", "Check");
    expect(parentOf(moved, "Idle")).toBe("Check");
    expect(transitions(moved).toSorted()).toEqual(transitions(NESTED).toSorted());
    const out = moveStateInto(NESTED, "Inner", null);
    expect(parentOf(out, "Inner")).toBeNull();
    expect(out.split("\n").slice(4, 6)).toEqual(["    %% the outer machine", "    Inner"]);
    expect(changed(NESTED, out)).toEqual({ lost: [], added: ["    Inner"] });
    expect(
      moveStateInto(out, "Inner", "Check")
        .split("\n")
        .filter((line) => line.trim() === "Inner"),
    ).toHaveLength(1);
    // A composite state moves with what it holds.
    const check = moveStateInto(NESTED, "Check", null);
    expect(parentOf(check, "Check")).toBeNull();
    expect(parentOf(check, "Inner")).toBe("Check");
    expect(check).toContain("\n    state Check {\n        [*] --> Inner\n    }\n");
    expect(check.split("\n")).toHaveLength(NESTED.split("\n").length);
    // A state named by its declaration takes the declaration along.
    const declared = `stateDiagram-v2\n  state "Waiting" as W\n  W : entry / start\n  state Box {\n    A --> B\n  }\n  W --> A`;
    expect(moveStateInto(declared, "W", "Box")).toBe(
      `stateDiagram-v2\n  state Box {\n    A --> B\n    state "Waiting" as W\n    W : entry / start\n  }\n  W --> A`,
    );
    // Into a region, and into a plain state, which becomes a composite state.
    const region = moveStateInto(`${REGIONS}\n  Off --> Active`, "Off", "Active#region1");
    expect(parentOf(region, "Off")).toBe("Active#region1");
    expect(parentOf(moveStateInto(`${REGIONS}\n  Off --> Active`, "Off", "Active"), "Off")).toBe(
      "Active#region2",
    );
    const plain = moveStateInto(STARTER, "Approved", "Submitted");
    expect(parentOf(plain, "Approved")).toBe("Submitted");
    // Where it is already, into itself or what it holds, or what holds nothing.
    expect(moveStateInto(NESTED, "Inner", "Check")).toBe(NESTED);
    expect(moveStateInto(NESTED, "Idle", null)).toBe(NESTED);
    expect(moveStateInto(NESTED, "Edit", "Check")).toBe(NESTED);
    expect(moveStateInto(NESTED, "Edit", "Edit")).toBe(NESTED);
    expect(moveStateInto(NESTED, "Idle", "pick")).toBe(NESTED);
    expect(moveStateInto(NESTED, "root#initial", "Edit")).toBe(NESTED);
    expect(moveStateInto(NESTED, "note1", "Edit")).toBe(NESTED);
  });

  it("moves a state into the block its composite state has", () => {
    const blocks = (source: string, id: string) =>
      source.split("\n").filter((line) => line.trim().startsWith(`state ${id} {`)).length;
    // A composite state added last: it moves up to stand before the line that names the state.
    const review = `${STARTER}\n  state Review {\n  }`,
      moved = moveStateInto(review, "Submitted", "Review");
    expect(moved).toBe(
      `stateDiagram-v2\n  [*] --> Draft\n  state Review {\n    Submitted\n  }\n  Draft --> Submitted : submit\n  Submitted --> Approved : approve\n  Submitted --> Draft : reject\n  Approved --> [*]`,
    );
    expect(transitions(moved)).toEqual(transitions(review));
    // The next state joins it there, and a part added to the composite state finds one block.
    const second = moveStateInto(moved, "Approved", "Review");
    expect(second).toContain("  state Review {\n    Submitted\n    Approved\n  }\n");
    expect(blocks(second, "Review")).toBe(1);
    const filled = addStatePiece(second, { kind: "state", label: "Checked", parent: "Review" });
    expect(filled.source).toContain("    Approved\n    Checked\n  }\n");
    // Out again: before the composite state, which stays.
    const out = moveStateInto(second, "Submitted", null);
    expect(parentOf(out, "Submitted")).toBeNull();
    expect(out).toContain("  [*] --> Draft\n  state Review {\n    Approved\n  }\n  Draft --> Sub");
    // A state named after the block goes to the end of the block, which stays where it is.
    const early = `stateDiagram-v2\n  state Review {\n    A --> B\n  }\n  [*] --> Idle\n  Idle --> A`;
    expect(moveStateInto(early, "Idle", "Review")).toBe(
      `stateDiagram-v2\n  state Review {\n    A --> B\n    Idle\n  }\n  [*] --> Idle\n  Idle --> A`,
    );
    // Into the last region, and into a region that is named: one block, the `--` where they were.
    const regions = `stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy : go\n  Busy : does things\n  note right of Busy : hm\n  state Active {\n    [*] --> NumOff\n    --\n    [*] --> CapsOff\n  }\n  Busy --> Active`;
    const last = moveStateInto(regions, "Busy", "Active");
    expect(last).toBe(
      `stateDiagram-v2\n  [*] --> Idle\n  state Active {\n    [*] --> NumOff\n    --\n    [*] --> CapsOff\n    Busy : does things\n  }\n  Idle --> Busy : go\n  note right of Busy : hm\n  Busy --> Active`,
    );
    expect(parentOf(last, "Busy")).toBe("Active#region2");
    expect(parseStateDiagram(last).states.get("Busy")!.descriptions).toEqual(["does things"]);
    expect(parseStateDiagram(last).notes[0].target).toBe("Busy");
    const first = moveStateInto(regions, "Busy", "Active#region1");
    expect(first).toContain("    [*] --> NumOff\n    Busy : does things\n    --\n");
    expect(parentOf(first, "Busy")).toBe("Active#region1");
    expect(blocks(first, "Active")).toBe(1);
    // Between two composite states, with transitions written inside the one it leaves.
    const two = `stateDiagram-v2\n  [*] --> Idle\n  state Left {\n    X --> Y : next\n    Y --> Idle\n  }\n  Idle --> Right\n  state Right {\n    [*] --> Z\n  }`;
    const across = moveStateInto(two, "Y", "Right");
    expect(across).toBe(
      `stateDiagram-v2\n  [*] --> Idle\n  state Right {\n    [*] --> Z\n    Y\n  }\n  state Left {\n    X --> Y : next\n    Y --> Idle\n  }\n  Idle --> Right`,
    );
    expect(parentOf(across, "Y")).toBe("Right");
    expect(parentOf(across, "X")).toBe("Left");
    expect(transitions(across).toSorted()).toEqual(transitions(two).toSorted());
    const back = moveStateInto(across, "Y", "Left");
    expect(parentOf(back, "Y")).toBe("Left");
    expect(blocks(back, "Left")).toBe(1);
    expect(back).toContain("  state Right {\n    [*] --> Z\n  }\n");
    // Where the block cannot move up without taking a state along, the lines that name the
    // state move behind it.
    const held = `stateDiagram-v2\n  A --> S\n  A --> R\n  state Box {\n    R --> Q\n  }`;
    expect(moveStateInto(held, "S", "Box")).toBe(
      `stateDiagram-v2\n  A --> R\n  state Box {\n    R --> Q\n    S\n  }\n  A --> S`,
    );
    // A source that opens the composite state twice: the state goes into the last block.
    const twice = `stateDiagram-v2\n  state Box {\n    A --> B\n  }\n  B --> C\n  state Box {\n    C --> A\n  }\n  C --> D`;
    expect(moveStateInto(twice, "D", "Box")).toBe(
      `stateDiagram-v2\n  state Box {\n    A --> B\n  }\n  B --> C\n  state Box {\n    C --> A\n    D\n  }\n  C --> D`,
    );
  });

  it("ungroups a composite state and keeps its states", () => {
    const flat = ungroupComposite(NESTED, "Check");
    expect(changed(NESTED, flat)).toEqual({
      lost: ["        state Check {", "            [*] --> Inner", "        }"],
      added: ["        [*] --> Inner"],
    });
    expect(parentOf(flat, "Inner")).toBe("Edit");
    const edit = ungroupComposite(NESTED, "Edit");
    const read = parseStateDiagram(edit);
    expect(read.states.has("Edit")).toBe(false);
    for (const id of ["Unsaved", "Saved", "Check"]) expect(read.states.get(id)!.parent).toBeNull();
    expect(read.states.get("Inner")!.parent).toBe("Check");
    expect(edit).toContain(
      "    %% the outer machine\n    [*] --> Unsaved\n    Unsaved --> Saved : apply\n\n    state Check {\n        [*] --> Inner\n    }\n    Saved --> [*]\n    state pick <<choice>>\n",
    );
    // Its transitions go with it.
    expect(edit).not.toContain("Idle --> Edit");
    expect(edit).not.toContain("Edit --> pick");
    const regions = ungroupComposite(REGIONS, "Active");
    expect(regions).toBe(
      `stateDiagram-v2\n  [*] --> NumOff\n  NumOff --> NumOn : press\n  [*] --> CapsOff\n  CapsOff --> CapsOn : press\n  CapsOn --> [*]`,
    );
    expect(ungroupComposite(NESTED, "Idle")).toBe(NESTED);
    expect(ungroupComposite(NESTED, "nothing")).toBe(NESTED);
    expect(ungroupComposite(REGIONS, "Active#region1")).toBe(REGIONS);
  });

  it("reverses a transition", () => {
    expect(changed(STARTER, reverseTransition(STARTER, "t2"))).toEqual({
      lost: ["  Draft --> Submitted : submit"],
      added: ["  Submitted --> Draft : submit"],
    });
    // An initial state becomes a final state, and the other way round.
    expect(reverseTransition(STARTER, "t1")).toContain("\n  Draft --> [*]\n");
    expect(transitions(reverseTransition(STARTER, "t5")).at(-1)).toBe("root#initial>Approved");
    expect(reverseTransition(NESTED, "t6")).toContain("    Edit --> Idle: open\n");
    expect(reverseTransition("stateDiagram-v2\n  A:::hot-->B:::cold:go", "t1")).toBe(
      "stateDiagram-v2\n  B:::cold-->A:::hot:go",
    );
    expect(reverseTransition(connectStates(STARTER, "Draft", "Draft"), "t6")).toBe(
      connectStates(STARTER, "Draft", "Draft"),
    );
    expect(reverseTransition(STARTER, "t9")).toBe(STARTER);
  });

  it("keeps every example readable, with the ids of the scene", async () => {
    for (const [name, source] of STATE_EXAMPLES) {
      const { nodes, edges } = stateStructure.read(source),
        real = nodes.filter((node) =>
          ["state", "composite", "choice", "fork", "join"].includes(node.kind),
        ),
        homes = (text: string) =>
          Object.fromEntries(
            stateStructure
              .read(text)
              .nodes.filter((node) => real.some((item) => item.id === node.id))
              .map((node) => [node.id, node.parent?.replace(/#region\d+$/, "") ?? null]),
          );
      const drawn = async (text: string, hint: string) => {
        const read = stateStructure.read(text),
          { shapes, wires } = await sceneIds(text);
        for (const node of read.nodes)
          expect(shapes.has(node.id), `${name} ${hint} ${node.id}`).toBe(true);
        for (const edge of read.edges)
          expect(wires.has(edge.id), `${name} ${hint} ${edge.id}`).toBe(true);
      };
      /** Lines are only added: every line of the source is still there, in its order. */
      const keeps = (text: string, hint: string) => {
        const now = text.split("\n");
        let at = 0;
        for (const line of source.split("\n")) {
          at = now.indexOf(line, at) + 1;
          expect(at, `${name} ${hint}: ${line}`).toBeGreaterThan(0);
        }
      };
      for (const node of real) {
        // A new state at this one, joined and named.
        const added = stateStructure.add(source, { kind: "state", parent: node.parent }),
          joined = connectState(added.source, node.id, added.id),
          named = retitleState(joined.source, added.id, "Fresh");
        expect(named.id, `${name} ${node.id}`).toBe("Fresh");
        expect(named.source).not.toContain("state1");
        expect(
          stateStructure.read(named.source).edges.find((edge) => edge.id === joined.edge),
        ).toMatchObject({ source: node.id, target: "Fresh" });
        keeps(named.source, `add at ${node.id}`);
        // A second connection of the same kind changes nothing.
        expect(connectState(joined.source, node.id, added.id)).toEqual({
          source: joined.source,
          edge: joined.edge,
        });
        // A note, an end and a start at it.
        const note = stateStructure.add(source, { kind: "note", parent: node.id });
        expect(
          parseStateDiagram(note.source).notes.find((item) => item.id === note.id)!.target,
        ).toBe(node.id);
        keeps(note.source, `note at ${node.id}`);
        expect(homes(note.source)).toEqual(homes(source));
        for (const kind of ["start", "end"] as const) {
          const made = stateStructure.add(source, {
              kind,
              parent: node.group ? node.id : node.parent,
            }),
            linked =
              kind === "start"
                ? connectState(source, made.id, node.id)
                : connectState(source, node.id, made.id);
          expect(linked.edge, `${name} ${kind} ${node.id}`).not.toBe("");
          const edge = stateStructure
            .read(linked.source)
            .edges.find((item) => item.id === linked.edge)!;
          expect(kind === "start" ? edge.target : edge.source).toBe(node.id);
          expect(homes(linked.source)).toEqual(homes(source));
          if (linked.source !== source) keeps(linked.source, `${kind} at ${node.id}`);
        }
        // A new state that follows this one, in one line, and in two with a name of two words.
        for (const [label, id, count] of [
          ["Fresh", "Fresh", 1],
          ["Fresh thing", "FreshThing", 2],
        ] as const) {
          const attached = attachState(source, { kind: "state", label }, node.id);
          expect(attached.id, `${name} ${node.id}`).toBe(id);
          expect(attached.source.split("\n")).toHaveLength(source.split("\n").length + count);
          expect(
            stateStructure.read(attached.source).edges.find((edge) => edge.id === attached.edge),
          ).toMatchObject({ source: node.id, target: id });
          keeps(attached.source, `attach at ${node.id}`);
          expect(homes(attached.source)).toEqual(homes(source));
          expect(
            stateStructure
              .read(attached.source)
              .nodes.find((item) => item.id === id)!
              .parent?.replace(/#region\d+$/, "") ?? null,
          ).toBe(node.parent?.replace(/#region\d+$/, "") ?? null);
          await drawn(attached.source, `attach at ${node.id}`);
        }
        const unnamed = attachState(source, { kind: "state" }, node.id),
          titled = retitleState(unnamed.source, unnamed.id, "Fresh thing");
        expect(titled.id, `${name} ${node.id}`).toBe("FreshThing");
        expect(parseStateDiagram(titled.source).states.get("FreshThing")!.label).toBe(
          "Fresh thing",
        );
        expect(titled.source).not.toContain("state1");
        const copy = duplicateState(source, node.id);
        expect(copy.id, `${name} ${node.id}`).not.toBe("");
        if (node.kind === "state" || node.kind === "composite") {
          expect(isGeneratedStateId(copy.source, copy.id), `${name} ${node.id}`).toBe(true);
          const first = retitleState(copy.source, copy.id, "Copy of it");
          expect(first.id, `${name} ${node.id}`).toBe("CopyOfIt");
          expect(homes(first.source)).toEqual(homes(source));
        }
        keeps(copy.source, `copy of ${node.id}`);
        expect(homes(copy.source)).toEqual(homes(source));
        const renamed = renameStateId(source, node.id, "Zz9");
        expect(stateStructure.read(renamed).edges).toHaveLength(edges.length);
        expect(stateStructure.read(renamed).nodes).toHaveLength(nodes.length);
        for (const text of [named.source, note.source, copy.source, renamed])
          await drawn(text, node.id);
        if (node.kind === "composite") {
          const flat = ungroupComposite(source, node.id);
          expect(parseStateDiagram(flat).states.has(node.id), `${name} ${node.id}`).toBe(false);
          await drawn(flat, `ungroup ${node.id}`);
        }
        for (const into of [
          null,
          ...real.filter((item) => item.kind === "composite").map((item) => item.id),
        ]) {
          const moved = moveStateInto(source, node.id, into);
          if (moved === source) continue;
          expect(homes(moved)[node.id], `${name} ${node.id} into ${into}`).toBe(into);
          expect(stateStructure.read(moved).edges).toHaveLength(edges.length);
          // No composite state is opened once more, and every line is still there as it was written.
          const opened = (text: string) =>
            text
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.endsWith("{"));
          expect(opened(moved).toSorted(), `${name} ${node.id} into ${into}`).toEqual(
            opened(source).toSorted(),
          );
          const now = moved.split("\n").map((line) => line.trim());
          for (const line of source.split("\n").map((item) => item.trim())) {
            const at = now.indexOf(line);
            expect(at, `${name} ${node.id} into ${into}: ${line}`).toBeGreaterThanOrEqual(0);
            now.splice(at, 1);
          }
          expect(now.length, `${name} ${node.id} into ${into}`).toBeLessThanOrEqual(1);
          await drawn(moved, `move ${node.id}`);
        }
      }
      for (const edge of edges) {
        const turned = reverseTransition(source, edge.id);
        expect(() => parseUml(turned), `${name} ${edge.id}`).not.toThrow();
        expect(turned.split("\n")).toHaveLength(source.split("\n").length);
        expect(parseStateDiagram(turned).transitions).toHaveLength(edges.length);
      }
    }
  }, 120_000);
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
