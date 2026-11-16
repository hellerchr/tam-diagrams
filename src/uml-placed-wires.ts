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
  runsOf,
  scopeOf,
  terrainOf,
  type Traveller,
  TROUBLE,
} from "./tam-placed-field.ts";
import {
  between,
  type End,
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
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape])),
    before = new Map(auto.shapes.map((shape) => [shape.id, shape.box]));
  const moveOf = (shape: SceneShape): Move => {
    const was = before.get(shape.id)!;
    return {
      dx: shape.box.x - was.x,
      dy: shape.box.y - was.y,
      resized:
        Math.abs(shape.box.width - was.width) > 0.01 ||
        Math.abs(shape.box.height - was.height) > 0.01,
    };
  };
  /** Whether a wire as it lies runs through a part or a container that is not its own. */
  const blocked = (wire: SceneWire) =>
    wire.points
      .slice(1)
      .some((point, index) =>
        scene.shapes.some((shape) =>
          shape.kind === "region" || shape.passable
            ? false
            : shape.container
              ? !wire.home.includes(shape.id) &&
                crossesBox(wire.points[index], point, grow(shape.box, -1))
              : !wire.ends.includes(shape.id) && crossesShape(wire.points[index], point, shape),
        ),
      );
  const textsOf = (wire: SceneWire) =>
    scene.texts.filter((text) => text.owner === wire.edge && !shapes.has(wire.edge));
  const markersOf = (wire: SceneWire) =>
    scene.markers.filter(
      (marker) =>
        marker.wire === wire.edge &&
        Math.min(distance(marker.tip, wire.points[0]), distance(marker.tip, wire.points.at(-1)!)) <
          1,
    );

  const jobs: Job[] = [];
  scene.wires.forEach((wire, index) => {
    const was = auto.wires[index],
      a = shapes.get(wire.from ?? wire.ends[0]),
      b = shapes.get(wire.to ?? wire.ends.at(-1)!);
    if (!a || !b) return;
    const from = moveOf(a),
      to = moveOf(b);
    const still = (move: Move) => !move.dx && !move.dy && !move.resized;
    if (still(from) && still(to)) {
      if (!blocked(wire)) return;
    } else if (
      (a === b || (from.dx === to.dx && from.dy === to.dy && !to.resized)) &&
      !from.resized &&
      !wire.path
    ) {
      // Both ends moved as one: the wire goes with them, with all it carries.
      const texts = textsOf(wire),
        markers = markersOf(wire);
      wire.points = wire.points.map((point) => ({ x: point.x + from.dx, y: point.y + from.dy }));
      for (const marker of markers)
        marker.tip = { x: marker.tip.x + from.dx, y: marker.tip.y + from.dy };
      shiftTexts(texts, from.dx, from.dy);
      if (a === b || !blocked(wire)) return;
      wire.points = was.points.map((point) => ({ ...point }));
      for (const marker of markers)
        marker.tip = { x: marker.tip.x - from.dx, y: marker.tip.y - from.dy };
      shiftTexts(texts, -from.dx, -from.dy);
    } else if (a === b && !wire.path) {
      // A loop at a container that changed its size keeps its corner.
      const corner = (box: Box) => ({ x: box.x + box.width, y: box.y }),
        now = corner(a.box),
        then = corner(before.get(a.id)!),
        dx = now.x - then.x,
        dy = now.y - then.y;
      wire.points = wire.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
      for (const marker of markersOf(was))
        marker.tip = { x: marker.tip.x + dx, y: marker.tip.y + dy };
      shiftTexts(textsOf(wire), dx, dy);
      return;
    }
    const markers = markersOf(was),
      nearStart = (point: Point) =>
        distance(point, was.points[0]) <= distance(point, was.points.at(-1)!),
      texts = textsOf(wire),
      label = texts.filter((text) => text.role === "label"),
      total = lengthOf(was.points) || 1;
    jobs.push({
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
          return {
            text,
            first,
            away: distance(center, first ? was.points[0] : was.points.at(-1)!),
          };
        }),
    });
  });
  if (!jobs.length) return;

  // What the wires to lay carried leaves the scene while they are laid, and comes back beside them.
  const lifted = new Set<SceneText>(
      jobs.flatMap((job) => [...job.label, ...job.ends.map((end) => end.text)]),
    ),
    gone = new Set<SceneMarker>(
      jobs.flatMap((job) => [job.start, job.end].filter((item) => !!item)),
    );
  scene.texts = scene.texts.filter((text) => !lifted.has(text));
  scene.markers = scene.markers.filter((marker) => !gone.has(marker));

  if (style === "straight") return redraw(scene, jobs, measure);

  const routed = new Set(jobs.map((job) => job.wire));
  const field: Field = {
    solids: [],
    containers: [],
    titles: [],
    wires: new Map(),
    marks: new Map(),
  };
  for (const shape of scene.shapes) {
    if (shape.passable) continue;
    if (shape.container) {
      field.containers.push({ id: shape.id, box: shape.box });
      const titles = scene.texts.filter(
        (text) => text.owner === shape.id && (text.role === "title" || text.role === "stereotype"),
      );
      if (titles.length) field.titles.push({ id: shape.id, box: grow(textGroupBox(titles), 2) });
    } else field.solids.push({ id: shape.id, box: shape.box });
  }
  // A part's text beside it stands in a wire's way like the part.
  for (const text of scene.texts) {
    const owner = text.owner ? shapes.get(text.owner) : undefined;
    if (owner && !owner.container && text.role === "label")
      field.solids.push({ id: `${owner.id}\u0000label`, box: text.box });
  }
  /** The wire ends each side of each shape holds. */
  const taken = new Map<string, { at: number; key: string }[]>();
  const sideKey = (id: string, side: Side) => `${id}\u0000${side}`;
  const hold = (id: string, side: Side, point: Point, key: string) => {
    const list = taken.get(sideKey(id, side)) ?? [];
    taken.set(sideKey(id, side), list);
    list.push({ at: lies(side) ? point.x : point.y, key });
  };
  scene.wires.forEach((wire, index) => {
    if (routed.has(wire)) return;
    const key = `${wire.edge}\u0000${index}`,
      a = shapes.get(wire.from ?? wire.ends[0]),
      b = shapes.get(wire.to ?? wire.ends.at(-1)!);
    field.wires.set(key, runsOf(wire.points, 0));
    if (a) hold(a.id, sideAt(a.box, wire.points[0]), wire.points[0], key);
    if (b) hold(b.id, sideAt(b.box, wire.points.at(-1)!), wire.points.at(-1)!, key);
    const marks = scene.texts.filter((text) => text.owner === wire.edge).map((text) => text.box);
    if (marks.length) field.marks.set(key, marks);
  });

  const radiusOf = (shape: SceneShape) =>
    shape.kind === "round"
      ? (shape.radius ?? 10)
      : shape.kind === "stadium" || outlineOf(shape.kind) === "ellipse"
        ? Math.min(shape.box.width, shape.box.height) / 2
        : 0;
  /** Shapes a wire meets at the middle of a side only: diamonds, and circles too small for more. */
  const symbol = (shape: SceneShape) => {
    const kind = outlineOf(shape.kind);
    return (
      kind === "diamond" ||
      (kind === "ellipse" && Math.max(shape.box.width, shape.box.height) <= SMALL_SYMBOL)
    );
  };
  /** Shapes whose outline is not their box: a straight wire to one runs through its middle. */
  const centered = (shape: SceneShape) => outlineOf(shape.kind) !== "box";
  const endOf = (shape: SceneShape): End => ({
    id: shape.id,
    box: shape.box,
    radius: radiusOf(shape),
  });
  const sidesOf = (id: string) =>
    Object.fromEntries(SIDES.map((side) => [side, sideKey(id, side)])) as Record<Side, string>;

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
  const routes: Route[] = jobs.map((job, index) => {
    const chainA = chainOf(tree, job.a.id),
      chainB = chainOf(tree, job.b.id),
      a = endOf(job.a),
      b = endOf(job.b),
      nested = chainA.includes(job.b.id) || chainB.includes(job.a.id),
      home = chainA.find((id) => chainB.includes(id) && shapes.get(id)?.container);
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
        home: home ? shapes.get(home)!.box : undefined,
        half: 0,
        sides: [sidesOf(a.id), sidesOf(b.id)],
      },
    };
  });

  /** The spots on a side a wire may end at: the middle of a symbol, else spots free of the ends the side holds. */
  const spotsOf =
    (route: Route): Spots =>
    (end, side) => {
      const shape = shapes.get(end.id)!,
        [low, high] = range(end, side),
        middle = (low + high) / 2;
      if (symbol(shape)) return [{ at: middle, off: 0 }];
      const others = (taken.get(sideKey(end.id, side)) ?? []).filter(
        (other) => other.key !== route.key,
      );
      const free = (spot: number, gap: number) =>
        others.every((other) => Math.abs(other.at - spot) >= gap);
      const found: Spot[] = [];
      const add = (at: number, off: number) => {
        if (found.every((spot) => Math.abs(spot.at - at) >= 4)) found.push({ at, off });
      };
      if (free(middle, APART)) add(middle, 0);
      else
        for (const gap of [APART, TIGHT]) {
          for (const way of [-1, 1])
            for (let spot = middle + way; spot >= low && spot <= high; spot += way)
              if (free(spot, gap)) {
                add(spot, gap === APART ? 0.1 : 2);
                break;
              }
          if (found.length) break;
        }
      for (const quarter of [0.25, 0.75]) {
        const spot = low + (high - low) * quarter;
        if (free(spot, APART)) add(spot, 1);
      }
      if (!found.length) add(middle, 2);
      return found;
    };

  /** Whether a line ends where its shapes take wires: a symbol at the middle of a side. */
  const fits = (route: Route, line: Line) =>
    (["a", "b"] as const).every((which) => {
      const end = route[which],
        shape = shapes.get(end.id)!;
      if (!symbol(shape) || route.nested) return true;
      const side = which === "a" ? line.from : line.to,
        point = which === "a" ? line.points[0] : line.points.at(-1)!,
        center = centerOf(end.box);
      return Math.abs(lies(side) ? point.x - center.x : point.y - center.y) < 0.5;
    });

  /**
   * The straight lines between facing sides that run through the middle of a shape whose outline
   * is not its box: where such a shape stands level with the other, the wire is one straight line.
   */
  const throughMiddles = (route: Route): Line[] => {
    if (route.nested) return [];
    const { a, b, job } = route,
      found: Line[] = [];
    for (const [from, to] of [
      ["bottom", "top"],
      ["top", "bottom"],
      ["right", "left"],
      ["left", "right"],
    ] as const) {
      const out = from === "bottom" || from === "right" ? 1 : -1,
        near = lies(from)
          ? out > 0
            ? a.box.y + a.box.height
            : a.box.y
          : out > 0
            ? a.box.x + a.box.width
            : a.box.x,
        far = lies(to)
          ? out > 0
            ? b.box.y
            : b.box.y + b.box.height
          : out > 0
            ? b.box.x
            : b.box.x + b.box.width;
      if (out * (far - near) < 4) continue;
      const middle = (box: Box) => (lies(from) ? box.x + box.width / 2 : box.y + box.height / 2);
      const ats = [
        ...(centered(job.a) ? [middle(a.box)] : []),
        ...(centered(job.b) ? [middle(b.box)] : []),
      ];
      const [lowA, highA] = range(a, from),
        [lowB, highB] = range(b, to);
      for (const at of ats)
        if (
          at >= lowA - 0.5 &&
          at <= highA + 0.5 &&
          at >= lowB - 0.5 &&
          at <= highB + 0.5 &&
          ats.every((other) => Math.abs(other - at) < 0.5)
        ) {
          found.push({
            from,
            to,
            points: [sidePoint(a.box, from, at), sidePoint(b.box, to, at)],
            off: 0,
          });
          break;
        }
    }
    return found;
  };

  /** What a line costs before what it meets: corners, length, ends off the middle or beside others. */
  const plain = (route: Route, line: Line) => {
    const { points } = line;
    let total =
      (points.length - 2) * BEND + lengthOf(points) * LENGTH + (line.off ?? 0) * OFF_MIDDLE;
    if (line.from === line.to && !route.nested) total += BEND;
    for (const which of ["a", "b"] as const) {
      const end = route[which],
        side = which === "a" ? line.from : line.to,
        point = which === "a" ? points[0] : points.at(-1)!,
        at = lies(side) ? point.x : point.y;
      if ((lies(side) ? end.box.width : end.box.height) < 12 && !symbol(shapes.get(end.id)!))
        total += SHORT_SIDE;
      const nearest = Math.min(
        Infinity,
        ...(taken.get(sideKey(end.id, side)) ?? [])
          .filter((other) => other.key !== route.key)
          .map((other) => Math.abs(other.at - at)),
      );
      if (nearest < APART) total += nearest < TIGHT ? TAKEN : CLOSE;
    }
    return total;
  };

  /** The cheapest line for a wire in the field as it is. */
  const cheapest = (route: Route): Line => {
    const both = around([route.a.box, route.b.box]),
      scope = scopeOf(field, route.traveller, grow(both, REACH + 8));
    let best: { line: Line; cost: number; met: number } | undefined;
    const consider = (line: Line, within = scope) => {
      const met = price(within, line.points, line.from, line.to),
        cost = plain(route, line) + met;
      if (!best || cost < best.cost) best = { line, cost, met };
    };
    for (const line of [
      ...throughMiddles(route),
      ...lines(route.a, route.b, route.part, route.job.label.length > 0, spotsOf(route)),
    ])
      if (fits(route, line)) consider(line);
    if (!route.nested && (!best || best.met >= TROUBLE)) {
      const { home } = route.traveller;
      for (const window of [home ? grow(home, 16) : grow(both, 180), undefined]) {
        const wide = scopeOf(field, route.traveller, window),
          { blocked: walls, terrain } = terrainOf(wide),
          way = detour(route.a.box, route.b.box, walls, terrain);
        if (!way) continue;
        consider(way, wide);
        if (price(wide, way.points, way.from, way.to) < ALONG) break;
      }
    }
    return best?.line ?? between(route.a.box, route.b.box);
  };

  const lift = (route: Route) => {
    field.wires.delete(route.key);
    for (const list of taken.values())
      for (let index = list.length - 1; index >= 0; index--)
        if (list[index].key === route.key) list.splice(index, 1);
  };
  const lay = (route: Route, line: Line) => {
    route.line = line;
    field.wires.set(
      route.key,
      runsOf(line.points, 0, [sideKey(route.a.id, line.from), sideKey(route.b.id, line.to)]),
    );
    hold(route.a.id, line.from, line.points[0], route.key);
    hold(route.b.id, line.to, line.points.at(-1)!, route.key);
  };

  // Near pairs choose first and leave by the sides still free; then each once more beside the others.
  const span = (route: Route) => {
    const ca = centerOf(route.a.box),
      cb = centerOf(route.b.box);
    return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
  };
  const queue = routes.toSorted((p, q) => span(p) - span(q));
  for (const route of queue) lay(route, cheapest(route));
  for (const route of queue) {
    lift(route);
    lay(route, cheapest(route));
  }

  for (const route of routes) {
    const { job } = route;
    let points = route.line!.points.map((point) => ({ ...point }));
    // Every end meets the outline of its shape: round corners, slanted sides.
    if (!route.nested) {
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
    }
    job.wire.points = simplifyPath(points);
  }
  for (const job of jobs) mark(scene, job);
  for (const job of jobs) letter(scene, job);
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
  if (job.label.length) {
    // Where it stood along the wire first, then step by step away from there, to both sides.
    const size = textGroupBox(job.label),
      step = Math.max(10, total / 24),
      at = job.share * total,
      stops = [at];
    for (let k = 1; k * step < total; k++)
      for (const stop of [at + k * step, at - k * step])
        if (stop >= Math.min(8, total / 2) && stop <= total - Math.min(8, total / 2))
          stops.push(stop);
    const spots = GAPS.flatMap((gap) =>
      stops.flatMap((stop) => besideWire(wire.points, stop, size, gap)),
    );
    settle(scene, wire, job.label, spots);
  }
}

