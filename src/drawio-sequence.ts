/**
 * draw.io pages of sequence diagrams (`sequenceDiagram`). A participant is drawn as the Lifeline of
 * the TAM-SeqD library: a container that holds the agent's box (an actor's, a TAM-BD Human figure
 * over its name) and the dashed lifeline below it, with the activation bars and a destruction cross
 * inside. Messages are edges with the TAM-SeqD heads (a filled head for a synchronous call, a dashed
 * line with an open head for a reply, a solid one for an asynchronous message), combined fragments
 * are draw.io UML frames, notes TAM-Ann notes.
 *
 * Time runs down in a sequence diagram whatever the page says, so an import does not place events:
 * it reads the order. Participants stand left to right as their heads do (and are placed where the
 * heads stand, `%% @head:<id>`), events top to bottom as the page draws them: a message where it
 * leaves its sender, an activation from the top of its bar to the bottom, a fragment from its top to
 * its bottom with a branch at each dashed line across it. Besides the TAM shapes a page may hold
 * draw.io's own UML Lifeline, Actor, Frame and Destroy shapes, as people draw them by hand.
 */

import {
  type Cell,
  type Drawing,
  DrawioError,
  LAYER,
  shapeOf,
  type Style,
  textToHtml,
} from "./drawio-file.ts";
import type { DrawioType, Imported } from "./drawio.ts";
import {
  arrowAt,
  cell,
  dashed,
  edgeRoute,
  fillColor,
  fillOf,
  FONT_SIZE,
  hasArrow,
  Ids,
  isDark,
  labelAt,
  roleOf,
  TAMSHAPES,
  vertexGeometry,
} from "./drawio-shapes.ts";
import type { MarkerKind } from "./markers.ts";
import {
  type Box,
  contains,
  inside,
  type Point,
  type Scene,
  type SceneShape,
  type SceneText,
} from "./scene.ts";
import { type MessageEvent, parseSequenceDiagram, type SequenceDiagram } from "./uml-sequence.ts";
import { textOf } from "./uml-sequence-edit.ts";

/** The size of message labels, notes and conditions, as the scene draws them. */
const SMALL_SIZE = 12;

/** The fragments that frame messages under a keyword, and the word that starts another branch. */
const FRAGMENTS = new Set(["loop", "alt", "opt", "par", "critical", "break"]);
const BRANCH_WORD: Record<string, string | undefined> = {
  alt: "else",
  par: "and",
  critical: "option",
};

// ---------------------------------------------------------------------------------------------
// Export

/** Unique cell ids on a page: an id taken already gets `#2`, `#3`… */
class CellIds {
  private readonly taken = new Set(["0", LAYER]);
  of(wanted: string): string {
    let id = wanted,
      number = 2;
    while (this.taken.has(id)) id = `${wanted}#${number++}`;
    this.taken.add(id);
    return id;
  }
}

/** Model text (line breaks as `<br>`) as text with `\n`. */
const plain = (text: string) => text.replace(/<br\s*\/?>/gi, "\n");

/** The box around some boxes. */
function union(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  const left = Math.min(...boxes.map((box) => box.x)),
    top = Math.min(...boxes.map((box) => box.y)),
    right = Math.max(...boxes.map((box) => box.x + box.width)),
    bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const centerOf = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** Edge style keys for an arrow head of the model at one end. */
function headStyle(kind: MarkerKind | null, end: "start" | "end") {
  const arrow =
    kind === "arrow" ? "classic" : kind === "open" ? "open" : kind === "cross" ? "cross" : "none";
  return { [`${end}Arrow`]: arrow, [`${end}Fill`]: kind === "arrow" ? 1 : 0 };
}

/** What the export knows of a participant's lifeline: its cells and boxes on the page. */
interface ExportLifeline {
  id: string;
  cell: string;
  box: Box;
  head: { cell: string; box: Box };
  bars: { cell: string; box: Box; depth: number }[];
}

/** The fragments of a diagram with their parents and the kinds and texts of their branches. */
function fragmentsOf(diagram: SequenceDiagram) {
  const frames = new Map<
    string,
    { kind: string; text: string; parent?: string; branches: string[] }
  >();
  const open: string[] = [];
  for (const event of diagram.events) {
    if (event.type === "start") {
      frames.set(event.id, {
        kind: event.kind,
        text: event.text,
        parent: open.at(-1),
        branches: [],
      });
      open.push(event.id);
    } else if (event.type === "else") frames.get(event.id)!.branches.push(event.text);
    else if (event.type === "end") open.pop();
  }
  return frames;
}

/** The texts that belong to a shape or wire, with a role. */
const textsOf = (scene: Scene, owner: string, role?: SceneText["role"]) =>
  scene.texts.filter((text) => text.owner === owner && (!role || text.role === role));

/** The cells that draw a sequence diagram as `scene` lays it out. */
function exportCells(source: string, scene: Scene): Cell[] {
  const diagram = parseSequenceDiagram(source);
  const ids = new CellIds();
  const cells: Cell[] = [];
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));

  // Groups of participants, behind everything.
  const groups = new Map<number, { cell: string; box: Box }>();
  diagram.boxes.forEach((group, number) => {
    const shape = shapes.get(`box${number}`);
    if (!shape) return;
    const id = ids.of(`box${number}`);
    groups.set(number, { cell: id, box: shape.box });
    cells.push(
      cell(
        {
          id,
          parent: LAYER,
          value: textToHtml(plain(group.label)),
          vertex: true,
          geometry: vertexGeometry(shape.box),
          style: {
            rounded: 0,
            whiteSpace: "wrap",
            html: 1,
            fillColor: fillOf(shape),
            strokeWidth: 1,
            verticalAlign: "top",
            fontStyle: 1,
            fontSize: FONT_SIZE,
            container: 1,
            collapsible: 0,
            recursiveResize: 0,
          },
        },
        "group",
      ),
    );
  });

  cells.push(...fragmentCells(diagram, scene, ids));

  const lifelines = new Map<string, ExportLifeline>();
  for (const [id, participant] of diagram.participants) {
    const head = shapes.get(`head:${id}`);
    if (!head) continue;
    const group = participant.box === null ? undefined : groups.get(participant.box);
    const made = lifelineCells(diagram, scene, ids, id, head, group);
    lifelines.set(id, made.lifeline);
    cells.push(...made.cells);
  }

  for (const event of diagram.events)
    if (event.type === "note") {
      const shape = shapes.get(event.id);
      if (!shape) continue;
      cells.push(
        cell(
          {
            id: ids.of(event.id),
            parent: LAYER,
            value: textToHtml(plain(event.text)),
            vertex: true,
            geometry: vertexGeometry(shape.box),
            style: {
              ...TAMSHAPES.note,
              verticalAlign: "middle",
              spacingLeft: 7,
              strokeWidth: 1,
              fontSize: SMALL_SIZE,
              tamPlacement: event.placement,
            },
          },
          "note",
        ),
      );
    }

  for (const event of diagram.events)
    if (event.type === "message") cells.push(...messageCells(event, scene, ids, lifelines));

  const heading = scene.texts.find((text) => text.role === "heading");
  if (heading)
    cells.push(
      cell(
        {
          id: ids.of("title"),
          parent: LAYER,
          value: textToHtml(heading.text),
          vertex: true,
          geometry: vertexGeometry({ ...heading.box, width: heading.box.width + 8 }),
          style: {
            ...TAMSHAPES.text,
            align: "left",
            fontSize: 16,
            fontStyle: 1,
            whiteSpace: "nowrap",
          },
        },
        "title",
      ),
    );
  return cells;
}

