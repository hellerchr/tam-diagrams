// What the diagram's Properties (DiagramProperties.svelte) offer for a part or a join of a Mermaid UML diagram, besides
// its name and kind (diagram-uml-editor.svelte.ts): what a type adds, as tam-diagrams' old inspector had it. A class's
// stereotype and a state's description; a class relation's multiplicities, an ER relationship's cardinalities and
// whether it identifies; a sequence message's reply and activation. Each edit is a whole new source with the places
// following; re-exported by diagram-props.ts.
import {
  classRelationEnds,
  classStereotype,
  setClassMultiplicity,
  setClassStereotype,
} from "../../src/uml-class-edit.ts";
import type { Cardinality } from "../../src/uml-er.ts";
import { erRelationshipEnds, setErCardinality, setErIdentifying } from "../../src/uml-er-edit.ts";
import { replyTo, toggleActivation } from "../../src/uml-sequence-edit.ts";
import { setStateDescription, stateDescription } from "../../src/uml-state-edit.ts";
import { followed, type UmlModel } from "./diagram-uml-model.ts";

export type { Cardinality };
export type End = "from" | "to";

/** What `get` reads; undefined while the source does not read so. */
export function tried<T>(get: () => T): T | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}

/** The cardinalities of an end of a relationship, as the Properties name them. */
export const CARDINALITIES: { value: Cardinality; name: string }[] = [
  { value: "only-one", name: "Exactly one" },
  { value: "zero-or-one", name: "Zero or one" },
  { value: "one-or-more", name: "One or more" },
  { value: "zero-or-more", name: "Zero or more" },
];

/** The id of a part as the source writes it: the scene's has a prefix where a shape needs one. */
export const shownId = (id: string) => id.replace(/^(head|ns):/, "");

/** `m`'s source changed by `change`, the places following. */
const amended = (m: UmlModel, change: (source: string) => string) =>
  followed(m, m.source, change(m.source));

/** A class's stereotype (`interface`, `abstract`); "" for none. */
export const stereotypeOf = (m: UmlModel, id: string) => classStereotype(m.source, id);
export const withStereotype = (m: UmlModel, id: string, text: string) =>
  amended(m, (s) => setClassStereotype(s, id, text));

/** What a state does (`entry / …`). */
export const doesOf = (m: UmlModel, id: string) => stateDescription(m.source, id);
export const withDoes = (m: UmlModel, id: string, text: string) =>
  amended(m, (s) => setStateDescription(s, id, text));

/** The multiplicities at the ends of a class relation; undefined for another join. */
export function multiplicities(m: UmlModel, id: string): Record<End, string> | undefined {
  const ends = m.kind === "class" ? classRelationEnds(m.source, id) : undefined;
  return ends && { from: ends.fromMultiplicity, to: ends.toMultiplicity };
}
export const withMultiplicity = (m: UmlModel, id: string, end: End, text: string) =>
  amended(m, (s) => setClassMultiplicity(s, id, end, text));

/** The cardinalities at the ends of an ER relationship and whether it identifies; undefined for another join. */
export function cardinalities(
  m: UmlModel,
  id: string,
): (Record<End, Cardinality> & { identifying: boolean }) | undefined {
  const ends = m.kind === "er" ? erRelationshipEnds(m.source, id) : undefined;
  return (
    ends && { from: ends.fromCardinality, to: ends.toCardinality, identifying: ends.identifying }
  );
}
export const withCardinality = (m: UmlModel, id: string, end: End, cardinality: Cardinality) =>
  amended(m, (s) => setErCardinality(s, id, end, cardinality));
export const withIdentifying = (m: UmlModel, id: string, identifying: boolean) =>
  amended(m, (s) => setErIdentifying(s, id, identifying));

/** A sequence message with its reply after it, and with its activation turned on or off. */
export const withReply = (m: UmlModel, id: string) => amended(m, (s) => replyTo(s, id).source);
export const withActivation = (m: UmlModel, id: string) =>
  amended(m, (s) => toggleActivation(s, id));

/** The kinds a join's Kind list offers and the one it is ("" for one that is no usual kind: "Other"); undefined where
 *  the list shows not: a type with one kind of join, or a join of a kind only read (an ER relationship still takes one). */
export function joinKinds(
  m: UmlModel,
  id: string,
): { kinds: { value: string; name: string }[]; value: string } | undefined {
  const { links } = m.structure;
  const kind = m.joins.get(id)?.kind;
  const known = links.some((link) => link.kind === kind);
  if (links.length < 2 || !(known || m.kind === "er")) return undefined;
  return {
    kinds: links.map((link) => ({ value: link.kind, name: link.name })),
    value: known ? kind! : "",
  };
}

/** The name of the piece a part is, as the palette says it; undefined for a kind that is only read. */
export const pieceName = (m: UmlModel, id: string) => {
  const kind = m.parts.get(id)?.kind;
  return m.structure.pieces.find((piece) => piece.kind === kind)?.name;
};
