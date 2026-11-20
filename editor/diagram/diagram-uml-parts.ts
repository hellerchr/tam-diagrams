// The diagram editor's edits of a UML diagram's structure (diagram-uml.ts), as the old editor made them: adding a
// piece (dropped on a group it stands inside, on a part it is joined to where the type has such a join), joining two
// parts with a kind of join, naming a part or labelling a join, removing, changing a join's kind or direction,
// duplicating, ungrouping, another id, and a class's members and an entity's attributes. The places of the parts follow
// every edit.
import type { Piece, StructureEdge, StructureNode } from "../../src/structure.ts";
import { classMembers, setClassMembers } from "../../src/uml-class-edit.ts";
import { erAttributes, setErAttributes } from "../../src/uml-er-edit.ts";
import { hasPlaces, setPlaces } from "../../src/uml-places.ts";
import { inBox, partAt, type Part, type Point } from "./diagram-hit.ts";
import { lifelineAt } from "./diagram-uml-hits.ts";
import { followed, outermost, type UmlModel } from "./diagram-uml-model.ts";

/** Whether a piece joins a part of its kind by its own join. */
const joinsTo = (piece: Piece, node: StructureNode) =>
  !!piece.joins && (!piece.joinsTo || piece.joinsTo.includes(node.kind));

/** Whether a piece added at a group stands at it, not in it: one without a name that joins a group (a composite's end). */
const standsBeside = (piece: Piece, node: StructureNode) =>
  node.group && !piece.named && joinsTo(piece, node);

/** Whether a part takes a piece dropped on it: the piece stands in it, or is joined to it. */
const takes = (m: UmlModel, node: StructureNode, piece: Piece) =>
  !piece.group &&
  (node.group || piece.kind === "note" || m.kind === "sequence" || joinsTo(piece, node));

const pieceOf = (m: UmlModel, kind: string) =>
  m.structure.pieces.find((piece) => piece.kind === kind);

/** The part a piece of `kind` dropped at `at` stands in or is joined to: the one under it (in a sequence diagram the
 *  lifeline there too) when it takes the piece; else null, and it stands alone. */
export function pieceTarget(m: UmlModel, kind: string, at: Point): string | null {
  const piece = pieceOf(m, kind);
  // A sequence diagram's note follows a message, a fragment frames it.
  const message =
    m.kind === "sequence" ? partAt({ elements: [], wires: m.hits.wires }, at, 4)?.id : undefined;
  if (message && piece && (piece.kind === "note" || (piece.group && piece.kind !== "box")))
    return message;
  const hit =
    partAt({ elements: m.hits.elements, wires: [] }, at, 0)?.id ??
    (m.kind === "sequence" ? lifelineAt(m.hits, at) : undefined);
  const node = hit === undefined ? undefined : m.parts.get(hit);
  return piece && node && takes(m, node, piece) ? node.id : null;
}

/** The lane of an activity with lanes at `at`. */
const laneAt = (m: UmlModel, at: Point) =>
  m.hits.elements.find((e) => m.parts.get(e.id)?.kind === "lane" && inBox(e.box, at))?.id;

/** Where a piece added at `node` stands: the group it goes in (a note and a participant take the part itself), and
 *  whether it is joined to the part. Without a part it stands alone, in `lane`. */
function standing(
  m: UmlModel,
  piece: Piece,
  node: StructureNode | undefined,
  lane: string | undefined,
) {
  if (!node) return { parent: lane ?? null, joins: false };
  const beside = standsBeside(piece, node);
  const own = piece.kind === "note" || m.kind === "sequence" || (node.group && !beside);
  return {
    parent: own ? node.id : (node.parent ?? lane ?? null),
    joins: (!node.group || beside) && !piece.group && joinsTo(piece, node),
  };
}

/** Where a piece is added: around `at`, at the part `target` (null: alone; undefined: the one part `selected`). */
export type AddedAt = { at?: Point; target?: string | null; selected?: string };

/**
 * Adds a piece of `kind`: at the part `target` (null: alone; undefined: the one part `selected`), inside it when it is
 * a group, else joined to it as the piece joins (a step follows, a start leads) and in its group. Where the parts are
 * placed it stands at `at`. With the id it got.
 */
