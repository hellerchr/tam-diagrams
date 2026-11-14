/** Geometry passes that spread wire jogs apart and balance elements in their containers. */

import { type Box, grow, overlaps, type Point, segmentHits } from "./scene";
import {
  anchored,
  type Axis,
  clear,
  type Geometry,
  halves,
  inner,
  movable,
  other,
  relabel,
  segment,
  segments,
  size,
  spanBox,
  straightAcross,
} from "./route";
import { clearTitles, slideIntoContainer, slideMarker } from "./route-straighten";
import { type Obstacle, shiftLabels, startAmong } from "./node-labels";

/** A step this close to a container's border counts as lying on it. */
const BORDER_REACH = 6;

/**
 * Spreads the sideways steps of wires (segments across the layout direction, between two runs along it)
 * evenly over the free space they cross. Steps that share that space keep ELK's order and levels and
 * are stretched over it, so a lone step sits in the middle instead of hugging an element or border.
 */
export function spreadJogs(geometry: Geometry, vertical: boolean) {
  const main: Axis = vertical ? "y" : "x",
    cross = other(main);
  const flat = (p: Point, q: Point) => Math.abs(p[main] - q[main]) < 0.5;
  // Fixed things the steps may not pass: elements, markers, labels, titles, container borders and other wires' fixed sideways runs.
  const fixed: Box[] = [
    ...[...geometry.leaves, ...geometry.markers]
      .map((id) => geometry.boxes.get(id)!)
      .filter(Boolean),
    ...[...geometry.nodeLabels.values()].flat(),
    ...geometry.edgeLabels.values(),
    ...geometry.titles,
    ...[...geometry.containers].flatMap((id) => {
      const box = geometry.boxes.get(id)!;
      return [
        { ...box, [size(main)]: 0 },
        { ...box, [main]: box[main] + box[size(main)], [size(main)]: 0 },
      ];
    }),
  ];
  interface Jog {
    edge: string;
    index: number;
    at: number;
    from: number;
    to: number;
    low: number;
    high: number;
    /** The step lay on a container's border; it counts as on the side the wire came from. */
    snapped?: boolean;
  }
  const jogs: Jog[] = [];
  for (const [edge, route] of geometry.routes) {
    for (let index = 0; index + 1 < route.length; index++) {
      const p = route[index],
        q = route[index + 1];
      if (!flat(p, q)) continue;
      const span = { from: Math.min(p[cross], q[cross]), to: Math.max(p[cross], q[cross]) };
      // Only steps between two runs along the layout direction can move; end runs and pinned routes are fixed.
      if (index === 0 || index + 2 >= route.length || !movable(geometry, edge)) {
        fixed.push({
          [cross]: span.from,
          [size(cross)]: span.to - span.from,
          [main]: p[main],
          [size(main)]: 0,
        } as unknown as Box);
        continue;
      }
      // ELK may run a step along a container's border, where it reads as a bend at the border. It is
      // treated as lying on the side the wire came from, so it spreads into the free space there.
      let at = p[main],
        snapped = false;
      for (const id of geometry.containers) {
        const box = geometry.boxes.get(id)!;
        if (span.to < box[cross] || span.from > box[cross] + box[size(cross)]) continue;
        for (const line of [box[main], box[main] + box[size(main)]]) {
          if (Math.abs(at - line) >= BORDER_REACH) continue;
          at = line + (route[index - 1][main] < line ? -1 : 1);
          snapped = true;
        }
      }
      jogs.push({ edge, index, at, ...span, low: -Infinity, high: Infinity, snapped });
    }
  }
  for (const jog of jogs) {
    const route = geometry.routes.get(jog.edge)!;
    // The runs before and after keep their direction and some length.
    for (const value of [route[jog.index - 1][main], route[jog.index + 2][main]]) {
      if (value < jog.at) jog.low = Math.max(jog.low, value + 10);
      else jog.high = Math.min(jog.high, value - 10);
    }
    for (const box of fixed) {
      if (box[cross] > jog.to + 2 || box[cross] + box[size(cross)] < jog.from - 2) continue;
      if (box[main] + box[size(main)] <= jog.at + 0.5)
        jog.low = Math.max(jog.low, box[main] + box[size(main)]);
      else if (box[main] >= jog.at - 0.5) jog.high = Math.min(jog.high, box[main]);
    }
  }
  // Steps in one channel (each lies in the other's free space) share its tracks, as ELK routes them.
  const parent = jogs.map((_, index) => index);
  const find = (index: number): number =>
    parent[index] === index ? index : (parent[index] = find(parent[index]));
  for (let i = 0; i < jogs.length; i++)
    for (let j = i + 1; j < jogs.length; j++) {
      const a = jogs[i],
        b = jogs[j];
      if (a.at > b.low && a.at < b.high && b.at > a.low && b.at < a.high) parent[find(i)] = find(j);
    }
  const groups = new Map<number, Jog[]>();
  jogs.forEach((jog, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), jog]));
  for (const group of groups.values()) {
    const low = Math.max(...group.map((jog) => jog.low)),
      high = Math.min(...group.map((jog) => jog.high));
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    // ELK's levels, in order, become evenly spaced tracks.
    const levels = [...new Set(group.map((jog) => Math.round(jog.at * 2) / 2))].toSorted(
      (a, b) => a - b,
    );
    const step = (high - low) / (levels.length + 1);
    if (step < 8) continue;
    const wanted = (jog: Jog) => low + (levels.indexOf(Math.round(jog.at * 2) / 2) + 1) * step;
    if (group.every((jog) => !jog.snapped && Math.abs(wanted(jog) - jog.at) < 4)) continue;
    const edges = [...new Set(group.map((jog) => jog.edge))];
    const before = new Map(edges.map((edge) => [edge, geometry.routes.get(edge)!]));
    const labels = new Map(edges.map((edge) => [edge, geometry.edgeLabels.get(edge)]));
    // All the way when that is clear, else halfway.
    for (const share of [1, 0.5]) {
      for (const edge of edges) {
        const points = before.get(edge)!.map((point) => ({ ...point }));
        for (const jog of group.filter((item) => item.edge === edge)) {
          const to = jog.at + (wanted(jog) - jog.at) * share;
          points[jog.index][main] = to;
          points[jog.index + 1][main] = to;
        }
        geometry.routes.set(edge, points);
      }
      // A step on a container's border may leave it only if that hits no more titles than it did.
      const titled = (points: Point[]) =>
        segments(points).filter(([a, b]) =>
          geometry.titles.some((title) => segmentHits(a, b, grow(title, 3))),
        ).length;
      const titles = geometry.titles;
      const ok = edges.every((edge) => {
        const points = geometry.routes.get(edge)!;
        const snapped = group.some((jog) => jog.edge === edge && jog.snapped);
        if (snapped && titled(points) <= titled(before.get(edge)!)) geometry.titles = [];
        try {
          return (
            clear(geometry, edge, points, new Set(), before.get(edge)!) &&
            relabel(geometry, edge, points)
          );
        } finally {
          geometry.titles = titles;
        }
      });
      if (ok) {
        // The wire's runs may still cross a title: they move aside as in straighten.
        for (const edge of edges)
          if (group.some((jog) => jog.edge === edge && jog.snapped)) clearTitles(geometry, edge);
        break;
      }
      for (const edge of edges) {
        geometry.routes.set(edge, before.get(edge)!);
        const label = labels.get(edge);
        if (label) geometry.edgeLabels.set(edge, label);
      }
    }
  }
}

