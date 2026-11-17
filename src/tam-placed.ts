/**
 * TAM layout by hand, first step: every element's box from the placements in the source (`@x,y`).
 * tam-placed-wires.ts routes the connections between the boxes, and tam-scene.ts draws the result
 * like a layout by ELK.
 */

import { around, type Box, centerOf, grow, inside, overlaps, type Point } from "./scene.ts";
import type { Placement, TamDiagram, TamEdge, TamNode } from "./tam.ts";
import { type Measure, SMALL } from "./text.ts";
import {
  CHANNEL,
  containerInsets,
  leafSize,
  MARKER_GAP,
  NODE_SPACING,
  SHADOW,
  type TamGraph,
} from "./tam-graph.ts";

/** A side of a box. Wire ends on `top` and `bottom` lie at an x, on `left` and `right` at a y. */
export type Side = "top" | "bottom" | "left" | "right";

/** Whether wire ends on the side lie along x. */
export const lies = (side: Side) => side === "top" || side === "bottom";

/** The point on a box's side at `along`: an x on the top and bottom, a y on the left and right. */
export const sidePoint = (box: Box, side: Side, along: number): Point =>
  side === "top"
    ? { x: along, y: box.y }
    : side === "bottom"
      ? { x: along, y: box.y + box.height }
      : side === "left"
        ? { x: box.x, y: along }
        : { x: box.x + box.width, y: along };

/** Elements the source does not place stand in rows this wide at most, below the placed ones. */
const ROW = 720;

/** An interface's line reaches this far from its element; each further one on the side reaches STEP less far or further. */
const STUB = 30,
  STEP = 18;

/** An interface's circle and name keep this far from other elements and from their container's border. */
const CLEAR = 4;

/** Three dots at the end of a row stand this far from the last element. */
const DOTS = 20;

/** The elements of a layout placed by hand: their boxes, and the marks derived from them. */
export interface PlacedElements {
  /** Elements and interface circles by id; an element with copies behind it takes its shadow's room too. */
  boxes: Map<string, Box>;
  dots: Map<string, { center: Point; across: boolean }>;
  /** The line from an element to each of its interfaces, by the connection's id. */
  stubs: Map<string, Point[]>;
  /** The room beside each interface circle for its name. */
  labels: Map<string, Box[]>;
  /** Whether the line at an interface runs up or down. */
  upright: Map<string, boolean>;
}

/** A layout by hand as it goes on: the elements placed so far, and what is known of the source. */
interface Placing extends PlacedElements {
  prepared: TamGraph;
  measure: Measure;
  /** Whether the source places an element or one of its parts, by the element's id. */
  anchored: Map<string, boolean>;
}

/**
 * Places every element: where the source says (`@x,y`, with `WxH` as its least size), and never
 * smaller than its name or its parts need. A container without a placement fits its parts.
 * Elements the source leaves out stand in a row below the placed ones of their container, so a
 * source edited as text shows its new elements at once. Copies (`...`), dots and interfaces follow
 * the elements they belong to.
 */
export function placeElements(prepared: TamGraph, measure: Measure): PlacedElements {
  const placing: Placing = {
    prepared,
    measure,
    anchored: new Map(),
    boxes: new Map(),
    dots: new Map(),
    stubs: new Map(),
    labels: new Map(),
    upright: new Map(),
  };
  placeAll(placing, null, { x: 0, y: 0 });
  const { boxes, dots, stubs, labels, upright } = placing;
  return { boxes, dots, stubs, labels, upright };
}

const nodeOf = ({ prepared }: Placing, id: string) => prepared.diagram.nodes.get(id)!;
const isRow = (id: string) => id.endsWith("#row");
/** The second copy of a `...` element follows the first. */
const isCopy = (item: TamNode) => !!item.origin && item.origin !== item.id;
const isElement = (item: TamNode) =>
  item.kind !== "dots" && item.kind !== "interface" && item.kind !== "channel" && !isCopy(item);

/** The elements among `ids`, with the elements of rows in their place: a row is no shape of its own. */
function elementsAmong(placing: Placing, ids: string[]): string[] {
  return ids.flatMap((id) =>
    isRow(id)
      ? elementsAmong(placing, nodeOf(placing, id).children)
      : isElement(nodeOf(placing, id))
        ? [id]
        : [],
  );
}

