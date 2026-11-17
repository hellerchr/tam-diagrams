/**
 * draw.io pages of activity diagrams: Mermaid flowcharts (`flowchart`, `graph`) and swimlane
 * activities (`swimlane-beta`). An activity is exported with the shapes of the TAMshapes library
 * TAM-AD: actions as rounded boxes, the initial node as a black dot, decisions and merges as
 * diamonds, fork and join bars, swimlanes as partial rectangles with dashed sides. Mermaid's shapes
 * that mean nothing more in TAM (a hexagon, a parallelogram, a cylinder) are drawn with draw.io's
 * shapes of that look. A page drawn by hand with the TAM-AD library reads back as an activity.
 */

import {
  type Cell,
  type Drawing,
  DrawioError,
  type Geometry,
  isOn,
  LAYER,
  shapeOf,
  type Style,
  textToHtml,
} from "./drawio-file.ts";
import {
  arrowAt,
  cell,
  dashed,
  edgeRoute,
  fillOf,
  FONT_SIZE,
  Ids,
  isDark,
  labelAt,
  readingOrder,
  roleOf,
  TAMSHAPES,
  vertexGeometry,
} from "./drawio-shapes.ts";
import type { DrawioKind, DrawioType, Imported } from "./drawio.ts";
import {
  around,
  type Box,
  contains,
  inside,
  type Point,
  type Scene,
  type SceneShape,
  type SceneText,
} from "./scene.ts";
import { FONT, type Measure, textMeasure } from "./text.ts";
import type { Direction } from "./elk.ts";
import {
  type FlowEdge,
  type Flowchart,
  type FlowNode,
  type Marker,
  parseFlowchart,
} from "./uml-activity.ts";
import { escapeLabel } from "./uml.ts";
import { degrees, guardText, nodeBox, splitDecisions, splitFinals } from "./uml-activity-layout.ts";
import { placeSwimlanes } from "./swimlane-place.ts";

type Shape = FlowNode["shape"];

/** The roles of the cells of an activity: a node's shape, or what else the cell draws. */
const SHAPES: Shape[] = [
  "rect",
  "round",
  "stadium",
  "subroutine",
  "cylinder",
  "circle",
  "double-circle",
  "diamond",
  "hexagon",
  "lean-right",
  "lean-left",
  "trapezoid",
  "trapezoid-top",
  "flag",
  "initial",
  "final",
  "flow-final",
  "bar",
];
const isShape = (role: string | undefined): role is Shape => SHAPES.includes(role as Shape);

/** Symbols that carry their name beside them, not inside. */
const SYMBOLS = new Set<Shape>(["initial", "final", "flow-final", "bar", "diamond"]);

/** How far from a node the loose end of a flow may stop and still be read as leading to it. */
const LOOSE = 12;

/** The page draws no lines thicker than this as a normal flow. */
const THICK = 2.5;

// ---------------------------------------------------------------------------------------------
// Export: styles

/** The style of shapes TAM-AD has no symbol for: draw.io's own, with an outline as TAM-AD draws. */
const PLAIN = { whiteSpace: "wrap", html: 1, strokeWidth: 2 };

/** The style of a node's shape: TAM-AD where the library has it, draw.io's own shape otherwise. */
const SHAPE_STYLES: Record<Shape, Record<string, string | number>> = {
  rect: TAMSHAPES.action,
  round: TAMSHAPES.action,
  stadium: TAMSHAPES.action,
  initial: TAMSHAPES.initial,
  // One cell that draws the TAM-AD End of Activity, so flows connect to it as one node.
  final: {
    ellipse: "",
    shape: "endState",
    fillColor: "#000000",
    aspect: "fixed",
    strokeWidth: 2,
    html: 1,
  },
  "flow-final": {
    ellipse: "",
    shape: "sumEllipse",
    perimeter: "ellipsePerimeter",
    aspect: "fixed",
    strokeWidth: 2,
    html: 1,
  },
  diamond: TAMSHAPES.decision,
  bar: TAMSHAPES.bar,
  circle: { ellipse: "", aspect: "fixed", ...PLAIN },
  "double-circle": { ellipse: "", shape: "doubleEllipse", aspect: "fixed", ...PLAIN },
  cylinder: { shape: "cylinder3", boundedLbl: 1, backgroundOutline: 1, size: 8, ...PLAIN },
  subroutine: { shape: "process", fixedSize: 1, size: 8, backgroundOutline: 1, ...PLAIN },
  hexagon: { shape: "hexagon", perimeter: "hexagonPerimeter2", fixedSize: 1, size: 14, ...PLAIN },
  "lean-right": {
    shape: "parallelogram",
    perimeter: "parallelogramPerimeter",
    fixedSize: 1,
    size: 14,
    ...PLAIN,
  },
  "lean-left": {
    shape: "parallelogram",
    perimeter: "parallelogramPerimeter",
    fixedSize: 1,
    size: 14,
    flipH: 1,
    ...PLAIN,
  },
  trapezoid: {
    shape: "trapezoid",
    perimeter: "trapezoidPerimeter",
    fixedSize: 1,
    size: 14,
    ...PLAIN,
  },
  "trapezoid-top": {
    shape: "trapezoid",
    perimeter: "trapezoidPerimeter",
    fixedSize: 1,
    size: 14,
    flipV: 1,
    ...PLAIN,
  },
  flag: { shape: "step", perimeter: "stepPerimeter", fixedSize: 1, size: 12, ...PLAIN },
};

/** Label keys that stand a symbol's name or question where the scene draws it, beside the symbol. */
function besideStyle(shape: Box, text: Box): Record<string, string> {
  const cx = text.x + text.width / 2,
    cy = text.y + text.height / 2;
  const horizontal = cx > shape.x + shape.width ? "right" : cx < shape.x ? "left" : "center";
  const vertical = cy < shape.y ? "top" : cy > shape.y + shape.height ? "bottom" : "middle";
  return {
    labelPosition: horizontal,
    align: ALIGN_BESIDE[horizontal],
    verticalLabelPosition: vertical,
    verticalAlign: ALIGN_BESIDE[vertical],
  };
}

/** How a label beside a shape aligns: toward the shape. */
const ALIGN_BESIDE: Record<string, string> = {
  right: "left",
  left: "right",
  center: "center",
  top: "bottom",
  bottom: "top",
  middle: "middle",
};

/** draw.io's name of an end marker. */
const MARKER_STYLE: Record<Marker, { arrow: string; fill: number }> = {
  arrow: { arrow: "classic", fill: 1 },
  circle: { arrow: "oval", fill: 0 },
  cross: { arrow: "cross", fill: 0 },
};

function endStyle(end: "start" | "end", marker: Marker | undefined) {
  const style = marker ? MARKER_STYLE[marker] : { arrow: "none", fill: 0 };
  return { [`${end}Arrow`]: style.arrow, [`${end}Fill`]: style.fill };
}

/** A label's text as a cell's value: Mermaid's `<br>` as line breaks. */
const valueOf = (label: string) => textToHtml(label.replace(/<br\s*\/?>/gi, "\n"));

/** The box around texts. */
function boxAround(texts: SceneText[]): Box | undefined {
  if (!texts.length) return undefined;
  return around(texts.map((text) => text.box));
}

