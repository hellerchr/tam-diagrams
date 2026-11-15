/**
 * What an editor needs to change the structure of a diagram that lays itself out: the parts and
 * joins a source declares, the pieces that can be added, and the edits, each of which returns the
 * source with one change made and every other line as it was. One `Structure` per diagram type;
 * uml-activity-edit.ts has the one for flowcharts and swimlanes.
 */

/** A part of a diagram: a node, or a group that holds others. Its id is the id of its shape in the scene. */
export interface StructureNode {
  id: string;
  label: string;
  /** The group that holds it. */
  parent: string | null;
  /** The line that first names it, from 1. */
  line: number;
  /** Whether it holds other parts. */
  group: boolean;
  /** The kind of piece it is, one of the structure's `pieces`. */
  kind: string;
}

/** A join between two parts: an edge, a relation, a message. Its id is the `edge` of its wire in the scene. */
export interface StructureEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  line: number;
  /** The kind of join it is, one of the structure's `links`. */
  kind: string;
}

/** A piece the canvas adds: a kind of part. */
export interface Piece {
  kind: string;
  name: string;
  /** What it stands for, for a tooltip. */
  about: string;
  /** Whether it holds other parts. */
  group?: boolean;
  /**
   * How a new piece joins the part it is added at: it follows that part (`after`), leads to it
   * (`before`), or stands alone.
   */
  joins?: "after" | "before";
  /** The kinds of part it joins that way; any part when left out. */
  joinsTo?: string[];
  /** Whether it carries a name to type when added. */
  named?: boolean;
}

/** A kind of join the canvas draws between two parts. */
export interface Link {
  kind: string;
  name: string;
}

export interface Structure {
  /** The pieces that can be added, the usual one first. */
  pieces: Piece[];
  /** The kinds of join, the usual one first. */
  links: Link[];
  /** The parts, parents before what they hold and else in the order of the source, and the joins. */
  read(source: string): { nodes: StructureNode[]; edges: StructureEdge[] };
  /** Adds a piece, inside a group when given, and returns the id it got. */
  add(
    source: string,
    piece: { kind: string; label?: string; parent?: string | null },
  ): { source: string; id: string };
  /** Joins two parts; with the usual kind of join when none is given. */
  connect(source: string, from: string, to: string, kind?: string): string;
  /** Gives a part another name. */
  rename(source: string, id: string, label: string): string;
  /**
   * Gives a part that was just added its first name: where the syntax allows, the id follows the
   * name (`class Invoice` rather than `class Class1["Invoice"]`), with every mention of it.
   * Returns the id the part has afterwards. A structure without it names new parts with `rename`.
   */
  retitle?(source: string, id: string, name: string): { source: string; id: string };
  /** Gives a join another label; an empty one removes it. */
  label(source: string, edge: string, label: string): string;
  /** Makes a join one of another kind. */
  relink(source: string, edge: string, kind: string): string;
  /** Removes parts with their joins, groups with what they hold, and joins, by id. */
  remove(source: string, ids: string[]): string;
}
