/**
 * Editing a flowchart or swimlane source as text: adding, naming, connecting and removing nodes,
 * the way tam-edit.ts edits block diagrams. Each function returns the source with one change made.
 * A line that loses a node or an edge is written anew, one statement a line, from what it still
 * says; every other line stays as it was. The layout stays automatic.
 */

import { type FlowEdge, type Flowchart, parseFlowchart } from "./uml-activity.ts";

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

/** A node as a line declares it: `id[Label]`, `id@{ shape: fork }`. */
interface Declaration {
  id: string;
  start: number;
  end: number;
  /** Where its label lies in the line; for the `@{ }` form, where a label goes. */
  label?: { start: number; end: number };
  /** The `@{ }` form, whose label is a `label: "…"` entry. */
  braces?: boolean;
}

/** The node declarations in a line of source, in order. */
function declarations(line: string): Declaration[] {
  const found: Declaration[] = [],
    id = /[A-Za-z_][\w]*/y;
  for (let at = 0; at < line.length;) {
    // The text of an edge is no place for declarations.
    if (line[at] === "|") {
      const close = line.indexOf("|", at + 1);
      at = close < 0 ? line.length : close + 1;
      continue;
    }
    if (line.startsWith("%%", at)) break;
    id.lastIndex = at;
    const match = /\w/.test(line[at - 1] ?? "") ? null : id.exec(line);
    if (!match) {
      at++;
      continue;
    }
    const after = at + match[0].length;
    if (line.startsWith("@{", after)) {
      const close = line.indexOf("}", after);
      if (close < 0) break;
      const body = line.slice(after, close + 1),
        label = body.match(/label:\s*"([^"]*)"/);
      found.push({
        id: match[0],
        start: at,
        end: close + 1,
        braces: true,
        label: label
          ? {
              start: after + label.index! + label[0].indexOf('"') + 1,
              end: after + label.index! + label[0].length - 1,
            }
          : { start: close, end: close },
      });
      at = close + 1;
      continue;
    }
    const open = DELIMITERS.find(([text]) => line.startsWith(text, after));
    // A flag opens with `>`, which is also the head of an arrow: only directly after the id it is a shape.
    if (open && !(open[0] === ">" && /[-=.~]/.test(line[at - 1] ?? ""))) {
      const from = after + open[0].length,
        quoted = line[from] === '"' ? line.indexOf('"', from + 1) : -1,
        search = quoted > 0 ? quoted + 1 : from;
      const closes = open[1]
        .map((text) => ({ text, at: line.indexOf(text, search) }))
        .filter((item) => item.at >= 0)
        .toSorted((a, b) => a.at - b.at);
      if (closes.length) {
        const [close] = closes;
        found.push({
          id: match[0],
          start: at,
          end: close.at + close.text.length,
          label: { start: from, end: close.at },
        });
        at = close.at + close.text.length;
        continue;
      }
    }
    at = after;
  }
  return found;
}

