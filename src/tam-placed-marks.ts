/**
 * TAM layout by hand: where a connection's circle and label stand on its wire. Every wire lies
 * before the first mark is placed, so a mark takes the spot on its wire where it covers nothing:
 * no element, no other wire, no other mark, no container's border or title.
 */

import { type Box, grow, inside, overlaps, type Point, segmentHits } from "./scene.ts";
import type { TamEdge } from "./tam.ts";
import type { ElkLabel } from "elkjs/lib/elk-api";
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

/** How much one box of a mark covers of what surrounds it; `own` is a circle, which its own wire runs through. */
function roomHits(edge: TamEdge, room: Box, own: boolean, around: Surroundings): number {
  let hits = 0;
  const box = grow(room, 2);
  for (const other of around.solids) if (overlaps(box, other)) hits += SOLID;
  for (const other of around.placed) if (overlaps(box, other.box)) hits += PLACED;
  hits += wireHits(edge, box, own, around) + borderHits(room, around);
  for (const other of around.titles) if (overlaps(box, other)) hits += PLACED;
  return hits;
}

/** A border passes a mark at twice the distance of anything else: it is a long line beside it. */
function borderHits(room: Box, around: Surroundings): number {
  let hits = 0;
  const wide = grow(room, 4);
  for (const other of around.containers)
    if (overlaps(wide, other) && !inside(wide, other)) hits += EDGE;
  return hits;
}

/** How much a box covers of the wires around it; a loop's two lines lie `half` to either side of its own. */
function wireHits(edge: TamEdge, box: Box, own: boolean, around: Surroundings): number {
  let hits = 0;
  for (const wire of around.wires)
    if (
      !(own && wire.owner === edge.id) &&
      segmentHits(wire.a, wire.b, wire.half ? grow(box, wire.half) : box)
    )
      hits += WIRE;
  return hits;
}

/** How much the boxes of a mark cover of what surrounds them. */
function covered(edge: TamEdge, boxes: Box[], circle: boolean, around: Surroundings): number {
  let hits = 0;
  boxes.forEach((room, index) => {
    hits += roomHits(edge, room, circle && index === boxes.length - 1, around);
  });
  return hits;
}

/** What a mark is placed for: a connection with what it carries, what surrounds its wire, and where it would stand. */
interface Marking {
  edge: TamEdge;
  circle: boolean;
  /** The size of its circle: 0 for a label alone. */
  size: number;
  /** The size of its label, where it carries a label and no circle. */
  text?: { width: number; height: number };
  /** The room the connection takes to either side of its wire. */
  half: number;
  /** How far a mark keeps from the ends of its run. */
  end: number;
  prefer: { share: number; outer: number };
  around: Surroundings;
  prepared: Pick<TamGraph, "channelLabels">;
}

/** A run of a wire a mark may stand on: it starts at point `host` of the line, `rank` runs are better. */
interface Host {
  host: number;
  rank: number;
  from: Point;
  to: Point;
  length: number;
  up: boolean;
}

/** A mark with what it costs where it stands. */
type Candidate = Mark & { cost: number };

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
  if (!circled(edge) && !edge.label) return undefined;
  const marking = markingOf(edge, prefer, around, prepared, measure);
  let best: Candidate | undefined;
  for (const [rank, host] of hostsOf(points).entries()) {
    const run = hostAt(points, host, rank);
    if (rank && run.length < 2 * marking.end) break;
    const found = bestOn(marking, run, best);
    if (found.free) return found.best;
    best = found.best;
  }
  return best;
}

/** What placing the mark of a connection that carries one takes into account. */
function markingOf(
  edge: TamEdge,
  prefer: Marking["prefer"],
  around: Surroundings,
  prepared: Marking["prepared"],
  measure: Measure,
): Marking {
  const circle = circled(edge);
  return {
    edge,
    circle,
    size: !circle ? 0 : edge.kind === "assembly" ? ASSEMBLY : CHANNEL,
    text: !circle ? smallSize(edge.label!, measure) : undefined,
    half: thickness(edge),
    end: !circle ? 8 : edge.flow ? HEAD : END,
    prefer,
    around,
    prepared,
  };
}

/** The run of a line that starts at point `host`, the `rank`th best. */
function hostAt(points: Point[], host: number, rank: number): Host {
  const from = points[host],
    to = points[host + 1];
  return { host, rank, from, to, length: runLength(from, to), up: runsUpright(points, host) };
}

