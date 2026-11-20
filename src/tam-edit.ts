/**
 * Editing a TAM source as text. Every function returns the source with one change made and every
 * other line as it was, so comments, order and formatting survive, and a source edited on a canvas
 * stays the text its author wrote. The functions expect a source that parses; a change that breaks
 * a rule of the notation shows when the result is parsed.
 */

import { indentOf, linesOf, rootEnd } from "./source-text.ts";
import {
  COLORS,
  type Connection,
  ELEMENT,
  ELEMENT_KINDS,
  INTERFACE,
  isStorage,
  LABEL_PLACE,
  parseTam,
  PLACEMENT,
  type Placement,
  readConnections,
  type TamDiagram,
  type TamNode,
} from "./tam.ts";
import type { Direction } from "./elk.ts";
import { type Port, portText } from "./tam-ports.ts";

/** The kinds of elements a source declares. */
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** Words a source reads as statements, so no element is named by one. */
const RESERVED = new Set<string>([...ELEMENT_KINDS, "title", "direction", "level"]);

/** A line's statement and the comment after it. */
function cut(line: string): [string, string] {
  const at = line.indexOf("%%");
  return at < 0 ? [line, ""] : [line.slice(0, at), line.slice(at)];
}

const statementOf = (line: string) => cut(line)[0].trim();

/** A number as sources write it: whole where it can be, one decimal else. */
const number = (value: number) => String(Math.round(value * 10) / 10);

/** A declaration line taken apart; `write` puts it together again. */
interface Declaration {
  indent: string;
  kind: string;
  id: string;
  /** Undefined when the line gives none: the element then shows its id. */
  label?: string;
  color?: string;
  stack: boolean;
  multiple: boolean;
  at?: Placement;
  /** Where the copy of an element shown as several stands. */
  copyAt?: Placement;
  /** `{` opens a block, `{}` an empty one. */
  brace: "" | "{" | "{}";
  comment: string;
}

function read(line: string): Declaration | undefined {
  const [code, comment] = cut(line),
    match = code.trim().match(ELEMENT);
  if (!match) return undefined;
  const [, kind, id, bracketed, quoted, modifiers, brace] = match;
  const [placed, copy] = [...modifiers.matchAll(new RegExp(PLACEMENT, "g"))];
  const options = modifiers
    .replace(new RegExp(PLACEMENT, "g"), " ")
    .replace(/:::/g, " :::")
    .trim()
    .split(/\s+/);
  return {
    indent: indentOf(line),
    kind,
    id: id ?? "",
    label: bracketed ?? quoted,
    color: options.find((option) => option.startsWith(":::"))?.slice(3),
    stack: options.includes("stack"),
    multiple: options.includes("..."),
    ...(placed ? { at: placementOf(placed) } : {}),
    ...(copy ? { copyAt: { x: Number(copy[1]), y: Number(copy[2]) } } : {}),
    brace: braceOf(brace),
    comment,
  };
}

/** A placement as `PLACEMENT` matched it: `@x,y`, with `WxH` when it has a size. */
const placementOf = (placed: RegExpMatchArray): Placement => ({
  x: Number(placed[1]),
  y: Number(placed[2]),
  ...(placed[3] ? { width: Number(placed[3]), height: Number(placed[4]) } : {}),
});

/** The brace a declaration ends with, as a declaration holds it. */
const braceOf = (brace: string | undefined): Declaration["brace"] =>
  !brace ? "" : brace === "{" ? "{" : "{}";

/** A label as a declaration holds it: in brackets, or in quotes when it has a bracket itself. */
const labelText = (label: string) =>
  !label.includes("]")
    ? `[${label}]`
    : !label.includes('"')
      ? ` "${label}"`
      : `[${label.replace(/\]/g, ")")}]`;

function write(declaration: Declaration): string {
  return [
    `${declaration.indent}${declaration.kind}`,
    declaration.id && ` ${declaration.id}`,
    declaration.label !== undefined && labelText(declaration.label),
    declaration.color && `:::${declaration.color}`,
    declaration.stack && " stack",
    declaration.multiple && " ...",
    placesText(declaration),
    declaration.brace && ` ${declaration.brace}`,
    declaration.comment && ` ${declaration.comment}`,
  ]
    .filter(Boolean)
    .join("");
}

/** The placements of a declaration: its own, and its copy's after it, the second one. */
function placesText({ at, copyAt, multiple }: Declaration): string {
  if (!at) return "";
  const own = ` @${number(at.x)},${number(at.y)}${at.width === undefined ? "" : ` ${number(at.width)}x${number(at.height!)}`}`;
  return multiple && copyAt ? `${own} @${number(copyAt.x)},${number(copyAt.y)}` : own;
}

/** Text as a label holds it: line breaks as `<br>`, and nothing that would end the label or its line. */
const cleanLabel = (text: string) =>
  text
    .trim()
    .replace(/\s*\n\s*/g, "<br>")
    .replace(/%%+/g, "%");

/** Text as a connection holds it: no `@`, which starts the protocol, and no arrow. */
const cleanWire = (text: string) =>
  cleanLabel(text)
    .replace(/@/g, "")
    .replace(/-{2,}>?|\.->/g, "-")
    .trim();

/** A signed number, as the place of a label writes its offset: `+20`, `-14`, `+0`. */
const signed = (value: number) => `${value < 0 ? "-" : "+"}${number(Math.abs(value))}`;

/** The place of a connection's label as its statement ends with it: ` @+20,-14`, or nothing. */
const labelPlace = (at: Connection["labelAt"]) => (at ? ` @${signed(at.x)},${signed(at.y)}` : "");

/** A connection as a statement. */
function writeConnection(connection: Connection): string {
  return writeLink(connection) + labelPlace(connection.labelAt);
}