/** The font size a scene text is written in, as draw.io gets it. */
const fontOf = (texts: SceneText[]) =>
  texts.length ? Math.round((texts[0].size * FONT_SIZE) / FONT) : FONT_SIZE;

// ---------------------------------------------------------------------------------------------
// Export: cells

/** The model id a node of the layout stands for: a copy of a final node or a split diamond is its original's. */
function originalOf(chart: Flowchart, id: string): string {
  if (chart.nodes.has(id)) return id;
  const owners = [...chart.nodes.keys()].filter((key) => id.startsWith(`${key}#`));
  return owners.toSorted((a, b) => b.length - a.length)[0] ?? id;
}

/** The frame of a swimlane scene: the closed line around the lanes. */
const isFrame = ({ points }: { points: Point[] }) =>
  points.length === 5 && points[0].x === points[4].x && points[0].y === points[4].y;

/** The lanes of a swimlane scene: the frame, and each lane's box between the lines that part them. */
function laneBoxes(
  scene: Scene,
  count: number,
  vertical: boolean,
): { frame: Box; lanes: Box[] } | undefined {
  const frameLine = scene.lines.find(isFrame);
  if (!frameLine) return undefined;
  const frame = boxOfPoints(frameLine.points);
  const axis = vertical ? "x" : "y",
    size = vertical ? "width" : "height";
  const separators = scene.lines
    .filter((line) => line !== frameLine && line.points.length === 2)
    .map((line) => line.points[0][axis])
    .toSorted((a, b) => a - b);
  const bounds = [frame[axis], ...separators, frame[axis] + frame[size]];
  if (bounds.length !== count + 1) return undefined;
  const lanes = bounds
    .slice(0, -1)
    .map((start, index) =>
      vertical
        ? { x: start, y: frame.y, width: bounds[index + 1] - start, height: frame.height }
        : { x: frame.x, y: start, width: frame.width, height: bounds[index + 1] - start },
    );
  return { frame, lanes };
}

