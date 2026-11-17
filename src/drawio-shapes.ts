/**
 * What every diagram type's draw.io cells are made of: the shapes of the TAM libraries for draw.io,
 * the scene's colors, and the geometry that turns a scene's boxes and wires into cells and back.
 *
 * The styles are those of the TAMshapes libraries for draw.io (TAM-BD, TAM-AD, TAM-SeqD, TAM-Ann and
 * the State shape), https://github.com/f-m-c/TAMshapes, Apache License 2.0: a diagram exported here
 * is drawn with the shapes a draw.io user who opens those libraries draws with, and a diagram drawn
 * with those libraries reads back. Every cell this package writes also carries `tam=<role>` in its
 * style, which says what the shape alone cannot (an id's kind, a Mermaid shape variant).
 */

import { type DiagramColors, shapeFill } from "./draw.ts";
import {
  type Cell,
  type Drawing,
  formatStyle,
  type Geometry,
  isOn,
  LAYER,
  type Style,
  textToHtml,
} from "./drawio-file.ts";
import type { Box, Point, Scene, SceneShape } from "./scene.ts";
import { FONT } from "./text.ts";

/** The "R ▾" of a request/response channel: R above a triangle pointing down; rotated, it points elsewhere. */
export const REQUEST_STENCIL =
  "stencil(vVNRbsMgDD2NPycxqKb9Tm13gN0gA6dBpRABbbOdfgEnWpDSpZmmRSiI5+eHbWwQ29BULQJnDYgdcM5Z/+uP1/JYhRZlJKzWHSqCQ/TuiFet4uCubYNex2QVe2A7YC+QNBiI7XsljwfvzlYlG6G0Sh7w1zlqSaqdx2WxkU1xSmec7wHac7zWWaRU+lvvUaqdjUF/porlLas8slUaEbtIxSP3t6HGRh8sIRJtRE9wV95xmdBOWikzxP9B0Gai9UBvm3Hyvi9FbcxMqYALlr9VubZVao2Sd4s9+pzcBb8Tfyry+6HUS7JG24nsKDTq8r/S3fxPvM+/1pXGBVznmody7ilv9Q8N3HKbZOG5WSZSNg9dvP8C)";

/** Styles of the TAMshapes libraries, as keys and values to extend. */
export const TAMSHAPES = {
  /** TAM-BD Agent; TAM-AD Object Node and TAM-CD Class are the same rectangle. */
  agent: { rounded: 0, whiteSpace: "wrap", html: 1, strokeWidth: 2 },
  /** TAM-BD Storage; TAM-AD Action is the same rounded rectangle. */
  storage: { rounded: 1, whiteSpace: "wrap", html: 1, strokeWidth: 2, arcSize: 40 },
  action: { rounded: 1, whiteSpace: "wrap", html: 1, strokeWidth: 2, arcSize: 40 },
  /** The State shape: rounded less than an action. */
  state: { rounded: 1, whiteSpace: "wrap", html: 1, strokeWidth: 2, arcSize: 10 },
  /** A channel's circle, 20 across. */
  channel: {
    ellipse: "",
    whiteSpace: "wrap",
    html: 1,
    aspect: "fixed",
    strokeWidth: 2,
    rotatable: 0,
  },
  /** The request marker on a channel, 30 across; `rotation` turns its triangle from pointing down. */
  request: {
    shape: REQUEST_STENCIL,
    whiteSpace: "wrap",
    html: 1,
    connectable: 0,
    allowArrows: 0,
    rotatable: 1,
    editable: 0,
    expand: 0,
    aspect: "fixed",
  },
  /** Connections: arrows, connectors and channels of TAM-BD and TAM-AD. */
  connection: { rounded: 1, html: 1, align: "center", labelBackgroundColor: "none" },
  /** A dashed border line (TAM-Ann Border), also lifelines and protocol boundaries. */
  border: {
    dashed: 1,
    dashPattern: "5 5",
    strokeWidth: 2,
    strokeColor: "#666666",
    startArrow: "none",
    endArrow: "none",
    html: 1,
    endFill: 0,
  },
  /** TAM-Ann Note. */
  note: {
    shape: "note2",
    boundedLbl: 1,
    whiteSpace: "wrap",
    html: 1,
    size: 10,
    spacingLeft: 2,
    verticalAlign: "top",
    align: "left",
    fillColor: "#FFFFFF",
  },
  /** TAM-Ann Text. */
  text: {
    text: "",
    html: 1,
    strokeColor: "none",
    fillColor: "none",
    align: "center",
    verticalAlign: "middle",
    whiteSpace: "wrap",
    rounded: 0,
  },
  /** TAM-AD Start of Activity, also the initial state. */
  initial: {
    ellipse: "",
    fillColor: "#000000",
    whiteSpace: "wrap",
    html: 1,
    aspect: "fixed",
    strokeWidth: 2,
    rotatable: 0,
  },
  /** TAM-AD Decision or Merge. */
  decision: { rhombus: "", strokeWidth: 2, rotatable: 0, html: 1, whiteSpace: "wrap" },
  /** TAM-AD Fork or Join. */
  bar: {
    rounded: 0,
    fillColor: "#000000",
    whiteSpace: "wrap",
    html: 1,
    strokeWidth: 2,
    rotatable: 0,
  },
  /** TAM-AD Swimlane: dashed lines left and right. */
  lane: {
    shape: "partialRectangle",
    whiteSpace: "wrap",
    top: 0,
    bottom: 0,
    fillColor: "none",
    dashed: 1,
    dashPattern: "5 5",
    strokeWidth: 2,
    strokeColor: "#666666",
    verticalAlign: "top",
    fontStyle: 1,
    spacing: 0,
    html: 1,
  },
  /** TAM-SeqD Activation. */
  activation: { rounded: 0, whiteSpace: "wrap", html: 1, strokeWidth: 2, fillColor: "#E6E6E6" },
  /** TAM-CD Package: a folder. */
  package: {
    shape: "folder",
    fontStyle: 1,
    align: "left",
    spacingLeft: 2,
    boundedLbl: 1,
    labelInHeader: 1,
    collapsible: 0,
    recursiveResize: 0,
    tabWidth: 100,
    tabHeight: 20,
    tabPosition: "left",
    html: 1,
    fillColor: "#E6E6E6",
    strokeWidth: 2,
  },
} as const;

