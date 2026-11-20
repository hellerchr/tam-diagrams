/**
 * TAM layout by hand, second step: the wires between the placed elements. Every pair of elements
 * gets the cheapest line through the field of what stands around it (tam-placed-field.ts): one of
 * the simple lines of tam-placed-lines.ts, or a way around from tam-placed-detour.ts. The wires
 * that end on one side of an element keep apart, and once every wire lies, each connection's
 * circle and label take a free spot on it (tam-placed-marks.ts); a connection with no free spot
 * on its wire gets another line.
 */

import { around, type Box, centerOf, grow, middlesApart, type Point } from "./scene.ts";
import type { TamEdge } from "./tam.ts";
import type { Measure } from "./text.ts";
import { outline } from "./route.ts";
import { CHANNEL, LOOP_END, SHADOW, type TamGeometry, type TamGraph } from "./tam-graph.ts";
import { lies, type PlacedElements, type Side } from "./tam-placed.ts";
import { detour, GAP, type Line, meets } from "./tam-placed-detour.ts";
import {
  ALONG,
  type Field,
  fieldOf,
  price,
  runsOf,
  type Scope,
  scopeOf,
  terrainOf,
  THROUGH,
  type Traveller,
  TROUBLE,
} from "./tam-placed-field.ts";
import {
  beside,
  between,
  type End,
  inRange,
  lines,
  plainSpots,
  PORT,
  range,
  REACH,
  runLength,
  type Spot,
  type Spots,
  SPOTS,
} from "./tam-placed-lines.ts";
import { type Port, portAlong, portsAlong, portText } from "./tam-ports.ts";
import {
  circled,
  HIT,
  type Mark,
  marked,
  placeMark,
  type Surroundings,
  thickness,
} from "./tam-placed-marks.ts";

/** Wires of a bundle keep this far apart, wire ends on one side GAP, and TIGHT where a side is full. */
const APART = 18,
  TIGHT = 6;

/** A circle on the run that leaves a side keeps the wire ends beside it this much further off. */
const CIRCLE = 6;

/** A wire's run with a channel's circle or a label on it is at least this long. */
const ROOM = 44;

/**
 * What a line costs beside what it meets: a corner counts like BEND pixels of wire. SHORT is a line
 * too short for the label at its circle, CRAMPED one too short for the circle itself, CROWDED a side
 * with more wire ends than fit, TAKEN a spot on a side another wire ends at, CLOSE one nearer to
 * another wire end than two wires keep apart. A line that leaves or
 * enters across the diagram's direction pays SIDEWAYS, one off the middle of a side OFF_MIDDLE, a
 * part of it at another of the side's ports (PORT, tam-placed-lines.ts), all of it beside a middle
 * that another wire holds where no port is free. A mark that covers something counts like
 * COVER pixels for each point it covers.
 */
const BEND = 70,
  LENGTH = 0.25,
  SHORT = 90,
  CRAMPED = 600,
  CROWDED = 120,
  TAKEN = 1200,
  CLOSE = 300,
  SIDEWAYS = 80,
  OFF_MIDDLE = 150,
  COVER = 60;

/** A line that costs this much more than the one its bundle takes alone is worth another wire's giving way. */
const PUSHED = 150;

/** A connection whose marks cover something gets the best of this many other lines. */
const OTHERS = 5;

/** The connections between one pair of elements run side by side as a bundle, along one line. */
interface Bundle extends Line {
  key: string;
  a: End;
  b: End;
  members: TamEdge[];
  /** One element holds the other: the wire runs inside it. */
  nested: boolean;
  /** Each member's distance from the bundle's line, to its left. */
  offsets: number[];
  /** Half of the room the bundle takes across, with what its members carry. */
  half: number;
  /** Half of the room its wires alone take, where they end on a side. */
  reach: number;
  traveller: Traveller;
  /** The key of each side of each end, for what the side holds. */
  sides: Record<"a" | "b", Record<Side, string>>;
  /** The port each end takes where its connections name one (tam-ports.ts): its line ends there and nowhere else. */
  pins: Record<"a" | "b", Port | undefined>;
  /** Each member's line, and its circle and label. */
  laid: Point[][];
  marks: (Mark | undefined)[];
  /** How much the marks cover as they stand: 0 where every one stands free. */
  covered: number;
}

/** A wire end on a side of an element, by the key of its bundle: where along the side, and half of its room. */
interface Taken {
  at: number;
  half: number;
  key: string;
}

/** One end of a bundle: `a` the source of its first member, `b` the target. */
type Which = "a" | "b";

const ENDS = ["a", "b"] as const;

/** The wiring of a layout placed by hand as it goes on: the field, the wire ends on each side, the bundles. */
interface Wiring {
  prepared: TamGraph;
  measure: Measure;
  /** Elements and interface circles by id. */
  boxes: Map<string, Box>;
  field: Field;
  /** The wire ends each side of each element holds, as bundles choose their lines and ends move apart. */
  taken: Map<string, Taken[]>;
  /** What the circles and labels on the wires keep off, as wires and marks take their places. */
  surroundings: Surroundings;
  /** The pieces of the interfaces' lines. */
  stubs: Surroundings["wires"];
  /** Every bundle, in the order they take their lines. */
  queue: Bundle[];
}

