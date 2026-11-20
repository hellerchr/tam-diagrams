// What the diagram canvas (DiagramCanvas.svelte) lays over the picture to grab, as tam-diagrams' old editor had it
// (editor/gesture.ts, overlay.ts, placing.ts): the eight resize handles of the one selected element, the four dots a
// connection is dragged from, the ends of the one selected connection, where a new element stands, and the plain math
// of a drag (the slop, one axis with Shift, the grid, the edges a resize may not cross). Screen points are pixels on
// the stage; no tam-diagrams here, so Node tests it.
import type { View } from "../lib/zoom.ts";
import { type Guide, guidesAt, snapEdge, snapMove } from "./diagram-arrange.ts";
import { type Box, type Point, shift } from "./diagram-hit.ts";

/** A pointer moves this far, on screen, before a press becomes a drag. */
export const SLOP = 4;
/** Handles are this large on screen, and the connection dots this far out from their element. */
export const HANDLE = 8;
export const DOT_GAP = 22;
/** A moved element lines up with others within this many screen pixels. */
export const ALIGN = 8;
/** Elements stand on this grid; Alt (or Snap off) moves them freely. */
export const GRID = 10;

/** The handles of a selected element: which edges each moves, and the cursor over it. */
export const HANDLES = [
  { x: -1, y: -1, cursor: "nwse-resize" },
  { x: 0, y: -1, cursor: "ns-resize" },
  { x: 1, y: -1, cursor: "nesw-resize" },
  { x: 1, y: 0, cursor: "ew-resize" },
  { x: 1, y: 1, cursor: "nwse-resize" },
  { x: 0, y: 1, cursor: "ns-resize" },
  { x: -1, y: 1, cursor: "nesw-resize" },
  { x: -1, y: 0, cursor: "ew-resize" },
] as const;
export type Handle = (typeof HANDLES)[number];

/** A point of the diagram on the stage. */
export const toScreen = (view: View, p: Point): Point => ({
  x: p.x * view.zoom + view.x,
  y: p.y * view.zoom + view.y,
});

/** A box of the diagram on the stage. */
export function boxOnScreen(view: View, box: Box): Box {
  const { x, y } = toScreen(view, box);
  return { x, y, width: box.width * view.zoom, height: box.height * view.zoom };
}

/** The handles of a box on the stage: where each grabs, on the box's edge (it is drawn on the frame 3 pixels out). */
export function handlePoints(view: View, box: Box): { handle: Handle; x: number; y: number }[] {
  const on = boxOnScreen(view, box);
  return HANDLES.map((handle) => ({
    handle,
    x: on.x + ((handle.x + 1) / 2) * on.width,
    y: on.y + ((handle.y + 1) / 2) * on.height,
  }));
}

/** The handle at a point of the stage: within its size of where it grabs. */
export const handleAt = (view: View, box: Box, at: Point) =>
  handlePoints(view, box).find(
    (spot) => Math.abs(spot.x - at.x) <= HANDLE && Math.abs(spot.y - at.y) <= HANDLE,
  )?.handle;

/** The dots a connection is dragged from, on the stage: off the middle of each side. */
export function linkPoints(view: View, box: Box): Point[] {
  const on = boxOnScreen(view, box);
  return [
    { x: on.x + on.width / 2, y: on.y - DOT_GAP },
    { x: on.x + on.width + DOT_GAP, y: on.y + on.height / 2 },
    { x: on.x + on.width / 2, y: on.y + on.height + DOT_GAP },
    { x: on.x - DOT_GAP, y: on.y + on.height / 2 },
  ];
}

/** Whether a point of the stage is on one of a box's dots. */
export const onLinkDot = (view: View, box: Box, at: Point) =>
  linkPoints(view, box).some((spot) => Math.hypot(spot.x - at.x, spot.y - at.y) <= HANDLE);

/** Whether the pointer, at a point of the diagram, is still near enough a box for its dots to stay. */
export const nearDots = (box: Box, p: Point, zoom: number) => {
  const by = (DOT_GAP + HANDLE + 2) / zoom;
  return (
    p.x >= box.x - by &&
    p.x <= box.x + box.width + by &&
    p.y >= box.y - by &&
    p.y <= box.y + box.height + by
  );
};

/** The point of a wire nearest to a box: where the connection meets its element. */
export function endNear(points: Point[], box: Box): Point | undefined {
  const away = (p: Point) =>
    Math.max(box.x - p.x, p.x - box.x - box.width, 0) +
    Math.max(box.y - p.y, p.y - box.y - box.height, 0);
  return points.reduce<Point | undefined>(
    (best, p) => (!best || away(p) < away(best) ? p : best),
    undefined,
  );
}

/** Whether the pointer went at least SLOP from where it was pressed, on the stage. */
export const movedPast = (screen: Point, start: Point) =>
  Math.hypot(screen.x - start.x, screen.y - start.y) >= SLOP;

/** A step kept to one axis when asked (Shift): the one it goes further along. */
export function alongOneAxis(step: Point, keep: boolean): Point {
  if (!keep) return step;
  return Math.abs(step.x) >= Math.abs(step.y) ? { x: step.x, y: 0 } : { x: 0, y: step.y };
}

/** A value on the grid, or a whole number when free. */
export const onGrid = (value: number, free: boolean) =>
  free ? Math.round(value) : Math.round(value / GRID) * GRID;

/** The size a new element of a kind is shown at before it is placed; its name sizes it after. */
export function sizeOf(kind: string): { width: number; height: number } {
  if (kind === "group") return { width: 160, height: 100 };
  if (kind === "note") return { width: 80, height: 30 };
  if (kind === "human") return { width: 76, height: 66 };
  return { width: 96, height: kind === "storage" ? 36 : 40 };
}

