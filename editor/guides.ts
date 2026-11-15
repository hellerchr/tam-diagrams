/**
 * Alignment help, as drawing programs give it: a moved element lines up with the edges and middles
 * of others and with the gaps between them, and a selection is aligned, spread evenly or made one size.
 */

import type { Box, Point } from "../src/scene.ts";

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

/** How far a box moves along one axis to line up with others within `reach`, and the lines that show it. */
function snapAxis(
  box: Box,
  others: Box[],
  axis: Axis,
  reach: number,
): { by: number; guides: Guide[] } {
  const across = other(axis);
  // An edge on the same edge of another, a middle on a middle, or an edge a gap away from the
  // edge that faces it, so that two elements never come to rest touching: the nearest wins.
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
  if (best) {
    const from = Math.min(box[across], best.with[across]) - 12,
      to = Math.max(end(box, across), end(best.with, across)) + 12;
    return {
      by: best.by,
      guides: [
        axis === "x"
          ? [
              { x: best.at, y: from },
              { x: best.at, y: to },
            ]
          : [
              { x: from, y: best.at },
              { x: to, y: best.at },
            ],
      ],
    };
  }
  // Else the gaps: halfway between its neighbours, or as far from one as that one is from the next.
  const row = others.filter((item) => inLine(item, box, axis)),
    before = row
      .filter((item) => end(item, axis) <= box[axis] + reach)
      .toSorted((a, b) => end(b, axis) - end(a, axis)),
    after = row
      .filter((item) => item[axis] >= end(box, axis) - reach)
      .toSorted((a, b) => a[axis] - b[axis]);
  const size = box[extent(axis)];
  const spots: { at: number; guides: () => Guide[] }[] = [];
  const [left, further] = before,
    [right, beyond] = after;
  if (left && right)
    spots.push({
      at: (end(left, axis) + right[axis] - size) / 2,
      guides: () => {
        const at = (end(left, axis) + right[axis] - size) / 2;
        return [
          gapGuide(end(left, axis), at, left, box, axis),
          gapGuide(at + size, right[axis], right, box, axis),
        ];
      },
    });
  if (left && further && inLine(left, further, axis) && end(further, axis) <= left[axis]) {
    const gap = left[axis] - end(further, axis);
    spots.push({
      at: end(left, axis) + gap,
      guides: () => [
        gapGuide(end(further, axis), left[axis], further, left, axis),
        gapGuide(end(left, axis), end(left, axis) + gap, left, box, axis),
      ],
    });
  }
  if (right && beyond && inLine(right, beyond, axis) && end(right, axis) <= beyond[axis]) {
    const gap = beyond[axis] - end(right, axis);
    spots.push({
      at: right[axis] - gap - size,
      guides: () => [
        gapGuide(end(right, axis), beyond[axis], right, beyond, axis),
        gapGuide(right[axis] - gap, right[axis], right, box, axis),
      ],
    });
  }
  const spot = spots
    .filter((item) => Math.abs(item.at - box[axis]) <= reach)
    .toSorted((a, b) => Math.abs(a.at - box[axis]) - Math.abs(b.at - box[axis]))[0];
  return spot ? { by: spot.at - box[axis], guides: spot.guides() } : { by: 0, guides: [] };
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
  if (!best) return { value };
  const across = other(axis),
    from = Math.min(box[across], best.with[across]) - 12,
    to = Math.max(end(box, across), end(best.with, across)) + 12;
  return {
    value: best.at,
    guide:
      axis === "x"
        ? [
            { x: best.at, y: from },
            { x: best.at, y: to },
          ]
        : [
            { x: from, y: best.at },
            { x: to, y: best.at },
          ],
  };
}

/** The box around boxes. */
export function around(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x)),
    y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

/** How a selection is arranged: aligned on a side or middle of the box around it, or spread with even gaps. */
export type Arrangement =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "spread-x"
  | "spread-y";

/** The step each box takes for an arrangement; boxes that stay are left out. */
export function arrange(boxes: Map<string, Box>, how: Arrangement): Map<string, Point> {
  const steps = new Map<string, Point>(),
    all = around([...boxes.values()]);
  const step = (id: string, axis: Axis, to: number) => {
    const by = Math.round(to - boxes.get(id)![axis]);
    if (by) steps.set(id, axis === "x" ? { x: by, y: 0 } : { x: 0, y: by });
  };
  if (how === "spread-x" || how === "spread-y") {
    const axis: Axis = how === "spread-x" ? "x" : "y",
      order = [...boxes].toSorted(([, a], [, b]) => a[axis] - b[axis]);
    if (order.length < 3) return steps;
    // The outermost stay; the gaps between all become one size.
    const filled = order.reduce((sum, [, box]) => sum + box[extent(axis)], 0),
      gap = (all[extent(axis)] - filled) / (order.length - 1);
    let at = all[axis];
    for (const [id, box] of order) {
      step(id, axis, at);
      at += box[extent(axis)] + gap;
    }
    return steps;
  }
  for (const [id, box] of boxes) {
    if (how === "left") step(id, "x", all.x);
    else if (how === "center") step(id, "x", all.x + all.width / 2 - box.width / 2);
    else if (how === "right") step(id, "x", all.x + all.width - box.width);
    else if (how === "top") step(id, "y", all.y);
    else if (how === "middle") step(id, "y", all.y + all.height / 2 - box.height / 2);
    else step(id, "y", all.y + all.height - box.height);
  }
  return steps;
}
