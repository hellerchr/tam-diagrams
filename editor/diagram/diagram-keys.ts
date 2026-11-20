// The diagram canvas's keys (DiagramCanvas.svelte), as tam-diagrams' old editor had them (editor/keys.ts): undo and
// redo as the person's keymap has them, the commands with Cmd/Ctrl (select all, duplicate, group and ungroup), and the
// plain keys (delete, rename, Escape, the arrows, the tools). The zoom and fit keys (+ - 1 2 Ctrl+0) and ? are the
// window's (DiagramBar.svelte).
import { idsFor } from "../lib/hotkeys.svelte.ts";
import { isEditable } from "../lib/keys.ts";
import { overlays } from "../lib/overlays.svelte.ts";
import { groupSelection, ungroupSelection, wrapByKey } from "./diagram-boxes.ts";
import type { ElementKind } from "./diagram-edit.ts";
import { GRID } from "./diagram-marks.ts";
import type { Tool, Workbench } from "./diagram-workbench.svelte.ts";

type Run = (e: KeyboardEvent) => unknown;

/** The tools a letter picks. */
const TOOLS: Record<string, Tool> = {
  v: "select",
  h: "pan",
  c: "connect",
  a: "agent",
  s: "storage",
  u: "human",
  g: "group",
  n: "note",
};

/** Ctrl+Alt with a box's tool letter (by the key, which Option on a Mac turns into another character): the selection
 *  goes in a new one of it. */
const WRAPS: Record<string, ElementKind> = { KeyA: "agent", KeyS: "storage" };

/** What Ctrl+Alt with a box's letter does on a block diagram; undefined for any other key. */
function wrapKey(ws: Workbench, e: KeyboardEvent, named: (id: string) => void): Run | undefined {
  const kind = WRAPS[e.code];
  if (!kind || !e.altKey || !(e.ctrlKey || e.metaKey) || e.shiftKey || !ws.model) return undefined;
  return () => wrapByKey(ws.ed, kind, named);
}

/** Escape: ends the gesture under way, else the tool, else the selection. */
export function escape(ws: Workbench) {
  if (ws.g.cancel()) return;
  if (ws.tool !== "select") ws.pickTool("select");
  else ws.ed.selection = [];
}

/** Enter or F2: the name of the one selected element opens. */
function renameSelected(ws: Workbench) {
  const [only, ...more] = ws.ed.selection;
  if (only?.type === "element" && !more.length) ws.startRename(only);
}

/** The function that says what a key does on the canvas; undefined: the key is not the canvas's. */
export function diagramKeys(ws: Workbench): (e: KeyboardEvent) => Run | undefined {
  const { ed } = ws;
  /** An arrow moves the selection a grid step, a pixel with Shift; a sequence diagram's part a place. */
  const arrow = (dx: number, dy: number) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 1 : GRID;
    ed.nudge(dx * step, dy * step);
  };
  const plain: Record<string, Run> = {
    Delete: ed.remove,
    Backspace: ed.remove,
    Escape: () => escape(ws),
    Enter: () => renameSelected(ws),
    F2: () => renameSelected(ws),
    ArrowLeft: arrow(-1, 0),
    ArrowRight: arrow(1, 0),
    ArrowUp: arrow(0, -1),
    ArrowDown: arrow(0, 1),
  };
  const named = (id: string) => ws.placed(id);
  const withMod: Record<string, Run> = {
    a: ed.selectAll,
    d: ed.duplicate,
    g: (e) => (e.shiftKey ? ungroupSelection(ed) : groupSelection(ed, named)),
  };
  return (e) => {
    const ids = idsFor(e);
    if (ids.includes("editor.undo") || ids.includes("editor.redo"))
      return () => (ids.includes("editor.redo") ? ws.redo() : ws.undo());
    const wrap = wrapKey(ws, e, named);
    if (wrap) return wrap;
    if (e.altKey) return undefined;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.ctrlKey || e.metaKey) return ws.model ? withMod[key] : undefined;
    const tool = TOOLS[key];
    if (tool) return () => ws.pickTool(tool);
    // Only Escape works on a picture that is not edited on the canvas.
    return ws.model || key === "Escape" ? plain[key] : undefined;
  };
}

/** The controls that keep the keys that work them once the keyboard took the focus to them. */
const CONTROLS =
  'button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="treeitem"], [role="option"], [role="radio"]';

/** Whether a key is the canvas's, as the old editor decided (keys.ts keysElsewhere): the focus is on the page or in
 *  the diagram's window (`shell`), not in a field, no dialog or menu is open, and no control the keyboard went to keeps
 *  it (with Ctrl or Cmd the canvas has it all the same, and Escape: a tool picked on the rail keeps its button focused,
 *  and Escape still goes back to the pointer). */
export function canvasHasKey(e: KeyboardEvent, shell: Element | null | undefined): boolean {
  const target = e.target as HTMLElement | null;
  const active = document.activeElement;
  if (!shell || (active && active !== document.body && !shell.contains(active))) return false;
  if (
    isEditable(target) ||
    overlays.menu ||
    document.querySelector('[role="dialog"], dialog[open]')
  )
    return false;
  return (
    e.ctrlKey ||
    e.metaKey ||
    e.key === "Escape" ||
    !target?.closest?.(CONTROLS)?.matches(":focus-visible")
  );
}
