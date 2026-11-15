/**
 * TAM layout by hand: the simple lines two elements can be joined by. Straight between facing
 * sides, around one corner, with a step in the gap between them, or around both on one side;
 * tam-placed-wires.ts takes the cheapest, tam-placed-detour.ts searches where none is free.
 */

import { type Box, centerOf, type Point } from "./scene.ts";
import { lies, type Side, sidePoint } from "./tam-placed.ts";
import { type Line, outward } from "./tam-placed-detour.ts";

const SIDES: Side[] = ["bottom", "top", "right", "left"];

/** One end of a connection: an element with its box and the radius of its rounded corners. */
export interface End {
  id: string;
  box: Box;
  radius: number;
}

/** Where a side's line lies: the y of a top or bottom, the x of a left or right. */
export const level = (box: Box, side: Side) =>
  side === "top"
    ? box.y
    : side === "bottom"
      ? box.y + box.height
      : side === "left"
        ? box.x
        : box.x + box.width;

/** How far a point lies outside a box, past one of its sides. */
export const beyond = (box: Box, side: Side, point: Point) =>
  outward(side) * ((lies(side) ? point.y : point.x) - level(box, side));

/** A corner keeps CLEAR from the elements it joins. */
const CLEAR = 12;

/**
 * The least gap between two elements for a wire to step sideways in, and how far around them a wire
 * runs: further where it carries a circle or a label, which stand between the wire and the elements.
 */
const STEP = 20,
  AROUND = 24,
  AROUND_MARKED = 36;

/** How far a simple line reaches past the elements it joins at most. */
export const REACH = AROUND_MARKED;

/** Where along a side a bent line may leave: the middle first. */
const SHARES = [0.5, 0.25, 0.75];

/** The part of a side wires end on: clear of the corners, and of the steep part of round ones. */
export function range(end: End, side: Side): [number, number] {
  const start = lies(side) ? end.box.x : end.box.y,
    extent = lies(side) ? end.box.width : end.box.height;
  const inset = Math.min(
    extent / 4,
    end.radius ? Math.max(0.4 * Math.min(end.radius, extent / 2), 6) : 8,
  );
  return [start + inset, start + extent - inset];
}

const share = ([low, high]: [number, number], of: number) => low + (high - low) * of;

/**
 * The lines two elements can be joined by with at most two corners; `part` is the one the other
 * holds, `marked` a line that carries a circle or a label. A line that leaves a side off its
 * middle, or steps off the middle of a gap, says so in `off`: it is taken only where the plain one
 * is not free.
 */
