import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { Known } from "../editor/completion.ts";
import { completeSource, idsOf } from "../editor/completion-uml.ts";
import { typeOf, TYPES } from "../editor/types.ts";

/** The options at the `|` of a text, or at its end; the type is the one its header says. */
const options = (text: string, explicit = false, known: Known[] = []) => {
  const at = text.includes("|!") ? text.indexOf("|!") : text.length,
    doc = text.replace("|!", "");
  const state = EditorState.create({ doc });
  return (
    completeSource(new CompletionContext(state, at, explicit), typeOf(doc), known)?.options ?? []
  );
};

/** The labels offered. */
const offered = (text: string, explicit = false, known: Known[] = []) =>
  options(text, explicit, known).map((item) => item.label);

/** The labels offered, best first as the list shows them before anything is typed. */
const ordered = (text: string, explicit = false) =>
  options(text, explicit)
    .toSorted((a, b) => (b.boost ?? 0) - (a.boost ?? 0))
    .map((item) => item.label);

const HEADERS = [
  "classDiagram",
  "usecase-beta",
  "flowchart",
  "swimlane-beta",
  "stateDiagram-v2",
  "sequenceDiagram",
];

describe("completing the first line of a source", () => {
  it("offers the headers of all types, and what a block diagram starts with", () => {
    expect(offered("")).toEqual([]);
    expect(offered("", true)).toEqual(expect.arrayContaining([...HEADERS, "agent", "title"]));
    expect(offered("s")).toEqual(expect.arrayContaining(["sequenceDiagram", "storage"]));
    expect(offered("%% a comment\n\nstate")).toEqual(expect.arrayContaining(HEADERS));
    expect(offered("usecase-")).toEqual(HEADERS);
    // Past the first statement a block diagram offers its own.
    expect(offered("agent a[A]\ns")).not.toContain("sequenceDiagram");
    expect(offered("agent a[A]\ns", false, [{ id: "a", kind: "agent", label: "A" }])).toEqual(
      expect.arrayContaining(["storage", "a"]),
    );
  });

  it("offers a header again where one is replaced, and a title before it", () => {
    expect(offered("class|!\n  class A")).toEqual(expect.arrayContaining(HEADERS));
    expect(offered("---\nt")).toEqual(["title"]);
    expect(offered("---\ntitle: X\n---\nfl")).toEqual(expect.arrayContaining(HEADERS));
    expect(offered("---\ntitle: X\n---\nfl")).not.toContain("title");
    expect(offered("flowchart ")).toEqual(["TB", "LR", "BT", "RL"]);
    expect(offered("swimlane-beta L")).toContain("LR");
  });

  it("knows every type the editor has", () => {
    for (const info of TYPES) {
      if (info.type === "tam") continue;
      expect(HEADERS, info.type).toContain(info.starter.split(/\s/)[0]);
      // The elements of a starter are found in its text.
      expect(idsOf(info.type, info.starter).length, info.type).toBeGreaterThan(2);
    }
  });
});

