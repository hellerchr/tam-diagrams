/**
 * Alignment help, as drawing programs give it: a moved element lines up with the edges and middles
 * of others and with the gaps between them, and a selection is aligned, spread evenly or made one size.
 */

import { around, type Box, type Point } from "../src/scene.ts";

type Axis = "x" | "y";

/** The gap a moved element keeps to the edge of a neighbour it comes to rest beside. */
const GAP = 20;

/** A line shown while an element is aligned on it. */
export type Guide = [Point, Point];

const extent = (axis: Axis) => (axis === "x" ? "width" : "height");

const other = (axis: Axis): Axis => (axis === "x" ? "y" : "x");

const end = (box: Box, axis: Axis) => box[axis] + box[extent(axis)];

/** The start, middle and end of a box along an axis. */
const stops = (box: Box, axis: Axis) => [
  box[axis],
  box[axis] + box[extent(axis)] / 2,
  end(box, axis),
];

/** Whether two boxes share a stretch across an axis: they stand in one row (x) or one column (y). */
const inLine = (a: Box, b: Box, axis: Axis) => {
  const across = other(axis);
  return a[across] < end(b, across) && b[across] < end(a, across);
};

/** The line across the gap between two values of `axis`, in the middle of what two boxes share across it. */
function gapGuide(from: number, to: number, a: Box, b: Box, axis: Axis): Guide {
  const across = other(axis),
    at = (Math.max(a[across], b[across]) + Math.min(end(a, across), end(b, across))) / 2;
  return axis === "x"
    ? [
        { x: from, y: at },
        { x: to, y: at },
      ]
    : [
        { x: at, y: from },
        { x: at, y: to },
      ];
}

/** The line along `at` across an axis, reaching past a box and the one it lines up with. */
function lineAt(at: number, axis: Axis, box: Box, item: Box): Guide {
  const across = other(axis),
    from = Math.min(box[across], item[across]) - 12,
    to = Math.max(end(box, across), end(item, across)) + 12;
  return axis === "x"
    ? [
        { x: at, y: from },
        { x: at, y: to },
      ]
    : [
        { x: from, y: at },
        { x: to, y: at },
      ];
}

/** How far a box moves along one axis to line up with others within `reach`, and the lines that show it. */
function snapAxis(
  box: Box,
  others: Box[],
  axis: Axis,
  reach: number,
): { by: number; guides: Guide[] } {
  return edgeSnap(box, others, axis, reach) ?? gapSnap(box, others, axis, reach);
}

/**
 * An edge on the same edge of another, a middle on a middle, or an edge a gap away from the edge
 * that faces it, so that two elements never come to rest touching: the nearest within `reach`.
 */
function edgeSnap(
  box: Box,
  others: Box[],
  axis: Axis,
  reach: number,
): { by: number; guides: Guide[] } | undefined {
  let best: { by: number; at: number; with: Box } | undefined;
  const take = (mine: number, theirs: number, item: Box, at = theirs) => {
    const by = theirs - mine;
    if (Math.abs(by) <= reach && (!best || Math.abs(by) < Math.abs(best.by)))
      best = { by, at, with: item };
  };
  for (const item of others) {
    const [start, middle, finish] = stops(box, axis),
      [theirStart, theirMiddle, theirFinish] = stops(item, axis);
    take(start, theirStart, item);
    take(middle, theirMiddle, item);
    take(finish, theirFinish, item);
    // Only beside each other, not one inside the other, do facing edges keep a gap.
    if (inLine(item, box, axis) && !inLine(item, box, other(axis))) {
      take(start, theirFinish + GAP, item, theirFinish);
      take(finish, theirStart - GAP, item, theirStart);
    }
  }
  const found = best as { by: number; at: number; with: Box } | undefined;
  return found && { by: found.by, guides: [lineAt(found.at, axis, box, found.with)] };
}

/** A place a box could stand at along an axis, with the lines across the gaps it keeps there. */
type GapSpot = { at: number; guides: () => Guide[] };

/** Where the gaps place a box: halfway between its neighbours, or as far from one as that one is from the next. */
function gapSnap(box: Box, others: Box[], axis: Axis, reach: number) {
  const row = others.filter((item) => inLine(item, box, axis)),
    before = row
      .filter((item) => end(item, axis) <= box[axis] + reach)
      .toSorted((a, b) => end(b, axis) - end(a, axis)),
    after = row
      .filter((item) => item[axis] >= end(box, axis) - reach)
      .toSorted((a, b) => a[axis] - b[axis]);
  const [left, further] = before,
    [right, beyond] = after;
  const spots = [
    left && right ? halfway(box, left, right, axis) : undefined,
    left && further ? rhythmAfter(box, left, further, axis) : undefined,
    right && beyond ? rhythmBefore(box, right, beyond, axis) : undefined,
  ].filter((spot): spot is GapSpot => !!spot);
  const spot = spots
    .filter((item) => Math.abs(item.at - box[axis]) <= reach)
    .toSorted((a, b) => Math.abs(a.at - box[axis]) - Math.abs(b.at - box[axis]))[0];
  return spot ? { by: spot.at - box[axis], guides: spot.guides() } : { by: 0, guides: [] };
}