/**
 * Moves an element across the layout direction toward the middle of the elements it connects to, when
 * all its connections can then run straight along the layout direction (directly, or through a channel
 * or loop marker): its markers and wires move along. ELK's placement can leave a chain off center.
 */
export function balanceElements(geometry: Geometry, vertical: boolean) {
  const main: Axis = vertical ? "y" : "x",
    cross = other(main);
  const middle = (box: Box) => box[cross] + box[size(cross)] / 2;
  const degree = (id: string) =>
    [...geometry.ends.values()].filter((ends) => ends.includes(id)).length;
  for (const id of [...geometry.leaves].toSorted((a, b) => degree(a) - degree(b))) {
    const box = geometry.boxes.get(id)!;
    if (anchored(geometry, id)) continue;
    // Each connection: a straight wire to a neighbour, or two straight halves through a marker.
    const links: { edges: string[]; marker?: string; neighbour: string }[] = [];
    let ok = true;
    for (const [edge, [source, target]] of geometry.ends) {
      if (source !== id && target !== id) continue;
      const end = source === id ? target : source;
      if (geometry.markers.has(end)) {
        const parts = halves(geometry, end);
        if (!parts || links.some((link) => link.marker === end)) {
          ok = ok && !!parts;
          continue;
        }
        links.push({
          edges: [parts.inbound, parts.outbound],
          marker: end,
          neighbour: parts.source === id ? parts.target : parts.source,
        });
      } else links.push({ edges: [edge], neighbour: end });
    }
    if (
      !ok ||
      !links.length ||
      links.some((link) => link.neighbour === id || !geometry.boxes.has(link.neighbour))
    )
      continue;
    // Wires must leave along the layout direction (a marker's other half may still bend).
    const first = (link: (typeof links)[number]) => {
      const route = geometry.routes.get(link.edges[0])!;
      return geometry.ends.get(link.edges[0])![0] === id
        ? [route[0], route[1]]
        : [route.at(-1)!, route.at(-2)!];
    };
    if (
      links.some((link) => {
        const [p, q] = first(link);
        return Math.abs(p[cross] - q[cross]) > 0.5;
      })
    )
      continue;
    // A connection into a container centers the element on that container (the outermost one it enters).
    const mine = new Set(geometry.ancestors.get(id) ?? []);
    const entered = (link: (typeof links)[number]) =>
      (geometry.ancestors.get(link.neighbour) ?? []).findLast(
        (container) => geometry.containers.has(container) && !mine.has(container),
      );
    const target =
      links.reduce(
        (sum, link) => sum + middle(geometry.boxes.get(entered(link) ?? link.neighbour)!),
        0,
      ) / links.length;
    // Free space across the layout direction, among things beside the element.
    const own = new Set([
      id,
      ...links.flatMap((link) => [...link.edges, ...(link.marker ? [link.marker] : [])]),
    ]);
    const parentId = geometry.ancestors
      .get(id)
      ?.find((container) => geometry.containers.has(container));
    const frame = parentId ? geometry.boxes.get(parentId) : undefined;
    // Elements keep ELK's node spacing (room for the dots between multiples, too), wires its wire spacing.
    const { node: apart, edge: wireGap } = geometry.spacing;
    const inset = inner(geometry, parentId, cross);
    // Its own labels (notes) move with it, so each of them limits the move as the box does.
    const labels = geometry.nodeLabels.get(id) ?? [];
    const obstacles: Obstacle[] = [
      ...[...geometry.leaves, ...geometry.markers]
        .filter((other) => !own.has(other))
        .map((other) => [geometry.boxes.get(other)!, apart] as Obstacle),
      ...[...geometry.containers]
        .filter(
          (container) => container !== parentId && !geometry.ancestors.get(id)?.includes(container),
        )
        .map((container) => [geometry.boxes.get(container)!, apart] as Obstacle),
      ...[
        ...geometry.titles,
        ...[...geometry.nodeLabels].filter(([node]) => !own.has(node)).flatMap(([, list]) => list),
        ...[...geometry.edgeLabels].filter(([edge]) => !own.has(edge)).map(([, label]) => label),
      ].map((label) => [label, 8] as Obstacle),
      ...[...geometry.routes]
        .filter(([edge]) => !own.has(edge))
        .flatMap(([, route]) =>
          segments(route).map(([p, q]) => [spanBox([p, q]), wireGap] as Obstacle),
        ),
    ].filter(([item]) => item);
    const frameLimits = {
      low: frame ? frame[cross] + inset.low : -Infinity,
      high: frame ? frame[cross] + frame[size(cross)] - inset.high : Infinity,
    };
    const start = startAmong(box, labels, obstacles, frameLimits, cross, target);
    if (start === undefined) continue;
    const shift = start - box[cross];
    if (!Number.isFinite(shift) || Math.abs(shift) < 4) continue;
    // Moves the element, then each connection onto its shifted line; undoes everything if one fails.
    const saved = {
      boxes: new Map(geometry.boxes),
      routes: new Map(geometry.routes),
      nodeLabels: new Map(geometry.nodeLabels),
      edgeLabels: new Map(geometry.edgeLabels),
    };
    geometry.boxes.set(id, { ...box, [cross]: start });
    shiftLabels(geometry, id, cross, shift);
    const moved = links.every((link) => {
      // A straight connection moves along; a bent one runs straight at the middle of the shared overlap.
      const placed = geometry.boxes.get(id)!,
        far = geometry.boxes.get(link.neighbour)!;
      const overlap = [
        Math.max(placed[cross], far[cross]),
        Math.min(placed[cross] + placed[size(cross)], far[cross] + far[size(cross)]),
      ];
      const at = link.edges.every((edge) => straightAcross(geometry.routes.get(edge)!, cross))
        ? first(link)[0][cross] + shift
        : (overlap[0] + overlap[1]) / 2;
      // Into a container: straight to the marker, then as few bends as reach the part inside.
      if (link.marker && entered(link))
        return slideIntoContainer(geometry, link.marker, main, first(link)[0][cross] + shift, id);
      if (overlap[1] - overlap[0] < 16) return false;
      if (link.marker) return slideMarker(geometry, link.marker, main, [at]);
      const [source, target] = geometry.ends.get(link.edges[0])!,
        points = segment(geometry, source, target, cross, at);
      if (
        !points ||
        !clear(geometry, link.edges[0], points, new Set(), geometry.routes.get(link.edges[0])!)
      )
        return false;
      geometry.routes.set(link.edges[0], points);
      return relabel(geometry, link.edges[0], points);
    });
    if (!moved)
      for (const key of ["boxes", "routes", "nodeLabels", "edgeLabels"] as const) {
        const map = geometry[key] as Map<string, unknown>;
        map.clear();
        for (const [k, v] of saved[key] as Map<string, unknown>) map.set(k, v);
      }
  }
}

