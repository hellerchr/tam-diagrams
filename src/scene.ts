/**
 * The scene model every diagram type lays out into and the box and point geometry on it. Shape outlines
 * are in outline.ts, text in text.ts, markers in markers.ts and the SVG drawer in draw.ts.
 */

import type { MarkerKind } from "./markers";

/**
 * A laid-out diagram, independent of its type: positioned shapes, wires with end markers, decorative
 * lines and text boxes. Layouts produce scenes, drawScene below draws them and audit.ts checks
 * them for collisions. TAM block diagrams use the same conventions (tam.ts).
 */

/** A point in scene coordinates (pixels, y down). */
export type Point = { x: number; y: number };

/** An axis-aligned rectangle from its top left corner. */
export type Box = { x: number; y: number; width: number; height: number };

/** `inverse` is the page color, for text on filled marks. */
type Tone = "text" | "secondary" | "ink" | "inverse";

export interface SceneText {
  text: string;
  x: number;
  y: number;
  size: number;
  weight: number;
  anchor: "start" | "middle" | "end";
  tone: Tone;
  italic?: boolean;
  underline?: boolean;
  halo?: "background";
  /** Box around the glyphs, for audits and bounds. */
  box: Box;
  /**
   * node: the name inside a shape; title: a container's name; member: class members and state
   * descriptions; label: a connection or side label; end: multiplicities and roles at wire ends.
   */
  role:
    | "node"
    | "title"
    | "stereotype"
    | "member"
    | "label"
    | "end"
    | "marker"
    | "protocol"
    | "heading";
  /** The shape or wire the text belongs to. */
  owner?: string;
}

export type ShapeKind =
  | "rect"
  | "round"
  | "stadium"
  | "ellipse"
  | "circle"
  | "double-circle"
  | "diamond"
  | "hexagon"
  | "cylinder"
  | "subroutine"
  | "lean-right"
  | "lean-left"
  | "trapezoid"
  | "trapezoid-top"
  | "flag"
  | "note"
  | "bar"
  | "actor"
  | "initial"
  | "final"
  | "flow-final"
  | "frame"
  | "activation"
  | "badge"
  | "destroy"
  | "region"
  /** A package: a folder with a tab on top; a small filled triangle pointing along `facing`; three dots for "more of these". */
  | "folder"
  | "pointer"
  | "dots";

/** A drawn element: its outline kind, box, fill and decorations. */
export interface SceneShape {
  id: string;
  kind: ShapeKind;
  box: Box;
  /** Containers hold other shapes; wires may cross only those around their ends. */
  container: boolean;
  depth: number;
  fill: "page" | "shade" | "strong" | "ink" | "none";
  /** Corner radius of `round` shapes and containers. */
  radius?: number;
  /** Horizontal lines across the shape at these y values: class compartments, a composite state's name. */
  dividers?: number[];
  dashed?: boolean;
  /** Frames: the keyword tab in the top left corner; actors: the figure's size at the top of the box. */
  tab?: { width: number; height: number };
  /** Shapes wires and text may pass over: activation bars, invisible regions. */
  passable?: boolean;
  /** Thinner outline, for notes and frames. */
  thin?: boolean;
  /** A palette color name tinting the fill. */
  color?: string;
  /** Multiplicity: a second outline behind the shape, offset by STACK. */
  stack?: boolean;
  /** A symbol in the shape: the UML component icon in the top right, a stick figure at the top. */
  icon?: "component" | "human";
  /** Pointers: the direction the triangle points. */
  facing?: Point;
}

/** Offset of a stacked shape's second outline. */
export const STACK = 5;

export interface SceneWire {
  /** The connection this wire draws. */
  edge: string;
  points: Point[];
  dashed?: boolean;
  thick?: boolean;
  /** Shapes the wire may touch: its ends (and their parts). */
  ends: string[];
  /** Containers the wire may cross: those around either end. */
  home: string[];
  /** The shapes at the first and last point, which the wire must touch. */
  from?: string;
  to?: string;
  /** Curved wires: the SVG path drawn; `points` follow the curve for audits. */
  path?: string;
  /** Foreign containers the wire was deliberately routed through (a shortcut instead of a long detour): a compromise, not a defect. */
  through?: string[];
}

