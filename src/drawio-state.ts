/**
 * draw.io pages of state machine diagrams (stateDiagram-v2). A state is the State shape of the
 * TAMshapes libraries, a composite state the same shape grown into a grey container with its name in
 * a compartment at the top, and its concurrent regions are invisible containers parted by dashed
 * lines. The initial state is TAM-AD's Start of Activity, a final state its End of Activity (a white
 * ring around a black dot, grouped), a choice its Decision, fork and join bars its Fork or Join, a
 * transition its Arrow and a note TAM-Ann's Note, joined to its state by a dashed line.
 *
 * Reading a page back finds the parts by their picture, and by the `tam` role where it has one: what
 * stands inside a state's box belongs to that state, whether or not draw.io nests the cells. The
 * source it writes names `[*]` states as the parser does, so their places come back under the ids
 * the export gave them.
 */

import {
  type Cell,
  type Drawing,
  DrawioError,
  htmlToText,
  isOn,
  LAYER,
  shapeOf,
  type Style,
  textToHtml,
} from "./drawio-file.ts";
import type { DrawioType, Imported } from "./drawio.ts";
import {
  cell,
  dashed,
  edgeRoute,
  fillOf,
  FONT_SIZE,
  hasArrow,
  isDark,
  labelAt,
  readingOrder,
  pageTitle,
  roleOf,
  titleCell,
  TAMSHAPES,
  vertexGeometry,
  within,
} from "./drawio-shapes.ts";
import type { Box, Point, Scene, SceneShape } from "./scene.ts";
import { chainOf, sceneTree } from "./scene-tree.ts";
import { parseStateDiagram, type StateDiagram } from "./uml-state.ts";
import { STYLING } from "./uml.ts";

// ---------------------------------------------------------------------------------------------
// Roles

/** The roles this module writes; every one starts with `state`, which is what `likeness` looks for. */
const ROLE = {
  state: "state",
  composite: "state-composite",
  region: "state-region",
  initial: "state-initial",
  final: "state-final",
  ring: "state-final-ring",
  dot: "state-final-dot",
  choice: "state-choice",
  split: "state-choice-split",
  fork: "state-fork",
  join: "state-join",
  noteLeft: "state-note-left",
  noteRight: "state-note-right",
  noteLink: "state-note-link",
  transition: "state-transition",
  splitLink: "state-choice-link",
  description: "state-description",
  divider: "state-divider",
  separator: "state-separator",
} as const;

/** The size of the dot inside a final state's ring, as the TAMshapes End of Activity has it (16 in 30). */
const DOT = 16 / 30;

/** Room between a state's outline and its descriptions. */
const PAD = 12;

// ---------------------------------------------------------------------------------------------
// Export

/** Model text (`<br>` between lines) as a cell's HTML label. */
const html = (text: string) => textToHtml(text.replace(/<br\s*\/?>/gi, "\n"));

/** The box around a set of boxes. */
function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x)),
    y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

