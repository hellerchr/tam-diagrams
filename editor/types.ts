/**
 * The diagram types the editor works with: TAM block diagrams, edited on the canvas, and the UML
 * diagrams the library draws from Mermaid sources, edited as text with a live picture.
 */

import { TAM_EXAMPLES } from "../src/samples/tam-examples.ts";
import {
  CLASS_EXAMPLES,
  ER_EXAMPLES,
  FLOWCHART_EXAMPLES,
  SEQUENCE_EXAMPLES,
  STATE_EXAMPLES,
  SWIMLANE_EXAMPLES,
  USECASE_EXAMPLES,
} from "../src/samples/uml-examples.ts";
import type { ElementKind } from "../src/tam-edit.ts";
import { detectUml, type UmlKind } from "../src/uml.ts";
import type { IconName } from "./icons.ts";
import { structureOf } from "./structures.ts";

export type DiagramType = "tam" | UmlKind;

/** A piece of source a click adds: the usual statements of a diagram type. */
export interface Snippet {
  name: string;
  /** The drawing of what the statement adds. */
  icon: IconName;
  text: string;
}

/** A shape of the palette: an element kind to drag onto the canvas. */
export interface Shape {
  kind: ElementKind;
  icon: IconName;
  name: string;
  /** The key that picks it as the tool. */
  key?: string;
  /** What the element stands for, for its tooltip. */
  hint: string;
}

/** Shapes that belong together in the palette: a level of the notation. */
export interface ShapeGroup {
  title: string;
  items: Shape[];
}

/** A diagram to start from: its name and its source. */
export type Example = [name: string, source: string];

/** The examples to offer of a list of samples: a few that show the type well, under names for a reader. */
function examples(samples: [string, string][], names: Record<string, string>): Example[] {
  return Object.entries(names).flatMap(([name, shown]) => {
    const found = samples.find(([sample]) => sample === name);
    return found ? [[shown, found[1]] as Example] : [];
  });
}

