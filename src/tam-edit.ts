/**
 * Editing a TAM source as text. Every function returns the source with one change made and every
 * other line as it was, so comments, order and formatting survive, and a source edited on a canvas
 * stays the text its author wrote. The functions expect a source that parses; a change that breaks
 * a rule of the notation shows when the result is parsed.
 */

import {
  COLORS,
  type Connection,
  ELEMENT,
  ELEMENT_KINDS,
  INTERFACE,
  isActive,
  isStorage,
  parseTam,
  PLACEMENT,
  type Placement,
  readConnections,
  type TamDiagram,
  type TamNode,
} from "./tam.ts";
import type { Direction } from "./elk.ts";

/** The kinds of elements a source declares. */
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** Words a source reads as statements, so no element is named by one. */
const RESERVED = new Set<string>([...ELEMENT_KINDS, "title", "direction", "level"]);

const linesOf = (source: string) => source.replace(/\r\n?/g, "\n").split("\n");

/** A line's statement and the comment after it. */
function cut(line: string): [string, string] {
  const at = line.indexOf("%%");
  return at < 0 ? [line, ""] : [line.slice(0, at), line.slice(at)];
}

const statementOf = (line: string) => cut(line)[0].trim();

const indentOf = (line: string) => line.match(/^\s*/)![0];

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
  const at = placed && {
    x: Number(placed[1]),
    y: Number(placed[2]),
    ...(placed[3] ? { width: Number(placed[3]), height: Number(placed[4]) } : {}),
  };
  return {
    indent: indentOf(line),
    kind,
    id: id ?? "",
    label: bracketed ?? quoted,
    color: options.find((option) => option.startsWith(":::"))?.slice(3),
    stack: options.includes("stack"),
    multiple: options.includes("..."),
    ...(at ? { at } : {}),
    ...(copy ? { copyAt: { x: Number(copy[1]), y: Number(copy[2]) } } : {}),
    brace: !brace ? "" : brace === "{" ? "{" : "{}",
    comment,
  };
}

/** A label as a declaration holds it: in brackets, or in quotes when it has a bracket itself. */
const labelText = (label: string) =>
  !label.includes("]")
    ? `[${label}]`
    : !label.includes('"')
      ? ` "${label}"`
      : `[${label.replace(/\]/g, ")")}]`;

