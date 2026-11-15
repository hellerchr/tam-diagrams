/**
 * The TAM side of the spike: the source is the document. tldraw holds one box per element, to
 * select, move, resize and nest; every change of a box becomes an edit of the source, the source is
 * laid out by the library, and the boxes follow the layout.
 */

import { atom, createShapeId, type Editor, type TLParentId, type TLShape, type TLShapeId } from "tldraw";
import { drawScene, type DiagramColors } from "../../../src/draw.ts";
import type { Box, Scene } from "../../../src/scene.ts";
import { isPlaced, parseTam, type Placement, type TamDiagram } from "../../../src/tam.ts";
import {
  addElement,
  connect,
  type ElementKind,
  holder,
  moveInto,
  place,
  remove,
  setElement,
} from "../../../src/tam-edit.ts";
import { bestLayout, layoutPlaced } from "../../../src/tam-layout.ts";
import { elementBoxes, pin } from "../../../src/tam-pin.ts";
import { textMeasure } from "../../../src/text.ts";
import { svgUrl } from "../../../src/index.ts";

const FONT = "system-ui, sans-serif";

const COLORS: DiagramColors = {
  background: "#ffffff",
  text: "#1b1c1f",
  secondary: "#3f4146",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  font: FONT,
  dark: false,
};

const measure = textMeasure(FONT);

/** A source laid out. */
export interface Picture {
  source: string;
  diagram: TamDiagram;
  scene: Scene;
  /** The picture as an image, and where it lies on the page. */
  url: string;
  bounds: Box;
}

export const STARTER = `title Order system
human customer[Customer] @40,60
agent shop[Web Shop] @220,30 380x260 {
  agent api[Order API] @250,90
  agent worker[Fulfillment] @450,90
  storage cart[Cart] @250,220
  storage orders[Orders] @450,220
}
agent erp[ERP System]:::orange @700,90
customer -- calls: place order @HTTPS --> api
api -- sends data: order events --> worker
api -- reads/writes --> cart
api -- writes --> orders
worker -- reads --> orders
worker -- calls: IDoc @RFC --> erp
`;

/** The id of the box that stands for an element. */
const shapeId = (element: string): TLShapeId => createShapeId(`tam-${element.replace(/#/g, "_")}`);

const round = (value: number) => Math.round(value);

export class Model {
  /** The source, the picture of it, and why the last text did not become one. */
  readonly source = atom("source", "");
  readonly picture = atom<Picture | undefined>("picture", undefined);
  readonly problem = atom<string | undefined>("problem", undefined);
  /** The kind of element the tool in use draws. */
  drawing: ElementKind = "agent";
  private editor: Editor | undefined;
  private pending = false;
  /** The sources before each step, and those undone: the history is the document's, not the boxes'. */
  private undone: string[] = [];
  private redone: string[] = [];
  /** Whether the drag under way has its step in the history already. */
  private stepped = false;

  /** Remembers the source before a change; a drag is one step. */
  private step() {
    const busy =
      !!this.editor &&
      (this.editor.isIn("select.translating") || this.editor.isIn("select.resizing"));
    if (busy && this.stepped) return;
    this.stepped = busy;
    this.undone.push(this.source.get());
    this.redone = [];
  }

  undo() {
    const source = this.undone.pop();
    if (source === undefined) return;
    this.redone.push(this.source.get());
    this.show(source);
  }

  redo() {
    const source = this.redone.pop();
    if (source === undefined) return;
    this.undone.push(this.source.get());
    this.show(source);
  }

  /** Takes a text as the source: laid out as placed, or placed from the automatic layout first. */
  async setSource(text: string) {
    if (text !== this.source.get() && this.source.get()) this.step();
    this.source.set(text);
    try {
      let source = text,
        diagram = parseTam(source);
      if (!isPlaced(diagram) && diagram.nodes.size) {
        source = pin(source, await bestLayout(diagram, measure), measure);
        diagram = parseTam(source);
        this.source.set(source);
      }
      this.show(source, diagram);
    } catch (reason) {
      this.problem.set(reason instanceof Error ? reason.message : String(reason));
    }
  }

  /** Lays a placed source out, shows it and lets the boxes follow. */
  private show(source: string, diagram = parseTam(source)) {
    const scene = layoutPlaced(diagram, measure);
    this.source.set(source);
    this.problem.set(undefined);
    this.picture.set({
      source,
      diagram,
      scene,
      url: svgUrl(drawScene(scene, COLORS, diagram.title ?? "TAM block diagram", "tam")),
      bounds: scene.bounds,
    });
    try {
      localStorage.setItem("tam-tldraw:source", source);
    } catch {
      // Without storage the diagram lives as long as the page.
    }
    this.syncShapes();
  }

