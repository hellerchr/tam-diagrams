/** Geometry passes that center elements, fans, pairs, ends and wires on each other, and align layers. */

import { type Box, grow, overlaps, type Point, segmentHits } from "./scene";
import {
  anchored,
  type Axis,
  clear,
  edgesOf,
  endSides,
  type Geometry,
  halves,
  inner,
  movable,
  other,
  segment,
  segments,
  size,
  straightAcross,
  straightenRoute,
  tryRoute,
} from "./route";
import { slideIntoContainer, slideMarker } from "./route-straighten";
import { widen } from "./route-spread";

/** Whether a box lies within a frame across `cross`. */
const within = (item: Box, frame: Box, cross: Axis) =>
  item[cross] >= frame[cross] &&
  item[cross] + item[size(cross)] <= frame[cross] + frame[size(cross)];

/** The wires at an element, each with whether it starts there. */
function wiresAt(geometry: Geometry, id: string): { edge: string; start: boolean }[] {
  return [...geometry.ends]
    .filter(([, ends]) => ends.includes(id))
    .map(([edge, ends]) => ({ edge, start: ends[0] === id }));
}

/** Whether every wire leaves its element straight along the layout direction (its `cross` stays put). */
function leaveAlong(geometry: Geometry, edges: { edge: string; start: boolean }[], cross: Axis) {
  return edges.every(({ edge, start }) => {
    const route = geometry.routes.get(edge)!,
      [p, q] = start ? [route[0], route[1]] : [route.at(-1)!, route.at(-2)!];
    return Math.abs(p[cross] - q[cross]) < 0.5;
  });
}

/**
 * Centers a leaf element in the free space along the layout direction (between the nearest element,
 * title or container edge before and after it) when all its wires run along that direction, so they
 * only get longer or shorter. Keeps a lone storage from hugging a container title.
 */
export function centerElements(geometry: Geometry, vertical: boolean) {
  const main: Axis = vertical ? "y" : "x",
    cross = other(main);
  for (const id of geometry.leaves) {
    const box = geometry.boxes.get(id)!;
    if (anchored(geometry, id)) continue;
    const edges = wiresAt(geometry, id);
    if (!edges.length || edges.some(({ edge }) => geometry.edgeLabels.has(edge))) continue;
    // Every wire leaves along the layout direction, from the side facing its other end.
    if (!leaveAlong(geometry, edges, cross)) continue;
    // Free space before and after, among things that overlap the element across the layout direction.
    const span = (item: Box) =>
      item[cross] < box[cross] + box[size(cross)] && item[cross] + item[size(cross)] > box[cross];
    const parent = geometry.ancestors
      .get(id)
      ?.find((container) => geometry.containers.has(container));
    const frame = parent ? geometry.boxes.get(parent) : undefined;
    const inset = inner(geometry, parent, main);
    let low = frame ? frame[main] + inset.low : -Infinity,
      high = frame ? frame[main] + frame[size(main)] - inset.high : Infinity;
    const obstacles = [
      ...[...geometry.leaves, ...geometry.markers]
        .filter((other) => other !== id)
        .map((other) => geometry.boxes.get(other)!),
      ...[...geometry.containers]
        .filter(
          (container) => container !== parent && !geometry.ancestors.get(id)?.includes(container),
        )
        .map((container) => geometry.boxes.get(container)!),
      ...geometry.titles,
      ...[...geometry.nodeLabels.values()].flat(),
      ...geometry.edgeLabels.values(),
    ].filter((item) => item && span(item));
    for (const item of obstacles) {
      if (item[main] + item[size(main)] <= box[main] + 0.5)
        low = Math.max(low, item[main] + item[size(main)]);
      else if (item[main] >= box[main] + box[size(main)] - 0.5) high = Math.min(high, item[main]);
    }
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    const before = box[main] - low,
      after = high - (box[main] + box[size(main)]);
    const shift = (after - before) / 2;
    if (Math.abs(shift) < 12) continue;
    shiftAlong(geometry, id, edges, main, shift);
  }
}

/**
 * Moves an element by `shift` along the layout direction when all its wires leave along it: the wires
 * get longer or shorter, each keeping some length and its direction. Returns whether it moved.
 */
