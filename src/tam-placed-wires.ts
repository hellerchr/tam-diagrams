/**
 * TAM layout by hand, second step: the wires between the placed elements. Every pair of elements
 * gets the cheapest line through the field of what stands around it (tam-placed-field.ts): one of
 * the simple lines of tam-placed-lines.ts, or a way around from tam-placed-detour.ts. The wires
 * that end on one side of an element keep apart, and once every wire lies, each connection's
 * circle and label take a free spot on it (tam-placed-marks.ts); a connection with no free spot
 * on its wire gets another line.
 */

import { type Box, centerOf, grow, type Point } from "./scene.ts";
import type { TamEdge } from "./tam.ts";
import type { Measure } from "./text.ts";
import { outline } from "./route.ts";
import { CHANNEL, LOOP_END, SHADOW, type TamGeometry, type TamGraph } from "./tam-graph.ts";
import { lies, type PlacedElements, type Side, union } from "./tam-placed.ts";
import { detour, GAP, type Line, meets } from "./tam-placed-detour.ts";
import {
  ALONG,
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
  lines,
  plainSpots,
  range,
  REACH,
  runLength,
  type Spot,
  type Spots,
} from "./tam-placed-lines.ts";
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
 * enters across the diagram's direction pays SIDEWAYS, one off the middle of a side OFF_MIDDLE, and
 * only BESIDE of it where another wire holds the middle. A mark that covers something counts like
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
  BESIDE = 0.1,
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
  /** Each member's line, and its circle and label. */
  laid: Point[][];
  marks: (Mark | undefined)[];
  /** How much the marks cover as they stand: 0 where every one stands free. */
  covered: number;
}

