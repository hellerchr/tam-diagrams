// The kind of a UML source and its header: detection, unsupported Mermaid types, size limits, and the edits of title, direction, level and numbering.
import { test } from "vitest";
import assert from "node:assert/strict";
import { detectUml, parseUml, UmlError } from "../../src/index.ts";
import { parseTam } from "../../src/tam.ts";
import { scan } from "../../src/uml.ts";
import {
  setUmlHeader,
  turnPlaces,
  umlHeader,
  umlSettings,
  withTitle,
} from "../../src/uml-header-edit.ts";
import type { UmlHeaderChange } from "../../src/uml-header-edit.ts";

/** The error a parse throws. */
const thrown = (run: () => unknown): Error => {
  try {
    run();
  } catch (reason) {
    assert.ok(reason instanceof Error);
    return reason;
  }
  throw new Error("parsed");
};

/** The message a change is refused with, without its line. */
const refusal = (source: string, change: UmlHeaderChange) =>
  thrown(() => setUmlHeader(source, change)).message.replace(/^Line \d+: /, "");

const SOURCES = {
  class: "classDiagram\n  class Order\n  Order --> Item",
  state: "stateDiagram-v2\n  [*] --> Open\n  Open --> [*]",
  er: "erDiagram\n  ORDER ||--o{ ITEM : holds",
  usecase: "usecase-beta\n  actor User\n  buy(Buy)\n  User --> buy",
  flowchart: "flowchart TB\n  a --> b",
  swimlane: "swimlane-beta TB\n  subgraph Shop\n    a --> b\n  end",
  sequence: "sequenceDiagram\n  A->>B: hi",
};

test("a Mermaid type this package does not draw raises the unsupported UmlError at its line", () => {
  const sources: [string, string, number][] = [
    ["journey\n  title A working day", "journey", 1],
    ["pie title Pets", "pie", 1],
    ["gitGraph LR:", "gitGraph", 1],
    ["---\ntitle: Plan\n---\ngantt\n  title Plan", "gantt", 4],
    ["%%{\n  init: {}\n}%%\ngantt", "gantt", 4],
    ["architecture-beta", "architecture-beta", 1],
    [`gantt${"\n  Task : a, 1d".repeat(700)}`, "gantt", 1],
    [`gantt\n${"x".repeat(30_000)}`, "gantt", 1],
  ];
  for (const [source, word, line] of sources) {
    for (const parse of [parseTam, parseUml]) {
      const error = thrown(() => parse(source));
      assert.ok(error instanceof UmlError);
      assert.equal(error.unsupported, true);
      assert.equal(error.line, line);
      assert.equal(
        error.message,
        `Line ${line}: ${word} is drawn by Mermaid, not the built-in renderer.`,
      );
    }
    assert.equal(detectUml(source), null);
  }
  const generic = thrown(() => parseUml("agent a"));
  assert.ok(generic instanceof UmlError);
  assert.deepEqual([generic.unsupported, generic.line], [true, 0]);
  assert.equal(
    generic.message,
    "This diagram type is drawn by Mermaid, not the built-in renderer.",
  );
});

test("a TAM source whose first id looks like a Mermaid keyword stays TAM", () => {
  for (const id of ["graph", "flowchart", "pie2", "block"]) {
    const source = `${id} -- calls --> api\nagent ${id}\nagent api`;
    assert.equal(detectUml(source), null);
    assert.equal(parseTam(source).edges.length, 1);
  }
  const statements: [string, string][] = [
    ["pie", "pie provides IPie\ncomponent pie"],
    ["C4Context", "C4Context requires ICtx\ncomponent C4Context"],
    ["gantt", "gantt & api -- reads --> db\nagent gantt\nagent api\nstorage db"],
    ["graph", "graph provides IG\ncomponent graph"],
  ];
  for (const [id, source] of statements) {
    assert.equal(detectUml(source), null);
    assert.ok(parseTam(source).nodes.has(id));
  }
  const link = "info <-- calls --> api\nagent info\nagent api";
  assert.equal(detectUml(link), null);
  assert.equal(parseTam(link).edges.length, 1);
  // A bare `<` is Mermaid's right-to-left: a flowchart, neither TAM nor an unsupported type.
  for (const header of ["graph <", "flowchart <"]) {
    assert.equal(parseUml(`${header}\n  a --> b`).kind, "flowchart");
  }
});

