/** Geometry passes that straighten wires: unfold detours, shortcut bends, slide markers, align protocols and delegations. */

import {
  anchored,
  type Axis,
  clear,
  endsSquare,
  fallback,
  type Geometry,
  halves,
  meetsSquare,
  movable,
  other,
  segment,
  segments,
  simplifyRoute,
  size,
  straightenRoute,
  tryRoute,
  zRoute,
} from "./route.ts";
import { type Box, grow, overlaps, type Point, segmentHits, simplifyPath } from "./scene.ts";

export function straighten(geometry: Geometry, vertical: boolean) {
  const main: Axis = vertical ? "y" : "x";
  const markers = [...geometry.markers].filter((marker) => !anchored(geometry, marker)),
    ids = [...geometry.routes.keys()].filter((id) => movable(geometry, id));
  for (const marker of markers) unfold(geometry, marker, main);
  // Joining a channel's halves can leave a wire running along its element's side into its end.
  for (const id of ids) squareEnds(geometry, id);
  for (const id of ids) shortcut(geometry, id);
  for (const id of ids) clearTitles(geometry, id);
  for (let pass = 0; pass < 2; pass++) settle(geometry, markers, ids, main);
}

/** One round of settling: markers slide and center, then every wire takes the straightest route it can. */
function settle(geometry: Geometry, markers: string[], ids: string[], main: Axis) {
  for (const marker of markers) slideMarker(geometry, marker, main);
  for (const marker of markers) centerMarker(geometry, marker, main);
  for (const id of ids) straightest(geometry, id, main);
}

/** Along the layout direction first, then across it for elements side by side; else as few bends as the ends allow. */
function straightest(geometry: Geometry, id: string, main: Axis) {
  if (geometry.routes.get(id)!.length <= 2) return;
  straightenRoute(geometry, id, other(main)) ||
    straightenRoute(geometry, id, main) ||
    simplifyRoute(geometry, id);
}

/** A route that runs along a side of an element into its end meets that side square instead, where it can. */
function squareEnds(geometry: Geometry, id: string) {
  const [source, target] = geometry.ends.get(id)!;
  const route = geometry.routes.get(id)!;
  const ended = squaredEnd(route, geometry.boxes.get(target)),
    points = squaredEnd(ended.toReversed(), geometry.boxes.get(source)).toReversed();
  if (points.length === route.length && endsSquare(geometry, id, route)) return;
  if (clear(geometry, id, points, new Set(), route)) tryRoute(geometry, id, points, route);
}

/** A route whose last segment runs along a side of `box`, with its last bend moved so it meets the side square. */
function squaredEnd(route: Point[], box: Box | undefined): Point[] {
  if (!box || route.length < 3) return route;
  const [p, q, end] = route.slice(-3);
  if (meetsSquare(end, q, box)) return route;
  const corner = Math.abs(q.x - end.x) < 0.5 ? { x: p.x, y: end.y } : { x: end.x, y: p.y };
  return simplifyPath([...route.slice(0, -2), corner, end]);
}

/**
 * Whether a marker's box or its labels, at their new place, would come within 3 of another shape or
 * marker in `others`, another label, or a route that `skip` does not exempt.
 */
function markerBlocked(
  geometry: Geometry,
  marker: string,
  items: Box[],
  others: string[],
  skip: (edge: string) => boolean,
): boolean {
  return items.some((item) => {
    const room = grow(item, 3);
    return (
      others.some((id) => overlaps(room, geometry.boxes.get(id)!)) ||
      [...geometry.nodeLabels].some(
        ([id, list]) => id !== marker && list.some((label) => overlaps(room, label)),
      ) ||
      [...geometry.edgeLabels.values()].some((label) => overlaps(room, label)) ||
      [...geometry.routes].some(
        ([edge, route]) => !skip(edge) && segments(route).some(([c, d]) => segmentHits(c, d, room)),
      )
    );
  });
}

