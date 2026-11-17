/**
 * Editing a use case diagram source as text: adding, naming, connecting and removing actors, use
 * cases, system boundaries and notes, the way uml-activity-edit.ts edits flowcharts. Each function
 * returns the source with one change made. A line that loses an element or its relation is written
 * anew from what it still says; every other line stays as it was. The layout stays automatic.
 *
 * The edits write what UML has: an association between an actor and a use case, «include» and
 * «extend» between two use cases, a generalization between two actors or two use cases. A source
 * that says more is read as it is.
 */

import type { Structure, StructureEdge, StructureNode } from "./structure.ts";
import { accessibilityLines, labelText, scan } from "./uml.ts";
import { counted, indentOf, linesOf, listed, numberedId, rootEnd } from "./source-text.ts";
import {
  parseUseCaseDiagram,
  type UseCaseDiagram,
  type UseCaseElement,
  type UseCaseNote,
  type UseCaseRelation,
} from "./uml-usecase.ts";

/** A join of a use case diagram as `read` gives it. */
export interface UseCaseEdge extends StructureEdge {
  /** Whether the join carries no label to edit: every relation but an association. */
  fixedLabel?: boolean;
}

/** What a canvas adds to a use case diagram. */
type UseCasePiece = "usecase" | "actor" | "boundary" | "note";

/** An element's name as the parser reads it: `id`, `id(Label)`, `id[Label]` or `"Label"`. */
const NAME =
  /^(?:(\w+)(?:(\s*\(\s*)("[^"]*"|[^)]*)\s*\)|(\s*\[\s*)("[^"]*"|[^\]]*)\s*\])?|("[^"]*"))/;

/** What may follow a name: `@{ … }`, a `<<stereotype>>` and `:::classes`. */
const SUFFIX = /^(?:\s*@\{[^}]*\})?(?:\s*<<\s*[^>]+?\s*>>)?(?:\s*:::[\w,-]+)?/;

/** The arrows without a text between their ends, longest first, and whether they point backward. */
const PLAIN: [RegExp, boolean][] = [
  [/^\.\.>\s*:\s*(include|extend)\b/i, false],
  [/^--\|>/, false],
  [/^--+>/, false],
  [/^<--+/, true],
  [/^--o/, false],
  [/^o--/, true],
  [/^--x/, false],
  [/^x--/, true],
  [/^--+/, false],
];

/** An association with its text between the ends: `-- pays -->`. */
const LABELLED = /^(<--|o--|x--|--)\s+(?!>)([^-]+?)\s+(-->|--o|--x|--)(?!-)/;

/** The arrow each kind of relation is written with. */
const ARROWS: Record<string, string> = {
  association: "-->",
  undirected: "--",
  include: "..> : include",
  extend: "..> : extend",
  generalization: "--|>",
};

/** An element or boundary where a line names it, with its places in the line. */
interface Mention {
  id: string;
  start: number;
  /** The end of the whole mention, with stereotype and classes. */
  end: number;
  /** The end of the id, or of the quoted name that stands for it. */
  idEnd: number;
  /** The end of the name with its label. */
  nameEnd: number;
  /** Where the label lies between its brackets. */
  label?: { start: number; end: number };
  /** Whether a quoted name is both id and label. */
  quoted: boolean;
}

/** A statement line as the edits see it. */
interface Statement {
  /** The index of its line, from 0. */
  index: number;
  kind: "boundary" | "end" | "note" | "actors" | "element" | "other";
  /** The elements it declares or starts a relation from; for a boundary, the boundary. */
  mentions: Mention[];
  /** The arrow of its relation: where it lies, and whether its source stands on the right. */
  arrow?: { start: number; end: number; backward: boolean };
  /** The element the arrow leads to in the line. */
  target?: Mention;
  /** For a note: where the id of its element and its text lie. */
  note?: { id: { start: number; end: number }; text: { start: number; end: number } };
}

/** The mention that starts at a place in a line. */
function mentionAt(line: string, at: number): Mention | null {
  const rest = line.slice(at),
    match = rest.match(NAME);
  if (!match) return null;
  const suffix = rest.slice(match[0].length).match(SUFFIX)![0],
    name = match[1] ?? match[6],
    [before, inner] = match[3] !== undefined ? [match[2], match[3]] : [match[4], match[5]];
  const from = at + name.length + (before?.length ?? 0);
  return {
    id: match[1] ?? labelText(match[6]),
    start: at,
    end: at + match[0].length + suffix.length,
    idEnd: at + name.length,
    nameEnd: at + match[0].length,
    label: inner !== undefined ? { start: from, end: from + inner.trimEnd().length } : undefined,
    quoted: match[1] === undefined,
  };
}

/** Reads a statement line the way the parser does, keeping where its parts lie. */
function statement(line: string, index: number): Statement {
  const text = line.trim(),
    pad = indentOf(line).length,
    found: Statement = { index, kind: "other", mentions: [] };
  if (/^(direction\s|classDef\b|class\b|style\b)/.test(text)) return found;
  if (text === "end") return { ...found, kind: "end" };
  const boundary = text.match(/^systemBoundary\s+/);
  if (boundary) {
    const mention = mentionAt(line, pad + boundary[0].length);
    return mention ? { ...found, kind: "boundary", mentions: [mention] } : found;
  }
  const note = text.match(/^(note\s+for\s+)(\w+)(\s+)(.+)$/);
  if (note) return { ...found, kind: "note", note: notePlaces(note, pad) };
  const at = readMentions(line, text, pad, found);
  if (at === undefined || at >= line.trimEnd().length) return found;
  return withRelation(line, at, found);
}

/** Where the id of its element and its text lie in a note statement. */
function notePlaces(match: RegExpMatchArray, pad: number) {
  const id = pad + match[1].length,
    from = id + match[2].length + match[3].length;
  return {
    id: { start: id, end: id + match[2].length },
    text: { start: from, end: from + match[4].length },
  };
}

/** The place past the white space at a place in a line. */
const skipSpace = (line: string, at: number) => at + line.slice(at).match(/^\s*/)![0].length;

/**
 * Reads the elements a line declares, or the one it starts a relation from, into a statement;
 * returns where the line goes on, or undefined where nothing more is read.
 */
function readMentions(line: string, text: string, pad: number, found: Statement) {
  const actors = text.match(/^actor\s+/);
  if (!actors) {
    const mention = mentionAt(line, pad);
    if (!mention) return undefined;
    found.kind = "element";
    found.mentions.push(mention);
    return skipSpace(line, mention.end);
  }
  found.kind = "actors";
  for (let at = pad + actors[0].length; ; at = skipSpace(line, at + 1)) {
    const mention = mentionAt(line, at);
    if (!mention) return undefined;
    found.mentions.push(mention);
    at = skipSpace(line, mention.end);
    if (line[at] !== ",") return at;
  }
}

/** The arrow a text starts with: how long it is, and whether it points backward; no length for none. */
function arrowAt(rest: string): { length: number; backward: boolean } {
  const labelled = rest.match(LABELLED);
  if (labelled) return { length: labelled[0].length, backward: false };
  const plain = PLAIN.find(([pattern]) => pattern.test(rest));
  return plain
    ? { length: rest.match(plain[0])![0].length, backward: plain[1] }
    : { length: 0, backward: false };
}

