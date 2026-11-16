/**
 * The reference guides of the editor: for each diagram type what the diagram shows, the rules of
 * its notation, every statement its parser reads, one whole example, and what is refused. The
 * guides are data: the editor shows them beside the source (reference-dialog.ts), `guideMarkdown`
 * writes them as the pages under docs/guides, and the tests parse every row and example, so a
 * guide says nothing the parser does not do.
 */

import type { DiagramType } from "./types.ts";

/** A line of a guide's table: what is written in the source, and what it means. */
export interface GuideRow {
  /** The statement, or several lines of statements, as they stand in a source. */
  write: string;
  /** What it means; `backticks` mark code. */
  means: string;
  /** The lines that stand before the statement for it to be read; the section's, where the row has none. */
  context?: string;
  /** The lines that stand after the statement for it to be read: what closes a block it opens. */
  after?: string;
  /** The first line the row is read under, where it is not its section's or its guide's. */
  header?: string;
  /** The row is a source of its own: the header of the type is not put before it. */
  whole?: boolean;
  /** The row is no statement, such as an operator or a list of words on its own: it is not parsed. */
  fragment?: boolean;
  /** The parser refuses the statement; the meaning says why, and what to write instead. */
  refused?: boolean;
}

/** A part of a guide under its title: a paragraph, a list of rules, a table of rows, an example, or several of them. */
export interface GuideSection {
  /** The name of the section in links: unique in its guide. */
  id: string;
  title: string;
  /** A paragraph; `backticks` mark code. */
  prose?: string;
  /** The rules of the notation, one sentence or two each; `backticks` mark code. */
  rules?: string[];
  /**
   * The first line the rows of the section are read under, where it is not the guide's: the
   * lanes of an activity diagram are read under `swimlane-beta`.
   */
  header?: string;
  /** The lines that stand before each row of the section, where the row says nothing else. */
  context?: string;
  rows?: GuideRow[];
  /** A whole diagram of the type. */
  example?: string;
}

/** The guide of a diagram type. */
export interface Guide {
  type: DiagramType;
  /** The name of the diagram, as the guide's title says it. */
  name: string;
  /** What the diagram shows, in one line, for the list of all guides. */
  about: string;
  /** The first line of a source of the type; empty for a block diagram, which has none. */
  header: string;
  sections: GuideSection[];
}

/** A row of a table. */
const row = (write: string, means: string, more: Partial<GuideRow> = {}): GuideRow => ({
  write,
  means,
  ...more,
});

/** A row the parser refuses. */
const no = (write: string, means: string, more: Partial<GuideRow> = {}): GuideRow =>
  row(write, means, { ...more, refused: true });

/** A row that is no statement of its own. */
const part = (write: string, means: string): GuideRow => row(write, means, { fragment: true });

/** The first lines every Mermaid type shares: a title in frontmatter, and comments. */
const front = (header: string, body: string, level?: string): GuideRow[] => [
  row("---\ntitle: Order system\n---", "The title, in a frontmatter block before the first line.", {
    after: `${header}\n${body}`,
    whole: true,
  }),
  ...(level
    ? [
        row("%% level conceptual", level, {
          whole: true,
          after: `${header}\n${body}`,
        }),
      ]
    : []),
  row("%% a remark", "A comment: a line of its own that starts with `%%`."),
];

/** How the text of a label is written, in every Mermaid type. */
const TEXT =
  "`<br>` breaks a line. `#quot;` writes a quote, `#35;` the character with that number.";

/**
 * The section on the lines that place the parts of a Mermaid diagram by hand: `id` is a part of
 * the lines in `context`, `what` says which parts take a place and under which id. `edge` is the
 * id of the first connection, whose label is placed: a letter of the type and a count.
 */
const place = (
  id: string,
  context: string,
  what: string,
  edge: string,
  more: GuideRow[] = [],
): GuideSection => ({
  id: "positions",
  title: "Positions",
  prose: `Without positions the diagram lays itself out. Moving a part in the editor writes a position for every part, as comment lines at the end of the source, so the source stays valid Mermaid. ${what}`,
  context,
  rows: [
    row(
      `%% @${id} 120,40`,
      "The part with this id stands with its top left corner at x 120, y 40, in pixels, y down. A part without such a line stays where the layout puts it; without any such line the layout is automatic again.",
    ),
    row(
      `%% @label:${edge} +20,-14`,
      `The label of the connection \`${edge}\`, the first in the source (\`${edge.replace(/\d+$/, "")}2\` the second, and so on), stands with its middle 20 right of and 14 above the middle of its line, which it keeps to when the line moves. Dragging a label in the editor writes it.`,
    ),
    ...more,
  ],
});

const TAM_CONTEXT = "agent a[A]\nagent b[B]\nagent c[C]\nstorage s[S]\nstorage t[T]";