/** The wires, channel circles and label rooms of a layout placed by hand, added to the placed elements. */
export function placedGeometry(
  prepared: TamGraph,
  placed: PlacedElements,
  measure: Measure,
  draft = false,
): TamGeometry {
  const boxes = new Map(placed.boxes),
    elements = elementsOf(prepared, boxes),
    round = roundsOf(prepared, elements, boxes);
  const field = fieldOf(prepared, placed, elements, measure);
  const wiring: Wiring = {
    prepared,
    measure,
    boxes,
    field,
    taken: new Map(),
    surroundings: {
      solids: field.solids.map((wall) => wall.box),
      containers: field.containers.map((wall) => wall.box),
      titles: field.titles.map((wall) => wall.box),
      wires: [],
      placed: [],
      boundaries: [],
    },
    stubs: [...placed.stubs].flatMap(([owner, points]) =>
      points.slice(1).map((point, index) => ({ owner, a: points[index], b: point })),
    ),
    queue: [],
  };
  const markers = takeInterfaces(wiring, placed);
  const end = (id: string): End => ({ id, box: boxes.get(id)!, radius: round.get(id) ?? 0 });
  const alone = layAll(wiring, bundlesOf(wiring, end));
  if (!draft) untangle(wiring, alone);
  for (const item of remark(wiring)) relay(wiring, item);
  const geometry: TamGeometry = {
    boxes,
    edgeLabels: new Map(),
    leaves: new Set(elements.filter((id) => !prepared.shapes.get(id)!.container)),
    markers,
    nodeLabels: new Map(placed.labels),
    round,
    routes: new Map(placed.stubs),
    upright: new Map(placed.upright),
    dots: placed.dots,
  };
  for (const item of wiring.queue)
    item.members.forEach((edge, index) => drawMember(geometry, item, edge, index));
  return geometry;
}

/** The placed elements wires join: no rows, dots, interfaces or channels. */
function elementsOf({ shapes }: TamGraph, boxes: Map<string, Box>): string[] {
  return [...shapes.keys()].filter(
    (id) =>
      boxes.has(id) &&
      !id.endsWith("#row") &&
      !["dots", "interface", "channel"].includes(shapes.get(id)!.node.kind),
  );
}

/** Rounded shapes: leaf storages are pills, storage containers and groups of storages have round corners. */
function roundsOf(
  { shapes }: TamGraph,
  elements: string[],
  boxes: Map<string, Box>,
): Map<string, number> {
  const round = new Map<string, number>();
  for (const id of elements) {
    const { node, container } = shapes.get(id)!;
    if (node.kind === "storage" && !container)
      round.set(id, (boxes.get(id)!.height - (node.stack ? SHADOW : 0)) / 2);
    else if (container && (node.kind === "storage" || (node.kind === "group" && node.passive)))
      round.set(id, 18);
  }
  return round;
}

/**
 * An interface's line takes its place on the side it leaves, like any wire end. Returns the
 * interface circles, which carry markers.
 */
function takeInterfaces(wiring: Wiring, placed: PlacedElements): Set<string> {
  const markers = new Set<string>(),
    { boxes } = wiring;
  for (const [edge, stub] of placed.stubs) {
    const { source, target } = wiring.prepared.diagram.edges.find((item) => item.id === edge) ?? {};
    if (!source || !target || !boxes.has(target) || !boxes.has(source)) continue;
    markers.add(target);
    const side = stubSide(stub);
    addTaken(wiring, `${source}\u0000${side}`, {
      at: lies(side) ? stub[0].x : stub[0].y,
      half: CHANNEL / 2,
      key: edge,
    });
  }
  return markers;
}

/** The side of its element an interface's line leaves by. */
function stubSide([from, to]: Point[]): Side {
  if (Math.abs(from.x - to.x) < 0.5) return to.y > from.y ? "bottom" : "top";
  return to.x > from.x ? "right" : "left";
}

/** Notes a wire end on a side. */
function addTaken(wiring: Wiring, key: string, end: Taken) {
  const list = wiring.taken.get(key) ?? [];
  wiring.taken.set(key, list);
  list.push(end);
}

/** The wire ends on a side but the bundle's own. */
const othersOn = (wiring: Wiring, item: Bundle, key: string) =>
  (wiring.taken.get(key) ?? []).filter((other) => other.key !== item.key);

/** The innermost container that holds both elements; the outer one where it holds the other. */
function homeOf({ prepared: { chain, shapes }, boxes }: Wiring, a: string, b: string) {
  const around = new Set(chain(b));
  const id = chain(a).find(
    (id) => around.has(id) && !id.endsWith("#row") && shapes.get(id)?.container,
  );
  return id ? boxes.get(id) : undefined;
}

const sidesOf = (id: string) =>
  Object.fromEntries(
    (["top", "bottom", "left", "right"] as Side[]).map((side) => [side, `${id}\u0000${side}`]),
  ) as Record<Side, string>;

/** The port a connection names for its end at an element (tam-ports.ts). */
const portAt = (edge: TamEdge, id: string) =>
  edge.source === id ? edge.sourcePort : edge.targetPort;