const partsOf = (placing: Placing, id: string) =>
  placing.prepared.shapes.get(id)?.container
    ? elementsAmong(placing, nodeOf(placing, id).children)
    : [];

/** Whether the source places the element or one of its parts, which places the element around it. */
function isAnchored(placing: Placing, id: string): boolean {
  const { anchored } = placing;
  if (!anchored.has(id))
    anchored.set(
      id,
      !!nodeOf(placing, id).at || partsOf(placing, id).some((part) => isAnchored(placing, part)),
    );
  return anchored.get(id)!;
}

const shadowOf = (placing: Placing, id: string) => (nodeOf(placing, id).stack ? SHADOW : 0);

/** A leaf at a point, as large as its name and the source ask. */
function leafBox(placing: Placing, id: string, at: Point): Box {
  const shape = placing.prepared.shapes.get(id)!,
    size = leafSize(shape.node, shape.lines, shape.textWidth, placing.measure),
    given = shape.node.at;
  return {
    ...at,
    width: Math.ceil(Math.max(size.width, given?.width ?? 0)) + shadowOf(placing, id),
    height: Math.ceil(Math.max(size.height, given?.height ?? 0)) + shadowOf(placing, id),
  };
}

/** A container at a point with its parts placed: around them, and at least as large as the source asks. */
function containerBox(placing: Placing, id: string, at: Point): Box {
  const shape = placing.prepared.shapes.get(id)!,
    shadow = shadowOf(placing, id);
  const { top, side, minimum } = containerInsets(
    shape.node,
    shape.lines,
    shape.textWidth,
    placing.measure,
  );
  const inner = placeAll(placing, id, { x: at.x + side, y: at.y + top });
  const frame = {
    x: inner.x - side,
    y: inner.y - top,
    width: Math.max(inner.width + 2 * side + shadow, minimum),
    height: inner.height + top + side + shadow,
  };
  const given = shape.node.at;
  if (!given) return frame;
  return around([
    frame,
    {
      x: given.x,
      y: given.y,
      width: Math.max((given.width ?? 0) + shadow, minimum),
      height: (given.height ?? 0) + shadow,
    },
  ]);
}

/** Places an element with its parts and returns the room it takes with its copy. */
function placeElement(placing: Placing, id: string, free: Point): Box {
  const shape = placing.prepared.shapes.get(id)!,
    at = shape.node.at ?? free;
  const box = shape.container ? containerBox(placing, id, at) : leafBox(placing, id, at);
  placing.boxes.set(id, box);
  return withCopy(placing, id, box);
}

/**
 * Places the copy of an element beside it, where the source places it or across the direction the
 * diagram runs, and returns the room both take; the element's own where it has no copy.
 */
function withCopy(placing: Placing, id: string, box: Box): Box {
  const { diagram, vertical } = placing.prepared,
    copy = `${id}#2`;
  if (diagram.nodes.get(copy)?.origin !== id) return box;
  const given = diagram.nodes.get(copy)!.at;
  const second = given
    ? { ...box, x: given.x, y: given.y }
    : vertical
      ? { ...box, x: box.x + box.width + NODE_SPACING }
      : { ...box, y: box.y + box.height + NODE_SPACING };
  placing.boxes.set(copy, second);
  return around([box, second]);
}

/** Dots in the gap between two boxes, along the line that joins them. */
function dotsBetween(a: Box, b: Box) {
  const ca = centerOf(a),
    cb = centerOf(b),
    across = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y);
  const [first, second] = [a, b].toSorted((p, q) => (across ? p.x - q.x : p.y - q.y));
  return {
    across,
    center: across
      ? { x: (first.x + first.width + second.x) / 2, y: (ca.y + cb.y) / 2 }
      : { x: (ca.x + cb.x) / 2, y: (first.y + first.height + second.y) / 2 },
  };
}

/**
 * Places the parts of a container (or the top-level elements): the placed ones first, the others
 * in rows below them, from `free` when nothing is placed. Returns the room they take with their
 * dots and interfaces.
 */
function placeAll(placing: Placing, parent: string | null, free: Point): Box {
  const children = parent ? nodeOf(placing, parent).children : placing.prepared.diagram.roots,
    ids = elementsAmong(placing, children);
  const taken = ids
    .filter((id) => isAnchored(placing, id))
    .map((id) => placeElement(placing, id, free));
  const rest = ids.filter((id) => !isAnchored(placing, id));
  taken.push(...placeInRows(placing, rest, taken.length ? around(taken) : undefined, free));
  taken.push(...marks(placing, children, parent));
  return taken.length ? around(taken) : { ...free, width: 0, height: 0 };
}

