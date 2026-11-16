/**
 * The Shapes tab of the left panel. For a diagram edited on the canvas: the shapes of its notation
 * as tiles to drag there, in groups that open and close. For a diagram edited as text: its usual
 * statements as snippets a click adds to the source.
 */

import type { ElementKind } from "../src/tam-edit.ts";
import { h, icon, tipped } from "./dom.ts";
import type { Editor } from "./editor.ts";
import type { Link, Piece } from "../src/structure.ts";
import { linkIcon, pieceIcon, structureOf } from "./structures.ts";
import { type DiagramType, type Shape, type Snippet, typeInfo } from "./types.ts";

export class Palette {
  readonly element = h("div", { class: "tab-body" });
  private readonly editor: Editor;
  /** Adds a snippet to the source, where the cursor is. */
  private readonly insert: (text: string) => void;
  private readonly list = h("div", { class: "palette" });
  private readonly search: HTMLInputElement;
  private readonly tiles = new Map<ElementKind, HTMLButtonElement>();
  /** The groups of shapes, shown as far as the diagram takes their shapes. */
  private groups: { box: HTMLElement; items: Shape[] }[] = [];
  private snippets: { row: HTMLElement; snippet: Snippet }[] = [];
  private pieces: { tile: HTMLElement; piece: Piece }[] = [];
  private readonly links = new Map<string, HTMLElement>();
  private readonly none = h("p", { class: "note" }, "Nothing found.");
  private type: DiagramType | undefined;

  constructor(editor: Editor, insert: (text: string) => void) {
    this.editor = editor;
    this.insert = insert;
    this.search = h("input", {
      class: "field search",
      type: "search",
      onInput: () => this.update(),
    });
    this.element.append(h("div", { class: "tab-tools" }, this.search), this.list);
  }

  /** A group of the list with a header that opens and closes it. */
  private group(title: string, body: HTMLElement): HTMLElement {
    const header = h(
      "button",
      {
        class: "group-header",
        type: "button",
        "aria-expanded": "true",
        onClick: () => {
          const open = header.getAttribute("aria-expanded") !== "true";
          header.setAttribute("aria-expanded", String(open));
          body.hidden = !open;
        },
      },
      icon("chevron"),
      h("span", {}, title),
    );
    return h("section", { class: "palette-group" }, header, body);
  }

  /** Builds the list for a diagram type: its shapes, or its snippets. */
  private build(type: DiagramType) {
    const info = typeInfo(type);
    this.type = type;
    this.tiles.clear();
    this.search.value = "";
    this.search.placeholder = "Find a shape…";
    this.search.setAttribute("aria-label", "Find a shape");
    this.groups = info.palette.map((group) => {
      const tiles = h("div", { class: "tiles" }, ...group.items.map((item) => this.tile(item)));
      return { box: this.group(group.title, tiles), items: group.items };
    });
    // A diagram with a structure shows its pieces and the kinds of join; one edited as text, its statements.
    const structure = structureOf(type);
    this.links.clear();
    this.pieces = (structure?.pieces ?? []).map((piece) => ({ piece, tile: this.piece(piece) }));
    this.snippets = structure
      ? []
      : info.snippets.map((snippet) => ({ snippet, row: this.snippet(snippet) }));
    this.list.replaceChildren(
      ...this.groups.map((group) => group.box),
      ...(structure
        ? [
            this.group(
              info.name,
              h("div", { class: "tiles" }, ...this.pieces.map((item) => item.tile)),
            ),
            ...(structure.links.length > 1
              ? [
                  this.group(
                    "Connections",
                    h("div", { class: "tiles" }, ...structure.links.map((link) => this.link(link))),
                  ),
                ]
              : []),
          ]
        : []),
      ...(this.snippets.length
        ? [
            this.group(
              info.name,
              h("div", { class: "tiles" }, ...this.snippets.map((item) => item.row)),
            ),
          ]
        : []),
      this.none,
    );
  }

  /** A statement of a text diagram, shown as the shape it adds: a click adds it to the source. */
  private snippet(snippet: Snippet): HTMLElement {
    return h(
      "button",
      {
        class: "tile snippet",
        type: "button",
        ...tipped({
          tip: `Add ${snippet.name.toLowerCase()}: ${snippet.text.trim()}`,
          side: "right",
        }),
        onClick: () => this.insert(snippet.text),
      },
      icon(snippet.icon),
      h("span", { class: "name" }, snippet.name),
    );
  }