/** A participant's lifeline: the container, the head, the dashed line, the bars and a destruction. */
function lifelineCells(
  diagram: SequenceDiagram,
  scene: Scene,
  ids: CellIds,
  id: string,
  head: SceneShape,
  group: { cell: string; box: Box } | undefined,
): { cells: Cell[]; lifeline: ExportLifeline } {
  const participant = diagram.participants.get(id)!;
  const x = head.box.x + head.box.width / 2;
  const line = scene.lines.find(
    (item) =>
      item.tone === "boundary" &&
      Math.abs(item.points[0].x - x) < 0.5 &&
      Math.abs(item.points.at(-1)!.x - x) < 0.5 &&
      item.points[0].y >= head.box.y,
  );
  const destroy = scene.shapes.find((shape) => shape.id === `destroy:${id}`);
  const bottom = Math.max(
    head.box.y + head.box.height,
    line?.points.at(-1)!.y ?? 0,
    destroy ? destroy.box.y + destroy.box.height : 0,
  );
  const box: Box = {
    x: head.box.x,
    y: head.box.y,
    width: head.box.width,
    height: bottom - head.box.y,
  };
  const container = ids.of(id),
    headId = ids.of(`${id}#head`);
  const cells: Cell[] = [
    cell(
      {
        id: container,
        parent: group?.cell ?? LAYER,
        value: "",
        vertex: true,
        geometry: vertexGeometry(box, group?.box),
        style: {
          html: 1,
          noLabel: 1,
          strokeColor: "none",
          fillColor: "none",
          container: 1,
          collapsible: 0,
          recursiveResize: 0,
          dropTarget: 0,
          tamLevel: diagram.level,
        },
      },
      "lifeline",
    ),
  ];
  if (participant.actor)
    cells.push(...actorCells(ids, headId, container, participant.label, head.box, box));
  else
    cells.push(
      cell(
        {
          id: headId,
          parent: container,
          value: textToHtml(plain(participant.label)),
          vertex: true,
          geometry: vertexGeometry(head.box, box),
          style: { ...TAMSHAPES.agent, fillColor: "#FFFFFF", fontStyle: 4, fontSize: FONT_SIZE },
        },
        "participant",
      ),
    );
  if (line) {
    const route = edgeRoute([line.points[0], line.points.at(-1)!], head.box, undefined, box);
    cells.push(
      cell(
        {
          id: ids.of(`${id}#line`),
          parent: container,
          edge: true,
          source: headId,
          geometry: route.geometry,
          style: { ...TAMSHAPES.border, edgeStyle: "none", bendable: 0, ...route.style },
        },
        "line",
      ),
    );
  }
  const bars: ExportLifeline["bars"] = [];
  for (const shape of scene.shapes) {
    if (shape.kind !== "activation" || Math.abs(shape.box.x + shape.box.width / 2 - x) > 25)
      continue;
    const barId = ids.of(`${id}#bar${bars.length + 1}`);
    bars.push({ cell: barId, box: shape.box, depth: shape.depth });
    cells.push(
      cell(
        {
          id: barId,
          parent: container,
          value: "",
          vertex: true,
          geometry: vertexGeometry(shape.box, box),
          style: {
            ...TAMSHAPES.activation,
            fillColor: shape.fill === "strong" ? "#E6E6E6" : "#FFFFFF",
          },
        },
        "activation",
      ),
    );
  }
  if (destroy)
    cells.push(
      cell(
        {
          id: ids.of(`${id}#destroy`),
          parent: container,
          value: "",
          vertex: true,
          geometry: vertexGeometry(destroy.box, box),
          style: { shape: "umlDestroy", html: 1, strokeWidth: 2 },
        },
        "destroy",
      ),
    );
  return {
    cells,
    lifeline: { id, cell: container, box, head: { cell: headId, box: head.box }, bars },
  };
}

/** The lines of the TAM-BD Human figure, in its 20 by 40 box: from and to. */
const HUMAN_LINES: [Point, Point][] = [
  [
    { x: 10, y: 12 },
    { x: 10, y: 26 },
  ],
  [
    { x: 10, y: 18 },
    { x: 20, y: 12 },
  ],
  [
    { x: 10, y: 18 },
    { x: 0, y: 12 },
  ],
  [
    { x: 10, y: 26 },
    { x: 0, y: 40 },
  ],
  [
    { x: 10, y: 26 },
    { x: 20, y: 40 },
  ],
];

/** An actor's head: its name at the bottom of its box, the TAM-BD Human figure above it. */
function actorCells(
  ids: CellIds,
  headId: string,
  container: string,
  label: string,
  head: Box,
  box: Box,
): Cell[] {
  const figure = ids.of(`${headId}#figure`);
  const stroke = {
    edgeStyle: "none",
    strokeWidth: 2,
    html: 1,
    startArrow: "none",
    endArrow: "none",
    startFill: 0,
    endFill: 0,
  };
  return [
    cell(
      {
        id: headId,
        parent: container,
        value: textToHtml(plain(label)),
        vertex: true,
        geometry: vertexGeometry(head, box),
        style: {
          html: 1,
          whiteSpace: "wrap",
          strokeColor: "none",
          fillColor: "none",
          verticalAlign: "bottom",
          align: "center",
          spacingBottom: 4,
          fontSize: FONT_SIZE,
          container: 1,
          collapsible: 0,
        },
      },
      "actor",
    ),
    cell(
      {
        id: figure,
        parent: headId,
        value: "",
        vertex: true,
        connectable: false,
        geometry: { x: (head.width - 20) / 2, y: 1, width: 20, height: 40 },
        style: { group: "", strokeWidth: 2, rotatable: 0, editable: 0, fillColor: "none" },
      },
      "human",
    ),
    cell(
      {
        id: ids.of(`${figure}#head`),
        parent: figure,
        value: "",
        vertex: true,
        geometry: { x: 4, y: 0, width: 12, height: 12 },
        style: { ellipse: "", strokeWidth: 2, whiteSpace: "wrap", html: 1 },
      },
      "human",
    ),
    ...HUMAN_LINES.map(([from, to], index) =>
      cell(
        {
          id: ids.of(`${figure}#line${index + 1}`),
          parent: figure,
          edge: true,
          geometry: { x: 0, y: 0, width: 0, height: 0, sourcePoint: from, targetPoint: to },
          style: stroke,
        },
        "human",
      ),
    ),
  ];
}

/** A message as an edge from the bar or lifeline it leaves to the one it reaches, and its number. */
function messageCells(
  event: MessageEvent,
  scene: Scene,
  ids: CellIds,
  lifelines: Map<string, ExportLifeline>,
): Cell[] {
  const wire = scene.wires.find((item) => item.edge === event.id);
  if (!wire) return [];
  const points = wire.points;
  const at = (who: string, point: Point) => {
    const lifeline = lifelines.get(who);
    if (!lifeline) return undefined;
    const bar = lifeline.bars
      .filter((item) => contains(item.box, point, 1.5))
      .sort((a, b) => b.depth - a.depth)[0];
    if (bar) return { cell: bar.cell, box: bar.box };
    if (contains(lifeline.head.box, point, 1.5)) return lifeline.head;
    return contains(lifeline.box, point, 0.5)
      ? { cell: lifeline.cell, box: lifeline.box }
      : undefined;
  };
  const from = at(event.from, points[0]),
    to = at(event.to, points.at(-1)!);
  const route = edgeRoute(points, from?.box, to?.box);
  const label = union(textsOf(scene, event.id, "label").map((text) => text.box));
  const id = ids.of(event.id);
  const cells: Cell[] = [
    cell(
      {
        id,
        parent: LAYER,
        value: textToHtml(plain(event.text)),
        edge: true,
        source: from?.cell,
        target: to?.cell,
        geometry: label ? labelAt(route.geometry, points, centerOf(label)) : route.geometry,
        style: {
          html: 1,
          rounded: 0,
          edgeStyle: "none",
          ...(event.dashed ? { dashed: 1, dashPattern: "4 4" } : {}),
          ...headStyle(event.head, "end"),
          ...headStyle(event.tail, "start"),
          fontSize: SMALL_SIZE,
          labelBackgroundColor: "#FFFFFF",
          ...route.style,
        },
      },
      "message",
    ),
  ];
  const badge = scene.shapes.find((shape) => shape.id === `badge:${event.id}`);
  if (badge && event.number !== undefined)
    cells.push(
      cell(
        {
          id: ids.of(`${event.id}#number`),
          parent: LAYER,
          value: String(event.number),
          vertex: true,
          connectable: false,
          geometry: vertexGeometry(badge.box),
          style: {
            ellipse: "",
            html: 1,
            aspect: "fixed",
            fillColor: fillOf(badge) ?? "#000000",
            strokeColor: "none",
            fontColor: "#FFFFFF",
            fontSize: 10,
            fontStyle: 1,
          },
        },
        "badge",
      ),
    );
  return cells;
}

/** The combined fragments: UML frames with the keyword in the tab, their conditions and branch lines. */
function fragmentCells(diagram: SequenceDiagram, scene: Scene, ids: CellIds): Cell[] {
  const cells: Cell[] = [];
  const placed = new Map<string, { cell: string; box: Box }>();
  for (const [frameId, frame] of fragmentsOf(diagram)) {
    const shape = scene.shapes.find((item) => item.id === frameId);
    if (!shape) continue;
    const parent = frame.parent ? placed.get(frame.parent) : undefined;
    const id = ids.of(frameId);
    placed.set(frameId, { cell: id, box: shape.box });
    const base = {
      id,
      parent: parent?.cell ?? LAYER,
      vertex: true,
      geometry: vertexGeometry(shape.box, parent?.box),
    };
    if (frame.kind === "rect") {
      cells.push(
        cell(
          {
            ...base,
            value: "",
            style: {
              rounded: 0,
              html: 1,
              fillColor: fillOf(shape),
              strokeColor: "none",
              container: 1,
              collapsible: 0,
              recursiveResize: 0,
            },
          },
          "rect",
        ),
      );
      continue;
    }
    cells.push(
      cell(
        {
          ...base,
          value: textToHtml(frame.kind),
          style: {
            shape: "umlFrame",
            whiteSpace: "wrap",
            html: 1,
            pointerEvents: 0,
            width: shape.tab?.width ?? 50,
            height: shape.tab?.height ?? 20,
            fontStyle: 1,
            fontSize: SMALL_SIZE,
            fillColor: "none",
            strokeWidth: 1,
            container: 1,
            collapsible: 0,
            recursiveResize: 0,
          },
        },
        "fragment",
      ),
    );
    cells.push(...branchCells(scene, ids, frameId, id, shape.box, frame));
  }
  return cells;
}

