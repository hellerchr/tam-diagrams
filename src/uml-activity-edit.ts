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
import { removePlaces } from "./uml-places.ts";

/** What a canvas adds to an activity diagram. */
export type FlowPiece = "step" | "decision" | "start" | "end" | "group" | "lane";

const linesOf = (source: string) => source.replace(/\r\n?/g, "\n").split("\n");

const indentOf = (line: string) => line.match(/^\s*/)![0];

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
    ref: Ref = { id, start, idEnd, end: idEnd, text: id };
  const opener = DELIMITERS.find(([open]) => text.startsWith(open, idEnd));
  if (opener) {
    const [open, closes] = opener,
      inner = idEnd + open.length,
      body = blank(text, inner);
    let close: { at: number; text: string } | undefined;
    if (text[body] === '"') {
      const quote = text.indexOf('"', body + 1);
      if (quote < 0) return null;
      const after = blank(text, quote + 1),
        found = closes.find((item) => text.startsWith(item, after));
      if (!found) return null;
      close = { at: after, text: found };
    } else {
      // The earliest closing delimiter ends the text.
      for (const item of closes) {
        const at = text.indexOf(item, inner);
        if (at >= 0 && (!close || at < close.at)) close = { at, text: item };
      }
      if (!close) return null;
    }
    ref.end = close.at + close.text.length;
    ref.shape = { open, start: inner, end: close.at, after: ref.end };
  }
  const braces = text.slice(ref.end).match(/^@\{([^}]*)\}/);
  if (braces) {
    const at = ref.end + 2;
    ref.braces = { start: ref.end, end: ref.end + braces[0].length };
    for (const entry of braces[1].matchAll(/(\w+)\s*:\s*("(?:[^"]*)"|[^,]+)/g))
      if (entry[1] === "label") {
        const value = entry[2].trimEnd(),
          valueAt = at + entry.index + entry[0].length - entry[2].length;
        ref.braces.label = { start: valueAt, end: valueAt + value.length };
      }
    ref.end = ref.braces.end;
  }
  const css = text.slice(ref.end).match(/^:::[\w-]+/);
  if (css) ref.end += css[0].length;
  ref.text = text.slice(start, ref.end);
  return ref;
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
  let depth = 0,
    quote = false,
    start = from;
  const take = (end: number) => {
    const piece = text.slice(start, end),
      lead = piece.length - piece.trimStart().length;
    if (piece.trim()) out.push({ start: start + lead, end: start + lead + piece.trim().length });
  };
  for (let at = from; at < text.length; at++) {
    const c = text[at];
    if (c === '"') quote = !quote;
    else if (!quote && "[({".includes(c)) depth++;
    else if (!quote && "])}".includes(c)) depth = Math.max(0, depth - 1);
    else if (!quote && !depth && c === ";") {
      take(at);
      start = at + 1;
    }
  }
  take(text.length);
  return out;
}

/**
 * Reads a source as statements with the places of their nodes and arrows, each arrow with the edges
 * the parser made of it. Null when the statements cannot be matched with what the parser read.
 */