  /** An edit of the source made on the canvas: applied when the result parses, said when not. */
  private edit(make: (source: string) => string): boolean {
    try {
      const next = make(this.source.get());
      if (next === this.source.get()) return true;
      // Parsed before it counts as a step.
      const diagram = parseTam(next);
      this.step();
      this.show(next, diagram);
      return true;
    } catch (reason) {
      this.problem.set(reason instanceof Error ? reason.message : String(reason));
      // The boxes go back to what the source says.
      this.syncShapes();
      return false;
    }
  }

  attach(editor: Editor) {
    this.editor = editor;
    // Every change the user makes to the boxes is read once the store has settled.
    editor.store.listen(
      () => {
        if (this.pending) return;
        this.pending = true;
        queueMicrotask(() => {
          this.pending = false;
          this.readShapes();
        });
      },
      { source: "user", scope: "document" },
    );
    editor.on("event", (info) => {
      if (info.name !== "pointer_up") return;
      this.stepped = false;
      // After the state chart has left the drag.
      setTimeout(() => {
        this.readShapes();
        this.syncShapes();
      });
    });
    this.syncShapes();
  }

  /** The element boxes of the picture, parents before their parts. */
  private boxes(): { id: string; box: Box; parent: string | null }[] {
    const picture = this.picture.get();
    if (!picture) return [];
    const depth = (id: string): number => {
      const parent = holder(picture.diagram, id);
      return parent ? depth(parent) + 1 : 0;
    };
    return [...elementBoxes(picture.diagram, picture.scene)]
      .map(([id, box]) => ({ id, box, parent: holder(picture.diagram, id) }))
      .toSorted((a, b) => depth(a.id) - depth(b.id));
  }

  /** Lets tldraw's boxes follow the picture: one per element, inside the box of the element that holds it. */
  private syncShapes() {
    const { editor } = this,
      picture = this.picture.get();
    if (!editor || !picture) return;
    const boxes = this.boxes(),
      byId = new Map(boxes.map((item) => [item.id, item.box]));
    // While the user drags, the boxes are theirs: they are read, not written, or a container that
    // grows around its dragged part would carry the part along and grow again. The picture under
    // them follows at once; the boxes follow when the drag ends.
    if (editor.isIn("select.translating") || editor.isIn("select.resizing")) return;
    const held = new Set<TLShapeId>();
    editor.run(
      () => {
        const wanted = new Set<TLShapeId>();
        for (const { id, box, parent } of boxes) {
          const node = picture.diagram.nodes.get(id)!,
            shape = shapeId(id),
            origin = parent ? byId.get(parent)! : { x: 0, y: 0 },
            parentId: TLParentId = parent ? shapeId(parent) : editor.getCurrentPageId();
          wanted.add(shape);
          const partial = {
            id: shape,
            type: "tam" as const,
            parentId,
            x: box.x - origin.x,
            y: box.y - origin.y,
            props: {
              w: box.width,
              h: box.height,
              element: id,
              kind: node.kind,
              label: node.label,
              container: node.children.length > 0 || node.kind === "group",
            },
          };
          const existing = editor.getShape(shape);
          if (!existing) editor.createShape(partial);
          else if (!held.has(shape)) {
            if (existing.parentId !== parentId) editor.reparentShapes([shape], parentId);
            editor.updateShape(partial);
          }
        }
        const stale = editor
          .getCurrentPageShapes()
          .filter((shape) => shape.type === "tam" && !wanted.has(shape.id) && isAdopted(shape));
        if (stale.length) editor.deleteShapes(stale.map((shape) => shape.id));
      },
      { history: "ignore", ignoreShapeLock: true },
    );
  }

