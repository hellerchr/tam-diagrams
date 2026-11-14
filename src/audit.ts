/** Layout checks and metrics, and the portfolio that keeps the best of several layouts. */

import {
  type Box,
  grow,
  inside,
  overlaps,
  type Point,
  type Scene,
  type SceneMarker,
  type SceneShape,
  type SceneText,
  type SceneWire,
  segmentsCross,
} from "./scene";
import {
  boxInsideOutline,
  insideOutline,
  insidePolygon,
  outlineOf,
  polygonOf,
  segmentDistance,
} from "./outline";
import { markerBounds, markerPoints } from "./markers";
import { textGroupBox } from "./text";

/**
 * Geometric checks on a laid-out scene (scene.ts): text that leaves its shape or collides
 * with other text or shapes, wires through shapes, containers or text, wires on top of each other,
 * wire ends off their shapes, markers that collide or float, and content outside the picture.
 * Every diagram type uses it: tests and the labs to find layout defects, the layout portfolio to score
 * each strategy. Lookups go through spatial grids, so the pairwise checks run in about linear time.
 */

/** The least space between a note and any other element. */
const NOTE_GAP = 16;
/** Px a wire end may be off its outline before it is a defect. */
export const END_OFF_OUTLINE = 1.5;

/** Defects must not occur; notes are compromises the renderer makes when there is no better spot. */
export interface Finding {
  check: string;
  detail: string;
  note?: boolean;
}

/**
 * Uniform grid over boxes. An item is stored in every cell its box touches, and a query visits only
 * the cells of the query box: with items spread over the picture, a lookup is O(1) on average.
 */
export class SpatialGrid<T> {
  private readonly cells = new Map<number, T[]>();
  constructor(private readonly size = 64) {}
  private keys(box: Box): number[] {
    const keys: number[] = [];
    const [x0, x1] = [Math.floor(box.x / this.size), Math.floor((box.x + box.width) / this.size)];
    const [y0, y1] = [Math.floor(box.y / this.size), Math.floor((box.y + box.height) / this.size)];
    // Cell coordinates packed into one number; pictures stay far below 2^20 cells per axis.
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) keys.push((x + 524288) * 1048576 + (y + 524288));
    return keys;
  }
  add(box: Box, item: T) {
    for (const key of this.keys(box)) {
      const cell = this.cells.get(key);
      if (cell) cell.push(item);
      else this.cells.set(key, [item]);
    }
  }
  /** Items whose boxes share a cell with `box`, each once. */
  near(box: Box): Set<T> {
    const found = new Set<T>();
    for (const key of this.keys(box)) for (const item of this.cells.get(key) ?? []) found.add(item);
    return found;
  }
}

export const around = (a: Point, b: Point, pad = 0): Box => ({
  x: Math.min(a.x, b.x) - pad,
  y: Math.min(a.y, b.y) - pad,
  width: Math.abs(a.x - b.x) + 2 * pad,
  height: Math.abs(a.y - b.y) + 2 * pad,
});

/** Whether segment a-b passes through the open box (Liang-Barsky clipping). */
export function crossesBox(a: Point, b: Point, box: Box): boolean {
  if (box.width <= 0 || box.height <= 0) return false;
  let t0 = 0,
    t1 = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - box.x],
    [dx, box.x + box.width - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.height - a.y],
  ]) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t1 - t0 > 1e-6;
}