export interface TypeInfo {
  type: DiagramType;
  name: string;
  /** The name for several, as in "Class diagrams are edited as text". */
  plural: string;
  icon: IconName;
  /** Whether the diagram is edited on the canvas, or as text with the picture as a preview. */
  mode: "canvas" | "structure" | "text";
  /** The shapes to drag onto the canvas; none for a type edited as text. */
  palette: ShapeGroup[];
  /** Diagrams of the type to open and learn from. */
  examples: Example[];
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
    plural: "Block diagrams",
    icon: "logo",
    mode: "canvas",
    palette: [
      {
        title: "Block diagram",
        items: [
          {
            kind: "agent",
            icon: "agent",
            name: "Agent",
            key: "A",
            hint: "Does something: a service, a process",
          },
          {
            kind: "human",
            icon: "human",
            name: "Human",
            key: "U",
            hint: "A person who uses the system",
          },
          {
            kind: "storage",
            icon: "storage",
            name: "Storage",
            key: "S",
            hint: "Keeps information: a database, a file",
          },
          {
            kind: "group",
            icon: "group",
            name: "Group",
            key: "G",
            hint: "A frame around elements",
          },
        ],
      },
      {
        title: "Design level",
        items: [
          {
            kind: "component",
            icon: "component",
            name: "Component",
            hint: "A replaceable part with interfaces",
          },
          {
            kind: "subsystem",
            icon: "subsystem",
            name: "Subsystem",
            hint: "A part of the system made of components",
          },
          { kind: "class", icon: "class", name: "Class", hint: "A class of the implementation" },
          { kind: "package", icon: "package", name: "Package", hint: "A unit of the source code" },
        ],
      },
    ],
    examples: examples(TAM_EXAMPLES, {
      "flyer: web service landscape": "Web service landscape",
      "standard figure 2-1: web server": "Web server",
      "protocols, data flow and dependencies": "Protocols, data flow and dependencies",
      "design level: components and interfaces": "Components and interfaces",
      "package dependencies": "Package dependencies",
      "reference: SAP blog online shop": "Online shop",
    }),
    about: "Agents, storages and the channels between them (SAP TAM, FMC)",
    starter: "",
    snippets: [],
  },
  {
    type: "class",
    name: "Class diagram",
    plural: "Class diagrams",
    icon: "class",
    mode: "text",
    palette: [],
    examples: examples(CLASS_EXAMPLES, {
      "class: harness session (mermaid-demo)": "Session, kernel and agent",
    }),
    about: "Classes with members, inheritance and associations",
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
  Order "1" *-- "*" OrderItem`,
    snippets: [
      {
        name: "Class",
        icon: "class",
        text: "  class NewClass {\n    +field: string\n    +method()\n  }",
      },
      {
        name: "Interface",
        icon: "uml-interface",
        text: "  class NewInterface {\n    <<interface>>\n    +method()\n  }",
      },
      { name: "Inheritance", icon: "uml-inherit", text: "  Base <|-- Derived" },
      { name: "Association", icon: "uml-arrow", text: '  A "1" --> "*" B : has' },
      { name: "Composition", icon: "uml-compose", text: "  Whole *-- Part" },
      { name: "Dependency", icon: "uml-dashed", text: "  A ..> B : uses" },
    ],
  },
  {
    type: "usecase",
    name: "Use case diagram",
    plural: "Use case diagrams",
    icon: "usecase",
    mode: "text",
    palette: [],
    examples: examples(USECASE_EXAMPLES, {
      "usecase: purchasing (docs/tam.md)": "Purchasing",
      "usecase: TAM flyer": "Web shop",
      "usecase: library TB with notes": "Library with notes",
      "usecase: actors and generalization": "Actors and generalization",
      "usecase: two systems": "Two systems",
      "usecase: bank (large)": "Bank",
    }),
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
      { name: "Actor", icon: "uml-actor", text: "  actor NewActor" },
      { name: "Use case", icon: "uml-usecase", text: "  newCase(New Use Case)" },
      {
        name: "System",
        icon: "uml-system",
        text: "  systemBoundary sys[System]\n    inner(Inner Use Case)\n  end",
      },
      { name: "Association", icon: "uml-arrow", text: "  NewActor --> newCase" },
      { name: "Include", icon: "uml-dashed", text: "  newCase ..> : include inner" },
    ],
  },
  {
    type: "flowchart",
    name: "Activity diagram",
    plural: "Activity diagrams",
    icon: "flowchart",
    mode: "text",
    palette: [],
    examples: examples(FLOWCHART_EXAMPLES, {
      "flowchart: harness turn (mermaid-demo)": "Agent turn",
      "flowchart: login decisions": "Login decisions",
      "flowchart: node shapes": "Node shapes",
      "flowchart: nested subgraphs LR": "Nested groups",
      "flowchart: CI pipeline (large)": "CI pipeline",
    }),
    about: "Steps and decisions of a flow",
    starter: `flowchart TB
  start((Start)) --> check{In stock?}
  check -->|yes| ship[Ship order]
  check -->|no| wait[Wait for supply]
  wait --> check
  ship --> done(((End)))`,
    snippets: [
      {
        name: "Step",
        icon: "uml-step",

        text: "  a[Do something] --> b[Do the next thing]",
      },
      {
        name: "Decision",
        icon: "uml-decision",

        text: "  ask{Decide?} -->|yes| one[One way]\n  ask -->|no| other[Other way]",
      },
      {
        name: "Start",
        icon: "uml-start",

        text: "  start((Start)) --> first[First step]",
      },
      { name: "End", icon: "uml-end", text: "  last[Last step] --> stop(((End)))" },
      {
        name: "Group",
        icon: "group",

        text: "  subgraph part [A part]\n    x[Inside] --> y[Also inside]\n  end",
      },
    ],
  },
  {
    type: "swimlane",
    name: "Activity with lanes",
    plural: "Activities with lanes",
    icon: "swimlane",
    mode: "text",
    palette: [],
    examples: examples(SWIMLANE_EXAMPLES, {
      "swimlane: TAM flyer activity": "Order handling",
      "swimlane: request and response (docs/tam.md)": "Request and response",
      "swimlane: order fulfilment LR": "Order fulfilment",
      "swimlane: incident handling (large)": "Incident handling",
    }),
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
      {
        name: "Lane",
        icon: "uml-lane",

        text: "  subgraph NewLane\n    step(New Step)\n  end",
      },
      {
        name: "Step",
        icon: "uml-step",

        text: "  a(Do something) --> b(Do the next thing)",
      },
      {
        name: "Decision",
        icon: "uml-decision",

        text: "  ask{ } -->|yes| one(One way)\n  ask -->|no| other(Other way)",
      },
    ],
  },
  {
    type: "state",
    name: "State machine",
    plural: "State machines",
    icon: "state",
    mode: "text",
    palette: [],
    examples: examples(STATE_EXAMPLES, {
      "state: TAM flyer": "Document approval",
      "state: composite and nested (Mermaid docs)": "Composite states",
      "state: choice, fork and join": "Choice, fork and join",
      "state: concurrency (Mermaid docs)": "Concurrency",
      "state: notes and descriptions LR": "Notes and descriptions",
      "state: order lifecycle (large)": "Order lifecycle",
    }),
    about: "The states of a thing and what moves it between them",
    starter: `stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted : submit
  Submitted --> Approved : approve
  Submitted --> Draft : reject
  Approved --> [*]`,
    snippets: [
      { name: "State", icon: "uml-step", text: '  state "New State" as NewState' },
      { name: "Transition", icon: "uml-arrow", text: "  A --> B : event" },
      { name: "Start", icon: "uml-start", text: "  [*] --> First" },
      { name: "End", icon: "uml-end", text: "  Last --> [*]" },
      {
        name: "Composite",
        icon: "uml-composite",
        text: "  state Outer {\n    [*] --> Inner\n    Inner --> [*]\n  }",
      },
      { name: "Note", icon: "uml-note", text: "  note right of A : A note" },
    ],
  },
  {
    type: "sequence",
    name: "Sequence diagram",
    plural: "Sequence diagrams",
    icon: "sequence",
    mode: "text",
    palette: [],
    examples: examples(SEQUENCE_EXAMPLES, {
      "sequence: harness turn (mermaid-demo)": "Agent turn",
      "sequence: TAM flyer": "Web shop order",
      "sequence: fragments (Mermaid docs)": "Fragments",
      "sequence: arrows, notes and self messages": "Arrows, notes and self messages",
      "sequence: groups with boxes": "Groups with boxes",
      "sequence: checkout (large)": "Checkout",
    }),
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
      { name: "Participant", icon: "uml-participant", text: "  participant N as New" },
      { name: "Actor", icon: "uml-actor", text: "  actor A as Person" },
      { name: "Message", icon: "uml-message", text: "  A->>B: message" },
      { name: "Reply", icon: "uml-reply", text: "  B-->>A: reply" },
      {
        name: "Alternative",
        icon: "uml-frame",
        text: "  alt condition\n    A->>B: one\n  else otherwise\n    A->>B: other\n  end",
      },
      { name: "Loop", icon: "uml-loop", text: "  loop every time\n    A->>B: again\n  end" },
      { name: "Note", icon: "uml-note", text: "  Note over A,B: A note" },
    ],
  },
  {
    type: "er",
    name: "ER diagram",
    plural: "ER diagrams",
    icon: "er",
    mode: "text",
    palette: [],
    examples: examples(ER_EXAMPLES, {
      "er: order example (Mermaid docs)": "Order example",
      "er: every cardinality": "Every cardinality",
      "er: self-relationship and parallel relationships": "Self and parallel relationships",
      "er: aliases, keys and comments": "Aliases, keys and comments",
      "er: library BT with non-identifying relationships": "Library",
      "er: order management (large)": "Order management",
    }),
    about:
      "Entity relationships: entities with their attributes, and how many of each belong together",
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
  }`,
    snippets: [
      {
        name: "Entity",
        icon: "uml-entity",
        text: "  ENTITY {\n    int id PK\n    string name\n  }",
      },
      { name: "One to many", icon: "er-one-to-many", text: "  A ||--o{ B : has" },
      { name: "Many to one", icon: "er-many-to-one", text: '  A }o--|| B : "belongs to"' },
      { name: "One to one", icon: "er-one-to-one", text: "  A ||--|| B : is" },
      { name: "Many to many", icon: "er-many-to-many", text: "  A }o--o{ B : has" },
    ],
  },
];

