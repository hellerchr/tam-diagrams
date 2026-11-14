/** Two wires touching at a bend: a turn of one lying on the other, where they would read as joined. */

import type { Point, SceneWire } from "./scene.ts";

/** The distance within which a bend counts as lying on a wire. */
const TOUCH = 0.5;

const distanceToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length2 = dx * dx + dy * dy,
    along = length2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2 : 0,
    t = Math.max(0, Math.min(1, along));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** The bends of `route` (its points between the two ends, which meet their shapes) that lie on `other`. */
export function bendsOn(route: Point[], other: Point[]): Point[] {
  return route
    .slice(1, -1)
    .filter((point) =>
      other.slice(1).some((end, k) => distanceToSegment(point, other[k], end) <= TOUCH),
    );
}

/** Whether `points`, as the route of `wire`, would touch another of `wires`, or another touch it. */
export function touchesOtherWire(wires: SceneWire[], wire: SceneWire, points: Point[]): boolean {
  return wires.some(
    (other) =>
      other.edge !== wire.edge &&
      (bendsOn(points, other.points).length > 0 || bendsOn(other.points, points).length > 0),
  );
}
