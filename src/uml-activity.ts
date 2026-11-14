/** Flowcharts and activity diagrams: the Mermaid syntax. uml-activity-layout.ts lays flowcharts out, uml-swimlanes.ts swimlane diagrams. */

import type { Direction } from "./elk.ts";
import {
  accessibilityLines,
  labelText,
  type Level,
  prepare,
  STYLING,
  UmlError,
  unsupported,
} from "./uml.ts";

/**
 * Mermaid flowcharts (`flowchart`, `graph`) and swimlane activity diagrams (`swimlane-beta`) read
 * as UML activity diagrams in the TAM style (TAM standard 2.2.2): actions, decisions and merges,
 * initial and final nodes, fork and join bars, object nodes, and swimlanes for the agents.
 */

type FlowShape =
  | "rect"
  | "round"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "double-circle"
  | "diamond"
  | "hexagon"
  | "lean-right"
  | "lean-left"
  | "trapezoid"
  | "trapezoid-top"
  | "flag"
  | "initial"
  | "final"
  | "flow-final"
  | "bar";
export interface FlowNode {
  id: string;
  label: string;
  shape: FlowShape;
  parent: string | null;
  line: number;
  declared: boolean;
}
interface Subgraph {
  id: string;
  label: string;
  parent: string | null;
  line: number;
}
export type Marker = "arrow" | "circle" | "cross";
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  stroke: "solid" | "dotted" | "thick" | "invisible";
  start?: Marker;
  end?: Marker;
  line: number;
}
export interface Flowchart {
  kind: "flowchart" | "swimlane";
  direction: Direction;
  title?: string;
  level?: Level;
  nodes: Map<string, FlowNode>;
  subgraphs: Map<string, Subgraph>;
  edges: FlowEdge[];
  /** Nodes and subgraphs in declaration order, for layouts that follow the source. */
  order: string[];
}

