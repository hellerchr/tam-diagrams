/**
 * Editing an entity relationship source as text: adding, naming, connecting and removing
 * entities, changing the attributes of an entity and the cardinalities of a relationship, the way
 * uml-class-edit.ts edits class diagrams. Each function returns the source with one change made;
 * a line that is not part of the change stays as it was. The layout stays automatic.
 *
 * Parts carry the ids of the scene: an entity the name the source calls it by, a relationship
 * `r1`, `r2` in the order of the source.
 *
 * The kind of a relationship says how many of each entity take part: one of the kinds in `links`
 * for the usual pairs (`one-to-many` is `||--o{`), and the two cardinalities with a colon between
 * (`one-or-more:zero-or-one`) for any other pair, which is read and not chosen. Whether the
 * relationship identifies is no part of its kind.
 */

import type { Structure, StructureEdge, StructureNode } from "./structure.ts";
import { accessibilityLines, labelText, scan } from "./uml.ts";
import {
  blockEnd,
  CARDINALITIES,
  type Cardinality,
  ER_ENTITY,
  ER_NAME,
  ER_STYLING,
  type ErDiagram,
  erId,
  type ErRelationship,
  parseErDiagram,
  relationshipParts,
  type RelationshipParts,
} from "./uml-er.ts";
import {
  blockLineText,
  canTakeId,
  counted,
  entityCoded,
  freshId,
  indentOf,
  linesOf,
  oneLine,
  renamedOnly,
  rootEnd,
  indentStep,
} from "./source-text.ts";

const PLAIN = /^[\p{L}_][\p{L}\p{N}_-]*$/u;

/** An entity statement in three parts: its name, its alias in brackets, and the rest. */
const ENTITY_PARTS = new RegExp(
  `^(${ER_NAME})(\\s*\\[\\s*(?:"[^"]*"|[^\\]"]*?)\\s*\\])?(.*)$`,
  "u",
);
/** A statement that styles entities by name: `style A fill:#eee`, `class A,B important`. */
const STYLED = new RegExp(`^(style|class)\\s+((?:${ER_NAME})(?:\\s*,\\s*(?:${ER_NAME}))*)`, "u");

/** Words the syntax reads for itself: an entity goes by one of them in quotes only. */
const SYNTAX_WORDS =
  /^(one|many|to|u|end|subgraph|direction|classDef|class|style|linkStyle|click|callback|link|title|accTitle|accDescr)$/;

/**
 * An entity's name as a statement writes it: in quotes when it is more than one plain word, or a
 * word of the syntax.
 */
const ref = (id: string) =>
  PLAIN.test(id) && !SYNTAX_WORDS.test(id) ? id : `"${id.replace(/"/g, "'")}"`;

/**
 * A relationship's label as the source writes it: one plain word as it is, anything else in
 * quotes. Mermaid asks for a label, so none is an empty one in quotes.
 */
const labelOf = (text: string) => {
  const label = entityCoded(text);
  return /^[\p{L}\p{N}_-]+$/u.test(label) ? label : `"${label}"`;
};

/** The lines from an opening statement to its closing brace, as indices; `close` is -1 while open. */
interface Block {
  open: number;
  close: number;
}

/** A line of attributes in an entity's block. */
interface Entry {
  index: number;
  text: string;
  /** Whether it shares its line with a brace of the block. */
  inline: boolean;
}

/** Where the source says something of an entity. */
interface EntityLines {
  id: string;
  declarations: { index: number; body: Block | null; aliased: boolean }[];
  entries: Entry[];
  /** Every line that names it so that it exists. */
  mentions: number[];
  /** Statements that only style it. */
  styles: number[];
}

/** An entity where a statement names it: the line, and the columns of the name as it is written. */
interface Place {
  id: string;
  index: number;
  start: number;
  end: number;
}

/** The lines of a source by what they declare, read the way the parser reads them. */
interface Outline {
  lines: string[];
  entities: Map<string, EntityLines>;
  /** Every place a statement names an entity, styling statements among them. */
  names: Place[];
  /** The lines of the relationships. */
  relationships: number[];
  /** The indentation of the statements. */
  indent: string;
}

/** The entity a statement names, made known to the outline where it is first named. */
function ensureEntity(outline: Outline, raw: string, index: number, offset: number): EntityLines {
  const id = erId(raw),
    start = indentOf(outline.lines[index]).length + offset;
  outline.names.push({ id, index, start, end: start + raw.length });
  let item = outline.entities.get(id);
  if (!item) {
    item = { id, declarations: [], entries: [], mentions: [], styles: [] };
    outline.entities.set(id, item);
  }
  item.mentions.push(index);
  return item;
}

/** An entity's block that is still open as the outline is read. */
interface OpenBody {
  item: EntityLines;
  block: Block;
}

