// The kinds of diagram the diagram editor (DiagramView.svelte) starts and switches between: a TAM block diagram and
// the Mermaid UML types tam-diagrams draws, each with what it shows, the source a new one starts with, and the
// statements its Add menu writes (a UML diagram is edited in the source). Taken from tam-diagrams' old editor
// (editor/types.ts, editor/starter.ts).

/** A source's type as tam-diagrams' detectUml names it; "tam" for a block diagram. */
export type DiagramKind =
  "tam" | "class" | "usecase" | "flowchart" | "swimlane" | "state" | "sequence" | "er";

/** A statement to add with a click. */
export type Snippet = { name: string; text: string };

export type DiagramType = {
  kind: DiagramKind;
  name: string;
  about: string;
  starter: string;
  snippets: Snippet[];
};

export const TYPES: DiagramType[] = [
  {
    kind: "tam",
    name: "Block diagram",
    about: "Compositional structure: agents, storages, channels and accesses (SAP TAM, FMC)",
    starter: `title Order system
human customer[Customer] @40,60
agent shop[Web Shop] @220,30 380x260 {
  agent api[Order API] @250,90
  agent worker[Fulfillment] @450,90
  storage cart[Cart] @250,220
  storage orders[Orders] @450,220
}
agent erp[ERP System]:::orange @700,90
customer -- calls: place order @HTTPS --> api
api -- sends data: order events --> worker
api -- reads/writes --> cart
api -- writes --> orders
worker -- reads --> orders
worker -- calls: IDoc @RFC --> erp
`,
    snippets: [],
  },
  {
    kind: "class",
    name: "Class diagram",
    about: "Classifiers with attributes and operations, generalizations and associations",
    starter: `classDiagram
  class Order {
    +id: string
    +total() number
  }
  class OrderItem {
    +quantity: number
  }
  class Customer
  Customer "1" --> "*" Order : places
  Order "1" *-- "*" OrderItem
`,
    snippets: [
      { name: "Class", text: "  class NewClass {\n    +field: string\n    +method()\n  }" },
      { name: "Interface", text: "  class NewInterface {\n    <<interface>>\n    +method()\n  }" },
      { name: "Generalization", text: "  Base <|-- Derived" },
      { name: "Association", text: '  A "1" --> "*" B : has' },
      { name: "Composition", text: "  Whole *-- Part" },
      { name: "Dependency", text: "  A ..> B : uses" },
    ],
  },
  {
    kind: "usecase",
    name: "Use case diagram",
    about: "Actors, use cases and the subject's system boundary",
    starter: `usecase-beta
  direction LR
  actor User
  actor Admin
  systemBoundary shop[Web Shop]
    browse(Browse Products)
    order(Place Order)
    manage(Manage Catalog)
  end
  User --> browse
  User --> order
  Admin --> manage
`,
    snippets: [
      { name: "Actor", text: "  actor NewActor" },
      { name: "Use case", text: "  newCase(New Use Case)" },
      { name: "System", text: "  systemBoundary sys[System]\n    inner(Inner Use Case)\n  end" },
      { name: "Association", text: "  NewActor --> newCase" },
      { name: "Include", text: "  newCase ..> : include inner" },
    ],
  },
  {
    kind: "flowchart",
    name: "Activity diagram",
    about:
      "Actions and control flow: decisions, forks and joins, and lanes for the agents responsible",
    starter: `flowchart TB
  start((Start)) --> check{In stock?}
  check -->|yes| ship[Ship order]
  check -->|no| wait[Wait for supply]
  wait --> check
  ship --> done(((End)))
`,
    snippets: [
      { name: "Action", text: "  a[Do something] --> b[Do the next thing]" },
      {
        name: "Decision",
        text: "  ask{Decide?} -->|yes| one[One way]\n  ask -->|no| other[Other way]",
      },
      { name: "Initial node", text: "  start((Start)) --> first[First step]" },
      { name: "Final node", text: "  last[Last step] --> stop(((End)))" },
      { name: "Group", text: "  subgraph part [A part]\n    x[Inside] --> y[Also inside]\n  end" },
    ],
  },
  {
    kind: "state",
    name: "State machine",
    about: "States of one object and the transitions between them",
    starter: `stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted : submit
  Submitted --> Approved : approve
  Submitted --> Draft : reject
  Approved --> [*]
`,
    snippets: [
      { name: "State", text: '  state "New State" as NewState' },
      { name: "Transition", text: "  A --> B : event" },
      { name: "Initial", text: "  [*] --> First" },
      { name: "Final state", text: "  Last --> [*]" },
      { name: "Composite", text: "  state Outer {\n    [*] --> Inner\n    Inner --> [*]\n  }" },
      { name: "Note", text: "  note right of A : A note" },
    ],
  },
  {
    kind: "sequence",
    name: "Sequence diagram",
    about: "Messages between lifelines, ordered in time",
    starter: `sequenceDiagram
  participant U as User
  participant S as Shop
  participant P as Payment
  U->>S: place order
  S->>P: charge
  P-->>S: paid
  S-->>U: confirmation
`,
    snippets: [
      { name: "Participant", text: "  participant N as New" },
      { name: "Actor", text: "  actor A as Person" },
      { name: "Message", text: "  A->>B: message" },
      { name: "Reply", text: "  B-->>A: reply" },
      {
        name: "Alternative",
        text: "  alt condition\n    A->>B: one\n  else otherwise\n    A->>B: other\n  end",
      },
      { name: "Loop", text: "  loop every time\n    A->>B: again\n  end" },
      { name: "Note", text: "  Note over A,B: A note" },
    ],
  },
  {
    kind: "er",
    name: "ER diagram",
    about: "Entity types with attributes and keys, and relationships with their cardinalities",
    starter: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ORDER-ITEM : contains
  CUSTOMER {
    int id PK
    string name
    string email UK
  }
  ORDER {
    int id PK
    int customerId FK
    date placed
  }
  ORDER-ITEM {
    int orderId PK, FK
    int position PK
    int quantity
  }
`,
    snippets: [
      { name: "Entity", text: "  ENTITY {\n    int id PK\n    string name\n  }" },
      { name: "One to many", text: "  A ||--o{ B : has" },
      { name: "Many to one", text: '  A }o--|| B : "belongs to"' },
      { name: "One to one", text: "  A ||--|| B : is" },
      { name: "Many to many", text: "  A }o--o{ B : has" },
    ],
  },
];

/** The type a kind of source is to the person: a flowchart with lanes (swimlane) is an activity diagram too. */
export const typeOf = (kind: DiagramKind | undefined): DiagramType | undefined =>
  kind &&
  TYPES.find((type) => type.kind === kind || (kind === "swimlane" && type.kind === "flowchart"));

/** The types a file may hold: a .tam file any, a Mermaid file (lang "mermaid") only UML. */
export const typesFor = (lang: string) =>
  lang === "tam" ? TYPES : TYPES.filter((type) => type.kind !== "tam");

/** `source` with `text` added as statements at its end, on lines of their own. */
export const withSnippet = (source: string, text: string) =>
  `${source.replace(/\s*$/, "")}\n${text}\n`;
