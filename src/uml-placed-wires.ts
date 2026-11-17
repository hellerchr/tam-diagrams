/**
 * Layout by hand for the diagrams that lay themselves out: the wires. A wire whose two ends moved
 * together moves with them; every other wire of a part that moved is laid again in the style of
 * its diagram. Wires with corners take the cheapest line through the field of what stands around
 * them, as the wires of a block diagram placed by hand do (tam-placed-field.ts, -lines.ts,
 * -detour.ts); straight and curved lines are drawn as use case diagrams draw them
 * (uml-usecase-lines.ts). Markers, end texts and labels follow their wires.
 */

import { crossesBox, crossesShape } from "./audit.ts";
import { dodgeTitles } from "./labels.ts";
import { markerBounds, type MarkerKind } from "./markers.ts";
import { clipToOutline, entryPoint, outlineOf } from "./outline.ts";
import { outline } from "./route.ts";
import {
  around,
  type Box,
  centerOf,
  distance,
  grow,
  overlaps,
  type Point,
  type Scene,
  type SceneMarker,
  type SceneShape,
  type SceneText,
  type SceneWire,
  simplifyPath,
  straddles,
  unit,
} from "./scene.ts";
import { chainOf, type SceneTree, shiftTexts } from "./scene-tree.ts";
import { lies, type Side, sidePoint } from "./tam-placed.ts";
import { detour, type Line } from "./tam-placed-detour.ts";
import {
  ALONG,
  type Field,
  price,
  type Scope,
  runsOf,
  scopeOf,
  terrainOf,
  type Traveller,
  TROUBLE,
} from "./tam-placed-field.ts";
import {
  between,
  type End,
  level,
  lines,
  range,
  REACH,
  type Spot,
  type Spots,
} from "./tam-placed-lines.ts";
import { type Measure, textGroupBox } from "./text.ts";
import { ACCEPTED, hasRoom, labelLine, leastHiding } from "./uml-usecase-label.ts";
import { drawLine, drawLoop } from "./uml-usecase-lines.ts";

/** How the wires of a diagram run: with corners between the sides of boxes, or straight and curved between outlines. */
export type LineStyle = "orthogonal" | "straight";

const SIDES: Side[] = ["top", "right", "bottom", "left"];

/**
 * What a line costs beside what it meets in the field: a corner counts like BEND pixels of wire, an
 * end off the middle of its side OFF_MIDDLE, an end on the short side of a bar SHORT_SIDE, an end
 * on a spot another wire ends at TAKEN, and one nearer to another end than markers need CLOSE.
 */
const BEND = 70,
  LENGTH = 0.25,
  OFF_MIDDLE = 150,
  SHORT_SIDE = 400,
  TAKEN = 1200,
  CLOSE = 50;

/** Wire ends on one side keep APART, so that their markers stand side by side; TIGHT where a side is full. */
const APART = 14,
  TIGHT = 9;

/** A circle up to this size takes wires at the middles of its sides only, as a diamond does at its corners. */
const SMALL_SYMBOL = 24;

/** The room a label wants around it, check by check: more than the audit asks for. */
const WANTED = { shape: 3, container: 2, text: 2, label: 6, marker: 2, wire: 2, ownWire: 4 };

/** What moved of a shape between the automatic scene and the placed one. */
interface Move {
  dx: number;
  dy: number;
  resized: boolean;
}

/** The side of a box a point on its outline lies on. */
function sideAt(box: Box, point: Point): Side {
  const away: [Side, number][] = [
    ["top", Math.abs(point.y - box.y)],
    ["bottom", Math.abs(point.y - box.y - box.height)],
    ["left", Math.abs(point.x - box.x)],
    ["right", Math.abs(point.x - box.x - box.width)],
  ];
  return away.toSorted((a, b) => a[1] - b[1])[0][0];
}

/** The length of a wire. */
const lengthOf = (points: Point[]) =>
  points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);

/** The point of a wire `along` pixels from its start, and the index of the piece it lies on. */
function pointAt(points: Point[], along: number): { point: Point; piece: number } {
  let rest = Math.max(0, along);
  for (let index = 0; index < points.length - 1; index++) {
    const length = distance(points[index], points[index + 1]);
    if (rest <= length || index === points.length - 2) {
      const t = length ? Math.min(1, rest / length) : 0,
        a = points[index],
        b = points[index + 1];
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, piece: index };
    }
    rest -= length;
  }
  return { point: points[0], piece: 0 };
}