  /**
   * A piece of a diagram with a structure: a click adds it at the selected part, a drag carries it
   * to a part on the canvas, which shows as the one it would join, or to the empty canvas, where
   * it stands alone.
   */
  private piece(piece: Piece): HTMLElement {
    const { editor } = this;
    const control = h(
      "button",
      {
        class: "tile",
        type: "button",
        ...tipped({
          tip: `${piece.name}: ${piece.about}. Click to add, or drag onto the canvas.`,
          side: "right",
        }),
      },
      icon(pieceIcon(piece.kind)),
      h("span", { class: "name" }, piece.name),
    );
    let start: { x: number; y: number } | undefined, chip: HTMLElement | undefined;
    const over = (event: PointerEvent) => {
      const rect = editor.view.canvas.getBoundingClientRect();
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    };
    const end = () => {
      start = undefined;
      chip?.remove();
      chip = undefined;
      editor.showPieceTarget(undefined);
    };
    control.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      control.setPointerCapture(event.pointerId);
    });
    control.addEventListener("pointermove", (event) => {
      if (!start) return;
      if (!chip && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
      chip ??= document.body.appendChild(
        h("div", { class: "drag-chip" }, icon(pieceIcon(piece.kind)), h("span", {}, piece.name)),
      );
      chip.style.transform = `translate(${event.clientX + 10}px, ${event.clientY + 10}px)`;
      editor.showPieceTarget(
        over(event) ? editor.view.toScene(editor.view.pointOf(event)) : undefined,
        piece.kind,
      );
    });
    control.addEventListener("pointerup", (event) => {
      if (!start) return;
      const dragged = !!chip,
        on = over(event);
      end();
      if (!dragged) editor.addPiece(piece.kind);
      else if (on) editor.dropPiece(piece.kind, editor.view.toScene(editor.view.pointOf(event)));
    });
    control.addEventListener("pointercancel", end);
    // The keyboard adds a piece as a click does.
    control.addEventListener("click", (event) => {
      if (event.detail === 0) editor.addPiece(piece.kind);
    });
    return control;
  }

  /** A kind of join: the one new connections are drawn with, and what a selected join becomes on a click. */
  private link(link: Link): HTMLElement {
    const { editor } = this;
    const control = h(
      "button",
      {
        class: "tile",
        type: "button",
        ...tipped({
          tip: `${link.name}: new connections are drawn as this; a selected one becomes it`,
          side: "right",
        }),
        onClick: () => editor.setLink(link.kind),
      },
      icon(linkIcon(link.kind)),
      h("span", { class: "name" }, link.name),
    );
    this.links.set(link.kind, control);
    return control;
  }

  /**
   * A shape: a click picks it as the tool, to place with a click on the canvas, and a double click
   * keeps the tool to place several; a drag carries the shape to the canvas, shown where it would stand.
   */
  private tile(entry: Shape): HTMLElement {
    const { editor } = this,
      { kind } = entry;
    const control = h(
      "button",
      {
        class: "tile",
        type: "button",
        ...tipped({ tip: `${entry.name}: ${entry.hint}`, key: entry.key, side: "right" }),
      },
      icon(entry.icon),
      h("span", { class: "name" }, entry.name),
    );
    this.tiles.set(kind, control);
    let start: { x: number; y: number } | undefined,
      chip: HTMLElement | undefined,
      clicked = -1000;
    const over = (event: PointerEvent) => {
      const rect = editor.view.canvas.getBoundingClientRect();
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    };
    const end = () => {
      start = undefined;
      chip?.remove();
      chip = undefined;
      editor.showGhost(kind, undefined);
    };
    control.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      control.setPointerCapture(event.pointerId);
    });
    control.addEventListener("pointermove", (event) => {
      if (!start) return;
      if (!chip && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
      chip ??= document.body.appendChild(
        h("div", { class: "drag-chip" }, icon(entry.icon), h("span", {}, entry.name)),
      );
      // Over the canvas the element shows where it would stand; on the way there, as a chip.
      const on = over(event);
      chip.hidden = on;
      chip.style.transform = `translate(${event.clientX + 10}px, ${event.clientY + 10}px)`;
      editor.showGhost(
        kind,
        on ? editor.view.toScene(editor.view.pointOf(event)) : undefined,
        event.altKey,
      );
    });
    control.addEventListener("pointerup", (event) => {
      if (!start) return;
      const dragged = !!chip,
        on = over(event);
      end();
      // A second click soon after the first keeps the tool, to place several.
      const again = event.timeStamp - clicked < 400;
      clicked = event.timeStamp;
      if (!dragged) {
        if (again) editor.setTool(kind, true);
        else editor.setTool(editor.tool === kind ? "select" : kind);
      } else if (on)
        editor.create(kind, editor.view.toScene(editor.view.pointOf(event)), event.altKey);
    });
    control.addEventListener("pointercancel", end);
    // The keyboard picks a shape as the pointer does.
    control.addEventListener("click", (event) => {
      if (event.detail === 0) editor.setTool(editor.tool === kind ? "select" : kind);
    });
    return control;
  }

  /** Shows the editor's state: called whenever it changed. */
  update() {
    const { editor } = this,
      { doc } = editor;
    if (editor.type !== this.type) this.build(editor.type);
    const words = this.search.value.trim().toLowerCase();
    let found = false;
    // Only the shapes the diagram takes are offered: one its level allows.
    for (const group of this.groups) {
      let any = false;
      for (const entry of group.items) {
        const allowed = !!doc.problem || editor.allowsKind(entry.kind),
          shown = allowed && (!words || entry.name.toLowerCase().includes(words)),
          tile = this.tiles.get(entry.kind)!;
        tile.hidden = !shown;
        tile.setAttribute("aria-pressed", String(editor.tool === entry.kind));
        tile.classList.toggle("sticky", editor.tool === entry.kind && editor.sticky);
        any ||= shown;
        if (!allowed && editor.tool === entry.kind) editor.tool = "select";
      }
      group.box.hidden = !any;
      found ||= any;
    }
    for (const { tile, piece } of this.pieces) {
      tile.hidden = !!words && !piece.name.toLowerCase().includes(words);
      found ||= !tile.hidden;
    }
    for (const [kind, tile] of this.links)
      tile.setAttribute("aria-pressed", String(editor.link === kind));
    for (const { row, snippet } of this.snippets) {
      row.hidden =
        !!words &&
        !snippet.name.toLowerCase().includes(words) &&
        !snippet.text.toLowerCase().includes(words);
      found ||= !row.hidden;
    }
    this.none.hidden = found;
  }
}
