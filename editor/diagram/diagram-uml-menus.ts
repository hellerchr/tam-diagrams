// The menus of a right click on a UML diagram (diagram-menus.ts hands them on), as tam-diagrams' old editor had them
// (editor/menus.ts structureContext, partContext, joinContext): adding a piece of its type, alone or at a part; what
// can be done to one part (rename, move to a group, duplicate, ungroup) or one join (its label, its kind, its
// direction, its place in a sequence); several, only their removal. Each row where the type's structure has it.
import type { MenuEntry } from "../lib/overlays.svelte.ts";
import { keys } from "./diagram-bar-view.ts";
import { fits, removal } from "./diagram-menu-rows.ts";
import type { Workbench } from "./diagram-workbench.svelte.ts";

/** The pieces of the type to add: at the part `at`, or alone (null); each off with the structure's refusal. */
function pieces(ws: Workbench, at: string | null): MenuEntry[] {
  const m = ws.ed.uml!;
  return m.structure.pieces.map((piece) => ({
    label: piece.name,
    off: m.structure.refusal?.(m.source, piece.kind),
    action: () => ws.placed(ws.ed.umlEd.addPiece(piece.kind, undefined, at)),
  }));
}

/** Moving a part into one of the groups, or out of all with the last row. */
function moveTo(ws: Workbench, id: string): MenuEntry {
  const ued = ws.ed.umlEd;
  const m = ws.ed.uml!;
  const part = m.parts.get(id);
  const parent = part?.parent ?? undefined;
  const groups = [...m.parts.values()].filter((node) => node.group && node.id !== id);
  if (!ued.can("moveInto") || part?.group || (!groups.length && !parent)) return false;
  const into = (group: string | null) =>
    ued.apply((model, edits) => edits.moved(model, [id], { x: 0, y: 0 }, group));
  return {
    label: "Move to",
    items: [
      ...groups.map((group) => ({
        label: group.label || group.id,
        checked: parent === group.id,
        action: () => into(group.id),
      })),
      !!parent && { label: "Out of its group", action: () => into(null) },
    ],
  };
}

/** The menu of a right click on one part. */
function partContext(ws: Workbench, id: string): MenuEntry[] {
  const { ed } = ws;
  const ued = ed.umlEd;
  const group = !!ed.uml?.parts.get(id)?.group;
  const part = { type: "element" as const, id };
  return [
    ed.nameable(part) && { label: "Rename", hint: "F2", action: () => ws.startRename(part) },
    { label: "Add here", items: pieces(ws, id) },
    moveTo(ws, id),
    ued.can("copy") && !group && { label: "Duplicate", hint: keys("Mod-d"), action: ed.duplicate },
    ued.can("ungroup") &&
      group && { label: "Ungroup", hint: keys("Mod-Shift-g"), action: () => ued.ungroup(id) },
    "separator",
    removal(ws),
  ];
}

/** The menu of a right click on one join. */
function joinContext(ws: Workbench, id: string): MenuEntry[] {
  const { ed } = ws;
  const ued = ed.umlEd;
  const m = ed.uml!;
  const join = { type: "wire" as const, id };
  const key = m.hits.wires.find((w) => w.id === id)?.label?.key ?? id;
  const links = m.structure.links;
  const current = ued.linkKind(id);
  const sequence = m.kind === "sequence";
  return [
    ed.nameable(join) && { label: "Edit label", action: () => ws.startRename(join) },
    !!ued.edits?.labelPlaced(m, key) && {
      label: "Put the label back",
      action: () => ued.apply((model, edits) => edits.labelMoved(model, key, undefined)),
    },
    links.length > 1 &&
      links.some((link) => link.kind === current) && {
        label: "Change kind",
        items: links.map((link) => ({
          label: link.name,
          checked: link.kind === current,
          action: () => ued.relink(id, link.kind),
        })),
      },
    ued.can("reverse") && { label: "Reverse", action: () => ued.reverse(id) },
    sequence && { label: "Move earlier", hint: "↑", action: () => ed.nudge(0, -1) },
    sequence && { label: "Move later", hint: "↓", action: () => ed.nudge(0, 1) },
    "separator",
    removal(ws),
  ];
}

/** The menu of a right click on a UML diagram: what to add on nothing, what to do with one part or one join. */
export function umlContext(ws: Workbench): MenuEntry[] {
  const { selection } = ws.ed;
  const [only, ...more] = selection;
  if (!only) return [{ label: "Add", items: pieces(ws, null) }, "separator", ...fits(ws)];
  if (more.length) return [removal(ws)];
  return only.type === "element" ? partContext(ws, only.id) : joinContext(ws, only.id);
}
