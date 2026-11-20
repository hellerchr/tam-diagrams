// What the diagram editor's Shapes tab (DiagramShapes.svelte) shows, as the old editor's palette.ts did: the type's
// shapes in a group under its name and its kinds of connection under "Connections" (a UML type's only when it has
// more than one), as far as the search finds the shapes; the statements of a type edited as text; the tooltips; and a
// tile's press, which is a click or a drag to the canvas once the pointer went 5 pixels.
import type { Point } from "./diagram-hit.ts";
import type { Palette, PaletteItem } from "./palettes.ts";
import type { Snippet } from "./diagram-types.ts";

/** A group of tiles: shapes, or kinds of connection (`links`). */
export type TileGroup = { title: string; items: PaletteItem[]; links: boolean };

const found = (texts: string[], words: string) => {
  const query = words.trim().toLowerCase();
  return !query || texts.some((text) => text.toLowerCase().includes(query));
};

/** The groups of a palette as the search `words` finds its shapes by name; the connections are never searched. A
 *  block diagram's shapes go when none is found, a UML type's group of pieces stays, empty. */
export function tileGroups(
  palette: Palette,
  title: string,
  uml: boolean,
  words: string,
): TileGroup[] {
  const shapes = palette.shapes.filter((item) => found([item.name], words));
  const links = uml && palette.links.length < 2 ? [] : palette.links;
  return [
    ...(shapes.length || uml ? [{ title, items: shapes, links: false }] : []),
    ...(links.length ? [{ title: "Connections", items: links, links: true }] : []),
  ];
}

/** The statements the search finds by their name or text. */
export const snippetsFound = (snippets: Snippet[], words: string) =>
  snippets.filter((snippet) => found([snippet.name, snippet.text], words));

/** The tooltip of a tile, as the old palette worded it. */
export function tileTip(item: PaletteItem, how: { links: boolean; uml: boolean }): string {
  if (how.links && how.uml)
    return `${item.name}: new connections are drawn as this; a selected one becomes it`;
  if (how.links)
    return `${item.hint}. Drag from one element to another, or from the dots beside one. Click again for the connection that fits.`;
  if (how.uml) return `${item.name}: ${item.hint}. Click to add, or drag onto the canvas.`;
  return `${item.name}: ${item.hint}${item.key ? ` (${item.key})` : ""}`;
}

/** The tooltip of a statement's tile. */
export const snippetTip = (snippet: Snippet) =>
  `Add ${snippet.name.toLowerCase()}: ${snippet.text.trim()}`;

/** What a tile does as it is pressed: dragged over the page (`client`, `over` the canvas), then let go. */
export type TileDrag = {
  move: (client: Point, over: boolean, e: PointerEvent) => void;
  /** The pointer was let go: after a drag, or a click. */
  release: (dragged: boolean, over: boolean, e: PointerEvent) => void;
  /** The press ended, however it did. */
  end: () => void;
};

/** How far the pointer goes before a press is a drag. */
const SLOP = 5;

/** A tile's press: pointer events in, a click or a drag out. */
export class TilePress {
  #start: (Point & { id: number }) | undefined;
  #dragging = false;
  readonly #drag: TileDrag;
  readonly #over: (client: Point) => boolean;

  constructor(drag: TileDrag, over: (client: Point) => boolean) {
    this.#drag = drag;
    this.#over = over;
  }

  down(e: PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.#start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }

  move(e: PointerEvent) {
    const start = this.#start;
    if (start?.id !== e.pointerId) return;
    const client = { x: e.clientX, y: e.clientY };
    if (!this.#dragging && Math.hypot(client.x - start.x, client.y - start.y) < SLOP) return;
    this.#dragging = true;
    this.#drag.move(client, this.#over(client), e);
  }

  up(e: PointerEvent) {
    if (this.#start?.id !== e.pointerId) return;
    const dragged = this.#dragging;
    this.cancel();
    this.#drag.release(dragged, this.#over({ x: e.clientX, y: e.clientY }), e);
  }

  cancel() {
    this.#start = undefined;
    this.#dragging = false;
    this.#drag.end();
  }
}
