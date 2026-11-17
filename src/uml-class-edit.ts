/**
 * Editing a class diagram source as text: adding, naming, connecting and removing classes, notes
 * and packages, and changing the members of a class, the way uml-activity-edit.ts edits flowcharts.
 * Each function returns the source with one change made; a line that is not part of the change
 * stays as it was. The layout stays automatic.
 *
 * Parts carry the ids of the scene: a class its id, a namespace `ns:` and its dotted id, a note
 * `note1`, a lollipop interface `interface1`; a relation `r1`, the line from a note to its class
 * `note1:link`.
 *
 * A relation between two classes is one of the kinds in `links`. Two joins are of a kind of their
 * own, which nothing switches: the line of a note (`anchor`), made by connecting a note with a
 * class, and the relation that draws a lollipop interface (`lollipop`).
 */

import type { Structure, StructureEdge, StructureNode } from "./structure.ts";
import { accessibilityLines, scan } from "./uml.ts";
import {
  type ClassDiagram,
  type ClassNote,
  parseClassDiagram,
  parseMember,
  type Relation,
  type UmlClass,
} from "./uml-class.ts";
import {
  blockLineText,
  canTakeId,
  counted,
  entityCoded,
  freshId,
  indentOf,
  linesOf,
  listed,
  oneLine,
  renamedOnly,
  rootEnd,
  stepOf,
} from "./uml-edit-text.ts";

/** The kinds of class a canvas adds, by the annotation that makes a class one. */
const ANNOTATIONS: Record<string, string> = {
  interface: "interface",
  abstract: "abstract",
  enumeration: "enumeration",
};

/** The kind of class an annotation stands for, if it is one that makes a kind. */
const kindOfAnnotation = (annotation: string): string | undefined =>
  /^interface$/i.test(annotation)
    ? "interface"
    : /^abstract$/i.test(annotation)
      ? "abstract"
      : /^enum(eration)?$/i.test(annotation)
        ? "enumeration"
        : undefined;

// The statements of a class diagram, as uml-class.ts reads them.
const NAME = "(?:`[^`]+`|[\\p{L}\\p{N}_.]+(?:~[^~]+~)?)";
const RELATION = new RegExp(
  `^(${NAME})(\\s*)("[^"]*"\\s*)?(<\\||\\*|o|<|\\(\\))?(--|\\.\\.)(\\|>|\\*|o|>|\\(\\))?(\\s*)("[^"]*"\\s*)?(${NAME})\\s*(?::\\s*(.*))?$`,
  "u",
);
const CLASS = new RegExp(
  `^class\\s+(${NAME})(?:\\s*\\[\\s*"([^"]*)"\\s*\\])?(?::::[\\w-]+)?(?:\\s*<<\\s*([^>]+?)\\s*>>)?\\s*(\\{.*)?$`,
  "u",
);
/** A class statement in three parts: up to its name, its label in brackets, and the rest. */
const CLASS_PARTS = new RegExp(`^(class\\s+${NAME})(\\s*\\[\\s*"[^"]*"\\s*\\])?(.*)$`, "u");
const MEMBER = new RegExp(`^(${NAME})\\s*:\\s*(.*)$`, "u");
const ANNOTATION = new RegExp(`^<<\\s*([^>]+?)\\s*>>\\s*(${NAME})$`, "u");
const NAMESPACE = /^namespace\s+([\p{L}\p{N}_.]+)(?:\s*\[\s*"?([^\]"]*)"?\s*\])?\s*\{\s*(\})?$/u;
/** A namespace statement in three parts: up to its id, its label in brackets, and the brace. */
const NAMESPACE_PARTS = /^(namespace\s+[\p{L}\p{N}_.]+)(\s*\[[^\]]*\])?(\s*\{.*)$/u;
const NOTE_FOR = /^note\s+for\s+(\S+)\s+"([\s\S]*)"$/u;
const NOTE = /^note\s+"([\s\S]*)"$/u;
const STYLED = new RegExp(`^(?:click|link|style|callback)\\s+(${NAME})(?=\\s|$)`, "u");
const CSS = new RegExp(`^(${NAME}):::[\\w-]+$`, "u");

/** The id a name in the source stands for: without backticks and type arguments. */
const idOf = (raw: string) => {
  if (raw.startsWith("`")) return raw.replace(/^`|`$/g, "");
  const at = raw.indexOf("~");
  return at > 0 ? raw.slice(0, at) : raw;
};

/** A class id as a statement names it: in backticks when it is more than letters and digits. */
const ref = (id: string) => (/^[\p{L}\p{N}_.]+$/u.test(id) ? id : `\`${id.replace(/`/g, "'")}\``);

/** A class as its declaration names it: with its type arguments. */
const declared = (diagram: ClassDiagram, id: string) => {
  const generic = diagram.classes.get(id)?.generic;
  return generic && !ref(id).startsWith("`") ? `${id}~${generic}~` : ref(id);
};

/** A label inside the brackets of a namespace, which end at the first `]`. */
const spaceLabel = (label: string) => entityCoded(label, " ").replace(/\]/g, "#93;");

/** The lines from an opening statement to its closing brace, as indices; `close` is -1 while open. */
interface Block {
  open: number;
  close: number;
}

/** A line of a class body, or a `Class : member` statement. */
interface Entry {
  index: number;
  text: string;
  /** The annotation it gives the class, for `<<interface>>`. */
  annotation?: string;
  /** Whether it shares its line with a brace of the body. */
  inline: boolean;
  /** Whether it is a `Class : member` statement outside the body. */
  outside: boolean;
}

/** Where the source says something of a class. */
interface ClassLines {
  id: string;
  declarations: { index: number; body: Block | null; labelled: boolean; annotation?: string }[];
  entries: Entry[];
  /** `<<interface>> Class` statements. */
  marks: { index: number; annotation: string }[];
  /** Statements that only style it or link it. */
  styles: number[];
  /** Every line that names it so that it exists. */
  mentions: number[];
}

/** A class where a statement names it: the line, and the columns of the name as it is written. */
interface Place {
  id: string;
  index: number;
  start: number;
  end: number;
}

/** The lines of a source by what they declare, read the way the parser reads them. */
interface Outline {
  lines: string[];
  classes: Map<string, ClassLines>;
  /** The blocks of each namespace, by its dotted id. */
  spaces: Map<string, Block[]>;
  /** Every namespace statement: the id it opens, and the name it is written with, dots and all. */
  blocks: { id: string; name: string; block: Block }[];
  /** Every place a statement names a class, styling statements among them. */
  names: Place[];
  /** The lines of the relations. */
  relations: number[];
  /** The lines of the notes that stand in no namespace. */
  notes: number[];
  /** The statements that stand inside a namespace. */
  nested: Set<number>;
  /** The indentation of the statements that stand in no namespace. */
  indent: string;
}

/** Notes the place of a class's name, which starts `offset` characters into the statement. */
function notePlace(outline: Outline, raw: string, index: number, offset: number) {
  const start = indentOf(outline.lines[index]).length + offset;
  outline.names.push({ id: idOf(raw), index, start, end: start + raw.length });
}

/** The class a statement names, made known to the outline where it is first named. */
function ensureClass(outline: Outline, raw: string, index: number, offset = 0): ClassLines {
  const id = idOf(raw);
  notePlace(outline, raw, index, offset);
  let item = outline.classes.get(id);
  if (!item) {
    item = { id, declarations: [], entries: [], marks: [], styles: [], mentions: [] };
    outline.classes.set(id, item);
  }
  item.mentions.push(index);
  return item;
}

/** Notes a member or an annotation of a class. */
function addEntry(item: ClassLines, index: number, raw: string, inline: boolean, outside = false) {
  item.entries.push({
    index,
    text: raw.trim(),
    annotation: raw.trim().match(/^<<\s*(.+?)\s*>>$/)?.[1],
    inline,
    outside,
  });
}

/** A class body that is still open as the outline is read. */
interface OpenBody {
  item: ClassLines;
  block: Block;
}

/** A namespace block that is still open as the outline is read, by its dotted id. */
interface OpenSpace {
  id: string;
  block: Block;
}

/**
 * Reads a line of an open class body as a member, or as its last when the brace closes it there;
 * returns the body while it stays open.
 */
function readBodyLine(body: OpenBody, text: string, index: number, inline = false) {
  const closes = text.endsWith("}"),
    raw = closes ? text.slice(0, -1) : text;
  if (raw.trim()) addEntry(body.item, index, raw, inline || closes);
  if (!closes) return body;
  body.block.close = index;
  return null;
}

/** Reads one kind of statement outside a class body; returns the body it opens, if any. */
type StatementReader = (
  outline: Outline,
  match: RegExpMatchArray,
  text: string,
  index: number,
  open: OpenSpace[],
) => OpenBody | null | void;

const readNamespace: StatementReader = (outline, match, _text, index, open) => {
  const id = open.length ? `${open.at(-1)!.id}.${match[1]}` : match[1],
    block = { open: index, close: match[3] ? index : -1 };
  outline.spaces.set(id, [...(outline.spaces.get(id) ?? []), block]);
  outline.blocks.push({ id, name: match[1], block });
  if (!match[3]) open.push({ id, block });
};