function shiftAlong(
  geometry: Geometry,
  id: string,
  edges: { edge: string; start: boolean }[],
  main: Axis,
  shift: number,
): boolean {
  const box = geometry.boxes.get(id)!;
  const moved = edges.map(({ edge, start }) => {
    const route = geometry.routes.get(edge)!,
      points = route.map((point) => ({ ...point }));
    const index = start ? 0 : points.length - 1,
      next = start ? 1 : points.length - 2;
    points[index][main] += shift;
    return {
      edge,
      points,
      keeps:
        Math.sign(points[next][main] - points[index][main]) ===
          Math.sign(route[next][main] - route[index][main]) &&
        Math.abs(points[next][main] - points[index][main]) >= 12,
    };
  });
  if (!moved.every((item) => item.keeps)) return false;
  const place = { ...box, [main]: box[main] + shift };
  if (
    [...geometry.leaves, ...geometry.markers].some(
      (other) => other !== id && overlaps(grow(place, 6), geometry.boxes.get(other)!),
    )
  )
    return false;
  // Wires of other connections must not pass through the element's new place.
  const own = new Set(edges.map((item) => item.edge));
  if (
    [...geometry.routes].some(
      ([edge, route]) =>
        !own.has(edge) && segments(route).some(([c, d]) => segmentHits(c, d, grow(place, 4))),
    )
  )
    return false;
  // Nor may it or its wires (with their arrowheads) land on text.
  if (
    [
      ...geometry.titles,
      ...[...geometry.nodeLabels].filter(([other]) => other !== id).flatMap(([, list]) => list),
      ...[...geometry.edgeLabels].filter(([edge]) => !own.has(edge)).map(([, label]) => label),
    ].some((label) => overlaps(grow(place, 4), label))
  )
    return false;
  geometry.boxes.set(id, place);
  if (
    !moved.every(({ edge, points }) =>
      clear(geometry, edge, points, new Set(), geometry.routes.get(edge)!),
    )
  ) {
    geometry.boxes.set(id, box);
    return false;
  }
  for (const { edge, points } of moved) geometry.routes.set(edge, points);
  return true;
}

/**
 * An element whose children hang only from it, each on a straight wire from the same side, sits
 * centered over them: the children (with everything that hangs only from them, markers too) shift across together,
 * so the wires fan out symmetrically from the parent. Done only into free space.
 */
