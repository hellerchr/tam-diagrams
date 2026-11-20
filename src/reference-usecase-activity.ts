// The syntax guides of use case and activity diagrams, with lanes and without (reference.ts).
import { type Guide, type GuideRow, row, no, front, place, TEXT } from "./reference-rows.ts";

export const USECASE: Guide = {
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
          `A note at an element that is declared above. The text runs to the end of the line; quotes around it are optional. ${TEXT}`,
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
    place(["order", "order(Place order)"], "An actor or a use case is placed by its id.", "r1"),
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

export const FLOWCHART: Guide = {
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
    place(["pack", "pack(Pack goods)"], "A node is placed by its id.", "e1", [
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