/** A fragment's dashed branch lines and its conditions, each in brackets in a text of its own. */
function branchCells(
  scene: Scene,
  ids: CellIds,
  frameId: string,
  frameCell: string,
  box: Box,
  frame: { kind: string; text: string; branches: string[] },
): Cell[] {
  const lines = scene.lines
    .filter(
      (line) =>
        line.tone === "ink" &&
        line.dashed &&
        Math.abs(line.points[0].x - box.x) < 0.5 &&
        Math.abs(line.points.at(-1)!.x - (box.x + box.width)) < 0.5 &&
        line.points[0].y > box.y &&
        line.points[0].y < box.y + box.height,
    )
    .map((line) => line.points[0].y)
    .sort((a, b) => a - b);
  const guards = textsOf(scene, frameId, "label");
  const cells: Cell[] = [];
  const stretches = [box.y, ...lines];
  const conditions = [frame.text, ...frame.branches];
  stretches.forEach((top, index) => {
    const bottom = stretches[index + 1] ?? box.y + box.height;
    if (index > 0) {
      const route = edgeRoute(
        [
          { x: box.x, y: top },
          { x: box.x + box.width, y: top },
        ],
        undefined,
        undefined,
        box,
      );
      cells.push(
        cell(
          {
            id: ids.of(`${frameCell}#branch${index}`),
            parent: frameCell,
            edge: true,
            geometry: route.geometry,
            style: {
              html: 1,
              endArrow: "none",
              startArrow: "none",
              dashed: 1,
              strokeWidth: 1,
              edgeStyle: "none",
            },
          },
          "branch",
        ),
      );
    }
    const text = conditions[index];
    const drawn = union(
      guards.filter((guard) => guard.y > top && guard.y < bottom).map((guard) => guard.box),
    );
    if (!text || !drawn) return;
    cells.push(
      cell(
        {
          id: ids.of(`${frameCell}#condition${index}`),
          parent: frameCell,
          value: textToHtml(`[${plain(text)}]`),
          vertex: true,
          geometry: vertexGeometry({ ...drawn, width: drawn.width + 6 }, box),
          style: {
            ...TAMSHAPES.text,
            align: "left",
            fontSize: SMALL_SIZE,
            fontColor: "#3F4146",
            spacing: 0,
          },
        },
        "condition",
      ),
    );
  });
  return cells;
}

// ---------------------------------------------------------------------------------------------
// Reading the page

/** A participant found on a page. */
interface Lifeline {
  /** The cell the participant's id comes from, when the page was written here. */
  own?: string;
  label: string;
  actor: boolean;
  /** The head: the agent's box, an actor's figure and name. */
  head: Box;
  x: number;
  /** Cells that stand for this participant when a message is connected to them. */
  cells: Set<string>;
  group?: number;
  level?: string;
  /** Where the lifeline ends. */
  bottom?: number;
}

interface Bar {
  who: number;
  top: number;
  bottom: number;
  x: number;
  white: boolean;
}

interface Message {
  from: number;
  to: number;
  text: string;
  dashed: boolean;
  head: MarkerKind | null;
  tail: MarkerKind | null;
  y: number;
  start: Point;
  /** How far it reaches left and right. */
  span: [number, number];
  number?: number;
  activate?: boolean;
  deactivate?: boolean;
}

interface Note {
  placement: "left" | "right" | "over";
  who: number[];
  text: string;
  y: number;
}

interface Frame {
  kind: string;
  text: string;
  box: Box;
  branches: { y: number; text: string }[];
  /** The dashed lines across it and the texts in it, before they are read as branches and conditions. */
  lines: { y: number; text: string }[];
  guards: { box: Box; text: string }[];
}

/** What a page holds, read part by part. */
class Reader {
  readonly used = new Set<string>();
  readonly warnings: string[] = [];
  lifelines: Lifeline[] = [];
  readonly bars: Bar[] = [];
  readonly messages: Message[] = [];
  readonly notes: Note[] = [];
  readonly frames: Frame[] = [];
  readonly destroys: { who: number; y: number }[] = [];
  readonly groups: { label: string; box: Box }[] = [];
  /** The texts of the calls and replies in message exchanges, by edge. */
  readonly exchangeTexts = new Map<string, string>();
  title?: string;

  readonly drawing: Drawing;

  constructor(drawing: Drawing) {
    this.drawing = drawing;
  }

  style = (item: Cell) => this.drawing.style(item);
  role = (item: Cell) => roleOf(this.drawing, item);
  box = (item: Cell) => this.drawing.box(item);
  label = (item: Cell) => this.drawing.label(item);

  get vertices() {
    return this.drawing.parts.filter((item) => item.vertex && !this.used.has(item.id));
  }

  get edges() {
    return this.drawing.parts.filter((item) => item.edge && !this.used.has(item.id));
  }

  /** Marks a cell and everything in it read. */
  use(item: Cell, deep = false) {
    this.used.add(item.id);
    if (deep) for (const inner of this.drawing.descendants(item.id)) this.used.add(inner.id);
  }

  /** Whether a cell draws only its text: no outline and no fill, or the `text` style. */
  isText(item: Cell) {
    const style = this.style(item);
    if (shapeOf(style) === "text") return true;
    return (
      style.get("strokeColor") === "none" &&
      (!style.get("fillColor") || style.get("fillColor") === "none")
    );
  }

  /** Whether a cell draws nothing at all. */
  invisible(item: Cell) {
    const style = this.style(item);
    return (
      style.get("strokeColor") === "none" && style.get("fillColor") === "none" && !this.label(item)
    );
  }

  /** The participant a cell stands for, by itself or by one of the cells it is in. */
  participantOf(item: Cell | undefined): number | undefined {
    for (let at = item; at; at = this.drawing.parentOf(at)) {
      const index = this.lifelines.findIndex((lifeline) => lifeline.cells.has(at!.id));
      if (index >= 0) return index;
    }
    return undefined;
  }

  /** The participant whose lifeline runs nearest `x`. */
  nearest(x: number): number {
    let best = 0;
    this.lifelines.forEach((lifeline, index) => {
      if (Math.abs(lifeline.x - x) < Math.abs(this.lifelines[best].x - x)) best = index;
    });
    return best;
  }
}

/** Whether a style draws a dashed vertical line from `top` down: the shape of a lifeline. */
function lineDown(path: Point[], least = 30): { top: Point; bottom: Point } | undefined {
  if (path.length < 2) return undefined;
  const xs = path.map((point) => point.x),
    ys = path.map((point) => point.y);
  if (Math.max(...xs) - Math.min(...xs) > 4) return undefined;
  const top = Math.min(...ys),
    bottom = Math.max(...ys);
  if (bottom - top < least) return undefined;
  return { top: { x: xs[0], y: top }, bottom: { x: xs[0], y: bottom } };
}

/** Whether a cell is the TAM-BD Human figure: a group holding a circle and lines. */
function isHuman(drawing: Drawing, item: Cell): boolean {
  const style = drawing.style(item);
  if (roleOf(drawing, item) === "human") return true;
  if (!style.has("group")) return false;
  const inside = drawing.children(item.id);
  return (
    inside.some((child) => shapeOf(drawing.style(child)) === "ellipse") &&
    inside.filter((child) => child.edge).length >= 3
  );
}

