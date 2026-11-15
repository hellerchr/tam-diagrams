/**
 * The Outline tab of the left panel: the elements of the diagram as a tree. The arrow opens and
 * closes an element that holds others, a click selects, a double click names, a drag puts an
 * element inside another. The tree is one stop for Tab: the arrow keys go from row to row inside
 * it, and select.
 */

import { h, icon, iconButton } from "./dom.ts";
import type { Editor, TreeItem } from "./editor.ts";
import type { IconName } from "./icons.ts";
import { pieceIcon } from "./structures.ts";
import { kindName, typeInfo } from "./types.ts";

/** An element of the tree with everything inside it, as ids. */
export const within = (item: TreeItem): string[] => [item.id, ...item.children.flatMap(within)];

export class Outline {
  readonly element = h("div", { class: "tab-body" });
  private readonly editor: Editor;
  /** Opens the menu of the selection at a point of the window. */
  private readonly menu: (at: { x: number; y: number }) => void;
  private readonly tree = h("div", { class: "tree", role: "tree", "aria-label": "Elements" });
  /** The elements of the tree that are closed: their parts do not show. */
  private folded = new Set<string>();
  /** The elements being dragged in the tree. */
  private dragged: string[] = [];
  /** The rows of the tree by element, to mark the selected ones without building the tree again. */
  private rows = new Map<string, HTMLElement>();
  private filter = "";
  private marked = "";
  private shown = "";

  constructor(editor: Editor, menu: (at: { x: number; y: number }) => void) {
    this.editor = editor;
    this.menu = menu;
    // The tree takes drops: onto an element, or onto its ground for the top level.
    this.tree.addEventListener("dragover", (event) => {
      if (
        event.target === this.tree &&
        this.dragged.length &&
        editor.allowsMove(this.dragged, null)
      )
        event.preventDefault();
    });
    this.tree.addEventListener("drop", (event) => {
      if (event.target !== this.tree) return;
      event.preventDefault();
      editor.moveElements(this.dragged, null);
    });
    this.element.append(
      h(
        "div",
        { class: "tab-tools" },
        h("input", {
          class: "field search",
          type: "search",
          placeholder: "Find an element…",
          "aria-label": "Find an element",
          onInput: (event: Event) => {
            this.filter = (event.target as HTMLInputElement).value;
            this.update();
          },
        }),
        iconButton("expand", { tip: "Expand all" }, () => this.foldAll(false), "button small"),
        iconButton("collapse", { tip: "Collapse all" }, () => this.foldAll(true), "button small"),
      ),
      this.tree,
    );
  }

  /** Opens or closes every element of the tree that holds others. */
  private foldAll(closed: boolean) {
    this.folded.clear();
    const walk = (items: TreeItem[]) => {
      for (const item of items) {
        if (closed && item.children.length) this.folded.add(item.id);
        walk(item.children);
      }
    };
    walk(this.editor.tree);
    this.update();
  }

  /**
   * Shows the tree. It is built again only when the elements, the closed ones or the filter
   * changed, so a row stays the row it was between two clicks.
   */
  update() {
    const { editor } = this,
      items = editor.tree,
      selected = editor.selectedElements;
    // What is selected on the canvas shows in the tree: the elements around it open.
    const mark = selected.join(" ");
    if (mark !== this.marked) {
      const open = (list: TreeItem[], path: string[]): void => {
        for (const item of list) {
          if (selected.includes(item.id)) path.forEach((id) => this.folded.delete(id));
          open(item.children, [...path, item.id]);
        }
      };
      open(items, []);
    }
    const words = this.filter.trim().toLowerCase();
    const matches = (item: TreeItem): boolean =>
      !words ||
      item.label.toLowerCase().includes(words) ||
      item.id.toLowerCase().includes(words) ||
      item.kind.includes(words) ||
      this.look(item).name.toLowerCase().includes(words) ||
      this.look(item).kind.toLowerCase().includes(words) ||
      item.children.some(matches);
    const kinds = [...(editor.doc.picture?.parts?.values() ?? [])].map((part) => part.kind);
    const key = JSON.stringify([items, kinds, [...this.folded], words, editor.type]);
    // The keyboard is in the tree: it stays there, whatever happens to the row it was on.
    const active = document.activeElement,
      held = this.tree.contains(active)
        ? [...this.rows.values()].indexOf(active as HTMLElement)
        : -1;
    if (key !== this.shown) {
      this.shown = key;
      this.rows.clear();
      // A tree in which nothing holds anything needs no room for arrows.
      this.tree.classList.toggle("flat", !items.some((item) => item.children.length));
      const lines = items.flatMap((item) => this.row(item, 0, words, matches));
      this.tree.replaceChildren(
        ...(lines.length
          ? lines
          : [
              h(
                "p",
                { class: "note" },
                words
                  ? "Nothing found."
                  : editor.editable || editor.structural
                    ? "No elements yet."
                    : `${typeInfo(editor.type).plural} are edited as text: their parts are in the source.`,
              ),
            ]),
      );
    }
    for (const [id, line] of this.rows)
      line.setAttribute("aria-selected", String(selected.includes(id)));
    // One row is the tree's stop for Tab: the one selected last, else the one the keyboard is on
    // or was on, else the first.
    const lines = [...this.rows.values()],
      stop =
        this.rows.get(selected.at(-1) ?? "") ??
        (active instanceof HTMLElement && lines.includes(active) ? active : undefined) ??
        lines[Math.max(0, Math.min(held, lines.length - 1))];
    for (const line of lines) line.tabIndex = line === stop ? 0 : -1;
    if (held >= 0 && stop && document.activeElement !== stop) stop.focus();
    if (mark !== this.marked) {
      this.marked = mark;
      // The row of what was selected last comes into view, without taking the focus from the canvas.
      this.rows.get(selected.at(-1) ?? "")?.scrollIntoView({ block: "nearest" });
    }
  }

