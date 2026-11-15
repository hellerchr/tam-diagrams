/**
 * The editor: selection, tools and gestures on the canvas, and the commands the panels and the
 * keyboard run. Every change goes through the document as a new source.
 */

import type { DiagramColors } from "../src/draw.ts";
import type { Box, Point } from "../src/scene.ts";
import {
  type Connection,
  ELEMENT_KINDS,
  parseTam,
  type Placement,
  type TamDiagram,
} from "../src/tam.ts";
import {
  addElement,
  addInterface,
  connect,
  connectionOf,
  copyOf,
  type ConnectionChange,
  duplicate,
  type ElementChange,
  type ElementKind,
  holder,
  moveInto,
  paste,
  place,
  remove,
  setConnection,
  setElement,
  setHeader,
  unplace,
  wrap,
} from "../src/tam-edit.ts";
import { declaredElements } from "../src/tam-pin.ts";
import type { Doc, Picture } from "./document.ts";
import {
  boxesOf,
  boxOf,
  dropTarget,
  elementShapes,
  elementsIn,
  type Part,
  partAt,
  samePart,
  wireParts,
} from "./hit.ts";
import type { View } from "./view.ts";

/** An element in the tree of the diagram. */
export interface TreeItem {
  id: string;
  kind: ElementKind;
  label: string;
  children: TreeItem[];
}

/** What the pointer does on the canvas: select and move, pan, draw a connection, or place an element of a kind. */
export type Tool = "select" | "pan" | "connect" | ElementKind;

/** Elements snap to this grid; Alt moves them freely. */
const GRID = 10;

const snap = (value: number, free: boolean) =>
  free ? Math.round(value) : Math.round(value / GRID) * GRID;

/** A pointer moves this far before a press becomes a drag. */
const SLOP = 4;

/** Handles are this large on screen, and connection handles this far from their element. */
const HANDLE = 8,
  REACH = 16;

/** The handles of a selected element: which edges each moves. */
const HANDLES = [
  { x: -1, y: -1, cursor: "nwse-resize" },
  { x: 0, y: -1, cursor: "ns-resize" },
  { x: 1, y: -1, cursor: "nesw-resize" },
  { x: 1, y: 0, cursor: "ew-resize" },
  { x: 1, y: 1, cursor: "nwse-resize" },
  { x: 0, y: 1, cursor: "ns-resize" },
  { x: -1, y: 1, cursor: "nesw-resize" },
  { x: -1, y: 0, cursor: "ew-resize" },
] as const;

type Handle = (typeof HANDLES)[number];

/** A gesture under way, from the press of the pointer to its release. */
type Gesture =
  | { type: "pan"; last: Point }
  | {
      type: "move";
      /** The press, on the canvas and in the diagram. */
      screen: Point;
      start: Point;
      /** Set once the pointer moved past SLOP: the placed source the move starts from. */
      base?: {
        picture: Picture;
        outer: string[];
        places: Map<string, Placement>;
        all: Set<string>;
      };
      result?: string;
      target?: string | null;
      /** Lines the moved element is aligned on with others, in the diagram. */
      guides?: [Point, Point][];
    }
  | {
      type: "resize";
      id: string;
      handle: Handle;
      start: Point;
      base: string;
      box: Box;
      /** A leaf's least size, or the box around a container's parts. */
      least: { width: number; height: number } | Box;
      container: boolean;
      result?: string;
    }
  | { type: "frame"; start: Point; current: Point; kept: Part[] }
  | { type: "connect"; from: string; current: Point; target?: string }
  /** An end of a connection dragged to another element. */
  | { type: "attach"; id: string; end: "from" | "to"; current: Point; target?: string };

/** The size a new element of a kind is shown at before it is placed; its name sizes it after. */
const sizeOf = (kind: ElementKind) =>
  kind === "group"
    ? { width: 160, height: 100 }
    : kind === "human"
      ? { width: 76, height: 66 }
      : { width: 96, height: kind === "storage" ? 36 : 40 };

/** Where a new element of a kind stands when dropped at a point: around it, on the grid. */
const dropPlace = (kind: ElementKind, at: Point, free: boolean): Point => ({
  x: snap(at.x - sizeOf(kind).width / 2, free),
  y: snap(at.y - sizeOf(kind).height / 2, free),
});

/** A moved element snaps to the edges and middles of others within this many screen pixels. */
const ALIGN = 6;

const NAMES: Record<ElementKind, string> = {
  agent: "Agent",
  human: "User",
  storage: "Storage",
  component: "Component",
  subsystem: "Subsystem",
  class: "Class",
  package: "Package",
  group: "",
};

export class Editor {
  readonly doc: Doc;
  readonly view: View;
  colors: DiagramColors;
  /** The accent color of selections and handles. */
  accent = "#2a78d6";
  selection: Part[] = [];
  tool: Tool = "select";
  /** Called when the selection, the tool or the document changed: the panels show them. */
  onState: () => void = () => {};
  /** Says something to the user in passing: why an edit was not made. */
  notify: (message: string) => void = () => {};
  /** Opens a text field over the canvas; the panels provide it. */
  editText: (
    box: Box,
    text: string,
    options: { size: number; weight: number },
    done: (text: string | undefined) => void,
  ) => void = () => {};
  private gesture: Gesture | undefined;
  private hover: Part | undefined;
  /** The element whose connection dots show: the one under the pointer, until the pointer leaves the dots. */
  private linkHost: string | undefined;
  /** A new element shown before it is placed: under the pointer with a shape tool, or dragged from the palette. */
  private ghost: { kind: ElementKind; at: Point; target: string | null } | undefined;
  private space = false;
  /** What was copied last, and how often it was pasted. */
  private copied: { text: string; times: number } | undefined;
  /** Whether the pointer is on the canvas. */
  private over = false;
  private pointer: Point = { x: 0, y: 0 };