/** A connection's ends as its statement writes them: each id with the port it takes (tam-ports.ts). */
const endsOf = (connection: Connection) => [
  connection.from + portText(connection.fromPort),
  connection.to + portText(connection.toPort),
];

/** A connection as a statement, without the place of its label. */
function writeLink(connection: Connection): string {
  const { word } = connection,
    [from, to] = endsOf(connection),
    { label, protocol, at } = wireTexts(connection);
  if (word === "anchor") return `${from} -.- ${to}`;
  if (word === "dependency") return `${from} -. ${label ?? "use"} .-> ${to}`;
  if (word === "---")
    return label || protocol
      ? `${from} -- ${label ?? ""}${at} --- ${to}`.replace("--  @", "-- @")
      : `${from} --- ${to}`;
  return writeArrow(connection);
}

/** A connection's label and protocol as its statement holds them, and the protocol behind its `@`. */
function wireTexts(connection: Connection) {
  const label = connection.label && cleanWire(connection.label),
    protocol = connection.protocol && cleanWire(connection.protocol);
  return { label, protocol, at: protocol ? ` @${protocol}` : "" };
}

/** A connection with an arrowhead and a word: an access, a call, a request, a socket's line. */
function writeArrow(connection: Connection): string {
  const { word, both } = connection,
    [from, to] = endsOf(connection),
    { label, at } = wireTexts(connection);
  if (word === "requires") return `${from} -- requires${label ? ` ${label}` : ""}${at} --> ${to}`;
  return `${from} ${both ? "<--" : "--"} ${word}${label ? `: ${label}` : ""}${at} --> ${to}`;
}

/** The index of the line that closes the block a declaration opens; the declaration's own without a block. */
function blockEnd(lines: string[], start: number): number {
  if (read(lines[start])?.brace !== "{") return start;
  let depth = 1;
  for (let index = start + 1; index < lines.length; index++) {
    const statement = statementOf(lines[index]);
    if (statement === "}") depth--;
    else if (read(lines[index])?.brace === "{") depth++;
    if (!depth) return index;
  }
  return lines.length - 1;
}

/** The element a part of the picture stands for: a copy made for `...` is its original. */
const declared = (diagram: TamDiagram, id: string): TamNode | undefined => {
  const node = diagram.nodes.get(id);
  return node?.origin ? diagram.nodes.get(node.origin) : node;
};

/** Whether the id names a declared element, not a mark the layout adds. */
const isElement = (node: TamNode | undefined): node is TamNode =>
  !!node && (ELEMENT_KINDS as readonly string[]).includes(node.kind) && !node.id.endsWith("#row");

/** The elements declared inside an element, at any depth. */
function inside(diagram: TamDiagram, id: string): string[] {
  const node = diagram.nodes.get(id);
  return node ? node.children.flatMap((child) => [child, ...inside(diagram, child)]) : [];
}

/** Sets or clears where elements are placed, by id: `@x,y`, with `WxH` when the placement has a size. */
export function place(source: string, places: Map<string, Placement | undefined>): string {
  const diagram = parseTam(source),
    lines = linesOf(source);
  for (const [id, at] of places) {
    const node = declared(diagram, id),
      declaration = isElement(node) ? read(lines[node.line - 1]) : undefined;
    if (!declaration) continue;
    // The copy of an element shown as several (`id#2`) is placed in its original's declaration.
    lines[node!.line - 1] = write(
      id.endsWith("#2") && diagram.nodes.get(id)?.origin === node!.id
        ? { ...declaration, copyAt: at && { x: at.x, y: at.y } }
        : { ...declaration, at },
    );
  }
  return lines.join("\n");
}

/** Removes every placement, of elements and of labels: the diagram is laid out automatically again. */
export function unplace(source: string): string {
  return linesOf(source)
    .map((line) => {
      const declaration = read(line);
      if (declaration)
        return declaration.at || declaration.copyAt
          ? write({ ...declaration, at: undefined, copyAt: undefined })
          : line;
      return withLabelPlace(line, undefined);
    })
    .join("\n");
}

/**
 * A line of one connection with its label placed at `at`, or without a place: the statement keeps
 * its text, the place stands behind it, before a comment.
 */
function withLabelPlace(line: string, at: Connection["labelAt"]): string {
  const [code, comment] = cut(line),
    connections = quietly(() => readConnections(code.trim(), 0));
  if (connections?.length !== 1 || (!at && !connections[0].labelAt)) return line;
  const kept = code.replace(/\s+$/, "").replace(LABEL_PLACE, "");
  return `${kept}${labelPlace(at)}${comment ? ` ${comment}` : ""}`;
}

/**
 * Places the label of a connection: its middle at `at` from the middle of the line (see
 * label-places.ts), or where the layout puts it without `at`. A statement that holds several
 * connections is written out first, one a line, so that the place names one label.
 */
export function placeLabel(
  source: string,
  edge: string,
  at: { x: number; y: number } | undefined,
): string {
  const lines = linesOf(source),
    found = findConnection(parseTam(source), lines, edge);
  if (!found) return source;
  const offset = at && { x: Math.round(at.x), y: Math.round(at.y) };
  if (found.connections.length === 1) {
    lines[found.line] = withLabelPlace(lines[found.line], offset);
    return lines.join("\n");
  }
  rewrite(
    lines,
    found.line,
    found.connections.map((connection, index) =>
      index === found.index ? { ...connection, labelAt: offset } : connection,
    ),
  );
  return lines.join("\n");
}