  /**
   * How a row shows its element: its drawing, its name, and the name of its kind. A part of a
   * diagram with a structure shows as the piece it is; one without a name of its own, as a start
   * or an end node, goes by the name of its kind.
   */
  private look(item: TreeItem): { icon: IconName; name: string; kind: string } {
    const { editor } = this,
      part = editor.doc.picture?.parts?.get(item.id),
      label = (part?.label ?? item.label).replace(/<br\s*\/?>/gi, " ").trim();
    if (!part)
      return {
        icon: item.kind,
        name: label || item.id.replace(/#.*/, ""),
        kind: kindName(item.kind),
      };
    const kind =
      editor.structure?.pieces.find((piece) => piece.kind === part.kind)?.name ??
      kindName(part.kind);
    // An id the library made up (`root#initial`) is no name to read.
    return {
      icon: pieceIcon(part.kind),
      name: label || (item.id.includes("#") ? kind : item.id),
      kind,
    };
  }

  /** The row of an element, and below it the rows of what it holds while it is open. */
  private row(
    item: TreeItem,
    depth: number,
    words: string,
    matches: (item: TreeItem) => boolean,
  ): HTMLElement[] {
    const { editor } = this;
    if (!matches(item)) return [];
    // A search shows what it finds, whatever is closed.
    const folded = !words && this.folded.has(item.id),
      parent = item.children.length > 0;
    const toggle = (deep: boolean) => {
      const ids = deep ? within(item) : [item.id];
      for (const id of ids)
        if (folded) this.folded.delete(id);
        else this.folded.add(id);
      this.update();
    };
    const look = this.look(item);
    const twist = h(
      "span",
      parent
        ? {
            class: "twist",
            role: "button",
            "data-tip": folded ? "Expand (Alt: all inside)" : "Collapse (Alt: all inside)",
            "aria-label": folded ? "Expand" : "Collapse",
            "aria-expanded": String(!folded),
            draggable: "false",
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              toggle(event.altKey);
            },
            onDblclick: (event: Event) => event.stopPropagation(),
            onPointerdown: (event: Event) => event.stopPropagation(),
          }
        : { class: "twist none" },
      parent && icon("chevron"),
    );
    const line = h(
      "div",
      {
        class: "node",
        role: "treeitem",
        tabindex: "-1",
        draggable: "true",
        ...(parent ? { "aria-expanded": String(!folded) } : {}),
        style: `padding-left:${4 + depth * 14}px`,
        "data-tip": item.id.includes("#") ? look.kind : `${look.kind} ${item.id}`,
        "data-side": "right",
      },
      twist,
      icon(look.icon),
      h("span", { class: "name" }, look.name),
      parent && folded && h("span", { class: "count" }, String(within(item).length - 1)),
    );
    this.rows.set(item.id, line);
    line.addEventListener("click", (event) => {
      const part = { type: "element" as const, id: item.id };
      editor.select(
        event.shiftKey || event.ctrlKey || event.metaKey
          ? editor.isSelected(part)
            ? editor.selection.filter((other) => other.id !== item.id)
            : [...editor.selection, part]
          : [part],
      );
      editor.reveal(item.id);
      line.focus();
    });
    line.addEventListener("dblclick", () => editor.rename(item.id));
    line.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!editor.isSelected({ type: "element", id: item.id }))
        editor.select([{ type: "element", id: item.id }]);
      this.menu({ x: event.clientX, y: event.clientY });
    });
    line.addEventListener("keydown", (event) => {
      const lines = [...this.rows.values()],
        at = lines.indexOf(line);
      // The keys of the history and of the window are not the tree's.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // A row the keyboard came to is selected by the keys that act on it.
      const chosen = () => {
        if (!editor.isSelected({ type: "element", id: item.id })) line.click();
      };
      if (event.key === "ArrowRight" && parent && folded) toggle(false);
      else if (event.key === "ArrowLeft" && parent && !folded) toggle(false);
      else if (event.key === "ArrowDown") lines[at + 1]?.click();
      else if (event.key === "ArrowUp") lines[at - 1]?.click();
      else if (event.key === "Home") lines[0]?.click();
      else if (event.key === "End") lines.at(-1)?.click();
      else if (event.key === " ") chosen();
      else if (event.key === "Enter" || event.key === "F2") (chosen(), editor.rename(item.id));
      else if (event.key === "Delete" || event.key === "Backspace")
        (chosen(), editor.deleteSelection());
      else return;
      event.preventDefault();
      event.stopPropagation();
    });
    line.addEventListener("dragstart", (event) => {
      // The arrow opens and closes; it does not start a drag.
      if ((event.target as HTMLElement).closest?.(".twist")) return event.preventDefault();
      const chosen = editor.selectedElements;
      this.dragged = chosen.includes(item.id) ? chosen : [item.id];
      event.dataTransfer?.setData("text/plain", this.dragged.join(" "));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    line.addEventListener("dragend", () => {
      this.dragged = [];
    });
    line.addEventListener("dragover", (event) => {
      if (!this.dragged.length || !editor.allowsMove(this.dragged, item.id)) return;
      event.preventDefault();
      line.classList.add("over");
    });
    line.addEventListener("dragleave", () => line.classList.remove("over"));
    line.addEventListener("drop", (event) => {
      event.preventDefault();
      line.classList.remove("over");
      this.folded.delete(item.id);
      editor.moveElements(this.dragged, item.id);
    });
    return [
      line,
      ...(folded
        ? []
        : item.children.flatMap((child) => this.row(child, depth + 1, words, matches))),
    ];
  }
}