const TAM: Guide = {
  type: "tam",
  name: "TAM block diagram",
  about: "Compositional structure of a system: agents, storages, channels and accesses",
  header: "",
  sections: [
    {
      id: "about",
      title: "What it shows",
      prose:
        "A block diagram shows the compositional structure of a system: agents as active structure elements, storages and channels as passive ones, the channels over which agents communicate and the read and write accesses of agents to storages. Use it for the system's components and their communication paths. The editor offers plain block diagrams; the design level of the standard is read and drawn too, and has a section of its own at the end.",
    },
    {
      id: "rules",
      title: "Rules of the notation",
      prose: "The parser enforces the SAP TAM standard and names the line that breaks a rule.",
      rules: [
        "Agents are active structure elements: they process information. A human agent is an agent that is a person. Storages and channels are passive structure elements: a storage stores information, a channel transmits it.",
        "Active and passive elements alternate. Agents communicate over channels and access storages by read and write accesses; a storage is never joined to a storage by a flow, only by a `pointer`.",
        "A channel joins agents only: agents, human agents, and groups of them.",
        "A request/response channel is unidirectional or bidirectional. A data flow channel is unidirectional; data in both directions takes two channels.",
        "An access joins one active element and one storage, and is written from the active element. `writes` points to the storage, `reads` points from it, `reads/writes` is a modifying access. An access has no protocol.",
        "An agent holds agents and storages. A human agent holds nothing. A storage holds only storages.",
        "A container stands for its parts: a container and one of its own parts are never connected.",
        "A `pointer` joins two storages; `create` and `generate` join active elements.",
        "Only agents and storages are shown as several (`stack`, `...`). Dots stand between elements of one kind.",
        "A note remarks on the diagram and takes part in no rule of the notation: it is neither active nor passive, holds nothing, and stands at the top or in any container. Dots and groups do not count it.",
        "`-.-` attaches a note to an element: it joins exactly one note and one element. A note has no other connection. A note on an element shown as several is attached to the original.",
        "Elements do not overlap. In a layout by hand the editor and `check` say which do.",
        "An id starts with a letter or `_` and goes on with letters, digits and `_`. Every id is declared once; a connection may stand before or after the declarations of its ends.",
        "A diagram has at most 300 elements, 400 lines and 20,000 characters.",
      ],
    },
    {
      id: "diagram",
      title: "Diagram",
      context: "agent a[A]",
      rows: [
        row("title Order system", "The title above the diagram. Quotes around it are optional."),
        row(
          "direction LR",
          "The way the automatic layout runs: `TB` (top to bottom, the default) or `LR` (left to right). `TD` is `TB`.",
        ),
        row("%% a remark", "A comment, to the end of its line. It may follow a statement."),
      ],
    },
    {
      id: "elements",
      title: "Elements",
      rows: [
        row("agent api[Order API]", "An agent: a kind, an id, and the name in brackets."),
        row('agent api "Order API"', "The name in quotes works too."),
        row("agent api", "Without a name the id is shown."),
        row("agent api[]", "Empty brackets: no text."),
        row("agent api[Order<br>API]", "`<br>` breaks the name."),
        row("human customer[Customer]", "A human agent, drawn with a figure."),
        row("storage db[Orders]", "A storage: a passive structure element, drawn rounded."),
      ],
    },
    {
      id: "nesting",
      title: "Nesting and grouping",
      rows: [
        row(
          "agent shop[Web Shop] {\n  agent api[Order API]\n  storage cart[Cart]\n}",
          "A container: its parts stand on the lines between `{` and `}`. The `}` is a line of its own.",
        ),
        row(
          "group {\n  agent a1[Worker]\n  agent a2[Planner]\n}",
          "A group: a thin frame around elements that share channels and accesses. It needs no id. A group of storages counts as a storage.",
        ),
        row(
          "group pool[Workers] {\n  agent a1[Worker]\n}",
          "A group with an id can be an end of a connection; the name is optional.",
        ),
        row("agent shop[Web Shop] {}", "`{}` on the line: an element without parts."),
      ],
    },
    {
      id: "several",
      title: "Several of a kind",
      rows: [
        row("agent worker[Worker] stack", "Several, drawn as a stack. A container may be a stack."),
        row(
          "storage log[Log] ...",
          "Several, drawn as two with dots between. Each connection goes to both. Not for containers.",
        ),
        row(
          "agent first[First]\n...\nagent last[Last]",
          "A line of three dots between two elements of one kind: more of them stand between, side by side.",
        ),
      ],
    },
    {
      id: "notes",
      title: "Notes",
      prose:
        "A note is a remark in a box with a folded corner, attached to what it remarks on by a dotted line.",
      context: TAM_CONTEXT,
      rows: [
        row(
          "note vat[Remember VAT]",
          "A note: the kind, an id and its text in brackets. `<br>` breaks the text.",
        ),
        row(
          "note [Remember VAT]",
          "Without an id: a note that stands alone, since no line can name it.",
        ),
        row(
          "note vat[Remember VAT]:::yellow @40,400 140x60",
          "Color, position and size as for any element.",
        ),
        row(
          "vat -.- a",
          "A dotted line attaches the note to an element, in either order: `a -.- vat` is the same.",
          { context: `${TAM_CONTEXT}\nnote vat[Remember VAT]` },
        ),
        row(
          "agent shop[Web Shop] {\n  agent api[Order API]\n  note check[Check stock first]\n}",
          "A note in a container stands among its parts.",
        ),
      ],
    },
    {
      id: "look",
      title: "Color, position and size",
      prose:
        "Color, `stack`, `...` and positions follow the name in any order; an opening `{` comes last.",
      rows: [
        row(
          "storage cart[Cart]:::blue",
          "A color: `blue`, `orange`, `green`, `yellow`, `pink`, `purple`, `red` or `gray`.",
        ),
        row(
          "agent api[Order API] @250,90",
          "A position: the top left corner in pixels, y down. One position is enough to lay the diagram out by hand; elements without one stand in a row below the placed ones.",
        ),
        row(
          "agent api[Order API] @250,90 140x40",
          "A position and a least size, width x height. An element is never smaller than its name, a container never smaller than its parts.",
        ),
        row(
          "agent worker[Worker] ... @450,90 @450,160",
          "With `...` a second position places the copy. It takes no size.",
        ),
        row(
          "a -- calls: place order --> b @+20,-14",
          "Behind a connection, signed: its label stands with its middle 20 right of and 14 above the middle of the line, a channel's circle, and keeps to it when the line moves. A statement of several connections takes none. Dragging a label in the editor writes it.",
          { context: "agent a[A]\nagent b[B]" },
        ),
      ],
    },
    {
      id: "channels",
      title: "Channels: agent to agent",
      context: TAM_CONTEXT,
      rows: [
        row("a -- calls --> b", "A request/response channel: `a` is the client, `b` the server."),
        row("a <-- calls --> b", "A bidirectional request/response channel."),
        row("a -- sends data --> b", "A unidirectional data flow channel from `a` to `b`."),
        row("a --- b", "A channel without a direction."),
        row("a -- calls: place order --> b", "A label follows the word after a colon."),
        row(
          "a -- calls @HTTPS --> b",
          "A protocol follows `@`. Channels of one protocol in a row share a dashed protocol boundary.",
        ),
        row("a -- calls: place order @HTTPS --> b", "Word, label and protocol together."),
        row("a -- orders --- b", "A channel without a direction takes a label without a word."),
        row("a -- orders @AMQP --- b", "And a protocol."),
        row(
          'a -- calls: "ratio 1:2" @"HTTP/2" --> b',
          "Quotes keep a `:` or `@` inside a label or a protocol.",
        ),
      ],
    },
    {
      id: "accesses",
      title: "Accesses: active element to storage",
      context: TAM_CONTEXT,
      rows: [
        row("a -- reads --> s", "A read access: `a` reads `s`. The arrow points from the storage."),
        row("a -- writes --> s", "A write access. The arrow points to the storage."),
        row("a -- reads/writes --> s", "A modifying (read/write) access of `a` to `s`."),
        row("a -- writes: new orders --> s", "A label follows the word after a colon."),
      ],
    },
    {
      id: "dependencies",
      title: "Dependencies",
      prose:
        "A dashed arrow with its keyword in «». It carries the keyword only: no label, no protocol.",
      context: TAM_CONTEXT,
      rows: [
        row("a -. create .-> b", "`a` creates `b` at run time. Between active elements."),
        row("a -. generate .-> b", "`a` generates `b`. Between active elements."),
        row("s -. pointer .-> t", "`s` holds a reference to `t`. Between two storages."),
      ],
    },
    {
      id: "ends",
      title: "Several ends, chains and words",
      context: TAM_CONTEXT,
      rows: [
        row(
          "a & b -- reads --> s",
          "`&` lists several ends: every one on the left to every one on the right.",
        ),
        row("a --- b --- c", "A chain: each link is a connection of its own."),
        row(
          "a -- Read --> s",
          "Words are read without case, singular or plural: `read`, `Reads`, `send data`.",
        ),
        part(
          "reads  writes  reads/writes  sends data  calls  delegates  requires",
          "The words of a solid arrow. Anything else goes in the label, after a colon.",
        ),
        part("use  import  create  generate  pointer", "The keywords of a dashed arrow."),
      ],
    },
    {
      id: "design",
      title: "Design level and package diagrams",
      prose:
        "The parser reads the design level of the standard and package diagrams, and the editor draws them and keeps them editable as text; its palette, completion and properties offer the plain block diagram. Components, subsystems and classes connect through interfaces, not channels. A component or a class holds components, classes and storages; a subsystem holds these and subsystems, never agents. A package holds packages, classes, components and subsystems, stands at the top, in a package or in a group, and connects only through dependencies. A container and its part are joined only by `delegates`. `level conceptual` allows agents, storages, channels and accesses only; `level design` allows everything, as no level line does.",
      context: "component c[C]\ncomponent d[D]",
      rows: [
        row("level conceptual", "Only agents, storages, channels and accesses are allowed.", {
          context: "agent a[A]",
        }),
        row("level design", "Components, subsystems, classes, packages and interfaces too.", {
          context: "agent a[A]",
        }),
        row("component billing[Billing]", "A component, with provided and required interfaces."),
        row("subsystem erp[ERP]", "A subsystem, marked «subsystem»."),
        row("class Order[Order]", "A class."),
        row("package ui[UI]", "A package of a package diagram."),
        row(
          "c -- requires IOrders --> d",
          "`c` requires the interface `IOrders` that `d` provides: a ball at `d` in a socket of `c`.",
        ),
        row("c -- requires --> d", "The same without a name."),
        row("c -- requires IOrders @REST --> d", "A protocol follows `@`."),
        row("c provides IRefund", "An interface `c` provides, without a partner."),
        row("c requires ILog", "An interface `c` requires, without a partner."),
        row(
          "outer -- delegates --> inner",
          "Delegation from a container to one of its own parts. The only connection between the two.",
          { context: "component outer[Outer] {\n  component inner[Inner]\n}" },
        ),
        row("p -. use .-> q", "A «use» dependency of `p` on `q`.", {
          context: "package p[P]\npackage q[Q]",
        }),
        row("p -. import .-> q", "A package import of `q` into `p`.", {
          context: "package p[P]\npackage q[Q]",
        }),
      ],
    },
    {
      id: "example",
      title: "Example",
      example: `title Order system
direction LR
human customer[Customer]
agent shop[Web Shop] {
  agent api[Order API]
  storage cart[Cart]:::blue
}
agent payment[Payment Service] stack
storage db[Orders]
customer -- calls: place order @HTTPS --> api
api -- reads/writes --> cart
api -- writes --> db
api <-- calls --> payment`,
    },
    {
      id: "refused",
      title: "Not accepted",
      prose:
        "The syntax borrows Mermaid's arrows, not Mermaid's flowchart: shapes in brackets, `subgraph`, `style` and `classDef` are not read.",
      context: TAM_CONTEXT,
      rows: [
        no("a --> b", "An arrow says what happens: `a -- calls --> b`."),
        no(
          "a -->|orders| b",
          "The text stands inside the arrow, after a word: `a -- calls: orders --> b`.",
        ),
        no("a -- uses --> b", "`uses` is no connection word. Write `a -- calls: uses --> b`."),
        no(
          "s -- reads --> a",
          "A storage is passive. Write the access from the agent: `a -- reads --> s`.",
        ),
        no("a -- calls --> s", "A storage is read or written, not called: `a -- reads --> s`."),
        no("s -- sends data --> t", "Storages are joined only by `s -. pointer .-> t`."),
        no(
          "a <-- sends data --> b",
          "A data flow channel is unidirectional. Write two channels, or `a <-- calls --> b`.",
        ),
        no("a -- reads @SQL --> s", "An access has no protocol."),
        no("a -. use: orders .-> b", "A dependency carries only its keyword."),
        no("shop -- calls --> api", "A container is not connected to its own part.", {
          context: "agent shop[Shop] {\n  agent api[API]\n}",
        }),
        no("a -- calls --> x", "Every id is declared: `agent x[Name]`."),
        no("agent web-server[Web]", "An id has letters, digits and `_` only."),
        no("agent api[API]:::teal", "No such color."),
        no("n -- calls --> a", "A note only hangs on a dotted line: `n -.- a`.", {
          context: `${TAM_CONTEXT}\nnote n[N]`,
        }),
        no("a -.- b", "`-.-` attaches a note: one of its ends is a note."),
        no("note n[N] {\n  agent x[X]\n}", "A note holds nothing."),
        no("subgraph backend", "Write a container, `agent backend[Backend] {`, or a `group {`."),
        no("style a fill:#f96", "Colors are given with `:::name` on the declaration."),
      ],
    },
  ],
};

