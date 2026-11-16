// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  setUmlHeader,
  turnPlaces,
  umlHeader,
  umlSettings,
  withTitle,
} from "../src/uml-header-edit.ts";
import { parseUml } from "../src/index.ts";

/** The message a change is refused with, without its line. */
const refusal = (source: string, change: Parameters<typeof setUmlHeader>[1]) => {
  try {
    setUmlHeader(source, change);
  } catch (reason) {
    return (reason as Error).message.replace(/^Line \d+: /, "");
  }
  throw new Error("allowed");
};

const SOURCES = {
  class: "classDiagram\n  class Order\n  Order --> Item",
  state: "stateDiagram-v2\n  [*] --> Open\n  Open --> [*]",
  er: "erDiagram\n  ORDER ||--o{ ITEM : holds",
  usecase: "usecase-beta\n  actor User\n  buy(Buy)\n  User --> buy",
  flowchart: "flowchart TB\n  a --> b",
  swimlane: "swimlane-beta TB\n  subgraph Shop\n    a --> b\n  end",
  sequence: "sequenceDiagram\n  A->>B: hi",
};

describe("the title of a Mermaid diagram", () => {
  it.each(Object.entries(SOURCES))(
    "is added and changed in the frontmatter of a %s",
    (_, source) => {
      const titled = setUmlHeader(source, { title: "Orders" });
      expect(titled).toBe(`---\ntitle: Orders\n---\n${source}`);
      expect(umlHeader(titled).title).toBe("Orders");
      const changed = setUmlHeader(titled, { title: "Orders: all" });
      expect(changed).toBe(`---\ntitle: "Orders: all"\n---\n${source}`);
      expect(umlHeader(changed).title).toBe("Orders: all");
      expect(setUmlHeader(changed, { title: "" })).toBe(source);
    },
  );

  it("keeps the other lines of the frontmatter, and the title's place among them", () => {
    const source = "---\nconfig:\n  look: classic\ntitle: Old\n---\nclassDiagram\n  class A";
    expect(setUmlHeader(source, { title: "New" })).toBe(source.replace("Old", "New"));
    expect(setUmlHeader(source, { title: "" })).toBe(
      "---\nconfig:\n  look: classic\n---\nclassDiagram\n  class A",
    );
    expect(withTitle("---\nconfig: {}\n---\nclassDiagram", "T")).toBe(
      "---\ntitle: T\nconfig: {}\n---\nclassDiagram",
    );
  });

  it("is changed where a sequence or entity relationship diagram says it as a statement", () => {
    const sequence = "sequenceDiagram\n  title: Checkout\n  A->>B: hi";
    expect(setUmlHeader(sequence, { title: "Pay" })).toBe(sequence.replace("Checkout", "Pay"));
    expect(setUmlHeader(sequence, { title: "" })).toBe("sequenceDiagram\n  A->>B: hi");
    const er = "---\ntitle: Old\n---\nerDiagram\n  title Old\n  A ||--o{ B : has";
    expect(setUmlHeader(er, { title: "New" })).toBe(er.replaceAll("Old", "New"));
    expect(setUmlHeader(er, { title: "" })).toBe("erDiagram\n  A ||--o{ B : has");
  });

  it("is written in a source that has an error, past its frontmatter only", () => {
    expect(withTitle("classDiagram\n  class A {", "T")).toBe(
      "---\ntitle: T\n---\nclassDiagram\n  class A {",
    );
  });
});

