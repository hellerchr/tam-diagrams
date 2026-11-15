/** Turning a layout into placements: every element stays where the picture shows it, written into the source. */

import { type Box, centerOf, type Scene } from "./scene.ts";
import { ELEMENT_KINDS, parseTam, type Placement, type TamDiagram, type TamNode } from "./tam.ts";
import type { Measure } from "./text.ts";
import { place } from "./tam-edit.ts";
import { layoutPlaced } from "./tam-layout.ts";

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
  const placed = place(source, places);
  // Leaves that came out smaller move to the middle of where they were.
  const again = elementBoxes(parseTam(placed), layoutPlaced(parseTam(placed), measure));
  for (const [id, box] of again) {
    const was = drawn.get(id)!,
      at = places.get(id)!;
    if (at.width !== undefined) continue;
    places.set(id, {
      x: Math.round(at.x + centerOf(was).x - centerOf(box).x),
      y: Math.round(at.y + centerOf(was).y - centerOf(box).y),
    });
  }
  return place(source, places);
}
