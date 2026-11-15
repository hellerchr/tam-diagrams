/**
 * TAM layout by hand, second step: the wires between the placed elements. Every pair of elements
 * gets the simplest line that passes no other element (straight, one corner, or two; a detour
 * around what is in the way where none of those is free), the wires that end on one side of an
 * element keep apart, and each channel's circle sits on its wire's longest run with its label
 * beside it.
 */

import { type Box, centerOf, grow, overlaps, type Point, segmentHits } from "./scene.ts";
import type { TamEdge } from "./tam.ts";
import type { Measure } from "./text.ts";
import { smallSize } from "./labels.ts";
import { outline } from "./route.ts";
import {
  ASSEMBLY,
  BULGE,
  CHANNEL,
  containerInsets,
  LOOP_END,
  MARKER_GAP,
  SHADOW,
  type TamGeometry,
  type TamGraph,
} from "./tam-graph.ts";
import { lies, type PlacedElements, type Side, sidePoint } from "./tam-placed.ts";
import { detour, type Line, outward } from "./tam-placed-detour.ts";

const SIDES: Side[] = ["bottom", "top", "right", "left"];

/** Where a side's line lies: the y of a top or bottom, the x of a left or right. */
const level = (box: Box, side: Side) =>
  side === "top"
    ? box.y
    : side === "bottom"
      ? box.y + box.height
      : side === "left"
        ? box.x
        : box.x + box.width;

/** How far a point lies outside a box, past one of its sides. */
const beyond = (box: Box, side: Side, point: Point) =>
  outward(side) * ((lies(side) ? point.y : point.x) - level(box, side));

/** Wire ends on one side keep this far apart; a corner keeps CLEAR from the elements it joins. */
const APART = 18,
  CLEAR = 12;

/** The least gap between two elements for a wire to step sideways in, and how far around them a wire runs. */
const STEP = 20,
  AROUND = 24;

/** A wire's run with a channel's circle or a label on it is at least this long. */
const ROOM = 44;

/**
 * What a line costs: a corner counts like BEND pixels of wire, an element in the way more than any
 * detour, a foreign container's border less. SHORT is a line too short for its circle, CROWDED a
 * side with more wire ends than fit.
 */
const BEND = 70,
  LENGTH = 0.25,
  THROUGH = 1000,
  ACROSS = 200,
  SHORT = 90,
  CROWDED = 120,
  OFF_MIDDLE = 150;

/** Where along a side a bent line may leave: the middle first. */
const SHARES = [0.5, 0.25, 0.75];

/** One end of a connection: an element with its box and the radius of its rounded corners. */
interface End {
  id: string;
  box: Box;
  radius: number;
}

/** The connections between one pair of elements run side by side as a bundle, along one line. */
interface Bundle extends Line {
  a: End;
  b: End;
  members: TamEdge[];
  /** One element holds the other: the wire runs inside it. */
  nested: boolean;
  /** Each member's distance from the bundle's line, to its left. */
  offsets: number[];
  /** Half of the room the bundle takes across. */
  half: number;
}

/** The part of a side wires end on: clear of the corners, and of the steep part of round ones. */
function range(end: End, side: Side): [number, number] {
  const start = lies(side) ? end.box.x : end.box.y,
    extent = lies(side) ? end.box.width : end.box.height;
  const inset = Math.min(
    extent / 4,
    end.radius ? Math.max(0.4 * Math.min(end.radius, extent / 2), 6) : 8,
  );
  return [start + inset, start + extent - inset];
}

const share = ([low, high]: [number, number], of: number) => low + (high - low) * of;