const centerOf = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** The choice a diamond that splits a crowded choice belongs to (`check#join1` belongs to `check`). */
const splitOwner = (id: string) => id.match(/^(.*)#(?:join|branch)\d+$/)?.[1];

/** The cells that draw a state machine diagram as the scene lays it out. */
function exportCells(source: string, scene: Scene): Cell[] {
  const diagram = parseStateDiagram(source);
  const tree = sceneTree(scene);
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  const notes = new Map(diagram.notes.map((note) => [note.id, note]));
  const cells: Cell[] = [];
  const parentOf = (id: string) => tree.parent.get(id);
  const boxOf = (id: string | undefined) => (id === undefined ? undefined : shapes.get(id)?.box);
  const texts = (owner: string, role: string) =>
    scene.texts.filter((text) => text.owner === owner && text.role === role);

  const vertex = (
    shape: SceneShape,
    fields: Partial<Cell>,
    style: Record<string, string | number | undefined>,
    role: string,
  ) => {
    const parent = parentOf(shape.id);
    cells.push(
      cell(
        {
          id: shape.id,
          parent: parent ?? LAYER,
          vertex: true,
          geometry: vertexGeometry(shape.box, boxOf(parent)),
          ...fields,
          style,
        },
        role,
      ),
    );
  };

  const drawState = (shape: SceneShape) => {
    const state = diagram.states.get(shape.id);
    const owner = splitOwner(shape.id);
    if (!state && owner) {
      vertex(shape, { value: "" }, { ...TAMSHAPES.decision }, ROLE.split);
      return;
    }
    if (!state) {
      const note = notes.get(shape.id);
      if (note)
        vertex(
          shape,
          { value: html(note.text) },
          { ...TAMSHAPES.note, fontSize: FONT_SIZE },
          note.side === "left" ? ROLE.noteLeft : ROLE.noteRight,
        );
      return;
    }
    switch (state.kind) {
      case "region":
        vertex(
          shape,
          { value: "", connectable: false },
          {
            rounded: 0,
            html: 1,
            fillColor: "none",
            strokeColor: "none",
            container: 1,
            collapsible: 0,
          },
          ROLE.region,
        );
        return;
      case "initial":
        vertex(shape, { value: "" }, { ...TAMSHAPES.initial }, ROLE.initial);
        return;
      case "final":
        drawFinal(shape);
        return;
      case "choice":
        vertex(shape, { value: "" }, { ...TAMSHAPES.decision }, ROLE.choice);
        return;
      case "fork":
      case "join":
        vertex(
          shape,
          { value: "" },
          { ...TAMSHAPES.bar },
          state.kind === "fork" ? ROLE.fork : ROLE.join,
        );
        return;
    }
    const composite = state.children.length > 0;
    const header = shape.dividers?.[0];
    const style: Record<string, string | number | undefined> = {
      ...TAMSHAPES.state,
      fillColor: fillOf(shape),
      fontSize: FONT_SIZE,
      ...(header !== undefined ? { verticalAlign: "top", spacingTop: 4 } : {}),
      ...(composite
        ? { container: 1, collapsible: 0, fontStyle: 1, absoluteArcSize: 1, arcSize: 24 }
        : {}),
    };
    vertex(shape, { value: html(state.label) }, style, composite ? ROLE.composite : ROLE.state);
    if (header === undefined) return;
    // The line under the name compartment, and the descriptions below it.
    cells.push(
      cell(
        {
          id: `${shape.id}#divider`,
          parent: shape.id,
          vertex: true,
          connectable: false,
          value: "",
          geometry: { x: 0, y: header - shape.box.y - 5, width: shape.box.width, height: 10 },
          style: { line: "", strokeWidth: 1, html: 1, editable: 0, movable: 0, resizable: 0 },
        },
        ROLE.divider,
      ),
    );
    if (state.descriptions.length) {
      const lines = texts(shape.id, "member");
      const top = lines.length ? Math.min(...lines.map((text) => text.box.y)) - 2 : header + 4;
      cells.push(
        cell(
          {
            id: `${shape.id}#description`,
            parent: shape.id,
            vertex: true,
            connectable: false,
            value: state.descriptions.map(html).join("<br>"),
            geometry: {
              x: PAD - 4,
              y: top - shape.box.y,
              width: shape.box.width - 2 * (PAD - 4),
              height: shape.box.y + shape.box.height - top - 2,
            },
            style: {
              ...TAMSHAPES.text,
              align: "left",
              verticalAlign: "top",
              spacing: 0,
              fontSize: FONT_SIZE,
            },
          },
          ROLE.description,
        ),
      );
    }
  };

  const drawFinal = (shape: SceneShape) => {
    vertex(
      shape,
      { value: "", connectable: true },
      { group: "", aspect: "fixed", rotatable: 0, resizable: 0 },
      ROLE.final,
    );
    const { width, height } = shape.box;
    cells.push(
      cell(
        {
          id: `${shape.id}#ring`,
          parent: shape.id,
          vertex: true,
          value: "",
          geometry: { x: 0, y: 0, width, height },
          style: { ...TAMSHAPES.initial, fillColor: "#FFFFFF", editable: 0 },
        },
        ROLE.ring,
      ),
      cell(
        {
          id: `${shape.id}#dot`,
          parent: shape.id,
          vertex: true,
          value: "",
          geometry: {
            x: (width * (1 - DOT)) / 2,
            y: (height * (1 - DOT)) / 2,
            width: width * DOT,
            height: height * DOT,
          },
          style: { ...TAMSHAPES.initial, editable: 0 },
        },
        ROLE.dot,
      ),
    );
  };

  // Shapes outside in: a container before what it holds, so draw.io draws them in that order.
  const depth = (id: string) => chainOf(tree, id).length;
  const order = scene.shapes.toSorted((a, b) => depth(a.id) - depth(b.id));
  for (const shape of order) drawState(shape);

  // The dashed lines between concurrent regions, in the composite state they part.
  scene.lines
    .filter((line) => line.dashed && line.points.length === 2)
    .forEach((line, index) => {
      const middle = centerOf(union(line.points.map((p) => ({ ...p, width: 0, height: 0 }))));
      const holder = scene.shapes
        .filter(
          (shape) =>
            shape.container &&
            shape.kind !== "region" &&
            within({ ...middle, width: 0, height: 0 }, shape.box, 0.5),
        )
        .toSorted((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
      const parent = holder?.box;
      const shift = (p: Point) => ({ x: p.x - (parent?.x ?? 0), y: p.y - (parent?.y ?? 0) });
      cells.push(
        cell(
          {
            id: `separator${index + 1}`,
            parent: holder?.id ?? LAYER,
            edge: true,
            geometry: {
              x: 0,
              y: 0,
              width: 0,
              height: 0,
              relative: true,
              sourcePoint: shift(line.points[0]),
              targetPoint: shift(line.points[1]),
            },
            style: { endArrow: "none", startArrow: "none", dashed: 1, html: 1, strokeWidth: 1 },
          },
          ROLE.separator,
        ),
      );
    });

  // Transitions, the links between split choices, and the dashed lines from notes to their states.
  const common = (a: string, b: string) => {
    const outer = new Set(chainOf(tree, b).slice(1));
    return chainOf(tree, a)
      .slice(1)
      .find((id) => outer.has(id));
  };
  const transitions = new Map(diagram.transitions.map((transition) => [transition.id, transition]));
  for (const wire of scene.wires) {
    if (wire.points.length < 2) continue;
    const note = wire.edge.endsWith(":link") ? notes.get(wire.edge.slice(0, -5)) : undefined;
    const transition = transitions.get(wire.edge);
    const from = wire.from ?? transition?.source ?? note?.id,
      to = wire.to ?? transition?.target ?? note?.target;
    if (!from || !to || !shapes.has(from) || !shapes.has(to)) continue;
    const parent = common(from, to);
    const route = edgeRoute(wire.points, boxOf(from), boxOf(to), boxOf(parent));
    const fields = { id: wire.edge, parent: parent ?? LAYER, edge: true, source: from, target: to };
    if (note) {
      cells.push(
        cell(
          {
            ...fields,
            geometry: route.geometry,
            style: { ...route.style, endArrow: "none", startArrow: "none", dashed: 1, html: 1 },
          },
          ROLE.noteLink,
        ),
      );
      continue;
    }
    const labels = texts(wire.edge, "label");
    const label = transition?.label;
    const geometry =
      label && labels.length
        ? labelAt(route.geometry, wire.points, centerOf(union(labels.map((text) => text.box))))
        : route.geometry;
    cells.push(
      cell(
        {
          ...fields,
          value: label ? html(label) : "",
          geometry,
          style: {
            ...TAMSHAPES.connection,
            ...route.style,
            endArrow: "classic",
            endFill: 1,
            fontSize: FONT_SIZE,
          },
        },
        transition ? ROLE.transition : ROLE.splitLink,
      ),
    );
  }
  const title = titleCell(scene);
  if (title) cells.push(title);
  return cells;
}

// ---------------------------------------------------------------------------------------------
// Import: the parts of a page

type Kind =
  | "state"
  | "initial"
  | "final"
  | "choice"
  | "split"
  | "fork"
  | "join"
  | "bar"
  | "note"
  | "region"
  | "description"
  | "text"
  | "line"
  | "dot"
  | "ring"
  | "ignore";

/** A part of the page as the import reads it. */
interface Part {
  cell: Cell;
  kind: Kind;
  box: Box;
  label: string;
  descriptions: string[];
  /** States: whether the label is the name already, parted by a rule in it or written by us. */
  parted?: boolean;
  /** The composite state around the part, and the region of it the part stands in. */
  parent?: Part;
  region?: number;
  members: Part[];
  /** Notes: the side the role gives. */
  side?: "left" | "right";
  /** Composite states with regions from our export: the number of the first (`Active#region3`). */
  regionStart?: number;
  /** The id in the written source. */
  id?: string;
}

interface Transition {
  cell: Cell;
  source: Part;
  target: Part;
  label: string;
}

const ROLE_KINDS: Record<string, Kind> = {
  [ROLE.state]: "state",
  [ROLE.composite]: "state",
  [ROLE.region]: "region",
  [ROLE.initial]: "initial",
  [ROLE.final]: "final",
  [ROLE.ring]: "ignore",
  [ROLE.dot]: "ignore",
  [ROLE.choice]: "choice",
  [ROLE.split]: "split",
  [ROLE.fork]: "fork",
  [ROLE.join]: "join",
  [ROLE.noteLeft]: "note",
  [ROLE.noteRight]: "note",
  [ROLE.description]: "description",
  [ROLE.divider]: "ignore",
  title: "ignore",
};

const area = (box: Box) => box.width * box.height;
const pointBox = (point: Point): Box => ({ ...point, width: 0, height: 0 });

/** Whether a vertex draws nothing: no outline and no fill. */
const invisible = (style: Style) =>
  style.get("strokeColor") === "none" && (style.get("fillColor") ?? "none") === "none";

/**
 * Whether a vertex is filled solid: black or nearly, or in its outline's color as draw.io's UML 2.5
 * palette fills its initial state and its fork and join bars (`fillColor=strokeColor`).
 */
const filled = (style: Style) =>
  isDark(style) ||
  (style.get("fillColor") === "strokeColor" && style.get("strokeColor") !== "none");

/** Whether a line shape is drawn upright: turned a quarter, or pointing north or south. */
function upright(style: Style): boolean {
  const turn = Math.abs(Number(style.get("rotation") ?? 0)) % 180;
  const direction = style.get("direction");
  return (turn > 45 && turn < 135) !== (direction === "north" || direction === "south");
}

/**
 * The box a fork or join bar draws. A bar of the line shape (the tam-drawio plugin's Fork or Join,
 * draw.io's older UML palette) draws a thick line through the middle of its box, across or upright.
 */
function barBox(style: Style, box: Box): Box {
  const turned = Math.abs(Number(style.get("rotation") ?? 0)) % 180;
  const quarter = turned > 45 && turned < 135;
  const middle = centerOf(box);
  // The box as the page shows it, turned a quarter around its middle.
  const shown = quarter
    ? {
        x: middle.x - box.height / 2,
        y: middle.y - box.width / 2,
        width: box.height,
        height: box.width,
      }
    : box;
  if (shapeOf(style) !== "line") return shown;
  const thickness = Math.max(1, Number(style.get("strokeWidth") ?? 1));
  return upright(style)
    ? { x: middle.x - thickness / 2, y: shown.y, width: thickness, height: shown.height }
    : { x: shown.x, y: middle.y - thickness / 2, width: shown.width, height: thickness };
}

/** What a vertex is by its picture alone. */
function kindByPicture(drawing: Drawing, vertex: Cell): Kind {
  const style = drawing.style(vertex),
    shape = shapeOf(style);
  if (shape === "group") {
    const inner = drawing
      .children(vertex.id)
      .filter((child) => shapeOf(drawing.style(child)) === "ellipse");
    const dark = inner.some((child) => isDark(drawing.style(child))),
      light = inner.some((child) => !isDark(drawing.style(child)));
    return dark && light ? "final" : "ignore";
  }
  if (shape === "startState") return "initial";
  // The End of Activity of the tam-drawio plugin is a shape of its own.
  if (shape === "endState" || shape === "endactivity") return "final";
  if (shape === "ellipse" || shape === "doubleEllipse") {
    if (drawing.label(vertex)) return "state";
    return filled(style) ? "dot" : "ring";
  }
  if (shape === "rhombus") return "choice";
  if (shape === "note" || shape === "note2") return "note";
  // A thick line is a fork or join bar; a thin one a line (dashed, it parts regions).
  if (shape === "line")
    return Number(style.get("strokeWidth") ?? 1) >= 4 && !drawing.label(vertex) ? "bar" : "line";
  if (shape === "text" || shape === "edgeLabel" || invisible(style)) return "text";
  if (filled(style)) return "bar";
  return "state";
}

/** The kind a role names, or the picture's when the cell has no role of this module. */
function kindOf(drawing: Drawing, vertex: Cell): Kind {
  const role = roleOf(drawing, vertex);
  return role !== undefined && role in ROLE_KINDS
    ? ROLE_KINDS[role]
    : kindByPicture(drawing, vertex);
}

/**
 * The text of a state's label; a horizontal rule in an HTML label (draw.io's Insert Horizontal Rule
 * writes `<hr>`) parts the name from the descriptions.
 */
function nameAndDescriptions(
  drawing: Drawing,
  vertex: Cell,
): { label: string; descriptions: string[]; parted?: boolean } {
  const value = vertex.value ?? "";
  const rule = drawing.style(vertex).get("html") === "1" ? value.search(/<hr\b[^>]*>/i) : -1;
  if (rule < 0) return { label: drawing.label(vertex), descriptions: [] };
  const rest = value.slice(rule).replace(/^<hr\b[^>]*>/i, "");
  return {
    label: htmlToText(value.slice(0, rule)),
    descriptions: htmlToText(rest).split("\n").filter(Boolean),
    parted: true,
  };
}

/**
 * A line of a state that is behavior rather than name: `entry /`, `do /` or `exit /`, or an
 * internal transition with its action after a slash set apart by spaces (`tick [on] / count`). A
 * slash inside a word, as in `and/or`, is part of a name.
 */
const BEHAVIOR = /^(entry|do|exit)\s*\/|\S\s+\/(\s|$)/i;

/**
 * The name and descriptions of a state's text when nothing draws a line between them: the lines up
 * to the first line of behavior are the name, so a name may take two lines; that line and the rest
 * are descriptions. The first line is always the name.
 */
function partByBehavior(lines: string[]): { label: string; descriptions: string[] } {
  const first = lines.findIndex((line, index) => index > 0 && BEHAVIOR.test(line));
  const end = first < 0 ? lines.length : first;
  return { label: lines.slice(0, end).join("\n"), descriptions: lines.slice(end) };
}

/** The line height draw.io gives a label, as a share of its font size (mxConstants.LINE_HEIGHT). */
const LINE_HEIGHT = 1.2;

/**
 * How many lines of a vertex's label stand above a height on the page, from where draw.io sets the
 * label: at the top, the middle or the bottom of the box, with its spacing, a line a font size and
 * a fifth high.
 */
function linesAbove(style: Style, box: Box, count: number, y: number): number {
  const number = (key: string, fallback: number) => Number(style.get(key) ?? fallback) || 0;
  const line = number("fontSize", 12) * LINE_HEIGHT,
    spacing = number("spacing", 2),
    top = number("spacingTop", 0),
    bottom = number("spacingBottom", 0);
  const height = count * line;
  const align = style.get("verticalAlign") ?? "middle";
  const start =
    align === "top"
      ? box.y + spacing + top
      : align === "bottom"
        ? box.y + box.height - spacing - bottom - height
        : box.y + (box.height - height) / 2 + (top - bottom) / 2;
  let above = 0;
  while (above < count && start + (above + 0.5) * line < y) above++;
  return above;
}

/** Everything the import reads off a page. */
class PageReader {
  readonly parts: Part[] = [];
  readonly transitions: Transition[] = [];
  readonly warnings: string[] = [];
  /** The part each cell stands for, the cells of a final state's group included. */
  private readonly byCell = new Map<string, Part>();
  private readonly separators: { points: Point[]; role: boolean }[] = [];
  /** Solid lines drawn across, which may part a state's name from its descriptions. */
  private readonly rules: Box[] = [];
  private readonly links: { note: Part; target: Part }[] = [];

  readonly drawing: Drawing;

  constructor(drawing: Drawing) {
    this.drawing = drawing;
    this.readVertices();
    this.findFinals();
    this.nest();
    this.readEdges();
    this.nameStates();
    this.attachDescriptions();
    this.splitRegions();
    this.attachNotes();
    this.settleBars();
  }

  private named = (cell: Cell) => {
    const text = this.drawing.label(cell).replace(/\s+/g, " ");
    return text ? `“${text.length > 40 ? `${text.slice(0, 39)}…` : text}”` : `\`${cell.id}\``;
  };

  /** A part as a warning names it: its label, else what it is. */
  private describe(part: Part): string {
    if (part.label) return this.named(part.cell);
    const WORDS: Partial<Record<Kind, string>> = {
      initial: "an initial state",
      final: "a final state",
      choice: "a choice",
      split: "a choice",
      bar: "a fork or join bar",
      fork: "a fork",
      join: "a join",
    };
    return WORDS[part.kind] ?? this.named(part.cell);
  }

  private add(cell: Cell, kind: Kind): Part {
    const { label, descriptions, parted } =
      kind === "state"
        ? nameAndDescriptions(this.drawing, cell)
        : { label: this.drawing.label(cell), descriptions: [], parted: undefined };
    const box = this.drawing.box(cell);
    const part: Part = {
      cell,
      kind,
      box: ["bar", "fork", "join"].includes(kind) ? barBox(this.drawing.style(cell), box) : box,
      label,
      descriptions,
      members: [],
    };
    const role = roleOf(this.drawing, cell);
    // The label of a state this module wrote is its name, its descriptions a text of their own.
    part.parted = parted || role === ROLE.state || role === ROLE.composite;
    if (role === ROLE.noteLeft) part.side = "left";
    if (role === ROLE.noteRight) part.side = "right";
    this.parts.push(part);
    this.byCell.set(cell.id, part);
    return part;
  }

  private readVertices() {
    const { drawing } = this;
    for (const vertex of drawing.parts) {
      if (!vertex.vertex) continue;
      const holder = drawing.parentOf(vertex);
      // Labels on edges are read with their edge; the cells of a final state with it.
      if (holder?.edge) continue;
      if (holder && this.byCell.get(holder.id)?.kind === "final") continue;
      const kind = kindOf(drawing, vertex);
      if (kind === "ignore") continue;
      if (kind === "line") {
        const box = drawing.box(vertex);
        if (!dashed(drawing.style(vertex)) && !upright(drawing.style(vertex)))
          this.rules.push({ ...box, y: box.y + box.height / 2, height: 0 });
        if (dashed(drawing.style(vertex))) {
          const middle = box.y + box.height / 2;
          this.separators.push({
            points:
              box.width >= box.height
                ? [
                    { x: box.x, y: middle },
                    { x: box.x + box.width, y: middle },
                  ]
                : [
                    { x: box.x + box.width / 2, y: box.y },
                    { x: box.x + box.width / 2, y: box.y + box.height },
                  ],
            role: false,
          });
        }
        continue;
      }
      this.add(vertex, kind);
    }
  }

  /** A white ring with a black dot in it is a final state, a black dot alone the initial state. */
  private findFinals() {
    const rings = this.parts.filter((part) => part.kind === "ring");
    for (const dot of this.parts.filter((part) => part.kind === "dot")) {
      const ring = rings.find((item) => within(dot.box, item.box));
      if (ring) {
        ring.kind = "final";
        dot.kind = "ignore";
        this.byCell.set(dot.cell.id, ring);
      } else dot.kind = "initial";
    }
    for (const ring of rings.filter((part) => part.kind === "ring")) {
      this.warnings.push(
        `The empty circle ${this.named(ring.cell)} is neither an initial nor a final state and is not read.`,
      );
      ring.kind = "ignore";
    }
    // The cells inside a final state's group stand for it.
    for (const final of this.parts.filter((part) => part.kind === "final"))
      for (const inner of this.drawing.descendants(final.cell.id)) this.byCell.set(inner.id, final);
    this.parts.splice(0, this.parts.length, ...this.parts.filter((part) => part.kind !== "ignore"));
  }

  /** States, pseudostates and regions stand in the smallest state whose box holds them. */
  private nest() {
    const holders = this.parts
      .filter((part) => part.kind === "state")
      .toSorted((a, b) => area(a.box) - area(b.box));
    for (const part of this.parts) {
      if (part.kind === "note" || part.kind === "text" || part.kind === "description") continue;
      const holder = holders.find(
        (item) => item !== part && area(item.box) > area(part.box) && within(part.box, item.box),
      );
      if (!holder) continue;
      part.parent = holder;
      if (part.kind !== "region") holder.members.push(part);
    }
  }

  /** The part a cell stands for: itself, or the group or final state it is drawn in. */
  private partOf(id: string | undefined): Part | undefined {
    for (let at = id ? this.drawing.cells.get(id) : undefined; at; at = this.drawing.parentOf(at)) {
      const part = this.byCell.get(at.id);
      if (part) return part;
    }
    return undefined;
  }

  /**
   * The part at an edge's loose end: the smallest whose box holds the point. An end dropped a little
   * short of a state, outside it or inside the composite state around it, goes to that state, and
   * `near` says so; an end on a composite state's outline stays there.
   */
  private partAt(point: Point | undefined): { part?: Part; near?: boolean } {
    if (!point) return {};
    // An end dropped on a note is the note's: its line joins the note to a state.
    const note = this.parts.find(
      (part) => part.kind === "note" && within(pointBox(point), part.box, 6),
    );
    if (note) return { part: note };
    const candidates = this.parts.filter(
      (part) => !["note", "text", "description", "region"].includes(part.kind),
    );
    const holder = candidates
      .filter((part) => within(pointBox(point), part.box, 6))
      .toSorted((a, b) => area(a.box) - area(b.box))[0];
    if (holder && (!holder.members.length || outlineGap(point, holder.box) <= 6))
      return { part: holder };
    const nearest = candidates
      .filter((part) => !part.members.length && part !== holder)
      .map((part) => ({ part, distance: gap(pointBox(point), part.box) }))
      .filter(({ distance }) => distance <= 20)
      .toSorted((a, b) => a.distance - b.distance)[0];
    return nearest ? { part: nearest.part, near: true } : { part: holder };
  }

  private readEdges() {
    const { drawing } = this;
    for (const edge of drawing.parts) {
      if (!edge.edge) continue;
      const style = drawing.style(edge),
        role = roleOf(drawing, edge);
      if (role === ROLE.splitLink) continue;
      const path = drawing.path(edge);
      const loose = (id: string | undefined, point: Point | undefined) =>
        id ? { part: this.partOf(id) } : this.partAt(point);
      const start = loose(edge.source, path[0]),
        finish = loose(edge.target, path.at(-1));
      const source = start.part,
        target = finish.part;
      const label = [
        drawing.label(edge),
        ...drawing
          .children(edge.id)
          .filter((child) => child.vertex)
          .map((child) => drawing.label(child)),
      ]
        .filter(Boolean)
        .join("\n");
      // A line from a note, dashed or not, joins it to the state at its other end.
      const note = source?.kind === "note" ? source : target?.kind === "note" ? target : undefined;
      if (note || role === ROLE.noteLink) {
        const other = note === source ? target : source;
        if (note && other && other.kind !== "note") this.links.push({ note, target: other });
        continue;
      }
      const drawn = !edge.source && !edge.target && !label && path.length >= 2;
      if (role === ROLE.separator || (dashed(style) && drawn)) {
        if (path.length >= 2)
          this.separators.push({ points: [path[0], path.at(-1)!], role: role === ROLE.separator });
        continue;
      }
      // A plain line drawn across a state, from side to side, is a rule in it.
      const [first, last] = [path[0], path.at(-1)!];
      if (
        drawn &&
        !hasArrow(style, "start") &&
        !hasArrow(style, "end") &&
        Math.abs(first.y - last.y) < Math.abs(first.x - last.x) / 10 &&
        this.parts.some(
          (part) =>
            part.kind === "state" &&
            within(pointBox(first), part.box, 6) &&
            within(pointBox(last), part.box, 6),
        )
      ) {
        this.rules.push({
          x: Math.min(first.x, last.x),
          y: (first.y + last.y) / 2,
          width: Math.abs(first.x - last.x),
          height: 0,
        });
        continue;
      }
      if (!source || !target) {
        this.warnings.push(
          `The connection ${label ? `“${label.replace(/\s+/g, " ")}”` : `\`${edge.id}\``} is not attached to a state at ${!source ? "its start" : "its end"} and is not read.`,
        );
        continue;
      }
      for (const [end, part] of [
        [start, source],
        [finish, target],
      ] as const)
        if (end.near)
          this.warnings.push(
            `The connection ${label ? `“${label.replace(/\s+/g, " ")}”` : `\`${edge.id}\``} ends short of ${this.describe(part)} and is read as joined to it.`,
          );
      const backward = !hasArrow(style, "end") && hasArrow(style, "start");
      this.transitions.push({
        cell: edge,
        source: backward ? target : source,
        target: backward ? source : target,
        label,
      });
    }
    // A transition to or from a diamond that splits a crowded choice is one of that choice.
    const owners = new Map<Part, Part>();
    for (const split of this.parts.filter((part) => part.kind === "split")) {
      const base = splitOwner(split.cell.id);
      const owner = base === undefined ? undefined : this.byCell.get(base);
      if (owner && owner.kind === "choice") owners.set(split, owner);
      else split.kind = "choice";
    }
    for (const transition of this.transitions) {
      transition.source = owners.get(transition.source) ?? transition.source;
      transition.target = owners.get(transition.target) ?? transition.target;
    }
    for (const link of this.links) link.target = owners.get(link.target) ?? link.target;
  }

  /** The topmost rule drawn across most of a box, below its top. */
  private ruleIn(box: Box): Box | undefined {
    return this.rules
      .filter(
        (rule) =>
          rule.y > box.y + 2 &&
          rule.y < box.y + box.height - 2 &&
          Math.min(rule.x + rule.width, box.x + box.width) - Math.max(rule.x, box.x) >=
            box.width / 2,
      )
      .toSorted((a, b) => a.y - b.y)[0];
  }

  /**
   * The name of each state, and the descriptions typed into its label below it. A swimlane's label
   * is its header, a name all of it; in another state the lines above a rule drawn across it are the
   * name, and without a rule the lines up to the first line of behavior (`entry / …`).
   */
  private nameStates() {
    for (const state of this.parts.filter((part) => part.kind === "state" && !part.parted)) {
      const style = this.drawing.style(state.cell);
      const lines = state.label.split("\n");
      if (lines.length < 2 || shapeOf(style) === "swimlane") continue;
      const rule = this.ruleIn(state.box);
      const above = rule ? linesAbove(style, state.box, lines.length, rule.y) : 0;
      const { label, descriptions } =
        above > 0
          ? { label: lines.slice(0, above).join("\n"), descriptions: lines.slice(above) }
          : partByBehavior(lines);
      state.label = label;
      state.descriptions = descriptions.filter(Boolean);
    }
    for (const state of this.parts.filter(
      (part) => part.kind === "state" && part.members.length && part.descriptions.length,
    ))
      this.warnings.push(
        `The text below the name of ${this.named(state.cell)} is not read: a composite state has a name only.`,
      );
  }

  /**
   * Text in a state that holds no other states is its descriptions, top to bottom; in a state
   * without a label the topmost text gives its name, all of it when a rule stands below it. Text
   * elsewhere beside a transition is its label, as users type a label into a text of its own; other
   * text is not read.
   */
  private attachDescriptions() {
    const states = this.parts
      .filter((part) => part.kind === "state")
      .toSorted((a, b) => area(a.box) - area(b.box));
    const unlabeled = new Set(this.transitions.filter((item) => !item.label));
    const inside = new Map<Part, { box: Box; lines: string[] }[]>();
    for (const text of this.parts.filter(
      (part) => part.kind === "text" || part.kind === "description",
    )) {
      const lines = text.label.split("\n").filter(Boolean);
      const holder = states.find((state) => within(pointBox(centerOf(text.box)), state.box, 0));
      const beside =
        text.kind === "text" && lines.length && !(holder && !holder.members.length)
          ? this.transitionBeside(text.box, unlabeled)
          : undefined;
      if (beside) {
        beside.label = beside.label ? `${beside.label} ${lines.join(" ")}` : lines.join("\n");
        unlabeled.delete(beside);
      } else if (holder && !holder.members.length) {
        if (lines.length)
          inside.set(holder, [...(inside.get(holder) ?? []), { box: text.box, lines }]);
      } else if (lines.length)
        this.warnings.push(
          `The text ${this.named(text.cell)} belongs to no state and is not read.`,
        );
      text.kind = "ignore";
    }
    for (const [state, texts] of inside) {
      texts.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
      if (!state.label) {
        const { box, lines } = texts.shift()!;
        const rule = this.ruleIn(state.box);
        const { label, descriptions } =
          rule && centerOf(box).y < rule.y
            ? { label: lines.join("\n"), descriptions: [] }
            : partByBehavior(lines);
        state.label = label;
        state.descriptions.push(...descriptions);
      }
      for (const { lines } of texts) state.descriptions.push(...lines);
    }
    this.parts.splice(0, this.parts.length, ...this.parts.filter((part) => part.kind !== "ignore"));
  }

  /**
   * The transition a text stands beside, within a little more than a line's height of its path; an
   * unlabeled one before one with a label. draw.io routes many edges at right angles, so the path
   * between two points may run either way round the corner.
   */
  private transitionBeside(box: Box, unlabeled: Set<Transition>): Transition | undefined {
    const REACH = 24;
    const near = this.transitions
      .map((transition) => ({
        transition,
        distance: pathGap(box, this.drawing.path(transition.cell)),
      }))
      .filter(({ distance }) => distance <= REACH)
      .toSorted(
        (a, b) =>
          Number(!unlabeled.has(a.transition)) - Number(!unlabeled.has(b.transition)) ||
          a.distance - b.distance,
      );
    return near[0]?.transition;
  }

  /**
   * The concurrent regions of each composite state: the region cells in it, or else the dashed
   * lines across it. Every part in the state goes to the region its middle lies in.
   */
  private splitRegions() {
    const regions = this.parts.filter((part) => part.kind === "region");
    for (const composite of this.parts.filter(
      (part) => part.kind === "state" && part.members.length,
    )) {
      let boxes = regions
        .filter((region) => region.parent === composite)
        .toSorted(
          (a, b) => regionNumber(a) - regionNumber(b) || a.box.x - b.box.x + (a.box.y - b.box.y),
        );
      if (boxes.length < 2) boxes = this.cutRegions(composite);
      if (boxes.length < 2) continue;
      composite.regionStart = regionNumber(boxes[0]) || undefined;
      const used = new Set<number>();
      for (const member of composite.members) {
        const middle = centerOf(member.box);
        const distance = (box: Box) =>
          Math.hypot(
            Math.max(box.x - middle.x, 0, middle.x - box.x - box.width),
            Math.max(box.y - middle.y, 0, middle.y - box.y - box.height),
          );
        let best = 0;
        boxes.forEach((region, index) => {
          if (distance(region.box) < distance(boxes[best].box)) best = index;
        });
        member.region = best;
        used.add(best);
      }
      // Regions that hold nothing are dropped, and the rest numbered without gaps.
      const kept = [...used].toSorted((a, b) => a - b);
      for (const member of composite.members)
        member.region = kept.length > 1 ? kept.indexOf(member.region!) : undefined;
    }
    this.parts.splice(0, this.parts.length, ...this.parts.filter((part) => part.kind !== "region"));
  }

  /** Regions of a composite state from the dashed lines across it. */
  private cutRegions(composite: Part): Part[] {
    const box = composite.box;
    const holder = (point: Point) =>
      this.parts
        .filter((part) => part.kind === "state" && within(pointBox(point), part.box, 0.5))
        .toSorted((a, b) => area(a.box) - area(b.box))[0];
    const xs: number[] = [],
      ys: number[] = [];
    for (const { points } of this.separators) {
      const [a, b] = points;
      if (holder(centerOf(union([pointBox(a), pointBox(b)]))) !== composite) continue;
      const vertical = Math.abs(a.x - b.x) < Math.abs(a.y - b.y) / 10,
        horizontal = Math.abs(a.y - b.y) < Math.abs(a.x - b.x) / 10;
      if (vertical && Math.abs(a.y - b.y) >= box.height / 3) xs.push((a.x + b.x) / 2);
      else if (horizontal && Math.abs(a.x - b.x) >= box.width / 3) ys.push((a.y + b.y) / 2);
    }
    const cuts = xs.length >= ys.length ? xs : ys;
    if (!cuts.length) return [];
    const along = xs.length >= ys.length ? "x" : "y",
      size = along === "x" ? "width" : "height";
    const edges = [box[along], ...cuts.toSorted((a, b) => a - b), box[along] + box[size]];
    return edges.slice(1).map((end, index) => ({
      cell: composite.cell,
      kind: "region" as Kind,
      box: { ...box, [along]: edges[index], [size]: end - edges[index] },
      label: "",
      descriptions: [],
      members: [],
    }));
  }

  /**
   * Each note goes to the state its line joins it to, dashed or not, whatever stands nearer; only a
   * note without a line goes to the nearest state.
   */
  private attachNotes() {
    this.noteTargets = new Map();
    const named = this.parts.filter((part) =>
      ["state", "choice", "fork", "join", "bar"].includes(part.kind),
    );
    for (const note of this.parts.filter((part) => part.kind === "note")) {
      let target = this.links.find((link) => link.note === note)?.target;
      if (target && !named.includes(target)) target = undefined;
      target ??= named.toSorted((a, b) => gap(note.box, a.box) - gap(note.box, b.box))[0];
      if (!target) {
        this.warnings.push(`The note ${this.named(note.cell)} stands by no state and is not read.`);
        continue;
      }
      this.noteTargets.set(note, target);
    }
  }

  noteTargets = new Map<Part, Part>();

  /** A bar that more transitions leave than enter is a fork, any other a join. */
  private settleBars() {
    for (const bar of this.parts.filter((part) => part.kind === "bar")) {
      const into = this.transitions.filter((item) => item.target === bar).length,
        out = this.transitions.filter((item) => item.source === bar).length;
      bar.kind = out > into ? "fork" : "join";
    }
  }
}

/** The number in a region's id from our export (`Active#region2`), for their order. */
const regionNumber = (part: Part) => Number(part.cell.id.match(/#region(\d+)$/)?.[1] ?? 0);

/** The number in a final state's id from our export (`root#final3`), for their order. */
const finalNumber = (part: Part) => Number(part.cell.id.match(/#final(\d+)$/)?.[1] ?? Infinity);

/** The distance from a point inside a box to the box's outline. */
const outlineGap = (point: Point, box: Box) =>
  Math.min(
    Math.abs(point.x - box.x),
    Math.abs(box.x + box.width - point.x),
    Math.abs(point.y - box.y),
    Math.abs(box.y + box.height - point.y),
  );

/** The distance from a box to a line between two points, 0 when the line crosses it. */
function segmentGap(box: Box, a: Point, b: Point): number {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
  let best = Infinity;
  for (let i = 0; i <= steps; i++) {
    const point = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    best = Math.min(best, gap(pointBox(point), box));
  }
  return best;
}

/** The distance from a box to an edge's path, taking each leg straight or round either corner. */
function pathGap(box: Box, path: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    const straight = segmentGap(box, a, b);
    const across = Math.min(
      segmentGap(box, a, { x: b.x, y: a.y }),
      segmentGap(box, { x: b.x, y: a.y }, b),
    );
    const down = Math.min(
      segmentGap(box, a, { x: a.x, y: b.y }),
      segmentGap(box, { x: a.x, y: b.y }, b),
    );
    best = Math.min(best, straight, across, down);
  }
  return best;
}

/** The distance between two boxes, 0 when they overlap. */
function gap(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
    dy = Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height);
  return Math.hypot(dx, dy);
}

// ---------------------------------------------------------------------------------------------
// Import: the source

/** Words a state id may not be alone on its line, as the parser reads them as keywords. */
const KEYWORDS = /^(state|note|end|direction|hide|scale|accTitle|accDescr)$/i;

/** An id the parser takes for a state, and that this module writes. */
const STATE_ID = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/**
 * Text as a name, a transition's label or a note holds it: line breaks as `<br>`, and as entities
 * what the parser would read as markup. A name stands in quotes, so its quotes are entities too.
 */
function escapeText(label: string, quoted: boolean): string {
  const text = label
    .trim()
    .replace(/[#&](?=\w+;)/g, (mark) => (mark === "#" ? "#35;" : "#amp;"))
    .replace(/<(?=\/?[a-z])(?!br\s*\/?>)/gi, "#lt;")
    .replace(/\\n/g, "#92;n")
    .replace(/\s*\n\s*/g, "<br>");
  return quoted || /^".*"$/.test(text) ? text.replace(/"/g, "#quot;") : text;
}

/** Ids for the named states of a page: the cell's id when it can be one, else one made from the label. */
class StateIds {
  private readonly taken = new Set<string>();
  of(cellId: string, label: string, fallback: string): string {
    const free = (id: string) =>
      STATE_ID.test(id) && !KEYWORDS.test(id) && !STYLING.test(id) && !this.taken.has(id);
    let id = cellId;
    if (!free(id)) {
      const made = label
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}_]+/gu, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
      id = made && /^[\p{L}_]/u.test(made) ? made : made ? `${fallback}_${made}` : fallback;
      if (!free(id)) {
        let index = 1;
        while (!free(`${id}${index}`)) index++;
        id = `${id}${index}`;
      }
    }
    this.taken.add(id);
    return id;
  }
}

/** The way the layout runs, read from where the transitions lead: most go that way. */
function directionOf(reader: PageReader): "TB" | "BT" | "LR" | "RL" {
  const votes = { TB: 0, BT: 0, LR: 0, RL: 0 };
  for (const { source, target } of reader.transitions) {
    if (source === target) continue;
    if (within(source.box, target.box) || within(target.box, source.box)) continue;
    const a = centerOf(source.box),
      b = centerOf(target.box),
      dx = b.x - a.x,
      dy = b.y - a.y;
    if (Math.abs(dx) > Math.abs(dy)) votes[dx > 0 ? "LR" : "RL"]++;
    else votes[dy > 0 ? "TB" : "BT"]++;
  }
  const bars = reader.parts.filter((part) => part.kind === "fork" || part.kind === "join");
  const across = bars.length
    ? bars.every((bar) => bar.box.height > bar.box.width)
      ? "horizontal"
      : "vertical"
    : undefined;
  const keys = (
    across === "horizontal"
      ? ["LR", "RL"]
      : across === "vertical"
        ? ["TB", "BT"]
        : ["TB", "LR", "BT", "RL"]
  ) as (keyof typeof votes)[];
  return keys.reduce((best, key) => (votes[key] > votes[best] ? key : best), keys[0]);
}

/** A scope of `[*]`: the whole machine, a composite state, or one of its regions. */
interface Scope {
  composite?: Part;
  region?: number;
}

/** The source of a page, with the lines that write `[*]` and the parts they stand for. */
class SourceWriter {
  readonly lines: string[] = [];
  /** The line (1-based) of each `[*]` transition, and the initial or final state it names. */
  readonly starred = new Map<number, Part>();
  /** The notes in the order they are written: the parser numbers them so. */
  notes: Part[] = [];
  private readonly ids = new StateIds();

  private readonly reader: PageReader;

  constructor(reader: PageReader) {
    this.reader = reader;
  }

  write(title: string | undefined): string {
    const { reader } = this;
    const order = readingOrder(reader.parts, (part) => part.box);
    for (const part of order)
      if (["state", "choice", "fork", "join"].includes(part.kind))
        part.id = this.ids.of(
          part.cell.id,
          part.label,
          part.kind === "state" ? "state" : part.kind,
        );
    if (title) this.lines.push("---", `title: ${title.replace(/\s+/g, " ")}`, "---");
    this.lines.push("stateDiagram-v2");
    const direction = directionOf(reader);
    if (direction !== "TB") this.lines.push(`  direction ${direction}`);
    this.scope({}, order, 1);
    for (const transition of this.ordered(reader.transitions))
      if (transition.source.id && transition.target.id) this.transition(transition, 1);
    this.notes = order
      .filter((part) => reader.noteTargets.has(part))
      .toSorted((a, b) => noteNumber(a) - noteNumber(b));
    for (const note of this.notes) {
      const target = reader.noteTargets.get(note)!;
      const side = note.side ?? sideOf(note.box, target.box, direction);
      this.lines.push(
        `  note ${side} of ${target.id} : ${escapeText(note.label, false)}`.trimEnd(),
      );
    }
    return this.lines.join("\n") + "\n";
  }

  /** Transitions in the order of the export's ids (`t3`), else as the page has them. */
  private ordered(transitions: Transition[]) {
    const number = (item: Transition) => Number(item.cell.id.match(/^t(\d+)$/)?.[1] ?? Infinity);
    return transitions
      .map((item, index) => ({ item, index }))
      .toSorted((a, b) => number(a.item) - number(b.item) || a.index - b.index)
      .map(({ item }) => item);
  }

  private transition(transition: Transition, depth: number) {
    const end = (part: Part) => part.id ?? "[*]";
    const label = escapeText(transition.label, false);
    this.lines.push(
      `${"  ".repeat(depth)}${end(transition.source)} --> ${end(transition.target)}${label ? ` : ${label}` : ""}`,
    );
  }

  private members(scope: Scope, order: Part[]) {
    return order.filter(
      (part) =>
        part.parent === scope.composite && part.region === scope.region && part.kind !== "note",
    );
  }

  /** The states of a scope, the composite states in it with theirs, then its `[*]` transitions. */
  private scope(scope: Scope, order: Part[], depth: number) {
    const { reader } = this;
    const pad = "  ".repeat(depth);
    const members = this.members(scope, order);
    for (const part of members) {
      if (part.kind === "choice" || part.kind === "fork" || part.kind === "join")
        this.lines.push(`${pad}state ${part.id} <<${part.kind}>>`);
      else if (part.kind === "state" && !part.members.length) {
        const name = escapeText(part.label, true);
        this.lines.push(
          `${pad}${name && name !== part.id ? `state "${name}" as ${part.id}` : KEYWORDS.test(part.id!) || STYLING.test(part.id!) ? `state ${part.id}` : part.id}`,
        );
        for (const line of part.descriptions)
          this.lines.push(`${pad}${part.id} : ${escapeText(line, false)}`);
      }
    }
    const subtree = (part: Part): Part[] => [part, ...part.members.flatMap(subtree)];
    const firstFinal = (part: Part) =>
      Math.min(
        ...subtree(part)
          .filter((item) => item.kind === "final")
          .map(finalNumber),
      );
    const firstRegion = (part: Part) =>
      Math.min(...subtree(part).map((item) => item.regionStart ?? Infinity));
    const composites = members
      .filter((part) => part.kind === "state" && part.members.length)
      .map((part, index) => ({ part, index }))
      .toSorted(
        (a, b) =>
          firstFinal(a.part) - firstFinal(b.part) ||
          firstRegion(a.part) - firstRegion(b.part) ||
          a.index - b.index,
      )
      .map(({ part }) => part);
    for (const composite of composites) {
      const name = escapeText(composite.label, true);
      this.lines.push(
        `${pad}${name && name !== composite.id ? `state "${name}" as ${composite.id}` : `state ${composite.id}`} {`,
      );
      const regions = [...new Set(composite.members.map((part) => part.region))].toSorted(
        (a, b) => (a ?? 0) - (b ?? 0),
      );
      regions.forEach((region, index) => {
        if (index) this.lines.push(`${pad}  --`);
        this.scope({ composite, region }, order, depth + 1);
      });
      this.lines.push(`${pad}}`);
    }
    // The `[*]` transitions of the scope: from its initial state, then to its final states.
    const initials = members.filter((part) => part.kind === "initial");
    if (initials.length > 1)
      reader.warnings.push(
        `${initials.length} initial states stand in ${scope.composite ? `“${scope.composite.label}”` : "the diagram"}; they are read as one.`,
      );
    for (const initial of initials) {
      const out = this.ordered(reader.transitions.filter((item) => item.source === initial));
      if (!out.length)
        reader.warnings.push(
          `An initial state${scope.composite ? ` in “${scope.composite.label}”` : ""} has no transition and is not read.`,
        );
      for (const transition of out) {
        if (transition.target.kind === "initial") {
          reader.warnings.push(`A transition into an initial state is not read.`);
          continue;
        }
        if (transition.target.kind === "final" && !this.same(transition.target, initial)) {
          reader.warnings.push(
            `A transition from an initial state to a final state in another scope is not read.`,
          );
          continue;
        }
        this.starred.set(this.lines.length + 1, initial);
        if (transition.target.kind === "final")
          this.starred.set(-(this.lines.length + 1), transition.target);
        this.transition(transition, depth);
      }
    }
    const finals = members
      .filter((part) => part.kind === "final")
      .map((part, index) => ({ part, index }))
      .toSorted((a, b) => finalNumber(a.part) - finalNumber(b.part) || a.index - b.index)
      .map(({ part }) => part);
    for (const final of finals) {
      const into = this.ordered(reader.transitions.filter((item) => item.target === final));
      if (!into.length)
        reader.warnings.push(
          `A final state${scope.composite ? ` in “${scope.composite.label}”` : ""} has no transition into it and is not read.`,
        );
      if (into.length > 1)
        reader.warnings.push(
          `A final state has ${into.length} transitions into it; each draws a final state of its own.`,
        );
      if (reader.transitions.some((item) => item.source === final))
        reader.warnings.push(`A transition out of a final state is not read.`);
      for (const transition of into) {
        if (transition.source.kind === "final" || transition.source.kind === "initial") continue;
        this.starred.set(-(this.lines.length + 1), final);
        this.transition(transition, depth);
      }
    }
  }

  private same(a: Part, b: Part) {
    return a.parent === b.parent && a.region === b.region;
  }
}

/** The number in a note's id from our export (`note2`), for their order. */
const noteNumber = (part: Part) => Number(part.cell.id.match(/^note(\d+)$/)?.[1] ?? Infinity);

/** The side of its state a note stands on, by where it stands. */
function sideOf(note: Box, state: Box, direction: string): "left" | "right" {
  const facing =
    Math.min(note.y + note.height, state.y + state.height) - Math.max(note.y, state.y) > 0;
  if (!facing && (direction === "LR" || direction === "RL"))
    return centerOf(note).y < centerOf(state).y ? "left" : "right";
  return centerOf(note).x < centerOf(state).x ? "left" : "right";
}

/** The size the layout gives a symbol, which is placed by its middle: a state by its corner. */
function symbolSize(
  part: Part,
  diagram: StateDiagram,
  vertical: boolean,
): { width: number; height: number } | undefined {
  if (part.kind === "initial") return { width: 15, height: 15 };
  if (part.kind === "final") return { width: 17, height: 17 };
  if (part.kind === "choice" || part.kind === "split") return { width: 18, height: 18 };
  if (part.kind === "fork" || part.kind === "join") {
    const id = part.id!;
    const into = diagram.transitions.filter(
        (item) => item.target === id && item.source !== id,
      ).length,
      out = diagram.transitions.filter((item) => item.source === id && item.target !== id).length;
    const length = Math.max(60, Math.max(into, out) * 46);
    return vertical ? { width: length, height: 5 } : { width: 5, height: length };
  }
  return undefined;
}

/** The place of a part: its corner, or for a symbol the corner that puts its middle where the page has it. */
function placeOf(box: Box, size: { width: number; height: number } | undefined): Point {
  if (!size) return { x: Math.round(box.x), y: Math.round(box.y) };
  const middle = centerOf(box);
  return { x: Math.round(middle.x - size.width / 2), y: Math.round(middle.y - size.height / 2) };
}

const DEFAULT_NAMES = /^(State machine diagram|Page-\d+|)$/;

function readPage(drawing: Drawing): Imported {
  const reader = new PageReader(drawing);
  if (
    !reader.parts.some((part) =>
      ["state", "initial", "final", "choice", "fork", "join"].includes(part.kind),
    )
  )
    throw new DrawioError(`The page “${drawing.name}” holds no states.`);
  const writer = new SourceWriter(reader);
  const title = pageTitle(drawing, DEFAULT_NAMES);
  let source = writer.write(title);
  let diagram: StateDiagram;
  try {
    diagram = parseStateDiagram(source);
  } catch (error) {
    throw new DrawioError(
      `The page “${drawing.name}” does not make a state machine diagram: ${(error as Error).message}`,
    );
  }
  // The ids the parser gave the `[*]` states, by the lines that wrote them.
  const generated = new Map<Part, string[]>();
  for (const transition of diagram.transitions) {
    const line = transition.line;
    const initial = writer.starred.get(line),
      final = writer.starred.get(-line);
    if (initial && !generated.has(initial)) generated.set(initial, [transition.source]);
    if (final) generated.set(final, [...(generated.get(final) ?? []), transition.target]);
  }
  const vertical = diagram.direction === "TB" || diagram.direction === "BT";
  const places: string[] = [];
  const place = (id: string, at: Point) => places.push(`%% @${id} ${at.x},${at.y}`);
  for (const part of readingOrder(reader.parts, (item) => item.box)) {
    const size = symbolSize(part, diagram, vertical);
    if (part.kind === "note") {
      const id = diagram.notes[writer.notes.indexOf(part)]?.id;
      if (id) place(id, placeOf(part.box, undefined));
    } else if (part.kind === "split") {
      const base = splitOwner(part.cell.id),
        owner = reader.parts.find((item) => item.cell.id === base);
      if (owner?.id) place(owner.id + part.cell.id.slice(base!.length), placeOf(part.box, size));
    } else if (part.kind === "initial" || part.kind === "final") {
      for (const id of generated.get(part) ?? []) place(id, placeOf(part.box, size));
    } else if (part.id && !part.members.length) place(part.id, placeOf(part.box, size));
  }
  if (places.length) source += places.join("\n") + "\n";
  return { source, kind: "state", warnings: reader.warnings };
}

// ---------------------------------------------------------------------------------------------
// Likeness

/**
 * Whether a vertex is drawn as a state: the State shape of TAMshapes (rounded less than an action),
 * draw.io's UML state, or the tam-drawio plugin's State (a plain box filled with the default fill).
 */
function looksLikeState(style: Style): boolean {
  const shape = shapeOf(style);
  if (shape === "umlState") return true;
  if (shape !== "rect" || filled(style)) return false;
  if (isOn(style, "rounded")) return Number(style.get("arcSize") ?? 20) <= 15;
  return style.get("fillColor") === "default" && Number(style.get("strokeWidth") ?? 1) >= 2;
}

/** Whether a vertex is drawn as an action of an activity diagram: a box rounded more than a state. */
const looksLikeAction = (style: Style) =>
  shapeOf(style) === "rect" &&
  isOn(style, "rounded") &&
  !filled(style) &&
  Number(style.get("arcSize") ?? 20) >= 30;

/** A transition's label: an event with a guard, or an action after a slash. */
const TRANSITION_LABEL = /(^|\s)\/\s*\S|^\s*[\p{L}_][\p{L}\p{N}_ ]*\[[^\]]+\]/u;

/** What the symbols state machines share with activity diagrams weigh: as much as there. */
const PSEUDOSTATE_WEIGHT: Partial<Record<Kind, number>> = {
  initial: 4,
  dot: 4,
  final: 4,
  choice: 4,
  bar: 4,
};

/**
 * How much a page looks like a state machine: states, which only state machines have, weigh most;
 * the pseudostates weigh as they do for an activity diagram, so the states and the transitions
 * labeled `event [guard] / action` or leading back to their state decide. Our roles count too.
 */
function likeness(drawing: Drawing): number {
  let score = 0;
  for (const part of drawing.parts) {
    const role = roleOf(drawing, part);
    if (role?.startsWith("state")) {
      score += 3;
      continue;
    }
    if (part.edge) {
      if (TRANSITION_LABEL.test(drawing.label(part))) score += 2;
      if (part.source && part.source === part.target) score += 2;
      continue;
    }
    if (!part.vertex) continue;
    // The circles inside a final state's group count with the group.
    const holder = drawing.parentOf(part);
    if (holder?.vertex && shapeOf(drawing.style(holder)) === "group") continue;
    const style = drawing.style(part);
    if (looksLikeState(style)) score += 4;
    else if (looksLikeAction(style)) score -= 2;
    else {
      const kind = kindByPicture(drawing, part);
      score += PSEUDOSTATE_WEIGHT[kind] ?? 0;
      if (kind === "final" && shapeOf(style) === "group") score += 1;
    }
  }
  return Math.max(0, score);
}

export const stateDrawio: DrawioType = {
  kinds: ["state"],
  cells: exportCells,
  likeness,
  read: readPage,
};