/** The box around points. */
function boxOfPoints(points: Point[]): Box {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/** What an exported page needs to know of its activity while its cells are made. */
interface Export {
  chart: Flowchart;
  split: Flowchart;
  scene: Scene;
  shapes: Map<string, SceneShape>;
  cells: Cell[];
  /** The cell each node or container of the layout is drawn as, with its box. */
  boxes: Map<string, Box>;
  /** The cell a node stands in, when it is not the layer. */
  holder: Map<string, string>;
  flow: Direction;
}

/** The title above the diagram, as a text. */
function titleCell(job: Export) {
  const heading = job.scene.texts.find((text) => text.role === "heading");
  if (!heading) return;
  job.cells.push(
    cell(
      {
        id: "title",
        parent: LAYER,
        value: textToHtml(heading.text),
        vertex: true,
        style: {
          ...TAMSHAPES.text,
          whiteSpace: "nowrap",
          align: "left",
          fontStyle: 1,
          fontSize: Math.round((heading.size * FONT_SIZE) / FONT),
        },
        geometry: vertexGeometry(heading.box),
      },
      "title",
    ),
  );
}

/**
 * The lanes of a swimlane activity, in order: one per lane of the source, and one more without a
 * name for the nodes outside every lane, or when there is no lane at all.
 */
function lanesOf(split: Flowchart, taken: Set<string>): { id: string; label: string }[] {
  const lanes = [...split.subgraphs.values()]
    .filter((subgraph) => !subgraph.parent)
    .map((subgraph) => ({ id: subgraph.id, label: subgraph.label }));
  if (lanes.length && [...split.nodes.values()].every((node) => node.parent)) return lanes;
  let id = "lane";
  for (let index = 1; taken.has(id); index++) id = `lane${index}`;
  taken.add(id);
  return [...lanes, { id, label: "" }];
}

/** How a lane writes its name: on top in lanes side by side, at the left in lanes one above the other. */
const LANE_NAMES = {
  vertical: { spacingTop: 10 },
  horizontal: {
    top: undefined,
    bottom: undefined,
    left: 0,
    right: 0,
    verticalAlign: "middle",
    align: "left",
    spacingLeft: 14,
  },
};

/** The lanes of a swimlane activity: TAM-AD swimlanes in a frame, each holding its nodes. */
function laneCells(job: Export, taken: Set<string>) {
  const { split, scene } = job;
  const vertical = split.direction === "TB" || split.direction === "BT";
  const lanes = lanesOf(split, taken);
  const found = laneBoxes(scene, lanes.length, vertical);
  if (!found) return;
  job.cells.push(
    cell(
      {
        id: "frame",
        parent: LAYER,
        vertex: true,
        style: { rounded: 0, html: 1, fillColor: "none", strokeWidth: 1.2, connectable: 0 },
        geometry: vertexGeometry(found.frame),
      },
      "frame",
    ),
  );
  const names = LANE_NAMES[vertical ? "vertical" : "horizontal"];
  lanes.forEach((lane, index) => {
    const box = found.lanes[index];
    job.boxes.set(lane.id, box);
    job.cells.push(
      cell(
        {
          id: lane.id,
          parent: LAYER,
          value: valueOf(lane.label),
          vertex: true,
          style: {
            ...TAMSHAPES.lane,
            ...names,
            container: 1,
            fontSize: FONT_SIZE,
            tamFlow: split.direction,
          },
          geometry: vertexGeometry(box),
        },
        split.subgraphs.has(lane.id) ? "lane" : "lane-none",
      ),
    );
  });
  const outside = lanes.find((lane) => !split.subgraphs.has(lane.id))?.id;
  for (const node of split.nodes.values()) job.holder.set(node.id, node.parent ?? outside!);
}

/** A subgraph of a flowchart: a frame that holds its nodes. */
function subgraphCell(job: Export, id: string) {
  const shape = job.shapes.get(id),
    subgraph = job.split.subgraphs.get(id)!;
  if (!shape) return;
  const parent = subgraph.parent ?? undefined;
  job.boxes.set(id, shape.box);
  if (parent) job.holder.set(id, parent);
  const titles = job.scene.texts.filter((text) => text.owner === id);
  job.cells.push(
    cell(
      {
        id,
        parent: parent ?? LAYER,
        value: valueOf(subgraph.label),
        vertex: true,
        style: {
          rounded: 0,
          whiteSpace: "wrap",
          html: 1,
          container: 1,
          collapsible: 0,
          verticalAlign: "top",
          fontStyle: 1,
          strokeWidth: 1,
          spacingTop: titles.length
            ? Math.max(0, Math.round(titles[0].box.y - shape.box.y) - 2)
            : 4,
          fillColor: fillOf(shape),
          fontSize: FONT_SIZE,
        },
        geometry: vertexGeometry(shape.box, parent ? job.boxes.get(parent) : undefined),
      },
      "subgraph",
    ),
  );
}

/** The symbols drawn black, whatever fill the scene gives them. */
const UNFILLED = new Set<Shape>(["initial", "final", "bar"]);

/** The cell a node stands in: its lane, or in a flowchart its subgraph. */
function holderOfNode(job: Export, id: string, node: FlowNode): string | undefined {
  const held = job.holder.get(id);
  if (held) return held;
  return job.chart.kind === "flowchart" ? (node.parent ?? undefined) : undefined;
}

/** A node: its shape with its text inside, or a symbol with its name beside it. */
function nodeCell(job: Export, id: string) {
  const shape = job.shapes.get(id),
    node = job.split.nodes.get(id)!;
  if (!shape) return;
  const parent = holderOfNode(job, id, node);
  job.boxes.set(id, shape.box);
  job.cells.push(
    cell(
      {
        id,
        parent: parent ?? LAYER,
        value: valueOf(node.label),
        vertex: true,
        style: nodeStyle(job, id, node, shape),
        geometry: vertexGeometry(shape.box, parent ? job.boxes.get(parent) : undefined),
      },
      node.shape,
    ),
  );
}

/** A node's style: its shape and fill, and a symbol's name beside it where the scene draws it. */
function nodeStyle(job: Export, id: string, node: FlowNode, shape: SceneShape) {
  const original = originalOf(job.chart, id);
  const texts = job.scene.texts.filter((text) => text.owner === id && text.role === "label");
  const fill = UNFILLED.has(node.shape) ? undefined : fillOf(shape);
  const symbol = SYMBOLS.has(node.shape);
  // Without a text in the scene, the name stands right of the symbol.
  const beside = () =>
    besideStyle(
      shape.box,
      boxAround(texts) ?? { ...shape.box, x: shape.box.x + shape.box.width + 4 },
    );
  return {
    ...SHAPE_STYLES[node.shape],
    ...(fill ? { fillColor: fill } : {}),
    ...(symbol && node.label ? beside() : {}),
    fontSize: symbol ? fontOf(texts) : FONT_SIZE,
    tamFlow: job.flow,
    tamOf: original === id ? undefined : original,
  };
}

/** A link the layout keeps but the page does not show: an edge without a line. */
function invisibleCell(id: string, edge: FlowEdge, label: string): Cell {
  return cell(
    {
      id,
      parent: LAYER,
      value: label ? valueOf(label) : undefined,
      edge: true,
      source: edge.source,
      target: edge.target,
      style: {
        html: 1,
        strokeColor: "none",
        startArrow: "none",
        endArrow: "none",
        fontSize: FONT_SIZE,
        noLabel: 1,
      },
      geometry: { x: 0, y: 0, width: 0, height: 0, relative: true },
    },
    "invisible",
  );
}

/** The line of a flow: dotted or thick as its stroke. */
const STROKES: Partial<Record<FlowEdge["stroke"], Record<string, string | number>>> = {
  dotted: { dashed: 1, dashPattern: "5 4" },
  thick: { strokeWidth: 3 },
};

/** A flow: an arrow along the scene's wire, or an invisible link between its nodes. */
function edgeCell(job: Export, edge: FlowEdge, id: string) {
  const label = edge.label ? guardText(job.chart, edge) : "";
  if (edge.stroke === "invisible") {
    job.cells.push(invisibleCell(id, edge, label));
    return;
  }
  const wire = job.scene.wires.find((item) => item.edge === edge.id);
  if (!wire) return;
  const route = edgeRoute(wire.points, job.boxes.get(edge.source), job.boxes.get(edge.target));
  const texts = job.scene.texts.filter((text) => text.owner === edge.id && text.role === "label");
  const at = boxAround(texts);
  const geometry: Geometry = at
    ? labelAt(route.geometry, wire.points, { x: at.x + at.width / 2, y: at.y + at.height / 2 })
    : route.geometry;
  job.cells.push(
    cell(
      {
        id,
        parent: LAYER,
        value: label ? valueOf(label) : undefined,
        edge: true,
        source: edge.source,
        target: edge.target,
        style: {
          ...TAMSHAPES.connection,
          ...endStyle("start", edge.start),
          ...endStyle("end", edge.end),
          ...STROKES[edge.stroke],
          ...route.style,
          fontSize: fontOf(texts),
        },
        geometry,
      },
      job.chart.edges.some((item) => item.id === edge.id) ? "flow" : "link",
    ),
  );
}

function exportCells(source: string, scene: Scene): Cell[] {
  const chart = parseFlowchart(source);
  const split = splitDecisions(splitFinals(chart));
  const job: Export = {
    chart,
    split,
    scene,
    shapes: new Map(scene.shapes.map((shape) => [shape.id, shape])),
    cells: [],
    boxes: new Map(),
    holder: new Map(),
    flow: chart.direction,
  };
  const taken = new Set<string>([
    "title",
    "frame",
    ...split.nodes.keys(),
    ...split.subgraphs.keys(),
  ]);
  titleCell(job);
  if (chart.kind === "swimlane") laneCells(job, taken);
  nodeCells(job);
  for (const edge of split.edges) {
    const id = taken.has(edge.id) ? `flow#${edge.id}` : edge.id;
    taken.add(id);
    edgeCell(job, edge, id);
  }
  return job.cells;
}

/**
 * The nodes and subgraphs, each in the order of the source; in a flowchart a subgraph comes before
 * what it holds. A swimlane's lanes are drawn already.
 */
function nodeCells(job: Export) {
  const { chart, split } = job;
  const flowchart = chart.kind === "flowchart";
  const done = new Set<string>();
  const add = (id: string) => {
    if (done.has(id)) return;
    done.add(id);
    const parent = split.nodes.get(id)?.parent ?? split.subgraphs.get(id)?.parent;
    if (flowchart && parent) add(parent);
    if (!split.subgraphs.has(id)) nodeCell(job, id);
    else if (flowchart) subgraphCell(job, id);
  };
  split.order.forEach(add);
}

// ---------------------------------------------------------------------------------------------
// Import: what each cell is

/** A part read from the page: a node, a container, a text, or something left out. */
interface Part {
  cell: Cell;
  kind: Shape | "subgraph" | "lane" | "lane-none" | "frame" | "text" | "title";
  box: Box;
  label: string;
  /** Whether the page says the kind (`tam=`), not only the picture. */
  tagged: boolean;
  /** A copy of a node in the layout (a second final node, a split diamond): the original's cell id. */
  of?: string;
  /** Its index in the order the source declares it. */
  order: number;
}

/** The pieces of the TAM-AD End of Activity and End of Flow groups. */
function endGroup(drawing: Drawing, group: Cell): Shape | undefined {
  const inside = drawing.descendants(group.id);
  const ellipses = inside.filter(
    (item) => item.vertex && shapeOf(drawing.style(item)) === "ellipse",
  );
  const lines = inside.filter((item) => item.edge);
  if (
    ellipses.some((item) => isDark(drawing.style(item))) &&
    ellipses.some((item) => !isDark(drawing.style(item)))
  )
    return "final";
  if (ellipses.length && lines.length >= 2) return "flow-final";
  return undefined;
}

/** What a vertex may be by its picture: a part, a note, or no part of an activity. */
type Pictured = Part["kind"] | "note" | "other";

/** The kind of a shape by its name and style; a rectangle needs more to tell. */
const PICTURES = new Map<string, Pictured | ((style: Style) => Pictured)>([
  ["partialRectangle", "lane"],
  ["endState", "final"],
  ["endactivity", "final"],
  // The Fork or Join of the tam-drawio plugin is a line drawn thick.
  ["line", (style) => (thickLine(style) ? "bar" : "other")],
  ["sumEllipse", "flow-final"],
  ["orEllipse", "flow-final"],
  ["doubleEllipse", (style) => (isDark(style) ? "final" : "double-circle")],
  ["ellipse", (style) => (isDark(style) ? "initial" : "circle")],
  ["rhombus", "diamond"],
  ["cylinder", "cylinder"],
  ["cylinder3", "cylinder"],
  ["datastore", "cylinder"],
  ["process", "subroutine"],
  ["hexagon", "hexagon"],
  ["parallelogram", (style) => (isOn(style, "flipH") ? "lean-left" : "lean-right")],
  ["trapezoid", (style) => (isOn(style, "flipV") ? "trapezoid-top" : "trapezoid")],
  ["step", "flag"],
  ["text", "text"],
  ["label", "text"],
  ["swimlane", "subgraph"],
  ["note", "note"],
  ["note2", "note"],
]);

/** The kind a vertex has by its picture alone; "other" for one that is no part of an activity. */
function pictured(drawing: Drawing, item: Cell, style: Style, holds: boolean): Pictured {
  const shape = shapeOf(style);
  if (shape === "rect") return rectangle(drawing, item, style, holds);
  const kind = PICTURES.get(shape) ?? "other";
  return typeof kind === "function" ? kind(style) : kind;
}

/**
 * What a rectangle is: black a bar, without outline and fill a text, holding others a subgraph or a
 * frame, else an action or an object node.
 */
function rectangle(drawing: Drawing, item: Cell, style: Style, holds: boolean): Pictured {
  if (isDark(style)) return "bar";
  if (isBare(style)) return "text";
  if (holds || isOn(style, "container")) return containerKind(drawing, item, style);
  // A TAM-AD Action is rounded, an Object Node is not. The syntax has no plain rectangle for an
  // object node (square brackets draw an action too), so it reads as the syntax's object node, the
  // cylinder.
  return isOn(style, "rounded") ? "round" : "cylinder";
}

/** Whether a shape is drawn without outline and fill: a text. */
const isBare = (style: Style) =>
  style.get("strokeColor") === "none" && (style.get("fillColor") ?? "none") === "none";

/** A rectangle that holds others: a subgraph with a name or a fill, else the frame of the lanes. */
const containerKind = (drawing: Drawing, item: Cell, style: Style): Pictured =>
  drawing.label(item) || style.get("fillColor") !== "none" ? "subgraph" : "frame";

/** Whether a line shape is drawn as thick as a fork or join bar. */
const thickLine = (style: Style) => Number(style.get("strokeWidth") ?? 1) >= 6;

/** What the page holds: its parts, the cells that stand for them, and what could not be read. */
interface Reading {
  parts: Part[];
  /** The part each cell stands for: a group's ellipses are the group's node. */
  partOf: Map<string, Part>;
  /** Lines that draw part of a node (the cross of an End of Flow), not a flow. */
  marks: Set<string>;
  warnings: string[];
}

const ROLES = new Set<string>([...SHAPES, "subgraph", "lane", "lane-none", "frame", "title"]);

/** The parts of a page, read vertex by vertex. */
class PartReader {
  readonly reading: Reading = { parts: [], partOf: new Map(), marks: new Set(), warnings: [] };
  private readonly drawing: Drawing;
  private readonly vertices: Cell[];
  /** The cells that are pieces of an end node's group. */
  private readonly absorbed = new Set<string>();
  private readonly order: Map<string, number>;
  private readonly boxes: Map<string, Box>;

  constructor(drawing: Drawing) {
    this.drawing = drawing;
    this.vertices = drawing.parts.filter((item) => item.vertex && !drawing.parentOf(item)?.edge);
    this.order = new Map(drawing.parts.map((item, index) => [item.id, index]));
    this.boxes = new Map(this.vertices.map((item) => [item.id, drawing.box(item)]));
  }

  read(): Reading {
    for (const item of this.vertices) this.readEndGroup(item);
    for (const item of this.vertices) if (!this.absorbed.has(item.id)) this.readVertex(item);
    stackedEnds(this.drawing, this.reading);
    return this.reading;
  }

  private add(item: Cell, kind: Part["kind"], tagged: boolean) {
    const { drawing, reading } = this;
    const part: Part = {
      cell: item,
      kind,
      box: drawing.box(item),
      label: drawing.label(item),
      tagged,
      of: tagged ? drawing.style(item).get("tamOf") : undefined,
      order: this.order.get(item.id) ?? 0,
    };
    reading.parts.push(part);
    reading.partOf.set(item.id, part);
    return part;
  }

  /** The TAM-AD end nodes are groups: the group is the node, its pieces belong to it. */
  private readEndGroup(item: Cell) {
    const { drawing, reading } = this;
    if (roleOf(drawing, item) || shapeOf(drawing.style(item)) !== "group") return;
    const kind = endGroup(drawing, item);
    if (!kind) return;
    const part = this.add(item, kind, false);
    for (const piece of drawing.descendants(item.id)) {
      this.absorbed.add(piece.id);
      reading.partOf.set(piece.id, part);
      if (piece.edge) reading.marks.add(piece.id);
    }
  }

  /** Whether a vertex holds another: draw.io nests it, or it stands inside, smaller, and is no text. */
  private holds(item: Cell) {
    const { drawing } = this;
    const box = this.boxes.get(item.id)!;
    return this.vertices.some((other) => {
      if (other === item || this.absorbed.has(other.id)) return false;
      const inner = this.boxes.get(other.id)!;
      return (
        drawing.parentOf(other) === item ||
        (area(inner) < area(box) &&
          inside(inner, box, 2) &&
          shapeOf(drawing.style(other)) !== "text")
      );
    });
  }

  private readVertex(item: Cell) {
    const { drawing } = this;
    const style = drawing.style(item),
      role = roleOf(drawing, item);
    if (role && ROLES.has(role)) {
      this.add(item, role as Part["kind"], true);
      return;
    }
    if (shapeOf(style) === "group") return;
    const kind = pictured(drawing, item, style, this.holds(item));
    if (kind === "note" || kind === "other") this.readStranger(item, kind);
    else this.add(item, kind, false);
  }

  /** A note or a shape that is no part of an activity: an action when it has a name, else nothing. */
  private readStranger(item: Cell, kind: "note" | "other") {
    const label = this.drawing.label(item);
    if (!label) return;
    if (kind === "other") {
      this.add(item, "round", false);
      this.reading.warnings.push(
        `The shape “${label}” is no shape of an activity diagram and is read as an action.`,
      );
    } else
      this.reading.warnings.push(
        `The note “${label}” is left out: activity diagrams have no notes in this syntax (Mermaid flowcharts have none).`,
      );
  }
}

const readParts = (drawing: Drawing): Reading => new PartReader(drawing).read();

/**
 * End nodes drawn from pieces that are not grouped: a white circle with a black dot on it is the
 * End of Activity, a white circle crossed by two lines the End of Flow.
 */
function stackedEnds(drawing: Drawing, reading: Reading) {
  const rings = reading.parts.filter(
    (part) => part.kind === "circle" && !part.tagged && !part.label,
  );
  for (const ring of rings) {
    const dot = dotIn(reading, ring);
    if (dot) {
      ring.kind = "final";
      reading.parts.splice(reading.parts.indexOf(dot), 1);
      reading.partOf.set(dot.cell.id, ring);
      continue;
    }
    const cross = crossIn(drawing, reading, ring);
    if (cross.length >= 2) {
      ring.kind = "flow-final";
      for (const line of cross) reading.marks.add(line.id);
    }
  }
}

/** A black dot drawn on a ring. */
const dotIn = (reading: Reading, ring: Part) =>
  reading.parts.find(
    (part) =>
      part.kind === "initial" &&
      !part.tagged &&
      part.box.width < ring.box.width &&
      inside(part.box, ring.box, 2),
  );

/** The loose lines drawn inside a ring. */
function crossIn(drawing: Drawing, reading: Reading, ring: Part): Cell[] {
  return drawing.parts.filter((item) => {
    if (!item.edge || item.source || item.target || reading.marks.has(item.id)) return false;
    const path = drawing.path(item);
    return (
      path.length >= 2 &&
      path.every((point) => inside({ ...point, width: 0, height: 0 }, ring.box, 1))
    );
  });
}

// ---------------------------------------------------------------------------------------------
// Import: the activity

/** A flow of the source being written. */
interface Flow {
  source: string;
  target: string;
  label: string;
  stroke: FlowEdge["stroke"];
  start?: Marker;
  end?: Marker;
}

/** A flow read from the page, between the parts it joins. */
type ReadFlow = Flow & { from: Part; to: Part };

/** A part that is a node. */
type NodePart = Part & { kind: Shape };

const center = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const area = (box: Box) => box.width * box.height;

/** The Mermaid markers of draw.io's arrow heads; every other head is an arrow. */
const MARKERS = new Map<string, Marker>([
  ["oval", "circle"],
  ["circle", "circle"],
  ["circlePlus", "circle"],
  ["dot", "circle"],
  ["cross", "cross"],
]);

/** The Mermaid marker of an end of a draw.io edge. */
function markerAt(style: Style, end: "start" | "end"): Marker | undefined {
  const arrow = arrowAt(style, end);
  if (arrow === "none") return undefined;
  return MARKERS.get(arrow) ?? "arrow";
}

/** The distance from a point to a path. */
function distanceTo(path: Point[], point: Point): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = length
      ? Math.max(
          0,
          Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length),
        )
      : 0;
    best = Math.min(
      best,
      Math.hypot(point.x - a.x - t * (b.x - a.x), point.y - a.y - t * (b.y - a.y)),
    );
  }
  return best;
}

