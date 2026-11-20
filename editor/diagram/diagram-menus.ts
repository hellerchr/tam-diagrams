// The diagram editor's menus of the selection (the canvas's right click, the outline's, and the bar's Arrange menu), as
// tam-diagrams' old editor had them (editor/menus.ts context, arrange): a block diagram's elements, connections, both
// or the empty canvas; a UML diagram's are in diagram-uml-menus.ts. A row that does not apply is off with its reason.
import { type MenuEntry, type MenuItem, openMenu, toast } from "../lib/overlays.svelte.ts";
import { ARRANGE, arrangeRefusal, type Arranging } from "./diagram-arrange.ts";
import {
  allowsWrap,
  BOXES,
  groupedAlready,
  groupSelection,
  selectionHolder,
  takeOut,
  ungroupable,
  ungroupSelection,
  wrapSelection,
} from "./diagram-boxes.ts";
import type { ElementKind } from "./diagram-edit.ts";
import type { Point } from "./diagram-hit.ts";
import { keys } from "./diagram-bar-view.ts";
import { fits, removal } from "./diagram-menu-rows.ts";
import { umlContext } from "./diagram-uml-menus.ts";
import type { Workbench } from "./diagram-workbench.svelte.ts";
import { kindName } from "./palettes.ts";

/** The rows of a group of ARRANGE, each off with its reason when too little is selected. */
function arrangements(ws: Workbench, group: keyof typeof ARRANGE): MenuItem[] {
  const selected = ws.ed.selectedIds().length;
  const run = (action: Arranging) => {
    const { ed } = ws;
    if (action.does === "same-width" || action.does === "same-height")
      ed.sameSize(action.does === "same-width" ? "width" : "height");
    else if (action.does === "fit-size") ed.fitSize();
    else ed.arrange(action.does);
  };
  return ARRANGE[group].map((action) => ({
    label: action.name,
    off: arrangeRefusal(action, selected),
    action: () => run(action),
  }));
}

/** Putting the selection in a new box: only the boxes that may hold it. */
function putIn(ws: Workbench): MenuEntry {
  const { ed } = ws;
  const kinds = BOXES.filter(([kind]) => allowsWrap(ed, kind));
  const named = (id: string) => ws.placed(id);
  const reason = ed.selectedIds().length
    ? "No box may hold what is selected"
    : "Select the elements to put in a box";
  return {
    label: "Put in",
    off: kinds.length ? undefined : reason,
    items: kinds.map(([kind, key]) => ({
      label: kindName(kind),
      hint: key ? keys(key) : undefined,
      // A group of one group, or of the parts of one, groups nothing.
      off: kind === "group" ? groupedAlready(ed) : undefined,
      action: () => (kind === "group" ? groupSelection(ed, named) : wrapSelection(ed, kind, named)),
    })),
  };
}

/** Whether the diagram on show is laid out by hand: some element or part has a place. */
function placed(ws: Workbench): boolean {
  const { ed } = ws;
  if (ed.model && ed.edits) return ed.edits.placedByHand(ed.model);
  return !!ed.uml && !!ed.umlEd.edits?.placed(ed.uml);
}

/** Laying the whole diagram out automatically again. */
const autoLayout = (ws: Workbench): MenuItem => ({
  label: "Auto layout",
  off: placed(ws) ? undefined : "The layout is automatic already",
  action: ws.autoLayout,
});

/** The bar's Arrange menu: aligning, distributing and sizing; boxes; laying out. */
export function arrangeMenu(ws: Workbench): MenuEntry[] {
  const { ed } = ws;
  return [
    { label: "Align", items: arrangements(ws, "Align") },
    { label: "Distribute", items: arrangements(ws, "Distribute") },
    ...arrangements(ws, "Size"),
    "separator",
    putIn(ws),
    {
      label: "Take out of its box",
      off: selectionHolder(ed) ? undefined : "Select elements that stand in a box",
      action: () => takeOut(ed),
    },
    {
      label: "Ungroup",
      hint: keys("Mod-Shift-g"),
      off: ungroupable(ed) ? undefined : "Select one element that holds others",
      action: () => ungroupSelection(ed),
    },
    "separator",
    autoLayout(ws),
  ];
}

/** Laying out only the selected elements: the parts of the one that holds others, or several among themselves. */
function layOutWithin(ws: Workbench, ids: string[]): MenuEntry {
  const holds = ids.length === 1 && !!ws.ed.model?.diagram.nodes.get(ids[0]!)?.children.length;
  return {
    label: ids.length === 1 ? "Auto layout inside" : "Auto layout these",
    off: holds || ids.length > 1 ? undefined : "This element holds no others to lay out",
    action: () =>
      void ws.layOutSelection().catch(() => toast("Could not lay out the selection", "error")),
  };
}

/** Copies the selected elements as source text to the clipboard; with `cut` they go. */
function clip(ws: Workbench, cut: boolean) {
  const text = ws.ed.copy();
  if (!text) return;
  navigator.clipboard.writeText(text).then(
    () => cut && ws.ed.remove(),
    () => toast("Could not copy the selection", "error"),
  );
}

