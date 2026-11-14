import { type Box, distance, grow, overlaps, type Point, segmentHits } from "./scene.ts";
import { MARKER_LENGTH } from "./markers.ts";

/**
 * Geometry passes after ELK, shared by every diagram type: connections become single straight
 * segments wherever their two elements overlap across the line; markers (channel circles, interface
 * markers, decision diamonds) slide with their labels so their wires run straight; elements center
 * among their neighbours and in their free space; sideways steps spread over their free channel.
 * A change is kept only if it hits no element, marker or label, adds no crossing and crowds no wire.
 */

export interface Geometry {
  boxes: Map<string, Box>;
  routes: Map<string, Point[]>;
  nodeLabels: Map<string, Box[]>;
  edgeLabels: Map<string, Box>;
  /** ELK edge id to its source and target node. */
  ends: Map<string, [string, string]>;
  /** Drawn leaf elements that wires must not cross. */
  leaves: Set<string>;
  /** Channel circles and interface markers: tiny nodes wires attach to at the center. */
  markers: Set<string>;
  /** Corner radius of rounded shapes (storages); wires end on the curved outline. */
  round: Map<string, number>;
  /** Ancestors of each node, innermost first. */
  ancestors: Map<string, string[]>;
  /** Drawn containers; a wire may only cross the ones that hold one of its ends. */
  containers: Set<string>;
  /** Container title areas, which wires should not cross. */
  titles: Box[];
  /** The spacing ELK keeps between elements and between a wire and an element; moves keep it too. */
  spacing: { node: number; edge: number };
  /** The band each container keeps around its parts (its title on top): moved elements stay inside it. */
  insets?: Map<string, { top: number; side: number; bottom: number }>;
  /** Routes the passes must leave as they are (wires on fixed ports, self loops); they still count as obstacles. */
  pinned?: Set<string>;
  /** How far a wire's drawing reaches beyond its route on each side (the sides of a loop). */
  widths: Map<string, number>;
}

/**
 * Safety nets and fallbacks that fired while building one scene, by name: rules that should rarely be
 * needed. Layout code after ELK runs synchronously, so one collector at a time is enough.
 */
let fired: Map<string, number> | undefined;

export const collectFallbacks = (into: Map<string, number> | undefined) => {
  fired = into;
};

export const fallback = (name: string) => {
  fired?.set(name, (fired.get(name) ?? 0) + 1);
};

export type Axis = "x" | "y";

/** A container's inset along an axis: its title band on top, its padding elsewhere (6px when unknown). */
export const inner = (geometry: Geometry, container: string | undefined, axis: Axis) => {
  const inset = container ? geometry.insets?.get(container) : undefined;
  if (!inset) return { low: 6, high: 6 };
  return axis === "y"
    ? { low: inset.top, high: inset.bottom }
    : { low: inset.side, high: inset.side };
};

/** An arrowhead's length and half width (the markers in scene.ts), with a pixel of clearance. */
const HEAD = MARKER_LENGTH.arrow,
  HEAD_HALF = 5;

export const movable = (geometry: Geometry, edge: string) => !geometry.pinned?.has(edge);

/** Whether a node has a pinned wire: then it stays where it is. */
export const anchored = (geometry: Geometry, node: string) =>
  !!geometry.pinned?.size &&
  [...geometry.ends].some(([edge, ends]) => ends.includes(node) && geometry.pinned!.has(edge));

export const other = (axis: Axis): Axis => (axis === "x" ? "y" : "x");

export const size = (axis: Axis) => (axis === "x" ? "width" : "height");

/** The connections at a node, each with the node at its other end. */
export const edgesOf = (geometry: Geometry, id: string) =>
  [...geometry.ends]
    .filter(([, ends]) => ends.includes(id))
    .map(([edge, [source, target]]) => ({ edge, other: source === id ? target : source }));

/** Whether a route is one segment across the layout direction (`cross` is constant along it). */
export const straightAcross = (route: Point[], cross: Axis) =>
  route.length === 2 && Math.abs(route[0][cross] - route[1][cross]) < 0.5;

/** Wire ends per element side (the half of the element before or after its middle along `main`). */
export function endSides(geometry: Geometry, main: Axis) {
  const sideOf = (id: string, point: Point) => {
    const box = geometry.boxes.get(id)!;
    return `${id}|${point[main] <= box[main] + box[size(main)] / 2 ? "low" : "high"}`;
  };
  const sides = new Map<string, number>();
  for (const [edge, [source, target]] of geometry.ends) {
    const route = geometry.routes.get(edge);
    if (!route) continue;
    for (const [id, point] of [
      [source, route[0]],
      [target, route.at(-1)!],
    ] as const)
      if (geometry.boxes.has(id))
        sides.set(sideOf(id, point), (sides.get(sideOf(id, point)) ?? 0) + 1);
  }
  return { sides, sideOf };
}