/** Halfway between the neighbours before and after a box. */
function halfway(box: Box, left: Box, right: Box, axis: Axis): GapSpot {
  const size = box[extent(axis)],
    at = (end(left, axis) + right[axis] - size) / 2;
  return {
    at,
    guides: () => [
      gapGuide(end(left, axis), at, left, box, axis),
      gapGuide(at + size, right[axis], right, box, axis),
    ],
  };
}

/** After the neighbour before a box, as far from it as it is from the one before it. */
function rhythmAfter(box: Box, left: Box, further: Box, axis: Axis): GapSpot | undefined {
  if (!inLine(left, further, axis) || end(further, axis) > left[axis]) return undefined;
  const gap = left[axis] - end(further, axis);
  return {
    at: end(left, axis) + gap,
    guides: () => [
      gapGuide(end(further, axis), left[axis], further, left, axis),
      gapGuide(end(left, axis), end(left, axis) + gap, left, box, axis),
    ],
  };
}

/** Before the neighbour after a box, as far from it as it is from the one after it. */
function rhythmBefore(box: Box, right: Box, beyond: Box, axis: Axis): GapSpot | undefined {
  if (!inLine(right, beyond, axis) || end(right, axis) > beyond[axis]) return undefined;
  const gap = beyond[axis] - end(right, axis);
  return {
    at: right[axis] - gap - box[extent(axis)],
    guides: () => [
      gapGuide(end(right, axis), beyond[axis], right, beyond, axis),
      gapGuide(right[axis] - gap, right[axis], right, box, axis),
    ],
  };
}

/**
 * Where a moved box comes to rest among others: on their edges and middles first, else with even
 * gaps to its neighbours. Returns the step from where it is, the axes it lined up on (the others
 * are free for the grid), and the guides to show.
 */
export function snapMove(
  box: Box,
  others: Box[],
  reach: number,
): { dx: number; dy: number; x: boolean; y: boolean; guides: Guide[] } {
  const across = snapAxis(box, others, "x", reach),
    down = snapAxis(box, others, "y", reach);
  return {
    dx: across.by,
    dy: down.by,
    x: across.guides.length > 0,
    y: down.guides.length > 0,
    guides: [...across.guides, ...down.guides],
  };
}

/** The guides of a box where it lies: what it is lined up with, to the pixel. */
export const guidesAt = (box: Box, others: Box[]): Guide[] => [
  ...snapAxis(box, others, "x", 0.01).guides,
  ...snapAxis(box, others, "y", 0.01).guides,
];

/** An edge being dragged comes to rest on the edges of others within `reach`. */
export function snapEdge(
  value: number,
  axis: Axis,
  box: Box,
  others: Box[],
  reach: number,
): { value: number; guide?: Guide } {
  let best: { at: number; with: Box } | undefined;
  for (const item of others)
    for (const at of [item[axis], end(item, axis)])
      if (
        Math.abs(at - value) <= reach &&
        (!best || Math.abs(at - value) < Math.abs(best.at - value))
      )
        best = { at, with: item };
  return best ? { value: best.at, guide: lineAt(best.at, axis, box, best.with) } : { value };
}

/** How a selection is arranged: aligned on a side or middle of the box around it, or spread with even gaps. */
export type Arrangement =
  "left" | "center" | "right" | "top" | "middle" | "bottom" | "spread-x" | "spread-y";

/** Where an alignment stands a box along its axis, in the box around all. */
const ALIGNMENTS: Record<
  Exclude<Arrangement, `spread-${string}`>,
  [Axis, (all: Box, box: Box) => number]
> = {
  left: ["x", (all) => all.x],
  center: ["x", (all, box) => all.x + all.width / 2 - box.width / 2],
  right: ["x", (all, box) => all.x + all.width - box.width],
  top: ["y", (all) => all.y],
  middle: ["y", (all, box) => all.y + all.height / 2 - box.height / 2],
  bottom: ["y", (all, box) => all.y + all.height - box.height],
};

/** The step each box takes for an arrangement; boxes that stay are left out. */
export function arrange(boxes: Map<string, Box>, how: Arrangement): Map<string, Point> {
  const steps = new Map<string, Point>(),
    all = around([...boxes.values()]);
  const step = (id: string, axis: Axis, to: number) => {
    const by = Math.round(to - boxes.get(id)![axis]);
    if (by) steps.set(id, axis === "x" ? { x: by, y: 0 } : { x: 0, y: by });
  };
  if (how === "spread-x" || how === "spread-y") {
    spread(boxes, how === "spread-x" ? "x" : "y", all, step);
    return steps;
  }
  const [axis, to] = ALIGNMENTS[how];
  for (const [id, box] of boxes) step(id, axis, to(all, box));
  return steps;
}

/** Spreads three or more boxes along an axis: the outermost stay, and the gaps between all become one size. */
function spread(
  boxes: Map<string, Box>,
  axis: Axis,
  all: Box,
  step: (id: string, axis: Axis, to: number) => void,
) {
  const order = [...boxes].toSorted(([, a], [, b]) => a[axis] - b[axis]);
  if (order.length < 3) return;
  const filled = order.reduce((sum, [, box]) => sum + box[extent(axis)], 0),
    gap = (all[extent(axis)] - filled) / (order.length - 1);
  let at = all[axis];
  for (const [id, box] of order) {
    step(id, axis, at);
    at += box[extent(axis)] + gap;
  }
}