test("a %%{ }%% directive is skipped, on one line or several, only when a line closes it", () => {
  const directive = '%%{\n  init: { "theme": "dark" }\n}%%\n';
  for (const head of [directive, '%%{init: { "theme": "dark" }}%%\n']) {
    const source = `${head}sequenceDiagram\n  A->>B: hi`;
    assert.equal(detectUml(source), "sequence");
    assert.equal(parseUml(source).kind, "sequence");
  }
  const unclosed = "%%{\n  init: {}\nsequenceDiagram\n  A->>B: hi";
  assert.equal(detectUml(unclosed), null);
  assert.deepEqual(scan(unclosed).lines, [
    { text: "init: {}", line: 2 },
    { text: "sequenceDiagram", line: 3 },
    { text: "A->>B: hi", line: 4 },
  ]);
  // A plain comment opens none, and a statement after the closing line counts.
  const later = "%% about\nsequenceDiagram\n  A->>B: hi\n%%{init: {}}%%";
  assert.equal(detectUml(later), "sequence");
  assert.deepEqual(
    scan(later).lines.map((item) => item.line),
    [2, 3],
  );
  assert.equal(detectUml(`${directive}%% a comment\nflowchart TB\n  a --> b`), "flowchart");
});

test("flowchart headers are read with their direction and semicolons, not as TAM links", () => {
  for (const header of [
    "graph TD",
    "graph TD;",
    "graph;",
    "flowchart LR",
    "flowchart-elk TB",
    "graph",
  ]) {
    assert.equal(detectUml(`${header}\n  a --> b`), "flowchart", header);
  }
  for (const line of [
    "graph -- calls --> api",
    "flowchart[x]",
    "graph.x",
    "flowchart  <-- a",
    "graph <== a",
  ]) {
    assert.equal(detectUml(line), null, line);
  }
});

test("the size limit counts statement lines: 600 pass, 601 fail, with a trailing newline or without", () => {
  const lines = (count: number) =>
    ["stateDiagram-v2", ...Array<string>(count - 1).fill("A --> B")].join("\n");
  for (const ending of ["\n", ""]) {
    assert.equal(parseUml(lines(600) + ending).kind, "state");
    assert.throws(() => parseUml(lines(601) + ending), /limit of 600 lines/);
  }
});

test("the title is added, changed and removed in the frontmatter", () => {
  for (const source of [SOURCES.class, SOURCES.flowchart, SOURCES.sequence]) {
    const titled = setUmlHeader(source, { title: "Orders" });
    assert.equal(titled, `---\ntitle: Orders\n---\n${source}`);
    assert.equal(umlHeader(titled).title, "Orders");
    const changed = setUmlHeader(titled, { title: "Orders: all" });
    assert.equal(changed, `---\ntitle: "Orders: all"\n---\n${source}`);
    assert.equal(umlHeader(changed).title, "Orders: all");
    assert.equal(setUmlHeader(changed, { title: "" }), source);
  }
});

test("the title keeps the other frontmatter lines, its statement form, and skips a broken body", () => {
  const source = "---\nconfig:\n  look: classic\ntitle: Old\n---\nclassDiagram\n  class A";
  assert.equal(setUmlHeader(source, { title: "New" }), source.replace("Old", "New"));
  assert.equal(
    setUmlHeader(source, { title: "" }),
    "---\nconfig:\n  look: classic\n---\nclassDiagram\n  class A",
  );
  assert.equal(
    withTitle("---\nconfig: {}\n---\nclassDiagram", "T"),
    "---\ntitle: T\nconfig: {}\n---\nclassDiagram",
  );
  // Sequence and ER diagrams say it as a statement too.
  const sequence = "sequenceDiagram\n  title: Checkout\n  A->>B: hi";
  assert.equal(setUmlHeader(sequence, { title: "Pay" }), sequence.replace("Checkout", "Pay"));
  assert.equal(setUmlHeader(sequence, { title: "" }), "sequenceDiagram\n  A->>B: hi");
  const er = "---\ntitle: Old\n---\nerDiagram\n  title Old\n  A ||--o{ B : has";
  assert.equal(setUmlHeader(er, { title: "New" }), er.replaceAll("Old", "New"));
  assert.equal(setUmlHeader(er, { title: "" }), "erDiagram\n  A ||--o{ B : has");
  assert.equal(
    withTitle("classDiagram\n  class A {", "T"),
    "---\ntitle: T\n---\nclassDiagram\n  class A {",
  );
});

