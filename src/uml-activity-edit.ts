/**
 * Editing a flowchart or swimlane source as text: adding, naming, connecting, moving, grouping and
 * removing nodes, the way tam-edit.ts edits block diagrams. Each function returns the source with one change made.
 * The source is read as statements with the places of their nodes and arrows, so an edit changes
 * the one node or arrow it is about and leaves the rest of its line, and every other line, as it
 * was. A node stays when a statement that mentions it goes: it is then written on a line of its
 * own. The layout stays automatic.
 */

import type { Structure, StructureNode } from "./structure.ts";
import { type FlowEdge, type Flowchart, parseFlowchart } from "./uml-activity.ts";
import { accessibilityLines, escapeLabel, labelText as shownText, scan, STYLING } from "./uml.ts";
import { dedent, indentOf, linesOf, numberedId, originalsOf } from "./uml-edit-text.ts";
import { removePlaces } from "./uml-places.ts";

/** What a canvas adds to an activity diagram. */
type FlowPiece = "step" | "decision" | "start" | "end" | "group" | "lane";

/** The delimiters a node's shape is written with, longest opening first, as the parser reads them. */
const DELIMITERS: [string, string[]][] = [
  ["(((", [")))"]],
  ["((", ["))"]],
  ["([", ["])"]],
  ["[[", ["]]"]],
  ["[(", [")]"]],
  ["[/", ["/]", "\\]"]],
  ["[\\", ["\\]", "/]"]],
  ["{{", ["}}"]],
  ["(", [")"]],
  ["[", ["]"]],
  ["{", ["}"]],
  [">", ["]"]],
];

