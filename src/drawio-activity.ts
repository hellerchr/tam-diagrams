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

/** The style of a node's shape: TAM-AD where the library has it, draw.io's own shape otherwise. */
function shapeStyle(shape: Shape): Record<string, string | number> {
  const plain = { whiteSpace: "wrap", html: 1, strokeWidth: 2 };
  switch (shape) {
    case "rect":
    case "round":
    case "stadium":
      return { ...TAMSHAPES.action };
    case "initial":
      return { ...TAMSHAPES.initial };
    case "final":
      // One cell that draws the TAM-AD End of Activity, so flows connect to it as one node.
      return {
        ellipse: "",
        shape: "endState",
        fillColor: "#000000",
        aspect: "fixed",
        strokeWidth: 2,
        html: 1,
      };
    case "flow-final":
      return {
        ellipse: "",
        shape: "sumEllipse",
        perimeter: "ellipsePerimeter",
        aspect: "fixed",
        strokeWidth: 2,
        html: 1,
      };
    case "diamond":
      return { ...TAMSHAPES.decision };
    case "bar":
      return { ...TAMSHAPES.bar };
    case "circle":
      return { ellipse: "", aspect: "fixed", ...plain };
    case "double-circle":
      return { ellipse: "", shape: "doubleEllipse", aspect: "fixed", ...plain };
    case "cylinder":
      return { shape: "cylinder3", boundedLbl: 1, backgroundOutline: 1, size: 8, ...plain };
    case "subroutine":
      return { shape: "process", fixedSize: 1, size: 8, backgroundOutline: 1, ...plain };
    case "hexagon":
      return { shape: "hexagon", perimeter: "hexagonPerimeter2", fixedSize: 1, size: 14, ...plain };
    case "lean-right":
    case "lean-left":
      return {
        shape: "parallelogram",
        perimeter: "parallelogramPerimeter",
        fixedSize: 1,
        size: 14,
        flipH: shape === "lean-left" ? 1 : undefined!,
        ...plain,
      };
    case "trapezoid":
    case "trapezoid-top":
      return {
        shape: "trapezoid",
        perimeter: "trapezoidPerimeter",
        fixedSize: 1,
        size: 14,
        flipV: shape === "trapezoid-top" ? 1 : undefined!,
        ...plain,
      };
    case "flag":
      return { shape: "step", perimeter: "stepPerimeter", fixedSize: 1, size: 12, ...plain };
  }
}

/** Label keys that stand a symbol's name or question where the scene draws it, beside the symbol. */
function besideStyle(shape: Box, text: Box): Record<string, string> {
  const cx = text.x + text.width / 2,
    cy = text.y + text.height / 2;
  const horizontal = cx > shape.x + shape.width ? "right" : cx < shape.x ? "left" : "center";
  const vertical = cy < shape.y ? "top" : cy > shape.y + shape.height ? "bottom" : "middle";
  return {
    labelPosition: horizontal,
    align: horizontal === "right" ? "left" : horizontal === "left" ? "right" : "center",
    verticalLabelPosition: vertical,
    verticalAlign: vertical === "top" ? "bottom" : vertical === "bottom" ? "top" : "middle",
  };
}

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
  const x = Math.min(...texts.map((text) => text.box.x)),
    y = Math.min(...texts.map((text) => text.box.y));
  return {
    x,
    y,
    width: Math.max(...texts.map((text) => text.box.x + text.box.width)) - x,
    height: Math.max(...texts.map((text) => text.box.y + text.box.height)) - y,
  };
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