/** How far along a wire the point nearest to `to` lies. */
function alongOf(points: Point[], to: Point): number {
  let best = { away: Infinity, along: 0 },
    walked = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index],
      b = points[index + 1],
      length = distance(a, b),
      t = length
        ? Math.max(
            0,
            Math.min(1, ((to.x - a.x) * (b.x - a.x) + (to.y - a.y) * (b.y - a.y)) / length ** 2),
          )
        : 0,
      away = distance(to, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (away < best.away) best = { away, along: walked + t * length };
    walked += length;
  }
  return best.along;
}

/** A wire to lay again, with what it carried in the automatic scene. */
interface Job {
  wire: SceneWire;
  was: SceneWire;
  a: SceneShape;
  b: SceneShape;
  /** The kinds of the markers at its start and its end. */
  start?: SceneMarker;
  end?: SceneMarker;
  /** Its label, and where along the wire it stood: a share of the wire's length. */
  label: SceneText[];
  share: number;
  /** The texts at its ends, each with the end it stood at and how far from it. */
  ends: { text: SceneText; first: boolean; away: number }[];
}

/** A placed scene with its shapes by id and the boxes they had in the automatic scene. */
interface Placed {
  scene: Scene;
  shapes: Map<string, SceneShape>;
  before: Map<string, Box>;
}

/**
 * Lays the wires of a placed scene again where their parts moved: `scene` holds the shapes where
 * they stand now and the wires, markers and texts of the automatic scene `auto`.
 */
export function rewire(
  scene: Scene,
  auto: Scene,
  tree: SceneTree,
  measure: Measure,
  style: LineStyle,
) {
  const placed: Placed = {
    scene,
    shapes: new Map(scene.shapes.map((shape) => [shape.id, shape])),
    before: new Map(auto.shapes.map((shape) => [shape.id, shape.box])),
  };
  const jobs = scene.wires.flatMap((wire, index) => jobOf(placed, wire, auto.wires[index]) ?? []);
  if (!jobs.length) return;
  liftCarried(scene, jobs);
  if (style === "straight") return redraw(scene, jobs, measure);
  relay(placed, tree, jobs);
}

/** What moved of a shape between the automatic scene and the placed one. */
function moveOf(placed: Placed, shape: SceneShape): Move {
  const was = placed.before.get(shape.id)!;
  return {
    dx: shape.box.x - was.x,
    dy: shape.box.y - was.y,
    resized:
      Math.abs(shape.box.width - was.width) > 0.01 ||
      Math.abs(shape.box.height - was.height) > 0.01,
  };
}

const still = (move: Move) => !move.dx && !move.dy && !move.resized;

/** Whether a wire's piece from `from` to `to` runs through a part or a container that is not its own. */
function blocks(shape: SceneShape, wire: SceneWire, from: Point, to: Point): boolean {
  if (shape.kind === "region" || shape.passable) return false;
  return shape.container
    ? !wire.home.includes(shape.id) && crossesBox(from, to, grow(shape.box, -1))
    : !wire.ends.includes(shape.id) && crossesShape(from, to, shape);
}

/** Whether a wire as it lies runs through a part or a container that is not its own. */
const blocked = (scene: Scene, wire: SceneWire) =>
  wire.points
    .slice(1)
    .some((point, index) =>
      scene.shapes.some((shape) => blocks(shape, wire, wire.points[index], point)),
    );

const textsOf = (placed: Placed, wire: SceneWire) =>
  placed.scene.texts.filter((text) => text.owner === wire.edge && !placed.shapes.has(wire.edge));

const markersOf = (scene: Scene, wire: SceneWire) =>
  scene.markers.filter(
    (marker) =>
      marker.wire === wire.edge &&
      Math.min(distance(marker.tip, wire.points[0]), distance(marker.tip, wire.points.at(-1)!)) < 1,
  );

/** Moves markers and texts a wire carries by `dx`, `dy`. */
function moveCarried(markers: SceneMarker[], texts: SceneText[], dx: number, dy: number) {
  for (const marker of markers) marker.tip = { x: marker.tip.x + dx, y: marker.tip.y + dy };
  shiftTexts(texts, dx, dy);
}

const shifted = (points: Point[], dx: number, dy: number) =>
  points.map((point) => ({ x: point.x + dx, y: point.y + dy }));

/**
 * Both ends moved as one: the wire goes with them, with all it carries. Returns whether it stays
 * so; a wire that now runs through something goes back to lie as it did, to be laid again.
 */