const CLASS: Guide = {
  type: "class",
  name: "Class diagram",
  about: "Classes with their attributes and operations, and the relations between them",
  header: "classDiagram",
  sections: [
    {
      id: "about",
      title: "What it shows",
      prose:
        "A class diagram shows classes with their attributes and operations and how they relate: by generalization, association, aggregation, composition, dependency and realization. Use it for the static structure of software or of a domain. It is written in Mermaid's `classDiagram` syntax.",
    },
    {
      id: "rules",
      title: "Rules of the notation",
      rules: [
        "A class is a box with its name, its attributes and its operations. A member with `(` is an operation, any other an attribute.",
        "Generalization: a solid line with a hollow triangle at the general class. Realization: the same dashed, the triangle at the interface.",
        "Composition: a filled diamond at the composite, which owns the lifecycle of its parts. Shared aggregation: a hollow diamond at the aggregate.",
        "Association: a solid line. An open arrowhead marks the navigable end; multiplicities stand beside the ends.",
        "Dependency: a dashed line with an open arrowhead at the supplier.",
        "A class exists as soon as a statement names it. A relation needs no declaration of its ends.",
        "A namespace is drawn as a package. It only declares classes: a class belongs to the namespace its `class` statement stands in, and relations stand outside all namespaces.",
        "`%% level conceptual` is TAM's conceptual level: no visibility, interfaces, templates, realization or dependencies.",
        "A diagram has at most 200 classes, 60 members in a class, and 20,000 characters.",
      ],
    },
    {
      id: "diagram",
      title: "Diagram",
      context: "class Order",
      rows: [
        row("classDiagram", "The first line. `classDiagram-v2` is read the same.", {
          whole: true,
          after: "class Order",
        }),
        ...front(
          "classDiagram",
          "class Order",
          "TAM's conceptual level, as a comment before or after the first line. `%% level design` allows everything, as no level does.",
        ),
        row("direction LR", "The way the layout runs: `TB` (the default) or `LR`. `TD` is `TB`."),
      ],
    },
    {
      id: "classes",
      title: "Classes",
      rows: [
        row("class Order", "A class. Its name is letters, digits, `_` and `.`."),
        row('class Order["Customer order"]', "A class with a text of its own to show."),
        row("class `Order Item`", "Backticks allow any name."),
        row("class List~T~", "A template: shown as `List<T>`."),
        row("class Shape <<abstract>>", "An annotation, shown as «abstract» above the name."),
        row("<<interface>> Payable", "An annotation as a statement of its own."),
        row(
          "class Order {\n  +id: int\n  +total() Money\n}",
          "A class with its members, one on each line between `{` and `}`.",
        ),
        row("class Order { +id: int }", "One member on the line of the class."),
        row("Order : +id int", "A member added from outside the braces."),
      ],
    },
    {
      id: "members",
      title: "Members",
      prose: "A member is shown as it is written. These signs are read:",
      rows: [
        row(
          "class Order {\n  +id: int\n  -secret: string\n  #state: State\n  ~count: int\n}",
          "Visibility before the name: `+` public, `-` private, `#` protected, `~` package.",
        ),
        row(
          "class Order {\n  +total() Money\n  +find(id: int): Order\n}",
          "An operation with its result after the brackets, with or without a colon. Shown as `total() : Money`.",
        ),
        row("class Order {\n  +count() int$\n}", "`$` at the end: static, underlined."),
        row("class Shape {\n  +area() float*\n}", "`*` at the end: abstract, in italics."),
        row("class Cart {\n  +items: List~Item~\n}", "`~T~` in a type is shown as `<T>`."),
        row(
          "class Payable {\n  <<interface>>\n  +pay()\n}",
          "An annotation inside the braces: `<<interface>>`, `<<abstract>>`, `<<enumeration>>`, `<<service>>` or any word.",
        ),
      ],
    },
    {
      id: "relations",
      title: "Relations",
      prose:
        "One relation on a line, between two class names. Every sign may stand at either end; the line is `--` (solid) or `..` (dashed).",
      rows: [
        row(
          "Animal <|-- Dog",
          "Generalization: `Dog` specializes `Animal`. The triangle is at `Animal`.",
        ),
        row("Dog --|> Animal", "The same, written from the specific class."),
        row(
          "Order *-- OrderItem",
          "Composition: `OrderItem` is a part of the composite `Order`. Also `OrderItem --* Order`.",
        ),
        row(
          "Team o-- Player",
          "Shared aggregation: `Team` aggregates `Player`. Also `Player --o Team`.",
        ),
        row(
          "Customer --> Order",
          "Association, navigable from `Customer` to `Order`. Also `Order <-- Customer`.",
        ),
        row("Customer -- Order", "Association, navigability unspecified."),
        row("Customer <--> Order", "Association, navigable in both directions."),
        row(
          "Order ..> Mailer",
          "Dependency: `Order` is the client, `Mailer` the supplier. Also `Mailer <.. Order`.",
        ),
        row(
          "Order ..|> Payable",
          "Realization: `Order` implements `Payable`. Also `Payable <|.. Order`.",
        ),
        row("Order .. Draft", "A dashed line without ends."),
        row('Customer "1" --> "0..*" Order', "Multiplicities in quotes, beside the ends."),
        row("Customer --> Order : places", "The association's name, after a colon."),
        row('Customer "1" --> "0..*" Order : places', "Both."),
        row(
          "IPayable ()-- Order",
          "`IPayable` as a provided interface of `Order`, in ball notation.",
        ),
        row("Order --() IPayable", "The same, the ball written at the right."),
        part(
          "<|   |>   *   o   <   >   ()",
          "The end adornments: triangle, filled diamond, hollow diamond, open arrowhead, ball.",
        ),
      ],
    },
    {
      id: "namespaces",
      title: "Namespaces",
      rows: [
        row(
          "namespace shop {\n  class Order\n  class Cart\n}",
          "A package with the classes declared in it.",
        ),
        row('namespace shop["Web shop"] {\n  class Order\n}', "A package with a text of its own."),
        row(
          "namespace shop.core {\n  class Order\n}",
          "A dot nests: package `core` inside package `shop`. Namespaces may also be written inside each other.",
        ),
      ],
    },
    {
      id: "notes",
      title: "Notes",
      context: "class Order",
      rows: [
        row('note "Prices include tax"', "A note on its own."),
        row('note for Order "Created at checkout"', "A note attached to a class."),
        row(
          'note for Order "First line\\nsecond line"',
          "`\\n` or `<br>` breaks a line. `#quot;` writes a quote.",
        ),
      ],
    },
    {
      id: "ignored",
      title: "Read and not drawn",
      context: "class Order",
      rows: [
        row("Order:::important", "A style class on a class: alone, or in its `class` line."),
        row("classDef important fill:#f96", "Styles: `classDef`, `style`, `cssClass`."),
        row('click Order href "https://example.com"', "Links: `click`, `link`, `callback`."),
        row("accTitle: Orders", "Texts for screen readers: `accTitle`, `accDescr`."),
      ],
    },
    place("Order", "class Order", "A class is placed by its name.", "r1"),
    {
      id: "example",
      title: "Example",
      example: `classDiagram
  class Customer {
    +name: string
    +place(order: Order)
  }
  class Order {
    +id: int
    +total() Money
  }
  class OrderItem {
    +quantity: int
  }
  class Payable {
    <<interface>>
    +pay()
  }
  Customer "1" --> "0..*" Order : places
  Order *-- "1..*" OrderItem
  Order ..|> Payable
  Order <|-- RushOrder`,
    },
    {
      id: "refused",
      title: "Not supported",
      rows: [
        no("title Orders", "Mermaid's `title` statement. Write the title in frontmatter."),
        no("Order", "A name alone declares nothing. Write `class Order`."),
        no("A -- B -- C", "One relation on a line."),
        no("namespace shop {\n  class A\n  A --> B\n}", "Relations stand outside namespaces."),
        no("class Order {\n  +id: int", "A class body ends with `}`."),
        no(
          "class Payable {\n  <<interface>>\n}",
          "At the conceptual level: no interfaces, visibility, templates, realization or dependencies.",
          { context: "%% level conceptual" },
        ),
      ],
    },
  ],
};

