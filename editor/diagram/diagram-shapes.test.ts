// Tests of the Shapes tab's lists and words: the groups as the search finds the shapes (the connections never
// searched, a UML type's only when it has more than one), the statements found by name or text, and the tooltips.
import assert from "node:assert/strict";
import { test } from "vitest";
import { snippetsFound, snippetTip, tileGroups, tileTip } from "./diagram-shapes.ts";
import { kindName, paletteOf } from "./palettes.ts";

const tam = paletteOf("tam")!;

test("a block diagram shows its shapes under its name and its seven connections; a search finds shapes only", () => {
  const all = tileGroups(tam, "Block diagram", false, "");
  assert.deepEqual(
    all.map((group) => [group.title, group.items.length]),
    [
      ["Block diagram", 5],
      ["Connections", 7],
    ],
  );
  const found = tileGroups(tam, "Block diagram", false, " STOR ");
  assert.deepEqual(
    found.map((group) => [group.title, group.items.map((item) => item.name)]),
    [
      ["Block diagram", ["Storage"]],
      ["Connections", tam.links.map((item) => item.name)],
    ],
  );
  assert.deepEqual(
    tileGroups(tam, "Block diagram", false, "zzz").map((group) => group.title),
    ["Connections"],
  );
});

test("a UML type with one kind of join shows no Connections; its pieces' group stays when none is found", () => {
  const one = { shapes: tam.shapes, links: tam.links.slice(0, 1) };
  assert.deepEqual(
    tileGroups(one, "Sequence diagram", true, "").map((group) => group.title),
    ["Sequence diagram"],
  );
  assert.deepEqual(
    tileGroups(one, "State machine", true, "zzz").map((group) => [group.title, group.items.length]),
    [["State machine", 0]],
  );
});

test("statements are found by name or by text", () => {
  const snippets = [
    { name: "Class", text: "  class NewClass" },
    { name: "Composition", text: "  Whole *-- Part" },
  ];
  assert.deepEqual(
    snippetsFound(snippets, "whole").map((s) => s.name),
    ["Composition"],
  );
  assert.equal(snippetTip(snippets[1]!), "Add composition: Whole *-- Part");
});

test("tooltips say what the old palette said", () => {
  const agent = tam.shapes[0]!;
  assert.equal(
    tileTip(agent, { links: false, uml: false }),
    "Agent: Active structure element: a service, a process (A)",
  );
  assert.match(
    tileTip(tam.links[0]!, { links: true, uml: false }),
    /\(-- calls -->\)\. Drag from one element to another/,
  );
  assert.equal(
    tileTip({ ...agent, name: "Class", hint: "a classifier" }, { links: false, uml: true }),
    "Class: a classifier. Click to add, or drag onto the canvas.",
  );
  assert.equal(
    tileTip({ ...agent, name: "Association" }, { links: true, uml: true }),
    "Association: new connections are drawn as this; a selected one becomes it",
  );
  assert.equal(kindName("storage"), "Storage");
  assert.equal(kindName("component"), "Component");
});