export interface SceneMarker {
  kind: MarkerKind;
  tip: Point;
  /** Unit vector toward the tip. */ direction: Point;
  wire: string;
  small?: boolean;
}

/** Lines that are neither wires nor outlines: lifelines, lane and region separators, fragment separators. */
interface SceneLine {
  points: Point[];
  dashed?: boolean;
  tone: "ink" | "line" | "boundary";
  width: number;
  /** Lines that keep clear of shapes and of each other, such as protocol boundaries. */
  clear?: boolean;
  /** Shapes the line belongs to and may pass through (a boundary's channel circles). */
  ends?: string[];
}

/** A laid-out diagram: everything drawScene draws and auditScene checks, in absolute coordinates. */
export interface Scene {
  shapes: SceneShape[];
  wires: SceneWire[];
  markers: SceneMarker[];
  lines: SceneLine[];
  texts: SceneText[];
  bounds: Box;
  /** Wires drawn straight run horizontally or vertically only. */
  orthogonal?: boolean;
  /** Safety nets and fallbacks that fired while laying the scene out, by name. */
  fallbacks?: Map<string, number>;
}

/** A scene with nothing in it, to add shapes, wires and text to. */
export const emptyScene = (): Scene => ({
  shapes: [],
  wires: [],
  markers: [],
  lines: [],
  texts: [],
  bounds: { x: 0, y: 0, width: 0, height: 0 },
});

/** The center of a box. */
export const centerOf = (box: Box): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** A box grown by `by` on every side (shrunk when negative). */
export const grow = (box: Box, by: number): Box => ({
  x: box.x - by,
  y: box.y - by,
  width: box.width + 2 * by,
  height: box.height + 2 * by,
});

/** The unit vector from `from` toward `to`. */
export const unit = (from: Point, to: Point): Point => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

/** Euclidean distance between two points. */
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Whether two segments cross at a point inside both. An end must lie at least 0.5 past the other
 * segment's line; with `scaled` that margin grows with the segments' lengths (cross products scale
 * with length), so long segments that only touch do not count.
 */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point, scaled = false): boolean {
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(c, d, a),
    d2 = side(c, d, b),
    d3 = side(a, b, c),
    d4 = side(a, b, d);
  const eps = scaled ? 0.5 * Math.max(distance(a, b), distance(c, d)) : 0.5;
  return (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  );
}

/** Whether an axis-aligned segment passes through the open box. */
export const segmentHits = (a: Point, b: Point, box: Box) =>
  Math.max(a.x, b.x) > box.x &&
  Math.min(a.x, b.x) < box.x + box.width &&
  Math.max(a.y, b.y) > box.y &&
  Math.min(a.y, b.y) < box.y + box.height;

/** Whether two boxes overlap by more than `slack` on both axes. */
export const overlaps = (a: Box, b: Box, slack = 0) =>
  a.x + slack < b.x + b.width &&
  b.x + slack < a.x + a.width &&
  a.y + slack < b.y + b.height &&
  b.y + slack < a.y + a.height;

/** Whether box `a` lies within box `b`, give or take `slack`. */
export const inside = (a: Box, b: Box, slack = 0) =>
  a.x >= b.x - slack &&
  a.y >= b.y - slack &&
  a.x + a.width <= b.x + b.width + slack &&
  a.y + a.height <= b.y + b.height + slack;

/** Whether a box lies across the edge of `container`: partly inside it, partly out. */
export const straddles = (box: Box, container: Box) =>
  overlaps(box, container) && !inside(box, container);

/** Drops repeated points and the middle points of straight (or doubling back) orthogonal runs. */
export function simplifyPath(points: Point[]): Point[] {
  const path: Point[] = [];
  for (const point of points) {
    if (path.length && Math.hypot(point.x - path.at(-1)!.x, point.y - path.at(-1)!.y) < 0.01)
      continue;
    path.push({ ...point });
    while (path.length >= 3) {
      const [p, q, r] = path.slice(-3);
      if (
        !(
          (Math.abs(p.x - q.x) < 0.5 && Math.abs(q.x - r.x) < 0.5) ||
          (Math.abs(p.y - q.y) < 0.5 && Math.abs(q.y - r.y) < 0.5)
        )
      )
        break;
      path.splice(path.length - 2, 1);
    }
  }
  return path;
}