const USECASE: Guide = {
  type: "usecase",
  name: "Use case diagram",
  about: "The functional scope of a subject: actors, use cases and the system boundary",
  header: "usecase-beta",
  sections: [
    {
      id: "about",
      title: "What it shows",
      prose:
        "A use case diagram shows the functional requirements of a subject: the actors external to it, the use cases inside its system boundary, and the associations between them. Use it to fix the scope of a system. It is written in Mermaid's `usecase-beta` syntax.",
    },
    {
      id: "rules",
      title: "Rules of the notation",
      rules: [
        "An actor is a role external to the subject. A human actor is drawn as a stick figure; an actor with a stereotype other than `<<human>>`, such as `<<system>>`, as a box that shows the stereotype.",
        "A use case is a behavior of the subject that yields an observable result for an actor: an ellipse inside the system boundary. Actors stand outside it.",
        "An association joins an actor and a use case: the actor participates in it.",
        "«include» goes from the including use case to the included one, whose behavior it always incorporates. «extend» goes from the extending use case to the extended one, whose behavior it conditionally augments. Both join two use cases.",
        "A generalization joins two actors or two use cases; the hollow triangle is at the general one.",
        "The parser reads a relation between any two elements. The editor's canvas offers only the pairings above.",
        "Declare an actor before a relation names it: a name a relation mentions first is a use case.",
        "One relation on a line. Relations stand outside system boundaries, and boundaries do not nest.",
        "TAM puts use case diagrams at the conceptual level: `%% level design` is refused.",
        "A diagram has at most 200 elements and 20,000 characters.",
      ],
    },
    {
      id: "diagram",
      title: "Diagram",
      context: "actor Customer",
      rows: [
        row("usecase-beta", "The first line.", { whole: true, after: "actor Customer" }),
        ...front("usecase-beta", "actor Customer"),
        row(
          "direction TB",
          "The way the layout runs: `LR` (the default) or `TB`, in capitals. `TD` is `TB`.",
        ),
      ],
    },
    {
      id: "actors",
      title: "Actors",
      rows: [
        row(
          "actor Customer",
          "An actor. Its id is letters, digits and `_`, and is shown as its name.",
        ),
        row("actor c(Retail customer)", "An id, and the name in round brackets."),
        row("actor c[Retail customer]", "Square brackets work too."),
        row('actor "Retail customer"', "A name in quotes is id and name at once."),
        row("actor Customer, Clerk", "Several actors, with commas between."),
        row("actor Bank <<system>>", "A stereotype: the actor is drawn as a box marked «system»."),
        row("actor Customer --> order", "An actor declared with a relation on the same line."),
      ],
    },
    {
      id: "usecases",
      title: "Use cases",
      rows: [
        row("order(Place order)", "A use case: an id, and the name in round brackets. An ellipse."),
        row('order("Place order: fast")', "Quotes keep brackets and signs inside a name."),
        row("order[Place order]", "Square brackets: drawn as a rectangle."),
        row('"Place order"', "A name in quotes is id and name at once."),
        row("order", "An id alone: shown as its name."),
      ],
    },
    {
      id: "boundary",
      title: "System boundary",
      rows: [
        row(
          "systemBoundary shop[Web Shop]\n  order(Place order)\n  pay(Pay)\nend",
          "The system, with the use cases declared between its line and `end`. The name stands in square or round brackets.",
        ),
        row("systemBoundary Shop\n  order(Place order)\nend", "An id alone is the name."),
        row('systemBoundary "Web Shop"\n  order(Place order)\nend', "A name in quotes."),
      ],
    },
    {
      id: "relations",
      title: "Relations",
      context: "actor Customer\nactor Clerk\norder(Place order)\npay(Pay)\nrush(Rush order)",
      rows: [
        row(
          "Customer --> order",
          "A directed association: `Customer` participates in `order`. More dashes are read the same.",
        ),
        row("Customer -- order", "An undirected association."),
        row("order <-- Customer", "The arrow written from its head."),
        row("Customer -- pays with --> pay", "A named association, the name between two dashes."),
        row("Customer -- pays with -- pay", "The same without an arrow."),
        row("order ..> : include pay", "«include»: `order` always incorporates `pay`."),
        row("rush ..> : extend order", "«extend»: `rush` conditionally extends `order`."),
        row(
          "Clerk --|> Customer",
          "Generalization: `Clerk` specializes `Customer`. Between two actors or two use cases.",
        ),
        row("Customer --o order", "A circle at the end; `o--` at the start."),
        row("Customer --x order", "A cross at the end; `x--` at the start."),
        row(
          "Customer e1@--> order",
          "An id for the relation before its arrow is read and ignored.",
        ),
      ],
    },
    {
      id: "notes",
      title: "Notes",
      context: "actor Customer\norder(Place order)",
      rows: [
        row(
          "note for order Needs a login",
          "A note at an element that is declared above. The text runs to the end of the line; quotes around it are optional. " +
            TEXT,
        ),
      ],
    },
    {
      id: "ignored",
      title: "Read and not drawn",
      context: "actor Customer\norder(Place order)",
      rows: [
        row("order(Place order):::important", "A style class on an element."),
        row("order(Place order) <<service>>", "A stereotype on a use case."),
        row("classDef important fill:#f96", "Styles: `classDef`, `class`, `style`."),
        row('actor Admin@{ icon: "user" }', "Metadata in `@{ }` after an element."),
        row("accTitle: Shop", "Texts for screen readers: `accTitle`, `accDescr`."),
      ],
    },
    place("order", "order(Place order)", "An actor or a use case is placed by its id.", "r1"),
    {
      id: "example",
      title: "Example",
      example: `usecase-beta
  actor Customer
  actor Bank <<system>>
  systemBoundary shop[Web Shop]
    browse(Browse products)
    order(Place order)
    pay(Pay)
    rush(Rush order)
  end
  Customer --> browse
  Customer --> order
  order ..> : include pay
  rush ..> : extend order
  pay --> Bank`,
    },
    {
      id: "refused",
      title: "Not supported",
      context: "actor Customer\norder(Place order)\npay(Pay)",
      rows: [
        no("order ..> pay", "A dashed arrow says what it is: `order ..> : include pay`."),
        no(
          "order ..> pay : include",
          "The keyword stands before the target: `order ..> : include pay`.",
        ),
        no(
          "Customer --> order : often",
          "A name stands inside the line: `Customer -- often --> order`.",
        ),
        no("Customer --> order --> pay", "One relation on a line."),
        no("Customer <--> order", "No arrow at both ends."),
        no(
          "order --> Clerk\nactor Clerk",
          "`Clerk` is a use case by then. Declare the actor first.",
        ),
        no(
          "systemBoundary shop\n  Customer --> order\nend",
          "Relations stand outside system boundaries.",
        ),
        no(
          "systemBoundary shop\n  systemBoundary inner\n  end\nend",
          "System boundaries do not nest.",
        ),
        no("note for Clerk Unknown", "A note names an element that is declared above it."),
        no("direction tb", "A direction is written in capitals."),
        no("title Shop", "Write the title in frontmatter."),
        no("actor Clerk %% staff", "A comment is a line of its own."),
        no('json config { "a": 1 }', "Mermaid's JSON elements."),
      ],
    },
  ],
};

/** The shapes of a node, for both kinds of activity diagram. */
const FLOW_NODES: GuideRow[] = [
  row("pack(Pack goods)", "An action: an id, and its text in round brackets. A rounded box."),
  row("pack[Pack goods]", "Square brackets are an action too, drawn the same."),
  row("ok{In stock?}", "A decision or merge node: a diamond. Its text stands beside it."),
  row(
    "start((Start))",
    "A circle. With flows that only leave it, it is the initial node: a filled dot.",
  ),
  row("done(((End)))", "A double circle. With flows that only enter it, it is the final node."),
  row(
    "pack",
    "An id alone: an action that shows its id. Flows may name nodes that are declared nowhere.",
  ),
  row('pack("Pack (all) goods")', "Quotes keep brackets and signs inside a text."),
  row('pack("`Pack **all** goods`")', "A Markdown text: shown without its emphasis signs."),
  row("pack(Pack<br>goods)", TEXT),
  row("db[(Orders)]", "A cylinder: an object node, a data store."),
  row("pill([Wait])", "Mermaid's stadium: drawn as an action."),
  row("sub[[Check credit]]", "A subroutine: a rectangle with double sides."),
  row("prep{{Prepare}}", "A hexagon."),
  row("in[/Read order/]", "A parallelogram leaning right: input or output."),
  row(String.raw`out[\Print slip\]`, "Leaning left."),
  row(String.raw`manual[/Check by hand\]`, "A trapezoid, wide at the bottom."),
  row(String.raw`prio[\Sort/]`, "A trapezoid, wide at the top."),
  row("flag>Order received]", "A flag."),
  row("split@{ shape: fork }", "A fork or join bar. `join` is the same shape."),
  row("first@{ shape: start }", "The initial node, whatever flows it has."),
  row("last@{ shape: stop }", "The final node."),
  row(
    "abort@{ shape: cross-circ }",
    "A flow final node: a crossed circle. It ends its flow, not the activity.",
  ),
  row(
    'ok@{ shape: diamond, label: "In stock?" }',
    "Any shape by its Mermaid name, with its text: `rect`, `rounded`, `stadium`, `subroutine`, `cyl`, `circle`, `dbl-circ`, `diamond`, `hex`, `lean-r`, `lean-l`, `trap-b`, `trap-t`, `odd`, and Mermaid's longer names for them.",
  ),
];