/** Finds the participants: draw.io lifelines, TAM lifelines, actors, and boxes with a dashed line below. */
function readLifelines(reader: Reader) {
  const { drawing } = reader;
  const add = (lifeline: Omit<Lifeline, "x" | "cells">, cells: Cell[]) =>
    reader.lifelines.push({
      ...lifeline,
      x: lifeline.head.x + lifeline.head.width / 2,
      cells: new Set(cells.map((item) => item.id)),
    });

  for (const item of reader.vertices) {
    const style = reader.style(item),
      role = reader.role(item),
      shape = shapeOf(style);
    if (role === "lifeline") {
      reader.use(item);
      continue;
    }
    if (shape === "umlLifeline") {
      const box = reader.box(item),
        size = Number(style.get("size") ?? 40) || 40;
      reader.use(item);
      add(
        {
          label: reader.label(item),
          actor: style.get("participant") === "umlActor",
          head: { ...box, height: Math.min(size, box.height) },
          bottom: box.y + box.height,
        },
        [item],
      );
    } else if (role === "participant" || role === "actor") {
      reader.use(item, true);
      const container = drawing.parentOf(item);
      const own = container && reader.role(container) === "lifeline" ? container : item;
      add(
        {
          own: own.id,
          label: reader.label(item),
          actor: role === "actor",
          head: reader.box(item),
          level: container && reader.style(container).get("tamLevel"),
        },
        container ? [item, container] : [item],
      );
    }
  }
  for (const item of reader.vertices) {
    if (shapeOf(reader.style(item)) === "umlActor") {
      reader.use(item, true);
      add(
        {
          label: reader.label(item) || labelBelow(reader, reader.box(item)),
          actor: true,
          head: reader.box(item),
        },
        [item],
      );
    } else if (isHuman(drawing, item)) {
      // In a box of its own (TAM-BD Human Agent) the box is the head; alone, its name stands below it.
      // Dropped onto a head's box, which does not hold it, the figure makes that head an actor's.
      const outer = drawing.parentOf(item) ?? boxAround(reader, reader.box(item));
      if (outer && !reader.used.has(outer.id) && reader.label(outer) && !reader.isText(outer)) {
        reader.use(item, true);
        reader.use(outer, true);
        const container = drawing.parentOf(outer);
        add(
          { label: reader.label(outer), actor: true, head: reader.box(outer) },
          container && reader.invisible(container) ? [outer, container] : [outer],
        );
      } else {
        reader.use(item, true);
        const box = reader.box(item);
        add({ label: reader.label(item) || labelBelow(reader, box), actor: true, head: box }, [
          item,
        ]);
      }
    }
  }
  readLines(reader);
  reader.lifelines.sort((a, b) => a.x - b.x);
}

/** The smallest box with a name around a figure, the size of a head. */
function boxAround(reader: Reader, figure: Box): Cell | undefined {
  return reader.vertices
    .filter((item) => {
      if (!item.vertex || reader.isText(item) || !reader.label(item)) return false;
      if (shapeOf(reader.style(item)) !== "rect") return false;
      const box = reader.box(item);
      return box.height <= 3 * figure.height && inside(figure, box, 1);
    })
    .sort((a, b) => {
      const one = reader.box(a),
        other = reader.box(b);
      return one.width * one.height - other.width * other.height;
    })[0];
}

/** The text of a text cell just below a figure, which is then read. */
function labelBelow(reader: Reader, figure: Box): string {
  const text = reader.vertices.find((item) => {
    if (!reader.isText(item) || !reader.label(item)) return false;
    const box = reader.box(item);
    return (
      box.y >= figure.y + figure.height - 8 &&
      box.y <= figure.y + figure.height + 30 &&
      Math.abs(box.x + box.width / 2 - (figure.x + figure.width / 2)) < figure.width / 2 + 40
    );
  });
  if (!text) return "";
  reader.use(text);
  return reader.label(text);
}

/** Dashed lines down from a head: the lifelines, and the boxes they hang from as heads. */
function readLines(reader: Reader) {
  const { drawing } = reader;
  for (const edge of reader.edges) {
    const style = reader.style(edge),
      role = reader.role(edge);
    if (!dashed(style) && role !== "line") continue;
    // A lifeline written here may be short: a participant created at the end of the diagram.
    const line = lineDown(drawing.path(edge), role === "line" ? 0 : 30);
    if (!line) continue;
    const source = edge.source ? drawing.cells.get(edge.source) : undefined;
    const under = (box: Box) =>
      line.top.x >= box.x - 2 &&
      line.top.x <= box.x + box.width + 2 &&
      line.top.y >= box.y + box.height - 12 &&
      line.top.y <= box.y + box.height + 40;
    const known = reader.lifelines.find(
      (lifeline) => (source && lifeline.cells.has(source.id)) || under(lifeline.head),
    );
    if (known) {
      reader.use(edge);
      known.cells.add(edge.id);
      known.bottom = Math.max(known.bottom ?? -Infinity, line.bottom.y);
      continue;
    }
    const head =
      (source?.vertex && !reader.used.has(source.id) ? source : undefined) ??
      reader.vertices.find(
        (item) => !reader.isText(item) && reader.label(item) && under(reader.box(item)),
      );
    if (!head) continue;
    reader.use(edge);
    reader.use(head, true);
    const box = reader.box(head);
    reader.lifelines.push({
      label: reader.label(head),
      actor: false,
      head: box,
      x: box.x + box.width / 2,
      bottom: line.bottom.y,
      cells: new Set([
        head.id,
        edge.id,
        ...(drawing.parentOf(head) && reader.invisible(drawing.parentOf(head)!)
          ? [drawing.parentOf(head)!.id]
          : []),
      ]),
    });
  }
}

/** Activation bars: narrow upright boxes on a lifeline; pieces that meet and differ in fill are one bar. */
function readBars(reader: Reader) {
  const pieces: (Bar & { cell: Cell })[] = [];
  for (const item of reader.vertices) {
    const style = reader.style(item),
      box = reader.box(item);
    const looks =
      reader.role(item) === "activation" ||
      (shapeOf(style) === "rect" &&
        !reader.isText(item) &&
        !isDark(style) &&
        box.width > 0 &&
        box.width <= 30 &&
        box.height >= box.width &&
        !reader.label(item));
    if (!looks) continue;
    const x = box.x + box.width / 2,
      who = reader.participantOf(item) ?? reader.nearest(x);
    if (Math.abs(reader.lifelines[who].x - x) > 25) continue;
    reader.use(item);
    reader.lifelines[who].cells.add(item.id);
    const fill = fillColor(style);
    pieces.push({
      cell: item,
      who,
      top: box.y,
      bottom: box.y + box.height,
      x,
      white: !fill || fill === "#FFFFFF",
    });
  }
  pieces.sort((a, b) => a.who - b.who || a.x - b.x || a.top - b.top);
  for (const piece of withoutLayers(pieces)) {
    const last = reader.bars.at(-1);
    if (
      last &&
      last.who === piece.who &&
      Math.abs(last.x - piece.x) < 1 &&
      Math.abs(last.bottom - piece.top) <= 1 &&
      last.white !== piece.white
    )
      Object.assign(last, { bottom: piece.bottom, white: piece.white });
    else
      reader.bars.push({
        who: piece.who,
        top: piece.top,
        bottom: piece.bottom,
        x: piece.x,
        white: piece.white,
      });
  }
}

/**
 * The pieces of bars without those laid over another bar at the same place: a TAM-SeqD message
 * exchange dropped on a lifeline that is active already brings bars of its own, which only change the
 * fill of the bar under them (a white one while the caller waits). A nested bar stands aside.
 */
function withoutLayers<T extends Bar>(pieces: T[]): T[] {
  return pieces.filter(
    (piece) =>
      !pieces.some(
        (other) =>
          other !== piece &&
          other.who === piece.who &&
          Math.abs(other.x - piece.x) < 3 &&
          other.top <= piece.top + 1 &&
          other.bottom >= piece.bottom - 1 &&
          (other.bottom - other.top > piece.bottom - piece.top ||
            pieces.indexOf(other) < pieces.indexOf(piece)),
      ),
  );
}

/** Crosses that end lifelines. */
function readDestroys(reader: Reader) {
  for (const item of reader.vertices) {
    if (reader.role(item) !== "destroy" && shapeOf(reader.style(item)) !== "umlDestroy") continue;
    reader.use(item, true);
    const center = centerOf(reader.box(item));
    reader.destroys.push({
      who: reader.participantOf(item) ?? reader.nearest(center.x),
      y: center.y,
    });
  }
}

/** Notes: beside the lifeline nearest them, or over the lifelines they cover. */
function readNotes(reader: Reader) {
  for (const item of reader.vertices) {
    const shape = shapeOf(reader.style(item));
    if (reader.role(item) !== "note" && shape !== "note" && shape !== "note2") continue;
    reader.use(item, true);
    const box = reader.box(item);
    const over = reader.lifelines
      .map((lifeline, index) => ({ lifeline, index }))
      .filter(({ lifeline }) => lifeline.x > box.x && lifeline.x < box.x + box.width);
    const text = reader.label(item);
    if (over.length) {
      const who = over.length === 1 ? [over[0].index] : [over[0].index, over.at(-1)!.index];
      reader.notes.push({ placement: "over", who, text, y: box.y });
    } else {
      // Beside the lifeline the page says, or else the one it stands closer to: right of the one on its
      // left, or left of the one on its right.
      const said = reader.style(item).get("tamPlacement");
      const left = reader.lifelines.findLastIndex((lifeline) => lifeline.x <= box.x),
        right = reader.lifelines.findIndex((lifeline) => lifeline.x >= box.x + box.width);
      const gapLeft = left < 0 ? Infinity : box.x - reader.lifelines[left].x,
        gapRight = right < 0 ? Infinity : reader.lifelines[right].x - (box.x + box.width);
      reader.notes.push(
        (said === "right" && left >= 0) || (said !== "left" && gapLeft <= gapRight) || right < 0
          ? { placement: "right", who: [left], text, y: box.y }
          : { placement: "left", who: [right], text, y: box.y },
      );
    }
  }
}