const readClass: StatementReader = (outline, match, text, index) => {
  const item = ensureClass(outline, match[1], index, text.match(/^class\s+/)![0].length),
    inner = match[4]?.slice(1).trim(),
    block = inner === undefined ? null : { open: index, close: -1 };
  item.declarations.push({
    index,
    body: block,
    labelled: match[2] !== undefined,
    annotation: match[3],
  });
  return block && readBodyLine({ item, block }, inner!, index, true);
};

const readRelation: StatementReader = (outline, match, _text, index) => {
  outline.relations.push(index);
  // A lollipop end names an interface ball, not a class.
  if (!(match[4] === "()" && !match[6])) ensureClass(outline, match[1], index);
  if (!(match[6] === "()" && !match[4]))
    ensureClass(
      outline,
      match[9],
      index,
      match.slice(1, 9).reduce((sum, part) => sum + (part?.length ?? 0), 0),
    );
};

const readStyled: StatementReader = (outline, match, text, index) => {
  notePlace(outline, match[1], index, text.match(/^\w+\s+/)![0].length);
  // Styling of a class named only later is left alone: it draws nothing.
  outline.classes.get(idOf(match[1]))?.styles.push(index);
};

/** The statements an outline reads, each with what it notes; the first that matches is read. */
const STATEMENTS: [RegExp, StatementReader][] = [
  [NAMESPACE, readNamespace],
  [CLASS, readClass],
  [
    ANNOTATION,
    (outline, match, text, index) => {
      ensureClass(outline, match[2], index, text.length - match[2].length).marks.push({
        index,
        annotation: match[1],
      });
    },
  ],
  [
    NOTE_FOR,
    (outline, match, text, index, open) => {
      ensureClass(outline, match[1], index, text.match(/^note\s+for\s+/)![0].length);
      if (!open.length) outline.notes.push(index);
    },
  ],
  [
    NOTE,
    (outline, _match, _text, index, open) => {
      if (!open.length) outline.notes.push(index);
    },
  ],
  [RELATION, readRelation],
  [
    MEMBER,
    (outline, match, _text, index) =>
      addEntry(ensureClass(outline, match[1], index), index, match[2], false, true),
  ],
  [
    CSS,
    (outline, match, _text, index) => {
      ensureClass(outline, match[1], index).styles.push(index);
    },
  ],
  [STYLED, readStyled],
];

/** Reads a statement outside every class body; returns the body it opens, if any. */
function readStatement(outline: Outline, text: string, index: number, open: OpenSpace[]) {
  if (text === "}") {
    const closed = open.pop();
    if (closed) closed.block.close = index;
    return null;
  }
  if (open.length) outline.nested.add(index);
  for (const [pattern, read] of STATEMENTS) {
    const match = text.match(pattern);
    if (match) return read(outline, match, text, index, open) ?? null;
  }
  return null;
}

/** Reads where each class and namespace is declared; the source is one the parser accepts. */
function outlineOf(source: string): Outline {
  const lines = linesOf(source),
    statements = scan(source).lines.slice(1);
  const outline: Outline = {
    lines,
    classes: new Map(),
    spaces: new Map(),
    blocks: [],
    names: [],
    relations: [],
    notes: [],
    nested: new Set(),
    indent: statements.length ? indentOf(lines[statements[0].line - 1]) : "  ",
  };
  const open: OpenSpace[] = [];
  let body: OpenBody | null = null;
  const accessibility = accessibilityLines();
  for (const { text, line } of statements) {
    if (body) body = readBodyLine(body, text, line - 1);
    else if (!accessibility(text) && !/^direction\s/i.test(text))
      body = readStatement(outline, text, line - 1, open);
  }
  return outline;
}

/** The line after the last of some lines, if there are any. */
const after = (ends: number[]) => (ends.length ? Math.max(...ends) + 1 : undefined);

/**
 * The line after the last class declared outside every namespace, past the statements that say
 * more of a class there: its members, annotations and styling.
 */
function afterLastClass(outline: Outline): number | undefined {
  const classes = [...outline.classes.values()],
    more = new Set(
      classes.flatMap((item) => [
        ...item.entries.filter((entry) => entry.outside).map((entry) => entry.index),
        ...item.marks.map((mark) => mark.index),
        ...item.styles,
      ]),
    );
  let at = after(
    classes.flatMap((item) =>
      item.declarations
        .filter(({ index }) => !outline.nested.has(index))
        .map(({ index, body }) => (body ? body.close : index)),
    ),
  );
  while (at !== undefined && more.has(at)) at++;
  return at;
}

/** The first relation, with the comments right above it, which stay with it. */
function firstRelation({ relations, lines }: Outline): number | undefined {
  let relation = relations.length ? Math.min(...relations) : undefined;
  while (relation && lines[relation - 1].trim().startsWith("%%")) relation--;
  return relation;
}

/**
 * Where a new part that stands in no namespace goes: a class after the last class declared there
 * with the statements that follow it for its members and styling, a package after the last
 * package, each after the other where its own kind is missing, and before the first relation
 * where there is neither; a note after the last note. Else after the last line with text.
 */
function rootPlace(outline: Outline, kind: "class" | "note" | "package"): number {
  const end = rootEnd(outline.lines);
  if (kind === "note") return after(outline.notes) ?? end;
  const lastClass = afterLastClass(outline),
    lastSpace = after(
      outline.blocks
        .filter(({ block }) => !outline.nested.has(block.open))
        .map(({ block }) => block.close),
    );
  const [first, second] = kind === "class" ? [lastClass, lastSpace] : [lastSpace, lastClass];
  return first ?? second ?? firstRelation(outline) ?? end;
}

/**
 * Puts the statements of a part into the lines of an outline: at the end of a namespace, which
 * gets a block when only a dotted name implies it, or where its kind stands outside the
 * namespaces. Returns the index of its first line.
 */
function put(
  outline: Outline,
  text: string[],
  space: string | null,
  kind: "class" | "note" | "package",
): number {
  const { lines } = outline,
    step = stepOf(lines),
    block = space ? outline.spaces.get(space)?.at(-1) : undefined;
  if (block) {
    const indent = indentOf(lines[block.open]);
    // An empty namespace on one line opens over two.
    if (block.close === block.open)
      lines.splice(block.open, 1, lines[block.open].replace(/\s*\}\s*$/, ""), `${indent}}`);
    const at = block.close === block.open ? block.open + 1 : block.close;
    lines.splice(at, 0, ...text.map((line) => indent + step + line));
    return at;
  }
  if (space) {
    const at = rootEnd(lines);
    lines.splice(
      at,
      0,
      `${outline.indent}namespace ${space} {`,
      ...text.map((line) => outline.indent + step + line),
      `${outline.indent}}`,
    );
    return at + 1;
  }
  const at = rootPlace(outline, kind);
  lines.splice(at, 0, ...text.map((line) => outline.indent + line));
  return at;
}

/** The source with a `class` statement for a class that relations or notes only mention. */
function declare(source: string, id: string): string {
  const diagram = parseClassDiagram(source),
    outline = outlineOf(source),
    item = outline.classes.get(id),
    { lines } = outline;
  if (!item || item.declarations.length) return source;
  const first = item.mentions[0],
    statement = `class ${declared(diagram, id)}`;
  // After the line that first names it, so the classes keep their order; a line in a namespace
  // would take the class into it, so there the statement goes to the end.
  if (outline.nested.has(first)) lines.splice(rootEnd(lines), 0, outline.indent + statement);
  else lines.splice(first + 1, 0, indentOf(lines[first]) + statement);
  return lines.join("\n");
}

/**
 * The source with the class declared and its body open over lines of its own: `class A {`, one
 * line a member, `}`.
 */
function withBody(source: string, id: string): string {
  const text = declare(source, id),
    { lines, classes } = outlineOf(text),
    item = classes.get(id);
  if (!item) return source;
  const declaration = item.declarations.find((found) => found.body) ?? item.declarations[0],
    line = lines[declaration.index],
    indent = indentOf(line),
    step = stepOf(lines);
  if (!declaration.body) {
    lines.splice(declaration.index, 1, `${line.trimEnd()} {`, `${indent}}`);
    return lines.join("\n");
  }
  const { open, close } = declaration.body;
  // A last member that shares its line with the closing brace.
  if (close > open && lines[close].trim() !== "}")
    lines.splice(
      close,
      1,
      indentOf(lines[close]) + lines[close].trim().slice(0, -1).trimEnd(),
      `${indent}}`,
    );
  openOnOwnLine(lines, line, declaration.body, indent + step);
  return lines.join("\n");
}

/**
 * Gives the first member of a body, which shares its line with the opening brace, a line of its
 * own at the indentation of the body; a body on one line closes on a line of its own too.
 */
function openOnOwnLine(lines: string[], line: string, { open, close }: Block, inside: string) {
  const braces = line.trim().match(CLASS)![4],
    head = line.trimEnd().slice(0, line.trimEnd().length - braces.length + 1),
    inner = braces.slice(1).trim();
  if (!inner) return;
  const member = close === open ? inner.slice(0, -1).trim() : inner,
    indent = indentOf(line);
  lines.splice(
    open,
    1,
    head,
    ...(member ? [inside + member] : []),
    ...(close === open ? [`${indent}}`] : []),
  );
}