/** The wires, channel circles and label rooms of a layout placed by hand, added to the placed elements. */
export function placedGeometry(
  prepared: TamGraph,
  placed: PlacedElements,
  measure: Measure,
): TamGeometry {
  const { chain, diagram, shapes, vertical } = prepared;
  const boxes = new Map(placed.boxes),
    routes = new Map(placed.stubs),
    nodeLabels = new Map(placed.labels),
    upright = new Map(placed.upright),
    edgeLabels = new Map<string, Box>();
  const elements = [...shapes.keys()].filter(
    (id) =>
      boxes.has(id) &&
      !id.endsWith("#row") &&
      !["dots", "interface", "channel"].includes(shapes.get(id)!.node.kind),
  );
  const leaves = new Set(elements.filter((id) => !shapes.get(id)!.container));
  // Rounded shapes: leaf storages are pills, storage containers and groups of storages have round corners.
  const round = new Map<string, number>();
  for (const id of elements) {
    const { node, container } = shapes.get(id)!;
    if (node.kind === "storage" && !container)
      round.set(id, (boxes.get(id)!.height - (node.stack ? SHADOW : 0)) / 2);
    else if (container && (node.kind === "storage" || (node.kind === "group" && node.passive)))
      round.set(id, 18);
  }
  const end = (id: string): End => ({ id, box: boxes.get(id)!, radius: round.get(id) ?? 0 });

  const field = fieldOf(prepared, placed, elements, measure);
  const markers = new Set<string>();
  /** The wire ends each side of each element holds, as bundles choose their lines and ends move apart. */
  const taken = new Map<string, { at: number; half: number; key: string }[]>();
  // An interface's line takes its place on the side it leaves, like any wire end.
  for (const [edge, stub] of placed.stubs) {
    const { source, target } = diagram.edges.find((item) => item.id === edge) ?? {};
    if (!source || !target || !boxes.has(target) || !boxes.has(source)) continue;
    markers.add(target);
    const up = Math.abs(stub[0].x - stub[1].x) < 0.5,
      side: Side = up
        ? stub[1].y > stub[0].y
          ? "bottom"
          : "top"
        : stub[1].x > stub[0].x
          ? "right"
          : "left",
      key = `${source}\u0000${side}`;
    taken.set(key, [
      ...(taken.get(key) ?? []),
      { at: up ? stub[0].x : stub[0].y, half: CHANNEL / 2, key: edge },
    ]);
  }

  /** The innermost container that holds both elements; the outer one where it holds the other. */
  const homeOf = (a: string, b: string) => {
    const around = new Set(chain(b));
    const id = chain(a).find(
      (id) => around.has(id) && !id.endsWith("#row") && shapes.get(id)?.container,
    );
    return id ? boxes.get(id) : undefined;
  };

  const sidesOf = (id: string) =>
    Object.fromEntries(
      (["top", "bottom", "left", "right"] as Side[]).map((side) => [side, `${id}\u0000${side}`]),
    ) as Record<Side, string>;

  // Connections between one pair of elements share a line.
  const bundles = new Map<string, Bundle>();
  const bundle = (key: string, a: End, b: End, members: TamEdge[]): Bundle => {
    const nested = chain(a.id).includes(b.id) || chain(b.id).includes(a.id),
      sides = { a: sidesOf(a.id), b: sidesOf(b.id) };
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
        home: homeOf(a.id, b.id),
        half: 0,
        sides: [sides.a, sides.b],
      },
      sides,
      laid: [],
      marks: [],
      covered: 0,
    };
  };
  for (const edge of diagram.edges) {
    if (edge.kind === "provided" || edge.kind === "required") continue;
    if (!boxes.has(edge.source) || !boxes.has(edge.target)) continue;
    const key = [edge.source, edge.target].toSorted().join("\u0000");
    const found = bundles.get(key);
    if (found) found.members.push(edge);
    else bundles.set(key, bundle(key, end(edge.source), end(edge.target), [edge]));
  }

  /** Where the members of a bundle run beside its line, by what each carries: a loop's width, a circle. */
  const places = (members: TamEdge[]) => {
    const found = [0];
    for (let index = 1; index < members.length; index++)
      found.push(
        found[index - 1] +
          Math.max(APART, thickness(members[index - 1]) + thickness(members[index]) + 8),
      );
    return found;
  };
  /** The room a loop's two lines take beside the bundle's own where it ends. */
  const loop = (item: Bundle) =>
    item.members.some((edge) => edge.kind === "modify") ? LOOP_END : 0;
  /** The room a side leaves a bundle that ends on it. */
  const room = (item: Bundle, line: Line = item) =>
    Math.min(
      ...[range(item.a, line.from), range(item.b, line.to)].map(([low, high]) => high - low),
    );
  /** Spreads the members of a bundle across its line; one wider than the sides it ends on is pressed together to fit them. */
  const arrange = (item: Bundle) => {
    const found = places(item.members),
      width = found.at(-1)!,
      fits = room(item),
      press = width > fits && width > 0 ? Math.max(fits, (found.length - 1) * 6) / width : 1;
    item.offsets = found.map((place) => (place - width / 2) * press);
    item.reach = (width * press) / 2 + loop(item);
    item.half = (width * press) / 2 + Math.max(...item.members.map(thickness)) / 2;
    item.traveller.half = item.half;
  };

  const sideKey = (item: Bundle, which: "a" | "b", line: Line = item) =>
    item.sides[which][which === "a" ? line.from : line.to];
  const at = (item: Bundle, which: "a" | "b", line: Line = item) => {
    const point = which === "a" ? line.points[0] : line.points.at(-1)!;
    return lies(which === "a" ? line.from : line.to) ? point.x : point.y;
  };

  /**
   * Half of the room a bundle takes where one of its ends meets its side: its wires, and the circle
   * of a channel where the run that leaves the side is the longest, the one the circle stands on,
   * and too short for the circle to stand far from the side.
   */
  const reachAt = (item: Bundle, which: "a" | "b", line: Line = item) => {
    const { points } = line,
      lengths = points.slice(1).map((point, index) => runLength(points[index], point)),
      own = which === "a" ? lengths[0] : lengths.at(-1)!;
    return (
      item.reach +
      (item.members.some(circled) && own >= Math.max(...lengths) && own < 2 * ROOM ? CIRCLE : 0)
    );
  };

  /** What a line costs before what it meets: corners, length, no room for a circle, a crowded side. */
  const plain = (item: Bundle, line: Line) => {
    const { points } = line;
    let total = (points.length - 2) * BEND,
      most = 0;
    for (let index = 0; index < points.length - 1; index++) {
      const length = runLength(points[index], points[index + 1]);
      total += length * LENGTH;
      most = Math.max(most, length);
    }
    if (line.from === line.to && !item.nested) total += BEND;
    // A line leaves the middle of a side unless something stands in its way there.
    total += (line.off ?? 0) * OFF_MIDDLE;
    if (item.members.some(circled) && most < CHANNEL + 8) total += CRAMPED;
    else if (most < ROOM && item.members.some(marked)) total += SHORT;
    // Of equal lines, the one that leaves and enters along the diagram's direction.
    if (lies(line.from) !== vertical) total += SIDEWAYS;
    if (lies(line.to) !== vertical) total += SIDEWAYS;
    for (const which of ["a", "b"] as const) {
      const key = sideKey(item, which, line),
        spot = at(item, which, line);
      const others = (taken.get(key) ?? []).filter((other) => other.key !== item.key);
      if (!others.length) continue;
      // Every wire end has a spot of its own on its side, with a gap to the next.
      const reach = reachAt(item, which, line),
        nearest = Math.min(
          ...others.map((other) => Math.abs(other.at - spot) - other.half - reach),
        );
      if (nearest < GAP) total += nearest < TIGHT ? TAKEN : CLOSE;
      const [low, high] = range(item[which], which === "a" ? line.from : line.to);
      const needed =
        others.reduce((sum, other) => sum + 2 * other.half + APART, 0) +
        (item.members.length - 1) * APART;
      total += needed > high - low ? CROWDED : 12;
    }
    return total;
  };

  const windowOf = (item: Bundle, by: number) => grow(union([item.a.box, item.b.box]), by);

  /**
   * The spots on a side one end of a bundle may take: the middle and the quarters where no other
   * wire ends near them; beside a middle that is taken, the nearest free spot either way.
   */
  const spotsOf =
    (item: Bundle): Spots =>
    (end, side) => {
      const which = end === item.a ? "a" : "b",
        others = (taken.get(item.sides[which][side]) ?? []).filter(
          (other) => other.key !== item.key,
        );
      if (!others.length) return plainSpots(end, side);
      const [low, high] = range(end, side),
        middle = (low + high) / 2,
        reach = item.reach + (item.members.some(circled) ? CIRCLE : 0);
      const free = (spot: number, gap: number) =>
        others.every((other) => Math.abs(other.at - spot) >= other.half + reach + gap);
      const found: Spot[] = [];
      const add = (at: number, off: number) => {
        if (found.every((spot) => Math.abs(spot.at - at) >= 4)) found.push({ at, off });
      };
      if (free(middle, GAP)) add(middle, 0);
      else
        for (const gap of [GAP, TIGHT]) {
          for (const way of [-1, 1])
            for (let spot = middle + way; spot >= low && spot <= high; spot += way)
              if (free(spot, gap)) {
                add(spot, gap === GAP ? BESIDE : 2);
                break;
              }
          if (found.length) break;
        }
      for (const quarter of [0.25, 0.75]) {
        const spot = low + (high - low) * quarter;
        if (free(spot, GAP)) add(spot, 1);
      }
      if (!found.length) add(middle, 2);
      return found;
    };

  /**
   * A bent line with one end moved along its side, with the run that leaves it, to the nearest spot
   * that is free of the ends the side holds already and where that run meets no new trouble; the
   * line itself where its end is free as it lies, or no other spot is.
   */
  const apart = (item: Bundle, line: Line, which: "a" | "b"): Line => {
    const side = which === "a" ? line.from : line.to,
      { points } = line,
      [low, high] = range(item[which], side),
      others = (taken.get(sideKey(item, which, line)) ?? []).filter(
        (other) => other.key !== item.key,
      );
    if (!others.length || points.length < 3) return line;
    const free = (spot: number, gap: number, circle: boolean) =>
      others.every(
        (other) =>
          Math.abs(other.at - spot) >=
          (circle
            ? other.half + reachAt(item, which, line)
            : Math.min(other.half, LOOP_END) + item.reach) +
            gap,
      );
    const start = at(item, which, line),
      other = centerOf(item[which === "a" ? "b" : "a"].box),
      // Toward the element the line leads to first.
      toward = Math.sign((lies(side) ? other.x : other.y) - start) || 1;
    const axis = lies(side) ? "x" : "y",
      [first, second] = which === "a" ? [0, 1] : [points.length - 1, points.length - 2];
    const moved = (spot: number) =>
      points.map((point, index) =>
        index === first || index === second ? { ...point, [axis]: spot } : point,
      );
    let scope: Scope | undefined,
      met = 0;
    const passes = (spot: number) => {
      if (!scope) {
        scope = scopeOf(field, item.traveller, windowOf(item, 200));
        met = price(scope, points, line.from, line.to);
      }
      return price(scope, moved(spot), line.from, line.to) < met + TROUBLE;
    };
    // On a side with more ends than fit GAP apart, they move closer together, at last without room for circles.
    for (const [gap, circle] of [
      [GAP, true],
      [TIGHT, true],
      [TIGHT, false],
    ] as const)
      for (let step = 0; step <= high - low; step += 3)
        for (const spot of [start + toward * step, start - toward * step])
          if (spot >= low && spot <= high && free(spot, gap, circle)) {
            if (spot === start) return line;
            if (passes(spot)) return { ...line, points: moved(spot) };
          }
    return line;
  };

  /** The cheapest `count` lines for a bundle in the field as it is, cheapest first, with what each costs; of several, each between other sides. */
  const cheapest = (item: Bundle, count: number): { line: Line; cost: number }[] => {
    const part = !item.nested ? undefined : chain(item.a.id).includes(item.b.id) ? item.a : item.b;
    const scope = scopeOf(field, item.traveller, windowOf(item, REACH + item.half + 8));
    const found: { line: Line; cost: number; met: number }[] = [];
    const consider = (line: Line, cost: number, within: Scope) => {
      if (found.length === count && cost >= found.at(-1)!.cost) return;
      const met = price(within, line.points, line.from, line.to),
        total = cost + met;
      // Of the lines between one pair of sides, only the cheapest is one of several to choose from.
      const same = found.findIndex(
        (other) => other.line.from === line.from && other.line.to === line.to,
      );
      if (count > 1 && same >= 0) {
        if (found[same].cost <= total) return;
        found.splice(same, 1);
      }
      const index = found.findIndex((other) => total < other.cost);
      if (index < 0 && found.length === count) return;
      found.splice(index < 0 ? found.length : index, 0, { line, cost: total, met });
      if (found.length > count) found.pop();
    };
    for (const { line, cost } of lines(
      item.a,
      item.b,
      part,
      item.members.some(marked),
      spotsOf(item),
      item.half,
    )
      .map((line) => ({ line, cost: plain(item, line) }))
      .toSorted((p, q) => p.cost - q.cost))
      consider(line, cost, scope);
    // Something stands in every simple line's way: around it, in the container of both ends first.
    const best = found[0];
    if (!item.nested && (!best || best.met >= TROUBLE || best.cost >= TROUBLE + 2 * OFF_MIDDLE)) {
      const { home } = item.traveller;
      for (const window of [home ? grow(home, 16) : windowOf(item, 180), undefined]) {
        const wide = scopeOf(field, item.traveller, window),
          { blocked, terrain } = terrainOf(wide),
          found = detour(item.a.box, item.b.box, blocked, terrain),
          // It leaves and enters at the middle of a side: beside the wire ends that lie there already.
          way = found && apart(item, apart(item, found, "a"), "b");
        if (way) consider(way, plain(item, way), wide);
        // A way that still runs into something may find a better one further out.
        if (way && price(wide, way.points, way.from, way.to) < ALONG) break;
      }
    }
    // The elements lie on each other: a line between their middles is all there is.
    if (!found.length)
      found.push({ cost: Infinity, met: Infinity, line: between(item.a.box, item.b.box) });
    return found;
  };

  // What the circles and labels on the wires keep off, as wires and marks take their places.
  const around: Surroundings = {
    solids: field.solids.map((wall) => wall.box),
    containers: field.containers.map((wall) => wall.box),
    titles: field.titles.map((wall) => wall.box),
    wires: [],
    placed: [],
    boundaries: [],
  };
  const stubs = [...placed.stubs].flatMap(([owner, points]) =>
    points.slice(1).map((point, index) => ({ owner, a: points[index], b: point })),
  );
  const piece = (edge: TamEdge, a: Point, b: Point) => ({
    owner: edge.id,
    a,
    b,
    half: edge.kind === "modify" ? thickness(edge) : 0,
  });
  /** Every wire but the bundle's own, for its marks to keep off. */
  const wiresBut = (item?: Bundle) => [
    ...stubs,
    ...queue
      .filter((other) => other !== item)
      .flatMap((other) =>
        other.laid.flatMap((points, member) =>
          points.slice(1).map((point, index) => piece(other.members[member], points[index], point)),
        ),
      ),
  ];
  /** Places the marks of a bundle on its wires as they lie, off every other wire that lies, and notes how much they cover. */
  const mark = (item: Bundle, others: Surroundings["wires"] = wiresBut(item)) => {
    const count = item.members.length,
      own = item.laid.map((points, member) =>
        points.slice(1).map((point, index) => piece(item.members[member], points[index], point)),
      );
    const mine: Surroundings["placed"] = [],
      both = new Set(chain(item.a.id).filter((id) => chain(item.b.id).includes(id))),
      foreign = field.containers.filter((wall) => !both.has(wall.id)).map((wall) => wall.box);
    let hits = 0;
    item.marks = item.members.map((edge, index) => {
      // The outer wires of a bundle carry their labels on their outer side; circles stand along it one after the other.
      const found = placeMark(
        edge,
        item.laid[index],
        {
          share: count > 1 ? (index + 1) / (count + 1) : 0.5,
          outer:
            count > 1 && Math.abs(item.offsets[index]) > 0.5 ? Math.sign(item.offsets[index]) : 0,
        },
        {
          ...around,
          foreign,
          wires: [...others, ...own.flat()],
          placed: [...around.placed, ...mine],
        },
        prepared,
        measure,
      );
      if (found) {
        hits += found.hits;
        mine.push(...found.drawn.map((box) => ({ owner: edge.id, box })));
      }
      return found;
    });
    item.covered = hits;
    return mine;
  };
  /** Takes the marks of a bundle out of what the others keep off. */
  const unmark = (item: Bundle) => {
    if (!field.marks.has(item.key)) return;
    const owners = new Set(item.members.map((edge) => edge.id));
    around.placed = around.placed.filter((entry) => !owners.has(entry.owner));
    around.boundaries = around.boundaries.filter((entry) => !owners.has(entry.owner));
    field.marks.delete(item.key);
  };
  /** Stands the marks of a bundle where the wires and marks that come later keep off them. */
  const commit = (item: Bundle, mine: Surroundings["placed"]) => {
    around.placed.push(...mine);
    item.members.forEach((edge, index) => {
      const found = item.marks[index];
      if (found && edge.protocol && circled(edge))
        around.boundaries.push({
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
  };

  /** Takes a bundle's wires out of the field and its ends off their sides, with its marks. */
  const lift = (item: Bundle) => {
    unmark(item);
    field.wires.delete(item.key);
    for (const which of ["a", "b"] as const) {
      const list = taken.get(sideKey(item, which));
      if (!list) continue;
      for (let index = list.length - 1; index >= 0; index--)
        if (list[index].key === item.key) list.splice(index, 1);
    }
  };

  /** Moves an end of a bundle that lies off the other wire ends on its side. */
  const spread = (item: Bundle, which: "a" | "b") => {
    const line = apart(item, item, which);
    if (line !== item) lay(item, line);
  };

  /** Lays a bundle along a line: its members beside it, its runs into the field, its ends on their sides, its marks on its wires. */
  const lay = (item: Bundle, line: Line) => {
    if (item.points.length) lift(item);
    item.from = line.from;
    item.to = line.to;
    item.points = line.points;
    arrange(item);
    item.laid = item.offsets.map((offset) => beside(item.points, offset));
    field.wires.set(
      item.key,
      runsOf(item.points, item.half, [sideKey(item, "a"), sideKey(item, "b")]),
    );
    for (const which of ["a", "b"] as const) {
      const list = taken.get(sideKey(item, which)) ?? [];
      taken.set(sideKey(item, which), list);
      list.push({ at: at(item, which), half: reachAt(item, which), key: item.key });
    }
    // Its circles and labels stand on it at once, so the wires that come later run around them.
    if (item.members.some(marked)) commit(item, mark(item));
  };

  // Each bundle takes the cheapest line. The pairs a straight line joins choose first, so no other
  // wire takes the room between them; then near pairs before far ones, which leave by the sides
  // still free.
  const span = (item: Bundle) => {
    const ca = centerOf(item.a.box),
      cb = centerOf(item.b.box);
    return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
  };
  /** The line each bundle takes where no other wire lies, and what it costs. */
  const alone = new Map<Bundle, { line: Line; cost: number }>();
  for (const item of bundles.values()) {
    item.reach = places(item.members).at(-1)! / 2 + loop(item);
    item.half = item.traveller.half =
      places(item.members).at(-1)! / 2 + Math.max(...item.members.map(thickness)) / 2;
    alone.set(item, cheapest(item, 1)[0]);
  }
  const direct = (item: Bundle) => +(alone.get(item)!.line.points.length === 2);
  const queue = [...bundles.values()].toSorted(
    (p, q) => direct(q) - direct(p) || span(p) - span(q),
  );
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    const [{ line }] = cheapest(item, 1);
    // Circles side by side need their room: the channels a side has no room for take a line of their own.
    const fit = places(item.members).findLastIndex((place) => place <= room(item, line)) + 1;
    if (fit < item.members.length && item.members.some(circled)) {
      const rest = bundle(
        `${item.key}\u0000${index}`,
        item.a,
        item.b,
        item.members.splice(Math.max(1, fit)),
      );
      for (const each of [item, rest]) {
        each.reach = places(each.members).at(-1)! / 2 + loop(each);
        each.half = each.traveller.half =
          places(each.members).at(-1)! / 2 + Math.max(...each.members.map(thickness)) / 2;
      }
      queue.splice(index + 1, 0, rest);
    }
    lay(item, line);
  }

  // A wire end that found no spot of its own on its side moves along it: straight lines stay.
  const bent = queue.filter((item) => item.points.length > 2);
  for (const which of ["a", "b"] as const) for (const item of bent) spread(item, which);

  /** What a bundle's line costs as it lies, with everything it meets and what its marks cover. */
  const worth = (item: Bundle) =>
    plain(item, item) +
    price(scopeOf(field, item.traveller), item.points, item.from, item.to) +
    item.covered * COVER;
  /** The bundles a line for a bundle runs on or beside, meets in a junction, or ends too near on a side. */
  const clashes = (item: Bundle, line: Line = item): Bundle[] => {
    const { points } = line,
      found = new Set<Bundle>();
    for (const which of ["a", "b"] as const)
      for (const other of taken.get(sideKey(item, which, line)) ?? [])
        if (
          other.key !== item.key &&
          Math.abs(other.at - at(item, which, line)) < other.half + reachAt(item, which, line) + GAP
        ) {
          const owner = queue.find((bundle) => bundle.key === other.key);
          if (owner) found.add(owner);
        }
    for (const other of queue) {
      if (other === item || found.has(other)) continue;
      const runs = field.wires.get(other.key) ?? [];
      const hit = points.slice(1).some((point, index) => {
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
      if (hit) found.add(other);
    }
    return [...found];
  };
  /** Gives a bundle the cheapest line in the field as it is. */
  const route = (item: Bundle) => {
    lift(item);
    lay(item, cheapest(item, 1)[0].line);
    if (item.points.length > 2) (["a", "b"] as const).forEach((which) => spread(item, which));
  };
  const lineOf = (item: Bundle): Line => ({ from: item.from, to: item.to, points: item.points });
  // Two wires that still read as one: each chose its line without the other, or around it. And a
  // wire that goes a long way round because another one lies where it would run alone. The two
  // choose again, one first and then the other first, and keep the lines that suit both best.
  for (const item of queue) {
    const ideal = alone.get(item),
      pushed = ideal && worth(item) > ideal.cost + PUSHED ? clashes(item, ideal.line) : [];
    for (const other of new Set([...clashes(item), ...pushed])) {
      let best = { cost: worth(item) + worth(other), lines: [lineOf(item), lineOf(other)] };
      for (const [first, second] of [
        [item, other],
        [other, item],
      ]) {
        lift(second);
        route(first);
        route(second);
        const cost = worth(item) + worth(other);
        if (cost < best.cost - 1) best = { cost, lines: [lineOf(item), lineOf(other)] };
      }
      lift(item);
      lift(other);
      lay(item, best.lines[0]);
      lay(other, best.lines[1]);
      // And each once more beside the other as it lies now.
      for (const each of [item, other]) {
        const line = lineOf(each);
        route(each);
        const cost = worth(item) + worth(other);
        if (cost < best.cost - 1) best.cost = cost;
        else {
          lift(each);
          lay(each, line);
        }
      }
    }
  }

  // Every wire lies: circles and labels take their spots again, on the shortest wires first.
  const longest = (item: Bundle) =>
    Math.max(...item.points.slice(1).map((point, index) => runLength(item.points[index], point)));
  const troubled: Bundle[] = [];
  for (const item of queue.toSorted((p, q) => longest(p) - longest(q))) {
    if (!item.members.some(marked)) continue;
    unmark(item);
    commit(item, mark(item));
    if (item.covered >= HIT) troubled.push(item);
  }

  // A connection whose circle or label covers something takes another line, where one leaves them room.
  for (const item of troubled) {
    const current = lineOf(item);
    lift(item);
    let best: { line: Line; total: number } | undefined;
    const options = cheapest(item, OTHERS);
    const scope = scopeOf(field, item.traveller);
    for (const option of [current, ...options.map((option) => option.line)]) {
      lay(item, option);
      if (option !== current && option.points.length > 2)
        (["a", "b"] as const).forEach((which) => spread(item, which));
      const line: Line = { from: item.from, to: item.to, points: item.points, off: option.off },
        met = price(scope, line.points, line.from, line.to);
      if (option !== current && met >= THROUGH) continue;
      const total = plain(item, line) + met + item.covered * COVER;
      if (!best || total < best.total) best = { line, total };
    }
    lay(item, best!.line);
  }

  for (const item of queue) {
    item.members.forEach((edge, index) => {
      let points = item.laid[index].map((point) => ({ ...point }));
      const found = item.marks[index];
      // Every end on a rounded shape meets its curved outline.
      const first = outline(points[0], points[1], item.a.box, item.nested ? 0 : item.a.radius),
        last = outline(points.at(-1)!, points.at(-2)!, item.b.box, item.nested ? 0 : item.b.radius);
      points[0] = first;
      points[points.length - 1] = last;
      let cut = found?.host ?? 0;
      if (edge.source !== item.a.id) {
        points = points.toReversed();
        cut = points.length - 2 - cut;
      }
      if (found && circled(edge)) {
        // The circle sits on its run, its label and marker beside it.
        const id = `${edge.id}#node`;
        boxes.set(id, found.rooms.at(-1)!);
        markers.add(id);
        upright.set(id, found.up);
        routes.set(`${edge.id}:a`, [...points.slice(0, cut + 1), found.spot]);
        routes.set(`${edge.id}:b`, [found.spot, ...points.slice(cut + 1)]);
        if (found.rooms.length > 1) nodeLabels.set(id, found.rooms.slice(0, -1));
        return;
      }
      routes.set(edge.id, points);
      if (found) edgeLabels.set(edge.id, found.rooms[0]);
    });
  }
  return {
    boxes,
    edgeLabels,
    leaves,
    markers,
    nodeLabels,
    round,
    routes,
    upright,
    dots: placed.dots,
  };
}