/** Whether segment a-b (axis-aligned) passes through the open box. */
function crossing(a: Point, b: Point, c: Point, d: Point): boolean {
  const horizontal = (p: Point, q: Point) => Math.abs(p.y - q.y) < 0.5;
  const [h, v] =
    horizontal(a, b) && !horizontal(c, d)
      ? [
          [a, b],
          [c, d],
        ]
      : !horizontal(a, b) && horizontal(c, d)
        ? [
            [c, d],
            [a, b],
          ]
        : [null, null];
  if (!h || !v) return false;
  const x = v[0].x,
    y = h[0].y;
  return (
    x > Math.min(h[0].x, h[1].x) + 0.5 &&
    x < Math.max(h[0].x, h[1].x) - 0.5 &&
    y > Math.min(v[0].y, v[1].y) + 0.5 &&
    y < Math.max(v[0].y, v[1].y) - 0.5
  );
}

/**
 * Whether two axis-aligned segments run side by side closer than `gap` (or on top of each other)
 * along a shared stretch longer than `overlap`.
 */
export function runsAlong(a: Point, b: Point, c: Point, d: Point, gap = 6, overlap = 0): boolean {
  const vertical = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.5,
    horizontal = (p: Point, q: Point) => Math.abs(p.y - q.y) < 0.5;
  if (vertical(a, b) && vertical(c, d) && Math.abs(a.x - c.x) < gap)
    return (
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) >
      overlap
    );
  if (horizontal(a, b) && horizontal(c, d) && Math.abs(a.y - c.y) < gap)
    return (
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) >
      overlap
    );
  return false;
}

/** The straight pieces of a route, cached per route array like its box. */
const routeSegments = new WeakMap<Point[], (readonly [Point, Point])[]>();

export function segments(points: Point[]): (readonly [Point, Point])[] {
  let pieces = routeSegments.get(points);
  if (!pieces)
    routeSegments.set(
      points,
      (pieces = points.slice(1).map((point, index) => [points[index], point] as const)),
    );
  return pieces;
}

/**
 * The straight segment between two elements at `at` on `axis` (a line of constant x for 'x'),
 * or null when the elements do not overlap there or are not separated along the line.
 */
export function segment(
  geometry: Geometry,
  source: string,
  target: string,
  axis: Axis,
  at: number,
): Point[] | null {
  const s = geometry.boxes.get(source),
    t = geometry.boxes.get(target);
  if (!s || !t) return null;
  // Nested elements (a container and its part) keep ELK's route.
  if (
    geometry.ancestors.get(source)?.includes(target) ||
    geometry.ancestors.get(target)?.includes(source)
  )
    return null;
  const within = (id: string, box: Box) => {
    if (geometry.markers.has(id)) return Math.abs(box[axis] + box[size(axis)] / 2 - at) < 0.5;
    // On a rounded shape a wire meets the outline only where it is fairly flat (steepness up to about 40 degrees).
    const margin = geometry.round.has(id) ? Math.max(6, 0.4 * geometry.round.get(id)!) : 8;
    return (
      at >= box[axis] + Math.min(margin, box[size(axis)] / 2) &&
      at <= box[axis] + box[size(axis)] - Math.min(margin, box[size(axis)] / 2)
    );
  };
  if (!within(source, s) || !within(target, t)) return null;
  const along = other(axis),
    point = (value: number): Point => (axis === "x" ? { x: at, y: value } : { x: value, y: at });
  // Ends meet the real outline, which curves at the corners of rounded shapes.
  const meet = (id: string, box: Box, from: Point, to: Point) =>
    outline(to, from, box, geometry.round.get(id) ?? 0);
  const finish = (a: Point, b: Point) => [meet(source, s, b, a), meet(target, t, a, b)];
  if (s[along] + s[size(along)] <= t[along])
    return finish(point(s[along] + s[size(along)]), point(t[along]));
  if (t[along] + t[size(along)] <= s[along])
    return finish(point(s[along]), point(t[along] + t[size(along)]));
  return null;
}

/** Bounding box of a route, cached per route array (changed routes are new arrays, so stale boxes never apply). */
const routeBoxes = new WeakMap<Point[], Box>();

function boxOf(points: Point[]): Box {
  let box = routeBoxes.get(points);
  if (!box) routeBoxes.set(points, (box = spanBox(points)));
  return box;
}