/** Slides a channel or interface marker across the layout direction so every wire at it runs straight. */
export function slideMarker(
  geometry: Geometry,
  marker: string,
  main: Axis,
  wanted?: number[],
): boolean {
  const axis = other(main);
  const edges = [...geometry.ends]
    .filter(([, ends]) => ends.includes(marker))
    .map(([edge]) => edge);
  if (!edges.length || (!wanted && edges.every((edge) => geometry.routes.get(edge)!.length <= 2)))
    return false;
  const box = geometry.boxes.get(marker)!,
    center = box[axis] + box[size(axis)] / 2;
  // The marker must sit where every element it connects to overlaps.
  let low = -Infinity,
    high = Infinity;
  for (const edge of edges) {
    const end = geometry.ends.get(edge)!.find((node) => node !== marker)!,
      other = geometry.boxes.get(end)!;
    const margin = geometry.round.has(end) ? Math.max(6, 0.4 * geometry.round.get(end)!) : 8;
    low = Math.max(low, other[axis] + margin);
    high = Math.min(high, other[axis] + other[size(axis)] - margin);
  }
  if (low > high) return false;
  const middle = (low + high) / 2;
  const candidates = wanted
    ? wanted.filter((at) => at >= low && at <= high)
    : [
        Math.min(Math.max(center, low), high),
        middle,
        ...[1, 2, 3, 4]
          .flatMap((step) => [middle - step * 12, middle + step * 12])
          .filter((at) => at >= low && at <= high),
      ];
  const labels = geometry.nodeLabels.get(marker) ?? [];
  const routes = new Map(edges.map((edge) => [edge, geometry.routes.get(edge)!]));
  for (const at of candidates) {
    const shift = at - center;
    const moved = (item: Box): Box => ({ ...item, [axis]: item[axis] + shift });
    const place = moved(box),
      placed = labels.map(moved);
    // The marker and its labels must land on free space.
    const others = [...geometry.leaves, ...geometry.markers].filter(
      (id) => id !== marker && !edges.some((edge) => geometry.ends.get(edge)!.includes(id)),
    );
    if (markerBlocked(geometry, marker, [place, ...placed], others, (edge) => routes.has(edge)))
      continue;
    geometry.boxes.set(marker, place);
    geometry.nodeLabels.set(marker, placed);
    const straight = edges.map((edge) => {
      const [source, target] = geometry.ends.get(edge)!;
      return segment(geometry, source, target, axis, at);
    });
    const ignore = new Set(edges);
    if (
      straight.every(
        (points, index) =>
          points && clear(geometry, edges[index], points, ignore, routes.get(edges[index])!),
      )
    ) {
      straight.forEach((points, index) => geometry.routes.set(edges[index], points!));
      return true;
    }
    geometry.boxes.set(marker, box);
    geometry.nodeLabels.set(marker, labels);
  }
  return false;
}

/**
 * Moves a marker across the layout direction to `at`: its half toward `near` runs straight, the other half
 * takes one sideways step (a Z) to its unchanged far end. Undone unless both halves are clear.
 */
export function slideIntoContainer(
  geometry: Geometry,
  marker: string,
  main: Axis,
  at: number,
  near: string,
): boolean {
  const parts = halves(geometry, marker);
  if (!parts) return false;
  const axis = other(main),
    box = geometry.boxes.get(marker)!,
    center = box[axis] + box[size(axis)] / 2,
    shift = at - center;
  const [close, far] =
    parts.source === near ? [parts.inbound, parts.outbound] : [parts.outbound, parts.inbound];
  const routes = new Map([
      [close, geometry.routes.get(close)!],
      [far, geometry.routes.get(far)!],
    ]),
    labels = geometry.nodeLabels.get(marker) ?? [];
  const moved = (item: Box): Box => ({ ...item, [axis]: item[axis] + shift });
  geometry.boxes.set(marker, moved(box));
  geometry.nodeLabels.set(marker, labels.map(moved));
  const undo = () => {
    geometry.boxes.set(marker, box);
    geometry.nodeLabels.set(marker, labels);
    for (const [edge, route] of routes) geometry.routes.set(edge, route);
    return false;
  };
  const [source, target] = geometry.ends.get(close)!,
    straight = segment(geometry, source, target, axis, at);
  if (!straight) return undo();
  // The far half: from the marker's far side to where it ends now, with one step across in between.
  const old = routes.get(far)!,
    startsAtMarker = geometry.ends.get(far)![0] === marker,
    end = startsAtMarker ? old.at(-1)! : old[0];
  const placed = geometry.boxes.get(marker)!,
    down = end[main] > placed[main] + placed[size(main)] / 2;
  const from: Point = {
    [axis]: at,
    [main]: down ? placed[main] + placed[size(main)] : placed[main],
  } as unknown as Point;
  const levels = [
    ...new Set([...old.map((point) => point[main]), (from[main] + end[main]) / 2]),
  ].filter(
    (level) =>
      Math.abs(level - from[main]) >= 10 &&
      Math.abs(end[main] - level) >= 10 &&
      (level - from[main]) * (end[main] - level) > 0,
  );
  const point = (alongMain: number, across: number): Point =>
    ({ [main]: alongMain, [axis]: across }) as unknown as Point;
  const candidates =
    Math.abs(end[axis] - at) < 0.5
      ? [[from, end]]
      : levels.map((level) => [from, point(level, at), point(level, end[axis]), end]);
  const ignore = new Set([close, far]);
  geometry.routes.set(close, straight);
  if (!clear(geometry, close, straight, ignore, routes.get(close)!)) return undo();
  // Clear of container titles if possible; else through one, which its halo interrupts (as for delegations).
  const titles = geometry.titles;
  for (const avoid of [true, false]) {
    geometry.titles = avoid ? titles : [];
    for (const candidate of candidates) {
      const points = startsAtMarker ? candidate : candidate.toReversed();
      if (clear(geometry, far, points, ignore, old)) {
        geometry.titles = titles;
        geometry.routes.set(far, points);
        return true;
      }
    }
  }
  geometry.titles = titles;
  return undo();
}