function carryAlong(placed: Placed, wire: SceneWire, was: SceneWire, move: Move, loop: boolean) {
  const texts = textsOf(placed, wire),
    markers = markersOf(placed.scene, wire);
  wire.points = shifted(wire.points, move.dx, move.dy);
  moveCarried(markers, texts, move.dx, move.dy);
  if (loop || !blocked(placed.scene, wire)) return true;
  wire.points = was.points.map((point) => ({ ...point }));
  moveCarried(markers, texts, -move.dx, -move.dy);
  return false;
}

/** A loop at a container that changed its size keeps its corner. */
function keepCorner(placed: Placed, wire: SceneWire, was: SceneWire, shape: SceneShape) {
  const corner = (box: Box) => ({ x: box.x + box.width, y: box.y }),
    now = corner(shape.box),
    then = corner(placed.before.get(shape.id)!),
    dx = now.x - then.x,
    dy = now.y - then.y;
  wire.points = shifted(wire.points, dx, dy);
  moveCarried(markersOf(placed.scene, was), textsOf(placed, wire), dx, dy);
}

/** Whether both ends of a wire moved as one, and neither changed its size. */
const together = (a: SceneShape, b: SceneShape, from: Move, to: Move) =>
  (a === b || (from.dx === to.dx && from.dy === to.dy && !to.resized)) && !from.resized;

/**
 * Whether a wire lies right without being laid again: its ends stand still and nothing is in its
 * way, it moved along with its ends, or it is a loop that keeps its corner.
 */
function settled(placed: Placed, wire: SceneWire, was: SceneWire, a: SceneShape, b: SceneShape) {
  const from = moveOf(placed, a),
    to = moveOf(placed, b);
  if (still(from) && still(to)) return !blocked(placed.scene, wire);
  if (wire.path) return false;
  if (together(a, b, from, to)) return carryAlong(placed, wire, was, from, a === b);
  if (a !== b) return false;
  keepCorner(placed, wire, was, a);
  return true;
}

/** The wire to lay again for a wire of the placed scene, if it is one, and what it carried. */
function jobOf(placed: Placed, wire: SceneWire, was: SceneWire): Job | undefined {
  const a = placed.shapes.get(wire.from ?? wire.ends[0]),
    b = placed.shapes.get(wire.to ?? wire.ends.at(-1)!);
  if (!a || !b || settled(placed, wire, was, a, b)) return undefined;
  const markers = markersOf(placed.scene, was),
    nearStart = (point: Point) =>
      distance(point, was.points[0]) <= distance(point, was.points.at(-1)!),
    texts = textsOf(placed, wire),
    label = texts.filter((text) => text.role === "label"),
    total = lengthOf(was.points) || 1;
  return {
    wire,
    was,
    a,
    b,
    start: markers.find((marker) => nearStart(marker.tip)),
    end: markers.find((marker) => !nearStart(marker.tip)),
    label,
    share: label.length ? alongOf(was.points, centerOf(textGroupBox(label))) / total : 0.5,
    ends: texts
      .filter((text) => text.role !== "label")
      .map((text) => {
        const center = centerOf(text.box),
          first = nearStart(center);
        return { text, first, away: distance(center, first ? was.points[0] : was.points.at(-1)!) };
      }),
  };
}

/** What the wires to lay carried leaves the scene while they are laid, and comes back beside them. */
function liftCarried(scene: Scene, jobs: Job[]) {
  const lifted = new Set<SceneText>(
      jobs.flatMap((job) => [...job.label, ...job.ends.map((end) => end.text)]),
    ),
    gone = new Set<SceneMarker>(
      jobs.flatMap((job) => [job.start, job.end].filter((item) => !!item)),
    );
  scene.texts = scene.texts.filter((text) => !lifted.has(text));
  scene.markers = scene.markers.filter((marker) => !gone.has(marker));
}

/** The field the wires are laid in, the shapes by id, and the wire ends each side of each shape holds. */
interface Router {
  field: Field;
  shapes: Map<string, SceneShape>;
  taken: Map<string, { at: number; key: string }[]>;
}

/** A wire to lay with corners: its ends, how it travels the field, and the line it takes. */
interface Route {
  job: Job;
  key: string;
  a: End;
  b: End;
  nested: boolean;
  part?: End;
  traveller: Traveller;
  line?: Line;
}