/** Draws wires again as straight or curved lines between the outlines of their shapes, with their labels. */
function redraw(scene: Scene, jobs: Job[], measure: Measure) {
  const drop = new Set(jobs.map((job) => job.wire));
  scene.wires = scene.wires.filter((wire) => !drop.has(wire));
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  for (const job of jobs) {
    const link = {
      id: job.wire.edge,
      source: job.a.id,
      target: job.b.id,
      start: job.start?.kind as MarkerKind | undefined,
      end: job.end?.kind as MarkerKind | undefined,
      dashed: job.wire.dashed,
    };
    if (job.a === job.b) drawLoop(scene, job.a, link);
    else if (!drawLine(scene, shapes, link, new Set(job.wire.home), true)) {
      // The shapes lie on each other: a line between their middles is all there is.
      const ca = centerOf(job.a.box),
        cb = centerOf(job.b.box),
        from = entryPoint(cb, ca, job.a.kind === "actor" ? "rect" : job.a.kind, job.a.box) ?? ca,
        to = entryPoint(ca, cb, job.b.kind === "actor" ? "rect" : job.b.kind, job.b.box) ?? cb;
      scene.wires.push({ ...job.wire, points: [from, to], path: undefined });
      if (job.start) scene.markers.push({ ...job.start, tip: from, direction: unit(to, from) });
      if (job.end) scene.markers.push({ ...job.end, tip: to, direction: unit(from, to) });
    }
  }
  for (const job of jobs) {
    // Texts at the ends keep their distance to the end they stood at.
    const wire = scene.wires.find((item) => item.edge === job.wire.edge);
    if (wire)
      for (const { text, first } of job.ends) {
        const then = first ? job.was.points[0] : job.was.points.at(-1)!,
          now = first ? wire.points[0] : wire.points.at(-1)!;
        shiftTexts([text], now.x - then.x, now.y - then.y);
        scene.texts.push(text);
      }
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
