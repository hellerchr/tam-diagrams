// The diagram editor's palettes (DiagramShapes.svelte): for each diagram type the shapes to drag onto the picture
// and the kinds of connection to draw, generic over the type. A block diagram's lists are here, as the old editor's
// types.ts had them (names, hints, keys, icons), with the wording each connection kind writes; the UML types add
// theirs (diagram-uml-structures.ts). The icons of the statements a type edited as text adds are here too.
import type { IconNode } from "lucide";
import { ICONS, type IconName } from "./diagram-icons.ts";
import type { DiagramKind } from "./diagram-types.ts";

/** A shape or a kind of connection of a palette; `key` picks a shape as the tool. */
export type PaletteItem = {
  kind: string;
  name: string;
  icon: IconNode;
  hint?: string;
  key?: string;
};

/** A diagram type's palette: shapes to add, and kinds of connection to draw them with. */
export type Palette = { shapes: PaletteItem[]; links: PaletteItem[] };

const item = (kind: string, name: string, icon: IconName, hint: string): PaletteItem => ({
  kind,
  name,
  hint,
  icon: ICONS[icon],
});

const TAM: Palette = {
  shapes: [
    {
      ...item("agent", "Agent", "agent", "Active structure element: a service, a process"),
      key: "A",
    },
    { ...item("human", "Human", "human", "Human agent: an agent that is a person"), key: "U" },
    {
      ...item(
        "storage",
        "Storage",
        "storage",
        "Passive structure element that stores data: a database, a file",
      ),
      key: "S",
    },
    {
      ...item("group", "Group", "group", "Frame around elements that share channels and accesses"),
      key: "G",
    },
    {
      ...item("note", "Note", "uml-note", "A remark attached to an element with a dotted line"),
      key: "N",
    },
  ],
  links: [
    item(
      "calls",
      "Request",
      "tam-calls",
      "Request/response channel: the client calls the server (-- calls -->)",
    ),
    item(
      "sends data",
      "Data flow",
      "tam-sends",
      "Data flow channel: data goes one way (-- sends data -->)",
    ),
    item(
      "calls both",
      "Both ways",
      "tam-calls-both",
      "Bidirectional channel: requests go both ways (<-- calls -->)",
    ),
    item("---", "Channel", "tam-channel", "Channel without a direction (---)"),
    item("reads", "Read", "tam-reads", "Read access: an agent reads a storage (-- reads -->)"),
    item(
      "writes",
      "Write",
      "tam-writes",
      "Write access: an agent writes a storage (-- writes -->)",
    ),
    item(
      "reads/writes",
      "Read/write",
      "tam-modifies",
      "Modifying access: an agent reads and writes a storage (-- reads/writes -->)",
    ),
  ],
};

/** The name of a block diagram's element kind as the palette says it (the old kindName). */
export function kindName(kind: string): string {
  return (
    TAM.shapes.find((shape) => shape.kind === kind)?.name ??
    (kind[0] ?? "").toUpperCase() + kind.slice(1)
  );
}

/** The drawings of the statements a type edited as text adds, by their names (the old types.ts's snippets). */
const SNIPPET_ICONS: Record<string, IconName> = {
  Class: "class",
  Interface: "uml-interface",
  Generalization: "uml-inherit",
  Association: "uml-arrow",
  Composition: "uml-compose",
  Dependency: "uml-dashed",
  Actor: "uml-actor",
  "Use case": "uml-usecase",
  System: "uml-system",
  Include: "uml-dashed",
  Action: "uml-step",
  Decision: "uml-decision",
  "Initial node": "uml-start",
  "Final node": "uml-end",
  Group: "group",
  State: "uml-step",
  Transition: "uml-arrow",
  Initial: "uml-start",
  "Final state": "uml-end",
  Composite: "uml-composite",
  Note: "uml-note",
  Participant: "uml-participant",
  Message: "uml-message",
  Reply: "uml-reply",
  Alternative: "uml-frame",
  Loop: "uml-loop",
  Entity: "uml-entity",
  "One to many": "er-one-to-many",
  "Many to one": "er-many-to-one",
  "One to one": "er-one-to-one",
  "Many to many": "er-many-to-many",
};

/** The drawing of a statement a type edited as text adds, by its name. */
export const snippetIcon = (name: string): IconNode => ICONS[SNIPPET_ICONS[name] ?? "uml-step"];

/** What a block diagram's connection kind writes: its word, and whether it goes both ways. */
export type Wording = {
  word: "calls" | "sends data" | "---" | "reads" | "writes" | "reads/writes";
  both: boolean;
};

const WORDINGS: Record<string, Wording> = {
  calls: { word: "calls", both: false },
  "sends data": { word: "sends data", both: false },
  "calls both": { word: "calls", both: true },
  "---": { word: "---", both: false },
  reads: { word: "reads", both: false },
  writes: { word: "writes", both: false },
  "reads/writes": { word: "reads/writes", both: false },
};

/** The wording of a block diagram's connection kind; undefined for a kind it does not have. */
export const wordingOf = (kind: string): Wording | undefined => WORDINGS[kind];

/** The kind of connection a word and direction are, as the palette names it; undefined for one it does not offer. */
export const linkKindOf = (word: string, both: boolean) =>
  Object.entries(WORDINGS).find(
    ([, wording]) => wording.word === word && wording.both === both,
  )?.[0];

const PALETTES: Partial<Record<DiagramKind, Palette>> = { tam: TAM };

/** The palette of a diagram type; undefined for a type edited only in the source. */
export const paletteOf = (kind: DiagramKind | undefined): Palette | undefined =>
  kind ? PALETTES[kind] : undefined;