// A type with a structure is edited on the canvas, whatever else the table says of it.
for (const info of TYPES) if (structureOf(info.type)) info.mode = "structure";

export const typeInfo = (type: DiagramType): TypeInfo =>
  TYPES.find((item) => item.type === type) ?? TYPES[0];

/** The type of a source: a Mermaid header names a UML type, anything else is a block diagram. */
export const typeOf = (source: string): DiagramType => detectUml(source) ?? "tam";

/** The name of an element kind as the palette says it. */
export function kindName(kind: string): string {
  const shape = TYPES[0].palette.flatMap((group) => group.items).find((item) => item.kind === kind);
  return shape?.name ?? kind[0].toUpperCase() + kind.slice(1);
}

/**
 * A source with another title. A block diagram says it on a `title` line, which the library's edits
 * write; the other types say it in a frontmatter block before the diagram, which this writes.
 */
export function withUmlTitle(source: string, title: string): string {
  const name = title.trim().replace(/\s+/g, " "),
    front = source.match(/^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/),
    kept = (front?.[1].split("\n") ?? []).filter((line) => !/^title:/.test(line)),
    // As YAML reads it: plain where that is safe, else in quotes.
    quoted = /^[\p{L}\p{N}][^:#"']*$/u.test(name)
      ? name
      : !/["\\]/.test(name)
        ? `"${name}"`
        : `'${name.replace(/'/g, "''")}'`,
    lines = name ? [`title: ${quoted}`, ...kept] : kept,
    body = front ? source.slice(front[0].length) : source;
  return lines.length ? `---\n${lines.join("\n")}\n---\n${body}` : body;
}
