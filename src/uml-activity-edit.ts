/**
 * Editing a flowchart or swimlane source as text: adding, naming, connecting and removing nodes,
 * the way tam-edit.ts edits block diagrams. Each function returns the source with one change made.
 * The source is read as statements with the places of their nodes and arrows, so an edit changes
 * the one node or arrow it is about and leaves the rest of its line, and every other line, as it
 * was. A node stays when a statement that mentions it goes: it is then written on a line of its
 * own. The layout stays automatic.
 */

import type { Structure, StructureNode } from "./structure.ts";
import { type FlowEdge, type Flowchart, parseFlowchart } from "./uml-activity.ts";
import { accessibilityLines, labelText as shownText, scan, STYLING } from "./uml.ts";

/** What a canvas adds to an activity diagram. */
export type FlowPiece = "step" | "decision" | "start" | "end" | "group";

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

/**
 * Text as a label holds it: line breaks as `<br>`, and as entity codes what the parser would read
 * as an entity, a tag, a quote or markdown.
 */
const escaped = (label: string) =>
  label
    .trim()
    .replace(/[#&](?=\w+;)/g, (mark) => (mark === "#" ? "#35;" : "#amp;"))
    .replace(/<(?=\/?[a-z])(?!br\s*\/?>)/gi, "#lt;")
    .replace(/"/g, "#quot;")
    .replace(/^`(?=[\s\S]*`$)/, "#96;")
    .replace(/\s*\n\s*/g, "<br>");

/** In quotes, unless a text is plain words: quotes keep every mark of the syntax a text. */
const quoted = (text: string) =>
  /^[\p{L}\p{N} .,:!?'\-_/]*$/u.test(text.replace(/<br>/g, "")) && !text.startsWith("/")
    ? text
    : `"${text}"`;

/** A label as a node or a subgraph holds it between its delimiters. */
const labelText = (label: string) => quoted(escaped(label));

/** A label as an arrow holds it between pipes, with the pipes. */
const pipeText = (label: string) => `|${quoted(escaped(label).replace(/\|/g, "#124;"))}|`;

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
    const words = change.label === undefined ? text : escaped(change.label),
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
 * Adds a step, decision, start, end or group and returns the id it got. It goes into the subgraph
 * or lane `parent` names. Without one it stands at the root of a flowchart; in a swimlane it
 * stands in no lane when the source already has a node outside the lanes, else in the first lane,
 * where every node of such a diagram belongs. A lane goes after the last lane.
 */
export function addFlowPiece(
  source: string,
  piece: { kind: FlowPiece; label?: string; parent?: string | null },
): { source: string; id: string } {
  const model = readModel(source);
  if (!model) return { source, id: "" };
  const { chart } = model,
    lines = [...model.lines],
    lane = piece.kind === "group" && chart.kind === "swimlane",
    given = piece.parent && chart.subgraphs.has(piece.parent) ? piece.parent : null,
    loose = [...chart.nodes.values()].some((node) => !node.parent);
  const parent = lane
    ? null
    : (given ??
      (chart.kind === "swimlane" && !loose ? ([...chart.subgraphs.keys()][0] ?? null) : null));
  const id = freshId(chart, piece.kind === "group" ? (lane ? "lane" : "group") : piece.kind),
    label = piece.label?.trim() ? labelText(piece.label) : "",
    place = insertAt(model, parent);
  if (lane) {
    // Beside the other lanes: after the `end` of the last one.
    const ends = model.statements
      .filter((item) => item.kind === "subgraph" && item.close !== undefined)
      .map((item) => model.statements[item.close!].line);
    if (ends.length) place.at = Math.max(...ends) + 1;
  }
  const text =
    piece.kind === "group"
      ? [`subgraph ${id} [${label || "Group"}]`, "end"]
      : piece.kind === "decision"
        ? [`${id}{${label || " "}}`]
        : piece.kind === "start"
          ? [`${id}((${label || "Start"}))`]
          : piece.kind === "end"
            ? [`${id}(((${label || "End"})))`]
            : [
                chart.kind === "swimlane"
                  ? `${id}(${label || "Step"})`
                  : `${id}[${label || "Step"}]`,
              ];
  lines.splice(place.at, 0, ...text.map((line) => place.indent + line));
  return { source: lines.join("\n"), id };
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
        (!text || edge.label === shownText(escaped(text))),
    )
  )
    return source;
  // The subgraphs around a part, the nearest first.
  const around = (id: string) => {
    const out: string[] = [];
    for (
      let parent = (chart.nodes.get(id) ?? chart.subgraphs.get(id))?.parent ?? null;
      parent;
      parent = chart.subgraphs.get(parent)?.parent ?? null
    )
      out.push(parent);
    return out;
  };
  const shared = around(to),
    { at, indent } = insertAt(model, around(from).find((id) => shared.includes(id)) ?? null);
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
        : `subgraph "${escaped(label)}"`;
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
      inner = `"${escaped(label).replace(/\}/g, "#125;")}"`;
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

/** The source with a node or subgraph under another id, at every mention. */
function reidentify(source: string, id: string, next: string, plain: boolean): string {
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
      changes.set(statement, [`subgraph ${next}${plain || !bracket ? "" : bracket[1]}`]);
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
 * Gives a part that was just added its first name. A part that still has the id it was added with
 * (`step1`, `lane1`) takes an id made of the name, at every mention, where the name gives one that
 * is free: `packParcel[Pack parcel]`, and for a subgraph named with one word `subgraph Shop`. Any
 * other part keeps its id and takes the name as `renameFlow` gives it. Returns the id afterwards.
 */
export function retitleFlow(
  source: string,
  id: string,
  name: string,
): { source: string; id: string } {
  const named = renameFlow(source, id, name);
  if (!name.trim() || !GENERATED.test(id)) return { source: named, id };
  const chart = parseFlowchart(source),
    free = (candidate: string | null) =>
      candidate !== null &&
      !RESERVED.has(candidate) &&
      !chart.nodes.has(candidate) &&
      !chart.subgraphs.has(candidate);
  // A subgraph named with one word is that word, as id and as name.
  const word = chart.subgraphs.has(id) && /^[A-Za-z]\w*$/.test(name.trim()) ? name.trim() : null,
    next = free(word) ? word : idOf(name);
  if (!free(next)) return { source: named, id };
  const moved = reidentify(named, id, next!, next === word);
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

/** Flowcharts and swimlanes as a structure a canvas edits. */
export const flowStructure: Structure = {
  pieces: [
    { kind: "step", name: "Step", about: "Something that is done", joins: "after", named: true },
    {
      kind: "decision",
      name: "Decision",
      about: "A question the flow branches at",
      joins: "after",
      named: true,
    },
    { kind: "start", name: "Start", about: "Where the flow begins", joins: "before" },
    { kind: "end", name: "End", about: "Where the flow ends", joins: "after" },
    {
      kind: "group",
      name: "Group",
      about: "A group of steps, or a lane",
      group: true,
      named: true,
    },
  ],
  links: [
    { kind: "flow", name: "Flow" },
    { kind: "dotted", name: "Dotted flow" },
    { kind: "thick", name: "Thick flow" },
  ],
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
          ? [{ ...group, group: true, kind: "group" }]
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
  add: (source, piece) => addFlowPiece(source, { ...piece, kind: piece.kind as FlowPiece }),
  connect: (source, from, to, kind) => connectFlow(source, from, to, undefined, kind),
  rename: renameFlow,
  retitle: retitleFlow,
  label: labelFlowEdge,
  relink: restrokeFlow,
  remove: (source, ids) => removeFlow(source, ids),
};