export function added(m: UmlModel, kind: string, where: AddedAt): { source: string; id: string } {
  const piece = pieceOf(m, kind);
  if (!piece) throw new Error(`A ${m.kind} diagram has no ${kind}.`);
  const refused = m.structure.refusal?.(m.source, kind);
  if (refused) throw new Error(`${refused}.`);
  const { node, stand } = standingAt(m, piece, where);
  const made = m.structure.add(m.source, { kind, parent: stand.parent });
  if (!made.id || made.source === m.source)
    throw new Error(`${piece.name} stands at another part: select one first, or drop it onto one.`);
  let next = made.source;
  if (stand.joins && node)
    next =
      piece.joins === "before"
        ? m.structure.connect(next, made.id, node.id)
        : m.structure.connect(next, node.id, made.id);
  if (where.at && hasPlaces(made.source))
    next = setPlaces(
      next,
      new Map([[made.id, { x: Math.round(where.at.x - 48), y: Math.round(where.at.y - 18) }]]),
    );
  return { source: followed(m, m.source, next), id: made.id };
}

/** Adds a piece of `kind` joined from the part `from` (a connection dropped on the empty canvas), in its group, at `at`
 *  where the parts are placed; with the join of `link` (the type's usual one without). With the id it got. */
export function addedJoined(
  m: UmlModel,
  kind: string,
  { from, at, link }: { from: string; at: Point; link?: string },
): { source: string; id: string } {
  const refused = m.structure.refusal?.(m.source, kind);
  if (refused) throw new Error(`${refused}.`);
  const made = m.structure.add(m.source, { kind, parent: m.parts.get(from)?.parent ?? null });
  if (!made.id) throw new Error("This part cannot be added here.");
  let next = m.structure.connect(made.source, from, made.id, link);
  if (hasPlaces(made.source))
    next = setPlaces(
      next,
      new Map([[made.id, { x: Math.round(at.x - 48), y: Math.round(at.y - 18) }]]),
    );
  return { source: followed(m, m.source, next), id: made.id };
}

/** The part a piece is added at, the group it goes in and whether it is joined to the part. A sequence diagram's
 *  message takes a note after it, or a fragment around it. */
function standingAt(m: UmlModel, piece: Piece, { at, target, selected }: AddedAt) {
  const chosen = (target === undefined ? selected : target) ?? "";
  const node = m.parts.get(chosen);
  if (m.kind === "sequence" && m.joins.has(chosen))
    return { node, stand: { parent: chosen, joins: false } };
  return {
    node,
    stand: standing(m, piece, node, at && m.kind === "swimlane" ? laneAt(m, at) : undefined),
  };
}

/** What a join says: its ends and its kind. */
const says = (edge: StructureEdge) => `${edge.source}\u0000${edge.target}\u0000${edge.kind}`;

/** The join an edit made: the last of the joins that say something more often than before. */
function madeJoin(before: StructureEdge[], after: StructureEdge[]): StructureEdge | undefined {
  const count = (edges: StructureEdge[], edge: StructureEdge) =>
    edges.filter((other) => says(other) === says(edge)).length;
  return after.findLast((edge) => count(after, edge) > count(before, edge));
}

/** Joins two parts with a join of `kind` (the type's usual one without), after the join `after` in a diagram whose joins
 *  are ordered; with the id of the join it made. */
export function connected(
  m: UmlModel,
  from: string,
  to: string,
  how: { kind?: string; after?: string } = {},
): { source: string; edge?: string } {
  const { structure } = m;
  const { kind, after } = how;
  const joined = structure.join ? structure.join(m.source, from, to, kind, after) : undefined;
  const source = joined?.source ?? structure.connect(m.source, from, to, kind);
  if (source === m.source)
    throw new Error(
      m.edges.some((e) => e.source === from && e.target === to)
        ? "These two are joined that way already."
        : "These two cannot be joined that way.",
    );
  const edge = joined?.edge ?? madeJoin(m.edges, structure.read(source).edges)?.id;
  return { source: followed(m, m.source, source), edge };
}

/** Removes parts with their joins, groups with what they hold, and joins. */
export const removed = (m: UmlModel, parts: Part[]) =>
  followed(
    m,
    m.source,
    m.structure.remove(
      m.source,
      parts.map((part) => part.id),
    ),
  );

/** The name of a part, or the label of a join. */
export const labelOf = (m: UmlModel, part: Part) =>
  (part.type === "wire" ? m.joins.get(part.id)?.label : m.parts.get(part.id)?.label) ?? "";

/** Whether a part carries a name to type (a start or a fork does not), or a join a label (one whose text says its kind
 *  does not). */