/** The lines two elements can be joined by with at most two corners; `part` is the one the other holds. */
function lines(a: End, b: End, part?: End): Line[] {
  const found: Line[] = [];
  if (part) {
    // From the border of the outer element straight in to its part, on the same side of both.
    for (const side of SIDES) {
      const at = share(range(part, side), 0.5);
      found.push({
        from: side,
        to: side,
        points: [sidePoint(a.box, side, at), sidePoint(b.box, side, at)],
      });
    }
    return found;
  }
  for (const from of SIDES)
    for (const to of SIDES) {
      const ra = range(a, from),
        rb = range(b, to);
      if (from !== to && lies(from) === lies(to)) {
        // Facing sides: straight where they overlap.
        const low = Math.max(ra[0], rb[0]),
          high = Math.min(ra[1], rb[1]);
        if (high >= low && outward(from) * (level(b.box, to) - level(a.box, from)) >= 0) {
          const at = (low + high) / 2;
          found.push({ from, to, points: [sidePoint(a.box, from, at), sidePoint(b.box, to, at)] });
        }
      }
      for (const sa of SHARES)
        for (const sb of SHARES) {
          const off = +(sa !== 0.5) + +(sb !== 0.5);
          const p = sidePoint(a.box, from, share(ra, sa)),
            q = sidePoint(b.box, to, share(rb, sb));
          if (lies(from) !== lies(to)) {
            // One corner, clear of both elements.
            const corner = lies(from) ? { x: p.x, y: q.y } : { x: q.x, y: p.y };
            if (beyond(a.box, from, corner) >= CLEAR && beyond(b.box, to, corner) >= CLEAR)
              found.push({ from, to, points: [p, corner, q], off });
            continue;
          }
          let mid: number;
          if (from !== to) {
            // Facing sides: a step in the gap between them.
            const gap = outward(from) * (level(b.box, to) - level(a.box, from));
            if (gap < STEP || Math.abs(share(ra, sa) - share(rb, sb)) < CLEAR) continue;
            mid = (level(a.box, from) + level(b.box, to)) / 2;
          } else {
            // The same side of both: around them.
            if (Math.abs(share(ra, sa) - share(rb, sb)) < CLEAR) continue;
            const far =
              outward(from) > 0
                ? Math.max(level(a.box, from), level(b.box, to))
                : Math.min(level(a.box, from), level(b.box, to));
            mid = far + outward(from) * AROUND;
          }
          found.push({
            from,
            to,
            points: lies(from)
              ? [p, { x: p.x, y: mid }, { x: q.x, y: mid }, q]
              : [p, { x: mid, y: p.y }, { x: mid, y: q.y }, q],
            off,
          });
        }
    }
  return found;
}

/** The longest run of a line; of equal ones a run between two corners. */
function longest(points: Point[]): number {
  let best = 0,
    most = -1;
  for (let index = 0; index < points.length - 1; index++) {
    const length =
      Math.abs(points[index + 1].x - points[index].x) +
      Math.abs(points[index + 1].y - points[index].y);
    // A run between corners wins a tie: a circle on it leaves the elements clear.
    const centered = index > 0 && index < points.length - 2 ? 0.5 : 0;
    if (length + centered > most) {
      most = length + centered;
      best = index;
    }
  }
  return best;
}

const runsUpright = (points: Point[], index: number) =>
  Math.abs(points[index].x - points[index + 1].x) < 0.5;

/** An orthogonal line moved `distance` to its left; a corner moves with both runs that meet at it. */
function beside(points: Point[], distance: number): Point[] {
  if (!distance) return points.map((point) => ({ ...point }));
  const normal = (from: Point, to: Point) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
  };
  return points.map((point, index) => {
    const before = index > 0 ? normal(points[index - 1], point) : { x: 0, y: 0 },
      after = index < points.length - 1 ? normal(point, points[index + 1]) : { x: 0, y: 0 };
    return {
      x: point.x + (before.x + after.x) * distance,
      y: point.y + (before.y + after.y) * distance,
    };
  });
}

/** The room a connection takes to either side of its wire: a loop's two lines, a circle. */
const thickness = (edge: TamEdge) =>
  edge.kind === "modify"
    ? LOOP_END + BULGE
    : edge.kind === "channel"
      ? CHANNEL / 2
      : edge.kind === "assembly"
        ? ASSEMBLY / 2
        : 0;

