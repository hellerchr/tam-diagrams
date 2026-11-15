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
import { parseUseCaseDiagram, type UseCaseDiagram, type UseCaseRelation } from "./uml-usecase.ts";

/** A join of a use case diagram as `read` gives it. */
export interface UseCaseEdge extends StructureEdge {
  /** Whether the join carries no label to edit: every relation but an association. */
  fixedLabel?: boolean;
}

/** What a canvas adds to a use case diagram. */
export type UseCasePiece = "usecase" | "actor" | "boundary" | "note";

const linesOf = (source: string) => source.replace(/\r\n?/g, "\n").split("\n");

const indentOf = (line: string) => line.match(/^\s*/)![0];

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
  const space = (at: number) => at + line.slice(at).match(/^\s*/)![0].length;
  if (/^(direction\s|classDef\b|class\b|style\b)/.test(text)) return found;
  if (text === "end") return { ...found, kind: "end" };
  let match: RegExpMatchArray | null;
  if ((match = text.match(/^systemBoundary\s+/))) {
    const mention = mentionAt(line, pad + match[0].length);
    return mention ? { ...found, kind: "boundary", mentions: [mention] } : found;
  }
  if ((match = text.match(/^(note\s+for\s+)(\w+)(\s+)(.+)$/))) {
    const id = pad + match[1].length,
      from = id + match[2].length + match[3].length;
    return {
      ...found,
      kind: "note",
      note: {
        id: { start: id, end: id + match[2].length },
        text: { start: from, end: from + match[4].length },
      },
    };
  }
  let at = pad;
  if ((match = text.match(/^actor\s+/))) {
    found.kind = "actors";
    for (at += match[0].length; ; at = space(at + 1)) {
      const mention = mentionAt(line, at);
      if (!mention) return found;
      found.mentions.push(mention);
      at = space(mention.end);
      if (line[at] !== ",") break;
    }
  } else {
    const mention = mentionAt(line, at);
    if (!mention) return found;
    found.kind = "element";
    found.mentions.push(mention);
    at = space(mention.end);
  }
  if (at >= line.trimEnd().length) return found;
  // A relation: an arrow, after the id some give their line (`e1@-->`), and the other element.
  at += line.slice(at).match(/^\w+@(?=[-<.ox])/)?.[0].length ?? 0;
  const rest = line.slice(at),
    labelled = rest.match(LABELLED),
    plain = labelled ? undefined : PLAIN.find(([pattern]) => pattern.test(rest));
  const length = labelled ? labelled[0].length : plain ? rest.match(plain[0])![0].length : 0;
  const target = length ? mentionAt(line, space(at + length)) : null;
  if (!target) return found;
  return {
    ...found,
    arrow: { start: at, end: at + length, backward: plain?.[1] ?? false },
    target,
  };
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
function freshId(diagram: UseCaseDiagram, base: string, from = 1): string {
  for (let count = from; ; count++) {
    const id = `${base}${count}`;
    if (!diagram.elements.has(id) && !diagram.boundaries.has(id)) return id;
  }
}

/** The index of the line with the `end` that closes the boundary opened on a line. */
function blockEnd(statements: Statement[], start: number, lines: string[]): number {
  return (
    statements.find((item) => item.kind === "end" && item.index > start)?.index ?? lines.length - 1
  );
}

/** Where a statement is added: before the `end` of a boundary, or after the last line with text. */
function insertAt(lines: string[], statements: Statement[], boundary?: { line: number }) {
  if (boundary) {
    const start = boundary.line - 1,
      end = blockEnd(statements, start, lines),
      child = statements.find((item) => item.index > start && item.index < end);
    return {
      at: end,
      indent: child ? indentOf(lines[child.index]) : `${indentOf(lines[start])}  `,
    };
  }
  let at = lines.length;
  while (at > 0 && !lines[at - 1].trim()) at--;
  return { at, indent: statements.length ? indentOf(lines[statements[0].index]) : "  " };
}

