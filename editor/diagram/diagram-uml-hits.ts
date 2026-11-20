// The plain geometry of a UML diagram on the canvas (diagram-uml.ts): its structure's parts and joins as the boxes and
// lines the editor hits, the lanes of an activity with lanes, what moves with dragged parts, and how many places a
// dragged participant or message moves along its row. No library at run time, so Node tests it.
import type { StructureEdge, StructureNode } from "../../src/structure.ts";
import type { LaneFrame } from "../../src/uml-lanes.ts";
import type { Box, HitElement, Hits, Point } from "./diagram-hit.ts";

/** What a scene shows of a structure: its shapes by id and its wires by the join they draw. */
export type Drawn = {
  shapes: { id: string; box: Box }[];
  wires: { edge: string; points: Point[] }[];
};
/** The parts and joins a structure reads from a source. */
export type Read = { nodes: StructureNode[]; edges: StructureEdge[] };

/** The extra drawings of a part carry its id and one of these endings: a copy, a merge, a decision. */
const DRAWING = /#(\d+|merge\d*|decision\d+)$/;

/** The part a shape draws: itself, or the part of which it is an extra drawing; undefined for anything else. */
export function partOf(shape: string, parts: ReadonlySet<string>): string | undefined {
  if (parts.has(shape)) return shape;
  const base = shape.replace(DRAWING, "");
  return base !== shape && parts.has(base) ? base : undefined;
}

/** The boxes of the named lanes of an activity with lanes: each from its borders across, the frame's along. */
export function laneBoxes(lanes: LaneFrame): { id: string; box: Box }[] {
  const { across, bounds, ids, frame } = lanes;
  return ids.flatMap((id, i) => {
    if (!id) return [];
    const from = bounds[i]!;
    const size = bounds[i + 1]! - from;
    const box =
      across === "x" ? { ...frame, x: from, width: size } : { ...frame, y: from, height: size };
    return [{ id, box }];
  });
}

/** The lane of an activity with lanes whose far border lies within `reach` of `point`: its index, its width, the axis
 *  its width is taken along. A lane without a name has no width of its own to set. */
export function laneBorderAt(lanes: LaneFrame, point: Point, reach: number) {
  const { across, bounds, ids, frame } = lanes;
  const along = across === "x" ? "y" : "x";
  const length = along === "y" ? frame.height : frame.width;
  if (point[along] < frame[along] || point[along] > frame[along] + length) return undefined;
  const index = ids.findIndex((id, i) => !!id && Math.abs(point[across] - bounds[i + 1]!) <= reach);
  return index < 0 ? undefined : { index, width: bounds[index + 1]! - bounds[index]!, across };
}

/** How deep each part is nested: 0 at the top. */
function depths(nodes: StructureNode[]): Map<string, number> {
  const parents = new Map(nodes.map((node) => [node.id, node.parent]));
  const depth = (id: string, seen = 0): number => {
    const parent = parents.get(id);
    return parent && seen < nodes.length ? depth(parent, seen + 1) + 1 : 0;
  };
  return new Map(nodes.map((node) => [node.id, depth(node.id)]));
}

/** The parts and joins of a structure where a scene draws them: every drawing of a part is the part, a lane is the
 *  box between its borders. Parts the scene does not draw are left out. */
export function umlHits(read: Read, scene: Drawn, lanes?: LaneFrame): Hits {
  const ids = new Set(read.nodes.map((node) => node.id));
  const nodes = new Map(read.nodes.map((node) => [node.id, node]));
  const depth = depths(read.nodes);
  const element = (id: string, box: Box): HitElement => {
    const node = nodes.get(id)!;
    return { id, box, depth: depth.get(id) ?? 0, holder: node.group, parent: node.parent };
  };
  const elements = scene.shapes.flatMap((shape) => {
    const id = partOf(shape.id, ids);
    return id ? [element(id, shape.box)] : [];
  });
  for (const lane of lanes ? laneBoxes(lanes) : [])
    if (ids.has(lane.id)) elements.push(element(lane.id, lane.box));
  const joins = new Set(read.edges.map((edge) => edge.id));
  const wires = scene.wires.flatMap((wire) => {
    const id = wire.edge.replace(/#\d+$/, "");
    return joins.has(id) ? [{ id, points: wire.points }] : [];
  });
  return { elements, wires };
}

/** The participant of a sequence diagram whose lifeline runs down through `point`: under its head, in its column. */
export function lifelineAt(hits: Hits, point: Point): string | undefined {
  const head = hits.elements.find(
    (e) =>
      e.id.startsWith("head:") &&
      point.x >= e.box.x &&
      point.x <= e.box.x + e.box.width &&
      point.y >= e.box.y,
  );
  return head?.id;
}

/** The shapes among `placeable` that move with the parts `ids`: theirs and those of everything their groups hold. */
export function movingShapes(
  placeable: string[],
  parents: ReadonlyMap<string, string | null>,
  ids: string[],
): string[] {
  const chosen = new Set(ids);
  const parts = new Set(parents.keys());
  const within = (id: string | null | undefined, seen = 0): boolean =>
    !!id && seen <= parents.size && (chosen.has(id) || within(parents.get(id), seen + 1));
  return placeable.filter((shape) => within(partOf(shape, parts)));
}

/** `places` moved by `delta`, in whole numbers. */
export const shiftedPlaces = (places: ReadonlyMap<string, Point>, delta: Point) =>
  new Map(
    [...places].map(([id, at]) => [
      id,
      { x: Math.round(at.x + delta.x), y: Math.round(at.y + delta.y) },
    ]),
  );

/** How many places an item of a row moves when its middle is dragged to `to`: the others it passed, after (+) or before
 *  (−). `middles` are the row's middles in its order, `index` the item's. */
export function reorderSteps(middles: number[], index: number, to: number): number {
  const before = middles.filter((m, i) => i !== index && m < to).length;
  return before - index;
}
