# Activity diagram with lanes guide

<!-- Written by guideMarkdown in editor/reference.ts: change the guide there, not here. -->

A flow of actions in lanes: who does which step.

## What it shows

An activity diagram with lanes shows a flow of actions and who does each: every lane holds the steps of one agent. Use it when a process crosses people, departments or systems. It is written in Mermaid's `swimlane-beta` syntax: a flowchart whose subgraphs are the lanes.

## Rules of the notation

- Every `subgraph` is a lane, named after the agent that does its steps. Lanes stand side by side in the order of the source.
- A node stands in the lane where it is named first inside one. Nodes named in no lane share a lane without a name.
- Flows run from node to node, also across lanes. A flow does not end at a lane, and lanes do not nest.
- An action is a step of the flow. A flow is an arrow from one node to the next.
- A decision is a diamond with one flow in and several out. The text of a flow that leaves it is its guard, shown in square brackets. A merge is a diamond that brings flows together again; a diamond that does both is drawn as a merge followed by a decision.
- The initial node is a filled dot: a circle `((…))` that flows only leave. The final node is a ringed dot: a double circle `(((…)))` that flows only enter. A circle that flows enter stays a circle; a double circle that flows leave stays one.
- A fork bar splits one flow into parallel ones, a join bar brings them together: `@{ shape: fork }`.
- A flow final node, a crossed circle, ends one flow while the others go on.
- Decisions, merges, initial and final nodes have no flow to themselves.
- A node exists as soon as a statement names it. Its shape and text may be given at any mention; the last one given counts.
- `end`, `subgraph`, `graph`, `flowchart`, `direction`, `style`, `linkStyle`, `classDef`, `class` and `click` are keywords, not ids.
- A diagram has at most 300 nodes, 500 flows and 20,000 characters.

## Diagram

| You write | It means |
| --- | --- |
| `swimlane-beta TB` | The first line, with the way the flow runs. `TB` (the default) and `BT`: lanes are columns. `LR` and `RL`: lanes are rows. `TD` is `TB`; `>`, `<`, `^` and `v` point the way too. |
| `---`<br>`title: Order system`<br>`---` | The title, in a frontmatter block before the first line. |
| `%% level conceptual` | TAM's level, as a comment before or after the first line. An activity diagram may be of either level. |
| `%% a remark` | A comment: a line of its own that starts with `%%`. |

## Lanes

| You write | It means |
| --- | --- |
| `subgraph Customer`<br>&nbsp;&nbsp;`order(Place order)`<br>`end` | A lane with its nodes, between its line and `end`. The id is its title. |
| `subgraph shop [Web Shop]`<br>&nbsp;&nbsp;`check(Check order)`<br>`end` | An id, and the title in square brackets. |
| `subgraph "Web Shop"`<br>&nbsp;&nbsp;`check(Check order)`<br>`end` | A title in quotes, without an id. |
| `subgraph Customer`<br>&nbsp;&nbsp;`order(Place order)`<br>`end`<br>`subgraph Shop`<br>&nbsp;&nbsp;`check(Check order)`<br>`end`<br>`order --> check` | A flow from lane to lane. It may stand after the lanes or inside one. |

## Nodes

| You write | It means |
| --- | --- |
| `pack(Pack goods)` | An action: an id, and its text in round brackets. A rounded box. |
| `pack[Pack goods]` | Square brackets are an action too, drawn the same. |
| `ok{In stock?}` | A decision or a merge: a diamond. Its question stands beside it. |
| `start((Start))` | A circle. With flows that only leave it, it is the initial node: a filled dot. |
| `done(((End)))` | A double circle. With flows that only enter it, it is the final node. |
| `pack` | An id alone: an action that shows its id. Flows may name nodes that are declared nowhere. |
| `pack("Pack (all) goods")` | Quotes keep brackets and signs inside a text. |
| ``pack("`Pack **all** goods`")`` | A Markdown text: shown without its emphasis signs. |
| `pack(Pack<br>goods)` | `<br>` breaks a line. `#quot;` writes a quote, `#35;` the character with that number. |
| `db[(Orders)]` | A cylinder: an object, a database. |
| `pill([Wait])` | Mermaid's stadium: drawn as an action. |
| `sub[[Check credit]]` | A subroutine: a rectangle with double sides. |
| `prep{{Prepare}}` | A hexagon. |
| `in[/Read order/]` | Leaning right: input or output. |
| `out[\Print slip\]` | Leaning left. |
| `manual[/Check by hand\]` | A trapezoid, wide at the bottom. |
| `prio[\Sort/]` | A trapezoid, wide at the top. |
| `flag>Order received]` | A flag. |
| `split@{ shape: fork }` | A fork or join bar. `join` is the same shape. |
| `first@{ shape: start }` | The initial node, whatever flows it has. |
| `last@{ shape: stop }` | The final node. |
| `abort@{ shape: cross-circ }` | A flow final node: a crossed circle. Only this flow ends. |
| `ok@{ shape: diamond, label: "In stock?" }` | Any shape by its Mermaid name, with its text: `rect`, `rounded`, `stadium`, `subroutine`, `cyl`, `circle`, `dbl-circ`, `diamond`, `hex`, `lean-r`, `lean-l`, `trap-b`, `trap-t`, `odd`, and Mermaid's longer names for them. |

