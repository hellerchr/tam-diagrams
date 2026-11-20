// The model of a Mermaid UML diagram on the diagram editor's canvas (diagram-uml.ts): the source with its picture and
// its structure's parts and joins where the picture draws them, and what every edit of it shares: the check that the
// result still reads, the places following the parts, the source with every part pinned where it shows.
import { detectUml, parseUml, type Scene, textMeasure, type UmlKind } from "../../src/index.ts";
import type { Structure, StructureEdge, StructureNode } from "../../src/structure.ts";
import { laneFrame, type LaneFrame } from "../../src/uml-lanes.ts";
import { keepAutomatic, placesOf } from "../../src/uml-placed.ts";
import { followPlaces, hasMarks, hasPlaces, prunePlaces, setPlaces } from "../../src/uml-places.ts";
import { errorText } from "../shared/errors.ts";
import type { Hits } from "./diagram-hit.ts";
import { wireLabels } from "./diagram-labels.ts";
import { umlHits } from "./diagram-uml-hits.ts";
import { structureOf } from "./diagram-uml-structures.ts";

/** A UML source with its picture: its structure's parts and joins, where the picture draws them. */
export type UmlModel = {
  source: string;
  scene: Scene;
  hits: Hits;
  kind: UmlKind;
  structure: Structure;
  nodes: StructureNode[];
  edges: StructureEdge[];
  parts: Map<string, StructureNode>;
  joins: Map<string, StructureEdge>;
  /** The lanes of an activity with lanes. */
  lanes?: LaneFrame;
};

/** The model of a drawn UML source of a type with a structure; undefined for another, or one that does not read. */
export function modelOf(source: string, scene: Scene, font: string): UmlModel | undefined {
  const kind = detectUml(source);
  const structure = kind && structureOf(kind);
  if (!kind || !structure) return undefined;
  let read: { nodes: StructureNode[]; edges: StructureEdge[] };
  try {
    read = structure.read(source);
  } catch {
    return undefined;
  }
  // The first move starts from exactly where the automatic layout shows the parts.
  if (kind !== "sequence" && !hasPlaces(source)) keepAutomatic(source, textMeasure(font), scene);
  const lanes = kind === "swimlane" ? laneFrame(scene) : undefined;
  const parts = new Map(read.nodes.map((node) => [node.id, node]));
  const joins = new Map(read.edges.map((edge) => [edge.id, edge]));
  const hits = umlHits(read, scene, lanes);
  const labels = [...wireLabels(scene).values()];
  for (const wire of hits.wires) wire.label = labels.find((label) => label.key === wire.id);
  return { source, scene, kind, structure, ...read, parts, joins, lanes, hits };
}

/** `make`'s source when it still reads as a diagram, else why not (the editor says it and leaves the source). */
export function attempt(make: () => string): { source: string } | { refused: string } {
  try {
    const source = make();
    parseUml(source);
    return { source };
  } catch (error) {
    return { refused: errorText(error).replace(/^Line \d+: /, "") };
  }
}

/** The source with every part placed where the picture shows it, without places of parts that are gone. */
export const pinned = (m: UmlModel) =>
  setPlaces(
    prunePlaces(
      m.source,
      m.scene.shapes.map((shape) => shape.id),
    ),
    placesOf(m.scene),
  );

/** What holds each part, by id (null: the diagram). */
export const parentsOf = (m: UmlModel) => new Map(m.nodes.map((node) => [node.id, node.parent]));

/** The parts of `ids` that no other of them holds: what moves as one. */
export function outermost(m: UmlModel, ids: string[]): string[] {
  const chosen = new Set(ids);
  const held = (id: string | null | undefined, seen = 0): boolean =>
    !!id && seen <= m.nodes.length && (chosen.has(id) || held(m.parts.get(id)?.parent, seen + 1));
  return ids.filter((id) => m.parts.has(id) && !held(m.parts.get(id)?.parent));
}

/** The source after a structural edit with its places, label places and lane widths following the parts. */
export const followed = (m: UmlModel, before: string, after: string) =>
  hasMarks(after) ? followPlaces((source) => m.structure.read(source), before, after) : after;
