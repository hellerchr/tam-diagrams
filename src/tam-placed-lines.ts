/**
 * TAM layout by hand: the simple lines two elements can be joined by. Straight between facing
 * sides, around one corner, with a step in the gap between them, or around both on one side;
 * tam-placed-wires.ts takes the cheapest, tam-placed-detour.ts searches where none is free.
 */

import { type Box, centerOf, type Point } from "./scene.ts";
import { lies, type Side, sidePoint } from "./tam-placed.ts";
import { type Line, outward } from "./tam-placed-detour.ts";
import { portsAlong } from "./tam-ports.ts";

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

/** Two sides nearer than this leave no room for a wire straight between them. */
const TOUCHING = 4;

/**
 * The least gap between two elements for a wire to step sideways in, and how far around them a wire
 * runs: further where it carries a circle or a label, which stand between the wire and the elements.
 */
const STEP = 20,
  AROUND = 24,
  AROUND_MARKED = 36;

/** How far a simple line reaches past the elements it joins at most. */
export const REACH = AROUND_MARKED;

/** How far a bent line's end is from the plain one at one of its side's other two ports (tam-ports.ts), in parts of
 *  OFF_MIDDLE (tam-placed-wires.ts). */
export const PORT = 0.25;

/** A spot on a side for a wire end, and how far it is from the plain one: 0 for the middle, PORT for another port, 1 for a spot off them. */
export interface Spot {
  at: number;
  off: number;
}

/** The spots on each side of an element a line may end at. */
export type Spots = (end: End, side: Side) => Spot[];

/** The ports of a side nearest its middle, the middle first, for an element no other wire ends on. */
export const plainSpots: Spots = (end, side) =>
  inRange(end, side, portsAlong(end.box, side))
    .slice(0, SPOTS)
    .map((at, index) => ({ at, off: index ? PORT : 0 }));

/** How many of a side's ports a line is tried at: the middle and those nearest it. A long side has many ports, and
 *  every spot of one end is tried with every spot of the other. */
export const SPOTS = 3;

/** The ports of a side a wire end may stand at: those clear of the corners (and of a rounded shape's steep part). */
export function inRange(end: End, side: Side, ports: number[]): number[] {
  const [low, high] = range(end, side);
  return ports.filter((at) => at >= low - 0.5 && at <= high + 0.5);
}

/**
 * How far a straight line at `at` is from the plain one, in parts of OFF_MIDDLE: nothing at the middle of either side
 * or of what the sides share, a little at another port of either side (tam-ports.ts), more elsewhere. Small, so ports
 * only choose among straight lines: none of them gets dearer than a line with a corner (a reads/writes loop is drawn
 * as arcs only when straight).
 */
function straightOff(ends: [End, Side][], at: number, shared: number): number {
  const ports = ends.map(([end, side]) => portsAlong(end.box, side));
  if (Math.abs(at - shared) < 1 || ports.some(([middle]) => Math.abs(at - middle!) < 1)) return 0;
  return ports.some((along) => along.some((port) => Math.abs(at - port) < 1)) ? 0.02 : 0.1;
}

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

/** Two elements to join, with the spots on each of their sides a line may end at, looked up once. */
interface Pair {
  a: End;
  b: End;
  on: (end: End, side: Side) => Spot[];
  marked: boolean;
  half: number;
}

/**
 * The lines two elements can be joined by with at most two corners; `part` is the one the other
 * holds, `marked` a line that carries a circle or a label, `spots` where on a side a line may end,
 * `half` half of the room the wire takes across. A line that leaves a side off its middle, or steps off the middle of a gap, says so in `off`: it
 * is taken only where the plain one is not free.
 */
export function lines(
  a: End,
  b: End,
  part?: End,
  marked = false,
  spots: Spots = plainSpots,
  half = 0,
): Line[] {
  if (part) return linesIn(a, b, part, spots);
  const ends = new Map<string, Spot[]>();
  const on = (end: End, side: Side) => {
    const key = `${end === a ? "a" : "b"}${side}`;
    if (!ends.has(key)) ends.set(key, spots(end, side));
    return ends.get(key)!;
  };
  const pair: Pair = { a, b, on, marked, half },
    found: Line[] = [];
  for (const from of SIDES)
    for (const to of SIDES) {
      if (from !== to && lies(from) === lies(to)) found.push(...straightLines(pair, from, to));
      if (lies(from) !== lies(to)) found.push(...clearCornerLines(pair, from, to));
      found.push(...spotLines(pair, from, to));
    }
  return found;
}

/** From the border of the outer element straight in to its part, on the same side of both. */
function linesIn(a: End, b: End, part: End, spots: Spots): Line[] {
  const found: Line[] = [];
  for (const side of SIDES) {
    if (Math.abs(level(a.box, side) - level(b.box, side)) < TOUCHING) continue;
    for (const { at, off } of spots(part, side))
      found.push({
        from: side,
        to: side,
        points: [sidePoint(a.box, side, at), sidePoint(b.box, side, at)],
        off,
      });
  }
  return found;
}

