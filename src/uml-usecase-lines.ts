/** Use case diagram lines: curved or straight links between actors and use cases, their ends and loops. */

import { crossesBox, crossesShape } from "./audit.ts";
import { markerBounds, type MarkerKind, markerPoints } from "./markers.ts";
import { entryPoint } from "./outline.ts";
import {
  centerOf,
  distance,
  grow,
  type Point,
  type Scene,
  type SceneShape,
  unit,
} from "./scene.ts";

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

/** A curve around a shape passes its box this far from the nearest corner. */
const PASS = 18;

/**
 * Draws a line between two elements: straight where it hits nothing, else one smooth curve bending
 * around what is in the way, the least bent and least crossing one. The ends meet the outlines
 * exactly, aimed at (or a little beside) the centers. With `around`, curves that pass a corner of
 * a shape between the two are tried as well: where the elements stand as a hand placed them, a
 * bend in the middle of the line does not always clear what stands near one end. Returns whether
 * it drew one.
 */
export function drawLine(
  scene: Scene,
  shapes: Map<string, SceneShape>,
  link: Link,
  home: Set<string>,
  around = false,
): boolean {
  const a = shapes.get(link.source),
    b = shapes.get(link.target);
  if (!a || !b) return false;
  const chord = chordOf(a, b);
  const candidates = [
    ...bends(distance(chord.ca, chord.cb)),
    ...(around ? corners(chord, shapes.values()) : []),
  ].toSorted((p, q) => p.base - q.base);
  const best = cheapest(scene, chord, candidates, link, home);
  if (!best) return false;
  addLine(scene, link, home, best);
  return true;
}

function chordOf(a: SceneShape, b: SceneShape): Chord {
  const ca = centerOf(a.box),
    cb = centerOf(b.box),
    d = unit(ca, cb);
  return {
    a,
    b,
    ca,
    cb,
    n: { x: -d.y, y: d.x },
    middle: { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 },
  };
}

/** The cheapest line of the candidates, tried from the cheapest before what they meet on until none can be cheaper. */
function cheapest(
  scene: Scene,
  chord: Chord,
  candidates: Candidate[],
  link: Link,
  home: Set<string>,
): Line | null {
  const taken = endsOf(scene);
  let best: Line | null = null;
  for (const candidate of candidates) {
    if (best && best.cost <= candidate.base) break;
    const line = lineOf(scene, chord, candidate, link, home, taken);
    if (line && (!best || line.cost < best.cost)) best = line;
  }
  return best;
}

/** The two elements a line joins, their middles, the normal to the chord between them and its middle. */
interface Chord {
  a: SceneShape;
  b: SceneShape;
  ca: Point;
  cb: Point;
  n: Point;
  middle: Point;
}

/**
 * A way to draw a line: its ends aimed `ka` and `kb` steps beside the middles, bent `bend` off the
 * chord or through the point `through`, at a cost before what it meets of `base`.
 */
interface Candidate {
  ka: number;
  kb: number;
  bend: number;
  base: number;
  through?: Point;
}

/** A line drawn, with its cost and the control point of its curve. */
interface Line {
  cost: number;
  points: Point[];
  control?: Point;
}

/** The aims and bends of a line along a chord this long, the least bent and least aside first. */
const bends = (chord: number): Candidate[] =>
  AIMS.flatMap(([ka, kb]) =>
    BENDS.filter((bend) => Math.abs(bend) <= Math.max(44, chord / 2)).map((bend) => ({
      ka,
      kb,
      bend,
      base: Math.abs(bend) + 5 * (Math.abs(ka) + Math.abs(kb)),
      through: undefined,
    })),
  );

/**
 * The corners of the shapes between the two elements, a little outside them: a curve whose
 * middle lies on one costs as much as it leaves the straight line there.
 */
function corners(chord: Chord, shapes: Iterable<SceneShape>): Candidate[] {
  const { a, b, ca, cb, middle } = chord;
  return [...shapes]
    .filter(
      (shape) =>
        shape !== a && shape !== b && !shape.container && crossesBox(ca, cb, grow(shape.box, 60)),
    )
    .flatMap(({ box }) =>
      [
        { x: box.x - PASS, y: box.y - PASS },
        { x: box.x + box.width + PASS, y: box.y - PASS },
        { x: box.x - PASS, y: box.y + box.height + PASS },
        { x: box.x + box.width + PASS, y: box.y + box.height + PASS },
      ].map((through) => ({
        ka: 0,
        kb: 0,
        bend: 1,
        base: 10 + 1.5 * distanceToLine(through, ca, cb) + 0.2 * distance(through, middle),
        through,
      })),
    );
}

/** The control point of a candidate's curve; none for a straight line. A quadratic curve's middle lies halfway between the chord and its control point. */
function controlOf(chord: Chord, { bend, through }: Candidate, ca: Point, cb: Point) {
  const { n, middle } = chord;
  if (through) return { x: 2 * through.x - middle.x, y: 2 * through.y - middle.y };
  return bend
    ? { x: (ca.x + cb.x) / 2 + n.x * 2 * bend, y: (ca.y + cb.y) / 2 + n.y * 2 * bend }
    : undefined;
}

/** The line a candidate draws and its cost; null where its ends crowd each other or the ends of other lines. */
function lineOf(
  scene: Scene,
  chord: Chord,
  candidate: Candidate,
  link: Link,
  home: Set<string>,
  taken: ReturnType<typeof endsOf>,
): Line | null {
  const { a, b, n } = chord,
    { ka, kb } = candidate;
  const ca = { x: chord.ca.x + n.x * ka * 9, y: chord.ca.y + n.y * ka * 9 },
    cb = { x: chord.cb.x + n.x * kb * 9, y: chord.cb.y + n.y * kb * 9 };
  const control = controlOf(chord, candidate, ca, cb);
  const start = entryPoint(control ?? cb, ca, outline(a), a.box),
    end = entryPoint(control ?? ca, cb, outline(b), b.box);
  if (!start || !end || !endsApart(scene, start, end, control, link, taken)) return null;
  const points = control ? sampleCurve(start, control, end) : [start, end];
  const cost =
    candidate.base + 1000 * conflicts(scene, home, points) + 40 * crossings(scene, points);
  return { cost, points, control };
}

/** Whether a line's ends keep apart: from each other, and with their markers from the ends of other lines. */
const endsApart = (
  scene: Scene,
  start: Point,
  end: Point,
  control: Point | undefined,
  link: Link,
  taken: ReturnType<typeof endsOf>,
) =>
  distance(start, end) >= 16 &&
  apart(scene, control ?? end, start, link.start, taken) &&
  apart(scene, control ?? start, end, link.end, taken);

/** Adds a line to the scene with its markers. */
function addLine(scene: Scene, link: Link, home: Set<string>, { points, control }: Line) {
  const start = points[0],
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
