/** A node's own labels (ELK's outside labels, such as notes) and how they move with it. */

import { type Box } from "./scene";
import { type Axis, type Geometry, other, size, spanBox } from "./route";

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

/** Moves a node's own labels by `shift` along `axis`, as the node itself moved. */
export function shiftLabels(geometry: Geometry, id: string, axis: Axis, shift: number) {
  const labels = geometry.nodeLabels.get(id);
  if (labels)
    geometry.nodeLabels.set(
      id,
      labels.map((label) => ({ ...label, [axis]: label[axis] + shift })),
    );
}