/** A frame's keyword and the condition its tab may carry (`alt [in stock]`). */
function frameLabel(label: string): { kind: string; text: string } {
  const match = label.trim().match(/^(\w+)\s*([\s\S]*)$/);
  if (!match) return { kind: "", text: "" };
  return { kind: match[1].toLowerCase(), text: bare(match[2]) };
}

/** A condition without its brackets. */
const bare = (text: string) =>
  text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .replace(/^\[([\s\S]*)\]$/, "$1")
    .trim();

/** Combined fragments, `rect` areas, and the groups of participants. */
function readFrames(reader: Reader) {
  for (const item of reader.vertices) {
    const role = reader.role(item),
      shape = shapeOf(reader.style(item)),
      box = reader.box(item);
    if (role === "rect") {
      reader.use(item);
      reader.frames.push({ kind: "rect", text: "", box, branches: [], lines: [], guards: [] });
    } else if (role === "fragment" || shape === "umlFrame") {
      reader.use(item);
      const { kind, text } = frameLabel(reader.label(item));
      if (!FRAGMENTS.has(kind)) {
        reader.warnings.push(
          `The frame “${reader.label(item)}” is no fragment a sequence diagram has (loop, alt, opt, par, critical, break); its messages are read without it.`,
        );
        continue;
      }
      reader.frames.push({ kind, text, box, branches: [], lines: [], guards: [] });
    } else if (role === "group") {
      reader.use(item);
      reader.groups.push({ label: reader.label(item), box });
    }
  }
  // A labelled box around participants' heads groups them.
  for (const item of reader.vertices) {
    if (reader.isText(item) || !reader.label(item) || shapeOf(reader.style(item)) !== "rect")
      continue;
    const box = reader.box(item);
    if (!reader.lifelines.some((lifeline) => inside(lifeline.head, box, 4))) continue;
    reader.use(item);
    reader.groups.push({ label: reader.label(item), box });
  }
  reader.groups.sort((a, b) => a.box.x - b.box.x);
  reader.lifelines.forEach((lifeline) => {
    const group = reader.groups.findIndex((item) => inside(lifeline.head, item.box, 4));
    if (group >= 0) lifeline.group = group;
  });
}

/** The innermost frame around a point. */
function frameAt(reader: Reader, point: Point): Frame | undefined {
  return reader.frames
    .filter((frame) => contains(frame.box, point, 2))
    .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
}

/** Branch lines across fragments. */
function readBranches(reader: Reader) {
  const { drawing } = reader;
  for (const edge of reader.edges) {
    const path = drawing.path(edge),
      role = reader.role(edge),
      style = reader.style(edge);
    if (path.length < 2 || role === "message") continue;
    if (role !== "branch" && (!dashed(style) || hasArrow(style, "start") || hasArrow(style, "end")))
      continue;
    const ys = path.map((point) => point.y),
      xs = path.map((point) => point.x);
    if (Math.max(...ys) - Math.min(...ys) > 4) continue;
    const middle = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: ys[0] };
    // A branch line runs from side to side of its frame; a message ends at lifelines inside it.
    const frame = frameAt(reader, middle);
    if (
      !frame ||
      Math.min(...xs) - frame.box.x > 8 ||
      frame.box.x + frame.box.width - Math.max(...xs) > 8
    )
      continue;
    reader.use(edge, true);
    frame.lines.push({ y: middle.y, text: bare(reader.label(edge)) });
  }
}

/** The conditions inside fragments, read once the texts of messages are taken. */
function readConditions(reader: Reader) {
  for (const item of reader.vertices) {
    if (reader.role(item) !== "condition" && !reader.isText(item)) continue;
    const text = reader.label(item);
    if (!text) continue;
    const box = reader.box(item);
    const frame = frameAt(reader, centerOf(box));
    if (!frame) continue;
    reader.use(item);
    frame.guards.push({ box, text: bare(text) });
  }
  for (const frame of reader.frames) settleBranches(reader, frame);
}

/** A frame's condition and its branches, each with the condition just below its line. */
function settleBranches(reader: Reader, frame: Frame) {
  const lines = frame.lines.sort((a, b) => a.y - b.y);
  const word = BRANCH_WORD[frame.kind];
  if (lines.length && !word) {
    reader.warnings.push(
      `The ${frame.kind || "rect"} fragment has branch lines, which only alt, par and critical have; they are left out.`,
    );
  }
  const stops = [frame.box.y, ...(word ? lines.map((line) => line.y) : [])];
  const texts = stops.map(() => [] as string[]);
  for (const guard of frame.guards.sort((a, b) => a.box.y - b.box.y)) {
    const index = stops.findLastIndex((y) => y <= guard.box.y + 4);
    if (index < 0 || guard.box.y - stops[index] > 40) {
      reader.warnings.push(
        `The text “${guard.text}” in a fragment is no condition of it and is left out.`,
      );
      continue;
    }
    texts[index].push(guard.text);
  }
  if (!frame.text) frame.text = texts[0].join(" ");
  if (word)
    frame.branches = lines.map((line, index) => ({
      y: line.y,
      text: line.text || texts[index + 1].join(" "),
    }));
}

/** The model's head at one end of an edge. */
function headOf(style: Style, end: "start" | "end"): MarkerKind | null {
  const arrow = arrowAt(style, end);
  if (arrow === "none") return null;
  if (arrow === "cross") return "cross";
  if (/^open/.test(arrow)) return "open";
  return style.get(`${end}Fill`) === "0" ? "open" : "arrow";
}

/** Messages: every other edge, from the lifeline nearest its start to the one nearest its end. */
function readMessages(reader: Reader) {
  const { drawing } = reader;
  for (const edge of reader.edges) {
    const path = messagePath(reader, edge);
    const text = [
      reader.label(edge),
      reader.exchangeTexts.get(edge.id),
      ...drawing
        .children(edge.id)
        .filter((item) => item.vertex)
        .map((item) => reader.label(item)),
    ]
      .filter(Boolean)
      .join("\n");
    if (path.length < 2) {
      reader.warnings.push(
        `The connection “${text || edge.id}” has no ends on the page and is left out.`,
      );
      continue;
    }
    reader.use(edge, true);
    const style = reader.style(edge);
    const end = (id: string | undefined, point: Point) => {
      const connected = reader.participantOf(id ? drawing.cells.get(id) : undefined);
      if (connected !== undefined) return connected;
      const nearest = reader.nearest(point.x);
      if (Math.abs(reader.lifelines[nearest].x - point.x) > 60)
        reader.warnings.push(
          `The message “${text}” ends far from every lifeline; it is read as ending at “${reader.lifelines[nearest].label}”, the nearest.`,
        );
      return nearest;
    };
    let from = end(edge.source, path[0]),
      to = end(edge.target, path.at(-1)!),
      head = headOf(style, "end"),
      tail = headOf(style, "start"),
      start = path[0];
    // An edge drawn backwards, its only head at its start, goes the other way.
    if (!head && tail) [from, to, head, tail, start] = [to, from, tail, null, path.at(-1)!];
    const xs = path.map((point) => point.x);
    reader.messages.push({
      from,
      to,
      text,
      dashed: dashed(style),
      head,
      tail,
      y: start.y,
      start,
      span: [Math.min(...xs), Math.max(...xs)],
    });
  }
  reader.messages.sort((a, b) => a.y - b.y);
}

/**
 * The message exchanges of TAM-SeqD: a group of two bars with a call between them and, when it is
 * synchronous, the reply. The group's own label names the call, the label inside it ("..." until
 * someone types over it) the reply below it.
 */