/** Whether segment a-b passes through the shape's real outline, shrunk by `inset`. */
export function crossesShape(a: Point, b: Point, shape: SceneShape, inset = 1): boolean {
  const box = grow(shape.box, -inset);
  if (!crossesBox(a, b, box)) return false;
  if (outlineOf(shape.kind) === "box") return true;
  const steps = Math.max(8, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  for (let i = 0; i <= steps; i++) {
    const point = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
    if (insideOutline(point, shape.kind, shape.box, inset)) return true;
  }
  return false;
}

/** Length of the stretch two segments share when they run on top of each other. */
function shared(a: Point, b: Point, c: Point, d: Point): number {
  const horizontal = (p: Point, q: Point) => Math.abs(p.y - q.y) < 0.5,
    vertical = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.5;
  if (horizontal(a, b) && horizontal(c, d) && Math.abs(a.y - c.y) < 2) {
    return (
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
    );
  }
  if (vertical(a, b) && vertical(c, d) && Math.abs(a.x - c.x) < 2) {
    return (
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
    );
  }
  // Collinear diagonal segments.
  const cross = (p: Point, q: Point, s: Point) =>
    (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (
    length < 1 ||
    Math.abs(cross(a, b, c)) / length > 1.5 ||
    Math.abs(cross(a, b, d)) / length > 1.5
  )
    return 0;
  const project = (p: Point) => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length;
  return (
    Math.min(length, Math.max(project(c), project(d))) -
    Math.max(0, Math.min(project(c), project(d)))
  );
}

/** Distance from a point to a shape's outline (0 on it, positive outside or inside). */
export function offOutline(point: Point, shape: SceneShape): number {
  const { x, y, width, height } = shape.box;
  const kind = outlineOf(shape.kind);
  const radius =
    shape.kind === "round"
      ? Math.min(shape.radius ?? 10, width / 2, height / 2)
      : shape.kind === "stadium"
        ? Math.min(width, height) / 2
        : 0;
  if (radius) {
    // Signed distance to a rounded rectangle.
    const qx = Math.abs(point.x - x - width / 2) - (width / 2 - radius),
      qy = Math.abs(point.y - y - height / 2) - (height / 2 - radius);
    return Math.abs(
      Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius,
    );
  }
  if (kind === "polygon") {
    const corners = polygonOf(shape.kind, shape.box);
    return Math.min(
      ...corners.map((corner, index) =>
        segmentDistance(point, corner, corners[(index + 1) % corners.length]),
      ),
    );
  }
  if (kind === "box") {
    const dx = Math.max(x - point.x, 0, point.x - x - width),
      dy = Math.max(y - point.y, 0, point.y - y - height);
    if (dx || dy) return Math.hypot(dx, dy);
    return Math.min(point.x - x, x + width - point.x, point.y - y, y + height - point.y);
  }
  // Ellipses and diamonds: compare the normalized radius with 1, scaled back to pixels.
  const cx = x + width / 2,
    cy = y + height / 2,
    a = width / 2,
    b = height / 2;
  const nx = (point.x - cx) / a,
    ny = (point.y - cy) / b;
  const value = kind === "ellipse" ? Math.hypot(nx, ny) : Math.abs(nx) + Math.abs(ny);
  return Math.abs(value - 1) * Math.min(a, b);
}

export interface Segment {
  wire: SceneWire;
  index: number;
  a: Point;
  b: Point;
}

/** Every straight piece of every wire, with the wire's position in the scene for pair ordering. */
export function segmentsOf(scene: Scene, straightOnly: boolean): Segment[] {
  return scene.wires.flatMap((wire, index) =>
    straightOnly && wire.path
      ? []
      : wire.points.slice(1).map((point, i) => ({ wire, index, a: wire.points[i], b: point })),
  );
}

/** A wire's two ends: the shape each one is attached to (if any) and its point. */
const wireEnds = (wire: SceneWire) =>
  [
    [wire.from, wire.points[0]],
    [wire.to, wire.points.at(-1)!],
  ] as const;

/** Every layout defect and note in a scene (see the checks above); an empty list for a clean layout. */
export function auditScene(scene: Scene): Finding[] {
  const findings: Finding[] = [];
  const report = (check: string, detail: string, note = false) =>
    findings.push({ check, detail, ...(note ? { note } : {}) });
  const drawn = scene.shapes.filter((shape) => shape.kind !== "region");
  const leafList = drawn.filter((shape) => !shape.container && !shape.passable);
  const byId = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  const order = new Map(scene.shapes.map((shape, index) => [shape.id, index]));
  const name = (text: { text: string }) => JSON.stringify(text.text);

  // Indexes built once: grids of shapes, texts and wire pieces.
  const shapes = new SpatialGrid<SceneShape>(),
    leaves = new SpatialGrid<SceneShape>(),
    containers = new SpatialGrid<SceneShape>();
  for (const shape of drawn) {
    shapes.add(shape.box, shape);
    if (shape.container) containers.add(shape.box, shape);
    else if (!shape.passable) leaves.add(shape.box, shape);
  }
  const texts = new SpatialGrid<SceneText>(),
    textOrder = new Map<SceneText, number>();
  scene.texts.forEach((text, index) => {
    texts.add(text.box, text);
    textOrder.set(text, index);
  });
  const titles = new Map<string, Box>();
  for (const shape of drawn)
    if (shape.container) {
      const box = titleBox(scene, shape.id);
      if (box.width) titles.set(shape.id, box);
    }
  const titleGrid = new SpatialGrid<[string, Box]>();
  for (const entry of titles) titleGrid.add(entry[1], entry);

  // Text inside its own shape, clear of other shapes and other text.
  for (const text of scene.texts) {
    const own = text.owner ? byId.get(text.owner) : undefined;
    if (
      own &&
      (text.role === "node" ||
        text.role === "member" ||
        text.role === "stereotype" ||
        (text.role === "title" && !own.container))
    ) {
      if (!boxInsideOutline(text.box, own.kind, own.box, outlineOf(own.kind) === "box" ? 2 : 0))
        report("text-overflow", `${name(text)} leaves ${own.id}`);
    }
    if (own?.container && text.role === "title" && !inside(text.box, own.box, -1))
      report("text-overflow", `${name(text)} leaves ${own.id}`);
    // Activation bars, badges and crosses may lie under wires, but never under text, unless the
    // text's own shape is drawn over them and hides them (a note over an activation bar).
    const covers = (shape: SceneShape) =>
      !!own &&
      !own.container &&
      !own.passable &&
      own.fill !== "none" &&
      shape.passable &&
      order.get(own.id)! > order.get(shape.id)! &&
      inside(text.box, own.box);
    for (const shape of shapes.near(text.box))
      if (
        !shape.container &&
        shape.id !== text.owner &&
        overlaps(text.box, shape.box, 1) &&
        crossesShapeBox(text.box, shape) &&
        !covers(shape)
      )
        report("text-on-shape", `${name(text)} (${text.role}) covers ${shape.id}`);
    // Lines (lifelines, lane and region separators, boundaries) stay off text; a label may sit on one
    // with its halo, and text inside a shape is drawn over them anyway.
    const ownShape = text.owner ? byId.get(text.owner) : undefined;
    const onLine =
      text.halo &&
      (text.role === "label" ||
        text.role === "end" ||
        text.role === "marker" ||
        text.role === "protocol") &&
      !ownShape;
    if (text.role !== "heading" && !(ownShape && !ownShape.container) && !onLine) {
      for (const line of scene.lines) {
        if (
          line.points
            .slice(1)
            .some((point, index) => crossesBox(line.points[index], point, grow(text.box, -1)))
        ) {
          report("text-on-line", `${name(text)} (${text.role}) lies on a line`);
          break;
        }
      }
    }
    if (text.role !== "title")
      for (const [owner, box] of titleGrid.near(text.box)) {
        if (text.owner !== owner && overlaps(text.box, box, 1))
          report("text-on-title", `${name(text)} covers the title of ${owner}`);
      }
    for (const other of texts.near(text.box)) {
      if (
        textOrder.get(other)! <= textOrder.get(text)! ||
        (text.owner && text.owner === other.owner && text.role === other.role)
      )
        continue;
      if (overlaps(text.box, other.box, 1))
        report("text-collision", `${name(text)} (${text.role}) and ${name(other)} (${other.role})`);
    }
  }

  // Straight wires run horizontally or vertically only, where the diagram routes orthogonally.
  if (scene.orthogonal)
    for (const wire of scene.wires) {
      if (wire.path) continue;
      if (
        wire.points
          .slice(1)
          .some(
            (point, i) =>
              Math.abs(point.x - wire.points[i].x) > 0.5 &&
              Math.abs(point.y - wire.points[i].y) > 0.5,
          )
      )
        report("slanted-wire", `${wire.edge} has a slanted segment`);
    }

  // Wires: never through foreign shapes or text, never along another wire, ends on their shapes.
  for (const { wire, a, b } of segmentsOf(scene, false)) {
    const box = around(a, b, 1);
    for (const shape of leaves.near(box))
      if (!wire.ends.includes(shape.id) && crossesShape(a, b, shape))
        report("wire-through-shape", `${wire.edge} crosses ${shape.id}`);
    for (const shape of containers.near(box)) {
      if (!wire.home.includes(shape.id) && crossesBox(a, b, grow(shape.box, -1)))
        report(
          "wire-through-container",
          `${wire.edge} passes through ${shape.id}`,
          !!wire.through?.includes(shape.id),
        );
    }
    for (const text of texts.near(box)) {
      if (text.role === "heading") continue;
      // A wire may run under an opaque shape it ends at (a badge on its message), and so under that shape's text;
      // labels and markers of the wire's ends (a channel's label) sit beside it.
      const holder =
        text.owner && wire.ends.includes(text.owner) ? byId.get(text.owner) : undefined;
      const under = !!holder && holder.fill !== "none" && inside(text.box, holder.box, 0.5);
      const beside =
        !!text.owner &&
        wire.ends.includes(text.owner) &&
        (text.role === "label" || text.role === "marker");
      const own = text.owner === wire.edge || under || beside;
      if (!own && crossesBox(a, b, grow(text.box, -2)))
        report(
          "wire-through-text",
          `${wire.edge} crosses ${name(text)} (${text.role})`,
          text.role === "title" || text.role === "stereotype",
        );
    }
  }
  for (const wire of scene.wires) {
    for (const [end, point] of wireEnds(wire)) {
      const shape = end ? byId.get(end) : undefined;
      const off = shape ? offOutline(point, shape) : 0;
      if (shape && off > END_OFF_OUTLINE)
        report("wire-end-off-shape", `${wire.edge} ends ${Math.round(off)}px from ${shape.id}`);
    }
    // A label's halo stays off its own connection, or it cuts notches into the line.
    for (const text of scene.texts) {
      if (text.owner !== wire.edge || !text.halo) continue;
      const halo = {
        x: text.box.x - 3,
        y: text.box.y - 3,
        width: text.box.width + 6,
        height: text.box.height + 6,
      };
      if (wire.points.slice(1).some((point, index) => crossesBox(wire.points[index], point, halo)))
        report("halo-on-wire", `${name(text)} touches its own wire ${wire.edge}`);
    }
  }
  const pieces = segmentsOf(scene, true),
    pieceGrid = new SpatialGrid<Segment>(32),
    overlapping = new Set<string>();
  for (const piece of pieces) pieceGrid.add(around(piece.a, piece.b, 2), piece);
  for (const piece of pieces)
    for (const other of pieceGrid.near(around(piece.a, piece.b, 2))) {
      const pair = `${piece.index}:${other.index}`;
      if (other.index <= piece.index || overlapping.has(pair)) continue;
      const length = shared(piece.a, piece.b, other.a, other.b);
      if (length > 6) {
        overlapping.add(pair);
        report(
          "wire-overlap",
          `${piece.wire.edge} and ${other.wire.edge} share ${Math.round(length)}px`,
        );
      }
    }

  // Lines that keep clear (protocol boundaries) stay off shapes and off each other.
  const clearLines = scene.lines.filter((line) => line.clear);
  for (const line of clearLines)
    for (let i = 1; i < line.points.length; i++) {
      const [a, b] = [line.points[i - 1], line.points[i]];
      for (const shape of leaves.near(around(a, b, 1)))
        if (!line.ends?.includes(shape.id) && crossesBox(a, b, grow(shape.box, -1)))
          report("line-through-shape", `a boundary crosses ${shape.id}`);
    }
  clearLines.forEach((first, i) =>
    clearLines.slice(i + 1).forEach((second) => {
      for (let a = 1; a < first.points.length; a++)
        for (let b = 1; b < second.points.length; b++) {
          const [p, q, r, t] = [
            first.points[a - 1],
            first.points[a],
            second.points[b - 1],
            second.points[b],
          ];
          const horizontal =
            Math.abs(p.y - q.y) < 0.5 && Math.abs(r.y - t.y) < 0.5 && Math.abs(p.y - r.y) < 8;
          const vertical =
            Math.abs(p.x - q.x) < 0.5 && Math.abs(r.x - t.x) < 0.5 && Math.abs(p.x - r.x) < 8;
          const length = horizontal
            ? Math.min(Math.max(p.x, q.x), Math.max(r.x, t.x)) -
              Math.max(Math.min(p.x, q.x), Math.min(r.x, t.x))
            : vertical
              ? Math.min(Math.max(p.y, q.y), Math.max(r.y, t.y)) -
                Math.max(Math.min(p.y, q.y), Math.min(r.y, t.y))
              : 0;
          if (length > 2) {
            report("line-overlap", "two boundaries run along each other");
            return;
          }
        }
    }),
  );

  // Markers touch lines (lifelines) at most with their tip.
  for (const marker of scene.markers) {
    const outline = markerPoints(marker.kind, marker.tip, marker.direction, marker.small);
    const edges =
      marker.kind === "cross"
        ? [
            [outline[0], outline[1]],
            [outline[2], outline[3]],
          ]
        : outline.map((point, index) => [point, outline[(index + 1) % outline.length]]);
    const hit = scene.lines.some((line) =>
      line.points.slice(1).some((point, index) =>
        edges.some(([a, b]) => {
          const crossing = segmentsMeet(a, b, line.points[index], point);
          return crossing && Math.hypot(crossing.x - marker.tip.x, crossing.y - marker.tip.y) > 1.2;
        }),
      ),
    );
    if (hit) report("marker-on-line", `${marker.kind} of ${marker.wire} overlaps a line`);
  }

  // Each marker's anchor (the tip of a head, the center of a cross, circle or socket) lies on an end of a wire of its connection.
  const wires = new Map<string, SceneWire[]>();
  for (const wire of scene.wires) wires.set(wire.edge, [...(wires.get(wire.edge) ?? []), wire]);
  for (const marker of scene.markers) {
    const off = Math.min(
      Infinity,
      ...(wires.get(marker.wire) ?? [])
        .flatMap((wire) => [wire.points[0], wire.points.at(-1)!])
        .map((point) => Math.hypot(point.x - marker.tip.x, point.y - marker.tip.y)),
    );
    if (off > 0.5)
      report(
        "marker-off-end",
        `${marker.kind} of ${marker.wire} is ${Number.isFinite(off) ? `${Math.round(off * 10) / 10}px` : "away"} from its wire's end`,
      );
    const reach = markerBounds(marker.kind, marker.tip, marker.direction, marker.small);
    for (const text of texts.near(reach))
      if (coversText(reach, text))
        report("marker-on-text", `${marker.kind} of ${marker.wire} covers ${name(text)}`);
  }
  // Other connections' wires stay off a marker.
  const allPieces = new SpatialGrid<Segment>(32);
  for (const piece of segmentsOf(scene, false)) allPieces.add(around(piece.a, piece.b, 1), piece);
  for (const marker of scene.markers) {
    const box = markerBounds(marker.kind, marker.tip, marker.direction, marker.small);
    const outline = markerPoints(marker.kind, marker.tip, marker.direction, marker.small);
    const hit = [...allPieces.near(box)].find(
      (piece) => piece.wire.edge !== marker.wire && touchesPolygon(piece.a, piece.b, outline),
    );
    if (hit)
      report("wire-on-marker", `${hit.wire.edge} touches the ${marker.kind} of ${marker.wire}`);
  }
  const markerGrid = new SpatialGrid<SceneMarker>(16),
    markerOrder = new Map(scene.markers.map((marker, index) => [marker, index]));
  const reach = (marker: SceneMarker) =>
    markerBounds(marker.kind, marker.tip, marker.direction, marker.small);
  for (const marker of scene.markers) markerGrid.add(reach(marker), marker);
  for (const a of scene.markers)
    for (const b of markerGrid.near(reach(a))) {
      // Heads closer than 8px collide unless they sit back to back on opposite sides of a thin shape.
      if (markerOrder.get(b)! <= markerOrder.get(a)!) continue;
      if (Math.hypot(a.tip.x - b.tip.x, a.tip.y - b.tip.y) < 8 && overlaps(reach(a), reach(b), 0.5))
        report(
          "marker-collision",
          `${a.kind} and ${b.kind} at ${Math.round(a.tip.x)},${Math.round(a.tip.y)}`,
        );
    }

  // A jog between two shapes that overlap across the line, when a straight line would hit nothing.
  for (const wire of scene.wires) {
    const a = wire.from ? byId.get(wire.from) : undefined,
      b = wire.to ? byId.get(wire.to) : undefined;
    if (!a || !b || a === b || a.container || b.container || wire.points.length < 3) continue;
    const straight = avoidable(scene, wire, a, b);
    if (straight)
      report("avoidable-jog", `${wire.edge} bends although a straight line at ${straight} fits`);
  }

  // Wires meet diamonds at their vertices only.
  for (const wire of scene.wires) {
    for (const [end, point] of wireEnds(wire)) {
      const shape = end ? byId.get(end) : undefined;
      if (shape?.kind !== "diamond") continue;
      const { x, y, width, height } = shape.box,
        vertices = [
          { x: x + width / 2, y },
          { x: x + width, y: y + height / 2 },
          { x: x + width / 2, y: y + height },
          { x, y: y + height / 2 },
        ];
      if (!vertices.some((vertex) => Math.hypot(vertex.x - point.x, vertex.y - point.y) <= 0.5))
        report("diamond-off-vertex", `${wire.edge} meets ${shape.id} off its vertices`);
    }
  }

  // Sequence number badges are drawn objects of their own: off bars, heads, lifelines, other wires and markers.
  for (const badge of drawn.filter((shape) => shape.kind === "badge")) {
    const center = { x: badge.box.x + badge.box.width / 2, y: badge.box.y + badge.box.height / 2 },
      radius = badge.box.width / 2;
    for (const shape of shapes.near(grow(badge.box, 1)))
      if (shape !== badge && !shape.container && overlaps(grow(badge.box, 1), shape.box))
        report("badge-overlap", `${badge.id} covers ${shape.id}`);
    if (
      scene.lines.some((line) =>
        line.points
          .slice(1)
          .some(
            (point, index) => segmentDistance(center, line.points[index], point) < radius + 1.5,
          ),
      )
    )
      report("badge-overlap", `${badge.id} lies on a line`);
    for (const wire of scene.wires)
      if (
        !wire.ends.includes(badge.id) &&
        wire.points
          .slice(1)
          .some((point, index) => segmentDistance(center, wire.points[index], point) < radius + 1)
      )
        report("badge-overlap", `${wire.edge} crosses ${badge.id}`);
    for (const marker of markerGrid.near(grow(badge.box, 1)))
      if (overlaps(grow(badge.box, 1), reach(marker)))
        report("badge-overlap", `${badge.id} touches the ${marker.kind} of ${marker.wire}`);
  }

  // Decisions, merges and choices are the small UML diamond (larger only for many wires on a side).
  for (const shape of drawn)
    if (shape.kind === "diamond" && Math.max(shape.box.width, shape.box.height) > 30)
      report("diamond-size", `${shape.id} is ${Math.round(shape.box.width)}px wide`);

  // Notes keep their distance from other elements (lifeline bars may pass under a note over them).
  for (const note of drawn.filter((shape) => shape.kind === "note")) {
    for (const shape of shapes.near(grow(note.box, NOTE_GAP))) {
      if (shape === note || shape.container || shape.passable) continue;
      const gap = Math.max(
        shape.box.x - note.box.x - note.box.width,
        note.box.x - shape.box.x - shape.box.width,
        shape.box.y - note.box.y - note.box.height,
        note.box.y - shape.box.y - shape.box.height,
      );
      if (gap < NOTE_GAP)
        report(
          "note-too-close",
          `${note.id} is ${Math.max(0, Math.round(gap))}px from ${shape.id}`,
        );
    }
  }

  // Shapes do not overlap unless one holds the other.
  for (const a of leafList)
    for (const b of leaves.near(a.box)) {
      if (order.get(b.id)! > order.get(a.id)! && overlaps(a.box, b.box, 0.5))
        report("shape-overlap", `${a.id} and ${b.id}`);
    }

  // Everything inside the picture.
  const bounds = scene.bounds;
  for (const text of scene.texts)
    if (!inside(text.box, bounds)) report("out-of-bounds", name(text));
  for (const shape of drawn) if (!inside(shape.box, bounds)) report("out-of-bounds", shape.id);
  return findings;
}

/** Whether a text box touches the shape's real outline area (not just its bounding box corner). */
function crossesShapeBox(box: Box, shape: SceneShape): boolean {
  if (outlineOf(shape.kind) === "box") return true;
  for (let i = 0; i <= 6; i++)
    for (let j = 0; j <= 3; j++) {
      if (
        insideOutline(
          { x: box.x + (box.width * i) / 6, y: box.y + (box.height * j) / 3 },
          shape.kind,
          shape.box,
          0.5,
        )
      )
        return true;
    }
  return false;
}

/** The coordinate of a clear straight line between two shapes that overlap across it, if there is one. */
function avoidable(
  scene: Scene,
  wire: Scene["wires"][number],
  a: SceneShape,
  b: SceneShape,
): string | null {
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height",
      along = axis === "x" ? "y" : "x",
      alongSize = axis === "x" ? "height" : "width";
    const symbol = (shape: SceneShape) => outlineOf(shape.kind) !== "box";
    const margin = (shape: SceneShape) => (shape.kind === "round" ? 10 : 8);
    const low = Math.max(a.box[axis] + margin(a), b.box[axis] + margin(b)),
      high = Math.min(a.box[axis] + a.box[size] - margin(a), b.box[axis] + b.box[size] - margin(b));
    const centers = [a, b].filter(symbol).map((shape) => shape.box[axis] + shape.box[size] / 2);
    const at = centers.length ? centers[0] : (low + high) / 2;
    if (
      centers.some((center) => Math.abs(center - at) > 0.5) ||
      high - low < (centers.length ? 0 : 16) ||
      at < low - 0.5 ||
      at > high + 0.5
    )
      continue;
    const [first, second] = a.box[along] <= b.box[along] ? [a, b] : [b, a];
    if (first.box[along] + first.box[alongSize] > second.box[along] - 10) continue;
    const p =
      axis === "x"
        ? { x: at, y: first.box[along] + first.box[alongSize] }
        : { x: first.box[along] + first.box[alongSize], y: at };
    const q = axis === "x" ? { x: at, y: second.box[along] } : { x: second.box[along], y: at };
    if (
      scene.shapes.some(
        (shape) =>
          shape !== a &&
          shape !== b &&
          shape.kind !== "region" &&
          !shape.passable &&
          (shape.container
            ? !wire.home.includes(shape.id) && crossesBox(p, q, shape.box)
            : crossesShape(p, q, shape, -4)),
      )
    )
      continue;
    if (scene.texts.some((text) => text.owner !== wire.edge && crossesBox(p, q, text.box)))
      continue;
    const vertical = axis === "x";
    const crowd = scene.wires.some(
      (other) =>
        (other !== wire &&
          other.points.slice(1).some((point, index) => {
            const c = other.points[index];
            if (
              vertical
                ? Math.abs(c.x - point.x) > 0.5 || Math.abs(c.x - at) >= 10
                : Math.abs(c.y - point.y) > 0.5 || Math.abs(c.y - at) >= 10
            )
              return false;
            const [lo, hi] = vertical
              ? [Math.min(c.y, point.y), Math.max(c.y, point.y)]
              : [Math.min(c.x, point.x), Math.max(c.x, point.x)];
            return (
              Math.min(hi, Math.max(p[along], q[along])) -
                Math.max(lo, Math.min(p[along], q[along])) >
              0
            );
          })) ||
        other.points
          .slice(1)
          .some((point, index) => segmentsCross(p, q, other.points[index], point, true)),
    );
    if (!crowd) return `${axis} = ${Math.round(at)}`;
  }
  return null;
}

/** Whether a marker's reach covers text other than a heading: the marker-on-text check. */
export function coversText(reach: Box, text: SceneText): boolean {
  return overlaps(reach, text.box, 0.5) && text.role !== "heading";
}

/** Whether segment a-b crosses or lies inside the polygon (a marker's outline). */
export function touchesPolygon(a: Point, b: Point, polygon: Point[]): boolean {
  const inside = (point: Point) => insidePolygon(point, polygon);
  return (
    inside(a) ||
    inside(b) ||
    inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) ||
    polygon.some(
      (point, index) => !!segmentsMeet(a, b, point, polygon[(index + 1) % polygon.length]),
    )
  );
}

/** Where segments a-b and c-d meet, if they do. */
function segmentsMeet(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y },
    s = { x: d.x - c.x, y: d.y - c.y },
    denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denominator,
    u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + t * r.x, y: a.y + t * r.y } : null;
}

/** The title strip of a container: its label text boxes, or nothing. */
function titleBox(scene: Scene, id: string): Box {
  const titles = scene.texts.filter(
    (text) => text.owner === id && (text.role === "title" || text.role === "stereotype"),
  );
  return titles.length ? textGroupBox(titles) : { x: 0, y: 0, width: 0, height: 0 };
}

/** Whether two segments cross at a point inside both. */