/** The body of a class whose body `withBody` has opened, and the indentation of its lines. */
function bodyOf(outline: Outline, id: string) {
  const item = outline.classes.get(id)!,
    declaration = item.declarations.find((found) => found.body)!,
    block = declaration.body!,
    inside = item.entries.findLast(
      (found) => !found.outside && found.index > block.open && found.index < block.close,
    );
  return {
    item,
    block,
    indent: inside
      ? indentOf(outline.lines[inside.index])
      : indentOf(outline.lines[block.open]) + stepOf(outline.lines),
  };
}

/** The members of a class as its source writes them, attributes and methods in their order. */
export function classMembers(source: string, id: string): string[] {
  return (outlineOf(source).classes.get(id)?.entries ?? [])
    .filter((entry) => !entry.annotation && entry.text)
    .map((entry) => entry.text);
}

/**
 * Adds an attribute or a method as a line of a class's body; a class without a body gets one, and
 * a class that is only mentioned gets its `class` statement.
 */
export function addClassMember(source: string, id: string, text: string): string {
  const member = blockLineText(text);
  if (!member || !parseClassDiagram(source).classes.has(id)) return source;
  const outline = outlineOf(withBody(source, id)),
    { block, indent } = bodyOf(outline, id);
  outline.lines.splice(block.close, 0, indent + member);
  return outline.lines.join("\n");
}

/**
 * Gives a class other members: its member lines go, in the body and as `Class : member`
 * statements, and the new ones stand in the body. Annotations and comments in the body stay.
 */
export function setClassMembers(source: string, id: string, members: string[]): string {
  const texts = members.map(blockLineText).filter(Boolean);
  if (!parseClassDiagram(source).classes.has(id)) return source;
  if (!texts.length && !classMembers(source, id).length) return source;
  const outline = outlineOf(withBody(source, id)),
    { item, block, indent } = bodyOf(outline, id),
    gone = new Set(item.entries.filter((entry) => !entry.annotation).map((entry) => entry.index));
  return outline.lines
    .flatMap((line, index) => [
      ...(index === block.close ? texts.map((text) => indent + text) : []),
      ...(gone.has(index) ? [] : [line]),
    ])
    .join("\n");
}

/**
 * The member of a class at a place in `classMembers`, in a source where it stands on a line of
 * its own: a member that shares its line with a brace of the body gets one first.
 */
function memberAt(source: string, id: string, index: number) {
  const pick = (outline: Outline) =>
    outline.classes.get(id)?.entries.filter((entry) => !entry.annotation && entry.text)[index];
  let outline = outlineOf(source),
    entry = pick(outline);
  if (entry?.inline) {
    outline = outlineOf(withBody(source, id));
    entry = pick(outline);
  }
  return entry && !entry.inline ? { outline, entry } : undefined;
}

/**
 * Gives one member of a class another text, by its place in `classMembers`, where it stands: in
 * the body or as a `Class : member` statement. An empty text removes the member.
 */
export function setClassMember(source: string, id: string, index: number, text: string): string {
  const member = blockLineText(text);
  if (!member) return removeClassMember(source, id, index);
  const found = memberAt(source, id, index);
  if (!found || found.entry.text === member) return source;
  const { lines } = found.outline,
    line = lines[found.entry.index],
    head = found.entry.outside ? line.match(/^\s*[^:]+:\s*/)![0] : indentOf(line);
  lines[found.entry.index] = head + member;
  const result = lines.join("\n");
  return reads(result) ? result : source;
}

/**
 * Removes one member of a class, by its place in `classMembers`. A class that only its
 * `Class : member` statement names stays, as a `class` statement in its place.
 */
export function removeClassMember(source: string, id: string, index: number): string {
  const found = memberAt(source, id, index);
  if (!found) return source;
  const { lines, classes } = found.outline,
    item = classes.get(id)!,
    at = found.entry.index,
    alone = found.entry.outside && item.mentions.every((mention) => mention === at);
  if (alone) lines[at] = `${indentOf(lines[at])}class ${declared(parseClassDiagram(source), id)}`;
  else lines.splice(at, 1);
  const result = lines.join("\n");
  return reads(result) ? result : source;
}

/**
 * The place in `classMembers` of the member a class shows in a row of its box, counted from 0
 * over its attributes and then its operations, as they are drawn; -1 for a row it does not have.
 */
export function classMemberIndex(source: string, id: string, row: number): number {
  const shown = classMembers(source, id)
    .map((text, index) => ({ index, member: parseMember(text) }))
    .filter(({ member }) => member.text);
  return (
    [
      ...shown.filter(({ member }) => !member.method),
      ...shown.filter(({ member }) => member.method),
    ][row]?.index ?? -1
  );
}

/**
 * Makes a class a plain class, an interface, an abstract class or an enumeration: the annotation
 * that said what it was goes, and the new one stands first in its body. Other annotations stay.
 */
export function setClassKind(source: string, id: string, kind: string): string {
  if (kind !== "class" && !ANNOTATIONS[kind]) return source;
  const found = parseClassDiagram(source).classes.get(id);
  if (!found) return source;
  if (kind === "class" && !found.annotations.some(kindOfAnnotation)) return source;
  return annotate(
    source,
    id,
    (annotation) => !!kindOfAnnotation(annotation),
    kind === "class" ? undefined : ANNOTATIONS[kind],
  );
}

/** A `class` statement without the annotation it gives the class. */
function withoutAnnotation(line: string): string {
  const [, head, label = "", rest] = line.trim().match(CLASS_PARTS)!;
  return indentOf(line) + head + label + rest.replace(/\s*<<\s*[^>]+?\s*>>/, "");
}

/**
 * The source of a class the parser knows without the annotations that `goes` names, however they
 * are written, and with another one as the first line of its body when given.
 */
function annotate(
  source: string,
  id: string,
  goes: (annotation: string) => boolean,
  add?: string,
): string {
  let outline = outlineOf(source);
  // An annotation on a line with a brace gets a line of its own first; so does the new one.
  if (add || annotationEntries(outline.classes.get(id)!, goes).some((entry) => entry.inline))
    outline = outlineOf(withBody(source, id));
  const item = outline.classes.get(id)!,
    { lines } = outline,
    gone = new Set([
      ...annotationEntries(item, goes).map((entry) => entry.index),
      ...item.marks.filter((mark) => goes(mark.annotation)).map((mark) => mark.index),
    ]);
  for (const declaration of item.declarations)
    if (declaration.annotation && goes(declaration.annotation))
      lines[declaration.index] = withoutAnnotation(lines[declaration.index]);
  const opened = add ? bodyOf(outline, id).block.open : -1;
  return lines
    .flatMap((line, index) => [
      ...(gone.has(index) ? [] : [line]),
      ...(index === opened ? [`${indentOf(line)}${stepOf(lines)}<<${add}>>`] : []),
    ])
    .join("\n");
}

/** The entries of a class that are annotations `goes` names. */
const annotationEntries = (item: ClassLines, goes: (annotation: string) => boolean) =>
  item.entries.filter((entry) => entry.annotation && goes(entry.annotation));

/**
 * The stereotype of a class: the annotation it is drawn under, whatever it says (`interface`,
 * `abstract`, `enumeration`, `service`); empty when it has none. A class has one: of several the
 * source gives it, this is the first.
 */
export function classStereotype(source: string, id: string): string {
  return parseClassDiagram(source).classes.get(id)?.annotations[0] ?? "";
}

/**
 * Gives a class another stereotype, written with or without its `<<` `>>`, in the place of the
 * one it has: where that stands, and else as the first line of its body. Every other annotation
 * of the class goes, so it has one. An empty stereotype removes it, which makes an interface, an
 * abstract class or an enumeration a plain class; one that names such a kind makes the class it.
 */