function readExchanges(reader: Reader) {
  const { drawing } = reader;
  const groups = new Set(
    reader.edges
      .map((edge) => drawing.parentOf(edge))
      .filter((group): group is Cell => !!group?.vertex && !reader.used.has(group.id)),
  );
  for (const group of groups) {
    const calls = drawing
      .children(group.id)
      .filter((item) => item.edge && !reader.used.has(item.id))
      .map((edge) => ({ edge, y: Math.min(...drawing.path(edge).map((point) => point.y)) }))
      .sort((a, b) => a.y - b.y);
    if (!calls.length) continue;
    const texts = new Map<string, string[]>();
    const add = (edge: Cell, text: string) => {
      if (text && !/^(\.\.\.|…)$/.test(text.trim()))
        texts.set(edge.id, [...(texts.get(edge.id) ?? []), text]);
    };
    reader.use(group);
    add(calls[0].edge, reader.label(group));
    for (const item of drawing.children(group.id)) {
      if (!item.vertex || reader.used.has(item.id)) continue;
      reader.use(item, true);
      const box = reader.box(item),
        y = box.y + box.height / 2;
      // A label stands on or just above the line it names.
      const nearest = calls
        .map((call) => ({ call, distance: Math.abs(call.y - y) }))
        .sort((a, b) => a.distance - b.distance)[0];
      add(nearest.call.edge, reader.label(item));
    }
    for (const [id, lines] of texts) reader.exchangeTexts.set(id, lines.join("\n"));
  }
}

/** Whether a text is a condition in brackets, which a fragment holds and no message does. */
const bracketed = (text: string) => /^\s*\[[\s\S]*\]\s*$/.test(text);

/**
 * Texts that people type above a message rather than on it: a text just above a message without a
 * text of its own (or on its line), within its length, names that message.
 */
function readMessageTexts(reader: Reader) {
  for (const item of reader.vertices) {
    const text = reader.label(item);
    if (!text || !reader.isText(item) || bracketed(text) || reader.role(item)) continue;
    const box = reader.box(item),
      middle = box.x + box.width / 2,
      bottom = box.y + box.height;
    const message = reader.messages
      .filter(
        (candidate) =>
          !candidate.text &&
          middle >= candidate.span[0] - 4 &&
          middle <= candidate.span[1] + 4 &&
          candidate.y - bottom >= -box.height / 2 &&
          candidate.y - bottom <= 12,
      )
      .sort((a, b) => Math.abs(a.y - bottom) - Math.abs(b.y - bottom))[0];
    if (!message) continue;
    reader.use(item);
    message.text = text;
  }
}

/** How draw.io's perimeter of a shape meets a message: a lifeline's, a bar's of its UML library, or another. */
function perimeterOf(reader: Reader, item: Cell): "lifeline" | "orthogonal" | "other" {
  const style = reader.style(item),
    perimeter = style.get("perimeter");
  if (perimeter === "lifelinePerimeter" || shapeOf(style) === "umlLifeline") return "lifeline";
  return perimeter === "orthogonalPerimeter" ? "orthogonal" : "other";
}

/**
 * Where a floating end of a message meets its shape, toward the next point of the message, as
 * draw.io's perimeters put it: on a lifeline's dashed line level with the point, below the head; on a
 * bar of draw.io's UML library (orthogonalPerimeter) straight across when the point lies within its
 * height; on other shapes where the line toward the point crosses their outline
 * (mxPerimeter.RectanglePerimeter).
 */
function floatingEnd(reader: Reader, item: Cell, next: Point): Point {
  const box = reader.box(item),
    middle = centerOf(box),
    kind = perimeterOf(reader, item);
  if (kind === "lifeline") {
    const head = Number(reader.style(item).get("size") ?? 40) || 40;
    return { x: middle.x, y: Math.min(box.y + box.height, Math.max(box.y + head, next.y)) };
  }
  const dx = next.x - middle.x,
    dy = next.y - middle.y;
  if (!dx && !dy) return middle;
  const alpha = Math.atan2(dy, dx),
    corner = Math.atan2(box.height, box.width);
  const point =
    alpha < -Math.PI + corner || alpha > Math.PI - corner
      ? { x: box.x, y: middle.y - (box.width * Math.tan(alpha)) / 2 }
      : alpha < -corner
        ? { x: middle.x - box.height / (2 * Math.tan(alpha)), y: box.y }
        : alpha < corner
          ? { x: box.x + box.width, y: middle.y + (box.width * Math.tan(alpha)) / 2 }
          : { x: middle.x + box.height / (2 * Math.tan(alpha)), y: box.y + box.height };
  if (kind === "orthogonal") {
    if (next.x >= box.x && next.x <= box.x + box.width) point.x = next.x;
    else if (next.y >= box.y && next.y <= box.y + box.height) point.y = next.y;
    if (next.x < box.x) point.x = box.x;
    else if (next.x > box.x + box.width) point.x = box.x + box.width;
    if (next.y < box.y) point.y = box.y;
    else if (next.y > box.y + box.height) point.y = box.y + box.height;
  }
  return point;
}

/** The lifeline of draw.io's UML library a shape is, or stands in (a bar), or else the shape itself. */
function sequenceLifeline(reader: Reader, item: Cell): Cell {
  const parent = reader.drawing.parentOf(item);
  const lifeline = (cell: Cell | undefined) =>
    !!cell?.vertex && shapeOf(reader.style(cell)) === "umlLifeline";
  return !lifeline(item) && lifeline(parent) ? parent! : item;
}

/**
 * The bends draw.io's sequence router (edgeStyle=sequenceEdgeStyle, mxEdgeStyle.SequenceMessage)
 * gives a message whose bends are its own: a self call goes out 30px to the right and back; a
 * message between two lifelines runs level, at the height of its pinned end, or of its bend, or else
 * halfway between the middles of its shapes, kept within the heights both shapes share.
 */
function sequenceBends(
  reader: Reader,
  ends: { source?: Cell; target?: Cell; start?: Point; end?: Point },
  bends: Point[],
): Point[] {
  const { source, target, start, end } = ends;
  const span = (item: Cell) => {
    const box = reader.box(item),
      head =
        perimeterOf(reader, item) === "lifeline"
          ? Number(reader.style(item).get("size") ?? 40) || 40
          : 0;
    return { top: box.y + Math.min(head, box.height), bottom: box.y + box.height };
  };
  if (
    source &&
    target &&
    bends.length <= 2 &&
    sequenceLifeline(reader, source) === sequenceLifeline(reader, target)
  ) {
    const box = reader.box(source);
    const top = start?.y ?? bends[0]?.y ?? centerOf(box).y,
      bottom = end?.y ?? (bends.length > 1 ? bends[1].y : top + 30);
    const x =
      bends[0]?.x ??
      (perimeterOf(reader, source) === "lifeline" ? centerOf(box).x : box.x + box.width) + 30;
    return [
      { x, y: top },
      { x, y: bottom },
    ];
  }
  if (bends.length > 1 || !source || !target || source === target) return bends;
  if (start && end) return [];
  let y: number;
  if (start || end) {
    y = (start ?? end)!.y;
    const { top, bottom } = span(start ? target : source);
    if (y < top || y > bottom) return [];
  } else {
    const one = span(source),
      other = span(target);
    const top = Math.max(one.top, other.top),
      bottom = Math.min(one.bottom, other.bottom);
    if (top > bottom) return [];
    y = bends[0]?.y ?? (centerOf(reader.box(source)).y + centerOf(reader.box(target)).y) / 2;
    y = Math.min(bottom, Math.max(top, y));
  }
  // Halfway between the shapes, outside both.
  const from = reader.box(source),
    to = reader.box(target);
  let x = (centerOf(from).x + centerOf(to).x) / 2;
  const rightward = centerOf(from).x <= centerOf(to).x;
  for (const [box, right] of [
    [from, rightward],
    [to, !rightward],
  ] as const)
    if (x > box.x && x < box.x + box.width) x = right ? box.x + box.width + 1 : box.x - 1;
  return [{ x, y }];
}

/**
 * A message's path, as draw.io draws it. A floating end on a lifeline or a bar of draw.io's UML
 * library meets it level with the point it comes from, and a message drawn with draw.io's sequence
 * router runs as that router lays it; the ends of other messages are where `Drawing.path` puts them.
 * As in draw.io, the end at the target is placed first, toward the last bend or the source's middle,
 * and the start toward the first bend or that end.
 */