/**
 * Grows an element symmetrically across the layout direction until `at` lies well inside it, so a
 * straight wire can reach it there: only rectangles, by at most 48 pixels a side, into free space within
 * its container, and only when no wire ends on the sides that move. Its middle stays where it is.
 */
export function widen(geometry: Geometry, id: string, cross: Axis, at: number): boolean {
  const box = geometry.boxes.get(id);
  if (!box || geometry.round.has(id) || geometry.markers.has(id) || geometry.containers.has(id))
    return false;
  const margin = 8,
    by = Math.max(box[cross] + margin - at, at - (box[cross] + box[size(cross)] - margin), 0);
  if (by < 0.5 || by > 48) return false;
  const place = { ...box, [cross]: box[cross] - by, [size(cross)]: box[size(cross)] + 2 * by };
  const own = [...geometry.ends].filter(([, ends]) => ends.includes(id)).map(([edge]) => edge);
  for (const edge of own) {
    const route = geometry.routes.get(edge)!,
      end = geometry.ends.get(edge)![0] === id ? route[0] : route.at(-1)!;
    if (
      Math.abs(end[cross] - box[cross]) < 0.5 ||
      Math.abs(end[cross] - box[cross] - box[size(cross)]) < 0.5
    )
      return false;
  }
  const parent = geometry.ancestors
    .get(id)
    ?.find((container) => geometry.containers.has(container));
  const frame = parent ? geometry.boxes.get(parent) : undefined,
    inset = inner(geometry, parent, cross);
  if (
    frame &&
    (place[cross] < frame[cross] + inset.low ||
      place[cross] + place[size(cross)] > frame[cross] + frame[size(cross)] - inset.high)
  )
    return false;
  const gap = geometry.spacing.node / 2;
  if (
    [...geometry.leaves, ...geometry.markers].some(
      (other) => other !== id && overlaps(grow(place, gap), geometry.boxes.get(other)!),
    ) ||
    [...geometry.containers].some(
      (container) =>
        container !== parent &&
        !geometry.ancestors.get(id)?.includes(container) &&
        overlaps(grow(place, gap), geometry.boxes.get(container)!),
    ) ||
    [
      ...geometry.titles,
      ...[...geometry.nodeLabels.values()].flat(),
      ...geometry.edgeLabels.values(),
    ].some((label) => overlaps(grow(place, 4), label)) ||
    [...geometry.routes].some(
      ([edge, route]) =>
        !own.includes(edge) && segments(route).some(([c, d]) => segmentHits(c, d, grow(place, 4))),
    )
  )
    return false;
  geometry.boxes.set(id, place);
  return true;
}