/** A bundle of connections between two elements, before it takes a line. */
function newBundle(wiring: Wiring, key: string, a: End, b: End, members: TamEdge[]): Bundle {
  const { chain } = wiring.prepared,
    nested = chain(a.id).includes(b.id) || chain(b.id).includes(a.id),
    sides = { a: sidesOf(a.id), b: sidesOf(b.id) },
    // A wire inside its container runs straight in from its border: only the part's port could be said, and is not.
    pins = nested
      ? { a: undefined, b: undefined }
      : { a: portAt(members[0]!, a.id), b: portAt(members[0]!, b.id) };
  return {
    key,
    a,
    b,
    members,
    from: "bottom",
    to: "top",
    points: [],
    nested,
    offsets: [0],
    half: 0,
    reach: 0,
    traveller: {
      key,
      own: new Set([...chain(a.id), ...chain(b.id)]),
      ends: nested ? [] : [a.box, b.box],
      home: homeOf(wiring, a.id, b.id),
      half: 0,
      sides: [sides.a, sides.b],
    },
    sides,
    pins,
    laid: [],
    marks: [],
    covered: 0,
  };
}

/** Connections between one pair of elements share a line: one bundle for each pair and the ports they name. */
function bundlesOf(wiring: Wiring, end: (id: string) => End): Map<string, Bundle> {
  const bundles = new Map<string, Bundle>(),
    { boxes } = wiring;
  for (const edge of wiring.prepared.diagram.edges) {
    if (edge.kind === "provided" || edge.kind === "required") continue;
    if (!boxes.has(edge.source) || !boxes.has(edge.target)) continue;
    const key = [edge.source + portText(edge.sourcePort), edge.target + portText(edge.targetPort)]
      .toSorted()
      .join("\u0000");
    const found = bundles.get(key);
    if (found) found.members.push(edge);
    else bundles.set(key, newBundle(wiring, key, end(edge.source), end(edge.target), [edge]));
  }
  return bundles;
}

/** Where the members of a bundle run beside its line, by what each carries: a loop's width, a circle. */
function placesOf(members: TamEdge[]): number[] {
  const found = [0];
  for (let index = 1; index < members.length; index++)
    found.push(
      found[index - 1] +
        Math.max(APART, thickness(members[index - 1]) + thickness(members[index]) + 8),
    );
  return found;
}

/** The room a loop's two lines take beside the bundle's own where it ends. */
const loopRoom = (item: Bundle) =>
  item.members.some((edge) => edge.kind === "modify") ? LOOP_END : 0;

/** The room a side leaves a bundle that ends on it. */
const roomFor = (item: Bundle, line: Line = item) =>
  Math.min(...[range(item.a, line.from), range(item.b, line.to)].map(([low, high]) => high - low));

/** Gives a bundle the room its members take side by side, before a side presses them together. */
function unpressed(item: Bundle) {
  item.reach = placesOf(item.members).at(-1)! / 2 + loopRoom(item);
  item.half = item.traveller.half =
    placesOf(item.members).at(-1)! / 2 + Math.max(...item.members.map(thickness)) / 2;
}

/** Spreads the members of a bundle across its line; one wider than the sides it ends on is pressed together to fit them. */
function arrange(item: Bundle) {
  const found = placesOf(item.members),
    width = found.at(-1)!,
    fits = roomFor(item),
    press = width > fits && width > 0 ? Math.max(fits, (found.length - 1) * 6) / width : 1;
  item.offsets = found.map((place) => (place - width / 2) * press);
  item.reach = (width * press) / 2 + loopRoom(item);
  item.half = (width * press) / 2 + Math.max(...item.members.map(thickness)) / 2;
  item.traveller.half = item.half;
}

/** The side a line leaves the end `which` by, or enters it by. */
const sideOf = (which: Which, line: Line) => (which === "a" ? line.from : line.to);

/** The key of the side a line ends on at one end of a bundle. */
const sideKey = (item: Bundle, which: Which, line: Line = item) =>
  item.sides[which][sideOf(which, line)];

/** Where along its side a line ends at one end of a bundle. */
function endAt(which: Which, line: Line) {
  const point = which === "a" ? line.points[0] : line.points.at(-1)!;
  return lies(sideOf(which, line)) ? point.x : point.y;
}

/**
 * Half of the room a bundle takes where one of its ends meets its side: its wires, and the circle
 * of a channel where the run that leaves the side is the longest, the one the circle stands on,
 * and too short for the circle to stand far from the side.
 */
function reachAt(item: Bundle, which: Which, line: Line = item) {
  const { points } = line,
    lengths = points.slice(1).map((point, index) => runLength(points[index], point)),
    own = which === "a" ? lengths[0] : lengths.at(-1)!;
  return (
    item.reach +
    (item.members.some(circled) && own >= Math.max(...lengths) && own < 2 * ROOM ? CIRCLE : 0)
  );
}

/** What a line costs before what it meets: corners, length, no room for a circle, a crowded side. */
function plain(wiring: Wiring, item: Bundle, line: Line): number {
  const { points } = line;
  // A reads/writes loop pays its corners twice: bent, it is two parallel lines with sharp corners, straight two arcs.
  let total = (points.length - 2) * BEND * (loopRoom(item) ? 2 : 1),
    most = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const length = runLength(points[index], points[index + 1]);
    total += length * LENGTH;
    most = Math.max(most, length);
  }
  if (line.from === line.to && !item.nested) total += BEND;
  // A line leaves the middle of a side unless something stands in its way there.
  total += (line.off ?? 0) * OFF_MIDDLE;
  total += roomCost(item, most);
  // Of equal lines, the one that leaves and enters along the diagram's direction.
  const { vertical } = wiring.prepared;
  total += lies(line.from) !== vertical ? SIDEWAYS : 0;
  total += lies(line.to) !== vertical ? SIDEWAYS : 0;
  for (const which of ENDS) for (const cost of endCosts(wiring, item, which, line)) total += cost;
  return total;
}