function messagePath(reader: Reader, edge: Cell): Point[] {
  const { drawing } = reader;
  const path = [...drawing.path(edge)];
  if (path.length < 2) return path;
  const style = reader.style(edge),
    edgeStyle = style.get("edgeStyle") ?? "none";
  const connected = (id: string | undefined) => {
    const terminal = id ? drawing.cells.get(id) : undefined;
    return terminal?.vertex ? terminal : undefined;
  };
  const floating = (id: string | undefined, side: "exit" | "entry") =>
    style.has(`${side}X`) && style.has(`${side}Y`) ? undefined : connected(id);
  const source = floating(edge.source, "exit"),
    target = floating(edge.target, "entry");
  const special = (item: Cell | undefined) => !!item && perimeterOf(reader, item) !== "other";
  // A loop on one shape is drawn with draw.io's loop style, whatever the edge's own.
  const loop = !!edge.source && edge.source === edge.target;
  if (
    !loop &&
    (edgeStyle === "sequenceEdgeStyle" || (edgeStyle === "none" && !style.has("orthogonal")))
  ) {
    if (edgeStyle === "none" && !special(source) && !special(target)) return path;
    const parent = drawing.parentOf(edge);
    const origin = parent?.vertex ? drawing.box(parent) : { x: 0, y: 0 };
    const own = (edge.geometry?.points ?? []).map((point) => ({
      x: point.x + origin.x,
      y: point.y + origin.y,
    }));
    const fixed = { start: source ? undefined : path[0], end: target ? undefined : path.at(-1) };
    const bends =
      edgeStyle === "sequenceEdgeStyle"
        ? sequenceBends(
            reader,
            { source: connected(edge.source), target: connected(edge.target), ...fixed },
            own,
          )
        : own;
    const end = target
      ? floatingEnd(reader, target, bends.at(-1) ?? fixed.start ?? centerOf(reader.box(source!)))
      : fixed.end!;
    const start = source ? floatingEnd(reader, source, bends[0] ?? end) : fixed.start!;
    return [start, ...bends, end];
  }
  // Routed otherwise, an end on a lifeline still meets it level with the point next to it.
  if (special(target)) path[path.length - 1] = floatingEnd(reader, target!, path.at(-2)!);
  if (special(source)) path[0] = floatingEnd(reader, source!, path[1]);
  return path;
}

/** Message numbers in black circles at the start of the messages they number. */
function readNumbers(reader: Reader) {
  for (const item of reader.vertices) {
    const style = reader.style(item);
    const number = reader.label(item);
    const looks =
      reader.role(item) === "badge" ||
      (shapeOf(style) === "ellipse" && reader.box(item).width <= 30 && /^\d+$/.test(number));
    if (!looks) continue;
    reader.use(item, true);
    const center = centerOf(reader.box(item));
    const message = reader.messages
      .filter((candidate) => candidate.number === undefined)
      .map((candidate) => ({
        candidate,
        distance: Math.hypot(candidate.start.x - center.x, candidate.start.y - center.y),
      }))
      .filter(({ distance }) => distance < 40)
      .sort((a, b) => a.distance - b.distance)[0];
    if (message && /^\d+$/.test(number)) message.candidate.number = Number(number);
    else reader.warnings.push(`The number “${number}” stands at no message and is left out.`);
  }
}

/** The title, and a warning for every other shape with text that is not read. */
function readRest(reader: Reader) {
  const headsTop = Math.min(...reader.lifelines.map((lifeline) => lifeline.head.y));
  for (const item of reader.vertices) {
    const text = reader.label(item);
    if (
      reader.role(item) === "title" ||
      (!reader.title &&
        text &&
        reader.isText(item) &&
        reader.box(item).y + reader.box(item).height <= headsTop)
    ) {
      reader.use(item);
      reader.title = text.replace(/\n/g, " ");
      continue;
    }
    if (text)
      reader.warnings.push(`The shape “${text}” is no part of a sequence diagram and is left out.`);
  }
}

// ---------------------------------------------------------------------------------------------
// Writing the source

/** The words a statement can open with, which an id of a participant is not to be. */
const RESERVED =
  "end loop alt else opt par and critical option break rect box note activate deactivate participant actor create destroy title autonumber link links properties details as over of left right sequencediagram".split(
    " ",
  );

/** A color a box's title may start with, which the parser takes for the box's color (as uml-sequence.ts reads it). */
const COLOR =
  /^(rgba?\([^)]*\)|#[0-9a-f]{3,8}|transparent|aqua|black|blue|fuchsia|gray|grey|green|lime|maroon|navy|olive|purple|red|silver|teal|white|yellow|orange|pink|lightblue|lightgreen|lightgrey|lightgray|lightyellow|beige|ivory|lavender|wheat|tan|khaki|coral|salmon|gold|cyan|magenta)\b/i;

const PARTICIPANT_ID = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** The arrow of a message, and a warning when the page draws one the syntax has not. */
function arrowOf(message: Message): { arrow: string; odd: boolean } {
  if (message.tail)
    return { arrow: message.dashed ? "<<-->>" : "<<->>", odd: message.tail !== message.head };
  switch (message.head) {
    case "arrow":
      return { arrow: message.dashed ? "-->>" : "->>", odd: message.dashed };
    case "open":
      return { arrow: message.dashed ? "-->>" : "-)", odd: false };
    case "cross":
      return { arrow: message.dashed ? "--x" : "-x", odd: false };
    default:
      return { arrow: message.dashed ? "-->" : "->", odd: false };
  }
}

/** An event of the source and where it happens on the page: by y, then by rank at the same height. */
interface Placed {
  y: number;
  rank: number;
  /** Ties at the same height and rank. */
  order: number;
  lines: string[];
  /** +1 opens a fragment (the lines after stand deeper), -1 closes one, 0 for a branch line. */
  depth?: 1 | 0 | -1;
}

/** How far a bar's end may be from a message to start or end with it. */
const NEAR = 6;

/** Whether a message is to or from a participant, at a height. */
const takesPart = (message: Message, who: number, y: number) =>
  (message.to === who || message.from === who) && Math.abs(message.y - y) <= NEAR;

/**
 * Activations: a message's `+` where a bar starts at a message to its participant, its `-` where a
 * bar ends at one from it, else `activate` and `deactivate` where the bar starts and ends. A bar that
 * runs to the end of its lifeline is never deactivated. The white bar of a caller in a TAM-SeqD
 * exchange, on a lifeline with no bar under it, is the caller's activation while it waits: `+` and
 * `-` belong to the receiver of the call and the sender of the reply, so it is `activate` after the
 * call (the bar then starts at the call) and `deactivate` after the reply.
 */
function activationEvents(reader: Reader, name: (index: number) => string): Placed[] {
  const { messages, lifelines } = reader;
  const placed: Placed[] = [];
  const bars = reader.bars.toSorted((a, b) => a.top - b.top || b.bottom - a.bottom);
  for (const bar of bars) {
    const start = messages.find(
      (message) =>
        message.to === bar.who && !message.activate && Math.abs(message.y - bar.top) <= NEAR,
    );
    if (start) start.activate = true;
    else
      placed.push({
        y: messages.find((message) => takesPart(message, bar.who, bar.top))?.y ?? bar.top,
        rank: 2,
        order: bar.top,
        lines: [`activate ${name(bar.who)}`],
      });
  }
  for (const bar of bars.toSorted((a, b) => a.bottom - b.bottom || b.top - a.top)) {
    const end = lifelines[bar.who].bottom;
    if (end !== undefined && bar.bottom >= end - 7) continue;
    const last = messages.find(
      (message) =>
        message.from === bar.who &&
        !message.deactivate &&
        !message.activate &&
        Math.abs(message.y - bar.bottom) <= NEAR,
    );
    if (last) last.deactivate = true;
    else
      placed.push({
        y: messages.find((message) => takesPart(message, bar.who, bar.bottom))?.y ?? bar.bottom,
        rank: 1,
        order: -bar.top,
        lines: [`deactivate ${name(bar.who)}`],
      });
  }
  return placed;
}

/**
 * Creation and destruction: a participant whose head stands below the row of heads is created by
 * the message to it at the height of its head; one whose lifeline ends in a cross is destroyed with
 * the last message it takes part in above the cross.
 */
function lifecycleEvents(reader: Reader, name: (index: number) => string, created: Set<number>) {
  const { messages, lifelines } = reader;
  const placed: Placed[] = [];
  const rowBottom = Math.min(
    ...lifelines.map((lifeline) => lifeline.head.y + lifeline.head.height),
  );
  lifelines.forEach((lifeline, index) => {
    if (lifeline.head.y < rowBottom) return;
    const message = messages.find(
      (item) =>
        item.to === index &&
        item.y >= lifeline.head.y - 4 &&
        item.y <= lifeline.head.y + lifeline.head.height + 4,
    );
    if (!message) {
      reader.warnings.push(
        `The participant “${lifeline.label}” stands below the others, but no message creates it; it stands with them.`,
      );
      return;
    }
    created.add(index);
    placed.push({
      y: message.y,
      rank: -1,
      order: index,
      lines: [`create ${declaration(lifeline, name(index))}`],
    });
  });
  for (const destroy of reader.destroys) {
    const message = messages.findLast(
      (item) => (item.to === destroy.who || item.from === destroy.who) && item.y <= destroy.y + 2,
    );
    placed.push({
      y: message ? message.y : destroy.y,
      rank: message ? -0.5 : 1.5,
      order: destroy.who,
      lines: [`destroy ${name(destroy.who)}`],
    });
  }
  return placed;
}

