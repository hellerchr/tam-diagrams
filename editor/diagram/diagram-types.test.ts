// Tests of the diagram types: which a file may hold, how a kind of source is named, and adding a statement.
import assert from "node:assert/strict";
import { test } from "vitest";
import { EXAMPLES } from "../../src/examples.ts";
import { typeOf, typesFor, withSnippet } from "./diagram-types.ts";

test("a .tam file may hold any type, a Mermaid file only UML", () => {
  assert.equal(typesFor("tam")[0]!.kind, "tam");
  assert.equal(
    typesFor("mermaid").some((type) => type.kind === "tam"),
    false,
  );
});

test("a flowchart with lanes is an activity diagram; no kind, no type", () => {
  assert.equal(typeOf("swimlane")?.name, "Activity diagram");
  assert.equal(typeOf("er")?.name, "ER diagram");
  assert.equal(typeOf(undefined), undefined);
});

test("every starter but the block diagram's opens with its Mermaid header", () => {
  for (const type of typesFor("mermaid"))
    assert.match(
      type.starter,
      /^(classDiagram|usecase-beta|flowchart|stateDiagram|sequenceDiagram|erDiagram)/,
    );
});

test("every type the chooser offers has examples, and every kind of example a type", () => {
  const kinds = typesFor("tam").map((type) => type.kind);
  assert.deepEqual(kinds.toSorted(), Object.keys(EXAMPLES).toSorted());
});

test("a snippet goes on lines of its own at the end, whatever blank lines the source ended with", () => {
  assert.equal(
    withSnippet("classDiagram\n  class A\n\n\n", "  class B"),
    "classDiagram\n  class A\n  class B\n",
  );
});
