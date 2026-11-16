# TAM block diagram guide

<!-- Written by guideMarkdown in editor/reference.ts: change the guide there, not here. -->

Compositional structure of a system: agents, storages, channels and accesses.

## What it shows

A block diagram shows the compositional structure of a system: agents as active structure elements, storages and channels as passive ones, the channels over which agents communicate and the read and write accesses of agents to storages. Use it for the system's components and their communication paths. The editor offers plain block diagrams; the design level of the standard is read and drawn too, and has a section of its own at the end.

## Rules of the notation

The parser enforces the SAP TAM standard and names the line that breaks a rule.

- Agents are active structure elements: they process information. A human agent is an agent that is a person. Storages and channels are passive structure elements: a storage stores information, a channel transmits it.
- Active and passive elements alternate. Agents communicate over channels and access storages by read and write accesses; a storage is never joined to a storage by a flow, only by a `pointer`.
- A channel joins agents only: agents, human agents, and groups of them.
- A request/response channel is unidirectional or bidirectional. A data flow channel is unidirectional; data in both directions takes two channels.
- An access joins one active element and one storage, and is written from the active element. `writes` points to the storage, `reads` points from it, `reads/writes` is a modifying access. An access has no protocol.
- An agent holds agents and storages. A human agent holds nothing. A storage holds only storages.
- A container stands for its parts: a container and one of its own parts are never connected.
- A `pointer` joins two storages; `create` and `generate` join active elements.
- Only agents and storages are shown as several (`stack`, `...`). Dots stand between elements of one kind.
- Elements do not overlap. In a layout by hand the editor and `check` say which do.
- An id starts with a letter or `_` and goes on with letters, digits and `_`. Every id is declared once; a connection may stand before or after the declarations of its ends.
- A diagram has at most 300 elements, 400 lines and 20,000 characters.

## Diagram

| You write | It means |
| --- | --- |
| `title Order system` | The title above the diagram. Quotes around it are optional. |
| `direction LR` | The way the automatic layout runs: `TB` (top to bottom, the default) or `LR` (left to right). `TD` is `TB`. |
| `%% a remark` | A comment, to the end of its line. It may follow a statement. |

## Elements

| You write | It means |
| --- | --- |
| `agent api[Order API]` | An agent: a kind, an id, and the name in brackets. |
| `agent api "Order API"` | The name in quotes works too. |
| `agent api` | Without a name the id is shown. |
| `agent api[]` | Empty brackets: no text. |
| `agent api[Order<br>API]` | `<br>` breaks the name. |
| `human customer[Customer]` | A human agent, drawn with a figure. |
| `storage db[Orders]` | A storage: a passive structure element, drawn rounded. |

## Nesting and grouping

| You write | It means |
| --- | --- |
| `agent shop[Web Shop] {`<br>&nbsp;&nbsp;`agent api[Order API]`<br>&nbsp;&nbsp;`storage cart[Cart]`<br>`}` | A container: its parts stand on the lines between `{` and `}`. The `}` is a line of its own. |
| `group {`<br>&nbsp;&nbsp;`agent a1[Worker]`<br>&nbsp;&nbsp;`agent a2[Planner]`<br>`}` | A group: a thin frame around elements that share channels and accesses. It needs no id. A group of storages counts as a storage. |
| `group pool[Workers] {`<br>&nbsp;&nbsp;`agent a1[Worker]`<br>`}` | A group with an id can be an end of a connection; the name is optional. |
| `agent shop[Web Shop] {}` | `{}` on the line: an element without parts. |

## Several of a kind

| You write | It means |
| --- | --- |
| `agent worker[Worker] stack` | Several, drawn as a stack. A container may be a stack. |
| `storage log[Log] ...` | Several, drawn as two with dots between. Each connection goes to both. Not for containers. |
| `agent first[First]`<br>`...`<br>`agent last[Last]` | A line of three dots between two elements of one kind: more of them stand between, side by side. |

## Color, position and size

Color, `stack`, `...` and positions follow the name in any order; an opening `{` comes last.

| You write | It means |
| --- | --- |
| `storage cart[Cart]:::blue` | A color: `blue`, `orange`, `green`, `yellow`, `pink`, `purple`, `red` or `gray`. |
| `agent api[Order API] @250,90` | A position: the top left corner in pixels, y down. One position is enough to lay the diagram out by hand; elements without one stand in a row below the placed ones. |
| `agent api[Order API] @250,90 140x40` | A position and a least size, width x height. An element is never smaller than its name, a container never smaller than its parts. |
| `agent worker[Worker] ... @450,90 @450,160` | With `...` a second position places the copy. It takes no size. |
| `a -- calls: place order --> b @+20,-14` | Behind a connection, signed: its label stands with its middle 20 right of and 14 above the middle of the line, a channel's circle, and keeps to it when the line moves. A statement of several connections takes none. Dragging a label in the editor writes it. |

## Channels: agent to agent