  constructor(doc: Doc, view: View, colors: DiagramColors) {
    this.doc = doc;
    this.view = view;
    this.colors = colors;
    view.overlay = (context) => this.drawOverlay(context);
    const { canvas } = view;
    canvas.addEventListener("pointerdown", (event) => this.down(event));
    canvas.addEventListener("pointermove", (event) => this.move(event));
    canvas.addEventListener("pointerup", (event) => this.up(event));
    canvas.addEventListener("pointercancel", () => this.abort());
    canvas.addEventListener("dblclick", (event) => this.doubleClick(event));
    canvas.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerenter", () => (this.over = true));
    canvas.addEventListener("pointerleave", () => (this.over = false));
    // Copy, cut and paste work on the selection unless a text field has the focus.
    const typing = (event: Event) => {
      const target = event.target as HTMLElement | null;
      return (
        !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      );
    };
    const copy = (event: ClipboardEvent, cut: boolean) => {
      if (typing(event)) return;
      const text = this.copy();
      if (text === undefined) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
      if (cut) this.deleteSelection();
    };
    document.addEventListener("copy", (event) => copy(event, false));
    document.addEventListener("cut", (event) => copy(event, true));
    document.addEventListener("paste", (event) => {
      if (typing(event)) return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      this.paste(text);
    });
    window.addEventListener("keydown", (event) => this.key(event));
    window.addEventListener("keyup", (event) => {
      if (event.key === " ") {
        this.space = false;
        this.cursor();
      }
    });
  }

  private get picture() {
    return this.doc.picture;
  }

  /** The picture changed: selections of what is gone go with it. */
  refresh() {
    const { picture } = this;
    if (picture && !this.gesture && picture.source === this.doc.source) {
      const { diagram } = picture;
      this.selection = this.selection.filter((part) =>
        part.type === "element"
          ? diagram.nodes.has(part.id)
          : diagram.edges.some((edge) => edge.id === part.id),
      );
    }
    void this.view.show(
      this.doc.svg(this.colors),
      picture?.scene.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
    );
    this.view.invalidate();
    this.onState();
  }

  // Selection.

  select(parts: Part[]) {
    this.selection = parts;
    this.view.invalidate();
    this.onState();
  }

  isSelected(part: Part) {
    return this.selection.some((other) => samePart(other, part));
  }

  get selectedElements(): string[] {
    return this.selection.filter((part) => part.type === "element").map((part) => part.id);
  }

  get selectedWires(): string[] {
    return this.selection.filter((part) => part.type === "wire").map((part) => part.id);
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.ghost = undefined;
    this.view.invalidate();
    this.cursor();
    this.onState();
  }

  // Commands. Each makes one change to the source; a change the notation forbids is said, not made.

  /** Applies a new source; false, with a notice, when it breaks a rule of the notation. */
  private change(source: string | undefined): boolean {
    if (source === undefined) {
      this.notify(
        this.doc.problem
          ? "Fix the source first: it does not parse."
          : "The layout is not ready yet.",
      );
      return false;
    }
    const problem = this.doc.tryApply(source);
    if (problem) this.notify(problem.message.replace(/^Line \d+: /, ""));
    return !problem;
  }

