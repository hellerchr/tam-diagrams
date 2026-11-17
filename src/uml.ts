import type { Direction, GraphEdge, GraphNode, GraphPort } from "./elk.ts";
import { SourceError } from "./source-error.ts";

/**
 * Shared parsing for the Mermaid diagram types the built-in UML renderer draws: header detection,
 * frontmatter titles, comments, the optional TAM level directive, label text, and errors that say
 * whether the source is wrong or merely uses syntax the renderer leaves to Mermaid. Also the vertex
 * ports the behavior diagrams give their small symbols.
 */

/** Mermaid diagram types detectUml recognizes and this package draws; `er` is an entity relationship diagram. */
export type UmlKind = "class" | "state" | "flowchart" | "swimlane" | "usecase" | "sequence" | "er";
/** The TAM abstraction level a source declares with `%% level conceptual` or `%% level design`. */
export type Level = "conceptual" | "design";

/**
 * An error in a Mermaid source, with its line. `unsupported` marks valid Mermaid the built-in
 * renderer does not draw; such diagrams are rendered by Mermaid instead.
 */
export class UmlError extends SourceError {
  unsupported: boolean;
  constructor(line: number, message: string, unsupported = false) {
    super(line, message);
    this.unsupported = unsupported;
  }
}
/** Throws the `unsupported` UmlError for valid Mermaid syntax the renderer leaves to Mermaid. */
export const unsupported = (line: number, what: string): never => {
  throw new UmlError(line, `${what} is drawn by Mermaid, not the built-in renderer.`, true);
};

const MAX_UML_CHARS = 20_000;
const MAX_LINES = 600;

// A header line ends after its keyword, or continues with whitespace and arguments (`TD`, `LR:`,
// `title Pets`). A TAM statement that starts with an id and whitespace is not one: a link
// (`graph -- calls --> api`, `graph <-- calls --> api`), several ends (`graph & api -- …`) or an
// interface (`graph provides IApi`). A bare `<` is none of these: `graph <` is a flowchart's.
export const HEADER_END = String.raw`(?=[:;]*$|\s+(?!(?:provides|requires)\s)(?!<[-=])[^-&\s])`;

const HEADERS: [RegExp, UmlKind][] = [
  [new RegExp(String.raw`^classDiagram(-v2)?${HEADER_END}`), "class"],
  [new RegExp(String.raw`^stateDiagram(-v2)?${HEADER_END}`), "state"],
  [new RegExp(String.raw`^(flowchart(-elk)?|graph)${HEADER_END}`), "flowchart"],
  [new RegExp(String.raw`^swimlane-beta${HEADER_END}`), "swimlane"],
  [new RegExp(String.raw`^usecase-beta${HEADER_END}`), "usecase"],
  [new RegExp(String.raw`^sequenceDiagram${HEADER_END}`), "sequence"],
  [new RegExp(String.raw`^erDiagram${HEADER_END}`), "er"],
];

interface SourceLine {
  text: string;
  line: number;
}
interface Prepared {
  kind: UmlKind;
  /** The header line's text after the diagram keyword, such as `TB` in `flowchart TB`. */
  rest: string;
  headerLine: number;
  /** Statement lines after the header, trimmed, without comments and directives. */
  lines: SourceLine[];
  title?: string;
  level?: Level;
}

/** The line closing the `%%{ … }%%` directive that opens at `index`; `index` when none does. */
function directiveEnd(all: string[], index: number): number {
  if (!all[index].trim().startsWith("%%{")) return index;
  const end = all.slice(index).findIndex((text) => text.trim().endsWith("}%%"));
  return end < 0 ? index : index + end;
}

/**
 * YAML frontmatter: only the title matters here; `config` styling is ignored. Returns the line
 * after it, 0 without one.
 */
function frontMatter(all: string[]): { start: number; title?: string } {
  const first = all.findIndex((text) => text.trim());
  if (first < 0 || all[first].trim() !== "---") return { start: 0 };
  const close = all.findIndex((text, index) => index > first && text.trim() === "---");
  if (close <= first) return { start: 0 };
  let title: string | undefined;
  for (const text of all.slice(first + 1, close)) {
    const match = text.match(/^title:\s*(.+)$/);
    if (match) title = unquoted(match[1].trim());
  }
  return { start: close + 1, title };
}

