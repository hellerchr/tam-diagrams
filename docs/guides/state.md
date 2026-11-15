# State machine diagram guide

<!-- Written by guideMarkdown in editor/reference.ts: change the guide there, not here. -->

The states of one thing and the transitions between them.

## What it shows

A state machine diagram shows the states one thing can be in and the transitions between them: which event leads from which state to which. Use it for the life of an object, a document, a connection. It is written in Mermaid's `stateDiagram-v2` syntax.

## Rules of the notation

- A state is a rounded box. A transition is an arrow, labelled `event [guard] / action`: what happens, the condition under which it leads on, and what is done on the way. Every part is optional.
- `[*]` before an arrow is the initial state of its scope, a filled dot: every such line starts at the same dot. `[*]` after an arrow is a final state, a ringed dot: every such line draws one of its own.
- A composite state contains states and has its own initial and final states. It shows a name only, no description.
- Inside a composite state `--` separates regions that are active at the same time.
- A choice is a diamond: the guards of the transitions that leave it decide. It has no transition to itself.
- A fork bar splits one transition into several, a join bar brings several together.
- A state exists as soon as a statement names it, and stands in the composite state where it is named first. Its id has no spaces and none of `:`, `-`, `{`, `}`, `"`.
- TAM puts state machines at the conceptual level: `%% level design` is refused, and `%% level conceptual` refuses fork and join bars.
- A diagram has at most 300 states and 20,000 characters.

## Diagram

| You write | It means |
| --- | --- |
| `stateDiagram-v2` | The first line. `stateDiagram` is read the same. |
| `---`<br>`title: Order system`<br>`---` | The title, in a frontmatter block before the first line. |
| `%% a remark` | A comment: a line of its own that starts with `%%`. |
| `direction LR` | The way the layout runs: `TB` (the default), `LR`, `BT` or `RL`. `TD` is `TB`. Inside a composite state the line is ignored. |

## States

| You write | It means |
| --- | --- |
| `Idle` | A state: its id is its name. |
| `state Idle` | The same with the keyword. |
| `state "Waiting for input" as Waiting` | A state with a name of several words, and its id. |
| `Idle : entry / reset` | A description below the name. Each such line adds one. |

## Transitions

| You write | It means |
| --- | --- |
| `Idle --> Busy` | A transition from `Idle` to `Busy`. |
| `Idle --> Busy : start` | The event that causes it, after a colon. |
| `Idle --> Busy : start [ready] / beep` | Event, guard and action. `<br>` breaks a line. `#quot;` writes a quote, `#35;` the character with that number. |
| `[*] --> Idle` | From the initial state: where the machine starts. |
| `Busy --> [*]` | To a final state: where it ends. |
| `Busy --> Busy : retry` | A transition from a state to itself. |

## Choice, fork and join

| You write | It means |
| --- | --- |
| `state check <<choice>>`<br>`Idle --> check`<br>`check --> Busy : [ready]`<br>`check --> Failed : [else]` | A choice: a diamond whose outgoing guards decide. |
| `state split <<fork>>`<br>`Idle --> split`<br>`split --> Printing`<br>`split --> Mailing` | A fork bar: one transition becomes several. |
| `state merge <<join>>`<br>`Printing --> merge`<br>`Mailing --> merge`<br>`merge --> Done` | A join bar: several transitions become one. |
| `state check [[choice]]` | Double square brackets are read like `<< >>`. |

## Composite states and regions

| You write | It means |
| --- | --- |
| `state Active {`<br>&nbsp;&nbsp;`[*] --> Reading`<br>&nbsp;&nbsp;`Reading --> Writing : edit`<br>&nbsp;&nbsp;`Writing --> [*]`<br>`}` | A composite state: its states and transitions stand between `{` and `}`. The `}` is a line of its own. |
| `state "In work" as Active {`<br>&nbsp;&nbsp;`Reading --> Writing`<br>`}` | A composite state with a name of several words. |
| `state Active {`<br>&nbsp;&nbsp;`Reading --> Writing`<br>&nbsp;&nbsp;`--`<br>&nbsp;&nbsp;`Online --> Offline`<br>`}` | `--` on a line of its own starts another region, active at the same time. |
| `state Active {`<br>&nbsp;&nbsp;`state Editing {`<br>&nbsp;&nbsp;&nbsp;&nbsp;`Typing --> Saving`<br>&nbsp;&nbsp;`}`<br>`}`<br>`Active --> Closed : close`<br>`Saving --> Closed : quit` | Composite states nest, and transitions go to and from a composite state or the states inside it. |

## Notes

| You write | It means |
| --- | --- |
| `note right of Idle : Waits for a job` | A note beside a state: `right of` or `left of`. |
| `note left of Idle`<br>&nbsp;&nbsp;`Waits for a job.`<br>&nbsp;&nbsp;`Uses no power.`<br>`end note` | A note of several lines, up to `end note`. |

## Read and not drawn

| You write | It means |
| --- | --- |
| `Idle:::important --> Busy` | A style class on a state. |
| `classDef important fill:#f96` | Styles: `classDef`, `class`, `style`. |
| `hide empty description` | Mermaid's display options: this one and `scale 350 width`. |
| `accTitle: Printer` | Texts for screen readers: `accTitle`, `accDescr`. |

## Positions

Without positions the diagram lays itself out. Moving a part in the editor writes a position for every part, as comment lines at the end of the source, so the source stays valid Mermaid. A state is placed by its id; initial and final states have ids the editor writes.

| You write | It means |
| --- | --- |
| `%% @Idle 120,40` | The part with this id stands with its top left corner at x 120, y 40, in pixels, y down. A part without such a line stays where the layout puts it; without any such line the layout is automatic again. |

## Example

```mermaid
stateDiagram-v2
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
  note right of Draft : The author may still edit
```

## Not supported

| Not accepted | Why, and what to write |
| --- | --- |
| `Idle -> Busy` | A transition is written `-->`. |
| `state check <<choice>>`<br>`check --> check` | A transition from a choice to itself. |
| `Idle --> Busy`<br>`--`<br>`On --> Off` | Regions stand inside a composite state. |
| `state Active {`<br>&nbsp;&nbsp;`Reading`<br>`}`<br>`Active : busy` | A composite state has a name only, no description. |
| `state "Check" as check <<choice>>` | A choice, fork or join has an id only. |
| `state Active {}` | The braces of a composite state stand on lines of their own. |
| `state Active {`<br>&nbsp;&nbsp;`Reading` | A composite state ends with `}`. |
| `note over Idle : text` | A note stands `left of` or `right of` a state. |
| `state Up-To-Date` | An id has no `-`. Write `state "Up-To-Date" as UpToDate`. |
| `Idle --> Busy %% next` | A comment is a line of its own. |
| `title Printer` | Write the title in frontmatter. |
| `state split <<fork>>` | TAM's conceptual level has no fork and join bars. |