describe("the direction of a Mermaid diagram", () => {
  it.each(["class", "state", "er", "usecase"] as const)(
    "is added below the first line of a %s diagram, and changed in place",
    (kind) => {
      const source = SOURCES[kind],
        [first, ...rest] = source.split("\n"),
        other = kind === "usecase" ? "TB" : "LR";
      const turned = setUmlHeader(source, { direction: other });
      expect(turned).toBe([first, `  direction ${other}`, ...rest].join("\n"));
      expect(umlHeader(turned).direction).toBe(other);
      expect(setUmlHeader(turned, { direction: "RL" })).toBe(turned.replace(other, "RL"));
    },
  );

  it("is not added when it is the type's default", () => {
    expect(umlHeader(SOURCES.class).direction).toBe("TB");
    expect(umlHeader(SOURCES.usecase).direction).toBe("LR");
    expect(setUmlHeader(SOURCES.class, { direction: "TB" })).toBe(SOURCES.class);
    expect(setUmlHeader(SOURCES.usecase, { direction: "LR" })).toBe(SOURCES.usecase);
  });

  it("writes capitals over `TD` and lower case, and keeps the line's indent", () => {
    expect(setUmlHeader("classDiagram\n    direction td\n    class A", { direction: "BT" })).toBe(
      "classDiagram\n    direction BT\n    class A",
    );
  });

  it("is the top level's in a state machine: a composite state keeps its own", () => {
    const source = "stateDiagram-v2\n  state Busy {\n    direction LR\n    a --> b\n  }";
    expect(setUmlHeader(source, { direction: "RL" })).toBe(
      "stateDiagram-v2\n  direction RL\n  state Busy {\n    direction LR\n    a --> b\n  }",
    );
  });

  it("is the word after the first one in an activity diagram", () => {
    expect(setUmlHeader("flowchart TB\n  a --> b", { direction: "LR" })).toBe(
      "flowchart LR\n  a --> b",
    );
    expect(setUmlHeader("graph TD; a --> b", { direction: "RL" })).toBe("graph RL; a --> b");
    expect(setUmlHeader("flowchart >\n  a --> b", { direction: "BT" })).toBe(
      "flowchart BT\n  a --> b",
    );
    expect(setUmlHeader("flowchart\n  a --> b", { direction: "LR" })).toBe(
      "flowchart LR\n  a --> b",
    );
    expect(setUmlHeader("flowchart\n  a --> b", { direction: "TB" })).toBe("flowchart\n  a --> b");
    expect(setUmlHeader(SOURCES.swimlane, { direction: "LR" })).toBe(
      SOURCES.swimlane.replace("TB", "LR"),
    );
    expect(umlHeader("graph RL\n  a --> b").direction).toBe("RL");
  });

  it("is no setting of a sequence diagram, whose lifelines run down", () => {
    expect(umlSettings("sequence").direction).toBeUndefined();
    expect(refusal(SOURCES.sequence, { direction: "LR" })).toBe(
      "Sequence diagrams have no direction: their lifelines always run down.",
    );
  });
});

describe("the level of a Mermaid diagram", () => {
  it.each(["class", "state", "usecase", "flowchart", "swimlane", "sequence"] as const)(
    "is added below the first line of a %s diagram, changed and removed",
    (kind) => {
      const source = SOURCES[kind],
        [first, ...rest] = source.split("\n");
      const leveled = setUmlHeader(source, { level: "conceptual" });
      expect(leveled).toBe([first, "  %% level conceptual", ...rest].join("\n"));
      expect(umlHeader(leveled).level).toBe("conceptual");
      expect(setUmlHeader(leveled, { level: "" })).toBe(source);
    },
  );

  it("is changed in place, before the first line too", () => {
    const source = "%% level conceptual\nflowchart TB\n  a --> b";
    expect(setUmlHeader(source, { level: "design" })).toBe(source.replace("conceptual", "design"));
    expect(setUmlHeader(source, { level: "" })).toBe("flowchart TB\n  a --> b");
  });

  it("stands after the direction, which stands after the first line", () => {
    const leveled = setUmlHeader(SOURCES.class, { level: "conceptual" });
    expect(setUmlHeader(leveled, { direction: "LR" })).toBe(
      "classDiagram\n  direction LR\n  %% level conceptual\n  class Order\n  Order --> Item",
    );
    expect(setUmlHeader(SOURCES.class, { direction: "LR", level: "design" })).toBe(
      "classDiagram\n  direction LR\n  %% level design\n  class Order\n  Order --> Item",
    );
  });

  it("is refused where the parser refuses it, with its reason", () => {
    expect(refusal(SOURCES.state, { level: "design" })).toBe(
      "State machine diagrams belong to the conceptual level in TAM; remove `%% level design`.",
    );
    expect(refusal(SOURCES.usecase, { level: "design" })).toBe(
      "Use case diagrams belong to the conceptual level in TAM; remove `%% level design`.",
    );
    expect(refusal("classDiagram\n  class A {\n    +int id\n  }", { level: "conceptual" })).toBe(
      "Visibility (`+int id`) belongs to the design level; remove `%% level conceptual` or the marker.",
    );
    expect(
      refusal("stateDiagram-v2\n  state f <<fork>>\n  [*] --> f", { level: "conceptual" }),
    ).toBe("TAM state machines have no fork bars; use an activity diagram for parallel flows.");
    expect(
      refusal("sequenceDiagram\n  create participant B\n  A->>B: new", { level: "conceptual" }),
    ).toBe("Object creation belongs to the design level in TAM.");
  });

  it("is no setting of an entity relationship diagram", () => {
    expect(umlSettings("er").level).toBe(false);
    expect(refusal(SOURCES.er, { level: "conceptual" })).toBe(
      "Entity relationship diagrams have no TAM level.",
    );
  });
});

