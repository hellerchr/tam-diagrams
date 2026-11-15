/**
 * Editing a use case diagram source as text: adding, naming, connecting and removing actors, use
 * cases, system boundaries and notes, the way uml-activity-edit.ts edits flowcharts. Each function
 * returns the source with one change made. A line that loses an element or its relation is written
 * anew from what it still says; every other line stays as it was. The layout stays automatic.
 */

import type { Structure, StructureNode } from "./structure.ts";
import { accessibilityLines, labelText, scan } from "./uml.ts";
import { parseUseCaseDiagram, type UseCaseDiagram, type UseCaseRelation } from "./uml-usecase.ts";

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

/** A source as its diagram, its lines, and its statements with their places. */
function model(source: string) {
  const diagram = parseUseCaseDiagram(source),
    lines = linesOf(source),
    skipped = accessibilityLines();
  const statements = scan(source)
    .lines.slice(1)
    .flatMap(({ text, line }) => (skipped(text) ? [] : [statement(lines[line - 1], line - 1)]));
  return { diagram, lines, statements };
}

/** A text as a label holds it: line breaks as `<br>`, and what the parser would decode or drop as entity codes. */
const escaped = (label: string) =>
  label
    .trim()
    .replace(/\s*\n\s*/g, "<br>")
    .replace(/[#&](?=\w+;)/g, (mark) => (mark === "#" ? "#35;" : "#amp;"))
    .replace(/"/g, "#quot;")
    .replace(/<(?!br\s*\/?>)(?=\/?[a-z])/gi, "#lt;");

/** A label between the brackets of an element or boundary: in quotes when it has a mark of the syntax. */
const nameText = (label: string) => {
  const text = escaped(label);
  return /[()[\]{}<>,:@]/.test(text.replace(/<br>/g, "")) ? `"${text}"` : text;
};

/** The text of an association: hyphens are what ends it, so they are written as codes. */
const relationText = (label: string) => escaped(label).replace(/-/g, "#45;").replace(/^>/, "#gt;");

/** An element as a relation refers to it: by its id, or by its quoted name when that is its id. */
const ref = (id: string) => (/^\w+$/.test(id) ? id : `"${escaped(id)}"`);

/** An id no element or boundary has yet. */
function freshId(diagram: UseCaseDiagram, base: string): string {
  for (let count = 1; ; count++) {
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
 * Adds a use case, an actor, a system boundary or a note, and returns the id it got. A use case
 * goes inside the boundary given as parent; actors stand outside, and boundaries do not nest. A
 * note needs an element to hang on: the last one of the parent, or of the diagram; without any
 * element nothing is added and the id is empty.
 */
export function addUseCasePiece(
  source: string,
  piece: { kind: UseCasePiece; label?: string; parent?: string | null },
): { source: string; id: string } {
  const { diagram, lines, statements } = model(source),
    label = piece.label?.trim() ? piece.label : "",
    parent = piece.parent ? diagram.boundaries.get(piece.parent) : undefined;
  if (piece.kind === "note") {
    const elements = [...diagram.elements.values()].filter((item) => /^\w+$/.test(item.id)),
      target =
        (parent && elements.findLast((item) => item.boundary === parent.id)) || elements.at(-1);
    if (!target) return { source, id: "" };
    const { at, indent } = insertAt(lines, statements);
    lines.splice(at, 0, `${indent}note for ${target.id} "${escaped(label || "Note")}"`);
    return { source: lines.join("\n"), id: `note${diagram.notes.length + 1}` };
  }
  const id = freshId(
    diagram,
    piece.kind === "boundary" ? "system" : piece.kind === "actor" ? "actor" : "usecase",
  );
  const { at, indent } = insertAt(lines, statements, piece.kind === "usecase" ? parent : undefined);
  const text =
    piece.kind === "boundary"
      ? [`systemBoundary ${id}[${nameText(label || "System")}]`, "end"]
      : piece.kind === "actor"
        ? [`actor ${id}(${nameText(label || "Actor")})`]
        : [`${id}(${nameText(label || "Use case")})`];
  lines.splice(at, 0, ...text.map((line) => indent + line));
  return { source: lines.join("\n"), id };
}

/**
 * Joins two elements with a relation of a kind, an association when none is given. A note joined
 * to an element hangs on that element from then on.
 */
export function connectUseCase(source: string, from: string, to: string, kind?: string): string {
  const { diagram, lines, statements } = model(source),
    note = diagram.notes.find((item) => item.id === from || item.id === to);
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
  if (!diagram.elements.has(from) || !diagram.elements.has(to)) return source;
  const { at, indent } = insertAt(lines, statements);
  lines.splice(
    at,
    0,
    `${indent}${ref(from)} ${ARROWS[kind ?? ""] ?? ARROWS.association} ${ref(to)}`,
  );
  return lines.join("\n");
}

/**
 * Gives an element, a boundary or a note another name. The id stays, so every relation still
 * holds: the name is the label beside the id (`User` becomes `User(Customer)`), written where the
 * element has its label, or where it first stands when it has none. Only an element whose quoted
 * name is its id (`"Log in"`) is renamed wherever it stands. An empty name takes the label away,
 * which leaves the id as the name.
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
  if (!text) {
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

/** Makes a relation one of another kind: association, include, extend or generalization. */
export function relinkUseCase(source: string, edge: string, kind: string): string {
  const { diagram, lines, statements } = model(source),
    relation = diagram.relations.find((item) => item.id === edge),
    found = relation && statementOf(statements, relation);
  if (!relation || !found || !ARROWS[kind] || relation.kind === kind) return source;
  rearrow(lines, found, ARROWS[kind], found.arrow!.backward);
  return lines.join("\n");
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
 */
export const usecaseStructure: Structure = {
  pieces: [
    {
      kind: "usecase",
      name: "Use case",
      about: "Something the system does for an actor",
      joins: "after",
      named: true,
    },
    {
      kind: "actor",
      name: "Actor",
      about: "Someone or something that uses the system",
      joins: "before",
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
      named: true,
    },
  ],
  links: [
    { kind: "association", name: "Association" },
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
      edges: diagram.relations.map((item) => ({
        id: item.id,
        source: item.source,
        target: item.target,
        label: item.label,
        line: item.line,
        kind: item.kind,
      })),
    };
  },
  add: (source, piece) => addUseCasePiece(source, { ...piece, kind: piece.kind as UseCasePiece }),
  connect: connectUseCase,
  rename: renameUseCase,
  label: labelUseCaseRelation,
  relink: relinkUseCase,
  remove: (source, ids) => removeUseCase(source, ids),
};
