/**
 * The Shapes tab of the left panel. For a diagram edited on the canvas: the shapes of its notation
 * as tiles to drag there, in groups that open and close. For a diagram edited as text: its usual
 * statements as snippets a click adds to the source.
 */

import type { ElementKind } from "../src/tam-edit.ts";
import { h, icon, isOff, setOff, tipped } from "./dom.ts";
import type { Editor } from "./editor.ts";
import type { Piece } from "../src/structure.ts";
import type { IconName } from "./icons.ts";
import { linkIcon, pieceIcon, structureOf } from "./structures.ts";
import { type DiagramType, sameType, type Shape, type Snippet, typeInfo } from "./types.ts";

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
    // A block diagram's kinds of connection follow its shapes, as a structure's follow its pieces.
    const links = (info.links ?? []).map((link) =>
      this.link(
        link.kind,
        link.name,
        link.icon,
        `${link.hint}. Drag from one element to another, or from the dots beside one. Click again for the connection that fits.`,
      ),
    );
    this.list.replaceChildren(
      ...this.groups.map((group) => group.box),
      ...(links.length ? [this.group("Connections", h("div", { class: "tiles" }, ...links))] : []),
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
                    h(
                      "div",
                      { class: "tiles" },
                      ...structure.links.map((link) =>
                        this.link(
                          link.kind,
                          link.name,
                          linkIcon(link.kind),
                          `${link.name}: new connections are drawn as this; a selected one becomes it`,
                        ),
                      ),
                    ),
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
    dragTile(control, editor, {
      starts: () => !isOff(control),
      chip: () =>
        h("div", { class: "drag-chip" }, icon(pieceIcon(piece.kind)), h("span", {}, piece.name)),
      move: (event, on) =>
        editor.showPieceTarget(on ? scenePoint(editor, event) : undefined, piece.kind),
      release: (event, dragged, on) => {
        if (!dragged) editor.addPiece(piece.kind);
        else if (on) editor.dropPiece(piece.kind, scenePoint(editor, event));
      },
      end: () => editor.showPieceTarget(undefined),
    });
    // The keyboard adds a piece as a click does.
    control.addEventListener("click", (event) => {
      if (event.detail === 0 && !isOff(control)) editor.addPiece(piece.kind);
    });
    return control;
  }

  /** A kind of join: the one new connections are drawn with, and what a selected join becomes on a click. */
  private link(kind: string, name: string, drawing: IconName, tip: string): HTMLElement {
    const { editor } = this;
    const control = h(
      "button",
      {
        class: "tile",
        type: "button",
        ...tipped({ tip, side: "right" }),
        onClick: () => editor.setLink(kind),
      },
      icon(drawing),
      h("span", { class: "name" }, name),
    );
    this.links.set(kind, control);
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
    let clicked = -1000;
    dragTile(control, editor, {
      chip: () => h("div", { class: "drag-chip" }, icon(entry.icon), h("span", {}, entry.name)),
      // Over the canvas the element shows where it would stand; on the way there, as a chip.
      move: (event, on, chip) => {
        chip.hidden = on;
        editor.showGhost(kind, on ? scenePoint(editor, event) : undefined, event.altKey);
      },
      release: (event, dragged, on) => {
        // A second click soon after the first keeps the tool, to place several.
        const again = event.timeStamp - clicked < 400;
        clicked = event.timeStamp;
        if (dragged) {
          if (on) editor.create(kind, scenePoint(editor, event), event.altKey);
        } else if (again) editor.setTool(kind, true);
        else editor.setTool(editor.tool === kind ? "select" : kind);
      },
      end: () => editor.showGhost(kind, undefined),
    });
    // The keyboard picks a shape as the pointer does.
    control.addEventListener("click", (event) => {
      if (event.detail === 0) editor.setTool(editor.tool === kind ? "select" : kind);
    });
    return control;
  }

  /** Shows the editor's state: called whenever it changed. */
  update() {
    const { editor } = this;
    // An activity diagram that takes its first lane stays the type it was: its list stays.
    if (!this.type || !sameType(editor.type, this.type)) this.build(editor.type);
    const words = this.search.value.trim().toLowerCase(),
      shapes = this.showShapes(words),
      pieces = this.showPieces(words),
      snippets = this.showSnippets(words);
    for (const [kind, tile] of this.links)
      tile.setAttribute("aria-pressed", String(editor.link === kind));
    this.none.hidden = shapes || pieces || snippets;
  }

  /** Shows the groups of shapes as far as the search finds them; true when it found any. */
  private showShapes(words: string) {
    let found = false;
    for (const group of this.groups) {
      const shown = group.items.map((entry) => this.showTile(entry, words));
      group.box.hidden = !shown.includes(true);
      found ||= !group.box.hidden;
    }
    return found;
  }

  /**
   * Shows the tile of a shape, pressed while it is the tool; true when it shows. Only the shapes
   * the diagram takes are offered: one its level allows.
   */
  private showTile(entry: Shape, words: string) {
    const { editor } = this,
      allowed = !!editor.doc.problem || editor.allowsKind(entry.kind),
      shown = allowed && (!words || entry.name.toLowerCase().includes(words)),
      tile = this.tiles.get(entry.kind)!,
      tool = editor.tool === entry.kind;
    tile.hidden = !shown;
    tile.setAttribute("aria-pressed", String(tool));
    tile.classList.toggle("sticky", tool && editor.sticky);
    if (!allowed && tool) editor.tool = "select";
    return shown;
  }

  /** A piece the diagram does not take as it stands is off, with the reason: a group beside lanes. */
  private showPieces(words: string) {
    let found = false;
    for (const { tile, piece } of this.pieces) {
      tile.hidden = !!words && !piece.name.toLowerCase().includes(words);
      setOff(tile, this.editor.pieceRefusal(piece.kind));
      found ||= !tile.hidden;
    }
    return found;
  }

  /** Shows the snippets whose name or text holds the search; true when it found any. */
  private showSnippets(words: string) {
    let found = false;
    for (const { row, snippet } of this.snippets) {
      row.hidden =
        !!words &&
        !snippet.name.toLowerCase().includes(words) &&
        !snippet.text.toLowerCase().includes(words);
      found ||= !row.hidden;
    }
    return found;
  }
}

