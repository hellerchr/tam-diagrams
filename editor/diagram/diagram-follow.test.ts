// The source and the picture following each other: lines of the selected parts, the part of a line, and where a
// guide's statement is written.
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseTam } from "../../src/tam.ts";
import { declaredElements } from "../../src/tam-pin.ts";
import { insertion, type Lined, linesOf, partAtLine } from "./diagram-follow.ts";

const SOURCE = `title Shop
human user[Customer]
agent shop[Shop] {
  agent api[API]
}
storage db[Orders]
user -- calls --> api
api -- writes --> db
api -- reads --> db`;

const diagram = parseTam(SOURCE);
const lined: Lined = { nodes: declaredElements(diagram), edges: diagram.edges };

test("the selected parts mark the lines that declare them, in order, each once", () => {
  const [calls, writes] = diagram.edges;
  assert.deepEqual(
    linesOf(lined, [
      { type: "element", id: "db" },
      { type: "element", id: "user" },
    ]),
    [2, 6],
  );
  assert.deepEqual(
    linesOf(lined, [
      { type: "wire", id: writes!.id },
      { type: "element", id: "api" },
    ]),
    [4, 8],
  );
  assert.deepEqual(
    linesOf(lined, [
      { type: "wire", id: calls!.id },
      { type: "wire", id: calls!.id },
    ]),
    [7],
  );
  // A part the diagram no longer has, a wire id taken for an element, nothing drawn: no lines.
  assert.deepEqual(
    linesOf(lined, [
      { type: "element", id: "gone" },
      { type: "element", id: calls!.id },
    ]),
    [],
  );
  assert.deepEqual(linesOf(undefined, [{ type: "element", id: "db" }]), []);
});

test("a line selects the element it declares, else the connection it says", () => {
  assert.deepEqual(partAtLine(lined, 3), { type: "element", id: "shop" });
  assert.deepEqual(partAtLine(lined, 4), { type: "element", id: "api" });
  assert.deepEqual(partAtLine(lined, 9), { type: "wire", id: diagram.edges[2]!.id });
  // The title, a closing brace, a line past the end, no diagram: nothing.
  for (const line of [1, 5, 40]) assert.equal(partAtLine(lined, line), undefined);
  assert.equal(partAtLine(undefined, 2), undefined);
});

test("a line and its part go both ways", () => {
  for (const node of lined.nodes)
    assert.deepEqual(linesOf(lined, [partAtLine(lined, node.line)!]), [node.line]);
});

/** The source after an insertion, with the text it selects. */
function inserted(doc: string, head: number, text: string) {
  const change = insertion(doc, head, text);
  const next = doc.slice(0, change.from) + change.insert + doc.slice(change.to);
  return [next, next.slice(...change.select)];
}

test("a statement goes below the cursor's line, onto a blank one, or at the end from the start", () => {
  const doc = "agent a[A]\nagent b[B]";
  assert.deepEqual(inserted(doc, 3, "agent c"), ["agent a[A]\nagent c\nagent b[B]", "agent c"]);
  assert.deepEqual(inserted(doc, 0, "agent c"), ["agent a[A]\nagent b[B]\nagent c\n", "agent c"]);
  assert.deepEqual(inserted(doc, doc.length, "a -- b"), [
    "agent a[A]\nagent b[B]\na -- b\n",
    "a -- b",
  ]);
  assert.deepEqual(inserted("agent a\n  \nagent b", 9, "x {\n}"), [
    "agent a\nx {\n}\nagent b",
    "x {\n}",
  ]);
  assert.deepEqual(inserted("agent a\n", 0, "agent b"), ["agent a\nagent b\n", "agent b"]);
  assert.deepEqual(inserted("", 0, "agent a"), ["agent a\n", "agent a"]);
});
