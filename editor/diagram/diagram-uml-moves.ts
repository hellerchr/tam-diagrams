// Moving the parts of a UML diagram on the diagram editor's canvas (diagram-uml.ts): dragging, dropping into groups,
// arranging, laying out again and sizing lanes. A UML diagram lays itself out until a part is moved: the first move pins
// every part where the automatic layout shows it (`%% @id x,y`, uml-places.ts), then the places of what moves change;
// a sequence diagram's participants and messages are put in another order instead.
import { parseUml } from "../../src/index.ts";
import { placeable, placesOf } from "../../src/uml-placed.ts";
import {
  hasPlaces,
  readLabels,
  readPlaces,
  setLabel,
  setLane,
  setPlaces,
  unplaced,
} from "../../src/uml-places.ts";
import { moveMessageTo, moveParticipant } from "../../src/uml-sequence-edit.ts";
import { type Arrangement, arrange } from "./diagram-arrange.ts";
import { holderAt, middle, type Part, type Point, shift } from "./diagram-hit.ts";
import { movingShapes, reorderSteps, shiftedPlaces } from "./diagram-uml-hits.ts";
import { followed, outermost, parentsOf, pinned, type UmlModel } from "./diagram-uml-model.ts";

/** The places of the shapes that move with the parts `ids`, where the picture shows them. */
function placesMoving(m: UmlModel, ids: string[]): Map<string, Point> {
  const all = placesOf(m.scene);
  const shapes = movingShapes(placeable(m.scene), parentsOf(m), ids);
  return new Map(
    shapes.flatMap((shape) => (all.has(shape) ? [[shape, all.get(shape)!] as const] : [])),
  );
}

/** A placed source with the parts `ids`, and all they hold, moved by `delta`. */
function shifted(m: UmlModel, base: string, ids: string[], delta: Point): string {
  return setPlaces(base, shiftedPlaces(placesMoving(m, ids), delta));
}

/**
 * Moves parts by `delta`, into `holder` when given (null: out of every group). The first move places every part where
 * it stands. In a sequence diagram laid out automatically a participant changes its column instead: as many as its
 * middle passed. A part that cannot stand in the group stays in its own, where it was dropped.
 */
export function moved(m: UmlModel, ids: string[], delta: Point, holder?: string | null): string {
  if (m.kind === "sequence" && !hasPlaces(m.source)) return reordered(m, ids[0], delta.x);
  const outer = outermost(m, ids);
  const placed = shifted(m, pinned(m), outer, m.kind === "sequence" ? { x: delta.x, y: 0 } : delta);
  if (holder === undefined || !m.structure.moveInto) return placed;
  try {
    const next = outer.reduce(
      (source, id) => m.structure.moveInto?.(source, id, holder) ?? source,
      placed,
    );
    parseUml(next);
    return followed(m, placed, next);
  } catch {
    return placed;
  }
}

/** The heads of a sequence diagram's participants, in their order, with their boxes. */
const headMiddles = (m: UmlModel) =>
  m.nodes
    .filter((n) => n.id.startsWith("head:"))
    .map((n) => ({ id: n.id, box: m.hits.elements.find((e) => e.id === n.id)?.box }));

/** A sequence diagram with the participant `id` moved across as many columns as dragging it by `dx` passes. */
function reordered(m: UmlModel, id: string | undefined, dx: number): string {
  const heads = headMiddles(m).filter((h) => h.box);
  const index = heads.findIndex((h) => h.id === id);
  if (!id || index < 0) return m.source;
  const middles = heads.map((h) => middle(h.box!).x);
  return repeat(m.source, reorderSteps(middles, index, middles[index]! + dx), (source, step) =>
    moveParticipant(source, id, step),
  );
}

/** `source` stepped `steps` times, one place at a time, the way the sign of `steps` says. */
function repeat(
  source: string,
  steps: number,
  step: (source: string, delta: -1 | 1) => string,
): string {
  let next = source;
  for (let i = 0; i < Math.abs(steps); i++) next = step(next, steps < 0 ? -1 : 1);
  return next;
}

