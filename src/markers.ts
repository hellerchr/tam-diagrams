/** Arrowheads and other wire-end markers: their size, outline and SVG. */

import type { Box, Point } from "./scene.ts";

export const round1 = (value: number) => Math.round(value * 10) / 10;

/** `socket`: the half circle of a required interface, around the point the wire ends at. */
export type MarkerKind =
  | "arrow"
  | "open"
  | "triangle"
  | "diamond"
  | "filled-diamond"
  | "cross"
  | "circle"
  | "socket";

/** Radius of a socket's half circle. */
export const SOCKET = 9;

/** How far each marker reaches back along its wire from the tip. */
export const MARKER_LENGTH: Record<MarkerKind, number> = {
  arrow: 9.5,
  open: 9,
  triangle: 13,
  diamond: 17,
  "filled-diamond": 17,
  cross: 4,
  circle: 5,
  socket: SOCKET,
};

/**
 * How far before the anchor the wire's stroke stops, so it never pokes through a head: at the notch
 * of filled heads, inside the apex of open heads, at the base of hollow shapes. Wires run to the
 * center of crosses and circles (a circle's fill covers the wire).
 */
export const MARKER_TRIM: Record<MarkerKind, number> = {
  arrow: 6.5,
  open: 1.6,
  triangle: 12,
  diamond: 16,
  "filled-diamond": 16,
  cross: 0,
  circle: 0,
  socket: SOCKET,
};

const at = (tip: Point, d: Point, back: number, side = 0): Point => ({
  x: tip.x - d.x * back - d.y * side,
  y: tip.y - d.y * back + d.x * side,
});

const path = (points: Point[], close: boolean) =>
  points
    .map((point, index) => `${index ? "L" : "M"}${round1(point.x)} ${round1(point.y)}`)
    .join("") + (close ? "Z" : "");

/**
 * The outline points of a marker whose tip is `tip`, pointing along `d`; audits use them. Stroked
 * outlines are pulled back by half their stroke, so the drawn tip touches `tip` exactly.
 */
export function markerPoints(kind: MarkerKind, tip: Point, d: Point, small = false): Point[] {
  switch (kind) {
    case "arrow": {
      const size = small ? 7.5 : 9.5,
        half = small ? 3.3 : 4,
        point = at(tip, d, 0.3);
      return [
        point,
        at(point, d, size, half),
        at(point, d, size * 0.72),
        at(point, d, size, -half),
      ];
    }
    case "open": {
      const point = at(tip, d, 0.65);
      return [at(point, d, 8.5, 4.3), point, at(point, d, 8.5, -4.3)];
    }
    case "triangle": {
      const point = at(tip, d, 0.65);
      return [point, at(point, d, 13, 7), at(point, d, 13, -7)];
    }
    case "diamond":
    case "filled-diamond": {
      const point = at(tip, d, 0.65);
      return [point, at(point, d, 8.5, 5), at(point, d, 17), at(point, d, 8.5, -5)];
    }
    // A cross of two 8px strokes centered on the wire's end.
    case "cross":
      return [
        at(tip, d, -2.8, 2.8),
        at(tip, d, 2.8, -2.8),
        at(tip, d, 2.8, 2.8),
        at(tip, d, -2.8, -2.8),
      ];
    case "circle":
      return Array.from({ length: 12 }, (_, k) => {
        const angle = (k * Math.PI) / 6;
        return { x: tip.x + 4.5 * Math.cos(angle), y: tip.y + 4.5 * Math.sin(angle) };
      });
    // The half circle on the wire's side of the center, open toward where the wire points.
    case "socket":
      return Array.from({ length: 9 }, (_, k) => {
        const angle = Math.atan2(-d.y, -d.x) - Math.PI / 2 + (k * Math.PI) / 8;
        return { x: tip.x + SOCKET * Math.cos(angle), y: tip.y + SOCKET * Math.sin(angle) };
      });
  }
}

/** The box a marker covers, with its stroke. */
export function markerBounds(kind: MarkerKind, tip: Point, d: Point, small = false): Box {
  const points = markerPoints(kind, tip, d, small),
    xs = points.map((point) => point.x),
    ys = points.map((point) => point.y);
  const x = Math.min(...xs) - 0.7,
    y = Math.min(...ys) - 0.7;
  return { x, y, width: Math.max(...xs) + 0.7 - x, height: Math.max(...ys) + 0.7 - y };
}

/**
 * SVG for a marker whose tip touches `tip`, pointing along `d` (a unit vector). Filled heads have a
 * notched back (a "stealth" head) as in TAM; hollow markers are filled with the color behind them so
 * the wire under them disappears.
 */
export function markerSvg(
  kind: MarkerKind,
  tip: Point,
  d: Point,
  ink: string,
  behind: string,
  small = false,
): string {
  const points = markerPoints(kind, tip, d, small);
  switch (kind) {
    case "arrow":
      return `<path d="${path(points, true)}" fill="${ink}" stroke="${ink}" stroke-width="0.6" stroke-linejoin="round"/>`;
    case "open":
      return `<path d="${path(points, false)}" fill="none" stroke="${ink}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>`;
    case "triangle":
      return `<path d="${path(points, true)}" fill="${behind}" stroke="${ink}" stroke-width="1.3" stroke-linejoin="round"/>`;
    case "diamond":
    case "filled-diamond":
      return `<path d="${path(points, true)}" fill="${kind === "diamond" ? behind : ink}" stroke="${ink}" stroke-width="1.3" stroke-linejoin="round"/>`;
    case "cross":
      return `<path d="${path(points.slice(0, 2), false)}${path(points.slice(2), false)}" stroke="${ink}" stroke-width="1.3" stroke-linecap="round"/>`;
    case "circle":
      return `<circle cx="${round1(tip.x)}" cy="${round1(tip.y)}" r="4.5" fill="${behind}" stroke="${ink}" stroke-width="1.3"/>`;
    case "socket":
      return `<path d="M${round1(points[0].x)} ${round1(points[0].y)}A${SOCKET} ${SOCKET} 0 0 1 ${round1(points.at(-1)!.x)} ${round1(points.at(-1)!.y)}" fill="none" stroke="${ink}" stroke-width="1.4"/>`;
  }
}