/** Places the elements the source does not place in rows of at most ROW below the `placed` ones. */
function placeInRows(placing: Placing, ids: string[], placed: Box | undefined, free: Point) {
  const taken: Box[] = [];
  const left = placed ? placed.x : free.x;
  let x = left,
    y = placed ? placed.y + placed.height + NODE_SPACING : free.y,
    tallest = 0;
  for (const id of ids) {
    let box = placeElement(placing, id, { x, y });
    if (x > left && box.x + box.width - left > ROW) {
      x = left;
      y += tallest + NODE_SPACING;
      tallest = 0;
      box = placeElement(placing, id, { x, y });
    }
    taken.push(box);
    x = box.x + box.width + NODE_SPACING;
    tallest = Math.max(tallest, box.height);
  }
  return taken;
}

/** The dots and interfaces among `ids` (and in their rows), parts of `parent`, placed by the elements they belong to. */
function marks(placing: Placing, ids: string[], parent: string | null): Box[] {
  const taken = ids.filter(isRow).flatMap((id) => rowMarks(placing, id, parent));
  const lollipops = new Map<string, TamEdge[]>();
  for (const id of ids) {
    const { kind } = nodeOf(placing, id);
    if (kind === "interface") addInterface(placing, id, lollipops);
    else if (kind === "dots") {
      const spot = dotsSpot(placing, ids, id);
      if (!spot) continue;
      placing.dots.set(id, spot);
      taken.push({ x: spot.center.x - 8, y: spot.center.y - 8, width: 16, height: 16 });
    }
  }
  const room = roomOf(parent ? nodeOf(placing, parent).at : undefined);
  for (const [owner, edges] of lollipops)
    taken.push(...placeInterfaces(placing, owner, edges, room));
  return taken;
}

/** The marks in a row; the row takes the room of what stands in it, so dots beside a row find it. */
function rowMarks(placing: Placing, id: string, parent: string | null): Box[] {
  const { boxes } = placing,
    { children } = nodeOf(placing, id);
  const taken = marks(placing, children, parent);
  const inside = children.flatMap((child) => boxes.get(child) ?? []);
  if (inside.length) boxes.set(id, around(inside));
  return taken;
}

/** Files an interface under the element it belongs to, where that element stands. */
function addInterface(placing: Placing, id: string, lollipops: Map<string, TamEdge[]>) {
  const edge = placing.prepared.diagram.edges.find((edge) => edge.target === id);
  if (edge && placing.boxes.has(edge.source))
    lollipops.set(edge.source, [...(lollipops.get(edge.source) ?? []), edge]);
}

/** Where dots stand: between the elements declared before and after them, or past the one they follow. */
function dotsSpot(placing: Placing, ids: string[], id: string) {
  const { boxes } = placing,
    { vertical } = placing.prepared,
    index = ids.indexOf(id);
  // Notes stand beside the elements they remark on and are no neighbours of the dots.
  const real = (other: string) => boxes.has(other) && nodeOf(placing, other).kind !== "note";
  const before = ids.slice(0, index).findLast(real),
    after = ids.slice(index + 1).find(real);
  const beside = before ?? after;
  if (!beside) return undefined;
  const box = boxes.get(beside)!,
    away = before ? 1 : -1;
  if (before && after) return dotsBetween(box, boxes.get(after)!);
  return {
    across: vertical,
    center: vertical
      ? { x: centerOf(box).x + away * (box.width / 2 + DOTS), y: centerOf(box).y }
      : { x: centerOf(box).x, y: centerOf(box).y + away * (box.height / 2 + DOTS) },
  };
}

/** The room a container's placement gives its parts; none where the source does not size it. */
function roomOf(given: Placement | undefined): Box | undefined {
  return given?.width !== undefined && given.height !== undefined
    ? { x: given.x, y: given.y, width: given.width, height: given.height }
    : undefined;
}

/** The side interfaces leave an element by: the one the diagram runs toward. */
const FLOW: Record<TamDiagram["direction"], Side> = {
  TB: "bottom",
  BT: "top",
  LR: "right",
  RL: "left",
};