/** A sequence diagram with the message `id` moved past as many messages as dragging it by `dy` passes; with its id. */
export function messageMoved(
  m: UmlModel,
  id: string,
  dy: number,
): { source: string; edge: string } {
  const rows = m.edges.flatMap((edge) => {
    const wire = m.hits.wires.find((w) => w.id === edge.id);
    return wire?.points[0] ? [{ id: edge.id, y: wire.points[0].y }] : [];
  });
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return { source: m.source, edge: id };
  let moved = { source: m.source, edge: id };
  const steps = reorderSteps(
    rows.map((row) => row.y),
    index,
    rows[index]!.y + dy,
  );
  for (let i = 0; i < Math.abs(steps); i++)
    moved = moveMessageTo(moved.source, moved.edge, steps < 0 ? -1 : 1);
  return moved;
}

/** A sequence diagram with a participant a column, or a message a step, earlier (−1) or later (1): the arrow keys. */
export function stepped(m: UmlModel, part: Part, delta: -1 | 1): string {
  if (part.type === "wire") return moveMessageTo(m.source, part.id, delta).source;
  return moveParticipant(m.source, part.id, delta);
}

/** The group parts moved by `delta` land in when it is another than theirs (null: none), else undefined; undefined
 *  too where the type moves no parts between groups. */
export function dropHolder(m: UmlModel, ids: string[], delta: Point): string | null | undefined {
  if (!m.structure.moveInto || m.kind === "sequence") return undefined;
  const outer = outermost(m, ids);
  const box = m.hits.elements.find((e) => e.id === outer[0])?.box;
  if (!box) return undefined;
  const inner = new Set(
    movingShapes(
      m.nodes.map((n) => n.id),
      parentsOf(m),
      outer,
    ),
  );
  const target = holderAt(m.hits, middle(shift(box, delta)), inner);
  const homes = new Set(outer.map((id) => m.parts.get(id)?.parent ?? null));
  return homes.size === 1 && homes.has(target) ? undefined : target;
}

/** Aligns the parts `ids` on a side or middle of the box around them, or spreads them; participants keep their row. */
export function arranged(m: UmlModel, ids: string[], how: Arrangement): string {
  const boxes = new Map(
    outermost(m, ids).flatMap((id) => {
      const box = m.hits.elements.find((e) => e.id === id)?.box;
      return box ? [[id, box] as const] : [];
    }),
  );
  let source = pinned(m);
  for (const [id, step] of arrange(boxes, how))
    source = setPlaces(
      source,
      shiftedPlaces(placesMoving(m, [id]), m.kind === "sequence" ? { ...step, y: 0 } : step),
    );
  return source;
}

/** The source without places of parts and labels: laid out automatically again (lanes keep their widths). */
export const laidOut = (m: UmlModel) => unplaced(m.source);

/** Whether the source places its parts by hand. */
export const placed = (m: UmlModel) => hasPlaces(m.source);

/** Gives the lane at `index` of an activity with lanes the width `width`; placed parts of the lanes after it move with
 *  its border, so they keep their place in their lane. */
export function laneSized(m: UmlModel, index: number, width: number): string {
  const lanes = m.lanes;
  const id = lanes?.ids[index];
  if (!lanes || !id) return m.source;
  const step = width - (lanes.bounds[index + 1]! - lanes.bounds[index]!);
  const after = new Set(lanes.ids.slice(index + 1));
  const places = readPlaces(m.source);
  const moved = new Map(
    [...places].flatMap(([part, at]) =>
      after.has(m.parts.get(part)?.parent ?? undefined)
        ? [[part, { ...at, [lanes.across]: at[lanes.across] + step }] as const]
        : [],
    ),
  );
  const sized = setLane(m.source, id, Math.max(1, Math.round(width)));
  return moved.size ? setPlaces(sized, moved) : sized;
}

/** The label of the join placed by `key` set `offset` from the middle of its line; back where the layout puts it
 *  without one. */
export const labelMoved = (m: UmlModel, key: string, offset: Point | undefined) =>
  setLabel(m.source, key, offset);

/** Whether the label of the join placed by `key` stands where the source places it. */
export const labelPlaced = (m: UmlModel, key: string) => readLabels(m.source).has(key);