/** What a line pays whose longest run leaves its circle or its label too little room. */
function roomCost(item: Bundle, most: number): number {
  if (item.members.some(circled) && most < CHANNEL + 8) return CRAMPED;
  if (most < ROOM && item.members.some(marked)) return SHORT;
  return 0;
}

/**
 * What a line pays at one end for the wire ends on its side: every wire end has a spot of its own
 * on its side, with a gap to the next, and a side has room for so many.
 */
function endCosts(wiring: Wiring, item: Bundle, which: Which, line: Line): number[] {
  const others = othersOn(wiring, item, sideKey(item, which, line));
  if (!others.length) return [];
  const spot = endAt(which, line),
    reach = reachAt(item, which, line),
    nearest = Math.min(...others.map((other) => Math.abs(other.at - spot) - other.half - reach));
  const [low, high] = range(item[which], sideOf(which, line));
  const needed =
    others.reduce((sum, other) => sum + 2 * other.half + APART, 0) +
    (item.members.length - 1) * APART;
  return [
    nearest < GAP ? (nearest < TIGHT ? TAKEN : CLOSE) : 0,
    needed > high - low ? CROWDED : 12,
  ];
}

const windowOf = (item: Bundle, by: number) => grow(around([item.a.box, item.b.box]), by);

/** Where the ends of a bundle may take their spots, for the lines it may take: a pinned end only at its port. */
const spotsOf =
  (wiring: Wiring, item: Bundle): Spots =>
  (end, side) => {
    const pin = item.pins[end === item.a ? "a" : "b"];
    if (!pin) return sideSpots(wiring, item, end, side);
    return pin.side === side ? [{ at: portAlong(end.box, pin), off: 0 }] : [];
  };

/** Whether a line ends at the ports a bundle's connections name. */
const pinnedBy = (item: Bundle, line: Line) =>
  ENDS.every((which) => {
    const pin = item.pins[which];
    return (
      !pin ||
      (sideOf(which, line) === pin.side &&
        Math.abs(endAt(which, line) - portAlong(item[which].box, pin)) < 1)
    );
  });

/**
 * The spots on a side one end of a bundle may take: its ports where no other wire ends near them,
 * the middle first; where every port is taken, the nearest free spot beside the middle either way.
 */
function sideSpots(wiring: Wiring, item: Bundle, end: End, side: Side): Spot[] {
  const which = end === item.a ? "a" : "b",
    others = othersOn(wiring, item, item.sides[which][side]);
  if (!others.length) return plainSpots(end, side);
  const [low, high] = range(end, side),
    reach = item.reach + (item.members.some(circled) ? CIRCLE : 0);
  const free = (spot: number, gap: number) =>
    others.every((other) => Math.abs(other.at - spot) >= other.half + reach + gap);
  const found: Spot[] = [];
  const add = (at: number, off: number) => {
    if (found.every((spot) => Math.abs(spot.at - at) >= 4)) found.push({ at, off });
  };
  // The free ports nearest the middle: a long side has many, and the line is tried at each.
  for (const at of inRange(end, side, portsAlong(end.box, side))) {
    if (found.length === SPOTS) break;
    if (free(at, GAP)) add(at, Math.abs(at - (low + high) / 2) < 1 ? 0 : PORT);
  }
  if (!found.length) besideMiddle(free, add, low, high);
  if (!found.length) add((low + high) / 2, 2);
  return found;
}

/** Beside a middle that is taken, the nearest free spot either way: GAP from the others, else TIGHT. */
function besideMiddle(
  free: (spot: number, gap: number) => boolean,
  add: (at: number, off: number) => void,
  low: number,
  high: number,
) {
  const middle = (low + high) / 2;
  for (const gap of [GAP, TIGHT]) {
    let added = false;
    for (const way of [-1, 1]) {
      const spot = nearestFree(middle, way, low, high, (spot) => free(spot, gap));
      if (spot === undefined) continue;
      add(spot, gap === GAP ? 1 : 2);
      added = true;
    }
    if (added) break;
  }
}

/** The first spot from the middle one way, a pixel at a time, that is free. */
function nearestFree(
  middle: number,
  way: number,
  low: number,
  high: number,
  free: (spot: number) => boolean,
) {
  for (let spot = middle + way; spot >= low && spot <= high; spot += way)
    if (free(spot)) return spot;
  return undefined;
}

/** One end of a bent line on the move along its side, past the wire ends that lie there. */
interface Moving {
  item: Bundle;
  line: Line;
  which: Which;
  others: Taken[];
  /** What the line meets as it lies, worked out at the first spot it may move to. */
  scope?: Scope;
  met: number;
}

/** On a side with more ends than fit GAP apart, they move closer together, at last without room for circles. */
const SQUEEZES = [
  [GAP, true],
  [TIGHT, true],
  [TIGHT, false],
] as const;

/**
 * A bent line with one end moved along its side, with the run that leaves it, to the nearest spot
 * that is free of the ends the side holds already and where that run meets no new trouble; the
 * line itself where its end is free as it lies, or no other spot is.
 */