/**
 * Moves a channel marker along its wires to `center` on the layout axis: the wire's segments at the
 * circle run along that axis and just get longer or shorter. Returns whether the move was clean.
 */
function moveAlong(geometry: Geometry, marker: string, main: Axis, center: number): boolean {
  const parts = halves(geometry, marker);
  if (!parts) return false;
  const { inbound, outbound, source, target } = parts;
  const a = geometry.routes.get(inbound)!,
    b = geometry.routes.get(outbound)!;
  const cross = other(main),
    box = geometry.boxes.get(marker)!,
    half = box[size(main)] / 2,
    current = box[main] + half;
  const shift = center - current;
  if (Math.abs(shift) < 0.5) return true;
  // The segments touching the circle must lie on the layout axis through its center.
  const along = (p: Point, q: Point) => Math.abs(p[cross] - q[cross]) < 0.5;
  if (!along(a.at(-2)!, a.at(-1)!) || !along(b[0], b[1])) return false;
  const nextA = a.map((point, index) =>
    index === a.length - 1 ? { ...point, [main]: point[main] + shift } : point,
  );
  const nextB = b.map((point, index) =>
    index === 0 ? { ...point, [main]: point[main] + shift } : point,
  );
  // Both segments keep their direction and some length.
  const keeps = (p: Point, q: Point, before: number) =>
    Math.sign(q[main] - p[main]) === Math.sign(before) && Math.abs(q[main] - p[main]) >= 6;
  if (
    !keeps(nextA.at(-2)!, nextA.at(-1)!, a.at(-1)![main] - a.at(-2)![main]) ||
    !keeps(nextB[0], nextB[1], b[1][main] - b[0][main])
  )
    return false;
  const moved = (item: Box): Box => ({ ...item, [main]: item[main] + shift });
  const labels = geometry.nodeLabels.get(marker) ?? [];
  const place = moved(box),
    placed = labels.map(moved);
  const others = [...geometry.leaves, ...geometry.markers].filter(
    (id) => id !== marker && id !== source && id !== target,
  );
  if (
    markerBlocked(
      geometry,
      marker,
      [place, ...placed],
      others,
      (edge) => edge === inbound || edge === outbound,
    )
  )
    return false;
  const ignore = new Set([inbound, outbound]);
  if (
    !clear(geometry, inbound, nextA, ignore, null) ||
    !clear(geometry, outbound, nextB, ignore, null)
  )
    return false;
  geometry.boxes.set(marker, place);
  geometry.nodeLabels.set(marker, placed);
  geometry.routes.set(
    inbound,
    nextA.map((point, index) =>
      index === nextA.length - 1
        ? { ...point, [main]: center - Math.sign(b[1][main] - b[0][main] || 1) * half }
        : point,
    ),
  );
  geometry.routes.set(
    outbound,
    nextB.map((point, index) =>
      index === 0
        ? { ...point, [main]: center + Math.sign(b[1][main] - b[0][main] || 1) * half }
        : point,
    ),
  );
  return true;
}

