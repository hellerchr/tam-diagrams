/** Use case diagram lines: curved or straight links between actors and use cases, their ends, loops and labels. */

import { crossesBox, crossesShape } from "./audit.ts";
import { smallLines, smallSize } from "./labels.ts";
import { markerBounds, type MarkerKind, markerPoints } from "./markers.ts";
import { entryPoint } from "./outline.ts";
import {
  type Box,
  centerOf,
  distance,
  grow,
  overlaps,
  type Point,
  type Scene,
  type SceneShape,
  straddles,
  unit,
} from "./scene.ts";
import type { Measure } from "./text.ts";

/** Aims beside the centers (in steps of 9px across the line), so lines into one shape keep their ends apart. */
const AIMS = [
  [0, 0],
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [0, 2],
  [0, -2],
  [1, 1],
  [-1, -1],
  [2, 0],
  [-2, 0],
];

/** How far a curve's middle bends away from the straight line, nearest first. */
const BENDS = [
  0, 14, -14, 28, -28, 44, -44, 60, -60, 80, -80, 104, -104, 130, -130, 160, -160, 200, -200,
];

/** A line end already drawn, with the width of the marker on it (0 without one). */
interface End {
  point: Point;
  width: number;
}

export type Link = {
  id: string;
  source: string;
  target: string;
  start?: MarkerKind;
  end?: MarkerKind;
  dashed?: boolean;
};

/** How wide a marker is across its wire. */
function markerWidth(kind?: MarkerKind): number {
  if (!kind) return 0;
  const ys = markerPoints(kind, { x: 0, y: 0 }, { x: 1, y: 0 }).map((point) => point.y);
  return Math.max(...ys) - Math.min(...ys);
}

function endsOf(scene: Scene): End[] {
  return scene.wires.flatMap((wire) =>
    [wire.points[0], wire.points.at(-1)!].map((point) => {
      const marker = scene.markers.find(
        (item) => item.wire === wire.edge && distance(item.tip, point) < 0.75,
      );
      return { point, width: markerWidth(marker?.kind) };
    }),
  );
}

/**
 * Whether a new line end, reached from `from`, keeps apart from the ends drawn (12px, or more where
 * the markers on them are wider) and its marker off the other wires drawn.
 */
function apart(
  scene: Scene,
  from: Point,
  point: Point,
  kind: MarkerKind | undefined,
  taken: End[],
): boolean {
  const width = markerWidth(kind);
  if (
    !taken.every(
      (other) => distance(other.point, point) >= Math.max(12, (width + other.width) / 2 + 3),
    )
  )
    return false;
  if (!kind) return true;
  const reach = grow(markerBounds(kind, point, unit(from, point)), 1);
  return !scene.wires.some((wire) =>
    wire.points.slice(1).some((next, index) => crossesBox(wire.points[index], next, reach)),
  );
}

/** The outline a line meets: an actor's box holds the figure and its name. */
const outline = (shape: SceneShape) => (shape.kind === "actor" ? "rect" : shape.kind);

/** A point in an SVG path, to two decimals. */
const format = (point: Point) =>
  `${Math.round(point.x * 100) / 100} ${Math.round(point.y * 100) / 100}`;

/** Points along a quadratic Bézier curve. */
function sampleCurve(start: Point, control: Point, end: Point, steps = 24): Point[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps,
      u = 1 - t;
    return {
      x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
      y: u * u * start.y + 2 * u * t * control.y + t * t * end.y,
    };
  });
}

/**
 * Draws a line between two elements: straight where it hits nothing, else one smooth curve bending
 * around what is in the way, the least bent and least crossing one. The ends meet the outlines
 * exactly, aimed at (or a little beside) the centers. Returns whether it drew one.
 */
