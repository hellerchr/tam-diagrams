// Alignment help for the diagram editor (DiagramView.svelte), as drawing programs give it: a moved element lines up
// with the edges and middles of others and with the gaps between them, a band selects what it encloses, and a
// selection is aligned or spread evenly. Ported from tam-diagrams' old editor (editor/guides.ts); no tam-diagrams
// here, so Node tests it.
import type { Box, Point } from "./diagram-hit.ts";

type Axis = "x" | "y";
type Snap = { by: number; guides: Guide[] };

/** The gap a moved element keeps to the edge of a neighbour it comes to rest beside. */
const GAP = 20;

/** A line shown while an element is aligned on it. */
export type Guide = [Point, Point];

const extent = (axis: Axis) => (axis === "x" ? "width" : "height");
const other = (axis: Axis): Axis => (axis === "x" ? "y" : "x");
const end = (box: Box, axis: Axis) => box[axis] + box[extent(axis)];
/** The start, middle and end of a box along an axis. */
const stops = (box: Box, axis: Axis) =>
  [box[axis], box[axis] + box[extent(axis)] / 2, end(box, axis)] as const;

/** Whether two boxes share a stretch across an axis: they stand in one row (x) or one column (y). */
function inLine(a: Box, b: Box, axis: Axis) {
  const across = other(axis);
  return a[across] < end(b, across) && b[across] < end(a, across);
}

/** A guide from `from` to `to` along `axis`, standing at `at` across it. */
const guide = (axis: Axis, from: number, to: number, at: number): Guide =>
  axis === "x"
    ? [
        { x: from, y: at },
        { x: to, y: at },
      ]
    : [
        { x: at, y: from },
        { x: at, y: to },
      ];

/** The line across the gap between two values of `axis`, in the middle of what two boxes share across it. */
function gapGuide(axis: Axis, [from, to]: [number, number], a: Box, b: Box): Guide {
  const across = other(axis);
  return guide(
    axis,
    from,
    to,
    (Math.max(a[across], b[across]) + Math.min(end(a, across), end(b, across))) / 2,
  );
}

/** The line along `at` across an axis, reaching past a box and the one it lines up with. */
function lineAt(at: number, axis: Axis, box: Box, item: Box): Guide {
  const across = other(axis);
  return guide(
    across,
    Math.min(box[across], item[across]) - 12,
    Math.max(end(box, across), end(item, across)) + 12,
    at,
  );
}

/** The box around `boxes`. */
export function around(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const width = Math.max(...boxes.map((box) => box.x + box.width)) - x;
  return { x, y, width, height: Math.max(...boxes.map((box) => box.y + box.height)) - y };
}

/**
 * An edge on the same edge of another, a middle on a middle, or an edge a gap away from the edge that faces it, so
 * that two elements never come to rest touching: the nearest within `reach`.
 */
function edgeSnap(box: Box, others: Box[], axis: Axis, reach: number): Snap | undefined {
  let best: { by: number; at: number; with: Box } | undefined;
  const take = (mine: number, theirs: number, item: Box, at = theirs) => {
    const by = theirs - mine;
    if (Math.abs(by) <= reach && (!best || Math.abs(by) < Math.abs(best.by)))
      best = { by, at, with: item };
  };
  const mine = stops(box, axis);
  for (const item of others) {
    const theirs = stops(item, axis);
    for (let i = 0; i < 3; i++) take(mine[i]!, theirs[i]!, item);
    // Only beside each other, not one inside the other, do facing edges keep a gap.
    if (inLine(item, box, axis) && !inLine(item, box, other(axis))) {
      take(mine[0], theirs[2] + GAP, item, theirs[2]);
      take(mine[2], theirs[0] - GAP, item, theirs[0]);
    }
  }
  return best && { by: best.by, guides: [lineAt(best.at, axis, box, best.with)] };
}

/** A place a box could stand at along an axis, with the lines across the gaps it keeps there. */
type GapSpot = { at: number; guides: () => Guide[] };

/** Halfway between the neighbours before and after a box. */
function halfway(box: Box, left: Box, right: Box, axis: Axis): GapSpot {
  const size = box[extent(axis)];
  const at = (end(left, axis) + right[axis] - size) / 2;
  return {
    at,
    guides: () => [
      gapGuide(axis, [end(left, axis), at], left, box),
      gapGuide(axis, [at + size, right[axis]], right, box),
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
      gapGuide(axis, [end(further, axis), left[axis]], further, left),
      gapGuide(axis, [end(left, axis), end(left, axis) + gap], left, box),
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
      gapGuide(axis, [end(right, axis), beyond[axis]], right, beyond),
      gapGuide(axis, [right[axis] - gap, right[axis]], right, box),
    ],
  };
}

