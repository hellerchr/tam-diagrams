// The syntax guides: every row and example is real source the parser reads (or refuses, where the row says so), each
// guide has its parts, and a source finds its guide.
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseUml } from "../../src/index.ts";
import {
  type Guide,
  type GuideRow,
  type GuideSection,
  GUIDES,
  guideOf,
  guideTypeOf,
  rowSource,
} from "../../src/reference.ts";
import { parseTam } from "../../src/tam.ts";
import { detectUml } from "../../src/uml.ts";

const parse = (guide: Guide, source: string) =>
  guide.type === "tam" ? parseTam(source) : parseUml(source);

/** Every row of a guide with its section. */
const rowsOf = (guide: Guide): [GuideSection, GuideRow][] =>
  guide.sections.flatMap((section) =>
    (section.rows ?? []).map((item): [GuideSection, GuideRow] => [section, item]),
  );

/** The guide type of a parsed Mermaid source: an activity with lanes is an activity. */
const kindOf = (source: string) =>
  detectUml(source) === "swimlane" ? "flowchart" : detectUml(source);

test("each guide says what the diagram shows, its rules, its syntax, an example and what is refused", () => {
  for (const guide of GUIDES) {
    const ids = guide.sections.map((section) => section.id);
    assert.equal(new Set(ids).size, ids.length, guide.type);
    assert.deepEqual(ids.slice(0, 2), ["about", "rules"], guide.type);
    assert.deepEqual(ids.slice(-2), ["example", "refused"], guide.type);
    assert.ok(rowsOf(guide).filter(([, item]) => !item.refused).length > 25, guide.type);
  }
});

test("every row is source the parser reads, or refuses where the row says so", () => {
  for (const guide of GUIDES)
    for (const [section, item] of rowsOf(guide)) {
      if (item.fragment) continue;
      const source = rowSource(guide, section, item);
      if (item.refused)
        assert.throws(() => parse(guide, source), `${guide.type} refuses:\n${source}`);
      else {
        assert.doesNotThrow(() => parse(guide, source), `${guide.type} reads:\n${source}`);
        if (guide.type !== "tam") assert.equal(kindOf(source), guide.type, source);
      }
    }
});

test("a refused row is refused for itself, not for the lines around it", () => {
  for (const guide of GUIDES)
    for (const [section, item] of rowsOf(guide)) {
      if (!item.refused || item.whole) continue;
      const around = rowSource(guide, section, { ...item, write: "" });
      assert.doesNotThrow(() => parse(guide, around), `${guide.type}:\n${around}`);
    }
});

test("each example is a source of its type that reads", () => {
  for (const guide of GUIDES) {
    const { example } = guide.sections.find((section) => section.id === "example")!;
    assert.ok(example);
    assert.doesNotThrow(() => parse(guide, example), guide.type);
    if (guide.type !== "tam") assert.equal(example.split("\n")[0], guide.header);
  }
});

test("a source finds its guide: by the file's language, else by its header", () => {
  assert.equal(guideTypeOf("tam", ""), "tam");
  assert.equal(guideTypeOf("mermaid", "%% a remark\nstateDiagram-v2\n  [*] --> A"), "state");
  assert.equal(guideTypeOf("mermaid", "flowchart LR"), "flowchart");
  assert.equal(guideTypeOf("mermaid", ""), undefined);
  assert.equal(guideOf("swimlane"), guideOf("flowchart"));
  assert.equal(guideOf("nothing"), undefined);
});