export function drawLine(
  scene: Scene,
  shapes: Map<string, SceneShape>,
  link: Link,
  home: Set<string>,
): boolean {
  const a = shapes.get(link.source),
    b = shapes.get(link.target);
  if (!a || !b) return false;
  const taken = endsOf(scene);
  const ca0 = centerOf(a.box),
    cb0 = centerOf(b.box),
    d = unit(ca0, cb0),
    n = { x: -d.y, y: d.x },
    chord = distance(ca0, cb0);
  const candidates = AIMS.flatMap(([ka, kb]) =>
    BENDS.filter((bend) => Math.abs(bend) <= Math.max(44, chord / 2)).map((bend) => ({
      ka,
      kb,
      bend,
      base: Math.abs(bend) + 5 * (Math.abs(ka) + Math.abs(kb)),
    })),
  ).toSorted((p, q) => p.base - q.base);
  let best: { cost: number; points: Point[]; control?: Point } | null = null;
  for (const { ka, kb, bend, base } of candidates) {
    if (best && best.cost <= base) break;
    const ca = { x: ca0.x + n.x * ka * 9, y: ca0.y + n.y * ka * 9 },
      cb = { x: cb0.x + n.x * kb * 9, y: cb0.y + n.y * kb * 9 };
    // A quadratic curve's middle lies halfway between the chord and its control point.
    const control = bend
      ? { x: (ca.x + cb.x) / 2 + n.x * 2 * bend, y: (ca.y + cb.y) / 2 + n.y * 2 * bend }
      : undefined;
    const start = entryPoint(control ?? cb, ca, outline(a), a.box),
      end = entryPoint(control ?? ca, cb, outline(b), b.box);
    if (!start || !end || distance(start, end) < 16) continue;
    if (
      !apart(scene, control ?? end, start, link.start, taken) ||
      !apart(scene, control ?? start, end, link.end, taken)
    )
      continue;
    const points = control ? sampleCurve(start, control, end) : [start, end];
    const cost = base + 1000 * conflicts(scene, home, points) + 40 * crossings(scene, points);
    if (!best || cost < best.cost) best = { cost, points, control };
  }
  if (!best) return false;
  const { points, control } = best,
    start = points[0],
    end = points.at(-1)!;
  scene.wires.push({
    edge: link.id,
    points,
    dashed: link.dashed,
    ends: [...new Set([link.source, link.target])],
    home: [...home],
    from: link.source,
    to: link.target,
    ...(control ? { path: `M${format(start)}Q${format(control)} ${format(end)}` } : {}),
  });
  if (link.start)
    scene.markers.push({
      kind: link.start,
      tip: start,
      direction: unit(control ?? end, start),
      wire: link.id,
    });
  if (link.end)
    scene.markers.push({
      kind: link.end,
      tip: end,
      direction: unit(control ?? start, end),
      wire: link.id,
    });
  return true;
}

/** A relation of a use case with itself: a loop out of its top right. */
export function drawLoop(scene: Scene, shape: SceneShape, link: Link) {
  const { x, y, width, height } = shape.box,
    center = centerOf(shape.box);
  const c1 = { x: x + width * 0.6, y: y - 34 },
    c2 = { x: x + width + 34, y: y + height * 0.4 };
  const start = entryPoint(c1, center, outline(shape), shape.box),
    end = entryPoint(c2, center, outline(shape), shape.box);
  if (!start || !end) return;
  const points = Array.from({ length: 25 }, (_, index) => {
    const t = index / 24,
      u = 1 - t;
    return {
      x: u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
      y: u * u * u * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
    };
  });
  scene.wires.push({
    edge: link.id,
    points,
    dashed: link.dashed,
    ends: [shape.id],
    home: [shape.id],
    from: shape.id,
    to: shape.id,
    path: `M${format(start)}C${format(c1)} ${format(c2)} ${format(end)}`,
  });
  if (link.start)
    scene.markers.push({ kind: link.start, tip: start, direction: unit(c1, start), wire: link.id });
  if (link.end)
    scene.markers.push({ kind: link.end, tip: end, direction: unit(c2, end), wire: link.id });
}

/** How many things a route runs into: foreign shapes and containers, text, markers, and wires it runs along. */
function conflicts(scene: Scene, home: Set<string>, points: Point[]): number {
  let count = 0;
  for (let k = 1; k < points.length; k++) {
    const p = points[k - 1],
      q = points[k];
    count += scene.shapes.filter(
      (shape) =>
        !home.has(shape.id) &&
        (shape.container ? crossesBox(p, q, shape.box) : crossesShape(p, q, shape, -3)),
    ).length;
    // A boundary's title moves aside for the lines afterwards (dodgeTitles).
    count += scene.texts.filter(
      (text) => text.role !== "title" && crossesBox(p, q, grow(text.box, 2)),
    ).length;
    count += scene.markers.filter((marker) =>
      crossesBox(
        p,
        q,
        grow(markerBounds(marker.kind, marker.tip, marker.direction, marker.small), 1),
      ),
    ).length;
    // On top of a wire already drawn: nearly parallel, close and side by side.
    const e = unit(p, q);
    for (const wire of scene.wires)
      for (let j = 1; j < wire.points.length; j++) {
        const r = wire.points[j - 1],
          s = wire.points[j],
          f = unit(r, s);
        if (Math.abs(e.x * f.y - e.y * f.x) > 0.08 || distanceToLine(r, p, q) > 6) continue;
        const along = (point: Point) => (point.x - p.x) * e.x + (point.y - p.y) * e.y;
        if (
          Math.min(distance(p, q), Math.max(along(r), along(s))) -
            Math.max(0, Math.min(along(r), along(s))) >
          2
        )
          count++;
      }
  }
  return count;
}