export function centerFans(geometry: Geometry, vertical: boolean) {
  const main: Axis = vertical ? "y" : "x",
    cross = other(main);
  const middle = (box: Box) => box[cross] + box[size(cross)] / 2,
    level = (box: Box) => box[main] + box[size(main)] / 2;
  for (const parent of geometry.leaves) {
    if (anchored(geometry, parent)) continue;
    const box = geometry.boxes.get(parent)!;
    for (const side of [-1, 1]) {
      // Children: straight wires leaving this side of the parent.
      const fan = edgesOf(geometry, parent).filter(({ edge, other }) => {
        const route = geometry.routes.get(edge);
        return (
          route &&
          movable(geometry, edge) &&
          straightAcross(route, cross) &&
          geometry.leaves.has(other) &&
          Math.sign(level(geometry.boxes.get(other)!) - level(box)) === side
        );
      });
      if (fan.length < 2) continue;
      // Everything hanging only from the children moves with them.
      const group = new Set(fan.map((item) => item.other));
      let ok = true;
      for (let grew = true; grew && ok;) {
        grew = false;
        for (const member of Array.from(group))
          for (const { edge, other } of edgesOf(geometry, member)) {
            if (
              other === parent
                ? !fan.some((item) => item.edge === edge)
                : !group.has(other) &&
                  (!geometry.boxes.has(other) ||
                    edgesOf(geometry, other).some(
                      (item) => item.other !== member && !group.has(item.other),
                    ))
            ) {
              ok = false;
              break;
            }
            if (!group.has(other) && other !== parent) {
              group.add(other);
              grew = true;
            }
            if (!straightAcross(geometry.routes.get(edge) ?? [], cross)) {
              ok = false;
              break;
            }
          }
        if (group.size > 12) ok = false;
      }
      // The group moves rigidly, so wires pinned inside it keep their ports; only the parent's own wires slide.
      if (!ok) continue;
      const delta =
        middle(box) -
        fan.reduce((sum, item) => sum + middle(geometry.boxes.get(item.other)!), 0) / fan.length;
      if (Math.abs(delta) < 4) continue;
      // The wires stay on the parent's side, well inside it.
      if (
        fan.some(({ edge }) => {
          const at = geometry.routes.get(edge)![0][cross] + delta;
          return at < box[cross] + 8 || at > box[cross] + box[size(cross)] - 8;
        })
      )
        continue;
      const shift = <T extends Box | Point>(item: T): T => ({
        ...item,
        [cross]: item[cross] + delta,
      });
      const edges = new Set(
        [...group].flatMap((member) => edgesOf(geometry, member).map((item) => item.edge)),
      );
      const boxes = [...group].map((member) => shift(geometry.boxes.get(member)!));
      const labels = [...edges]
        .flatMap((edge) =>
          geometry.edgeLabels.has(edge) ? [shift(geometry.edgeLabels.get(edge)!)] : [],
        )
        .concat([...group].flatMap((member) => (geometry.nodeLabels.get(member) ?? []).map(shift)));
      const routes = [...edges].map((edge) => geometry.routes.get(edge)!.map(shift));
      const gap = geometry.spacing.node / 2,
        mine = new Set([...group, parent]);
      const parents = new Set([...group].flatMap((member) => geometry.ancestors.get(member) ?? []));
      const fixed = [...geometry.leaves, ...geometry.markers]
        .filter((id) => !mine.has(id))
        .map((id) => geometry.boxes.get(id)!)
        .concat(
          [...geometry.containers]
            .filter((container) => !parents.has(container))
            .map((container) => geometry.boxes.get(container)!),
        );
      const fixedLabels = [
        ...geometry.titles,
        ...[...geometry.nodeLabels].filter(([id]) => !mine.has(id)).flatMap(([, list]) => list),
        ...[...geometry.edgeLabels].filter(([edge]) => !edges.has(edge)).map(([, label]) => label),
      ];
      const frames = [...parents]
        .filter((container) => geometry.containers.has(container))
        .map((container) => geometry.boxes.get(container)!);
      if (
        boxes.some(
          (item) =>
            fixed.some((other) => overlaps(grow(item, gap), other)) ||
            fixedLabels.some((label) => overlaps(grow(item, 4), label)) ||
            !frames.every((frame) => within(item, frame, cross)),
        ) ||
        labels.some(
          (label) =>
            fixed.some((other) => overlaps(grow(label, 4), other)) ||
            fixedLabels.some((other) => overlaps(grow(label, 2), other)),
        ) ||
        routes.some((route) =>
          segments(route).some(
            ([c, d]) =>
              fixed.some((other) => segmentHits(c, d, grow(other, 4))) ||
              fixedLabels.some((label) => segmentHits(c, d, grow(label, 2))),
          ),
        ) ||
        [...geometry.routes].some(
          ([edge, route]) =>
            !edges.has(edge) &&
            segments(route).some(([c, d]) =>
              [...boxes, ...labels].some((item) => segmentHits(c, d, grow(item, 4))),
            ),
        )
      )
        continue;
      [...group].forEach((member, index) => {
        geometry.boxes.set(member, boxes[index]);
        if (geometry.nodeLabels.has(member))
          geometry.nodeLabels.set(member, geometry.nodeLabels.get(member)!.map(shift));
      });
      for (const edge of edges) {
        geometry.routes.set(edge, geometry.routes.get(edge)!.map(shift));
        if (geometry.edgeLabels.has(edge))
          geometry.edgeLabels.set(edge, shift(geometry.edgeLabels.get(edge)!));
      }
    }
  }
}

/**
 * Two storages joined by a pointer sit side by side. When one element reaches both with its own
 * connections, the pair moves across the layout direction until it is centered under that element, so
 * both connections run straight, as a single storage's would. Undone unless every move is clear.
 */
