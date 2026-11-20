// Tests of what the diagram editor's right panel, guide sheet, New diagram chooser and help sheets decide on their own:
// the problem strips' words, the starts a type offers, the arrow keys' steps, the guide's filter, and the sheets' rows.
import assert from "node:assert/strict";
import { test } from "vitest";
import { GUIDES } from "../../src/reference.ts";
import { cardStep, fills, startsOf, startStep, thumbOf } from "./diagram-chooser.ts";
import {
  linkLabel,
  narrowGuide,
  otherSyntax,
  rowCount,
  stopAfter,
  wideRow,
  wordsOf,
  writes,
} from "./diagram-guide.ts";
import { helpSheet } from "./diagram-help.ts";
import { syntaxSheet } from "./diagram-help-syntax.ts";
import { oneLine, overlapText, problemText, proseBits } from "./diagram-side.ts";
import { TYPES } from "./diagram-types.ts";

test("a problem strip says the line, and its code between backticks is code", () => {
  assert.equal(
    problemText({ line: 17, message: "Cannot read `foo`." }),
    "Line 17: Cannot read `foo`.",
  );
  assert.equal(problemText({ line: 0, message: "Empty." }), "Empty.");
  assert.deepEqual(proseBits("Cannot read `foo bar`."), [
    { text: "Cannot read ", code: false },
    { text: "foo bar", code: true },
    { text: ".", code: false },
  ]);
  assert.equal(
    overlapText(["Cart", oneLine("Order<br>API")]),
    "“Cart” and “Order API” overlap. TAM places all elements apart.",
  );
});

test("a block diagram starts empty or from the sample, a UML type from its starter, then the examples", () => {
  const [tam, cls] = [TYPES[0]!, TYPES[1]!];
  const tamStarts = startsOf(tam, [
    ["Web", "title Web"],
    ["Same as sample", tam.starter],
  ]);
  assert.deepEqual(
    tamStarts.map((s) => s.name),
    ["Empty diagram", "Order system (sample)", "Web"],
  );
  assert.equal(tamStarts[0]!.source, "");
  assert.deepEqual(
    startsOf(cls, [["Shop", "classDiagram"]]).map((s) => [s.name, s.icon]),
    [
      ["Small starter diagram", "plus"],
      ["Shop", "file"],
    ],
  );
  for (const type of TYPES) assert.ok(thumbOf(type).trim(), type.kind);
});

test("the chooser's keys step through the list and the cards, and stop at the ends", () => {
  assert.equal(startStep("ArrowDown", 4, 5), 4);
  assert.equal(startStep("ArrowUp", 0, 5), 0);
  assert.equal(startStep("End", 1, 5), 4);
  assert.equal(startStep("x", 1, 5), undefined);
  assert.equal(cardStep("ArrowDown", 1, 4, 7), 5);
  assert.equal(cardStep("ArrowDown", 4, 4, 7), undefined);
  assert.equal(cardStep("ArrowLeft", 0, 4, 7), undefined);
  assert.equal(fills(200, 100), true);
  assert.equal(fills(100, 100), false);
});

test("the guide's filter keeps the rows with every word, and a section whose title has them whole", () => {
  const tam = GUIDES[0]!;
  assert.equal(narrowGuide(tam, []).length, tam.sections.length);
  const kept = narrowGuide(tam, wordsOf("STORAGE  reads"));
  assert.ok(kept.length > 0);
  for (const part of kept.filter(
    (p) => !/storage/i.test(p.section.title) || !/reads/i.test(p.section.title),
  ))
    for (const row of part.rows) {
      const text = `${row.write}\n${row.means}`.toLowerCase();
      assert.ok(text.includes("storage") && text.includes("reads"), text);
    }
  assert.equal(narrowGuide(tam, wordsOf("zzzqqq")).length, 0);
  const titled = tam.sections[1]!;
  const whole = narrowGuide(tam, wordsOf(titled.title)).find((part) => part.section === titled);
  assert.equal(whole?.rows.length, titled.rows?.length ?? 0);
  assert.equal(rowCount([], 3), "");
  assert.equal(rowCount(["a"], 1), "1 row");
  assert.equal(rowCount(["a"], 0), "Nothing");
});

test("the guide's rows, links, keys and the sentence of another type's syntax", () => {
  assert.equal(writes({ write: "a", means: "" }), true);
  assert.equal(writes({ write: "-->", means: "", fragment: true }), false);
  assert.equal(wideRow({ write: "a\nb", means: "" }), true);
  assert.equal(linkLabel("channels"), "Channels");
  assert.equal(
    otherSyntax("TAM block diagram", "Activity diagram"),
    "This is TAM block diagram syntax; the diagram on show is an activity diagram.",
  );
  assert.equal(
    otherSyntax("Class diagram", undefined),
    "This is class diagram syntax; the diagram on show is of no type yet.",
  );
  assert.equal(stopAfter("ArrowDown", -1, 3, true), 0);
  assert.equal(stopAfter("ArrowDown", 2, 3, false), undefined);
  assert.equal(stopAfter("ArrowUp", 0, 3, false), "filter");
  assert.equal(stopAfter("End", 0, 3, false), 2);
  assert.equal(stopAfter("ArrowUp", -1, 3, true), undefined);
});

test("the help sheets: a block diagram's keys, a UML type's by its structure, and each type's syntax", () => {
  assert.deepEqual(
    helpSheet("tam", "Block diagram").map(([title]) => title),
    ["Add and connect", "Select and change", "Move and arrange", "View and files"],
  );
  const state = helpSheet("state", "State machine", { usual: "State", links: 1, copy: true });
  assert.ok(state[0]![1].some(([, does]) => does === "Add a state"));
  assert.ok(state[1]![1].some(([how]) => Array.isArray(how) && how.join() === "Ctrl,D"));
  assert.match(state[3]![1][0]![1], /^State machines lay themselves out/);
  assert.ok(
    !helpSheet("er", "ER diagram")
      .flatMap(([, rows]) => rows)
      .some(([how]) => Array.isArray(how) && how.join() === "Ctrl,D"),
  );
  assert.ok(
    helpSheet("sequence", "Sequence diagram")[1]![1].some(([, does]) =>
      does.startsWith("Move the selected message"),
    ),
  );
  assert.equal(syntaxSheet("tam").groups[0]![0], "Diagram");
  assert.deepEqual(
    syntaxSheet("swimlane").groups.map(([title]) => title),
    ["Statements", "With lanes", "Every type"],
  );
  for (const kind of ["class", "usecase", "flowchart", "state", "sequence", "er"])
    assert.ok(syntaxSheet(kind).groups[0]![1].length > 3, kind);
});