export function named(m: UmlModel, part: Part): boolean {
  if (part.type === "wire") return !!m.joins.get(part.id) && !m.joins.get(part.id)?.fixedLabel;
  const kind = m.parts.get(part.id)?.kind;
  const piece = kind && pieceOf(m, kind);
  return !!kind && (!piece || !!piece.named);
}

/** Names a part or labels a join; a part just added (`fresh`) takes its id from its first name where the syntax allows.
 *  With the id the part has afterwards. */
export function renamed(
  m: UmlModel,
  part: Part,
  label: string,
  fresh: boolean,
): { source: string; id: string } {
  const { structure, source } = m;
  if (part.type === "wire")
    return { source: followed(m, source, structure.label(source, part.id, label)), id: part.id };
  if (!fresh || !structure.retitle || !label.trim())
    return { source: followed(m, source, structure.rename(source, part.id, label)), id: part.id };
  const made = structure.retitle(source, part.id, label);
  return { source: followed(m, source, made.source), id: made.id || part.id };
}

/** Whether the type has one of the edits not every type has. */
export const can = (m: UmlModel, edit: "reverse" | "copy" | "moveInto" | "ungroup" | "reid") =>
  !!m.structure[edit];

/** Swaps the ends of a join. */
export function reversed(m: UmlModel, id: string): string {
  const next = m.structure.reverse?.(m.source, id) ?? m.source;
  if (next === m.source) throw new Error("This connection has only one way to run.");
  return followed(m, m.source, next);
}

/** The kind of a join, one of the type's links. */
export const linkOf = (m: UmlModel, id: string) => m.joins.get(id)?.kind;

/** Makes the joins `ids` of another kind. */
export const relinked = (m: UmlModel, ids: string[], kind: string) =>
  followed(
    m,
    m.source,
    ids.reduce((source, id) => m.structure.relink(source, id, kind), m.source),
  );

/** Copies the parts `ids` with what they hold, without their joins; placed beside their originals where parts are placed. */
export function duplicated(m: UmlModel, ids: string[]): { source: string; ids: string[] } {
  const { structure } = m;
  if (!structure.copy) throw new Error("The parts of this diagram cannot be copied.");
  const made: string[] = [];
  const places = new Map<string, Point>();
  let next = m.source;
  for (const id of outermost(m, ids)) {
    const result = structure.copy(next, id);
    next = result.source;
    if (!result.id) continue;
    made.push(result.id);
    const box = m.hits.elements.find((e) => e.id === id)?.box;
    if (box && hasPlaces(m.source))
      places.set(result.id, { x: Math.round(box.x + box.width + 24), y: Math.round(box.y) });
  }
  if (!made.length) throw new Error("This part cannot be copied.");
  return { source: followed(m, m.source, places.size ? setPlaces(next, places) : next), ids: made };
}

/** Removes a group and keeps what it holds. */
export const ungrouped = (m: UmlModel, id: string) =>
  followed(m, m.source, m.structure.ungroup?.(m.source, id) ?? m.source);

/** Gives a part another id, at every mention; with the id it has afterwards (the one not there before). */
export function reided(m: UmlModel, id: string, next: string): { source: string; id: string } {
  const result = m.structure.reid?.(m.source, id, next.trim()) ?? m.source;
  if (result === m.source) throw new Error(`\`${next.trim()}\` is taken, or is no id.`);
  const now = m.structure.read(result).nodes.find((node) => !m.parts.has(node.id))?.id ?? id;
  return { source: followed(m, m.source, result), id: now };
}

/** The attributes and operations of a class, one a line; undefined for anything else. */
export function membersOf(m: UmlModel, id: string): string[] | undefined {
  const kind = m.parts.get(id)?.kind;
  if (m.kind !== "class" || !kind || kind === "note" || kind === "package" || kind === "lollipop")
    return undefined;
  return classMembers(m.source, id);
}

/** A class with these attributes and operations. */
export const withMembers = (m: UmlModel, id: string, members: string[]) =>
  setClassMembers(m.source, id, members);

/** The attributes of an entity, one a line; undefined for anything else. */
export const attributesOf = (m: UmlModel, id: string) =>
  m.kind === "er" && m.parts.has(id) ? erAttributes(m.source, id) : undefined;

/** An entity with these attributes. */
export const withAttributes = (m: UmlModel, id: string, attributes: string[]) =>
  setErAttributes(m.source, id, attributes);