/** The gap between two boxes, 0 when they touch or overlap. */
const gap = (a: Box, b: Box) =>
  Math.hypot(
    Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width),
    Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height),
  );

/**
 * Whether a text beside a symbol and near a flow names the symbol rather than labels the flow: a
 * guard in brackets labels the flow, a question names the decision it stands by, and otherwise the
 * nearer of the two takes it.
 */
function namesSymbol(text: Part, symbol: Part, fromFlow: number): boolean {
  const words = text.label.trim();
  if (/^\[[\s\S]*\]$/.test(words)) return false;
  if (symbol.kind === "diamond" && words.endsWith("?")) return true;
  return gap(symbol.box, text.box) <= fromFlow;
}

const DIRECTIONS = new Set<string>(["TB", "BT", "LR", "RL"]);

/** The way the flow runs: as the page says, else the way most flows point. */
function directionOf(
  drawing: Drawing,
  reading: Reading,
  flows: { from: Part; to: Part }[],
  lanes: Part[],
): Direction {
  const said = reading.parts
    .map((part) => drawing.style(part.cell).get("tamFlow"))
    .find((flow) => flow && DIRECTIONS.has(flow));
  if (said) return said as Direction;
  let dx = 0,
    dy = 0;
  for (const { from, to } of flows) {
    const a = center(from.box),
      b = center(to.box);
    dx += b.x - a.x;
    dy += b.y - a.y;
  }
  if (runsInColumns(lanes, dx, dy)) return dy < 0 ? "BT" : "TB";
  return dx < 0 ? "RL" : "LR";
}

