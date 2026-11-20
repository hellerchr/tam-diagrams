// What the New diagram chooser (DiagramChooser.svelte) offers, as the old editor's dialogs.ts did: the picture on
// each type's card, the words under its name, and the list of what a diagram of the type starts from (a new one, the
// sample, the examples of src/tam/examples.ts). Library-free, so the lists are tested on their own.
import type { DiagramKind, DiagramType } from "./diagram-types.ts";
import type { IconName } from "./diagram-icons.ts";

/** The pictures on the cards: a small diagram of each type that is wider than high, as the window of a card is. A type
 *  without one shows its starter. */
const THUMBS: Partial<Record<DiagramKind, string>> = {
  class: `classDiagram
  direction LR
  class Customer {
    +name: string
  }
  class Order {
    +id: string
    +total() number
  }
  Customer "1" --> "*" Order : places`,
  usecase: `usecase-beta
  direction LR
  actor User
  systemBoundary shop[Web Shop]
    browse(Browse Products)
    order(Place Order)
  end
  User --> browse
  User --> order`,
  flowchart: `flowchart LR
  start((Start)) --> check{In stock?}
  check -->|yes| ship[Ship order]
  check -->|no| wait[Wait]
  ship --> done(((End)))`,
  state: `stateDiagram-v2
  direction LR
  [*] --> Draft
  Draft --> Approved : approve
  Draft --> Rejected : reject`,
  sequence: `sequenceDiagram
  participant U as User
  participant S as Shop
  participant P as Payment
  U->>S: place order
  S->>P: charge
  P-->>S: paid`,
  er: `erDiagram
  direction LR
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    int id PK
    string name
  }
  ORDER {
    int id PK
    date placed
  }`,
};

/** The source of the picture on a type's card. */
export const thumbOf = (type: DiagramType): string => THUMBS[type.kind] ?? type.starter;

/** How a type is worked on, in a few plain words: a block diagram is placed by hand, the UML types lay themselves out. */
export const badgeOf = (type: DiagramType): string =>
  type.kind === "tam" ? "Placed by hand" : "Lays itself out";

/** The icon of a type, as the bar's type chip shows it. */
export const typeIcon = (kind: DiagramKind): IconName =>
  kind === "tam" ? "logo" : kind === "swimlane" ? "flowchart" : kind;

/** A diagram to start from, as the chooser lists it. */
export type Start = { name: string; source: string; icon: "plus" | "file" };

/** What a diagram of `type` starts from: a new one (empty for a block diagram, else the type's small starter), the
 *  block diagram's sample, then the examples; one row per source. */
export function startsOf(type: DiagramType, examples: [string, string][]): Start[] {
  const first: Start[] =
    type.kind === "tam"
      ? [
          { name: "Empty diagram", source: "", icon: "plus" },
          { name: "Order system (sample)", source: type.starter, icon: "file" },
        ]
      : [{ name: "Small starter diagram", source: type.starter, icon: "plus" }];
  const known = new Set(first.map((start) => start.source));
  return [
    ...first,
    ...examples
      .filter(([, source]) => !known.has(source))
      .map(([name, source]): Start => ({ name, source, icon: "file" })),
  ];
}

/** How much wider than high a picture may be to fill the window of a card; any other shows whole. */
const FILLS = { least: 1.7, most: 2.6 };

/** Whether a picture of `width` by `height` fills a card's window (cut at the sides) rather than showing whole. */
export const fills = (width: number, height: number) =>
  width / height >= FILLS.least && width / height <= FILLS.most;

/** Where the arrow keys, Home and End go in the list of starts from the row at `at` of `count`; undefined: not a
 *  key of the list. */
export function startStep(key: string, at: number, count: number): number | undefined {
  const last = count - 1;
  if (key === "ArrowDown") return Math.min(at + 1, last);
  if (key === "ArrowUp") return Math.max(at - 1, 0);
  if (key === "Home") return 0;
  return key === "End" ? last : undefined;
}

/** Where the arrow keys go among the cards from the card at `at`, `across` cards in a row; undefined: nowhere. */
export function cardStep(
  key: string,
  at: number,
  across: number,
  count: number,
): number | undefined {
  const by = (
    { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -across, ArrowDown: across } as Record<string, number>
  )[key];
  const next = by === undefined ? -1 : at + by;
  return next >= 0 && next < count ? next : undefined;
}