describe("completing a class diagram", () => {
  const source = `classDiagram
  class Order {
    +id: string
  }
  class Customer["A customer"]
  namespace shop {
    class Cart
  }
  Order "1" *-- "*" OrderItem : has
`;

  it("finds the classes in the text", () => {
    expect(idsOf("class", source)).toEqual([
      { id: "Order", kind: "uml-class", label: "" },
      { id: "Customer", kind: "uml-class", label: "A customer" },
      { id: "Cart", kind: "uml-class", label: "" },
      { id: "OrderItem", kind: "uml-class", label: "" },
    ]);
    // A source that does not parse has them too.
    expect(idsOf("class", "classDiagram\nclass A {\n  +x\nB --> ").map((item) => item.id)).toEqual([
      "A",
    ]);
  });

  it("offers statements and classes at the start of a line", () => {
    expect(offered(`${source}  `)).toEqual([]);
    expect(ordered(`${source}  `, true)).toEqual([
      "class",
      "interface",
      "namespace",
      "note",
      "note for",
      "direction",
      "Order",
      "Customer",
      "Cart",
      "OrderItem",
    ]);
    expect(offered(`${source}  c`)).toEqual(expect.arrayContaining(["class", "Customer"]));
    const [declare] = options(`${source}  c`);
    expect(declare).toMatchObject({ label: "class", type: "declare-uml-class" });
    expect(typeof declare.apply).toBe("function");
    expect(options(`${source}  C`).find((item) => item.label === "Customer")).toMatchObject({
      type: "uml-class",
      detail: "A customer",
    });
    expect(offered(`${source}  direction `)).toEqual(["TB", "LR", "BT", "RL"]);
    expect(offered(`${source}  note `)).toEqual(["for"]);
    expect(offered(`${source}  note for `)).toContain("Order");
  });

  it("offers the relations after a class", () => {
    const relations = ordered(`${source}  Order `);
    expect(relations.slice(0, 9)).toEqual([
      "<|--",
      "--|>",
      "*--",
      "o--",
      "-->",
      "--",
      "..>",
      "..|>",
      "<|..",
    ]);
    expect(options(`${source}  Order `)[0]).toMatchObject({
      type: "connection",
      detail: "inheritance: the left is the base class",
    });
    expect(offered(`${source}  Order -`)).toContain("-->");
    expect(offered(`${source}  Order "1" .`)).toContain("..>");
    expect(offered(`${source}  class `)).toEqual([]);
    expect(offered(`${source}  class New `)).toEqual([]);
  });

  it("offers the classes after a relation", () => {
    const classes = ["Order", "Customer", "Cart", "OrderItem"];
    expect(offered(`${source}  Order --> `)).toEqual(classes);
    expect(offered(`${source}  Order <|-- `)).toEqual(classes);
    expect(offered(`${source}  Order "1" *-- "*" `)).toEqual(classes);
    expect(offered(`${source}  Order ..|> Cu`)).toEqual(classes);
    // The word at the cursor is not a class yet.
    expect(offered(`${source}  Order --> New`)).not.toContain("New");
    expect(offered(`${source}  Order --> Customer : pla`)).toEqual([]);
  });

  it("offers members inside a class, and classes only inside a namespace", () => {
    const body = "classDiagram\n  class Order {\n    ";
    expect(offered(body)).toEqual([]);
    expect(ordered(body, true)).toEqual([
      "attribute",
      "method",
      "method with result",
      "static method",
      "abstract method",
      "+",
      "-",
      "#",
      "~",
      "<<interface>>",
      "<<abstract>>",
      "<<enumeration>>",
    ]);
    expect(offered(`${body}-`)).toEqual(expect.arrayContaining(["attribute", "method"]));
    expect(offered(`${body}-`)).not.toContain("+");
    expect(offered(`${body}+me`)).toContain("method");
    expect(offered(`${body}<<`)).toEqual(["interface", "abstract", "enumeration", "service"]);
    expect(offered(`${body}+id: string\n  }\n  O`)).toEqual(
      expect.arrayContaining(["class", "Order"]),
    );
    expect(offered("classDiagram\n  namespace shop {\n    c")).toEqual(["class", "interface"]);
  });
});

describe("completing a use case diagram", () => {
  const source = `usecase-beta
  actor User
  actor svc("Billing Service") <<system>>
  systemBoundary shop[Web Shop]
    browse(Browse Products)
    order(Place Order)
  end
  User --> browse
`;

  it("finds actors and use cases in the text", () => {
    expect(idsOf("usecase", source)).toEqual([
      { id: "User", kind: "uml-actor", label: "" },
      { id: "svc", kind: "uml-actor", label: "Billing Service" },
      { id: "browse", kind: "uml-usecase", label: "Browse Products" },
      { id: "order", kind: "uml-usecase", label: "Place Order" },
    ]);
  });

  it("offers statements and elements at the start of a line", () => {
    expect(ordered(`${source}  `, true)).toEqual([
      "actor",
      "use case",
      "systemBoundary",
      "note for",
      "direction",
      "User",
      "svc",
      "browse",
      "order",
    ]);
    expect(offered(`${source}  a`)).toEqual(expect.arrayContaining(["actor", "systemBoundary"]));
    expect(options(`${source}  U`).find((item) => item.label === "User")?.type).toBe("uml-actor");
  });

  it("offers the relations after an element, as the parser reads them", () => {
    expect(ordered(`${source}  User `)).toEqual([
      "-->",
      "--",
      "..> : include",
      "..> : extend",
      "--|>",
      "-- text -->",
    ]);
    expect(offered(`${source}  browse .`)).toContain("..> : include");
    expect(offered(`${source}  browse ..> : `)).toEqual(["include", "extend"]);
    expect(offered(`${source}  actor New `)).toEqual([]);
  });

  it("offers the elements after a relation", () => {
    expect(offered(`${source}  User --> `)).toEqual(["User", "svc", "browse", "order"]);
    expect(offered(`${source}  User -- `)).toEqual(["User", "svc", "browse", "order"]);
    expect(offered(`${source}  svc --|> U`)).toContain("User");
    // A use case includes use cases, not actors.
    expect(offered(`${source}  order ..> : include `)).toEqual(["browse", "order"]);
  });

  it("offers use cases and the end inside a system boundary", () => {
    const inside = "usecase-beta\n  systemBoundary shop[Shop]\n    ";
    expect(ordered(inside, true)).toEqual(["use case", "end"]);
    expect(offered(`${inside}e`)).toContain("end");
  });
});