| You write | It means |
| --- | --- |
| `a -- calls --> b` | A request/response channel: `a` is the client, `b` the server. |
| `a <-- calls --> b` | A bidirectional request/response channel. |
| `a -- sends data --> b` | A unidirectional data flow channel from `a` to `b`. |
| `a --- b` | A channel without a direction. |
| `a -- calls: place order --> b` | A label follows the word after a colon. |
| `a -- calls @HTTPS --> b` | A protocol follows `@`. Channels of one protocol in a row share a dashed protocol boundary. |
| `a -- calls: place order @HTTPS --> b` | Word, label and protocol together. |
| `a -- orders --- b` | A channel without a direction takes a label without a word. |
| `a -- orders @AMQP --- b` | And a protocol. |
| `a -- calls: "ratio 1:2" @"HTTP/2" --> b` | Quotes keep a `:` or `@` inside a label or a protocol. |

## Accesses: active element to storage

| You write | It means |
| --- | --- |
| `a -- reads --> s` | A read access: `a` reads `s`. The arrow points from the storage. |
| `a -- writes --> s` | A write access. The arrow points to the storage. |
| `a -- reads/writes --> s` | A modifying (read/write) access of `a` to `s`. |
| `a -- writes: new orders --> s` | A label follows the word after a colon. |

## Dependencies

A dashed arrow with its keyword in «». It carries the keyword only: no label, no protocol.

| You write | It means |
| --- | --- |
| `a -. create .-> b` | `a` creates `b` at run time. Between active elements. |
| `a -. generate .-> b` | `a` generates `b`. Between active elements. |
| `s -. pointer .-> t` | `s` holds a reference to `t`. Between two storages. |

## Several ends, chains and words

| You write | It means |
| --- | --- |
| `a & b -- reads --> s` | `&` lists several ends: every one on the left to every one on the right. |
| `a --- b --- c` | A chain: each link is a connection of its own. |
| `a -- Read --> s` | Words are read without case, singular or plural: `read`, `Reads`, `send data`. |
| `reads  writes  reads/writes  sends data  calls  delegates  requires` | The words of a solid arrow. Anything else goes in the label, after a colon. |
| `use  import  create  generate  pointer` | The keywords of a dashed arrow. |

## Design level and package diagrams

The parser reads the design level of the standard and package diagrams, and the editor draws them and keeps them editable as text; its palette, completion and properties offer the plain block diagram. Components, subsystems and classes connect through interfaces, not channels. A component or a class holds components, classes and storages; a subsystem holds these and subsystems, never agents. A package holds packages, classes, components and subsystems, stands at the top, in a package or in a group, and connects only through dependencies. A container and its part are joined only by `delegates`. `level conceptual` allows agents, storages, channels and accesses only; `level design` allows everything, as no level line does.

| You write | It means |
| --- | --- |
| `level conceptual` | Only agents, storages, channels and accesses are allowed. |
| `level design` | Components, subsystems, classes, packages and interfaces too. |
| `component billing[Billing]` | A component, with provided and required interfaces. |
| `subsystem erp[ERP]` | A subsystem, marked «subsystem». |
| `class Order[Order]` | A class. |
| `package ui[UI]` | A package of a package diagram. |
| `c -- requires IOrders --> d` | `c` requires the interface `IOrders` that `d` provides: a ball at `d` in a socket of `c`. |
| `c -- requires --> d` | The same without a name. |
| `c -- requires IOrders @REST --> d` | A protocol follows `@`. |
| `c provides IRefund` | An interface `c` provides, without a partner. |
| `c requires ILog` | An interface `c` requires, without a partner. |
| `outer -- delegates --> inner` | Delegation from a container to one of its own parts. The only connection between the two. |
| `p -. use .-> q` | A «use» dependency of `p` on `q`. |
| `p -. import .-> q` | A package import of `q` into `p`. |

## Example

```tam
title Order system
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
api <-- calls --> payment
```

## Not accepted

The syntax borrows Mermaid's arrows, not Mermaid's flowchart: shapes in brackets, `subgraph`, `style` and `classDef` are not read.

| Not accepted | Why, and what to write |
| --- | --- |
| `a --> b` | An arrow says what happens: `a -- calls --> b`. |
| `a -->\|orders\| b` | The text stands inside the arrow, after a word: `a -- calls: orders --> b`. |
| `a -- uses --> b` | `uses` is no connection word. Write `a -- calls: uses --> b`. |
| `s -- reads --> a` | A storage is passive. Write the access from the agent: `a -- reads --> s`. |
| `a -- calls --> s` | A storage is read or written, not called: `a -- reads --> s`. |
| `s -- sends data --> t` | Storages are joined only by `s -. pointer .-> t`. |
| `a <-- sends data --> b` | A data flow channel is unidirectional. Write two channels, or `a <-- calls --> b`. |
| `a -- reads @SQL --> s` | An access has no protocol. |
| `a -. use: orders .-> b` | A dependency carries only its keyword. |
| `shop -- calls --> api` | A container is not connected to its own part. |
| `a -- calls --> x` | Every id is declared: `agent x[Name]`. |
| `agent web-server[Web]` | An id has letters, digits and `_` only. |
| `agent api[API]:::teal` | No such color. |
| `subgraph backend` | Write a container, `agent backend[Backend] {`, or a `group {`. |
| `style a fill:#f96` | Colors are given with `:::name` on the declaration. |