  /**
   * Reads what the user did to the boxes into the source: boxes that moved or changed size are
   * placed anew, boxes in another parent are nested there, boxes that are gone are removed, and an
   * arrow between two boxes becomes a connection.
   */
  private readShapes() {
    const { editor } = this,
      picture = this.picture.get();
    if (!editor || !picture) return;
    const shapes = editor.getCurrentPageShapes().filter((shape) => shape.type === "tam");
    const elementOf = new Map(
      shapes.flatMap((shape) => {
        const { element } = (shape as TamShapeLike).props;
        return element ? [[shape.id, element] as [TLShapeId, string]] : [];
      }),
    );
    // A box a tool has finished drawing becomes an element.
    const fresh = shapes.find((shape) => !isAdopted(shape));
    if (fresh && !editor.isIn("select.resizing") && !editor.isIn("select.translating")) {
      this.adopt(fresh, this.drawing);
      return;
    }
    const drawn = new Map(this.boxes().map((item) => [item.id, item]));
    // Arrows that join two elements are connections of the source, drawn by the library.
    if (!editor.inputs.getIsPointing?.() && !editor.isIn("arrow.pointing") && !editor.isIn("select.dragging_handle")) {
      for (const arrow of editor.getCurrentPageShapes().filter((shape) => shape.type === "arrow")) {
        const ends = editor.getBindingsFromShape(arrow, "arrow");
        const from = ends.find((end) => end.props.terminal === "start"),
          to = ends.find((end) => end.props.terminal === "end");
        const a = from && elementOf.get(from.toId),
          b = to && elementOf.get(to.toId);
        if (!a || !b || a === b) continue;
        editor.run(() => editor.deleteShapes([arrow.id]), { history: "ignore" });
        this.edit((source) => connect(source, a, b));
        return;
      }
    }
    const gone = [...drawn.keys()].filter((id) => !editor.getShape(shapeId(id)));
    if (gone.length) {
      this.edit((source) => remove(source, gone));
      return;
    }
    const places = new Map<string, Placement>(),
      moves: [string, string | null][] = [];
    for (const shape of shapes) {
      const element = elementOf.get(shape.id),
        was = element && drawn.get(element),
        bounds = editor.getShapePageBounds(shape);
      if (!element || !was || !bounds) continue;
      const parent = elementOf.get(shape.parentId as TLShapeId) ?? null;
      if (parent !== was.parent) moves.push([element, parent]);
      const moved = Math.abs(bounds.x - was.box.x) > 0.5 || Math.abs(bounds.y - was.box.y) > 0.5,
        sized =
          Math.abs(bounds.w - was.box.width) > 0.5 || Math.abs(bounds.h - was.box.height) > 0.5;
      if (!moved && !sized) continue;
      const at = picture.diagram.nodes.get(element)?.at;
      // A size is written when the user gave one, now or before.
      places.set(element, {
        x: round(bounds.x),
        y: round(bounds.y),
        ...(sized || at?.width !== undefined
          ? { width: round(bounds.w), height: round(bounds.h) }
          : {}),
      });
    }
    if (!places.size && !moves.length) return;
    this.edit((source) => {
      let next = place(source, places);
      for (const [element, parent] of moves) next = moveInto(next, [element], parent);
      parseTam(next);
      return next;
    });
  }

  /** A box drawn with a tool becomes an element of its kind, where it was drawn. */
  adopt(shape: TLShape, kind: ElementKind) {
    const { editor } = this;
    if (!editor || !editor.getShape(shape.id) || isAdopted(shape)) return;
    const bounds = editor.getShapePageBounds(shape),
      parentShape = editor.getShape(shape.parentId as TLShapeId) as TamShapeLike | undefined;
    if (!bounds) return;
    const label = kind === "group" ? undefined : kind[0].toUpperCase() + kind.slice(1);
    // A click makes an element as large as its name; a drag gives it the size drawn.
    const drawnSize = bounds.w > 110 || bounds.h > 60;
    let made = "";
    const done = this.edit((source) => {
      const result = addElement(source, {
        kind,
        label,
        parent: parentShape?.props?.element || null,
        at: {
          x: round(bounds.x),
          y: round(bounds.y),
          ...(drawnSize || kind === "group" ? { width: round(bounds.w), height: round(bounds.h) } : {}),
        },
      });
      made = result.id;
      parseTam(result.source);
      return result.source;
    });
    // The drawn box gives way to the element's own.
    editor.run(() => editor.deleteShapes([shape.id]), { history: "ignore" });
    if (done && made) {
      editor.select(shapeId(made));
      if (kind !== "group") editor.setEditingShape(shapeId(made));
    }
  }

  rename(element: string, label: string) {
    this.edit((source) => setElement(source, element, { label }));
  }
}

/** A tam box as the model reads it. */
interface TamShapeLike {
  props: { element: string; kind: string; label: string; container: boolean; w: number; h: number };
}

/** Whether a box stands for an element already: one being drawn with a tool does not yet. */
const isAdopted = (shape: TLShape) => !!(shape as unknown as TamShapeLike).props.element;

export const model = new Model();
