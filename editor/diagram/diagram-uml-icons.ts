// The drawings of the UML pieces and joins in the diagram editor's palette and outline (diagram-uml-structures.ts,
// DiagramOutline.svelte): picked by the words their kinds contain, the most telling first, as the old editor's
// structures.ts did, from its icons (diagram-icons.ts).
import type { IconNode } from "lucide";
import { ICONS, type IconName } from "./diagram-icons.ts";

/** The drawings of the pieces, by words their kinds contain: the most telling word first. */
const PIECES: [RegExp, IconName][] = [
  [/entity/, "uml-entity"],
  [/interface/, "uml-interface"],
  [/abstract/, "uml-abstract"],
  [/enum/, "uml-enum"],
  [/class/, "class"],
  [/package|namespace/, "package"],
  [/actor|person/, "uml-actor"],
  [/usecase|use-case|case/, "uml-usecase"],
  [/system|boundary/, "uml-system"],
  [/decision|choice/, "uml-decision"],
  [/start|initial/, "uml-start"],
  [/end|final/, "uml-end"],
  [/composite/, "uml-composite"],
  [/note/, "uml-note"],
  [/participant|lifeline/, "uml-participant"],
  [/lane/, "uml-lane"],
  [/group|box|frame/, "group"],
  [/fork|join|bar/, "uml-lane"],
  [/step|state|node/, "uml-step"],
];

/** The drawings of the joins, by words their kinds contain. */
const LINKS: [RegExp, IconName][] = [
  [/^one-to-many$/, "er-one-to-many"],
  [/^many-to-one$/, "er-many-to-one"],
  [/^one-to-one$/, "er-one-to-one"],
  [/^many-to-many$/, "er-many-to-many"],
  [/^zero-or-one-to-many$/, "er-zero-or-one-to-many"],
  [/^one-to-one-or-more$/, "er-one-to-one-or-more"],
  [/^one-to-zero-or-one$/, "er-one-to-zero-or-one"],
  [/realiz/, "uml-realize"],
  [/inherit|general/, "uml-inherit"],
  [/aggreg/, "uml-aggregate"],
  [/compos/, "uml-compose"],
  [/dashed|dotted.?(line|both)?$/, "uml-dashed-link"],
  [/^(link|line|undirected|lost|both)$/, "uml-link"],
  [/depend|include|extend|dotted|reply|return/, "uml-dashed"],
  [/message|call|sync/, "uml-message"],
];

/** The name of a piece's drawing, by its kind. */
export const pieceIconName = (kind: string): IconName =>
  PIECES.find(([words]) => words.test(kind.toLowerCase()))?.[1] ?? "uml-step";

/** The name of a kind of join's drawing. */
export const linkIconName = (kind: string): IconName =>
  LINKS.find(([words]) => words.test(kind.toLowerCase()))?.[1] ?? "uml-arrow";

/** The drawing of a piece, by its kind. */
export const pieceIcon = (kind: string): IconNode => ICONS[pieceIconName(kind)];

/** The drawing of a kind of join. */
export const linkIcon = (kind: string): IconNode => ICONS[linkIconName(kind)];