function apart(wiring: Wiring, item: Bundle, line: Line, which: Which): Line {
  const side = sideOf(which, line),
    [low, high] = range(item[which], side),
    others = othersOn(wiring, item, sideKey(item, which, line));
  if (!others.length || line.points.length < 3 || item.pins[which]) return line;
  const moving: Moving = { item, line, which, others, met: 0 };
  const start = endAt(which, line);
  // A free port first, the nearest one; then the nearest free spot.
  const ports = inRange(item[which], side, portsAlong(item[which].box, side)).toSorted(
    (p, q) => Math.abs(p - start) - Math.abs(q - start),
  );
  for (const spot of ports) {
    if (!endFree(moving, spot, GAP, true)) continue;
    if (Math.abs(spot - start) < 1) return line;
    if (passes(wiring, moving, spot)) return { ...line, points: movedEnd(moving, spot) };
  }
  for (const [gap, circle] of SQUEEZES)
    for (const spot of outward(start, towardOther(item, which, side, start), low, high)) {
      if (!endFree(moving, spot, gap, circle)) continue;
      if (spot === start) return line;
      if (passes(wiring, moving, spot)) return { ...line, points: movedEnd(moving, spot) };
    }
  return line;
}

/** Which way along its side the element at the bundle's other end lies, from a spot at one end. */
function towardOther(item: Bundle, which: Which, side: Side, start: number) {
  const other = centerOf(item[which === "a" ? "b" : "a"].box);
  return Math.sign((lies(side) ? other.x : other.y) - start) || 1;
}

/** The spots on a side from `start` outward, three pixels at a time, toward the other element first. */
function* outward(start: number, toward: number, low: number, high: number) {
  for (let step = 0; step <= high - low; step += 3)
    for (const spot of [start + toward * step, start - toward * step])
      if (spot >= low && spot <= high) yield spot;
}

/** Whether a spot on its side keeps a moving end `gap` from the others there, with room for a circle or without. */
function endFree(
  { item, line, which, others }: Moving,
  spot: number,
  gap: number,
  circle: boolean,
) {
  return others.every(
    (other) =>
      Math.abs(other.at - spot) >=
      (circle
        ? other.half + reachAt(item, which, line)
        : Math.min(other.half, LOOP_END) + item.reach) +
        gap,
  );
}

/** The line with its end and the run that leaves it moved to a spot along its side. */
function movedEnd({ line, which }: Moving, spot: number): Point[] {
  const { points } = line,
    axis = lies(sideOf(which, line)) ? "x" : "y",
    [first, second] = which === "a" ? [0, 1] : [points.length - 1, points.length - 2];
  return points.map((point, index) =>
    index === first || index === second ? { ...point, [axis]: spot } : point,
  );
}

/** Whether the line with its end moved to a spot meets no new trouble. */
function passes(wiring: Wiring, moving: Moving, spot: number): boolean {
  const { item, line } = moving;
  if (!moving.scope) {
    moving.scope = scopeOf(wiring.field, item.traveller, windowOf(item, 200));
    moving.met = price(moving.scope, line.points, line.from, line.to);
  }
  return price(moving.scope, movedEnd(moving, spot), line.from, line.to) < moving.met + TROUBLE;
}

/** A line with what it costs, and what of that it pays for what it meets. */
interface Priced {
  line: Line;
  cost: number;
  met: number;
}

/**
 * Adds a line to the `count` cheapest found so far, cheapest first, priced in a scope; of several,
 * only the cheapest between one pair of sides.
 */
function consider(found: Priced[], count: number, line: Line, cost: number, within: Scope) {
  if (found.length === count && cost >= found.at(-1)!.cost) return;
  const met = price(within, line.points, line.from, line.to),
    total = cost + met;
  if (count > 1 && !dropDearer(found, line, total)) return;
  const index = found.findIndex((other) => total < other.cost);
  if (index < 0 && found.length === count) return;
  found.splice(index < 0 ? found.length : index, 0, { line, cost: total, met });
  if (found.length > count) found.pop();
}

/**
 * Of the lines between one pair of sides, only the cheapest is one of several to choose from:
 * drops a dearer one between the sides of `line`, and says whether `line` may join.
 */
function dropDearer(found: Priced[], line: Line, total: number): boolean {
  const same = found.findIndex(
    (other) => other.line.from === line.from && other.line.to === line.to,
  );
  if (same < 0) return true;
  if (found[same].cost <= total) return false;
  found.splice(same, 1);
  return true;
}

/** The cheapest `count` lines for a bundle in the field as it is, cheapest first, with what each costs; of several, each between other sides. */
function cheapest(wiring: Wiring, item: Bundle, count: number): Priced[] {
  const part = !item.nested
    ? undefined
    : wiring.prepared.chain(item.a.id).includes(item.b.id)
      ? item.a
      : item.b;
  const scope = scopeOf(wiring.field, item.traveller, windowOf(item, REACH + item.half + 8));
  const found: Priced[] = [];
  for (const { line, cost } of lines(
    item.a,
    item.b,
    part,
    item.members.some(marked),
    spotsOf(wiring, item),
    item.half,
  )
    .filter((line) => pinnedBy(item, line))
    .map((line) => ({ line, cost: plain(wiring, item, line) }))
    .toSorted((p, q) => p.cost - q.cost))
    consider(found, count, line, cost, scope);
  const best = found[0];
  if (!item.nested && (!best || best.met >= TROUBLE || best.cost >= TROUBLE + 2 * OFF_MIDDLE))
    considerDetours(wiring, item, found, count);
  // The elements lie on each other: a line between their middles is all there is.
  if (!found.length)
    found.push({ cost: Infinity, met: Infinity, line: between(item.a.box, item.b.box) });
  return found;
}