export function centerPairs(geometry: Geometry, vertical: boolean, pairs: [string, string][]) {
  const main: Axis = vertical ? "y" : "x",
    cross = other(main);
  for (const [a, b] of pairs) {
    const mine = [...edgesOf(geometry, a), ...edgesOf(geometry, b)];
    const hub = mine[0]?.other;
    if (!hub || !geometry.leaves.has(hub) || mine.some((item) => item.other !== hub)) continue;
    if (!mine.every(({ edge }) => movable(geometry, edge))) continue;
    const [boxA, boxB, boxHub] = [a, b, hub].map((id) => geometry.boxes.get(id)!);
    const low = Math.min(boxA[cross], boxB[cross]),
      high = Math.max(boxA[cross] + boxA[size(cross)], boxB[cross] + boxB[size(cross)]);
    const delta = boxHub[cross] + boxHub[size(cross)] / 2 - (low + high) / 2;
    if (Math.abs(delta) < 1) continue;
    const shift = (box: Box): Box => ({ ...box, [cross]: box[cross] + delta });
    // The pair stays inside its containers and clear of every other element.
    const group = new Set([a, b, hub]);
    const frames = (geometry.ancestors.get(a) ?? [])
      .filter((container) => geometry.containers.has(container))
      .map((container) => geometry.boxes.get(container)!);
    const moved = [boxA, boxB].map(shift);
    const fixed = [...geometry.leaves, ...geometry.markers]
      .filter((id) => !group.has(id))
      .map((id) => geometry.boxes.get(id)!);
    const gap = geometry.spacing.node / 2;
    if (
      moved.some(
        (item) =>
          fixed.some((other) => overlaps(grow(item, gap), other)) ||
          !frames.every((frame) => within(item, frame, cross)),
      )
    )
      continue;
    const before = {
      boxes: [boxA, boxB],
      labels: [a, b].map((id) => geometry.nodeLabels.get(id)),
      routes: mine.map(({ edge }) => geometry.routes.get(edge)!),
    };
    geometry.boxes.set(a, moved[0]);
    geometry.boxes.set(b, moved[1]);
    [a, b].forEach((id) => {
      const labels = geometry.nodeLabels.get(id);
      if (labels) geometry.nodeLabels.set(id, labels.map(shift));
    });
    // Each connection runs straight again, or the move is undone.
    const ok = mine.every(({ edge }) => straightenRoute(geometry, edge, cross));
    if (ok) continue;
    geometry.boxes.set(a, before.boxes[0]);
    geometry.boxes.set(b, before.boxes[1]);
    [a, b].forEach((id, index) => {
      if (before.labels[index]) geometry.nodeLabels.set(id, before.labels[index]!);
    });
    mine.forEach(({ edge }, index) => geometry.routes.set(edge, before.routes[index]));
  }
}

/**
 * Elements of one size standing side by side across the layout direction share one line. ELK centers
 * a row container (with its padding) against single elements, which can leave them a few pixels apart.
 * The line most of them already share wins, else the one nearest the start.
 */