/** The colors an exported diagram is drawn in: the light theme of the editor. */
const EXPORT_COLORS: DiagramColors = {
  background: "#ffffff",
  text: "#1b1c1f",
  secondary: "#3f4146",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  font: "Helvetica",
  dark: false,
};

/** The fill a scene shape is drawn with, as draw.io writes a color; undefined for the page color. */
export function fillOf(shape: SceneShape): string | undefined {
  const fill = shapeFill(shape, EXPORT_COLORS).toUpperCase();
  return fill === "NONE" ? "none" : fill === "#FFFFFF" ? undefined : fill;
}

/** The size the cells' labels are written in, as the scene measures text. */
export const FONT_SIZE = FONT;

// ---------------------------------------------------------------------------------------------
// Ids

const ID = /^[A-Za-z_]\w*$/;

/**
 * Ids for the parts of an imported diagram: a cell's own id when the syntax takes it, else one made
 * from its label (`Order API` → `Order_API`), else `fallback` and a number; never one taken.
 */
export class Ids {
  private readonly taken: Set<string>;
  constructor(reserved: Iterable<string> = []) {
    this.taken = new Set([...reserved].map((word) => word.toLowerCase()));
  }
  /** Marks an id taken without asking for it. */
  take(id: string) {
    this.taken.add(id.toLowerCase());
  }
  /** An id for a cell: `pattern` says which ids the syntax takes. */
  of(cellId: string, label: string, fallback: string, pattern: RegExp = ID): string {
    const fresh = (id: string) => pattern.test(id) && !this.taken.has(id.toLowerCase());
    let id = cellId;
    if (!fresh(id)) {
      const made = label
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
      id = made && /^[A-Za-z_]/.test(made) ? made : made ? `${fallback}_${made}` : fallback;
      if (!fresh(id)) {
        let index = 1;
        while (!fresh(`${id}${index}`)) index++;
        id = `${id}${index}`;
      }
    }
    this.take(id);
    return id;
  }
}

// ---------------------------------------------------------------------------------------------
// Export geometry

const round = (value: number) => Math.round(value * 100) / 100;

/** A vertex's geometry from its box on the page and the box of the vertex it stands in. */
export function vertexGeometry(box: Box, parent?: Box): Geometry {
  return {
    x: round(box.x - (parent?.x ?? 0)),
    y: round(box.y - (parent?.y ?? 0)),
    width: round(box.width),
    height: round(box.height),
  };
}

/**
 * Where a point lies on a box: the fractions draw.io pins an edge's end with, in hundredths, and the
 * pixels left over, which on a tall bar or lifeline would otherwise move the end.
 */
function pin(point: Point, box: Box) {
  const fx = box.width ? (point.x - box.x) / box.width : 0.5,
    fy = box.height ? (point.y - box.y) / box.height : 0.5;
  const x = round(Math.max(0, Math.min(1, fx))),
    y = round(Math.max(0, Math.min(1, fy)));
  return {
    x,
    y,
    dx: round(point.x - box.x - x * box.width),
    dy: round(point.y - box.y - y * box.height),
  };
}

