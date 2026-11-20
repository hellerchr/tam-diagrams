// The syntax sheet of the diagram editor (DiagramHelp.svelte; Help > TAM syntax), as the old editor's dialogs.ts had
// it: what a line of the source may say, one group per kind of statement for a block diagram, and for a Mermaid type
// its statements, read one after the other a diagram of that type. The guide (GuidePanel.svelte) says more.
import type { SheetGroup, SheetRow } from "./diagram-help.ts";

/** The TAM notation on one sheet: what a line of the source may say. */
const TAM_SYNTAX: SheetGroup[] = [
  [
    "Diagram",
    [
      ["title Order system", "The title"],
      ["direction LR", "The way an automatic layout runs: TB or LR"],
      ["%% a remark", "A comment"],
    ],
  ],
  [
    "Elements",
    [
      ["agent api[Order API]", "A kind, an id, and the name in brackets"],
      ["agent human storage group", "The kinds of a block diagram"],
      [
        "agent shop[Web Shop] { ... }",
        "A container: its parts stand on the lines between the braces",
      ],
      ["storage cart[Cart]:::blue", "A color"],
      ["agent worker[Worker] stack", "Several, drawn as a stack"],
      [
        "agent worker[Worker] ...",
        "Several, drawn as two with dots between: three dots after the name",
      ],
      ["agent api[Order API] @250,90 140x40", "A position, and a least size"],
    ],
  ],
  [
    "Connections",
    [
      [
        "a -- calls: place order @HTTPS --> b",
        "A request/response channel with a label and a protocol",
      ],
      ["a <-- calls --> b", "A bidirectional request/response channel"],
      ["a -- sends data --> b", "A unidirectional data flow channel"],
      ["a --- b", "A channel without a direction"],
      ["a -- reads --> s", "A storage access: reads, writes or reads/writes"],
      ["s -. pointer .-> t", "A reference between storages; create and generate join agents"],
      ["a --- b @+20,-14", "Where the label stands: from the middle of the line"],
    ],
  ],
];

/** The first lines of every Mermaid source: a title, and remarks. */
const FRONT: SheetRow[] = [
  ["---\ntitle: Order system\n---", "The title, before the first line of the diagram"],
  ["%% a remark", "A comment"],
];

/**
 * The Mermaid syntax the editor draws, per diagram type: the statements of a diagram and what each
 * says. The rows of a type, read one after the other, are a diagram of that type.
 */