/** The runs of a line, longest first; of equal ones a run between two corners, where a circle leaves the elements clear. */
function hostsOf(points: Point[]): number[] {
  const weigh = (index: number) =>
    runLength(points[index], points[index + 1]) +
    (index > 0 && index < points.length - 2 ? 0.5 : 0);
  return points
    .slice(1)
    .map((_, index) => index)
    .toSorted((p, q) => weigh(q) - weigh(p));
}

/**
 * The best mark on one run, or `best` where none there is better; `free` where the mark covers
 * nothing, which ends the search.
 */
function bestOn(
  marking: Marking,
  run: Host,
  best: Candidate | undefined,
): { best: Candidate | undefined; free: boolean } {
  const { up } = run,
    sides = sidesOf(marking, run);
  // A circle on a protocol's boundary stands in line with the circles of that protocol nearby.
  const lines = marking.edge.protocol
    ? marking.around.boundaries.filter((line) => line.up === up)
    : [];
  const spots = spotsOn(marking, run, lines);
  // A label moves along its run before it stands off its wire.
  for (const lift of marking.text ? LIFTS : [0])
    for (const [along, away] of spots) {
      const spot = pointAt(run, along),
        crooked = isCrooked(lines, spot, up);
      for (const [turn, side] of sides.entries()) {
        const { mark, free } = markAt(marking, run, { spot, side, lift, away, turn, crooked });
        if (free) return { best: mark, free };
        if (!best || mark.cost < best.cost) best = mark;
      }
    }
  return { best, free: false };
}
/**
 * The sides of a run a mark tries in turn: -1 left of or above the wire, 1 right of or below it, 0
 * as the notation has it. The left of a line is below a run to the right and above one to the
 * left, left of a run down.
 */
function sidesOf({ prefer: { outer } }: Marking, { from, to, up }: Host): number[] {
  const left = up ? (to.y > from.y ? -1 : 1) : to.x > from.x ? 1 : -1;
  return outer ? [outer * left, 0, -outer * left] : [0, -1, 1];
}

/**
 * The spots along a run a mark may stand at, as how far along the run and how far from the one
 * it wants: in line with a boundary of its protocol first, then outward from the wanted spot.
 */
function spotsOn(
  marking: Marking,
  run: Host,
  lines: Surroundings["boundaries"],
): [number, number][] {
  const { end } = marking,
    { length } = run,
    [wanted, reach] = wantedOn(marking, run);
  const spots: [number, number][] = lines
    .filter((line) => inLine(marking, run, line))
    .map((line) => [Math.abs(line.level - levelOf(run.from, run.up)), 0]);
  for (let away = 0; away <= reach; away += STEP)
    for (const way of away ? [1, -1] : [1]) {
      const along = wanted + way * away;
      if (!away || (along >= end && along <= length - end)) spots.push([along, away]);
    }
  return spots;
}

/**
 * Where on a run a mark wants to stand: at its share of the way along the best run, in the middle
 * of the others, and how far it may move from there.
 */
function wantedOn({ end, prefer }: Marking, { length, rank }: Host): [number, number] {
  if (length < 2 * end) return [length / 2, 0];
  const wanted = Math.min(length - end, Math.max(end, length * (rank ? 0.5 : prefer.share)));
  return [wanted, Math.max(wanted - end, length - end - wanted)];
}

/** Where a point lies along a run that goes up or down, or across. */
const levelOf = (spot: Point, up: boolean) => (up ? spot.y : spot.x);
/** Where a point lies across such a run. */
const acrossOf = (spot: Point, up: boolean) => (up ? spot.x : spot.y);

/** Whether a protocol's boundary nearby crosses a run where a circle of the protocol may stand on it. */
function inLine(
  { edge, end }: Marking,
  { from, to, up, length }: Host,
  line: Surroundings["boundaries"][number],
): boolean {
  const start = levelOf(from, up),
    along = Math.abs(line.level - start);
  return (
    line.protocol === edge.protocol &&
    Math.abs(line.at - acrossOf(from, up)) < NEIGHBOUR &&
    along >= end &&
    along <= length - end &&
    Math.abs(start + Math.sign(levelOf(to, up) - start) * along - line.level) < 0.5
  );
}

/** The point `along` a run. */
const pointAt = ({ from, to, length }: Host, along: number): Point => ({
  x: from.x + ((to.x - from.x) * along) / (length || 1),
  y: from.y + ((to.y - from.y) * along) / (length || 1),
});

