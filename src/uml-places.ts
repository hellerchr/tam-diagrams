/**
 * Positions in a Mermaid source: where its parts stand when they are placed by hand. A place is a
 * comment line, `%% @<id> <x>,<y>`, so the source stays valid Mermaid: the id is the id of the
 * part's shape in the scene, x and y the top left corner of its box. The places stand together as
 * one block at the end of the source; lines elsewhere are read too. Everything here is text: the
 * layout that follows the places is uml-placed.ts.
 */

import type { Point } from "./scene.ts";
import type { Structure } from "./structure.ts";

/** A place line: the id may hold anything but a line break, the numbers may be negative. */
const PLACE = /^\s*%%\s*@(\S(?:.*?\S)?)\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

/** Places given as a map, or as an object by id. */
export type Places = ReadonlyMap<string, Point> | Readonly<Record<string, Point>>;

const entriesOf = (places: Places): [string, Point][] =>
  places instanceof Map ? [...places] : Object.entries(places as Record<string, Point>);

/** A source as lines, and whether it ends with a line break. */
function linesOf(source: string) {
  const text = source.replace(/\r\n?/g, "\n"),
    ended = text.endsWith("\n");
  return { lines: (ended ? text.slice(0, -1) : text).split("\n"), ended };
}

/** The line that places a part. */
const lineOf = (id: string, at: Point) => `%% @${id} ${Math.round(at.x)},${Math.round(at.y)}`;

/** Whether a source places any of its parts. */
export const hasPlaces = (source: string) =>
  /^[ \t]*%%[ \t]*@\S/m.test(source) && readPlaces(source).size > 0;

/** The places a source gives its parts, by id; of two lines for one id the later counts. */
export function readPlaces(source: string): Map<string, Point> {
  const places = new Map<string, Point>();
  for (const line of linesOf(source).lines) {
    const match = line.match(PLACE);
    if (match) places.set(match[1], { x: Number(match[2]), y: Number(match[3]) });
  }
  return places;
}

/**
 * A source with its place lines replaced by `places`, as one block at the end; every other line
 * stays as it is. Without places the source ends as it did before it had any.
 */
function withPlaces(source: string, places: Map<string, Point>): string {
  const { lines, ended } = linesOf(source);
  const rest = lines.filter((line) => !PLACE.test(line));
  if (rest.length === lines.length && !places.size) return source;
  // The empty lines before the block go with it.
  while (rest.length && !rest.at(-1)!.trim()) rest.pop();
  const block = [...places].map(([id, at]) => lineOf(id, at));
  return [...rest, ...block].join("\n") + (ended || block.length ? "\n" : "");
}

/** Places parts: adds or replaces the lines of those ids; the places of other parts stay. */
export function setPlaces(source: string, places: Places): string {
  const all = readPlaces(source);
  for (const [id, at] of entriesOf(places)) all.set(id, at);
  return withPlaces(source, all);
}

/** Removes the places of some parts, or of all without `ids`: the layout is automatic again. */
export function removePlaces(source: string, ids?: Iterable<string>): string {
  const all = readPlaces(source);
  if (!ids) all.clear();
  else for (const id of ids) all.delete(id);
  return withPlaces(source, all);
}

/** Gives the place of a part to another id: the part was renamed. */
export function renamePlace(source: string, id: string, next: string): string {
  const all = readPlaces(source);
  if (!all.has(id) || id === next) return source;
  return withPlaces(source, new Map([...all].map(([key, at]) => [key === id ? next : key, at])));
}

/** Drops the places of parts that are no longer there: `ids` are the parts the source has. */
export function prunePlaces(source: string, ids: Iterable<string>): string {
  const kept = new Set(ids),
    all = readPlaces(source);
  const gone = [...all.keys()].filter((id) => !kept.has(id));
  return gone.length ? removePlaces(source, gone) : source;
}

/** The source without its place lines: what the automatic layout is made from. */
export const unplaced = (source: string) => removePlaces(source);

/** The extra drawings of a part carry its id and one of these endings: a copy, a merge, a decision. */
const DRAWING = /^#(\d+|merge\d*|decision\d+)$/;

/**
 * What a part is apart from its id: its kind, its name, what holds it and what it is joined to.
 * Ids that count parts (`note2`, a second final state) pass to another part when one before it
 * goes; what a part says stays its own.
 */
function signatures(structure: StructureParts): Map<string, string> {
  const nodes = new Map(structure.nodes.map((node) => [node.id, node]));
  const said = (id: string | null) => {
    const node = id === null ? undefined : nodes.get(id);
    return node ? `${node.kind}:${node.label}` : "";
  };
  return new Map(
    structure.nodes.map((node) => [
      node.id,
      [
        node.kind,
        node.label,
        said(node.parent),
        ...structure.edges
          .flatMap((edge) => [
            ...(edge.source === node.id ? [`>${said(edge.target)}:${edge.kind}`] : []),
            ...(edge.target === node.id ? [`<${said(edge.source)}:${edge.kind}`] : []),
          ])
          .toSorted(),
      ].join("\u0000"),
    ]),
  );
}

/** The parts and joins a structure reads from a source. */
type StructureParts = ReturnType<Structure["read"]>;

/**
 * Which part of the source after an edit each part before it is, by id: the same id where the
 * part still says the same, else the part that says the same, else the same id, and at last the
 * one part of a kind that went for the one that came (it was given another id). Parts that are
 * gone are left out.
 */
export function followParts(was: StructureParts, now: StructureParts): Map<string, string> {
  const before = signatures(was),
    after = signatures(now),
    kinds = (parts: StructureParts) => new Map(parts.nodes.map((node) => [node.id, node.kind]));
  const kindBefore = kinds(was),
    kindAfter = kinds(now);
  const found = new Map<string, string>(),
    taken = new Set<string>();
  const pair = (from: string, to: string) => {
    found.set(from, to);
    taken.add(to);
  };
  for (const [id, said] of before) if (after.get(id) === said) pair(id, id);
  for (const [id, said] of before) {
    if (found.has(id)) continue;
    const same = [...after].find(([other, text]) => !taken.has(other) && text === said);
    if (same) pair(id, same[0]);
  }
  for (const id of before.keys())
    if (!found.has(id) && !taken.has(id) && kindAfter.get(id) === kindBefore.get(id)) pair(id, id);
  for (const kind of new Set(kindBefore.values())) {
    const gone = [...before.keys()].filter((id) => !found.has(id) && kindBefore.get(id) === kind),
      come = [...after.keys()].filter((id) => !taken.has(id) && kindAfter.get(id) === kind);
    if (gone.length === 1 && come.length === 1) pair(gone[0], come[0]);
  }
  return found;
}

/**
 * The source after an edit of its structure with its places in step: the place of a part goes
 * with the part when the edit gave it another id, the places of parts that are gone go, and the
 * block of places stands at the end again. `read` is the `read` of the diagram type's structure.
 */
export function followPlaces(read: Structure["read"], before: string, after: string): string {
  const places = readPlaces(after);
  if (!places.size) return after;
  const was = read(before),
    parts = followParts(was, read(after)),
    ids = was.nodes.map((node) => node.id).toSorted((a, b) => b.length - a.length);
  const next = new Map<string, Point>();
  for (const [key, at] of places) {
    // A place is a part's, or that of one of its drawings; any other stays as it is.
    const owner = ids.find(
      (id) => key === id || (key.startsWith(id) && DRAWING.test(key.slice(id.length))),
    );
    if (owner === undefined) next.set(key, at);
    else if (parts.has(owner)) next.set(parts.get(owner)! + key.slice(owner.length), at);
  }
  return withPlaces(after, next);
}