/** The sides interfaces try in turn: the one the diagram runs toward, those across it, the one opposite. */
const SIDES_FOR: Record<Side, Side[]> = {
  bottom: ["bottom", "right", "left", "top"],
  top: ["top", "right", "left", "bottom"],
  right: ["right", "bottom", "top", "left"],
  left: ["left", "bottom", "top", "right"],
};

/** An interface on a side of its element: its line, its circle, and the room for its name. */
interface Lollipop {
  edge: TamEdge;
  from: Point;
  center: Point;
  circle: Box;
  label: Box;
  name?: string;
}

/**
 * Places the interfaces of an element and returns the room they take. They leave their element on
 * the side the diagram runs toward, each on a line of its own; on another side where an element
 * stands in the way there, or the container's `room` ends.
 */
function placeInterfaces(
  placing: Placing,
  owner: string,
  edges: TamEdge[],
  room: Box | undefined,
): Box[] {
  const flow = FLOW[placing.prepared.diagram.direction],
    side = SIDES_FOR[flow].find((side) => standsFree(placing, owner, edges, side, room)) ?? flow;
  const taken: Box[] = [];
  for (const { edge, from, center, circle, label, name } of interfacesOn(
    placing,
    owner,
    edges,
    side,
  )) {
    placing.boxes.set(edge.target, circle);
    placing.stubs.set(edge.id, [from, center]);
    placing.upright.set(edge.target, lies(side));
    if (name) placing.labels.set(edge.target, [label]);
    taken.push(circle, ...(name ? [label] : []));
  }
  return taken;
}

/** The interfaces of an element on one of its sides: each one's line, circle and the room for its name. */
function interfacesOn(placing: Placing, owner: string, edges: TamEdge[], side: Side): Lollipop[] {
  const box = placing.boxes.get(owner)!;
  return edges.map((edge, index) => {
    const name = nodeOf(placing, edge.target).label,
      width = name ? Math.ceil(placing.measure(name, SMALL, 400)) : 0,
      { from, center, label } = lies(side)
        ? acrossSide(box, side, index, edges.length, width)
        : alongSide(box, side, index, edges.length, width);
    const circle = {
      x: center.x - CHANNEL / 2,
      y: center.y - CHANNEL / 2,
      width: CHANNEL,
      height: CHANNEL,
    };
    return { edge, from, center, circle, label, name };
  });
}

/** An interface on the top or bottom: names stand right of the circles, the lines get shorter to the right, so no name meets a line. */
function acrossSide(box: Box, side: Side, index: number, count: number, width: number) {
  const from = sidePoint(box, side, box.x + box.width * ((index + 1) / (count + 1))),
    center = { x: from.x, y: from.y + outwardOf(side) * (STUB + (count - 1 - index) * STEP) };
  return {
    from,
    center,
    label: { x: center.x + CHANNEL / 2 + MARKER_GAP, y: center.y - 8, width, height: 16 },
  };
}

/** An interface on the left or right: names stand above the circles, every other line reaches past the name before. */
function alongSide(box: Box, side: Side, index: number, count: number, width: number) {
  const from = sidePoint(box, side, box.y + box.height * ((index + 1) / (count + 1))),
    center = { x: from.x + outwardOf(side) * (STUB + (index % 2) * (width / 2 + STEP)), y: from.y };
  return {
    from,
    center,
    label: {
      x: center.x - width / 2,
      y: center.y - CHANNEL / 2 - MARKER_GAP - 16,
      width,
      height: 16,
    },
  };
}

const outwardOf = (side: Side) => (side === "bottom" || side === "right" ? 1 : -1);

/** Whether the interfaces on a side stand clear of every other element and inside the container's room. */
function standsFree(
  placing: Placing,
  owner: string,
  edges: TamEdge[],
  side: Side,
  room: Box | undefined,
): boolean {
  const box = placing.boxes.get(owner)!;
  const clear = (item: Box) =>
    (!room || inside(item, room, -CLEAR)) &&
    ![...placing.boxes].some(
      ([id, other]) =>
        id !== owner && !isRow(id) && !inside(box, other) && overlaps(grow(item, CLEAR), other),
    );
  return interfacesOn(placing, owner, edges, side).every(({ circle, label, name }) =>
    [circle, ...(name ? [label] : [])].every(clear),
  );
}