/** Something stands in every simple line's way: around it, in the container of both ends first. */
function considerDetours(wiring: Wiring, item: Bundle, found: Priced[], count: number) {
  const { home } = item.traveller;
  for (const window of [home ? grow(home, 16) : windowOf(item, 180), undefined]) {
    const wide = scopeOf(wiring.field, item.traveller, window),
      { blocked, terrain } = terrainOf(wide),
      way = detour(item.a.box, item.b.box, blocked, {
        ...terrain,
        ports: [item.pins.a, item.pins.b],
      });
    if (!way) continue;
    // It leaves and enters at the middle of a side: beside the wire ends that lie there already.
    const spread = apart(wiring, item, apart(wiring, item, way, "a"), "b");
    consider(found, count, spread, plain(wiring, item, spread), wide);
    // A way that still runs into something may find a better one further out.
    if (price(wide, spread.points, spread.from, spread.to) < ALONG) break;
  }
}

/** A piece of a connection's wire, for marks to keep off; a loop's two lines lie to either side. */
const piece = (edge: TamEdge, a: Point, b: Point) => ({
  owner: edge.id,
  a,
  b,
  half: edge.kind === "modify" ? thickness(edge) : 0,
});

/** The pieces of the wires of a bundle as they lie. */
const piecesOf = (item: Bundle) =>
  item.laid.map((points, member) =>
    points.slice(1).map((point, index) => piece(item.members[member], points[index], point)),
  );

/** Every wire but the bundle's own, for its marks to keep off. */
const wiresBut = (wiring: Wiring, item?: Bundle) => [
  ...wiring.stubs,
  ...wiring.queue.filter((other) => other !== item).flatMap((other) => piecesOf(other).flat()),
];

/** Where along a bundle a member's mark prefers to stand: the outer wires carry their labels on their outer side; circles stand along it one after the other. */
function preferOf(item: Bundle, index: number) {
  const count = item.members.length;
  return {
    share: count > 1 ? (index + 1) / (count + 1) : 0.5,
    outer: count > 1 && Math.abs(item.offsets[index]) > 0.5 ? Math.sign(item.offsets[index]) : 0,
  };
}

/** Places the marks of a bundle on its wires as they lie, off every other wire that lies, and notes how much they cover. */
function mark(wiring: Wiring, item: Bundle): Surroundings["placed"] {
  const { chain } = wiring.prepared,
    others = wiresBut(wiring, item),
    own = piecesOf(item);
  const mine: Surroundings["placed"] = [],
    both = new Set(chain(item.a.id).filter((id) => chain(item.b.id).includes(id))),
    foreign = wiring.field.containers.filter((wall) => !both.has(wall.id)).map((wall) => wall.box);
  let hits = 0;
  item.marks = item.members.map((edge, index) => {
    const found = placeMark(
      edge,
      item.laid[index],
      preferOf(item, index),
      {
        ...wiring.surroundings,
        foreign,
        wires: [...others, ...own.flat()],
        placed: [...wiring.surroundings.placed, ...mine],
      },
      wiring.prepared,
      wiring.measure,
    );
    if (found) {
      hits += found.hits;
      mine.push(...found.drawn.map((box) => ({ owner: edge.id, box })));
    }
    return found;
  });
  item.covered = hits;
  return mine;
}

/** Takes the marks of a bundle out of what the others keep off. */
function unmark({ field, surroundings }: Wiring, item: Bundle) {
  if (!field.marks.has(item.key)) return;
  const owners = new Set(item.members.map((edge) => edge.id));
  surroundings.placed = surroundings.placed.filter((entry) => !owners.has(entry.owner));
  surroundings.boundaries = surroundings.boundaries.filter((entry) => !owners.has(entry.owner));
  field.marks.delete(item.key);
}

/** Stands the marks of a bundle where the wires and marks that come later keep off them. */
function commit({ field, surroundings }: Wiring, item: Bundle, mine: Surroundings["placed"]) {
  surroundings.placed.push(...mine);
  item.members.forEach((edge, index) => {
    const found = item.marks[index];
    if (found && edge.protocol && circled(edge))
      surroundings.boundaries.push({
        owner: edge.id,
        protocol: edge.protocol,
        up: found.up,
        level: found.up ? found.spot.y : found.spot.x,
        at: found.up ? found.spot.x : found.spot.y,
      });
  });
  field.marks.set(
    item.key,
    mine.map((entry) => entry.box),
  );
}

/** Takes a bundle's wires out of the field and its ends off their sides, with its marks. */
function lift(wiring: Wiring, item: Bundle) {
  unmark(wiring, item);
  wiring.field.wires.delete(item.key);
  for (const which of ENDS) {
    const list = wiring.taken.get(sideKey(item, which));
    if (!list) continue;
    for (let index = list.length - 1; index >= 0; index--)
      if (list[index].key === item.key) list.splice(index, 1);
  }
}

/** Moves an end of a bundle that lies off the other wire ends on its side. */
function spread(wiring: Wiring, item: Bundle, which: Which) {
  const line = apart(wiring, item, item, which);
  if (line !== item) lay(wiring, item, line);
}

/** Moves both ends of a bent bundle off the other wire ends on their sides. */
function spreadBent(wiring: Wiring, item: Bundle) {
  if (item.points.length > 2) ENDS.forEach((which) => spread(wiring, item, which));
}