export function setClassStereotype(source: string, id: string, text: string): string {
  const name = text
      .replace(/<<|>>|[«»<>]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    found = parseClassDiagram(source).classes.get(id);
  if (!found || hasOnlyStereotype(found, name)) return source;
  if (!name || !found.annotations.length)
    return annotate(source, id, () => true, name || undefined);
  return restereotyped(source, id, name);
}

/**
 * The source with a class's annotations rewritten in place to one that says a name: the first
 * keeps its place and the others go. Where that cannot be done in place, `annotate` does it.
 */
function restereotyped(source: string, id: string, name: string): string {
  const outline = outlineOf(source),
    places = annotationPlaces(outline.classes.get(id)!);
  // An annotation on a line with a brace has no place of its own to be rewritten in.
  if (places.some((place) => !place.line)) return annotate(source, id, () => true, name);
  const result = withOneAnnotation(outline.lines, places, name);
  return reads(result)?.classes.get(id)?.annotations.join() === name
    ? result
    : annotate(source, id, () => true, name);
}

/** Whether a name is a class's one and only annotation. */
const hasOnlyStereotype = (found: UmlClass, name: string) =>
  !!name && name === found.annotations[0] && found.annotations.length < 2;

/** An annotation as it is written. */
const WRITTEN_ANNOTATION = /<<\s*[^>]+?\s*>>/;

/**
 * Where the source gives a class an annotation, in the order of the lines: whether it stands on a
 * line without a brace, and whether it is the whole statement or a piece of a `class` statement.
 */
const annotationPlaces = (item: ClassLines) =>
  [
    ...item.entries
      .filter((entry) => entry.annotation)
      .map((entry) => ({ index: entry.index, line: !entry.inline, whole: true })),
    ...item.marks.map((mark) => ({ index: mark.index, line: true, whole: true })),
    ...item.declarations
      .filter((declaration) => declaration.annotation)
      .map((declaration) => ({ index: declaration.index, line: true, whole: false })),
  ].toSorted((a, b) => a.index - b.index);

/** The source with the first annotation of a class saying a name, and the others gone. */
function withOneAnnotation(
  lines: string[],
  places: ReturnType<typeof annotationPlaces>,
  name: string,
): string {
  const [kept, ...rest] = places,
    gone = new Set<number>();
  lines[kept.index] = lines[kept.index].replace(WRITTEN_ANNOTATION, () => `<<${name}>>`);
  for (const place of rest)
    if (place.whole) gone.add(place.index);
    else
      lines[place.index] = lines[place.index].replace(
        new RegExp(`\\s*${WRITTEN_ANNOTATION.source}`),
        "",
      );
  return lines.filter((_, index) => !gone.has(index)).join("\n");
}

/** The ways a kind of relation is written: from its first end to its second, and the other way round. */
const OPERATORS: Record<string, [string, string]> = {
  association: ["-->", "<--"],
  inheritance: ["--|>", "<|--"],
  composition: ["*--", "--*"],
  aggregation: ["o--", "--o"],
  dependency: ["..>", "<.."],
  realization: ["..|>", "<|.."],
  link: ["--", "--"],
  dashed: ["..", ".."],
};

/** The kind of join a relation is, by its line and the markers at its ends. */
function kindOfRelation(relation: Relation): string {
  const markers = [relation.startMarker, relation.endMarker];
  if (markers.includes("triangle")) return relation.dashed ? "realization" : "inheritance";
  if (markers.includes("filled-diamond")) return "composition";
  if (markers.includes("diamond")) return "aggregation";
  if (markers.includes("open")) return relation.dashed ? "dependency" : "association";
  return relation.dashed ? "dashed" : "link";
}

/** A name as one word that can be an id: `Order Item` is `OrderItem`; empty when it has no letter or digit. */
function wordOf(label: string): string {
  const words = label.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  return words.length > 1
    ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join("")
    : (words[0] ?? "");
}

/** Whether an id is taken in a diagram: by a class or a namespace, or as one a note or a lollipop gets. */
const usedIn = (diagram: ClassDiagram) => (name: string) =>
  diagram.classes.has(name) || diagram.namespaces.has(name) || /^(note|interface)\d+$/.test(name);

/** The namespace a group's id names, when the diagram has it. */
const spaceOf = (diagram: ClassDiagram, id: string | null | undefined) =>
  id?.startsWith("ns:") && diagram.namespaces.has(id.slice(3)) ? id.slice(3) : null;

/**
 * Adds a class, an interface, an abstract class, an enumeration, a note or a package; inside a
 * namespace when given, and else where its kind stands in the source: a class after the last
 * class, a package after the last package, a note after the last note. A class takes its id from
 * its name (`Order Item` is `OrderItem`, shown under its name), a package likewise; without a name
 * the id is a kind with a number that no class or package of the diagram has. A lollipop is the
 * interface of the class given as its parent, and nothing without one. Returns the id of its
 * shape, empty when nothing is added.
 */
function addClassPiece(
  source: string,
  piece: { kind: string; label?: string; parent?: string | null },
): { source: string; id: string } {
  const diagram = parseClassDiagram(source),
    outline = outlineOf(source),
    parent = spaceOf(diagram, piece.parent);
  if (piece.kind === "lollipop")
    return addLollipop(source, piece.parent ?? "", nameOf(piece.label));
  const made = newPart(diagram, piece.kind, piece.label, parent, stepOf(outline.lines)),
    kind = piece.kind === "note" || piece.kind === "package" ? piece.kind : "class",
    at = put(outline, made.text, parent, kind),
    result = outline.lines.join("\n");
  // Notes are numbered in the order of the source: the one on the new line says which it is.
  if (piece.kind !== "note") return { source: result, id: made.id };
  return {
    source: result,
    id: parseClassDiagram(result).notes.find((note) => note.line === at + 1)?.id ?? "",
  };
}

/** A name a piece is added with, on one line. */
const nameOf = (label: string | undefined) => oneLine(label ?? "");

/** The statements of a new part of a kind and the id of its shape; a note's id is known once it stands. */
function newPart(
  diagram: ClassDiagram,
  kind: string,
  label: string | undefined,
  parent: string | null,
  step: string,
): { id: string; text: string[] } {
  if (kind === "note") return { id: "", text: [`note "${entityCoded(label ?? "") || "Note"}"`] };
  if (kind === "package") return newPackage(diagram, nameOf(label), parent);
  return newClass(diagram, kind in ANNOTATIONS ? kind : "class", nameOf(label), step);
}

/** The statements of a new package: its name is free when no package has it, wherever that one stands. */
function newPackage(diagram: ClassDiagram, label: string, parent: string | null) {
  const names = new Set([...diagram.namespaces.keys()].map((space) => space.split(".").at(-1))),
    name = freshId((name) => names.has(name), "Package", wordOf(label));
  return {
    id: `ns:${parent ? `${parent}.${name}` : name}`,
    text: [`namespace ${name}${label && label !== name ? `["${spaceLabel(label)}"]` : ""} {`, "}"],
  };
}

/** The statements of a new class of a kind, with its annotation where the kind has one. */
function newClass(diagram: ClassDiagram, kind: string, label: string, step: string) {
  const id = freshId(usedIn(diagram), kind[0].toUpperCase() + kind.slice(1), wordOf(label)),
    head = `class ${id}${label && label !== id ? `["${entityCoded(label, " ")}"]` : ""}`;
  return {
    id,
    text: kind === "class" ? [head] : [`${head} {`, `${step}<<${ANNOTATIONS[kind]}>>`, "}"],
  };
}

/**
 * A relation's line with another operator, label or name at an end; what is not changed stays,
 * the multiplicities among it.
 */
function relationLine(line: string, change: RelationChange): string {
  const match = line.trim().match(RELATION);
  if (!match) return line;
  const [, , gap, , start = "", stroke, end = "", space] = match,
    { first, second, near, far } = relationEnds(match, change),
    operator = change.operator?.(start, end) ?? start + stroke + end,
    label = change.label ?? (match[10] ?? "").trim();
  // A multiplicity stands a space away from the name before it.
  return `${indentOf(line)}${first}${spaced(gap, near)}${near}${operator}${spaced(space, far)}${far}${second}${label ? ` : ${label}` : ""}`;
}

/** The names at the ends of a relation's line once a change is made, and the multiplicity beside each. */
function relationEnds(match: RegExpMatchArray, change: RelationChange) {
  const [, left, , startLabel = "", start = "", , end = "", , endLabel = "", right] = match,
    near = multiplicityText(change.multiplicity?.start, startLabel),
    far = multiplicityText(change.multiplicity?.end, endLabel),
    [first, second] = change.ends?.(left, right, start, end) ?? [left, right];
  return change.reverse
    ? { first: second, second: first, near: far, far: near }
    : { first, second, near, far };
}

/** A change of the pieces of a relation's line. */
interface RelationChange {
  operator?: (start: string, end: string) => string;
  label?: string;
  ends?: (left: string, right: string, start: string, end: string) => [string, string];
  /** The multiplicity at the first end, at the second end, or both; an empty one goes. */
  multiplicity?: { start?: string; end?: string };
  /** Whether the ends change places, each with its multiplicity. */
  reverse?: boolean;
}

/** A multiplicity as a relation writes it, in quotes with a space after; the old one when none is given. */
const multiplicityText = (text: string | undefined, old: string) => {
  if (text === undefined) return old.trim() ? `${old.trim()} ` : "";
  return text ? `"${text}" ` : "";
};

/** The gap before a multiplicity: at least a space, where there is one. */
const spaced = (gap: string, multiplicity: string) => (multiplicity ? gap || " " : gap);

/**
 * Joins two classes with a relation of a kind, an association when none is given. The first end
 * is where an association, a dependency, an inheritance or a realization starts, and the whole of
 * a composition or an aggregation; both ends may be the same class. With a note at one end the
 * note becomes one for the class at the other, whatever the kind: that is the only way a note
 * comes to a class, or to another one.
 */
function connectClasses(source: string, from: string, to: string, kind?: string): string {
  const diagram = parseClassDiagram(source),
    lines = linesOf(source);
  const note = diagram.notes.find((item) => item.id === from || item.id === to);
  if (note) return noteFor(source, diagram, note, note.id === from ? to : from);
  const operator = OPERATORS[kind ?? "association"]?.[0];
  if (!operator || !diagram.classes.has(from) || !diagram.classes.has(to)) return source;
  lines.splice(rootEnd(lines), 0, `${outlineOf(source).indent}${ref(from)} ${operator} ${ref(to)}`);
  return lines.join("\n");
}

/** The source with a note made the note of a class; unchanged where the class cannot be named. */
function noteFor(source: string, diagram: ClassDiagram, note: ClassNote, target: string): string {
  if (!diagram.classes.has(target) || /\s/.test(ref(target))) return source;
  const lines = linesOf(source),
    index = note.line - 1;
  lines[index] = lines[index].replace(
    /^(\s*note)(?:\s+for\s+\S+)?(?=\s+")/,
    (_, head: string) => `${head} for ${ref(target)}`,
  );
  return lines.join("\n");
}

/**
 * Gives a part another name. A class keeps its id, which relations and notes name it by, and
 * shows the name as its label (`class Order["Purchase order"]`); a name that is the id itself
 * takes the label away. A namespace gets its label the same way, a note its text, and a lollipop
 * interface its name on the relation that draws it.
 */
function renameClassPart(source: string, id: string, label: string): string {
  const diagram = parseClassDiagram(source),
    note = diagram.notes.find((item) => item.id === id),
    ball = diagram.lollipops.find((item) => item.id === id),
    space = spaceOf(diagram, id);
  if (note) return rewriteLine(linesOf(source), note.line - 1, (text) => noteText(text, label));
  if (ball) return renameBall(source, ball.line - 1, label);
  if (space) return renameSpaceLabel(source, space, label);
  if (!diagram.classes.has(id)) return source;
  const outline = outlineOf(declare(source, id)),
    declarations = outline.classes.get(id)!.declarations,
    declaration = declarations.findLast((found) => found.labelled) ?? declarations[0],
    name = entityCoded(label, " ");
  return rewriteLine(outline.lines, declaration.index, (text) => {
    const [, head, , rest] = text.match(CLASS_PARTS)!;
    return name && name !== id ? `${head}["${name}"]${rest}` : head + rest;
  });
}

/** The source with one statement changed, its indentation kept. */
function rewriteLine(lines: string[], index: number, change: (text: string) => string): string {
  lines[index] = indentOf(lines[index]) + change(lines[index].trim());
  return lines.join("\n");
}

/** A note statement with another text. */
const noteText = (statement: string, label: string) =>
  statement.replace(/"[\s\S]*"$/, () => `"${entityCoded(label) || " "}"`);

/** The source with a lollipop interface under another name, on the relation that draws it. */
function renameBall(source: string, index: number, label: string): string {
  const name = oneLine(label),
    lines = linesOf(source);
  if (!name) return source;
  lines[index] = relationLine(lines[index], {
    ends: (left, right, start, end) =>
      start === "()" && !end ? [ref(name), right] : [left, ref(name)],
  });
  return lines.join("\n");
}

/** The source with a namespace under another label, on the statement that has one or else its first. */
function renameSpaceLabel(source: string, space: string, label: string): string {
  const { lines, spaces } = outlineOf(source),
    blocks = spaces.get(space) ?? [],
    labelled = blocks.findLast((block) => NAMESPACE_PARTS.exec(lines[block.open].trim())?.[2]),
    block = labelled ?? blocks[0],
    name = spaceLabel(label);
  // A namespace that only a dotted name implies has no statement to carry a label.
  if (!block) return source;
  return rewriteLine(lines, block.open, (text) => {
    const [, head, , rest] = text.match(NAMESPACE_PARTS)!;
    return name && name !== space.split(".").at(-1) ? `${head}["${name}"]${rest}` : head + rest;
  });
}

/** Words that open a statement: no class goes by one of them. */
const RESERVED =
  /^(class|namespace|note|direction|classDef|style|linkStyle|cssClass|click|callback|link|links|properties|details|title|accTitle|accDescr)$/;

/** A source as its diagram, or nothing when the parser does not read it. */
function reads(source: string): ClassDiagram | undefined {
  try {
    return parseClassDiagram(source);
  } catch {
    return undefined;
  }
}

/** The source with a namespace under another last name, in every statement that opens it or one inside it. */
function renameSpace(source: string, diagram: ClassDiagram, space: string, name: string): string {
  const at = space.split(".").length - 1,
    next = [...space.split(".").slice(0, -1), name].join(".");
  if (!/^[\p{L}\p{N}_]+$/u.test(name) || diagram.namespaces.has(next)) return source;
  const outline = outlineOf(source),
    { lines } = outline;
  for (const { id, name: own, block } of outline.blocks) {
    if (id !== space && !id.startsWith(`${space}.`)) continue;
    // A statement names the namespaces from the one it stands in downward.
    const words = own.split("."),
      first = id.split(".").length - words.length;
    if (at < first) continue;
    words[at - first] = name;
    lines[block.open] = lines[block.open].replace(
      /^(\s*namespace\s+)[\p{L}\p{N}_.]+/u,
      (_, head: string) => head + words.join("."),
    );
  }
  return lines.join("\n");
}

/**
 * Gives a class another id, wherever the source names it: in its declarations, relations, notes,
 * `Class : member` and annotation statements and styling lines; its type arguments stay, and a
 * label that says what the new id says goes (`class Purchase`, not `class Purchase["Purchase"]`).
 * A namespace (`ns:Sales.Billing`) gets another last name the same way, in every statement that
 * opens it or a namespace inside it. The source comes back unchanged when the new id is not one
 * the syntax can write, is a word of the syntax, or is taken by another class or namespace.
 */
export function renameClassId(source: string, id: string, newId: string): string {
  const diagram = parseClassDiagram(source),
    name = newId.trim(),
    space = spaceOf(diagram, id);
  if (space) return renameSpace(source, diagram, space, lastName(space, name));
  if (!canTakeClassId(diagram, id, name)) return source;
  const result = withNameAt(outlineOf(source), id, ref(name)),
    now = result === undefined ? undefined : reads(result);
  if (
    !now ||
    !renamedOnly((item) => now.classes.has(item), id, name, countsOf(diagram), countsOf(now))
  )
    return source;
  const labelled = outlineOf(result!)
    .classes.get(name)!
    .declarations.some((declaration) => declaration.labelled);
  return labelled && now.classes.get(name)!.label === name
    ? renameClassPart(result!, name, name)
    : result!;
}

/** The last name a namespace is to go by, from a new id given whole (`ns:Sales.Billing`) or as the last name. */
function lastName(space: string, name: string): string {
  const parent = space.split(".").slice(0, -1).join("."),
    full = name.replace(/^ns:/, "");
  return parent && full.startsWith(`${parent}.`) ? full.slice(parent.length + 1) : full;
}

/** Whether a class can go by a new id: one the syntax writes, no word of it, that no class has. */
const canTakeClassId = (diagram: ClassDiagram, id: string, name: string) =>
  canTakeId(
    (item) => diagram.classes.has(item),
    id,
    name,
    !/[`"\n]/.test(name) && !/^(note|interface)\d+$|^ns:/.test(name) && !RESERVED.test(name),
  );

/**
 * The source with a class written as another name wherever a statement names it, its type
 * arguments kept; undefined where a name in backticks would need them.
 */
function withNameAt(outline: Outline, id: string, written: string): string | undefined {
  const { lines } = outline;
  // From the right, so the places before keep their columns.
  const places = outline.names
    .filter((place) => place.id === id)
    .toSorted((a, b) => b.index - a.index || b.start - a.start);
  for (const { index, start, end } of places) {
    const raw = lines[index].slice(start, end),
      generic = raw.startsWith("`") || !raw.includes("~") ? "" : raw.slice(raw.indexOf("~"));
    // A name in backticks carries no type arguments.
    if (generic && written.startsWith("`")) return undefined;
    lines[index] = lines[index].slice(0, start) + written + generic + lines[index].slice(end);
  }
  return lines.join("\n");
}

/** How many classes, relations and notes a diagram has. */
const countsOf = (diagram: ClassDiagram) => [
  diagram.classes.size,
  diagram.relations.length,
  diagram.notes.length,
];

/** The ids a new class gets when it has no name yet, and the name a new package gets. */
const GENERATED = /^(?:Class|Interface|Abstract|Enumeration|Package)\d+$/;

/**
 * Whether a class or a package goes by an id that an edit made up and its first name may
 * replace: `Class1`, `Interface1` or `Package1` as a new one gets them, and the id of a copy
 * (`Order2` beside `Order`) while the copy still shows the name of its original or its own id.
 */
export function isGeneratedClassId(source: string, id: string): boolean {
  const diagram = parseClassDiagram(source),
    space = spaceOf(diagram, id),
    item = diagram.classes.get(id);
  if (space) return GENERATED.test(space.split(".").at(-1)!);
  if (!item) return false;
  if (GENERATED.test(id)) return true;
  return [...diagram.classes.values()].some(
    (original) => original !== item && isCopyOf(item, original),
  );
}

/**
 * Whether a class looks like a copy of another: it goes by the id of the original as one word,
 * with a number from 2 where that is taken, and shows the original's name or its own id.
 */
function isCopyOf(item: UmlClass, original: UmlClass) {
  const base = wordOf(original.id),
    number = item.id.startsWith(base) ? item.id.slice(base.length) : "x";
  return (
    !!base &&
    (number === "" || (/^\d+$/.test(number) && Number(number) > 1)) &&
    (item.label === item.id || item.label === original.label)
  );
}

/**
 * Gives a class or a package that was just added its first name: the id follows the name
 * (`Order Item` makes `class OrderItem["Order Item"]`, `Invoice` makes `class Invoice`) wherever
 * the source names it, unless another class or package has that id; then the id stays and the
 * name is its label. A note gets its text. Returns the id the part has afterwards.
 */
function retitleClassPart(
  source: string,
  id: string,
  name: string,
): { source: string; id: string } {
  const diagram = parseClassDiagram(source),
    space = spaceOf(diagram, id),
    word = wordOf(name);
  let next = id;
  if (word && (space || diagram.classes.has(id))) {
    const wanted = space ? `ns:${[...space.split(".").slice(0, -1), word].join(".")}` : word,
      has = (now: ClassDiagram) =>
        space ? now.namespaces.has(wanted.slice(3)) : now.classes.has(wanted);
    if (wanted !== id && !has(diagram)) {
      const renamed = renameClassId(source, id, word);
      if (has(parseClassDiagram(renamed))) [source, next] = [renamed, wanted];
    }
  }
  return { source: renameClassPart(source, next, name), id: next };
}

/** Gives a relation another label; an empty one removes it. Its multiplicities stay. */
function labelRelation(source: string, edge: string, label: string): string {
  const relation = parseClassDiagram(source).relations.find((item) => item.id === edge),
    lines = linesOf(source);
  if (!relation) return source;
  lines[relation.line - 1] = relationLine(lines[relation.line - 1], { label: entityCoded(label) });
  return lines.join("\n");
}

/**
 * Makes a relation one of another kind, between the same ends: the end an arrow starts from, or
 * that a diamond stands at, stays the first end of the new kind. The relation that draws a
 * lollipop interface and the line of a note stay what they are.
 */
function relinkRelation(source: string, edge: string, kind: string): string {
  const diagram = parseClassDiagram(source),
    relation = diagram.relations.find((item) => item.id === edge),
    lines = linesOf(source);
  if (!relation || !OPERATORS[kind] || kind === kindOfRelation(relation)) return source;
  if (drawsBall(diagram, relation)) return source;
  lines[relation.line - 1] = relationLine(lines[relation.line - 1], {
    operator: (start, end) => OPERATORS[kind][pointsBack(start, end) ? 1 : 0],
  });
  return lines.join("\n");
}

/** Whether a relation is written from its second end: an arrow at the start, or a diamond at the end. */
function pointsBack(start: string, end: string): boolean {
  if (start && !end) return /[<|]/.test(start);
  if (end && !start) return /[*o]/.test(end);
  return false;
}

/** Whether a relation draws a lollipop interface: one of its ends is the ball, not a class. */
const drawsBall = (diagram: ClassDiagram, relation: Relation) =>
  diagram.lollipops.some((ball) => ball.id === relation.source || ball.id === relation.target);

/**
 * Turns a relation round: its ends change places, each with its multiplicity, and its kind and
 * label stay, so an inheritance drawn from the parent runs from the child. The relation that
 * draws a lollipop interface stays as it is.
 */
export function reverseClassRelation(source: string, edge: string): string {
  const diagram = parseClassDiagram(source),
    relation = diagram.relations.find((item) => item.id === edge),
    lines = linesOf(source);
  if (!relation || drawsBall(diagram, relation)) return source;
  lines[relation.line - 1] = relationLine(lines[relation.line - 1], { reverse: true });
  return lines.join("\n");
}

/**
 * The ends of a relation: the ids of the parts it joins, in the order it is written, and the
 * multiplicity beside each, empty where there is none. Undefined for what is no relation.
 */
export function classRelationEnds(
  source: string,
  edge: string,
): { from: string; to: string; fromMultiplicity: string; toMultiplicity: string } | undefined {
  const relation = parseClassDiagram(source).relations.find((item) => item.id === edge);
  return (
    relation && {
      from: relation.source,
      to: relation.target,
      fromMultiplicity: relation.startLabel ?? "",
      toMultiplicity: relation.endLabel ?? "",
    }
  );
}

/** Gives one end of a relation another multiplicity (`1`, `0..*`); an empty one removes it. */
export function setClassMultiplicity(
  source: string,
  edge: string,
  end: "from" | "to",
  text: string,
): string {
  const relation = parseClassDiagram(source).relations.find((item) => item.id === edge),
    lines = linesOf(source),
    value = text.replace(/["\n]/g, " ").replace(/\s+/g, " ").trim();
  if (!relation) return source;
  if (value === ((end === "from" ? relation.startLabel : relation.endLabel) ?? "")) return source;
  lines[relation.line - 1] = relationLine(lines[relation.line - 1], {
    multiplicity: end === "from" ? { start: value } : { end: value },
  });
  return lines.join("\n");
}

/**
 * Adds a copy of a class: its label, type arguments, annotations and members under an id of its
 * own (`Order2`), declared after the class and so in its namespace, with none of its relations.
 * Returns the id of the copy, empty for what is no class.
 */
export function duplicateClass(source: string, id: string): { source: string; id: string } {
  const diagram = parseClassDiagram(source),
    item = diagram.classes.get(id);
  if (!item) return { source, id: "" };
  const copy = freshId(usedIn(diagram), "Class", wordOf(id)),
    outline = outlineOf(declare(source, id)),
    { lines } = outline,
    declaration = outline.classes.get(id)!.declarations.at(-1)!,
    indent = indentOf(lines[declaration.index]),
    head = `class ${copy}${item.generic ? `~${item.generic}~` : ""}${item.label === id ? "" : `["${entityCoded(item.label, " ")}"]`}`,
    inner = [
      ...item.annotations.map((annotation) => `<<${annotation}>>`),
      ...classMembers(source, id),
    ],
    text = inner.length ? [`${head} {`, ...inner.map((line) => stepOf(lines) + line), "}"] : [head];
  lines.splice(
    (declaration.body?.close ?? declaration.index) + 1,
    0,
    ...text.map((line) => indent + line),
  );
  return { source: lines.join("\n"), id: copy };
}

/**
 * Moves a class or a note into a namespace (`ns:Sales`), or out of every namespace with null:
 * its declarations, bodies and all, go to the end of the namespace, or to where its kind stands
 * outside. A class that relations only mention is declared there. The notes are numbered in the
 * order of the source, so a note that moves may come back under another id.
 */
export function moveClassInto(source: string, id: string, namespace: string | null): string {
  const diagram = parseClassDiagram(source),
    move = moveOf(diagram, id, namespace);
  if (!move) return source;
  const { note, space } = move,
    result = note ? movedNote(source, note, space) : movedClass(source, id, space),
    now = reads(result);
  if (!now || now.classes.size !== diagram.classes.size) return source;
  return arrived(diagram, now, note ? undefined : id, space) ? result : source;
}

/**
 * What a move takes, the note of an id or else its class, and the namespace it goes to; undefined
 * for a move of nothing, to no namespace of the diagram, or to where the part stands.
 */
function moveOf(diagram: ClassDiagram, id: string, namespace: string | null) {
  const space = namespace === null ? null : spaceOf(diagram, spaceId(namespace)),
    note = diagram.notes.find((item) => item.id === id),
    item = note ?? diagram.classes.get(id);
  if (!item || (namespace !== null && !space) || item.namespace === space) return undefined;
  return { note, space };
}

/** The source with ranges of lines moved to the end of a namespace, or to where their kind stands outside. */
function moveLines(
  source: string,
  ranges: number[][],
  space: string | null,
  kind: "class" | "note",
): string {
  const { moved, rest } = cut(linesOf(source), ranges);
  put(rest, moved, space, kind);
  return rest.lines.join("\n");
}

/** The source with a note moved into a namespace or out of every one. */
const movedNote = (source: string, note: ClassNote, space: string | null) =>
  moveLines(source, [[note.line - 1, note.line - 1]], space, "note");

/** The source with a class declared and its declarations, bodies and all, moved into a namespace or out of every one. */
function movedClass(source: string, id: string, space: string | null): string {
  const text = declare(source, id),
    declarations = outlineOf(text).classes.get(id)!.declarations;
  return moveLines(
    text,
    declarations.map(({ index, body }) => [index, body?.close ?? index]),
    space,
    "class",
  );
}

/**
 * Whether a move arrived: the class stands in the namespace, or, for a note, which may have
 * another id now, the namespace holds one note more.
 */
function arrived(
  before: ClassDiagram,
  now: ClassDiagram,
  id: string | undefined,
  space: string | null,
) {
  if (id !== undefined) return now.classes.get(id)?.namespace === space;
  const held = (found: ClassDiagram) =>
    found.notes.filter((other) => other.namespace === space).length;
  return held(now) === held(before) + 1;
}

/** A namespace's id as a group has it: `ns:` and the dotted id. */
const spaceId = (namespace: string) =>
  namespace.startsWith("ns:") ? namespace : `ns:${namespace}`;

/**
 * Cuts ranges of lines out of a source: the lines without their own indentation, and the outline
 * of what is left.
 */
function cut(lines: string[], ranges: number[][]): { moved: string[]; rest: Outline } {
  const moved: string[] = [],
    gone = new Set<number>();
  for (const [from, to] of ranges) {
    const indent = indentOf(lines[from]);
    for (let index = from; index <= to; index++) {
      gone.add(index);
      moved.push(
        lines[index].startsWith(indent)
          ? lines[index].slice(indent.length)
          : lines[index].trimStart(),
      );
    }
  }
  return { moved, rest: outlineOf(lines.filter((_, index) => !gone.has(index)).join("\n")) };
}

/**
 * Removes a package and keeps what it holds: its classes, notes and packages stand where the
 * package stood, one level out. A package written as part of a dotted name (`namespace app.model`)
 * leaves that name without its own.
 */
export function ungroupClassPackage(source: string, id: string): string {
  const space = spaceOf(parseClassDiagram(source), id);
  if (!space) return source;
  const outline = outlineOf(source),
    gone = new Set<number>();
  for (const statement of outline.blocks)
    if (statement.id === space || statement.id.startsWith(`${space}.`))
      ungroupStatement(outline.lines, statement, space, gone);
  const result = outline.lines.filter((_, index) => !gone.has(index)).join("\n");
  return reads(result) ? result : source;
}

/**
 * Takes a namespace out of a statement that opens it or a namespace inside it: out of its dotted
 * name, or, where it is the whole name, the statement and its brace go into `gone` and what the
 * block holds moves one level out.
 */
function ungroupStatement(
  lines: string[],
  { id: full, name, block }: Outline["blocks"][number],
  space: string,
  gone: Set<number>,
) {
  // A statement names the namespaces from the one it stands in downward.
  const at = space.split(".").length - 1,
    words = name.split("."),
    first = full.split(".").length - words.length;
  if (at < first) return;
  words.splice(at - first, 1);
  const line = lines[block.open],
    indent = indentOf(line),
    step = stepOf(lines);
  if (words.length) {
    const [, , label = "", rest] = line.trim().match(NAMESPACE_PARTS)!;
    // A label is that of the last name: it goes with it.
    lines[block.open] =
      `${indent}namespace ${words.join(".")}${full === space ? "" : label}${rest}`;
    return;
  }
  gone.add(block.open).add(block.close);
  for (let index = block.open + 1; index < block.close; index++)
    if (lines[index].startsWith(indent + step))
      lines[index] = indent + lines[index].slice(indent.length + step.length);
}

/**
 * Removes classes with their relations, notes and styling, namespaces with what they hold, notes,
 * lollipop interfaces with the relation that draws them, and single relations, by id; the line of
 * a note leaves the note without a class. A class that only a removed relation names stays, as a
 * `class` statement in its place.
 */
export function removeClassParts(source: string, ids: Iterable<string>): string {
  const diagram = parseClassDiagram(source),
    outline = outlineOf(source),
    removal: Removal = { gone: new Set(), dropped: new Set(), rewritten: new Map() };
  for (const id of ids) choose(diagram, outline, id, removal);
  for (const id of removal.gone) {
    const item = outline.classes.get(id);
    if (item) dropClass(item, removal.dropped);
  }
  // What stays loses no class: one that only the removed lines name is declared where it stood.
  const kept = keptClasses(diagram, outline, removal);
  return outline.lines
    .flatMap((line, index) => [
      ...(removal.dropped.has(index) ? [] : [removal.rewritten.get(index) ?? line]),
      ...(kept.get(index) ?? []),
    ])
    .join("\n");
}

/** What a removal takes: the classes that go, the lines that go, and the lines written anew. */
interface Removal {
  gone: Set<string>;
  dropped: Set<number>;
  rewritten: Map<number, string>;
}

/** Adds the lines from one index to another to those that go. */
function drop(dropped: Set<number>, from: number, to = from) {
  for (let index = from; index <= to; index++) dropped.add(index);
}

/** Adds the lines of a class that goes to those that go: its declarations with their bodies, and every line that names it. */
function dropClass(item: ClassLines, dropped: Set<number>) {
  for (const { index, body } of item.declarations) drop(dropped, index, body?.close ?? index);
  for (const index of [...item.mentions, ...item.styles]) dropped.add(index);
}

/** Whether a namespace is another one or inside it. */
const within = (space: string | null, id: string) => space === id || !!space?.startsWith(`${id}.`);

/** Adds what goes with one chosen id to a removal. */
function choose(diagram: ClassDiagram, outline: Outline, id: string, removal: Removal) {
  const space = spaceOf(diagram, id),
    note = diagram.notes.find((item) => item.id === id || `${item.id}:link` === id),
    line = [...diagram.relations, ...diagram.lollipops].find((item) => item.id === id)?.line;
  if (space) chooseSpace(diagram, outline, space, removal);
  else if (diagram.classes.has(id)) removal.gone.add(id);
  else if (note?.id === id) removal.dropped.add(note.line - 1);
  // The line of a note leaves the note without a class.
  else if (note)
    removal.rewritten.set(
      note.line - 1,
      outline.lines[note.line - 1].replace(/^(\s*note)\s+for\s+\S+(?=\s+")/, "$1"),
    );
  else if (line) removal.dropped.add(line - 1);
}

/** Adds a namespace to a removal, with the namespaces and classes it holds. */
function chooseSpace(diagram: ClassDiagram, outline: Outline, space: string, removal: Removal) {
  for (const [other, blocks] of outline.spaces)
    if (within(other, space))
      for (const block of blocks) drop(removal.dropped, block.open, block.close);
  for (const item of diagram.classes.values())
    if (within(item.namespace, space)) removal.gone.add(item.id);
}

/**
 * The `class` statements that keep a class which only removed lines name, by the line each
 * follows: the first that names it outside every namespace, as one inside would take it in.
 */
function keptClasses(diagram: ClassDiagram, outline: Outline, removal: Removal) {
  const kept = new Map<number, string[]>(),
    stays = (index: number) => !removal.dropped.has(index) && !removal.rewritten.has(index);
  for (const item of outline.classes.values()) {
    const first = item.mentions.find((index) => !outline.nested.has(index));
    if (removal.gone.has(item.id) || first === undefined || item.mentions.some(stays)) continue;
    kept.set(first, [
      ...(kept.get(first) ?? []),
      `${indentOf(outline.lines[first])}class ${declared(diagram, item.id)}`,
    ]);
  }
  return kept;
}

/**
 * Joins two parts as `connectClasses` does and says which join it wrote: the relation, or the
 * line of the note. No edge, with the source unchanged, when the two are not joined.
 */
export function joinClasses(
  source: string,
  from: string,
  to: string,
  kind?: string,
): { source: string; edge: string } {
  const result = connectClasses(source, from, to, kind);
  if (result === source) return { source, edge: "" };
  const diagram = parseClassDiagram(result),
    note = diagram.notes.find((item) => item.id === from || item.id === to);
  // A new relation is the last statement, and so the last relation.
  return { source: result, edge: note ? `${note.id}:link` : (diagram.relations.at(-1)?.id ?? "") };
}

/**
 * Why two parts are not joined, in words for the user; undefined when `connectClasses` joins
 * them. A relation joins two classes, and a note is joined to the class it is for.
 */
export function whyNotClass(
  source: string,
  from: string,
  to: string,
  kind?: string,
): string | undefined {
  const diagram = parseClassDiagram(source),
    ends = [from, to],
    count = (test: (id: string) => boolean) => ends.filter(test).length,
    notes = count((id) => diagram.notes.some((note) => note.id === id));
  if (notes) return whyNotNote(diagram, ends, notes);
  if (count((id) => spaceOf(diagram, id) !== null))
    return "A package has no relations of its own: join the classes in it.";
  if (count((id) => diagram.lollipops.some((ball) => ball.id === id)))
    return "A lollipop interface belongs to the class it is drawn at.";
  if (count((id) => diagram.classes.has(id)) < 2) return "A relation joins two classes.";
  return kind === undefined || OPERATORS[kind] ? undefined : "There is no relation of that kind.";
}

/** Why a note is not joined to the other end, of the ends given, `notes` of which are notes. */
function whyNotNote(diagram: ClassDiagram, ends: string[], notes: number): string | undefined {
  if (notes === 2) return "A note is joined to a class, not to another note.";
  const target = ends.find((id) => diagram.classes.has(id));
  if (target === undefined) return "A note is joined to a class: drop it on a class.";
  return /\s/.test(ref(target))
    ? "A note cannot name a class whose id has spaces: give the class another id first."
    : undefined;
}

/**
 * Adds a lollipop interface to a class: a ball on a line from the class with the name beside it,
 * written as the relation `Name ()-- Class` after the last statement. Returns the id of the ball,
 * empty with the source unchanged for what is no class.
 */
export function addLollipop(
  source: string,
  classId: string,
  name: string,
): { source: string; id: string } {
  const diagram = parseClassDiagram(source),
    outline = outlineOf(source),
    { lines } = outline,
    label = oneLine(name) || "Interface",
    none = { source, id: "" };
  if (!diagram.classes.has(classId)) return none;
  const at = rootEnd(lines);
  lines.splice(at, 0, `${outline.indent}${ref(label)} ()-- ${ref(classId)}`);
  const result = lines.join("\n"),
    ball = reads(result)?.lollipops.find((item) => item.line === at + 1);
  return ball ? { source: result, id: ball.id } : none;
}

/**
 * Adds a piece at a part and says what it wrote: the id of the piece, and the id of the join
 * between the two when there is one. A note at a class is the note of that class, and a lollipop
 * the interface of that class. A class of any kind stands in the package of the class it is added
 * at and, with a `link`, is the second end of a relation of that kind from it. At a package the
 * piece goes into the package; at any other part, or where the piece is not one for the part, it
 * is added as `addClassPiece` adds it in the group of the part, with no join.
 */
export function attachClass(
  source: string,
  piece: { kind: string; label?: string },
  at: string,
  link?: string,
): { source: string; id: string; edge: string } {
  const node = readClasses(source).nodes.find((item) => item.id === at),
    host = parseClassDiagram(source).classes.has(at),
    alone = (parent: string | null | undefined) => {
      const added = addClassPiece(source, { ...piece, parent });
      return { source: added.id ? added.source : source, id: added.id, edge: "" };
    };
  if (piece.kind === "lollipop") return attachLollipop(source, host ? at : "", piece.label);
  if (!node) return alone(null);
  if (node.group) return alone(at);
  if (!joinsHost(piece.kind, host, link)) return alone(node.parent);
  const added = addClassPiece(source, { ...piece, parent: node.parent }),
    joined =
      piece.kind === "note"
        ? joinClasses(added.source, added.id, at)
        : joinClasses(added.source, at, added.id, link);
  return { source: joined.source, id: added.id, edge: joined.edge };
}

/** Whether a piece added at a part is joined to it: a note, or a class with a link, at a class. */
const joinsHost = (kind: string, host: boolean, link: string | undefined) =>
  host && kind !== "package" && (kind === "note" || link !== undefined);

/** Adds a lollipop interface to a class, none when no class is given, with the relation that draws it. */
function attachLollipop(source: string, host: string, label: string | undefined) {
  const added = host ? addLollipop(source, host, label ?? "") : { source, id: "" },
    now = added.id ? parseClassDiagram(added.source) : undefined,
    ball = now?.lollipops.find((item) => item.id === added.id);
  return {
    ...added,
    edge: now?.relations.find((relation) => relation.line === ball?.line)?.id ?? "",
  };
}

/**
 * What a removal takes with it, in words: the packages and classes it names, and how many
 * classes, packages, relations and notes go with them, as in `Package billing with 3 classes and
 * 2 relations`; for relations and notes alone, how many go. Empty when the removal changes
 * nothing.
 */
export function classRemovalSummary(source: string, ids: Iterable<string>): string {
  const chosen = new Set(ids),
    before = parseClassDiagram(source),
    after = parseClassDiagram(removeClassParts(source, chosen)),
    plain = (label: string) => label.replace(/<br\s*\/?>/gi, " "),
    names = [
      ...[...before.namespaces.values()]
        .filter((space) => chosen.has(`ns:${space.id}`))
        .map((space) => `Package ${plain(space.label)}`),
      ...[...before.classes.values()]
        .filter((item) => chosen.has(item.id) && !after.classes.has(item.id))
        .map((item) => plain(item.label)),
    ],
    // What goes beside the parts the summary names: those are not counted again.
    gone = (all: { id: string }[], left: number, named: (id: string) => boolean) =>
      all.length - left - (names.length ? all.filter(({ id }) => named(id)).length : 0),
    rest = [
      ...counted(
        gone([...before.classes.values()], after.classes.size, (id) => chosen.has(id)),
        "class",
        "classes",
      ),
      ...counted(
        gone([...before.namespaces.values()], after.namespaces.size, (id) =>
          chosen.has(`ns:${id}`),
        ),
        "package",
      ),
      ...counted(
        gone(before.relations, after.relations.length, (id) => chosen.has(id)),
        "relation",
      ),
      ...counted(
        gone(before.notes, after.notes.length, (id) => chosen.has(id)),
        "note",
      ),
    ];
  return names.length
    ? `${names.join(", ")}${rest.length ? ` with ${listed(rest)}` : ""}`
    : listed(rest);
}

/** A join of a class diagram as `read` gives it. */
export interface ClassEdge extends StructureEdge {
  /** Whether the join carries no label to edit: the line from a note to its class. */
  fixedLabel?: boolean;
}

/**
 * The parts and joins of a class diagram, under the ids of its scene. A relation is of one of the
 * kinds in `links`; the relation that draws a lollipop interface is a `lollipop` and the line of
 * a note an `anchor`, which are no kinds to choose.
 */
function readClasses(source: string): { nodes: StructureNode[]; edges: ClassEdge[] } {
  const diagram = parseClassDiagram(source);
  const group = (space: string | null) => (space ? `ns:${space}` : null);
  const parts: StructureNode[] = [
    ...[...diagram.namespaces.values()].map((space) => ({
      id: `ns:${space.id}`,
      label: space.label,
      parent: group(space.parent),
      line: space.line,
      group: true,
      kind: "package",
    })),
    ...[...diagram.classes.values()].map((item) => ({
      id: item.id,
      label: item.label,
      parent: group(item.namespace),
      line: item.line,
      group: false,
      kind: item.annotations.map(kindOfAnnotation).find(Boolean) ?? "class",
    })),
    ...diagram.notes.map((note) => ({
      id: note.id,
      label: note.text,
      parent: group(note.namespace),
      line: note.line,
      group: false,
      kind: "note",
    })),
    // A lollipop is an interface drawn as a ball: a part of a kind of its own, with no members.
    ...diagram.lollipops.map((ball) => ({
      id: ball.id,
      label: ball.label,
      parent: null,
      line: ball.line,
      group: false,
      kind: "lollipop",
    })),
  ].toSorted((a, b) => a.line - b.line);
  // Each group before what it holds, the rest in the order of the source.
  const nodes: StructureNode[] = [];
  const take = (parent: string | null) => {
    for (const part of parts)
      if (part.parent === parent) {
        nodes.push(part);
        if (part.group) take(part.id);
      }
  };
  take(null);
  const edges: ClassEdge[] = [
    ...diagram.relations.map((relation) => ({
      id: relation.id,
      source: relation.source,
      target: relation.target,
      label: relation.label,
      line: relation.line,
      kind: drawsBall(diagram, relation) ? "lollipop" : kindOfRelation(relation),
    })),
    ...diagram.notes.flatMap((note) =>
      note.target
        ? [
            {
              id: `${note.id}:link`,
              source: note.id,
              target: note.target,
              line: note.line,
              kind: "anchor",
              fixedLabel: true,
            },
          ]
        : [],
    ),
  ].toSorted((a, b) => a.line - b.line);
  return { nodes, edges };
}

/** The kinds of part that are classes. */
const CLASS_KINDS = ["class", "interface", "abstract", "enumeration"];

/**
 * Class diagrams as a structure a canvas edits. A class added at another stands beside it without
 * a relation; a note added at a class is the note of that class, and a lollipop exists only at a
 * class: `add` takes that class as its parent, and `attachClass` adds either with its join. The kinds of join are the ones a
 * relation between two classes can be.
 */
export const classStructure: Structure = {
  pieces: [
    {
      kind: "class",
      name: "Class",
      about: "Classifier with attributes and operations",
      named: true,
    },
    {
      kind: "interface",
      name: "Interface",
      about: "Classifier declaring operations that classes realize",
      named: true,
    },
    {
      kind: "abstract",
      name: "Abstract class",
      about: "Class without direct instances",
      named: true,
    },
    {
      kind: "enumeration",
      name: "Enumeration",
      about: "Data type whose values are enumeration literals",
      named: true,
    },
    {
      kind: "note",
      name: "Note",
      about: "Comment, attached to a class or unattached",
      joins: "after",
      joinsTo: CLASS_KINDS,
      named: true,
    },
    {
      kind: "lollipop",
      name: "Lollipop interface",
      about: "Provided interface of a class, in ball notation",
      joins: "after",
      joinsTo: CLASS_KINDS,
      named: true,
    },
    {
      kind: "package",
      name: "Package",
      about: "Namespace that owns classes",
      group: true,
      named: true,
    },
  ],
  links: [
    { kind: "association", name: "Association" },
    { kind: "inheritance", name: "Generalization" },
    { kind: "composition", name: "Composition" },
    { kind: "aggregation", name: "Aggregation" },
    { kind: "dependency", name: "Dependency" },
    { kind: "realization", name: "Realization" },
    { kind: "link", name: "Link" },
    { kind: "dashed", name: "Dashed link" },
  ],
  read: readClasses,
  add: addClassPiece,
  connect: connectClasses,
  rename: renameClassPart,
  retitle: retitleClassPart,
  label: labelRelation,
  relink: relinkRelation,
  remove: (source, ids) => removeClassParts(source, ids),
};
