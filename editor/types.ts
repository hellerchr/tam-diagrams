/**
 * The diagram types the editor works with: TAM block diagrams, edited on the canvas, and the UML
 * diagrams the library draws from Mermaid sources, edited as text with a live picture.
 */

import { detectUml, type UmlKind } from "../src/uml.ts";

export type DiagramType = "tam" | UmlKind;

/** A piece of source a click adds: the usual statements of a diagram type. */
export interface Snippet {
  name: string;
  text: string;
}

export interface TypeInfo {
  type: DiagramType;
  name: string;
  /** What the type shows, for the chooser. */
  about: string;
  /** The source a new diagram of the type starts with. */
  starter: string;
  /** Statements to add with a click; none for the type edited on the canvas. */
  snippets: Snippet[];
}

export const TYPES: TypeInfo[] = [
  {
    type: "tam",
    name: "Block diagram",
    about: "Agents, storages and the channels between them (SAP TAM, FMC)",
    starter: "",
    snippets: [],
  },
  {
    type: "class",
    name: "Class diagram",
    about: "Classes with members, inheritance and associations",
    starter: `classDiagram
  class Order {
    +id: string
    +total(): number
  }
  class OrderItem {
    +quantity: number
  }
  class Customer
  Customer "1" --> "*" Order : places
  Order "1" *-- "*" OrderItem`,
    snippets: [
      { name: "Class", text: "  class NewClass {\n    +field: string\n    +method()\n  }" },
      { name: "Interface", text: "  class NewInterface {\n    <<interface>>\n    +method()\n  }" },
      { name: "Inheritance", text: "  Base <|-- Derived" },
      { name: "Association", text: '  A "1" --> "*" B : has' },
      { name: "Composition", text: "  Whole *-- Part" },
      { name: "Dependency", text: "  A ..> B : uses" },
    ],
  },
  {
    type: "usecase",
    name: "Use case diagram",
    about: "Actors and what they do with a system",
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
  Admin --> manage`,
    snippets: [
      { name: "Actor", text: "  actor NewActor" },
      { name: "Use case", text: "  newCase(New Use Case)" },
      { name: "System", text: "  systemBoundary sys[System]\n    inner(Inner Use Case)\n  end" },
      { name: "Association", text: "  NewActor --> newCase" },
      { name: "Include", text: "  newCase ..> : include inner" },
    ],
  },
  {
    type: "flowchart",
    name: "Activity diagram",
    about: "Steps and decisions of a flow",
    starter: `flowchart TB
  start((Start)) --> check{In stock?}
  check -->|yes| ship[Ship order]
  check -->|no| wait[Wait for supply]
  wait --> check
  ship --> done(((End)))`,
    snippets: [
      { name: "Step", text: "  a[Do something] --> b[Do the next thing]" },
      {
        name: "Decision",
        text: "  ask{Decide?} -->|yes| one[One way]\n  ask -->|no| other[Other way]",
      },
      { name: "Start", text: "  start((Start)) --> first[First step]" },
      { name: "End", text: "  last[Last step] --> stop(((End)))" },
      { name: "Group", text: "  subgraph part [A part]\n    x[Inside] --> y[Also inside]\n  end" },
    ],
  },
  {
    type: "swimlane",
    name: "Activity with lanes",
    about: "A flow across the agents that carry it out",
    starter: `swimlane-beta TB
  subgraph Customer
    start((Start)) --> order(Place Order)
    receive(Receive Goods) --> stop(((End)))
  end
  subgraph Shop
    check(Check Order) --> ship(Ship Goods)
  end
  order --> check
  ship --> receive`,
    snippets: [
      { name: "Lane", text: "  subgraph NewLane\n    step(New Step)\n  end" },
      { name: "Step", text: "  a(Do something) --> b(Do the next thing)" },
      { name: "Decision", text: "  ask{ } -->|yes| one(One way)\n  ask -->|no| other(Other way)" },
    ],
  },
  {
    type: "state",
    name: "State machine",
    about: "The states of a thing and what moves it between them",
    starter: `stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted : submit
  Submitted --> Approved : approve
  Submitted --> Draft : reject
  Approved --> [*]`,
    snippets: [
      { name: "State", text: '  state "New State" as NewState' },
      { name: "Transition", text: "  A --> B : event" },
      { name: "Start", text: "  [*] --> First" },
      { name: "End", text: "  Last --> [*]" },
      { name: "Composite", text: "  state Outer {\n    [*] --> Inner\n    Inner --> [*]\n  }" },
      { name: "Note", text: "  note right of A : A note" },
    ],
  },
  {
    type: "sequence",
    name: "Sequence diagram",
    about: "Messages between participants over time",
    starter: `sequenceDiagram
  participant U as User
  participant S as Shop
  participant P as Payment
  U->>S: place order
  S->>P: charge
  P-->>S: paid
  S-->>U: confirmation`,
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
];

export const typeInfo = (type: DiagramType): TypeInfo =>
  TYPES.find((item) => item.type === type) ?? TYPES[0];

/** The type of a source: a Mermaid header names a UML type, anything else is a block diagram. */
export const typeOf = (source: string): DiagramType => detectUml(source) ?? "tam";