/** Where a new element of a kind stands when dropped at a point: its top left, around the point, on the grid. */
export const dropPlace = (kind: string, at: Point, free: boolean): Point => ({
  x: onGrid(at.x - sizeOf(kind).width / 2, free),
  y: onGrid(at.y - sizeOf(kind).height / 2, free),
});

/** The edges of a box being resized. */
export type Edges = { left: number; top: number; right: number; bottom: number };

/** Edges that still hold a container's parts, whose box is `least`. */
export const holding = (edges: Edges, least: Box): Edges => ({
  left: Math.min(edges.left, Math.floor(least.x)),
  top: Math.min(edges.top, Math.floor(least.y)),
  right: Math.max(edges.right, Math.ceil(least.x + least.width)),
  bottom: Math.max(edges.bottom, Math.ceil(least.y + least.height)),
});

/** Edges at least as far apart as a leaf's least size: the dragged edge stops there. */
export function leastApart(
  edges: Edges,
  least: { width: number; height: number },
  handle: Handle,
): Edges {
  const width = Math.ceil(least.width);
  const height = Math.ceil(least.height);
  let { left, top, right, bottom } = edges;
  if (right - left < width) {
    if (handle.x < 0) left = right - width;
    else right = left + width;
  }
  if (bottom - top < height) {
    if (handle.y < 0) top = bottom - height;
    else bottom = top + height;
  }
  return { left, top, right, bottom };
}

/** The box between edges. */
export const boxOf = (e: Edges): Box => ({
  x: e.left,
  y: e.top,
  width: e.right - e.left,
  height: e.bottom - e.top,
});

/** How far `p` lies out from a box, along the axis it is furthest out on. */
export const awayFrom = (box: Box, p: Point) =>
  Math.max(box.x - p.x, p.x - box.x - box.width, box.y - p.y, p.y - box.y - box.height);

/** Where a new element stands in an element that holds nothing yet: below where its title will be. */
export const newSpot = (spot: Point, holder: Box | undefined): Point =>
  holder
    ? {
        x: Math.max(spot.x, onGrid(holder.x + 14, false)),
        y: Math.max(spot.y, onGrid(holder.y + 44, false)),
      }
    : spot;

/** Whether the whole of `bounds` (a box on the stage) lies outside a stage `width` by `height`: the view has left
 *  the diagram, and the way back shows. */
export const awayFromView = (on: Box, width: number, height: number) =>
  on.x > width || on.y > height || on.x + on.width < 0 || on.y + on.height < 0;

/** What a move of elements lines up with: the box around what moves, the first moved element's top left (which lands
 *  on the grid), and the boxes of the others. */
export type MoveBase = { moving: Box; lead: Point; others: Box[] };

/**
 * How far a move has come: what moves lines up with the edges and middles of the other elements, or evenly between
 * them, within `reach` (diagram units); along an axis where it lines up with none its first element lands on the
 * grid. Whole steps, so the source holds whole numbers; `free` (Alt, or Snap off) takes the step as it is.
 */
export function moveStep(
  base: MoveBase,
  delta: Point,
  reach: number,
  free: boolean,
): { delta: Point; guides: Guide[] } {
  const { moving, lead, others } = base;
  const snapped = free ? undefined : snapMove(shift(moving, delta), others, reach);
  const dx = snapped?.x
    ? Math.round(delta.x + snapped.dx)
    : onGrid(lead.x + delta.x, free) - lead.x;
  const dy = snapped?.y
    ? Math.round(delta.y + snapped.dy)
    : onGrid(lead.y + delta.y, free) - lead.y;
  const step = { x: dx, y: dy };
  return { delta: step, guides: snapped ? guidesAt(shift(moving, step), others) : [] };
}

/** What a resize starts from: the element's box, the handle dragged, the boxes its edges line up with, and the least
 *  it may become (a leaf's size, or the box around a container's parts). */
export type ResizeBase = {
  box: Box;
  handle: Handle;
  others: Box[];
  least: Box;
  container: boolean;
};

/**
 * The box a resize has come to: each dragged edge comes to rest on the edges of others within `reach`, else on the
 * grid; never smaller than a leaf's least size, nor off a container's parts.
 */
export function resized(
  base: ResizeBase,
  delta: Point,
  reach: number,
  free: boolean,
): { box: Box; guides: Guide[]; natural: boolean } {
  const { box, handle, others, least, container } = base;
  const guides: Guide[] = [];
  const edge = (value: number, axis: "x" | "y") => {
    const found = free ? { value } : snapEdge([value, axis], box, others, reach);
    if (!found.guide) return onGrid(value, free);
    guides.push(found.guide);
    return found.value;
  };
  const dragged = {
    left: handle.x < 0 ? edge(box.x + delta.x, "x") : box.x,
    right: handle.x > 0 ? edge(box.x + box.width + delta.x, "x") : box.x + box.width,
    top: handle.y < 0 ? edge(box.y + delta.y, "y") : box.y,
    bottom: handle.y > 0 ? edge(box.y + box.height + delta.y, "y") : box.y + box.height,
  };
  const sized = boxOf(container ? holding(dragged, least) : leastApart(dragged, least, handle));
  // A leaf back at its least size takes none: its name sizes it.
  const natural =
    !container && sized.width <= Math.ceil(least.width) && sized.height <= Math.ceil(least.height);
  return { box: sized, guides, natural };
}