/** How often a route crosses the wires drawn. */
function crossings(scene: Scene, points: Point[]): number {
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  let count = 0;
  for (let k = 1; k < points.length; k++)
    for (const wire of scene.wires)
      for (let j = 1; j < wire.points.length; j++) {
        const [p, q, r, s] = [points[k - 1], points[k], wire.points[j - 1], wire.points[j]];
        if (side(r, s, p) * side(r, s, q) < 0 && side(p, q, r) * side(p, q, s) < 0) count++;
      }
  return count;
}

function distanceToLine(point: Point, a: Point, b: Point): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return Math.abs((b.x - a.x) * (a.y - point.y) - (a.x - point.x) * (b.y - a.y)) / length;
}

/**
 * A label beside the middle of its line (straight or curved), on whichever side is free: clear of
 * shapes, text, markers and wires, a clear gap from other labels, and either inside a boundary or
 * outside it, never across its edge.
 */
export function labelLine(scene: Scene, measure: Measure, id: string, text: string) {
  const wire = scene.wires.find((item) => item.edge === id);
  if (!wire) return;
  const size = smallSize(text, measure),
    points = wire.points;
  const lengths = points.slice(1).map((point, index) => distance(points[index], point)),
    total = lengths.reduce((sum, value) => sum + value, 0);
  /** The point at a fraction of the line's length, and the line's direction there. */
  const at = (t: number) => {
    let rest = t * total,
      k = 0;
    while (k < lengths.length - 1 && rest > lengths[k]) rest -= lengths[k++];
    const a = points[k],
      b = points[k + 1],
      f = lengths[k] ? rest / lengths[k] : 0;
    return { point: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, d: unit(a, b) };
  };
  const candidates = [6, 12, 20, 30].flatMap((gap) =>
    [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82].flatMap((t) => {
      const { point, d } = at(t),
        n = { x: -d.y, y: d.x };
      return [1, -1].map((side) => {
        // The box's nearest corner keeps `gap` from the line.
        const reach = (Math.abs(n.x) * size.width) / 2 + (Math.abs(n.y) * size.height) / 2 + gap;
        return {
          x: point.x + n.x * side * reach - size.width / 2,
          y: point.y + n.y * side * reach - size.height / 2,
          ...size,
        };
      });
    }),
  );
  const free = (box: Box) =>
    !scene.shapes.some((shape) =>
      shape.container ? straddles(grow(box, 2), shape.box) : overlaps(grow(box, 3), shape.box),
    ) &&
    !scene.texts.some((other) => overlaps(grow(box, other.role === "label" ? 10 : 2), other.box)) &&
    !scene.markers.some((marker) =>
      overlaps(grow(box, 2), markerBounds(marker.kind, marker.tip, marker.direction, marker.small)),
    ) &&
    !scene.wires.some((other) =>
      other.points
        .slice(1)
        .some((point, index) =>
          crossesBox(other.points[index], point, grow(box, other === wire ? 4 : 2)),
        ),
    );
  // Nothing free: the spot that runs into the fewest things, other wires above all.
  const conflicts = (box: Box) =>
    scene.shapes.filter((shape) =>
      shape.container ? straddles(box, shape.box) : overlaps(box, shape.box),
    ).length *
      2 +
    scene.texts.filter((other) => overlaps(box, other.box)).length * 2 +
    scene.wires.filter(
      (other) =>
        other !== wire &&
        other.points.slice(1).some((point, index) => crossesBox(other.points[index], point, box)),
    ).length *
      3;
  const box =
    candidates.find(free) ??
    candidates.reduce((best, item) => (conflicts(item) < conflicts(best) ? item : best));
  smallLines(scene, measure, text, box.x + box.width / 2, box.y + box.height / 2, {
    role: "label",
    owner: id,
  });
}
