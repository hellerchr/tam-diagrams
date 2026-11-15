/** Turning a layout into placements: every element stays where the picture shows it, written into the source. */

import { type Box, centerOf, overlaps, type Scene } from "./scene.ts";
import { ELEMENT_KINDS, parseTam, type Placement, type TamDiagram, type TamNode } from "./tam.ts";
import type { Measure } from "./text.ts";
import type { ElkLayout } from "./elk.ts";
import { copyOf, place, unplace } from "./tam-edit.ts";
import { bestLayout, layoutPlaced } from "./tam-layout.ts";

/** The elements a source declares: no copies, rows, dots, channels or interfaces. */
export const declaredElements = (diagram: TamDiagram): TamNode[] =>
  [...diagram.nodes.values()].filter(
    (node) =>
      (ELEMENT_KINDS as readonly string[]).includes(node.kind) &&
      !node.id.endsWith("#row") &&
      (!node.origin || node.origin === node.id),
  );

/** Where a scene draws each declared element. */
export function elementBoxes(diagram: TamDiagram, scene: Scene): Map<string, Box> {
  const drawn = new Map(scene.shapes.map((shape) => [shape.id, shape.box]));
  return new Map(
    declaredElements(diagram).flatMap((node) =>
      drawn.has(node.id) ? [[node.id, drawn.get(node.id)!] as [string, Box]] : [],
    ),
  );
}

/**
 * Places every element of a source where `scene`, a layout of it, draws it. Containers keep their
 * size; a leaf keeps its middle, since an automatic layout grows leaves for their connections and
 * a placed one takes the size of its name. Positions are whole numbers.
 */
export function pin(source: string, scene: Scene, measure: Measure): string {
  const diagram = parseTam(source),
    drawn = elementBoxes(diagram, scene),
    places = new Map<string, Placement>();
  for (const [id, box] of drawn) {
    const sized = diagram.nodes.get(id)!.children.length > 0;
    places.set(id, {
      x: Math.round(box.x),
      y: Math.round(box.y),
      ...(sized ? { width: Math.round(box.width), height: Math.round(box.height) } : {}),
    });
  }
  // The copy of an element shown as several stays where the layout drew it, too.
  const boxOf = new Map(scene.shapes.map((shape) => [shape.id, shape.box]));
  const copies = [...drawn.keys()].filter((id) => boxOf.has(`${id}#2`));
  for (const id of copies) {
    const box = boxOf.get(`${id}#2`)!;
    places.set(`${id}#2`, { x: Math.round(box.x), y: Math.round(box.y) });
  }
  const placed = place(source, places);
  // Leaves that came out smaller move to the middle of where they were, and their copies with them.
  const again = elementBoxes(parseTam(placed), layoutPlaced(parseTam(placed), measure));
  for (const [id, box] of again) {
    const was = drawn.get(id)!,
      at = places.get(id)!;
    if (at.width !== undefined) continue;
    const dx = centerOf(was).x - centerOf(box).x,
      dy = centerOf(was).y - centerOf(box).y;
    places.set(id, { x: Math.round(at.x + dx), y: Math.round(at.y + dy) });
    const copy = places.get(`${id}#2`);
    if (copy) places.set(`${id}#2`, { x: Math.round(copy.x + dx), y: Math.round(copy.y + dy) });
  }
  return place(source, places);
}

/**
 * The elements that lie on each other in a layout: pairs of which neither holds the other. The TAM
 * standard (3.3.5) places all elements non-overlapping; an automatic layout does, a layout by hand
 * may not.
 */
export function overlapping(diagram: TamDiagram, scene: Scene): [string, string][] {
  const kinds = ELEMENT_KINDS as readonly string[];
  const drawn = scene.shapes.filter((shape) => {
    const node = diagram.nodes.get(shape.id);
    return !!node && kinds.includes(node.kind) && !shape.id.endsWith("#row");
  });
  const holds = (outer: string, inner: string) => {
    for (let node = diagram.nodes.get(inner); node?.parent; node = diagram.nodes.get(node.parent))
      if (node.parent === outer) return true;
    return false;
  };
  const pairs: [string, string][] = [];
  drawn.forEach((a, index) => {
    for (const b of drawn.slice(index + 1))
      if (overlaps(a.box, b.box, 0.5) && !holds(a.id, b.id) && !holds(b.id, a.id))
        pairs.push([a.id, b.id]);
  });
  return pairs;
}

/**
 * Lays some elements of a placed source out automatically and leaves the rest where it is: the
 * parts of one element when `ids` names a single element that holds others, else the named elements
 * among themselves. Only they and the connections among them count for the layout; it takes the
 * place they had, from its top left corner. A container laid out this way fits its parts again.
 */
export async function layoutWithin(
  source: string,
  ids: string[],
  measure: Measure,
  layout?: ElkLayout,
): Promise<string> {
  const diagram = parseTam(source),
    declared = new Set(declaredElements(diagram).map((node) => node.id));
  /** The elements an element holds: rows of copies and of dots are no elements. */
  const parts = (id: string): string[] =>
    diagram.nodes
      .get(id)!
      .children.flatMap((child) =>
        child.endsWith("#row") ? parts(child) : declared.has(child) ? [child] : [],
      );
  const named = ids.filter((id) => declared.has(id)),
    [only] = named,
    inside = named.length === 1 && parts(only).length > 0,
    scope = inside ? parts(only) : named;
  if (scope.length < (inside ? 1 : 2)) return source;
  const before = elementBoxes(diagram, layoutPlaced(diagram, measure)),
    stood = scope.flatMap((id) => before.get(id) ?? []);
  if (!stood.length) return source;
  // The elements as a diagram of their own, without their places.
  const fragment = `direction ${diagram.direction}\n${unplace(copyOf(source, scope))}`,
    alone = parseTam(fragment),
    pinned = parseTam(pin(fragment, await bestLayout(alone, measure, layout), measure)),
    after = [...elementBoxes(pinned, layoutPlaced(pinned, measure)).values()];
  const dx = Math.min(...stood.map((box) => box.x)) - Math.min(...after.map((box) => box.x)),
    dy = Math.min(...stood.map((box) => box.y)) - Math.min(...after.map((box) => box.y));
  const places = new Map<string, Placement | undefined>();
  for (const node of pinned.nodes.values())
    if (node.at && diagram.nodes.has(node.id) && !node.id.endsWith("#row"))
      places.set(node.id, {
        ...node.at,
        x: Math.round(node.at.x + dx),
        y: Math.round(node.at.y + dy),
      });
  if (inside) places.set(only, undefined);
  return place(source, places);
}