/** Lays the wires of the jobs with corners, through the field of what stands around them. */
function relay(placed: Placed, tree: SceneTree, jobs: Job[]) {
  const router: Router = { field: placedField(placed), shapes: placed.shapes, taken: new Map() };
  holdStaying(router, placed.scene, new Set(jobs.map((job) => job.wire)));
  const routes = jobs.map((job, index) => routeOf(router, tree, job, index));
  // Near pairs choose first and leave by the sides still free; then each once more beside the others.
  const queue = routes.toSorted((p, q) => span(p) - span(q));
  for (const route of queue) lay(router, route, cheapest(router, route));
  for (const route of queue) {
    lift(router, route);
    lay(router, route, cheapest(router, route));
  }
  for (const route of routes) route.job.wire.points = simplifyPath(outlined(route));
  for (const job of jobs) mark(placed.scene, job);
  for (const job of jobs) letter(placed.scene, job);
}

/** The parts, containers and container titles of a scene as the field a wire travels. */
function placedField({ scene, shapes }: Placed): Field {
  const field: Field = {
    solids: [],
    containers: [],
    titles: [],
    wires: new Map(),
    marks: new Map(),
  };
  for (const shape of scene.shapes.filter((item) => !item.passable)) {
    if (shape.container) addContainer(field, scene, shape);
    else field.solids.push({ id: shape.id, box: shape.box });
  }
  // A part's text beside it stands in a wire's way like the part.
  for (const text of scene.texts) {
    const owner = text.owner ? shapes.get(text.owner) : undefined;
    if (owner && !owner.container && text.role === "label")
      field.solids.push({ id: `${owner.id}\u0000label`, box: text.box });
  }
  return field;
}

/** A container in the field, with its title in a wire's way. */
function addContainer(field: Field, scene: Scene, shape: SceneShape) {
  field.containers.push({ id: shape.id, box: shape.box });
  const titles = scene.texts.filter(
    (text) => text.owner === shape.id && (text.role === "title" || text.role === "stereotype"),
  );
  if (titles.length) field.titles.push({ id: shape.id, box: grow(textGroupBox(titles), 2) });
}

const sideKey = (id: string, side: Side) => `${id}\u0000${side}`;

/** Notes that a wire ends at `point` on a side of a shape. */
function hold(router: Router, id: string, side: Side, point: Point, key: string) {
  const list = router.taken.get(sideKey(id, side)) ?? [];
  router.taken.set(sideKey(id, side), list);
  list.push({ at: lies(side) ? point.x : point.y, key });
}

/** The wires that stay as they lie stand in the field, and hold the spots they end at. */
function holdStaying(router: Router, scene: Scene, routed: Set<SceneWire>) {
  scene.wires.forEach((wire, index) => {
    if (routed.has(wire)) return;
    const key = `${wire.edge}\u0000${index}`,
      a = router.shapes.get(wire.from ?? wire.ends[0]),
      b = router.shapes.get(wire.to ?? wire.ends.at(-1)!);
    router.field.wires.set(key, runsOf(wire.points, 0));
    if (a) hold(router, a.id, sideAt(a.box, wire.points[0]), wire.points[0], key);
    if (b) hold(router, b.id, sideAt(b.box, wire.points.at(-1)!), wire.points.at(-1)!, key);
    const marks = scene.texts.filter((text) => text.owner === wire.edge).map((text) => text.box);
    if (marks.length) router.field.marks.set(key, marks);
  });
}

/** The radius of a shape's corners, as its wire ends see it. */
const radiusOf = (shape: SceneShape) =>
  shape.kind === "round"
    ? (shape.radius ?? 10)
    : shape.kind === "stadium" || outlineOf(shape.kind) === "ellipse"
      ? Math.min(shape.box.width, shape.box.height) / 2
      : 0;

/** Shapes a wire meets at the middle of a side only: diamonds, and circles too small for more. */
function symbol(shape: SceneShape) {
  const kind = outlineOf(shape.kind);
  return (
    kind === "diamond" ||
    (kind === "ellipse" && Math.max(shape.box.width, shape.box.height) <= SMALL_SYMBOL)
  );
}

/** Shapes whose outline is not their box: a straight wire to one runs through its middle. */
const centered = (shape: SceneShape) => outlineOf(shape.kind) !== "box";

const endOf = (shape: SceneShape): End => ({
  id: shape.id,
  box: shape.box,
  radius: radiusOf(shape),
});

const sidesOf = (id: string) =>
  Object.fromEntries(SIDES.map((side) => [side, sideKey(id, side)])) as Record<Side, string>;