/** Where the gaps place a box: halfway between its neighbours, or as far from one as that one is from the next. */
function gapSnap(box: Box, others: Box[], axis: Axis, reach: number): Snap {
  const row = others.filter((item) => inLine(item, box, axis));
  const [left, further] = row
    .filter((item) => end(item, axis) <= box[axis] + reach)
    .toSorted((a, b) => end(b, axis) - end(a, axis));
  const [right, beyond] = row
    .filter((item) => item[axis] >= end(box, axis) - reach)
    .toSorted((a, b) => a[axis] - b[axis]);
  const spots = [
    left && right ? halfway(box, left, right, axis) : undefined,
    left && further ? rhythmAfter(box, left, further, axis) : undefined,
    right && beyond ? rhythmBefore(box, right, beyond, axis) : undefined,
  ].filter((spot): spot is GapSpot => !!spot && Math.abs(spot.at - box[axis]) <= reach);
  const spot = spots.toSorted((a, b) => Math.abs(a.at - box[axis]) - Math.abs(b.at - box[axis]))[0];
  return spot ? { by: spot.at - box[axis], guides: spot.guides() } : { by: 0, guides: [] };
}

/** Where a moved box comes to rest among others: on their edges and middles first, else with even gaps to its
 *  neighbours. Returns the step from where it is and the guides to show. */
export function snapMove(
  box: Box,
  others: Box[],
  reach: number,
): { dx: number; dy: number; x: boolean; y: boolean; guides: Guide[] } {
  const across = snapAxis(box, others, "x", reach);
  const down = snapAxis(box, others, "y", reach);
  const x = across.guides.length > 0;
  const y = down.guides.length > 0;
  return { dx: across.by, dy: down.by, x, y, guides: [...across.guides, ...down.guides] };
}

const snapAxis = (box: Box, others: Box[], axis: Axis, reach: number) =>
  edgeSnap(box, others, axis, reach) ?? gapSnap(box, others, axis, reach);

/** The guides of a box where it lies: what it is lined up with, to the pixel. */
export const guidesAt = (box: Box, others: Box[]): Guide[] => [
  ...snapAxis(box, others, "x", 0.01).guides,
  ...snapAxis(box, others, "y", 0.01).guides,
];

/** An edge being dragged (a resize) comes to rest on the edges of others within `reach`, with the guide that shows it. */
export function snapEdge(
  [value, axis]: [number, Axis],
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

/** The step each box takes for an arrangement; boxes that stay are left out. Spreading needs three boxes or more:
 *  the outermost stay, and the gaps between all become one size. */
export function arrange(boxes: Map<string, Box>, how: Arrangement): Map<string, Point> {
  const steps = new Map<string, Point>();
  const all = around([...boxes.values()]);
  const step = (id: string, axis: Axis, to: number) => {
    const by = Math.round(to - boxes.get(id)![axis]);
    if (by) steps.set(id, axis === "x" ? { x: by, y: 0 } : { x: 0, y: by });
  };
  if (how === "spread-x" || how === "spread-y") {
    const axis = how === "spread-x" ? "x" : "y";
    const order = [...boxes].toSorted(([, a], [, b]) => a[axis] - b[axis]);
    if (order.length < 3) return steps;
    const gap =
      (all[extent(axis)] - order.reduce((sum, [, box]) => sum + box[extent(axis)], 0)) /
      (order.length - 1);
    let at = all[axis];
    for (const [id, box] of order) {
      step(id, axis, at);
      at += box[extent(axis)] + gap;
    }
    return steps;
  }
  const [axis, to] = ALIGNMENTS[how];
  for (const [id, box] of boxes) step(id, axis, to(all, box));
  return steps;
}

/** The box a band dragged from `a` to `b` covers. */
export const band = (a: Point, b: Point): Box => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

/** Whether `inner` lies wholly in `outer`. */
export const encloses = (outer: Box, inner: Box) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  end(inner, "x") <= end(outer, "x") &&
  end(inner, "y") <= end(outer, "y");

/** One way to arrange the selected elements, as the Arrange menu, the context menu and the Properties offer it: what
 *  it does, its icon and name, and how many elements it needs. */
export type Arranging = {
  does: Arrangement | "same-width" | "same-height" | "fit-size";
  icon: string;
  name: string;
  least: number;
};
const aligning = (does: Arrangement, name: string): Arranging => ({
  does,
  icon: `align-${does}`,
  name,
  least: 2,
});
/** The ways to arrange, by group: Align, Distribute and Size (the old editor's ARRANGE). */
export const ARRANGE: Record<"Align" | "Distribute" | "Size", Arranging[]> = {
  Align: [
    aligning("left", "Align left edges"),
    aligning("center", "Align centers"),
    aligning("right", "Align right edges"),
    aligning("top", "Align top edges"),
    aligning("middle", "Align middles"),
    aligning("bottom", "Align bottom edges"),
  ],
  Distribute: [
    { does: "spread-x", icon: "spread-x", name: "Distribute left to right", least: 3 },
    { does: "spread-y", icon: "spread-y", name: "Distribute top to bottom", least: 3 },
  ],
  Size: [
    { does: "same-width", icon: "same-width", name: "Same width", least: 2 },
    { does: "same-height", icon: "same-height", name: "Same height", least: 2 },
    { does: "fit-size", icon: "fit-size", name: "Fit size to the contents", least: 1 },
  ],
};

/** Why an arranging is off for `selected` elements; undefined when it is on. */
export const arrangeRefusal = (action: Arranging, selected: number) =>
  selected >= action.least
    ? undefined
    : action.least === 1
      ? "Select an element"
      : `Select ${action.least === 2 ? "two" : "three"} or more elements`;
