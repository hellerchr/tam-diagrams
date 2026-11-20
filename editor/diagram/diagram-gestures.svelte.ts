// The diagram canvas's pointer (DiagramCanvas.svelte), as tam-diagrams' old editor had it (editor/editor.ts): a press
// starts a gesture by what lies under the pointer (diagram-gesture-press.ts), a move makes it follow, a release ends
// it with its edit (diagram-gesture-drops.ts); with no button down, what the pointer is over shows, with the
// connection dots of the element under it and the cursor of what a press there would do.
import type { View } from "../lib/zoom.ts";
import { band, type Guide } from "./diagram-arrange.ts";
import type { DiagramEditor } from "./diagram-editor.svelte.ts";
import {
  finish,
  followLabel,
  followLane,
  followMove,
  followResize,
} from "./diagram-gesture-drops.ts";
import type { Doing, Gesture } from "./diagram-gesture-kinds.ts";
import { cursorAt, followEnd, linkHost, press } from "./diagram-gesture-press.ts";
import { type Box, type Part, partAt, type Point, shift } from "./diagram-hit.ts";
import type { Layout } from "./diagram-layout.svelte.ts";
import { movedPast, toScreen } from "./diagram-marks.ts";
import type { Camera, Pictures } from "./diagram-stage.svelte.ts";

/** How near, on screen, a press must be to take a wire. */
export const REACH = 6;

/** What the gestures work on: the editor, the view, the pictures, and the window's state and commands. */
export type GestureHost = {
  ed: DiagramEditor;
  camera: Camera;
  pictures: Pictures;
  layout: Layout;
  stage: () => HTMLElement | undefined;
  lang: () => string;
  /** The tool picked: select, pan, connect, or a block diagram's kind of element. */
  tool: () => string;
  /** The shape tool stays after it placed an element. */
  sticky: () => boolean;
  /** Back to the select tool. */
  select: () => void;
  /** Space is held: any drag pans. */
  space: () => boolean;
  /** Shows where a new element of `kind` would be dropped at `at` (Alt: `free` of the grid); undefined hides it. */
  ghost: (kind?: string, at?: Point, free?: boolean) => void;
  /** Places an element of a kind centred on `at`, and opens its name; `keep` keeps the shape tool. */
  create: (kind: string, at: Point, free: boolean, keep: boolean) => void;
  /** Opens the name of a part; a connection's label at `at`. */
  rename: (part: Part, at?: Point) => void;
  /** Opens the name of a part just added, once its picture shows. */
  placed: (id: string | undefined) => void;
};

/** The pointer on the canvas: one gesture at a time, and what it shows while it runs. */
export class Gestures {
  /** The part under the pointer, with no button down. */
  hover = $state.raw<Part>();
  /** The element whose connection dots show besides the selected one: the one under the pointer, kept while the
   *  pointer goes to a dot. */
  dotted = $state<string>();
  /** The part a palette piece dragged over the canvas would join or go into. */
  pieceTarget = $state<string>();
  /** The gesture under way, replaced as it follows the pointer. */
  gesture = $state.raw<Gesture>();
  /** Lines a moved or resized element is aligned on. */
  guides = $state.raw<Guide[]>([]);
  /** Where the pointer is over the stage, on it and in the diagram: the status bar shows it, a paste lands there,
   *  the dot under it shows larger. */
  screen = $state.raw<Point>();
  pointer = $state.raw<Point>();
  cursor = $state("default");
  readonly host: GestureHost;
  #id: number | undefined;

  constructor(host: GestureHost) {
    this.host = host;
  }

  /** Whether a gesture is under way. */
  get active() {
    return !!this.gesture;
  }
  /** What the pointer is doing between its press and its release, for the status bar's hint. */
  get doing(): Doing | undefined {
    return this.gesture?.type;
  }
  get view(): View {
    return this.host.camera.view;
  }

