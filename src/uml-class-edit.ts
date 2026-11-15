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
import { type ClassDiagram, parseClassDiagram, type Relation } from "./uml-class.ts";

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

const linesOf = (source: string) => source.replace(/\r\n?/g, "\n").split("\n");

const indentOf = (line: string) => line.match(/^\s*/)![0];

/** One more level of indentation, in the style of the source: a tab where it indents with tabs. */
const stepOf = (lines: string[]) => (lines.some((line) => line.startsWith("\t")) ? "\t" : "  ");

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

/**
 * A label as the source holds it: line breaks as `<br>` (or a space, in a name), and the characters
 * the syntax reads for itself as Mermaid's entity codes.
 */
const labelText = (label: string, breaks = "<br>") =>
  label
    .trim()
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/\s*\n\s*/g, breaks);

/** A label inside the brackets of a namespace, which end at the first `]`. */
const spaceLabel = (label: string) => labelText(label, " ").replace(/\]/g, "#93;");

/** A member as a line of a class body: one line, which a closing brace does not end. */
const memberText = (text: string) =>
  text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .replace(/[\s}]+$/, "");

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
  /** Notes the place of a class's name, which starts `offset` characters into the statement. */
  const name = (raw: string, index: number, offset: number) => {
    const start = indentOf(lines[index]).length + offset;
    outline.names.push({ id: idOf(raw), index, start, end: start + raw.length });
  };
  const ensure = (raw: string, index: number, offset = 0) => {
    const id = idOf(raw);
    name(raw, index, offset);
    let item = outline.classes.get(id);
    if (!item) {
      item = { id, declarations: [], entries: [], marks: [], styles: [], mentions: [] };
      outline.classes.set(id, item);
    }
    item.mentions.push(index);
    return item;
  };
  const entry = (item: ClassLines, index: number, raw: string, inline: boolean, outside = false) =>
    item.entries.push({
      index,
      text: raw.trim(),
      annotation: raw.trim().match(/^<<\s*(.+?)\s*>>$/)?.[1],
      inline,
      outside,
    });
  const open: { id: string; block: Block }[] = [];
  let body: { item: ClassLines; block: Block } | null = null;
  const accessibility = accessibilityLines();
  for (const { text, line } of statements) {
    const index = line - 1;
    if (body) {
      if (text.endsWith("}")) {
        if (text !== "}") entry(body.item, index, text.slice(0, -1), true);
        body.block.close = index;
        body = null;
      } else entry(body.item, index, text, false);
      continue;
    }
    if (accessibility(text) || /^direction\s/i.test(text)) continue;
    if (text === "}") {
      const closed = open.pop();
      if (closed) closed.block.close = index;
      continue;
    }
    if (open.length) outline.nested.add(index);
    let match: RegExpMatchArray | null;
    if ((match = text.match(NAMESPACE))) {
      const id = open.length ? `${open.at(-1)!.id}.${match[1]}` : match[1],
        block = { open: index, close: match[3] ? index : -1 };
      outline.spaces.set(id, [...(outline.spaces.get(id) ?? []), block]);
      outline.blocks.push({ id, name: match[1], block });
      if (!match[3]) open.push({ id, block });
    } else if ((match = text.match(CLASS))) {
      const item = ensure(match[1], index, text.match(/^class\s+/)![0].length),
        inner = match[4]?.slice(1).trim(),
        block = inner === undefined ? null : { open: index, close: -1 };
      item.declarations.push({
        index,
        body: block,
        labelled: match[2] !== undefined,
        annotation: match[3],
      });
      if (!block) continue;
      if (inner!.endsWith("}")) {
        if (inner!.slice(0, -1).trim()) entry(item, index, inner!.slice(0, -1), true);
        block.close = index;
        continue;
      }
      if (inner) entry(item, index, inner, true);
      body = { item, block };
    } else if ((match = text.match(ANNOTATION)))
      ensure(match[2], index, text.length - match[2].length).marks.push({
        index,
        annotation: match[1],
      });
    else if ((match = text.match(NOTE_FOR))) {
      ensure(match[1], index, text.match(/^note\s+for\s+/)![0].length);
      if (!open.length) outline.notes.push(index);
    } else if (NOTE.test(text)) {
      if (!open.length) outline.notes.push(index);
    } else if ((match = text.match(RELATION))) {
      outline.relations.push(index);
      // A lollipop end names an interface ball, not a class.
      if (!(match[4] === "()" && !match[6])) ensure(match[1], index);
      if (!(match[6] === "()" && !match[4]))
        ensure(
          match[9],
          index,
          match.slice(1, 9).reduce((sum, part) => sum + (part?.length ?? 0), 0),
        );
    } else if ((match = text.match(MEMBER)))
      entry(ensure(match[1], index), index, match[2], false, true);
    else if ((match = text.match(CSS))) ensure(match[1], index).styles.push(index);
    else if ((match = text.match(STYLED))) {
      name(match[1], index, text.match(/^\w+\s+/)![0].length);
      const item = outline.classes.get(idOf(match[1]));
      // Styling of a class named only later is left alone: it draws nothing.
      if (item) item.styles.push(index);
    }
  }
  return outline;
}

