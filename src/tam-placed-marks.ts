/**
 * TAM layout by hand: where a connection's circle and label stand on its wire. Every wire lies
 * before the first mark is placed, so a mark takes the spot on its wire where it covers nothing:
 * no element, no other wire, no other mark, no container's border or title.
 */

import { type Box, grow, inside, overlaps, type Point, segmentHits } from "./scene.ts";
import type { TamEdge } from "./tam.ts";
import type { Measure } from "./text.ts";
import { smallSize } from "./labels.ts";
import {
  ASIDE,
  ASSEMBLY,
  BULGE,
  CHANNEL,
  LOOP_END,
  MARKER_GAP,
  type TamGraph,
} from "./tam-graph.ts";
import { runLength, runsUpright } from "./tam-placed-lines.ts";

/** The room a connection takes to either side of its wire: a loop's two lines, a circle. */
export const thickness = (edge: TamEdge) =>
  edge.kind === "modify"
    ? LOOP_END + BULGE
    : edge.kind === "channel"
      ? CHANNEL / 2
      : edge.kind === "assembly"
        ? ASSEMBLY / 2
        : 0;

/** Whether a connection carries a circle (a channel, a connector) rather than a label alone. */
export const circled = (edge: TamEdge) => edge.kind === "channel" || edge.kind === "assembly";

/** Whether a connection carries anything on its wire. */
export const marked = (edge: TamEdge) => circled(edge) || !!edge.label;

/** What a mark keeps off. */
export interface Surroundings {
  /** Elements, interface circles and their names. */
  solids: Box[];
  containers: Box[];
  /** The containers that hold only one end of the connection, or none: a mark stands outside them where its wire leaves it room there. */
  foreign?: Box[];
  titles: Box[];
  /** Every piece of every wire, by the connection it belongs to; a loop's two lines lie `half` to either side. */
  wires: { owner: string; a: Point; b: Point; half?: number }[];
  /** The circles and labels placed already, by their connection. */
  placed: { owner: string; box: Box }[];
  /** The protocol boundaries through the circles placed already: each runs across its wire at `level`, through `at`. */
  boundaries: { owner: string; protocol: string; up: boolean; level: number; at: number }[];
}

/** A connection's circle and label at a spot on its wire. */
export interface Mark {
  spot: Point;
  /** The run of the wire the mark stands on: it starts at this point of the line. */
  host: number;
  /** Whether that run goes up or down. */
  up: boolean;
  /** The rooms the scene draws into: one per label and marker, and the circle's box last. */
  rooms: Box[];
  /** What is drawn in them, for what comes later to keep off. */
  drawn: Box[];
  /** How much the mark covers: 0 for one that stands free. */
  hits: number;
}

/** What covering each kind of thing counts; a mark that covers anything counts HIT at least. */
const SOLID = 10,
  PLACED = 10,
  WIRE = 8,
  EDGE = 5;
export const HIT = EDGE;

/**
 * A mark's spot moves along its run in steps of STEP; a circle keeps END from the run's ends, and
 * HEAD where an arrowhead points into it.
 */
const STEP = 6,
  END = CHANNEL / 2 + 4,
  HEAD = CHANNEL / 2 + 12;

/** A spot inside a container that does not hold both ends counts INSIDE: less than covering anything, more than a spot on another run. */
const INSIDE = 3;

/** A label that finds no room at its wire stands off it by one of these. */
const LIFTS = [0, 10, 20, 30];

/** Two protocol boundaries side by side keep APART, as far along as NEIGHBOUR; nearer ones share a line. */
const APART = 12,
  NEIGHBOUR = 200;

/** How much the boxes of a mark cover of what surrounds them. */
function covered(edge: TamEdge, boxes: Box[], circle: boolean, around: Surroundings): number {
  let hits = 0;
  boxes.forEach((room, index) => {
    const box = grow(room, 2),
      own = circle && index === boxes.length - 1;
    for (const other of around.solids) if (overlaps(box, other)) hits += SOLID;
    for (const other of around.placed) if (overlaps(box, other.box)) hits += PLACED;
    for (const wire of around.wires)
      if (
        !(own && wire.owner === edge.id) &&
        segmentHits(wire.a, wire.b, wire.half ? grow(box, wire.half) : box)
      )
        hits += WIRE;
    // A border passes a mark at twice the distance of anything else: it is a long line beside it.
    const wide = grow(room, 4);
    for (const other of around.containers)
      if (overlaps(wide, other) && !inside(wide, other)) hits += EDGE;
    for (const other of around.titles) if (overlaps(box, other)) hits += PLACED;
  });
  return hits;
}

/**
 * The best place for a connection's circle and label on its wire `points`: on the longest run, at
 * `share` of the way along it, where that covers nothing, else along the run, on its other side
 * and on the other runs. A wire that runs beside others of its bundle (`outer`: 1 to their left as
 * the line runs, -1 to their right) carries its label on the side away from them first. Undefined
 * for a connection that carries nothing.
 */
