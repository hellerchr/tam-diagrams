// The syntax guide of TAM block diagrams (reference.ts).
import { type Guide, row, no, part } from "./reference-rows.ts";

const TAM_CONTEXT = "agent a[A]\nagent b[B]\nagent c[C]\nstorage s[S]\nstorage t[T]";

export const TAM: Guide = {
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
          {
            context: `${TAM_CONTEXT}\nnote vat[Remember VAT]`,
          },
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