/** An id no element has yet, from a name: `Order API` gives `order_api`, then `order_api2`. */
function freshId(taken: Set<string>, name: string): string {
  const base =
    name
      .replace(/<br\s*\/?>/gi, " ")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "_$1")
      .slice(0, 24) || "element";
  // A name that is a word of the notation counts from one: `agent1`; any other stands as it is first.
  let id = RESERVED.has(base) ? `${base}1` : base;
  for (let count = 2; taken.has(id) || RESERVED.has(id); count++) id = `${base}${count}`;
  taken.add(id);
  return id;
}

const idsOf = (diagram: TamDiagram) => new Set(diagram.nodes.keys());

/** Opens a block at a declaration that has none, and returns the index of its closing line. */
function openBlock(lines: string[], index: number): number {
  const declaration = read(lines[index])!;
  if (declaration.brace === "{") return blockEnd(lines, index);
  lines[index] = write({ ...declaration, brace: "{" });
  lines.splice(index + 1, 0, `${declaration.indent}}`);
  return index + 1;
}

/** The indent of the statements in the block a declaration opens. */
function innerIndent(lines: string[], start: number, end: number): string {
  return firstIndent(lines, start, end) ?? `${indentOf(lines[start])}  `;
}

/** The indent of the first statement in the block a declaration opens; none in an empty block. */
function firstIndent(lines: string[], start: number, end: number): string | undefined {
  const first = lines.slice(start + 1, end).find((line) => line.trim());
  return first && indentOf(first);
}

/** Where a new top-level element goes: after the last one, or after the header of a source without any. */
function afterElements(lines: string[]): number {
  let last = -1;
  for (let index = 0; index < lines.length; index++) {
    const statement = statementOf(lines[index]);
    if (read(lines[index])) last = index = blockEnd(lines, index);
    else if (statement === "..." || /^(title|direction|level)\s/.test(statement)) last = index;
  }
  return last + 1;
}

/** A new element: its kind and name, where it stands, and the element that holds it. */
export interface NewElement {
  kind: ElementKind;
  label?: string;
  at?: Placement;
  parent?: string | null;
  color?: string;
}

/** Adds an element, inside `parent` when given, and returns the id it got. */
export function addElement(source: string, element: NewElement): { source: string; id: string } {
  const diagram = parseTam(source),
    lines = linesOf(source);
  const label = element.label === undefined ? undefined : cleanLabel(element.label),
    id = freshId(idsOf(diagram), label || element.kind);
  const parent = element.parent ? declared(diagram, element.parent) : undefined;
  const declaration: Declaration = {
    indent: "",
    kind: element.kind,
    id,
    label,
    color: element.color,
    stack: false,
    multiple: false,
    at: element.at,
    brace: "",
    comment: "",
  };
  if (isElement(parent)) {
    const start = parent.line - 1,
      end = openBlock(lines, start);
    lines.splice(end, 0, write({ ...declaration, indent: innerIndent(lines, start, end) }));
  } else lines.splice(afterElements(lines), 0, write(declaration));
  return { source: lines.join("\n"), id };
}

/** What can change about an element; a `color` of null clears it. */
export interface ElementChange {
  kind?: ElementKind;
  label?: string;
  color?: string | null;
  stack?: boolean;
  multiple?: boolean;
}

/** Changes an element's kind, name, color or multiplicity. */
export function setElement(source: string, id: string, change: ElementChange): string {
  const diagram = parseTam(source),
    lines = linesOf(source),
    node = declared(diagram, id);
  const declaration = isElement(node) ? read(lines[node.line - 1]) : undefined;
  if (!declaration) return source;
  const next = changed(declaration, change);
  // A group needs no id, every other kind does.
  if (!next.id) next.id = freshId(idsOf(diagram), next.label || next.kind);
  lines[node!.line - 1] = write(next);
  return lines.join("\n");
}

/** A declaration with a change made. */
function changed(declaration: Declaration, change: ElementChange): Declaration {
  const next = { ...declaration };
  if (change.kind) next.kind = change.kind;
  if (change.label !== undefined) next.label = cleanLabel(change.label);
  if (change.color !== undefined)
    next.color = change.color && COLORS.has(change.color) ? change.color : undefined;
  return withMultiplicity(next, change);
}

/** A declaration stacked or shown as several as a change says: an element drawn as several is drawn one way, stacked or as copies with dots. */
function withMultiplicity(next: Declaration, change: ElementChange): Declaration {
  if (change.stack !== undefined) next.stack = change.stack;
  if (change.multiple !== undefined) next.multiple = change.multiple;
  if (change.stack) next.multiple = false;
  if (change.multiple) next.stack = false;
  return next;
}

/** The connection a wire of the picture draws, as its statement says it; a copy's wire is its original's. */
interface Found {
  line: number;
  /** All connections of the statement, and the one meant among them. */
  connections: Connection[];
  index: number;
}