export function alignLayers(geometry: Geometry, vertical: boolean) {
  const main: Axis = vertical ? "y" : "x",
    cross = other(main);
  const middle = (id: string) => {
    const box = geometry.boxes.get(id)!;
    return box[main] + box[size(main)] / 2;
  };
  const length = (id: string) => geometry.boxes.get(id)![size(main)];
  const done = new Set<string>();
  for (const id of geometry.leaves) {
    if (done.has(id)) continue;
    const cluster = [...geometry.leaves].filter(
      (other) =>
        !done.has(other) &&
        Math.abs(length(other) - length(id)) < 0.5 &&
        Math.abs(middle(other) - middle(id)) <= 10,
    );
    cluster.forEach((other) => done.add(other));
    const lines = new Map<number, number>();
    for (const other of cluster)
      lines.set(
        Math.round(middle(other) * 2) / 2,
        (lines.get(Math.round(middle(other) * 2) / 2) ?? 0) + 1,
      );
    if (lines.size < 2) continue;
    const [target] = [...lines].toSorted((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    for (const other of cluster) {
      const shift = target - middle(other);
      if (Math.abs(shift) < 0.5 || anchored(geometry, other)) continue;
      const edges = wiresAt(geometry, other);
      // Every wire must leave along the layout direction, so moving only lengthens or shortens it.
      if (!leaveAlong(geometry, edges, cross)) continue;
      shiftAlong(geometry, other, edges, main, shift);
    }
  }
}

/**
 * A wire that is the only one on its side of an element leaves from the middle of that side. A wire
 * that bends anyway moves its first run there (with its channel marker), and the bend takes up the
 * difference; a straight wire moves as close to the middle as its other end allows.
 */
export function centerEnds(geometry: Geometry, vertical: boolean) {
  const main: Axis = vertical ? "y" : "x",
    cross = other(main);
  const { sides, sideOf } = endSides(geometry, main);
  // Positions from the middle back toward the current end, nearest to the middle first.
  const toward = (middle: number, current: number) =>
    Array.from(
      { length: Math.floor(Math.abs(current - middle) / 3) },
      (_, step) => middle + Math.sign(current - middle) * step * 3,
    );
  for (const id of geometry.leaves) {
    if (geometry.markers.has(id) || anchored(geometry, id)) continue;
    const box = geometry.boxes.get(id)!,
      middle = box[cross] + box[size(cross)] / 2;
    for (const [edge, [source, target]] of geometry.ends) {
      if ((source === id) === (target === id) || !movable(geometry, edge)) continue;
      const route = geometry.routes.get(edge);
      if (!route || route.length < 2) continue;
      const [end, next] = source === id ? [route[0], route[1]] : [route.at(-1)!, route.at(-2)!];
      if (
        sides.get(sideOf(id, end)) !== 1 ||
        Math.abs(end[cross] - middle) < 1 ||
        Math.abs(next[cross] - end[cross]) > 0.5
      )
        continue;
      const far = source === id ? target : source;
      if (geometry.markers.has(far)) {
        const parts = halves(geometry, far);
        if (!parts || anchored(geometry, far)) continue;
        const routes = [parts.inbound, parts.outbound].map((item) => geometry.routes.get(item)!);
        if (!routes.every((route) => straightAcross(route, cross))) {
          slideIntoContainer(geometry, far, main, middle, id);
          continue;
        }
        if (slideMarker(geometry, far, main, [middle])) continue;
        // An element across the marker may grow to reach under the middle; else as close as it allows.
        const across = parts.source === id ? parts.target : parts.source,
          before = geometry.boxes.get(across)!;
        if (widen(geometry, across, cross, middle) && slideMarker(geometry, far, main, [middle]))
          continue;
        geometry.boxes.set(across, before);
        slideMarker(geometry, far, main, toward(middle, end[cross]));
      } else if (straightAcross(route, cross)) {
        for (const at of toward(middle, end[cross])) {
          const points = segment(geometry, source, target, cross, at);
          if (points && clear(geometry, edge, points, new Set(), route)) {
            if (tryRoute(geometry, edge, points, route)) break;
          }
        }
      } else if (!geometry.round.has(id) && route.length >= 3) {
        // The first run moves across to the middle; the bend after it absorbs the difference.
        const points =
          source === id
            ? route.map((point) => ({ ...point }))
            : route.map((point) => ({ ...point })).toReversed();
        const turn = points[2];
        if (Math.abs(points[1][main] - turn[main]) > 0.5 || Math.abs(turn[cross] - middle) < 12)
          continue;
        points[0][cross] = middle;
        points[1][cross] = middle;
        const moved = source === id ? points : points.toReversed();
        if (!clear(geometry, edge, moved, new Set(), route)) continue;
        tryRoute(geometry, edge, moved, route);
      }
    }
  }
}

/**
 * A straight connection that is the only wire on its side of both elements runs through the middle of
 * their overlap (with its channel or loop marker), so a centered pair is joined by a centered line.
 */
export function centerWires(geometry: Geometry, vertical: boolean) {
  const main: Axis = vertical ? "y" : "x",
    cross = other(main);
  const { sides, sideOf } = endSides(geometry, main);
  const lone = (id: string, point: Point) =>
    geometry.markers.has(id) || sides.get(sideOf(id, point)) === 1;
  const done = new Set<string>();
  for (const [edge, [source, target]] of geometry.ends) {
    if (done.has(edge) || !movable(geometry, edge)) continue;
    const marker = [source, target].find((end) => geometry.markers.has(end));
    const parts = marker ? halves(geometry, marker) : null;
    if (marker && (!parts || anchored(geometry, marker))) continue;
    const edges = parts ? [parts.inbound, parts.outbound] : [edge];
    edges.forEach((item) => done.add(item));
    const [from, to] = parts ? [parts.source, parts.target] : [source, target];
    const routes = edges.map((item) => geometry.routes.get(item)!);
    if (
      !routes.every((route) => straightAcross(route, cross)) ||
      geometry.markers.has(from) ||
      geometry.markers.has(to)
    )
      continue;
    if (!lone(from, routes[0][0]) || !lone(to, routes.at(-1)!.at(-1)!)) continue;
    const a = geometry.boxes.get(from)!,
      b = geometry.boxes.get(to)!;
    const middle =
      (Math.max(a[cross], b[cross]) +
        Math.min(a[cross] + a[size(cross)], b[cross] + b[size(cross)])) /
      2;
    if (Math.abs(routes[0][0][cross] - middle) < 1) continue;
    if (marker) {
      slideMarker(geometry, marker, main, [middle]);
      continue;
    }
    const points = segment(geometry, source, target, cross, middle);
    if (points && clear(geometry, edge, points, new Set(), routes[0])) {
      tryRoute(geometry, edge, points, routes[0]);
    }
  }
}