  /** Runs an edit of the committed source, which must parse. */
  private edit(make: (source: string) => string): boolean {
    if (this.doc.problem) return this.change(undefined);
    try {
      return this.change(make(this.doc.source));
    } catch (reason) {
      this.notify(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }

  /** Whether an edit leaves a source the notation allows: the panels offer only such choices. */
  private allows(make: (source: string) => string): boolean {
    if (this.doc.problem) return false;
    try {
      parseTam(make(this.doc.source));
      return true;
    } catch {
      return false;
    }
  }

  /** Whether a connection may change this way, between the elements it joins. */
  allowsWire(id: string, change: ConnectionChange) {
    return this.allows((source) => setConnection(source, id, change));
  }

  /** Whether the selected elements may change this way, where they stand and with their connections. */
  allowsElements(change: ElementChange) {
    const ids = this.selectedElements;
    return this.allows((source) => ids.reduce((next, id) => setElement(next, id, change), source));
  }

  /** The elements of the diagram as a tree: what each holds, in the order of the source. */
  get tree(): TreeItem[] {
    const { picture } = this;
    if (!picture) return [];
    const { diagram } = picture;
    const items = (ids: string[]): TreeItem[] =>
      ids.flatMap((id) => {
        const node = diagram.nodes.get(id)!;
        if (id.endsWith("#row")) return items(node.children);
        if (!(ELEMENT_KINDS as readonly string[]).includes(node.kind)) return [];
        if (node.origin && node.origin !== id) return [];
        return [
          { id, kind: node.kind as ElementKind, label: node.label, children: items(node.children) },
        ];
      });
    return items(diagram.roots);
  }

  /** Whether elements may stand inside another, or at the top with null. */
  allowsMove(ids: string[], parent: string | null) {
    return (
      !ids.includes(parent ?? "") &&
      this.allows((source) => {
        const moved = moveInto(source, ids, parent);
        if (moved === source) throw new Error("Nothing moves.");
        return moved;
      })
    );
  }

  /** Puts elements inside another, or at the top with null: below what stands there, so nothing lies on anything. */
  moveElements(ids: string[], parent: string | null) {
    const base = this.doc.placedSource();
    if (base === undefined) return this.change(undefined);
    try {
      const picture = this.doc.layout(base),
        { outer } = this.movers(picture.diagram, ids),
        into = parent ? boxOf(picture, parent) : picture.scene.bounds;
      let source = base,
        x = (into?.x ?? 0) + 2 * GRID;
      for (const id of outer) {
        const box = boxOf(picture, id);
        if (!box || !into) continue;
        const { places } = this.movers(picture.diagram, [id]);
        source = place(
          source,
          shifted(places, snap(x - box.x, false), snap(into.y + into.height + GRID - box.y, false)),
        );
        x += box.width + 2 * GRID;
      }
      if (this.change(moveInto(source, outer, parent)))
        this.select(outer.map((id) => ({ type: "element", id })));
    } catch (reason) {
      this.notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  /** Brings an element into view when it is outside it. */
  reveal(id: string) {
    const { picture, view } = this,
      box = picture && boxOf(picture, id);
    if (!box) return;
    const on = view.boxOnScreen(box),
      { width, height } = view.size;
    if (on.x >= 0 && on.y >= 0 && on.x + on.width <= width && on.y + on.height <= height) return;
    view.panBy(width / 2 - on.x - on.width / 2, height / 2 - on.y - on.height / 2);
  }

  /** Whether an element may provide or require an interface. */
  allowsInterface(id: string) {
    return this.allows((source) => addInterface(source, id, "provides", "I"));
  }

  deleteSelection() {
    if (!this.selection.length) return;
    const ids = this.selection.map((part) => part.id);
    if (this.edit((source) => remove(source, ids))) this.select([]);
  }

  duplicateSelection() {
    const ids = this.selectedElements;
    if (!ids.length) return;
    let made: string[] = [];
    const done = this.edit((source) => {
      const result = duplicate(source, ids, { x: 2 * GRID, y: 2 * GRID });
      made = result.ids;
      return result.source;
    });
    if (done) this.select(made.map((id) => ({ type: "element", id })));
  }

  /** The selected elements as text, with the connections among them: what copying puts on the clipboard. */
  copy(): string | undefined {
    const ids = this.selectedElements;
    if (!ids.length || this.doc.problem) return undefined;
    try {
      this.copied = { text: copyOf(this.doc.source, ids), times: 0 };
      return this.copied.text;
    } catch {
      return undefined;
    }
  }

  /** Adds copied elements: under the pointer when it is on the canvas, else a step beside their originals. */
  paste(text: string) {
    const fragment = text.replace(/\r\n?/g, "\n").trim();
    try {
      if (!fragment || !parseTam(fragment).nodes.size) return;
    } catch {
      return this.notify("The clipboard holds no elements.");
    }
    const placed = !!this.picture?.placed,
      base = placed ? this.doc.placedSource() : this.doc.source;
    if (base === undefined) return void this.change(undefined);
    // Each paste of the same text stands a step further, so copies do not hide each other.
    if (this.copied?.text !== fragment) this.copied = { text: fragment, times: 0 };
    const step = ++this.copied.times * 2 * GRID,
      places = [...parseTam(fragment).nodes.values()].flatMap((node) => (node.at ? [node.at] : []));
    const origin = places.length
      ? { x: Math.min(...places.map((at) => at.x)), y: Math.min(...places.map((at) => at.y)) }
      : this.pointer;
    const at = this.over
      ? { x: snap(this.pointer.x, false), y: snap(this.pointer.y, false) }
      : { x: origin.x + step, y: origin.y + step };
    let made: string[] = [];
    const done = this.change(
      (() => {
        const result = paste(base, fragment, { at, placed });
        made = result.ids;
        return result.source;
      })(),
    );
    if (done) this.select(made.map((id) => ({ type: "element", id })));
  }

  /** Whether the selected elements may stand together in a new element of a kind. */
  allowsWrap(kind: ElementKind) {
    const ids = this.selectedElements;
    return (
      ids.length > 0 && this.allows((source) => wrap(source, ids, { kind, label: "x" }).source)
    );
  }

  /** Puts the selected elements in a new element that holds them, and opens its name. */
  wrapSelection(kind: ElementKind) {
    const ids = this.selectedElements;
    if (!ids.length) return;
    let made = "";
    const done = this.edit((source) => {
      const result = wrap(source, ids, { kind, label: NAMES[kind] || undefined });
      made = result.id;
      return result.source;
    });
    if (!done) return;
    this.select([{ type: "element", id: made }]);
    if (kind !== "group") void this.whenShown().then(() => this.rename(made));
  }

  /** The element that holds all selected elements, when one does. */
  get selectionHolder(): string | null {
    const { picture } = this,
      ids = this.selectedElements;
    if (!picture || !ids.length) return null;
    const holders = new Set(ids.map((id) => holder(picture.diagram, id)));
    return holders.size === 1 ? [...holders][0] : null;
  }

  /** Takes the selected elements out of the element that holds them, into the one around it. */
  takeOut() {
    const { picture } = this,
      inside = this.selectionHolder;
    if (!picture || !inside) return;
    this.moveElements(this.selectedElements, holder(picture.diagram, inside));
  }

  /** Resolves when the picture of the committed source is on show. */
  private async whenShown() {
    for (let tries = 0; tries < 200 && this.picture?.source !== this.doc.source; tries++)
      await new Promise((resolve) => setTimeout(resolve, 25));
  }

  /** What was copied last here, for a paste the browser's clipboard does not serve. */
  get copiedText() {
    return this.copied?.text;
  }

  /** What a right click asks for; the panels show the menu. */
  onMenu: (at: { x: number; y: number }, point: Point) => void = () => {};

  selectAll() {
    const { picture } = this;
    if (!picture) return;
    this.select(
      declaredElements(picture.diagram).map((node) => ({ type: "element", id: node.id })),
    );
  }

  setElements(change: ElementChange) {
    const ids = this.selectedElements;
    this.edit((source) => ids.reduce((next, id) => setElement(next, id, change), source));
  }

  setWire(id: string, change: ConnectionChange) {
    this.edit((source) => setConnection(source, id, change));
  }

  addInterface(id: string, offers: "provides" | "requires", name: string) {
    this.edit((source) => addInterface(source, id, offers, name));
  }

  setHeader(header: Parameters<typeof setHeader>[1]) {
    this.edit((source) => setHeader(source, header));
  }

  allowsHeader(header: Parameters<typeof setHeader>[1]) {
    return this.allows((source) => setHeader(source, header));
  }

  /** Whether the diagram takes elements of a kind: a conceptual one takes no components. */
  allowsKind(kind: ElementKind) {
    return this.allows((source) => addElement(source, { kind, label: "x" }).source);
  }

  /** The connection behind a selected wire; undefined for an interface's line. */
  connection(id: string): Connection | undefined {
    try {
      return this.doc.problem ? undefined : connectionOf(this.doc.source, id);
    } catch {
      return undefined;
    }
  }

  /** Clears every placement: the layout is automatic again. */
  async autoLayout() {
    if (this.edit(unplace)) await this.fitSoon();
  }

  /** Fits the picture once the layout under way is shown. */
  async fitSoon() {
    for (let tries = 0; tries < 200 && this.picture?.source !== this.doc.source; tries++)
      await new Promise((resolve) => setTimeout(resolve, 25));
    // The page may still be finding its size.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    this.fit();
  }

  fit() {
    const bounds = this.picture?.scene.bounds;
    if (bounds && bounds.width) this.view.fit(bounds);
    else {
      this.view.zoom = 1;
      this.view.origin = { x: 80, y: 80 };
      this.view.invalidate();
      this.view.onView();
    }
  }

  /** Moves the selected elements by a step. */
  nudge(dx: number, dy: number) {
    const base = this.doc.placedSource();
    if (base === undefined || !this.selectedElements.length) return;
    const moving = this.movers(parseTam(base), this.selectedElements);
    this.change(place(base, shifted(moving.places, dx, dy)));
  }

  /** The outermost of some elements, and the placements of all that move with them. */
  private movers(diagram: TamDiagram, ids: string[]) {
    const chosen = new Set(ids);
    const within = (id: string): boolean => {
      const parent = holder(diagram, id);
      return parent !== null && (chosen.has(parent) || within(parent));
    };
    const outer = ids.filter((id) => diagram.nodes.has(id) && !within(id));
    const places = new Map<string, Placement>(),
      all = new Set<string>();
    const take = (id: string) => {
      const node = diagram.nodes.get(id)!;
      if (node.origin && node.origin !== id) return;
      if (!id.endsWith("#row")) all.add(id);
      if (node.at && !id.endsWith("#row")) places.set(id, node.at);
      node.children.forEach(take);
    };
    outer.forEach(take);
    return { outer, places, all };
  }

  /** Places a new element at a point of the diagram, inside the element there, and opens its name. */
  create(kind: ElementKind, at: Point, free = false) {
    const base = this.doc.placedSource(),
      { picture } = this;
    if (base === undefined) return this.change(undefined);
    const parent = picture ? dropTarget(picture, at, new Set(), true) : null;
    const size = kind === "group" ? sizeOf(kind) : {};
    let made = "";
    this.ghost = undefined;
    const add = (into: string | null) => {
      const result = addElement(base, {
        kind,
        label: NAMES[kind] || undefined,
        at: { ...dropPlace(kind, at, free), ...size },
        parent: into,
      });
      made = result.id;
      return result.source;
    };
    const problem = this.doc.tryApply(add(parent));
    if (problem) {
      this.notify(problem.message.replace(/^Line \d+: /, ""));
      return false;
    }
    this.tool = "select";
    this.select([{ type: "element", id: made }]);
    if (kind !== "group") this.rename(made);
    return true;
  }

  /** Shows where a new element would stand if dropped at a point of the diagram; without a point, hides it. */
  showGhost(kind: ElementKind, at: Point | undefined, free = false) {
    const { picture } = this;
    const target = at && picture ? dropTarget(picture, at, new Set(), true) : null;
    // An element the one under it cannot hold shows no place to stand.
    const fits =
      !target ||
      this.allows((source) => addElement(source, { kind, label: "x", parent: target }).source);
    this.ghost = at && fits ? { kind, at: dropPlace(kind, at, free), target } : undefined;
    this.view.canvas.style.cursor = at && !fits ? "not-allowed" : "";
    this.view.invalidate();
  }

  /** Opens the name of an element, or the label of a connection, for typing on the canvas. */
  rename(id: string, wire = false, at?: Point) {
    const { picture } = this;
    if (!picture || this.doc.problem) return;
    if (wire) {
      const connection = this.connection(id);
      if (!connection || connection.word === "dependency" || !at) return;
      const box = { x: at.x - 70, y: at.y - 12, width: 140, height: 24 };
      this.editText(box, connection.label ?? "", { size: 12, weight: 400 }, (text) => {
        if (text !== undefined && text !== (connection.label ?? ""))
          this.setWire(id, { label: text });
      });
      return;
    }
    // The element may be on its way: its picture comes after the layout.
    const box = boxOf(picture, id) ?? {
      x: this.pointer.x - 48,
      y: this.pointer.y - 20,
      width: 96,
      height: 40,
    };
    const node = picture.diagram.nodes.get(id),
      container = !!node?.children.length;
    const field = container ? { ...box, height: Math.min(box.height, 34) } : box;
    const label = (node?.label ?? NAMES.agent).replace(/<br\s*\/?>/gi, "\n");
    this.editText(field, label, { size: 14, weight: container ? 600 : 400 }, (text) => {
      if (text !== undefined && text !== label)
        this.edit((source) => setElement(source, id, { label: text }));
    });
  }

  // Gestures.

  private down(event: PointerEvent) {
    const { view } = this,
      screen = view.pointOf(event),
      point = view.toScene(screen);
    this.pointer = point;
    view.canvas.setPointerCapture(event.pointerId);
    if (event.button === 2) {
      // A right click selects what it is on, unless that is selected already, and asks for the menu.
      const part = this.picture && partAt(this.picture, point, 6 / view.zoom);
      if (!part) this.select([]);
      else if (!this.isSelected(part)) this.select([part]);
      view.canvas.releasePointerCapture(event.pointerId);
      this.onMenu({ x: event.clientX, y: event.clientY }, point);
      return;
    }
    if (event.button === 1 || this.space || this.tool === "pan") {
      this.gesture = { type: "pan", last: screen };
      this.cursor();
      return;
    }
    if (event.button !== 0) return;
    const { picture } = this,
      part = picture && partAt(picture, point, 6 / view.zoom);
    if (this.tool !== "select" && this.tool !== "connect") {
      this.create(this.tool, point, event.altKey);
      return;
    }
    if (this.tool === "connect") {
      if (part?.type === "element")
        this.gesture = { type: "connect", from: part.id, current: point };
      return;
    }
    const handle = this.handleAt(screen);
    if (handle && picture) {
      this.startResize(handle.id, handle.handle, point);
      return;
    }
    const end = this.endAt(screen);
    if (end) {
      this.gesture = { type: "attach", ...end, current: point };
      return;
    }
    const link = this.linkAt(screen);
    if (link) {
      this.gesture = { type: "connect", from: link, current: point };
      return;
    }
    if (!part) {
      const kept = event.shiftKey ? this.selection : [];
      this.select(kept);
      this.gesture = { type: "frame", start: point, current: point, kept };
      return;
    }
    if (event.shiftKey)
      this.select(
        this.isSelected(part)
          ? this.selection.filter((other) => !samePart(other, part))
          : [...this.selection, part],
      );
    else if (!this.isSelected(part)) this.select([part]);
    if (part.type === "element" && this.isSelected(part))
      this.gesture = { type: "move", screen, start: point };
  }

  private move(event: PointerEvent) {
    const { view, gesture } = this,
      screen = view.pointOf(event),
      point = view.toScene(screen);
    this.pointer = point;
    if (!gesture) {
      const { picture } = this;
      const hover =
        picture && this.tool !== "pan" ? partAt(picture, point, 6 / view.zoom) : undefined;
      if (!samePart(hover, this.hover) && (hover || this.hover)) {
        this.hover = hover;
        view.invalidate();
      }
      // The dots stay while the pointer is on its way to them.
      const host =
        this.tool !== "select" ? undefined : hover?.type === "element" ? hover.id : this.linkHost;
      const near = host && picture ? boxOf(picture, host) : undefined;
      const reach = (REACH + HANDLE + 2) / view.zoom;
      const kept =
        near &&
        point.x >= near.x - reach &&
        point.x <= near.x + near.width + reach &&
        point.y >= near.y - reach &&
        point.y <= near.y + near.height + reach
          ? host
          : undefined;
      if (kept !== this.linkHost) {
        this.linkHost = kept;
        view.invalidate();
      }
      if (this.tool !== "select" && this.tool !== "pan" && this.tool !== "connect")
        this.showGhost(this.tool, point, event.altKey);
      if (this.linkHost) view.invalidate();
      this.cursor(screen);
      return;
    }
    switch (gesture.type) {
      case "pan":
        view.panBy(screen.x - gesture.last.x, screen.y - gesture.last.y);
        gesture.last = screen;
        return;
      case "frame":
        gesture.current = point;
        if (this.picture) {
          const caught = elementsIn(this.picture, frameOf(gesture.start, point)).map(
            (id): Part => ({ type: "element", id }),
          );
          this.selection = [
            ...gesture.kept,
            ...caught.filter((part) => !gesture.kept.some((kept) => samePart(kept, part))),
          ];
          this.onState();
        }
        view.invalidate();
        return;
      case "attach": {
        gesture.current = point;
        // Only an element the connection may end at takes it.
        const part = this.picture && partAt(this.picture, point, 0);
        gesture.target =
          part?.type === "element" && this.allowsWire(gesture.id, { [gesture.end]: part.id })
            ? part.id
            : undefined;
        view.invalidate();
        return;
      }
      case "connect": {
        gesture.current = point;
        const part = this.picture && partAt(this.picture, point, 0);
        gesture.target = part?.type === "element" && part.id !== gesture.from ? part.id : undefined;
        view.invalidate();
        return;
      }
      case "move":
        this.drag(gesture, screen, point, event);
        return;
      case "resize":
        this.resize(gesture, point, event.altKey);
        return;
    }
  }

  /** Moves the selected elements with the pointer, into the container under it. */
  private drag(
    gesture: Extract<Gesture, { type: "move" }>,
    screen: Point,
    point: Point,
    event: PointerEvent,
  ) {
    if (!gesture.base) {
      if (Math.hypot(screen.x - gesture.screen.x, screen.y - gesture.screen.y) < SLOP) return;
      const source = this.doc.placedSource();
      if (source === undefined) {
        this.gesture = undefined;
        this.change(undefined);
        return;
      }
      const picture = this.doc.layout(source);
      gesture.base = { picture, ...this.movers(picture.diagram, this.selectedElements) };
    }
    const { picture, outer, places, all } = gesture.base;
    // The first element lands on the grid; the others keep their distance to it.
    const lead = places.get(outer[0]) ?? [...places.values()][0];
    if (!lead) return;
    let dx = snap(lead.x + point.x - gesture.start.x, event.altKey) - lead.x,
      dy = snap(lead.y + point.y - gesture.start.y, event.altKey) - lead.y;
    // Near the edge or middle of another element the moved one lines up with it instead.
    gesture.guides = [];
    const box = boxOf(picture, outer[0]);
    if (box && !event.altKey) {
      const others = elementShapes(picture)
        .filter(({ id }) => !all.has(id))
        .map(({ shape }) => shape.box);
      const stops = (item: Box, axis: "x" | "y") => {
        const extent = axis === "x" ? item.width : item.height;
        return [item[axis], item[axis] + extent / 2, item[axis] + extent];
      };
      const align = (axis: "x" | "y", shift: number) => {
        const moved = { ...box, [axis]: box[axis] + shift };
        let best: { by: number; at: number; other: Box } | undefined;
        for (const other of others)
          for (const mine of stops(moved, axis))
            for (const theirs of stops(other, axis)) {
              const by = theirs - mine;
              if (
                Math.abs(by) <= ALIGN / this.view.zoom &&
                (!best || Math.abs(by) < Math.abs(best.by))
              )
                best = { by, at: theirs, other };
            }
        return best;
      };
      const across = align("x", dx),
        down = align("y", dy);
      if (across) dx = Math.round((dx + across.by) * 2) / 2;
      if (down) dy = Math.round((dy + down.by) * 2) / 2;
      const moved = { ...box, x: box.x + dx, y: box.y + dy };
      if (across)
        gesture.guides.push([
          { x: across.at, y: Math.min(moved.y, across.other.y) - 12 },
          {
            x: across.at,
            y: Math.max(moved.y + moved.height, across.other.y + across.other.height) + 12,
          },
        ]);
      if (down)
        gesture.guides.push([
          { x: Math.min(moved.x, down.other.x) - 12, y: down.at },
          { x: Math.max(moved.x + moved.width, down.other.x + down.other.width) + 12, y: down.at },
        ]);
    }
    const moved = place(picture.source, shifted(places, dx, dy));
    const target = dropTarget(picture, point, all, event.ctrlKey || event.metaKey);
    gesture.target = undefined;
    let result = moved;
    if (outer.some((id) => holder(picture.diagram, id) !== target)) {
      try {
        const nested = moveInto(moved, outer, target);
        parseTam(nested);
        result = nested;
        gesture.target = target;
      } catch {
        // The notation forbids the element there: it stays in its container.
      }
    }
    if (this.doc.preview(result)) gesture.result = result;
  }

  private startResize(id: string, handle: Handle, start: Point) {
    const base = this.doc.placedSource();
    if (base === undefined) return void this.change(undefined);
    try {
      const picture = this.doc.layout(base),
        box = boxOf(picture, id)!,
        container = !!picture.diagram.nodes.get(id)?.children.length;
      // Without its placement the element shows what it needs: a leaf its size, a container the box around its parts.
      const least = boxOf(this.doc.layout(place(base, new Map([[id, undefined]]))), id)!;
      this.gesture = { type: "resize", id, handle, start, base, box, least, container };
    } catch {
      this.notify("This element cannot be resized.");
    }
  }

  private resize(gesture: Extract<Gesture, { type: "resize" }>, point: Point, free: boolean) {
    const { box, handle, least, container } = gesture;
    let left = box.x,
      top = box.y,
      right = box.x + box.width,
      bottom = box.y + box.height;
    const dx = point.x - gesture.start.x,
      dy = point.y - gesture.start.y;
    if (handle.x < 0) left = snap(left + dx, free);
    if (handle.x > 0) right = snap(right + dx, free);
    if (handle.y < 0) top = snap(top + dy, free);
    if (handle.y > 0) bottom = snap(bottom + dy, free);
    if (container && "x" in least) {
      left = Math.min(left, Math.floor(least.x));
      top = Math.min(top, Math.floor(least.y));
      right = Math.max(right, Math.ceil(least.x + least.width));
      bottom = Math.max(bottom, Math.ceil(least.y + least.height));
    } else {
      const width = Math.ceil(least.width),
        height = Math.ceil(least.height);
      if (right - left < width) {
        if (handle.x < 0) left = right - width;
        else right = left + width;
      }
      if (bottom - top < height) {
        if (handle.y < 0) top = bottom - height;
        else bottom = top + height;
      }
    }
    // A leaf at its least size needs none: its name sizes it.
    const natural =
      !container &&
      right - left <= Math.ceil(least.width) &&
      bottom - top <= Math.ceil(least.height);
    const at: Placement = natural
      ? { x: left, y: top }
      : { x: left, y: top, width: right - left, height: bottom - top };
    const result = place(gesture.base, new Map([[gesture.id, at]]));
    if (this.doc.preview(result)) gesture.result = result;
  }

  private up(event: PointerEvent) {
    const { gesture, view } = this;
    this.gesture = undefined;
    if (view.canvas.hasPointerCapture(event.pointerId))
      view.canvas.releasePointerCapture(event.pointerId);
    if (!gesture) return;
    switch (gesture.type) {
      case "move":
      case "resize":
        if (gesture.result !== undefined && gesture.result !== this.doc.source)
          this.change(gesture.result);
        else if (gesture.type === "resize" || gesture.base) this.doc.cancel();
        break;
      case "attach":
        if (gesture.target) this.setWire(gesture.id, { [gesture.end]: gesture.target });
        break;
      case "connect":
        if (gesture.target) this.connect(gesture.from, gesture.target);
        else this.connectNew(gesture.from, gesture.current);
        break;
      case "frame":
      case "pan":
        break;
    }
    view.invalidate();
    this.cursor(view.pointOf(event));
  }

  /** Connects two elements with the word that fits them and selects the connection. */
  connect(from: string, to: string) {
    if (!this.edit((source) => connect(source, from, to))) return;
    const made = parseTam(this.doc.source).edges.findLast((edge) => !edge.id.includes("#"));
    this.tool = "select";
    if (made) this.select([{ type: "wire", id: made.id }]);
  }

  /** A connection dropped on the empty canvas ends at a new agent there. */
  private connectNew(from: string, at: Point) {
    const { picture } = this,
      base = this.doc.placedSource(),
      start = picture && boxOf(picture, from);
    if (!picture || base === undefined || !start) return;
    // Only a drag well away from the element, and onto nothing, asks for a new one.
    const away = Math.max(
      start.x - at.x,
      at.x - start.x - start.width,
      start.y - at.y,
      at.y - start.y - start.height,
    );
    if (away < 3 * GRID || partAt(picture, at, 0)) return;
    let made = "";
    const done = this.change(
      (() => {
        const added = addElement(base, {
          kind: "agent",
          label: NAMES.agent,
          at: dropPlace("agent", at, false),
        });
        made = added.id;
        try {
          return connect(added.source, from, made);
        } catch {
          return added.source;
        }
      })(),
    );
    if (!done) return;
    this.tool = "select";
    this.select([{ type: "element", id: made }]);
    this.rename(made);
  }

  private abort() {
    const { gesture } = this;
    this.gesture = undefined;
    if (gesture?.type === "move" || gesture?.type === "resize") this.doc.cancel();
    this.view.invalidate();
  }

  private doubleClick(event: MouseEvent) {
    const point = this.view.toScene(this.view.pointOf(event)),
      { picture } = this;
    if (this.tool !== "select") return;
    const part = picture && partAt(picture, point, 6 / this.view.zoom);
    if (!part) this.create("agent", point, event.altKey);
    else if (part.type === "element") this.rename(part.id);
    else this.rename(part.id, true, point);
  }

  private wheel(event: WheelEvent) {
    event.preventDefault();
    const { view } = this;
    // A pinch or Ctrl with the wheel zooms; the wheel alone moves the view, as trackpads expect.
    if (event.ctrlKey || event.metaKey)
      view.zoomBy(Math.exp(-event.deltaY * 0.01), view.pointOf(event));
    else if (event.shiftKey && !event.deltaX) view.panBy(-event.deltaY, 0);
    else view.panBy(-event.deltaX, -event.deltaY);
  }

  private key(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
      return;
    const command = event.ctrlKey || event.metaKey,
      key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const done = () => event.preventDefault();
    if (command) {
      if (key === "z") return (done(), event.shiftKey ? this.doc.redo() : this.doc.undo());
      if (key === "y") return (done(), this.doc.redo());
      if (key === "d") return (done(), this.duplicateSelection());
      if (key === "a") return (done(), this.selectAll());
      if (key === "g") return (done(), this.wrapSelection(event.shiftKey ? "group" : "agent"));
      if (key === "0") return (done(), this.view.zoomTo(1));
      if (key === "=" || key === "+") return (done(), this.view.zoomBy(1.25));
      if (key === "-") return (done(), this.view.zoomBy(0.8));
      return;
    }
    const step = event.shiftKey ? 1 : GRID;
    switch (key) {
      case " ":
        this.space = true;
        this.cursor();
        return done();
      case "Delete":
      case "Backspace":
        return (done(), this.deleteSelection());
      case "Escape":
        if (this.gesture) this.abort();
        else if (this.tool !== "select") this.setTool("select");
        else this.select([]);
        return;
      case "Enter":
      case "F2": {
        const [only] = this.selection;
        if (this.selection.length === 1 && only.type === "element") (done(), this.rename(only.id));
        return;
      }
      case "ArrowLeft":
        return (done(), this.nudge(-step, 0));
      case "ArrowRight":
        return (done(), this.nudge(step, 0));
      case "ArrowUp":
        return (done(), this.nudge(0, -step));
      case "ArrowDown":
        return (done(), this.nudge(0, step));
      case "v":
        return this.setTool("select");
      case "h":
        return this.setTool("pan");
      case "c":
        return this.setTool("connect");
      case "a":
        return this.setTool("agent");
      case "s":
        return this.setTool("storage");
      case "u":
        return this.setTool("human");
      case "g":
        return this.setTool("group");
      case "1":
        return this.fit();
      case "+":
      case "=":
        return this.view.zoomBy(1.25);
      case "-":
        return this.view.zoomBy(0.8);
    }
  }

  // What lies over the picture.

  /** The one selected element with its box, when handles show. */
  private get single(): { id: string; box: Box } | undefined {
    const { picture, selection } = this;
    if (!picture || selection.length !== 1 || selection[0].type !== "element") return undefined;
    const box = boxOf(picture, selection[0].id);
    return box && { id: selection[0].id, box };
  }

  private handlePoints(box: Box) {
    const on = this.view.boxOnScreen(box);
    return HANDLES.map((handle) => ({
      handle,
      x: on.x + ((handle.x + 1) / 2) * on.width,
      y: on.y + ((handle.y + 1) / 2) * on.height,
    }));
  }

  /** Where a connection is drawn from: a dot off the middle of each side. */
  private linkPoints(box: Box) {
    const on = this.view.boxOnScreen(box);
    return [
      { x: on.x + on.width / 2, y: on.y - REACH },
      { x: on.x + on.width + REACH, y: on.y + on.height / 2 },
      { x: on.x + on.width / 2, y: on.y + on.height + REACH },
      { x: on.x - REACH, y: on.y + on.height / 2 },
    ];
  }

  private handleAt(screen: Point) {
    const { single } = this;
    if (!single || this.tool !== "select") return undefined;
    const found = this.handlePoints(single.box).find(
      (spot) => Math.abs(spot.x - screen.x) <= HANDLE && Math.abs(spot.y - screen.y) <= HANDLE,
    );
    return found && { id: single.id, handle: found.handle };
  }

  /**
   * The ends of the one selected connection, where it meets its elements: handles to drag to
   * another element. None for an interface's line.
   */
  private get wireEnds(): { id: string; end: "from" | "to"; at: Point }[] {
    const { picture } = this,
      [only] = this.selection;
    if (!picture || this.selection.length !== 1 || only.type !== "wire" || this.tool !== "select")
      return [];
    const connection = this.connection(only.id);
    if (!connection) return [];
    const points = wireParts(picture.scene, picture.diagram, only.id).lines.flat();
    return (["from", "to"] as const).flatMap((end) => {
      const box = boxOf(picture, connection[end]);
      if (!box || !points.length) return [];
      // The point of the wire nearest to the element.
      const away = (point: Point) =>
        Math.max(box.x - point.x, point.x - box.x - box.width, 0) +
        Math.max(box.y - point.y, point.y - box.y - box.height, 0);
      const at = points.reduce((best, point) => (away(point) < away(best) ? point : best));
      return [{ id: only.id, end, at }];
    });
  }

  private endAt(screen: Point) {
    return this.wireEnds.find(({ at }) => {
      const on = this.view.toScreen(at);
      return Math.hypot(on.x - screen.x, on.y - screen.y) <= HANDLE;
    });
  }

  /** The elements that show connection dots: the selected one and the one under the pointer. */
  private get linkHosts(): { id: string; box: Box }[] {
    const { picture, single } = this;
    if (!picture || this.tool !== "select") return [];
    const box =
      this.linkHost && this.linkHost !== single?.id ? boxOf(picture, this.linkHost) : undefined;
    return [...(single ? [single] : []), ...(box ? [{ id: this.linkHost!, box }] : [])];
  }

  private linkAt(screen: Point) {
    return this.linkHosts.find(({ box }) =>
      this.linkPoints(box).some(
        (spot) => Math.hypot(spot.x - screen.x, spot.y - screen.y) <= HANDLE,
      ),
    )?.id;
  }

  private cursor(screen?: Point) {
    const { canvas } = this.view;
    let cursor = "default";
    if (this.gesture?.type === "pan") cursor = "grabbing";
    else if (this.space || this.tool === "pan") cursor = "grab";
    else if (this.tool !== "select") cursor = "crosshair";
    else if (screen) {
      const handle = this.handleAt(screen);
      if (handle) cursor = handle.handle.cursor;
      else if (this.endAt(screen) || this.linkAt(screen)) cursor = "crosshair";
      else if (this.hover?.type === "element") cursor = "move";
      else if (this.hover) cursor = "pointer";
    }
    canvas.style.cursor = cursor;
  }

  private drawOverlay(context: CanvasRenderingContext2D) {
    const { picture, view, gesture, accent } = this;
    if (!picture) return;
    const outlineBox = (box: Box, pad = 0) => {
      const on = view.boxOnScreen(box);
      context.strokeRect(on.x - pad, on.y - pad, on.width + 2 * pad, on.height + 2 * pad);
    };
    context.lineJoin = "round";
    // What the pointer is over, lightly.
    const { hover } = this;
    if (hover && !gesture && this.tool !== "pan" && !this.isSelected(hover)) {
      context.strokeStyle = accent;
      context.globalAlpha = 0.45;
      context.lineWidth = 1.5;
      if (hover.type === "element") boxesOf(picture, hover.id).forEach((box) => outlineBox(box, 2));
      else this.strokeWire(context, picture, hover.id, 3);
      context.globalAlpha = 1;
    }
    // Selected connections are drawn over in the accent color, selected elements framed.
    context.strokeStyle = accent;
    for (const id of this.selectedWires) this.strokeWire(context, picture, id, 2.5);
    context.lineWidth = 1.5;
    for (const id of this.selectedElements)
      boxesOf(picture, id).forEach((box) => outlineBox(box, 3));
    const { single } = this;
    if (single && this.tool === "select" && (!gesture || gesture.type === "resize")) {
      context.fillStyle = "#ffffff";
      for (const spot of this.handlePoints(single.box)) {
        // The handles stand on the frame, which lies 3 outside the element.
        const x = spot.x + spot.handle.x * 3 - HANDLE / 2,
          y = spot.y + spot.handle.y * 3 - HANDLE / 2;
        context.fillRect(x, y, HANDLE, HANDLE);
        context.strokeRect(x, y, HANDLE, HANDLE);
      }
    }
    if (!gesture) {
      const at = this.view.toScreen(this.pointer);
      for (const { box } of this.linkHosts)
        for (const spot of this.linkPoints(box)) {
          const on = Math.hypot(spot.x - at.x, spot.y - at.y) <= HANDLE;
          context.beginPath();
          context.arc(spot.x, spot.y, on ? 6.5 : 4.5, 0, 2 * Math.PI);
          context.fillStyle = accent;
          context.globalAlpha = on ? 1 : 0.75;
          context.fill();
          context.globalAlpha = 1;
        }
    }
    if (gesture?.type === "move" && gesture.guides?.length) {
      context.strokeStyle = "#e0457b";
      context.lineWidth = 1;
      for (const [from, to] of gesture.guides) {
        const a = view.toScreen(from),
          b = view.toScreen(to);
        context.beginPath();
        context.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
        context.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
        context.stroke();
      }
      context.strokeStyle = accent;
    }
    const { ghost } = this;
    if (ghost && !gesture) {
      // The new element where it would stand, and the element it would stand in.
      const on = view.boxOnScreen({ ...ghost.at, ...sizeOf(ghost.kind) });
      context.lineWidth = 1.5;
      if (ghost.target) {
        context.setLineDash([6, 4]);
        boxesOf(picture, ghost.target).forEach((box) => outlineBox(box, 4));
        context.setLineDash([]);
      }
      context.fillStyle = accent;
      context.globalAlpha = 0.12;
      context.beginPath();
      context.roundRect(
        on.x,
        on.y,
        on.width,
        on.height,
        ghost.kind === "storage" ? on.height / 2 : ghost.kind === "group" ? 4 * view.zoom : 0,
      );
      context.fill();
      context.globalAlpha = 1;
      context.stroke();
    }
    if (gesture?.type === "move" && gesture.target) {
      context.setLineDash([6, 4]);
      context.lineWidth = 2;
      boxesOf(picture, gesture.target).forEach((box) => outlineBox(box, 4));
      context.setLineDash([]);
    }
    if (gesture?.type === "frame") {
      const on = view.boxOnScreen(frameOf(gesture.start, gesture.current));
      context.fillStyle = accent;
      context.globalAlpha = 0.08;
      context.fillRect(on.x, on.y, on.width, on.height);
      context.globalAlpha = 1;
      context.lineWidth = 1;
      context.strokeRect(on.x, on.y, on.width, on.height);
    }
    if (!gesture || gesture.type === "attach") {
      // The ends of the selected connection: drag one to another element.
      for (const { at, end } of this.wireEnds) {
        if (gesture?.type === "attach" && gesture.end === end) continue;
        const on = view.toScreen(at);
        context.beginPath();
        context.arc(on.x, on.y, 5, 0, 2 * Math.PI);
        context.fillStyle = "#ffffff";
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = accent;
        context.stroke();
      }
    }
    if (gesture?.type === "attach") {
      const fixed = this.wireEnds.find((item) => item.end !== gesture.end),
        end = view.toScreen(gesture.current);
      context.strokeStyle = accent;
      if (gesture.target) {
        context.lineWidth = 2;
        boxesOf(picture, gesture.target).forEach((box) => outlineBox(box, 3));
      }
      if (fixed) {
        const start = view.toScreen(fixed.at);
        context.lineWidth = 1.5;
        context.setLineDash([5, 4]);
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        context.setLineDash([]);
      }
    }
    if (gesture?.type === "connect") {
      const from = boxOf(picture, gesture.from);
      if (from) {
        const start = view.toScreen({ x: from.x + from.width / 2, y: from.y + from.height / 2 }),
          end = view.toScreen(gesture.current);
        context.lineWidth = 1.5;
        boxesOf(picture, gesture.from).forEach((box) => outlineBox(box, 3));
        if (gesture.target) {
          context.lineWidth = 2;
          boxesOf(picture, gesture.target).forEach((box) => outlineBox(box, 3));
        }
        context.lineWidth = 1.5;
        context.setLineDash([5, 4]);
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
        context.setLineDash([]);
      }
    }
  }

  private strokeWire(
    context: CanvasRenderingContext2D,
    picture: Picture,
    id: string,
    width: number,
  ) {
    const { view } = this,
      { lines, circles } = wireParts(picture.scene, picture.diagram, id);
    context.lineWidth = width;
    for (const points of lines) {
      context.beginPath();
      points.forEach((point, index) => {
        const on = view.toScreen(point);
        if (index) context.lineTo(on.x, on.y);
        else context.moveTo(on.x, on.y);
      });
      context.stroke();
    }
    for (const box of circles) {
      const on = view.boxOnScreen(box);
      context.beginPath();
      context.arc(on.x + on.width / 2, on.y + on.height / 2, on.width / 2 + 1, 0, 2 * Math.PI);
      context.stroke();
    }
  }
}

/** Placements moved by a step. */
function shifted(places: Map<string, Placement>, dx: number, dy: number) {
  return new Map([...places].map(([id, at]) => [id, { ...at, x: at.x + dx, y: at.y + dy }]));
}

/** The box between two corners. */
const frameOf = (a: Point, b: Point): Box => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});