// Node shapes by their delimiters, longest opening first.
const DELIMITERS: [string, string[], FlowShape[]][] = [
  ["(((", [")))"], ["double-circle"]],
  ["((", ["))"], ["circle"]],
  ["([", ["])"], ["stadium"]],
  ["[[", ["]]"], ["subroutine"]],
  ["[(", [")]"], ["cylinder"]],
  ["[/", ["/]", "\\]"], ["lean-right", "trapezoid"]],
  ["[\\", ["\\]", "/]"], ["lean-left", "trapezoid-top"]],
  ["{{", ["}}"], ["hexagon"]],
  ["(", [")"], ["round"]],
  ["[", ["]"], ["rect"]],
  ["{", ["}"], ["diamond"]],
  [">", ["]"], ["flag"]],
];
/** Mermaid 11 `@{ shape: ... }` names. */
const SHAPES: Record<string, FlowShape> = {
  rect: "rect",
  rectangle: "rect",
  proc: "rect",
  process: "rect",
  rounded: "round",
  event: "round",
  stadium: "stadium",
  terminal: "stadium",
  pill: "stadium",
  subroutine: "subroutine",
  subproc: "subroutine",
  "fr-rect": "subroutine",
  "framed-rectangle": "subroutine",
  cyl: "cylinder",
  cylinder: "cylinder",
  db: "cylinder",
  database: "cylinder",
  circle: "circle",
  circ: "circle",
  "dbl-circ": "double-circle",
  "double-circle": "double-circle",
  diam: "diamond",
  diamond: "diamond",
  decision: "diamond",
  question: "diamond",
  hex: "hexagon",
  hexagon: "hexagon",
  prepare: "hexagon",
  "lean-r": "lean-right",
  "lean-right": "lean-right",
  "in-out": "lean-right",
  "lean-l": "lean-left",
  "lean-left": "lean-left",
  "out-in": "lean-left",
  "trap-b": "trapezoid",
  "trapezoid-bottom": "trapezoid",
  priority: "trapezoid",
  "trap-t": "trapezoid-top",
  "trapezoid-top": "trapezoid-top",
  manual: "trapezoid-top",
  odd: "flag",
  asymmetric: "flag",
  "sm-circ": "initial",
  "small-circle": "initial",
  start: "initial",
  "f-circ": "initial",
  "filled-circle": "initial",
  junction: "initial",
  "fr-circ": "final",
  "framed-circle": "final",
  stop: "final",
  "cross-circ": "flow-final",
  "crossed-circle": "flow-final",
  summary: "flow-final",
  fork: "bar",
  join: "bar",
};
const ID = /^[\p{L}\p{N}_!#$%&'*+.`?\\/]+(?:-(?![->.])[\p{L}\p{N}_!#$%&'*+.`?\\/]*)*/u;
const KEYWORDS = new Set([
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
]);

/** Splits a line into statements at `;` outside quotes and brackets. */
function statements(text: string): string[] {
  const out: string[] = [];
  let depth = 0,
    quote = false,
    start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') quote = !quote;
    else if (!quote && "[({".includes(c)) depth++;
    else if (!quote && "])}".includes(c)) depth = Math.max(0, depth - 1);
    else if (!quote && !depth && c === ";") {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((item) => item.trim()).filter(Boolean);
}

interface Cursor {
  text: string;
  at: number;
  line: number;
}
const skip = (cursor: Cursor) => {
  while (cursor.at < cursor.text.length && /\s/.test(cursor.text[cursor.at])) cursor.at++;
};

/** A node reference: id, optional shape with text, class and metadata. */
function readNode(cursor: Cursor): { id: string; shape?: FlowShape; label?: string } | null {
  skip(cursor);
  const rest = cursor.text.slice(cursor.at);
  const match = rest.match(ID);
  if (!match) return null;
  let id = match[0];
  cursor.at += id.length;
  // An edge id (`e1@-->`) is not a node.
  if (id.endsWith("@")) {
    cursor.at -= id.length;
    return null;
  }
  let shape: FlowShape | undefined, label: string | undefined;
  const tail = cursor.text.slice(cursor.at);
  const opener = DELIMITERS.find(([open]) => tail.startsWith(open));
  if (opener) {
    const [open, closes, shapes] = opener;
    let body = tail.slice(open.length),
      consumed = open.length,
      closeIndex = -1;
    const quoted = body.trimStart().startsWith('"');
    if (quoted) {
      const first = body.indexOf('"'),
        end = body.indexOf('"', first + 1);
      if (end < 0) throw new UmlError(cursor.line, `Unclosed quote in \`${id}${tail}\`.`);
      label = body.slice(first + 1, end);
      body = body.slice(end + 1);
      consumed += end + 1;
      const trimmed = body.trimStart();
      closeIndex = closes.findIndex((close) => trimmed.startsWith(close));
      if (closeIndex < 0)
        throw new UmlError(cursor.line, `Expected \`${closes[0]}\` after the label of \`${id}\`.`);
      consumed += body.length - trimmed.length + closes[closeIndex].length;
    } else {
      // The earliest closing delimiter ends the text.
      let best = -1;
      closes.forEach((close, index) => {
        const at = body.indexOf(close);
        if (at >= 0 && (best < 0 || at < body.indexOf(closes[best]))) {
          best = index;
        }
      });
      if (best < 0)
        throw new UmlError(
          cursor.line,
          `\`${id}${open}\` is missing its closing \`${closes[0]}\`.`,
        );
      closeIndex = best;
      const at = body.indexOf(closes[best]);
      label = body.slice(0, at);
      consumed += at + closes[best].length;
    }
    shape = shapes[closeIndex];
    cursor.at += consumed;
    label = labelText(`"${label}"`);
  }
  const more = cursor.text.slice(cursor.at);
  const metadata = more.match(/^@\{([^}]*)\}/);
  if (metadata) {
    cursor.at += metadata[0].length;
    for (const [, key, value] of metadata[1].matchAll(/(\w+)\s*:\s*("(?:[^"]*)"|[^,]+)/g)) {
      const text = value.trim().replace(/^"(.*)"$/, "$1");
      if (key === "shape") {
        shape = SHAPES[text];
        if (!shape) unsupported(cursor.line, `The \`${text}\` shape`);
      } else if (key === "label") label = labelText(`"${text}"`);
      else if (key !== "icon" && key !== "form" && key !== "pos" && key !== "h" && key !== "w")
        unsupported(cursor.line, `Node metadata \`${key}\``);
      else unsupported(cursor.line, "Icon and image nodes");
    }
  }
  const css = cursor.text.slice(cursor.at).match(/^:::[\w-]+/);
  if (css) cursor.at += css[0].length;
  return { id, shape, label };
}

/** An edge operator with its label, or null. */
function readEdge(
  cursor: Cursor,
): { stroke: FlowEdge["stroke"]; start?: Marker; end?: Marker; label?: string } | null {
  skip(cursor);
  let rest = cursor.text.slice(cursor.at);
  const named = rest.match(/^[\w-]+@(?=[-=.~<ox])/);
  if (named) {
    cursor.at += named[0].length;
    rest = rest.slice(named[0].length);
  }
  const markerOf = (char?: string): Marker | undefined =>
    char === ">" || char === "<"
      ? "arrow"
      : char === "o"
        ? "circle"
        : char === "x"
          ? "cross"
          : undefined;
  let match: RegExpMatchArray | null;
  // `-- text -->`, `== text ==>`, `-. text .->`
  if (
    (match = rest.match(
      /^([<ox]?)(--|==|-\.)(?![->.=])\s*([^-=.>|][^]*?)\s*(-{2,}[->ox]?|={2,}[=>ox]?|\.+-[>ox]?)(?=\s|$|[\p{L}\p{N}_"])/u,
    ))
  ) {
    const [all, start, open, text, close] = match;
    cursor.at += all.length;
    const stroke = open === "==" ? "thick" : open === "-." ? "dotted" : "solid";
    const last = close.at(-1);
    return {
      stroke,
      start: markerOf(start),
      end: /[>ox]/.test(last!) ? markerOf(last) : undefined,
      label: labelText(text),
    };
  }
  if ((match = rest.match(/^~{3,}/))) {
    cursor.at += match[0].length;
    return withPipe(cursor, { stroke: "invisible" });
  }
  if ((match = rest.match(/^([<ox]?)(-{2,}|={2,}|-\.+-)([->ox=]?)(?=\s|$|\||[\p{L}\p{N}_"])/u))) {
    const [all, start, body, end] = match;
    // `--o` and `--x` end markers only before a space or a label, else the letter starts the next id.
    cursor.at += all.length;
    const stroke = body.startsWith("=") ? "thick" : body.includes(".") ? "dotted" : "solid";
    return withPipe(cursor, { stroke, start: markerOf(start), end: markerOf(end) });
  }
  return null;
}

function withPipe(
  cursor: Cursor,
  edge: { stroke: FlowEdge["stroke"]; start?: Marker; end?: Marker; label?: string },
) {
  skip(cursor);
  const rest = cursor.text.slice(cursor.at);
  const pipe = rest.match(/^\|([^|]*)\|/);
  if (pipe) {
    cursor.at += pipe[0].length;
    edge.label = labelText(`"${pipe[1].trim().replace(/^"(.*)"$/, "$1")}"`) || undefined;
  }
  return edge;
}

/** Header directions: long forms in any case, Mermaid's shorthands as written (`V` is no `v`). */
const DIRECTIONS = new Map<string, Direction>(
  Object.entries({ TB: "TB", TD: "TB", BT: "BT", LR: "LR", RL: "RL", "": "TB" } as const),
);
const SHORTHANDS = new Map<string, Direction>(
  Object.entries({ "<": "RL", ">": "LR", "^": "BT", v: "TB" } as const),
);

export function parseFlowchart(source: string): Flowchart {
  const prepared = prepare(source);
  if (prepared.kind !== "flowchart" && prepared.kind !== "swimlane")
    throw new UmlError(prepared.headerLine, "Not a flowchart.");
  const [directionWord = ""] = prepared.rest.split(/[\s;]/);
  const directionText = directionWord.toUpperCase();
  const direction = SHORTHANDS.get(directionWord) ?? DIRECTIONS.get(directionText);
  if (!direction)
    throw new UmlError(
      prepared.headerLine,
      `Unknown direction \`${directionText}\`; use TB, TD, BT, LR, RL or one of < > ^ v.`,
    );
  const chart: Flowchart = {
    kind: prepared.kind,
    direction,
    title: prepared.title,
    level: prepared.level,
    nodes: new Map(),
    subgraphs: new Map(),
    edges: [],
    order: [],
  };
  const stack: Subgraph[] = [];
  let anonymous = 0;
  // A header line can carry statements after `;`.
  const lines = [
    ...statements(prepared.rest.slice(directionText.length)).map((text) => ({
      text,
      line: prepared.headerLine,
    })),
    ...prepared.lines,
  ];

  const node = (id: string, line: number, shape?: FlowShape, label?: string): FlowNode => {
    if (chart.subgraphs.has(id))
      return { id, label: "", shape: "rect", parent: null, line, declared: false };
    let item = chart.nodes.get(id);
    const parent = stack.at(-1)?.id ?? null;
    if (!item) {
      if (chart.nodes.size >= 300) throw new UmlError(line, "Flowcharts are limited to 300 nodes.");
      item = { id, label: id, shape: "rect", parent, line, declared: false };
      chart.nodes.set(id, item);
      chart.order.push(id);
    } else if (parent && !item.parent) item.parent = parent;
    if (shape) item.shape = shape;
    // Start, stop, crossed circles and bars carry no text unless given one.
    if (shape && label === undefined && ["initial", "final", "flow-final", "bar"].includes(shape))
      label = "";
    if (label !== undefined) {
      item.label = label;
      item.declared = true;
    } else if (shape) item.declared = true;
    return item;
  };

  const accessibility = accessibilityLines();
  for (const { text: whole, line } of lines) {
    for (const text of statements(whole)) {
      if (accessibility(text)) continue;
      let match: RegExpMatchArray | null;
      // Mermaid takes no shorthand in a `direction` statement, so neither do we.
      if (/^direction\s+(TB|TD|BT|LR|RL)$/i.test(text)) continue;
      if (text === "end") {
        if (!stack.pop()) throw new UmlError(line, "Unmatched `end`.");
        continue;
      }
      if ((match = text.match(/^subgraph(?:\s+(.*))?$/))) {
        const spec = (match[1] ?? "").trim();
        let id: string, label: string;
        const bracket = spec.match(/^(\S+?)\s*\[(.*)\]$/);
        if (bracket) {
          id = bracket[1];
          label = labelText(bracket[2]);
        } else if (/^".*"$/.test(spec)) {
          id = `subgraph#${++anonymous}`;
          label = labelText(spec);
        } else if (spec) {
          id = spec;
          label = labelText(spec);
        } else {
          id = `subgraph#${++anonymous}`;
          label = "";
        }
        if (chart.subgraphs.has(id) || chart.nodes.has(id))
          throw new UmlError(line, `\`${id}\` is already declared.`);
        const subgraph: Subgraph = { id, label, parent: stack.at(-1)?.id ?? null, line };
        chart.subgraphs.set(id, subgraph);
        chart.order.push(id);
        stack.push(subgraph);
        continue;
      }
      if (STYLING.test(text)) continue;
      // A chain of node groups joined by edges: `a & b --> c -->|x| d`.
      const cursor: Cursor = { text, at: 0, line };
      const group = () => {
        const items: string[] = [];
        for (;;) {
          const item = readNode(cursor);
          if (!item) break;
          if (KEYWORDS.has(item.id) && !item.shape)
            throw new UmlError(line, `Cannot read \`${text}\`.`);
          items.push(node(item.id, line, item.shape, item.label).id);
          skip(cursor);
          if (cursor.text[cursor.at] === "&") {
            cursor.at++;
            continue;
          }
          break;
        }
        return items;
      };
      let from = group();
      if (!from.length) throw new UmlError(line, `Cannot read \`${text}\`.`);
      for (;;) {
        skip(cursor);
        if (cursor.at >= text.length) break;
        const edge = readEdge(cursor);
        if (!edge)
          throw new UmlError(line, `Cannot read \`${text.slice(cursor.at)}\` in \`${text}\`.`);
        const to = group();
        if (!to.length) throw new UmlError(line, `An edge in \`${text}\` has no target.`);
        for (const source of from)
          for (const target of to) {
            chart.edges.push({ id: `e${chart.edges.length + 1}`, source, target, line, ...edge });
            if (chart.edges.length > 500)
              throw new UmlError(line, "Flowcharts are limited to 500 edges.");
          }
        from = to;
      }
    }
  }
  if (stack.length)
    throw new UmlError(
      stack.at(-1)!.line,
      `Subgraph \`${stack.at(-1)!.label || stack.at(-1)!.id}\` is missing its \`end\`.`,
    );
  for (const edge of chart.edges) {
    for (const end of [edge.source, edge.target])
      if (chart.subgraphs.has(end) && chart.kind === "swimlane")
        unsupported(edge.line, "An edge to a swimlane");
  }
  if (chart.kind === "swimlane") {
    const nested = [...chart.subgraphs.values()].find((subgraph) => subgraph.parent);
    if (nested) unsupported(nested.line, "A subgraph inside a swimlane");
  }
  // UML activity nodes implied by the shapes: a circle that only starts flows (one per vertex) is
  // the initial node, a double circle that only ends them the activity final node. Initial nodes
  // that flows lead into are circles, final nodes that flows leave double circles.
  for (const item of chart.nodes.values()) {
    const incoming = chart.edges.some(
      (edge) => edge.target === item.id && edge.source !== item.id && edge.stroke !== "invisible",
    );
    const outgoing = chart.edges.filter(
      (edge) => edge.source === item.id && edge.target !== item.id && edge.stroke !== "invisible",
    ).length;
    if (item.shape === "circle" && !incoming && outgoing && outgoing <= 4) item.shape = "initial";
    else if (item.shape === "initial" && incoming) item.shape = "circle";
    if (item.shape === "double-circle" && incoming && !outgoing) item.shape = "final";
    else if (item.shape === "final" && outgoing) item.shape = "double-circle";
    if (
      (item.shape === "initial" ||
        item.shape === "final" ||
        item.shape === "flow-final" ||
        item.shape === "bar") &&
      item.label === item.id &&
      !item.declared
    )
      item.label = "";
  }
  // UML has no self loops on decisions, merges, initial and final nodes; Mermaid draws them as written.
  const looped = chart.edges.find(
    (edge) =>
      edge.source === edge.target &&
      ["diamond", "initial", "final", "flow-final"].includes(
        chart.nodes.get(edge.source)?.shape ?? "",
      ),
  );
  if (looped) unsupported(looped.line, "A self loop on a decision, merge, initial or final node");
  return chart;
}