describe("the numbering of the messages of a sequence diagram", () => {
  it("is turned on below the first line, after the title and the level", () => {
    const source = "sequenceDiagram\n  title Pay\n  %% level design\n  A->>B: hi";
    const numbered = setUmlHeader(source, { numbered: true });
    expect(numbered).toBe(
      "sequenceDiagram\n  title Pay\n  %% level design\n  autonumber\n  A->>B: hi",
    );
    expect(umlHeader(numbered).numbered).toBe(true);
    expect(setUmlHeader(numbered, { numbered: true })).toBe(numbered);
    expect(setUmlHeader(numbered, { numbered: false })).toBe(source);
  });

  it("keeps a numbering that starts elsewhere, and turns every one off", () => {
    const source = "sequenceDiagram\n  autonumber 10 5\n  A->>B: hi\n  autonumber off\n  A->>B: ho";
    expect(umlHeader(source).numbered).toBe(true);
    expect(setUmlHeader(source, { numbered: true })).toBe(source);
    expect(setUmlHeader(source, { numbered: false })).toBe(
      "sequenceDiagram\n  A->>B: hi\n  A->>B: ho",
    );
    expect(umlHeader(SOURCES.sequence).numbered).toBe(false);
  });

  it("is no setting of the other types", () => {
    expect(refusal(SOURCES.class, { numbered: true })).toBe(
      "Class diagrams have no numbered messages.",
    );
  });
});

describe("a change of the header", () => {
  it("keeps every other line, comments, places and line ends", () => {
    const source = "classDiagram\r\n  %% the order\r\n  class Order\r\n%% @Order 10,20\r\n";
    expect(setUmlHeader(source, { direction: "LR" })).toBe(
      "classDiagram\n  direction LR\n  %% the order\n  class Order\n%% @Order 10,20\n",
    );
  });

  it("leaves sources every parser reads", () => {
    for (const source of Object.values(SOURCES)) {
      const settings = umlSettings(parseUml(source).kind);
      const next = setUmlHeader(source, {
        title: "T",
        ...(settings.direction && { direction: "RL" }),
        ...(settings.level && { level: "conceptual" }),
        ...(settings.numbering && { numbered: true }),
      });
      expect(() => parseUml(next)).not.toThrow();
    }
  });
});

describe("places turned with the direction", () => {
  const sizes = new Map([
    ["a", { width: 100, height: 40 }],
    ["b", { width: 100, height: 40 }],
  ]);

  it("stand along the new way what stood along the old one", () => {
    const places = new Map([
      ["a", { x: 10, y: 10 }],
      ["b", { x: 10, y: 110 }],
    ]);
    const turned = turnPlaces(places, sizes, "TB", "LR");
    expect(turned.get("a")).toEqual({ x: 10, y: 10 });
    expect(turned.get("b")!.y).toBe(10);
    // The wide boxes keep a gap between them.
    expect(turned.get("b")!.x).toBeGreaterThanOrEqual(10 + 100 + 20);
    const back = turnPlaces(places, sizes, "TB", "BT");
    expect(back).toEqual(
      new Map([
        ["a", { x: 10, y: 110 }],
        ["b", { x: 10, y: 10 }],
      ]),
    );
  });

  it("stay as they are when the direction does not change", () => {
    const places = new Map([["a", { x: 5, y: 7 }]]);
    expect(turnPlaces(places, sizes, "LR", "LR")).toEqual(places);
  });
});