/**
 * Style keys and geometry for an edge that runs along `points` (page coordinates), from the shape
 * in `from` to the one in `to`: its ends pinned where the scene draws them, its bends as waypoints,
 * so draw.io draws it as the scene does. `parent` is the box of the vertex the edge stands in.
 */
export function edgeRoute(
  points: Point[],
  from: Box | undefined,
  to: Box | undefined,
  parent?: Box,
): { style: Record<string, string | number>; geometry: Geometry } {
  const shift = (p: Point) => ({
    x: round(p.x - (parent?.x ?? 0)),
    y: round(p.y - (parent?.y ?? 0)),
  });
  const style: Record<string, string | number> = {};
  const geometry: Geometry = { x: 0, y: 0, width: 0, height: 0, relative: true };
  const first = points[0],
    last = points.at(-1)!;
  if (from) {
    const at = pin(first, from);
    Object.assign(style, {
      exitX: at.x,
      exitY: at.y,
      exitDx: at.dx,
      exitDy: at.dy,
      exitPerimeter: 0,
    });
  } else geometry.sourcePoint = shift(first);
  if (to) {
    const at = pin(last, to);
    Object.assign(style, {
      entryX: at.x,
      entryY: at.y,
      entryDx: at.dx,
      entryDy: at.dy,
      entryPerimeter: 0,
    });
  } else geometry.targetPoint = shift(last);
  const bends = dropStraight(points.slice(1, -1), first, last);
  if (bends.length) geometry.points = bends.map(shift);
  return { style, geometry };
}

/** Bends without the ones that lie on the line through their neighbours. */
function dropStraight(bends: Point[], first: Point, last: Point): Point[] {
  const all = [first, ...bends, last];
  return bends.filter((point, index) => {
    const before = all[index],
      after = all[index + 2];
    const cross =
      (point.x - before.x) * (after.y - before.y) - (point.y - before.y) * (after.x - before.x);
    return Math.abs(cross) > 0.5 * Math.hypot(after.x - before.x, after.y - before.y);
  });
}

/** The share (0 to 1) of a path's length at which the point nearest `point` lies. */
function shareAlong(path: Point[], point: Point): number {
  let total = 0,
    best = { distance: Infinity, at: 0 };
  const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
  for (let i = 0; i < lengths.length; i++) {
    const a = path[i],
      b = path[i + 1],
      length = lengths[i];
    const t = length
      ? Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length ** 2,
          ),
        )
      : 0;
    const near = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const distance = Math.hypot(point.x - near.x, point.y - near.y);
    if (distance < best.distance) best = { distance, at: total + t * length };
    total += length;
  }
  return total ? best.at / total : 0.5;
}

/** The point at a share of a path's length. */
function pointAlong(path: Point[], share: number): Point {
  const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
  let left = share * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? Math.min(1, left / lengths[i]) : 0;
      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * t,
        y: path[i].y + (path[i + 1].y - path[i].y) * t,
      };
    }
    left -= lengths[i];
  }
  return path[0];
}

/**
 * The geometry of a mark that stands on an edge (a channel's circle, a label in a cell of its own)
 * centered at `center`, `size` across: draw.io keeps it on the edge when the edge moves.
 */
export function markOnEdge(
  path: Point[],
  center: Point,
  size: { width: number; height: number },
): Geometry {
  const share = shareAlong(path, center),
    at = pointAlong(path, share);
  return {
    x: round(share * 2 - 1),
    y: 0,
    width: round(size.width),
    height: round(size.height),
    relative: true,
    offset: {
      x: round(center.x - at.x - size.width / 2),
      y: round(center.y - at.y - size.height / 2),
    },
  };
}

/** Moves an edge's own label (its value) to `center`: x along the edge, the rest as offset. */
export function labelAt(geometry: Geometry, path: Point[], center: Point): Geometry {
  const share = shareAlong(path, center),
    at = pointAlong(path, share);
  return {
    ...geometry,
    x: round(share * 2 - 1),
    y: 0,
    offset: { x: round(center.x - at.x), y: round(center.y - at.y) },
  };
}

// ---------------------------------------------------------------------------------------------
// Reading

/** draw.io's default ends: an edge without `endArrow` ends in a classic arrow, without `startArrow` in none. */
export function arrowAt(style: Style, end: "start" | "end"): string {
  const value = style.get(`${end}Arrow`);
  return value === undefined || value === "" ? (end === "end" ? "classic" : "none") : value;
}

/** Whether an end of an edge has an arrow head of any kind. */
export const hasArrow = (style: Style, end: "start" | "end") => arrowAt(style, end) !== "none";