/** Puts a channel circle (with its marker and label) halfway along a straight connection. */
function centerMarker(geometry: Geometry, marker: string, main: Axis) {
  const parts = halves(geometry, marker);
  if (!parts) return;
  const a = geometry.routes.get(parts.inbound)!,
    b = geometry.routes.get(parts.outbound)!,
    cross = other(main);
  if (a.length !== 2 || b.length !== 2 || Math.abs(a[0][cross] - b[1][cross]) > 0.5) return;
  // Halfway between the elements as seen from the circle: a container border on the way counts as the end.
  const box = geometry.boxes.get(marker)!,
    center = box[main] + box[size(main)] / 2;
  const boundary = (end: Point, node: string) => {
    let value = end[main];
    for (const container of geometry.ancestors.get(node) ?? []) {
      if (
        geometry.ancestors.get(marker)?.includes(container) ||
        !geometry.containers.has(container)
      )
        continue;
      const frame = geometry.boxes.get(container)!,
        near = end[main] < center ? frame[main] + frame[size(main)] : frame[main];
      if (Math.abs(near - center) < Math.abs(value - center)) value = near;
    }
    return value;
  };
  moveAlong(
    geometry,
    marker,
    main,
    (boundary(a[0], parts.source) + boundary(b[1], parts.target)) / 2,
  );
}

/**
 * Channels that share a protocol move onto one level along their wires where they can, so their
 * protocol boundary is one straight line; the most common level wins.
 */
export function alignProtocols(geometry: Geometry, groups: string[][], vertical: boolean) {
  const main: Axis = vertical ? "y" : "x";
  const level = (marker: string) => {
    const box = geometry.boxes.get(marker)!;
    return box[main] + box[size(main)] / 2;
  };
  for (const group of groups) {
    const markers = group.filter((marker) => geometry.boxes.has(marker));
    const same = (a: number, b: number) => Math.abs(a - b) < 1;
    // Try each level, most shared first; keep the first that aligns every channel, else the best tried.
    const levels = markers
      .map(level)
      .filter((value, index, all) => all.findIndex((other) => same(other, value)) === index);
    levels.sort(
      (a, b) =>
        markers.filter((m) => same(level(m), b)).length -
        markers.filter((m) => same(level(m), a)).length,
    );
    for (const target of levels) {
      for (const marker of markers)
        if (Math.abs(level(marker) - target) > 0.01) moveAlong(geometry, marker, main, target);
      if (markers.every((marker) => same(level(marker), target))) break;
    }
  }
}

/**
 * A delegation continues the connector that reaches its container: where an assembly connector or
 * channel arrives at the container's border, the delegation starts at that point and runs straight
 * to the part. The arriving connector slides (with its marker) onto the part's line if needed.
 */