/** The route of a job: its ends, whether one holds the other, and how it travels the field. */
function routeOf(router: Router, tree: SceneTree, job: Job, index: number): Route {
  const chainA = chainOf(tree, job.a.id),
    chainB = chainOf(tree, job.b.id),
    a = endOf(job.a),
    b = endOf(job.b),
    nested = chainA.includes(job.b.id) || chainB.includes(job.a.id),
    home = chainA.find((id) => chainB.includes(id) && router.shapes.get(id)?.container);
  const key = `${job.wire.edge}\u0000route${index}`;
  return {
    job,
    key,
    a,
    b,
    nested,
    part: !nested ? undefined : chainA.includes(job.b.id) ? a : b,
    traveller: {
      key,
      own: new Set([...chainA, ...chainB]),
      ends: nested ? [] : [a.box, b.box],
      home: home ? router.shapes.get(home)!.box : undefined,
      half: 0,
      sides: [sidesOf(a.id), sidesOf(b.id)],
    },
  };
}

/** Where the other wires end on a side of a shape, along the side. */
const othersAt = (router: Router, id: string, side: Side, key: string) =>
  (router.taken.get(sideKey(id, side)) ?? [])
    .filter((other) => other.key !== key)
    .map((other) => other.at);

/** The spots on a side a wire may end at: the middle of a symbol, else spots free of the ends the side holds. */
const spotsOf =
  (router: Router, route: Route): Spots =>
  (end, side) => {
    const [low, high] = range(end, side),
      middle = (low + high) / 2;
    if (symbol(router.shapes.get(end.id)!)) return [{ at: middle, off: 0 }];
    return freeSpots(othersAt(router, end.id, side, route.key), low, high);
  };

/** Adds a spot unless one lies within 4px of it already. */
function addSpot(found: Spot[], at: number, off: number) {
  if (found.every((spot) => Math.abs(spot.at - at) >= 4)) found.push({ at, off });
}

/**
 * The spots between `low` and `high` clear of the ends at `others`: the middle, else the nearest
 * spots to it APART from the others, or TIGHT where the side is full; and the quarters.
 */
function freeSpots(others: number[], low: number, high: number): Spot[] {
  const middle = (low + high) / 2,
    free = (spot: number, gap: number) => others.every((other) => Math.abs(other - spot) >= gap);
  const found: Spot[] = [];
  if (free(middle, APART)) addSpot(found, middle, 0);
  else nearestFree(found, free, low, high);
  for (const quarter of [0.25, 0.75]) {
    const spot = low + (high - low) * quarter;
    if (free(spot, APART)) addSpot(found, spot, 1);
  }
  if (!found.length) addSpot(found, middle, 2);
  return found;
}

/** Adds the free spots nearest to the middle on both sides of it, at the widest gap any is free at. */
function nearestFree(
  found: Spot[],
  free: (spot: number, gap: number) => boolean,
  low: number,
  high: number,
) {
  for (const gap of [APART, TIGHT]) {
    for (const way of [-1, 1]) {
      const spot = firstFree((spot) => free(spot, gap), way, low, high);
      if (spot !== undefined) addSpot(found, spot, gap === APART ? 0.1 : 2);
    }
    if (found.length) return;
  }
}

/** The first free spot from the middle of `low` to `high` on, a pixel at a time the `way` it goes. */
function firstFree(free: (spot: number) => boolean, way: number, low: number, high: number) {
  for (let spot = (low + high) / 2 + way; spot >= low && spot <= high; spot += way)
    if (free(spot)) return spot;
  return undefined;
}

/** Whether a line ends where its shapes take wires: a symbol at the middle of a side. */
const fits = (router: Router, route: Route, line: Line) =>
  route.nested ||
  (["a", "b"] as const).every((which) => {
    const end = route[which];
    if (!symbol(router.shapes.get(end.id)!)) return true;
    const side = which === "a" ? line.from : line.to,
      point = which === "a" ? line.points[0] : line.points.at(-1)!,
      center = centerOf(end.box);
    return Math.abs(lies(side) ? point.x - center.x : point.y - center.y) < 0.5;
  });

/** Pairs of facing sides, the first of the wire's start, the second of its end. */
const FACING = [
  ["bottom", "top"],
  ["top", "bottom"],
  ["right", "left"],
  ["left", "right"],
] as const;

/**
 * The straight lines between facing sides that run through the middle of a shape whose outline
 * is not its box: where such a shape stands level with the other, the wire is one straight line.
 */
const throughMiddles = (route: Route): Line[] =>
  route.nested
    ? []
    : FACING.flatMap(([from, to]) => {
        const line = throughMiddle(route, from, to);
        return line ? [line] : [];
      });