function readModel(source: string): Model | null {
  const chart = parseFlowchart(source),
    lines = linesOf(source),
    rows = scan(source).lines,
    header = rows[0].line - 1;
  const head =
    lines[header].match(/^\s*(?:flowchart(?:-elk)?|graph|swimlane-beta)\s*[^\s;]*/)?.[0].length ??
    lines[header].length;
  const places = [
    ...split(lines[header], head).map((place) => ({ ...place, line: header })),
    ...rows
      .slice(1)
      .flatMap(({ line }) =>
        split(lines[line - 1], 0).map((place) => ({ ...place, line: line - 1 })),
      ),
  ];
  const statements: Statement[] = [],
    byLine = new Map<number, Statement[]>(),
    stack: Statement[] = [],
    accessibility = accessibilityLines();
  let anonymous = 0,
    edge = 0;
  for (const place of places) {
    const text = lines[place.line].slice(place.start, place.end),
      statement: Statement = {
        ...place,
        index: statements.length,
        text,
        kind: "other",
        scope: stack.at(-1)?.id ?? null,
        groups: [],
        arrows: [],
        edges: [],
      };
    statements.push(statement);
    byLine.set(place.line, [...(byLine.get(place.line) ?? []), statement]);
    if (accessibility(text)) continue;
    const subgraph = text.match(/^subgraph(?:\s+(.*))?$/);
    if (/^direction\s+(TB|TD|BT|LR|RL)$/i.test(text)) statement.kind = "direction";
    else if (text === "end") {
      statement.kind = "end";
      const opened = stack.pop();
      if (!opened) return null;
      opened.close = statement.index;
    } else if (subgraph) {
      const spec = (subgraph[1] ?? "").trim(),
        bracket = spec.match(/^(\S+?)\s*\[(.*)\]$/);
      statement.kind = "subgraph";
      statement.form = bracket
        ? "bracket"
        : /^".*"$/.test(spec)
          ? "quoted"
          : spec
            ? "plain"
            : "bare";
      statement.id =
        statement.form === "bracket"
          ? bracket![1]
          : statement.form === "plain"
            ? spec
            : `subgraph#${++anonymous}`;
      stack.push(statement);
    } else if (STYLING.test(text)) statement.kind = "styling";
    else {
      const chain = readChain(text);
      if (!chain) return null;
      statement.kind = "chain";
      statement.groups = chain.groups;
      statement.arrows = chain.arrows;
      for (let index = 0; index < chain.arrows.length; index++) {
        const own: FlowEdge[] = [];
        for (const from of chain.groups[index])
          for (const to of chain.groups[index + 1]) {
            const found = chart.edges[edge++];
            if (!found || found.source !== from.id || found.target !== to.id) return null;
            own.push(found);
          }
        statement.edges.push(own);
      }
    }
  }
  if (edge !== chart.edges.length || stack.length) return null;
  return { chart, lines, statements, byLine, header };
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
function arrowWith(token: string, change: { label?: string; stroke?: FlowEdge["stroke"] }): string {
  const named = token.match(NAMED)?.[0] ?? "",
    rest = token.slice(named.length),
    inline = rest.match(INLINE);
  if (inline) {
    const [, start, open, text, close] = inline,
      was = open === "==" ? "thick" : open === "-." ? "dotted" : "solid",
      stroke = change.stroke ?? was,
      last = close.at(-1)!,
      end = /[>ox]/.test(last) ? last : "";
    if (change.label !== undefined && !change.label.trim())
      return named + operator(start, stroke, end);
    const words = change.label === undefined ? text : escapeLabel(change.label),
      [head, tail] =
        stroke === was
          ? [open, close]
          : stroke === "thick"
            ? ["==", `==${end || "="}`]
            : stroke === "dotted"
              ? ["-.", `.-${end}`]
              : ["--", `--${end || "-"}`],
      made = `${start}${head} ${words} ${tail}`,
      read = `${made} x`.match(INLINE);
    if (read?.[0].length === made.length && read[3] === words && !/[;|[\](){}]/.test(words))
      return named + made;
    return named + operator(start, stroke, end) + pipeText(change.label ?? shownText(text));
  }
  const plain = rest.match(INVISIBLE) ?? rest.match(PLAIN);
  if (!plain) return token;
  const [all, start = "", body = "~", mark = ""] = plain,
    was = body.startsWith("~")
      ? "invisible"
      : body.startsWith("=")
        ? "thick"
        : body.includes(".")
          ? "dotted"
          : "solid",
    line =
      change.stroke && change.stroke !== was
        ? operator(start, change.stroke, /[>ox]/.test(mark) ? mark : "")
        : all,
    text =
      change.label === undefined
        ? rest.slice(all.length)
        : change.label.trim()
          ? pipeText(change.label)
          : "";
  return named + line + text;
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
  const { groups, text } = statement;
  if (
    !groups.flat().some((ref) => gone.has(ref.id)) &&
    !statement.edges.flat().some((edge) => cut.has(edge.id) || arrows.has(edge.id))
  )
    return undefined;
  interface Part {
    from: Ref[];
    to: Ref[];
    arrow: string;
  }
  // Each arrow as the parts that are left of it: sources with the same targets under one arrow.
  const parts = statement.arrows.map((token, index) => {
    const bySource: Part[][] = [];
    let count = 0;
    for (const from of groups[index]) {
      const own: Part[] = [];
      for (const to of groups[index + 1]) {
        const edge = statement.edges[index][count++];
        if (gone.has(from.id) || gone.has(to.id) || cut.has(edge.id)) continue;
        const arrow = arrows.get(edge.id) ?? token.text,
          last = own.at(-1);
        if (last?.arrow === arrow) last.to.push(to);
        else own.push({ from: [from], to: [to], arrow });
      }
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
    return bySource.flat();
  });
  const texts: string[] = [],
    written = new Set<Ref>();
  // A group as it was written when all of it stays; a node carries its shape where it is written first.
  const groupText = (refs: Ref[], index: number) => {
    const whole = groups[index];
    if (same(refs, whole) && !refs.some((ref) => written.has(ref))) {
      for (const ref of refs) written.add(ref);
      return text.slice(whole[0].start, whole.at(-1)!.end);
    }
    return refs
      .map((ref) => (written.has(ref) ? ref.id : (written.add(ref), ref.text)))
      .join(" & ");
  };
  let run = "",
    tail: Ref[] | undefined;
  parts.forEach((list, index) => {
    for (const part of list) {
      // A part goes on from the one before it when it starts with the nodes that one ends with.
      if (!tail || !same(tail, part.from)) {
        if (run) texts.push(run);
        run = groupText(part.from, index);
      }
      const token = statement.arrows[index];
      run +=
        (text.slice(groups[index].at(-1)!.end, token.start) || " ") +
        part.arrow +
        text.slice(token.end, groups[index + 1][0].start) +
        groupText(part.to, index + 1);
      tail = part.to;
    }
    if (!list.length) tail = undefined;
  });
  if (run) texts.push(run);
  const loose: Ref[] = [];
  for (const ref of groups.flat()) {
    if (written.has(ref) || gone.has(ref.id)) continue;
    if (ref.shape || ref.braces) texts.push(ref.text);
    else loose.push(ref);
  }
  return { texts, loose };
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
  const places = new Map<string, { statement: Statement; ref: Ref }[]>();
  for (const [statement, refs] of loose)
    for (const ref of refs)
      if (model.chart.nodes.has(ref.id))
        places.set(ref.id, [...(places.get(ref.id) ?? []), { statement, ref }]);
  const kept = new Map(changes);
  let added = false;
  for (const [id, found] of places) {
    const node = model.chart.nodes.get(id)!,
      now = after?.nodes.get(id),
      inside = found.find((place) => place.statement.scope === node.parent);
    const place = !now ? (inside ?? found[0]) : now.parent !== node.parent ? inside : undefined;
    if (!place) continue;
    kept.set(place.statement, [...kept.get(place.statement)!, place.ref.text]);
    added = true;
  }
  return added ? rebuild(model, kept, drop) : plain;
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
  if (list) {
    const ids = list[3].split(","),
      kept = ids.filter((id) => !gone.has(id));
    if (kept.length === ids.length) return text;
    return kept.length ? list[1] + list[2] + kept.join(",") + list[4] : null;
  }
  const click = text.match(/^click\s+(\S+)/);
  if (click) return gone.has(click[1]) ? null : text;
  const link = text.match(/^(linkStyle\s+)(\d+(?:\s*,\s*\d+)*)([\s\S]*)$/);
  if (link) {
    const before = link[2].split(",").map((item) => Number(item.trim())),
      now = before.map(edge).filter((item) => item !== null);
    if (now.length === before.length && now.every((item, index) => item === before[index]))
      return text;
    return now.length ? link[1] + now.join(",") + link[3] : null;
  }
  return text;
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
function freshId(chart: Flowchart, base: string): string {
  for (let count = 1; ; count++) {
    const id = `${base}${count}`;
    if (!chart.nodes.has(id) && !chart.subgraphs.has(id)) return id;
  }
}

/**
 * Where a statement is added, and with which indent: inside a subgraph before its `end`, else at
 * the end of the source; before the styling (`classDef`, `class`, `style`, `linkStyle`, `click`)
 * that closes either.
 */
function insertAt(model: Model, parent: string | null): { at: number; indent: string } {
  const { lines, statements, byLine } = model,
    group = parent
      ? statements.find((item) => item.kind === "subgraph" && item.id === parent)
      : undefined,
    end = group?.close === undefined ? undefined : statements[group.close];
  const inside = group && end && end.line > group.line && byLine.get(end.line)![0] === end;
  const from = inside ? group.line + 1 : model.header + 1,
    to = inside ? end.line : lines.length;
  let last = -1,
    first = -1,
    styled = false;
  for (let index = from; index < to; index++) {
    const own = byLine.get(index);
    if (!own) continue;
    if (first < 0) first = index;
    if (own.every((statement) => statement.kind === "styling")) styled = true;
    else {
      last = index;
      styled = false;
    }
  }
  let at = to;
  if (styled) at = last < 0 ? from : last + 1;
  else if (!inside) while (at > 0 && !lines[at - 1].trim()) at--;
  const indent = inside
    ? first >= 0
      ? indentOf(lines[first])
      : `${indentOf(lines[group.line])}  `
    : first >= 0
      ? indentOf(lines[first])
      : "  ";
  return { at, indent };
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
  const label = name?.trim() ? labelText(name) : "";
  if (kind === "decision") return `${id}{${label || " "}}`;
  if (kind === "start" || kind === "end") {
    if (alone) {
      const text = name?.trim() ? `, label: "${escapeLabel(name).replace(/\}/g, "#125;")}"` : "";
      return `${id}@{ shape: ${kind === "start" ? "start" : "stop"}${text} }`;
    }
    return kind === "start" ? `${id}((${label || "Start"}))` : `${id}(((${label || "End"})))`;
  }
  return chart.kind === "swimlane" ? `${id}(${label || "Step"})` : `${id}[${label || "Step"}]`;
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
    given = piece.parent && chart.subgraphs.has(piece.parent) ? piece.parent : null,
    loose = [...chart.nodes.values()].some((node) => !node.parent);
  const parent = lane
    ? null
    : (given ??
      (chart.kind === "swimlane" && !loose ? ([...chart.subgraphs.keys()][0] ?? null) : null));
  const id = freshId(chart, group ? (lane ? "lane" : "group") : piece.kind),
    label = piece.label?.trim() ? labelText(piece.label) : "",
    place = insertAt(model, parent);
  if (lane) {
    // Beside the other lanes: after the `end` of the last one.
    const ends = model.statements
      .filter((item) => item.kind === "subgraph" && item.close !== undefined)
      .map((item) => model.statements[item.close!].line);
    if (ends.length) place.at = Math.max(...ends) + 1;
  }
  const text = group
    ? [`subgraph ${id} [${label || (lane ? "Lane" : "Group")}]`, "end"]
    : [nodeText(chart, piece.kind, id, piece.label, true)];
  lines.splice(place.at, 0, ...text.map((line) => place.indent + line));
  return { source: lines.join("\n"), id };
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
  if (chart.kind === "swimlane" && (chart.subgraphs.has(from) || chart.subgraphs.has(to)))
    return source;
  if (
    chart.edges.some(
      (edge) =>
        edge.source === from &&
        edge.target === to &&
        edge.stroke === stroke &&
        (!text || edge.label === shownText(escapeLabel(text))),
    )
  )
    return source;
  const shared = around(chart, to),
    { at, indent } = insertAt(model, around(chart, from).find((id) => shared.includes(id)) ?? null);
  // The edges after the new one count one further.
  const before = chart.edges.filter((edge) => edge.line <= at).length,
    changes = new Map<Statement, string[]>();
  for (const statement of model.statements) {
    if (statement.kind !== "styling") continue;
    const styled = restyle(statement.text, new Set(), (index) =>
      index >= before ? index + 1 : index,
    );
    if (styled !== null && styled !== statement.text) changes.set(statement, [styled]);
  }
  const lines = linesOf(rebuild(model, changes));
  lines.splice(
    at,
    0,
    `${indent}${from} ${operator("", stroke, ">")}${text ? pipeText(text) : ""} ${to}`,
  );
  return lines.join("\n");
}

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
  const { chart, statements } = model,
    text = labelText(label),
    empty = !label.trim();
  const group = statements.find((item) => item.kind === "subgraph" && item.id === id);
  if (group) {
    if (empty) return source;
    const whole =
      group.form === "bracket" || (group.form === "plain" && /^\S+$/.test(id))
        ? `subgraph ${id} [${text}]`
        : `subgraph "${escapeLabel(label)}"`;
    return rebuild(model, new Map([[group, [whole]]]));
  }
  if (!chart.nodes.has(id)) return source;
  const mentions = statements.flatMap((statement) =>
    statement.groups.flat().flatMap((ref) => (ref.id === id ? [{ statement, ref }] : [])),
  );
  const shaped = mentions.find(({ ref }) => ref.shape),
    braced = mentions.find(({ ref }) => ref.braces);
  if (shaped) {
    const { statement, ref } = shaped,
      shape = ref.shape!;
    const whole =
      empty && shape.open === "["
        ? patched(statement, ref.idEnd, shape.after, "")
        : patched(statement, shape.start, shape.end, empty ? " " : text);
    return rebuild(model, new Map([[statement, [whole]]]));
  }
  if (braced) {
    const { statement, ref } = braced,
      braces = ref.braces!,
      inner = `"${escapeLabel(label).replace(/\}/g, "#125;")}"`;
    if (braces.label)
      return rebuild(
        model,
        new Map([[statement, [patched(statement, braces.label.start, braces.label.end, inner)]]]),
      );
    if (empty) return source;
    const body = statement.text.slice(braces.start + 2, braces.end - 1).trimEnd(),
      entry = `${body}${body.trim() ? "," : ""} label: ${inner} `;
    return rebuild(
      model,
      new Map([[statement, [patched(statement, braces.start + 2, braces.end - 1, entry)]]]),
    );
  }
  const [first] = mentions;
  if (!first || empty) return source;
  return rebuild(
    model,
    new Map([
      [first.statement, [patched(first.statement, first.ref.idEnd, first.ref.idEnd, `[${text}]`)]],
    ]),
  );
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
    if (statement.kind === "chain") {
      let text = statement.text;
      // From the right, so the places before keep their columns.
      for (const ref of statement.groups.flat().toReversed())
        if (ref.id === id) text = text.slice(0, ref.start) + next + text.slice(ref.idEnd);
      if (text !== statement.text) changes.set(statement, [text]);
    } else if (statement.kind === "subgraph" && statement.id === id) {
      const bracket = statement.text.match(/^subgraph\s+\S+?(\s*\[.*\])$/);
      changes.set(statement, [heading ?? `subgraph ${next}${bracket ? bracket[1] : ""}`]);
    } else if (statement.kind === "styling") {
      const list = statement.text.match(/^(style|class)(\s+)(\S+)([\s\S]*)$/),
        click = statement.text.match(/^(click\s+)(\S+)([\s\S]*)$/);
      const text = list
        ? list[1] +
          list[2] +
          list[3]
            .split(",")
            .map((item) => (item === id ? next : item))
            .join(",") +
          list[4]
        : click?.[2] === id
          ? click[1] + next + click[3]
          : statement.text;
      if (text !== statement.text) changes.set(statement, [text]);
    }
  }
  return rebuild(model, changes);
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
  const free = (candidate: string | null) =>
    candidate !== null &&
    !RESERVED.has(candidate) &&
    !chart.nodes.has(candidate) &&
    !chart.subgraphs.has(candidate);
  // A subgraph named with one word is that word, as id and as name.
  const word = chart.subgraphs.has(id) && /^[A-Za-z]\w*$/.test(name.trim()) ? name.trim() : null,
    next = free(word) ? word : idOf(name);
  if (!free(next)) return { source: named, id };
  const moved = reidentify(named, id, next!, next === word ? `subgraph ${next}` : undefined);
  try {
    const after = parseFlowchart(moved);
    if (after.nodes.has(next!) || after.subgraphs.has(next!)) return { source: moved, id: next! };
  } catch {
    // The name gives no id the source can hold: the part keeps its own.
  }
  return { source: named, id };
}

/** The source with one edge under another arrow, written in place where the edge has an arrow of its own. */
function rearrow(
  source: string,
  edge: string,
  change: { label?: string; stroke?: FlowEdge["stroke"] },
): string {
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
  const { chart, statements } = model,
    named = new Set(ids);
  const gone = new Set<string>(),
    changes = new Map<Statement, string[]>(),
    drop = new Set<number>();
  const take = (id: string) => {
    if (!chart.subgraphs.has(id) || gone.has(id)) return;
    gone.add(id);
    for (const node of chart.nodes.values()) if (node.parent === id) gone.add(node.id);
    for (const other of chart.subgraphs.values()) if (other.parent === id) take(other.id);
    const opening = statements.find((item) => item.kind === "subgraph" && item.id === id);
    if (opening?.close === undefined) return;
    const end = statements[opening.close];
    // Its own statements go: the opening, the `end`, and what is said of it in between.
    for (let index = opening.index; index <= end.index; index++)
      if (statements[index].kind !== "chain") changes.set(statements[index], []);
    for (let line = opening.line + 1; line < end.line; line++)
      if (!model.byLine.has(line) && !LEVEL.test(model.lines[line].trim())) drop.add(line);
  };
  for (const id of named) {
    if (chart.nodes.has(id)) gone.add(id);
    else take(id);
  }
  const cut = new Set(chart.edges.filter((edge) => named.has(edge.id)).map((edge) => edge.id));
  // The number of each edge that stays, among those that stay.
  const numbers = new Map<number, number>();
  chart.edges.forEach((edge, index) => {
    if (!cut.has(edge.id) && !gone.has(edge.source) && !gone.has(edge.target))
      numbers.set(index, numbers.size);
  });
  const loose = new Map<Statement, Ref[]>();
  for (const statement of statements) {
    if (changes.has(statement)) continue;
    if (statement.kind === "chain") {
      const made = recompose(statement, gone, cut, new Map());
      if (!made) continue;
      changes.set(statement, made.texts);
      if (made.loose.length) loose.set(statement, made.loose);
    } else if (statement.kind === "styling") {
      const styled = restyle(statement.text, gone, (index) => numbers.get(index) ?? null);
      if (styled !== statement.text) changes.set(statement, styled === null ? [] : [styled]);
    }
  }
  return rebuildKeeping(model, changes, loose, drop);
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
  const places = new Map<string, number[]>();
  model.chart.edges.forEach((edge, index) => {
    const key = signature(edge);
    places.set(key, [...(places.get(key) ?? []), index]);
  });
  const taken = new Map<string, number>(),
    now = before.map((key) => {
      if (key === null) return null;
      const count = taken.get(key) ?? 0;
      taken.set(key, count + 1);
      return places.get(key)?.[count] ?? null;
    }),
    changes = new Map<Statement, string[]>();
  for (const statement of model.statements) {
    if (statement.kind !== "styling") continue;
    const styled = restyle(statement.text, new Set(), (index) => now[index] ?? null);
    if (styled !== statement.text) changes.set(statement, styled === null ? [] : [styled]);
  }
  return rebuild(model, changes);
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
  const texts = [...made.texts];
  let loose = made.loose;
  const end = (ref: Ref) => {
    loose = loose.filter((item) => item.id !== ref.id);
    const alone = ref.shape || ref.braces ? texts.indexOf(ref.text) : -1;
    if (alone < 0) return ref.id;
    texts.splice(alone, 1);
    return ref.text;
  };
  const token = statement.arrows[arrow],
    ends = [end(wire.from), end(wire.to)];
  // After the statements that hold the edges before it.
  let slot = 0,
    count = 0;
  while (slot < texts.length && count < wire.order) count += edgeCount(texts[slot++]);
  // A node carries its shape where it is written first: here, when the rest follows.
  [wire.from, wire.to].forEach((ref, index) => {
    if (ends[index] !== ref.id || ref.text === ref.id) return;
    for (let later = slot; later < texts.length; later++) {
      const at = texts[later].indexOf(ref.text);
      if (at < 0 || (at > 0 && !/[\s&>|.=ox-]/.test(texts[later][at - 1]))) continue;
      texts[later] = texts[later].slice(0, at) + ref.id + texts[later].slice(at + ref.text.length);
      ends[index] = ref.text;
      return;
    }
  });
  const text = write(ends[0], ends[1], {
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
    { statement } = wire,
    id = freshId(chart, piece.kind),
    text = nodeText(chart, piece.kind, id, piece.label),
    mark = { arrow: ">", circle: "o", cross: "x" }[wire.edge.end ?? "arrow"],
    second = operator("", wire.edge.stroke, wire.edge.end ? mark : ""),
    token = statement.arrows[wire.arrow],
    half = `${headed(token.text)} ${text} ${second}`;
  const result =
    statement.edges[wire.arrow].length === 1
      ? rebuild(model, new Map([[statement, [patched(statement, token.start, token.end, half)]]]))
      : rewired(
          model,
          wire,
          (from, to, arrow) => `${from}${arrow.before}${half}${arrow.after}${to}`,
        );
  let after: Flowchart;
  try {
    after = parseFlowchart(result);
  } catch {
    return none;
  }
  const made = after.nodes.get(id);
  if (!made || after.edges.length !== chart.edges.length + 1) return none;
  const loose = [...chart.nodes.values()].some((node) => !node.parent),
    lane =
      chart.kind === "swimlane" && !made.parent && !loose
        ? (chart.nodes.get(wire.edge.source)?.parent ?? chart.nodes.get(wire.edge.target)?.parent)
        : null,
    placed = lane ? moveFlowInto(result, id, lane) : result;
  if (!keeps(placed, after, new Map([[id, lane ?? made.parent]]))) return none;
  const first: FlowEdge = { ...wire.edge, target: id, end: wire.edge.end && "arrow" };
  return {
    source: relinked(
      placed,
      chart.edges.map((item) => signature(item === wire.edge ? first : item)),
    ),
    id,
  };
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
  const id = freshId(chart, piece.kind),
    text = nodeText(chart, piece.kind, id, piece.label),
    place = insertAt(model, anchor.parent),
    lines = [...model.lines];
  lines.splice(
    place.at,
    0,
    place.indent + (piece.kind === "start" ? `${text} --> ${at}` : `${at} --> ${text}`),
  );
  const result = lines.join("\n");
  if (keeps(result, chart, new Map([[id, anchor.parent]]), 1)) {
    const edge = parseFlowchart(result).edges.find(
      (item) => item.line === place.at + 1 && (item.source === id || item.target === id),
    );
    if (edge) return { source: relinked(result, chart.edges.map(signature)), id, edge: edge.id };
  }
  // Where one statement cannot put the node beside the other: declared there, then joined.
  const added = addFlowPiece(source, { ...piece, parent: anchor.parent });
  if (!added.id) return none;
  const joined =
    piece.kind === "start"
      ? joinFlow(added.source, added.id, at)
      : joinFlow(added.source, at, added.id);
  return joined.edge ? { ...joined, id: added.id } : none;
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
  if (!model) return source;
  const { chart } = model,
    group = model.statements.find((item) => item.kind === "subgraph" && item.id === id);
  if (
    (!chart.nodes.has(id) && !group) ||
    !canBeId(next) ||
    chart.nodes.has(next) ||
    chart.subgraphs.has(next)
  )
    return source;
  let heading: string | undefined;
  if (group) {
    const { label } = chart.subgraphs.get(id)!;
    if (group.form === "bare") return source;
    // A subgraph whose name is its id is written by the id alone.
    if (label === next) heading = `subgraph ${next}`;
    else if (group.form !== "bracket") heading = `subgraph ${next} [${labelText(label)}]`;
  }
  const result = reidentify(source, id, next, heading);
  try {
    const after = parseFlowchart(result),
      was = chart.nodes.get(id) ?? chart.subgraphs.get(id)!,
      now = after.nodes.get(next) ?? after.subgraphs.get(next);
    const named = (item: string) => (item === id ? next : item);
    return now &&
      now.label ===
        (chart.nodes.has(id) && was.label === id && !declared(model, id) ? next : was.label) &&
      after.nodes.size === chart.nodes.size &&
      after.subgraphs.size === chart.subgraphs.size &&
      [...parentsOf(chart)].every(
        ([item, parent]) => parentsOf(after).get(named(item)) === (parent && named(parent)),
      ) &&
      after.edges.map(signature).join("\n") ===
        chart.edges
          .map((edge) =>
            signature({ ...edge, source: named(edge.source), target: named(edge.target) }),
          )
          .join("\n")
      ? result
      : source;
  } catch {
    return source;
  }
}

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
  const node = chart.nodes.get(id),
    numbered = id.match(/^(.*?)(\d+)$/);
  if (!node || !numbered || Number(numbered[2]) < 2) return false;
  return [...chart.nodes.values()].some(
    (other) =>
      other.id !== id &&
      other.id.replace(/\d+$/, "") === numbered[1] &&
      (node.label === other.label || node.label === other.id),
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
    mentions = mentionsOf(model, id),
    { ref } = mentions.find((item) => item.ref.shape || item.ref.braces) ?? mentions[0],
    base = id.replace(/\d+$/, "") || id;
  let copy = "";
  for (let count = 2; !copy; count++)
    if (!chart.nodes.has(`${base}${count}`) && !chart.subgraphs.has(`${base}${count}`))
      copy = `${base}${count}`;
  if (!canBeId(copy)) return none;
  // A node written by its id alone shows that id: the copy shows it too.
  const text =
      ref.shape || ref.braces
        ? copy + ref.text.slice(id.length)
        : `${copy}[${labelText(node.label)}]${ref.text.slice(id.length)}`,
    place = insertAt(model, node.parent),
    lines = [...model.lines];
  lines.splice(place.at, 0, place.indent + text);
  const result = lines.join("\n");
  return keeps(result, chart, new Map([[copy, node.parent]])) ? { source: result, id: copy } : none;
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
  if (!model) return source;
  const { chart, statements } = model,
    node = chart.nodes.get(id);
  if (!node || node.parent === group || (group !== null && !chart.subgraphs.has(group)))
    return source;
  if (
    group === null &&
    chart.kind === "swimlane" &&
    ![...chart.nodes.values()].some((other) => !other.parent)
  )
    return source;
  const opening = (scope: string) =>
      statements.find((item) => item.kind === "subgraph" && item.id === scope),
    target = group === null ? undefined : opening(group);
  if (group !== null && target?.close === undefined) return source;
  const mentions = mentionsOf(model, id),
    shaped = mentions.filter(({ ref }) => ref.shape || ref.braces),
    alone = (statement: Statement) => !statement.arrows.length && statement.groups[0].length === 1,
    there = mentions.find(({ statement }) => group !== null && statement.scope === group),
    // The line from which on the node is held by the subgraph it moves to.
    anchor = there ? there.statement.line : target ? statements[target.close!].line : Infinity;
  /** The subgraph around a scope behind whose `end` a statement holds the node no longer. */
  const outer = (scope: string): string => {
    const parent = opening(scope)?.scope ?? null;
    return parent === null || parent === group ? scope : outer(parent);
  };
  const changes = new Map<Statement, string[]>(),
    loose = new Map<Statement, Ref[]>(),
    pulled = new Map<string, string[]>(),
    seen = new Set<Statement>();
  let text = id,
    displaced = false,
    carried = false,
    first: string | undefined;
  // The one declaration of the node goes with a statement that no longer holds the node.
  const leaves = (statement: Statement) => {
    if (shaped.length !== 1 || shaped[0].statement !== statement) return;
    text = shaped[0].ref.text;
    displaced = true;
  };
  for (const { statement } of mentions) {
    if (seen.has(statement)) continue;
    seen.add(statement);
    const scope = statement.scope;
    if (scope === group) continue;
    if (alone(statement)) {
      // A line of its own outside the subgraph: the node leaves it.
      if (group === null || scope !== null || !there) {
        changes.set(statement, []);
        leaves(statement);
        if (scope !== null) first ??= outer(scope);
      }
      continue;
    }
    if (scope === null || statement.line >= anchor) continue;
    const made = recompose(statement, new Set([id]), new Set(), new Map());
    if (!made) continue;
    changes.set(statement, made.texts);
    if (made.loose.length) loose.set(statement, made.loose);
    leaves(statement);
    // Its flows there, written anew behind the subgraph: chains as far as they went on.
    const place = outer(scope),
      lands = (opening(place)?.scope ?? null) === group,
      out = pulled.get(place) ?? [];
    first ??= place;
    let tail: string | undefined;
    const name = (ref: Ref) => {
      if (ref.id !== id || !displaced || carried || !lands) return ref.id;
      carried = true;
      return text;
    };
    statement.arrows.forEach((token, index) => {
      for (const from of statement.groups[index])
        for (const to of statement.groups[index + 1]) {
          if (from.id !== id && to.id !== id) continue;
          if (tail === from.id && out.length) out[out.length - 1] += ` ${token.text} ${name(to)}`;
          else out.push(`${name(from)} ${token.text} ${name(to)}`);
          tail = to.id;
        }
    });
    pulled.set(place, out);
  }
  // Its one declaration in a flow that stays: the shape moves to the line the subgraph gets.
  const landed = [...pulled.keys()].some((place) => (opening(place)?.scope ?? null) === group),
    rooted = mentions.some(({ statement }) => statement.scope === null),
    lined =
      group === null
        ? (displaced && !carried) || (!rooted && !pulled.size)
        : (displaced && !carried) || (!there && !landed);
  if (
    group !== null &&
    lined &&
    !displaced &&
    shaped.length === 1 &&
    shaped[0].statement.scope !== group
  ) {
    const { statement, ref } = shaped[0];
    if (!changes.has(statement)) {
      text = ref.text;
      changes.set(statement, [
        patched(statement, ref.idEnd, ref.braces?.end ?? ref.shape!.after, ""),
      ]);
    }
  }
  // Out of every subgraph, the line of the node stands behind the subgraph it leaves.
  if (group === null && lined && first) pulled.set(first, [text, ...(pulled.get(first) ?? [])]);
  let result = rebuildKeeping(model, changes, loose);
  // Behind the subgraphs, the last first, so that the lines above stay where they are.
  const after = readModel(result);
  if (!after) return source;
  const places = [...pulled]
    .map(([place, texts]) => {
      const open = after.statements.find((item) => item.kind === "subgraph" && item.id === place);
      return { open, texts };
    })
    .filter((item) => item.texts.length);
  if (places.some((item) => item.open?.close === undefined)) return source;
  const lines = [...after.lines];
  for (const { open, texts } of places.toSorted((a, b) => b.open!.line - a.open!.line)) {
    const indent = indentOf(lines[open!.line]);
    lines.splice(after.statements[open!.close!].line + 1, 0, ...texts.map((item) => indent + item));
  }
  result = lines.join("\n");
  if (group !== null && lined) {
    const now = readModel(result);
    if (!now) return source;
    const place = insertAt(now, group),
      held = [...now.lines];
    held.splice(place.at, 0, place.indent + text);
    result = held.join("\n");
  }
  try {
    if (!keeps(result, chart, new Map([[id, group]])) || !sameEdges(parseFlowchart(result), chart))
      return source;
  } catch {
    return source;
  }
  return relinked(result, chart.edges.map(signature));
}

/**
 * Takes a subgraph or lane away and keeps what it holds: its `subgraph` and `end` lines and its
 * `direction` go, the lines between them stand one step less indented in the subgraph around it.
 * The flows to the subgraph itself go with it, and so does what styles it. A swimlane keeps its
 * last lane as long as that holds nodes, since a swimlane has lanes; any other lane leaves its
 * nodes outside the lanes.
 */
export function ungroupFlow(source: string, id: string): string {
  const first = readModel(source),
    group = first?.chart.subgraphs.get(id),
    open = first?.statements.find((item) => item.kind === "subgraph" && item.id === id);
  if (!first || !group || open?.close === undefined) return source;
  const { chart } = first,
    held = [...chart.nodes.values()].filter((node) => node.parent === id),
    end = first.statements[open.close];
  if (chart.kind === "swimlane" && chart.subgraphs.size === 1 && held.length) return source;
  if (first.byLine.get(open.line)!.length > 1 || first.byLine.get(end.line)!.length > 1)
    return source;
  // One step less of indentation between the two lines, then the lines themselves go.
  const lines = [...first.lines],
    outer = indentOf(lines[open.line]),
    inside = lines.slice(open.line + 1, end.line).find((line) => line.trim()),
    inner = inside ? indentOf(inside) : outer;
  if (inner.length > outer.length && inner.startsWith(outer))
    for (let index = open.line + 1; index < end.line; index++)
      if (lines[index].startsWith(inner)) lines[index] = outer + lines[index].slice(inner.length);
  const model = readModel(lines.join("\n"));
  if (!model) return source;
  const changes = new Map<Statement, string[]>(),
    loose = new Map<Statement, Ref[]>(),
    gone = new Set([id]);
  for (const statement of model.statements) {
    if (
      (statement.kind === "subgraph" && statement.id === id) ||
      statement.index === open.close ||
      (statement.kind === "direction" && statement.scope === id)
    )
      changes.set(statement, []);
    else if (statement.kind === "chain") {
      const made = recompose(statement, gone, new Set(), new Map());
      if (!made) continue;
      changes.set(statement, made.texts);
      if (made.loose.length) loose.set(statement, made.loose);
    } else if (statement.kind === "styling") {
      const styled = restyle(statement.text, gone, (index) => index);
      if (styled !== statement.text) changes.set(statement, styled === null ? [] : [styled]);
    }
  }
  let result = rebuildKeeping(model, changes, loose);
  // A node another subgraph mentions further down would go there: it stays where the subgraph stood.
  try {
    for (const node of held)
      if (parseFlowchart(result).nodes.get(node.id)?.parent !== group.parent)
        result = moveFlowInto(result, node.id, group.parent);
    const after = parseFlowchart(result),
      was = new Map(
        [...parentsOf(chart)]
          .filter(([item]) => item !== id)
          .map(([item, parent]) => [item, parent === id ? group.parent : parent]),
      ),
      now = parentsOf(after);
    if (now.size !== was.size || [...was].some(([item, parent]) => now.get(item) !== parent))
      return source;
  } catch {
    return source;
  }
  return relinked(
    result,
    chart.edges.map((edge) => (edge.source === id || edge.target === id ? null : signature(edge))),
  );
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
    none = { source, id: "" };
  if (!model) return none;
  const { chart } = model,
    nodes = [...new Set(ids)].filter((id) => chart.nodes.has(id)),
    inside = new Set(nodes),
    parents = new Set(nodes.map((id) => chart.nodes.get(id)!.parent));
  if (!nodes.length) return none;
  const wrapped = (): { source: string; id: string } | null => {
    if (chart.kind !== "flowchart" || parents.size !== 1) return null;
    const [parent] = parents,
      about = model.statements.filter(
        (item) =>
          item.kind === "chain" &&
          item.scope === parent &&
          item.groups.flat().some((ref) => inside.has(ref.id)),
      ),
      whole = about.filter((item) => item.groups.flat().every((ref) => inside.has(ref.id))),
      // Outside every subgraph a flow holds no node in place, so the subgraph opens where the
      // first statement it takes stood; inside one it opens before the first mention.
      first = parent === null ? (whole[0] ?? about[0]) : about[0];
    if (!first) return null;
    const id = freshId(chart, "group"),
      step = stepOf(model),
      changes = new Map<Statement, string[]>(whole.map((item) => [item, []])),
      held = new Set(whole.flatMap((item) => item.groups.flat().map((ref) => ref.id))),
      strips = new Map<Statement, Ref[]>(),
      own: string[] = [];
    for (const node of nodes) {
      if (held.has(node)) continue;
      // Its one declaration in a flow that stays outside: the shape moves to its line in the subgraph.
      const shaped = mentionsOf(model, node).filter(({ ref }) => ref.shape || ref.braces),
        found = shaped.length === 1 && shaped[0].statement.scope === parent ? shaped[0] : null;
      own.push(found ? found.ref.text : node);
      if (found) strips.set(found.statement, [...(strips.get(found.statement) ?? []), found.ref]);
    }
    // From the right, so that the places before keep their columns.
    for (const [statement, refs] of strips)
      changes.set(statement, [
        refs
          .toSorted((a, b) => b.start - a.start)
          .reduce(
            (text, ref) =>
              text.slice(0, ref.idEnd) + text.slice(ref.braces?.end ?? ref.shape!.after),
            statement.text,
          ),
      ]);
    const block = [
      `subgraph ${id} [${labelText(label) || "Group"}]`,
      ...[...whole.map((item) => item.text), ...own].map((text) => step + text),
      "end",
    ];
    changes.set(first, [...block, ...(changes.get(first) ?? [first.text])]);
    const result = rebuild(model, changes);
    try {
      const after = parseFlowchart(result);
      if (
        !keeps(
          result,
          chart,
          new Map([[id, parent], ...nodes.map((node): [string, string] => [node, id])]),
        ) ||
        !sameEdges(after, chart)
      )
        return null;
    } catch {
      return null;
    }
    return { source: relinked(result, chart.edges.map(signature)), id };
  };
  const made = wrapped();
  if (made) return made;
  const added = addFlowPiece(source, { kind: "group", label, parent: null });
  let result = added.source;
  for (const node of nodes) {
    const moved = moveFlowInto(result, node, added.id);
    if (moved === result) return none;
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
export function addActivityPiece(
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
export function ungroupActivity(source: string, id: string): string {
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
