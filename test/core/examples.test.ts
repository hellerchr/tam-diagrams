// Tests of the example diagrams: each is under the kind its source is, reads without an error, and is named once.
import assert from "node:assert/strict";
import { test } from "vitest";
import { EXAMPLES } from "../../src/examples.ts";
import { parseUml } from "../../src/index.ts";
import { parseTam } from "../../src/tam.ts";
import { detectUml } from "../../src/uml.ts";

test("every example is under the kind its source is (a swimlane under flowchart)", () => {
  for (const [kind, examples] of Object.entries(EXAMPLES)) {
    assert.ok(examples.length, `${kind} has examples`);
    for (const [name, source] of examples) {
      const detected = detectUml(source) ?? "tam";
      assert.equal(detected === "swimlane" ? "flowchart" : detected, kind, name);
    }
  }
});

test("every example reads without an error", () => {
  for (const [kind, examples] of Object.entries(EXAMPLES))
    for (const [name, source] of examples)
      assert.doesNotThrow(() => (kind === "tam" ? parseTam(source) : parseUml(source)), name);
});

test("an example's name is its own within its kind", () => {
  for (const examples of Object.values(EXAMPLES)) {
    const names = examples.map(([name]) => name);
    assert.equal(new Set(names).size, names.length);
  }
});
