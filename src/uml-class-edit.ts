/**
 * Editing a class diagram source as text: adding, naming, connecting and removing classes, notes
 * and packages, and changing the members of a class, the way uml-activity-edit.ts edits flowcharts.
 * Each function returns the source with one change made; a line that is not part of the change
 * stays as it was. The layout stays automatic.
 *
 * Parts carry the ids of the scene: a class its id, a namespace `ns:` and its dotted id, a note
 * `note1`, a lollipop interface `interface1`; a relation `r1`, the line from a note to its class
 * `note1:link`.
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

/** The lines of a source by what they declare, read the way the parser reads them. */
interface Outline {
  lines: string[];
  classes: Map<string, ClassLines>;
  /** The blocks of each namespace, by its dotted id. */
  spaces: Map<string, Block[]>;
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
    nested: new Set(),
    indent: statements.length ? indentOf(lines[statements[0].line - 1]) : "  ",
  };
  const ensure = (raw: string, index: number) => {
    const id = idOf(raw);
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
      if (!match[3]) open.push({ id, block });
    } else if ((match = text.match(CLASS))) {
      const item = ensure(match[1], index),
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
      ensure(match[2], index).marks.push({ index, annotation: match[1] });
    else if ((match = text.match(NOTE_FOR))) ensure(match[1], index);
    else if (NOTE.test(text)) continue;
    else if ((match = text.match(RELATION))) {
      // A lollipop end names an interface ball, not a class.
      if (!(match[4] === "()" && !match[6])) ensure(match[1], index);
      if (!(match[6] === "()" && !match[4])) ensure(match[9], index);
    } else if ((match = text.match(MEMBER)))
      entry(ensure(match[1], index), index, match[2], false, true);
    else if ((match = text.match(CSS))) ensure(match[1], index).styles.push(index);
    else if ((match = text.match(STYLED))) {
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
  const diagram = parseClassDiagram(source),
    found = diagram.classes.get(id);
  if (!found) return source;
  if (kind === "class" && !found.annotations.some(kindOfAnnotation)) return source;
  let outline = outlineOf(source);
  const kinds = (item: ClassLines) =>
    item.entries.filter((entry) => entry.annotation && kindOfAnnotation(entry.annotation));
  // An annotation on a line with a brace gets a line of its own first; so does the new one.
  if (kind !== "class" || kinds(outline.classes.get(id)!).some((entry) => entry.inline))
    outline = outlineOf(withBody(source, id));
  const item = outline.classes.get(id)!,
    { lines } = outline,
    gone = new Set([
      ...kinds(item).map((entry) => entry.index),
      ...item.marks.filter((mark) => kindOfAnnotation(mark.annotation)).map((mark) => mark.index),
    ]);
  for (const declaration of item.declarations)
    if (declaration.annotation && kindOfAnnotation(declaration.annotation)) {
      const line = lines[declaration.index],
        [, head, label = "", rest] = line.trim().match(CLASS_PARTS)!;
      lines[declaration.index] =
        indentOf(line) + head + label + rest.replace(/\s*<<\s*[^>]+?\s*>>/, "");
    }
  const body = kind === "class" ? null : bodyOf(outline, id);
  return lines
    .flatMap((line, index) => [
      ...(gone.has(index) ? [] : [line]),
      ...(body && index === body.block.open
        ? [`${indentOf(line)}${stepOf(lines)}<<${ANNOTATIONS[kind]}>>`]
        : []),
    ])
    .join("\n");
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

/** A piece's id: its name as one word when it has one that is free, else the base with a number. */
function freshId(taken: (id: string) => boolean, base: string, label: string): string {
  const words = label.split(/[^\p{L}\p{N}_]+/u).filter(Boolean),
    name =
      words.length > 1
        ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join("")
        : (words[0] ?? "");
  if (name && !taken(name)) return name;
  for (let count = name ? 2 : 1; ; count++) {
    const id = `${name || base}${count}`;
    if (!taken(id)) return id;
  }
}

/** The namespace a group's id names, when the diagram has it. */
const spaceOf = (diagram: ClassDiagram, id: string | null | undefined) =>
  id?.startsWith("ns:") && diagram.namespaces.has(id.slice(3)) ? id.slice(3) : null;

/**
 * Adds a class, an interface, an abstract class, an enumeration, a note or a package; inside a
 * namespace when given. A class takes its id from its name (`Order Item` is `OrderItem`, shown
 * under its name), a package likewise. Returns the id of its shape.
 */
export function addClassPiece(
  source: string,
  piece: { kind: string; label?: string; parent?: string | null },
): { source: string; id: string } {
  const diagram = parseClassDiagram(source),
    outline = outlineOf(source),
    { lines } = outline,
    step = stepOf(lines),
    label = (piece.label ?? "").replace(/\s*\n\s*/g, " ").trim(),
    parent = spaceOf(diagram, piece.parent);
  let id = "",
    text: string[];
  if (piece.kind === "note") text = [`note "${labelText(piece.label ?? "") || "Note"}"`];
  else if (piece.kind === "package") {
    const name = freshId(
      (name) => diagram.namespaces.has(parent ? `${parent}.${name}` : name),
      "Package",
      label,
    );
    id = `ns:${parent ? `${parent}.${name}` : name}`;
    text = [`namespace ${name}${label && label !== name ? `["${spaceLabel(label)}"]` : ""} {`, "}"];
  } else {
    const kind = piece.kind in ANNOTATIONS ? piece.kind : "class";
    id = freshId(
      (name) =>
        diagram.classes.has(name) ||
        diagram.namespaces.has(name) ||
        /^(note|interface)\d+$/.test(name),
      kind[0].toUpperCase() + kind.slice(1),
      label,
    );
    const head = `class ${id}${label && label !== id ? `["${labelText(label, " ")}"]` : ""}`;
    text = kind === "class" ? [head] : [`${head} {`, `${step}<<${ANNOTATIONS[kind]}>>`, "}"];
  }
  const block = parent ? outline.spaces.get(parent)?.at(-1) : undefined;
  let at: number;
  if (block) {
    const indent = indentOf(lines[block.open]);
    // An empty namespace on one line opens over two.
    if (block.close === block.open)
      lines.splice(block.open, 1, lines[block.open].replace(/\s*\}\s*$/, ""), `${indent}}`);
    at = block.close === block.open ? block.open + 1 : block.close;
    lines.splice(at, 0, ...text.map((line) => indent + step + line));
  } else if (parent) {
    // A namespace that only a dotted name implies has no block of its own: it gets one.
    at = rootEnd(lines) + 1;
    lines.splice(
      at - 1,
      0,
      `${outline.indent}namespace ${parent} {`,
      ...text.map((line) => outline.indent + step + line),
      `${outline.indent}}`,
    );
  } else {
    at = rootEnd(lines);
    lines.splice(at, 0, ...text.map((line) => outline.indent + line));
  }
  const result = lines.join("\n");
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
  },
): string {
  const match = line.trim().match(RELATION);
  if (!match) return line;
  const [, left, gap, startLabel = "", start = "", stroke, end = "", space, endLabel = "", right] =
    match;
  const operator = change.operator ? change.operator(start, end) : start + stroke + end,
    label = change.label === undefined ? (match[10] ?? "").trim() : change.label,
    [first, second] = change.ends ? change.ends(left, right, start, end) : [left, right];
  return `${indentOf(line)}${first}${gap}${startLabel}${operator}${space}${endLabel}${second}${label ? ` : ${label}` : ""}`;
}