/** The flows between nodes, for both kinds of activity diagram. */
const FLOW_EDGES: GuideRow[] = [
  row("a --> b", "A control flow from `a` to `b`."),
  row(
    "a -->|yes| b",
    "A flow with a text between bars: the guard of a flow leaving a decision node.",
  ),
  row("a -- yes --> b", "The same, the text inside the arrow."),
  row("a --- b", "A line without an arrow. With a text: `a ---|text| b` or `a -- text --- b`."),
  row("a -.-> b", "A dotted flow. With a text: `a -. text .-> b`. Without an arrow: `a -.- b`."),
  row("a ==> b", "A thick flow. With a text: `a == text ==> b`. Without an arrow: `a === b`."),
  row("a <--> b", "Arrows at both ends. Also `<-.->` and `<==>`."),
  row("a --o b", "A circle at the end. Both ends: `a o--o b`."),
  row("a --x b", "A cross at the end. Both ends: `a x--x b`."),
  row("a ~~~ b", "An invisible link: it only keeps `a` before `b` in the layout."),
  row("a ----> b", "More dashes are read as the same flow."),
  row("a --> b --> c", "A chain: each arrow is a flow of its own."),
  row(
    "a & b --> c & d",
    "`&` lists several ends: every one on the left to every one on the right.",
  ),
  row("a(Pack) --> b{Ok?}", "Nodes may get their shape and text where a flow names them."),
  row("a e1@--> b", "An id for the flow before its arrow is read and ignored."),
  row("a --> b; b --> c", "`;` separates statements on one line."),
];

/** What a flowchart source may say that changes nothing in the picture. */
const FLOW_IGNORED: GuideRow[] = [
  row("a:::important --> b", "A style class on a node."),
  row("classDef important fill:#f96", "Styles: `classDef`, `class`, `style`, `linkStyle`."),
  row('click a "https://example.com"', "Links: `click`, `callback`."),
  row("direction LR", "A `direction` line: the first line says the direction."),
  row("accTitle: Shipping", "Texts for screen readers: `accTitle`, `accDescr`."),
];

const ACTIVITY_RULES = [
  "An action is an executable node of the activity. A control flow is an arrow from one node to the next.",
  "A decision node is a diamond with one incoming flow and several outgoing ones. The text of an outgoing flow is its guard, shown in square brackets. A merge node is a diamond that joins alternative flows; a diamond that does both is drawn as a merge node followed by a decision node.",
  "The initial node is a filled dot: a circle `((…))` that flows only leave. The final node is a ringed dot: a double circle `(((…)))` that flows only enter. A circle that flows enter stays a circle; a double circle that flows leave stays one.",
  "A fork node splits one flow into concurrent flows, a join node synchronizes them: `@{ shape: fork }`.",
  "A flow final node, a crossed circle, ends one flow while the others continue.",
  "Decisions, merges, initial and final nodes have no flow to themselves.",
  "A node exists as soon as a statement names it. Its shape and text may be given at any mention; the last one given counts.",
];

const FLOWCHART: Guide = {
  type: "flowchart",
  name: "Activity diagram",
  about:
    "Actions and control flow: decision, merge, fork, join, initial and final nodes, and lanes for the agents responsible",
  header: "flowchart TB",
  sections: [
    {
      id: "about",
      title: "What it shows",
      prose:
        "An activity diagram shows the control flow between actions: their order, decision and merge nodes, concurrency through fork and join nodes, and initial and final nodes. Use it for a business process or an algorithm. It is written in Mermaid's `flowchart` syntax and drawn as a UML activity diagram. Lanes are optional: in a diagram with lanes every lane is an activity partition that holds the actions of one agent, for a process that spans human agents, organizational units or systems. Such a diagram starts with `swimlane-beta` instead, and its subgraphs are its lanes.",
    },
    {
      id: "rules",
      title: "Rules of the notation",
      rules: [
        ...ACTIVITY_RULES,
        "A node stands in the subgraph where it is named first inside one.",
        "Lanes and groups do not mix: under `flowchart` every subgraph is a group, under `swimlane-beta` every subgraph is a lane.",
        "`end`, `subgraph`, `graph`, `flowchart`, `direction`, `style`, `linkStyle`, `classDef`, `class` and `click` are keywords, not ids.",
        "A diagram has at most 300 nodes, 500 flows and 20,000 characters.",
      ],
    },
    {
      id: "diagram",
      title: "Diagram",
      context: "a --> b",
      rows: [
        row(
          "flowchart TB",
          "The first line, with the way the flow runs: `TB` (top to bottom, the default) or `LR` (left to right). `TD` is `TB`; `>` and `v` point the way too.",
          { whole: true, after: "a --> b" },
        ),
        row("graph LR", "`graph` and `flowchart-elk` are read as `flowchart`.", {
          whole: true,
          after: "a --> b",
        }),
        ...front(
          "flowchart TB",
          "a --> b",
          "TAM's level, as a comment before or after the first line. An activity diagram may be of either level.",
        ),
      ],
    },
    { id: "nodes", title: "Nodes", rows: FLOW_NODES },
    {
      id: "flows",
      title: "Flows",
      prose: "A flow may be written with or without spaces around its arrow.",
      rows: FLOW_EDGES,
    },
    {
      id: "groups",
      title: "Groups",
      rows: [
        row(
          "subgraph packing [Packing]\n  box(Box it) --> label(Label it)\nend",
          "A group of activity nodes in a frame: an id, and its title in square brackets.",
        ),
        row("subgraph Packing\n  box(Box it)\nend", "An id alone is the title."),
        row('subgraph "Packing station"\n  box(Box it)\nend', "A title in quotes, without an id."),
        row("subgraph\n  box(Box it)\nend", "A frame without a title."),
        row(
          "subgraph outer\n  subgraph inner\n    box(Box it)\n  end\nend\nstart --> outer",
          "Subgraphs nest, and a flow may end at a subgraph's id.",
        ),
      ],
    },
    {
      id: "lanes",
      title: "Lanes",
      header: "swimlane-beta TB",
      rules: [
        "A diagram with lanes starts with `swimlane-beta` instead of `flowchart`, and every `subgraph` of it is a lane: an activity partition named after the agent responsible for its actions. Lanes stand side by side in the order of the source.",
        "A node stands in the lane where it is named first inside one. Nodes named in no lane share a lane without a name.",
        "Flows run from node to node, also across lanes. A flow does not end at a lane, and lanes do not nest.",
        "Lanes and groups do not mix: a diagram with lanes has no groups. A placed node stays in its lane.",
      ],
      rows: [
        row(
          "swimlane-beta TB",
          "The first line of a diagram with lanes, with the way the flow runs. `TB` (the default): lanes are columns. `LR`: lanes are rows. `TD` is `TB`; `>` and `v` point the way too.",
          { whole: true, after: "a --> b" },
        ),
        row(
          "subgraph Customer\n  order(Place order)\nend",
          "A lane with its nodes, between its line and `end`. The id is its title.",
        ),
        row(
          "subgraph shop [Web Shop]\n  check(Check order)\nend",
          "An id, and the title in square brackets.",
        ),
        row('subgraph "Web Shop"\n  check(Check order)\nend', "A title in quotes, without an id."),
        row(
          "subgraph Customer\n  order(Place order)\nend\nsubgraph Shop\n  check(Check order)\nend\norder --> check",
          "A flow from lane to lane. It may stand after the lanes or inside one.",
        ),
      ],
    },
    { id: "ignored", title: "Read and not drawn", context: "a --> b", rows: FLOW_IGNORED },
    place("pack", "pack(Pack goods)", "A node is placed by its id.", "e1", [
      row(
        "%% @lane:Customer 260",
        "In a diagram with lanes, the lane of the subgraph `Customer` is 260 wide across the lanes (high, in `LR`), never less than its nodes, its name and its labels need. Dragging the border after a lane in the editor writes it; the outer edge is the last lane's.",
        { header: "swimlane-beta TB", context: "subgraph Customer\n  order(Place order)\nend" },
      ),
    ]),
    {
      id: "example",
      title: "Example",
      example: `flowchart TB
  start((Start)) --> check{In stock?}
  check -->|yes| split@{ shape: fork }
  check -->|no| wait(Wait for supply)
  wait --> check
  split --> pack(Pack goods)
  split --> bill(Write invoice)
  pack --> joined@{ shape: join }
  bill --> joined
  joined --> ship(Ship order)
  ship --> done(((End)))`,
    },
    {
      id: "refused",
      title: "Not supported",
      context: "a --> b",
      rows: [
        no(
          "ok{In stock?} --> ok",
          "A flow from a decision, merge, initial or final node to itself.",
        ),
        no("c@{ shape: cloud }", "Mermaid's other shapes: only the ones under Nodes are drawn."),
        no('c@{ icon: "fa:user" }', "Icon and image nodes."),
        no(
          "end --> b",
          "`end` is a keyword. Name the node otherwise, or give it a text: `stop[end]`.",
        ),
        no("a --> b %% the usual way", "A comment is a line of its own."),
        no("title Shipping", "Write the title in frontmatter."),
        no("subgraph packing\n  box(Box it)", "A subgraph ends with `end`."),
        no("order --> Shop", "A flow to a lane. Name a node in it.", {
          header: "swimlane-beta TB",
          context: "subgraph Shop\n  check(Check order)\nend",
        }),
        no(
          "subgraph Store\n  subgraph Desk\n    serve(Serve)\n  end\nend",
          "A subgraph inside a lane: lanes do not nest, and a diagram with lanes has no groups.",
          { header: "swimlane-beta TB" },
        ),
      ],
    },
  ],
};