/** A statement with the relation that goes on at a place in its line, where there is one. */
function withRelation(line: string, at: number, found: Statement): Statement {
  // An arrow, after the id some give their line (`e1@-->`), and the other element.
  const start = at + (line.slice(at).match(/^\w+@(?=[-<.ox])/)?.[0].length ?? 0),
    { length, backward } = arrowAt(line.slice(start)),
    target = length ? mentionAt(line, skipSpace(line, start + length)) : null;
  if (!target) return found;
  return { ...found, arrow: { start, end: start + length, backward }, target };
}

/** A source as its lines and its statements with their places; it need not be one the parser reads. */
function statementsOf(source: string) {
  const lines = linesOf(source),
    skipped = accessibilityLines();
  const statements = scan(source)
    .lines.slice(1)
    .flatMap(({ text, line }) => (skipped(text) ? [] : [statement(lines[line - 1], line - 1)]));
  return { lines, statements };
}

/** A source as its diagram, its lines, and its statements with their places. */
function model(source: string) {
  return { diagram: parseUseCaseDiagram(source), ...statementsOf(source) };
}

/** A source as its diagram, or nothing when the parser does not read it. */
function reads(source: string): UseCaseDiagram | undefined {
  try {
    return parseUseCaseDiagram(source);
  } catch {
    return undefined;
  }
}

/**
 * A text as a label holds it: line breaks as `<br>`, and what the parser would decode or drop as
 * entity codes, angle brackets among them.
 */