describe.each(["flowchart", "swimlane-beta"])("completing a %s", (header) => {
  const source = `${header} TB
  subgraph one [Part one]
    start((Start)) --> check{In stock?}
  end
  check -->|yes| ship[Ship order]
  ship --> done(((End)))
  ship --> plain
`;
  const nodes = ["start", "check", "ship", "done", "plain"];
  const targets = header === "flowchart" ? ["one", ...nodes] : nodes;

  it("finds the nodes in the text, each with its shape", () => {
    expect(
      idsOf(typeOf(source) as "flowchart", source).filter((item) => item.kind !== "group"),
    ).toEqual([
      { id: "start", kind: "uml-circle", label: "Start" },
      { id: "check", kind: "uml-decision", label: "In stock?" },
      { id: "ship", kind: "uml-rect", label: "Ship order" },
      { id: "done", kind: "uml-final", label: "End" },
      { id: "plain", kind: "uml-rect", label: "" },
    ]);
  });

  it("offers statements and nodes at the start of a line", () => {
    expect(offered(`${source}  `)).toEqual([]);
    expect(ordered(`${source}  `, true)).toEqual([
      "subgraph",
      "action",
      "decision",
      "initial",
      "final",
      "direction",
      ...targets,
    ]);
    expect(offered(`${source}  s`)).toEqual(expect.arrayContaining(["subgraph", "ship", "start"]));
    expect(offered(`${source}  direction `)).toEqual(["TB", "LR", "BT", "RL"]);
  });

  it("offers the edges after a node, and its shapes after a new one", () => {
    expect(ordered(`${source}  ship `).slice(0, 6)).toEqual([
      "-->",
      "-->|text|",
      "---",
      "-.->",
      "==>",
      "-- text -->",
    ]);
    expect(offered(`${source}  ship -`)).toContain("-.->");
    expect(offered(`${source}  ship[Ship it] =`)).toContain("==>");
    expect(offered(`${source}  ship `)).not.toContain("[ ]");
    const fresh = ordered(`${source}  pack `);
    expect(fresh.slice(0, 5)).toEqual(["[ ]", "( )", "{ }", "(( ))", "((( )))"]);
    expect(fresh).toEqual(expect.arrayContaining(["([ ])", "[( )]", "{{ }}", "-->"]));
    expect(options(`${source}  pack `).find((item) => item.label === "{ }")).toMatchObject({
      type: "uml-decision",
      detail: "diamond: a decision or a merge",
    });
    // A new node at the end of an edge has its shapes too.
    expect(offered(`${source}  ship --> pack `)).toContain("(( ))");
    // Inside a text nothing is a node.
    expect(offered(`${source}  ship[Ship the `)).toEqual([]);
    expect(offered(`${source}  ship -->|when `)).toEqual([]);
  });

  it("offers the nodes after an edge", () => {
    expect(offered(`${source}  ship --> `)).toEqual(targets);
    expect(offered(`${source}  ship -->|no| `)).toEqual(targets);
    expect(offered(`${source}  ship -- later --> `)).toEqual(targets);
    expect(offered(`${source}  ship -.-> d`)).toContain("done");
    expect(offered(`${source}  ship --> done & `)).toEqual(targets);
    expect(offered(`${source}  a[A] --> b[B] --> `)).toEqual([...targets, "a", "b"]);
  });

  it("offers the end inside a subgraph", () => {
    expect(offered(`${header} TB\n  subgraph one\n    e`)).toContain("end");
    expect(offered(`${source}  e`)).not.toContain("end");
  });
});