/** What a tile does as it is dragged to the canvas. */
interface TileDrag {
  /** Whether a press starts anything: a tile that is off starts nothing. */
  starts?(): boolean;
  /** The chip that follows the pointer on its way to the canvas. */
  chip(): HTMLElement;
  /** The pointer moved in a drag, over the canvas when `on`. */
  move(event: PointerEvent, on: boolean, chip: HTMLElement): void;
  /** The pointer was let go: after a drag, or after a click. */
  release(event: PointerEvent, dragged: boolean, on: boolean): void;
  /** The press ended, however it did. */
  end(): void;
}

/** Makes a tile a thing to click or to drag to the canvas: a drag starts once the pointer went 5 pixels. */
function dragTile(control: HTMLElement, editor: Editor, drag: TileDrag) {
  let start: { x: number; y: number } | undefined, chip: HTMLElement | undefined;
  const end = () => {
    start = undefined;
    chip?.remove();
    chip = undefined;
    drag.end();
  };
  control.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag.starts?.() === false) return;
    start = { x: event.clientX, y: event.clientY };
    control.setPointerCapture(event.pointerId);
  });
  control.addEventListener("pointermove", (event) => {
    if (!start) return;
    if (!chip && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
    chip ??= document.body.appendChild(drag.chip());
    chip.style.transform = `translate(${event.clientX + 10}px, ${event.clientY + 10}px)`;
    drag.move(event, overCanvas(editor, event), chip);
  });
  control.addEventListener("pointerup", (event) => {
    if (!start) return;
    const dragged = !!chip,
      on = overCanvas(editor, event);
    end();
    drag.release(event, dragged, on);
  });
  control.addEventListener("pointercancel", end);
}

/** Whether the pointer is over the canvas. */
function overCanvas(editor: Editor, event: PointerEvent): boolean {
  const rect = editor.view.canvas.getBoundingClientRect();
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  );
}

/** The point of the diagram under the pointer. */
const scenePoint = (editor: Editor, event: PointerEvent) =>
  editor.view.toScene(editor.view.pointOf(event));