test("the direction is a line below the first, changed in place, absent at the type's default", () => {
  for (const kind of ["class", "state", "er", "usecase"] as const) {
    const source = SOURCES[kind],
      [first, ...rest] = source.split("\n"),
      other = kind === "usecase" ? "TB" : "LR";
    const turned = setUmlHeader(source, { direction: other });
    assert.equal(turned, [first, `  direction ${other}`, ...rest].join("\n"));
    assert.equal(umlHeader(turned).direction, other);
    assert.equal(setUmlHeader(turned, { direction: "RL" }), turned.replace(other, "RL"));
  }
  assert.equal(umlHeader(SOURCES.class).direction, "TB");
  assert.equal(umlHeader(SOURCES.usecase).direction, "LR");
  assert.equal(setUmlHeader(SOURCES.class, { direction: "TB" }), SOURCES.class);
  assert.equal(setUmlHeader(SOURCES.usecase, { direction: "LR" }), SOURCES.usecase);
  // Capitals over `td`, the line's indent kept; a composite state keeps its own direction.
  assert.equal(
    setUmlHeader("classDiagram\n    direction td\n    class A", { direction: "BT" }),
    "classDiagram\n    direction BT\n    class A",
  );
  assert.equal(
    setUmlHeader("stateDiagram-v2\n  state Busy {\n    direction LR\n    a --> b\n  }", {
      direction: "RL",
    }),
    "stateDiagram-v2\n  direction RL\n  state Busy {\n    direction LR\n    a --> b\n  }",
  );
});

test("the direction of an activity diagram is the word after the first; a sequence has none", () => {
  assert.equal(
    setUmlHeader("flowchart TB\n  a --> b", { direction: "LR" }),
    "flowchart LR\n  a --> b",
  );
  assert.equal(setUmlHeader("graph TD; a --> b", { direction: "RL" }), "graph RL; a --> b");
  assert.equal(
    setUmlHeader("flowchart >\n  a --> b", { direction: "BT" }),
    "flowchart BT\n  a --> b",
  );
  assert.equal(
    setUmlHeader("flowchart\n  a --> b", { direction: "LR" }),
    "flowchart LR\n  a --> b",
  );
  assert.equal(setUmlHeader("flowchart\n  a --> b", { direction: "TB" }), "flowchart\n  a --> b");
  assert.equal(
    setUmlHeader(SOURCES.swimlane, { direction: "LR" }),
    SOURCES.swimlane.replace("TB", "LR"),
  );
  assert.equal(umlHeader("graph RL\n  a --> b").direction, "RL");
  assert.equal(umlSettings("sequence").direction, undefined);
  assert.equal(
    refusal(SOURCES.sequence, { direction: "LR" }),
    "Sequence diagrams have no direction: their lifelines always run down.",
  );
});

test("the level is a comment below the first line and the direction, changed in place, removed", () => {
  for (const kind of ["class", "state", "usecase", "flowchart", "swimlane", "sequence"] as const) {
    const source = SOURCES[kind],
      [first, ...rest] = source.split("\n");
    const leveled = setUmlHeader(source, { level: "conceptual" });
    assert.equal(leveled, [first, "  %% level conceptual", ...rest].join("\n"));
    assert.equal(umlHeader(leveled).level, "conceptual");
    assert.equal(setUmlHeader(leveled, { level: "" }), source);
  }
  const before = "%% level conceptual\nflowchart TB\n  a --> b";
  assert.equal(setUmlHeader(before, { level: "design" }), before.replace("conceptual", "design"));
  assert.equal(setUmlHeader(before, { level: "" }), "flowchart TB\n  a --> b");
  const leveled = setUmlHeader(SOURCES.class, { level: "conceptual" });
  assert.equal(
    setUmlHeader(leveled, { direction: "LR" }),
    "classDiagram\n  direction LR\n  %% level conceptual\n  class Order\n  Order --> Item",
  );
  assert.equal(
    setUmlHeader(SOURCES.class, { direction: "LR", level: "design" }),
    "classDiagram\n  direction LR\n  %% level design\n  class Order\n  Order --> Item",
  );
});