/** A quoted title stands without its quotes; in single quotes a doubled quote is one. */
const unquoted = (value: string) =>
  /^'.*'$/.test(value) ? value.slice(1, -1).replace(/''/g, "'") : value.replace(/^"(.*)"$/, "$1");

/** Statement lines of a source, without frontmatter, comments and `%%{ }%%` directives. */
export function scan(source: string): { lines: SourceLine[]; title?: string; level?: Level } {
  const all = source.replace(/\r\n?/g, "\n").split("\n");
  const { start, title } = frontMatter(all);
  let level: Level | undefined;
  const lines: SourceLine[] = [];
  for (let index = start; index < all.length; index++) {
    const text = all[index].trim();
    if (!text) continue;
    if (text.startsWith("%%")) {
      index = directiveEnd(all, index);
      // `%% level conceptual` sets the TAM abstraction level; Mermaid reads it as a comment.
      const match = text.match(/^%%\s*level\s*:?\s*(conceptual|design)\s*$/i);
      if (match) level = match[1].toLowerCase() as Level;
      continue;
    }
    lines.push({ text, line: index + 1 });
  }
  return { lines, title, level };
}

/** The diagram type of a Mermaid source, if the built-in renderer handles that type. */
export function detectUml(source: string): UmlKind | null {
  const firstLine = scan(source.slice(0, 4000)).lines[0]?.text ?? "";
  return HEADERS.find(([pattern]) => pattern.test(firstLine))?.[1] ?? null;
}

/**
 * A source split into its header and statement lines, with frontmatter title and level; throws UmlError
 * for unknown types and sources over the size limits.
 */
export function prepare(source: string): Prepared {
  if (source.length > MAX_UML_CHARS)
    throw new UmlError(0, "Diagram exceeds the limit of 20,000 characters.");
  const { lines, title, level } = scan(source);
  if (lines.length > MAX_LINES)
    throw new UmlError(0, `Diagram exceeds the limit of ${MAX_LINES} lines.`);
  const header = lines.shift();
  const found = header && HEADERS.find(([pattern]) => pattern.test(header.text));
  if (!header || !found) throw new UmlError(header?.line ?? 0, "Unknown diagram type.");
  const rest = header.text.replace(found[0], "").trim();
  return { kind: found[1], rest, headerLine: header.line, lines, title, level };
}

const ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  nbsp: " ",
  apos: "'",
  hash: "#",
  semi: ";",
  colon: ":",
};
/** Mermaid's `#quot;` and `#35;` entity codes, plus HTML entities. */
function decodeEntities(text: string): string {
  return text.replace(/[#&](\w+);/g, (whole, code: string) => {
    if (/^\d+$/.test(code)) return String.fromCodePoint(Number(code));
    if (/^x[0-9a-f]+$/i.test(code)) return String.fromCodePoint(parseInt(code.slice(1), 16));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * Label text as Mermaid shows it: quotes removed, entities decoded, markdown strings (`` "`...`" ``)
 * without emphasis markers, HTML tags other than `<br>` dropped.
 */
export function labelText(raw: string): string {
  let text = raw.trim();
  const markdown = text.match(/^"`([\s\S]*)`"$/);
  if (markdown)
    text = markdown[1]
      .replace(/\*\*(.+?)\*\*|__(.+?)__/g, "$1$2")
      .replace(/\*(.+?)\*|_(.+?)_/g, "$1$2")
      .replace(/\n/g, "<br>");
  else text = text.replace(/^"([\s\S]*)"$/, "$1");
  text = text
    .replace(/<br\s*\/?>/gi, "\u0000")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\u0000/g, "<br>");
  return decodeEntities(text).replace(/\\n/g, "<br>").trim();
}

/** A coding of text for the parser: a pattern, and what each match of it is written as. */
export type Coding = [RegExp, (match: string, ...groups: string[]) => string];

/** A tag's opening `<` as its entity code, so the parser does not read a tag; `<br>` stays. */
export const TAG_CODING: Coding = [/<(?=\/?[a-z])(?!br\s*\/?>)/gi, () => "#lt;"];

/** Line breaks, with the white space around them, as `<br>`. */
export const BREAK_CODING: Coding = [/\s*\n\s*/g, () => "<br>"];

/** A label trimmed, with each coding applied to it in turn. */
export const codedWith = (label: string, codings: Coding[]) =>
  codings.reduce((text, [pattern, code]) => text.replace(pattern, code), label.trim());

/** What a Mermaid label codes: an entity, a tag, a quote, markdown and line breaks. */
const LABEL_CODINGS: Coding[] = [
  [/[#&](?=\w+;)/g, (mark) => (mark === "#" ? "#35;" : "#amp;")],
  TAG_CODING,
  [/"/g, () => "#quot;"],
  [/^`(?=[\s\S]*`$)/, () => "#96;"],
  BREAK_CODING,
];

/**
 * Text as a Mermaid label holds it: line breaks as `<br>`, and as entity codes what the parser would
 * read as an entity, a tag, a quote or markdown.
 */
export const escapeLabel = (label: string) => codedWith(label, LABEL_CODINGS);

/** Statements that only style the picture (colors, classes, links, tooltips); the renderer ignores them. */
export const STYLING =
  /^(classDef|class|style|linkStyle|cssClass|click|callback|link|links|properties|details)\b/;
const ACCESSIBILITY = /^(accTitle|accDescr)\s*[:{]/;

/**
 * A stateful test for the lines of accessibility statements (`accTitle: …`, `accDescr: …` and a
 * multi-line `accDescr { … }`), which the renderer skips. Call it on every statement in order.
 */
export function accessibilityLines(): (text: string) => boolean {
  let open = false;
  return (text) => {
    if (open) {
      if (text.includes("}")) open = false;
      return true;
    }
    if (!ACCESSIBILITY.test(text)) return false;
    open = /^accDescr\s*\{/.test(text) && !text.includes("}");
    return true;
  };
}

/** Room along a node's side for each wire end: an arrowhead's width and a gap to the next. */
export const END_ROOM = 12;

type PortSide = GraphPort["side"];
/** Where flows enter and leave a symbol, and its side vertices with the one a label prefers last. */
const FLOW_SIDES: Record<Direction, { into: PortSide; out: PortSide; across: PortSide[] }> = {
  TB: { into: "NORTH", out: "SOUTH", across: ["WEST", "EAST"] },
  BT: { into: "SOUTH", out: "NORTH", across: ["WEST", "EAST"] },
  LR: { into: "WEST", out: "EAST", across: ["SOUTH", "NORTH"] },
  RL: { into: "EAST", out: "WEST", across: ["SOUTH", "NORTH"] },
};

/** Placements of a label beside one side of a node, and the side a placement stands beside. */
const BESIDE: Record<PortSide, string> = {
  NORTH: "OUTSIDE V_TOP H_CENTER",
  EAST: "OUTSIDE H_RIGHT V_CENTER",
  SOUTH: "OUTSIDE V_BOTTOM H_CENTER",
  WEST: "OUTSIDE H_LEFT V_CENTER",
};
function labelSide(placement: string): PortSide | null {
  if (placement.includes("V_CENTER"))
    return placement.includes("H_LEFT") ? "WEST" : placement.includes("H_RIGHT") ? "EAST" : null;
  if (placement.includes("H_CENTER"))
    return placement.includes("V_TOP") ? "NORTH" : placement.includes("V_BOTTOM") ? "SOUTH" : null;
  return null;
}

/**
 * Small symbols (decisions, merges, choices, initial and final nodes) take each wire at a vertex of
 * their own, so ELK lays the wires out where they are drawn: a fixed port at each vertex. A wire
 * along the flow enters at the side facing the flow and leaves at the opposite one; a wire against
 * the flow (back to a node of lower `rank`) does the reverse. Wires that find their side taken turn
 * to a free vertex, the sides first. A label beside the symbol keeps its side unless every other
 * vertex is taken; with `moveLabels` (a decision's question, the name of an initial node) it gives
 * way to a wire before the wire turns against the flow, and moves to a free side. Notes stay where
 * the author put them. Gives the symbols their ports
 * and the edges their port ids; returns, for each symbol given ports, whether a label is left on a
 * side with a wire. Symbols with more wires than vertices keep ELK's own ports.
 */
export function addVertexPorts(
  roots: GraphNode[],
  edges: GraphEdge[],
  direction: Direction,
  rank: (id: string) => number,
  options: { moveLabels?: boolean } = {},
): Map<string, boolean> {
  const symbols = new Map<string, GraphNode>();
  const visit = (node: GraphNode) => {
    if (node.centered && !node.children?.length) symbols.set(node.id, node);
    node.children?.forEach(visit);
  };
  roots.forEach(visit);
  const { into, out, across } = FLOW_SIDES[direction];
  const crowded = new Map<string, boolean>();
  for (const [id, node] of symbols) {
    const ends = edges.filter(
      (edge) => edge.source !== edge.target && (edge.source === id || edge.target === id),
    );
    const drawn = ends.filter((edge) => !edge.invisible);
    if (!drawn.length || drawn.length > 4) continue;
    const labelled = (node.labels ?? [])
      .map((label) => labelSide(label.placement))
      .filter((side) => side !== null);
    const natural = (edge: GraphEdge): PortSide => {
      const along = rank(edge.source) <= rank(edge.target);
      return (edge.source === id) === along ? out : into;
    };
    // Wires along the flow keep their natural side first, then the others in source order.
    const order = drawn.toSorted(
      (a, b) => +(rank(a.source) > rank(a.target)) - +(rank(b.source) > rank(b.target)),
    );
    // A label that may move gives way to a wire before the wire turns against the flow; one that stays is passed last.
    const free = (sides: PortSide[]) => sides.filter((side) => !labelled.includes(side)),
      beside = (sides: PortSide[]) => sides.filter((side) => labelled.includes(side));
    const turns = options.moveLabels
      ? [...free(across), ...beside(across), into, out]
      : [...free([...across, into, out]), ...beside([...across, into, out])];
    const taken = new Map<GraphEdge, PortSide>(),
      used = new Set<PortSide>();
    for (const edge of order) {
      const side = [natural(edge), ...turns].find((side) => !used.has(side))!;
      taken.set(edge, side);
      used.add(side);
    }
    if (options.moveLabels) {
      node.labels = node.labels?.map((label) => {
        const side = labelSide(label.placement);
        const free = [...across, into, out].find(
          (other) => !used.has(other) && !labelled.includes(other),
        );
        if (!side || !used.has(side) || !free) return label;
        labelled.push(free);
        return { ...label, placement: BESIDE[free] };
      });
    }
    crowded.set(
      id,
      (node.labels ?? []).some((label) => {
        const side = labelSide(label.placement);
        return !!side && used.has(side);
      }),
    );
    const width = node.width ?? 40,
      height = node.height ?? 30;
    const place: Record<PortSide, { x: number; y: number }> = {
      NORTH: { x: width / 2, y: 0 },
      SOUTH: { x: width / 2, y: height },
      WEST: { x: 0, y: height / 2 },
      EAST: { x: width, y: height / 2 },
    };
    // Layout-only edges share the port of their natural side.
    const sides = new Set<PortSide>();
    for (const edge of ends) {
      const side = taken.get(edge) ?? natural(edge),
        port = `${id}@${side.toLowerCase()}`;
      sides.add(side);
      if (edge.source === id) edge.sourcePort = port;
      else edge.targetPort = port;
    }
    node.ports = [...sides].map((side) => ({
      id: `${id}@${side.toLowerCase()}`,
      ...place[side],
      side,
    }));
  }
  return crowded;
}

/**
 * Reverse postorder of an iterative depth-first search (so long chains cannot overflow the stack):
 * the search starts at each of `starts` in turn (one already reached is skipped) and follows
 * `successors` in the order given. Maps each reached node to its index in that order.
 */
export function reversePostorder(
  starts: Iterable<string>,
  successors: (id: string) => readonly string[],
): Map<string, number> {
  const seen = new Set<string>(),
    post: string[] = [];
  for (const start of starts) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [{ id: start, next: [...successors(start)] }];
    while (stack.length) {
      const top = stack.at(-1)!,
        next = top.next.shift();
      if (next === undefined) {
        post.push(top.id);
        stack.pop();
        continue;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push({ id: next, next: [...successors(next)] });
    }
  }
  return new Map(post.toReversed().map((id, index) => [id, index]));
}
