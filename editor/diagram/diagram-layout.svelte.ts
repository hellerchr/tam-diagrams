// The diagram editor's window layout (DiagramView.svelte), as tam-diagrams' editor had it: the left panel's tab and
// width, the right panel (Properties above Source) with its width, sections and split, the guide sheet, and the view
// switches (snap, grid, minimap, light canvas). Remembered per browser; the sizes and breakpoints are the old editor's (ui.ts).
import { load, save } from "../lib/storage.ts";

/** The left panel's widths: where it starts and how far a drag takes it. */
export const LEFT = { start: 240, least: 200, most: 360 };
/** The right panel's widths; `text` for a type edited as text, `small` in a small window. */
export const RIGHT = { start: 320, small: 280, text: 480, least: 280, most: 560 };
/** Widths of the editor below which the left panel lies over the canvas (`NARROW`), and the right one does too
 *  (`TINY`). */
export const NARROW = 1000;
export const TINY = 860;
/** The least height Properties and Source each keep while both show. */
export const SECTION = 160;
/** The rail's width; the canvas keeps at least `CANVAS_LEAST`. */
export const RAIL = 44;
const CANVAS_LEAST = 240;

export type LeftTab = "shapes" | "outline";

const KEY = "h2.diagram.";
const clamp = (value: number, least: number, most: number) =>
  Math.min(most, Math.max(least, value));

/** A remembered value: read once, written back as it changes. */
function kept<T>(name: string, fallback: T) {
  let value = $state(load(KEY + name, fallback));
  return {
    get value() {
      return value;
    },
    set value(next: T) {
      value = next;
      save(KEY + name, next);
    },
  };
}

export class Layout {
  #width = $state(1440);
  /** The left panel's tab while it lies over the canvas: not remembered, and closed whenever it comes to lie there. */
  #overLeft = $state<LeftTab>();
  /** The left panel's tab: the one chosen before, else Shapes where the window has room for it (the old SMALL). */
  #left = kept<LeftTab | "none">("left", globalThis.innerWidth < 1200 ? "none" : "shapes");
  #leftWidth = kept("leftWidth", LEFT.start);
  #side = kept("side", true);
  #rightWidth = kept("rightWidth", RIGHT.start);
  #properties = kept("properties", true);
  #source = kept("source", true);
  /** The Properties height in pixels while both sections show; 0: half the panel. */
  #split = kept("split", 0);
  #wide = kept("sourceWide", false);
  #folded = kept<string[]>("folded", []);
  #snap = kept("snap", true);
  #grid = kept("grid", true);
  #minimap = kept("minimap", true);
  #light = kept("lightCanvas", true);
  /** The guide sheet beside the canvas. */
  guide = $state(false);

  /** The editor's width, from the shell; the breakpoints read it. */
  get width() {
    return this.#width;
  }
  set width(width: number) {
    if (width < NARROW !== this.narrow) this.#overLeft = undefined;
    this.#width = width;
  }

  get narrow() {
    return this.width < NARROW;
  }
  get tiny() {
    return this.width < TINY;
  }

  /** The left panel's tab; undefined while it is closed. */
  get left(): LeftTab | undefined {
    if (this.narrow) return this.#overLeft;
    const tab = this.#left.value;
    return tab === "none" ? undefined : tab;
  }
  set left(tab: LeftTab | undefined) {
    if (this.narrow) this.#overLeft = tab;
    else this.#left.value = tab ?? "none";
  }
  /** Shows `tab`, or closes the panel when it shows already (the rail's toggles). */
  toggleLeft(tab: LeftTab) {
    this.left = this.left === tab ? undefined : tab;
  }

  get leftWidth() {
    return this.#leftWidth.value;
  }
  set leftWidth(width: number) {
    this.#leftWidth.value = clamp(Math.round(width), LEFT.least, LEFT.most);
  }

  get side() {
    return this.#side.value;
  }
  set side(open: boolean) {
    this.#side.value = open;
  }

  /** The right panel's width: as dragged, but never so wide that the canvas keeps less than its least. */
  get rightWidth() {
    if (this.tiny) return Math.max(0, this.width - RAIL);
    const beside = this.left && !this.narrow ? this.leftWidth : 0;
    return Math.min(
      this.#rightWidth.value,
      Math.max(RIGHT.least, this.width - RAIL - beside - CANVAS_LEAST),
    );
  }
  set rightWidth(width: number) {
    this.#rightWidth.value = clamp(Math.round(width), RIGHT.least, RIGHT.most);
  }

  get properties() {
    return this.#properties.value;
  }
  set properties(open: boolean) {
    this.#properties.value = open;
  }
  get source() {
    return this.#source.value;
  }
  set source(open: boolean) {
    this.#source.value = open;
  }
  get split() {
    return this.#split.value;
  }
  set split(height: number) {
    this.#split.value = Math.round(height);
    this.#wide.value = false;
  }
  /** The source has most of the panel (Properties keeps 30%). */
  get wide() {
    return this.#wide.value;
  }
  set wide(on: boolean) {
    this.#wide.value = on;
  }
  /** The Properties section's height while both sections show, as CSS. */
  get propertiesHeight() {
    return this.wide ? "30%" : this.split ? `${this.split}px` : "50%";
  }

  /** Whether the Properties group titled `title` is folded. */
  folded(title: string) {
    return this.#folded.value.includes(title);
  }
  fold(title: string, folded = !this.folded(title)) {
    const rest = this.#folded.value.filter((t) => t !== title);
    this.#folded.value = folded ? [...rest, title] : rest;
  }

  get snap() {
    return this.#snap.value;
  }
  set snap(on: boolean) {
    this.#snap.value = on;
  }
  get grid() {
    return this.#grid.value;
  }
  set grid(on: boolean) {
    this.#grid.value = on;
  }
  get minimap() {
    return this.#minimap.value;
  }
  set minimap(on: boolean) {
    this.#minimap.value = on;
  }
  /** The canvas is white and the diagram drawn in light colors (lib/paper.ts), whatever the theme. */
  get light() {
    return this.#light.value;
  }
  set light(on: boolean) {
    this.#light.value = on;
  }
}
