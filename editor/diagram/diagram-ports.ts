// The ports of a block diagram's elements on the canvas (src/tam/tam-ports.ts): more along a longer side, shown while a
// connection is drawn or one of its ends dragged. Let go on one, the end takes that port; anywhere else on the element,
// the layout chooses the best.
import { type Port, portPoint, portsOf } from "../../src/tam-ports.ts";
import type { View } from "../lib/zoom.ts";
import type { Box, Point } from "./diagram-hit.ts";
import { HANDLE, toScreen } from "./diagram-marks.ts";

export type { Port };

/** How a port stands out: the middle of its side, a quarter, or one between them. */
export type PortRank = "middle" | "quarter" | "between";
export const rankOf = (port: Port): PortRank =>
  port.at === 50 ? "middle" : port.at === 25 || port.at === 75 ? "quarter" : "between";
/** A port's radius on the stage, by how it stands out. */
export const PORT_SIZES: Record<PortRank, number> = { middle: 4.5, quarter: 4, between: 2.5 };

/** The ports of a box on the stage. */
export const portsOn = (view: View, box: Box) =>
  portsOf(box).map((port) => ({ port, at: toScreen(view, portPoint(box, port)) }));

/** The port of a box a point of the stage is on, within HANDLE: the nearest. */
export function portOn(view: View, box: Box, screen: Point): Port | undefined {
  let best: { port: Port; distance: number } | undefined;
  for (const { port, at } of portsOn(view, box)) {
    const distance = Math.hypot(at.x - screen.x, at.y - screen.y);
    if (distance <= HANDLE && (!best || distance < best.distance)) best = { port, distance };
  }
  return best?.port;
}

/** The element and port at a point of the stage, of the elements `may` end at: the innermost first. */
export function portSnap(
  view: View,
  elements: readonly { id: string; box: Box; depth: number }[],
  screen: Point,
  may: (id: string) => boolean,
): { id: string; port: Port } | undefined {
  for (const element of elements.toSorted((p, q) => q.depth - p.depth)) {
    const port = portOn(view, element.box, screen);
    if (port && may(element.id)) return { id: element.id, port };
  }
  return undefined;
}