/** A label as a node or edge holds it: line breaks as `<br>`, and in quotes when it has a bracket. */
const labelText = (label: string) => {
  const text = label
    .trim()
    .replace(/\s*\n\s*/g, "<br>")
    .replace(/"/g, "'");
  return /[[\](){}|<>]/.test(text.replace(/<br>/g, "")) ? `"${text}"` : text;
};

/** An id no node or subgraph has yet. */
function freshId(chart: Flowchart, base: string): string {
  for (let count = 1; ; count++) {
    const id = `${base}${count}`;
    if (!chart.nodes.has(id) && !chart.subgraphs.has(id)) return id;
  }
}

/** The index of the `end` that closes the subgraph opened on a line. */
function blockEnd(lines: string[], start: number): number {
  let depth = 0;
  for (let index = start; index < lines.length; index++) {
    const statement = lines[index].replace(/%%.*$/, "").trim();
    if (/^subgraph\b/.test(statement)) depth++;
    else if (statement === "end" && !--depth) return index;
  }
  return lines.length - 1;
}

/** Where a statement is added: before the `end` of a subgraph, or after the last line with text. */
function insertAt(lines: string[], chart: Flowchart, parent: string | null) {
  const group = parent ? chart.subgraphs.get(parent) : undefined;
  if (group) {
    const end = blockEnd(lines, group.line - 1);
    return { at: end, indent: `${indentOf(lines[group.line - 1])}  ` };
  }
  let at = lines.length;
  while (at > 0 && !lines[at - 1].trim()) at--;
  return { at, indent: "  " };
}

/** An edge as a statement between two node texts. */
function edgeText(edge: FlowEdge, from: string, to: string): string {
  const mark = (marker: FlowEdge["end"], arrow: string) =>
    marker === "arrow" ? arrow : marker === "circle" ? "o" : marker === "cross" ? "x" : "";
  const start = mark(edge.start, "<"),
    end = mark(edge.end, ">");
  // The line between the ends: `--`, `==` or `-.-`; without a head it runs one stroke longer.
  const arrow =
    edge.stroke === "invisible"
      ? "~~~"
      : edge.stroke === "thick"
        ? `${start}==${end || "="}`
        : edge.stroke === "dotted"
          ? `${start}-.-${end}`
          : `${start}--${end || "-"}`;
  const label = edge.label ? `|${labelText(edge.label).replace(/\|/g, "/")}|` : "";
  return `${from} ${arrow}${label} ${to}`;
}

/**
 * Writes a line anew from the edges and declarations it keeps, one statement a line. `keep` says
 * which edges stay, `gone` which nodes do not, `relabel` gives an edge another label.
 */
function rewrite(
  lines: string[],
  index: number,
  chart: Flowchart,
  keep: (edge: FlowEdge) => boolean,
  gone: Set<string>,
): string[] {
  const text = lines[index],
    declared = new Map(
      declarations(text).map((item) => [item.id, text.slice(item.start, item.end)]),
    ),
    written = new Set<string>(),
    out: string[] = [];
  const name = (id: string) => {
    if (written.has(id) || !declared.has(id)) return id;
    written.add(id);
    return declared.get(id)!;
  };
  for (const edge of chart.edges)
    if (edge.line === index + 1 && keep(edge) && !gone.has(edge.source) && !gone.has(edge.target))
      out.push(edgeText(edge, name(edge.source), name(edge.target)));
  for (const [id, own] of declared) if (!written.has(id) && !gone.has(id)) out.push(own);
  return out.map((statement) => `${indentOf(text)}${statement}`);
}

/** Adds a step, decision, start, end or group; inside a subgraph when given. Returns the id it got. */
export function addFlowPiece(
  source: string,
  piece: { kind: FlowPiece; label?: string; parent?: string | null },
): { source: string; id: string } {
  const chart = parseFlowchart(source),
    lines = linesOf(source);
  // In a swimlane every node stands in a lane: the first, when none is named.
  const parent =
    piece.parent ??
    (chart.kind === "swimlane" && piece.kind !== "group"
      ? ([...chart.subgraphs.keys()][0] ?? null)
      : null);
  const id = freshId(
      chart,
      piece.kind === "group" ? (chart.kind === "swimlane" ? "lane" : "group") : piece.kind,
    ),
    label = labelText(piece.label ?? ""),
    { at, indent } = insertAt(
      lines,
      chart,
      piece.kind === "group" && chart.kind === "swimlane" ? null : parent,
    );
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
  lines.splice(at, 0, ...text.map((line) => indent + line));
  return { source: lines.join("\n"), id };
}

/** Connects two nodes with an arrow, labelled when a label is given. */
export function connectFlow(source: string, from: string, to: string, label?: string): string {
  const chart = parseFlowchart(source),
    lines = linesOf(source),
    { at, indent } = insertAt(lines, chart, null);
  const edge: FlowEdge = {
    id: "",
    source: from,
    target: to,
    label,
    stroke: "solid",
    end: "arrow",
    line: 0,
  };
  lines.splice(at, 0, indent + edgeText(edge, from, to));
  return lines.join("\n");
}

/** Gives a node or a subgraph another name. */
export function renameFlow(source: string, id: string, label: string): string {
  const chart = parseFlowchart(source),
    lines = linesOf(source),
    text = labelText(label);
  const group = chart.subgraphs.get(id);
  if (group) {
    const index = group.line - 1;
    lines[index] = `${indentOf(lines[index])}subgraph ${id} [${text}]`;
    return lines.join("\n");
  }
  const node = chart.nodes.get(id);
  if (!node) return source;
  for (let index = 0; index < lines.length; index++) {
    const found = declarations(lines[index]).find((item) => item.id === id);
    if (!found?.label) continue;
    const line = lines[index],
      inner = found.braces
        ? line.slice(found.label.start, found.label.end) || found.label.start !== found.label.end
          ? text.replace(/^"|"$/g, "")
          : `, label: "${text.replace(/^"|"$/g, "")}" `
        : text;
    lines[index] = line.slice(0, found.label.start) + inner + line.slice(found.label.end);
    return lines.join("\n");
  }
  // Named nowhere yet: where it first stands, it gets its name.
  const index = node.line - 1,
    at = lines[index].search(new RegExp(`(?<![\\w])${id}(?![\\w])`));
  if (at < 0) return source;
  lines[index] = `${lines[index].slice(0, at)}${id}[${text}]${lines[index].slice(at + id.length)}`;
  return lines.join("\n");
}

/** Gives an edge another label; an empty one removes it. */
export function labelFlowEdge(source: string, edge: string, label: string): string {
  const chart = parseFlowchart(source),
    lines = linesOf(source),
    found = chart.edges.find((item) => item.id === edge);
  if (!found) return source;
  found.label = label.trim() || undefined;
  lines.splice(found.line - 1, 1, ...rewrite(lines, found.line - 1, chart, () => true, new Set()));
  return lines.join("\n");
}

/** Removes nodes with their edges, subgraphs with what they hold, and edges, by id. */
export function removeFlow(source: string, ids: Iterable<string>): string {
  const chart = parseFlowchart(source),
    lines = linesOf(source),
    named = new Set(ids);
  const gone = new Set<string>(),
    dropped = new Set<number>();
  const inside = (group: string) => {
    for (const node of chart.nodes.values()) if (node.parent === group) gone.add(node.id);
    for (const other of chart.subgraphs.values()) if (other.parent === group) take(other.id);
  };
  const take = (id: string) => {
    const group = chart.subgraphs.get(id);
    if (!group) return;
    inside(id);
    dropped.add(group.line - 1);
    dropped.add(blockEnd(lines, group.line - 1));
  };
  for (const id of named) {
    if (chart.nodes.has(id)) gone.add(id);
    else take(id);
  }
  const edges = new Set(chart.edges.filter((edge) => named.has(edge.id)).map((edge) => edge.id));
  // The lines that say something of what goes: its edges, and where it is declared.
  const touched = new Set<number>();
  for (const edge of chart.edges)
    if (edges.has(edge.id) || gone.has(edge.source) || gone.has(edge.target))
      touched.add(edge.line - 1);
  lines.forEach((line, index) => {
    if (declarations(line).some((item) => gone.has(item.id))) touched.add(index);
    const statement = line.replace(/%%.*$/, "").trim();
    // A node alone on its line, and what styles it.
    if (
      gone.has(statement) ||
      [...gone].some((id) => new RegExp(`^(style|click)\\s+${id}\\b`).test(statement))
    )
      dropped.add(index);
  });
  // Bottom up, so the lines above keep their numbers.
  for (let index = lines.length - 1; index >= 0; index--) {
    if (dropped.has(index)) lines.splice(index, 1);
    else if (touched.has(index))
      lines.splice(index, 1, ...rewrite(lines, index, chart, (edge) => !edges.has(edge.id), gone));
  }
  return lines.join("\n");
}