/** How a warning names a cell: its label in quotes, else `fallback`. */
export const quotedOr = (label: string, fallback: string) => (label ? `“${label}”` : fallback);

/** Whether a vertex is drawn dashed. */
export const dashed = (style: Style) => isOn(style, "dashed");

/** A role a cell this package wrote has: the value of its `tam` key. */
export const roleOf = (drawing: Drawing, cell: Cell) => drawing.style(cell).get("tam");

/** A cell's fill as `#rrggbb`, or undefined for none or the default white. */
export function fillColor(style: Style): string | undefined {
  const fill = style.get("fillColor");
  if (!fill || fill === "none" || fill === "default") return undefined;
  const hex = fill.length === 4 ? `#${[...fill.slice(1)].map((c) => c + c).join("")}` : fill;
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : undefined;
}

/**
 * Whether a fill is black or nearly: filled marks such as initial nodes and fork bars. draw.io's UML
 * shapes fill them with the outline's color (`fillColor=strokeColor`), black unless it says another.
 */
export function isDark(style: Style): boolean {
  if (style.get("fillColor") === "strokeColor") {
    const stroke = style.get("strokeColor");
    if (stroke === "none") return false;
    if (!stroke || stroke === "default") return true;
    return isDark(new Map([["fillColor", stroke]]));
  }
  const fill = fillColor(style);
  if (!fill) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
  return r + g + b < 160;
}

/**
 * The palette color name nearest a fill, if the fill is clearly colored. Grays read as no color:
 * container shades and the TAMshapes fills are gray, so a gray says nothing; `tamColor` says gray.
 */
export function paletteColor(style: Style): string | undefined {
  const fill = fillColor(style);
  if (!fill) return undefined;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  if (max - min < 0.06) return undefined;
  // Hues between ours and draw.io's own fills (#dae8fc, #ffe6cc, #fff2cc, #d5e8d4, #e1d5e7, #f8cecc).
  const HUES: [string, number][] = [
    ["red", 0],
    ["orange", 26],
    ["yellow", 45],
    ["green", 135],
    ["blue", 213],
    ["purple", 265],
    ["pink", 335],
  ];
  const hi = max,
    lo = min,
    d = hi - lo;
  const h = hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const own = (h * 60 + 360) % 360;
  let best = { name: HUES[0][0], distance: Infinity };
  for (const [name, hue] of HUES) {
    const difference = Math.abs(hue - own),
      distance = Math.min(difference, 360 - difference);
    if (distance < best.distance) best = { name, distance };
  }
  return best.name;
}

/** Cells of `cells` in reading order: top to bottom, and left to right in a row. */
export function readingOrder<T>(items: T[], boxOf: (item: T) => Box): T[] {
  return items.toSorted((a, b) => {
    const p = boxOf(a),
      q = boxOf(b);
    const rowsOverlap =
      Math.min(p.y + p.height, q.y + q.height) - Math.max(p.y, q.y) >
      Math.min(p.height, q.height) / 2;
    return rowsOverlap ? p.x - q.x : p.y - q.y;
  });
}

/** A cell to write: its style from keys and values, the role tag added. */
export function cell(
  fields: Omit<Cell, "style"> & { style: Record<string, string | number | boolean | undefined> },
  role: string,
): Cell {
  return { ...fields, style: formatStyle({ ...fields.style, tam: role }) };
}

/**
 * The title the scene draws above the diagram, as a text cell of its own (`tam=title`); draw.io's
 * font runs wider than the one the scene measures, so the title does not wrap.
 */
export function titleCell(scene: Scene): Cell | undefined {
  const heading = scene.texts.find((text) => text.role === "heading");
  if (!heading) return undefined;
  return cell(
    {
      id: "title",
      parent: LAYER,
      value: textToHtml(heading.text),
      vertex: true,
      connectable: false,
      style: {
        ...TAMSHAPES.text,
        whiteSpace: "nowrap",
        align: heading.anchor === "start" ? "left" : heading.anchor === "end" ? "right" : "center",
        fontStyle: 1,
        fontSize: heading.size,
      },
      geometry: vertexGeometry(heading.box),
    },
    "title",
  );
}

/** The title of a page: its title cell's text, else the page's name unless that is a default name. */
export function pageTitle(drawing: Drawing, defaults: RegExp): string | undefined {
  const cell = drawing.parts.find((item) => roleOf(drawing, item) === "title");
  const title = cell ? drawing.label(cell) : drawing.name.trim();
  return !title || (!cell && (defaults.test(title) || /^Page-\d+$/.test(title)))
    ? undefined
    : title.replace(/\s+/g, " ");
}