/** Where a statement is added outside every namespace: after the last line with text. */
function rootEnd(lines: string[]): number {
  let at = lines.length;
  while (at > 0 && !lines[at - 1].trim()) at--;
  return at;
}

/**
 * Where a new part that stands in no namespace goes: a class after the last class declared there
 * with the statements that follow it for its members and styling, a package after the last
 * package, each after the other where its own kind is missing, and before the first relation
 * where there is neither; a note after the last note. Else after the last line with text.
 */
function rootPlace(outline: Outline, kind: "class" | "note" | "package"): number {
  const { lines } = outline,
    end = rootEnd(lines),
    after = (ends: number[]) => (ends.length ? Math.max(...ends) + 1 : undefined);
  if (kind === "note") return after(outline.notes) ?? end;
  const classes = [...outline.classes.values()],
    // The statements that say more of a class: its members, annotations and styling.
    more = new Set(
      classes.flatMap((item) => [
        ...item.entries.filter((entry) => entry.outside).map((entry) => entry.index),
        ...item.marks.map((mark) => mark.index),
        ...item.styles,
      ]),
    );
  let lastClass = after(
    classes.flatMap((item) =>
      item.declarations
        .filter(({ index }) => !outline.nested.has(index))
        .map(({ index, body }) => (body ? body.close : index)),
    ),
  );
  while (lastClass !== undefined && more.has(lastClass)) lastClass++;
  const lastSpace = after(
    outline.blocks
      .filter(({ block }) => !outline.nested.has(block.open))
      .map(({ block }) => block.close),
  );
  let relation = outline.relations.length ? Math.min(...outline.relations) : undefined;
  // A comment above the first relation stays with it.
  while (relation && lines[relation - 1].trim().startsWith("%%")) relation--;
  const [first, second] = kind === "class" ? [lastClass, lastSpace] : [lastSpace, lastClass];
  return first ?? second ?? relation ?? end;
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
  const braces = line.trim().match(CLASS)![4],
    head = line.trimEnd().slice(0, line.trimEnd().length - braces.length + 1),
    inner = braces.slice(1).trim();
  if (inner) {
    const member = close === open ? inner.slice(0, -1).trim() : inner;
    lines.splice(
      open,
      1,
      head,
      ...(member ? [indent + step + member] : []),
      ...(close === open ? [`${indent}}`] : []),
    );
  }
  return lines.join("\n");
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
  const member = memberText(text);
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
  const texts = members.map(memberText).filter(Boolean);
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
  const found = (item: ClassLines) =>
    item.entries.filter((entry) => entry.annotation && goes(entry.annotation));
  // An annotation on a line with a brace gets a line of its own first; so does the new one.
  if (add || found(outline.classes.get(id)!).some((entry) => entry.inline))
    outline = outlineOf(withBody(source, id));
  const item = outline.classes.get(id)!,
    { lines } = outline,
    gone = new Set([
      ...found(item).map((entry) => entry.index),
      ...item.marks.filter((mark) => goes(mark.annotation)).map((mark) => mark.index),
    ]);
  for (const declaration of item.declarations)
    if (declaration.annotation && goes(declaration.annotation)) {
      const line = lines[declaration.index],
        [, head, label = "", rest] = line.trim().match(CLASS_PARTS)!;
      lines[declaration.index] =
        indentOf(line) + head + label + rest.replace(/\s*<<\s*[^>]+?\s*>>/, "");
    }
  const body = add ? bodyOf(outline, id) : null;
  return lines
    .flatMap((line, index) => [
      ...(gone.has(index) ? [] : [line]),
      ...(body && index === body.block.open ? [`${indentOf(line)}${stepOf(lines)}<<${add}>>`] : []),
    ])
    .join("\n");
}