export function placeMark(
  edge: TamEdge,
  points: Point[],
  prefer: { share: number; outer: number },
  around: Surroundings,
  prepared: Pick<TamGraph, "channelLabels">,
  measure: Measure,
): Mark | undefined {
  const circle = circled(edge);
  if (!circle && !edge.label) return undefined;
  const size = !circle ? 0 : edge.kind === "assembly" ? ASSEMBLY : CHANNEL,
    text = !circle && edge.label ? smallSize(edge.label, measure) : undefined,
    half = thickness(edge);
  /** The rooms beside the wire at a spot, with everything on `side` of the wire, and what is drawn in them. */
  const rooms = (spot: Point, side: number, up: boolean, lift = 0): [Box[], Box[]] => {
    if (text) {
      // A label stands beside the run: right of one that runs up or down, above one across.
      const { width, height } = text;
      const room = up
        ? {
            x: side < 0 ? spot.x - half - 6 - lift - width : spot.x + half + 6 + lift,
            y: spot.y - height / 2,
            width,
            height,
          }
        : {
            x: spot.x - width / 2,
            y: side > 0 ? spot.y + half + 4 + lift : spot.y - half - 4 - lift - height,
            width,
            height,
          };
      return [[room], [room]];
    }
    const labels = prepared.channelLabels(edge, up);
    const box = { x: spot.x - size / 2, y: spot.y - size / 2, width: size, height: size };
    // Beside an upright wire everything stands in one room, right of it or left; at a wire across,
    // the label above and the marker below, or both on one side.
    let above = box.y - MARKER_GAP,
      below = box.y + size + MARKER_GAP;
    const found: Box[] = [],
      drawn: Box[] = [];
    // On one side the marker stands next to the circle and the label beyond it.
    const order = labels.map((_, at) => at);
    if (side && !edge.protocol) order.reverse();
    for (const at of order) {
      const where = labels[at].layoutOptions?.["elk.nodeLabels.placement"] ?? "",
        width = labels[at].width!,
        height = labels[at].height!;
      if (where.includes("H_RIGHT")) {
        found[at] = drawn[at] = {
          x: side < 0 ? box.x - MARKER_GAP - width : box.x + size + MARKER_GAP,
          y: spot.y - height / 2,
          width,
          height,
        };
        continue;
      }
      const over = side && !edge.protocol ? side < 0 : where.includes("V_TOP");
      found[at] = { x: spot.x - width / 2, y: over ? above - height : below, width, height };
      // Beside a protocol's boundary the label and the marker stand right of the line through the circle.
      drawn[at] = edge.protocol
        ? { ...found[at], x: spot.x + ASIDE, width: at ? 22 : (width - 14) / 2 }
        : found[at];
      if (over) above -= height + 2;
      else below += height + 2;
    }
    return [
      [...found, box],
      [...drawn, box],
    ];
  };
  // The longest run first; of equal ones a run between two corners, where a circle leaves the elements clear.
  const hosts = points
    .slice(1)
    .map((_, index) => index)
    .toSorted((p, q) => {
      const weigh = (index: number) =>
        runLength(points[index], points[index + 1]) +
        (index > 0 && index < points.length - 2 ? 0.5 : 0);
      return weigh(q) - weigh(p);
    });
  const end = !circle ? 8 : edge.flow ? HEAD : END;
  let best: (Mark & { cost: number }) | undefined;
  for (const [rank, host] of hosts.entries()) {
    const from = points[host],
      to = points[host + 1],
      length = runLength(from, to),
      up = runsUpright(points, host);
    if (rank && length < 2 * end) break;
    // Sides: -1 left of or above the wire, 1 right of or below it, 0 as the notation has it. The
    // left of a line is below a run to the right and above one to the left, left of a run down.
    const left = up ? (to.y > from.y ? -1 : 1) : to.x > from.x ? 1 : -1,
      sides = prefer.outer ? [prefer.outer * left, 0, -prefer.outer * left] : [0, -1, 1];
    const wanted =
        length < 2 * end
          ? length / 2
          : Math.min(length - end, Math.max(end, length * (rank ? 0.5 : prefer.share))),
      reach = length < 2 * end ? 0 : Math.max(wanted - end, length - end - wanted);
    // A circle on a protocol's boundary stands in line with the circles of that protocol nearby.
    const level = (spot: Point) => (up ? spot.y : spot.x),
      across = (spot: Point) => (up ? spot.x : spot.y),
      lines = edge.protocol ? around.boundaries.filter((line) => line.up === up) : [];
    const spots: [number, number][] = [];
    for (const line of lines) {
      const along = Math.abs(line.level - level(from));
      if (
        line.protocol === edge.protocol &&
        Math.abs(line.at - across(from)) < NEIGHBOUR &&
        along >= end &&
        along <= length - end &&
        Math.abs(level(from) + Math.sign(level(to) - level(from)) * along - line.level) < 0.5
      )
        spots.push([along, 0]);
    }
    for (let away = 0; away <= reach; away += STEP)
      for (const way of away ? [1, -1] : [1]) {
        const along = wanted + way * away;
        if (!away || (along >= end && along <= length - end)) spots.push([along, away]);
      }
    // A label moves along its run before it stands off its wire.
    for (const lift of text ? LIFTS : [0])
      for (const [along, away] of spots) {
        const spot = {
          x: from.x + ((to.x - from.x) * along) / (length || 1),
          y: from.y + ((to.y - from.y) * along) / (length || 1),
        };
        // Two boundaries side by side read as one crooked line.
        const crooked = lines.some(
          (line) =>
            Math.abs(line.at - across(spot)) < NEIGHBOUR &&
            Math.abs(line.level - level(spot)) > 0.5 &&
            Math.abs(line.level - level(spot)) < APART,
        );
        for (const [turn, side] of sides.entries()) {
          const [found, drawn] = rooms(spot, side, up, lift),
            hits = covered(edge, drawn, circle, around) + (crooked ? EDGE : 0),
            held = around.foreign?.some((box) => drawn.some((room) => overlaps(room, box))),
            cost = hits + (held ? INSIDE : 0) + rank * 1.5 + away * 0.02 + turn * 0.3 + lift * 0.1;
          const mark = { spot, host, up, rooms: found, drawn, hits, cost };
          if (!hits && !held) return mark;
          if (!best || cost < best.cost) best = mark;
        }
      }
  }
  return best;
}