export function alignDelegations(
  geometry: Geometry,
  delegations: [string, string, string][],
  vertical: boolean,
) {
  const main: Axis = vertical ? "y" : "x",
    axis = other(main);
  for (const [id, container, part] of delegations) {
    const c = geometry.boxes.get(container),
      p = geometry.boxes.get(part);
    if (!c || !p || !geometry.routes.has(id)) continue;
    // Connections that end on the container from outside it.
    const inside = (node: string) =>
      node === container || geometry.ancestors.get(node)?.includes(container);
    const arriving = [...geometry.ends].filter(
      ([edge, [source, target]]) =>
        edge !== id &&
        (source === container || target === container) &&
        !inside(source === container ? target : source),
    );
    // Already continuing a connector (ELK laid both out through one border port): nothing to do.
    const own = geometry.routes.get(id)!;
    if (
      own.length === 2 &&
      arriving.some(([edge, [source]]) => {
        const route = geometry.routes.get(edge)!,
          end = source === container ? route[0] : route.at(-1)!;
        return Math.hypot(end.x - own[0].x, end.y - own[0].y) < 1;
      })
    )
      continue;
    const middle = p[axis] + p[size(axis)] / 2;
    const wanted = [
      middle,
      ...[1, 2, 3].flatMap((step) => [middle - step * 10, middle + step * 10]),
    ].filter((at) => at > p[axis] + 8 && at < p[axis] + p[size(axis)] - 8);
    // Positions on the part's line: where the connector already arrives, then the part's middle and nearby.
    const done = arriving.some(([edge, [source, target]]) => {
      const outside = source === container ? target : source,
        route = geometry.routes.get(edge)!;
      const end = source === container ? route[0] : route.at(-1)!;
      const current =
        route.length === 2 && end[axis] > p[axis] + 8 && end[axis] < p[axis] + p[size(axis)] - 8
          ? [end[axis]]
          : [];
      const delegate = (at: number, titles: boolean) => {
        const entry =
          geometry.routes.get(edge)![
            source === container ? 0 : geometry.routes.get(edge)!.length - 1
          ];
        const facing = entry[main] <= p[main] ? p[main] : p[main] + p[size(main)];
        const point = (value: number): Point =>
          main === "y" ? { x: at, y: value } : { x: value, y: at };
        const points = [point(entry[main]), point(facing)];
        const saved = geometry.titles;
        if (!titles) geometry.titles = [];
        const ok = clear(geometry, id, points, new Set([edge]), null);
        geometry.titles = saved;
        if (ok) geometry.routes.set(id, points);
        return ok;
      };
      // Bring the connector onto a position: already there, by sliding its marker, or by straightening its wire.
      const reach = (at: number) => {
        const now = geometry.routes.get(edge)!,
          tip = source === container ? now[0] : now.at(-1)!;
        if (now.length === 2 && Math.abs(tip[axis] - at) < 0.5) return true;
        if (geometry.markers.has(outside)) return slideMarker(geometry, outside, main, [at]);
        const points = segment(geometry, source, target, axis, at);
        if (points && clear(geometry, edge, points, new Set([id]), now)) {
          geometry.routes.set(edge, points);
          return true;
        }
        return false;
      };
      for (const titles of [true, false]) {
        for (const at of [...current, ...wanted]) {
          const saved = {
            route: geometry.routes.get(edge)!,
            box: geometry.markers.has(outside) ? geometry.boxes.get(outside) : undefined,
            labels: geometry.nodeLabels.get(outside),
          };
          if (reach(at) && delegate(at, titles)) return true;
          geometry.routes.set(edge, saved.route);
          if (saved.box) {
            geometry.boxes.set(outside, saved.box);
            if (saved.labels) geometry.nodeLabels.set(outside, saved.labels);
          }
        }
      }
      // No straight line possible: the delegation still starts where the connector arrives and turns to the part.
      fallback("delegation-bent");
      const arrived = geometry.routes.get(edge)!,
        entry = source === container ? arrived[0] : arrived.at(-1)!;
      const facing = entry[main] <= p[main] ? p[main] : p[main] + p[size(main)];
      const depth = entry[main] + (facing - entry[main]) * 0.5;
      for (const at of [
        Math.min(Math.max(entry[axis], p[axis] + 12), p[axis] + p[size(axis)] - 12),
        ...wanted,
      ]) {
        const point = (mainValue: number, crossValue: number): Point =>
          main === "y" ? { x: crossValue, y: mainValue } : { x: mainValue, y: crossValue };
        const points =
          Math.abs(at - entry[axis]) < 0.5
            ? [point(entry[main], at), point(facing, at)]
            : [
                point(entry[main], entry[axis]),
                point(depth, entry[axis]),
                point(depth, at),
                point(facing, at),
              ];
        for (const titles of [true, false]) {
          const saved = geometry.titles;
          if (!titles) geometry.titles = [];
          const ok = clear(geometry, id, points, new Set([edge]), null);
          geometry.titles = saved;
          if (ok) {
            geometry.routes.set(id, points);
            return true;
          }
        }
      }
      return false;
    });
    void done;
  }
}

/**
 * When ELK reverses half of a channel or connector to break a cycle, both halves can leave the circle
 * on the same side, so one wire runs back over the other. The halves are then joined into one path,
 * the U-turn is removed, and the circle moves to the middle of the path's longest free segment along
 * the layout direction.
 */
