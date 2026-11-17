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
const within = (item: TreeItem): string[] => [item.id, ...item.children.flatMap(within)];

/** The line of a row the keyboard is on, if it is on one. */
const lineOf = (active: Element | null, lines: HTMLElement[]) =>
  active instanceof HTMLElement && lines.includes(active) ? active : undefined;

/** How a row shows its element: its drawing, its name, and the name of its kind. */
interface Look {
  icon: IconName;
  name: string;
  kind: string;
}

/** A row of the tree with its element, and whether it holds others and is closed. */
interface Row {
  item: TreeItem;
  line: HTMLElement;
  folded: boolean;
  parent: boolean;
  /** Opens or closes the element, with `deep` all inside it too. */
  toggle(deep: boolean): void;
}

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
      selected = editor.selectedElements,
      mark = selected.join(" ");
    // What is selected on the canvas shows in the tree: the elements around it open.
    if (mark !== this.marked) this.openAround(items, selected);
    const words = this.filter.trim().toLowerCase(),
      key = this.shownKey(items, words);
    // The keyboard is in the tree: it stays there, whatever happens to the row it was on.
    const active = document.activeElement,
      held = this.tree.contains(active)
        ? [...this.rows.values()].indexOf(active as HTMLElement)
        : -1;
    if (key !== this.shown) {
      this.shown = key;
      this.build(items, words);
    }
    for (const [id, line] of this.rows)
      line.setAttribute("aria-selected", String(selected.includes(id)));
    this.placeStop(selected, active, held);
    if (mark !== this.marked) {
      this.marked = mark;
      // The row of what was selected last comes into view, without taking the focus from the canvas.
      this.rows.get(selected.at(-1) ?? "")?.scrollIntoView({ block: "nearest" });
    }
  }

  /** What the tree shows, as a key: it is built again when this changes. */
  private shownKey(items: TreeItem[], words: string) {
    const { editor } = this,
      kinds = [...(editor.doc.picture?.parts?.values() ?? [])].map((part) => part.kind);
    return JSON.stringify([items, kinds, [...this.folded], words, editor.type]);
  }

  /** Opens the elements around the selected ones. */
  private openAround(list: TreeItem[], selected: string[], path: string[] = []) {
    for (const item of list) {
      if (selected.includes(item.id)) path.forEach((id) => this.folded.delete(id));
      this.openAround(item.children, selected, [...path, item.id]);
    }
  }

  /** Whether an element, or one inside it, is found by the words of the search. */
  private matches(item: TreeItem, words: string): boolean {
    if (!words) return true;
    const look = this.look(item);
    return (
      [item.label.toLowerCase(), item.id.toLowerCase(), item.kind].some((text) =>
        text.includes(words),
      ) ||
      [look.name, look.kind].some((text) => text.toLowerCase().includes(words)) ||
      item.children.some((child) => this.matches(child, words))
    );
  }

  /** Builds the rows of the tree again, for the elements the search finds. */
  private build(items: TreeItem[], words: string) {
    this.rows.clear();
    // A tree in which nothing holds anything needs no room for arrows.
    this.tree.classList.toggle("flat", !items.some((item) => item.children.length));
    const lines = items.flatMap((item) => this.row(item, 0, words));
    this.tree.replaceChildren(
      ...(lines.length ? lines : [h("p", { class: "note" }, this.emptyNote(words))]),
    );
  }

  /** What the tree says when it has no rows: nothing is found, or nothing is there. */
  private emptyNote(words: string) {
    const { editor } = this;
    if (words) return "Nothing found.";
    if (editor.editable || editor.structural) return "No elements yet.";
    return `${typeInfo(editor.type).plural} are edited as text: their parts are in the source.`;
  }

  /**
   * One row is the tree's stop for Tab: the one selected last, else the one the keyboard is on or
   * was on (at `held`), else the first.
   */
  private placeStop(selected: string[], active: Element | null, held: number) {
    const lines = [...this.rows.values()],
      stop =
        this.rows.get(selected.at(-1) ?? "") ??
        lineOf(active, lines) ??
        lines[Math.max(0, Math.min(held, lines.length - 1))];
    for (const line of lines) line.tabIndex = line === stop ? 0 : -1;
    if (held >= 0 && stop && document.activeElement !== stop) stop.focus();
  }

  /**
   * How a row shows its element: its drawing, its name, and the name of its kind. A part of a
   * diagram with a structure shows as the piece it is; one without a name of its own, as a start
   * or an end node, goes by the name of its kind.
   */
  private look(item: TreeItem): Look {
    const part = this.editor.doc.picture?.parts?.get(item.id),
      label = (part?.label ?? item.label).replace(/<br\s*\/?>/gi, " ").trim();
    if (part) return this.pieceLook(item.id, part.kind, label);
    return {
      // A note is drawn as the UML note it is.
      icon: item.kind === "note" ? "uml-note" : item.kind,
      name: label || item.id.replace(/#.*/, ""),
      kind: kindName(item.kind),
    };
  }

  /** How a row shows a part of a diagram with a structure: as the piece it is. */
  private pieceLook(id: string, kind: string, label: string): Look {
    const name =
      this.editor.structure?.pieces.find((piece) => piece.kind === kind)?.name ?? kindName(kind);
    // An id the library made up (`root#initial`) is no name to read.
    return { icon: pieceIcon(kind), name: label || (id.includes("#") ? name : id), kind: name };
  }

  /** The row of an element, and below it the rows of what it holds while it is open. */
  private row(item: TreeItem, depth: number, words: string): HTMLElement[] {
    if (!this.matches(item, words)) return [];
    // A search shows what it finds, whatever is closed.
    const folded = !words && this.folded.has(item.id),
      parent = item.children.length > 0,
      toggle = (deep: boolean) => {
        for (const id of deep ? within(item) : [item.id])
          if (folded) this.folded.delete(id);
          else this.folded.add(id);
        this.update();
      },
      line = this.line(item, depth, folded, this.twist(parent, folded, toggle)),
      row: Row = { item, line, folded, parent, toggle };
    this.rows.set(item.id, line);
    line.addEventListener("click", (event) => this.clicked(row, event));
    line.addEventListener("dblclick", () => this.editor.rename(item.id));
    line.addEventListener("contextmenu", (event) => this.menuAt(item, event));
    line.addEventListener("keydown", (event) => this.pressed(row, event));
    this.dragRow(item, line);
    return [
      line,
      ...(folded ? [] : item.children.flatMap((child) => this.row(child, depth + 1, words))),
    ];
  }

  /** The arrow before a row that opens and closes the element, with Alt all inside it. */
  private twist(parent: boolean, folded: boolean, toggle: (deep: boolean) => void) {
    if (!parent) return h("span", { class: "twist none" });
    return h(
      "span",
      {
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
      },
      icon("chevron"),
    );
  }

  /** The line of a row: its arrow, its drawing and its name, with the count of what a closed one holds. */
  private line(item: TreeItem, depth: number, folded: boolean, twist: HTMLElement) {
    const look = this.look(item),
      parent = item.children.length > 0;
    return h(
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
  }

  /** A click selects the element of a row; with Shift, Ctrl or Cmd it adds it, or takes it out. */
  private clicked({ item, line }: Row, event: MouseEvent) {
    const { editor } = this,
      part = { type: "element" as const, id: item.id };
    if (!(event.shiftKey || event.ctrlKey || event.metaKey)) editor.select([part]);
    else if (editor.isSelected(part))
      editor.select(editor.selection.filter((other) => other.id !== item.id));
    else editor.select([...editor.selection, part]);
    editor.reveal(item.id);
    line.focus();
  }

  /** A right click opens the menu of the selection, with the element of the row in it. */
  private menuAt(item: TreeItem, event: MouseEvent) {
    const { editor } = this;
    event.preventDefault();
    if (!editor.isSelected({ type: "element", id: item.id }))
      editor.select([{ type: "element", id: item.id }]);
    this.menu({ x: event.clientX, y: event.clientY });
  }

  /** The keys of a row: the arrows go along the tree and open and close, the others act on the element. */
  private pressed(row: Row, event: KeyboardEvent) {
    // The keys of the history and of the window are not the tree's.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const act = this.keys(row)[event.key];
    if (!act) return;
    act();
    event.preventDefault();
    event.stopPropagation();
  }

  /** What each key does on a row; a key that does nothing there is left out. */
  private keys({ item, line, folded, parent, toggle }: Row): Record<string, (() => void) | false> {
    const { editor } = this,
      lines = [...this.rows.values()],
      at = lines.indexOf(line),
      chosen = () => this.choose(item, line),
      rename = () => (chosen(), editor.rename(item.id)),
      remove = () => (chosen(), editor.deleteSelection());
    return {
      ArrowRight: parent && folded && (() => toggle(false)),
      ArrowLeft: parent && !folded && (() => toggle(false)),
      ArrowDown: () => lines[at + 1]?.click(),
      ArrowUp: () => lines[at - 1]?.click(),
      Home: () => lines[0]?.click(),
      End: () => lines.at(-1)?.click(),
      " ": chosen,
      Enter: rename,
      F2: rename,
      Delete: remove,
      Backspace: remove,
    };
  }

  /** A row the keyboard came to is selected by the keys that act on it. */
  private choose(item: TreeItem, line: HTMLElement) {
    if (!this.editor.isSelected({ type: "element", id: item.id })) line.click();
  }

  /** A row is dragged onto another to put its element, or the selection, inside that one. */
  private dragRow(item: TreeItem, line: HTMLElement) {
    const { editor } = this;
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
  }
}
