// Tests of the diagram editor's connection edits: drawing the palette's kind where it fits, what fits instead and why,
// and turning a connection into another kind.
import assert from "node:assert/strict";
import { test } from "vitest";
import { parseTam } from "../../src/index.ts";
import { connected, lastEdge, linkOf, type Model, relinked } from "./diagram-edit.ts";
import { wordingOf } from "./palettes.ts";

const SOURCE = `agent a[A]
agent b[B]
storage s[S]
`;
/** A model as the connection edits read it: the source and its diagram; no picture is needed. */
const model = (source: string) => ({ source, diagram: parseTam(source) }) as Model;
const lines = (source: string) => source.trim().split("\n").slice(3);

test("a kind that fits is drawn as picked", () => {
  const made = connected(model(SOURCE), "a", "s", wordingOf("reads/writes"));
  assert.deepEqual(lines(made.source), ["a -- reads/writes --> s"]);
  assert.equal(made.replaced, undefined);
});

test("an access dragged from the storage is written from the agent", () => {
  assert.deepEqual(lines(connected(model(SOURCE), "s", "a", wordingOf("reads")).source), [
    "a -- reads --> s",
  ]);
});

test("a kind that does not fit draws what fits the two, and says why", () => {
  const made = connected(model(SOURCE), "a", "b", wordingOf("writes"));
  assert.deepEqual(lines(made.source), ["a -- calls --> b"]);
  assert.match(made.replaced ?? "", /request channel/);
});

test("without a kind picked, the two get what fits them", () => {
  assert.deepEqual(lines(connected(model(SOURCE), "b", "s").source), ["b -- writes --> s"]);
});

test("a connection becomes another kind, and the palette names its kind", () => {
  const source = connected(model(SOURCE), "a", "b").source;
  const edge = lastEdge(source)!;
  assert.equal(linkOf(model(source), edge), "calls");
  const both = relinked(model(source), edge, wordingOf("calls both")!);
  assert.deepEqual(lines(both), ["a <-- calls --> b"]);
  assert.equal(linkOf(model(both), edge), "calls both");
});