function unfold(geometry: Geometry, marker: string, main: Axis) {
  const parts = halves(geometry, marker);
  if (!parts) return;
  const a = geometry.routes.get(parts.inbound)!,
    b = geometry.routes.get(parts.outbound)!;
  const into = { x: Math.sign(a.at(-1)!.x - a.at(-2)!.x), y: Math.sign(a.at(-1)!.y - a.at(-2)!.y) };
  const out = { x: Math.sign(b[1].x - b[0].x), y: Math.sign(b[1].y - b[0].y) };
  // A wire that arrives moving one way and leaves moving back the opposite way has folded.
  if (into.x !== -out.x || into.y !== -out.y) return;
  const box = geometry.boxes.get(marker)!,
    cross = other(main),
    half = box[size(main)] / 2;
  // One path from source to target without the detour through the circle: drop the points where the
  // halves touch it, join the rest with a corner, then remove back-tracking and straight-through points.
  const head = a.slice(0, -1),
    tail = b.slice(1),
    last = head.at(-1)!,
    first = tail[0];
  const joint =
    Math.abs(last.x - first.x) < 0.5 || Math.abs(last.y - first.y) < 0.5
      ? []
      : [main === "y" ? { x: last.x, y: first.y } : { x: first.x, y: last.y }];
  const path: Point[] = [];
  for (const point of [...head, ...joint, ...tail]) {
    path.push({ ...point });
    while (path.length >= 3) {
      const [p, q, r] = path.slice(-3);
      const collinear =
        (Math.abs(p.x - q.x) < 0.5 && Math.abs(q.x - r.x) < 0.5) ||
        (Math.abs(p.y - q.y) < 0.5 && Math.abs(q.y - r.y) < 0.5);
      if (!collinear) break;
      path.splice(path.length - 2, 1);
    }
  }
  // A short sideways step between two opposite runs is a U-turn: cut it to one corner.
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i + 3 < path.length; i++) {
      const [p, q, r, t] = path.slice(i, i + 4);
      const first = { x: Math.sign(q.x - p.x), y: Math.sign(q.y - p.y) },
        third = { x: Math.sign(t.x - r.x), y: Math.sign(t.y - r.y) };
      if (first.x !== -third.x || first.y !== -third.y || Math.hypot(r.x - q.x, r.y - q.y) > 16)
        continue;
      const corner = Math.abs(p.x - q.x) < 0.5 ? { x: p.x, y: t.y } : { x: t.x, y: p.y };
      path.splice(i + 1, 3, corner, t);
      for (let j = path.length - 2; j > 0; j--) {
        const [u, v, w] = [path[j - 1], path[j], path[j + 1]];
        if (
          (Math.abs(u.x - v.x) < 0.5 && Math.abs(v.x - w.x) < 0.5) ||
          (Math.abs(u.y - v.y) < 0.5 && Math.abs(v.y - w.y) < 0.5)
        )
          path.splice(j, 1);
      }
      changed = true;
      break;
    }
  }
  const candidates = segments(path)
    .map(([p, q], index) => ({ p, q, index, length: Math.hypot(q.x - p.x, q.y - p.y) }))
    .filter((item) => Math.abs(item.p[cross] - item.q[cross]) < 0.5 && item.length >= 4 * half + 16)
    .toSorted((x, y) => y.length - x.length);
  const labels = geometry.nodeLabels.get(marker) ?? [];
  // Each long segment offers several spots, middle first. A folded wire is worse than a crowded spot,
  // so without a free spot the circle goes where it collides least.
  const spots = candidates.flatMap((item) =>
    [0.5, 0.35, 0.65, 0.25, 0.75].map((share) => ({ ...item, share })),
  );
  let best: { conflicts: number; apply: () => void } | undefined;
  for (const { p, q, index, share } of spots) {
    const along = p[main] + (q[main] - p[main]) * share;
    if (Math.abs(along - p[main]) < 2 * half + 6 || Math.abs(q[main] - along) < 2 * half + 6)
      continue;
    const center = { [main]: along, [cross]: p[cross] } as Point;
    const shift = { x: center.x - (box.x + box.width / 2), y: center.y - (box.y + box.height / 2) };
    const moved = (item: Box): Box => ({ ...item, x: item.x + shift.x, y: item.y + shift.y });
    const place = moved(box),
      placed = labels.map(moved);
    const others = [...geometry.leaves, ...geometry.markers].filter((id) => id !== marker);
    const conflicts = [place, ...placed].reduce(
      (sum, item) =>
        sum +
        others.filter((id) => overlaps(grow(item, 3), geometry.boxes.get(id)!)).length * 10 +
        [...geometry.nodeLabels].filter(
          ([id, list]) => id !== marker && list.some((label) => overlaps(grow(item, 3), label)),
        ).length *
          3 +
        [...geometry.edgeLabels.values()].filter((label) => overlaps(grow(item, 3), label)).length *
          3 +
        [...geometry.routes].filter(
          ([edge, route]) =>
            edge !== parts.inbound &&
            edge !== parts.outbound &&
            segments(route).some(([c, d]) => segmentHits(c, d, grow(item, 3))),
        ).length,
      0,
    );
    const direction = Math.sign(q[main] - p[main]);
    const at = (value: number): Point => ({ [main]: value, [cross]: p[cross] }) as Point;
    const apply = () => {
      geometry.boxes.set(marker, place);
      geometry.nodeLabels.set(marker, placed);
      geometry.routes.set(parts.inbound, [
        ...path.slice(0, index + 1),
        at(along - direction * half),
      ]);
      geometry.routes.set(parts.outbound, [at(along + direction * half), ...path.slice(index + 1)]);
    };
    if (!conflicts) {
      apply();
      return;
    }
    if (!best || conflicts < best.conflicts) best = { conflicts, apply };
  }
  if (best) fallback("unfold-least-conflict");
  best?.apply();
}