/**
 * Joins two classes with a relation of a kind, an association when none is given. The first end
 * is where an association, a dependency, an inheritance or a realization starts, and the whole of
 * a composition or an aggregation. With a note at one end the note becomes one for the class at
 * the other, whatever the kind.
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
  if (diagram.lollipops.some((ball) => ball.id === relation.source || ball.id === relation.target))
    return source;
  lines[relation.line - 1] = relationLine(lines[relation.line - 1], {
    operator: (start, end) => {
      const pointed = start && !end ? /[<|]/.test(start) : false,
        held = end && !start ? /[*o]/.test(end) : false;
      return OPERATORS[kind][pointed || held ? 1 : 0];
    },
  });
  return lines.join("\n");
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

/** The parts and joins of a class diagram, under the ids of its scene. */
function readClasses(source: string): { nodes: StructureNode[]; edges: StructureEdge[] } {
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
  const edges: StructureEdge[] = [
    ...diagram.relations.map((relation) => ({
      id: relation.id,
      source: relation.source,
      target: relation.target,
      label: relation.label,
      line: relation.line,
      kind: kindOfRelation(relation),
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
            },
          ]
        : [],
    ),
  ].toSorted((a, b) => a.line - b.line);
  return { nodes, edges };
}

/** Class diagrams as a structure a canvas edits. */
export const classStructure: Structure = {
  pieces: [
    {
      kind: "class",
      name: "Class",
      about: "A kind of thing, with attributes and operations",
      joins: "after",
      named: true,
    },
    {
      kind: "interface",
      name: "Interface",
      about: "Operations that classes offer",
      joins: "after",
      named: true,
    },
    {
      kind: "abstract",
      name: "Abstract class",
      about: "A class that only its subclasses have objects of",
      joins: "after",
      named: true,
    },
    {
      kind: "enumeration",
      name: "Enumeration",
      about: "A fixed list of values",
      joins: "after",
      named: true,
    },
    {
      kind: "note",
      name: "Note",
      about: "A remark, on a class or free",
      joins: "after",
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
    { kind: "anchor", name: "Note anchor" },
  ],
  read: readClasses,
  add: addClassPiece,
  connect: connectClasses,
  rename: renameClassPart,
  label: labelRelation,
  relink: relinkRelation,
  remove: (source, ids) => removeClassParts(source, ids),
};
