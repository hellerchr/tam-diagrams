// The syntax guides of state machine and sequence diagrams (reference.ts).
import { type Guide, row, no, front, place, TEXT } from "./reference-rows.ts";

export const STATE: Guide = {
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
        row("Idle --> Busy : start [ready] / beep", `Trigger, guard and effect. ${TEXT}`),
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
      ["Idle", "[*] --> Idle"],
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

export const SEQUENCE: Guide = {
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
      ["head:A", SEQUENCE_CONTEXT],
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