function findConnection(diagram: TamDiagram, lines: string[], edge: string): Found | undefined {
  const id = edge.replace(/#\d+$/, ""),
    found = diagram.edges.find((item) => item.id === id);
  if (!found) return undefined;
  const connections = readConnections(statementOf(lines[found.line - 1]), found.line);
  if (!connections) return undefined;
  const sharing = diagram.edges.filter(
    (item) => item.line === found.line && !item.id.includes("#"),
  );
  return { line: found.line - 1, connections, index: sharing.indexOf(found) };
}

/** Replaces a statement by the connections it stands for, one a line; none removes the line. */
function rewrite(lines: string[], index: number, connections: Connection[]) {
  const [, comment] = cut(lines[index]),
    indent = indentOf(lines[index]);
  lines.splice(
    index,
    1,
    ...connections.map(
      (connection, row) =>
        `${indent}${writeConnection(connection)}${!row && comment ? ` ${comment}` : ""}`,
    ),
  );
}

/** The connection behind a wire: its ends, word, label and protocol; undefined for an interface's line. */
export function connectionOf(source: string, edge: string): Connection | undefined {
  const lines = linesOf(source),
    found = findConnection(parseTam(source), lines, edge);
  return found?.connections[found.index];
}

/**
 * The word that connects two elements when nothing else is said: an agent drawn to a storage writes
 * it and one drawn from a storage reads it, an agent calls another agent and delegates to what it
 * holds; storages point at each other and packages use each other; a note is attached to an
 * element, the note first. `from` and `to` swap where only the other element can act.
 */
export function defaultConnection(diagram: TamDiagram, from: string, to: string): Connection {
  const a = declared(diagram, from)!,
    b = declared(diagram, to)!;
  const [word, label, swap] = kindWord(a, b) ?? activeWord(diagram, a, b);
  return {
    from: swap ? b.id : a.id,
    to: swap ? a.id : b.id,
    word,
    both: false,
    ...(label ? { label } : {}),
  };
}

/** A default word with its label, and whether the ends swap. */
type DefaultWord = [Connection["word"], string | undefined, boolean];

/** The word a note or a package takes, or a storage at either end. */
function kindWord(a: TamNode, b: TamNode): DefaultWord | undefined {
  if (a.kind === "note" || b.kind === "note") return ["anchor", undefined, a.kind !== "note"];
  if (a.kind === "package" || b.kind === "package") return ["dependency", "use", false];
  if (isStorage(a) && isStorage(b)) return ["dependency", "pointer", false];
  // The drag says where the data goes: an agent drawn to a storage writes it, a storage drawn to an
  // agent is read by it. The access is written from the agent either way.
  if (isStorage(b)) return ["writes", undefined, false];
  if (isStorage(a)) return ["reads", undefined, true];
  return undefined;
}

/** The word between two agents: one delegates to the agent it holds, else calls the other. */
function activeWord(diagram: TamDiagram, a: TamNode, b: TamNode): DefaultWord {
  const holds = (outer: TamNode, part: TamNode) => inside(diagram, outer.id).includes(part.id);
  if (holds(a, b) || holds(b, a)) return ["delegates", undefined, holds(b, a)];
  return ["calls", undefined, false];
}

/** Whether a diagram is of the design level: it says so, or holds an element only that level has. */
const usesDesign = (diagram: TamDiagram) =>
  diagram.level === "design" ||
  [...diagram.nodes.values()].some((node) =>
    ["component", "subsystem", "class", "package", "interface"].includes(node.kind),
  );

/** What a connection is, as a sentence about it says it: "drawn as a write access". */
const CONNECTION_NAMES: Record<string, string> = {
  calls: "a request channel",
  "sends data": "a data flow channel",
  "---": "a channel",
  reads: "a read access",
  writes: "a write access",
  "reads/writes": "a modifying access",
  delegates: "a delegation",
  requires: "an assembly",
  anchor: "a note's line",
};

/** The best connection from one element to another, and why it is not the one asked for. */
export interface Fitted {
  from: string;
  to: string;
  change: Wording;
  /** Why the word asked for was not drawn, and what was drawn instead; none when it was. */
  replaced?: string;
}

/** A connection's word with its label and direction, without its ends. */
type Wording = Partial<Omit<Connection, "from" | "to">>;

/** Why the parser refuses a connection drawn between two elements; undefined where it takes it. */
function refusalOf(source: string, from: string, to: string, change: Wording) {
  try {
    parseTam(connect(source, from, to, change));
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message.replace(/^Line \d+: /, "") : String(error);
  }
}

/** A connection's name in a sentence: "a write access", "a «use» dependency". */
const nameOf = (change: Wording) =>
  change.word === "dependency"
    ? `a «${change.label}» dependency`
    : (CONNECTION_NAMES[change.word ?? ""] ?? "the connection that fits");

/** The connection two elements take (`defaultConnection`), where the parser takes it. */
function bestFit(source: string, from: string, to: string): Fitted | undefined {
  const diagram = parseTam(source),
    best = defaultConnection(diagram, from, to);
  // Delegation belongs to the design level: a plain block diagram does not take it.
  if (best.word === "delegates" && !usesDesign(diagram)) return undefined;
  const change = { word: best.word, both: best.both, ...(best.label ? { label: best.label } : {}) };
  if (refusalOf(source, best.from, best.to, change)) return undefined;
  return { from: best.from, to: best.to, change };
}

/**
 * The connection to draw from one element to another: the word asked for as drawn, or turned round
 * when it is written from the other end (an access is written from the agent), or else the one
 * that fits the two, with the reason the word asked for was left. Undefined when the two take no
 * connection at all.
 */
export function fitConnection(
  source: string,
  from: string,
  to: string,
  asked?: Wording,
): Fitted | undefined {
  if (!asked) return bestFit(source, from, to);
  const refused = refusalOf(source, from, to, asked);
  if (!refused) return { from, to, change: asked };
  if (!refusalOf(source, to, from, asked)) return { from: to, to: from, change: asked };
  const best = bestFit(source, from, to);
  return best && { ...best, replaced: `${refused} Drawn as ${nameOf(best.change)} instead.` };
}

/**
 * Connects two elements; without a word, with the one that fits them. A word given is written from
 * `from` to `to` as they are: an access from a storage is not turned round but refused when parsed.
 */
export function connect(source: string, from: string, to: string, change: Wording = {}): string {
  const diagram = parseTam(source),
    lines = linesOf(source),
    { fromPort, toPort, ...wording } = change;
  const connection: Connection = wording.word
    ? { from, to, word: wording.word, both: false, ...wording }
    : { ...defaultConnection(diagram, from, to), ...wording };
  // The ports go with their elements, where the fitting word turned the connection round.
  const turned = connection.from !== from;
  connection.fromPort = turned ? toPort : fromPort;
  connection.toPort = turned ? fromPort : toPort;
  // A note written without an id (`note [text]`) gets one, so a line can name it.
  for (const end of ["from", "to"] as const) {
    const node = declared(diagram, connection[end]),
      declaration = isElement(node) ? read(lines[node.line - 1]) : undefined;
    if (!declaration || declaration.id) continue;
    const id = freshId(idsOf(diagram), declaration.label || declaration.kind);
    lines[node!.line - 1] = write({ ...declaration, id });
    connection[end] = id;
  }
  lines.splice(rootEnd(lines), 0, writeConnection(connection));
  return lines.join("\n");
}

/** What can change about a connection; `reverse` swaps its ends. */
export interface ConnectionChange {
  word?: Connection["word"];
  both?: boolean;
  label?: string;
  protocol?: string;
  reverse?: boolean;
  /** Another element at an end. */
  from?: string;
  to?: string;
  /** The port an end takes (tam-ports.ts); null: the layout chooses. An end at another element leaves its port. */
  fromPort?: Port | null;
  toPort?: Port | null;
}

/** Changes one connection; a statement that holds several is written out as one line each. */
export function setConnection(source: string, edge: string, change: ConnectionChange): string {
  const lines = linesOf(source),
    found = findConnection(parseTam(source), lines, edge);
  if (!found) return source;
  const { reverse, fromPort, toPort, ...rest } = change,
    old = found.connections[found.index];
  const next: Connection = { ...old, ...rest };
  if (reverse)
    [next.from, next.to, next.fromPort, next.toPort] = [old.to, old.from, old.toPort, old.fromPort];
  if (next.from !== (reverse ? old.to : old.from)) next.fromPort = undefined;
  if (next.to !== (reverse ? old.from : old.to)) next.toPort = undefined;
  if (fromPort !== undefined) next.fromPort = fromPort ?? undefined;
  if (toPort !== undefined) next.toPort = toPort ?? undefined;
  if (next.word !== "calls" && next.word !== "sends data") next.both = false;
  fitWord(next, old, change.label !== undefined);
  rewrite(
    lines,
    found.line,
    found.connections.map((connection, index) => (index === found.index ? next : connection)),
  );
  return lines.join("\n");
}

/**
 * Fits what a connection carries to its word: an access carries no protocol, and a dependency only
 * its keyword, `use` unless a label is `given`.
 */
function fitWord(next: Connection, old: Connection, given: boolean) {
  if (next.word === "dependency") {
    next.protocol = undefined;
    if (old.word !== "dependency" && !given) next.label = "use";
  } else if (old.word === "dependency" && !given) next.label = undefined;
  if (["reads", "writes", "reads/writes", "delegates"].includes(next.word))
    next.protocol = undefined;
}

/** Gives an element an interface it provides or requires: a ball or a socket on a line. */
export function addInterface(
  source: string,
  id: string,
  offers: "provides" | "requires",
  name: string,
): string {
  const node = declared(parseTam(source), id),
    lines = linesOf(source),
    text = cleanLabel(name).replace(/<br>/g, " ");
  if (!isElement(node) || !text) return source;
  lines.splice(rootEnd(lines), 0, `${node.id} ${offers} ${text}`);
  return lines.join("\n");
}

/** Whether an id is one a new element got without a name of its own: its kind and a number. */
export const isGeneratedId = (id: string) =>
  new RegExp(`^(${ELEMENT_KINDS.join("|")}|element)\\d+$`).test(id);

/** The id a name gives, among the ids a source has: `Order API` gives `order_api`. */
export function idFor(source: string, name: string): string {
  return freshId(idsOf(parseTam(source)), name);
}

/**
 * Gives an element another id: in its declaration and in every connection and interface that
 * names it. A statement that names it with others (`a & b`, a chain) is written out, one
 * connection a line. The source stays as it is when the id is taken, reserved, or no id.
 */
export function renameId(source: string, id: string, next: string): string {
  const diagram = parseTam(source),
    node = declared(diagram, id),
    lines = linesOf(source);
  if (!isElement(node) || !canTake(diagram, node, next)) return source;
  const declaration = read(lines[node.line - 1]);
  if (!declaration) return source;
  // Bottom up, so the lines above keep their numbers.
  for (let index = lines.length - 1; index >= 0; index--) {
    if (index === node.line - 1)
      lines[index] = write({ ...declaration, id: next, label: declaration.label ?? node.id });
    else if (!read(lines[index])) renameIn(lines, index, node.id, next);
  }
  return lines.join("\n");
}

/** Whether an element may take an id: a word no other element has, not reserved, and not its own. */
const canTake = (diagram: TamDiagram, node: TamNode, next: string) =>
  /^[A-Za-z_]\w*$/.test(next) &&
  !RESERVED.has(next) &&
  !diagram.nodes.has(next) &&
  next !== node.id;

/** Renames an element in the interface or the connections a statement declares. */
function renameIn(lines: string[], index: number, id: string, next: string) {
  const statement = statementOf(lines[index]),
    offer = statement.match(INTERFACE);
  if (offer) {
    if (offer[1] === id)
      lines[index] = lines[index].replace(new RegExp(`^(\\s*)${id}\\b`), `$1${next}`);
    return;
  }
  const connections = quietly(() => readConnections(statement, 0));
  if (!connections?.some((item) => item.from === id || item.to === id)) return;
  // A statement that names only this element among its ends keeps its text.
  const kept = connections.length === 1 && renamedEnds(lines[index], connections[0], id, next);
  if (kept) {
    lines[index] = kept;
    return;
  }
  rewrite(
    lines,
    index,
    connections.map((item) => withEnds(item, (end) => (end === id ? next : end))),
  );
}

/** A line of one connection with the element renamed at its ends, the rest of its text as it was; undefined where its end is not found. */
function renamedEnds(line: string, connection: Connection, id: string, next: string) {
  const [left, ...rest] = line.split(/(?=\s(?:<--|--|-\.|---))/),
    tail = rest.join("");
  // Not a port's letter behind a colon (`a:R`), which names no element.
  const renamed = (text: string) =>
    text.replace(new RegExp(`(^|[^\\w:])${id}(?![\\w])`, "g"), `$1${next}`);
  const end = tail.match(/(-->|---|\.->|-\.-)\s*\w+(?:\s+@\s*[-+\d.]+\s*,\s*[-+\d.]+)?\s*(%%.*)?$/);
  if (!end || left === undefined) return undefined;
  const at = tail.lastIndexOf(end[0]) + end[1].length;
  return (
    (connection.from === id ? renamed(left) : left) +
    tail.slice(0, at) +
    (connection.to === id ? renamed(tail.slice(at)) : tail.slice(at))
  );
}

/** What a removal takes away: elements with their parts, whole lines, and connections out of their statements. */
interface Removal {
  gone: Set<string>;
  dropped: Set<number>;
  /** The connections that go, by the index of their statement's line and their index in it. */
  cut: Map<number, Set<number>>;
}

/** Removes elements, with what they hold and every connection at them, and connections, by id. */
export function remove(source: string, ids: Iterable<string>): string {
  const diagram = parseTam(source),
    lines = linesOf(source);
  const removal: Removal = { gone: new Set(), dropped: new Set(), cut: new Map() };
  for (const id of ids) noteRemoval(diagram, lines, removal, id);
  // Bottom up, so the lines above keep their numbers.
  for (let index = lines.length - 1; index >= 0; index--) removeAt(lines, index, removal);
  return tidy(lines).join("\n");
}

/** Notes what removing one element or connection takes away. */
function noteRemoval(diagram: TamDiagram, lines: string[], removal: Removal, id: string) {
  const node = declared(diagram, id);
  if (isElement(node)) {
    for (const part of [node.id, ...inside(diagram, node.id)]) removal.gone.add(part);
    for (let index = node.line - 1; index <= blockEnd(lines, node.line - 1); index++)
      removal.dropped.add(index);
    return;
  }
  const found = findConnection(diagram, lines, id),
    { cut } = removal;
  if (found) cut.set(found.line, (cut.get(found.line) ?? new Set()).add(found.index));
  else if (diagram.edges.some((edge) => edge.id === id.replace(/#\d+$/, "")))
    // An interface's line: the statement that declares it goes.
    removal.dropped.add(
      diagram.edges.find((edge) => edge.id === id.replace(/#\d+$/, ""))!.line - 1,
    );
}

/** Whether a statement declares an interface of an element that goes. */
function ownerGone(statement: string, declares: boolean, gone: Set<string>) {
  const owner = statement.match(INTERFACE)?.[1];
  return !!owner && !declares && gone.has(owner);
}

/** Removes a line, or the connections of its statement, that a removal takes away. */
function removeAt(lines: string[], index: number, { gone, dropped, cut }: Removal) {
  const statement = statementOf(lines[index]),
    declares = !!read(lines[index]);
  if (dropped.has(index) || ownerGone(statement, declares, gone)) {
    lines.splice(index, 1);
    return;
  }
  const connections = declares ? null : quietly(() => readConnections(statement, 0));
  if (!connections) return;
  const kept = connections.filter(
    (connection, at) =>
      !cut.get(index)?.has(at) && !gone.has(connection.from) && !gone.has(connection.to),
  );
  if (kept.length < connections.length) rewrite(lines, index, kept);
}

/** The result, or null where the statement is no connection at all. */
function quietly<T>(reading: () => T): T | null {
  try {
    return reading();
  } catch {
    return null;
  }
}

/** A block left without statements closes again: its element is a leaf. */
function tidy(lines: string[]): string[] {
  for (let index = lines.length - 2; index >= 0; index--) {
    const declaration = read(lines[index]);
    if (
      declaration?.brace === "{" &&
      statementOf(lines[index + 1]) === "}" &&
      !cut(lines[index + 1])[1]
    )
      lines.splice(index, 2, write({ ...declaration, brace: "" }));
  }
  return lines;
}

/** The elements among `ids` that no other of them holds: moving those moves the rest. */
function outermost(diagram: TamDiagram, ids: Iterable<string>): TamNode[] {
  const nodes = new Set(
    [...ids].map((id) => declared(diagram, id)).filter((node) => isElement(node)),
  ) as Set<TamNode>;
  const held = new Set([...nodes].flatMap((node) => inside(diagram, node.id)));
  return [...nodes].filter((node) => !held.has(node.id)).toSorted((a, b) => a.line - b.line);
}

/** The element that holds an element: rows of copies and of dots are no elements. */
export function holder(diagram: TamDiagram, id: string): string | null {
  let parent = declared(diagram, id)?.parent ?? null;
  while (parent?.endsWith("#row")) parent = diagram.nodes.get(parent)!.parent;
  return parent;
}

/** Moves elements into another element, or to the top level with `parent` null. */
export function moveInto(source: string, ids: Iterable<string>, parent: string | null): string {
  const diagram = parseTam(source),
    lines = linesOf(source);
  const target = parent ? declared(diagram, parent) : undefined;
  if (parent && !isElement(target)) return source;
  const moving = outermost(diagram, ids).filter((node) => movesInto(diagram, node, target));
  if (!moving.length) return source;
  // Taken out bottom up, so the lines above keep their numbers; put back in their order.
  const blocks: string[][] = [];
  let targetLine = target ? target.line - 1 : -1;
  for (const node of moving.toReversed()) {
    const start = node.line - 1,
      block = takeOut(lines, start);
    blocks.unshift(block);
    if (start < targetLine) targetLine -= block.length;
  }
  putBack(lines, blocks.flat(), target ? targetLine : undefined);
  return tidy(lines).join("\n");
}

/** Puts lines into the block of the declaration at `targetLine`, indented as its parts; at the top level without it. */
function putBack(lines: string[], moved: string[], targetLine: number | undefined) {
  const at = targetLine === undefined ? afterElements(lines) : openBlock(lines, targetLine),
    indent = targetLine === undefined ? "" : innerIndent(lines, targetLine, at);
  lines.splice(at, 0, ...moved.map((line) => (line.trim() ? indent + line : line)));
}

/** Whether an element moves into `target`: one that stands elsewhere and does not hold it. */
const movesInto = (diagram: TamDiagram, node: TamNode, target: TamNode | undefined) =>
  holder(diagram, node.id) !== (target?.id ?? null) &&
  node.id !== target?.id &&
  !(target && inside(diagram, node.id).includes(target.id));

/** Takes a declaration with its block out of the lines, its indent removed. */
function takeOut(lines: string[], start: number): string[] {
  const count = blockEnd(lines, start) - start + 1;
  return dedent(lines.splice(start, count));
}

/** Lines without the indent of the first of them. */
function dedent(lines: string[]): string[] {
  const base = indentOf(lines[0]).length;
  return lines.map((line) => line.slice(Math.min(base, indentOf(line).length)));
}

/**
 * Takes an element that holds others apart: its parts take its place, in the source and in the
 * element around it, and it goes with its connections. The source stays as it is for an element
 * that holds nothing.
 */
export function unwrap(source: string, id: string): string {
  const diagram = parseTam(source),
    node = declared(diagram, id);
  if (!isElement(node) || !node.children.length) return source;
  const lines = linesOf(withoutConnections(source, diagram, node.id));
  // The declaration may have moved up when connections above it went: find it again by its id.
  const start = lines.findIndex((line) => read(line)?.id === node.id),
    end = blockEnd(lines, start);
  if (start < 0 || end === start) return source;
  const outer = indentOf(lines[start]).length,
    shift = Math.max(0, (firstIndent(lines, start, end)?.length ?? outer) - outer);
  const parts = lines
    .slice(start + 1, end)
    .map((line) => (line.slice(0, shift).trim() ? line : line.slice(shift)));
  return [...lines.slice(0, start), ...parts, ...lines.slice(end + 1)].join("\n");
}

/** A source without the connections at an element. */
function withoutConnections(source: string, diagram: TamDiagram, id: string): string {
  const joins = diagram.edges
    .filter((edge) => edge.source === id || edge.target === id)
    .map((edge) => edge.id);
  return joins.length ? remove(source, joins) : source;
}

/**
 * Puts elements into a new element that holds them, where the first of them stood. Without a
 * position the new element fits its parts. Returns the id it got.
 */
export function wrap(
  source: string,
  ids: Iterable<string>,
  box: { kind: ElementKind; label?: string },
): { source: string; id: string } {
  const diagram = parseTam(source),
    nodes = outermost(diagram, ids);
  if (!nodes.length) return { source, id: "" };
  const added = addElement(source, { ...box, parent: holder(diagram, nodes[0].id) });
  return {
    source: moveInto(
      added.source,
      nodes.map((node) => node.id),
      added.id,
    ),
    id: added.id,
  };
}

/** Copies elements with what they hold, moved by `offset`, and returns the ids the copies got. */
export function duplicate(
  source: string,
  ids: Iterable<string>,
  offset: { x: number; y: number },
): { source: string; ids: string[] } {
  const diagram = parseTam(source),
    lines = linesOf(source),
    taken = idsOf(diagram),
    made: string[] = [];
  for (const node of outermost(diagram, ids).toReversed()) {
    const start = node.line - 1,
      end = blockEnd(lines, start);
    const copy = lines.slice(start, end + 1).map((line, row) => {
      const declaration = read(line);
      if (!declaration) return line;
      const id = declaration.id && freshId(taken, declaration.id.replace(/\d+$/, ""));
      if (!row) made.unshift(id);
      return write({
        ...declaration,
        id,
        // An element without a name shows its id: the copy shows the same.
        label: declaration.label ?? (declaration.id || undefined),
        at: declaration.at && shifted(declaration.at, offset),
        copyAt: declaration.copyAt && shifted(declaration.copyAt, offset),
      });
    });
    lines.splice(end + 1, 0, ...copy);
  }
  return { source: lines.join("\n"), ids: made.filter(Boolean) };
}

/**
 * Elements as a source of their own, to paste elsewhere: their declarations with what they hold,
 * and the connections and interfaces among them.
 */
export function copyOf(source: string, ids: Iterable<string>): string {
  const diagram = parseTam(source),
    lines = linesOf(source),
    nodes = outermost(diagram, ids),
    copied = new Set(nodes.flatMap((node) => [node.id, ...inside(diagram, node.id)]));
  return [
    ...nodes.flatMap((node) =>
      dedent(lines.slice(node.line - 1, blockEnd(lines, node.line - 1) + 1)),
    ),
    ...lines.flatMap((line) => statementsAmong(line, copied)),
  ].join("\n");
}

/** The interface or the connections a line declares among the `copied` elements. */
function statementsAmong(line: string, copied: Set<string>): string[] {
  const statement = statementOf(line);
  if (!statement || read(line)) return [];
  const owner = statement.match(INTERFACE)?.[1];
  if (owner) return copied.has(owner) ? [statement] : [];
  return (quietly(() => readConnections(statement, 0)) ?? [])
    .filter((connection) => copied.has(connection.from) && copied.has(connection.to))
    .map(writeConnection);
}

/**
 * Adds what `copyOf` gave to a source: the elements get ids of their own and stand at `at` (the
 * top left of them all), or keep their places without it; `placed` false drops the places, for a
 * source laid out automatically. Returns the ids of the top-level elements added.
 */
export function paste(
  source: string,
  fragment: string,
  options: { at?: { x: number; y: number }; placed?: boolean } = {},
): { source: string; ids: string[] } {
  const lines = linesOf(source);
  const pasting: Pasting = {
    taken: idsOf(parseTam(source)),
    renamed: new Map(),
    made: [],
    depth: 0,
    offset: undefined,
    declarations: [],
    statements: [],
  };
  // Parsed on its own first, placed or not: what is pasted is a diagram of its own.
  const offset = offsetTo(fragment, options.at);
  if (options.placed !== false) pasting.offset = offset;
  for (const line of linesOf(fragment)) pasteLine(pasting, line);
  lines.splice(afterElements(lines), 0, ...pasting.declarations);
  lines.splice(rootEnd(lines), 0, ...pasting.statements);
  return { source: lines.join("\n"), ids: pasting.made };
}

/** A fragment on its way into a source: the ids its elements get, and its lines as they go in. */
interface Pasting {
  /** The ids the source has, and those the pasted elements got. */
  taken: Set<string>;
  renamed: Map<string, string>;
  /** The top-level elements added. */
  made: string[];
  depth: number;
  /** How far the places of the elements move; none where they are dropped. */
  offset?: { x: number; y: number };
  declarations: string[];
  statements: string[];
}

/** How far the places of a fragment move for their top left to stand `at`. */
function offsetTo(fragment: string, at: { x: number; y: number } | undefined) {
  const places = [...parseTam(fragment).nodes.values()].flatMap((node) =>
    node.at ? [node.at] : [],
  );
  if (!at || !places.length) return { x: 0, y: 0 };
  return {
    x: at.x - Math.min(...places.map((p) => p.x)),
    y: at.y - Math.min(...places.map((p) => p.y)),
  };
}

/** Takes one line of a fragment in: a declaration, the end of a block, an interface or connections. */
function pasteLine(pasting: Pasting, line: string) {
  const statement = statementOf(line),
    declaration = read(line),
    offer = statement.match(INTERFACE);
  if (declaration) pasteDeclaration(pasting, declaration);
  else if (statement === "}" || statement === "...") {
    if (statement === "}") pasting.depth--;
    pasting.declarations.push(line);
  } else if (offer) {
    const [, owner, offers, name] = offer;
    pasting.statements.push(`${pasting.renamed.get(owner) ?? owner} ${offers} ${name}`);
  } else pasteConnections(pasting, statement);
}

/** Takes the connections of a statement in, between the elements as they are renamed. */
function pasteConnections(pasting: Pasting, statement: string) {
  for (const connection of quietly(() => readConnections(statement, 0)) ?? [])
    pasting.statements.push(
      writeConnection(withEnds(connection, (id) => pasting.renamed.get(id) ?? id)),
    );
}

/** Takes a declaration in with an id of its own, moved by the offset. */
function pasteDeclaration(pasting: Pasting, declaration: Declaration) {
  const id = declaration.id && freshId(pasting.taken, declaration.id.replace(/\d+$/, ""));
  if (declaration.id) pasting.renamed.set(declaration.id, id);
  if (!pasting.depth && id) pasting.made.push(id);
  if (declaration.brace === "{") pasting.depth++;
  pasting.declarations.push(
    write({
      ...declaration,
      id,
      label: declaration.label ?? (declaration.id || undefined),
      ...placesMoved(declaration, pasting.offset),
    }),
  );
}

/** The places of a declaration moved by an offset; none without one. */
const placesMoved = (
  { at, copyAt }: Declaration,
  offset: { x: number; y: number } | undefined,
) => ({
  at: offset && at && shifted(at, offset),
  copyAt: offset && copyAt && shifted(copyAt, offset),
});

/** A placement moved by an offset. */
const shifted = (at: Placement, by: { x: number; y: number }): Placement => ({
  ...at,
  x: at.x + by.x,
  y: at.y + by.y,
});

/** A connection with its ends renamed. */
const withEnds = (connection: Connection, rename: (id: string) => string): Connection => ({
  ...connection,
  from: rename(connection.from),
  to: rename(connection.to),
});

/** Sets the title, the direction or the level; an empty title or level removes its line. */
export function setHeader(
  source: string,
  header: { title?: string; direction?: Direction; level?: "conceptual" | "design" | "" },
): string {
  const lines = linesOf(source);
  // The header lines stand in this order at the top of a source.
  const order = ["title", "direction", "level"];
  const set = (keyword: string, value: string | undefined) => {
    if (value === undefined) return;
    const find = (word: string) =>
      lines.findIndex((line) => new RegExp(`^${word}\\s`).test(statementOf(line)));
    const index = find(keyword),
      text = value && `${keyword} ${value}`;
    if (index >= 0) {
      lines.splice(index, 1, ...(text ? [`${indentOf(lines[index])}${text}`] : []));
      return;
    }
    if (!text) return;
    // After the header lines that come before it.
    const before = order
      .slice(0, order.indexOf(keyword))
      .map(find)
      .filter((at) => at >= 0);
    lines.splice(before.length ? Math.max(...before) + 1 : 0, 0, text);
  };
  set(
    "title",
    header.title === undefined ? undefined : cleanLabel(header.title).replace(/<br>/g, " "),
  );
  set("direction", header.direction);
  set("level", header.level);
  return lines.join("\n");
}
