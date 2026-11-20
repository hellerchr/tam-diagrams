// Laying out only what is selected in a block diagram, for the Arrange group of the diagram's Properties
// (DiagramPropsArrange.svelte), as tam-diagrams' old editor did (src/tam-pin.ts layoutWithin): the parts of the one
// selected element that holds others, or several elements among themselves. Only they and the connections among them
// count; the layout takes the place they had, from its top left corner, and a container laid out so fits its parts
// again. Everything else stays where it is. Re-exported by diagram-props.ts.
import type { ElkLayout } from "../../src/elk.ts";
import { type Measure, textMeasure } from "../../src/text.ts";
import { copyOf, place, unplace } from "../../src/tam-edit.ts";
import { bestLayout, layoutPlaced } from "../../src/tam-layout.ts";
import { declaredElements, elementBoxes, pin } from "../../src/tam-pin.ts";
import { parseTam, type Placement, type TamDiagram } from "../../src/tam.ts";

/** The elements a layout within lays out: the parts of the one element `ids` names when it holds others (`inside`),
 *  else the named elements. Rows of copies and of dots are no elements. */
export function layoutScope(
  diagram: TamDiagram,
  ids: string[],
): { scope: string[]; inside?: string } {
  const declared = new Set(declaredElements(diagram).map((node) => node.id));
  const parts = (id: string): string[] =>
    diagram.nodes
      .get(id)!
      .children.flatMap((child) =>
        child.endsWith("#row") ? parts(child) : declared.has(child) ? [child] : [],
      );
  const named = ids.filter((id) => declared.has(id));
  const [only] = named;
  return named.length === 1 && parts(only!).length > 0
    ? { scope: parts(only!), inside: only }
    : { scope: named };
}

/** Whether the selection `ids` can be laid out on its own: one element that holds others, or several elements. */
export function canLayOut(diagram: TamDiagram, ids: string[]): boolean {
  const { scope, inside } = layoutScope(diagram, ids);
  return scope.length >= (inside ? 1 : 2);
}

const measures = new Map<string, Measure>();

/** `source`, whose elements are all placed, with the selection `ids` laid out among itself (see the file's comment) in
 *  the font `font`, by `layout` (ELK); as it is when there is nothing to lay out. */
export async function laidOutWithin(
  source: string,
  ids: string[],
  font: string,
  layout?: ElkLayout,
): Promise<string> {
  let measure = measures.get(font);
  if (!measure) measures.set(font, (measure = textMeasure(font)));
  const diagram = parseTam(source);
  const { scope, inside } = layoutScope(diagram, ids);
  if (scope.length < (inside ? 1 : 2)) return source;
  const before = elementBoxes(diagram, layoutPlaced(diagram, measure, true));
  const stood = scope.flatMap((id) => before.get(id) ?? []);
  if (!stood.length) return source;
  // The elements as a diagram of their own, without their places.
  const fragment = `direction ${diagram.direction}\n${unplace(copyOf(source, scope))}`;
  const alone = parseTam(fragment);
  const pinned = parseTam(pin(fragment, await bestLayout(alone, measure, layout), measure));
  const after = [...elementBoxes(pinned, layoutPlaced(pinned, measure, true)).values()];
  const by = {
    x: Math.min(...stood.map((box) => box.x)) - Math.min(...after.map((box) => box.x)),
    y: Math.min(...stood.map((box) => box.y)) - Math.min(...after.map((box) => box.y)),
  };
  const places = new Map<string, Placement | undefined>();
  for (const node of pinned.nodes.values())
    if (node.at && diagram.nodes.has(node.id) && !node.id.endsWith("#row"))
      places.set(node.id, {
        ...node.at,
        x: Math.round(node.at.x + by.x),
        y: Math.round(node.at.y + by.y),
      });
  if (inside) places.set(inside, undefined);
  return place(source, places);
}