const STATE: Guide = {
  type: "state",
  name: "State machine diagram",
  about: "The states of one object and the transitions between them",
  header: "stateDiagram-v2",
  sections: [
    {
      id: "about",
      title: "What it shows",
      prose:
        "A state machine diagram shows the states of one object and the transitions between them, each triggered by an event and guarded by a condition. Use it for the lifecycle of an object, a document or a connection. It is written in Mermaid's `stateDiagram-v2` syntax.",
    },
    {
      id: "rules",
      title: "Rules of the notation",
      rules: [
        "A state is a rounded box. A transition is an arrow, labelled `event [guard] / effect`: the trigger, the guard condition, and the effect behavior. Every part is optional.",
        "`[*]` before an arrow is the initial pseudostate of its region, a filled dot: every such line starts at the same dot. `[*]` after an arrow is a final state, a ringed dot: every such line draws one of its own.",
        "A composite state contains substates and has its own initial pseudostate and final states. It shows a name only, no description.",
        "Inside a composite state `--` separates orthogonal regions, active concurrently.",
        "A choice pseudostate is a diamond: the guards of its outgoing transitions select one. It has no transition to itself.",
        "A fork pseudostate splits one transition into concurrent ones, a join pseudostate synchronizes them.",
        'A state exists as soon as a statement names it, and stands in the composite state where it is named first. Its id has no spaces and none of `:`, `-`, `{`, `}`, `"`.',
        "TAM puts state machines at the conceptual level: `%% level design` is refused, and `%% level conceptual` refuses fork and join bars.",
        "A diagram has at most 300 states and 20,000 characters.",
      ],
    },
    {
      id: "diagram",
      title: "Diagram",
      context: "[*] --> Idle",
      rows: [
        row("stateDiagram-v2", "The first line. `stateDiagram` is read the same.", {
          whole: true,
          after: "[*] --> Idle",
        }),
        ...front("stateDiagram-v2", "[*] --> Idle"),
        row(
          "direction LR",
          "The way the layout runs: `TB` (the default) or `LR`. `TD` is `TB`. Inside a composite state the line is ignored.",
        ),
      ],
    },
    {
      id: "states",
      title: "States",
      rows: [
        row("Idle", "A state: its id is its name."),
        row("state Idle", "The same with the keyword."),
        row(
          'state "Waiting for input" as Waiting',
          "A state with a name of several words, and its id.",
        ),
        row(
          "Idle : entry / reset",
          "A description below the name, such as internal behavior. Each such line adds one.",
        ),
      ],
    },
    {
      id: "transitions",
      title: "Transitions",
      rows: [
        row("Idle --> Busy", "A transition from `Idle` to `Busy`."),
        row("Idle --> Busy : start", "The trigger event, after a colon."),
        row("Idle --> Busy : start [ready] / beep", "Trigger, guard and effect. " + TEXT),
        row("[*] --> Idle", "From the initial pseudostate to the default state."),
        row("Busy --> [*]", "To a final state: the region completes."),
        row("Busy --> Busy : retry", "A self-transition."),
      ],
    },
    {
      id: "pseudo",
      title: "Choice, fork and join",
      rows: [
        row(
          "state check <<choice>>\nIdle --> check\ncheck --> Busy : [ready]\ncheck --> Failed : [else]",
          "A choice pseudostate: a diamond whose outgoing guards select the transition.",
        ),
        row(
          "state split <<fork>>\nIdle --> split\nsplit --> Printing\nsplit --> Mailing",
          "A fork pseudostate: one transition splits into concurrent ones.",
        ),
        row(
          "state merge <<join>>\nPrinting --> merge\nMailing --> merge\nmerge --> Done",
          "A join pseudostate: concurrent transitions synchronize into one.",
        ),
        row("state check [[choice]]", "Double square brackets are read like `<< >>`."),
      ],
    },
    {
      id: "composite",
      title: "Composite states and regions",
      rows: [
        row(
          "state Active {\n  [*] --> Reading\n  Reading --> Writing : edit\n  Writing --> [*]\n}",
          "A composite state: its substates and transitions stand between `{` and `}`. The `}` is a line of its own.",
        ),
        row(
          'state "In work" as Active {\n  Reading --> Writing\n}',
          "A composite state with a name of several words.",
        ),
        row(
          "state Active {\n  Reading --> Writing\n  --\n  Online --> Offline\n}",
          "`--` on a line of its own starts another orthogonal region.",
        ),
        row(
          "state Active {\n  state Editing {\n    Typing --> Saving\n  }\n}\nActive --> Closed : close\nSaving --> Closed : quit",
          "Composite states nest, and transitions go to and from a composite state or its substates.",
        ),
      ],
    },
    {
      id: "notes",
      title: "Notes",
      context: "[*] --> Idle",
      rows: [
        row(
          "note right of Idle : Waits for a job",
          "A note beside a state: `right of` or `left of`.",
        ),
        row(
          "note left of Idle\n  Waits for a job.\n  Uses no power.\nend note",
          "A note of several lines, up to `end note`.",
        ),
      ],
    },
    {
      id: "ignored",
      title: "Read and not drawn",
      context: "[*] --> Idle",
      rows: [
        row("Idle:::important --> Busy", "A style class on a state."),
        row("classDef important fill:#f96", "Styles: `classDef`, `class`, `style`."),
        row("hide empty description", "Mermaid's display options: this one and `scale 350 width`."),
        row("accTitle: Printer", "Texts for screen readers: `accTitle`, `accDescr`."),
      ],
    },
    place(
      "Idle",
      "[*] --> Idle",
      "A state is placed by its id; initial and final states have ids the editor writes.",
      "t1",
    ),
    {
      id: "example",
      title: "Example",
      example: `stateDiagram-v2
  [*] --> Draft
  Draft --> Review : submit
  state Review {
    [*] --> Reading
    Reading --> Deciding : read
    Deciding --> [*]
  }
  state verdict <<choice>>
  Review --> verdict
  verdict --> Published : [approved]
  verdict --> Draft : [rejected] / notify author
  Published --> [*]
  note right of Draft : The author may still edit`,
    },
    {
      id: "refused",
      title: "Not supported",
      context: "[*] --> Idle",
      rows: [
        no("Idle -> Busy", "A transition is written `-->`."),
        no("state check <<choice>>\ncheck --> check", "A transition from a choice to itself."),
        no("Idle --> Busy\n--\nOn --> Off", "Regions stand inside a composite state."),
        no(
          "state Active {\n  Reading\n}\nActive : busy",
          "A composite state has a name only, no description.",
        ),
        no('state "Check" as check <<choice>>', "A choice, fork or join has an id only."),
        no("state Active {}", "The braces of a composite state stand on lines of their own."),
        no("state Active {\n  Reading", "A composite state ends with `}`."),
        no("note over Idle : text", "A note stands `left of` or `right of` a state."),
        no("state Up-To-Date", 'An id has no `-`. Write `state "Up-To-Date" as UpToDate`.'),
        no("Idle --> Busy %% next", "A comment is a line of its own."),
        no("title Printer", "Write the title in frontmatter."),
        no("state split <<fork>>", "TAM's conceptual level has no fork and join bars.", {
          context: "%% level conceptual",
        }),
      ],
    },
  ],
};

const SEQUENCE_CONTEXT = "participant A\nparticipant B";