/** The straight line from side `from` of a route's start to side `to` of its end through a middle, if there is one. */
function throughMiddle(route: Route, from: Side, to: Side): Line | undefined {
  const { a, b, job } = route,
    out = from === "bottom" || from === "right" ? 1 : -1;
  if (out * (level(b.box, to) - level(a.box, from)) < 4) return undefined;
  const ats = [job.a, job.b]
    .filter(centered)
    .map(({ box }) => (lies(from) ? box.x + box.width / 2 : box.y + box.height / 2));
  const [lowA, highA] = range(a, from),
    [lowB, highB] = range(b, to);
  const at = ats.find(
    (at) =>
      at >= Math.max(lowA, lowB) - 0.5 &&
      at <= Math.min(highA, highB) + 0.5 &&
      ats.every((other) => Math.abs(other - at) < 0.5),
  );
  if (at === undefined) return undefined;
  return { from, to, points: [sidePoint(a.box, from, at), sidePoint(b.box, to, at)], off: 0 };
}

/** `total` with what an end of a line costs: on the short side of a bar, or near the end of another wire. */
function withEnd(router: Router, route: Route, line: Line, which: "a" | "b", total: number) {
  const end = route[which],
    side = which === "a" ? line.from : line.to,
    point = which === "a" ? line.points[0] : line.points.at(-1)!,
    at = lies(side) ? point.x : point.y;
  if ((lies(side) ? end.box.width : end.box.height) < 12 && !symbol(router.shapes.get(end.id)!))
    total += SHORT_SIDE;
  const nearest = Math.min(
    Infinity,
    ...othersAt(router, end.id, side, route.key).map((other) => Math.abs(other - at)),
  );
  if (nearest < APART) total += nearest < TIGHT ? TAKEN : CLOSE;
  return total;
}

/** What a line costs before what it meets: corners, length, ends off the middle or beside others. */
function plain(router: Router, route: Route, line: Line) {
  const { points } = line;
  let total = (points.length - 2) * BEND + lengthOf(points) * LENGTH + (line.off ?? 0) * OFF_MIDDLE;
  if (line.from === line.to && !route.nested) total += BEND;
  return withEnd(router, route, line, "b", withEnd(router, route, line, "a", total));
}

/** The cheapest line found so far, with its cost and what of it is the price of what it meets. */
interface Best {
  line: Line;
  cost: number;
  met: number;
}

/** The cheaper of the best line so far and `line`, priced in the field `within`. */
function cheaper(
  best: Best | undefined,
  router: Router,
  route: Route,
  line: Line,
  within: Scope,
): Best | undefined {
  const met = price(within, line.points, line.from, line.to),
    cost = plain(router, route, line) + met;
  return !best || cost < best.cost ? { line, cost, met } : best;
}

/** The cheapest line for a wire in the field as it is. */
function cheapest(router: Router, route: Route): Line {
  const both = around([route.a.box, route.b.box]),
    scope = scopeOf(router.field, route.traveller, grow(both, REACH + 8));
  let best: Best | undefined;
  for (const line of [
    ...throughMiddles(route),
    ...lines(route.a, route.b, route.part, route.job.label.length > 0, spotsOf(router, route)),
  ])
    if (fits(router, route, line)) best = cheaper(best, router, route, line, scope);
  if (!route.nested && (!best || best.met >= TROUBLE)) best = detoured(router, route, both, best);
  return best?.line ?? between(route.a.box, route.b.box);
}

/** The best line once the detours around what is in the way are tried, near the ends first. */
function detoured(router: Router, route: Route, both: Box, best: Best | undefined) {
  const { home } = route.traveller;
  for (const window of [home ? grow(home, 16) : grow(both, 180), undefined]) {
    const wide = scopeOf(router.field, route.traveller, window),
      { blocked: walls, terrain } = terrainOf(wide),
      way = detour(route.a.box, route.b.box, walls, terrain);
    if (!way) continue;
    best = cheaper(best, router, route, way, wide);
    if (price(wide, way.points, way.from, way.to) < ALONG) break;
  }
  return best;
}

/** Takes a route's line out of the field and frees the spots it held. */
function lift(router: Router, route: Route) {
  router.field.wires.delete(route.key);
  for (const list of router.taken.values())
    for (let index = list.length - 1; index >= 0; index--)
      if (list[index].key === route.key) list.splice(index, 1);
}

/** Lays a route's line into the field and holds the spots it ends at. */
function lay(router: Router, route: Route, line: Line) {
  route.line = line;
  router.field.wires.set(
    route.key,
    runsOf(line.points, 0, [sideKey(route.a.id, line.from), sideKey(route.b.id, line.to)]),
  );
  hold(router, route.a.id, line.from, line.points[0], route.key);
  hold(router, route.b.id, line.to, line.points.at(-1)!, route.key);
}