const escaped = (label: string) =>
  label
    .trim()
    .replace(/\s*\n\s*/g, "<br>")
    .replace(/[#&](?=\w+;)/g, (mark) => (mark === "#" ? "#35;" : "#amp;"))
    .replace(/"/g, "#quot;")
    .split(/(<br\s*\/?>)/i)
    .map((part, index) => (index % 2 ? part : part.replace(/</g, "#lt;").replace(/>/g, "#gt;")))
    .join("");

/** A label between the brackets of an element or boundary: in quotes when it has a mark of the syntax. */
const nameText = (label: string) => {
  const text = escaped(label);
  return /[()[\]{},:@]/.test(text) ? `"${text}"` : text;
};

/** The text of an association: hyphens are what ends it, so they are written as codes. */
const relationText = (label: string) => escaped(label).replace(/-/g, "#45;");

/** An element as a relation refers to it: by its id, or by its quoted name when that is its id. */
const ref = (id: string) => (/^\w+$/.test(id) ? id : `"${escaped(id)}"`);

/** An id no element or boundary has yet: a base with a number, counted from `from`. */
const freshId = (diagram: UseCaseDiagram, base: string, from = 1) =>
  numberedId((id) => diagram.elements.has(id) || diagram.boundaries.has(id), base, from);

/** The index of the line with the `end` that closes the boundary opened on a line. */
function blockEnd(statements: Statement[], start: number, lines: string[]): number {
  return (
    statements.find((item) => item.kind === "end" && item.index > start)?.index ?? lines.length - 1
  );
}

/** Where a statement is added: before the `end` of a boundary, or after the last line with text. */
function insertAt(lines: string[], statements: Statement[], boundary?: { line: number }) {
  if (!boundary) return { at: rootEnd(lines), indent: rootIndent(lines, statements) };
  const start = boundary.line - 1,
    end = blockEnd(statements, start, lines),
    child = statements.find((item) => item.index > start && item.index < end);
  return {
    at: end,
    indent: child ? indentOf(lines[child.index]) : `${indentOf(lines[start])}  `,
  };
}

/** The indentation of the statements outside the boundaries: that of the first. */
const rootIndent = (lines: string[], statements: Statement[]) =>
  statements.length ? indentOf(lines[statements[0].index]) : "  ";

/**
 * Where a new part that stands in no boundary goes: an actor after the last line that declares
 * actors, a use case after the last one declared outside the boundaries, a boundary after the
 * last boundary, and each before the first relation where its kind is missing; a note after the
 * last note. Else, and when that is not below the line `after`, after the last line with text.
 */
function place(lines: string[], statements: Statement[], kind: UseCasePiece, after = -1) {
  const root = rootStatements(statements),
    last = lastOfKind(statements, root, kind);
  let at = last ? last.index + 1 : undefined;
  if (at === undefined && kind !== "note") at = firstRelation(lines, root);
  return {
    at: at === undefined || at <= after ? rootEnd(lines) : at,
    indent: rootIndent(lines, statements),
  };
}

/** The statements that stand in no boundary. */
function rootStatements(statements: Statement[]): Statement[] {
  const root: Statement[] = [];
  let open = false;
  for (const item of statements) {
    if (item.kind === "boundary") open = true;
    else if (item.kind === "end") open = false;
    if (!open) root.push(item);
  }
  return root;
}

/**
 * The last statement outside the boundaries that a new part of a kind follows: the last note,
 * where it stands outside, as a new note is the last also of those in a boundary; the last
 * boundary; or the last line that declares an element of the kind.
 */
function lastOfKind(statements: Statement[], root: Statement[], kind: UseCasePiece) {
  if (kind === "note") {
    const note = statements.findLast((item) => item.kind === "note");
    return note && root.includes(note) ? note : undefined;
  }
  if (kind === "boundary") return root.findLast((item) => item.kind === "end");
  const declares = kind === "actor" ? "actors" : "element";
  return root.findLast((item) => item.kind === declares && !item.arrow);
}

/** The line of the first relation outside the boundaries, with the comments right above it, which stay with it. */
function firstRelation(lines: string[], root: Statement[]): number | undefined {
  let at = root.find((item) => item.arrow)?.index;
  while (at && lines[at - 1].trim().startsWith("%%")) at--;
  return at;
}

/** The lines with a note for an element, which becomes the last note of the source. */
function withNote(
  lines: string[],
  statements: Statement[],
  target: { id: string; line: number },
  text: string,
): string {
  const { at, indent } = place(lines, statements, "note", target.line - 1);
  lines.splice(at, 0, `${indent}note for ${target.id} "${escaped(text || "Note")}"`);
  return lines.join("\n");
}

/** Whether a note can be written for an element: the statement names it by a plain id. */
const notable = (id: string) => /^\w+$/.test(id);

/**
 * Adds a use case, an actor, a system boundary or a note, and returns the id it got. A use case
 * goes inside the boundary given as parent; actors stand outside, and boundaries do not nest.
 * Outside the boundaries each stands with its kind: an actor after the actors, a use case after
 * the use cases, before the relations.
 *
 * A note is always the note of an actor or a use case. With that element as the parent it is
 * written at once. Without one the source comes back unchanged with the id the note is going to
 * have, and `connectUseCase` of that id with an element writes it; nothing is added until then.
 * The id is empty when the diagram has no element a note can be for.
 */
export function addUseCasePiece(
  source: string,
  piece: { kind: UseCasePiece; label?: string; parent?: string | null },
): { source: string; id: string } {
  const { diagram, lines, statements } = model(source),
    label = piece.label?.trim() ? piece.label : "";
  if (piece.kind === "note") return addNote(source, piece.parent, label);
  const parent = piece.parent ? diagram.boundaries.get(piece.parent) : undefined,
    made = NEW_PARTS[piece.kind as keyof typeof NEW_PARTS] ?? NEW_PARTS.usecase,
    id = freshId(diagram, made.base),
    { at, indent } =
      piece.kind === "usecase" && parent
        ? insertAt(lines, statements, parent)
        : place(lines, statements, piece.kind);
  lines.splice(at, 0, ...made.text(id, label).map((line) => indent + line));
  return { source: lines.join("\n"), id };
}

/** The new parts of each kind: the base of their ids, and their statements. */
const NEW_PARTS = {
  boundary: {
    base: "system",
    text: (id: string, label: string) => [
      `systemBoundary ${id}[${nameText(label || "System")}]`,
      "end",
    ],
  },
  actor: {
    base: "actor",
    text: (id: string, label: string) => [`actor ${id}(${nameText(label || "Actor")})`],
  },
  usecase: {
    base: "usecase",
    text: (id: string, label: string) => [`${id}(${nameText(label || "Use case")})`],
  },
};

/**
 * Adds a note for the element given as parent, and returns the id it got; without one, the id
 * the note is going to have, with the source unchanged, and none where no element can have one.
 */
function addNote(source: string, parent: string | null | undefined, label: string) {
  const { diagram, lines, statements } = model(source),
    target = parent ? diagram.elements.get(parent) : undefined,
    id = `note${diagram.notes.length + 1}`;
  if (target && notable(target.id))
    return { source: withNote(lines, statements, target, label), id };
  return { source, id: [...diagram.elements.keys()].some(notable) ? id : "" };
}

/** What a relation is as a join: its kind, and `undirected` for an association without a mark at either end. */
const kindOf = (relation: UseCaseRelation): string =>
  relation.kind === "association" && !relation.start && !relation.end
    ? "undirected"
    : relation.kind;

/**
 * Whether UML has a relation of a kind between two elements: «include» and «extend» between two
 * use cases, a generalization between two actors or two use cases, an association between an
 * actor and a use case.
 */
function fits(diagram: UseCaseDiagram, from: string, to: string, kind: string): boolean {
  const first = diagram.elements.get(from),
    second = diagram.elements.get(to);
  if (!first || !second) return false;
  if (kind === "include" || kind === "extend")
    return first.kind === "usecase" && second.kind === "usecase";
  return kind === "generalization" ? first.kind === second.kind : first.kind !== second.kind;
}

/**
 * Joins two elements with a relation of a kind. Without a kind it is the usual one for the two:
 * an association between an actor and a use case, «include» between two use cases, a
 * generalization between two actors. A kind UML does not have between the two leaves the source
 * unchanged. A note joined to an element hangs on that element from then on; the id a note was
 * promised by `addUseCasePiece` writes that note for the element.
 */
export function connectUseCase(source: string, from: string, to: string, kind?: string): string {
  const diagram = parseUseCaseDiagram(source),
    note = diagram.notes.find((item) => item.id === from || item.id === to);
  if (note) return renote(source, note, note.id === from ? to : from);
  return promisedNote(source, from, to) ?? relate(source, from, to, kind);
}

/** The source with a relation of a kind, or the usual one, between two elements where UML has it. */
function relate(source: string, from: string, to: string, kind?: string): string {
  const { diagram, lines, statements } = model(source),
    first = diagram.elements.get(from),
    second = diagram.elements.get(to);
  if (!first || !second) return source;
  const wanted = kind ?? usualKind(first.kind, second.kind);
  if (!ARROWS[wanted] || !fits(diagram, from, to, wanted)) return source;
  const { at, indent } = insertAt(lines, statements);
  lines.splice(at, 0, `${indent}${ref(from)} ${ARROWS[wanted]} ${ref(to)}`);
  return lines.join("\n");
}

/**
 * The source with the note `addUseCasePiece` promised written for the element at the other end,
 * where one end is that note; unchanged where the element cannot have it. Undefined where
 * neither end is the promised note.
 */
function promisedNote(source: string, from: string, to: string): string | undefined {
  const { diagram, lines, statements } = model(source),
    promised = `note${diagram.notes.length + 1}`;
  if ((from === promised) === (to === promised) || diagram.elements.has(promised)) return undefined;
  const target = diagram.elements.get(from === promised ? to : from);
  return target && notable(target.id) ? withNote(lines, statements, target, "") : source;
}

/** The usual relation between two kinds of element. */
const usualKind = (first: string, second: string) => {
  if (first !== second) return "association";
  return first === "actor" ? "generalization" : "include";
};

/** The source with a note made the note of another element, after which it stands. */
function renote(source: string, note: UseCaseNote, id: string): string {
  const { diagram, lines, statements } = model(source),
    target = diagram.elements.get(id),
    found = statements.find((item) => item.index === note.line - 1)?.note;
  if (!target || !found || !/^\w+$/.test(target.id)) return source;
  const index = note.line - 1,
    line = lines[index].slice(0, found.id.start) + target.id + lines[index].slice(found.id.end);
  // A note stands after the element it is for.
  if (target.line <= note.line) lines[index] = line;
  else {
    lines.splice(insertAt(lines, statements).at, 0, line);
    lines.splice(index, 1);
  }
  return lines.join("\n");
}

/**
 * Gives an element, a boundary or a note another name. The id stays, so every relation still
 * holds: the name is the label beside the id (`User` becomes `User(Customer)`), written where the
 * element has its label, or where it first stands when it has none. Only an element whose quoted
 * name is its id (`"Log in"`) is renamed wherever it stands. An empty name, and one that is
 * the id itself, takes the label away, which leaves the id as the name.
 */
export function renameUseCase(source: string, id: string, label: string): string {
  const { diagram, lines, statements } = model(source),
    note = diagram.notes.find((item) => item.id === id),
    element = diagram.elements.has(id),
    boundary = !element && diagram.boundaries.has(id);
  if (!element && !boundary) return note ? renameNote(source, note, label) : source;
  const places = mentionsOf(statements, id, boundary);
  if (!places.length) return source;
  if (!/^\w+$/.test(id)) return renameQuoted(diagram, lines, places, id, label, boundary) ?? source;
  relabel(lines, places, id, label, boundary);
  return lines.join("\n");
}

/** Writes a text into a line in place of what lies between two places. */
function splice(lines: string[], index: number, start: number, end: number, inner: string) {
  lines[index] = lines[index].slice(0, start) + inner + lines[index].slice(end);
}

/** The source with a note's text another one; unchanged for an empty one. */
function renameNote(source: string, note: UseCaseNote, label: string): string {
  const { lines, statements } = statementsOf(source),
    found = statements.find((item) => item.index === note.line - 1)?.note;
  if (!found || !nameText(label)) return source;
  const line = lines[note.line - 1];
  lines[note.line - 1] = `${line.slice(0, found.text.start)}"${escaped(label)}"`;
  return lines.join("\n");
}

/** Where the statements that declare elements, or boundaries, mention one by its id, in their order. */
const mentionsOf = (statements: Statement[], id: string, boundary: boolean) =>
  statements
    .filter((item) =>
      boundary ? item.kind === "boundary" : item.kind === "actors" || item.kind === "element",
    )
    .flatMap((item) =>
      [...item.mentions, ...(item.target ? [item.target] : [])]
        .filter((mention) => mention.id === id)
        .map((mention) => ({ index: item.index, mention })),
    );

/** A mention with the index of its line. */
type MentionPlace = ReturnType<typeof mentionsOf>[number];

/**
 * The source with a part whose quoted name is its id under another one at every mention;
 * undefined when that is no other or taken.
 */
function renameQuoted(
  diagram: UseCaseDiagram,
  lines: string[],
  places: MentionPlace[],
  id: string,
  label: string,
  boundary: boolean,
): string | undefined {
  const key = labelText(`"${escaped(label)}"`);
  if (!key || key === id || (boundary ? diagram.boundaries : diagram.elements).has(key))
    return undefined;
  // From the right, so the places before keep their columns.
  for (const { index, mention } of places.toReversed())
    splice(lines, index, mention.start, mention.idEnd, `"${escaped(label)}"`);
  return lines.join("\n");
}

/**
 * Writes another label where a part has its last one, or beside its id where it first stands; an
 * empty one, or the id itself, takes every label away.
 */
function relabel(
  lines: string[],
  places: MentionPlace[],
  id: string,
  label: string,
  boundary: boolean,
) {
  const text = nameText(label),
    [open, close] = boundary ? "[]" : "()",
    // The last label is the one that counts.
    labelled = places.findLast((place) => place.mention.label);
  if (!text || label.trim() === id) {
    for (const { index, mention } of places.toReversed())
      if (mention.label) splice(lines, index, mention.idEnd, mention.nameEnd, "");
  } else if (labelled) {
    const { start, end } = labelled.mention.label!;
    splice(lines, labelled.index, start, end, text);
  } else {
    const [{ index, mention }] = places;
    splice(lines, index, mention.start, mention.idEnd, `${id}${open}${text}${close}`);
  }
}

/** The statement that holds a relation. */
const statementOf = (statements: Statement[], relation: UseCaseRelation) =>
  statements.find((item) => item.index === relation.line - 1 && item.arrow && item.target);

/**
 * Writes another arrow into the line of a relation. When the line has its source on the right, or
 * `swap` says the ends change places, the relation is written anew from its source, after what the
 * line declares.
 */
function rearrow(lines: string[], found: Statement, arrow: string, swap: boolean) {
  const line = lines[found.index],
    { start, end } = found.arrow!;
  if (!swap) {
    lines[found.index] = line.slice(0, start) + arrow + line.slice(end);
    return;
  }
  const [left] = found.mentions,
    right = found.target!,
    head = line.slice(0, found.mentions.at(-1)!.end);
  const declares = found.kind === "actors" || line.slice(left.start, left.end) !== ref(left.id);
  lines.splice(
    found.index,
    1,
    ...(declares ? [head] : []),
    `${indentOf(line)}${line.slice(right.start, right.end)} ${arrow} ${ref(left.id)}`,
  );
}

const HEADS = { open: "-->", circle: "--o", cross: "--x" } as Record<string, string | undefined>;

const TAILS = { open: "<--", circle: "o--", cross: "x--" } as Record<string, string | undefined>;

/**
 * Gives an association another text; an empty one removes it. Only associations carry a text:
 * «include» and «extend» are named by their kind, and a generalization has none. An association
 * with a mark at both ends keeps only the one at its target when it loses its text, as the syntax
 * has no such arrow without one.
 */
export function labelUseCaseRelation(source: string, edge: string, label: string): string {
  const { diagram, lines, statements } = model(source),
    relation = diagram.relations.find((item) => item.id === edge),
    found = relation && statementOf(statements, relation);
  if (!relation || !found || relation.kind !== "association") return source;
  const text = relationText(label),
    { head, tail } = marksOf(relation);
  if (text) rearrow(lines, found, `${tail} ${text} ${head}`, found.arrow!.backward);
  else if (!relation.label) return source;
  else unlabel(lines, found, relation, head, tail);
  return lines.join("\n");
}

/** The ends of an association's arrow with its text between them, by the marks at its ends. */
const marksOf = (relation: UseCaseRelation) => ({
  head: HEADS[relation.end ?? ""] ?? "--",
  tail: TAILS[relation.start ?? ""] ?? "--",
});

/** Writes the arrow of an association without its text into its line. */
function unlabel(
  lines: string[],
  found: Statement,
  relation: UseCaseRelation,
  head: string,
  tail: string,
) {
  // An arrow that only points back is drawn the same from its other end.
  if (tail !== "--" && head === "--") rearrow(lines, found, HEADS[relation.start!]!, true);
  else rearrow(lines, found, head, false);
}

/**
 * Makes a relation one of another kind: an association with an arrow or as a plain line, include,
 * extend or generalization. A kind UML does not have between its two elements leaves the source
 * unchanged. An association keeps its text when it gets or loses its arrow.
 */
export function relinkUseCase(source: string, edge: string, kind: string): string {
  const { diagram, lines, statements } = model(source),
    relation = diagram.relations.find((item) => item.id === edge),
    found = relation && statementOf(statements, relation);
  if (!relation || !found || !ARROWS[kind] || kindOf(relation) === kind) return source;
  if (!fits(diagram, relation.source, relation.target, kind)) return source;
  rearrow(lines, found, arrowOf(relation, kind), found.arrow!.backward);
  return lines.join("\n");
}

/** The arrow a relation is written with as one of a kind: an association keeps its text. */
function arrowOf(relation: UseCaseRelation, kind: string): string {
  const plain = kind === "association" || kind === "undirected",
    text = plain && relation.kind === "association" && relation.label;
  return text ? `-- ${relationText(text)} ${ARROWS[kind]}` : ARROWS[kind];
}

/**
 * Turns a relation round: its two elements change places, and its arrow, kind and text stay. A
 * line that declares its first element keeps the declaration, and the relation follows it.
 */
export function reverseUsecaseRelation(source: string, edge: string): string {
  const { diagram, lines, statements } = model(source),
    relation = diagram.relations.find((item) => item.id === edge),
    found = relation && statementOf(statements, relation);
  if (!found) return source;
  const { start, end, backward } = found.arrow!,
    arrow = lines[found.index].slice(start, end);
  // An arrow that points back at the first element points on to the second with its mark there.
  if (backward)
    rearrow(
      lines,
      found,
      arrow.replace(
        /^([<ox])(-+)$/,
        (_, mark: string, stroke: string) => stroke + (mark === "<" ? ">" : mark),
      ),
      false,
    );
  else rearrow(lines, found, arrow, true);
  return lines.join("\n");
}

/** Words that open a statement: no element goes by one of them. */
const RESERVED =
  /^(actor|end|note|direction|systemBoundary|class|classDef|style|json|title|accTitle|accDescr)$/;

/**
 * Gives an actor, a use case or a system boundary another id, wherever the source names it: in
 * its declarations, relations, notes and styling lines. An element that has no label is shown
 * under its id, so it shows the new one; one whose quoted name is its id (`"Log out"`) keeps that
 * name as its label, and a label that says what the new id says goes (`actor Clerk`, not
 * `actor Clerk(Clerk)`) where the shape does not hang on its brackets. The source comes back unchanged when the new id is not a word of letters,
 * digits and underscores, is a word of the syntax, or is taken.
 */
export function renameUsecaseId(source: string, id: string, newId: string): string {
  const { diagram, lines, statements } = model(source),
    name = newId.trim(),
    element = diagram.elements.get(id),
    part = element ?? diagram.boundaries.get(id);
  if (!part || !canTakeId(diagram, id, name)) return source;
  const boundary = !element;
  writeId(
    lines,
    idPlaces(lines, statements, id, boundary),
    name,
    part.label === id && part.label,
    boundary,
  );
  const result = lines.join("\n"),
    now = reads(result);
  if (!now || !renamedOnly(diagram, now, id, name, boundary)) return source;
  return part.label === name ? withoutEcho(result, now, name, boundary) : result;
}

/**
 * Writes a new id at the places of the old one, from the right so the places before keep their
 * columns. Where the old id is a quoted name shown as it is, the first quoted place carries that
 * name on as the label.
 */
function writeId(
  lines: string[],
  places: IdPlace[],
  name: string,
  shown: string | false,
  boundary: boolean,
) {
  const labelled = shown ? places.find((place) => place.quoted) : undefined,
    [open, close] = boundary ? "[]" : "()";
  for (const found of places.toSorted((a, b) => b.index - a.index || b.start - a.start)) {
    const label = found === labelled ? `${open}${nameText(shown as string)}${close}` : "";
    splice(lines, found.index, found.start, found.end, name + label);
  }
}

/** Whether a part can go by a new id: a word that is no word of the syntax and that nothing has. */
const canTakeId = (diagram: UseCaseDiagram, id: string, name: string) =>
  name !== id &&
  /^\w+$/.test(name) &&
  !RESERVED.test(name) &&
  !/^note\d+$/.test(name) &&
  !diagram.elements.has(name) &&
  !diagram.boundaries.has(name);

/** Where the source names a part by its id: the line, the columns, and whether the id is a quoted name. */
interface IdPlace {
  index: number;
  start: number;
  end: number;
  quoted: boolean;
}

/** Every place the source names a part by its id: its mentions, and for an element its notes and styling. */
function idPlaces(lines: string[], statements: Statement[], id: string, boundary: boolean) {
  const places: IdPlace[] = mentionsOf(statements, id, boundary).map(({ index, mention }) => ({
    index,
    start: mention.start,
    end: mention.idEnd,
    quoted: mention.quoted,
  }));
  if (boundary) return places;
  for (const item of statements)
    for (const start of plainPlaces(lines[item.index], item, id))
      places.push({ index: item.index, start, end: start + id.length, quoted: false });
  return places;
}

/** Where a line names an element by its plain id outside a declaration: in a note, `style id fill:…` and `class id, other name`. */
function plainPlaces(line: string, item: Statement, id: string): number[] {
  if (item.note)
    return line.slice(item.note.id.start, item.note.id.end) === id ? [item.note.id.start] : [];
  if (item.kind !== "other") return [];
  const styled = line.match(/^(\s*style\s+)(\w+)/),
    classed = line.match(/^(\s*class\s+)(.+?)\s+[\w-]+\s*$/);
  if (styled) return styled[2] === id ? [styled[1].length] : [];
  return classed
    ? [...classed[2].matchAll(/\w+/g)]
        .filter((word) => word[0] === id)
        .map((word) => classed[1].length + word.index)
    : [];
}

/** Whether a diagram is another one with one part's id changed, and nothing else lost. */
function renamedOnly(
  before: UseCaseDiagram,
  after: UseCaseDiagram,
  id: string,
  name: string,
  boundary: boolean,
) {
  return (
    (boundary ? after.boundaries : after.elements).has(name) &&
    !after.elements.has(id) &&
    !after.boundaries.has(id) &&
    after.elements.size === before.elements.size &&
    after.boundaries.size === before.boundaries.size &&
    after.relations.length === before.relations.length &&
    after.notes.length === before.notes.length
  );
}

/**
 * The source without the label of a part where it says what the id says, when the part is to
 * read and to draw the same without it.
 */
function withoutEcho(result: string, now: UseCaseDiagram, name: string, boundary: boolean) {
  const bare = renameUseCase(result, name, name),
    short = reads(bare);
  return short &&
    drawnAlike(short, now, name, boundary) &&
    short.elements.size === now.elements.size
    ? bare
    : result;
}

/** Whether a part reads and draws the same in two diagrams: its label, and an element's shape and boundary. */
function drawnAlike(a: UseCaseDiagram, b: UseCaseDiagram, name: string, boundary: boolean) {
  if (boundary) return a.boundaries.get(name)?.label === b.boundaries.get(name)?.label;
  const looks = (diagram: UseCaseDiagram) => {
    const item = diagram.elements.get(name);
    return item && JSON.stringify([item.label, item.shape, item.boundary]);
  };
  return looks(a) === looks(b);
}

/** The ids a new part gets, before its first name. */
const GENERATED = /^(?:usecase|actor|system)\d+$/;

/** The id a copy of an element is made from, a number after it. */
const copyBase = (id: string, kind: "actor" | "usecase") =>
  notable(id) ? id : idWord(id) || (kind === "actor" ? "actor" : "usecase");

/**
 * Whether an actor, a use case or a boundary goes by an id that an edit made up and its first
 * name may replace: `usecase1`, `actor1` or `system1` as a new one gets them, and the id of a
 * copy (`browse2` beside `browse`) while the copy still shows the name of its original or its
 * own id.
 */
export function isGeneratedUsecaseId(source: string, id: string): boolean {
  const diagram = parseUseCaseDiagram(source),
    item = diagram.elements.get(id);
  if (!item) return diagram.boundaries.has(id) && GENERATED.test(id);
  if (GENERATED.test(id)) return true;
  return [...diagram.elements.values()].some((original) => {
    const base = copyBase(original.id, original.kind),
      number = id.startsWith(base) ? id.slice(base.length) : "";
    return (
      original !== item &&
      /^\d+$/.test(number) &&
      Number(number) > 1 &&
      (item.label === id || item.label === original.label)
    );
  });
}

/**
 * A name as an id: one word as it is (`Clerk`), several as one in camel case (`Archive Item` is
 * `archiveItem`). Empty for a name with letters an id cannot have.
 */
function idWord(name: string): string {
  if (/[^\s -~]/.test(name)) return "";
  const [first, ...rest] = name.split(/\W+/).filter(Boolean);
  if (!first || !rest.length) return first ?? "";
  // An abbreviation keeps its capitals.
  const head = /^[A-Z]{2}/.test(first) ? first : first[0].toLowerCase() + first.slice(1);
  return head + rest.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
}

/**
 * Gives an actor, a use case or a boundary that was just added its first name: the id follows the
 * name wherever the source names it (`Archive Item` makes `archiveItem(Archive Item)`, `Clerk`
 * makes `actor Clerk`), unless the name has no word an id can be or the id is taken; then the id
 * stays and the name is its label. A note gets its text. Returns the id the part has afterwards.
 */
function retitleUseCase(source: string, id: string, name: string): { source: string; id: string } {
  const diagram = parseUseCaseDiagram(source),
    word = idWord(name),
    has = (found: UseCaseDiagram, key: string) =>
      found.elements.has(key) || found.boundaries.has(key);
  let next = id;
  if (word && word !== id && has(diagram, id) && !has(diagram, word)) {
    const renamed = renameUsecaseId(source, id, word);
    if (has(parseUseCaseDiagram(renamed), word)) [source, next] = [renamed, word];
  }
  return { source: renameUseCase(source, next, name), id: next };
}

/**
 * Adds a copy of an actor or a use case: its name, shape and stereotype under an id of its own
 * (`browse2`), beside the element where a line of its own declares it and else where its kind
 * stands, in its boundary, with none of its relations. Returns the id of the copy, empty for what
 * is no element.
 */
export function duplicateUsecasePart(source: string, id: string): { source: string; id: string } {
  const { diagram, lines, statements } = model(source),
    item = diagram.elements.get(id);
  if (!item) return { source, id: "" };
  const copy = freshId(diagram, copyBase(id, item.kind), 2),
    name = copyName(item, copy),
    { at, indent } = copyPlace(diagram, lines, statements, item);
  lines.splice(at, 0, indent + (item.kind === "actor" ? `actor ${name}` : name));
  return { source: lines.join("\n"), id: copy };
}

/** The name of a copy of an element as it is declared: its id, with the label, shape and stereotype of the original. */
function copyName(item: UseCaseElement, copy: string): string {
  const [open, close] = item.shape === "rect" ? "[]" : "()",
    // A box is one by the brackets of its label.
    bare = item.label === item.id && notable(item.id) && item.shape !== "rect",
    label = bare ? "" : `${open}${nameText(item.label)}${close}`;
  return `${copy}${label}${item.stereotype ? ` <<${item.stereotype}>>` : ""}`;
}

/**
 * Where a copy of an element is declared: after the line of its own that declares the element,
 * else in its boundary, else where its kind stands.
 */
function copyPlace(
  diagram: UseCaseDiagram,
  lines: string[],
  statements: Statement[],
  item: UseCaseElement,
) {
  const declared = statements.find((found) => found.index === item.line - 1),
    boundary = item.boundary ? diagram.boundaries.get(item.boundary) : undefined;
  if (declared && !declared.arrow && (declared.kind === "actors" || declared.kind === "element"))
    return { at: declared.index + 1, indent: indentOf(lines[declared.index]) };
  return boundary ? insertAt(lines, statements, boundary) : place(lines, statements, item.kind);
}

/**
 * Moves a use case into a system boundary, or out of every boundary with null: the lines that
 * declare it go, and one declares it at the end of the boundary, or where the use cases stand
 * outside. A use case that relations only mention is declared there. Actors stand outside the
 * boundaries and are not moved.
 */
export function moveUsecaseInto(source: string, id: string, boundary: string | null): string {
  const { diagram, lines, statements } = model(source),
    item = diagram.elements.get(id);
  if (!item || !movable(diagram, item, boundary)) return source;
  const { text, rest } = withoutDeclarations(lines, statements, id),
    result = declaredIn(rest, id, text, boundary),
    now = reads(result);
  return now && arrived(diagram, now, item, boundary) ? result : source;
}

/**
 * The source with a use case declared at the end of a boundary, or where the use cases stand
 * outside. Outside, a use case that a relation still names needs no line of its own.
 */
function declaredIn(
  rest: ReturnType<typeof statementsOf>,
  id: string,
  text: string,
  boundary: string | null,
): string {
  const into = rest.statements.find(
    (found) => found.kind === "boundary" && found.mentions[0].id === boundary,
  );
  if (!into && namedIn(rest.statements, id) && text === ref(id)) return rest.lines.join("\n");
  const { at, indent } = into
    ? insertAt(rest.lines, rest.statements, { line: into.index + 1 })
    : place(rest.lines, rest.statements, "usecase");
  rest.lines.splice(at, 0, indent + text);
  return rest.lines.join("\n");
}

/** Whether an element is a use case that can move into a boundary, or out with null, from where it stands. */
const movable = (diagram: UseCaseDiagram, item: UseCaseElement, boundary: string | null) =>
  item.kind === "usecase" &&
  item.boundary !== boundary &&
  (boundary === null || diagram.boundaries.has(boundary));

/** Whether a use case stands in a boundary now, with its label, and no element was lost. */
function arrived(
  before: UseCaseDiagram,
  now: UseCaseDiagram,
  item: UseCaseElement,
  boundary: string | null,
) {
  const moved = now.elements.get(item.id);
  return (
    moved?.boundary === boundary &&
    now.elements.size === before.elements.size &&
    moved.label === item.label
  );
}

/**
 * The lines without those that declare a use case, and the declaration that says most of it: the
 * last with a label, or the first, or else its id.
 */
function withoutDeclarations(lines: string[], statements: Statement[], id: string) {
  const declarations = statements.filter(
      (found) => found.kind === "element" && !found.arrow && found.mentions[0].id === id,
    ),
    said =
      declarations.findLast(({ mentions: [mention] }) => mention.end > mention.idEnd) ??
      declarations[0],
    gone = new Set(declarations.map((found) => found.index));
  return {
    text: said ? lines[said.index].trim() : ref(id),
    rest: statementsOf(lines.filter((_, index) => !gone.has(index)).join("\n")),
  };
}

/** Whether a statement other than a boundary still names an element. */
const namedIn = (statements: Statement[], id: string) =>
  statements.some(
    (found) =>
      found.kind !== "boundary" &&
      [...found.mentions, ...(found.target ? [found.target] : [])].some(
        (mention) => mention.id === id,
      ),
  );

/** Removes a system boundary and keeps what it holds: its use cases stand where it stood, one level out. */
export function ungroupUsecaseBoundary(source: string, id: string): string {
  const { diagram, lines, statements } = model(source),
    boundary = diagram.boundaries.get(id);
  if (!boundary) return source;
  const start = boundary.line - 1,
    end = blockEnd(statements, start, lines),
    outdent = outdenter(lines, statements, start, end);
  return lines
    .flatMap((line, index) => {
      if (index === start || index === end) return [];
      return [index > start && index < end ? outdent(line) : line];
    })
    .join("\n");
}

/** What takes a line of a boundary's block one level out: the indent of the boundary in place of that of its block. */
function outdenter(lines: string[], statements: Statement[], start: number, end: number) {
  const indent = indentOf(lines[start]),
    first = statements.find((item) => item.index > start && item.index < end),
    inner = first ? indentOf(lines[first.index]) : indent;
  return (line: string) =>
    inner.length > indent.length && line.startsWith(inner)
      ? indent + line.slice(inner.length)
      : line;
}

/**
 * Removes elements with their relations and notes, boundaries with what they hold, and single
 * relations and notes, by id. An element that only loses a relation stays: where the relation's
 * line was the only one to name it, or gave it its label, that part of the line is kept.
 */
export function removeUseCase(source: string, ids: Iterable<string>): string {
  const { diagram, lines, statements } = model(source),
    named = new Set(ids),
    { gone, dropped } = chosenParts(diagram, lines, statements, named),
    cut = cutRelations(diagram, named, gone);
  dropFollowers(diagram, lines, statements, named, gone, dropped);
  const removal = { lines, gone, cut, standing: standingAfter(statements, dropped, cut) },
    rewritten = new Map<number, string[]>();
  for (const item of statements)
    if (!dropped.has(item.index) && loses(item, removal))
      rewritten.set(item.index, whatStays(item, removal));
  // Bottom up, so the lines above keep their numbers.
  for (let index = lines.length - 1; index >= 0; index--) {
    if (dropped.has(index)) lines.splice(index, 1);
    else if (rewritten.has(index)) lines.splice(index, 1, ...rewritten.get(index)!);
  }
  return lines.join("\n");
}

/** Adds to the dropped lines the notes chosen or of an element that goes, and the styling of an element that goes. */
function dropFollowers(
  diagram: UseCaseDiagram,
  lines: string[],
  statements: Statement[],
  named: Set<string>,
  gone: Set<string>,
  dropped: Set<number>,
) {
  for (const note of diagram.notes)
    if (named.has(note.id) || gone.has(note.target)) dropped.add(note.line - 1);
  for (const item of statements)
    if (item.kind === "other" && gone.has(styledId(lines[item.index]))) dropped.add(item.index);
}

/** The lines whose relation goes: one chosen, or one of an element that goes. */
const cutRelations = (diagram: UseCaseDiagram, named: Set<string>, gone: Set<string>) =>
  new Set(
    diagram.relations
      .filter((item) => named.has(item.id) || gone.has(item.source) || gone.has(item.target))
      .map((item) => item.line - 1),
  );

/** Whether a line that declares or relates elements loses its relation or one of them. */
const loses = (item: Statement, { gone, cut }: Removal) =>
  (item.kind === "actors" || item.kind === "element") &&
  (cut.has(item.index) || item.mentions.some((mention) => gone.has(mention.id)));

/** The id a `style` line styles; empty for another line. */
const styledId = (line: string) => line.trim().match(/^style\s+(\w+)/)?.[1] ?? "";

/** The elements chosen to go, also those of a chosen boundary, and the lines of the chosen boundaries. */
function chosenParts(
  diagram: UseCaseDiagram,
  lines: string[],
  statements: Statement[],
  named: Set<string>,
) {
  const gone = new Set<string>(),
    dropped = new Set<number>();
  for (const id of named) {
    const boundary = diagram.boundaries.get(id);
    if (diagram.elements.has(id)) gone.add(id);
    else if (boundary) {
      const end = blockEnd(statements, boundary.line - 1, lines);
      for (let index = boundary.line - 1; index <= end; index++) dropped.add(index);
      for (const item of diagram.elements.values()) if (item.boundary === id) gone.add(item.id);
    }
  }
  return { gone, dropped };
}

/** The elements some line still names once the dropped lines and the cut relations are gone. */
function standingAfter(statements: Statement[], dropped: Set<number>, cut: Set<number>) {
  const standing = new Set<string>();
  for (const item of statements) {
    if (dropped.has(item.index)) continue;
    const stays = cut.has(item.index)
      ? item.kind === "actors"
        ? item.mentions
        : []
      : [...item.mentions, ...(item.target ? [item.target] : [])];
    for (const mention of stays) standing.add(mention.id);
  }
  return standing;
}

/** What a removal takes from the lines that declare elements and relate them. */
interface Removal {
  lines: string[];
  /** The elements that go. */
  gone: Set<string>;
  /** The lines whose relation goes. */
  cut: Set<number>;
  /** The elements some line still names; those this keeps join them. */
  standing: Set<string>;
}

/** The lines a statement leaves once the elements and relations that go are gone. */
function whatStays(item: Statement, { lines, gone, cut, standing }: Removal): string[] {
  const severed = cut.has(item.index),
    line = lines[item.index],
    indent = indentOf(line),
    out: string[] = [];
  // What a line says of an element apart from its relation: its label, or that it is there at all.
  const loose = (mention: Mention) => {
    const own = line.slice(mention.start, mention.end);
    if (gone.has(mention.id) || (own === ref(mention.id) && standing.has(mention.id))) return;
    standing.add(mention.id);
    out.push(indent + own);
  };
  if (item.kind === "actors") out.push(...actorsLeft(item, line, gone, severed));
  else if (severed) loose(item.mentions[0]);
  if (severed && item.target) loose(item.target);
  return out;
}

/** The `actor` line with the actors that stay, and its relation unless it goes; none when no actor stays. */
function actorsLeft(item: Statement, line: string, gone: Set<string>, severed: boolean) {
  const kept = item.mentions
      .filter((mention) => !gone.has(mention.id))
      .map((mention) => line.slice(mention.start, mention.end)),
    rest = severed ? "" : line.slice(item.mentions.at(-1)!.end).trimEnd();
  return kept.length ? [`${indentOf(line)}actor ${kept.join(", ")}${rest}`] : [];
}

/**
 * Joins two elements as `connectUseCase` does and says which relation it wrote. No edge when
 * nothing is written, and none for a note, which has no join of its own.
 */
export function joinUseCase(
  source: string,
  from: string,
  to: string,
  kind?: string,
): { source: string; edge: string } {
  const result = connectUseCase(source, from, to, kind);
  if (result === source) return { source, edge: "" };
  const before = parseUseCaseDiagram(source).relations.length,
    relations = parseUseCaseDiagram(result).relations;
  // A new relation is the last statement, and so the last relation.
  return { source: result, edge: relations.length > before ? relations.at(-1)!.id : "" };
}

/** What each kind of relation joins, as a sentence for the user. */
const RULES: Record<string, string> = {
  association: "An association joins an actor and a use case.",
  undirected: "An association joins an actor and a use case.",
  include: "«include» joins two use cases.",
  extend: "«extend» joins two use cases.",
  generalization: "A generalization joins two actors or two use cases.",
};

/**
 * Why two parts are not joined by a relation of a kind, in words for the user: the rule of UML
 * the kind follows, or what the parts are. Undefined when `connectUseCase` joins them.
 */
export function whyNotUsecase(
  source: string,
  from: string,
  to: string,
  kind?: string,
): string | undefined {
  const diagram = parseUseCaseDiagram(source),
    ends = [from, to],
    promised = `note${diagram.notes.length + 1}`,
    isNote = (id: string) =>
      !diagram.elements.has(id) &&
      !diagram.boundaries.has(id) &&
      (id === promised || diagram.notes.some((note) => note.id === id));
  if (ends.some(isNote)) return whyNotNote(diagram, ends, isNote);
  if (ends.some((id) => !diagram.elements.has(id))) return whyNotEnds(diagram, ends);
  if (kind === undefined) return undefined;
  if (!ARROWS[kind]) return "There is no relation of that kind.";
  return fits(diagram, from, to, kind) ? undefined : RULES[kind];
}

/** Why two ends, one of which is no element, have no relation. */
const whyNotEnds = (diagram: UseCaseDiagram, ends: string[]) =>
  ends.some((id) => diagram.boundaries.has(id))
    ? "A system boundary has no relations of its own: join the use cases in it."
    : "A relation joins actors and use cases.";

/** Why a note among two ends is not joined to the other end. */
function whyNotNote(diagram: UseCaseDiagram, ends: string[], isNote: (id: string) => boolean) {
  const other = ends.find((id) => !isNote(id));
  if (other === undefined) return "A note is for an actor or a use case, not for another note.";
  const target = diagram.elements.get(other);
  if (!target) return "A note is for an actor or a use case.";
  return notable(target.id)
    ? undefined
    : "A note cannot name a part that goes by its quoted name: give it an id first.";
}

/**
 * Adds a piece at a part and says what it wrote: the id of the piece, and the id of the relation
 * that joins it to the part when there is one. A use case added at an actor and an actor added at
 * a use case are joined, from the actor; with a `link` every actor or use case is joined to the
 * element it is added at, by a relation of that kind where UML has it between the two and else by
 * the usual one. A use case stands in the boundary of the use case it is added at, or in the
 * boundary it is added at. A note is the note of the element. The id is empty, with the source
 * unchanged, when nothing is written: a note at a boundary.
 */
export function attachUsecase(
  source: string,
  piece: { kind: string; label?: string },
  at: string,
  link?: string,
): { source: string; id: string; edge: string } {
  const host = parseUseCaseDiagram(source).elements.get(at),
    kind = piece.kind as UseCasePiece,
    added = addUseCasePiece(source, {
      kind,
      label: piece.label,
      parent: kind === "note" || !host ? at : host.boundary,
    });
  if (!added.id || added.source === source) return { source, id: "", edge: "" };
  if (!host || kind === "note" || kind === "boundary") return { ...added, edge: "" };
  const joined = joinAdded(added, kind, host, link);
  return joined ? { ...joined, id: added.id } : { ...added, edge: "" };
}

/**
 * Joins a piece just added to the element it was added at, from the actor: by a relation of the
 * link's kind where UML has it between the two and else by the usual one. Undefined where the two
 * are not joined: a piece that joins no such element, with no link.
 */
function joinAdded(
  added: { source: string; id: string },
  kind: UseCasePiece,
  host: UseCaseElement,
  link: string | undefined,
) {
  const own = joinsBy(kind, host);
  if (!own && link === undefined) return undefined;
  // An actor leads to its use case; any other piece follows the part it is added at.
  const [from, to] = own === "before" ? [added.id, host.id] : [host.id, added.id],
    wanted = joinUseCase(added.source, from, to, link);
  return wanted.edge || link === undefined ? wanted : joinUseCase(added.source, from, to);
}

/** How a piece of a kind joins the element it is added at, where it joins one of its kind. */
function joinsBy(kind: UseCasePiece, host: UseCaseElement) {
  const own = usecaseStructure.pieces.find((item) => item.kind === kind);
  if (!own?.joins) return undefined;
  return !own.joinsTo || own.joinsTo.includes(host.kind) ? own.joins : undefined;
}

/**
 * What a removal takes with it, in words: the boundaries, actors and use cases it names, and how
 * many use cases, relations and notes go with them, as in `System boundary Library with 3 use
 * cases and 2 relations`; for relations and notes alone, how many go. Empty when the removal
 * changes nothing.
 */
export function usecaseRemovalSummary(source: string, ids: Iterable<string>): string {
  const chosen = new Set(ids),
    before = parseUseCaseDiagram(source),
    after = parseUseCaseDiagram(removeUseCase(source, chosen)),
    plain = (label: string) => label.replace(/<br\s*\/?>/gi, " "),
    elements = [...before.elements.values()],
    names = [
      ...[...before.boundaries.values()]
        .filter((item) => chosen.has(item.id) && !before.elements.has(item.id))
        .map((item) => `System boundary ${plain(item.label)}`),
      ...elements.filter((item) => chosen.has(item.id)).map((item) => plain(item.label)),
    ],
    // What goes beside the parts the summary names: those are not counted again.
    beside = (all: { id: string }[], left: number) =>
      all.length - left - (names.length ? all.filter(({ id }) => chosen.has(id)).length : 0),
    of = (kind: string, diagram: UseCaseDiagram) =>
      [...diagram.elements.values()].filter((item) => item.kind === kind),
    rest = [
      ...counted(beside(of("usecase", before), of("usecase", after).length), "use case"),
      ...counted(beside(of("actor", before), of("actor", after).length), "actor"),
      ...counted(beside(before.relations, after.relations.length), "relation"),
      ...counted(beside(before.notes, after.notes.length), "note"),
    ];
  return names.length
    ? `${names.join(", ")}${rest.length ? ` with ${listed(rest)}` : ""}`
    : listed(rest);
}

/**
 * Use case diagrams as a structure a canvas edits. Its parts are the actors, use cases, system
 * boundaries and notes under the ids of their shapes; its joins are the relations under the ids
 * of their wires (`r1`, `r2`… in the order of the source). The dashed line from a note to its
 * element is no join of its own: it comes and goes with the note.
 *
 * A piece added at a part is joined to it only where the two have a relation of their own: a use
 * case to an actor, an actor to a use case, a note to its element.
 */
export const usecaseStructure: Structure = {
  pieces: [
    {
      kind: "usecase",
      name: "Use case",
      about: "Behavior of the subject that yields an observable result for an actor",
      joins: "after",
      joinsTo: ["actor"],
      named: true,
    },
    {
      kind: "actor",
      name: "Actor",
      about: "Role of a human or a system external to the subject",
      joins: "before",
      joinsTo: ["usecase"],
      named: true,
    },
    {
      kind: "boundary",
      name: "System boundary",
      about: "Subject: the system that owns the use cases",
      group: true,
      named: true,
    },
    {
      kind: "note",
      name: "Note",
      about: "Comment attached to an actor or a use case",
      joins: "before",
      joinsTo: ["usecase", "actor"],
      named: true,
    },
  ],
  links: [
    { kind: "association", name: "Association" },
    { kind: "undirected", name: "Association, no arrow" },
    { kind: "include", name: "Include" },
    { kind: "extend", name: "Extend" },
    { kind: "generalization", name: "Generalization" },
  ],
  read(source) {
    const diagram = parseUseCaseDiagram(source);
    const parts: StructureNode[] = [
      ...[...diagram.boundaries.values()].map((item) => ({
        ...item,
        parent: null,
        group: true,
        kind: "boundary",
      })),
      ...[...diagram.elements.values()].map((item) => ({
        id: item.id,
        label: item.label,
        parent: item.boundary,
        line: item.line,
        group: false,
        kind: item.kind,
      })),
      ...diagram.notes.map((item) => ({
        id: item.id,
        label: item.text,
        parent: null,
        line: item.line,
        group: false,
        kind: "note",
      })),
    ].toSorted((a, b) => a.line - b.line);
    // A boundary first, then what it holds, also what a line above it already named.
    const nodes = parts
      .filter((item) => !item.parent)
      .flatMap((item) =>
        item.group ? [item, ...parts.filter((other) => other.parent === item.id)] : [item],
      );
    return {
      nodes,
      edges: diagram.relations.map((item): UseCaseEdge => ({
        id: item.id,
        source: item.source,
        target: item.target,
        label: item.label,
        line: item.line,
        kind: kindOf(item),
        // «include» and «extend» are named by their kind, a generalization carries no text.
        ...(item.kind === "association" ? {} : { fixedLabel: true }),
      })),
    };
  },
  add: (source, piece) => addUseCasePiece(source, { ...piece, kind: piece.kind as UseCasePiece }),
  connect: connectUseCase,
  rename: renameUseCase,
  retitle: retitleUseCase,
  label: labelUseCaseRelation,
  relink: relinkUseCase,
  remove: (source, ids) => removeUseCase(source, ids),
};