const SEQUENCE: Guide = {
  type: "sequence",
  name: "Sequence diagram",
  about: "Messages between the lifelines of agents, ordered in time",
  header: "sequenceDiagram",
  sections: [
    {
      id: "about",
      title: "What it shows",
      prose:
        "A sequence diagram shows an interaction: the messages exchanged between agents, ordered in time. Every participant is a lifeline that runs down, every message an arrow between two lifelines. Use it for one scenario of an interaction. It is written in Mermaid's `sequenceDiagram` syntax.",
    },
    {
      id: "rules",
      title: "Rules of the notation",
      rules: [
        "A participant is a box above its lifeline, an actor a stick figure. Participants stand from left to right in the order the source names them; declare them first to choose the order.",
        "A solid arrow with a filled head is a synchronous message: the sender blocks until the reply. A dashed arrow with an open head is the reply message. A solid arrow with an open head is an asynchronous message: the sender does not block.",
        "An activation bar on a lifeline is an execution specification: the participant is executing a behavior. A bar is white while its participant awaits a reply.",
        "`+` on an arrow activates the receiver, `-` ends the activation of the sender. A participant that is not active cannot be deactivated.",
        "A combined fragment frames messages under an interaction operator: `loop`, `alt`, `opt`, `par`, `critical`, `break`. `else` separates the operands of `alt`, `and` those of `par`, `option` those of `critical`. Fragments nest, and each ends with `end`.",
        "A note stands left of, right of or over one participant, or over two.",
        "A box frames a group of participants. Boxes do not nest.",
        "Creating and destroying participants belongs to TAM's design level: `%% level conceptual` refuses it.",
        "A diagram has at most 40 participants and 20,000 characters.",
      ],
    },
    {
      id: "diagram",
      title: "Diagram",
      context: "A->>B: hello",
      rows: [
        row("sequenceDiagram", "The first line.", { whole: true, after: "A->>B: hello" }),
        row("title Checkout", "The title. `title: Checkout` is read the same."),
        ...front(
          "sequenceDiagram",
          "A->>B: hello",
          "TAM's conceptual level, as a comment before or after the first line.",
        ),
        row("autonumber", "Numbers the messages that follow, from 1."),
        row("autonumber 10 5", "From 10, in steps of 5. `autonumber off` stops the numbering."),
      ],
    },
    {
      id: "participants",
      title: "Participants",
      rows: [
        row(
          "participant Shop",
          "A participant: a head box above its lifeline. Its id is its name.",
        ),
        row("participant S as Shop server", "An id, and the name to show."),
        row("actor Customer", "An actor, a human agent: a stick figure."),
        row("actor C as Retail customer", "An actor with an id and a name."),
        row("participant Web Shop", "An id may have spaces."),
        row(
          "box Backend\n  participant Shop\n  participant Bank\nend",
          "A box around participants, with its title. A color before the title, as in `box blue Backend`, is ignored.",
        ),
      ],
    },
    {
      id: "messages",
      title: "Messages",
      prose:
        "A message is two participants with an arrow between, then a colon and the text. Spaces around the arrow are optional, and so is the text. A participant a message names needs no declaration.",
      context: SEQUENCE_CONTEXT,
      rows: [
        row("A->>B: place order", "A synchronous message: solid, filled head."),
        row("B-->>A: confirmation", "A reply message: dashed, open head."),
        row("A-)B: notify", "An asynchronous message: solid, open head."),
        row("B--)A: notify back", "Dashed, open head."),
        row("A-xB: lost", "A lost message: a cross at its end. Dashed: `--x`."),
        row("A->B: hint", "A solid line without a head. Dashed: `-->`."),
        row("A<<->>B: sync", "Heads at both ends. Dashed: `<<-->>`."),
        row("A->>A: think", "A self message."),
        row("A->>B: first line<br>second line", TEXT),
      ],
    },
    {
      id: "activation",
      title: "Activation",
      context: SEQUENCE_CONTEXT,
      rows: [
        row(
          "A->>+B: place order\nB-->>-A: confirmation",
          "`+` after the arrow starts an execution specification on the receiver; `-` ends the sender's.",
        ),
        row(
          "A->>B: place order\nactivate B\nB-->>A: confirmation\ndeactivate B",
          "The same as statements of their own.",
        ),
        row(
          "A->>+B: first\nA->>+B: second\nB-->>-A: second done\nB-->>-A: first done",
          "Activations nest: each `+` opens a bar on the one before.",
        ),
      ],
    },
    {
      id: "fragments",
      title: "Fragments",
      context: SEQUENCE_CONTEXT,
      rows: [
        row(
          "loop every hour\n  A->>B: poll\nend",
          "`loop`: the operand repeats while its guard holds.",
        ),
        row(
          "alt in stock\n  B-->>A: confirmed\nelse sold out\n  B-->>A: refused\nend",
          "`alt`: the operand whose guard holds is executed. More `else` lines add operands.",
        ),
        row(
          "opt has a voucher\n  A->>B: redeem\nend",
          "`opt`: the single operand is executed only if its guard holds.",
        ),
        row(
          "par notify\n  B-)A: mail\nand book\n  B->>B: write ledger\nend",
          "`par`: the operands execute concurrently.",
        ),
        row(
          "critical reserve stock\n  A->>B: reserve\noption timeout\n  A->>B: cancel\nend",
          "`critical`: an atomic region; `option` adds the operand for its failure.",
        ),
        row(
          "break out of stock\n  B-->>A: refused\nend",
          "`break`: the operand is executed instead of the rest of the enclosing interaction.",
        ),
        row(
          "rect rgb(240, 240, 240)\n  A->>B: place order\nend",
          "A frame without a keyword around messages. The color is ignored.",
        ),
      ],
    },
    {
      id: "notes",
      title: "Notes",
      context: SEQUENCE_CONTEXT,
      rows: [
        row("note over A: Checks the cart", "A note over a lifeline."),
        row("note over A,B: Both are online", "A note over two lifelines."),
        row("note left of A: Starts here", "A note beside a lifeline: `left of` or `right of`."),
      ],
    },
    {
      id: "lifetime",
      title: "Creating and destroying: design level",
      context: SEQUENCE_CONTEXT,
      rows: [
        row(
          "create participant C\nB->>C: new",
          "The lifeline of `C` starts with the next message to it, its creation message, not at the top.",
        ),
        row("create actor C\nB->>C: welcome", "The same for an actor."),
        row(
          "destroy B\nA-xB: close",
          "The lifeline of `B` ends with a destruction occurrence at the next message to or from it.",
        ),
      ],
    },
    {
      id: "ignored",
      title: "Read and not drawn",
      context: SEQUENCE_CONTEXT,
      rows: [
        row(
          "link A: Dashboard @ https://example.com",
          "Menus of a participant: `link`, `links`, `properties`, `details`.",
        ),
        row("accTitle: Checkout", "Texts for screen readers: `accTitle`, `accDescr`."),
      ],
    },
    place(
      "head:A",
      SEQUENCE_CONTEXT,
      "Only participants are placed, by `head:` and their id, and only along their row: messages keep their order.",
      "m1",
    ),
    {
      id: "example",
      title: "Example",
      example: `sequenceDiagram
  actor C as Customer
  participant S as Shop
  participant B as Bank
  C->>+S: place order
  S->>+B: charge card
  note over S,B: The shop stores no card data
  B-->>-S: result
  alt card accepted
    S-->>C: confirmation
  else card refused
    S-->>C: ask for another card
  end
  deactivate S`,
    },
    {
      id: "refused",
      title: "Not supported",
      context: SEQUENCE_CONTEXT,
      rows: [
        no('participant D@{ "type": "database" }', "Mermaid's participant types."),
        no("par_over one\n  A->>B: x\nend", "Mermaid's `par_over`."),
        no(String.raw`A-|\B: half`, "Mermaid's half arrows."),
        no("direction LR", "Lifelines always run down."),
        no("A->>B: place order\ndeactivate B", "`B` is not active: nothing activated it."),
        no("else sold out\n  A->>B: x", "`else` stands inside `alt`."),
        no("note left of A,B: both", "Only `over` spans two participants, and none spans more."),
        no("box One\n  box Two\n  end\nend", "Boxes do not nest."),
        no("loop every hour\n  A->>B: poll", "A fragment ends with `end`."),
        no(
          "create participant C\nB->>C: new",
          "TAM's conceptual level has no creation and destruction.",
          {
            context: "%% level conceptual",
          },
        ),
      ],
    },
  ],
};