/**
 * Reads a line of an open block as an attribute, or as its last when the brace closes it there;
 * returns the block while it stays open.
 */
function readBodyLine(body: OpenBody, text: string, index: number, inline = false) {
  const close = blockEnd(text),
    raw = close < 0 ? text : text.slice(0, close);
  if (raw.trim()) body.item.entries.push({ index, text: raw.trim(), inline: inline || close >= 0 });
  if (close < 0) return body;
  body.block.close = index;
  return null;
}

/** Reads a styling statement: each name of its list, where it stands in the statement. */
function readStyling(outline: Outline, text: string, index: number) {
  const match = text.match(STYLED);
  if (!match) return;
  let offset = match[1].length + text.slice(match[1].length).match(/^\s*/)![0].length;
  for (const piece of match[2].split(",")) {
    const raw = piece.trim(),
      start = indentOf(outline.lines[index]).length + offset + piece.indexOf(raw);
    outline.names.push({ id: erId(raw), index, start, end: start + raw.length });
    outline.entities.get(erId(raw))?.styles.push(index);
    offset += piece.length + 1;
  }
}

/** Reads an entity's declaration; returns its block when the block goes on below. */
function readEntity(outline: Outline, match: RegExpMatchArray, index: number): OpenBody | null {
  const item = ensureEntity(outline, match[1], index, 0),
    inner = match[6]?.slice(1),
    block = inner === undefined ? null : { open: index, close: -1 };
  item.declarations.push({ index, body: block, aliased: match[2] !== undefined });
  return block && readBodyLine({ item, block }, inner!, index, true);
}

/** Reads a statement outside every block; returns the block it opens, if any. */
function readStatement(outline: Outline, text: string, index: number): OpenBody | null {
  if (ER_STYLING.test(text)) {
    readStyling(outline, text, index);
    return null;
  }
  const match = text.match(ER_ENTITY);
  if (match) return readEntity(outline, match, index);
  const parts = relationshipParts(text);
  if (parts) {
    outline.relationships.push(index);
    ensureEntity(outline, parts.left.text, index, parts.left.start);
    ensureEntity(outline, parts.right.text, index, parts.right.start);
  }
  return null;
}

/** Reads where each entity is declared and named; the source is one the parser accepts. */
function outlineOf(source: string): Outline {
  const lines = linesOf(source),
    statements = scan(source).lines.slice(1);
  const outline: Outline = {
    lines,
    entities: new Map(),
    names: [],
    relationships: [],
    indent: statements.length ? indentOf(lines[statements[0].line - 1]) : "  ",
  };
  let body: OpenBody | null = null;
  const accessibility = accessibilityLines();
  for (const { text, line } of statements) {
    if (body) body = readBodyLine(body, text, line - 1);
    else if (!accessibility(text) && !/^direction\s/i.test(text))
      body = readStatement(outline, text, line - 1);
  }
  return outline;
}

/** A source as its diagram, or nothing when the parser does not read it. */
function reads(source: string): ErDiagram | undefined {
  try {
    return parseErDiagram(source);
  } catch {
    return undefined;
  }
}

/** The source with a statement of its own for an entity that relationships only mention. */
function declare(source: string, id: string): string {
  const outline = outlineOf(source),
    item = outline.entities.get(id),
    { lines } = outline;
  if (!item || item.declarations.length) return source;
  // After the line that first names it, so the entities keep their order.
  const first = item.mentions[0];
  lines.splice(first + 1, 0, indentOf(lines[first]) + ref(id));
  return lines.join("\n");
}