export function spanBox(points: readonly Point[]): Box {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const { x, y } of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The stretches at both ends of a route where arrowheads are drawn, cached per route array. */
const routeHeads = new WeakMap<Point[], Box[]>();

function headsOf(route: Point[]): Box[] {
  let heads = routeHeads.get(route);
  if (!heads) {
    heads =
      route.length < 2
        ? []
        : (
            [
              [route[0], route[1]],
              [route.at(-1)!, route.at(-2)!],
            ] as const
          ).map(([tip, from]) => {
            const length = Math.hypot(from.x - tip.x, from.y - tip.y) || 1,
              reach = Math.min(HEAD, length);
            return grow(
              spanBox([
                tip,
                {
                  x: tip.x + ((from.x - tip.x) / length) * reach,
                  y: tip.y + ((from.y - tip.y) / length) * reach,
                },
              ]),
              HEAD_HALF,
            );
          });
    routeHeads.set(route, heads);
  }
  return heads;
}

/**
 * Whether a candidate route for edge `id` stays clear of everything else. Things whose bounding box
 * is far from the candidate are skipped with one box test, so a check costs about the number of
 * nearby objects rather than everything in the diagram.
 */
export function clear(
  geometry: Geometry,
  id: string,
  points: Point[],
  ignore: Set<string>,
  before: Point[] | null,
  throughContainers = false,
): boolean {
  const [source, target] = geometry.ends.get(id)!;
  const own = new Set([source, target, ...ignore]);
  const home = new Set([
    ...(geometry.ancestors.get(source) ?? []),
    ...(geometry.ancestors.get(target) ?? []),
    source,
    target,
  ]);
  // A wire drawn wider than its route keeps that much more clearance from everything.
  const width = geometry.widths.get(id) ?? 0;
  const reach = grow(boxOf(points), 10 + width);
  const near = (box: Box) => overlaps(reach, box);
  const pieces = segments(points);
  if (!throughContainers)
    for (const container of geometry.containers) {
      const box = grow(geometry.boxes.get(container)!, 4);
      if (!home.has(container) && near(box) && pieces.some(([a, b]) => segmentHits(a, b, box)))
        return false;
    }
  for (const group of [geometry.leaves, geometry.markers])
    for (const leaf of group) {
      if (own.has(leaf)) continue;
      const box = geometry.boxes.get(leaf);
      if (box && near(box) && pieces.some(([a, b]) => segmentHits(a, b, grow(box, 4 + width))))
        return false;
    }
  for (const [node, labels] of geometry.nodeLabels)
    if (
      !own.has(node) &&
      labels.some(
        (label) => near(label) && pieces.some(([a, b]) => segmentHits(a, b, grow(label, 2))),
      )
    )
      return false;
  if (
    geometry.titles.some(
      (title) => near(title) && pieces.some(([a, b]) => segmentHits(a, b, grow(title, 3))),
    )
  )
    return false;
  for (const [edge, label] of geometry.edgeLabels)
    if (edge !== id && near(label) && pieces.some(([a, b]) => segmentHits(a, b, grow(label, 2))))
      return false;
  // Wire ends carry arrowheads, drawn later: other wires keep off the last stretch of each end.
  for (const [edge, route] of geometry.routes) {
    if (edge === id || ignore.has(edge)) continue;
    for (const head of headsOf(route))
      if (near(head) && pieces.some(([a, b]) => segmentHits(a, b, head))) return false;
  }
  // Parallel wires closer than their drawn widths allow: a change may not crowd more pairs than the route it replaces.
  const crowding = (route: Point[]) => {
    const area = grow(boxOf(route), 10 + width + 8);
    let count = 0;
    for (const [edge, theirs] of geometry.routes) {
      if (edge === id || ignore.has(edge) || !overlaps(area, boxOf(theirs))) continue;
      const gap = 8 + width + (geometry.widths.get(edge) ?? 0);
      for (const [a, b] of segments(route))
        for (const [c, d] of segments(theirs)) if (runsAlong(a, b, c, d, gap, 0.5)) count++;
    }
    return count;
  };
  if (crowding(points) > (before ? crowding(before) : 0)) return false;
  if (!before) return true;
  // Never trade bends for crossings: compare against routes near either version.
  const area = grow(boxOf([...points, ...before]), 1);
  const nearBoth = [...geometry.routes]
    .filter(([edge, route]) => edge !== id && !ignore.has(edge) && overlaps(area, boxOf(route)))
    .map(([, route]) => segments(route));
  const count = (route: Point[]) =>
    segments(route).reduce(
      (sum, [a, b]) =>
        sum +
        nearBoth.reduce(
          (inner, theirs) => inner + theirs.filter(([c, d]) => crossing(a, b, c, d)).length,
          0,
        ),
      0,
    );
  return count(points) <= count(before);
}

/** Puts `points` in place of a route and moves its label along; restores `before` when no spot for the label is free. */
export function tryRoute(
  geometry: Geometry,
  id: string,
  points: Point[],
  before: Point[],
): boolean {
  const label = geometry.edgeLabels.get(id);
  geometry.routes.set(id, points);
  if (relabel(geometry, id, points)) return true;
  geometry.routes.set(id, before);
  if (label) geometry.edgeLabels.set(id, label);
  return false;
}

/** Moves the edge's label beside its new straight segment, or returns false if no side is free. */
export function relabel(geometry: Geometry, id: string, points: Point[]): boolean {
  const label = geometry.edgeLabels.get(id);
  if (!label) return true;
  // Beside the longest segment.
  const [a, b] = segments(points).reduce((best, item) =>
    Math.hypot(item[1].x - item[0].x, item[1].y - item[0].y) >
    Math.hypot(best[1].x - best[0].x, best[1].y - best[0].y)
      ? item
      : best,
  );
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    vertical = Math.abs(a.x - b.x) < 0.5,
    away = geometry.widths.get(id) ?? 0;
  const places = vertical
    ? [
        { x: mid.x + 6 + away, y: mid.y - label.height / 2 },
        { x: mid.x - 6 - away - label.width, y: mid.y - label.height / 2 },
      ]
    : [
        { x: mid.x - label.width / 2, y: mid.y - 4 - away - label.height },
        { x: mid.x - label.width / 2, y: mid.y + 4 + away },
      ];
  const [source, target] = geometry.ends.get(id)!;
  for (const place of places) {
    const box = { ...label, ...place };
    const blocked =
      [...geometry.leaves, ...geometry.markers].some((leaf) => {
        const other = geometry.boxes.get(leaf);
        return other && overlaps(grow(box, 2), other) && leaf !== source && leaf !== target;
      }) ||
      [...geometry.nodeLabels.values()].flat().some((other) => overlaps(grow(box, 2), other)) ||
      [...geometry.edgeLabels].some(
        ([edge, other]) => edge !== id && overlaps(grow(box, 2), other),
      ) ||
      [...geometry.routes].some(
        ([edge, route]) =>
          edge !== id && segments(route).some(([c, d]) => segmentHits(c, d, grow(box, 2))),
      );
    if (!blocked) {
      geometry.edgeLabels.set(id, box);
      return true;
    }
  }
  return false;
}

export function straightenRoute(geometry: Geometry, id: string, axis: Axis): boolean {
  const [source, target] = geometry.ends.get(id)!;
  // Both halves of a channel or connector meet its marker on one line, opposite each other.
  const hub = [source, target].find((end) => geometry.markers.has(end));
  const sibling = hub
    ? [...geometry.ends].find(([edge, ends]) => edge !== id && ends.includes(hub))?.[0]
    : undefined;
  if (sibling) {
    const other = geometry.routes.get(sibling)!,
      center = geometry.boxes.get(hub!)!;
    const near =
      Math.hypot(
        other[0].x - (center.x + center.width / 2),
        other[0].y - (center.y + center.height / 2),
      ) <
      Math.hypot(
        other.at(-1)!.x - (center.x + center.width / 2),
        other.at(-1)!.y - (center.y + center.height / 2),
      );
    const [p, q] = near ? [other[0], other[1]] : [other.at(-1)!, other.at(-2)!];
    if ((Math.abs(p.x - q.x) < 0.5 ? "x" : "y") !== axis) return false;
  }
  const route = geometry.routes.get(id)!;
  const s = geometry.boxes.get(source),
    t = geometry.boxes.get(target);
  if (!s || !t) return false;
  // Candidate lines: through a marker's center, else ELK's own segments, else the middle of the overlap.
  const low = Math.max(s[axis], t[axis]),
    high = Math.min(s[axis] + s[size(axis)], t[axis] + t[size(axis)]);
  const marker = [source, target].find((end) => geometry.markers.has(end));
  const candidates = marker
    ? [geometry.boxes.get(marker)![axis] + geometry.boxes.get(marker)![size(axis)] / 2]
    : [
        ...new Set([
          ...route.map((point) => point[axis]),
          (low + high) / 2,
          ...[1, 2, 3].flatMap((step) => [
            (low + high) / 2 - step * 10,
            (low + high) / 2 + step * 10,
          ]),
        ]),
      ].filter((at) => at > low && at < high);
  for (const at of candidates) {
    const points = segment(geometry, source, target, axis, at);
    if (!points || !clear(geometry, id, points, new Set(), route)) continue;
    if (tryRoute(geometry, id, points, route)) return true;
  }
  return false;
}

/** The wire into a channel marker and the wire out of it. */
export function halves(
  geometry: Geometry,
  marker: string,
): { inbound: string; outbound: string; source: string; target: string } | null {
  const edges = [...geometry.ends].filter(([, ends]) => ends.includes(marker));
  const inbound = edges.find(([, ends]) => ends[1] === marker),
    outbound = edges.find(([, ends]) => ends[0] === marker);
  return edges.length === 2 && inbound && outbound
    ? { inbound: inbound[0], outbound: outbound[0], source: inbound[1][0], target: outbound[1][1] }
    : null;
}

/** Replaces a route that bends more than its ends need with one of its `bendCandidates`. */
export function simplifyRoute(geometry: Geometry, id: string): boolean {
  const route = geometry.routes.get(id)!;
  return bendCandidates(route).some(
    (points) =>
      clear(geometry, id, points, new Set(), route) && tryRoute(geometry, id, points, route),
  );
}

/** A route from `start` to `end` that runs along `axis` at both ends, crossing over at `at`. */
export const zRoute = (start: Point, end: Point, axis: Axis, at: number): Point[] =>
  axis === "x"
    ? [start, { x: at, y: start.y }, { x: at, y: end.y }, end]
    : [start, { x: start.x, y: at }, { x: end.x, y: at }, end];

/**
 * Routes with fewer bends and the same ends: one bend (L) when the wire leaves and enters along
 * different axes, two (Z) when both ends run the same way, its middle at one of the route's own
 * bends or halfway.
 */
export function bendCandidates(route: Point[]): Point[][] {
  const start = route[0],
    end = route.at(-1)!,
    bends = route.length - 2;
  const horizontal = (p: Point, q: Point) => Math.abs(p.y - q.y) < 0.5;
  const first = horizontal(route[0], route[1]) ? "x" : "y",
    last = horizontal(route.at(-2)!, end) ? "x" : "y";
  const way = (p: Point, q: Point) =>
    `${Math.sign(Math.round(q.x - p.x))},${Math.sign(Math.round(q.y - p.y))}`;
  const result: Point[][] = [];
  if (first !== last && bends > 1)
    result.push([start, first === "x" ? { x: end.x, y: start.y } : { x: start.x, y: end.y }, end]);
  else if (first === last && bends > 2) {
    for (const at of new Set([
      ...route.slice(1, -1).map((point) => point[first]),
      (start[first] + end[first]) / 2,
    ])) {
      if ((at - start[first]) * (end[first] - at) < 0) continue;
      result.push(zRoute(start, end, first, at));
    }
  }
  // Same directions at both ends as before, or the wire would run through its shapes; no tiny jogs.
  return result.filter(
    (points) =>
      way(points[0], points[1]) === way(route[0], route[1]) &&
      way(points.at(-2)!, points.at(-1)!) === way(route.at(-2)!, route.at(-1)!) &&
      points.slice(1).every((point, index) => distance(points[index], point) >= 10),
  );
}

/**
 * Moves a wire end that lies on a rounded shape's bounding box onto its curved outline, along the
 * wire's last segment (from `from` toward `end`), so the line or arrowhead touches the shape.
 */
export function outline(end: Point, from: Point, box: Box, radius: number): Point {
  if (!radius) return end;
  const r = Math.min(radius, box.width / 2, box.height / 2);
  const left = box.x + r,
    right = box.x + box.width - r,
    top = box.y + r,
    bottom = box.y + box.height - r;
  const vertical = Math.abs(from.x - end.x) < 0.5;
  if (vertical) {
    const cx = end.x < left ? left : end.x > right ? right : null;
    if (cx === null) return end;
    const depth = r - Math.sqrt(Math.max(0, r * r - (end.x - cx) ** 2));
    return {
      x: end.x,
      y:
        end.y <= box.y + 0.5
          ? box.y + depth
          : end.y >= box.y + box.height - 0.5
            ? box.y + box.height - depth
            : end.y,
    };
  }
  const cy = end.y < top ? top : end.y > bottom ? bottom : null;
  if (cy === null) return end;
  const depth = r - Math.sqrt(Math.max(0, r * r - (end.y - cy) ** 2));
  return {
    x:
      end.x <= box.x + 0.5
        ? box.x + depth
        : end.x >= box.x + box.width - 0.5
          ? box.x + box.width - depth
          : end.x,
    y: end.y,
  };
}