/** The messages, with `autonumber` lines where their numbers start, change their step or stop. */
function messageEvents(reader: Reader, name: (index: number) => string): Placed[] {
  const { messages } = reader;
  let expected: number | undefined,
    step = 1;
  return messages.map((message, index) => {
    const { arrow, odd } = arrowOf(message);
    if (odd)
      reader.warnings.push(
        `The message “${message.text}” has heads the syntax does not draw; it reads as \`${arrow}\`.`,
      );
    const lines: string[] = [];
    if (message.number === undefined) {
      if (expected !== undefined) lines.push("autonumber off");
      expected = undefined;
    } else if (message.number !== expected) {
      const next = messages[index + 1]?.number;
      step = next !== undefined && next > message.number ? next - message.number : 1;
      lines.push(
        message.number === 1 && step === 1 ? "autonumber" : `autonumber ${message.number} ${step}`,
      );
      expected = message.number + step;
    } else expected = message.number + step;
    const sign = message.activate ? "+" : message.deactivate ? "-" : "";
    const text = message.text ? `: ${textOf(message.text)}` : "";
    lines.push(`${name(message.from)}${arrow}${sign}${name(message.to)}${text}`);
    return { y: message.y, rank: 0, order: index, lines };
  });
}

/** Notes where their tops stand. */
const noteEvents = (reader: Reader, name: (index: number) => string): Placed[] =>
  reader.notes.map((note) => {
    const where = note.placement === "over" ? "over" : `${note.placement} of`;
    return {
      y: note.y,
      rank: 3,
      order: 0,
      lines: [`note ${where} ${note.who.map(name).join(",")}: ${textOf(note.text)}`],
    };
  });

/** Fragments: their keyword at their top, a branch at each line across, `end` at their bottom. */
function frameEvents(reader: Reader): Placed[] {
  return reader.frames.flatMap((frame): Placed[] => {
    const word = BRANCH_WORD[frame.kind];
    const opening =
      frame.kind === "rect"
        ? "rect rgb(240, 240, 240)"
        : `${frame.kind}${frame.text ? ` ${textOf(frame.text)}` : ""}`;
    return [
      { y: frame.box.y, rank: 3, order: -frame.box.width, depth: 1, lines: [opening] },
      ...frame.branches.map((branch): Placed => ({
        y: branch.y,
        rank: 3,
        order: 0,
        depth: 0,
        lines: [`${word}${branch.text ? ` ${textOf(branch.text)}` : ""}`],
      })),
      {
        y: frame.box.y + frame.box.height,
        rank: 1.2,
        order: frame.box.width,
        depth: -1,
        lines: ["end"],
      },
    ];
  });
}

/** The events of the source in the order the page shows them, and the participants created on the way. */
function events(reader: Reader, ids: string[]): { placed: Placed[]; created: Set<number> } {
  const name = (index: number) => ids[index];
  const created = new Set<number>();
  // Activations first: they put the signs on the messages.
  const placed = [
    ...activationEvents(reader, name),
    ...lifecycleEvents(reader, name, created),
    ...messageEvents(reader, name),
    ...noteEvents(reader, name),
    ...frameEvents(reader),
  ];
  placed.sort((a, b) =>
    Math.abs(a.y - b.y) > 0.75 ? a.y - b.y : a.rank - b.rank || a.order - b.order,
  );
  return { placed, created };
}

/** A participant's declaration: `participant Id as Name`, `actor Id`. */
function declaration(lifeline: Lifeline, id: string): string {
  const keyword = lifeline.actor ? "actor" : "participant";
  const label = lifeline.label.replace(/\s*\n\s*/g, "<br>");
  return label === id ? `${keyword} ${id}` : `${keyword} ${id} as ${textOf(lifeline.label)}`;
}

/**
 * The ids of the participants: their own when the page was written here (the source had them), else
 * made from their names.
 */
function participantIds(reader: Reader): string[] {
  const ids = new Ids(RESERVED);
  const own = reader.lifelines.map((lifeline, index, all) =>
    lifeline.own &&
    PARTICIPANT_ID.test(lifeline.own) &&
    all.findIndex((other) => other.own?.toLowerCase() === lifeline.own!.toLowerCase()) === index
      ? lifeline.own
      : undefined,
  );
  for (const id of own) if (id) ids.take(id);
  return reader.lifelines.map(
    (lifeline, index) =>
      own[index] ?? ids.of("", lifeline.label.replace(/<br>/g, " "), "P", PARTICIPANT_ID),
  );
}

/** The source a read page stands for. */
function writeSource(reader: Reader): string {
  const ids = participantIds(reader);
  const { placed, created } = events(reader, ids);
  const lines = ["sequenceDiagram"];
  const level = reader.lifelines.find((lifeline) => lifeline.level)?.level;
  if (level === "conceptual" || level === "design") lines.push(`  %% level ${level}`);
  if (reader.title) lines.push(`  title ${textOf(reader.title)}`);
  let group: number | undefined;
  reader.lifelines.forEach((lifeline, index) => {
    if (created.has(index)) return;
    if (lifeline.group !== group) {
      if (group !== undefined) lines.push("  end");
      group = lifeline.group;
      if (group !== undefined) {
        const label = reader.groups[group].label;
        lines.push(`  box ${COLOR.test(label) ? "transparent " : ""}${textOf(label)}`.trimEnd());
      }
    }
    lines.push(`${group !== undefined ? "    " : "  "}${declaration(lifeline, ids[index])}`);
  });
  if (group !== undefined) lines.push("  end");
  let depth = 1;
  for (const event of placed) {
    if (event.depth === -1) depth = Math.max(1, depth - 1);
    const indent = "  ".repeat(event.depth === 0 ? depth - 1 : depth);
    lines.push(...event.lines.map((line) => indent + line));
    if (event.depth === 1) depth++;
  }
  // Heads stand where the page puts them along the row; time runs down whatever the page says.
  reader.lifelines.forEach((lifeline, index) =>
    lines.push(
      `%% @head:${ids[index]} ${Math.round(lifeline.head.x)},${Math.round(lifeline.head.y)}`,
    ),
  );
  return `${lines.join("\n")}\n`;
}

/** The sequence diagram a page draws. */
function readSequence(drawing: Drawing): Imported {
  const reader = new Reader(drawing);
  readLifelines(reader);
  if (!reader.lifelines.length)
    throw new DrawioError(
      `The page “${drawing.name}” has no lifelines: nothing on it reads as a sequence diagram.`,
    );
  readFrames(reader);
  readBars(reader);
  readDestroys(reader);
  readNotes(reader);
  readBranches(reader);
  readExchanges(reader);
  readMessages(reader);
  readMessageTexts(reader);
  readConditions(reader);
  readNumbers(reader);
  readRest(reader);
  if (
    !reader.title &&
    drawing.name &&
    !/^Page-\d+$/.test(drawing.name) &&
    drawing.name !== "Sequence diagram"
  )
    reader.title = drawing.name;
  return { source: writeSource(reader), kind: "sequence", warnings: reader.warnings };
}

/**
 * Whether a cell is a TAM-SeqD message exchange: a group holding the two bars and the message (or the
 * call and the reply) between them.
 */
function isExchange(drawing: Drawing, item: Cell): boolean {
  if (!item.vertex) return false;
  const inside = drawing.children(item.id);
  const bars = inside.filter((child) => {
    const box = drawing.box(child);
    return child.vertex && box.width > 0 && box.width <= 30 && box.height >= box.width;
  });
  return (
    bars.length === 2 &&
    inside.some(
      (child) =>
        child.edge && bars.some((bar) => bar.id === child.source || bar.id === child.target),
    )
  );
}

/** How much a page looks like a sequence diagram: its lifelines, activation bars, exchanges and frames. */
function likeness(drawing: Drawing): number {
  let score = 0;
  for (const item of drawing.parts) {
    if (isExchange(drawing, item)) score += 2;
    const style = drawing.style(item),
      role = roleOf(drawing, item),
      shape = shapeOf(style);
    if (role === "lifeline" || shape === "umlLifeline") score += 3;
    else if (role === "activation" || shape === "umlFrame" || shape === "umlDestroy") score += 1;
    else if (item.vertex && fillColor(style) === "#E6E6E6" && !style.get("shape")) {
      const box = drawing.box(item);
      if (box.width <= 30 && box.height >= 2 * box.width) score += 1;
    } else if (item.edge && dashed(style) && item.source && lineDown(drawing.path(item))) {
      const source = drawing.cells.get(item.source);
      if (source?.vertex && drawing.label(source)) score += 3;
    }
  }
  return score;
}

export const sequenceDrawio: DrawioType = {
  kinds: ["sequence"],
  cells: exportCells,
  likeness,
  read: readSequence,
};
