// How a row of the diagram editor's outline (DiagramOutline.svelte) shows its element, as the old outline.ts did: its
// drawing, its name, and the name of its kind. A part of a UML diagram shows as the piece it is; one without a name
// of its own (a start or an end node) goes by the name of its piece.
import type { Structure } from "../../src/structure.ts";
import { ICONS, type IconName } from "./diagram-icons.ts";
import type { TreeItem } from "./diagram-outline.ts";
import { pieceIconName } from "./diagram-uml-icons.ts";
import { kindName } from "./palettes.ts";

/** How a row shows its element. */
export type Look = { icon: IconName; name: string; kind: string; tip: string };

/** The look of an element: of a UML diagram's part when `structure` is given, else a block diagram's element. */
export function lookOf(item: TreeItem, structure?: Pick<Structure, "pieces">): Look {
  const label = item.label.replace(/<br\s*\/?>/gi, " ").trim();
  const made = item.id.includes("#");
  if (structure) {
    const piece = structure.pieces.find((p) => p.kind === item.kind)?.name ?? kindName(item.kind);
    // An id the library made up (`root#initial`) is no name to read.
    const name = label || (made ? piece : item.id);
    return {
      icon: pieceIconName(item.kind),
      name,
      kind: piece,
      tip: made ? piece : `${piece} ${item.id}`,
    };
  }
  const kind = kindName(item.kind);
  // A note is drawn as the UML note it is.
  const icon =
    item.kind === "note" ? "uml-note" : item.kind in ICONS ? (item.kind as IconName) : "agent";
  return {
    icon,
    name: label || item.id.replace(/#.*/, ""),
    kind,
    tip: made ? kind : `${kind} ${item.id}`,
  };
}

/** The words a search finds an element by: its label, id and kind, and the name and kind its row shows. */
export const searchTexts = (item: TreeItem, look: Look) => [
  item.label,
  item.id,
  item.kind,
  look.name,
  look.kind,
];