/** Facing sides: straight where they overlap, at the ports of either side first, else in the middle of what they share. */
function straightLines({ a, b, on }: Pair, from: Side, to: Side): Line[] {
  const ra = range(a, from),
    rb = range(b, to);
  const low = Math.max(ra[0], rb[0]),
    high = Math.min(ra[1], rb[1]);
  if (high < low || outward(from) * (level(b.box, to) - level(a.box, from)) < TOUCHING) return [];
  const straight = [(low + high) / 2];
  for (const spot of [
    share(ra, 0.5),
    share(rb, 0.5),
    ...on(a, from).map((spot) => spot.at),
    ...on(b, to).map((spot) => spot.at),
    low + (high - low) / 4,
    high - (high - low) / 4,
    low,
    high,
  ])
    if (spot >= low && spot <= high && straight.every((other) => Math.abs(other - spot) >= 4))
      straight.push(spot);
  return straight.map((at) => ({
    from,
    to,
    points: [sidePoint(a.box, from, at), sidePoint(b.box, to, at)],
    off: straightOff(
      [
        [a, from],
        [b, to],
      ],
      at,
      straight[0]!,
    ),
  }));
}

/**
 * The spot on the side of `near` for a corner clear of `far`, where no spot on it leaves one: an end
 * as near its side's middle as keeps the corner clear of the other element.
 */
function clearSpot({ on, half }: Pair, near: End, side: Side, far: End, other: Side) {
  if (on(near, side).some((spot) => outward(other) * (spot.at - level(far.box, other)) >= CLEAR))
    return undefined;
  const [low, high] = range(near, side),
    limit = level(far.box, other) + outward(other) * (CLEAR + half),
    at = outward(other) > 0 ? Math.max(limit, low) : Math.min(limit, high);
  return at < low || at > high || on(near, side).some((spot) => spot.at === at)
    ? undefined
    : { at, off: 1 };
}

/** One corner where no spot on the sides leaves it clear of both elements. */
function clearCornerLines(pair: Pair, from: Side, to: Side): Line[] {
  const { a, b, on } = pair,
    first = clearSpot(pair, a, from, b, to),
    last = clearSpot(pair, b, to, a, from);
  if (!first && !last) return [];
  const found: Line[] = [];
  for (const sa of first ? [first] : on(a, from))
    for (const sb of last ? [last] : on(b, to)) {
      const line = cornerLine(pair, from, to, sa, sb);
      if (line) found.push(line);
    }
  return found;
}

/** The line with one corner between two spots, where the corner is clear of both elements. */
function cornerLine({ a, b }: Pair, from: Side, to: Side, sa: Spot, sb: Spot): Line | undefined {
  const p = sidePoint(a.box, from, sa.at),
    q = sidePoint(b.box, to, sb.at),
    corner = lies(from) ? { x: p.x, y: q.y } : { x: q.x, y: p.y };
  return beyond(a.box, from, corner) >= CLEAR && beyond(b.box, to, corner) >= CLEAR
    ? { from, to, points: [p, corner, q], off: sa.off + sb.off }
    : undefined;
}

/** The lines between every spot on one side and every spot on the other: one corner, a step, or around both. */
function spotLines(pair: Pair, from: Side, to: Side): Line[] {
  const { a, b, on } = pair,
    found: Line[] = [];
  for (const sa of on(a, from))
    for (const sb of on(b, to)) {
      if (lies(from) !== lies(to)) {
        // One corner, clear of both elements.
        const line = cornerLine(pair, from, to, sa, sb);
        if (line) found.push(line);
        continue;
      }
      if (Math.abs(sa.at - sb.at) < CLEAR) continue;
      const p = sidePoint(a.box, from, sa.at),
        q = sidePoint(b.box, to, sb.at),
        off = sa.off + sb.off;
      for (const [mid, shifted] of from !== to
        ? stepMids(pair, from, to, off)
        : aroundMids(pair, from, to, off))
        found.push({
          from,
          to,
          points: lies(from)
            ? [p, { x: p.x, y: mid }, { x: q.x, y: mid }, q]
            : [p, { x: mid, y: p.y }, { x: mid, y: q.y }, q],
          off: shifted,
        });
    }
  return found;
}

/** Facing sides: where a step in the gap between them runs, in its middle first, and how far off the middle each is. */
function stepMids({ a, b }: Pair, from: Side, to: Side, off: number): [number, number][] {
  const gap = outward(from) * (level(b.box, to) - level(a.box, from));
  if (gap < STEP) return [];
  const near = level(a.box, from),
    far = level(b.box, to);
  const mids: [number, number][] = [[(near + far) / 2, off]];
  if (off < 1 && gap >= 3 * STEP)
    mids.push([near + (far - near) / 4, off + 0.3], [far - (far - near) / 4, off + 0.3]);
  return mids;
}

/** The same side of both: where a line around them runs; further out first for one that carries marks. */
function aroundMids({ a, b, marked }: Pair, from: Side, to: Side, off: number): [number, number][] {
  const far =
    outward(from) > 0
      ? Math.max(level(a.box, from), level(b.box, to))
      : Math.min(level(a.box, from), level(b.box, to));
  const mids: [number, number][] = [];
  if (marked) mids.push([far + outward(from) * AROUND_MARKED, off]);
  mids.push([far + outward(from) * AROUND, off + (marked ? 0.1 : 0)]);
  return mids;
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
