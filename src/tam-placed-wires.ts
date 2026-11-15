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
import { detour, type Line } from "./tam-placed-detour.ts";
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
import { beside, between, type End, lines, range, REACH, runLength } from "./tam-placed-lines.ts";
import {
  circled,
  HIT,
  type Mark,
  marked,
  placeMark,
  type Surroundings,
  thickness,
} from "./tam-placed-marks.ts";

/** Wires of a bundle keep this far apart, wire ends on one side half of it, and TIGHT where a side is full. */
const APART = 18,
  TIGHT = 6;

/** A circle on the run that leaves a side keeps the wire ends beside it this much further off. */
const CIRCLE = 6;

/** A wire's run with a channel's circle or a label on it is at least this long. */
const ROOM = 44;

/**
 * What a line costs beside what it meets: a corner counts like BEND pixels of wire. SHORT is a line
 * too short for the label at its circle, CRAMPED one too short for the circle itself, CROWDED a side
 * with more wire ends than fit, TAKEN a spot on a side another straight wire ends at. A line that
 * leaves or enters across the diagram's direction pays SIDEWAYS, one off the middle of a side
 * OFF_MIDDLE. A mark that covers something counts like COVER pixels for each point it covers.
 */
const BEND = 70,
  LENGTH = 0.25,
  SHORT = 90,
  CRAMPED = 600,
  CROWDED = 120,
  TAKEN = 300,
  SIDEWAYS = 80,
  OFF_MIDDLE = 150,
  COVER = 60;

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
    const nested = chain(a.id).includes(b.id) || chain(b.id).includes(a.id);
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
      },
      sides: { a: sidesOf(a.id), b: sidesOf(b.id) },
      laid: [],
      marks: [],
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

  /** The bundles that end on each side of each element, as they choose their lines. */
  const ends = new Map<string, Bundle[]>();
  const sideKey = (item: Bundle, which: "a" | "b", line: Line = item) =>
    item.sides[which][which === "a" ? line.from : line.to];
  const at = (item: Bundle, which: "a" | "b", line: Line = item) => {
    const point = which === "a" ? line.points[0] : line.points.at(-1)!;
    return lies(which === "a" ? line.from : line.to) ? point.x : point.y;
  };

  /**
   * Half of the room a bundle takes where one of its ends meets its side: its wires, and the circle
   * of a channel where the run that leaves the side is the longest, the one the circle stands on.
   */
  const reachAt = (item: Bundle, which: "a" | "b", line: Line = item) => {
    const { points } = line,
      lengths = points.slice(1).map((point, index) => runLength(points[index], point)),
      own = which === "a" ? lengths[0] : lengths.at(-1)!;
    return item.reach + (item.members.some(circled) && own >= Math.max(...lengths) ? CIRCLE : 0);
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
      // A straight line stays where it is: its spot on the side is free or it is no line to take.
      if (
        points.length === 2 &&
        (taken.get(key) ?? []).some(
          (other) =>
            other.key !== item.key &&
            Math.abs(other.at - spot) < other.half + reachAt(item, which, line) + APART / 2,
        )
      )
        total += TAKEN;
      const others = (ends.get(key) ?? []).filter((other) => other !== item);
      if (!others.length) continue;
      const [low, high] = range(item[which], which === "a" ? line.from : line.to);
      const needed =
        others.reduce((sum, other) => sum + 2 * other.reach + APART, 0) +
        (item.members.length - 1) * APART;
      total += needed > high - low ? CROWDED : 12;
    }
    return total;
  };

  const windowOf = (item: Bundle, by: number) => grow(union([item.a.box, item.b.box]), by);

  /** The cheapest `count` lines for a bundle in the field as it is, cheapest first, with what each costs; of several, each between other sides. */
  const cheapest = (item: Bundle, count: number): { line: Line; cost: number }[] => {
    const part = !item.nested ? undefined : chain(item.a.id).includes(item.b.id) ? item.a : item.b;
    const scope = scopeOf(field, item.traveller, windowOf(item, REACH + item.half + 8));
    const found: { line: Line; cost: number; met: number }[] = [];
    const consider = (line: Line, cost: number, within: Scope) => {
      if (found.length === count && cost >= found.at(-1)!.cost) return;
      const met = price(within, line.points),
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
    for (const { line, cost } of lines(item.a, item.b, part, item.members.some(marked))
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
          way = detour(item.a.box, item.b.box, blocked, terrain);
        if (way) consider(way, plain(item, way), wide);
        // A way that still runs into something may find a better one further out.
        if (way && price(wide, way.points) < ALONG) break;
      }
    }
    // The elements lie on each other: a line between their middles is all there is.
    if (!found.length)
      found.push({ cost: Infinity, met: Infinity, line: between(item.a.box, item.b.box) });
    return found;
  };

  /** Lays a bundle along a line: its members beside it, and its runs into the field. */
  const lay = (item: Bundle, line: Line) => {
    item.from = line.from;
    item.to = line.to;
    item.points = line.points;
    arrange(item);
    item.laid = item.offsets.map((offset) => beside(item.points, offset));
    field.wires.set(item.key, runsOf(item.points, item.half));
  };

  const take = (item: Bundle, which: "a" | "b") => {
    const list = taken.get(sideKey(item, which)) ?? [];
    taken.set(sideKey(item, which), list);
    list.push({ at: at(item, which), half: reachAt(item, which), key: item.key });
  };

  // Each bundle takes the cheapest line; near pairs choose first, so far ones leave by the sides still free.
  const span = (item: Bundle) => {
    const ca = centerOf(item.a.box),
      cb = centerOf(item.b.box);
    return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
  };
  const queue = [...bundles.values()].toSorted((p, q) => span(p) - span(q));
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    item.reach = places(item.members).at(-1)! / 2 + loop(item);
    item.half = item.traveller.half =
      places(item.members).at(-1)! / 2 + Math.max(...item.members.map(thickness)) / 2;
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
      queue.splice(index + 1, 0, rest);
    }
    lay(item, line);
    for (const which of ["a", "b"] as const) {
      const key = sideKey(item, which);
      ends.set(key, [...(ends.get(key) ?? []), item]);
      // A straight line stays where it is, so it takes its spots on both sides at once.
      if (item.points.length === 2 && !item.nested) take(item, which);
    }
  }

  /** How far the element a bundle leads to lies along the side one of its ends is on. */
  const far = (item: Bundle, which: "a" | "b") => {
    const other = centerOf(item[which === "a" ? "b" : "a"].box),
      side = which === "a" ? item.from : item.to;
    return (lies(side) ? other.x : other.y) - at(item, which);
  };
  /**
   * Moves one end of a bent line along its side, with the run that leaves it, to the nearest spot
   * that is free of the ends the side holds already and where that run meets no new trouble.
   */
  const spread = (item: Bundle, which: "a" | "b") => {
    const side = which === "a" ? item.from : item.to,
      [low, high] = range(item[which], side),
      others = (taken.get(sideKey(item, which)) ?? []).filter((other) => other.key !== item.key);
    const free = (spot: number, gap: number, circle: boolean) =>
      others.every(
        (other) =>
          Math.abs(other.at - spot) >=
          (circle
            ? other.half + reachAt(item, which)
            : Math.min(other.half, LOOP_END) + item.reach) +
            gap,
      );
    const toward = Math.sign(far(item, which)) || 1,
      start = at(item, which);
    const axis = lies(side) ? "x" : "y",
      [first, second] = which === "a" ? [0, 1] : [item.points.length - 1, item.points.length - 2];
    const moved = (spot: number) =>
      item.points.map((point, index) =>
        index === first || index === second ? { ...point, [axis]: spot } : point,
      );
    let scope: Scope | undefined,
      met = 0;
    const passes = (spot: number) => {
      if (!scope) {
        scope = scopeOf(field, item.traveller, windowOf(item, 200));
        met = price(scope, item.points);
      }
      return price(scope, moved(spot)) < met + TROUBLE;
    };
    // On a side with more ends than fit APART / 2 apart, they move closer together, at last without room for circles.
    let found: number | undefined;
    for (const [gap, circle] of [
      [APART / 2, true],
      [TIGHT, true],
      [TIGHT, false],
    ] as const)
      for (let step = 0; found === undefined && step <= high - low; step += 3)
        for (const spot of [start + toward * step, start - toward * step])
          if (
            found === undefined &&
            spot >= low &&
            spot <= high &&
            free(spot, gap, circle) &&
            (spot === start || passes(spot))
          )
            found = spot;
    if (found !== undefined && found !== start) lay(item, { ...item, points: moved(found) });
  };

  // Wire ends on one side of an element keep apart: straight lines stay, the others move along the side.
  const bent = queue.filter((item) => item.points.length > 2);
  for (const which of ["a", "b"] as const)
    // Nearest first: a wire to a near element keeps the middle, wires to far ones leave beside it.
    for (const item of bent.toSorted((p, q) => Math.abs(far(p, which)) - Math.abs(far(q, which)))) {
      spread(item, which);
      take(item, which);
    }

  // Every wire lies: circles and labels take their spots, on the shortest wires first.
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
  /** Places the marks of a bundle on its wires as they lie and returns how much they cover. */
  const mark = (item: Bundle, others: Surroundings["wires"]) => {
    const count = item.members.length,
      own = item.laid.map((points, member) =>
        points.slice(1).map((point, index) => piece(item.members[member], points[index], point)),
      );
    const mine: Surroundings["placed"] = [];
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
        { ...around, wires: [...others, ...own.flat()], placed: [...around.placed, ...mine] },
        prepared,
        measure,
      );
      if (found) {
        hits += found.hits;
        mine.push(...found.drawn.map((box) => ({ owner: edge.id, box })));
      }
      return found;
    });
    return { hits, mine };
  };
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
  const longest = (item: Bundle) =>
    Math.max(...item.points.slice(1).map((point, index) => runLength(item.points[index], point)));
  const troubled: Bundle[] = [];
  const all = wiresBut();
  for (const item of queue.toSorted((p, q) => longest(p) - longest(q))) {
    if (!item.members.some(marked)) continue;
    const owners = new Set(item.members.map((edge) => edge.id));
    const { hits, mine } = mark(
      item,
      all.filter((wire) => !owners.has(wire.owner)),
    );
    commit(item, mine);
    if (hits >= HIT) troubled.push(item);
  }

  // A connection whose circle or label covers something takes another line, where one leaves them room.
  for (const item of troubled) {
    const owners = new Set(item.members.map((edge) => edge.id)),
      others = wiresBut(item);
    around.placed = around.placed.filter((entry) => !owners.has(entry.owner));
    around.boundaries = around.boundaries.filter((entry) => !owners.has(entry.owner));
    field.marks.delete(item.key);
    field.wires.delete(item.key);
    for (const list of taken.values())
      for (let index = list.length - 1; index >= 0; index--)
        if (list[index].key === item.key) list.splice(index, 1);
    const current: Line = { from: item.from, to: item.to, points: item.points };
    let best: { line: Line; total: number } | undefined;
    const options = cheapest(item, OTHERS);
    const scope = scopeOf(field, item.traveller);
    for (const option of [current, ...options.map((option) => option.line)]) {
      lay(item, option);
      if (option !== current && option.points.length > 2)
        (["a", "b"] as const).forEach((which) => spread(item, which));
      const line: Line = { from: item.from, to: item.to, points: item.points, off: option.off },
        met = price(scope, line.points);
      if (option !== current && met >= THROUGH) continue;
      const total = plain(item, line) + met + mark(item, others).hits * COVER;
      if (!best || total < best.total) best = { line, total };
    }
    lay(item, best!.line);
    if (!item.nested || item.points.length > 2)
      (["a", "b"] as const).forEach((which) => take(item, which));
    commit(item, mark(item, others).mine);
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