/** Pastes copied elements from the clipboard at `at`. */
function paste(ws: Workbench, at?: Point) {
  navigator.clipboard.readText().then(
    (text) => text && ws.ed.paste(text, at),
    () => toast("Could not read the clipboard", "error"),
  );
}

/** The menu of a right click on elements of a block diagram. */
function elementsContext(ws: Workbench, ids: string[]): MenuEntry[] {
  const { ed } = ws;
  const m = ed.model!;
  const kinds = ed.edits!.kindsFor(m, ids);
  return [
    ids.length === 1 && {
      label: "Rename",
      hint: "F2",
      action: () => ws.startRename({ type: "element", id: ids[0]! }),
    },
    {
      label: "Change kind",
      items: kinds.kinds.map((kind) => ({
        label: kindName(kind),
        checked: kind === kinds.current,
        action: () => ed.apply((model, edits) => edits.rekindedAll(model, ids, kind)),
      })),
    },
    "separator",
    putIn(ws),
    !!selectionHolder(ed) && { label: "Take out of its box", action: () => takeOut(ed) },
    !!ungroupable(ed) && {
      label: "Ungroup",
      hint: keys("Mod-Shift-g"),
      action: () => ungroupSelection(ed),
    },
    {
      label: "Arrange",
      items: [
        ...arrangements(ws, "Align"),
        "separator",
        ...arrangements(ws, "Distribute"),
        "separator",
        ...arrangements(ws, "Size"),
      ],
    },
    layOutWithin(ws, ids),
    "separator",
    { label: "Fit selection", hint: "2", action: ws.fitSelection },
    "separator",
    { label: "Duplicate", hint: keys("Mod-d"), action: ed.duplicate },
    { label: "Copy", hint: keys("Mod-c"), action: () => clip(ws, false) },
    { label: "Cut", hint: keys("Mod-x"), action: () => clip(ws, true) },
    "separator",
    removal(ws),
  ];
}

/** The menu of a right click on connections of a block diagram; `at` is where the label of one without opens. */
function wiresContext(ws: Workbench, ids: string[], at: Point | undefined): MenuEntry[] {
  const { ed } = ws;
  const m = ed.model!;
  const [id] = ids;
  const wire = ids.length === 1 && id ? ed.edits!.wiresFor(m, id) : undefined;
  const change = (kind: { change: object }) =>
    ed.apply((model, edits) => edits.wireChanged(model, id!, kind.change));
  const word = wire?.connection.word;
  return [
    !!wire &&
      wire.kinds.length > 1 && {
        label: "Change kind",
        items: wire.kinds.map((kind) => ({
          label: kind.name,
          checked: kind.value === wire.current,
          action: () => change(kind),
        })),
      },
    !!wire &&
      ed.edits!.allowsWireChange(m, id!, { reverse: true }) && {
        label: "Reverse",
        action: () => ed.reverse(id!),
      },
    !!wire &&
      word !== "dependency" && {
        label: wire.connection.label ? "Edit label" : "Add a label",
        action: () => ws.startRename({ type: "wire", id: id! }, false, at),
      },
    !!id &&
      ed.edits!.labelPlaced(m, id) && {
        label: "Put the label back",
        action: () => ed.apply((model, edits) => edits.labelMoved(model, id, undefined)),
      },
    "separator",
    removal(ws),
  ];
}

/** The menu of a right click on the empty canvas of a block diagram: what to add at `at`. */
function canvasContext(ws: Workbench, at: Point | undefined): MenuEntry[] {
  const shapes = ws.ed.palette?.shapes ?? [];
  return [
    shapes.length > 0 && {
      label: "Add",
      items: shapes.map((shape) => ({
        label: shape.name,
        action: () => (at ? ws.create(shape.kind as ElementKind, at) : ws.addShape(shape.kind)),
      })),
    },
    "separator",
    { label: "Paste", hint: keys("Mod-v"), action: () => paste(ws, at) },
    { label: "Select all", hint: keys("Mod-a"), action: ws.ed.selectAll },
    "separator",
    ...fits(ws),
    "separator",
    autoLayout(ws),
  ];
}

/** The menu of a right click: what can be done with the selection, or at `at` on the empty canvas. */
export function contextItems(ws: Workbench, at?: Point): MenuEntry[] {
  const { ed } = ws;
  if (ed.uml) return umlContext(ws);
  if (!ed.model || !ed.edits) return fits(ws);
  const elements = ed.selectedIds();
  const wires = ed.selection.filter((part) => part.type === "wire").map((part) => part.id);
  if (elements.length && wires.length) return [removal(ws)];
  if (elements.length) return elementsContext(ws, elements);
  if (wires.length) return wiresContext(ws, wires, at);
  return canvasContext(ws, at);
}

/** Opens the menu of a right click at the pointer, for the selection (the canvas's, the outline's); `at` is the
 *  diagram's point under it on the canvas. */
export function openContextMenu(ws: Workbench, e: MouseEvent, at?: Point) {
  openMenu(e, contextItems(ws, at));
}