/** How far apart the middles of a route's ends lie, along x and y. */
function span(route: Route) {
  const ca = centerOf(route.a.box),
    cb = centerOf(route.b.box);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}

/** A route's line with every end on the outline of its shape: round corners, slanted sides. */
function outlined(route: Route): Point[] {
  const { job } = route;
  let points = route.line!.points.map((point) => ({ ...point }));
  if (route.nested) return points;
  if (!centered(job.a)) points[0] = outline(points[0], points[1], route.a.box, route.a.radius);
  if (!centered(job.b))
    points[points.length - 1] = outline(
      points.at(-1)!,
      points.at(-2)!,
      route.b.box,
      route.b.radius,
    );
  for (const [end, shape] of [
    [0, job.a],
    [points.length - 1, job.b],
  ] as const)
    if (centered(shape) && !symbol(shape))
      points = clipToOutline(points, end, shape.kind, shape.box) ?? points;
  return points;
}

/** Puts a wire's markers back on its ends, pointing along its last pieces. */
function mark(scene: Scene, job: Job) {
  const { points } = job.wire;
  if (job.start)
    scene.markers.push({
      ...job.start,
      tip: { ...points[0] },
      direction: unit(points[1], points[0]),
    });
  if (job.end)
    scene.markers.push({
      ...job.end,
      tip: { ...points.at(-1)! },
      direction: unit(points.at(-2)!, points.at(-1)!),
    });
}

/** Boxes of a size beside the point `along` a wire: right and left of an upright piece, above and below a level one. */
function besideWire(
  points: Point[],
  along: number,
  box: { width: number; height: number },
  gap: number,
): Box[] {
  const { point, piece } = pointAt(points, along),
    upright = Math.abs(points[piece].x - points[piece + 1].x) < 0.5,
    { width, height } = box,
    size = { width, height };
  return upright
    ? [
        { x: point.x + gap, y: point.y - size.height / 2, ...size },
        { x: point.x - gap - size.width, y: point.y - size.height / 2, ...size },
      ]
    : [
        { x: point.x - size.width / 2, y: point.y - gap - size.height, ...size },
        { x: point.x - size.width / 2, y: point.y + gap, ...size },
      ];
}

/** Whether a box lies off the lines of a scene: the borders of lanes and regions. */
const offLines = (scene: Scene, box: Box) =>
  !scene.lines.some((line) =>
    line.points
      .slice(1)
      .some((point, index) => crossesBox(line.points[index], point, grow(box, 2))),
  );

/** How many shapes, texts, markers and wires a box runs into, with the room the audit accepts. */
function crowding(scene: Scene, wire: SceneWire, box: Box): number {
  const room = ACCEPTED;
  return (
    scene.shapes.filter((shape) =>
      shape.container
        ? straddles(box, shape.box)
        : !shape.passable && overlaps(grow(box, room.shape), shape.box),
    ).length +
    scene.texts.filter((other) => overlaps(grow(box, room.text), other.box)).length +
    scene.markers.filter((marker) =>
      overlaps(
        grow(box, room.marker),
        markerBounds(marker.kind, marker.tip, marker.direction, marker.small),
      ),
    ).length +
    scene.wires.filter((other) =>
      other.points
        .slice(1)
        .some((point, index) =>
          crossesBox(
            other.points[index],
            point,
            grow(box, other === wire ? room.ownWire : room.wire),
          ),
        ),
    ).length
  );
}

/**
 * Moves texts to the first of `spots` with room around it; else to one the audit accepts, the one
 * that hides least wire; else to the one that runs into least.
 */
function settle(scene: Scene, wire: SceneWire, texts: SceneText[], spots: Box[]) {
  if (!texts.length || !spots.length) return;
  const box = textGroupBox(texts);
  const spot =
    spots.find((item) => hasRoom(scene, wire, item, WANTED) && offLines(scene, item)) ??
    leastHiding(scene, wire, spots) ??
    spots.reduce((best, item) =>
      crowding(scene, wire, item) < crowding(scene, wire, best) ? item : best,
    );
  shiftTexts(texts, spot.x - box.x, spot.y - box.y);
  scene.texts.push(...texts);
}

/** The gaps a text keeps to its wire, the nearest first. */
const GAPS = [5, 10, 18, 28, 40];

