/** The grid points swimlane wires end or turn at, which a wire's route may not touch once it would read as joined. */

import type { Point } from "./scene";
import { round } from "./swimlane-place";
import type { Tier } from "./swimlane-tiers";

/** Reserved points on the router's grid: stub ends (known up front) and the bends of routed wires. */
export interface OccupiedPoints {
  /** Reserves a stub end: its own grid cell, and the grid points around it. */
  terminal: (point: Point) => void;
  /** Reserves the grid points around a point a routed wire ends or turns at. */
  bend: (point: Point) => void;
  /**
   * Which cells a search skips as another wire's point. Unreserved: only the stub ends' own cells.
   * Reserved: the grid points around stub ends and around routed wires' bends. The relaxed tier
   * (sharing lines at a price) is never reserved: it stays as it was before reservations.
   */
  view: (reserved: boolean, tier: Tier) => (i: number, j: number) => boolean;
  /** Whether a route passes through (turns at or runs across) a reserved point; its first and last points are its own. */
  crossed: (route: Point[]) => boolean;
  /**
   * The route as found, or the result of `again` when the found route crosses a reserved point and
   * the second search gets clear of them: a second route that crosses one too is no better.
   */
  settle: (found: Point[] | null, again: () => Point[] | null) => Point[] | null;
}

/**
 * A reservation covers every grid point within half a pixel of the point: the routing grid has
 * half-pixel resolution, and two wires turning that close read as joined, as on the same point.
 */
const REACH = 0.5;

export function occupiedPoints(xs: number[], ys: number[]): OccupiedPoints {
  const cells = xs.length * ys.length,
    exact = new Uint8Array(cells),
    terminals = new Uint8Array(cells),
    bends = new Uint8Array(cells);
  const cell = (i: number, j: number) => j * xs.length + i;
  /** The cell at a grid point, or -1 off the grid. */
  const slot = (x: number, y: number) => {
    const i = xs.indexOf(x),
      j = ys.indexOf(y);
    return i < 0 || j < 0 ? -1 : cell(i, j);
  };
  const reserve = (grid: Uint8Array, { x, y }: Point) =>
    xs.forEach((gx, i) => {
      if (Math.abs(gx - x) > REACH) return;
      ys.forEach((gy, j) => {
        if (Math.abs(gy - y) <= REACH && Math.hypot(gx - x, gy - y) <= REACH) grid[cell(i, j)] = 1;
      });
    });
  const reservedAt = (index: number) => terminals[index] === 1 || bends[index] === 1;
  const crossed = (route: Point[]) => {
    const ends = [route[0], route[route.length - 1]];
    return route.slice(1, -1).some((p) => {
      const index = slot(p.x, p.y);
      return (
        index >= 0 &&
        reservedAt(index) &&
        ends.every((end) => Math.hypot(p.x - end.x, p.y - end.y) > REACH)
      );
    });
  };
  return {
    terminal: (point) => {
      const index = slot(round(point.x), round(point.y));
      if (index >= 0) exact[index] = 1;
      reserve(terminals, point);
    },
    bend: (point) => reserve(bends, point),
    view: (reserved, tier) => (i, j) =>
      reserved && tier !== "relaxed" ? reservedAt(cell(i, j)) : exact[cell(i, j)] === 1,
    crossed,
    settle: (found, again) => {
      if (!found || !crossed(found)) return found;
      const second = again();
      return second && !crossed(second) ? second : found;
    },
  };
}