test("the level is refused where the parser refuses it, with its reason", () => {
  assert.equal(
    refusal(SOURCES.state, { level: "design" }),
    "State machine diagrams belong to the conceptual level in TAM; remove `%% level design`.",
  );
  assert.equal(
    refusal("classDiagram\n  class A {\n    +int id\n  }", { level: "conceptual" }),
    "Visibility (`+int id`) belongs to the design level; remove `%% level conceptual` or the marker.",
  );
  assert.equal(
    refusal("sequenceDiagram\n  create participant B\n  A->>B: new", { level: "conceptual" }),
    "Object creation belongs to the design level in TAM.",
  );
  assert.equal(umlSettings("er").level, false);
  assert.equal(
    refusal(SOURCES.er, { level: "conceptual" }),
    "Entity relationship diagrams have no TAM level.",
  );
});

test("the numbering of a sequence diagram goes after title and level, and every one turns off", () => {
  const source = "sequenceDiagram\n  title Pay\n  %% level design\n  A->>B: hi";
  const numbered = setUmlHeader(source, { numbered: true });
  assert.equal(
    numbered,
    "sequenceDiagram\n  title Pay\n  %% level design\n  autonumber\n  A->>B: hi",
  );
  assert.equal(umlHeader(numbered).numbered, true);
  assert.equal(setUmlHeader(numbered, { numbered: true }), numbered);
  assert.equal(setUmlHeader(numbered, { numbered: false }), source);
  const elsewhere =
    "sequenceDiagram\n  autonumber 10 5\n  A->>B: hi\n  autonumber off\n  A->>B: ho";
  assert.equal(umlHeader(elsewhere).numbered, true);
  assert.equal(setUmlHeader(elsewhere, { numbered: true }), elsewhere);
  assert.equal(
    setUmlHeader(elsewhere, { numbered: false }),
    "sequenceDiagram\n  A->>B: hi\n  A->>B: ho",
  );
  assert.equal(umlHeader(SOURCES.sequence).numbered, false);
  assert.equal(
    refusal(SOURCES.class, { numbered: true }),
    "Class diagrams have no numbered messages.",
  );
});

test("a header change keeps every other line and leaves sources every parser reads", () => {
  const source = "classDiagram\r\n  %% the order\r\n  class Order\r\n%% @Order 10,20\r\n";
  assert.equal(
    setUmlHeader(source, { direction: "LR" }),
    "classDiagram\n  direction LR\n  %% the order\n  class Order\n%% @Order 10,20\n",
  );
  for (const each of Object.values(SOURCES)) {
    const settings = umlSettings(parseUml(each).kind);
    const next = setUmlHeader(each, {
      title: "T",
      ...(settings.direction && { direction: "RL" }),
      ...(settings.level && { level: "conceptual" }),
      ...(settings.numbering && { numbered: true }),
    });
    assert.doesNotThrow(() => parseUml(next), next);
  }
});

test("places turned with the direction stand along the new way, apart by the boxes' sizes", () => {
  const sizes = new Map([
    ["a", { width: 100, height: 40 }],
    ["b", { width: 100, height: 40 }],
  ]);
  const places = new Map([
    ["a", { x: 10, y: 10 }],
    ["b", { x: 10, y: 110 }],
  ]);
  const turned = turnPlaces(places, sizes, "TB", "LR");
  assert.deepEqual(turned.get("a"), { x: 10, y: 10 });
  assert.equal(turned.get("b")?.y, 10);
  assert.ok(turned.get("b")!.x >= 10 + 100 + 20);
  assert.deepEqual(
    turnPlaces(places, sizes, "TB", "BT"),
    new Map([
      ["a", { x: 10, y: 110 }],
      ["b", { x: 10, y: 10 }],
    ]),
  );
  const still = new Map([["a", { x: 5, y: 7 }]]);
  assert.deepEqual(turnPlaces(still, sizes, "LR", "LR"), still);
});