/** The wires, channel circles and label rooms of a layout placed by hand, added to the placed elements. */
export function placedGeometry(
  prepared: TamGraph,
  placed: PlacedElements,
  measure: Measure,
): TamGeometry {
  const { chain, channelLabels, diagram, shapes, vertical } = prepared;
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
  const circles = [...placed.stubs.keys()].flatMap((edge) => {
    const target = diagram.edges.find((item) => item.id === edge)?.target;
    return target && boxes.has(target) ? [{ id: target, box: boxes.get(target)! }] : [];
  });
  /** What a wire keeps out of: every element and interface circle but its ends and what holds them. */
  const obstacles = [
    ...elements.map((id) => ({ id, box: boxes.get(id)!, container: shapes.get(id)!.container })),
    ...circles.map((circle) => ({ ...circle, container: false })),
  ];
  const solid = obstacles.filter((obstacle) => !obstacle.container);
  // A container's title is crossed like a border: only where no other line is as simple.
  for (const id of elements) {
    const shape = shapes.get(id)!,
      box = boxes.get(id)!;
    if (!shape.container || !shape.lines.length) continue;
    const { top } = containerInsets(shape.node, shape.lines, shape.textWidth, measure);
    obstacles.push({
      id: `${id}#title`,
      box: {
        x: box.x + box.width / 2 - shape.textWidth / 2 - 4,
        y: box.y + 2,
        width: shape.textWidth + 8,
        height: top - 8,
      },
      container: true,
    });
  }

  // Connections between one pair of elements share a line.
  const bundles = new Map<string, Bundle>();
  for (const edge of diagram.edges) {
    if (edge.kind === "provided" || edge.kind === "required") continue;
    if (!boxes.has(edge.source) || !boxes.has(edge.target)) continue;
    const key = [edge.source, edge.target].toSorted().join("\u0000");
    const bundle = bundles.get(key);
    if (bundle) bundle.members.push(edge);
    else
      bundles.set(key, {
        a: end(edge.source),
        b: end(edge.target),
        members: [edge],
        from: "bottom",
        to: "top",
        points: [],
        nested:
          chain(edge.source).includes(edge.target) || chain(edge.target).includes(edge.source),
        offsets: [0],
        half: 0,
      });
  }
  const marked = (edge: TamEdge) =>
    edge.kind === "channel" || edge.kind === "assembly" || !!edge.label;

  /** The bundles that end on each side of each element, as they choose their lines. */
  const ends = new Map<string, Bundle[]>();
  const sideKey = (bundle: Bundle, which: "a" | "b", line: Line = bundle) =>
    `${bundle[which].id}\u0000${which === "a" ? line.from : line.to}`;

  /** What a line costs: elements in its way, corners, length, no room for a circle, a crowded side. */
  const cost = (bundle: Bundle, line: Line) => {
    const { points } = line,
      own = new Set([...chain(bundle.a.id), ...chain(bundle.b.id)]);
    let total = (points.length - 2) * BEND,
      most = 0;
    for (let index = 0; index < points.length - 1; index++) {
      const p = points[index],
        q = points[index + 1],
        length = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      total += length * LENGTH;
      most = Math.max(most, length);
      for (const obstacle of obstacles)
        if (
          !own.has(obstacle.id) &&
          segmentHits(p, q, grow(obstacle.box, obstacle.container ? 0 : 4))
        )
          total += obstacle.container ? ACROSS : THROUGH;
      // A line never runs through the elements it joins.
      if (!bundle.nested)
        for (const item of [bundle.a, bundle.b])
          if (segmentHits(p, q, grow(item.box, -1))) total += THROUGH;
    }
    if (line.from === line.to && !bundle.nested) total += BEND;
    // A line leaves the middle of a side unless something stands in its way there.
    total += (line.off ?? 0) * OFF_MIDDLE;
    if (most < ROOM && bundle.members.some(marked)) total += SHORT;
    // Of equal lines, the one that leaves along the diagram's direction.
    if (lies(line.from) !== vertical) total += 4;
    for (const which of ["a", "b"] as const) {
      const others = ends.get(sideKey(bundle, which, line)) ?? [];
      if (!others.length) continue;
      const [low, high] = range(bundle[which], which === "a" ? line.from : line.to);
      const needed =
        others.reduce((sum, other) => sum + 2 * other.half + APART, 0) +
        (bundle.members.length - 1) * APART;
      total += needed > high - low ? CROWDED : 12;
    }
    return total;
  };

  // Each bundle takes the cheapest line; near pairs choose first, so far ones leave by the sides still free.
  const span = (bundle: Bundle) => {
    const ca = centerOf(bundle.a.box),
      cb = centerOf(bundle.b.box);
    return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
  };
  for (const bundle of [...bundles.values()].toSorted((p, q) => span(p) - span(q))) {
    const part = !bundle.nested
      ? undefined
      : chain(bundle.a.id).includes(bundle.b.id)
        ? bundle.a
        : bundle.b;
    let best = Infinity,
      chosen: Line | undefined;
    const consider = (line: Line | undefined) => {
      const price = line ? cost(bundle, line) : Infinity;
      if (price < best) {
        best = price;
        chosen = line;
      }
    };
    lines(bundle.a, bundle.b, part).forEach(consider);
    // Something stands in every simple line's way: around it.
    if (best >= THROUGH && !bundle.nested)
      consider(
        detour(
          bundle.a.box,
          bundle.b.box,
          solid.filter((item) => item.id !== bundle.a.id && item.id !== bundle.b.id),
        ),
      );
    if (!chosen) {
      // The elements lie on each other: a line between their middles is all there is.
      const ca = centerOf(bundle.a.box),
        cb = centerOf(bundle.b.box),
        across = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y);
      chosen = {
        from: across ? (cb.x >= ca.x ? "right" : "left") : cb.y >= ca.y ? "bottom" : "top",
        to: across ? (cb.x >= ca.x ? "left" : "right") : cb.y >= ca.y ? "top" : "bottom",
        points: across
          ? [ca, { x: (ca.x + cb.x) / 2, y: ca.y }, { x: (ca.x + cb.x) / 2, y: cb.y }, cb]
          : [ca, { x: ca.x, y: (ca.y + cb.y) / 2 }, { x: cb.x, y: (ca.y + cb.y) / 2 }, cb],
      };
    }
    Object.assign(bundle, chosen);
    // Members keep apart by what each carries: a loop's width, a circle.
    const places = [0];
    for (let index = 1; index < bundle.members.length; index++)
      places.push(
        places[index - 1] +
          Math.max(
            APART,
            thickness(bundle.members[index - 1]) + thickness(bundle.members[index]) + 8,
          ),
      );
    // A bundle wider than the sides it ends on is pressed together to fit them.
    const sides = [range(bundle.a, bundle.from), range(bundle.b, bundle.to)],
      room = Math.min(...sides.map(([low, high]) => high - low)),
      width = places.at(-1)!,
      press = width > room && width > 0 ? Math.max(room, (places.length - 1) * 6) / width : 1;
    bundle.offsets = places.map((place) => (place - width / 2) * press);
    bundle.half = (width * press) / 2 + Math.max(...bundle.members.map(thickness)) / 2;
    for (const which of ["a", "b"] as const) {
      const key = sideKey(bundle, which);
      ends.set(key, [...(ends.get(key) ?? []), bundle]);
    }
  }

  // Wire ends on one side of an element keep apart: straight lines stay, the others move along the side.
  const taken = new Map<string, { at: number; half: number }[]>();
  const at = (bundle: Bundle, which: "a" | "b") => {
    const point = which === "a" ? bundle.points[0] : bundle.points.at(-1)!;
    return lies(which === "a" ? bundle.from : bundle.to) ? point.x : point.y;
  };
  const take = (bundle: Bundle, which: "a" | "b") => {
    const list = taken.get(sideKey(bundle, which)) ?? [];
    taken.set(sideKey(bundle, which), list);
    list.push({ at: at(bundle, which), half: bundle.half });
  };
  const bent = [...bundles.values()].filter((bundle) => bundle.points.length > 2);
  for (const bundle of bundles.values())
    if (bundle.points.length === 2 && !bundle.nested)
      (["a", "b"] as const).forEach((which) => take(bundle, which));
  for (const which of ["a", "b"] as const) {
    // Nearest first: a wire to a near element keeps the middle, wires to far ones leave beside it.
    const far = (bundle: Bundle) => {
      const other = centerOf(bundle[which === "a" ? "b" : "a"].box),
        side = which === "a" ? bundle.from : bundle.to;
      return (lies(side) ? other.x : other.y) - at(bundle, which);
    };
    for (const bundle of bent.toSorted((p, q) => Math.abs(far(p)) - Math.abs(far(q)))) {
      const side = which === "a" ? bundle.from : bundle.to,
        [low, high] = range(bundle[which], side),
        others = taken.get(sideKey(bundle, which)) ?? [];
      const free = (spot: number) =>
        others.every((other) => Math.abs(other.at - spot) >= other.half + bundle.half + APART / 2);
      const toward = Math.sign(far(bundle)) || 1,
        start = at(bundle, which);
      let found: number | undefined;
      for (let step = 0; found === undefined && step <= high - low; step += 3)
        for (const spot of [start + toward * step, start - toward * step])
          if (found === undefined && spot >= low && spot <= high && free(spot)) found = spot;
      if (found !== undefined && found !== start) {
        // The end moves along its side with the run that leaves it.
        const axis = lies(side) ? "x" : "y",
          [first, second] =
            which === "a" ? [0, 1] : [bundle.points.length - 1, bundle.points.length - 2];
        bundle.points = bundle.points.map((point, index) =>
          index === first || index === second ? { ...point, [axis]: found } : point,
        );
      }
      take(bundle, which);
    }
  }

  const markers = new Set(circles.map((circle) => circle.id));
  /** What a circle or label keeps off: the elements, and the circles and labels placed before it. */
  const occupied: Box[] = obstacles
    .filter((item) => !item.container || item.id.endsWith("#title"))
    .map((item) => item.box);
  const covered = (box: Box) => occupied.filter((other) => overlaps(box, other, 1)).length;
  for (const bundle of bundles.values()) {
    const center = bundle.points,
      host = longest(center),
      up = runsUpright(center, host);
    /** A point on the host run of a line, `share` of the way along it. */
    const along = (points: Point[], share: number): Point => ({
      x: points[host].x + (points[host + 1].x - points[host].x) * share,
      y: points[host].y + (points[host + 1].y - points[host].y) * share,
    });
    const length =
      Math.abs(center[host + 1].x - center[host].x) + Math.abs(center[host + 1].y - center[host].y);
    const count = bundle.members.length;
    bundle.members.forEach((edge, index) => {
      let points = beside(center, bundle.offsets[index]);
      // Circles and labels of a bundle stand along its run one after the other where it is long
      // enough; a single wire's stand in the middle, or off it where the middle is taken.
      const shares =
        count > 1
          ? [length >= count * ROOM ? (index + 1) / (count + 1) : 0.5]
          : length >= 3 * ROOM
            ? [0.5, 0.35, 0.65, 0.22, 0.78]
            : [0.5];
      // The outer wires of a bundle carry their labels on their outer side; a single wire's stand where there is room.
      const off = along(points, 0.5)[up ? "x" : "y"] - along(center, 0.5)[up ? "x" : "y"],
        outer = count > 1 && Math.abs(off) > 0.5 ? Math.sign(off) : 0,
        sides = outer ? [outer] : count > 1 ? [0] : [0, -1, 1];
      // Every end on a rounded shape meets its curved outline.
      const ends = [
        outline(points[0], points[1], bundle.a.box, bundle.nested ? 0 : bundle.a.radius),
        outline(points.at(-1)!, points.at(-2)!, bundle.b.box, bundle.nested ? 0 : bundle.b.radius),
      ];
      const mark = edge.kind === "channel" || edge.kind === "assembly",
        size = !mark ? 0 : edge.kind === "assembly" ? ASSEMBLY : CHANNEL,
        labels = mark ? channelLabels(edge, up) : [];
      /** The circle and the rooms beside it at a spot, with everything on `side` of the wire (0: as ELK has it). */
      const rooms = (spot: Point, side: number): Box[] => {
        if (!mark) {
          if (!edge.label) return [];
          // A label stands beside the run: right of one that runs up or down, above one across.
          const { width, height } = smallSize(edge.label, measure),
            half = thickness(edge);
          return [
            up
              ? {
                  x: side < 0 ? spot.x - half - 6 - width : spot.x + half + 6,
                  y: spot.y - height / 2,
                  width,
                  height,
                }
              : {
                  x: spot.x - width / 2,
                  y: side > 0 ? spot.y + half + 4 : spot.y - half - 4 - height,
                  width,
                  height,
                },
          ];
        }
        const box = { x: spot.x - size / 2, y: spot.y - size / 2, width: size, height: size };
        // Beside an upright wire everything stands in one room, right of it or left; at a wire across,
        // the label above and the marker below, or both on one side.
        let above = box.y - MARKER_GAP,
          below = box.y + size + MARKER_GAP;
        const found: Box[] = [];
        // On one side the marker stands next to the circle and the label beyond it.
        const order = labels.map((_, at) => at);
        if (side && !edge.protocol) order.reverse();
        for (const at of order) {
          const where = labels[at].layoutOptions?.["elk.nodeLabels.placement"] ?? "",
            width = labels[at].width!,
            height = labels[at].height!;
          if (where.includes("H_RIGHT")) {
            found[at] = {
              x: side < 0 ? box.x - MARKER_GAP - width : box.x + size + MARKER_GAP,
              y: spot.y - height / 2,
              width,
              height,
            };
            continue;
          }
          const over = side && !edge.protocol ? side < 0 : where.includes("V_TOP");
          found[at] = { x: spot.x - width / 2, y: over ? above - height : below, width, height };
          if (over) above -= height + 2;
          else below += height + 2;
        }
        return [...found, box];
      };
      let best: { spot: Point; rooms: Box[]; cost: number } | undefined;
      for (const share of shares)
        for (const side of sides) {
          const spot = along(points, share),
            taken = rooms(spot, side),
            cost = taken.reduce((sum, box) => sum + covered(box), 0);
          if (!best || cost < best.cost) best = { spot, rooms: taken, cost };
          if (!cost) break;
        }
      const { spot } = best!;
      occupied.push(...best!.rooms);
      points[0] = ends[0];
      points[points.length - 1] = ends[1];
      let cut = host;
      if (edge.source !== bundle.a.id) {
        points = points.toReversed();
        cut = points.length - 2 - host;
      }
      if (mark) {
        // The circle sits on the longest run, its label and marker beside it.
        const id = `${edge.id}#node`;
        boxes.set(id, best!.rooms.at(-1)!);
        markers.add(id);
        upright.set(id, up);
        routes.set(`${edge.id}:a`, [...points.slice(0, cut + 1), spot]);
        routes.set(`${edge.id}:b`, [spot, ...points.slice(cut + 1)]);
        if (labels.length) nodeLabels.set(id, best!.rooms.slice(0, -1));
        return;
      }
      routes.set(edge.id, points);
      if (edge.label) edgeLabels.set(edge.id, best!.rooms[0]);
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