/**
 * Whether the flow runs down columns: lanes side by side, one lane taller than wide, or without
 * lanes flows that run more down than across.
 */
function runsInColumns(lanes: Part[], dx: number, dy: number): boolean {
  if (lanes.length === 1) return lanes[0].box.height >= lanes[0].box.width;
  if (!lanes.length) return Math.abs(dy) >= Math.abs(dx);
  const a = center(lanes[0].box),
    b = center(lanes[1].box);
  return Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
}

/** In quotes, unless a text is plain words. */
const quoted = (text: string) =>
  /^[\p{L}\p{N} .,:!?'_-]*$/u.test(text.replace(/<br>/g, "")) ? text : `"${text}"`;

/** The brackets of the shapes Mermaid writes with brackets. */
const BRACKETS: Partial<Record<Shape, [string, string]>> = {
  rect: ["[", "]"],
  round: ["(", ")"],
  stadium: ["([", "])"],
  subroutine: ["[[", "]]"],
  cylinder: ["[(", ")]"],
  circle: ["((", "))"],
  "double-circle": ["(((", ")))"],
  diamond: ["{", "}"],
  hexagon: ["{{", "}}"],
  "lean-right": ["[/", "/]"],
  "lean-left": ["[\\", "\\]"],
  trapezoid: ["[/", "\\]"],
  "trapezoid-top": ["[\\", "/]"],
  flag: [">", "]"],
};
/** The Mermaid names of the shapes written as metadata. */
const NAMED: Partial<Record<Shape, string>> = {
  initial: "start",
  final: "stop",
  "flow-final": "cross-circ",
  bar: "fork",
};

/** A node's declaration: its id with its shape and text. */
function declaration(id: string, shape: Shape, label: string): string {
  const text = escapeLabel(label);
  const brackets = BRACKETS[shape];
  if (brackets) return `${id}${brackets[0]}${quoted(text)}${brackets[1]}`;
  const named = `shape: ${NAMED[shape]}`;
  return text
    ? `${id}@{ ${named}, label: "${text.replace(/\}/g, "#125;")}" }`
    : `${id}@{ ${named} }`;
}

/** The marks of a flow's ends in Mermaid. */
const START_MARKS: Record<Marker, string> = { arrow: "<", circle: "o", cross: "x" };
const END_MARKS: Record<Marker, string> = { arrow: ">", circle: "o", cross: "x" };

/** A flow's operator by its stroke, from the marks of its two ends. */
const OPERATORS: Record<FlowEdge["stroke"], (start: string, end: string) => string> = {
  invisible: () => "~~~",
  thick: (start, end) => `${start}==${end || "="}`,
  dotted: (start, end) => `${start}-.-${end}`,
  solid: (start, end) => `${start}--${end || "-"}`,
};

/** A flow's line. */
function flowLine(flow: Flow): string {
  const start = flow.start ? START_MARKS[flow.start] : "",
    end = flow.end ? END_MARKS[flow.end] : "";
  const operator = OPERATORS[flow.stroke](start, end);
  const label = flow.label ? `|${quoted(escapeLabel(flow.label).replace(/\|/g, "#124;"))}|` : "";
  return `${flow.source} ${operator}${label} ${flow.target}`;
}

/** Ids the parser takes as keywords. */
const KEYWORDS = [
  "end",
  "subgraph",
  "graph",
  "flowchart",
  "direction",
  "style",
  "linkStyle",
  "classDef",
  "class",
  "click",
];
/** The ids an imported node may keep: a Mermaid id. */
const MERMAID_ID = /^[\p{L}\p{N}_]+(?:-(?![->.])[\p{L}\p{N}_]+)*$/u;
const PLAIN_ID = /^[A-Za-z_]\w*$/;

const FALLBACK: Record<string, string> = {
  initial: "start",
  final: "stop",
  "flow-final": "flowEnd",
  diamond: "decision",
  bar: "fork",
  subgraph: "group",
  lane: "lane",
};

/**
 * The text measure that sizes a node drawn by hand, to center it where its shape stood: the one an
 * export lays out with when it is given none (a canvas in the browser, an estimate elsewhere).
 */
const roughMeasure: Measure = (text, size, weight) => textMeasure("system-ui")(text, size, weight);

/** The symbols a flow may not lead from back to themselves. */
const NO_SELF_LOOP = new Set<Part["kind"]>(["diamond", "initial", "final", "flow-final"]);

/** Whether a part may be the end of a flow: a node or a subgraph. */
const isFlowEnd = (part: Part) => isShape(part.kind) || part.kind === "subgraph";

/** The stroke of a flow's line: invisible, dashed, thick or solid. */
function strokeOf(drawing: Drawing, item: Cell, style: Style): FlowEdge["stroke"] {
  if (roleOf(drawing, item) === "invisible" || style.get("strokeColor") === "none")
    return "invisible";
  if (dashed(style)) return "dotted";
  return Number(style.get("strokeWidth") ?? 1) >= THICK ? "thick" : "solid";
}

/**
 * A page read as an activity, in its phases: the parts by picture, lanes or subgraphs, texts as
 * names and labels, ids, nesting, flows, the source written out, and the places of its nodes.
 */
class ActivityPage {
  private readonly drawing: Drawing;
  private readonly reading: Reading;
  private readonly warnings: string[];
  /** The type the page says it draws, when this package wrote it. */
  private readonly said?: DrawioKind;
  private readonly kind: "flowchart" | "swimlane";
  private readonly lanes: Part[];
  private readonly groups: Part[];
  private readonly nodes: NodePart[];
  private readonly flowCells: Cell[];
  /** A flow's label taken from a text beside it. */
  private readonly edgeLabels = new Map<string, string>();
  private readonly byCell: Map<string, Part>;
  private readonly idOf = new Map<Part, string>();
  /** The id each part is written with: anonymous subgraphs are numbered as the parser numbers them. */
  private readonly realId = new Map<Part, string>();
  private anonymous = 0;
  private readonly parentOf = new Map<Part, Part | undefined>();
  private readonly flows: ReadFlow[] = [];

  constructor(drawing: Drawing) {
    this.drawing = drawing;
    this.reading = readParts(drawing);
    this.warnings = this.reading.warnings;
    const { parts } = this.reading;
    this.said = drawing.data.tamDiagram as DrawioKind | undefined;
    const lanes = parts.filter((part) => part.kind === "lane" || part.kind === "lane-none");
    const swimlane = this.said === "swimlane" || (this.said !== "flowchart" && lanes.length);
    this.kind = swimlane ? "swimlane" : "flowchart";
    if (swimlane) {
      this.lanes = this.allLanes(lanes);
      this.groups = [];
    } else {
      for (const lane of lanes) lane.kind = "subgraph";
      this.lanes = [];
      this.groups = parts.filter((part) => part.kind === "subgraph");
    }
    this.nodes = parts.filter((part): part is NodePart => isShape(part.kind));
    if (!this.nodes.length)
      throw new DrawioError(
        `Nothing on the page “${drawing.name}” reads as a node of an activity.`,
      );
    this.flowCells = drawing.parts.filter((item) => this.isFlow(item));
    this.byCell = new Map(parts.map((part) => [part.cell.id, part]));
  }

  read(): Imported {
    for (const text of this.reading.parts.filter((part) => part.kind === "text"))
      this.placeText(text);
    this.nameParts();
    this.nest();
    for (const item of this.flowCells) this.readFlow(item);
    const direction = directionOf(this.drawing, this.reading, this.flows, this.lanes);
    const vertical = direction === "TB" || direction === "BT";
    const laneOrder = this.lanes.toSorted((a, b) =>
      vertical ? a.box.x - b.box.x : a.box.y - b.box.y,
    );
    const automatic = this.write(direction, laneOrder);
    const places = this.places(automatic, laneOrder, vertical);
    return {
      source: automatic + places.join("\n") + (places.length ? "\n" : ""),
      kind: this.kind,
      warnings: this.warnings,
    };
  }

  /**
   * The lanes of a swimlane page: rectangles that hold nodes are lanes too; one inside a lane is
   * not read.
   */
  private allLanes(lanes: Part[]): Part[] {
    for (const group of this.reading.parts.filter((part) => part.kind === "subgraph")) {
      if (
        lanes.some(
          (lane) => contains(lane.box, center(group.box)) && area(lane.box) > area(group.box),
        )
      )
        this.warnings.push(
          `The group “${group.label}” stands inside a lane, which a swimlane diagram does not take; its nodes stay in the lane.`,
        );
      else lanes.push(group);
    }
    for (const lane of lanes) lane.kind = lane.kind === "lane-none" ? "lane-none" : "lane";
    return lanes;
  }

  private isFlow(item: Cell) {
    const { drawing, reading } = this;
    return (
      !!item.edge &&
      !reading.marks.has(item.id) &&
      roleOf(drawing, item) !== "link" &&
      !reading.partOf.has(item.id)
    );
  }

  // Texts

  /** A text on its own: a symbol's name or question, or a flow's label. */
  private placeText(text: Part) {
    if (!text.label) return;
    const near = this.symbolNear(text);
    const line = this.flowNear(text);
    const fromFlow = () => distanceTo(this.drawing.path(line!), center(text.box));
    if (near && (!line || namesSymbol(text, near, fromFlow()))) near.label = text.label;
    else if (line) this.edgeLabels.set(line.id, text.label);
    else this.warnings.push(`The text “${text.label}” belongs to no node or flow and is left out.`);
  }

  /** The nearest unnamed symbol a text may name. */
  private symbolNear(text: Part) {
    return this.nodes
      .filter((part) => SYMBOLS.has(part.kind) && !part.label && gap(part.box, text.box) < 40)
      .toSorted((a, b) => gap(a.box, text.box) - gap(b.box, text.box))[0];
  }

  /** The nearest unlabeled flow a text may label. */
  private flowNear(text: Part) {
    const { drawing } = this;
    const from = (item: Cell) => distanceTo(drawing.path(item), center(text.box));
    return this.flowCells
      .filter((item) => !drawing.label(item) && !this.edgeLabels.has(item.id) && from(item) < 30)
      .toSorted((a, b) => from(a) - from(b))[0];
  }

  /** The title: the page's title cell, else the page's name unless that is a default name. */
  private title(): string | undefined {
    const { drawing } = this;
    let title = this.reading.parts.find((part) => part.kind === "title")?.label;
    if (!title && !this.said && drawing.name && !/^Page-\d+$/.test(drawing.name))
      title = drawing.name;
    return title === "Activity diagram" ? undefined : title;
  }

  // Ids and nesting

  /** Ids: the page's own where they are Mermaid ids, else made from the labels. */
  private nameParts() {
    const ids = new Ids(KEYWORDS);
    const all = [...this.lanes, ...this.groups, ...this.nodes];
    const fallback = (part: Part) => FALLBACK[part.kind] ?? "step";
    for (const part of all.filter((part) => part.tagged && !part.of)) {
      if (part.kind === "lane-none") continue;
      this.idOf.set(
        part,
        part.cell.id.startsWith("subgraph#")
          ? part.cell.id
          : ids.of(part.cell.id, part.label, fallback(part), MERMAID_ID),
      );
    }
    for (const part of all.filter((part) => !part.tagged))
      this.idOf.set(
        part,
        this.isAnonymousLane(part)
          ? `subgraph#`
          : ids.of(part.cell.id, part.label, fallback(part), PLAIN_ID),
      );
  }

  /** Whether a part drawn by hand is a lane without a name. */
  private isAnonymousLane(part: Part) {
    return (
      (part.kind === "lane" || part.kind === "subgraph") && !part.label && this.kind === "swimlane"
    );
  }

  /** The part a copy stands for: its original. */
  private nodeOf(part: Part): Part {
    const original = part.of ? this.byCell.get(part.of) : undefined;
    return original ?? part;
  }

  /** Containment: the smallest lane or subgraph whose box holds the node. */
  private nest() {
    const holderOf = (part: Part, among: Part[]) =>
      among
        .filter(
          (other) =>
            other !== part &&
            area(other.box) > area(part.box) &&
            contains(other.box, center(part.box)),
        )
        .toSorted((a, b) => area(a.box) - area(b.box))[0];
    const containers = this.kind === "swimlane" ? this.lanes : this.groups;
    for (const part of this.nodes) this.parentOf.set(part, holderOf(part, containers));
    for (const group of this.groups)
      this.parentOf.set(
        group,
        holderOf(
          group,
          this.groups.filter((other) => inside(group.box, other.box, 2)),
        ),
      );
  }

  // Flows

  /** The part at an end of a flow: the one it is attached to, else the smallest one it stops at. */
  private endPart(id: string | undefined, point: Point | undefined): Part | undefined {
    const direct = id ? this.reading.partOf.get(id) : undefined;
    if (direct) return this.nodeOf(direct);
    if (!point) return undefined;
    return [...this.nodes, ...this.groups]
      .filter((part) => contains(part.box, point, LOOSE))
      .toSorted((a, b) => area(a.box) - area(b.box))[0];
  }

  /** A flow's label: its own, the text beside it, or a label cell on it. */
  private flowLabel(item: Cell): string {
    const { drawing } = this;
    return (
      drawing.label(item) ||
      this.edgeLabels.get(item.id) ||
      drawing
        .children(item.id)
        .map((child) => drawing.label(child))
        .find(Boolean) ||
      ""
    );
  }

  /** How a warning names a flow: by its label, else by where it starts. */
  private flowName(label: string, from: Part | undefined) {
    if (label) return `The flow “${label}”`;
    return `A flow${from ? ` from “${from.label || this.idOf.get(from)}”` : ""}`;
  }

  private readFlow(item: Cell) {
    const { drawing } = this;
    const style = drawing.style(item),
      path = drawing.path(item);
    const label = this.flowLabel(item);
    const from = this.endPart(item.source, path[0]),
      to = this.endPart(item.target, path.at(-1));
    const name = this.flowName(label, from);
    if (!from || !to || !isFlowEnd(from) || !isFlowEnd(to)) {
      this.warnings.push(`${name} is not connected to a node at both ends and is left out.`);
      return;
    }
    if (!this.joins(item, name, from, to)) return;
    const stroke = strokeOf(drawing, item, style);
    const visible = stroke !== "invisible";
    this.flows.push({
      from,
      to,
      source: "",
      target: "",
      label: from.kind === "diamond" ? label.replace(/^\[([\s\S]*)\]$/, "$1") : label,
      stroke,
      start: visible ? markerAt(style, "start") : undefined,
      end: visible ? markerAt(style, "end") : undefined,
    });
  }

  /**
   * Whether a flow joins two nodes UML lets it join; one drawn only up to a node is read as
   * connected, with a word to say so.
   */
  private joins(item: Cell, name: string, from: Part, to: Part): boolean {
    this.warnDrawnUpTo(name, item.source, from);
    this.warnDrawnUpTo(name, item.target, to);
    if (from !== to || !NO_SELF_LOOP.has(from.kind)) return true;
    this.warnings.push(
      `${name} leads from a decision, initial or final node back to itself, which UML does not draw; it is left out.`,
    );
    return false;
  }

  /** A flow that only stops at a part is read as connected to it, with a word to say so. */
  private warnDrawnUpTo(name: string, end: string | undefined, part: Part) {
    if (end && this.reading.partOf.has(end)) return;
    this.warnings.push(
      `${name} is not attached to “${part.label || this.idOf.get(part)}”, only drawn up to it; it is read as connected.`,
    );
  }

  // The source

  /** The order of the source: the page's own when this package wrote it, else reading order. */
  private ordered<T extends Part>(parts: T[]) {
    return this.said
      ? parts.toSorted((a, b) => a.order - b.order)
      : readingOrder(parts, (part) => part.box);
  }

  /** The source without places: the header, the containers with their nodes, the flows. */
  private write(direction: Direction, laneOrder: Part[]): string {
    const lines: string[] = [];
    const title = this.title();
    if (title) lines.push("---", `title: ${title.replace(/\n/g, " ")}`, "---");
    lines.push(`${this.kind === "swimlane" ? "swimlane-beta" : "flowchart"} ${direction}`);
    if (this.kind === "swimlane") this.writeLanes(lines, laneOrder);
    else this.writeGroups(lines, undefined, "  ");
    for (const flow of this.flows) {
      flow.source = this.realId.get(flow.from) ?? this.idOf.get(flow.from)!;
      flow.target = this.realId.get(flow.to) ?? this.idOf.get(flow.to)!;
      lines.push(`  ${flowLine(flow)}`);
    }
    return lines.join("\n") + "\n";
  }

  private nodeLine(lines: string[], part: Part, indent: string) {
    const id = this.idOf.get(part)!;
    this.realId.set(part, id);
    lines.push(`${indent}${declaration(id, part.kind as Shape, part.label)}`);
  }

  /** The line that opens a lane or subgraph; one without an id is numbered as the parser does. */
  private opening(part: Part) {
    const id = this.idOf.get(part)!;
    if (id.startsWith("subgraph#")) {
      this.realId.set(part, `subgraph#${++this.anonymous}`);
      return part.label ? `subgraph "${escapeLabel(part.label)}"` : "subgraph";
    }
    this.realId.set(part, id);
    return `subgraph ${id} [${quoted(escapeLabel(part.label))}]`;
  }

  /** The lanes with their nodes, then the nodes outside every named lane. */
  private writeLanes(lines: string[], laneOrder: Part[]) {
    const originals = this.nodes.filter((part) => !part.of);
    for (const lane of laneOrder) {
      if (lane.kind === "lane-none") continue;
      lines.push(`  ${this.opening(lane)}`);
      for (const node of this.ordered(originals.filter((part) => this.parentOf.get(part) === lane)))
        this.nodeLine(lines, node, "    ");
      lines.push("  end");
    }
    const outside = (part: Part) => {
      const lane = this.parentOf.get(part);
      return !lane || lane.kind === "lane-none";
    };
    for (const node of this.ordered(originals.filter(outside))) this.nodeLine(lines, node, "  ");
  }

  /** The subgraphs and nodes a subgraph holds, or the top level, in order and nested. */
  private writeGroups(lines: string[], holder: Part | undefined, indent: string) {
    const held = this.ordered([
      ...this.groups.filter((group) => this.parentOf.get(group) === holder),
      ...this.nodes.filter((node) => !node.of && this.parentOf.get(node) === holder),
    ]);
    for (const part of held) {
      if (part.kind !== "subgraph") {
        this.nodeLine(lines, part, indent);
        continue;
      }
      lines.push(`${indent}${this.opening(part)}`);
      this.writeGroups(lines, part, `${indent}  `);
      lines.push(`${indent}end`);
    }
  }

  // Places

  /** The places: where the page shows each node, and each subgraph that holds nothing. */
  private places(automatic: string, laneOrder: Part[], vertical: boolean): string[] {
    const chart = this.parse(automatic);
    const middleOf =
      this.kind === "swimlane"
        ? laneMover(chart, laneOrder, this.parentOf, vertical)
        : (part: Part) => center(part.box);
    return [...this.nodePlaces(chart, middleOf, vertical), ...this.emptyGroupPlaces(chart)].map(
      ([id, at]) => `%% @${id} ${Math.round(at.x)},${Math.round(at.y)}`,
    );
  }

  /**
   * Where each node stands, by the id the layout knows it by. A node drawn by hand keeps its middle:
   * the layout gives it its own size.
   */
  private nodePlaces(
    chart: Flowchart,
    middleOf: (part: Part) => Point,
    vertical: boolean,
  ): [string, Point][] {
    const split = splitDecisions(splitFinals(chart));
    const degree = degrees(split.edges);
    const drawnAt = (key: string, part: Part): Point => {
      const size = nodeBox(split.nodes.get(key)!, degree(key), vertical, roughMeasure);
      const middle = middleOf(part);
      return { x: middle.x - size.width / 2, y: middle.y - size.height / 2 };
    };
    return this.nodes.flatMap((part): [string, Point][] => {
      const id = this.realId.get(this.nodeOf(part));
      if (!id) return [];
      const key = part.of ? `${id}${part.cell.id.slice(part.of.length)}` : id;
      return [[key, part.tagged || !split.nodes.has(key) ? part.box : drawnAt(key, part)]];
    });
  }

  /** Where each subgraph that holds nothing stands; the others take the room their nodes need. */
  private emptyGroupPlaces(chart: Flowchart): [string, Point][] {
    const holders = new Set(
      [...chart.nodes.values(), ...chart.subgraphs.values()].map((item) => item.parent),
    );
    return this.groups.flatMap((group): [string, Point][] => {
      const id = this.realId.get(group);
      return id && !holders.has(id) ? [[id, group.box]] : [];
    });
  }

  private parse(automatic: string): Flowchart {
    try {
      return parseFlowchart(automatic);
    } catch (error) {
      throw new DrawioError(
        `The page “${this.drawing.name}” reads as an activity that does not parse: ${(error as Error).message}`,
      );
    }
  }
}

const readActivity = (drawing: Drawing): Imported => new ActivityPage(drawing).read();

/**
 * Where the middle of a node drawn by hand stands in the lanes the layout makes: the lanes of a
 * swimlane diagram keep the widths their nodes give them (uml-placed.ts holds every node in its
 * lane), so a node keeps its share of its lane's width and its distance from the top of the lanes.
 */
function laneMover(
  chart: Flowchart,
  lanes: Part[],
  parentOf: Map<Part, Part | undefined>,
  vertical: boolean,
) {
  const laid = placeSwimlanes(chart, roughMeasure);
  const named = lanes.filter((lane) => lane.kind !== "lane-none");
  const across = vertical ? "x" : "y",
    along = vertical ? "y" : "x",
    size = vertical ? "width" : "height";
  const start = Math.min(...lanes.map((lane) => lane.box[along]));
  const top = Number.isFinite(start) ? start : 0;
  /** The lane a node is laid out in: its own, else the lane for nodes outside every lane. */
  const laneIndex = (lane: Part | undefined) =>
    lane && lane.kind !== "lane-none" ? named.indexOf(lane) : laid.lanes.length - 1;
  return (part: Part): Point => {
    const middle = center(part.box),
      lane = parentOf.get(part);
    const index = laneIndex(lane);
    const share = lane ? (middle[across] - lane.box[across]) / (lane.box[size] || 1) : 0.5;
    const moved = {
      [across]: laid.laneX[index] + Math.max(0, Math.min(1, share)) * laid.laneWidths[index],
      [along]: middle[along] - top,
    };
    return { x: moved.x, y: moved.y };
  };
}

/**
 * Whether a black shape is a symbol that flows connect to; the dots of TAM's Multiple Dots and
 * 3 Dots are black ellipses without an outline.
 */
const isBlackSymbol = (item: Cell, style: Style) =>
  isDark(style) &&
  style.get("strokeColor") !== "none" &&
  style.get("connectable") !== "0" &&
  item.connectable !== false;

/** Whether a rectangle is rounded as a TAM-AD Action. */
const isActionLike = (style: Style) =>
  isOn(style, "rounded") && Number(style.get("arcSize") ?? 0) >= 30;

/**
 * What a vertex drawn by hand weighs toward an activity, by its shape: the symbols only an
 * activity draws weigh most, a rounded box little.
 */
const PICTURE_SCORES = new Map<string, (drawing: Drawing, item: Cell, style: Style) => number>([
  ["partialRectangle", () => 5],
  ["group", (drawing, item) => (endGroup(drawing, item) ? 5 : 0)],
  ["endState", () => 4],
  ["endactivity", () => 4],
  ["sumEllipse", () => 4],
  ["rhombus", () => 4],
  ["line", (_, __, style) => (thickLine(style) ? 4 : 0)],
  ["ellipse", (_, item, style) => (isBlackSymbol(item, style) ? 4 : 0)],
  ["rect", (_, item, style) => (isBlackSymbol(item, style) ? 4 : isActionLike(style) ? 1 : 0)],
]);

/** What a vertex drawn by hand weighs toward an activity, by its picture. */
function pictureScore(drawing: Drawing, item: Cell): number {
  const style = drawing.style(item);
  return PICTURE_SCORES.get(shapeOf(style))?.(drawing, item, style) ?? 0;
}

/** Whether a cell is a piece of a TAM-AD end node's group. */
function inEndGroup(drawing: Drawing, item: Cell): boolean {
  const parent = drawing.parentOf(item);
  return !!parent && shapeOf(drawing.style(parent)) === "group" && !!endGroup(drawing, parent);
}

/** What a cell this package wrote weighs toward an activity: a node, lane or subgraph. */
const roleScore = (role: string) =>
  ROLES.has(role) && role !== "frame" && role !== "title" ? 3 : 0;

/**
 * How much a page looks like an activity: lanes, end nodes, decisions, bars and actions. The
 * symbols only an activity draws weigh most; an action weighs little, for TAM-BD draws a storage
 * with the same rounded box.
 */
function likeness(drawing: Drawing): number {
  let score = 0;
  for (const item of drawing.parts) {
    if (!item.vertex || inEndGroup(drawing, item)) continue;
    const role = roleOf(drawing, item);
    score += role ? roleScore(role) : pictureScore(drawing, item);
  }
  return score;
}

export const activityDrawio: DrawioType = {
  kinds: ["flowchart", "swimlane"],
  cells: exportCells,
  likeness,
  read: readActivity,
};