  /** The pointer's place on the stage. */
  screenOf(e: { clientX: number; clientY: number }): Point {
    const rect = this.host.stage()!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  /** A point of the stage in the diagram. */
  toDiagram = (screen: Point): Point => {
    const { x, y, zoom } = this.view;
    return { x: (screen.x - x) / zoom, y: (screen.y - y) / zoom };
  };

  /** The part under a point of the diagram, as a press finds it. */
  partAt = (p: Point) => {
    const hits = this.host.ed.shown?.hits;
    return hits && partAt(hits, p, REACH / this.view.zoom);
  };

  down = (e: PointerEvent) => {
    const stage = this.host.stage()!;
    stage.focus({ preventScroll: true });
    // A text selection left in a panel would turn the next drag into a drag of that text.
    window.getSelection()?.removeAllRanges();
    if (e.button === 2) return;
    stage.setPointerCapture(e.pointerId);
    const screen = this.screenOf(e);
    this.#id = e.pointerId;
    this.gesture = press(this, e, screen, this.toDiagram(screen));
    this.dotted = undefined;
    this.#cursor(screen);
  };

  move = (e: PointerEvent) => {
    const screen = (this.screen = this.screenOf(e));
    const p = (this.pointer = this.toDiagram(screen));
    const g = this.gesture;
    if (!g) return this.#hovering(screen, p, e.altKey);
    if (e.pointerId !== this.#id) return;
    this.gesture = this.#follow(g, screen, p, e) ?? g;
  };

  /** How a gesture follows the pointer: the gesture as it comes to be (undefined: as it is). */
  #follow(g: Gesture, screen: Point, p: Point, e: PointerEvent): Gesture | undefined {
    const { ed, camera } = this.host;
    switch (g.type) {
      case "pan":
        camera.pan(camera.view, screen.x - g.last.x, screen.y - g.last.y);
        return { ...g, last: screen };
      case "frame":
        ed.selectBand(g.kept, band(g.start, p));
        return {
          ...g,
          current: p,
          moved: g.moved || movedPast(screen, toScreen(this.view, g.start)),
        };
      case "connect":
      case "attach":
        return followEnd(this, g, screen, p);
      case "place":
        this.host.ghost(g.kind, p, e.altKey);
        return undefined;
      case "move":
        return followMove(this, g, screen, e);
      case "resize":
        return followResize(this, g, p, e);
      case "lane":
        return followLane(this, g, p);
      case "label":
        return followLabel(this, g, screen, p);
    }
  }

  up = (e: PointerEvent) => {
    const g = this.gesture;
    if (!g || e.pointerId !== this.#id) return;
    this.gesture = undefined;
    const stage = this.host.stage();
    if (stage?.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    const screen = this.screenOf(e);
    if (!finish(this, g, this.toDiagram(screen), e)) this.endDrag();
    this.#cursor(screen);
  };

  /** The gesture under way stops with nothing made (Escape, a lost pointer); whether there was one. */
  cancel = () => {
    const had = !!this.gesture;
    this.gesture = undefined;
    this.endDrag();
    return had;
  };

  /** The pointer left the stage: nothing under it shows. */
  leave = () => {
    this.screen = this.pointer = undefined;
    if (this.gesture) return;
    this.hover = this.dotted = undefined;
    this.host.ghost();
  };

  /** What the pointer is over with no button down, the element whose dots show, a shape tool's new element. */
  #hovering(screen: Point, p: Point, free: boolean) {
    const tool = this.host.tool();
    this.hover = tool === "pan" ? undefined : this.partAt(p);
    this.dotted = linkHost(this, p);
    if (!["select", "pan", "connect"].includes(tool)) this.host.ghost(tool, p, free);
    this.#cursor(screen);
  }

  /** The cursor over a point of the stage, for what a press there would do; again after Space or a tool changed. */
  #cursor(screen: Point) {
    this.cursor = cursorAt(this, screen);
  }
  refreshCursor = () => this.#cursor(this.screen ?? { x: -1e6, y: -1e6 });

  /** A drag is over, or its picture came: its preview goes. */
  endDrag() {
    this.guides = [];
    this.host.pictures.endPreview();
  }

  /** Where a selected element shows while a move or a resize is dragged, ahead of the picture of the drag. */
  shownBox = (id: string, box: Box): Box => {
    const g = this.gesture;
    if (g?.type === "resize" && g.id === id && g.box) return g.box;
    if (g?.type !== "move" || !g.delta || !this.host.ed.selectedIds().includes(id)) return box;
    return shift(box, g.delta);
  };
}