/**
 * Where a new part that stands in no boundary goes: an actor after the last line that declares
 * actors, a use case after the last one declared outside the boundaries, a boundary after the
 * last boundary, and each before the first relation where its kind is missing; a note after the
 * last note. Else, and when that is not below the line `after`, after the last line with text.
 */
function place(lines: string[], statements: Statement[], kind: UseCasePiece, after = -1) {
  const indent = statements.length ? indentOf(lines[statements[0].index]) : "  ";
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  const root: Statement[] = [];
  let open = false;
  for (const item of statements) {
    if (item.kind === "boundary") open = true;
    else if (item.kind === "end") open = false;
    if (!open) root.push(item);
  }
  // The notes are numbered in their order: a new one is the last, also of those in a boundary.
  const note = statements.findLast((item) => item.kind === "note"),
    last =
      kind === "note"
        ? note && root.includes(note)
          ? note
          : undefined
        : kind === "boundary"
          ? root.findLast((item) => item.kind === "end")
          : root.findLast(
              (item) => item.kind === (kind === "actor" ? "actors" : "element") && !item.arrow,
            );
  let at = last ? last.index + 1 : undefined;
  if (at === undefined && kind !== "note") {
    at = root.find((item) => item.arrow)?.index;
    // A comment above the first relation stays with it.
    while (at && lines[at - 1].trim().startsWith("%%")) at--;
  }
  return { at: at === undefined || at <= after ? end : at, indent };
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
    label = piece.label?.trim() ? piece.label : "",
    parent = piece.parent ? diagram.boundaries.get(piece.parent) : undefined;
  if (piece.kind === "note") {
    const target = piece.parent ? diagram.elements.get(piece.parent) : undefined,
      id = `note${diagram.notes.length + 1}`;
    if (target && notable(target.id))
      return { source: withNote(lines, statements, target, label), id };
    return { source, id: [...diagram.elements.keys()].some(notable) ? id : "" };
  }
  const id = freshId(
    diagram,
    piece.kind === "boundary" ? "system" : piece.kind === "actor" ? "actor" : "usecase",
  );
  const { at, indent } =
    piece.kind === "usecase" && parent
      ? insertAt(lines, statements, parent)
      : place(lines, statements, piece.kind);
  const text =
    piece.kind === "boundary"
      ? [`systemBoundary ${id}[${nameText(label || "System")}]`, "end"]
      : piece.kind === "actor"
        ? [`actor ${id}(${nameText(label || "Actor")})`]
        : [`${id}(${nameText(label || "Use case")})`];
  lines.splice(at, 0, ...text.map((line) => indent + line));
  return { source: lines.join("\n"), id };
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
  const { diagram, lines, statements } = model(source),
    note = diagram.notes.find((item) => item.id === from || item.id === to),
    promised = `note${diagram.notes.length + 1}`;
  if (!note && (from === promised) !== (to === promised) && !diagram.elements.has(promised)) {
    const target = diagram.elements.get(from === promised ? to : from);
    return target && notable(target.id) ? withNote(lines, statements, target, "") : source;
  }
  if (note) {
    const target = diagram.elements.get(note.id === from ? to : from),
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
  const first = diagram.elements.get(from),
    second = diagram.elements.get(to);
  if (!first || !second) return source;
  const wanted =
    kind ??
    (first.kind !== second.kind
      ? "association"
      : first.kind === "actor"
        ? "generalization"
        : "include");
  if (!ARROWS[wanted] || !fits(diagram, from, to, wanted)) return source;
  const { at, indent } = insertAt(lines, statements);
  lines.splice(at, 0, `${indent}${ref(from)} ${ARROWS[wanted]} ${ref(to)}`);
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
    text = nameText(label);
  const note = diagram.notes.find((item) => item.id === id);
  if (note && !diagram.elements.has(id) && !diagram.boundaries.has(id)) {
    const found = statements.find((item) => item.index === note.line - 1)?.note;
    if (!found || !text) return source;
    const line = lines[note.line - 1];
    lines[note.line - 1] = `${line.slice(0, found.text.start)}"${escaped(label)}"`;
    return lines.join("\n");
  }
  const boundary = !diagram.elements.has(id) && diagram.boundaries.has(id);
  if (!boundary && !diagram.elements.has(id)) return source;
  const [open, close] = boundary ? "[]" : "()",
    places = statements
      .filter((item) =>
        boundary ? item.kind === "boundary" : item.kind === "actors" || item.kind === "element",
      )
      .flatMap((item) =>
        [...item.mentions, ...(item.target ? [item.target] : [])]
          .filter((mention) => mention.id === id)
          .map((mention) => ({ index: item.index, mention })),
      );
  if (!places.length) return source;
  const put = (index: number, start: number, end: number, inner: string) => {
    lines[index] = lines[index].slice(0, start) + inner + lines[index].slice(end);
  };
  if (!/^\w+$/.test(id)) {
    // The quoted name is the id: every mention gets the new one, unless that is taken.
    const key = labelText(`"${escaped(label)}"`);
    if (!key || key === id) return source;
    if (boundary ? diagram.boundaries.has(key) : diagram.elements.has(key)) return source;
    // From the right, so the places before keep their columns.
    for (const { index, mention } of places.toReversed())
      put(index, mention.start, mention.idEnd, `"${escaped(label)}"`);
    return lines.join("\n");
  }
  if (!text || label.trim() === id) {
    for (const { index, mention } of places.toReversed())
      if (mention.label) put(index, mention.idEnd, mention.nameEnd, "");
    return lines.join("\n");
  }
  // The last label is the one that counts.
  const labelled = places.findLast((place) => place.mention.label);
  if (labelled) {
    const { start, end } = labelled.mention.label!;
    put(labelled.index, start, end, text);
  } else {
    const [{ index, mention }] = places;
    put(index, mention.start, mention.idEnd, `${id}${open}${text}${close}`);
  }
  return lines.join("\n");
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
    head = HEADS[relation.end ?? ""] ?? "--",
    tail = TAILS[relation.start ?? ""] ?? "--";
  if (text) rearrow(lines, found, `${tail} ${text} ${head}`, found.arrow!.backward);
  else if (!relation.label) return source;
  // An arrow that only points back is drawn the same from its other end.
  else if (tail !== "--" && head === "--") rearrow(lines, found, HEADS[relation.start!]!, true);
  else rearrow(lines, found, head, false);
  return lines.join("\n");
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
  const plain = kind === "association" || kind === "undirected",
    text = plain && relation.kind === "association" && relation.label;
  rearrow(
    lines,
    found,
    text ? `-- ${relationText(text)} ${ARROWS[kind]}` : ARROWS[kind],
    found.arrow!.backward,
  );
  return lines.join("\n");
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
 * name as its label. The source comes back unchanged when the new id is not a word of letters,
 * digits and underscores, is a word of the syntax, or is taken.
 */
export function renameUsecaseId(source: string, id: string, newId: string): string {
  const { diagram, lines, statements } = model(source),
    name = newId.trim(),
    element = diagram.elements.get(id),
    boundary = element ? undefined : diagram.boundaries.get(id);
  if (
    (!element && !boundary) ||
    name === id ||
    !/^\w+$/.test(name) ||
    RESERVED.test(name) ||
    /^note\d+$/.test(name) ||
    diagram.elements.has(name) ||
    diagram.boundaries.has(name)
  )
    return source;
  const places: { index: number; start: number; end: number; quoted: boolean }[] = [];
  const plain = (index: number, start: number) =>
    places.push({ index, start, end: start + id.length, quoted: false });
  for (const item of statements) {
    const line = lines[item.index];
    if (boundary ? item.kind === "boundary" : item.kind === "actors" || item.kind === "element")
      for (const mention of [...item.mentions, ...(item.target ? [item.target] : [])])
        if (mention.id === id)
          places.push({
            index: item.index,
            start: mention.start,
            end: mention.idEnd,
            quoted: mention.quoted,
          });
    if (boundary) continue;
    if (item.note && line.slice(item.note.id.start, item.note.id.end) === id)
      plain(item.index, item.note.id.start);
    // `style id fill:…` and `class id, other name`.
    const styled = item.kind === "other" && line.match(/^(\s*style\s+)(\w+)/),
      classed = item.kind === "other" && line.match(/^(\s*class\s+)(.+?)\s+[\w-]+\s*$/);
    if (styled && styled[2] === id) plain(item.index, styled[1].length);
    if (classed)
      for (const word of classed[2].matchAll(/\w+/g))
        if (word[0] === id) plain(item.index, classed[1].length + word.index);
  }
  // The first quoted name carries the name on as the label.
  const shown = (element ?? boundary)!.label,
    labelled = places.find((place) => place.quoted && shown === id),
    [open, close] = boundary ? "[]" : "()";
  // From the right, so the places before keep their columns.
  for (const found of places.toSorted((a, b) => b.index - a.index || b.start - a.start))
    lines[found.index] =
      lines[found.index].slice(0, found.start) +
      name +
      (found === labelled ? `${open}${nameText(shown)}${close}` : "") +
      lines[found.index].slice(found.end);
  const result = lines.join("\n"),
    now = reads(result);
  return now &&
    (boundary ? now.boundaries.has(name) : now.elements.has(name)) &&
    !now.elements.has(id) &&
    !now.boundaries.has(id) &&
    now.elements.size === diagram.elements.size &&
    now.boundaries.size === diagram.boundaries.size &&
    now.relations.length === diagram.relations.length &&
    now.notes.length === diagram.notes.length
    ? result
    : source;
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
export function retitleUseCase(
  source: string,
  id: string,
  name: string,
): { source: string; id: string } {
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
  const copy = freshId(
      diagram,
      notable(id) ? id : idWord(id) || (item.kind === "actor" ? "actor" : "usecase"),
      2,
    ),
    [open, close] = item.shape === "rect" ? "[]" : "()",
    // A box is one by the brackets of its label.
    bare = item.label === id && notable(id) && item.shape !== "rect",
    name = `${copy}${bare ? "" : `${open}${nameText(item.label)}${close}`}${item.stereotype ? ` <<${item.stereotype}>>` : ""}`,
    declared = statements.find((found) => found.index === item.line - 1),
    boundary = item.boundary ? diagram.boundaries.get(item.boundary) : undefined;
  const { at, indent } =
    declared && !declared.arrow && (declared.kind === "actors" || declared.kind === "element")
      ? { at: declared.index + 1, indent: indentOf(lines[declared.index]) }
      : boundary
        ? insertAt(lines, statements, boundary)
        : place(lines, statements, item.kind);
  lines.splice(at, 0, indent + (item.kind === "actor" ? `actor ${name}` : name));
  return { source: lines.join("\n"), id: copy };
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
  if (!item || item.kind !== "usecase" || item.boundary === boundary) return source;
  if (boundary !== null && !diagram.boundaries.has(boundary)) return source;
  const declarations = statements.filter(
      (found) => found.kind === "element" && !found.arrow && found.mentions[0].id === id,
    ),
    // The declaration that says most: the last with a label, or the first.
    said =
      declarations.findLast(({ mentions: [mention] }) => mention.end > mention.idEnd) ??
      declarations[0],
    text = said ? lines[said.index].trim() : ref(id),
    gone = new Set(declarations.map((found) => found.index)),
    rest = statementsOf(lines.filter((_, index) => !gone.has(index)).join("\n"));
  const named = rest.statements.some(
      (found) =>
        found.kind !== "boundary" &&
        [...found.mentions, ...(found.target ? [found.target] : [])].some(
          (mention) => mention.id === id,
        ),
    ),
    into = rest.statements.find(
      (found) => found.kind === "boundary" && found.mentions[0].id === boundary,
    );
  // Outside, a use case that a relation still names needs no line of its own.
  if (into || !named || text !== ref(id)) {
    const { at, indent } = into
      ? insertAt(rest.lines, rest.statements, { line: into.index + 1 })
      : place(rest.lines, rest.statements, "usecase");
    rest.lines.splice(at, 0, indent + text);
  }
  const result = rest.lines.join("\n"),
    now = reads(result);
  return now?.elements.get(id)?.boundary === boundary &&
    now.elements.size === diagram.elements.size &&
    now.elements.get(id)!.label === item.label
    ? result
    : source;
}

/** Removes a system boundary and keeps what it holds: its use cases stand where it stood, one level out. */
export function ungroupUsecaseBoundary(source: string, id: string): string {
  const { diagram, lines, statements } = model(source),
    boundary = diagram.boundaries.get(id);
  if (!boundary) return source;
  const start = boundary.line - 1,
    end = blockEnd(statements, start, lines),
    indent = indentOf(lines[start]),
    first = statements.find((item) => item.index > start && item.index < end),
    inner = first ? indentOf(lines[first.index]) : indent;
  return lines
    .flatMap((line, index) =>
      index === start || index === end
        ? []
        : [
            index > start && index < end && inner.length > indent.length && line.startsWith(inner)
              ? indent + line.slice(inner.length)
              : line,
          ],
    )
    .join("\n");
}

/**
 * Removes elements with their relations and notes, boundaries with what they hold, and single
 * relations and notes, by id. An element that only loses a relation stays: where the relation's
 * line was the only one to name it, or gave it its label, that part of the line is kept.
 */
export function removeUseCase(source: string, ids: Iterable<string>): string {
  const { diagram, lines, statements } = model(source),
    named = new Set(ids);
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
  for (const note of diagram.notes)
    if (named.has(note.id) || gone.has(note.target)) dropped.add(note.line - 1);
  // The lines whose relation goes.
  const cut = new Set(
    diagram.relations
      .filter((item) => named.has(item.id) || gone.has(item.source) || gone.has(item.target))
      .map((item) => item.line - 1),
  );
  for (const item of statements)
    if (
      item.kind === "other" &&
      gone.has(lines[item.index].trim().match(/^style\s+(\w+)/)?.[1] ?? "")
    )
      dropped.add(item.index);
  // The elements some line still names once the relations are gone.
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
  const rewritten = new Map<number, string[]>();
  for (const item of statements) {
    if (dropped.has(item.index) || (item.kind !== "actors" && item.kind !== "element")) continue;
    const severed = cut.has(item.index);
    if (!severed && !item.mentions.some((mention) => gone.has(mention.id))) continue;
    const line = lines[item.index],
      indent = indentOf(line),
      out: string[] = [];
    // What a line says of an element apart from its relation: its label, or that it is there at all.
    const loose = (mention: Mention) => {
      const own = line.slice(mention.start, mention.end);
      if (gone.has(mention.id) || (own === ref(mention.id) && standing.has(mention.id))) return;
      standing.add(mention.id);
      out.push(indent + own);
    };
    if (item.kind === "actors") {
      const kept = item.mentions
        .filter((mention) => !gone.has(mention.id))
        .map((mention) => line.slice(mention.start, mention.end));
      const rest = severed ? "" : line.slice(item.mentions.at(-1)!.end).trimEnd();
      if (kept.length) out.push(`${indent}actor ${kept.join(", ")}${rest}`);
    } else if (severed) loose(item.mentions[0]);
    if (severed && item.target) loose(item.target);
    rewritten.set(item.index, out);
  }
  // Bottom up, so the lines above keep their numbers.
  for (let index = lines.length - 1; index >= 0; index--) {
    if (dropped.has(index)) lines.splice(index, 1);
    else if (rewritten.has(index)) lines.splice(index, 1, ...rewritten.get(index)!);
  }
  return lines.join("\n");
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
      about: "Something the system does for an actor",
      joins: "after",
      joinsTo: ["actor"],
      named: true,
    },
    {
      kind: "actor",
      name: "Actor",
      about: "Someone or something that uses the system",
      joins: "before",
      joinsTo: ["usecase"],
      named: true,
    },
    {
      kind: "boundary",
      name: "System boundary",
      about: "The system that holds the use cases",
      group: true,
      named: true,
    },
    {
      kind: "note",
      name: "Note",
      about: "A remark on an actor or a use case",
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
