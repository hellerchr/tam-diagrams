/**
 * The keys of the canvas: which key runs which command of the editor, with Ctrl (or Cmd) and
 * without, and when the keys belong to something else on the page.
 */

import type { Editor } from "./editor.ts";
import { GRID } from "./placing.ts";

/** Whether an element of the page takes typing: a text field, or text that can be edited. */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return (
    !!element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName))
  );
}

/** The controls that keep the keys that work them once they have the focus. */
const CONTROLS =
  'button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="treeitem"], [role="option"], [role="radio"]';

/** Whether a key is for something on the page other than the canvas. */
export function keysElsewhere(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return (
    isTyping(target) || inDialog(target) || (!event.ctrlKey && !event.metaKey && controlled(target))
  );
}

/** In a dialog the keys are the dialog's, wherever the focus is. */
const inDialog = (target: HTMLElement | null) =>
  !!target?.closest?.("dialog") || !!document.querySelector("dialog[open]");

/**
 * Whether a focused control keeps the keys that work it: Space and Enter press it, the arrows move
 * within its group, and no key meant for it removes or moves what is selected on the canvas.
 * Reached by the keyboard, that is: one that was only clicked does not hold the keys back.
 */
const controlled = (target: HTMLElement | null) =>
  !!target?.closest?.(CONTROLS)?.matches(":focus-visible");

/** What a key does in the editor. */
type KeyCommand = (editor: Editor, event: KeyboardEvent) => void;

/** A command that keeps its key from the browser. */
const taking =
  (run: KeyCommand): KeyCommand =>
  (editor, event) => {
    event.preventDefault();
    run(editor, event);
  };

/**
 * An arrow key: it moves the selection a grid step, or one pixel with Shift. In a sequence diagram
 * it moves a message in time and a participant in its row.
 */
const arrow = (dx: -1 | 0 | 1, dy: -1 | 0 | 1): KeyCommand =>
  taking((editor, event) => {
    const step = event.shiftKey ? 1 : GRID;
    if (editor.type === "sequence") editor.shift((dx || dy) as -1 | 1);
    else editor.nudge(dx * step, dy * step);
  });

/** Enter or F2 opens the name of the one selected element. */
const renameSelected: KeyCommand = (editor, event) => {
  const [only] = editor.selection;
  if (editor.selection.length !== 1 || only.type !== "element") return;
  event.preventDefault();
  editor.rename(only.id);
};

const zoomIn = (editor: Editor) => editor.view.zoomBy(1.25),
  zoomOut = (editor: Editor) => editor.view.zoomBy(0.8);

/** The keys pressed with Ctrl or Cmd, in lower case. */
export const COMMAND_KEYS = new Map<string, KeyCommand>([
  ["z", taking((editor, event) => (event.shiftKey ? editor.doc.redo() : editor.doc.undo()))],
  ["y", taking((editor) => editor.doc.redo())],
  ["d", taking((editor) => editor.duplicateSelection())],
  ["a", taking((editor) => editor.selectAll())],
  [
    "g",
    taking((editor, event) =>
      event.shiftKey ? editor.ungroupSelection() : editor.groupSelection(),
    ),
  ],
  ["0", taking((editor) => editor.view.zoomTo(1))],
  ["=", taking(zoomIn)],
  ["+", taking(zoomIn)],
  ["-", taking(zoomOut)],
]);

/** The keys pressed alone or with Shift, in lower case. */
export const PLAIN_KEYS = new Map<string, KeyCommand>([
  [" ", taking((editor) => editor.holdSpace())],
  ["Delete", taking((editor) => editor.deleteSelection())],
  ["Backspace", taking((editor) => editor.deleteSelection())],
  ["Escape", (editor) => editor.escape()],
  ["Enter", renameSelected],
  ["F2", renameSelected],
  ["ArrowLeft", arrow(-1, 0)],
  ["ArrowRight", arrow(1, 0)],
  ["ArrowUp", arrow(0, -1)],
  ["ArrowDown", arrow(0, 1)],
  ["v", (editor) => editor.setTool("select")],
  ["h", (editor) => editor.setTool("pan")],
  ["c", (editor) => editor.setTool("connect")],
  ["a", (editor) => editor.setTool("agent")],
  ["s", (editor) => editor.setTool("storage")],
  ["u", (editor) => editor.setTool("human")],
  ["g", (editor) => editor.setTool("group")],
  ["n", (editor) => editor.setTool("note")],
  ["1", (editor) => editor.fit()],
  ["2", (editor) => editor.fitSelection()],
  ["?", (editor) => editor.onHelp()],
  ["+", zoomIn],
  ["=", zoomIn],
  ["-", zoomOut],
]);