/** Whether a block shares a line with an attribute: its brace opens or closes beside one. */
const sharesLine = (lines: string[], { open, close }: Block) =>
  lines[close].trim() !== "}" || !/\{\s*$/.test(lines[open]) || close === open;

/** The lines of a block whose last attribute shares its line with the closing brace, the brace on its own line. */
function closeOnOwnLine(lines: string[], { open, close }: Block) {
  const last = lines[close].trim();
  lines.splice(
    close,
    1,
    indentOf(lines[close]) + last.slice(0, blockEnd(last)).trimEnd(),
    `${indentOf(lines[open])}}`,
  );
}

/** The lines of a block whose first attribute shares its line with the opening brace, the attribute on its own line. */
function openOnOwnLine(lines: string[], { open, close }: Block) {
  const indent = indentOf(lines[open]),
    line = lines[open].trimEnd(),
    braces = line.trim().match(ER_ENTITY)![6],
    head = line.slice(0, line.length - braces.length + 1),
    inner = braces.slice(1),
    end = close === open ? blockEnd(inner) : -1,
    first = (end < 0 ? inner : inner.slice(0, end)).trim();
  lines.splice(
    open,
    1,
    head,
    ...(first ? [indent + indentStep(lines) + first] : []),
    ...(close === open ? [`${indent}}`] : []),
  );
}

/**
 * The source with the entity declared and each of its blocks open over lines of its own:
 * `ORDER {`, one line an attribute, `}`. An entity without a block gets one.
 */
function withBody(source: string, id: string): string {
  let text = declare(source, id);
  for (;;) {
    const { lines, entities } = outlineOf(text),
      item = entities.get(id);
    if (!item) return source;
    if (!item.declarations.some((found) => found.body)) {
      const { index } = item.declarations[0],
        line = lines[index];
      lines.splice(index, 1, `${line.trimEnd()} {`, `${indentOf(line)}}`);
      return lines.join("\n");
    }
    // The first block that shares a line with an attribute, from its end.
    const shared = item.declarations.find(({ body }) => body && sharesLine(lines, body))?.body;
    if (!shared) return lines.join("\n");
    if (shared.close > shared.open && lines[shared.close].trim() !== "}")
      closeOnOwnLine(lines, shared);
    else openOnOwnLine(lines, shared);
    text = lines.join("\n");
  }
}

/** The block of an entity whose blocks `withBody` has opened, and the indentation of its lines. */
function bodyOf(outline: Outline, id: string) {
  const item = outline.entities.get(id)!,
    block = item.declarations.find((found) => found.body)!.body!,
    inside = item.entries.findLast(
      (found) => found.index > block.open && found.index < block.close,
    );
  return {
    item,
    block,
    indent: inside
      ? indentOf(outline.lines[inside.index])
      : indentOf(outline.lines[block.open]) + indentStep(outline.lines),
  };
}

/** The source with the blocks of an entity that hold no line closed: `ORDER` instead of `ORDER {` and `}`. */
function withoutEmptyBody(source: string, id: string): string {
  const { lines, entities } = outlineOf(source),
    gone = new Set<number>();
  for (const { body } of entities.get(id)?.declarations ?? []) {
    if (!body || body.close !== body.open + 1 || lines[body.close].trim() !== "}") continue;
    lines[body.open] = lines[body.open].replace(/\s*\{\s*$/, "");
    gone.add(body.close);
  }
  return gone.size ? lines.filter((_, index) => !gone.has(index)).join("\n") : source;
}

/**
 * The attributes of an entity as its source writes them, one a line: a type, a name, then keys
 * and a comment in quotes (`int id PK "generated"`).
 */
export function erAttributes(source: string, id: string): string[] {
  return (outlineOf(source).entities.get(id)?.entries ?? []).map((entry) => entry.text);
}

/**
 * Adds an attribute as a line of an entity's block; an entity without a block gets one, and an
 * entity that relationships only mention gets its own statement.
 */
export function addErAttribute(source: string, id: string, text: string): string {
  const attribute = blockLineText(text);
  if (!attribute || !parseErDiagram(source).entities.has(id)) return source;
  const outline = outlineOf(withBody(source, id)),
    { block, indent } = bodyOf(outline, id);
  outline.lines.splice(block.close, 0, indent + attribute);
  return outline.lines.join("\n");
}

/**
 * Gives an entity other attributes: its attribute lines go and the new ones stand in its block.
 * Comments in the block stay; an entity left without attributes loses an empty block.
 */
export function setErAttributes(source: string, id: string, attributes: string[]): string {
  const texts = attributes.map(blockLineText).filter(Boolean),
    old = erAttributes(source, id);
  if (!parseErDiagram(source).entities.has(id)) return source;
  if (texts.length === old.length && texts.every((text, index) => text === old[index]))
    return source;
  const outline = outlineOf(withBody(source, id)),
    { item, block, indent } = bodyOf(outline, id),
    gone = new Set(item.entries.map((entry) => entry.index));
  const result = outline.lines
    .flatMap((line, index) => [
      ...(index === block.close ? texts.map((text) => indent + text) : []),
      ...(gone.has(index) ? [] : [line]),
    ])
    .join("\n");
  return texts.length ? result : withoutEmptyBody(result, id);
}

/** The attribute line of an entity at a place in `erAttributes`, in a source where it stands on a line of its own. */
function attributeAt(source: string, id: string, index: number) {
  let outline = outlineOf(source),
    entry = outline.entities.get(id)?.entries[index];
  if (entry?.inline) {
    outline = outlineOf(withBody(source, id));
    entry = outline.entities.get(id)?.entries[index];
  }
  return entry && !entry.inline ? { outline, entry } : undefined;
}

/**
 * Gives one attribute of an entity another text, by its place in `erAttributes`. An empty text
 * removes the attribute; a text the syntax does not read leaves the source as it is.
 */
export function setErAttribute(source: string, id: string, index: number, text: string): string {
  const attribute = blockLineText(text);
  if (!attribute) return removeErAttribute(source, id, index);
  const found = attributeAt(source, id, index);
  if (!found || found.entry.text === attribute) return source;
  const { lines } = found.outline;
  lines[found.entry.index] = indentOf(lines[found.entry.index]) + attribute;
  const result = lines.join("\n");
  return reads(result) ? result : source;
}

/** Removes one attribute of an entity, by its place in `erAttributes`; the last one takes the block with it. */
export function removeErAttribute(source: string, id: string, index: number): string {
  const found = attributeAt(source, id, index);
  if (!found) return source;
  found.outline.lines.splice(found.entry.index, 1);
  const result = withoutEmptyBody(found.outline.lines.join("\n"), id);
  return reads(result) ? result : source;
}

/** The usual relationships: what each is called and the cardinality at its first and second end. */
const KINDS: { kind: string; name: string; ends: [Cardinality, Cardinality] }[] = [
  { kind: "one-to-many", name: "One to many", ends: ["only-one", "zero-or-more"] },
  { kind: "many-to-one", name: "Many to one", ends: ["zero-or-more", "only-one"] },
  { kind: "one-to-one", name: "One to one", ends: ["only-one", "only-one"] },
  { kind: "many-to-many", name: "Many to many", ends: ["zero-or-more", "zero-or-more"] },
  {
    kind: "zero-or-one-to-many",
    name: "Zero or one to many",
    ends: ["zero-or-one", "zero-or-more"],
  },
  { kind: "one-to-one-or-more", name: "One to one or more", ends: ["only-one", "one-or-more"] },
  { kind: "one-to-zero-or-one", name: "One to zero or one", ends: ["only-one", "zero-or-one"] },
];

/** The kind of join a relationship is, by the cardinalities of its ends. */
const kindOfRelationship = (relationship: ErRelationship): string =>
  KINDS.find(
    ({ ends }) =>
      ends[0] === relationship.sourceCardinality && ends[1] === relationship.targetCardinality,
  )?.kind ?? `${relationship.sourceCardinality}:${relationship.targetCardinality}`;

/** Whether a cardinality is written as a symbol (`||`, `o{`) and not in words. */
const isSymbol = (text: string) => /^[|o{}]{2}$/.test(text);

/** A cardinality as the end of a relationship writes it: as a symbol, or in words where `old` is. */
const cardinalityText = (kind: Cardinality, side: "left" | "right", old: string) =>
  isSymbol(old) ? CARDINALITIES[kind][side] : CARDINALITIES[kind].words[0];

/** A change of the pieces of a relationship's line. */
interface RelationshipChange {
  left?: Cardinality;
  right?: Cardinality;
  identifying?: boolean;
  label?: string;
  /** Whether the ends change places, each with its cardinality. */
  reverse?: boolean;
}

/** The pieces of a relationship's line that a change writes anew, by their names in `RelationshipParts`. */
type PieceTexts = Record<keyof Omit<RelationshipParts, "label">, string>;

/** The line of a relationship that identifies or not, in the style of the old one: a symbol or words. */
const lineText = (old: string, identifying: boolean) =>
  /^[-.]+$/.test(old) ? (identifying ? "--" : "..") : identifying ? "to" : "optionally to";

/** The pieces of a line whose ends change places; a symbol faces its entity, words read the same at either end. */
function reversed(texts: PieceTexts, parts: RelationshipParts): PieceTexts {
  const turned = (text: string, kind: Cardinality, side: "left" | "right") =>
    isSymbol(text) ? CARDINALITIES[kind][side] : text;
  return {
    left: texts.right,
    right: texts.left,
    line: texts.line,
    leftCardinality: turned(texts.rightCardinality, parts.rightCardinality.kind, "left"),
    rightCardinality: turned(texts.leftCardinality, parts.leftCardinality.kind, "right"),
  };
}

/** The pieces of a relationship's line once a change is made, the line and label aside. */
function changedTexts(parts: RelationshipParts, change: RelationshipChange): PieceTexts {
  const texts: PieceTexts = {
    left: parts.left.text,
    leftCardinality: parts.leftCardinality.text,
    line: parts.line.text,
    rightCardinality: parts.rightCardinality.text,
    right: parts.right.text,
  };
  if (change.left)
    texts.leftCardinality = cardinalityText(change.left, "left", texts.leftCardinality);
  if (change.right)
    texts.rightCardinality = cardinalityText(change.right, "right", texts.rightCardinality);
  if (change.identifying !== undefined && change.identifying !== parts.line.identifying)
    texts.line = lineText(texts.line, change.identifying);
  return change.reverse ? reversed(texts, parts) : texts;
}

/**
 * A relationship's line with other pieces; what is not changed stays as it is written. The
 * cardinalities and the line keep their style: symbols stay symbols, words stay words.
 */
function relationshipLine(line: string, change: RelationshipChange): string {
  const text = line.trim(),
    parts = relationshipParts(text);
  if (!parts) return line;
  const texts = changedTexts(parts, change);
  // From the right, so the pieces before keep their columns.
  let result = text;
  if (change.label !== undefined) {
    const end = parts.right.start + parts.right.text.length;
    result = parts.label
      ? result.slice(0, parts.label.start) + change.label
      : `${result.slice(0, end)} : ${change.label}`;
  }
  for (const key of ["right", "rightCardinality", "line", "leftCardinality", "left"] as const) {
    const span = parts[key];
    result = result.slice(0, span.start) + texts[key] + result.slice(span.start + span.text.length);
  }
  return indentOf(line) + result;
}

/** A name as an id of one plain word: `Order Item` is `Order-Item`; empty when it has no letter. */
function wordOf(label: string): string {
  const word = label
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter(Boolean)
    .join("-")
    .replace(/^[\p{N}-]+/u, "");
  return PLAIN.test(word) ? word : "";
}

/** The name new entities get with a number: in capitals where the entities of the source are. */
const baseOf = (diagram: ErDiagram) =>
  diagram.entities.size && [...diagram.entities.keys()].every((id) => id === id.toUpperCase())
    ? "ENTITY"
    : "Entity";

/**
 * Adds an entity after the last entity the source declares, and else at the end. It takes its id
 * from its name (`Order Item` is `Order-Item`, shown under its name); without a name the id is
 * `Entity` with a number that no entity of the diagram has. Returns its id, empty for a piece
 * that is no entity.
 */
function addErPiece(
  source: string,
  piece: { kind: string; label?: string; parent?: string | null },
): { source: string; id: string } {
  if (piece.kind !== "entity") return { source, id: "" };
  const diagram = parseErDiagram(source),
    outline = outlineOf(source),
    { lines } = outline,
    label = oneLine(piece.label ?? ""),
    id = freshId((name) => diagram.entities.has(name), baseOf(diagram), wordOf(label)),
    ends = [...outline.entities.values()].flatMap((item) =>
      item.declarations.map(({ index, body }) => (body ? body.close : index)),
    );
  lines.splice(
    ends.length ? Math.max(...ends) + 1 : rootEnd(lines),
    0,
    `${outline.indent}${ref(id)}${label && label !== id ? `["${entityCoded(label, " ")}"]` : ""}`,
  );
  return { source: lines.join("\n"), id };
}

/** Where a relationship is added: after the last one, with its indent, and else at the end. */
function relationshipEnd({ relationships, lines, indent }: Outline) {
  if (!relationships.length) return { at: rootEnd(lines), indent };
  const at = Math.max(...relationships) + 1;
  return { at, indent: indentOf(lines[at - 1]) };
}

/**
 * Joins two entities with a relationship of a kind, one to many when none is given, and says
 * which one it wrote. The relationship identifies, carries an empty label (Mermaid asks for
 * one), and follows the last relationship of the source; both ends may be the same entity. No edge, with the source
 * unchanged, when the two are not joined.
 */
export function joinEntities(
  source: string,
  from: string,
  to: string,
  kind?: string,
): { source: string; edge: string } {
  const diagram = parseErDiagram(source),
    outline = outlineOf(source),
    { lines } = outline,
    found = KINDS.find((item) => item.kind === (kind ?? KINDS[0].kind));
  if (!found || !diagram.entities.has(from) || !diagram.entities.has(to))
    return { source, edge: "" };
  const [left, right] = found.ends,
    { at, indent } = relationshipEnd(outline);
  lines.splice(
    at,
    0,
    `${indent}${ref(from)} ${CARDINALITIES[left].left}--${CARDINALITIES[right].right} ${ref(to)} : ""`,
  );
  const result = lines.join("\n"),
    edge = reads(result)?.relationships.find((item) => item.line === at + 1)?.id;
  return edge ? { source: result, edge } : { source, edge: "" };
}

/** Joins two entities as `joinEntities` does. */
function connectEntities(source: string, from: string, to: string, kind?: string): string {
  return joinEntities(source, from, to, kind).source;
}

/**
 * Gives an entity another name. It keeps its id, which relationships name it by, and shows the
 * name as its alias (`ORDER["Purchase order"]`); a name that is the id itself takes the alias
 * away.
 */
function renameEntity(source: string, id: string, label: string): string {
  if (!parseErDiagram(source).entities.has(id)) return source;
  const outline = outlineOf(declare(source, id)),
    { lines } = outline,
    declarations = outline.entities.get(id)!.declarations,
    declaration = declarations.findLast((found) => found.aliased) ?? declarations[0],
    name = entityCoded(label, " "),
    line = lines[declaration.index],
    [, head, , rest] = line.trim().match(ENTITY_PARTS)!;
  lines[declaration.index] =
    indentOf(line) + (name && name !== id ? `${head}["${name}"]${rest}` : head + rest);
  return lines.join("\n");
}

/** Whether an entity can go by a new id: one with no quote or line break that no entity has. */
const canTakeEntityId = (diagram: ErDiagram, id: string, name: string) =>
  canTakeId((item) => diagram.entities.has(item), id, name, !/["\n]/.test(name));

/** How many entities and relationships a diagram has. */
const countsOf = (diagram: ErDiagram) => [diagram.entities.size, diagram.relationships.length];

/**
 * Gives an entity another id, wherever the source names it: in its declarations, relationships
 * and styling lines; an alias that says what the new id says goes. A name that is more than one
 * plain word, or is a word of the syntax, is written in quotes. The source comes back unchanged
 * when the new id is empty, holds a quote, or is taken by another entity.
 */
export function renameEntityId(source: string, id: string, newId: string): string {
  const diagram = parseErDiagram(source),
    name = newId.trim().replace(/^"(.*)"$/, "$1");
  if (!canTakeEntityId(diagram, id, name)) return source;
  const outline = outlineOf(source),
    { lines } = outline,
    written = ref(name);
  // From the right, so the places before keep their columns.
  const places = outline.names
    .filter((place) => place.id === id)
    .toSorted((a, b) => b.index - a.index || b.start - a.start);
  for (const { index, start, end } of places)
    lines[index] = lines[index].slice(0, start) + written + lines[index].slice(end);
  const result = lines.join("\n"),
    now = reads(result);
  if (
    !now ||
    !renamedOnly((item) => now.entities.has(item), id, name, countsOf(diagram), countsOf(now))
  )
    return source;
  const aliased = outlineOf(result)
    .entities.get(name)!
    .declarations.some((declaration) => declaration.aliased);
  return aliased && now.entities.get(name)!.label === name
    ? renameEntity(result, name, name)
    : result;
}

/** The ids a new entity gets when it has no name yet. */
const GENERATED = /^(?:ENTITY|Entity)\d+$/;

/**
 * Whether an entity goes by an id that an edit made up and its first name may replace: `Entity1`
 * as a new one gets it, and the id of a copy (`ORDER2` beside `ORDER`) while the copy still shows
 * the name of its original or its own id.
 */
export function isGeneratedErId(source: string, id: string): boolean {
  const diagram = parseErDiagram(source),
    item = diagram.entities.get(id);
  if (!item) return false;
  if (GENERATED.test(id)) return true;
  return [...diagram.entities.values()].some((original) => {
    const base = wordOf(original.id),
      number = id.startsWith(base) ? id.slice(base.length) : "x";
    return (
      original !== item &&
      !!base &&
      /^\d+$/.test(number) &&
      Number(number) > 1 &&
      (item.label === id || item.label === original.label)
    );
  });
}

/**
 * Gives an entity that was just added its first name: the id follows the name (`Invoice` makes
 * `Invoice`, `Order Item` makes `Order-Item["Order Item"]`) wherever the source names it, unless
 * another entity has that id; then the id stays and the name is its alias. Returns the id the
 * entity has afterwards.
 */
function retitleEntity(source: string, id: string, name: string): { source: string; id: string } {
  const diagram = parseErDiagram(source),
    word = wordOf(name);
  let next = id;
  if (word && word !== id && diagram.entities.has(id) && !diagram.entities.has(word)) {
    const renamed = renameEntityId(source, id, word);
    if (reads(renamed)?.entities.has(word)) [source, next] = [renamed, word];
  }
  return { source: renameEntity(source, next, name), id: next };
}

/** The source with one relationship's line changed. */
function changeRelationship(
  source: string,
  edge: string,
  change: (relationship: ErRelationship) => RelationshipChange | undefined,
): string {
  const relationship = parseErDiagram(source).relationships.find((item) => item.id === edge),
    lines = linesOf(source),
    made = relationship && change(relationship);
  if (!relationship || !made) return source;
  lines[relationship.line - 1] = relationshipLine(lines[relationship.line - 1], made);
  const result = lines.join("\n");
  return reads(result) ? result : source;
}

/** Gives a relationship another label; an empty one is written as `""`, which shows none. */
function labelErRelationship(source: string, edge: string, label: string): string {
  return changeRelationship(source, edge, (relationship) =>
    labelText(`"${entityCoded(label)}"`) === (relationship.label ?? "")
      ? undefined
      : { label: labelOf(label) },
  );
}

/**
 * Makes a relationship one of another kind, between the same ends: both cardinalities become
 * those of the kind. Whether it identifies, and its label, stay.
 */
function relinkErRelationship(source: string, edge: string, kind: string): string {
  const found = KINDS.find((item) => item.kind === kind);
  return changeRelationship(source, edge, (relationship) =>
    !found || kind === kindOfRelationship(relationship)
      ? undefined
      : { left: found.ends[0], right: found.ends[1] },
  );
}

/**
 * Turns a relationship round: its ends change places, each with its cardinality, so
 * `A ||--o{ B` reads `B }o--|| A`. Its line and label stay.
 */
export function reverseErRelationship(source: string, edge: string): string {
  return changeRelationship(source, edge, () => ({ reverse: true }));
}

/**
 * The ends of a relationship: the ids of the entities it joins, in the order it is written, the
 * cardinality at each, and whether it identifies. Undefined for what is no relationship.
 */
export function erRelationshipEnds(
  source: string,
  edge: string,
):
  | {
      from: string;
      to: string;
      fromCardinality: Cardinality;
      toCardinality: Cardinality;
      identifying: boolean;
    }
  | undefined {
  const relationship = parseErDiagram(source).relationships.find((item) => item.id === edge);
  return (
    relationship && {
      from: relationship.source,
      to: relationship.target,
      fromCardinality: relationship.sourceCardinality,
      toCardinality: relationship.targetCardinality,
      identifying: relationship.identifying,
    }
  );
}

/** Gives one end of a relationship another cardinality; the other end and the line stay. */
export function setErCardinality(
  source: string,
  edge: string,
  end: "from" | "to",
  cardinality: Cardinality,
): string {
  if (!CARDINALITIES[cardinality]) return source;
  return changeRelationship(source, edge, (relationship) =>
    (end === "from" ? relationship.sourceCardinality : relationship.targetCardinality) ===
    cardinality
      ? undefined
      : end === "from"
        ? { left: cardinality }
        : { right: cardinality },
  );
}

/** Makes a relationship identifying (a solid line, `--`) or not (a dashed one, `..`). */
export function setErIdentifying(source: string, edge: string, identifying: boolean): string {
  return changeRelationship(source, edge, (relationship) =>
    relationship.identifying === identifying ? undefined : { identifying },
  );
}

/**
 * Adds a copy of an entity: its alias and attributes under an id of its own (`ORDER2`), declared
 * after the entity, with none of its relationships. Returns the id of the copy, empty for what
 * is no entity.
 */
export function duplicateEntity(source: string, id: string): { source: string; id: string } {
  const diagram = parseErDiagram(source),
    item = diagram.entities.get(id);
  if (!item) return { source, id: "" };
  const copy = freshId((name) => diagram.entities.has(name), baseOf(diagram), wordOf(id)),
    outline = outlineOf(declare(source, id)),
    { lines } = outline,
    declaration = outline.entities.get(id)!.declarations.at(-1)!,
    indent = indentOf(lines[declaration.index]),
    head = `${ref(copy)}${item.label === id ? "" : `["${entityCoded(item.label, " ")}"]`}`,
    attributes = erAttributes(source, id),
    text = attributes.length
      ? [`${head} {`, ...attributes.map((line) => indentStep(lines) + line), "}"]
      : [head];
  lines.splice(
    (declaration.body?.close ?? declaration.index) + 1,
    0,
    ...text.map((line) => indent + line),
  );
  return { source: lines.join("\n"), id: copy };
}

/** The entities among some ids, and the lines of the relationships among them, as indices. */
function chosenParts(diagram: ErDiagram, ids: Iterable<string>) {
  const gone = new Set<string>(),
    dropped = new Set<number>();
  for (const id of ids) {
    const line = diagram.relationships.find((item) => item.id === id)?.line;
    if (diagram.entities.has(id)) gone.add(id);
    else if (line) dropped.add(line - 1);
  }
  return { gone, dropped };
}

/** The names each styling line lists, by the index of its line. */
function styledNames({ names, lines }: Outline): Map<number, string[]> {
  const styled = new Map<number, string[]>();
  for (const place of names)
    if (ER_STYLING.test(lines[place.index].trim()))
      styled.set(place.index, [...(styled.get(place.index) ?? []), place.id]);
  return styled;
}

/**
 * Adds to the dropped lines those of an entity that goes: its declarations with their blocks, the
 * relationships that name it, and the styling lines whose every entity goes.
 */
function dropEntity(
  item: EntityLines,
  gone: Set<string>,
  styled: Map<number, string[]>,
  dropped: Set<number>,
) {
  for (const { index, body } of item.declarations)
    for (let at = index; at <= (body ? body.close : index); at++) dropped.add(at);
  for (const index of item.mentions) dropped.add(index);
  for (const index of item.styles)
    if (styled.get(index)!.every((name) => gone.has(name))) dropped.add(index);
}

/** The statements that keep an entity which only dropped lines name, by the line each follows. */
function keptEntities(outline: Outline, gone: Set<string>, dropped: Set<number>) {
  const kept = new Map<number, string[]>();
  for (const item of outline.entities.values()) {
    if (gone.has(item.id) || item.mentions.some((index) => !dropped.has(index))) continue;
    const first = item.mentions[0];
    kept.set(first, [...(kept.get(first) ?? []), indentOf(outline.lines[first]) + ref(item.id)]);
  }
  return kept;
}

/**
 * Removes entities with their relationships and styling, and single relationships, by id. An
 * entity that only a removed relationship names stays, as a statement of its own in its place.
 */
export function removeErParts(source: string, ids: Iterable<string>): string {
  const outline = outlineOf(source),
    { gone, dropped } = chosenParts(parseErDiagram(source), ids),
    styled = styledNames(outline);
  for (const id of gone) {
    const item = outline.entities.get(id);
    if (item) dropEntity(item, gone, styled, dropped);
  }
  // What stays loses no entity: one that only the removed lines name is declared where it stood.
  const kept = keptEntities(outline, gone, dropped);
  if (!dropped.size) return source;
  return outline.lines
    .flatMap((line, index) => [...(dropped.has(index) ? [] : [line]), ...(kept.get(index) ?? [])])
    .join("\n");
}

/**
 * Why two parts are not joined, in words for the user; undefined when `connectEntities` joins
 * them.
 */
export function whyNotEr(
  source: string,
  from: string,
  to: string,
  kind?: string,
): string | undefined {
  const diagram = parseErDiagram(source);
  if (!diagram.entities.has(from) || !diagram.entities.has(to))
    return "A relationship joins two entities.";
  return kind === undefined || KINDS.some((item) => item.kind === kind)
    ? undefined
    : "There is no relationship of that kind.";
}

/**
 * Adds an entity at a part and says what it wrote: the id of the entity, and the id of the
 * relationship between the two when there is one. With a `link`, at an entity, the new entity is
 * the second end of a relationship of that kind from it; else it stands alone.
 */
export function attachEr(
  source: string,
  piece: { kind: string; label?: string },
  at: string,
  link?: string,
): { source: string; id: string; edge: string } {
  const added = addErPiece(source, piece);
  if (!added.id) return { source, id: "", edge: "" };
  if (link === undefined || !parseErDiagram(source).entities.has(at)) return { ...added, edge: "" };
  const joined = joinEntities(added.source, at, added.id, link);
  return { source: joined.source, id: added.id, edge: joined.edge };
}

/**
 * What a removal takes with it, in words: the entities it names and how many relationships go
 * with them, as in `CUSTOMER, ORDER with 3 relationships`; for relationships alone, how many go.
 * Empty when the removal changes nothing.
 */
export function erRemovalSummary(source: string, ids: Iterable<string>): string {
  const chosen = new Set(ids),
    before = parseErDiagram(source),
    after = parseErDiagram(removeErParts(source, chosen)),
    names = [...before.entities.values()]
      .filter((item) => chosen.has(item.id))
      .map((item) => item.label.replace(/<br\s*\/?>/gi, " ")),
    lost = before.relationships.length - after.relationships.length,
    // With entities named, the relationships chosen beside them are not counted again.
    rest = counted(
      names.length ? lost - before.relationships.filter(({ id }) => chosen.has(id)).length : lost,
      "relationship",
    ).join("");
  return names.length ? `${names.join(", ")}${rest ? ` with ${rest}` : ""}` : rest;
}

/** The parts and joins of an entity relationship diagram, under the ids of its scene. */
function readEr(source: string): { nodes: StructureNode[]; edges: StructureEdge[] } {
  const diagram = parseErDiagram(source);
  return {
    nodes: [...diagram.entities.values()].map((item) => ({
      id: item.id,
      label: item.label,
      parent: null,
      line: item.line,
      group: false,
      kind: "entity",
    })),
    edges: diagram.relationships.map((relationship) => ({
      id: relationship.id,
      source: relationship.source,
      target: relationship.target,
      label: relationship.label,
      line: relationship.line,
      kind: kindOfRelationship(relationship),
    })),
  };
}

/**
 * Entity relationship diagrams as a structure a canvas edits. An entity added at another stands
 * beside it without a relationship; the kinds of join are the usual pairs of cardinalities, each
 * written as an identifying relationship.
 */
export const erStructure: Structure = {
  pieces: [
    {
      kind: "entity",
      name: "Entity",
      about: "Entity type with its attributes and keys",
      named: true,
    },
  ],
  links: KINDS.map(({ kind, name }) => ({ kind, name })),
  read: readEr,
  add: addErPiece,
  connect: connectEntities,
  join: joinEntities,
  rename: renameEntity,
  retitle: retitleEntity,
  label: labelErRelationship,
  relink: relinkErRelationship,
  remove: (source, ids) => removeErParts(source, ids),
  reverse: reverseErRelationship,
  copy: duplicateEntity,
  reid: renameEntityId,
};