describe("completing a state machine", () => {
  const source = `stateDiagram-v2
  state "Waiting for payment" as Waiting
  state pick <<choice>>
  [*] --> Draft
  Draft --> Waiting : submit
`;
  const states = ["Waiting", "pick", "Draft"];

  it("finds the states in the text", () => {
    expect(idsOf("state", source)).toEqual([
      { id: "Waiting", kind: "uml-state", label: "Waiting for payment" },
      { id: "pick", kind: "uml-decision", label: "" },
      { id: "Draft", kind: "uml-state", label: "" },
    ]);
  });

  it("offers statements and states at the start of a line", () => {
    expect(ordered(`${source}  `, true)).toEqual([
      "state",
      "composite",
      "choice",
      "fork",
      "join",
      "note",
      "[*]",
      "direction",
      ...states,
    ]);
    expect(offered(`${source}  D`)).toEqual(expect.arrayContaining(["Draft", "direction"]));
    expect(offered(`${source}  [`)).toContain("[*]");
    expect(offered(`${source}  note `)).toEqual(["left of", "right of"]);
    expect(offered(`${source}  note right of `)).toEqual(states);
    expect(offered(`${source}  state New <<`)).toEqual(["choice", "fork", "join"]);
  });

  it("offers the transition after a state", () => {
    expect(offered(`${source}  Draft `)).toEqual(["-->", ":"]);
    expect(offered(`${source}  Draft -`)).toEqual(["-->", ":"]);
    expect(offered(`${source}  [*] `)).toEqual(["-->"]);
    expect(offered(`${source}  state `)).toEqual([]);
  });

  it("offers the states after a transition, and its event after the target", () => {
    expect(offered(`${source}  Draft --> `)).toEqual([...states, "[*]"]);
    expect(offered(`${source}  Draft --> W`)).toContain("Waiting");
    expect(offered(`${source}  Draft --> Waiting `)).toEqual([":"]);
    expect(offered(`${source}  Draft --> Waiting : sub`)).toEqual([]);
  });

  it("offers the divider of regions inside a composite state, and the end of a note", () => {
    const inside = `${source}  state Active {\n    `;
    expect(offered(inside, true)).toContain("--");
    expect(offered(`${source}  `, true)).not.toContain("--");
    expect(offered(`${inside}[*] --> `)).toContain("Draft");
    expect(offered(`${source}  note left of Draft\n    some text\n  e`)).toEqual(["end note"]);
  });
});

describe("completing a sequence diagram", () => {
  const source = `sequenceDiagram
  participant U as User
  actor A as Admin
  U->>Shop: place order
`;
  const participants = ["U", "A", "Shop"];

  it("finds the participants in the text", () => {
    expect(idsOf("sequence", source)).toEqual([
      { id: "U", kind: "uml-participant", label: "User" },
      { id: "A", kind: "uml-actor", label: "Admin" },
      { id: "Shop", kind: "uml-participant", label: "" },
    ]);
  });

  it("offers statements and participants at the start of a line", () => {
    expect(offered(`${source}  `)).toEqual([]);
    const all = ordered(`${source}  `, true);
    expect(all.slice(0, 11)).toEqual([
      "participant",
      "actor",
      "note",
      "alt",
      "opt",
      "loop",
      "par",
      "critical",
      "break",
      "rect",
      "box",
    ]);
    expect(all).toEqual(expect.arrayContaining(["activate", "autonumber", ...participants]));
    expect(all).not.toContain("end");
    expect(offered(`${source}  a`)).toEqual(expect.arrayContaining(["alt", "actor", "A"]));
    expect(options(`${source}  al`)[3]).toMatchObject({ label: "alt", type: "declare-uml-frame" });
  });

  it("offers the messages after a participant", () => {
    expect(ordered(`${source}  U-`).slice(0, 4)).toEqual(["->>", "-->>", "-)", "--)"]);
    expect(offered(`${source}  U `)).toContain("->>");
    expect(offered(`${source}  U--`)).toContain("-->>");
    expect(offered(`${source}  U<<`)).toContain("<<->>");
    // A word that is no participant yet may be a statement in the making.
    expect(offered(`${source}  New `)).toEqual([]);
  });

  it("offers the participants after an arrow, and where a statement names one", () => {
    expect(offered(`${source}  U->>S`)).toEqual(participants);
    expect(offered(`${source}  Shop-->>+`)).toContain("-->>");
    expect(offered(`${source}  Shop-->>+ `)).toEqual(participants);
    expect(offered(`${source}  Shop-)Sh`)).toEqual(participants);
    expect(offered(`${source}  U->>Shop: hel`)).toEqual([]);
    expect(offered(`${source}  note `)).toEqual(["over", "left of", "right of"]);
    expect(offered(`${source}  note over `)).toEqual(participants);
    expect(offered(`${source}  note over U,`)).toEqual(participants);
    expect(offered(`${source}  note over U: Sh`)).toEqual([]);
    expect(offered(`${source}  activate `)).toEqual(participants);
    expect(offered(`${source}  create `)).toEqual(["participant", "actor"]);
  });

  it("offers the branches and the end of the block the cursor is in", () => {
    expect(offered(`${source}  alt ok\n    U->>Shop: x\n  e`)).toEqual(
      expect.arrayContaining(["else", "end"]),
    );
    expect(offered(`${source}  par one\n    a`)).toContain("and");
    expect(offered(`${source}  critical one\n    o`)).toEqual(
      expect.arrayContaining(["option", "opt"]),
    );
    expect(offered(`${source}  loop n\n    alt ok\n    end\n    e`)).not.toContain("else");
    expect(offered(`${source}  alt ok\n  end\n  e`)).not.toContain("end");
    expect(offered(`${source}  alt is it o`)).toEqual([]);
  });
});
