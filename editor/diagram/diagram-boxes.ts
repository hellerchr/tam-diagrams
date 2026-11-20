// Putting a block diagram's selected elements in a box and taking them out again (the canvas's context menu, the
// Arrange menu, Ctrl+Alt+A and Ctrl+Alt+S, Ctrl+G / Ctrl+Shift+G), as tam-diagrams' old editor did (editor/editor.ts wrapSelection,
// groupSelection, ungroupSelection, takeOut), with the reasons a row is off; a UML diagram's group is taken apart by
// its structure.
import { toast } from "../lib/overlays.svelte.ts";
import type { ElementKind } from "./diagram-edit.ts";
import type { DiagramEditor } from "./diagram-editor.svelte.ts";

/** The boxes a selection may be put in, with the keys that do so: Ctrl+Alt and the box's tool letter, Ctrl+G a group. */
export const BOXES: [ElementKind, string][] = [
  ["agent", "Mod-Alt-a"],
  ["storage", "Mod-Alt-s"],
  ["group", "Mod-g"],
];

/** Ctrl+Alt+A or S: the selected elements go in a new agent or storage, or the reason they may not shows. */
export function wrapByKey(ed: DiagramEditor, kind: ElementKind, named: (id: string) => void) {
  const { model, edits } = ed;
  const ids = ed.selectedIds();
  if (!model || !edits || !ids.length) return;
  const why = edits.wrapRefusal(model, ids, kind);
  if (why) toast(why, "info");
  else wrapSelection(ed, kind, named);
}

/** The element that holds all the selected elements, when one does. */
export function selectionHolder(ed: DiagramEditor): string | undefined {
  const m = ed.model;
  const ids = ed.selectedIds();
  if (!m || !ids.length) return undefined;
  const holders = new Set(ids.map((id) => m.diagram.nodes.get(id)?.parent ?? null));
  const [only] = holders;
  return holders.size === 1 && only ? only : undefined;
}

/** Why the selection takes no new group: it is one group, or the very parts of one. */
export function groupedAlready(ed: DiagramEditor): string | undefined {
  const m = ed.model;
  const ids = ed.selectedIds();
  if (!m || !ids.length) return undefined;
  if (ids.length === 1 && m.diagram.nodes.get(ids[0]!)?.kind === "group")
    return "This is a group already";
  const around = selectionHolder(ed);
  const group = around ? m.diagram.nodes.get(around) : undefined;
  return group?.kind === "group" && group.children.length === ids.length
    ? "These are grouped already"
    : undefined;
}

/** The one selected element that holds others and can be taken apart. */
export function ungroupable(ed: DiagramEditor): string | undefined {
  const [only, ...more] = ed.selectedIds();
  if (!only || more.length) return undefined;
  if (ed.model) return ed.model.diagram.nodes.get(only)?.children.length ? only : undefined;
  return ed.uml?.parts.get(only)?.group && ed.umlEd.can("ungroup") ? only : undefined;
}

/** Whether the selected elements may go in a new element of `kind`. */
export const allowsWrap = (ed: DiagramEditor, kind: ElementKind) =>
  !!ed.model &&
  !!ed.edits &&
  ed.selectedIds().length > 0 &&
  !ed.edits.wrapRefusal(ed.model, ed.selectedIds(), kind);

/** Puts the selected elements in a new element of `kind`, selects it and opens its name (a group's stays). */
export function wrapSelection(ed: DiagramEditor, kind: ElementKind, named: (id: string) => void) {
  const ids = ed.selectedIds();
  let made = "";
  const done = ed.apply((m, edits) => {
    const result = edits.wrapped(m, ids, kind);
    made = result.id;
    return result.source;
  });
  if (!done) return;
  ed.selection = [{ type: "element", id: made }];
  if (kind !== "group") named(made);
}

/** Ctrl+G: the selected elements go in a new group, unless they are grouped already. */
export function groupSelection(ed: DiagramEditor, named: (id: string) => void) {
  if (!ed.model || !ed.selectedIds().length) return;
  const already = groupedAlready(ed);
  if (already) toast(`${already}.`, "info");
  else wrapSelection(ed, "group", named);
}

/** Ctrl+Shift+G: the selected box goes, and what it held stays where it stood. */
export function ungroupSelection(ed: DiagramEditor) {
  const id = ungroupable(ed);
  if (!id) return;
  if (!ed.model) return void ed.umlEd.ungroup(id);
  if (ed.apply((m, edits) => edits.unwrapped(m, id))) ed.selection = [];
}

/** Takes the selected elements out of the element that holds them, into the one around it. */
export function takeOut(ed: DiagramEditor) {
  const inside = selectionHolder(ed);
  if (inside) ed.apply((m, edits) => edits.takenOut(m, ed.selectedIds(), inside));
}