/** Puts a wire's label and the texts at its ends back beside it, where they stood along it. */
function letter(scene: Scene, job: Job) {
  letterEnds(scene, job);
  if (job.label.length) letterLabel(scene, job);
}

/** Puts the texts at a wire's ends back beside them. */
function letterEnds(scene: Scene, job: Job) {
  const { wire } = job,
    total = lengthOf(wire.points);
  for (const { text, first, away } of job.ends) {
    // Past the marker on the end, and no nearer to the shape than the text is long that way.
    const upright = first
        ? Math.abs(wire.points[0].x - wire.points[1].x) < 0.5
        : Math.abs(wire.points.at(-1)!.x - wire.points.at(-2)!.x) < 0.5,
      least = (upright ? text.box.height : text.box.width) / 2 + 4;
    const spots = GAPS.slice(0, 3).flatMap((gap) =>
      [0, 6, 12, 20, 30, 44].flatMap((more) => {
        const along = Math.min(Math.max(least, Math.min(away, 24)) + more, total / 2);
        return besideWire(wire.points, first ? along : total - along, text.box, gap);
      }),
    );
    settle(scene, wire, [text], spots);
  }
}

/** Puts a wire's label back beside it: where it stood along the wire first, then step by step away from there, to both sides. */
function letterLabel(scene: Scene, job: Job) {
  const { wire } = job,
    total = lengthOf(wire.points),
    size = textGroupBox(job.label),
    step = Math.max(10, total / 24),
    at = job.share * total,
    stops = [at],
    margin = Math.min(8, total / 2);
  for (let k = 1; k * step < total; k++)
    for (const stop of [at + k * step, at - k * step])
      if (stop >= margin && stop <= total - margin) stops.push(stop);
  const spots = GAPS.flatMap((gap) =>
    stops.flatMap((stop) => besideWire(wire.points, stop, size, gap)),
  );
  settle(scene, wire, job.label, spots);
}

/** Draws wires again as straight or curved lines between the outlines of their shapes, with their labels. */
function redraw(scene: Scene, jobs: Job[], measure: Measure) {
  const drop = new Set(jobs.map((job) => job.wire));
  scene.wires = scene.wires.filter((wire) => !drop.has(wire));
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  for (const job of jobs) redrawLine(scene, shapes, job);
  for (const job of jobs) {
    // Texts at the ends keep their distance to the end they stood at.
    const wire = scene.wires.find((item) => item.edge === job.wire.edge);
    if (wire) putEnds(scene, job, wire);
    if (job.label.length)
      labelLine(
        scene,
        measure,
        job.wire.edge,
        job.label
          .toSorted((a, b) => a.y - b.y)
          .map((text) => text.text)
          .join("<br>"),
      );
  }
  dodgeTitles(scene, measure);
}

/** Draws a wire again as a loop, a straight or curved line, or a line between its shapes' middles. */
function redrawLine(scene: Scene, shapes: Map<string, SceneShape>, job: Job) {
  const link = {
    id: job.wire.edge,
    source: job.a.id,
    target: job.b.id,
    start: job.start?.kind as MarkerKind | undefined,
    end: job.end?.kind as MarkerKind | undefined,
    dashed: job.wire.dashed,
  };
  if (job.a === job.b) drawLoop(scene, job.a, link);
  else if (!drawLine(scene, shapes, link, new Set(job.wire.home), true)) drawMiddles(scene, job);
}

/** The shapes lie on each other: a line between their middles is all there is. */
function drawMiddles(scene: Scene, job: Job) {
  const ca = centerOf(job.a.box),
    cb = centerOf(job.b.box),
    from = entryPoint(cb, ca, job.a.kind === "actor" ? "rect" : job.a.kind, job.a.box) ?? ca,
    to = entryPoint(ca, cb, job.b.kind === "actor" ? "rect" : job.b.kind, job.b.box) ?? cb;
  scene.wires.push({ ...job.wire, points: [from, to], path: undefined });
  if (job.start) scene.markers.push({ ...job.start, tip: from, direction: unit(to, from) });
  if (job.end) scene.markers.push({ ...job.end, tip: to, direction: unit(from, to) });
}

/** Puts the texts at a wire's ends back, as far from its ends as they stood from the ends it had. */
function putEnds(scene: Scene, job: Job, wire: SceneWire) {
  for (const { text, first } of job.ends) {
    const then = first ? job.was.points[0] : job.was.points.at(-1)!,
      now = first ? wire.points[0] : wire.points.at(-1)!;
    shiftTexts([text], now.x - then.x, now.y - then.y);
    scene.texts.push(text);
  }
}