/**
 * A wire that loops around large parts of the diagram (longer than 2.5 times the direct distance)
 * takes a direct L or Z route instead, even through a container's interior, if that route is clear
 * of elements, labels and other wires and adds no crossing.
 */
function shortcut(geometry: Geometry, id: string) {
  const route = geometry.routes.get(id)!;
  const length = segments(route).reduce((sum, [p, q]) => sum + Math.hypot(q.x - p.x, q.y - p.y), 0);
  const start = route[0],
    end = route.at(-1)!,
    direct = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
  if (route.length <= 3 || length <= 2.5 * direct + 60) return;
  const horizontal = (p: Point, q: Point) => Math.abs(p.y - q.y) < 0.5;
  const first = horizontal(route[0], route[1]) ? "x" : "y",
    last = horizontal(route.at(-2)!, end) ? "x" : "y";
  const candidates: Point[][] = [];
  if (first !== last)
    candidates.push([
      start,
      first === "x" ? { x: end.x, y: start.y } : { x: start.x, y: end.y },
      end,
    ]);
  else {
    const middle = (start[first] + end[first]) / 2;
    for (const at of [middle, middle - 20, middle + 20, middle - 40, middle + 40]) {
      candidates.push(zRoute(start, end, first, at));
    }
  }
  for (const points of candidates) {
    if (segments(points).some(([p, q]) => Math.hypot(q.x - p.x, q.y - p.y) < 10)) continue;
    if (!clear(geometry, id, points, new Set(), route, true)) continue;
    if (tryRoute(geometry, id, points, route)) return;
  }
}

/**
 * Moves a wire segment that runs through a container title sideways, just past the title, with the
 * segments next to it; an end segment may slide along its element's border.
 */
export function clearTitles(geometry: Geometry, id: string) {
  const [source, target] = geometry.ends.get(id)!;
  for (let attempt = 0; attempt < 3; attempt++) {
    const route = geometry.routes.get(id)!;
    const index = segments(route).findIndex(([p, q]) =>
      geometry.titles.some((title) => segmentHits(p, q, grow(title, 3))),
    );
    if (index < 0) return;
    const [p, q] = [route[index], route[index + 1]],
      vertical = Math.abs(p.x - q.x) < 0.5,
      axis: Axis = vertical ? "x" : "y";
    const title = geometry.titles.find((item) => segmentHits(p, q, grow(item, 3)))!;
    const options = [title[axis] - 8, title[axis] + title[size(axis)] + 8].toSorted(
      (a, b) => Math.abs(a - p[axis]) - Math.abs(b - p[axis]),
    );
    let moved = false;
    for (const at of options) {
      const points = route.map((point, i) =>
        i === index || i === index + 1 ? { ...point, [axis]: at } : { ...point },
      );
      // An end that moves must stay on its element's side.
      const onSide = (i: number, node: string) => {
        if (i !== 0 && i !== points.length - 1) return true;
        const box = geometry.boxes.get(node);
        return (
          !!box &&
          points[i][axis] > box[axis] + 6 &&
          points[i][axis] < box[axis] + box[size(axis)] - 6
        );
      };
      if (
        (index === 0 && !onSide(0, source)) ||
        (index + 1 === points.length - 1 && !onSide(points.length - 1, target))
      )
        continue;
      if (!clear(geometry, id, points, new Set(), route)) continue;
      if (tryRoute(geometry, id, points, route)) {
        moved = true;
        break;
      }
    }
    if (!moved) return;
  }
}