/** The id of a node, as the parser reads it. */
const ID = /[\p{L}\p{N}_!#$%&'*+.`?\\/]+(?:-(?![->.])[\p{L}\p{N}_!#$%&'*+.`?\\/]*)*/uy;
/** The name an edge can carry before its arrow: `e1@-->`. */
const NAMED = /^[\w-]+@(?=[-=.~<ox])/;
/** An arrow with its text between two strokes: `-- text -->`, `== text ==>`, `-. text .->`. */
const INLINE =
  /^([<ox]?)(--|==|-\.)(?![->.=])\s*([^-=.>|][^]*?)\s*(-{2,}[->ox]?|={2,}[=>ox]?|\.+-[>ox]?)(?=\s|$|[\p{L}\p{N}_"])/u;
/** An arrow without text of its own: `-->`, `---`, `-.->`, `==>`, `--o`, `<-->`. */
const PLAIN = /^([<ox]?)(-{2,}|={2,}|-\.+-)([->ox=]?)(?=\s|$|\||[\p{L}\p{N}_"])/u;
const INVISIBLE = /^~{3,}/;
/** The text of an arrow between pipes, after the arrow. */
const PIPE = /^\s*\|([^|]*)\|/;
/** The `%% level …` comment, which says something of the whole diagram. */
const LEVEL = /^%%\s*level\s*:?\s*(conceptual|design)\s*$/i;
/** Words a node cannot have as its id. */
const RESERVED = new Set([
  "end",
  "subgraph",
  "graph",
  "flowchart",
  "direction",
  "style",
  "linkStyle",
  "classDef",
  "class",
  "click",
  "default",
  "call",
  "href",
]);
/** The ids `addFlowPiece` gives: the kind of piece and a number. */
const GENERATED = /^(step|decision|start|end|group|lane)\d+$/;

/** A node as a statement mentions it: `id`, `id[Label]`, `id@{ shape: fork }`, `id:::class`. */
interface Ref {
  id: string;
  start: number;
  idEnd: number;
  end: number;
  /** As it is written, with its shape. */
  text: string;
  /** The shape it is written with: where its label lies between the delimiters, and where the shape ends. */
  shape?: { open: string; start: number; end: number; after: number };
  /** The `@{ }` form: where its braces lie, and the value of its `label` entry when it has one. */
  braces?: { start: number; end: number; label?: { start: number; end: number } };
}

/** An arrow between two groups of nodes, with its text. */
interface Arrow {
  start: number;
  end: number;
  text: string;
}

/** A statement of the source: a chain of nodes and arrows, the opening or end of a subgraph, styling. */
interface Statement {
  index: number;
  /** The line it stands on, from 0, and where it lies in that line. */
  line: number;
  start: number;
  end: number;
  text: string;
  kind: "chain" | "subgraph" | "end" | "direction" | "styling" | "other";
  /** The subgraph it stands in. */
  scope: string | null;
  /** A chain: the groups of nodes (`a & b`), the arrows between them, and the edges of each arrow. */
  groups: Ref[][];
  arrows: Arrow[];
  edges: FlowEdge[][];
  /** A subgraph: its id, how it is written, and the index of the statement that ends it. */
  id?: string;
  form?: "bracket" | "quoted" | "plain" | "bare";
  close?: number;
}

/** A source as its statements, each with the places of what it says. */
interface Model {
  chart: Flowchart;
  lines: string[];
  statements: Statement[];
  byLine: Map<number, Statement[]>;
  /** The line of the header, from 0. */
  header: number;
}

/** The place past the white space at a place in a text. */
const blank = (text: string, at: number) => {
  while (at < text.length && /\s/.test(text[at])) at++;
  return at;
};

/** Reads a node at a place of a statement, the way the parser does; null when none stands there. */
function readRef(text: string, from: number): Ref | null {
  const start = blank(text, from);
  ID.lastIndex = start;
  const match = ID.exec(text);
  if (!match) return null;
  const id = match[0],
    idEnd = start + id.length,
    ref: Ref = { id, start, idEnd, end: idEnd, text: id },
    opener = DELIMITERS.find(([open]) => text.startsWith(open, idEnd));
  if (opener) {
    const shape = readShape(text, idEnd, opener);
    if (!shape) return null;
    ref.shape = shape;
    ref.end = shape.after;
  }
  ref.braces = readBraces(text, ref.end);
  if (ref.braces) ref.end = ref.braces.end;
  ref.end += text.slice(ref.end).match(/^:::[\w-]+/)?.[0].length ?? 0;
  ref.text = text.slice(start, ref.end);
  return ref;
}

/** Reads the shape a node is written with after its id: where its label lies, and where it ends. */
function readShape(text: string, idEnd: number, [open, closes]: [string, string[]]) {
  const inner = idEnd + open.length,
    body = blank(text, inner),
    close = text[body] === '"' ? quotedClose(text, body, closes) : firstClose(text, inner, closes);
  if (!close) return null;
  return { open, start: inner, end: close.at, after: close.at + close.text.length };
}

/** The closing delimiter after a label in quotes. */
function quotedClose(text: string, body: number, closes: string[]) {
  const quote = text.indexOf('"', body + 1);
  if (quote < 0) return undefined;
  const after = blank(text, quote + 1),
    found = closes.find((item) => text.startsWith(item, after));
  return found ? { at: after, text: found } : undefined;
}

/** The earliest closing delimiter, which ends a label without quotes. */
function firstClose(text: string, inner: number, closes: string[]) {
  let close: { at: number; text: string } | undefined;
  for (const item of closes) {
    const at = text.indexOf(item, inner);
    if (at >= 0 && (!close || at < close.at)) close = { at, text: item };
  }
  return close;
}

/** Reads the `@{ }` form at a place: where its braces lie, and the value of its `label` entry. */
function readBraces(text: string, from: number): Ref["braces"] {
  const braces = text.slice(from).match(/^@\{([^}]*)\}/);
  if (!braces) return undefined;
  const found: NonNullable<Ref["braces"]> = { start: from, end: from + braces[0].length };
  for (const entry of braces[1].matchAll(/(\w+)\s*:\s*("(?:[^"]*)"|[^,]+)/g))
    if (entry[1] === "label") {
      const value = entry[2].trimEnd(),
        valueAt = from + 2 + entry.index + entry[0].length - entry[2].length;
      found.label = { start: valueAt, end: valueAt + value.length };
    }
  return found;
}

/** Reads an arrow with its text at a place of a statement, the way the parser does. */
function readArrow(text: string, from: number): Arrow | null {
  const start = blank(text, from),
    named = text.slice(start).match(NAMED)?.[0] ?? "",
    rest = text.slice(start + named.length);
  const inline = rest.match(INLINE);
  let length: number;
  if (inline) length = inline[0].length;
  else {
    const plain = rest.match(INVISIBLE) ?? rest.match(PLAIN);
    if (!plain) return null;
    length = plain[0].length + (rest.slice(plain[0].length).match(PIPE)?.[0].length ?? 0);
  }
  const end = start + named.length + length;
  return { start, end, text: text.slice(start, end) };
}

/** Reads a chain of node groups joined by arrows: `a & b --> c -->|x| d`. */
function readChain(text: string): { groups: Ref[][]; arrows: Arrow[] } | null {
  let at = 0;
  const group = () => {
    const refs: Ref[] = [];
    for (;;) {
      const ref = readRef(text, at);
      if (!ref) break;
      refs.push(ref);
      at = blank(text, ref.end);
      if (text[at] !== "&") break;
      at++;
    }
    return refs;
  };
  const groups = [group()],
    arrows: Arrow[] = [];
  if (!groups[0].length) return null;
  for (;;) {
    at = blank(text, at);
    if (at >= text.length) break;
    const arrow = readArrow(text, at);
    if (!arrow) return null;
    at = arrow.end;
    const to = group();
    if (!to.length) return null;
    arrows.push(arrow);
    groups.push(to);
  }
  return { groups, arrows };
}

/** Where the statements of a line lie, split at `;` outside quotes and brackets. */
function split(text: string, from: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = from;
  for (const at of separators(text, from)) {
    takePiece(out, text, start, at);
    start = at + 1;
  }
  takePiece(out, text, start, text.length);
  return out;
}

/** Notes where the statement between two places lies, without the blanks around it, when it says something. */
function takePiece(
  out: { start: number; end: number }[],
  text: string,
  start: number,
  end: number,
) {
  const piece = text.slice(start, end),
    lead = piece.length - piece.trimStart().length;
  if (piece.trim()) out.push({ start: start + lead, end: start + lead + piece.trim().length });
}

/** Where a `;` separates statements in a line: outside quotes and brackets. */
function separators(text: string, from: number): number[] {
  const found: number[] = [];
  let depth = 0,
    quote = false;
  for (let at = from; at < text.length; at++) {
    const c = text[at];
    if (c === '"') quote = !quote;
    else if (quote) continue;
    else if ("[({".includes(c)) depth++;
    else if ("])}".includes(c)) depth = Math.max(0, depth - 1);
    else if (!depth && c === ";") found.push(at);
  }
  return found;
}

/**
 * Reads a source as statements with the places of their nodes and arrows, each arrow with the edges
 * the parser made of it. Null when the statements cannot be matched with what the parser read.
 */
function readModel(source: string): Model | null {
  const chart = parseFlowchart(source),
    lines = linesOf(source),
    rows = scan(source).lines,
    header = rows[0].line - 1,
    reading: Reading = {
      chart,
      statements: [],
      byLine: new Map(),
      stack: [],
      anonymous: 0,
      edge: 0,
    },
    accessibility = accessibilityLines();
  for (const place of placesOf(lines, rows, header)) {
    const statement = addStatement(reading, place, lines[place.line].slice(place.start, place.end));
    if (!accessibility(statement.text) && !readKind(reading, statement)) return null;
  }
  if (reading.edge !== chart.edges.length || reading.stack.length) return null;
  return { chart, lines, statements: reading.statements, byLine: reading.byLine, header };
}

/** A model as it is read: the subgraphs open around a statement, and the edges matched so far. */
interface Reading {
  chart: Flowchart;
  statements: Statement[];
  byLine: Map<number, Statement[]>;
  stack: Statement[];
  /** The subgraphs without an id so far. */
  anonymous: number;
  /** The edges of the chart matched so far. */
  edge: number;
}

/** Where the statements of a source lie: those after the header on its line, then those of the lines below. */
function placesOf(lines: string[], rows: { line: number }[], header: number) {
  const head =
    lines[header].match(/^\s*(?:flowchart(?:-elk)?|graph|swimlane-beta)\s*[^\s;]*/)?.[0].length ??
    lines[header].length;
  return [
    ...split(lines[header], head).map((place) => ({ ...place, line: header })),
    ...rows
      .slice(1)
      .flatMap(({ line }) =>
        split(lines[line - 1], 0).map((place) => ({ ...place, line: line - 1 })),
      ),
  ];
}

/** Notes a statement at a place, in the subgraph open there, yet of no kind. */
function addStatement(
  reading: Reading,
  place: { line: number; start: number; end: number },
  text: string,
): Statement {
  const statement: Statement = {
    ...place,
    index: reading.statements.length,
    text,
    kind: "other",
    scope: reading.stack.at(-1)?.id ?? null,
    groups: [],
    arrows: [],
    edges: [],
  };
  reading.statements.push(statement);
  reading.byLine.set(place.line, [...(reading.byLine.get(place.line) ?? []), statement]);
  return statement;
}

/** Reads what kind of statement a statement is, and what it says; false where it cannot be matched with the chart. */
function readKind(reading: Reading, statement: Statement): boolean {
  const { text } = statement,
    subgraph = text.match(/^subgraph(?:\s+(.*))?$/);
  if (/^direction\s+(TB|TD|BT|LR|RL)$/i.test(text)) statement.kind = "direction";
  else if (text === "end") {
    statement.kind = "end";
    const opened = reading.stack.pop();
    if (!opened) return false;
    opened.close = statement.index;
  } else if (subgraph) openSubgraph(reading, statement, (subgraph[1] ?? "").trim());
  else if (STYLING.test(text)) statement.kind = "styling";
  else return readChainStatement(reading, statement);
  return true;
}

/** Reads a statement that opens a subgraph: how it is written, and its id. */
function openSubgraph(reading: Reading, statement: Statement, spec: string) {
  const bracket = spec.match(/^(\S+?)\s*\[(.*)\]$/);
  statement.kind = "subgraph";
  statement.form = subgraphForm(spec, !!bracket);
  if (bracket) statement.id = bracket[1];
  else statement.id = statement.form === "plain" ? spec : `subgraph#${++reading.anonymous}`;
  reading.stack.push(statement);
}

/** How a subgraph is written: with an id and a name in brackets, a name in quotes, an id, or nothing. */
function subgraphForm(spec: string, bracket: boolean): Statement["form"] {
  if (bracket) return "bracket";
  if (/^".*"$/.test(spec)) return "quoted";
  return spec ? "plain" : "bare";
}

/** Reads a chain with the edges the parser made of each arrow; false where they do not match. */
function readChainStatement(reading: Reading, statement: Statement): boolean {
  const chain = readChain(statement.text);
  if (!chain) return false;
  statement.kind = "chain";
  statement.groups = chain.groups;
  statement.arrows = chain.arrows;
  for (let index = 0; index < chain.arrows.length; index++) {
    const own: FlowEdge[] = [];
    for (const from of chain.groups[index])
      for (const to of chain.groups[index + 1]) {
        const found = reading.chart.edges[reading.edge++];
        if (!found || found.source !== from.id || found.target !== to.id) return false;
        own.push(found);
      }
    statement.edges.push(own);
  }
  return true;
}

/** In quotes, unless a text is plain words: quotes keep every mark of the syntax a text. */
const quoted = (text: string) =>
  /^[\p{L}\p{N} .,:!?'\-_/]*$/u.test(text.replace(/<br>/g, "")) && !text.startsWith("/")
    ? text
    : `"${text}"`;

/** A label as a node or a subgraph holds it between its delimiters. */
const labelText = (label: string) => quoted(escapeLabel(label));

/** A label as an arrow holds it between pipes, with the pipes. */
const pipeText = (label: string) => `|${quoted(escapeLabel(label).replace(/\|/g, "#124;"))}|`;

/** An arrow of a stroke between two end marks (`<`, `>`, `o`, `x` or none); without a head it runs one stroke longer. */
const operator = (start: string, stroke: FlowEdge["stroke"], end: string) =>
  stroke === "invisible"
    ? "~~~"
    : stroke === "thick"
      ? `${start}==${end || "="}`
      : stroke === "dotted"
        ? `${start}-.-${end}`
        : `${start}--${end || "-"}`;

/**
 * An arrow as it is written, with another label (an empty one removes it) or another stroke. It
 * keeps its form, `-- text -->` or `-->|text|`, its end marks and its name; a text the form between
 * strokes cannot hold goes between pipes.
 */
function arrowWith(token: string, change: ArrowChange): string {
  const named = token.match(NAMED)?.[0] ?? "",
    rest = token.slice(named.length),
    inline = rest.match(INLINE);
  if (inline) return named + inlineWith(inline, change);
  const plain = rest.match(INVISIBLE) ?? rest.match(PLAIN);
  return plain ? named + plainWith(rest, plain, change) : token;
}

/** Another label (an empty one removes it) or another stroke for an arrow. */
interface ArrowChange {
  label?: string;
  stroke?: FlowEdge["stroke"];
}

/** The stroke an arrow with its text between two strokes opens with. */
const inlineStroke = (open: string): FlowEdge["stroke"] =>
  open === "==" ? "thick" : open === "-." ? "dotted" : "solid";

/** The two halves of an arrow of a stroke with its text between them, ending in a mark or none. */
function halves(stroke: FlowEdge["stroke"], end: string): [string, string] {
  if (stroke === "thick") return ["==", `==${end || "="}`];
  if (stroke === "dotted") return ["-.", `.-${end}`];
  return ["--", `--${end || "-"}`];
}

/** Whether an arrow with its text between two strokes reads back as written, with that text. */
function readsInline(made: string, words: string): boolean {
  const read = `${made} x`.match(INLINE);
  return read?.[0].length === made.length && read[3] === words && !/[;|[\](){}]/.test(words);
}

/** An arrow with its text between two strokes, changed; a text that form cannot hold goes between pipes. */
function inlineWith(inline: RegExpMatchArray, change: ArrowChange): string {
  const [, start, open, text, close] = inline,
    was = inlineStroke(open),
    stroke = change.stroke ?? was,
    last = close.at(-1)!,
    end = /[>ox]/.test(last) ? last : "";
  if (change.label !== undefined && !change.label.trim()) return operator(start, stroke, end);
  const words = change.label === undefined ? text : escapeLabel(change.label),
    [head, tail] = stroke === was ? [open, close] : halves(stroke, end),
    made = `${start}${head} ${words} ${tail}`;
  if (readsInline(made, words)) return made;
  return operator(start, stroke, end) + pipeText(change.label ?? shownText(text));
}

/** The stroke of an arrow without text of its own, by its body. */
function plainStroke(body: string): FlowEdge["stroke"] {
  if (body.startsWith("~")) return "invisible";
  if (body.startsWith("=")) return "thick";
  return body.includes(".") ? "dotted" : "solid";
}

/** An arrow without text of its own, changed, with its text between pipes after it. */
function plainWith(rest: string, plain: RegExpMatchArray, change: ArrowChange): string {
  const [all, start = "", body = "~", mark = ""] = plain,
    line =
      change.stroke && change.stroke !== plainStroke(body)
        ? operator(start, change.stroke, /[>ox]/.test(mark) ? mark : "")
        : all;
  return line + pipeChange(rest.slice(all.length), change.label);
}

/** The text between pipes after an arrow: the old one, or another, or none for an empty label. */
function pipeChange(old: string, label: string | undefined): string {
  if (label === undefined) return old;
  return label.trim() ? pipeText(label) : "";
}

const same = (a: Ref[], b: Ref[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * Writes a chain anew without the nodes in `gone` and the edges in `cut`, and with the arrows in
 * `arrows` for single edges. What stays is written as it was: the chain is cut where an arrow has
 * no edge left, and an arrow between lists (`a & b --> c`) is written out only as far as its edges
 * no longer share one arrow. Returns the statements, and the nodes written without a shape that
 * the statements no longer mention; undefined when nothing changes.
 */
function recompose(
  statement: Statement,
  gone: Set<string>,
  cut: Set<string>,
  arrows: Map<string, string>,
): { texts: string[]; loose: Ref[] } | undefined {
  const keep: Keep = { gone, cut, arrows };
  if (!touches(statement, keep)) return undefined;
  const parts = statement.arrows.map((_, index) => partsOfArrow(statement, index, keep)),
    { texts, written } = writeParts(statement, parts),
    loose: Ref[] = [];
  for (const ref of statement.groups.flat()) {
    if (written.has(ref) || gone.has(ref.id)) continue;
    if (ref.shape || ref.braces) texts.push(ref.text);
    else loose.push(ref);
  }
  return { texts, loose };
}

/** What a chain is written anew without: nodes and edges that go, and edges under other arrows. */
interface Keep {
  gone: Set<string>;
  cut: Set<string>;
  arrows: Map<string, string>;
}

/** Whether a change touches a chain: one of its nodes goes, or one of its edges goes or changes. */
const touches = (statement: Statement, { gone, cut, arrows }: Keep) =>
  statement.groups.flat().some((ref) => gone.has(ref.id)) ||
  statement.edges.flat().some((edge) => cut.has(edge.id) || arrows.has(edge.id));

/** A part of what is left of an arrow: sources with the same targets under one arrow. */
interface Part {
  from: Ref[];
  to: Ref[];
  arrow: string;
}

/** What is left of one arrow of a chain, as parts. */
function partsOfArrow(statement: Statement, index: number, keep: Keep): Part[] {
  const { groups } = statement,
    token = statement.arrows[index].text,
    bySource: Part[][] = [];
  let count = 0;
  for (const from of groups[index]) {
    const own: Part[] = [];
    for (const to of groups[index + 1]) {
      const edge = statement.edges[index][count++];
      if (keep.gone.has(from.id) || keep.gone.has(to.id) || keep.cut.has(edge.id)) continue;
      addTarget(own, to, from, keep.arrows.get(edge.id) ?? token);
    }
    addSource(bySource, own, from);
  }
  return bySource.flat();
}

/** Adds a target to the parts of a source: under the arrow before it when that is the same. */
function addTarget(own: Part[], to: Ref, from: Ref, arrow: string) {
  const last = own.at(-1);
  if (last?.arrow === arrow) last.to.push(to);
  else own.push({ from: [from], to: [to], arrow });
}

/** Adds the parts of a source: to the source before it when both have one part, the same. */
function addSource(bySource: Part[][], own: Part[], from: Ref) {
  const before = bySource.at(-1);
  if (
    own.length === 1 &&
    before?.length === 1 &&
    before[0].arrow === own[0].arrow &&
    same(before[0].to, own[0].to)
  )
    before[0].from.push(from);
  else if (own.length) bySource.push(own);
}

/**
 * The statements the parts of a chain make, and the nodes written in them. A part goes on from
 * the one before it when it starts with the nodes that one ends with.
 */
function writeParts(statement: Statement, parts: Part[][]) {
  const texts: string[] = [],
    written = new Set<Ref>();
  let run = "",
    tail: Ref[] | undefined;
  parts.forEach((list, index) => {
    for (const part of list) {
      if (!tail || !same(tail, part.from)) {
        if (run) texts.push(run);
        run = groupText(statement, written, part.from, index);
      }
      run += arrowRun(statement, written, part, index);
      tail = part.to;
    }
    if (!list.length) tail = undefined;
  });
  if (run) texts.push(run);
  return { texts, written };
}

/** A part's arrow with the blanks around it as the chain had them, and its targets. */
function arrowRun(statement: Statement, written: Set<Ref>, part: Part, index: number): string {
  const { text, groups } = statement,
    token = statement.arrows[index];
  return (
    (text.slice(groups[index].at(-1)!.end, token.start) || " ") +
    part.arrow +
    text.slice(token.end, groups[index + 1][0].start) +
    groupText(statement, written, part.to, index + 1)
  );
}

/** A group as it was written when all of it stays; a node carries its shape where it is written first. */
function groupText(statement: Statement, written: Set<Ref>, refs: Ref[], index: number): string {
  const whole = statement.groups[index];
  if (same(refs, whole) && !refs.some((ref) => written.has(ref))) {
    for (const ref of refs) written.add(ref);
    return statement.text.slice(whole[0].start, whole.at(-1)!.end);
  }
  return refs.map((ref) => (written.has(ref) ? ref.id : (written.add(ref), ref.text))).join(" & ");
}

/**
 * The source with statements written anew: `changes` gives the statements that take the place of
 * one (none removes it), `drop` the lines that go. A line with one statement keeps what stands
 * around it, and becomes one line for each statement that takes its place.
 */
function rebuild(model: Model, changes: Map<Statement, string[]>, drop = new Set<number>()) {
  const out: string[] = [];
  model.lines.forEach((line, index) => {
    if (drop.has(index)) return;
    const own = model.byLine.get(index);
    if (!own?.some((statement) => changes.has(statement))) {
      out.push(line);
      return;
    }
    const texts = own.flatMap((statement) => changes.get(statement) ?? [statement.text]),
      before = line.slice(0, own[0].start),
      after = line.slice(own.at(-1)!.end);
    if (own.length === 1 && index !== model.header)
      out.push(...texts.map((text) => before + text + after));
    else if (texts.length) out.push(before + texts.join("; ") + after);
    else if (index === model.header) out.push(before.replace(/[;\s]*$/, ""));
  });
  return out.join("\n");
}

/**
 * The source with chains written anew, where no node is lost for it: a node the new chains no
 * longer mention, or no longer mention inside its subgraph, is written where it stood.
 */
function rebuildKeeping(
  model: Model,
  changes: Map<Statement, string[]>,
  loose: Map<Statement, Ref[]>,
  drop = new Set<number>(),
): string {
  const plain = rebuild(model, changes, drop);
  if (!loose.size) return plain;
  let after: Flowchart | undefined;
  try {
    after = parseFlowchart(plain);
  } catch {
    // Without a reading of the result every node is written out.
  }
  const kept = new Map(changes);
  let added = false;
  for (const [id, found] of loosePlaces(model, loose)) {
    const place = keepingPlace(model.chart.nodes.get(id)!, after?.nodes.get(id), found);
    if (!place) continue;
    kept.set(place.statement, [...kept.get(place.statement)!, place.ref.text]);
    added = true;
  }
  return added ? rebuild(model, kept, drop) : plain;
}

/** Where a loose node stood, by its id: each statement it was written in, with how. */
function loosePlaces(model: Model, loose: Map<Statement, Ref[]>) {
  const places = new Map<string, { statement: Statement; ref: Ref }[]>();
  for (const [statement, refs] of loose)
    for (const ref of refs)
      if (model.chart.nodes.has(ref.id))
        places.set(ref.id, [...(places.get(ref.id) ?? []), { statement, ref }]);
  return places;
}

/**
 * Where a node is written to keep it: where it stood in its subgraph, or anywhere it stood when it
 * is gone; nothing when it stands where it stood.
 */
function keepingPlace(
  node: { parent: string | null },
  now: { parent: string | null } | undefined,
  found: { statement: Statement; ref: Ref }[],
) {
  const inside = found.find((place) => place.statement.scope === node.parent);
  if (!now) return inside ?? found[0];
  return now.parent !== node.parent ? inside : undefined;
}

/**
 * A styling statement without the parts that go and with its edges renumbered: `style` and `class`
 * lose the ids in `gone`, `click` goes with its node, `linkStyle` counts the edges as `edge` says
 * (null for an edge that goes). Null when nothing is left for it to style.
 */
function restyle(
  text: string,
  gone: Set<string>,
  edge: (index: number) => number | null,
): string | null {
  const list = text.match(/^(style|class)(\s+)(\S+)([\s\S]*)$/);
  if (list) return restyleList(text, list, gone);
  const click = text.match(/^click\s+(\S+)/);
  if (click) return gone.has(click[1]) ? null : text;
  const link = text.match(/^(linkStyle\s+)(\d+(?:\s*,\s*\d+)*)([\s\S]*)$/);
  return link ? restyleLinks(text, link, edge) : text;
}

/** A `style` or `class` statement without the ids that go; null when none is left. */
function restyleList(text: string, list: RegExpMatchArray, gone: Set<string>): string | null {
  const ids = list[3].split(","),
    kept = ids.filter((id) => !gone.has(id));
  if (kept.length === ids.length) return text;
  return kept.length ? list[1] + list[2] + kept.join(",") + list[4] : null;
}

/** A `linkStyle` statement with its edges counted anew; null when none is left. */
function restyleLinks(
  text: string,
  link: RegExpMatchArray,
  edge: (index: number) => number | null,
): string | null {
  const before = link[2].split(",").map((item) => Number(item.trim())),
    now = before.map(edge).filter((item) => item !== null);
  if (now.length === before.length && now.every((item, index) => item === before[index]))
    return text;
  return now.length ? link[1] + now.join(",") + link[3] : null;
}

const parses = (source: string) => {
  try {
    parseFlowchart(source);
    return true;
  } catch {
    return false;
  }
};

/** An id no node or subgraph has yet. */
const freshId = (chart: Flowchart, base: string) =>
  numberedId((id) => chart.nodes.has(id) || chart.subgraphs.has(id), base);

/**
 * Where a statement is added, and with which indent: inside a subgraph before its `end`, else at
 * the end of the source; before the styling (`classDef`, `class`, `style`, `linkStyle`, `click`)
 * that closes either.
 */
function insertAt(model: Model, parent: string | null): { at: number; indent: string } {
  const { lines } = model,
    span = spanOf(model, parent),
    { first, last, styled } = scanSpan(model, span.from, span.to);
  let at = span.to;
  if (styled) at = last < 0 ? span.from : last + 1;
  else if (!span.group) while (at > 0 && !lines[at - 1].trim()) at--;
  if (first >= 0) return { at, indent: indentOf(lines[first]) };
  return { at, indent: span.group ? `${indentOf(lines[span.group.line])}  ` : "  " };
}

/**
 * The lines a statement is added among: those inside a subgraph whose `subgraph` and `end` stand on
 * lines of their own, with the subgraph, or else those after the header.
 */
function spanOf({ lines, statements, byLine, header }: Model, parent: string | null) {
  const group = parent
      ? statements.find((item) => item.kind === "subgraph" && item.id === parent)
      : undefined,
    end = group?.close === undefined ? undefined : statements[group.close];
  if (group && end && end.line > group.line && byLine.get(end.line)![0] === end)
    return { group, from: group.line + 1, to: end.line };
  return { group: undefined, from: header + 1, to: lines.length };
}

/** The first and the last line with statements among some lines, and whether styling alone stands after the last. */
function scanSpan({ byLine }: Model, from: number, to: number) {
  let last = -1,
    first = -1,
    styled = false;
  for (let index = from; index < to; index++) {
    const own = byLine.get(index);
    if (!own) continue;
    if (first < 0) first = index;
    styled = own.every((statement) => statement.kind === "styling");
    if (!styled) last = index;
  }
  return { first, last, styled };
}

/**
 * A new node as it is written: a step as a rectangle, in a swimlane as the rounded action; a
 * decision as a diamond; a start and an end as the circles a flow makes the small symbols of. A
 * start or an end that stands `alone`, with no flow yet, is written as the symbol itself.
 */
function nodeText(
  chart: Flowchart,
  kind: FlowPiece,
  id: string,
  name: string | undefined,
  alone = false,
): string {
  if ((kind === "start" || kind === "end") && alone) return symbolText(kind, id, name);
  const label = name?.trim() ? labelText(name) : "",
    shape = SHAPES[kind] ?? (chart.kind === "swimlane" ? actionText : stepText);
  return shape(id, label);
}

/** A step as a rectangle. */
const stepText = (id: string, label: string) => `${id}[${label || "Step"}]`;

/** A step of a swimlane as the rounded action. */
const actionText = (id: string, label: string) => `${id}(${label || "Step"})`;

/** The shapes of the new nodes that are no step: a decision a diamond, a start and an end the circles a flow makes the small symbols of. */
const SHAPES: Partial<Record<FlowPiece, (id: string, label: string) => string>> = {
  decision: (id, label) => `${id}{${label || " "}}`,
  start: (id, label) => `${id}((${label || "Start"}))`,
  end: (id, label) => `${id}(((${label || "End"})))`,
};

/** A start or an end as its symbol, `end1@{ shape: stop }`, with its name as the label entry. */
function symbolText(kind: "start" | "end", id: string, name: string | undefined): string {
  const text = name?.trim() ? `, label: "${escapeLabel(name).replace(/\}/g, "#125;")}"` : "";
  return `${id}@{ shape: ${kind === "start" ? "start" : "stop"}${text} }`;
}

/**
 * Adds a step, decision, start, end, group or lane and returns the id it got. It goes into the
 * subgraph or lane `parent` names, also one that holds nothing yet. Without one it stands at the
 * root of a flowchart; in a swimlane it stands in no lane when the source already has a node
 * outside the lanes, else in the first lane, where every node of such a diagram belongs. A group
 * of a swimlane is a lane, and goes after the last lane. A start and an end are written as their
 * symbols, `end1@{ shape: stop }`, so that they are drawn as such before a flow joins them.
 */
export function addFlowPiece(
  source: string,
  piece: { kind: FlowPiece; label?: string; parent?: string | null },
): { source: string; id: string } {
  const model = readModel(source);
  if (!model) return { source, id: "" };
  const { chart } = model,
    lines = [...model.lines],
    group = piece.kind === "group" || piece.kind === "lane",
    lane = group && chart.kind === "swimlane",
    id = freshId(chart, group ? (lane ? "lane" : "group") : piece.kind),
    place = piecePlace(model, lane, piece.parent);
  const text = group
    ? subgraphText(id, piece.label, lane)
    : [nodeText(chart, piece.kind, id, piece.label, true)];
  lines.splice(place.at, 0, ...text.map((line) => place.indent + line));
  return { source: lines.join("\n"), id };
}

/** Where a new piece is added: a lane beside the other lanes, after the `end` of the last one; any other piece in its subgraph. */
function piecePlace(model: Model, lane: boolean, parent: string | null | undefined) {
  if (!lane) return insertAt(model, homeOf(model.chart, parent));
  const place = insertAt(model, null);
  return { ...place, at: afterLanes(model) ?? place.at };
}

/** A new subgraph or lane as it is written, with its `end`. */
function subgraphText(id: string, name: string | undefined, lane: boolean): string[] {
  const label = name?.trim() ? labelText(name) : "";
  return [`subgraph ${id} [${label || (lane ? "Lane" : "Group")}]`, "end"];
}

/**
 * The subgraph a new node goes into: the one given, else in a swimlane whose nodes all stand in
 * lanes the first lane, else none.
 */
function homeOf(chart: Flowchart, parent: string | null | undefined): string | null {
  if (parent && chart.subgraphs.has(parent)) return parent;
  if (chart.kind !== "swimlane" || hasLoose(chart)) return null;
  return [...chart.subgraphs.keys()][0] ?? null;
}

/** Whether a chart has a node outside every subgraph. */
const hasLoose = (chart: Flowchart) => [...chart.nodes.values()].some((node) => !node.parent);

/** The line after the `end` of the last subgraph, if there is one. */
function afterLanes({ statements }: Model): number | undefined {
  const ends = statements
    .filter((item) => item.kind === "subgraph" && item.close !== undefined)
    .map((item) => statements[item.close!].line);
  return ends.length ? Math.max(...ends) + 1 : undefined;
}

/** The subgraphs around a node or subgraph, the nearest first. */
function around(chart: Flowchart, id: string): string[] {
  const out: string[] = [];
  for (
    let parent = (chart.nodes.get(id) ?? chart.subgraphs.get(id))?.parent ?? null;
    parent;
    parent = chart.subgraphs.get(parent)?.parent ?? null
  )
    out.push(parent);
  return out;
}

/** The strokes a flow is drawn with, as the kinds of join of an activity diagram. */
const STROKES: Record<string, FlowEdge["stroke"]> = {
  flow: "solid",
  dotted: "dotted",
  thick: "thick",
};

/**
 * Connects two nodes with an arrow of a kind (a plain flow when none is given), labelled when a
 * label is given. The arrow is written inside the subgraph that holds both ends, else at the root.
 * Two nodes that such an arrow already joins in that direction stay as they are, and so does a
 * swimlane when one end is a lane.
 */
export function connectFlow(
  source: string,
  from: string,
  to: string,
  label?: string,
  kind = "flow",
): string {
  const model = readModel(source),
    stroke = STROKES[kind];
  if (!model || !stroke) return source;
  const { chart } = model,
    text = label?.trim() || undefined;
  if (joinsLane(chart, from, to) || joins(chart, from, to, stroke, text)) return source;
  const { at, indent } = insertAt(model, sharedGroup(chart, from, to));
  // The edges after the new one count one further.
  const before = chart.edges.filter((edge) => edge.line <= at).length,
    lines = linesOf(recount(model, (index) => (index >= before ? index + 1 : index)));
  lines.splice(
    at,
    0,
    `${indent}${from} ${operator("", stroke, ">")}${text ? pipeText(text) : ""} ${to}`,
  );
  return lines.join("\n");
}

/** Whether one of two parts is a lane of a swimlane, which no flow joins. */
const joinsLane = (chart: Flowchart, from: string, to: string) =>
  chart.kind === "swimlane" && (chart.subgraphs.has(from) || chart.subgraphs.has(to));

/** The nearest subgraph that holds two parts, if any. */
function sharedGroup(chart: Flowchart, from: string, to: string): string | null {
  const shared = around(chart, to);
  return around(chart, from).find((id) => shared.includes(id)) ?? null;
}

/** Whether an edge of a stroke joins two nodes in that direction already, with the label when one is given. */
const joins = (
  chart: Flowchart,
  from: string,
  to: string,
  stroke: FlowEdge["stroke"],
  text: string | undefined,
) =>
  chart.edges.some(
    (edge) =>
      edge.source === from &&
      edge.target === to &&
      edge.stroke === stroke &&
      (!text || edge.label === shownText(escapeLabel(text))),
  );

/** The changes to the styling statements of a model that count the edges anew, and drop what styles parts that go. */
function restyled(
  model: Model,
  edge: (index: number) => number | null,
  gone = new Set<string>(),
): Map<Statement, string[]> {
  const changes = new Map<Statement, string[]>();
  for (const statement of model.statements) {
    if (statement.kind !== "styling") continue;
    const styled = restyle(statement.text, gone, edge);
    if (styled !== statement.text) changes.set(statement, styled === null ? [] : [styled]);
  }
  return changes;
}

/** A source whose `linkStyle` statements count its edges anew. */
const recount = (model: Model, edge: (index: number) => number | null) =>
  rebuild(model, restyled(model, edge));

/** A statement of a model with one stretch of it written anew. */
const patched = (statement: Statement, start: number, end: number, text: string) =>
  statement.text.slice(0, start) + text + statement.text.slice(end);

/**
 * Gives a node or a subgraph another name, where it is declared; a node that is only mentioned
 * gets its name where it first stands. Without a name a rectangle goes back to its bare id, which
 * it then shows, and any other shape keeps its delimiters around a blank; a subgraph keeps the
 * name it has.
 */
export function renameFlow(source: string, id: string, label: string): string {
  const model = readModel(source);
  if (!model) return source;
  const group = openingOf(model.statements, id);
  if (group)
    return label.trim()
      ? rebuild(model, new Map([[group, [headingOf(group, id, label)]]]))
      : source;
  const whole = model.chart.nodes.has(id) ? renamedNode(model, id, label) : undefined;
  return whole ? rebuild(model, new Map([[whole[0], [whole[1]]]])) : source;
}

/**
 * The statement that names a node, with another name: where it has a shape, else in its `@{ }`,
 * else in brackets where it first stands; undefined where nothing changes.
 */
function renamedNode(model: Model, id: string, label: string): [Statement, string] | undefined {
  const mentions = mentionsOf(model, id),
    shaped = mentions.find(({ ref }) => ref.shape),
    braced = mentions.find(({ ref }) => ref.braces),
    [first] = mentions;
  if (shaped) return [shaped.statement, reshaped(shaped.statement, shaped.ref, label)];
  if (braced) return rebraced(braced.statement, braced.ref, label);
  if (!first || !label.trim()) return undefined;
  const { statement, ref } = first;
  return [statement, patched(statement, ref.idEnd, ref.idEnd, `[${labelText(label)}]`)];
}

/** The `subgraph` line of a subgraph with another name: beside its id in brackets, or in quotes. */
function headingOf(group: Statement, id: string, label: string): string {
  return group.form === "bracket" || (group.form === "plain" && /^\S+$/.test(id))
    ? `subgraph ${id} [${labelText(label)}]`
    : `subgraph "${escapeLabel(label)}"`;
}

/**
 * A statement with another name between the delimiters of a node's shape. Without a name a
 * rectangle goes back to its bare id, and any other shape keeps its delimiters around a blank.
 */
function reshaped(statement: Statement, ref: Ref, label: string): string {
  const shape = ref.shape!,
    empty = !label.trim();
  if (empty && shape.open === "[") return patched(statement, ref.idEnd, shape.after, "");
  return patched(statement, shape.start, shape.end, empty ? " " : labelText(label));
}

/** A statement with another name as the `label` entry of a node's `@{ }`; undefined for an empty name where it has none. */
function rebraced(statement: Statement, ref: Ref, label: string): [Statement, string] | undefined {
  const braces = ref.braces!,
    inner = `"${escapeLabel(label).replace(/\}/g, "#125;")}"`;
  if (braces.label)
    return [statement, patched(statement, braces.label.start, braces.label.end, inner)];
  if (!label.trim()) return undefined;
  const body = statement.text.slice(braces.start + 2, braces.end - 1).trimEnd(),
    entry = `${body}${body.trim() ? "," : ""} label: ${inner} `;
  return [statement, patched(statement, braces.start + 2, braces.end - 1, entry)];
}

/** An id made of the words of a name (`Pack parcel`: `packParcel`); null when the name gives none. */
function idOf(name: string): string | null {
  const words =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss")
      .match(/[A-Za-z0-9]+/g) ?? [];
  let id = "";
  for (const word of words) {
    const next = id
      ? id + word[0].toUpperCase() + word.slice(1)
      : /[a-z]/.test(word)
        ? word[0].toLowerCase() + word.slice(1)
        : word.toLowerCase();
    if (id && next.length > 28) break;
    id = next;
  }
  return /^[A-Za-z]\w{0,39}$/.test(id) && !RESERVED.has(id) ? id : null;
}

/**
 * The source with a node or subgraph under another id, at every mention. A subgraph keeps the
 * name it has in brackets, or opens with `heading` when that is given.
 */
function reidentify(source: string, id: string, next: string, heading?: string): string {
  const model = readModel(source);
  if (!model) return source;
  const changes = new Map<Statement, string[]>();
  for (const statement of model.statements) {
    const text = withId(statement, id, next, heading);
    if (text !== statement.text) changes.set(statement, [text]);
  }
  return rebuild(model, changes);
}

/** A statement with a node or subgraph under another id, wherever it names it. */
function withId(statement: Statement, id: string, next: string, heading?: string): string {
  if (statement.kind === "chain") {
    let text = statement.text;
    // From the right, so the places before keep their columns.
    for (const ref of statement.groups.flat().toReversed())
      if (ref.id === id) text = text.slice(0, ref.start) + next + text.slice(ref.idEnd);
    return text;
  }
  if (statement.kind === "subgraph" && statement.id === id) {
    const bracket = statement.text.match(/^subgraph\s+\S+?(\s*\[.*\])$/);
    return heading ?? `subgraph ${next}${bracket ? bracket[1] : ""}`;
  }
  return statement.kind === "styling" ? styledWithId(statement.text, id, next) : statement.text;
}

/** A `style`, `class` or `click` statement with an id written as another. */
function styledWithId(text: string, id: string, next: string): string {
  const list = text.match(/^(style|class)(\s+)(\S+)([\s\S]*)$/),
    click = text.match(/^(click\s+)(\S+)([\s\S]*)$/);
  if (list) {
    const ids = list[3].split(",").map((item) => (item === id ? next : item));
    return list[1] + list[2] + ids.join(",") + list[4];
  }
  return click?.[2] === id ? click[1] + next + click[3] : text;
}

/**
 * Gives a part that was just added or copied its first name. A part that still has the id it was
 * added or copied under (`step1`, `lane1`, `packParcel2` beside `packParcel`) takes an id made of
 * the name, at every mention, where the name gives one that
 * is free: `packParcel[Pack parcel]`, and for a subgraph named with one word `subgraph Shop`. Any
 * other part keeps its id and takes the name as `renameFlow` gives it. Returns the id afterwards.
 */
export function retitleFlow(
  source: string,
  id: string,
  name: string,
): { source: string; id: string } {
  const named = renameFlow(source, id, name),
    chart = parseFlowchart(source);
  if (!name.trim() || !generated(chart, id)) return { source: named, id };
  // A subgraph named with one word is that word, as id and as name.
  const word = chart.subgraphs.has(id) && /^[A-Za-z]\w*$/.test(name.trim()) ? name.trim() : null,
    next = isFree(chart, word) ? word : idOf(name);
  if (!isFree(chart, next)) return { source: named, id };
  const moved = reidentify(named, id, next, next === word ? `subgraph ${next}` : undefined);
  return holds(moved, next) ? { source: moved, id: next } : { source: named, id };
}

/** Whether a text is an id no node or subgraph has, and no keyword. */
const isFree = (chart: Flowchart, candidate: string | null): candidate is string =>
  candidate !== null &&
  !RESERVED.has(candidate) &&
  !chart.nodes.has(candidate) &&
  !chart.subgraphs.has(candidate);

/** Whether a source reads with a node or subgraph of an id; the name gave no id the source can hold where not. */
function holds(source: string, id: string): boolean {
  try {
    const after = parseFlowchart(source);
    return after.nodes.has(id) || after.subgraphs.has(id);
  } catch {
    return false;
  }
}

/** The source with one edge under another arrow, written in place where the edge has an arrow of its own. */
function rearrow(source: string, edge: string, change: ArrowChange): string {
  const model = readModel(source);
  if (!model) return source;
  for (const statement of model.statements)
    for (const [index, edges] of statement.edges.entries()) {
      if (!edges.some((item) => item.id === edge)) continue;
      const token = statement.arrows[index].text,
        arrow = arrowWith(token, change);
      if (arrow === token) return source;
      const made = recompose(statement, new Set(), new Set(), new Map([[edge, arrow]]));
      if (!made) return source;
      const result = rebuild(model, new Map([[statement, made.texts]]));
      return parses(result) ? result : source;
    }
  return source;
}

/**
 * Gives an edge another label; an empty one removes it. The arrow keeps its form, `-- text -->` or
 * `-->|text|`, and the rest of its line; an arrow that stands for several edges (`a --> b & c`) is
 * written out for the edge that differs.
 */
export function labelFlowEdge(source: string, edge: string, label: string): string {
  return rearrow(source, edge, { label });
}

/** Makes an edge one of another stroke, in place as `labelFlowEdge` does; its end marks and label stay. */
export function restrokeFlow(source: string, edge: string, kind: string): string {
  return STROKES[kind] ? rearrow(source, edge, { stroke: STROKES[kind] }) : source;
}

/**
 * Removes nodes with their edges, subgraphs with what they hold, and edges, by id. With a node go
 * its `style`, `class` and `click` statements; with a subgraph its edges, its `direction` and the
 * comments inside it; `linkStyle` statements count the edges that are left. Every other node
 * stays: one that loses its last mention is written on a line of its own.
 */
export function removeFlow(source: string, ids: Iterable<string>): string {
  const model = readModel(source);
  if (!model) return source;
  const { chart } = model,
    named = new Set(ids),
    removal: FlowRemoval = { gone: new Set(), changes: new Map(), drop: new Set() };
  for (const id of named) {
    if (chart.nodes.has(id)) removal.gone.add(id);
    else takeSubgraph(model, id, removal);
  }
  const { changes, gone } = removal,
    cut = new Set(chart.edges.filter((edge) => named.has(edge.id)).map((edge) => edge.id)),
    numbers = survivors(chart, cut, gone),
    loose = recomposeAll(model, gone, cut, changes);
  for (const [statement, texts] of restyled(model, (index) => numbers.get(index) ?? null, gone))
    if (!changes.has(statement)) changes.set(statement, texts);
  return rebuildKeeping(model, changes, loose, removal.drop);
}

/** What a removal takes: the nodes and subgraphs that go, the statements written anew, the lines dropped. */
interface FlowRemoval {
  gone: Set<string>;
  changes: Map<Statement, string[]>;
  drop: Set<number>;
}

/**
 * Adds a subgraph to a removal with what it holds. Its own statements go: the opening, the `end`,
 * and what is said of it in between, comments among them.
 */
function takeSubgraph(model: Model, id: string, removal: FlowRemoval) {
  const { chart } = model,
    { gone } = removal;
  if (!chart.subgraphs.has(id) || gone.has(id)) return;
  gone.add(id);
  for (const node of chart.nodes.values()) if (node.parent === id) gone.add(node.id);
  for (const other of chart.subgraphs.values())
    if (other.parent === id) takeSubgraph(model, other.id, removal);
  const opening = openingOf(model.statements, id);
  if (opening?.close !== undefined) dropOwn(model, opening, opening.close, removal);
}

/** Drops a subgraph's own statements: the opening, the `end`, and what is said of it in between, comments among them. */
function dropOwn(model: Model, opening: Statement, close: number, removal: FlowRemoval) {
  const { statements } = model,
    end = statements[close];
  for (let index = opening.index; index <= end.index; index++)
    if (statements[index].kind !== "chain") removal.changes.set(statements[index], []);
  for (let line = opening.line + 1; line < end.line; line++)
    if (!model.byLine.has(line) && !LEVEL.test(model.lines[line].trim())) removal.drop.add(line);
}

/** The number of each edge that stays, among those that stay, by its number before. */
function survivors(chart: Flowchart, cut: Set<string>, gone: Set<string>) {
  const numbers = new Map<number, number>();
  chart.edges.forEach((edge, index) => {
    if (!cut.has(edge.id) && !gone.has(edge.source) && !gone.has(edge.target))
      numbers.set(index, numbers.size);
  });
  return numbers;
}

/** What an edge is apart from where it stands: its ends, its label, its stroke and its end marks. */
const signature = (edge: Omit<FlowEdge, "id" | "line">) =>
  [edge.source, edge.target, edge.label ?? "", edge.stroke, edge.start ?? "", edge.end ?? ""].join(
    "\u0000",
  );

/**
 * A source whose `linkStyle` statements count the edges as they now stand. `before` says what each
 * edge was when the statements were written, null for one that is gone: the edges of the source
 * are matched with those, each with the next that is the same.
 */
function relinked(result: string, before: (string | null)[]): string {
  const model = readModel(result);
  if (!model?.statements.some((item) => item.kind === "styling" && /^linkStyle\s/.test(item.text)))
    return result;
  const now = matched(model.chart, before);
  return recount(model, (index) => now[index] ?? null);
}

/** Each edge as it was, matched with the next edge of a chart that is the same: its number there, or null. */
function matched(chart: Flowchart, before: (string | null)[]): (number | null)[] {
  const places = new Map<string, number[]>();
  chart.edges.forEach((edge, index) => {
    const key = signature(edge);
    places.set(key, [...(places.get(key) ?? []), index]);
  });
  const taken = new Map<string, number>();
  return before.map((key) => {
    if (key === null) return null;
    const count = taken.get(key) ?? 0;
    taken.set(key, count + 1);
    return places.get(key)?.[count] ?? null;
  });
}

/** Where each node and subgraph of a chart stands: the subgraph that holds it. */
const parentsOf = (chart: Flowchart) =>
  new Map(
    [...chart.nodes.values(), ...chart.subgraphs.values()].map((item) => [item.id, item.parent]),
  );

/**
 * Whether a source reads as another did but for what `differs` names: the same nodes and
 * subgraphs with the names they had, each in the subgraph it was in, and as many edges, or
 * `more` edges than that.
 */
function keeps(
  result: string,
  chart: Flowchart,
  differs: Map<string, string | null>,
  more = 0,
): boolean {
  let after: Flowchart;
  try {
    after = parseFlowchart(result);
  } catch {
    return false;
  }
  const now = parentsOf(after),
    was = new Map([...parentsOf(chart), ...differs]);
  return (
    now.size === was.size &&
    [...was].every(([id, parent]) => now.has(id) && now.get(id) === parent) &&
    [...chart.nodes.values(), ...chart.subgraphs.values()].every(
      (item) => (after.nodes.get(item.id) ?? after.subgraphs.get(item.id))?.label === item.label,
    ) &&
    after.edges.length === chart.edges.length + more
  );
}

/** The same edges, each as often, wherever they stand. */
const sameEdges = (a: Flowchart, b: Flowchart) =>
  a.edges.map(signature).toSorted().join("\n") === b.edges.map(signature).toSorted().join("\n");

/** An edge where it is written: its statement, its arrow and the two nodes it joins there. */
interface Wire {
  statement: Statement;
  /** The arrow of the statement that makes it. */
  arrow: number;
  from: Ref;
  to: Ref;
  edge: FlowEdge;
  /** How many edges the statement makes before it. */
  order: number;
}

function wireOf(model: Model, edge: string): Wire | null {
  for (const statement of model.statements) {
    let order = 0;
    for (const [arrow, edges] of statement.edges.entries()) {
      let count = 0;
      for (const from of statement.groups[arrow])
        for (const to of statement.groups[arrow + 1]) {
          const found = edges[count++];
          if (found.id === edge) return { statement, arrow, from, to, edge: found, order };
          order++;
        }
    }
  }
  return null;
}

/** How many edges a chain makes. */
function edgeCount(text: string): number {
  const chain = readChain(text);
  if (!chain) return 0;
  return chain.arrows.reduce(
    (sum, _, index) => sum + chain.groups[index].length * chain.groups[index + 1].length,
    0,
  );
}

/**
 * The source with one edge taken out of its statement and written anew as a statement of its own,
 * in the place it had among the edges. `write` gets the two ends as they are to be written (with
 * the shape a node is declared with, where the statement no longer holds it elsewhere) and the
 * arrow with the blanks around it.
 */
function rewired(
  model: Model,
  wire: Wire,
  write: (
    from: string,
    to: string,
    arrow: { before: string; text: string; after: string },
  ) => string,
): string {
  const { statement, arrow } = wire,
    made = recompose(statement, new Set(), new Set([wire.edge.id]), new Map());
  if (!made) return model.lines.join("\n");
  const texts = [...made.texts],
    ends = [endText(texts, wire.from), endText(texts, wire.to)],
    loose = made.loose.filter((item) => item.id !== wire.from.id && item.id !== wire.to.id);
  const slot = slotOf(texts, wire.order);
  [wire.from, wire.to].forEach((ref, index) => {
    if (ends[index] === ref.id && carryShape(texts, slot, ref)) ends[index] = ref.text;
  });
  const token = statement.arrows[arrow],
    text = write(ends[0], ends[1], {
      before: statement.text.slice(statement.groups[arrow].at(-1)!.end, token.start) || " ",
      text: token.text,
      after: statement.text.slice(token.end, statement.groups[arrow + 1][0].start) || " ",
    });
  texts.splice(slot, 0, text);
  return rebuildKeeping(
    model,
    new Map([[statement, texts]]),
    loose.length ? new Map([[statement, loose]]) : new Map(),
  );
}

/** Where an edge goes among the statements of its chain: after those that hold the edges before it. */
function slotOf(texts: string[], order: number): number {
  let slot = 0,
    count = 0;
  while (slot < texts.length && count < order) count += edgeCount(texts[slot++]);
  return slot;
}

/**
 * An end of an edge as it is to be written: with its shape where the statements no longer hold
 * the node elsewhere, that is, where it stood alone, which it then no longer does.
 */
function endText(texts: string[], ref: Ref): string {
  const alone = ref.shape || ref.braces ? texts.indexOf(ref.text) : -1;
  if (alone < 0) return ref.id;
  texts.splice(alone, 1);
  return ref.text;
}

/**
 * Takes the shape of a node off its first mention in the statements from a slot on, so that the
 * edge written at the slot carries it: a node carries its shape where it is written first. False
 * where no statement there mentions it so.
 */
function carryShape(texts: string[], slot: number, ref: Ref): boolean {
  if (ref.text === ref.id) return false;
  for (let later = slot; later < texts.length; later++) {
    const at = texts[later].indexOf(ref.text);
    if (at < 0 || (at > 0 && !/[\s&>|.=ox-]/.test(texts[later][at - 1]))) continue;
    texts[later] = texts[later].slice(0, at) + ref.id + texts[later].slice(at + ref.text.length);
    return true;
  }
  return false;
}

/**
 * Turns an edge round: its ends change places, its arrow stays as it is written, with its label,
 * its stroke and its end marks. An edge that is a statement of its own is turned in place; one in
 * a chain or between lists (`a --> b --> c`, `a & b --> c`) leaves it and is written on a line of
 * its own where it stood, the rest of the chain as it was. `linkStyle` statements keep counting
 * the same edges. An edge of a node to itself stays as it is.
 */
export function reverseFlow(source: string, edge: string): string {
  const model = readModel(source),
    wire = model && wireOf(model, edge);
  if (!model || !wire || wire.edge.source === wire.edge.target) return source;
  const { chart } = model,
    result = rewired(
      model,
      wire,
      (from, to, arrow) => to + arrow.before + arrow.text + arrow.after + from,
    ),
    turned = { ...wire.edge, source: wire.edge.target, target: wire.edge.source };
  if (!keeps(result, chart, new Map())) return source;
  return relinked(
    result,
    chart.edges.map((item) => signature(item === wire.edge ? turned : item)),
  );
}

/** An arrow as it is written, with an arrow head where it ends in a circle or a cross. */
function headed(token: string): string {
  const named = token.match(NAMED)?.[0] ?? "",
    rest = token.slice(named.length),
    length = (rest.match(INLINE) ?? rest.match(PLAIN))?.[0].length ?? 0;
  return length && /[ox]/.test(rest[length - 1])
    ? `${named}${rest.slice(0, length - 1)}>${rest.slice(length)}`
    : token;
}

/**
 * Puts a new step, decision, start or end into a flow: `a --> b` becomes `a --> new --> b`, within
 * its chain where the arrow makes that one edge. The label of the edge stays on its first half,
 * the second half is an arrow of the same stroke that ends as the edge ended: a circle or a cross
 * at the end of the edge moves to it, and the first half gets an arrow head. In a swimlane whose nodes all stand in
 * lanes, the new node stands in the lane the flow leaves. Returns the id of the new node, empty
 * when the edge is not there or the piece is no node.
 */
export function insertFlowOnEdge(
  source: string,
  edge: string,
  piece: { kind: FlowPiece; label?: string },
): { source: string; id: string } {
  const model = readModel(source),
    wire = model && wireOf(model, edge),
    none = { source, id: "" };
  if (!model || !wire || piece.kind === "group" || piece.kind === "lane") return none;
  const { chart } = model,
    id = freshId(chart, piece.kind),
    result = withNodeOn(model, wire, nodeText(chart, piece.kind, id, piece.label)),
    after = readsWithOneMore(result, chart, id),
    placed = after && placedInLane(result, chart, after, id, wire.edge);
  if (!placed) return none;
  return { source: relinked(placed, halvedSignatures(chart, wire.edge, id)), id };
}

/** The edges of a chart as they were, the edge a node was put on as its first half, which ends at the node with a head. */
function halvedSignatures(chart: Flowchart, edge: FlowEdge, id: string): string[] {
  const first: FlowEdge = { ...edge, target: id, end: edge.end && "arrow" };
  return chart.edges.map((item) => signature(item === edge ? first : item));
}

/**
 * The source with a node put into a flow: the label of the edge stays on its first half, which
 * gets an arrow head; the second half is an arrow of the same stroke that ends as the edge ended.
 * Within its chain where the arrow makes that one edge, else on a line of its own.
 */
function withNodeOn(model: Model, wire: Wire, text: string): string {
  const { statement } = wire,
    mark = { arrow: ">", circle: "o", cross: "x" }[wire.edge.end ?? "arrow"],
    second = operator("", wire.edge.stroke, wire.edge.end ? mark : ""),
    token = statement.arrows[wire.arrow],
    half = `${headed(token.text)} ${text} ${second}`;
  if (statement.edges[wire.arrow].length === 1)
    return rebuild(
      model,
      new Map([[statement, [patched(statement, token.start, token.end, half)]]]),
    );
  return rewired(
    model,
    wire,
    (from, to, arrow) => `${from}${arrow.before}${half}${arrow.after}${to}`,
  );
}

/** A source with a new node in the lane of its flow where it belongs in one; undefined where that loses something. */
function placedInLane(
  result: string,
  chart: Flowchart,
  after: Flowchart,
  id: string,
  edge: FlowEdge,
): string | undefined {
  const made = after.nodes.get(id)!,
    lane = laneOfFlow(chart, made, edge),
    placed = lane ? moveFlowInto(result, id, lane) : result;
  return keeps(placed, after, new Map([[id, lane ?? made.parent]])) ? placed : undefined;
}

/** A source as its chart, where it has a new node and one edge more than a chart had. */
function readsWithOneMore(result: string, chart: Flowchart, id: string): Flowchart | undefined {
  try {
    const after = parseFlowchart(result);
    return after.nodes.has(id) && after.edges.length === chart.edges.length + 1 ? after : undefined;
  } catch {
    return undefined;
  }
}

/** The lane a node put into a flow stands in: in a swimlane whose nodes all stand in lanes, that of the flow; else none. */
function laneOfFlow(
  chart: Flowchart,
  made: { parent: string | null },
  edge: FlowEdge,
): string | null | undefined {
  if (chart.kind !== "swimlane" || made.parent || hasLoose(chart)) return null;
  return chart.nodes.get(edge.source)?.parent ?? chart.nodes.get(edge.target)?.parent;
}

/**
 * Connects two nodes as `connectFlow` does and says which edge it wrote: edges are numbered in the
 * order of the source, so the new one is not always the last. No edge is returned when nothing
 * was written.
 */
export function joinFlow(
  source: string,
  from: string,
  to: string,
  kind?: string,
  label?: string,
): { source: string; edge: string } {
  const result = connectFlow(source, from, to, label, kind);
  if (result === source) return { source, edge: "" };
  // The first edge that is not one of those the source had, in their order.
  const before = parseFlowchart(source).edges.map(signature);
  let at = 0;
  for (const edge of parseFlowchart(result).edges) {
    if (before[at] === signature(edge)) at++;
    else return { source: result, edge: edge.id };
  }
  return { source: result, edge: "" };
}

/**
 * Adds a step, decision, start or end joined to a node, in one statement: `at --> new[Label]`, or
 * `new((Start)) --> at` for a start, which leads. The statement stands in the subgraph or lane of
 * the node, so the new node stands there too. Returns the id of the node and of the edge; both
 * empty, and the source unchanged, for a group or a lane, at a lane of a swimlane, and at what is
 * not there.
 */
export function attachFlow(
  source: string,
  piece: { kind: FlowPiece; label?: string },
  at: string,
): { source: string; id: string; edge: string } {
  const model = readModel(source),
    none = { source, id: "", edge: "" };
  if (!model || piece.kind === "group" || piece.kind === "lane") return none;
  const { chart } = model,
    anchor = chart.nodes.get(at) ?? (chart.kind === "flowchart" ? chart.subgraphs.get(at) : null);
  if (!anchor) return none;
  return (
    attachInOne(model, piece, at, anchor.parent) ??
    attachByJoining(source, piece, at, anchor.parent) ??
    none
  );
}

/** Adds a node joined to another in one statement in the subgraph of that one; undefined where that does not put it there. */
function attachInOne(
  model: Model,
  piece: { kind: FlowPiece; label?: string },
  at: string,
  parent: string | null,
) {
  const { chart } = model,
    id = freshId(chart, piece.kind),
    text = nodeText(chart, piece.kind, id, piece.label),
    place = insertAt(model, parent),
    lines = [...model.lines];
  lines.splice(
    place.at,
    0,
    place.indent + (piece.kind === "start" ? `${text} --> ${at}` : `${at} --> ${text}`),
  );
  const result = lines.join("\n");
  if (!keeps(result, chart, new Map([[id, parent]]), 1)) return undefined;
  const edge = parseFlowchart(result).edges.find(
    (item) => item.line === place.at + 1 && (item.source === id || item.target === id),
  );
  return edge && { source: relinked(result, chart.edges.map(signature)), id, edge: edge.id };
}

/** Adds a node in the subgraph of another, declared there and then joined to it; undefined where it is not joined. */
function attachByJoining(
  source: string,
  piece: { kind: FlowPiece; label?: string },
  at: string,
  parent: string | null,
) {
  const added = addFlowPiece(source, { ...piece, parent });
  if (!added.id) return undefined;
  const joined =
    piece.kind === "start"
      ? joinFlow(added.source, added.id, at)
      : joinFlow(added.source, at, added.id);
  return joined.edge ? { ...joined, id: added.id } : undefined;
}

/**
 * The label a new flow out of a decision takes: `yes` for the first branch, `no` for the second,
 * as far as the branches the decision has are unlabelled or say yes and no. Undefined once both
 * are there, when the branches are named another way, and for what is no decision.
 */
export function nextBranchLabel(source: string, decision: string): string | undefined {
  let chart: Flowchart;
  try {
    chart = parseFlowchart(source);
  } catch {
    return undefined;
  }
  if (chart.nodes.get(decision)?.shape !== "diamond") return undefined;
  const labels = chart.edges
    .filter((edge) => edge.source === decision && edge.label?.trim())
    .map((edge) => edge.label!.trim().toLowerCase());
  if (labels.some((label) => label !== "yes" && label !== "no")) return undefined;
  return ["yes", "no"].find((label) => !labels.includes(label));
}

/** Whether a text can be the id of a node or subgraph: one word the parser reads as an id, and no keyword. */
const canBeId = (id: string) =>
  new RegExp(`^(?:${ID.source})$`, "u").test(id) && !RESERVED.has(id) && !id.endsWith("@");

/**
 * Gives a node or a subgraph another id, at every mention: in its flows, where it is declared,
 * and in the `style`, `class` and `click` statements that name it. A subgraph that was named by
 * its id keeps that name beside the new id. The source stays as it is when the id cannot be one,
 * when a node or subgraph has it, and for a subgraph without a name.
 */
export function renameFlowId(source: string, id: string, newId: string): string {
  const model = readModel(source),
    next = newId.trim();
  if (!model || !canReid(model, id, next)) return source;
  const heading = reidHeading(model, id, next);
  if (heading === null) return source;
  const result = reidentify(source, id, next, heading);
  return reidentified(result, model, id, next) ? result : source;
}

/** Whether a node or a subgraph can go by a new id: one the parser reads, that nothing has. */
function canReid({ chart, statements }: Model, id: string, next: string): boolean {
  if (!chart.nodes.has(id) && !openingOf(statements, id)) return false;
  return canBeId(next) && !chart.nodes.has(next) && !chart.subgraphs.has(next);
}

/**
 * The `subgraph` line a subgraph under a new id opens with: by the id alone where its name is the
 * id, else with its name in brackets beside it; undefined where its line stays as it is, and null
 * for a subgraph without a name.
 */
function reidHeading({ chart, statements }: Model, id: string, next: string) {
  const group = openingOf(statements, id);
  if (!group) return undefined;
  if (group.form === "bare") return null;
  const { label } = chart.subgraphs.get(id)!;
  if (label === next) return `subgraph ${next}`;
  return group.form === "bracket" ? undefined : `subgraph ${next} [${labelText(label)}]`;
}

/**
 * Whether a source reads as a model's chart with one id written as another: the part shows the
 * name it showed (a node shown by its id the new id), and every part and edge is as it was.
 */
function reidentified(result: string, model: Model, id: string, next: string): boolean {
  const { chart } = model,
    named = (item: string) => (item === id ? next : item),
    shown = shownAs(model, id, next);
  try {
    const after = parseFlowchart(result),
      now = after.nodes.get(next) ?? after.subgraphs.get(next);
    return (
      now?.label === shown && samePlaces(after, chart, named) && sameFlows(after, chart, named)
    );
  } catch {
    return false;
  }
}

/** The name a part shows under a new id: a node shown by its id shows the new one. */
function shownAs(model: Model, id: string, next: string): string {
  const { chart } = model,
    was = chart.nodes.get(id) ?? chart.subgraphs.get(id)!;
  return chart.nodes.has(id) && was.label === id && !declared(model, id) ? next : was.label;
}

/** Whether a chart has the parts another had, each in the subgraph it was in, under the ids `named` gives. */
function samePlaces(after: Flowchart, chart: Flowchart, named: (id: string) => string): boolean {
  const now = parentsOf(after);
  return (
    after.nodes.size === chart.nodes.size &&
    after.subgraphs.size === chart.subgraphs.size &&
    [...parentsOf(chart)].every(
      ([item, parent]) => now.get(named(item)) === (parent && named(parent)),
    )
  );
}

/** Whether a chart has the edges another had, in their order, between the ids `named` gives. */
const sameFlows = (after: Flowchart, chart: Flowchart, named: (id: string) => string) =>
  after.edges.map(signature).join("\n") ===
  chart.edges
    .map((edge) => signature({ ...edge, source: named(edge.source), target: named(edge.target) }))
    .join("\n");

/** Every place a node is mentioned at, in the order of the source. */
const mentionsOf = (model: Model, id: string) =>
  model.statements.flatMap((statement) =>
    statement.groups.flat().flatMap((ref) => (ref.id === id ? [{ statement, ref }] : [])),
  );

/** Whether a node is written with a shape or a name somewhere, and not by its id alone. */
const declared = (model: Model, id: string) =>
  mentionsOf(model, id).some(({ ref }) => ref.shape || ref.braces);

/**
 * Whether a node or subgraph still has an id it was given without being asked: the id a piece is
 * added under (`step1`, `lane1`), or the id of a copy that still carries the name it was copied
 * with (`packParcel2` beside `packParcel`). The first name such a part gets is to become its id.
 */
function generated(chart: Flowchart, id: string): boolean {
  if (GENERATED.test(id)) return true;
  const node = chart.nodes.get(id);
  return (
    !!node &&
    originalsOf(id, chart.nodes.values()).some(
      (other) => node.label === other.label || node.label === other.id,
    )
  );
}

/**
 * Whether a node or subgraph still has the id it was added or copied under, so that the first
 * name it gets is to become its id: what `retitleFlow` asks before it changes an id. A canvas
 * asks it of the copy `duplicateFlowNode` returns.
 */
export function isGeneratedFlowId(source: string, id: string): boolean {
  try {
    return generated(parseFlowchart(source), id);
  } catch {
    return false;
  }
}

/**
 * Adds a copy of a node beside it, in the same subgraph or lane: the same shape and name under a
 * new id, the id with the next number that is free. Its flows are not copied. Returns the id of
 * the copy, empty for what is no node.
 */
export function duplicateFlowNode(source: string, id: string): { source: string; id: string } {
  const model = readModel(source),
    node = model?.chart.nodes.get(id),
    none = { source, id: "" };
  if (!model || !node) return none;
  const { chart } = model,
    copy = numberedId(
      (item) => chart.nodes.has(item) || chart.subgraphs.has(item),
      id.replace(/\d+$/, "") || id,
      2,
    );
  if (!canBeId(copy)) return none;
  const place = insertAt(model, node.parent),
    lines = [...model.lines];
  lines.splice(place.at, 0, place.indent + copyText(model, id, copy, node.label));
  const result = lines.join("\n");
  return keeps(result, chart, new Map([[copy, node.parent]])) ? { source: result, id: copy } : none;
}

/** A copy of a node as it is declared; a node written by its id alone shows that id, and the copy shows it too. */
function copyText(model: Model, id: string, copy: string, label: string): string {
  const mentions = mentionsOf(model, id),
    { ref } = mentions.find((item) => item.ref.shape || item.ref.braces) ?? mentions[0];
  if (ref.shape || ref.braces) return copy + ref.text.slice(id.length);
  return `${copy}[${labelText(label)}]${ref.text.slice(id.length)}`;
}

/** One step of indentation, as the source indents. */
const stepOf = (model: Model) =>
  model.lines.some((line, index) => index !== model.header && line.startsWith("\t")) ? "\t" : "  ";

/**
 * Moves a node into a subgraph or lane, or with null out of every one. A node stands in the first
 * subgraph that mentions it, so the subgraph gets a line for it: the node as it is declared, which
 * then leaves the place it was declared at, or its id alone where its shape has to stay. Its flows
 * stay valid, and stay where they are as far as they can: a flow written inside another subgraph
 * before that line would hold the node there, so it is written anew right behind that subgraph,
 * the nodes at its other end staying inside. `linkStyle` statements keep counting the same edges.
 *
 * The source stays as it is when the node is there already, when the part is no node (a subgraph
 * does not move), when the subgraph is not there, and in a swimlane for null unless the source
 * has another node outside the lanes: there every node belongs to a lane.
 */
export function moveFlowInto(source: string, id: string, group: string | null): string {
  const model = readModel(source);
  if (!model || !canMoveInto(model, id, group)) return source;
  const move = startMove(model, id, group);
  for (const statement of new Set(move.mentions.map((mention) => mention.statement)))
    if (statement.scope !== group) moveOutOf(move, statement);
  const result = finishMove(move);
  if (result === undefined || !movedOnly(result, model.chart, id, group)) return source;
  return relinked(result, model.chart.edges.map(signature));
}

/**
 * The source once the statements a move changes are written anew: with the flows behind the
 * subgraphs they leave, and with a line of the node's own where it moves when it needs one.
 */
function finishMove(move: FlowMove): string | undefined {
  const { group } = move,
    lined = needsLine(move);
  if (lined) settleLine(move);
  const behind = placeBehind(rebuildKeeping(move.model, move.changes, move.loose), move.pulled);
  return behind !== undefined && group !== null && lined
    ? heldIn(behind, group, move.text)
    : behind;
}

/**
 * Readies the line of the node's own: into a subgraph it carries the shape of the node's one
 * declaration; out of every subgraph it stands behind the subgraph the node leaves.
 */
function settleLine(move: FlowMove) {
  if (move.group !== null) {
    if (!move.displaced) stripDeclaration(move);
  } else if (move.first)
    move.pulled.set(move.first, [move.text, ...(move.pulled.get(move.first) ?? [])]);
}

/**
 * Whether a node can move into a subgraph, or out of every one with null: it stands elsewhere, the
 * subgraph is there, and a swimlane has another node outside the lanes for null.
 */
function canMoveInto({ chart, statements }: Model, id: string, group: string | null): boolean {
  const node = chart.nodes.get(id);
  if (!node || node.parent === group) return false;
  if (group === null) return chart.kind !== "swimlane" || hasLoose(chart);
  return openingOf(statements, group)?.close !== undefined;
}

/** The statement that opens a subgraph. */
const openingOf = (statements: Statement[], scope: string) =>
  statements.find((item) => item.kind === "subgraph" && item.id === scope);

/** A node on its way into a subgraph, or out of every one, as `moveFlowInto` works it out. */
interface FlowMove {
  model: Model;
  id: string;
  group: string | null;
  mentions: { statement: Statement; ref: Ref }[];
  /** The mentions that write the node with its shape. */
  shaped: { statement: Statement; ref: Ref }[];
  /** The mention of the node inside the subgraph it moves to. */
  there?: { statement: Statement; ref: Ref };
  /** The line from which on the node is held by the subgraph it moves to. */
  anchor: number;
  changes: Map<Statement, string[]>;
  loose: Map<Statement, Ref[]>;
  /** The flows written anew behind each subgraph, by its id. */
  pulled: Map<string, string[]>;
  /** The node as its line is written: its id, or its declaration once that leaves its place. */
  text: string;
  /** Whether the one declaration of the node left the statement it stood in. */
  displaced: boolean;
  /** Whether a flow written anew carries that declaration. */
  carried: boolean;
  /** The subgraph behind which the node is written first. */
  first?: string;
}

/** A move of a node, before any statement is changed. */
function startMove(model: Model, id: string, group: string | null): FlowMove {
  const { statements } = model,
    mentions = mentionsOf(model, id),
    there = mentions.find(({ statement }) => group !== null && statement.scope === group),
    target = group === null ? undefined : openingOf(statements, group);
  return {
    model,
    id,
    group,
    mentions,
    shaped: mentions.filter(({ ref }) => ref.shape || ref.braces),
    there,
    anchor: there ? there.statement.line : target ? statements[target.close!].line : Infinity,
    changes: new Map(),
    loose: new Map(),
    pulled: new Map(),
    text: id,
    displaced: false,
    carried: false,
  };
}

/** The subgraph around a scope behind whose `end` a statement holds the node no longer. */
function outerOf(move: FlowMove, scope: string): string {
  const parent = openingOf(move.model.statements, scope)?.scope ?? null;
  return parent === null || parent === move.group ? scope : outerOf(move, parent);
}

/** Whether a subgraph stands right inside the one the node moves to. */
const landsIn = (move: FlowMove, place: string) =>
  (openingOf(move.model.statements, place)?.scope ?? null) === move.group;

/** The one declaration of the node goes with a statement that no longer holds the node. */
function leaves(move: FlowMove, statement: Statement) {
  if (move.shaped.length !== 1 || move.shaped[0].statement !== statement) return;
  move.text = move.shaped[0].ref.text;
  move.displaced = true;
}

/** Changes a statement outside the subgraph the node moves to that mentions the node. */
function moveOutOf(move: FlowMove, statement: Statement) {
  const { scope } = statement;
  if (!statement.arrows.length && statement.groups[0].length === 1) {
    // A line of its own outside the subgraph: the node leaves it.
    if (move.group !== null && scope === null && move.there) return;
    move.changes.set(statement, []);
    leaves(move, statement);
    if (scope !== null) move.first ??= outerOf(move, scope);
    return;
  }
  if (scope !== null && statement.line < move.anchor) pullFlows(move, statement, scope);
}

/**
 * Takes the node out of a chain inside another subgraph before the line that holds it where it
 * moves, and writes its flows there anew behind that subgraph: chains as far as they went on.
 */
function pullFlows(move: FlowMove, statement: Statement, scope: string) {
  const made = recompose(statement, new Set([move.id]), new Set(), new Map());
  if (!made) return;
  move.changes.set(statement, made.texts);
  if (made.loose.length) move.loose.set(statement, made.loose);
  leaves(move, statement);
  const place = outerOf(move, scope),
    out = move.pulled.get(place) ?? [];
  move.first ??= place;
  out.push(...flowsOf(move, statement, landsIn(move, place)));
  move.pulled.set(place, out);
}

/** The flows of the node in a chain, each chain as far as it goes on; the first carries its declaration where it lands. */
function flowsOf(move: FlowMove, statement: Statement, lands: boolean): string[] {
  const out: string[] = [];
  let tail: string | undefined;
  statement.arrows.forEach((token, index) => {
    for (const from of statement.groups[index])
      for (const to of statement.groups[index + 1]) {
        if (from.id !== move.id && to.id !== move.id) continue;
        const target = carriedName(move, to, lands);
        if (tail === from.id && out.length) out[out.length - 1] += ` ${token.text} ${target}`;
        else out.push(`${carriedName(move, from, lands)} ${token.text} ${target}`);
        tail = to.id;
      }
  });
  return out;
}

/** A node of a flow written anew: by its id, or the moving node by its declaration, once, where the flow lands. */
function carriedName(move: FlowMove, ref: Ref, lands: boolean): string {
  if (ref.id !== move.id || !move.displaced || move.carried || !lands) return ref.id;
  move.carried = true;
  return move.text;
}

/** Whether the node needs a line of its own where it moves: no statement there holds it otherwise. */
function needsLine(move: FlowMove): boolean {
  if (move.displaced && !move.carried) return true;
  if (move.group === null)
    return !move.mentions.some(({ statement }) => statement.scope === null) && !move.pulled.size;
  return !move.there && ![...move.pulled.keys()].some((place) => landsIn(move, place));
}

/** Its one declaration in a flow that stays: the shape moves to the line the subgraph gets. */
function stripDeclaration(move: FlowMove) {
  if (move.shaped.length !== 1 || move.shaped[0].statement.scope === move.group) return;
  const { statement, ref } = move.shaped[0];
  if (move.changes.has(statement)) return;
  move.text = ref.text;
  move.changes.set(statement, [
    patched(statement, ref.idEnd, ref.braces?.end ?? ref.shape!.after, ""),
  ]);
}

/** A source with flows written behind subgraphs, the last first, so that the lines above stay where they are. */
function placeBehind(result: string, pulled: Map<string, string[]>): string | undefined {
  const after = readModel(result);
  if (!after) return undefined;
  const places = [...pulled]
    .map(([place, texts]) => ({ open: openingOf(after.statements, place), texts }))
    .filter((item) => item.texts.length);
  if (places.some((item) => item.open?.close === undefined)) return undefined;
  const lines = [...after.lines];
  for (const { open, texts } of places.toSorted((a, b) => b.open!.line - a.open!.line)) {
    const indent = indentOf(lines[open!.line]);
    lines.splice(after.statements[open!.close!].line + 1, 0, ...texts.map((item) => indent + item));
  }
  return lines.join("\n");
}

/** A source with a line for a node in a subgraph. */
function heldIn(result: string, group: string, text: string): string | undefined {
  const now = readModel(result);
  if (!now) return undefined;
  const place = insertAt(now, group),
    lines = [...now.lines];
  lines.splice(place.at, 0, place.indent + text);
  return lines.join("\n");
}

/** Whether a source reads as a chart did with one node in another subgraph, and the same edges. */
const movedOnly = (result: string, chart: Flowchart, id: string, group: string | null) =>
  keptAs(result, chart, new Map([[id, group]]));

/**
 * Takes a subgraph or lane away and keeps what it holds: its `subgraph` and `end` lines and its
 * `direction` go, the lines between them stand one step less indented in the subgraph around it.
 * The flows to the subgraph itself go with it, and so does what styles it. A swimlane keeps its
 * last lane as long as that holds nodes, since a swimlane has lanes; any other lane leaves its
 * nodes outside the lanes.
 */
export function ungroupFlow(source: string, id: string): string {
  const first = readModel(source),
    found = first && ungroupable(first, id);
  if (!first || !found) return source;
  const { chart } = first,
    { open, close, parent } = found,
    lines = [...first.lines];
  // One step less of indentation between the two lines, then the lines themselves go.
  dedent(lines, open.line, first.statements[close].line);
  const model = readModel(lines.join("\n")),
    result = model && keptInPlace(withoutSubgraph(model, id, close), chart, id, parent);
  if (!result) return source;
  return relinked(
    result,
    chart.edges.map((edge) => (edge.source === id || edge.target === id ? null : signature(edge))),
  );
}

/** A subgraph that can be taken away: its opening statement, the index of its `end`, and the subgraph around it. */
function ungroupable(model: Model, id: string) {
  const group = model.chart.subgraphs.get(id),
    open = openingOf(model.statements, id);
  if (!group || open?.close === undefined || !canUngroup(model, id, open)) return undefined;
  return { open, close: open.close, parent: group.parent };
}

/**
 * Whether a subgraph can be taken away: its `subgraph` and `end` stand on lines of their own, and
 * it is not the last lane of a swimlane while that holds nodes.
 */
function canUngroup({ chart, byLine, statements }: Model, id: string, open: Statement): boolean {
  const held = [...chart.nodes.values()].some((node) => node.parent === id);
  if (chart.kind === "swimlane" && chart.subgraphs.size === 1 && held) return false;
  return (
    byLine.get(open.line)!.length === 1 && byLine.get(statements[open.close!].line)!.length === 1
  );
}

/**
 * A source without a subgraph's `subgraph` and `end` lines and its `direction`, and without the
 * flows to the subgraph itself and what styles it.
 */
function withoutSubgraph(model: Model, id: string, close: number): string {
  const gone = new Set([id]),
    changes = restyled(model, (index) => index, gone),
    loose = recomposeAll(model, gone, new Set(), changes);
  for (const statement of model.statements)
    if (
      (statement.kind === "subgraph" && statement.id === id) ||
      statement.index === close ||
      (statement.kind === "direction" && statement.scope === id)
    )
      changes.set(statement, []);
  return rebuildKeeping(model, changes, loose);
}

/**
 * A source whose nodes stand where they stood, those of a subgraph that went in the subgraph
 * around it: a node another subgraph mentions further down would go there, so it moves back.
 * Undefined where that cannot be.
 */
function keptInPlace(
  result: string,
  chart: Flowchart,
  id: string,
  parent: string | null,
): string | undefined {
  try {
    for (const node of chart.nodes.values())
      if (node.parent === id && parseFlowchart(result).nodes.get(node.id)?.parent !== parent)
        result = moveFlowInto(result, node.id, parent);
    const now = parentsOf(parseFlowchart(result)),
      was = new Map(
        [...parentsOf(chart)]
          .filter(([item]) => item !== id)
          .map(([item, at]) => [item, at === id ? parent : at]),
      );
    return now.size === was.size && [...was].every(([item, at]) => now.get(item) === at)
      ? result
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes anew every chain a change touches, into `changes`; returns the nodes the new chains no
 * longer mention, by statement.
 */
function recomposeAll(
  model: Model,
  gone: Set<string>,
  cut: Set<string>,
  changes: Map<Statement, string[]>,
): Map<Statement, Ref[]> {
  const loose = new Map<Statement, Ref[]>();
  for (const statement of model.statements) {
    if (changes.has(statement) || statement.kind !== "chain") continue;
    const made = recompose(statement, gone, cut, new Map());
    if (!made) continue;
    changes.set(statement, made.texts);
    if (made.loose.length) loose.set(statement, made.loose);
  }
  return loose;
}

/**
 * Wraps nodes in a new subgraph with a name, and returns its id. Nodes that stand together, in
 * one subgraph or in none, are wrapped where they stand: the subgraph opens before the first
 * statement that mentions one of them, takes the statements that are about them alone, and a line
 * for each node those do not mention. Nodes that stand apart, and the nodes of a swimlane, move
 * into a new subgraph or lane as `moveFlowInto` moves them. The id is empty and the source
 * unchanged when none of the ids is a node, or a node cannot move.
 */
export function groupFlowNodes(
  source: string,
  ids: Iterable<string>,
  label: string,
): { source: string; id: string } {
  const model = readModel(source),
    nodes = model ? [...new Set(ids)].filter((id) => model.chart.nodes.has(id)) : [];
  if (!model || !nodes.length) return { source, id: "" };
  return wrapInPlace(model, nodes, label) ?? groupByMoving(source, nodes, label);
}

/**
 * Wraps nodes that stand together in a flowchart where they stand, as `groupFlowNodes` says; null
 * where they stand apart, in a swimlane, or the result would not keep the chart.
 */
function wrapInPlace(
  model: Model,
  nodes: string[],
  label: string,
): { source: string; id: string } | null {
  const { chart } = model,
    parents = new Set(nodes.map((id) => chart.nodes.get(id)!.parent));
  if (chart.kind !== "flowchart" || parents.size !== 1) return null;
  const [parent] = parents,
    { whole, first } = takenStatements(model, new Set(nodes), parent);
  if (!first) return null;
  const id = freshId(chart, "group"),
    changes = new Map<Statement, string[]>(whole.map((item) => [item, []])),
    held = new Set(whole.flatMap((item) => item.groups.flat().map((ref) => ref.id))),
    own = ownLines(
      model,
      nodes.filter((node) => !held.has(node)),
      parent,
      changes,
    ),
    block = [
      `subgraph ${id} [${labelText(label) || "Group"}]`,
      ...[...whole.map((item) => item.text), ...own].map((text) => stepOf(model) + text),
      "end",
    ];
  changes.set(first, [...block, ...(changes.get(first) ?? [first.text])]);
  const result = rebuild(model, changes),
    moved = new Map([[id, parent], ...nodes.map((node): [string, string] => [node, id])]);
  if (!keptAs(result, chart, moved)) return null;
  return { source: relinked(result, chart.edges.map(signature)), id };
}

/**
 * The chains a new subgraph takes, those about its nodes alone, and the statement it opens
 * before. Outside every subgraph a flow holds no node in place, so the subgraph opens where the
 * first statement it takes stood; inside one it opens before the first mention.
 */
function takenStatements(model: Model, inside: Set<string>, parent: string | null) {
  const about = model.statements.filter(
      (item) =>
        item.kind === "chain" &&
        item.scope === parent &&
        item.groups.flat().some((ref) => inside.has(ref.id)),
    ),
    whole = about.filter((item) => item.groups.flat().every((ref) => inside.has(ref.id)));
  return { whole, first: parent === null ? (whole[0] ?? about[0]) : about[0] };
}

/**
 * The lines of a new subgraph for nodes no statement it takes mentions: a node by its id, or by
 * its one declaration in a flow that stays outside, whose shape then moves to its line.
 */
function ownLines(
  model: Model,
  nodes: string[],
  parent: string | null,
  changes: Map<Statement, string[]>,
): string[] {
  const own: string[] = [],
    strips = new Map<Statement, Ref[]>();
  for (const node of nodes) {
    const shaped = mentionsOf(model, node).filter(({ ref }) => ref.shape || ref.braces),
      found = shaped.length === 1 && shaped[0].statement.scope === parent ? shaped[0] : null;
    own.push(found ? found.ref.text : node);
    if (found) strips.set(found.statement, [...(strips.get(found.statement) ?? []), found.ref]);
  }
  for (const [statement, refs] of strips) changes.set(statement, [withoutShapes(statement, refs)]);
  return own;
}

/** A statement with nodes written by their ids alone, from the right so that the places before keep their columns. */
const withoutShapes = (statement: Statement, refs: Ref[]) =>
  refs
    .toSorted((a, b) => b.start - a.start)
    .reduce(
      (text, ref) => text.slice(0, ref.idEnd) + text.slice(ref.braces?.end ?? ref.shape!.after),
      statement.text,
    );

/** Whether a source reads as a chart did but for the parts moved, with the same edges. */
function keptAs(result: string, chart: Flowchart, moved: Map<string, string | null>): boolean {
  try {
    return keeps(result, chart, moved) && sameEdges(parseFlowchart(result), chart);
  } catch {
    return false;
  }
}

/** Groups nodes in a new subgraph or lane by moving each into it; nothing where one cannot move. */
function groupByMoving(source: string, nodes: string[], label: string) {
  const added = addFlowPiece(source, { kind: "group", label, parent: null });
  let result = added.source;
  for (const node of nodes) {
    const moved = moveFlowInto(result, node, added.id);
    if (moved === result) return { source, id: "" };
    result = moved;
  }
  return { source: result, id: added.id };
}

/**
 * An activity diagram's source under the other header: `swimlane-beta` once it has lanes,
 * `flowchart` once it has none, since only the header says whether a subgraph is a lane or a
 * group. The direction stays, and so does every other line: the title, the comments, the
 * statements. The places go: the layout with lanes and the one without stand the nodes apart in
 * other ways, and a node placed for one would be held in a lane it was not placed for.
 */
function reheaded(source: string, kind: Flowchart["kind"]): string {
  const model = readModel(source);
  if (!model || model.chart.kind === kind) return source;
  const lines = [...model.lines];
  lines[model.header] = lines[model.header].replace(
    /^(\s*)(?:flowchart(?:-elk)?|graph|swimlane-beta)/,
    `$1${kind === "swimlane" ? "swimlane-beta" : "flowchart"}`,
  );
  return removePlaces(lines.join("\n"));
}

/** Whether an activity diagram has lanes: a swimlane's subgraphs are its lanes. */
const laned = (chart: Flowchart) => chart.kind === "swimlane" && chart.subgraphs.size > 0;

/**
 * Why a piece cannot be added to an activity diagram as it stands. Lanes and groups do not mix: in
 * a diagram with lanes every subgraph is a lane, so a group has no place there, and a diagram with
 * groups takes its first lane once its groups are gone.
 */
export function activityRefusal(source: string, kind: string): string | undefined {
  let chart: Flowchart;
  try {
    chart = parseFlowchart(source);
  } catch {
    return undefined;
  }
  if (kind === "group" && laned(chart))
    return "Lanes and groups do not mix: this diagram has lanes, add a lane instead";
  if (kind === "lane" && chart.kind === "flowchart" && chart.subgraphs.size)
    return "Lanes and groups do not mix: ungroup the groups of this diagram to add a lane";
  return undefined;
}

/**
 * Adds a piece to an activity diagram as `addFlowPiece` does. The first lane makes the diagram one
 * with lanes: its header becomes `swimlane-beta`, and the nodes outside the new lane stand in the
 * lane without a name. A group added to a `swimlane-beta` source without lanes makes it a
 * flowchart again. A piece `activityRefusal` refuses is not added: the id is empty.
 */
function addActivityPiece(
  source: string,
  piece: { kind: string; label?: string; parent?: string | null },
): { source: string; id: string } {
  if (activityRefusal(source, piece.kind)) return { source, id: "" };
  const chart = parseFlowchart(source),
    kind =
      piece.kind === "lane"
        ? "swimlane"
        : piece.kind === "group" && !chart.subgraphs.size
          ? "flowchart"
          : chart.kind;
  return addFlowPiece(reheaded(source, kind), { ...piece, kind: piece.kind as FlowPiece });
}

/** A source that had lanes and has none left after an edit: a flowchart again. */
function unlaned(before: string, after: string): string {
  try {
    return laned(parseFlowchart(before)) && !laned(parseFlowchart(after))
      ? reheaded(after, "flowchart")
      : after;
  } catch {
    return after;
  }
}

/**
 * Takes a subgraph away as `ungroupFlow` does. The last lane of a diagram with lanes goes too,
 * with what it holds kept: the diagram becomes a flowchart without lanes.
 */
function ungroupActivity(source: string, id: string): string {
  const chart = parseFlowchart(source);
  if (!laned(chart) || chart.subgraphs.size > 1 || !chart.subgraphs.has(id))
    return ungroupFlow(source, id);
  const flat = reheaded(source, "flowchart"),
    made = ungroupFlow(flat, id);
  return made === flat ? source : made;
}

/**
 * Activity diagrams as a structure a canvas edits, with lanes and without: it says of each
 * subgraph what it is, a `lane` under a `swimlane-beta` header and a `group` under a `flowchart`
 * one, and changes the header as the first lane comes and the last one goes.
 */
export const activityStructure: Structure = {
  pieces: [
    {
      kind: "step",
      name: "Action",
      about: "Executable node of the activity",
      joins: "after",
      named: true,
    },
    {
      kind: "decision",
      name: "Decision",
      about: "Decision node: outgoing flows are selected by their guards",
      joins: "after",
      named: true,
    },
    {
      kind: "start",
      name: "Initial node",
      about: "Starts the control flow of the activity",
      joins: "before",
    },
    { kind: "end", name: "Final node", about: "Activity final: ends all flows", joins: "after" },
    {
      kind: "lane",
      name: "Lane",
      about: "Activity partition: the agent responsible for its actions",
      group: true,
      named: true,
    },
    {
      kind: "group",
      name: "Group",
      about: "Frame grouping activity nodes",
      group: true,
      named: true,
    },
  ],
  links: [
    { kind: "flow", name: "Flow" },
    { kind: "dotted", name: "Dotted flow" },
    { kind: "thick", name: "Thick flow" },
  ],
  refusal: activityRefusal,
  read(source) {
    const chart = parseFlowchart(source);
    const kindOf = (shape: string) =>
      shape === "diamond"
        ? "decision"
        : shape === "initial"
          ? "start"
          : shape === "final" || shape === "flow-final"
            ? "end"
            : "step";
    return {
      nodes: chart.order.flatMap((id): StructureNode[] => {
        const group = chart.subgraphs.get(id),
          node = chart.nodes.get(id);
        return group
          ? [{ ...group, group: true, kind: chart.kind === "swimlane" ? "lane" : "group" }]
          : node
            ? [
                {
                  id,
                  label: node.label,
                  parent: node.parent,
                  line: node.line,
                  group: false,
                  kind: kindOf(node.shape),
                },
              ]
            : [];
      }),
      edges: chart.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        line: edge.line,
        kind: edge.stroke === "dotted" ? "dotted" : edge.stroke === "thick" ? "thick" : "flow",
      })),
    };
  },
  add: addActivityPiece,
  connect: (source, from, to, kind) => connectFlow(source, from, to, undefined, kind),
  join: (source, from, to, kind) => joinFlow(source, from, to, kind),
  rename: renameFlow,
  retitle: retitleFlow,
  label: labelFlowEdge,
  relink: restrokeFlow,
  remove: (source, ids) => unlaned(source, removeFlow(source, ids)),
  reverse: reverseFlow,
  copy: duplicateFlowNode,
  moveInto: moveFlowInto,
  ungroup: ungroupActivity,
  reid: renameFlowId,
};
