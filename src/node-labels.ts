/** A node's own labels (ELK's outside labels, such as notes) and how they move with it. */

import { type Box, grow, overlaps, segmentHits } from "./scene.ts";
import { type Axis, type Geometry, other, segments, size, spanBox } from "./route.ts";

/** The smallest box around a node and its labels. */
export function withLabels(box: Box, labels: Box[]): Box {
  return spanBox(
    [box, ...labels].flatMap((item) => [
      { x: item.x, y: item.y },
      { x: item.x + item.width, y: item.y + item.height },
    ]),
  );
}

/** An obstacle with the gap to keep from it. */
export type Obstacle = [Box, number];

/**
 * The limits on where a box may start along `axis`, from the obstacles beside one item that moves with
 * it (the box itself or a label). `lead` is where the item starts relative to the box.
 */
function limitsFor(item: Box, lead: number, obstacles: Obstacle[], axis: Axis) {
  const main = other(axis);
  let low = -Infinity,
    high = Infinity;
  for (const [obstacle, gap] of obstacles) {
    if (
      obstacle[main] >= item[main] + item[size(main)] + gap ||
      obstacle[main] + obstacle[size(main)] <= item[main] - gap
    )
      continue;
    if (obstacle[axis] + obstacle[size(axis)] <= item[axis] + 0.5)
      low = Math.max(low, obstacle[axis] + obstacle[size(axis)] + gap - lead);
    else if (obstacle[axis] >= item[axis] + item[size(axis)] - 0.5)
      high = Math.min(high, obstacle[axis] - gap - (lead + item[size(axis)]));
  }
  return { low, high };
}

/**
 * Where a box starts along `axis` to lie as near `target` (its middle) as it and its labels fit
 * between the obstacles. Each obstacle limits the box and each label separately, by its own
 * distance to them, so one that lies between a box and its label stops the move. `frame` bounds the
 * box and its labels together. Without room for the labels it returns nothing and the box stays; a
 * box without labels takes the nearest start the limits leave.
 */
export function startAmong(
  box: Box,
  labels: Box[],
  obstacles: Obstacle[],
  frame: { low: number; high: number },
  axis: Axis,
  target: number,
): number | undefined {
  const reach = labels.length ? withLabels(box, labels) : box,
    lead = reach[axis] - box[axis];
  let low = frame.low - lead,
    high = frame.high - (lead + reach[size(axis)]);
  for (const item of [box, ...labels]) {
    const limits = limitsFor(item, item[axis] - box[axis], obstacles, axis);
    low = Math.max(low, limits.low);
    high = Math.min(high, limits.high);
  }
  if (labels.length && low > high) return undefined;
  return Math.min(Math.max(target - box[size(axis)] / 2, low), high);
}

/**
 * Whether a node's own labels, moved by `shift` along `axis` with it, would land on another element
 * (at the node spacing), on text or on a wire of another connection (`own` are the node's connections),
 * or leave a container they are inside.
 */
export function labelsBlocked(
  geometry: Geometry,
  id: string,
  own: Set<string>,
  axis: Axis,
  shift: number,
): boolean {
  const labels = geometry.nodeLabels.get(id) ?? [];
  if (!labels.length) return false;
  const holders = geometry.ancestors.get(id) ?? [],
    frames = holders
      .filter((item) => geometry.containers.has(item))
      .map((item) => geometry.boxes.get(item)!),
    solids = [
      ...[...geometry.leaves, ...geometry.markers].filter((item) => item !== id),
      ...[...geometry.containers].filter((item) => !holders.includes(item)),
    ].map((item) => geometry.boxes.get(item)!),
    texts = [
      ...geometry.titles,
      ...[...geometry.nodeLabels].filter(([item]) => item !== id).flatMap(([, list]) => list),
      ...[...geometry.edgeLabels].filter(([edge]) => !own.has(edge)).map(([, label]) => label),
    ],
    wires = [...geometry.routes]
      .filter(([edge]) => !own.has(edge))
      .flatMap(([, route]) => segments(route));
  const inside = (label: Box, frame: Box) =>
    label.x >= frame.x &&
    label.y >= frame.y &&
    label.x + label.width <= frame.x + frame.width &&
    label.y + label.height <= frame.y + frame.height;
  return labels.some((label) => {
    const place = { ...label, [axis]: label[axis] + shift };
    return (
      solids.some((item) => overlaps(grow(place, geometry.spacing.node), item)) ||
      texts.some((item) => overlaps(grow(place, 4), item)) ||
      wires.some(([c, d]) => segmentHits(c, d, grow(place, 4))) ||
      frames.some((frame) => inside(label, frame) && !inside(place, frame))
    );
  });
}

/** Moves a node's own labels by `shift` along `axis`, as the node itself moved. */
export function shiftLabels(geometry: Geometry, id: string, axis: Axis, shift: number) {
  const labels = geometry.nodeLabels.get(id);
  if (labels)
    geometry.nodeLabels.set(
      id,
      labels.map((label) => ({ ...label, [axis]: label[axis] + shift })),
    );
}
