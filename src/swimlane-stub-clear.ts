/** What blocks the router's grid, and its last resort for a wire whose stub end sits closer to a neighbouring shape than the clearance allows. */

import { type Box, grow, type Point, segmentHits } from "./scene.ts";
import { CLEAR, round, type SwimlanePlacement } from "./swimlane-place.ts";

/** Which unit segments of the routing grid are blocked: horizontal ones by row, vertical ones by column. */
export interface BlockedGrid {
  h: boolean[][];
  v: boolean[][];
}

/** What the stub ends are computed from. */
export type PortStubs = Pick<SwimlanePlacement, "portPoints" | "sides" | "stub" | "stubLength">;

/** The clearance a segment keeps at a stub end: a wire hugging a shape at a few tenths of a pixel reads as touching it. */
const STUB_END_CLEARANCE = 1;

const pointKey = ({ x, y }: Point) => `${x},${y}`;

/**
 * The test for a unit segment: blocked by a shape grown by the clearance, by a marker or by a lane
 * header. Only the clearance varies; markers and headers block at every clearance.
 */
export function segmentBlocker(obstacles: Box[], heads: Box[], headerBoxes: Box[]) {
  return (a: Point, b: Point, clearance = CLEAR): boolean =>
    obstacles.some((box) => segmentHits(a, b, grow(box, clearance))) ||
    heads.some((box) => segmentHits(a, b, box)) ||
    headerBoxes.some((box) => segmentHits(a, b, box));
}

/** The two stub ends of one wire: the points where it leaves its shapes' margins and turns onto the grid. */
export function stubEnds(
  { portPoints, sides, stub, stubLength }: PortStubs,
  id: string,
): Set<string> {
  const [a, b] = portPoints.get(id)!,
    [sa, sb] = sides.get(id)!;
  return new Set(
    [stub(a, sa, stubLength.get(`${id}:0`)), stub(b, sb, stubLength.get(`${id}:1`))].map((point) =>
      pointKey({ x: round(point.x), y: round(point.y) }),
    ),
  );
}

/** The clearance a unit segment keeps from shapes: little when it starts or ends at the wire's own stub end. */
export function clearanceAt(ends: Set<string>, a: Point, b: Point): number {
  return ends.has(pointKey(a)) || ends.has(pointKey(b)) ? STUB_END_CLEARANCE : CLEAR;
}

/**
 * The grid's blocked segments with the clearance lowered at the stub ends of wire `id`, and only
 * there: other wires' stub ends keep the full clearance. `blocked` tests a segment against the
 * shapes with the given clearance; markers and headers are its business, not ours.
 */
export function stubClearGrid(
  placed: PortStubs,
  id: string,
  xs: number[],
  ys: number[],
  blocked: (a: Point, b: Point, clearance: number) => boolean,
): BlockedGrid {
  const ends = stubEnds(placed, id);
  const test = (a: Point, b: Point) => blocked(a, b, clearanceAt(ends, a, b));
  return {
    h: ys.map((y) => xs.slice(0, -1).map((x, i) => test({ x, y }, { x: xs[i + 1], y }))),
    v: xs.map((x) => ys.slice(0, -1).map((y, j) => test({ x, y }, { x, y: ys[j + 1] }))),
  };
}