/** The lanes of a swimlane scene: the frame, and each lane's box between the lines that part them. */
function laneBoxes(
  scene: Scene,
  count: number,
  vertical: boolean,
): { frame: Box; lanes: Box[] } | undefined {
  const frameLine = scene.lines.find(
    ({ points }) =>
      points.length === 5 && points[0].x === points[4].x && points[0].y === points[4].y,
  );
  if (!frameLine) return undefined;
  const xs = frameLine.points.map((p) => p.x),
    ys = frameLine.points.map((p) => p.y);
  const frame = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
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

/** The lanes of a swimlane activity: TAM-AD swimlanes in a frame, each holding its nodes. */
function laneCells(job: Export, taken: Set<string>) {
  const { split, scene } = job;
  const vertical = split.direction === "TB" || split.direction === "BT";
  const lanes = [...split.subgraphs.values()]
    .filter((subgraph) => !subgraph.parent)
    .map((subgraph) => ({ id: subgraph.id, label: subgraph.label }));
  if ([...split.nodes.values()].some((node) => !node.parent) || !lanes.length) {
    let id = "lane";
    for (let index = 1; taken.has(id); index++) id = `lane${index}`;
    taken.add(id);
    lanes.push({ id: "", label: "" });
    lanes.at(-1)!.id = id;
  }
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
  const across = vertical
    ? { spacingTop: 10 }
    : {
        top: undefined,
        bottom: undefined,
        left: 0,
        right: 0,
        verticalAlign: "middle",
        align: "left",
        spacingLeft: 14,
      };
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
            ...across,
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
  for (const node of split.nodes.values())
    job.holder.set(node.id, node.parent ?? lanes.find((lane) => !split.subgraphs.has(lane.id))!.id);
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

/** A node: its shape with its text inside, or a symbol with its name beside it. */
function nodeCell(job: Export, id: string) {
  const shape = job.shapes.get(id),
    node = job.split.nodes.get(id)!;
  if (!shape) return;
  const parent =
    job.holder.get(id) ?? (job.chart.kind === "flowchart" ? (node.parent ?? undefined) : undefined);
  const original = originalOf(job.chart, id);
  const texts = job.scene.texts.filter((text) => text.owner === id && text.role === "label");
  const side = boxAround(texts);
  const label = node.label;
  const fill =
    node.shape === "initial" || node.shape === "final" || node.shape === "bar"
      ? undefined
      : fillOf(shape);
  job.boxes.set(id, shape.box);
  job.cells.push(
    cell(
      {
        id,
        parent: parent ?? LAYER,
        value: valueOf(label),
        vertex: true,
        style: {
          ...shapeStyle(node.shape),
          ...(fill ? { fillColor: fill } : {}),
          ...(SYMBOLS.has(node.shape) && label
            ? besideStyle(shape.box, side ?? { ...shape.box, x: shape.box.x + shape.box.width + 4 })
            : {}),
          fontSize: SYMBOLS.has(node.shape) ? fontOf(texts) : FONT_SIZE,
          tamFlow: job.flow,
          tamOf: original === id ? undefined : original,
        },
        geometry: vertexGeometry(shape.box, parent ? job.boxes.get(parent) : undefined),
      },
      node.shape,
    ),
  );
}

/** A flow: an arrow along the scene's wire, or an invisible link between its nodes. */
function edgeCell(job: Export, edge: FlowEdge, id: string) {
  const label = edge.label ? guardText(job.chart, edge) : "";
  const ends = { source: edge.source, target: edge.target };
  const role = job.chart.edges.some((item) => item.id === edge.id) ? "flow" : "link";
  if (edge.stroke === "invisible") {
    job.cells.push(
      cell(
        {
          id,
          parent: LAYER,
          value: label ? valueOf(label) : undefined,
          edge: true,
          ...ends,
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
      ),
    );
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
        ...ends,
        style: {
          ...TAMSHAPES.connection,
          ...endStyle("start", edge.start),
          ...endStyle("end", edge.end),
          ...(edge.stroke === "dotted" ? { dashed: 1, dashPattern: "5 4" } : {}),
          ...(edge.stroke === "thick" ? { strokeWidth: 3 } : {}),
          ...route.style,
          fontSize: fontOf(texts),
        },
        geometry,
      },
      role,
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
  // Containers before what they hold, each in the order of the source.
  const done = new Set<string>();
  const add = (id: string) => {
    if (done.has(id)) return;
    done.add(id);
    const parent = split.nodes.get(id)?.parent ?? split.subgraphs.get(id)?.parent;
    if (chart.kind === "flowchart" && parent) add(parent);
    if (split.subgraphs.has(id)) {
      if (chart.kind === "flowchart") subgraphCell(job, id);
    } else nodeCell(job, id);
  };
  split.order.forEach(add);
  for (const edge of split.edges) {
    let id = edge.id;
    if (taken.has(id)) id = `flow#${edge.id}`;
    taken.add(id);
    edgeCell(job, edge, id);
  }
  return job.cells;
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

/** The kind a vertex has by its picture alone; undefined for one that is no part of an activity. */
function pictured(
  drawing: Drawing,
  item: Cell,
  style: Style,
  holds: boolean,
): Part["kind"] | "note" | "other" {
  const shape = shapeOf(style);
  switch (shape) {
    case "partialRectangle":
      return "lane";
    case "endState":
    case "endactivity":
      return "final";
    case "line":
      // The Fork or Join of the tam-drawio plugin is a line drawn thick.
      return thickLine(style) ? "bar" : "other";
    case "sumEllipse":
    case "orEllipse":
      return "flow-final";
    case "doubleEllipse":
      return isDark(style) ? "final" : "double-circle";
    case "ellipse":
      return isDark(style) ? "initial" : "circle";
    case "rhombus":
      return "diamond";
    case "cylinder":
    case "cylinder3":
    case "datastore":
      return "cylinder";
    case "process":
      return "subroutine";
    case "hexagon":
      return "hexagon";
    case "parallelogram":
      return isOn(style, "flipH") ? "lean-left" : "lean-right";
    case "trapezoid":
      return isOn(style, "flipV") ? "trapezoid-top" : "trapezoid";
    case "step":
      return "flag";
    case "text":
    case "label":
      return "text";
    case "swimlane":
      return "subgraph";
    case "note":
    case "note2":
      return "note";
    case "rect": {
      if (isDark(style)) return "bar";
      if (style.get("strokeColor") === "none" && (style.get("fillColor") ?? "none") === "none")
        return "text";
      if (holds || isOn(style, "container"))
        return drawing.label(item) || style.get("fillColor") !== "none" ? "subgraph" : "frame";
      // A TAM-AD Action is rounded, an Object Node is not. The syntax has no plain rectangle for an
      // object node (square brackets draw an action too), so it reads as the syntax's object node, the
      // cylinder.
      return isOn(style, "rounded") ? "round" : "cylinder";
    }
    default:
      return "other";
  }
}

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

function readParts(drawing: Drawing): Reading {
  const reading: Reading = { parts: [], partOf: new Map(), marks: new Set(), warnings: [] };
  const vertices = drawing.parts.filter((item) => item.vertex && !drawing.parentOf(item)?.edge);
  const absorbed = new Set<string>();
  const ordered = new Map(drawing.parts.map((item, index) => [item.id, index]));
  const add = (item: Cell, kind: Part["kind"], tagged: boolean) => {
    const part: Part = {
      cell: item,
      kind,
      box: drawing.box(item),
      label: drawing.label(item),
      tagged,
      of: tagged ? drawing.style(item).get("tamOf") : undefined,
      order: ordered.get(item.id) ?? 0,
    };
    reading.parts.push(part);
    reading.partOf.set(item.id, part);
    return part;
  };
  // The TAM-AD end nodes are groups: the group is the node, its pieces belong to it.
  for (const item of vertices) {
    const style = drawing.style(item);
    if (roleOf(drawing, item) || shapeOf(style) !== "group") continue;
    const kind = endGroup(drawing, item);
    if (!kind) continue;
    const part = add(item, kind, false);
    for (const piece of drawing.descendants(item.id)) {
      absorbed.add(piece.id);
      reading.partOf.set(piece.id, part);
      if (piece.edge) reading.marks.add(piece.id);
    }
  }
  const boxes = new Map(vertices.map((item) => [item.id, drawing.box(item)]));
  const holds = (item: Cell) => {
    const box = boxes.get(item.id)!;
    return vertices.some((other) => {
      if (other === item || absorbed.has(other.id)) return false;
      const inner = boxes.get(other.id)!;
      return (
        drawing.parentOf(other) === item ||
        (inner.width * inner.height < box.width * box.height &&
          inside(inner, box, 2) &&
          shapeOf(drawing.style(other)) !== "text")
      );
    });
  };
  for (const item of vertices) {
    if (absorbed.has(item.id)) continue;
    const style = drawing.style(item),
      role = roleOf(drawing, item);
    if (role && ROLES.has(role)) {
      add(item, role as Part["kind"], true);
      continue;
    }
    if (shapeOf(style) === "group") continue;
    const kind = pictured(drawing, item, style, holds(item));
    if (kind === "note" || kind === "other") {
      const label = drawing.label(item);
      if (kind === "other" && label) {
        add(item, "round", false);
        reading.warnings.push(
          `The shape “${label}” is no shape of an activity diagram and is read as an action.`,
        );
      } else if (label)
        reading.warnings.push(
          `The note “${label}” is left out: activity diagrams have no notes in this syntax (Mermaid flowcharts have none).`,
        );
      continue;
    }
    add(item, kind, false);
  }
  stackedEnds(drawing, reading);
  return reading;
}

/**
 * End nodes drawn from pieces that are not grouped: a white circle with a black dot on it is the
 * End of Activity, a white circle crossed by two lines the End of Flow.
 */
function stackedEnds(drawing: Drawing, reading: Reading) {
  const rings = reading.parts.filter(
    (part) => part.kind === "circle" && !part.tagged && !part.label,
  );
  for (const ring of rings) {
    const dot = reading.parts.find(
      (part) =>
        part.kind === "initial" &&
        !part.tagged &&
        part.box.width < ring.box.width &&
        inside(part.box, ring.box, 2),
    );
    if (dot) {
      ring.kind = "final";
      reading.parts.splice(reading.parts.indexOf(dot), 1);
      reading.partOf.set(dot.cell.id, ring);
      continue;
    }
    const cross = drawing.parts.filter((item) => {
      if (!item.edge || item.source || item.target || reading.marks.has(item.id)) return false;
      const path = drawing.path(item);
      return (
        path.length >= 2 &&
        path.every((point) => inside({ ...point, width: 0, height: 0 }, ring.box, 1))
      );
    });
    if (cross.length >= 2) {
      ring.kind = "flow-final";
      for (const line of cross) reading.marks.add(line.id);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Import: the activity

/** A node, lane or subgraph of the source being written. */
interface Item {
  part: Part;
  id: string;
  /** The subgraph or lane that holds it, by its part. */
  parent?: Part;
}

/** A flow of the source being written. */
interface Flow {
  source: string;
  target: string;
  label: string;
  stroke: FlowEdge["stroke"];
  start?: Marker;
  end?: Marker;
}

const center = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const area = (box: Box) => box.width * box.height;

/** The Mermaid marker of an end of a draw.io edge. */
function markerAt(style: Style, end: "start" | "end"): Marker | undefined {
  const arrow = arrowAt(style, end);
  if (arrow === "none") return undefined;
  if (arrow === "oval" || arrow === "circle" || arrow === "circlePlus" || arrow === "dot")
    return "circle";
  if (arrow === "cross") return "cross";
  return "arrow";
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

/** The way the flow runs: as the page says, else the way most flows point. */
function directionOf(
  drawing: Drawing,
  reading: Reading,
  flows: { from: Part; to: Part }[],
  lanes: Part[],
): Direction {
  for (const part of reading.parts) {
    const said = drawing.style(part.cell).get("tamFlow");
    if (said === "TB" || said === "BT" || said === "LR" || said === "RL") return said;
  }
  let dx = 0,
    dy = 0;
  for (const { from, to } of flows) {
    const a = center(from.box),
      b = center(to.box);
    dx += b.x - a.x;
    dy += b.y - a.y;
  }
  const columns =
    lanes.length > 1
      ? Math.abs(center(lanes[1].box).x - center(lanes[0].box).x) >
        Math.abs(center(lanes[1].box).y - center(lanes[0].box).y)
      : lanes.length === 1
        ? lanes[0].box.height >= lanes[0].box.width
        : Math.abs(dy) >= Math.abs(dx);
  return columns ? (dy < 0 ? "BT" : "TB") : dx < 0 ? "RL" : "LR";
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

/** A flow's line. */
function flowLine(flow: Flow): string {
  const mark = (marker: Marker | undefined, start: boolean) =>
    marker === "arrow"
      ? start
        ? "<"
        : ">"
      : marker === "circle"
        ? "o"
        : marker === "cross"
          ? "x"
          : "";
  const start = mark(flow.start, true),
    end = mark(flow.end, false);
  const operator =
    flow.stroke === "invisible"
      ? "~~~"
      : flow.stroke === "thick"
        ? `${start}==${end || "="}`
        : flow.stroke === "dotted"
          ? `${start}-.-${end}`
          : `${start}--${end || "-"}`;
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

function readActivity(drawing: Drawing): Imported {
  const reading = readParts(drawing);
  const { warnings } = reading;
  const said = drawing.data.tamDiagram as DrawioKind | undefined;
  let lanes = reading.parts.filter((part) => part.kind === "lane" || part.kind === "lane-none");
  const kind: "flowchart" | "swimlane" =
    said === "swimlane" || (said !== "flowchart" && lanes.length) ? "swimlane" : "flowchart";
  if (kind === "flowchart") for (const lane of lanes) lane.kind = "subgraph";
  let groups = reading.parts.filter((part) => part.kind === "subgraph");
  if (kind === "swimlane") {
    // Rectangles that hold nodes are lanes too; one inside a lane is not read.
    for (const group of groups) {
      if (
        lanes.some(
          (lane) => contains(lane.box, center(group.box)) && area(lane.box) > area(group.box),
        )
      )
        warnings.push(
          `The group “${group.label}” stands inside a lane, which a swimlane diagram does not take; its nodes stay in the lane.`,
        );
      else lanes.push(group);
    }
    groups = [];
    for (const lane of lanes) lane.kind = lane.kind === "lane-none" ? "lane-none" : "lane";
  } else lanes = [];
  const nodes = reading.parts.filter((part) => isShape(part.kind)) as (Part & { kind: Shape })[];
  if (!nodes.length)
    throw new DrawioError(`Nothing on the page “${drawing.name}” reads as a node of an activity.`);

  // Texts on their own: a symbol's name or question, a flow's label, or the title.
  let title = reading.parts.find((part) => part.kind === "title")?.label;
  const texts = reading.parts.filter((part) => part.kind === "text");
  const flowCells = drawing.parts.filter(
    (item) =>
      item.edge &&
      !reading.marks.has(item.id) &&
      roleOf(drawing, item) !== "link" &&
      !reading.partOf.has(item.id),
  );
  const edgeLabels = new Map<string, string>();
  for (const text of texts) {
    if (!text.label) continue;
    const near = nodes
      .filter((part) => SYMBOLS.has(part.kind) && !part.label && gap(part.box, text.box) < 40)
      .toSorted((a, b) => gap(a.box, text.box) - gap(b.box, text.box))[0];
    const line = flowCells
      .filter(
        (item) =>
          !drawing.label(item) &&
          !edgeLabels.has(item.id) &&
          distanceTo(drawing.path(item), center(text.box)) < 30,
      )
      .toSorted(
        (a, b) =>
          distanceTo(drawing.path(a), center(text.box)) -
          distanceTo(drawing.path(b), center(text.box)),
      )[0];
    if (
      near &&
      (!line || namesSymbol(text, near, distanceTo(drawing.path(line), center(text.box))))
    )
      near.label = text.label;
    else if (line) edgeLabels.set(line.id, text.label);
    else warnings.push(`The text “${text.label}” belongs to no node or flow and is left out.`);
  }
  if (!title && !said && drawing.name && !/^Page-\d+$/.test(drawing.name)) title = drawing.name;
  if (title === "Activity diagram") title = undefined;

  // Ids: the page's own where they are Mermaid ids, else made from the labels.
  const ids = new Ids(KEYWORDS);
  const idOf = new Map<Part, string>();
  const tagged = (part: Part) => part.tagged && !part.of;
  for (const part of [...lanes, ...groups, ...nodes].filter(tagged)) {
    if (part.kind === "lane-none") continue;
    if (part.cell.id.startsWith("subgraph#")) idOf.set(part, part.cell.id);
    else
      idOf.set(part, ids.of(part.cell.id, part.label, FALLBACK[part.kind] ?? "step", MERMAID_ID));
  }
  for (const part of [...lanes, ...groups, ...nodes].filter((part) => !part.tagged)) {
    if ((part.kind === "lane" || part.kind === "subgraph") && !part.label && kind === "swimlane")
      idOf.set(part, `subgraph#`);
    else idOf.set(part, ids.of(part.cell.id, part.label, FALLBACK[part.kind] ?? "step", PLAIN_ID));
  }
  // Copies stand for their original.
  const byCell = new Map(reading.parts.map((part) => [part.cell.id, part]));
  const nodeOf = (part: Part | undefined): Part | undefined =>
    part?.of && byCell.get(part.of) ? byCell.get(part.of) : part;

  // Containment: the smallest lane or subgraph whose box holds the node.
  const holderOf = (part: Part, among: Part[]) =>
    among
      .filter(
        (other) =>
          other !== part &&
          area(other.box) > area(part.box) &&
          contains(other.box, center(part.box)),
      )
      .toSorted((a, b) => area(a.box) - area(b.box))[0];
  const parentOf = new Map<Part, Part | undefined>();
  for (const part of nodes)
    parentOf.set(part, holderOf(part, kind === "swimlane" ? lanes : groups));
  for (const group of groups)
    parentOf.set(
      group,
      holderOf(
        group,
        groups.filter((other) => inside(group.box, other.box, 2)),
      ),
    );

  // Flows.
  const flows: (Flow & { from: Part; to: Part })[] = [];
  const endPart = (id: string | undefined, point: Point | undefined): Part | undefined => {
    const direct = id ? reading.partOf.get(id) : undefined;
    if (direct) return nodeOf(direct);
    if (!point) return undefined;
    return [...nodes, ...groups]
      .filter((part) => contains(part.box, point, LOOSE))
      .toSorted((a, b) => area(a.box) - area(b.box))[0];
  };
  for (const item of flowCells) {
    const style = drawing.style(item),
      path = drawing.path(item);
    const label =
      drawing.label(item) ||
      edgeLabels.get(item.id) ||
      drawing
        .children(item.id)
        .map((child) => drawing.label(child))
        .find(Boolean) ||
      "";
    const from = endPart(item.source, path[0]),
      to = endPart(item.target, path.at(-1));
    const name = label
      ? `The flow “${label}”`
      : `A flow${from ? ` from “${from.label || idOf.get(from)}”` : ""}`;
    if (
      !from ||
      !to ||
      (!isShape(from.kind) && from.kind !== "subgraph") ||
      (!isShape(to.kind) && to.kind !== "subgraph")
    ) {
      warnings.push(`${name} is not connected to a node at both ends and is left out.`);
      continue;
    }
    for (const [end, part] of [
      [item.source, from],
      [item.target, to],
    ] as const)
      if (!end || !reading.partOf.has(end))
        warnings.push(
          `${name} is not attached to “${part.label || idOf.get(part)}”, only drawn up to it; it is read as connected.`,
        );
    if (from === to && ["diamond", "initial", "final", "flow-final"].includes(from.kind)) {
      warnings.push(
        `${name} leads from a decision, initial or final node back to itself, which UML does not draw; it is left out.`,
      );
      continue;
    }
    const invisible = roleOf(drawing, item) === "invisible" || style.get("strokeColor") === "none";
    const stroke: FlowEdge["stroke"] = invisible
      ? "invisible"
      : dashed(style)
        ? "dotted"
        : Number(style.get("strokeWidth") ?? 1) >= THICK
          ? "thick"
          : "solid";
    const guard = from.kind === "diamond" ? label.replace(/^\[([\s\S]*)\]$/, "$1") : label;
    flows.push({
      from,
      to,
      source: "",
      target: "",
      label: guard,
      stroke,
      start: invisible ? undefined : markerAt(style, "start"),
      end: invisible ? undefined : markerAt(style, "end"),
    });
  }
  const direction = directionOf(drawing, reading, flows, lanes);
  const vertical = direction === "TB" || direction === "BT";

  // The order of the source: the page's own when this package wrote it, else reading order.
  const ordered = <T extends Part>(parts: T[]) =>
    said ? parts.toSorted((a, b) => a.order - b.order) : readingOrder(parts, (part) => part.box);
  const laneOrder = lanes.toSorted((a, b) => (vertical ? a.box.x - b.box.x : a.box.y - b.box.y));

  const lines: string[] = [];
  if (title) lines.push("---", `title: ${title.replace(/\n/g, " ")}`, "---");
  lines.push(`${kind === "swimlane" ? "swimlane-beta" : "flowchart"} ${direction}`);
  let anonymous = 0;
  const realId = new Map<Part, string>();
  const nodeLine = (part: Part, indent: string) => {
    const id = idOf.get(part)!;
    realId.set(part, id);
    lines.push(`${indent}${declaration(id, part.kind as Shape, part.label)}`);
  };
  const opening = (part: Part) => {
    const id = idOf.get(part)!;
    if (id === "subgraph#" || id.startsWith("subgraph#")) {
      const named = `subgraph#${++anonymous}`;
      realId.set(part, named);
      return part.label ? `subgraph "${escapeLabel(part.label)}"` : "subgraph";
    }
    realId.set(part, id);
    return `subgraph ${id} [${quoted(escapeLabel(part.label))}]`;
  };
  if (kind === "swimlane") {
    for (const lane of laneOrder) {
      if (lane.kind === "lane-none") continue;
      lines.push(`  ${opening(lane)}`);
      for (const node of ordered(nodes.filter((part) => !part.of && parentOf.get(part) === lane)))
        nodeLine(node, "    ");
      lines.push("  end");
    }
    for (const node of ordered(
      nodes.filter(
        (part) => !part.of && (!parentOf.get(part) || parentOf.get(part)!.kind === "lane-none"),
      ),
    ))
      nodeLine(node, "  ");
  } else {
    const emit = (holder: Part | undefined, indent: string) => {
      const inside = ordered([
        ...groups.filter((group) => parentOf.get(group) === holder),
        ...nodes.filter((node) => !node.of && parentOf.get(node) === holder),
      ]);
      for (const part of inside) {
        if (part.kind !== "subgraph") {
          nodeLine(part, indent);
          continue;
        }
        lines.push(`${indent}${opening(part)}`);
        emit(part, `${indent}  `);
        lines.push(`${indent}end`);
      }
    };
    emit(undefined, "  ");
  }
  for (const flow of flows) {
    flow.source = realId.get(flow.from) ?? idOf.get(flow.from)!;
    flow.target = realId.get(flow.to) ?? idOf.get(flow.to)!;
    lines.push(`  ${flowLine(flow)}`);
  }
  const automatic = lines.join("\n") + "\n";

  // Places: where the page shows each node, and each subgraph that holds nothing.
  let chart: Flowchart;
  try {
    chart = parseFlowchart(automatic);
  } catch (error) {
    throw new DrawioError(
      `The page “${drawing.name}” reads as an activity that does not parse: ${(error as Error).message}`,
    );
  }
  const split = splitDecisions(splitFinals(chart));
  const degree = degrees(split.edges);
  const moveIntoLane =
    kind === "swimlane" ? laneMover(chart, laneOrder, parentOf, vertical) : undefined;
  const places: string[] = [];
  const place = (id: string, at: Point) =>
    places.push(`%% @${id} ${Math.round(at.x)},${Math.round(at.y)}`);
  for (const part of nodes) {
    const original = nodeOf(part)!;
    const id = realId.get(original);
    if (!id) continue;
    const key = part.of ? `${id}${part.cell.id.slice(part.of.length)}` : id;
    if (part.tagged || !split.nodes.has(key)) {
      place(key, part.box);
      continue;
    }
    // A node drawn by hand keeps its middle: the layout gives it its own size.
    const size = nodeBox(split.nodes.get(key)!, degree(key), vertical, roughMeasure);
    const middle = moveIntoLane ? moveIntoLane(part) : center(part.box);
    place(key, { x: middle.x - size.width / 2, y: middle.y - size.height / 2 });
  }
  for (const group of groups) {
    const id = realId.get(group);
    if (
      id &&
      ![...chart.nodes.values(), ...chart.subgraphs.values()].some((item) => item.parent === id)
    )
      place(id, group.box);
  }
  return { source: automatic + places.join("\n") + (places.length ? "\n" : ""), kind, warnings };
}

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
  return (part: Part): Point => {
    const middle = center(part.box),
      lane = parentOf.get(part);
    const index = lane && lane.kind !== "lane-none" ? named.indexOf(lane) : laid.lanes.length - 1;
    const share = lane ? (middle[across] - lane.box[across]) / (lane.box[size] || 1) : 0.5;
    const moved = {
      [across]: laid.laneX[index] + Math.max(0, Math.min(1, share)) * laid.laneWidths[index],
      [along]: middle[along] - (Number.isFinite(start) ? start : 0),
    };
    return { x: moved.x, y: moved.y };
  };
}

/**
 * How much a page looks like an activity: lanes, end nodes, decisions, bars and actions. The
 * symbols only an activity draws weigh most; an action weighs little, for TAM-BD draws a storage
 * with the same rounded box.
 */
function likeness(drawing: Drawing): number {
  let score = 0;
  const inEndGroup = (item: Cell) => {
    const parent = drawing.parentOf(item);
    return !!parent && shapeOf(drawing.style(parent)) === "group" && !!endGroup(drawing, parent);
  };
  for (const item of drawing.parts) {
    if (!item.vertex || inEndGroup(item)) continue;
    const role = roleOf(drawing, item);
    if (role && ROLES.has(role)) {
      score += role === "frame" || role === "title" ? 0 : 3;
      continue;
    }
    if (role) continue;
    const style = drawing.style(item),
      shape = shapeOf(style);
    // The dots of TAM's Multiple Dots and 3 Dots are black ellipses without an outline.
    const symbol =
      style.get("strokeColor") !== "none" &&
      style.get("connectable") !== "0" &&
      item.connectable !== false;
    if (shape === "partialRectangle") score += 5;
    else if (shape === "group" && endGroup(drawing, item)) score += 5;
    else if (shape === "endState" || shape === "endactivity" || shape === "sumEllipse") score += 4;
    else if (shape === "rhombus") score += 4;
    else if (shape === "ellipse" && isDark(style) && symbol) score += 4;
    else if (shape === "rect" && isDark(style) && symbol) score += 4;
    else if (shape === "line" && thickLine(style)) score += 4;
    else if (shape === "rect" && isOn(style, "rounded") && Number(style.get("arcSize") ?? 0) >= 30)
      score += 1;
  }
  return score;
}

export const activityDrawio: DrawioType = {
  kinds: ["flowchart", "swimlane"],
  cells: exportCells,
  likeness,
  read: readActivity,
};