/** Whether a circle at a spot puts its boundary beside another one: two side by side read as one crooked line. */
const isCrooked = (lines: Surroundings["boundaries"], spot: Point, up: boolean) =>
  lines.some(
    (line) =>
      Math.abs(line.at - acrossOf(spot, up)) < NEIGHBOUR &&
      Math.abs(line.level - levelOf(spot, up)) > 0.5 &&
      Math.abs(line.level - levelOf(spot, up)) < APART,
  );

/** A mark at a spot, on one side of its run, with what it costs; `free` where it covers nothing. */
function markAt(
  marking: Marking,
  { host, up, rank }: Host,
  at: { spot: Point; side: number; lift: number; away: number; turn: number; crooked: boolean },
): { mark: Candidate; free: boolean } {
  const { spot, side, lift, away, turn, crooked } = at,
    { edge, circle, around } = marking;
  const [found, drawn] = roomsAt(marking, spot, side, up, lift),
    hits = covered(edge, drawn, circle, around) + (crooked ? EDGE : 0),
    held = around.foreign?.some((box) => drawn.some((room) => overlaps(room, box))),
    cost = hits + (held ? INSIDE : 0) + rank * 1.5 + away * 0.02 + turn * 0.3 + lift * 0.1;
  return { mark: { spot, host, up, rooms: found, drawn, hits, cost }, free: !hits && !held };
}

/** The rooms beside the wire at a spot, with everything on `side` of the wire, and what is drawn in them. */
function roomsAt(
  marking: Marking,
  spot: Point,
  side: number,
  up: boolean,
  lift: number,
): [Box[], Box[]] {
  if (marking.text) {
    const room = labelRoom(marking.text, marking.half, spot, side, up, lift);
    return [[room], [room]];
  }
  return circleRooms(marking, spot, side, up);
}

/** A label stands beside the run: right of one that runs up or down, above one across. */
function labelRoom(
  { width, height }: { width: number; height: number },
  half: number,
  spot: Point,
  side: number,
  up: boolean,
  lift: number,
): Box {
  return up
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
}

/**
 * The rooms of a circle and its label and marker. Beside an upright wire everything stands in one
 * room, right of it or left; at a wire across, the label above and the marker below, or both on
 * one side.
 */
function circleRooms(
  { edge, size, prepared }: Marking,
  spot: Point,
  side: number,
  up: boolean,
): [Box[], Box[]] {
  const labels = prepared.channelLabels(edge, up);
  const box = { x: spot.x - size / 2, y: spot.y - size / 2, width: size, height: size };
  const stack = { above: box.y - MARKER_GAP, below: box.y + size + MARKER_GAP };
  const found: Box[] = [],
    drawn: Box[] = [];
  // On one side the marker stands next to the circle and the label beyond it.
  const aside = !!side && !edge.protocol,
    order = labels.map((_, at) => at);
  if (aside) order.reverse();
  for (const at of order) {
    const where = placementOf(labels[at]),
      width = labels[at].width!,
      height = labels[at].height!;
    if (where.includes("H_RIGHT")) {
      found[at] = drawn[at] = besideCircle(box, spot, side, width, height);
      continue;
    }
    found[at] = stacked(stack, spot, aside ? side < 0 : where.includes("V_TOP"), width, height);
    // Beside a protocol's boundary the label and the marker stand right of the line through the circle.
    drawn[at] = edge.protocol
      ? { ...found[at], x: spot.x + ASIDE, width: at ? 22 : (width - 14) / 2 }
      : found[at];
  }
  return [
    [...found, box],
    [...drawn, box],
  ];
}

/** Where ELK would place a label of a channel's circle. */
const placementOf = (label: ElkLabel) => label.layoutOptions?.["elk.nodeLabels.placement"] ?? "";

/** A label or marker beside a circle: left of it on the left side, else right of it. */
const besideCircle = (box: Box, spot: Point, side: number, width: number, height: number) => ({
  x: side < 0 ? box.x - MARKER_GAP - width : box.x + box.width + MARKER_GAP,
  y: spot.y - height / 2,
  width,
  height,
});

/** A label or marker stacked above a circle, or below it, beyond those stacked there already. */
function stacked(
  stack: { above: number; below: number },
  spot: Point,
  over: boolean,
  width: number,
  height: number,
): Box {
  const room = {
    x: spot.x - width / 2,
    y: over ? stack.above - height : stack.below,
    width,
    height,
  };
  if (over) stack.above -= height + 2;
  else stack.below += height + 2;
  return room;
}
