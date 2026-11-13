/** Shape outlines: the polygon of each shape kind, inside tests, and where a wire enters a shape. */

import { type Box, type Point, type ShapeKind, unit } from "./scene";

/** Shapes whose outline is not their bounding box. */
type Outline = "box" | "ellipse" | "diamond" | "polygon";

export function outlineOf(kind: ShapeKind): Outline {
  if (
    kind === "ellipse" ||
    kind === "circle" ||
    kind === "double-circle" ||
    kind === "initial" ||
    kind === "final" ||
    kind === "flow-final" ||
    kind === "badge"
  )
    return "ellipse";
  if (kind === "diamond") return "diamond";
  if (
    kind === "hexagon" ||
    kind === "lean-right" ||
    kind === "lean-left" ||
    kind === "trapezoid" ||
    kind === "trapezoid-top" ||
    kind === "flag"
  )
    return "polygon";
  return "box";
}

/** Corners of the polygonal shapes, as drawScene draws them. */
export function polygonOf(kind: ShapeKind, box: Box): Point[] {
  const { x, y, width: w, height: h } = box,
    cy = y + h / 2;
  const s = Math.min(h * 0.4, 14);
  switch (kind) {
    case "hexagon": {
      const inset = Math.min(h / 2, 14);
      return [
        { x: x + inset, y },
        { x: x + w - inset, y },
        { x: x + w, y: cy },
        { x: x + w - inset, y: y + h },
        { x: x + inset, y: y + h },
        { x, y: cy },
      ];
    }
    case "lean-right":
      return [
        { x: x + s, y },
        { x: x + w, y },
        { x: x + w - s, y: y + h },
        { x, y: y + h },
      ];
    case "lean-left":
      return [
        { x, y },
        { x: x + w - s, y },
        { x: x + w, y: y + h },
        { x: x + s, y: y + h },
      ];
    case "trapezoid":
      return [
        { x: x + s, y },
        { x: x + w - s, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
    case "trapezoid-top":
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w - s, y: y + h },
        { x: x + s, y: y + h },
      ];
    case "flag": {
      const f = Math.min(h / 2, 12);
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
        { x: x + f, y: cy },
      ];
    }
    default:
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
  }
}

/** Distance from a point to the segment a-b. */
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length),
  );
  return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y));
}

/** Whether a point lies inside a polygon (even-odd rule), at least `inset` from its edges. */
export function insidePolygon(point: Point, corners: Point[], inset = 0): boolean {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const [a, b] = [corners[i], corners[j]];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return (
    inside &&
    (!inset ||
      corners.every(
        (corner, index) =>
          segmentDistance(point, corner, corners[(index + 1) % corners.length]) >= inset,
      ))
  );
}

/** Whether a point lies inside the shape's outline, shrunk by `inset`. */
export function insideOutline(point: Point, kind: ShapeKind, box: Box, inset = 0): boolean {
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2,
    a = box.width / 2 - inset,
    b = box.height / 2 - inset;
  if (a <= 0 || b <= 0) return false;
  const dx = Math.abs(point.x - cx) / a,
    dy = Math.abs(point.y - cy) / b;
  switch (outlineOf(kind)) {
    case "ellipse":
      return dx * dx + dy * dy < 1;
    case "diamond":
      return dx + dy < 1;
    case "polygon":
      return insidePolygon(point, polygonOf(kind, box), inset);
    default:
      return dx < 1 && dy < 1;
  }
}

/** Whether a box lies inside the shape's outline (its four corners do). */
export function boxInsideOutline(inner: Box, kind: ShapeKind, box: Box, inset = 0): boolean {
  return [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].every(([u, v]) =>
    insideOutline(
      { x: inner.x + u * inner.width, y: inner.y + v * inner.height },
      kind,
      { x: box.x - 0.01, y: box.y - 0.01, width: box.width + 0.02, height: box.height + 0.02 },
      inset,
    ),
  );
}

function insideRounded(point: Point, box: Box, radius: number): boolean {
  if (
    point.x < box.x ||
    point.x > box.x + box.width ||
    point.y < box.y ||
    point.y > box.y + box.height
  )
    return false;
  const r = Math.min(radius, box.width / 2, box.height / 2);
  const cx = Math.min(Math.max(point.x, box.x + r), box.x + box.width - r),
    cy = Math.min(Math.max(point.y, box.y + r), box.y + box.height - r);
  return Math.hypot(point.x - cx, point.y - cy) <= r;
}

/**
 * Where the line from `outside` through `toward` first enters the shape's outline (rounded corners
 * count when `radius` is given), or null when the line misses the shape.
 */
export function entryPoint(
  outside: Point,
  toward: Point,
  kind: ShapeKind,
  box: Box,
  radius = 0,
): Point | null {
  const within = (point: Point) =>
    radius > 0 ? insideRounded(point, box, radius) : insideOutline(point, kind, box);
  const d = unit(outside, toward),
    reach = Math.hypot(toward.x - outside.x, toward.y - outside.y) + box.width + box.height;
  const at = (t: number) => ({ x: outside.x + d.x * t, y: outside.y + d.y * t });
  if (within(outside)) return null;
  let previous = 0;
  for (let t = 0.5; t <= reach; t += 0.5) {
    if (!within(at(t))) {
      previous = t;
      continue;
    }
    let low = previous,
      high = t;
    for (let i = 0; i < 30; i++) {
      const mid = (low + high) / 2;
      if (within(at(mid))) high = mid;
      else low = mid;
    }
    return at(low);
  }
  return null;
}

/**
 * Moves the end of a route from its shape's bounding box onto the real outline, along the last
 * segment. `end` is the index of the end point (0 or last). Returns null when the segment misses
 * the outline.
 */
export function clipToOutline(
  points: Point[],
  end: number,
  kind: ShapeKind,
  box: Box,
  radius = 0,
): Point[] | null {
  if (outlineOf(kind) === "box" && !radius) return points;
  const neighbour = end === 0 ? 1 : points.length - 2;
  const point = entryPoint(points[neighbour], points[end], kind, box, radius);
  if (!point) return null;
  const copy = points.map((item) => ({ ...item }));
  copy[end] = point;
  return copy;
}
