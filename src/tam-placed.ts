/**
 * TAM layout by hand, first step: every element's box from the placements in the source (`@x,y`).
 * tam-placed-wires.ts routes the connections between the boxes, and tam-scene.ts draws the result
 * like a layout by ELK.
 */

import { type Box, centerOf, type Point } from "./scene.ts";
import type { TamEdge, TamNode } from "./tam.ts";
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

/** The box around boxes. */
export function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x)),
    y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

/** Elements the source does not place stand in rows this wide at most, below the placed ones. */
const ROW = 720;

/** An interface's line reaches this far from its element; each further one on the side reaches STEP less far or further. */
const STUB = 30,
  STEP = 18;

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

/**
 * Places every element: where the source says (`@x,y`, with `WxH` as its least size), and never
 * smaller than its name or its parts need. A container without a placement fits its parts.
 * Elements the source leaves out stand in a row below the placed ones of their container, so a
 * source edited as text shows its new elements at once. Copies (`...`), dots and interfaces follow
 * the elements they belong to.
 */
export function placeElements(prepared: TamGraph, measure: Measure): PlacedElements {
  const { diagram, shapes, vertical } = prepared;
  const boxes = new Map<string, Box>(),
    dots = new Map<string, { center: Point; across: boolean }>(),
    stubs = new Map<string, Point[]>(),
    labels = new Map<string, Box[]>(),
    upright = new Map<string, boolean>();
  const node = (id: string) => diagram.nodes.get(id)!;
  const isRow = (id: string) => id.endsWith("#row");
  /** The second copy of a `...` element follows the first. */
  const isCopy = (item: TamNode) => !!item.origin && item.origin !== item.id;
  const isElement = (item: TamNode) =>
    item.kind !== "dots" && item.kind !== "interface" && item.kind !== "channel" && !isCopy(item);
  /** The elements among `ids`, with the elements of rows in their place: a row is no shape of its own. */
  const elements = (ids: string[]): string[] =>
    ids.flatMap((id) =>
      isRow(id) ? elements(node(id).children) : isElement(node(id)) ? [id] : [],
    );
  const parts = (id: string) => (shapes.get(id)?.container ? elements(node(id).children) : []);
  const anchored = new Map<string, boolean>();
  /** Whether the source places the element or one of its parts, which places the element around it. */
  const isAnchored = (id: string): boolean => {
    if (!anchored.has(id)) anchored.set(id, !!node(id).at || parts(id).some(isAnchored));
    return anchored.get(id)!;
  };
  const shadow = (id: string) => (node(id).stack ? SHADOW : 0);

  /** A leaf at a point, as large as its name and the source ask. */
  const leaf = (id: string, at: Point): Box => {
    const shape = shapes.get(id)!,
      size = leafSize(shape.node, shape.lines, shape.textWidth, measure),
      given = shape.node.at;
    return {
      ...at,
      width: Math.ceil(Math.max(size.width, given?.width ?? 0)) + shadow(id),
      height: Math.ceil(Math.max(size.height, given?.height ?? 0)) + shadow(id),
    };
  };

  /** Places an element with its parts and returns the room it takes with its copy. */
  const place = (id: string, free: Point): Box => {
    const shape = shapes.get(id)!,
      at = shape.node.at ?? free;
    let box: Box;
    if (!shape.container) box = leaf(id, at);
    else {
      const { top, side, minimum } = containerInsets(
        shape.node,
        shape.lines,
        shape.textWidth,
        measure,
      );
      const inner = placeAll(id, { x: at.x + side, y: at.y + top });
      const around = {
        x: inner.x - side,
        y: inner.y - top,
        width: Math.max(inner.width + 2 * side + shadow(id), minimum),
        height: inner.height + top + side + shadow(id),
      };
      const given = shape.node.at;
      box = given
        ? union([
            around,
            {
              x: given.x,
              y: given.y,
              width: Math.max((given.width ?? 0) + shadow(id), minimum),
              height: (given.height ?? 0) + shadow(id),
            },
          ])
        : around;
    }
    boxes.set(id, box);
    // A copy stands beside its original, the dots between them.
    const copy = `${id}#2`;
    if (diagram.nodes.get(copy)?.origin !== id) return box;
    // Where the source places it, or beside the original: across the direction the diagram runs.
    const given = diagram.nodes.get(copy)!.at;
    const second = given
      ? { ...box, x: given.x, y: given.y }
      : vertical
        ? { ...box, x: box.x + box.width + NODE_SPACING }
        : { ...box, y: box.y + box.height + NODE_SPACING };
    boxes.set(copy, second);
    return union([box, second]);
  };

  /** Dots in the gap between two boxes, along the line that joins them. */
  const between = (a: Box, b: Box) => {
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
  };

  /**
   * Places the parts of a container (or the top-level elements): the placed ones first, the others
   * in rows below them, from `free` when nothing is placed. Returns the room they take with their
   * dots and interfaces.
   */
  const placeAll = (parent: string | null, free: Point): Box => {
    const children = parent ? node(parent).children : diagram.roots,
      ids = elements(children);
    const taken = ids.filter(isAnchored).map((id) => place(id, free));
    const placed = taken.length ? union(taken) : undefined;
    const left = placed ? placed.x : free.x;
    let x = left,
      y = placed ? placed.y + placed.height + NODE_SPACING : free.y,
      tallest = 0;
    for (const id of ids.filter((id) => !isAnchored(id))) {
      let box = place(id, { x, y });
      if (x > left && box.x + box.width - left > ROW) {
        x = left;
        y += tallest + NODE_SPACING;
        tallest = 0;
        box = place(id, { x, y });
      }
      taken.push(box);
      x = box.x + box.width + NODE_SPACING;
      tallest = Math.max(tallest, box.height);
    }
    taken.push(...marks(children));
    return taken.length ? union(taken) : { ...free, width: 0, height: 0 };
  };

  /** The dots and interfaces among `ids` (and in their rows), placed by the elements they belong to. */
  const marks = (ids: string[]): Box[] => {
    const taken: Box[] = [];
    const lollipops = new Map<string, TamEdge[]>();
    // A row takes the room of what stands in it, so dots beside a row find it.
    for (const id of ids.filter(isRow)) {
      taken.push(...marks(node(id).children));
      const inside = node(id).children.flatMap((child) => boxes.get(child) ?? []);
      if (inside.length) boxes.set(id, union(inside));
    }
    for (const id of ids) {
      const item = node(id);
      if (item.kind === "interface") {
        const edge = diagram.edges.find((edge) => edge.target === id);
        if (edge && boxes.has(edge.source))
          lollipops.set(edge.source, [...(lollipops.get(edge.source) ?? []), edge]);
      } else if (item.kind === "dots") {
        // Between the elements declared before and after it, or past the one it follows.
        const index = ids.indexOf(id);
        const before = ids.slice(0, index).findLast((other) => boxes.has(other)),
          after = ids.slice(index + 1).find((other) => boxes.has(other));
        const beside = before ?? after;
        if (!beside) continue;
        const box = boxes.get(beside)!,
          away = before ? 1 : -1;
        const spot =
          before && after
            ? between(box, boxes.get(after)!)
            : {
                across: vertical,
                center: vertical
                  ? { x: centerOf(box).x + away * (box.width / 2 + DOTS), y: centerOf(box).y }
                  : { x: centerOf(box).x, y: centerOf(box).y + away * (box.height / 2 + DOTS) },
              };
        dots.set(id, spot);
        taken.push({ x: spot.center.x - 8, y: spot.center.y - 8, width: 16, height: 16 });
      }
    }
    // Interfaces leave their element on the side the diagram runs toward, each on a line of its own.
    const side: Side = { TB: "bottom", BT: "top", LR: "right", RL: "left" }[
      diagram.direction
    ] as Side;
    const out = side === "bottom" || side === "right" ? 1 : -1;
    for (const [owner, edges] of lollipops) {
      const box = boxes.get(owner)!;
      edges.forEach((edge, index) => {
        const share = (index + 1) / (edges.length + 1),
          name = node(edge.target).label,
          width = name ? Math.ceil(measure(name, SMALL, 400)) : 0;
        let from: Point, center: Point, room: Box | undefined;
        if (lies(side)) {
          // Names stand right of the circles: the lines get shorter to the right, so no name meets a line.
          from = sidePoint(box, side, box.x + box.width * share);
          center = { x: from.x, y: from.y + out * (STUB + (edges.length - 1 - index) * STEP) };
          room = { x: center.x + CHANNEL / 2 + MARKER_GAP, y: center.y - 8, width, height: 16 };
        } else {
          from = sidePoint(box, side, box.y + box.height * share);
          center = { x: from.x + out * (STUB + (index % 2) * (width / 2 + STEP)), y: from.y };
          room = {
            x: center.x - width / 2,
            y: center.y - CHANNEL / 2 - MARKER_GAP - 16,
            width,
            height: 16,
          };
        }
        const circle = {
          x: center.x - CHANNEL / 2,
          y: center.y - CHANNEL / 2,
          width: CHANNEL,
          height: CHANNEL,
        };
        boxes.set(edge.target, circle);
        stubs.set(edge.id, [from, center]);
        upright.set(edge.target, lies(side));
        if (name) labels.set(edge.target, [room]);
        taken.push(circle, ...(name ? [room] : []));
      });
    }
    return taken;
  };

  placeAll(null, { x: 0, y: 0 });
  return { boxes, dots, stubs, labels, upright };
}