/**
 * The stereotype of a class: its first annotation that is not the one that makes it an interface,
 * an abstract class or an enumeration (`service` for `<<service>>`); empty when it has none.
 */
export function classStereotype(source: string, id: string): string {
  return (
    parseClassDiagram(source)
      .classes.get(id)
      ?.annotations.find((annotation) => !kindOfAnnotation(annotation)) ?? ""
  );
}

/**
 * Gives a class another stereotype, written with or without its `<<` `>>`; an empty one removes
 * it. The annotation that makes the class an interface, an abstract class or an enumeration
 * stays, and a stereotype that names one of these makes the class that kind.
 */
export function setClassStereotype(source: string, id: string, text: string): string {
  const name = text
      .replace(/<<|>>|[«»<>]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    found = parseClassDiagram(source).classes.get(id);
  if (!found || name === classStereotype(source, id)) return source;
  const plain = (annotation: string) => !kindOfAnnotation(annotation),
    kind = kindOfAnnotation(name);
  return kind
    ? setClassKind(annotate(source, id, plain), id, kind)
    : annotate(source, id, plain, name || undefined);
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

/** A piece's id: its name as one word when it has one that is free, else the base with a number. */
function freshId(taken: (id: string) => boolean, base: string, label: string): string {
  const name = wordOf(label);
  if (name && !taken(name)) return name;
  for (let count = name ? 2 : 1; ; count++) {
    const id = `${name || base}${count}`;
    if (!taken(id)) return id;
  }
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
 * the id is a kind with a number that no class or package of the diagram has. Returns the id of
 * its shape.
 */
export function addClassPiece(
  source: string,
  piece: { kind: string; label?: string; parent?: string | null },
): { source: string; id: string } {
  const diagram = parseClassDiagram(source),
    outline = outlineOf(source),
    step = stepOf(outline.lines),
    label = (piece.label ?? "").replace(/\s*\n\s*/g, " ").trim(),
    parent = spaceOf(diagram, piece.parent);
  let id = "",
    text: string[];
  if (piece.kind === "note") text = [`note "${labelText(piece.label ?? "") || "Note"}"`];
  else if (piece.kind === "package") {
    // A name is free when no package has it, wherever that one stands.
    const names = new Set([...diagram.namespaces.keys()].map((space) => space.split(".").at(-1)));
    const name = freshId((name) => names.has(name), "Package", label);
    id = `ns:${parent ? `${parent}.${name}` : name}`;
    text = [`namespace ${name}${label && label !== name ? `["${spaceLabel(label)}"]` : ""} {`, "}"];
  } else {
    const kind = piece.kind in ANNOTATIONS ? piece.kind : "class";
    id = freshId(usedIn(diagram), kind[0].toUpperCase() + kind.slice(1), label);
    const head = `class ${id}${label && label !== id ? `["${labelText(label, " ")}"]` : ""}`;
    text = kind === "class" ? [head] : [`${head} {`, `${step}<<${ANNOTATIONS[kind]}>>`, "}"];
  }
  const at = put(
      outline,
      text,
      parent,
      piece.kind === "note" || piece.kind === "package" ? piece.kind : "class",
    ),
    result = outline.lines.join("\n");
  // Notes are numbered in the order of the source: the one on the new line says which it is.
  if (piece.kind === "note")
    id = parseClassDiagram(result).notes.find((note) => note.line === at + 1)?.id ?? "";
  return { source: result, id };
}

/**
 * A relation's line with another operator, label or name at an end; what is not changed stays,
 * the multiplicities among it.
 */
function relationLine(
  line: string,
  change: {
    operator?: (start: string, end: string) => string;
    label?: string;
    ends?: (left: string, right: string, start: string, end: string) => [string, string];
    /** The multiplicity at the first end, at the second end, or both; an empty one goes. */
    multiplicity?: { start?: string; end?: string };
    /** Whether the ends change places, each with its multiplicity. */
    reverse?: boolean;
  },
): string {
  const match = line.trim().match(RELATION);
  if (!match) return line;
  const [, left, gap, startLabel = "", start = "", stroke, end = "", space, endLabel = "", right] =
    match;
  const quoted = (text: string) => (text.trim() ? `${text.trim()} ` : ""),
    given = (text: string | undefined, old: string) =>
      text === undefined ? quoted(old) : text ? `"${text}" ` : "";
  let near = given(change.multiplicity?.start, startLabel),
    far = given(change.multiplicity?.end, endLabel),
    [first, second] = change.ends ? change.ends(left, right, start, end) : [left, right];
  if (change.reverse) [near, far, first, second] = [far, near, second, first];
  const operator = change.operator ? change.operator(start, end) : start + stroke + end,
    label = change.label === undefined ? (match[10] ?? "").trim() : change.label;
  // A multiplicity stands a space away from the name before it.
  return `${indentOf(line)}${first}${near ? gap || " " : gap}${near}${operator}${far ? space || " " : space}${far}${second}${label ? ` : ${label}` : ""}`;
}

/**
 * Joins two classes with a relation of a kind, an association when none is given. The first end
 * is where an association, a dependency, an inheritance or a realization starts, and the whole of
 * a composition or an aggregation; both ends may be the same class. With a note at one end the
 * note becomes one for the class at the other, whatever the kind: that is the only way a note
 * comes to a class, or to another one.
 */
export function connectClasses(source: string, from: string, to: string, kind?: string): string {
  const diagram = parseClassDiagram(source),
    lines = linesOf(source);
  const note = diagram.notes.find((item) => item.id === from || item.id === to);
  if (note) {
    const target = note.id === from ? to : from,
      index = note.line - 1;
    if (!diagram.classes.has(target) || /\s/.test(ref(target))) return source;
    lines[index] = lines[index].replace(
      /^(\s*note)(?:\s+for\s+\S+)?(?=\s+")/,
      (_, head: string) => `${head} for ${ref(target)}`,
    );
    return lines.join("\n");
  }
  const operator = OPERATORS[kind ?? "association"]?.[0];
  if (!operator || !diagram.classes.has(from) || !diagram.classes.has(to)) return source;
  lines.splice(rootEnd(lines), 0, `${outlineOf(source).indent}${ref(from)} ${operator} ${ref(to)}`);
  return lines.join("\n");
}

/**
 * Gives a part another name. A class keeps its id, which relations and notes name it by, and
 * shows the name as its label (`class Order["Purchase order"]`); a name that is the id itself
 * takes the label away. A namespace gets its label the same way, a note its text, and a lollipop
 * interface its name on the relation that draws it.
 */
export function renameClassPart(source: string, id: string, label: string): string {
  const diagram = parseClassDiagram(source);
  const note = diagram.notes.find((item) => item.id === id),
    ball = diagram.lollipops.find((item) => item.id === id),
    space = spaceOf(diagram, id);
  if (!note && !ball && !space && !diagram.classes.has(id)) return source;
  if (!note && !space && !ball) source = declare(source, id);
  const outline = outlineOf(source),
    { lines } = outline;
  const write = (index: number, change: (text: string) => string) => {
    lines[index] = indentOf(lines[index]) + change(lines[index].trim());
    return lines.join("\n");
  };
  if (note)
    return write(note.line - 1, (text) =>
      text.replace(/"[\s\S]*"$/, () => `"${labelText(label) || " "}"`),
    );
  if (ball) {
    const name = label.replace(/\s*\n\s*/g, " ").trim();
    if (!name) return source;
    lines[ball.line - 1] = relationLine(lines[ball.line - 1], {
      ends: (left, right, start, end) =>
        start === "()" && !end ? [ref(name), right] : [left, ref(name)],
    });
    return lines.join("\n");
  }
  if (space) {
    const blocks = outline.spaces.get(space) ?? [],
      labelled = blocks.findLast((block) => NAMESPACE_PARTS.exec(lines[block.open].trim())?.[2]),
      block = labelled ?? blocks[0],
      name = spaceLabel(label);
    // A namespace that only a dotted name implies has no statement to carry a label.
    if (!block) return source;
    return write(block.open, (text) => {
      const [, head, , rest] = text.match(NAMESPACE_PARTS)!;
      return name && name !== space.split(".").at(-1) ? `${head}["${name}"]${rest}` : head + rest;
    });
  }
  const declarations = outline.classes.get(id)!.declarations,
    declaration = declarations.findLast((found) => found.labelled) ?? declarations[0],
    name = labelText(label, " ");
  return write(declaration.index, (text) => {
    const [, head, , rest] = text.match(CLASS_PARTS)!;
    return name && name !== id ? `${head}["${name}"]${rest}` : head + rest;
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
 * `Class : member` and annotation statements and styling lines; its type arguments stay. A
 * namespace (`ns:Sales.Billing`) gets another last name the same way, in every statement that
 * opens it or a namespace inside it. The source comes back unchanged when the new id is not one
 * the syntax can write, is a word of the syntax, or is taken by another class or namespace.
 */
export function renameClassId(source: string, id: string, newId: string): string {
  const diagram = parseClassDiagram(source),
    name = newId.trim(),
    space = spaceOf(diagram, id);
  if (space) {
    const parent = space.split(".").slice(0, -1).join("."),
      full = name.replace(/^ns:/, "");
    return renameSpace(
      source,
      diagram,
      space,
      parent && full.startsWith(`${parent}.`) ? full.slice(parent.length + 1) : full,
    );
  }
  if (
    !diagram.classes.has(id) ||
    !name ||
    name === id ||
    /[`"\n]/.test(name) ||
    /^(note|interface)\d+$|^ns:/.test(name) ||
    RESERVED.test(name) ||
    diagram.classes.has(name)
  )
    return source;
  const outline = outlineOf(source),
    { lines } = outline,
    written = ref(name);
  // From the right, so the places before keep their columns.
  const places = outline.names
    .filter((place) => place.id === id)
    .toSorted((a, b) => b.index - a.index || b.start - a.start);
  for (const { index, start, end } of places) {
    const raw = lines[index].slice(start, end),
      generic = raw.startsWith("`") || !raw.includes("~") ? "" : raw.slice(raw.indexOf("~"));
    // A name in backticks carries no type arguments.
    if (generic && written.startsWith("`")) return source;
    lines[index] = lines[index].slice(0, start) + written + generic + lines[index].slice(end);
  }
  const result = lines.join("\n"),
    now = reads(result);
  return now?.classes.has(name) &&
    !now.classes.has(id) &&
    now.classes.size === diagram.classes.size &&
    now.relations.length === diagram.relations.length &&
    now.notes.length === diagram.notes.length
    ? result
    : source;
}

/**
 * Gives a class or a package that was just added its first name: the id follows the name
 * (`Order Item` makes `class OrderItem["Order Item"]`, `Invoice` makes `class Invoice`) wherever
 * the source names it, unless another class or package has that id; then the id stays and the
 * name is its label. A note gets its text. Returns the id the part has afterwards.
 */
export function retitleClassPart(
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
export function labelRelation(source: string, edge: string, label: string): string {
  const relation = parseClassDiagram(source).relations.find((item) => item.id === edge),
    lines = linesOf(source);
  if (!relation) return source;
  lines[relation.line - 1] = relationLine(lines[relation.line - 1], { label: labelText(label) });
  return lines.join("\n");
}

/**
 * Makes a relation one of another kind, between the same ends: the end an arrow starts from, or
 * that a diamond stands at, stays the first end of the new kind. The relation that draws a
 * lollipop interface and the line of a note stay what they are.
 */
export function relinkRelation(source: string, edge: string, kind: string): string {
  const diagram = parseClassDiagram(source),
    relation = diagram.relations.find((item) => item.id === edge),
    lines = linesOf(source);
  if (!relation || !OPERATORS[kind] || kind === kindOfRelation(relation)) return source;
  if (drawsBall(diagram, relation)) return source;
  lines[relation.line - 1] = relationLine(lines[relation.line - 1], {
    operator: (start, end) => {
      const pointed = start && !end ? /[<|]/.test(start) : false,
        held = end && !start ? /[*o]/.test(end) : false;
      return OPERATORS[kind][pointed || held ? 1 : 0];
    },
  });
  return lines.join("\n");
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
  const copy = freshId(usedIn(diagram), "Class", id),
    outline = outlineOf(declare(source, id)),
    { lines } = outline,
    declaration = outline.classes.get(id)!.declarations.at(-1)!,
    indent = indentOf(lines[declaration.index]),
    head = `class ${copy}${item.generic ? `~${item.generic}~` : ""}${item.label === id ? "" : `["${labelText(item.label, " ")}"]`}`,
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
    space =
      namespace === null
        ? null
        : spaceOf(diagram, namespace.startsWith("ns:") ? namespace : `ns:${namespace}`),
    note = diagram.notes.find((item) => item.id === id),
    item = note ?? diagram.classes.get(id);
  if (!item || (namespace !== null && !space) || item.namespace === space) return source;
  const outline = outlineOf(note ? source : declare(source, id)),
    { lines } = outline;
  const ranges = note
    ? [[note.line - 1, note.line - 1]]
    : outline.classes
        .get(id)!
        .declarations.map(({ index, body }) => [index, body ? body.close : index]);
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
  const rest = outlineOf(lines.filter((_, index) => !gone.has(index)).join("\n"));
  put(rest, moved, space, note ? "note" : "class");
  const result = rest.lines.join("\n"),
    now = reads(result),
    held = (found: ClassDiagram) => found.notes.filter((other) => other.namespace === space).length;
  const arrived = note
    ? !!now && held(now) === held(diagram) + 1
    : now?.classes.get(id)?.namespace === space;
  return arrived && now!.classes.size === diagram.classes.size ? result : source;
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
    { lines } = outline,
    step = stepOf(lines),
    at = space.split(".").length - 1,
    gone = new Set<number>();
  for (const { id: full, name, block } of outline.blocks) {
    if (full !== space && !full.startsWith(`${space}.`)) continue;
    // A statement names the namespaces from the one it stands in downward.
    const words = name.split("."),
      first = full.split(".").length - words.length;
    if (at < first) continue;
    words.splice(at - first, 1);
    const line = lines[block.open],
      indent = indentOf(line);
    if (words.length) {
      const [, , label = "", rest] = line.trim().match(NAMESPACE_PARTS)!;
      // A label is that of the last name: it goes with it.
      lines[block.open] =
        `${indent}namespace ${words.join(".")}${full === space ? "" : label}${rest}`;
      continue;
    }
    gone.add(block.open).add(block.close);
    for (let index = block.open + 1; index < block.close; index++)
      if (lines[index].startsWith(indent + step))
        lines[index] = indent + lines[index].slice(indent.length + step.length);
  }
  const result = lines.filter((_, index) => !gone.has(index)).join("\n");
  return reads(result) ? result : source;
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
    { lines } = outline;
  const gone = new Set<string>(),
    dropped = new Set<number>(),
    rewritten = new Map<number, string>();
  const drop = (from: number, to = from) => {
    for (let index = from; index <= to; index++) dropped.add(index);
  };
  const within = (space: string | null, id: string) =>
    space === id || !!space?.startsWith(`${id}.`);
  for (const id of ids) {
    const space = spaceOf(diagram, id),
      note = diagram.notes.find((item) => item.id === id || `${item.id}:link` === id),
      line = [...diagram.relations, ...diagram.lollipops].find((item) => item.id === id)?.line;
    if (space) {
      for (const [other, blocks] of outline.spaces)
        if (within(other, space)) for (const block of blocks) drop(block.open, block.close);
      for (const item of diagram.classes.values())
        if (within(item.namespace, space)) gone.add(item.id);
    } else if (diagram.classes.has(id)) gone.add(id);
    else if (note?.id === id) drop(note.line - 1);
    else if (note)
      rewritten.set(
        note.line - 1,
        lines[note.line - 1].replace(/^(\s*note)\s+for\s+\S+(?=\s+")/, "$1"),
      );
    else if (line) drop(line - 1);
  }
  for (const id of gone) {
    const item = outline.classes.get(id);
    if (!item) continue;
    for (const { index, body } of item.declarations) drop(index, body ? body.close : index);
    for (const index of [...item.mentions, ...item.styles]) drop(index);
  }
  // What stays loses no class: one that only the removed lines name is declared where it stood.
  const kept = new Map<number, string[]>();
  for (const item of outline.classes.values()) {
    // A statement in a namespace would take the class into it: the place is one outside.
    const first = item.mentions.find((index) => !outline.nested.has(index));
    if (
      gone.has(item.id) ||
      first === undefined ||
      item.mentions.some((index) => !dropped.has(index) && !rewritten.has(index))
    )
      continue;
    kept.set(first, [
      ...(kept.get(first) ?? []),
      `${indentOf(lines[first])}class ${declared(diagram, item.id)}`,
    ]);
  }
  return lines
    .flatMap((line, index) => [
      ...(dropped.has(index) ? [] : [rewritten.get(index) ?? line]),
      ...(kept.get(index) ?? []),
    ])
    .join("\n");
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
    // A lollipop is an interface, drawn as a ball.
    ...diagram.lollipops.map((ball) => ({
      id: ball.id,
      label: ball.label,
      parent: null,
      line: ball.line,
      group: false,
      kind: "interface",
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
 * a relation; a note added at a class is the note of that class. The kinds of join are the ones a
 * relation between two classes can be.
 */
export const classStructure: Structure = {
  pieces: [
    {
      kind: "class",
      name: "Class",
      about: "A kind of thing, with attributes and operations",
      named: true,
    },
    {
      kind: "interface",
      name: "Interface",
      about: "Operations that classes offer",
      named: true,
    },
    {
      kind: "abstract",
      name: "Abstract class",
      about: "A class that only its subclasses have objects of",
      named: true,
    },
    {
      kind: "enumeration",
      name: "Enumeration",
      about: "A fixed list of values",
      named: true,
    },
    {
      kind: "note",
      name: "Note",
      about: "A remark, on a class or free",
      joins: "after",
      joinsTo: CLASS_KINDS,
      named: true,
    },
    {
      kind: "package",
      name: "Package",
      about: "A namespace that holds classes",
      group: true,
      named: true,
    },
  ],
  links: [
    { kind: "association", name: "Association" },
    { kind: "inheritance", name: "Inheritance" },
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