const ER: Guide = {
  type: "er",
  name: "Entity relationship diagram",
  about:
    "Entity types with their attributes and keys, and the cardinalities of their relationships",
  header: "erDiagram",
  sections: [
    {
      id: "about",
      title: "What it shows",
      prose:
        "An entity relationship diagram shows the entity types of a data model, their attributes and keys, and the relationships between them with their cardinalities. Use it for a conceptual or logical data model, or the tables of a database schema. It is written in Mermaid's `erDiagram` syntax and drawn in crow's foot notation.",
    },
    {
      id: "rules",
      title: "Rules of the notation",
      rules: [
        "An entity type is a box with its name above one row for each attribute: type, name, keys and comment.",
        "A relationship is a line between two entity types. The symbol at each end is the cardinality of that end per instance of the other: a bar is one, a ring is zero, a crow's foot is many.",
        "`CUSTOMER ||--o{ ORDER` reads from both ends: an order relates to exactly one customer, a customer to zero or more orders.",
        "A solid line is an identifying relationship: the second entity type is existence-dependent on the first and identified through it. A dashed line is a non-identifying one.",
        "An entity type exists as soon as a statement names it. Several blocks of one entity type add up their attributes. A relationship may be recursive.",
        "An attribute belongs to the keys named after it: `PK` primary, `FK` foreign, `UK` unique. A primary key attribute is underlined.",
        "A name starts with a letter or `_` and goes on with letters, digits, `_` and `-`; any other name stands in quotes.",
        "A diagram has at most 200 entities, 60 attributes in an entity, and 20,000 characters.",
      ],
    },
    {
      id: "diagram",
      title: "Diagram",
      context: "CUSTOMER",
      rows: [
        row("erDiagram", "The first line. Nothing follows it on the line.", {
          whole: true,
          after: "CUSTOMER",
        }),
        ...front("erDiagram", "CUSTOMER"),
        row("title Order model", "The title as a statement. A title in frontmatter comes first."),
        row("direction LR", "The way the layout runs: `TB` (the default) or `LR`. `TD` is `TB`."),
      ],
    },
    {
      id: "entities",
      title: "Entities",
      rows: [
        row("CUSTOMER", "An entity type without attributes."),
        row(
          'CUSTOMER["Retail customer"]',
          "An entity type with a display name. The quotes are optional.",
        ),
        row("ORDER-ITEM", "A name may have hyphens."),
        row('"Order item"', "Quotes allow any name."),
        row(
          "CUSTOMER {\n  int id PK\n  string name\n}",
          "An entity type with its attributes, one on each line between `{` and `}`.",
        ),
        row("CUSTOMER { int id PK }", "A block on one line."),
      ],
    },
    {
      id: "attributes",
      title: "Attributes",
      prose:
        "An attribute is a type and a name, then its keys, then a comment. Both type and name are single words.",
      rows: [
        row(
          "ORDER {\n  date placed\n}",
          "A type and a name. The type is any word: `int`, `string`, `varchar(20)`, `date[]`.",
        ),
        row("ORDER {\n  int id PK\n}", "A key: `PK` primary, `FK` foreign or `UK` unique."),
        row("ORDER-ITEM {\n  int orderId PK, FK\n}", "Several keys, with commas between."),
        row('ORDER {\n  string status "open, paid or sent"\n}', "A comment in quotes, at the end."),
        row('ORDER {\n  int customerId FK "who placed it"\n}', "Keys and a comment."),
        row("ORDER {\n  list~string~ tags\n}", "`~T~` in a type is shown as `<T>`."),
      ],
    },
    {
      id: "relationships",
      title: "Relationships",
      prose:
        "Two entity types with a line between, a cardinality at each end of the line, then a colon and a label. Spaces around the symbols are optional, and so are the colon and the label.",
      rows: [
        row("CUSTOMER ||--o{ ORDER : places", "One customer, zero or more orders."),
        row("ORDER ||--|{ ORDER-ITEM : contains", "One order, one or more items."),
        row("PERSON ||--o| PASSPORT : holds", "One person, zero or one passport."),
        row("PERSON ||--|| BIRTH : has", "One to exactly one."),
        row("STUDENT }o--o{ COURSE : attends", "Zero or more on both sides."),
        row("ORDER }o--|| CUSTOMER : belongs to", "Written from the many end."),
        row(
          "CUSTOMER ||..o{ ADDRESS : uses",
          "A dashed line: a non-identifying relationship. `.-` and `-.` are read the same.",
        ),
        row("EMPLOYEE |o--o{ EMPLOYEE : manages", "A recursive relationship."),
        row('CUSTOMER ||--o{ ORDER : "places: online"', "The label may stand in quotes."),
        row("CUSTOMER ||--o{ ORDER", "Without a label."),
        row(
          'CUSTOMER ||--o{ ORDER : ""',
          "Empty quotes say the same where Mermaid asks for a label.",
        ),
        part("||", "Exactly one: two bars."),
        part(
          "|o   o|",
          "Zero or one: a ring and a bar. `|o` stands left of the line, `o|` right of it.",
        ),
        part("}|   |{", "One or more: a bar and a crow's foot."),
        part("}o   o{", "Zero or more: a ring and a crow's foot."),
        part("--   ..", "The line: identifying and non-identifying relationship."),
      ],
    },
    {
      id: "words",
      title: "Relationships in words",
      rows: [
        row(
          "CUSTOMER only one to zero or more ORDER : places",
          "The same as `||--o{`: cardinalities in words, and `to` for the solid line.",
        ),
        row(
          "CUSTOMER one optionally to many ADDRESS : uses",
          "`optionally to` is the dashed line.",
        ),
        part("only one   one   1", "Exactly one."),
        part("zero or one   one or zero", "Zero or one."),
        part("one or more   one or many   many(1)   1+", "One or more."),
        part("zero or more   zero or many   many(0)   many   0+", "Zero or more."),
      ],
    },
    {
      id: "ignored",
      title: "Read and not drawn",
      context: "CUSTOMER",
      rows: [
        row("CUSTOMER:::important", "A style class on an entity."),
        row("classDef important fill:#f96", "Styles: `classDef`, `class`, `style`, `linkStyle`."),
        row('click CUSTOMER href "https://example.com"', "Links: `click`, `link`, `callback`."),
        row("accTitle: Orders", "Texts for screen readers: `accTitle`, `accDescr`."),
      ],
    },
    place("CUSTOMER", "CUSTOMER", "An entity is placed by its name.", "r1"),
    {
      id: "example",
      title: "Example",
      example: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ORDER-ITEM : contains
  PRODUCT ||--o{ ORDER-ITEM : "is ordered as"
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
    int productId PK, FK
    int quantity
  }
  PRODUCT {
    int id PK
    string name
    decimal price "in euros"
  }`,
    },
    {
      id: "refused",
      title: "Not supported",
      context: "CUSTOMER\nORDER",
      rows: [
        no(
          "CUSTOMER --> ORDER",
          "A relationship has a cardinality at each end: `CUSTOMER ||--o{ ORDER`.",
        ),
        no("CUSTOMER ||--o{ ORDER :", "A colon is followed by a label."),
        no("CUSTOMER u--o{ ORDER : x", "Mermaid's `u` end."),
        no(
          "erDiagram LR",
          "Nothing follows `erDiagram`. Write `direction LR` on a line of its own.",
          {
            whole: true,
          },
        ),
        no("ORDER {\n  int id PK FK\n}", "Several keys take commas: `PK, FK`."),
        no("ORDER {\n  int\n}", "An attribute has a type and a name."),
        no(
          "ORDER {\n  date placed on\n}",
          "A name is one word; what follows is a key or a comment in quotes.",
        ),
        no("ORDER {\n  int id", "A block ends with `}`."),
      ],
    },
  ],
};

/** The guides, in the order the editor lists them. */
export const GUIDES: Guide[] = [TAM, CLASS, USECASE, FLOWCHART, STATE, SEQUENCE, ER];

/** Kinds of source whose guide is another type's: an activity diagram with lanes is an activity diagram. */
const GUIDED: Record<string, string> = { swimlane: "flowchart" };

/** The guide of a diagram type; undefined for a type that has none. */
export const guideOf = (type: string): Guide | undefined =>
  GUIDES.find((guide) => guide.type === (GUIDED[type] ?? type));

/**
 * The source a row is read in: the lines before it, the row, the lines after it, under the header
 * of its type. This is what the tests parse, and what the row is colored in.
 */
export function rowSource(guide: Guide, section: GuideSection, item: GuideRow): string {
  // A source of its own stands without the lines its section puts before a statement.
  const before = item.context ?? (item.whole ? undefined : section.context);
  const lines = [before, item.write, item.after].filter((text): text is string => !!text),
    header = item.header ?? section.header ?? guide.header;
  if (header && !item.whole) lines.unshift(header);
  return lines.join("\n");
}

/** A text as Markdown: its `backticks` stay code, and a bar does not end a table cell. */
const cell = (text: string) => text.replace(/\|/g, "\\|");

/** Code in a table cell: each line a code span, with a fence long enough for the backticks in it. */
function code(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const ticks = "`".repeat(
          Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length)) + 1,
        ),
        pad = line.startsWith("`") || line.endsWith("`") ? " " : "",
        // Leading spaces would be trimmed from a code span: they are kept as non-breaking ones.
        indent = line.match(/^ */)![0].length;
      return `${"&nbsp;".repeat(indent)}${ticks}${pad}${cell(line.slice(indent))}${pad}${ticks}`;
    })
    .join("<br>");
}

/** The guide of a type as a Markdown page: the text of docs/guides/<type>.md. */
export function guideMarkdown(type: string): string {
  const guide = guideOf(type);
  if (!guide) throw new Error(`There is no guide for \`${type}\`.`);
  const fence = guide.type === "tam" ? "tam" : "mermaid";
  const out = [
    `# ${guide.name} guide`,
    "",
    "<!-- Written by guideMarkdown in editor/reference.ts: change the guide there, not here. -->",
    "",
    `${guide.about}.`,
  ];
  for (const section of guide.sections) {
    out.push("", `## ${section.title}`);
    if (section.prose) out.push("", section.prose);
    if (section.rules) out.push("", ...section.rules.map((rule) => `- ${rule}`));
    if (section.rows?.length) {
      const refused = section.rows.every((item) => item.refused);
      out.push(
        "",
        refused ? "| Not accepted | Why, and what to write |" : "| You write | It means |",
        "| --- | --- |",
        ...section.rows.map((item) => `| ${code(item.write)} | ${cell(item.means)} |`),
      );
    }
    if (section.example) out.push("", `\`\`\`${fence}`, section.example, "```");
  }
  return `${out.join("\n")}\n`;
}