export function lines(a: End, b: End, part?: End, marked = false): Line[] {
  const found: Line[] = [];
  if (part) {
    // From the border of the outer element straight in to its part, on the same side of both.
    for (const side of SIDES)
      for (const of of SHARES) {
        const at = share(range(part, side), of);
        found.push({
          from: side,
          to: side,
          points: [sidePoint(a.box, side, at), sidePoint(b.box, side, at)],
          off: of === 0.5 ? 0 : 1,
        });
      }
    return found;
  }
  for (const from of SIDES)
    for (const to of SIDES) {
      const ra = range(a, from),
        rb = range(b, to);
      if (from !== to && lies(from) === lies(to)) {
        // Facing sides: straight where they overlap, in the middle of what they share first.
        const low = Math.max(ra[0], rb[0]),
          high = Math.min(ra[1], rb[1]);
        if (high >= low && outward(from) * (level(b.box, to) - level(a.box, from)) >= 0) {
          const middle = (low + high) / 2,
            spots = [middle];
          for (const spot of [
            share(ra, 0.5),
            share(rb, 0.5),
            low + (high - low) / 4,
            high - (high - low) / 4,
            low,
            high,
          ])
            if (spot >= low && spot <= high && spots.every((other) => Math.abs(other - spot) >= 4))
              spots.push(spot);
          spots.forEach((at, index) =>
            found.push({
              from,
              to,
              points: [sidePoint(a.box, from, at), sidePoint(b.box, to, at)],
              off: index ? 0.1 : 0,
            }),
          );
        }
      }
      for (const sa of SHARES)
        for (const sb of SHARES) {
          const off = +(sa !== 0.5) + +(sb !== 0.5);
          const p = sidePoint(a.box, from, share(ra, sa)),
            q = sidePoint(b.box, to, share(rb, sb));
          if (lies(from) !== lies(to)) {
            // One corner, clear of both elements.
            const corner = lies(from) ? { x: p.x, y: q.y } : { x: q.x, y: p.y };
            if (beyond(a.box, from, corner) >= CLEAR && beyond(b.box, to, corner) >= CLEAR)
              found.push({ from, to, points: [p, corner, q], off });
            continue;
          }
          if (Math.abs(share(ra, sa) - share(rb, sb)) < CLEAR) continue;
          const mids: [number, number][] = [];
          if (from !== to) {
            // Facing sides: a step in the gap between them, in its middle first.
            const gap = outward(from) * (level(b.box, to) - level(a.box, from));
            if (gap < STEP) continue;
            const near = level(a.box, from),
              far = level(b.box, to);
            mids.push([(near + far) / 2, off]);
            if (!off && gap >= 3 * STEP)
              mids.push([near + (far - near) / 4, 0.3], [far - (far - near) / 4, 0.3]);
          } else {
            // The same side of both: around them.
            const far =
              outward(from) > 0
                ? Math.max(level(a.box, from), level(b.box, to))
                : Math.min(level(a.box, from), level(b.box, to));
            if (marked) mids.push([far + outward(from) * AROUND_MARKED, off]);
            mids.push([far + outward(from) * AROUND, off + (marked ? 0.1 : 0)]);
          }
          for (const [mid, shifted] of mids)
            found.push({
              from,
              to,
              points: lies(from)
                ? [p, { x: p.x, y: mid }, { x: q.x, y: mid }, q]
                : [p, { x: mid, y: p.y }, { x: mid, y: q.y }, q],
              off: shifted,
            });
        }
    }
  return found;
}

/** The line between the middles of two elements that lie on each other, where no other line is left. */
export function between(a: Box, b: Box): Line {
  const ca = centerOf(a),
    cb = centerOf(b),
    across = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y);
  return {
    from: across ? (cb.x >= ca.x ? "right" : "left") : cb.y >= ca.y ? "bottom" : "top",
    to: across ? (cb.x >= ca.x ? "left" : "right") : cb.y >= ca.y ? "top" : "bottom",
    points: across
      ? [ca, { x: (ca.x + cb.x) / 2, y: ca.y }, { x: (ca.x + cb.x) / 2, y: cb.y }, cb]
      : [ca, { x: ca.x, y: (ca.y + cb.y) / 2 }, { x: cb.x, y: (ca.y + cb.y) / 2 }, cb],
  };
}

/** How long the run from one point to the next is. */
export const runLength = (p: Point, q: Point) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y);

/** Whether the run of a line that starts at `index` runs up or down. */
export const runsUpright = (points: Point[], index: number) =>
  Math.abs(points[index].x - points[index + 1].x) < 0.5;

/** An orthogonal line moved `distance` to its left; a corner moves with both runs that meet at it. */
export function beside(points: Point[], distance: number): Point[] {
  if (!distance) return points.map((point) => ({ ...point }));
  const normal = (from: Point, to: Point) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
  };
  return points.map((point, index) => {
    const before = index > 0 ? normal(points[index - 1], point) : { x: 0, y: 0 },
      after = index < points.length - 1 ? normal(point, points[index + 1]) : { x: 0, y: 0 };
    return {
      x: point.x + (before.x + after.x) * distance,
      y: point.y + (before.y + after.y) * distance,
    };
  });
}