## Flows

A flow may be written with or without spaces around its arrow.

| You write | It means |
| --- | --- |
| `a --> b` | A flow from `a` to `b`. |
| `a -->\|yes\| b` | A flow with a text between bars: the guard after a decision. |
| `a -- yes --> b` | The same, the text inside the arrow. |
| `a --- b` | A line without an arrow. With a text: `a ---\|text\| b` or `a -- text --- b`. |
| `a -.-> b` | A dotted flow. With a text: `a -. text .-> b`. Without an arrow: `a -.- b`. |
| `a ==> b` | A thick flow. With a text: `a == text ==> b`. Without an arrow: `a === b`. |
| `a <--> b` | Arrows at both ends. Also `<-.->` and `<==>`. |
| `a --o b` | A circle at the end. Both ends: `a o--o b`. |
| `a --x b` | A cross at the end. Both ends: `a x--x b`. |
| `a ~~~ b` | An invisible link: it only keeps `a` before `b` in the layout. |
| `a ----> b` | More dashes are read as the same flow. |
| `a --> b --> c` | A chain: each arrow is a flow of its own. |
| `a & b --> c & d` | `&` lists several ends: every one on the left to every one on the right. |
| `a(Pack) --> b{Ok?}` | Nodes may get their shape and text where a flow names them. |
| `a e1@--> b` | An id for the flow before its arrow is read and ignored. |
| `a --> b; b --> c` | `;` separates statements on one line. |

## Read and not drawn

| You write | It means |
| --- | --- |
| `a:::important --> b` | A style class on a node. |
| `classDef important fill:#f96` | Styles: `classDef`, `class`, `style`, `linkStyle`. |
| `click a "https://example.com"` | Links: `click`, `callback`. |
| `direction LR` | A `direction` line: the first line says the direction. |
| `accTitle: Shipping` | Texts for screen readers: `accTitle`, `accDescr`. |

## Positions

Without positions the diagram lays itself out. Moving a part in the editor writes a position for every part, as comment lines at the end of the source, so the source stays valid Mermaid. A node is placed by its id, and stays in its lane.

| You write | It means |
| --- | --- |
| `%% @order 120,40` | The part with this id stands with its top left corner at x 120, y 40, in pixels, y down. A part without such a line stays where the layout puts it; without any such line the layout is automatic again. |

## Example

```mermaid
swimlane-beta TB
  subgraph Customer
    start((Start)) --> order(Place order)
    receive(Receive goods) --> done(((End)))
  end
  subgraph Shop
    check{In stock?}
    pack(Pack goods)
    refuse(Cancel order) --> stop(((End)))
  end
  subgraph Carrier
    deliver(Deliver)
  end
  order --> check
  check -->|yes| pack
  check -->|no| refuse
  pack --> deliver
  deliver --> receive
```

## Not supported

| Not accepted | Why, and what to write |
| --- | --- |
| `order --> Shop` | A flow to a lane. Name a node in it. |
| `subgraph Store`<br>&nbsp;&nbsp;`subgraph Desk`<br>&nbsp;&nbsp;&nbsp;&nbsp;`serve(Serve)`<br>&nbsp;&nbsp;`end`<br>`end` | A subgraph inside a lane. |
| `ok{In stock?} --> ok` | A flow from a decision, merge, initial or final node to itself. |
| `c@{ shape: cloud }` | Mermaid's other shapes: only the ones under Nodes are drawn. |
| `end --> check` | `end` is a keyword. Name the node otherwise. |
| `order --> check %% next` | A comment is a line of its own. |
| `title Shipping` | Write the title in frontmatter. |