/** Lays a bundle along a line: its members beside it, its runs into the field, its ends on their sides, its marks on its wires. */
function lay(wiring: Wiring, item: Bundle, line: Line) {
  if (item.points.length) lift(wiring, item);
  item.from = line.from;
  item.to = line.to;
  item.points = line.points;
  arrange(item);
  item.laid = item.offsets.map((offset) => beside(item.points, offset));
  wiring.field.wires.set(
    item.key,
    runsOf(item.points, item.half, [sideKey(item, "a"), sideKey(item, "b")]),
  );
  for (const which of ENDS)
    addTaken(wiring, sideKey(item, which), {
      at: endAt(which, item),
      half: reachAt(item, which),
      key: item.key,
    });
  // Its circles and labels stand on it at once, so the wires that come later run around them.
  if (item.members.some(marked)) commit(wiring, item, mark(wiring, item));
}

/** How far apart the middles of a bundle's two elements are. */
const span = (item: Bundle) => middlesApart(item.a.box, item.b.box);

/**
 * Each bundle takes the cheapest line. The pairs a straight line joins choose first, so no other
 * wire takes the room between them; then near pairs before far ones, which leave by the sides
 * still free. Returns the line each bundle takes where no other wire lies, and what it costs.
 */
function layAll(wiring: Wiring, bundles: Map<string, Bundle>) {
  const alone = new Map<Bundle, { line: Line; cost: number }>();
  for (const item of bundles.values()) {
    unpressed(item);
    alone.set(item, cheapest(wiring, item, 1)[0]);
  }
  const direct = (item: Bundle) => +(alone.get(item)!.line.points.length === 2);
  // Wires pinned to their ports lie first: the others keep off the ports they hold.
  const pinned = (item: Bundle) => +!!(item.pins.a || item.pins.b);
  const queue = [...bundles.values()].toSorted(
    (p, q) => pinned(q) - pinned(p) || direct(q) - direct(p) || span(p) - span(q),
  );
  wiring.queue = queue;
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    const [{ line }] = cheapest(wiring, item, 1);
    splitCrowded(wiring, item, line, index);
    lay(wiring, item, line);
  }
  // A wire end that found no spot of its own on its side moves along it: straight lines stay.
  const bent = queue.filter((item) => item.points.length > 2);
  for (const which of ENDS) for (const item of bent) spread(wiring, item, which);
  return alone;
}

/** Circles side by side need their room: the channels a side has no room for take a line of their own, next in the queue. */
function splitCrowded(wiring: Wiring, item: Bundle, line: Line, index: number) {
  const fit = placesOf(item.members).findLastIndex((place) => place <= roomFor(item, line)) + 1;
  if (fit >= item.members.length || !item.members.some(circled)) return;
  const rest = newBundle(
    wiring,
    `${item.key}\u0000${index}`,
    item.a,
    item.b,
    item.members.splice(Math.max(1, fit)),
  );
  for (const each of [item, rest]) unpressed(each);
  wiring.queue.splice(index + 1, 0, rest);
}

/** What a bundle's line costs as it lies, with everything it meets and what its marks cover. */
const worth = (wiring: Wiring, item: Bundle) =>
  plain(wiring, item, item) +
  price(scopeOf(wiring.field, item.traveller), item.points, item.from, item.to) +
  item.covered * COVER;

/** The bundles a line for a bundle runs on or beside, meets in a junction, or ends too near on a side. */
function clashes(wiring: Wiring, item: Bundle, line: Line = item): Bundle[] {
  const found = new Set<Bundle>();
  for (const which of ENDS)
    for (const other of nearEnds(wiring, item, which, line)) {
      const owner = wiring.queue.find((bundle) => bundle.key === other.key);
      if (owner) found.add(owner);
    }
  for (const other of wiring.queue)
    if (other !== item && !found.has(other) && runsInto(wiring, item, line, other))
      found.add(other);
  return [...found];
}

/** The other wire ends on the side a line ends on, nearer than they keep apart. */
const nearEnds = (wiring: Wiring, item: Bundle, which: Which, line: Line) =>
  (wiring.taken.get(sideKey(item, which, line)) ?? []).filter(
    (other) =>
      other.key !== item.key &&
      Math.abs(other.at - endAt(which, line)) < other.half + reachAt(item, which, line) + GAP,
  );

/** Whether a line for a bundle runs on or beside the wires of another, or meets them in a junction. */
function runsInto(wiring: Wiring, item: Bundle, line: Line, other: Bundle): boolean {
  const { points } = line,
    runs = wiring.field.wires.get(other.key) ?? [];
  return points.slice(1).some((point, index) => {
    const mine = [
      index === 0 ? sideKey(item, "a", line) : undefined,
      index === points.length - 2 ? sideKey(item, "b", line) : undefined,
    ];
    return runs.some(
      (run) =>
        meets(points[index], point, item.half, run) > 1 &&
        !mine.some((key) => key && run.sides?.includes(key)),
    );
  });
}

/** Gives a bundle the cheapest line in the field as it is. */
function route(wiring: Wiring, item: Bundle) {
  lift(wiring, item);
  lay(wiring, item, cheapest(wiring, item, 1)[0].line);
  spreadBent(wiring, item);
}

const lineOf = (item: Bundle): Line => ({ from: item.from, to: item.to, points: item.points });

/**
 * Two wires that still read as one: each chose its line without the other, or around it. And a
 * wire that goes a long way round because another one lies where it would run alone. The two
 * choose again, one first and then the other first, and keep the lines that suit both best.
 */
