/**
 * The ports of an element in a layout placed by hand: where its wires prefer to end, spread evenly
 * along each side, more of them the longer the side (about one every PITCH pixels: three, seven,
 * eleven, ... so one stands in the middle and one at each quarter). A connection may name the port an end takes, behind
 * the element's id, with the side's letter as Mermaid's architecture diagrams write it and how far
 * along the side it is, in percent: `web:R -- calls --> api:L25` leaves web by the middle of its
 * right side (50 is said by none) and enters api a quarter of the way down its left. Along a top or
 * bottom side the percent counts from the left. A place in percent keeps its share of the side when
 * the element is resized. One digit 1, 2 or 3 is the quarter it was when every side had three:
 * `:L1` is `:L25`.
 */

import type { Box, Point } from "./scene.ts";

export type PortSide = "top" | "bottom" | "left" | "right";
/** A port: its side, and how far along it, in percent (1 to 99). */
export type Port = { side: PortSide; at: number };

const SIDES: Record<string, PortSide> = { T: "top", B: "bottom", L: "left", R: "right" };
const LETTERS: Record<PortSide, string> = { top: "T", bottom: "B", left: "L", right: "R" };

/** About one port this many pixels along a side. */
const PITCH = 24;

/** A port behind an id in a connection's end, as a regular expression's source. */
export const PORT = ":[TBLR](?:[1-9]\\d?)?";

/** The share of the side a port's number says: a percent, or one of the quarters as one digit. */
const shareOf = (digits: string) =>
  digits.length === 1 && "123".includes(digits) ? Number(digits) * 25 : Number(digits);

/** The id of a connection's end and the port it names, if any: `api:L25`. */
export function splitEnd(end: string): { id: string; port?: Port } {
  const colon = end.indexOf(":");
  if (colon < 0) return { id: end };
  const side = SIDES[end[colon + 1]!],
    digits = end.slice(colon + 2),
    at = digits ? shareOf(digits) : 50;
  return {
    id: end.slice(0, colon),
    ...(side && at >= 1 && at <= 99 ? { port: { side, at } } : {}),
  };
}

/** A port as its end writes it, behind the id: `:R` for the middle of the right side, `:L25`; nothing for none. */
export const portText = (port: Port | undefined) =>
  port ? `:${LETTERS[port.side]}${port.at === 50 ? "" : port.at}` : "";

/** Whether two ports are the same, or both none. */
export const samePort = (p: Port | undefined, q: Port | undefined) =>
  p?.side === q?.side && p?.at === q?.at;

const across = (side: PortSide) => side === "top" || side === "bottom";

/** Where along its side a port lies: an x on the top and bottom, a y on the left and right. */
export const portAlong = (box: Box, port: Port) =>
  across(port.side) ? box.x + (box.width * port.at) / 100 : box.y + (box.height * port.at) / 100;

/** The point on a box's side a port stands at. */
export function portPoint(box: Box, port: Port): Point {
  const along = portAlong(box, port);
  if (port.side === "top") return { x: along, y: box.y };
  if (port.side === "bottom") return { x: along, y: box.y + box.height };
  return { x: port.side === "left" ? box.x : box.x + box.width, y: along };
}

/** How many ports a side of this length has: about one every PITCH, three, seven, eleven, ... so the middle and the
 *  quarters are always among them. */
export function portCount(length: number): number {
  return 4 * Math.max(1, Math.round(length / PITCH / 4)) - 1;
}

/** The ports of one side of a box, in the order wires take them: the middle, the quarters, then the others outward
 *  from the middle. A line is tried at the first few, so the ones between only serve where those are taken (or a
 *  connection names one). */
export function sidePorts(box: Box, side: PortSide): Port[] {
  const count = portCount(across(side) ? box.width : box.height);
  const ports = Array.from({ length: count }, (_, index) => ({
    side,
    at: Math.round((100 * (index + 1)) / (count + 1)),
  }));
  const rank = (at: number) => (at === 50 ? 0 : at === 25 || at === 75 ? 1 : 2);
  return ports.toSorted(
    (p, q) => rank(p.at) - rank(q.at) || Math.abs(p.at - 50) - Math.abs(q.at - 50) || p.at - q.at,
  );
}

/** Where along a side its ports lie, the middle first, then outward. */
export const portsAlong = (box: Box, side: PortSide) =>
  sidePorts(box, side).map((port) => portAlong(box, port));

/** Every port of a box: those of each side. */
export const portsOf = (box: Box): Port[] =>
  (["top", "right", "bottom", "left"] as const).flatMap((side) => sidePorts(box, side));