const UML_SYNTAX: Record<string, SheetRow[]> = {
  class: [
    ["classDiagram", "The first line: a class diagram"],
    ["class Customer", "A class"],
    [
      "class Order {\n  +id: string\n  -total() number\n}",
      "Members: + public, - private, # protected",
    ],
    [
      "class Payable {\n  <<interface>>\n  +pay()\n}",
      "An interface; <<abstract>> and <<enumeration>> work the same",
    ],
    ["Payable <|.. Order", "Realization: the class realizes the interface"],
    ["Order <|-- RushOrder", "Generalization: the general class first"],
    ['Customer "1" --> "*" Order : places', "An association with multiplicities and a name"],
    ["Order *-- OrderItem", "Composition; o-- is a shared aggregation"],
    ["Order ..> Customer : notifies", "A dependency"],
  ],
  usecase: [
    ["usecase-beta", "The first line: a use case diagram"],
    ["direction LR", "The way the layout runs: LR or TB"],
    ["actor User", "An actor"],
    [
      "systemBoundary shop[Web Shop]\n  browse(Browse Products)\n  order(Place Order)\nend",
      "A system boundary with its use cases: an id, and the name in round brackets",
    ],
    ["User --> browse", "An association: the actor participates in the use case"],
    ["User --> order", "Every line is one association"],
  ],
  flowchart: [
    ["flowchart TB", "The first line: an activity diagram that runs TB or LR"],
    ["start((Start)) --> check{In stock?}", "An initial node, a control flow, and a decision node"],
    ["check -->|yes| ship[Ship order]", "A flow with a guard, to an action"],
    ["check -->|no| wait[Wait for supply]", "The other branch"],
    ["wait --> check", "A flow back"],
    ["ship --> done(((End)))", "An activity final node"],
    [
      "subgraph pack [Packing]\n  box[Box it] --> label[Label it]\nend",
      "A group of activity nodes; a diagram with lanes has none",
    ],
  ],
  swimlane: [
    ["swimlane-beta TB", "The first line: an activity diagram with lanes, running TB or LR"],
    [
      "subgraph Customer\n  start((Start)) --> order(Place Order)\nend",
      "An activity partition with its nodes: an initial node and an action",
    ],
    [
      "subgraph Shop\n  check(Check Order) --> ship(Ship Goods)\n  ship --> stop(((End)))\nend",
      "Another partition, with an activity final node",
    ],
    ["order --> check", "A control flow across partitions"],
  ],
  state: [
    ["stateDiagram-v2", "The first line: a state machine"],
    ["[*] --> Draft", "The initial pseudostate and the default state"],
    ["Draft --> Submitted : submit", "A transition and its trigger event"],
    ['state "Waiting for approval" as Waiting', "A state with a name of several words"],
    ["Submitted --> Waiting", "A transition without an event"],
    [
      "state Review {\n  [*] --> Reading\n  Reading --> [*]\n}",
      "A composite state with its substates",
    ],
    ["Waiting --> Review : assign", "Composite states take transitions like any other"],
    ["Review --> [*]", "A final state"],
  ],
  sequence: [
    ["sequenceDiagram", "The first line: a sequence diagram"],
    ["actor U as User", "An actor, a human agent: an id, and the name"],
    ["participant S as Shop", "A participant with its lifeline"],
    ["U->>S: place order", "A synchronous message"],
    ["S-->>U: confirmation", "A reply message"],
    [
      "alt in stock\n  S->>U: ship\nelse sold out\n  S->>U: refund\nend",
      "Combined fragment alt with two operands; opt has one",
    ],
    ["loop every day\n  S->>S: check supply\nend", "Combined fragment loop, with a self message"],
    ["Note over U,S: A note", "A note over lifelines"],
  ],
  er: [
    ["erDiagram", "The first line: an entity relationship diagram"],
    ["direction LR", "The way the layout runs: TB or LR"],
    ["CUSTOMER", "An entity type"],
    [
      'ORDER {\n  int id PK\n  int customerId FK\n  string status "open or closed"\n}',
      "Attributes: a type and a name, then the keys PK, FK or UK and a comment in quotes",
    ],
    [
      'ITEM["Order item"] {\n  int orderId PK, FK\n  int position PK\n}',
      "A display name; a composite primary key",
    ],
    ["CUSTOMER ||--o{ ORDER : places", "One customer, zero or more orders"],
    ["ORDER ||--|{ ITEM : contains", "One order, one or more items"],
    [
      'CUSTOMER }o..o| ORDER : "last looked at"',
      "Zero or one with o| and |o; dots for a non-identifying relationship",
    ],
    [
      'ORDER one or more to only one CUSTOMER : "belongs to"',
      "The same in words: zero or one, zero or more, one or more, only one; to, optionally to",
    ],
  ],
};

/** The headings of the sheets of the kinds of source a type is also written as. */
const VARIANT_SHEETS: Record<string, string> = {
  swimlane: "With lanes",
};

/** The types whose sources are also written another way, and that way: an activity diagram with lanes. */
const VARIANTS: Record<string, string[]> = { flowchart: ["swimlane"] };

/** The syntax sheet of a diagram of `kind` ("tam": a block diagram; a swimlane is an activity diagram), with the note
 *  under it. */
export function syntaxSheet(kind: string): { groups: SheetGroup[]; note: string } {
  if (kind === "tam")
    return {
      groups: TAM_SYNTAX,
      note: "The other diagram types are written in Mermaid's syntax: Help shows it while one of them is open.",
    };
  const type = kind === "swimlane" ? "flowchart" : kind;
  return {
    groups: [
      ["Statements", UML_SYNTAX[type] ?? []],
      ...(VARIANTS[type] ?? []).map((variant): SheetGroup => [
        VARIANT_SHEETS[variant] ?? variant,
        UML_SYNTAX[variant] ?? [],
      ]),
      ["Every type", FRONT],
    ],
    note: "This is the part of Mermaid's syntax the editor draws. The shapes on the left add these statements for you; the source completes them as you type.",
  };
}