function untangle(wiring: Wiring, alone: Map<Bundle, { line: Line; cost: number }>) {
  for (const item of wiring.queue) {
    const ideal = alone.get(item),
      pushed =
        ideal && worth(wiring, item) > ideal.cost + PUSHED ? clashes(wiring, item, ideal.line) : [];
    for (const other of new Set([...clashes(wiring, item), ...pushed]))
      chooseAgain(wiring, item, other);
  }
}

/** Lets two bundles choose their lines again, either first, and keeps the lines that suit both best. */
function chooseAgain(wiring: Wiring, item: Bundle, other: Bundle) {
  const both = () => worth(wiring, item) + worth(wiring, other);
  let best = { cost: both(), lines: [lineOf(item), lineOf(other)] };
  for (const [first, second] of [
    [item, other],
    [other, item],
  ]) {
    lift(wiring, second);
    route(wiring, first);
    route(wiring, second);
    const cost = both();
    if (cost < best.cost - 1) best = { cost, lines: [lineOf(item), lineOf(other)] };
  }
  lift(wiring, item);
  lift(wiring, other);
  lay(wiring, item, best.lines[0]);
  lay(wiring, other, best.lines[1]);
  // And each once more beside the other as it lies now.
  for (const each of [item, other]) {
    const line = lineOf(each);
    route(wiring, each);
    const cost = both();
    if (cost < best.cost - 1) best.cost = cost;
    else {
      lift(wiring, each);
      lay(wiring, each, line);
    }
  }
}

/**
 * Every wire lies: circles and labels take their spots again, on the shortest wires first. Returns
 * the bundles whose marks still cover something.
 */
function remark(wiring: Wiring): Bundle[] {
  const longest = (item: Bundle) =>
    Math.max(...item.points.slice(1).map((point, index) => runLength(item.points[index], point)));
  const troubled: Bundle[] = [];
  for (const item of wiring.queue.toSorted((p, q) => longest(p) - longest(q))) {
    if (!item.members.some(marked)) continue;
    unmark(wiring, item);
    commit(wiring, item, mark(wiring, item));
    if (item.covered >= HIT) troubled.push(item);
  }
  return troubled;
}

/** A connection whose circle or label covers something takes another line, where one leaves them room. */
function relay(wiring: Wiring, item: Bundle) {
  const current = lineOf(item);
  lift(wiring, item);
  let best: { line: Line; total: number } | undefined;
  const options = cheapest(wiring, item, OTHERS);
  const scope = scopeOf(wiring.field, item.traveller);
  for (const option of [current, ...options.map((option) => option.line)]) {
    const tried = tryLine(wiring, item, option, option === current, scope);
    if (tried && (!best || tried.total < best.total)) best = tried;
  }
  lay(wiring, item, best!.line);
}

/** Lays a bundle along a line it may take instead and says what it costs as it lies; nothing for a new line through an element. */
function tryLine(wiring: Wiring, item: Bundle, option: Line, current: boolean, scope: Scope) {
  lay(wiring, item, option);
  if (!current) spreadBent(wiring, item);
  const line: Line = { from: item.from, to: item.to, points: item.points, off: option.off },
    met = price(scope, line.points, line.from, line.to);
  if (!current && met >= THROUGH) return undefined;
  return { line, total: plain(wiring, item, line) + met + item.covered * COVER };
}

/** Draws one member of a bundle into the geometry: its wire, and its circle or label. */
function drawMember(geometry: TamGeometry, item: Bundle, edge: TamEdge, index: number) {
  const found = item.marks[index],
    [points, cut] = memberPoints(item, edge, index);
  if (found && circled(edge)) {
    drawCircle(geometry, edge, found, points, cut);
    return;
  }
  geometry.routes.set(edge.id, points);
  if (found) geometry.edgeLabels.set(edge.id, found.rooms[0]);
}

/**
 * The wire of a member from its source to its target, every end on a rounded shape on its curved
 * outline, and the index of the run its mark stands on.
 */
function memberPoints(item: Bundle, edge: TamEdge, index: number): [Point[], number] {
  let points = item.laid[index].map((point) => ({ ...point }));
  const first = outline(points[0], points[1], item.a.box, item.nested ? 0 : item.a.radius),
    last = outline(points.at(-1)!, points.at(-2)!, item.b.box, item.nested ? 0 : item.b.radius);
  points[0] = first;
  points[points.length - 1] = last;
  let cut = item.marks[index]?.host ?? 0;
  if (edge.source !== item.a.id) {
    points = points.toReversed();
    cut = points.length - 2 - cut;
  }
  return [points, cut];
}

/** The circle sits on its run, its label and marker beside it; the wire runs to it from either end. */
function drawCircle(
  geometry: TamGeometry,
  edge: TamEdge,
  found: Mark,
  points: Point[],
  cut: number,
) {
  const id = `${edge.id}#node`;
  geometry.boxes.set(id, found.rooms.at(-1)!);
  geometry.markers.add(id);
  geometry.upright!.set(id, found.up);
  geometry.routes.set(`${edge.id}:a`, [...points.slice(0, cut + 1), found.spot]);
  geometry.routes.set(`${edge.id}:b`, [found.spot, ...points.slice(cut + 1)]);
  if (found.rooms.length > 1) geometry.nodeLabels.set(id, found.rooms.slice(0, -1));
}
