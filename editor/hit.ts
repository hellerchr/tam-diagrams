/** What of a picture lies at a point: elements and connections, by the ids the source edits use. */

import type { Box, Point, Scene } from "../src/scene.ts";
import { ELEMENT_KINDS, type TamDiagram } from "../src/tam.ts";
import type { Picture } from "./document.ts";

/** A part of the picture that can be selected: an element by its id, a connection by its edge's. */
export type Part = { type: "element"; id: string } | { type: "wire"; id: string };

export const samePart = (a: Part | undefined, b: Part | undefined) =>
  !!a && !!b && a.type === b.type && a.id === b.id;

export const contains = (box: Box, point: Point, slack = 0) =>
  point.x >= box.x - slack &&
  point.x <= box.x + box.width + slack &&
  point.y >= box.y - slack &&
  point.y <= box.y + box.height + slack;

/** The element a shape of the scene draws: a copy made for `...` is its original. Undefined for marks. */
export function elementOf(diagram: TamDiagram, shape: string): string | undefined {
  const node = diagram.nodes.get(shape);
  if (!node || !(ELEMENT_KINDS as readonly string[]).includes(node.kind) || shape.endsWith("#row"))
    return undefined;
  return node.origin ?? node.id;
}

/** The connection a wire, circle or label of the scene belongs to: copies share their original's. */
export function wireOf(diagram: TamDiagram, owner: string): string | undefined {
  const id = owner.replace(/#node$/, "");
  const edge =
    diagram.edges.find((item) => item.id === id) ??
    // An interface's circle is named after the interface.
    diagram.edges.find(
      (item) => (item.kind === "provided" || item.kind === "required") && item.target === owner,
    );
  return edge?.id.replace(/#\d+$/, "");
}

/** The distance from a point to a segment. */
function distance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
    : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

/** The shapes of a scene that draw elements, innermost first. */
export function elementShapes(picture: Picture) {
  return picture.scene.shapes
    .flatMap((shape) => {
      const id = elementOf(picture.diagram, shape.id);
      return id ? [{ id, shape }] : [];
    })
    .toSorted(
      (a, b) =>
        +a.shape.container - +b.shape.container ||
        b.shape.depth - a.shape.depth ||
        a.shape.box.width * a.shape.box.height - b.shape.box.width * b.shape.box.height,
    );
}

/**
 * The part at a point: a connection's circle, label or line within `reach` first, then the
 * innermost element. Leaves win over the lines that end on them.
 */
export function partAt(picture: Picture, point: Point, reach = 5): Part | undefined {
  const { diagram, scene } = picture;
  const shapes = elementShapes(picture);
  const leaf = shapes.find(({ shape }) => !shape.container && contains(shape.box, point));
  if (leaf) return { type: "element", id: leaf.id };
  for (const shape of scene.shapes) {
    if (shape.kind !== "circle" || !contains(shape.box, point, 3)) continue;
    const id = wireOf(diagram, shape.id);
    if (id) return { type: "wire", id };
  }
  for (const text of scene.texts) {
    if (!text.owner || !["label", "marker"].includes(text.role) || !contains(text.box, point, 2))
      continue;
    const id = wireOf(diagram, text.owner);
    if (id) return { type: "wire", id };
  }
  let nearest: { id: string; distance: number } | undefined;
  for (const wire of scene.wires) {
    const id = wireOf(diagram, wire.edge);
    if (!id) continue;
    for (let index = 1; index < wire.points.length; index++) {
      const away = distance(point, wire.points[index - 1], wire.points[index]);
      if (away <= reach && (!nearest || away < nearest.distance)) nearest = { id, distance: away };
    }
  }
  if (nearest) return { type: "wire", id: nearest.id };
  const container = shapes.find(({ shape }) => contains(shape.box, point));
  return container && { type: "element", id: container.id };
}

/** The boxes an element is drawn in: its own, and its copy's. */
export function boxesOf(picture: Picture, id: string): Box[] {
  return picture.scene.shapes
    .filter((shape) => elementOf(picture.diagram, shape.id) === id)
    .map((shape) => shape.box);
}

/** The first box of an element: the one its placement names. */
export const boxOf = (picture: Picture, id: string): Box | undefined =>
  picture.scene.shapes.find((shape) => shape.id === id)?.box;

/** The lines a connection is drawn with, and the circles on them. */
export function wireParts(scene: Scene, diagram: TamDiagram, id: string) {
  return {
    lines: scene.wires
      .filter((wire) => wireOf(diagram, wire.edge) === id)
      .map((wire) => wire.points),
    circles: scene.shapes
      .filter((shape) => shape.kind === "circle" && wireOf(diagram, shape.id) === id)
      .map((shape) => shape.box),
  };
}

/** The elements whose boxes lie inside a box: what a selection frame catches. */
export function elementsIn(picture: Picture, frame: Box): string[] {
  const inside = (box: Box) =>
    box.x >= frame.x &&
    box.y >= frame.y &&
    box.x + box.width <= frame.x + frame.width &&
    box.y + box.height <= frame.y + frame.height;
  return [
    ...new Set(
      elementShapes(picture)
        .filter(({ shape }) => inside(shape.box))
        .map(({ id }) => id),
    ),
  ];
}

/**
 * The element a dragged element would drop into at a point: the innermost container there, or any
 * element with `leaves`. Elements in `except` (the dragged ones and their parts) do not count.
 */
export function dropTarget(
  picture: Picture,
  point: Point,
  except: Set<string>,
  leaves: boolean,
): string | null {
  const found = elementShapes(picture)
    .filter(
      ({ id, shape }) =>
        !except.has(id) && (shape.container || leaves) && contains(shape.box, point),
    )
    .toSorted(
      (a, b) => a.shape.box.width * a.shape.box.height - b.shape.box.width * b.shape.box.height,
    )[0];
  return found?.id ?? null;
}