function write(declaration: Declaration): string {
  const { at } = declaration;
  return [
    `${declaration.indent}${declaration.kind}`,
    declaration.id && ` ${declaration.id}`,
    declaration.label !== undefined && labelText(declaration.label),
    declaration.color && `:::${declaration.color}`,
    declaration.stack && " stack",
    declaration.multiple && " ...",
    at &&
      ` @${number(at.x)},${number(at.y)}${at.width === undefined ? "" : ` ${number(at.width)}x${number(at.height!)}`}`,
    // A copy's position is the second one: it is written only after the element's own.
    at &&
      declaration.multiple &&
      declaration.copyAt &&
      ` @${number(declaration.copyAt.x)},${number(declaration.copyAt.y)}`,
    declaration.brace && ` ${declaration.brace}`,
    declaration.comment && ` ${declaration.comment}`,
  ]
    .filter(Boolean)
    .join("");
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

/** A connection as a statement. */
function writeConnection(connection: Connection): string {
  const { from, to, word, both } = connection,
    label = connection.label && cleanWire(connection.label),
    protocol = connection.protocol && cleanWire(connection.protocol),
    at = protocol ? ` @${protocol}` : "";
  if (word === "dependency") return `${from} -. ${label ?? "use"} .-> ${to}`;
  if (word === "---")
    return label || protocol
      ? `${from} -- ${label ?? ""}${at} --- ${to}`.replace("--  @", "-- @")
      : `${from} --- ${to}`;
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

/** Removes every placement: the diagram is laid out automatically again. */
export function unplace(source: string): string {
  return linesOf(source)
    .map((line) => {
      const declaration = read(line);
      return declaration?.at || declaration?.copyAt
        ? write({ ...declaration, at: undefined, copyAt: undefined })
        : line;
    })
    .join("\n");
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
  const first = lines.slice(start + 1, end).find((line) => line.trim());
  return first ? indentOf(first) : `${indentOf(lines[start])}  `;
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
  const next = { ...declaration };
  if (change.kind) next.kind = change.kind;
  if (change.label !== undefined) next.label = cleanLabel(change.label);
  if (change.color !== undefined)
    next.color = change.color && COLORS.has(change.color) ? change.color : undefined;
  if (change.stack !== undefined) next.stack = change.stack;
  if (change.multiple !== undefined) next.multiple = change.multiple;
  // An element drawn as several is drawn one way: stacked, or as copies with dots.
  if (change.stack) next.multiple = false;
  if (change.multiple) next.stack = false;
  // A group needs no id, every other kind does.
  if (!next.id) next.id = freshId(idsOf(diagram), next.label || next.kind);
  lines[node!.line - 1] = write(next);
  return lines.join("\n");
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
 * The word that connects two elements when nothing else is said: an agent reads and writes a
 * storage, calls another agent, and holds what it delegates to; storages point at each other and
 * packages use each other. `from` and `to` swap where only the other element can act.
 */
export function defaultConnection(diagram: TamDiagram, from: string, to: string): Connection {
  const a = declared(diagram, from)!,
    b = declared(diagram, to)!;
  const holds = (outer: TamNode, part: TamNode) => inside(diagram, outer.id).includes(part.id);
  const connection = (word: Connection["word"], label?: string, swap = false): Connection => ({
    from: swap ? b.id : a.id,
    to: swap ? a.id : b.id,
    word,
    both: false,
    ...(label ? { label } : {}),
  });
  if (a.kind === "package" || b.kind === "package") return connection("dependency", "use");
  if (isStorage(a) && isStorage(b)) return connection("dependency", "pointer");
  if (isStorage(a) || isStorage(b)) return connection("reads/writes", undefined, isStorage(a));
  if (holds(a, b) || holds(b, a)) return connection("delegates", undefined, holds(b, a));
  return connection("calls");
}

/**
 * Connects two elements; without a word, with the one that fits them. A word given is written from
 * `from` to `to` as they are: an access from a storage is not turned round but refused when parsed.
 */
export function connect(
  source: string,
  from: string,
  to: string,
  change: Partial<Omit<Connection, "from" | "to">> = {},
): string {
  const diagram = parseTam(source),
    lines = linesOf(source);
  const connection: Connection = change.word
    ? { from, to, word: change.word, both: false, ...change }
    : { ...defaultConnection(diagram, from, to), ...change };
  // After the last statement, before blank lines at the end of the source.
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, writeConnection(connection));
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
}

/** Changes one connection; a statement that holds several is written out as one line each. */
export function setConnection(source: string, edge: string, change: ConnectionChange): string {
  const lines = linesOf(source),
    found = findConnection(parseTam(source), lines, edge);
  if (!found) return source;
  const { reverse, ...rest } = change,
    old = found.connections[found.index];
  const next: Connection = { ...old, ...rest };
  if (reverse) [next.from, next.to] = [old.to, old.from];
  if (next.word !== "calls" && next.word !== "sends data") next.both = false;
  // An access carries no protocol, and a dependency only its keyword.
  if (next.word === "dependency") {
    next.protocol = undefined;
    if (old.word !== "dependency" && change.label === undefined) next.label = "use";
  } else if (old.word === "dependency" && change.label === undefined) next.label = undefined;
  if (["reads", "writes", "reads/writes", "delegates"].includes(next.word))
    next.protocol = undefined;
  rewrite(
    lines,
    found.line,
    found.connections.map((connection, index) => (index === found.index ? next : connection)),
  );
  return lines.join("\n");
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
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, `${node.id} ${offers} ${text}`);
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
  if (
    !isElement(node) ||
    !/^[A-Za-z_]\w*$/.test(next) ||
    RESERVED.has(next) ||
    diagram.nodes.has(next) ||
    next === node.id
  )
    return source;
  const declaration = read(lines[node.line - 1]);
  if (!declaration) return source;
  // Bottom up, so the lines above keep their numbers.
  for (let index = lines.length - 1; index >= 0; index--) {
    if (index === node.line - 1) {
      lines[index] = write({ ...declaration, id: next, label: declaration.label ?? node.id });
      continue;
    }
    const statement = statementOf(lines[index]);
    if (read(lines[index])) continue;
    const offer = statement.match(INTERFACE);
    if (offer) {
      if (offer[1] === node.id)
        lines[index] = lines[index].replace(new RegExp(`^(\\s*)${node.id}\\b`), `$1${next}`);
      continue;
    }
    const connections = quietly(() => readConnections(statement, 0));
    if (!connections?.some((item) => item.from === node.id || item.to === node.id)) continue;
    // A statement that names only this element among its ends keeps its text.
    const only = connections.length === 1;
    if (only) {
      const [left, ...rest] = lines[index].split(/(?=\s(?:<--|--|-\.|---))/),
        tail = rest.join("");
      const renamed = (text: string) =>
        text.replace(new RegExp(`(^|[^\\w])${node.id}(?![\\w])`, "g"), `$1${next}`);
      const [connection] = connections,
        end = tail.match(/(-->|---|\.->)\s*\w+\s*(%%.*)?$/);
      if (end && left !== undefined) {
        const at = tail.lastIndexOf(end[0]) + end[1].length;
        lines[index] =
          (connection.from === node.id ? renamed(left) : left) +
          tail.slice(0, at) +
          (connection.to === node.id ? renamed(tail.slice(at)) : tail.slice(at));
        continue;
      }
    }
    rewrite(
      lines,
      index,
      connections.map((item) => ({
        ...item,
        from: item.from === node.id ? next : item.from,
        to: item.to === node.id ? next : item.to,
      })),
    );
  }
  return lines.join("\n");
}

/** Removes elements, with what they hold and every connection at them, and connections, by id. */
export function remove(source: string, ids: Iterable<string>): string {
  const diagram = parseTam(source),
    lines = linesOf(source);
  const gone = new Set<string>(),
    dropped = new Set<number>(),
    cut = new Map<number, Set<number>>();
  for (const id of ids) {
    const node = declared(diagram, id);
    if (isElement(node)) {
      for (const part of [node.id, ...inside(diagram, node.id)]) gone.add(part);
      for (let index = node.line - 1; index <= blockEnd(lines, node.line - 1); index++)
        dropped.add(index);
      continue;
    }
    const found = findConnection(diagram, lines, id);
    if (found) cut.set(found.line, (cut.get(found.line) ?? new Set()).add(found.index));
    else if (diagram.edges.some((edge) => edge.id === id.replace(/#\d+$/, "")))
      // An interface's line: the statement that declares it goes.
      dropped.add(diagram.edges.find((edge) => edge.id === id.replace(/#\d+$/, ""))!.line - 1);
  }
  // Bottom up, so the lines above keep their numbers.
  for (let index = lines.length - 1; index >= 0; index--) {
    if (dropped.has(index)) {
      lines.splice(index, 1);
      continue;
    }
    const statement = statementOf(lines[index]),
      owner = statement.match(INTERFACE)?.[1];
    if (owner && !read(lines[index]) && gone.has(owner)) {
      lines.splice(index, 1);
      continue;
    }
    const connections = read(lines[index]) ? null : quietly(() => readConnections(statement, 0));
    if (!connections) continue;
    const kept = connections.filter(
      (connection, at) =>
        !cut.get(index)?.has(at) && !gone.has(connection.from) && !gone.has(connection.to),
    );
    if (kept.length < connections.length) rewrite(lines, index, kept);
  }
  return tidy(lines).join("\n");
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
  const moving = outermost(diagram, ids).filter(
    (node) =>
      holder(diagram, node.id) !== (target?.id ?? null) &&
      node.id !== target?.id &&
      !(target && inside(diagram, node.id).includes(target.id)),
  );
  if (!moving.length) return source;
  // Taken out bottom up, so the lines above keep their numbers; put back in their order.
  const blocks: string[][] = [];
  let targetLine = target ? target.line - 1 : -1;
  for (const node of moving.toReversed()) {
    const start = node.line - 1,
      count = blockEnd(lines, start) - start + 1,
      base = indentOf(lines[start]).length;
    blocks.unshift(
      lines.splice(start, count).map((line) => line.slice(Math.min(base, indentOf(line).length))),
    );
    if (start < targetLine) targetLine -= count;
  }
  let at: number,
    indent = "";
  if (target) {
    at = openBlock(lines, targetLine);
    indent = innerIndent(lines, targetLine, at);
  } else at = afterElements(lines);
  lines.splice(at, 0, ...blocks.flat().map((line) => (line.trim() ? indent + line : line)));
  return tidy(lines).join("\n");
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
        at: declaration.at && {
          ...declaration.at,
          x: declaration.at.x + offset.x,
          y: declaration.at.y + offset.y,
        },
        copyAt: declaration.copyAt && {
          x: declaration.copyAt.x + offset.x,
          y: declaration.copyAt.y + offset.y,
        },
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
  const out: string[] = [];
  for (const node of nodes) {
    const start = node.line - 1,
      base = indentOf(lines[start]).length;
    for (const line of lines.slice(start, blockEnd(lines, start) + 1))
      out.push(line.slice(Math.min(base, indentOf(line).length)));
  }
  for (const line of lines) {
    const statement = statementOf(line);
    if (!statement || read(line)) continue;
    const owner = statement.match(INTERFACE)?.[1];
    if (owner) {
      if (copied.has(owner)) out.push(statement);
      continue;
    }
    for (const connection of quietly(() => readConnections(statement, 0)) ?? [])
      if (copied.has(connection.from) && copied.has(connection.to))
        out.push(writeConnection(connection));
  }
  return out.join("\n");
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
  const diagram = parseTam(source),
    lines = linesOf(source),
    taken = idsOf(diagram),
    renamed = new Map<string, string>(),
    made: string[] = [];
  // Parsed on its own first: what is pasted is a diagram of its own.
  const pasted = parseTam(fragment),
    places = [...pasted.nodes.values()].flatMap((node) => (node.at ? [node.at] : []));
  const dx = options.at && places.length ? options.at.x - Math.min(...places.map((p) => p.x)) : 0,
    dy = options.at && places.length ? options.at.y - Math.min(...places.map((p) => p.y)) : 0;
  const declarations: string[] = [],
    statements: string[] = [];
  let depth = 0;
  for (const line of linesOf(fragment)) {
    const statement = statementOf(line),
      declaration = read(line);
    if (declaration) {
      const id = declaration.id && freshId(taken, declaration.id.replace(/\d+$/, ""));
      if (declaration.id) renamed.set(declaration.id, id);
      if (!depth && id) made.push(id);
      if (declaration.brace === "{") depth++;
      declarations.push(
        write({
          ...declaration,
          id,
          label: declaration.label ?? (declaration.id || undefined),
          at:
            options.placed === false || !declaration.at
              ? undefined
              : { ...declaration.at, x: declaration.at.x + dx, y: declaration.at.y + dy },
          copyAt:
            options.placed === false || !declaration.copyAt
              ? undefined
              : { x: declaration.copyAt.x + dx, y: declaration.copyAt.y + dy },
        }),
      );
    } else if (statement === "}" || statement === "...") {
      if (statement === "}") depth--;
      declarations.push(line);
    } else if (statement.match(INTERFACE)) {
      const [, owner, offers, name] = statement.match(INTERFACE)!;
      statements.push(`${renamed.get(owner) ?? owner} ${offers} ${name}`);
    } else
      for (const connection of quietly(() => readConnections(statement, 0)) ?? [])
        statements.push(
          writeConnection({
            ...connection,
            from: renamed.get(connection.from) ?? connection.from,
            to: renamed.get(connection.to) ?? connection.to,
          }),
        );
  }
  lines.splice(afterElements(lines), 0, ...declarations);
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, ...statements);
  return { source: lines.join("\n"), ids: made };
}

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
