/**
 * Positions in a Mermaid source: where its parts stand when they are placed by hand. A place is a
 * comment line, `%% @<id> <x>,<y>`, so the source stays valid Mermaid: the id is the id of the
 * part's shape in the scene, x and y the top left corner of its box. Two more kinds of line say
 * where the layout departs from its own choices: `%% @label:<edge> <dx>,<dy>` places the label of
 * a connection, its middle that far from the middle of the line (label-places.ts), the edge being
 * the id of the connection's wire in the scene; `%% @lane:<id> <width>` gives a lane of an
 * activity with lanes its width across the lanes. All of them stand together as one block at the
 * end of the source, places first; lines elsewhere are read too. Everything here is text: the
 * layout that follows the places is uml-placed.ts.
 */

import { endedLines } from "./source-text.ts";
import type { Point } from "./scene.ts";
import type { Structure } from "./structure.ts";

/** A place line: the id may hold anything but a line break, the numbers may be negative. */
const PLACE = /^\s*%%\s*@(\S(?:.*?\S)?)\s+([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*$/;

/** A lane's width: `%% @lane:<id> <width>`. */
const LANE = /^\s*%%\s*@lane:(\S(?:.*?\S)?)\s+(\d+(?:\.\d+)?)\s*$/;

/** The ids of place lines that place a label, not a part. */
const LABEL = "label:";

/** What the block at the end of a source says: places of parts, places of labels, widths of lanes. */
interface Marks {
  places: Map<string, Point>;
  labels: Map<string, Point>;
  lanes: Map<string, number>;
}

/** Places given as a map, or as an object by id. */
export type Places = ReadonlyMap<string, Point> | Readonly<Record<string, Point>>;

const entriesOf = (places: Places): [string, Point][] =>
  places instanceof Map ? [...places] : Object.entries(places as Record<string, Point>);

/** Whether a line is one of the block: a place, a label's place or a lane's width. */
const isMark = (line: string) => PLACE.test(line) || LANE.test(line);

/** A number in whole pixels, with its sign: the offset of a label says it is one. */
const signed = (value: number) => `${value < 0 ? "-" : "+"}${Math.abs(Math.round(value))}`;

/** The lines of the block, in its order. */
const blockOf = ({ places, labels, lanes }: Marks) => [
  ...[...places].map(([id, at]) => `%% @${id} ${Math.round(at.x)},${Math.round(at.y)}`),
  ...[...labels].map(([edge, at]) => `%% @${LABEL}${edge} ${signed(at.x)},${signed(at.y)}`),
  ...[...lanes].map(([id, width]) => `%% @lane:${id} ${Math.round(width)}`),
];

/** What the lines of a source say; of two lines for one thing the later counts. */
function readMarks(source: string): Marks {
  const marks: Marks = { places: new Map(), labels: new Map(), lanes: new Map() };
  if (!/^[ \t]*%%[ \t]*@\S/m.test(source)) return marks;
  for (const line of endedLines(source).lines) {
    const lane = line.match(LANE);
    if (lane) {
      marks.lanes.set(lane[1], Number(lane[2]));
      continue;
    }
    const match = line.match(PLACE);
    if (!match) continue;
    const at = { x: Number(match[2]), y: Number(match[3]) };
    if (match[1].startsWith(LABEL)) marks.labels.set(match[1].slice(LABEL.length), at);
    else marks.places.set(match[1], at);
  }
  return marks;
}

/**
 * A source with its block replaced by `marks`, at the end; every other line stays as it is.
 * Without marks the source ends as it did before it had any.
 */
function withMarks(source: string, marks: Marks): string {
  const { lines, ended } = endedLines(source);
  const rest = lines.filter((line) => !isMark(line)),
    block = blockOf(marks);
  if (rest.length === lines.length && !block.length) return source;
  // The empty lines before the block go with it.
  while (rest.length && !rest.at(-1)!.trim()) rest.pop();
  return [...rest, ...block].join("\n") + (ended || block.length ? "\n" : "");
}

/** A source with its places replaced by `places`; its labels and lanes stay. */
const withPlaces = (source: string, places: Map<string, Point>) =>
  withMarks(source, { ...readMarks(source), places });

/** Whether a source places any of its parts. */
export const hasPlaces = (source: string) => readMarks(source).places.size > 0;

/** Whether a source departs from its automatic layout anywhere: a place, a label's place, a lane's width. */
export const hasMarks = (source: string) => blockOf(readMarks(source)).length > 0;

/** The places a source gives its parts, by id; of two lines for one id the later counts. */
export function readPlaces(source: string): Map<string, Point> {
  return readMarks(source).places;
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

/** The places of the labels a source places, by the id of the connection's wire. */
export function readLabels(source: string): Map<string, Point> {
  return readMarks(source).labels;
}

/**
 * Places the label of a connection, by the id of its wire: its middle `at` from the middle of the
 * line, in whole pixels; without `at` the layout places it again.
 */
export function setLabel(source: string, edge: string, at: Point | undefined): string {
  const marks = readMarks(source);
  if (at) marks.labels.set(edge, { x: Math.round(at.x), y: Math.round(at.y) });
  else marks.labels.delete(edge);
  return withMarks(source, marks);
}

/** The widths a source gives its lanes, by the id of the lane. */
export function readLanes(source: string): Map<string, number> {
  return readMarks(source).lanes;
}

/** Gives a lane a width, in whole pixels; without one the layout sizes it again. */
export function setLane(source: string, id: string, width: number | undefined): string {
  const marks = readMarks(source);
  if (width === undefined) marks.lanes.delete(id);
  else marks.lanes.set(id, Math.round(width));
  return withMarks(source, marks);
}

/** The source without any of its block: places, labels and lanes; the layout is automatic again. */
export const unmarked = (source: string) =>
  withMarks(source, { places: new Map(), labels: new Map(), lanes: new Map() });

/**
 * The source without its places and labels: what the automatic layout is made from. The widths of
 * lanes stay: the automatic layout of an activity with lanes takes them.
 */
export const unplaced = (source: string) =>
  withMarks(source, { ...readMarks(source), places: new Map(), labels: new Map() });

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

/** Pairs found so far between what was before an edit and what is after it, by id. */
class Pairing {
  readonly found = new Map<string, string>();
  readonly taken = new Set<string>();

  pair(from: string, to: string) {
    this.found.set(from, to);
    this.taken.add(to);
  }
}

/**
 * Which part of the source after an edit each part before it is, by id: the same id where the
 * part still says the same, else the part that says the same, else the same id, and at last the
 * one part of a kind that went for the one that came (it was given another id). Parts that are
 * gone are left out.
 */
function followParts(was: StructureParts, now: StructureParts): Map<string, string> {
  const before = signatures(was),
    after = signatures(now),
    kindBefore = kindsOf(was),
    kindAfter = kindsOf(now);
  const pairing = new Pairing(),
    { found } = pairing;
  for (const [id, said] of before) if (after.get(id) === said) pairing.pair(id, id);
  for (const [id, said] of before) if (!found.has(id)) pairSaid(pairing, after, id, said);
  for (const id of before.keys()) pairKept(pairing, id, kindBefore, kindAfter);
  for (const kind of new Set(kindBefore.values())) pairLone(pairing, kind, kindBefore, kindAfter);
  return found;
}

/** Pairs a part with the part of its id after the edit, where that is still free and of its kind. */
function pairKept(
  pairing: Pairing,
  id: string,
  kindBefore: Map<string, string>,
  kindAfter: Map<string, string>,
) {
  if (pairing.found.has(id) || pairing.taken.has(id)) return;
  if (kindAfter.get(id) === kindBefore.get(id)) pairing.pair(id, id);
}

/** The kind of each part, by id. */
const kindsOf = (parts: StructureParts) => new Map(parts.nodes.map((node) => [node.id, node.kind]));

/** Pairs the one part of a kind still unpaired before the edit with the one not yet taken after it. */
function pairLone(
  pairing: Pairing,
  kind: string,
  kindBefore: Map<string, string>,
  kindAfter: Map<string, string>,
) {
  const gone = [...kindBefore.keys()].filter(
      (id) => !pairing.found.has(id) && kindBefore.get(id) === kind,
    ),
    come = [...kindAfter.keys()].filter(
      (id) => !pairing.taken.has(id) && kindAfter.get(id) === kind,
    );
  if (gone.length === 1 && come.length === 1) pairing.pair(gone[0], come[0]);
}

/** Pairs a part with the first part not yet taken that says the same. */
function pairSaid(pairing: Pairing, after: Map<string, string>, id: string, said: string) {
  const same = [...after].find(([other, text]) => !pairing.taken.has(other) && text === said);
  if (same) pairing.pair(id, same[0]);
}

type Join = StructureParts["edges"][number];

/**
 * Which join of the source after an edit each join before it is, by id, given which part each part
 * is (`followParts`): the join between the same parts of the same kind with the same label, else
 * the one join between the same parts of the same kind, its label changed. Of several alike the
 * first goes to the first. Joins that are gone are left out.
 */
function followJoins(
  was: StructureParts,
  now: StructureParts,
  parts: Map<string, string>,
): Map<string, string> {
  const pairing = new Pairing();
  for (const edge of was.edges) {
    const same = alike(pairing, now, parts, edge).find(
      (other) => (other.label ?? "") === (edge.label ?? ""),
    );
    if (same) pairing.pair(edge.id, same.id);
  }
  for (const edge of was.edges) {
    if (pairing.found.has(edge.id)) continue;
    const found = alike(pairing, now, parts, edge);
    if (found.length === 1) pairing.pair(edge.id, found[0].id);
  }
  return pairing.found;
}

/** The joins after an edit not yet taken that run where a join before it runs now: between the parts its ends became, of its kind. */
function alike(pairing: Pairing, now: StructureParts, parts: Map<string, string>, edge: Join) {
  const ends = `${parts.get(edge.source) ?? ""}\u0000${parts.get(edge.target) ?? ""}\u0000${edge.kind}`;
  return now.edges.filter((other) => !pairing.taken.has(other.id) && between(other) === ends);
}

/** A join's ends and kind, as one key. */
const between = (edge: Join) => `${edge.source}\u0000${edge.target}\u0000${edge.kind}`;

/**
 * Marks by the id of what they are about, followed through an edit: one about something the
 * source had goes with it where it went, and goes when it is gone; one about something the source
 * never had stays.
 */
function followed<T>(
  marks: Map<string, T>,
  had: (id: string) => boolean,
  follow: Map<string, string>,
): Map<string, T> {
  const kept = new Map<string, T>();
  for (const [id, value] of marks)
    if (!had(id)) kept.set(id, value);
    else if (follow.has(id)) kept.set(follow.get(id)!, value);
  return kept;
}

/** The part a place belongs to: a place is a part's, or that of one of its drawings. */
const ownerOf = (ids: string[], key: string) =>
  ids.find((id) => key === id || (key.startsWith(id) && DRAWING.test(key.slice(id.length))));

/**
 * The source after an edit of its structure with its block in step: the place of a part goes
 * with the part when the edit gave it another id, the place of a label with its join and the width
 * of a lane with its lane; those of what is gone go, and the block stands at the end again. `read`
 * is the `read` of the diagram type's structure.
 */
export function followPlaces(read: Structure["read"], before: string, after: string): string {
  const marks = readMarks(after);
  if (!blockOf(marks).length) return after;
  const was = read(before),
    now = read(after),
    parts = followParts(was, now),
    ids = was.nodes.map((node) => node.id).toSorted((a, b) => b.length - a.length);
  const places = new Map<string, Point>();
  for (const [key, at] of marks.places) {
    const owner = ownerOf(ids, key);
    if (owner === undefined) places.set(key, at);
    else if (parts.has(owner)) places.set(parts.get(owner)! + key.slice(owner.length), at);
  }
  // A label's place is a join's, a width a lane's.
  const labels = followed(
    marks.labels,
    (edge) => was.edges.some((item) => item.id === edge),
    followJoins(was, now, parts),
  );
  const lanes = followed(marks.lanes, (lane) => was.nodes.some((node) => node.id === lane), parts);
  return withMarks(after, { places, labels, lanes });
}
