/** SAP TAM block diagrams: the text syntax. tam-layout.ts lays a parsed diagram out and draws it. */

import type { Direction } from "./elk.ts";
import { expandMultiples, rowDots, rowPointers } from "./tam-rows.ts";
import { rejectUnsupported } from "./uml-header.ts";

/**
 * Parser for SAP TAM (Technical Architecture Modeling) Component/Block diagrams in ```tam fences.
 * The notation follows the SAP TAM Standard and its FMC block diagram roots: agents, storages,
 * channels and accesses on conceptual level; components, interfaces and connectors on design level.
 * See docs/tam.md for the syntax.
 */

type NodeKind =
  | "agent"
  | "human"
  | "storage"
  | "component"
  | "subsystem"
  | "class"
  | "package"
  | "group"
  | "dots"
  | "channel"
  | "interface";

type EdgeKind =
  | "read"
  | "write"
  | "modify"
  | "channel"
  | "delegation"
  | "dependency"
  | "assembly"
  | "provided"
  | "required";

export interface TamNode {
  id: string;
  kind: NodeKind;
  label: string;
  parent: string | null;
  children: string[];
  /** Staggered copies behind the node. */
  stack: boolean;
  color?: string;
  /** For groups: whether it groups storages (rounded) or active elements. */
  passive?: boolean;
  /** Copies made for `...` multiplicity share this id. */
  origin?: string;
  /** Where the source places the element (`@x,y` and a size `WxH`); without it, layout does. */
  at?: Placement;
  /** Where the source places the copy of an element shown as several (`... @x,y @x,y`). */
  copyAt?: Placement;
  line: number;
}

/**
 * An element placed by hand: its top left corner in diagram coordinates and, when the source gives
 * one, its size. A size is a least size: an element never gets smaller than its name and its parts.
 */
export interface Placement {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface TamEdge {
  id: string;
  kind: EdgeKind;
  /** Access edges go from the active element to the storage, whatever the data direction. */
  source: string;
  target: string;
  label?: string;
  /** Channels: data flow toward the source and/or target end. */
  flow?: { toSource: boolean; toTarget: boolean };
  /** Channels: requests are sent toward the source and/or target end. */
  request?: { toSource: boolean; toTarget: boolean };
  protocol?: string;
  /** A «pointer» between sibling storages: they share a row and the line is drawn between them after layout. */
  aside?: boolean;
  /** Where the source places the label: its middle's offset from the middle of the line (`@+dx,-dy`). */
  labelAt?: { x: number; y: number };
  line: number;
}

/** A parsed TAM source: its elements by id, the top-level ones in order, and the connections. */
export interface TamDiagram {
  title?: string;
  direction: Direction;
  level?: "conceptual" | "design";
  nodes: Map<string, TamNode>;
  roots: string[];
  edges: TamEdge[];
}

/** A syntax or rule error in a TAM source, with its line (0 for the whole source). */
export class TamError extends Error {
  line: number;
  constructor(line: number, message: string) {
    super(line ? `Line ${line}: ${message}` : message);
    this.line = line;
  }
}

/** The kinds a declaration starts with. */
export const ELEMENT_KINDS = [
  "agent",
  "human",
  "storage",
  "component",
  "subsystem",
  "class",
  "package",
  "group",
] as const;

const ACTIVE = new Set<NodeKind>(["agent", "human", "component", "subsystem", "class"]);

/** The colors an element takes with `:::name`. */
export const COLORS = new Set([
  "blue",
  "orange",
  "green",
  "yellow",
  "pink",
  "purple",
  "red",
  "gray",
]);

const ID = "[A-Za-z_]\\w*";

const NUMBER = "\\d+(?:\\.\\d+)?";

/** A placement among an element's modifiers: `@120,40`, or `@120,40 200x80` with a size. */
export const PLACEMENT = `@\\s*(-?${NUMBER})\\s*,\\s*(-?${NUMBER})(?:\\s+(${NUMBER})x(${NUMBER}))?`;

/**
 * Declarations: `agent web[Web Server]:::blue stack @120,40 {`; a quoted label also works. The
 * groups are the kind, the id, the label in brackets or in quotes, the modifiers and the brace.
 */
export const ELEMENT = new RegExp(
  `^(${ELEMENT_KINDS.join("|")})(?:\\s+(${ID}))?\\s*(?:\\[([^\\]]*)\\]|"([^"]*)")?((?::::\\w+|\\s+(?:stack|\\.\\.\\.)|\\s*${PLACEMENT.replace(/\((?!\?)/g, "(?:")})*)\\s*(\\{\\s*\\}|\\{)?$`,
);

/** Placements reach this far from the origin, and sizes this far across: a picture stays drawable. */
const MAX_COORDINATE = 100_000,
  MAX_SIZE = 10_000;

/** `gateway provides IRefund`: the element, what it does with the interface, and the interface's name. */
export const INTERFACE = new RegExp(`^(${ID})\\s+(provides|requires)\\s+(.+)$`);

/**
 * Connections are Mermaid flowchart edges with one word on them, from the element that acts to the one
 * it acts on: `api -- reads --> db`, `a <-- calls --> b`, `a --- b`, `a -- label --- b`, `a -. use .-> b`.
 * The word may be followed by `: label` and `@Protocol`, inside the edge.
 */
const LINK = /\s*(?:(<--|--)\s*([^\s-].*?)\s*(-->|---)|-\.\s*(.+?)\s*\.->|(---))\s*/g;

/** The words of solid edges; anything else goes in the label after a colon. */
const WORDS: Word[] = [
  "reads/writes",
  "reads",
  "writes",
  "sends data",
  "calls",
  "delegates",
  "requires",
];

/** Words compare without case and singular or plural: `Read`, `read` and `reads` are one word. */
const stem = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split("/")
    .map((part) => part.replace(/^(\w+?)s?\b/, "$1"))
    .join("/");

const STEMS = new Map(WORDS.map((word) => [stem(word), word]));

function wordOf(head: string): Word | undefined {
  if (/^requires?(\s+\S+)?$/i.test(head)) return "requires";
  return STEMS.get(stem(head));
}

const KEYWORDS: Record<string, string> = {
  create: "create",
  generate: "generate",
  pointer: "pointer",
  use: "use",
  import: "import",
};

const ENDS = new RegExp(`^${ID}(?:\\s*&\\s*${ID})*$`);

const MAX_TAM_CHARS = 20_000;

const MAX_ELEMENTS = 300;

/** Active elements can act: agents, humans, components, subsystems, classes and groups of them. */
export function isActive(node: TamNode): boolean {
  return ACTIVE.has(node.kind) || (node.kind === "group" && !node.passive);
}

/** Storages keep information: storages and groups of them. */
export const isStorage = (node: TamNode) =>
  node.kind === "storage" || (node.kind === "group" && !!node.passive);

const isDesign = (node: TamNode) =>
  node.kind === "component" ||
  node.kind === "subsystem" ||
  node.kind === "class" ||
  node.kind === "package";

const article = (kind: string) => `${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind}`;

const unquote = (text: string) => text.trim().replace(/^"(.*)"$/, "$1");

/**
 * Parses a TAM source (docs/tam.md); throws TamError with the line of the first error, or the
 * `unsupported` UmlError for a Mermaid source this package does not draw.
 */
export function parseTam(source: string): TamDiagram {
  rejectUnsupported(source);
  // CRLF and a lone CR end a line like LF (as in uml.ts); `.` stops at `\r`, so a CRLF line would
  // keep its `%%` comment.
  // A final newline ends the last line; it does not start another one.
  const lines = source.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  if (source.length > MAX_TAM_CHARS || lines.length > 400)
    throw new TamError(0, "Diagram exceeds the limit of 20,000 characters or 400 lines.");
  const diagram: TamDiagram = { direction: "TB", nodes: new Map(), roots: [], edges: [] };
  const stack: TamNode[] = [];
  const raw: (
    | (Connection & { line: number })
    | { line: number; from: string; offers: "provides" | "requires"; label: string }
  )[] = [];
  const multiples: string[] = [];
  let anonymous = 0;

  const add = (node: TamNode) => {
    if (diagram.nodes.has(node.id))
      throw new TamError(
        node.line,
        `\`${node.id}\` is already declared on line ${diagram.nodes.get(node.id)!.line}.`,
      );
    if (diagram.nodes.size >= MAX_ELEMENTS)
      throw new TamError(node.line, `Diagrams are limited to ${MAX_ELEMENTS} elements.`);
    diagram.nodes.set(node.id, node);
    if (node.parent) diagram.nodes.get(node.parent)!.children.push(node.id);
    else diagram.roots.push(node.id);
  };

  lines.forEach((text, index) => {
    const line = index + 1;
    const statement = text.replace(/%%.*$/, "").trim();
    if (!statement) return;
    let match: RegExpMatchArray | null;
    if ((match = statement.match(/^title\s+(.+)$/))) {
      diagram.title = unquote(match[1]);
      return;
    }
    if ((match = statement.match(/^direction\s+(\w+)$/))) {
      const value = match[1].toUpperCase().replace(/^TD$/, "TB");
      if (!["TB", "BT", "LR", "RL"].includes(value))
        throw new TamError(line, `Unknown direction \`${match[1]}\`; use TB, BT, LR or RL.`);
      diagram.direction = value as Direction;
      return;
    }
    if ((match = statement.match(/^level\s+(\w+)$/))) {
      if (match[1] !== "conceptual" && match[1] !== "design")
        throw new TamError(line, `Unknown level \`${match[1]}\`; use conceptual or design.`);
      diagram.level = match[1];
      return;
    }
    if (statement === "...") {
      // Three dots between the elements declared before and after: more of the same kind.
      const parent = stack.at(-1)?.id ?? null;
      add({
        id: `dots#${++anonymous}`,
        kind: "dots",
        label: "",
        parent,
        children: [],
        stack: false,
        line,
      });
      return;
    }
    if (statement === "}") {
      if (!stack.pop()) throw new TamError(line, "Unmatched `}`.");
      return;
    }
    if ((match = statement.match(ELEMENT))) {
      const [, kind, id, bracketed, quoted, modifiers, opens] = match;
      // A blank label (`[]` or `[ ]`) shows no text.
      const label = (bracketed ?? quoted)?.trim();
      if (!id && kind !== "group")
        throw new TamError(
          line,
          `\`${kind}\` needs an id, for example \`${kind} web "Web Server"\`.`,
        );
      const placements = [...modifiers.matchAll(new RegExp(PLACEMENT, "g"))];
      // An element shown as several (`...`) may place its copy too, with a second position.
      const several = /(^|\s)\.\.\.(\s|$)/.test(modifiers.replace(new RegExp(PLACEMENT, "g"), " "));
      if (placements.length > (several ? 2 : 1))
        throw new TamError(
          line,
          several
            ? `\`${id ?? kind}\` has more than two positions; the first places it, the second its copy.`
            : `\`${id ?? kind}\` is placed twice; keep one \`@x,y\`.`,
        );
      const at = placements[0] && placement(placements[0], line);
      const copyAt = placements[1] && placement(placements[1], line);
      if (copyAt?.width !== undefined)
        throw new TamError(line, "A copy is as large as its original; place it with `@x,y` alone.");
      const options = modifiers
        .replace(new RegExp(PLACEMENT, "g"), " ")
        .replace(/:::/g, " :::")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const color = options.find((option) => option.startsWith(":::"))?.slice(3);
      if (color && !COLORS.has(color))
        throw new TamError(line, `Unknown color \`${color}\`; use ${[...COLORS].join(", ")}.`);
      const node: TamNode = {
        id: id || `group#${++anonymous}`,
        kind: kind as NodeKind,
        label: label ?? (kind === "group" ? "" : id!),
        parent: stack.at(-1)?.id ?? null,
        children: [],
        stack: options.includes("stack"),
        color,
        ...(at ? { at } : {}),
        ...(copyAt ? { copyAt } : {}),
        line,
      };
      if (options.includes("...")) multiples.push(node.id);
      if (
        (node.stack || options.includes("...")) &&
        !["agent", "human", "storage"].includes(node.kind)
      ) {
        throw new TamError(
          line,
          "Only agents and storages can be shown as multiple (`stack` or `...`).",
        );
      }
      const container = opens === "{";
      if (container && options.includes("..."))
        throw new TamError(line, "A container cannot use `...`; use `stack` instead.");
      add(node);
      if (container) stack.push(node);
      return;
    }
    if ((match = statement.match(INTERFACE))) {
      raw.push({
        line,
        from: match[1],
        offers: match[2] as "provides" | "requires",
        label: unquote(match[3]),
      });
      return;
    }
    const connections = readConnections(statement, line);
    if (connections) {
      for (const connection of connections) raw.push({ line, ...connection });
      return;
    }
    if (/\w\s*(?:<?-->|<?==>|-\.->)/.test(statement)) {
      throw new TamError(
        line,
        `\`${statement}\` has no connection word. Name what happens on the arrow: \`a -- calls --> b\`, \`a -- sends data --> b\`, \`api -- reads --> db\`, or \`a -. use .-> b\` for a dependency.`,
      );
    }
    if (/^[A-Za-z_]\w*\s*[^\w\s"[{]+\s*[A-Za-z_]\w*/.test(statement)) {
      throw new TamError(
        line,
        `Cannot read connection \`${statement}\`. Connections name what happens: \`a -- reads --> db\`, \`a -- calls --> b\`, \`a -- sends data --> b\`, \`a --- b\`, \`a -. use .-> b\`.`,
      );
    }
    throw new TamError(
      line,
      `Cannot read \`${statement}\`. Declare elements with ${ELEMENT_KINDS.map((kind) => `\`${kind}\``).join(", ")}, or connect two ids.`,
    );
  });
  if (stack.length)
    throw new TamError(stack.at(-1)!.line, `\`${stack.at(-1)!.id}\` is missing its closing \`}\`.`);

  // Groups are classified bottom-up (children are declared after parents) so nested storage groups count as storages.
  for (const node of [...diagram.nodes.values()].toReversed()) {
    if (node.kind === "group") {
      const children = node.children
        .map((child) => diagram.nodes.get(child)!)
        .filter((child) => child.kind !== "dots");
      node.passive = children.length > 0 && children.every(isStorage);
    }
  }
  validateNesting(diagram);
  // Multiplicity dots stand between elements of one kind (TAM standard 3.3.11).
  for (const dots of diagram.nodes.values()) {
    if (dots.kind !== "dots" || !dots.id.startsWith("dots#")) continue;
    const siblings = (dots.parent ? diagram.nodes.get(dots.parent)!.children : diagram.roots).map(
      (id) => diagram.nodes.get(id)!,
    );
    const index = siblings.indexOf(dots),
      before = siblings.slice(0, index).findLast((node) => node.kind !== "dots"),
      after = siblings.slice(index + 1).find((node) => node.kind !== "dots");
    if (
      before &&
      after &&
      (isStorage(before) !== isStorage(after) ||
        (before.kind === "human") !== (after.kind === "human"))
    ) {
      throw new TamError(
        dots.line,
        `\`...\` stands between elements of one kind; \`${before.id}\` is ${article(before.kind)} and \`${after.id}\` ${article(after.kind)}.`,
      );
    }
  }

  const lookup = (id: string, line: number) => {
    const node = diagram.nodes.get(id);
    if (!node)
      throw new TamError(
        line,
        `Unknown element \`${id}\`. Declare it first, for example \`agent ${id}[Name]\` or \`storage ${id}[Name]\`.`,
      );
    return node;
  };
  let count = 0;
  // An interface an assembly connector already draws is not drawn a second time.
  const assembled = new Set(
    raw.flatMap((entry) =>
      "word" in entry && entry.word === "requires"
        ? [`${entry.to} provides ${entry.label}`, `${entry.from} requires ${entry.label}`]
        : [],
    ),
  );
  for (const entry of raw) {
    const { line, label } = entry,
      a = lookup(entry.from, line);
    const edge = (fields: Omit<TamEdge, "id" | "line">) =>
      diagram.edges.push({
        id: `e${++count}`,
        line,
        ...fields,
        ...("labelAt" in entry && entry.labelAt ? { labelAt: entry.labelAt } : {}),
      });
    if ("offers" in entry) {
      const { offers } = entry;
      if (!isActive(a) || a.kind === "human")
        throw new TamError(
          line,
          `Only components, subsystems, classes and agents ${offers.slice(0, -1)} interfaces; \`${a.id}\` is a ${a.kind}.`,
        );
      if (assembled.has(`${a.id} ${offers} ${label}`)) continue;
      const id = `${a.id}#${offers}#${++count}`;
      add({
        id,
        kind: "interface",
        label: label || "",
        parent: a.parent,
        children: [],
        stack: false,
        line,
      });
      edge({ kind: offers === "provides" ? "provided" : "required", source: a.id, target: id });
      continue;
    }
    const { word, both, protocol } = entry,
      b = lookup(entry.to, line);
    if (a === b) throw new TamError(line, `\`${a.id}\` cannot connect to itself.`);
    checkWord(diagram, word, a, b, protocol, line, both);
    const nested = isAncestor(diagram, a.id, b.id) || isAncestor(diagram, b.id, a.id);
    if (
      (nested && word !== "delegates") ||
      (word === "delegates" && (!isActive(a) || !isActive(b)))
    ) {
      throw new TamError(
        line,
        `\`${a.id}\` contains \`${b.id}\` or the other way round; nested elements share their container's connections.`,
      );
    }
    const pkg = [a, b].find((node) => node.kind === "package");
    if (pkg && word !== "dependency")
      throw new TamError(
        line,
        `Package \`${pkg.id}\` connects only through dependencies such as \`-. import .->\`.`,
      );
    // checkWord has settled which kinds of elements each word connects.
    switch (word) {
      case "reads":
      case "writes":
      case "reads/writes":
        edge({
          kind: word === "reads" ? "read" : word === "writes" ? "write" : "modify",
          source: a.id,
          target: b.id,
          label,
        });
        break;
      case "delegates":
        edge({ kind: "delegation", source: a.id, target: b.id, label });
        break;
      case "sends data":
        edge({
          kind: "channel",
          source: a.id,
          target: b.id,
          label,
          protocol,
          flow: { toSource: both, toTarget: true },
        });
        break;
      case "calls":
        edge({
          kind: "channel",
          source: a.id,
          target: b.id,
          label,
          protocol,
          request: { toSource: both, toTarget: true },
        });
        break;
      case "---":
        edge({
          kind: "channel",
          source: a.id,
          target: b.id,
          label,
          protocol,
          flow: { toSource: false, toTarget: false },
        });
        break;
      case "dependency": {
        const keyword = KEYWORDS[label!];
        if (keyword === "pointer" && !(isStorage(a) && isStorage(b)))
          throw new TamError(line, "A «pointer» dependency connects two storages.");
        if ((keyword === "create" || keyword === "generate") && !(isActive(a) && isActive(b)))
          throw new TamError(
            line,
            `A «${keyword}» dependency connects active elements, not storages.`,
          );
        edge({ kind: "dependency", source: a.id, target: b.id, label: `«${keyword}»` });
        break;
      }
      case "requires":
        // `a -- requires IName --> b`: a requires the interface b provides.
        for (const node of [a, b]) {
          if (!isActive(node) || node.kind === "human")
            throw new TamError(
              line,
              `Interfaces connect components, subsystems, classes or agents; \`${node.id}\` is a ${node.kind}.`,
            );
        }
        edge({ kind: "assembly", source: a.id, target: b.id, label, protocol });
    }
  }

  if (diagram.level === "conceptual") {
    for (const node of diagram.nodes.values()) {
      if (isDesign(node) || node.kind === "interface")
        throw new TamError(
          node.line,
          `${node.kind === "interface" ? "Interfaces" : `${node.kind[0].toUpperCase()}${node.kind.slice(1)}s`} belong to the design level; remove \`level conceptual\` or use agents.`,
        );
    }
    const design = diagram.edges.find(
      (edge) => edge.kind === "assembly" || edge.kind === "delegation",
    );
    if (design)
      throw new TamError(
        design.line,
        "Assembly and delegation connectors belong to the design level.",
      );
  }
  expandMultiples(diagram, multiples);
  rowDots(diagram);
  rowPointers(diagram);
  return diagram;
}

/** The placement a declaration carries, within the limits of a drawable picture. */
function placement(match: RegExpMatchArray, line: number): Placement {
  const [x, y, width, height] = match.slice(1).map((value) => (value ? Number(value) : undefined));
  if (Math.abs(x!) > MAX_COORDINATE || Math.abs(y!) > MAX_COORDINATE)
    throw new TamError(
      line,
      `\`${match[0]}\` is too far out; positions reach ${MAX_COORDINATE} from the origin.`,
    );
  if (width === undefined) return { x: x!, y: y! };
  if (!width || !height || width > MAX_SIZE || height > MAX_SIZE)
    throw new TamError(
      line,
      `\`${match[0]}\` has no drawable size; sizes run from 1 to ${MAX_SIZE} each way.`,
    );
  return { x: x!, y: y!, width, height };
}

/** Whether the source places elements by hand: one placement is enough, layout places the rest around it. */
export const isPlaced = (diagram: TamDiagram) =>
  [...diagram.nodes.values()].some((node) => node.at);

/**
 * Mermaid-style connections: `a -- calls: label @Protocol --> b`, chains such as `a --- b --- c`, and
 * `a & b -- reads --> s` for several ends. Word, label and protocol apply to every connection in the statement.
 */
export type Word =
  | "reads"
  | "writes"
  | "reads/writes"
  | "sends data"
  | "calls"
  | "delegates"
  | "requires"
  | "---"
  | "dependency";

/** `both` marks `<--`: data or requests in both directions. */
export type Connection = {
  from: string;
  to: string;
  word: Word;
  both: boolean;
  label?: string;
  protocol?: string;
  /** Where its label stands: the offset of the label's middle from the middle of the line. */
  labelAt?: { x: number; y: number };
};

/**
 * The place of a connection's label, behind its statement: `a -- calls --> b @+20,-14` puts the
 * label's middle 20 right of and 14 above the middle of the line. The signs say it is an offset,
 * not a position as an element's `@x,y` is; a number without one counts as positive.
 */
export const LABEL_PLACE = new RegExp(`\\s+@\\s*([+-]?${NUMBER})\\s*,\\s*([+-]?${NUMBER})\\s*$`);

/**
 * The connections of one statement: one or more edges between ids (`a & b` for several ends), each
 * with its word, label and protocol. Null when the statement is no connection.
 */
export function readConnections(text: string, line: number): Connection[] | null {
  const placed = text.match(LABEL_PLACE),
    statement = placed ? text.slice(0, placed.index) : text,
    labelAt = placed && { x: Number(placed[1]), y: Number(placed[2]) };
  if (labelAt && (Math.abs(labelAt.x) > MAX_COORDINATE || Math.abs(labelAt.y) > MAX_COORDINATE))
    throw new TamError(line, `\`${placed[0].trim()}\` is too far out for a label's place.`);
  const pieces: string[] = [],
    links: RegExpExecArray[] = [];
  let last = 0,
    match: RegExpExecArray | null;
  LINK.lastIndex = 0;
  while ((match = LINK.exec(statement))) {
    pieces.push(statement.slice(last, match.index));
    links.push(match);
    last = LINK.lastIndex;
  }
  pieces.push(statement.slice(last));
  if (!links.length || !pieces.every((piece) => ENDS.test(piece.trim()))) return null;
  const ends = pieces.map((piece) => piece.split("&").map((end) => end.trim()));
  const connections: Connection[] = [];
  links.forEach((link, index) => {
    const [, open, text, close, dotted, bare] = link;
    let word: Word, label: string | undefined, protocol: string | undefined;
    if (bare) word = "---";
    else if (dotted) {
      const keyword = dotted.toLowerCase();
      if (/[:@]/.test(dotted) && KEYWORDS[keyword.split(/[:@\s]/)[0]])
        throw new TamError(
          line,
          `A dependency carries only its keyword: \`-. ${keyword.split(/[:@\s]/)[0]} .->\`.`,
        );
      if (!KEYWORDS[keyword])
        throw new TamError(
          line,
          `\`-. ${dotted} .->\` is no dependency; use \`-. create .->\`, \`-. generate .->\`, \`-. pointer .->\`, \`-. use .->\` or \`-. import .->\`.`,
        );
      word = "dependency";
      label = keyword;
    } else {
      // `word: label @Protocol`, each part optional except the word on arrows.
      const at = text.match(/^(.*?)\s*@\s*([^@\s][^@]*)$/);
      const body = (at ? at[1] : text).trim();
      protocol = at ? unquote(at[2]) : undefined;
      if (close === "---") {
        if (open !== "--")
          throw new TamError(
            line,
            "A channel without direction is `a --- b`, or `a -- label --- b`.",
          );
        word = "---";
        label = body || undefined;
      } else {
        const colon = body.indexOf(":"),
          head = (colon < 0 ? body : body.slice(0, colon)).trim();
        label = colon < 0 ? undefined : unquote(body.slice(colon + 1)) || undefined;
        const found = wordOf(head);
        if (!found)
          throw new TamError(
            line,
            `\`${head}\` is no connection word; use \`reads\`, \`writes\`, \`reads/writes\`, \`sends data\`, \`calls\`, \`delegates\` or \`requires [IName]\`, and put anything else in the label: \`-- calls: ${head} -->\`, or \`-- writes: ${head} -->\` toward a storage.`,
          );
        if (open === "<--" && found !== "sends data" && found !== "calls")
          throw new TamError(
            line,
            `Only \`sends data\` and \`calls\` go both ways (\`a <-- calls --> b\`); \`${found}\` points one way.`,
          );
        word = found;
        if (word === "requires") label = head.replace(/^requires?\s*/i, "") || undefined;
      }
    }
    const both = open === "<--";
    for (const from of ends[index])
      for (const to of ends[index + 1]) connections.push({ from, to, word, both, label, protocol });
  });
  // A label's place names one label: the statement says one connection.
  if (labelAt) {
    if (connections.length > 1)
      throw new TamError(
        line,
        "A label's place follows a connection of its own: write one connection a line to place their labels.",
      );
    connections[0].labelAt = labelAt;
  }
  return connections;
}

/** A connection word fits what it connects: accesses go from an active element to a storage, channels join active elements. */
function checkWord(
  diagram: TamDiagram,
  word: Word,
  a: TamNode,
  b: TamNode,
  protocol: string | undefined,
  line: number,
  both = false,
) {
  if (word === "reads" || word === "writes" || word === "reads/writes") {
    if (isStorage(a) && isActive(b))
      throw new TamError(
        line,
        `\`${a.id}\` is a storage and does not act; write the access from \`${b.id}\`: \`${b.id} -- ${word} --> ${a.id}\`.`,
      );
    if (!isActive(a) || !isStorage(b)) {
      throw new TamError(
        line,
        `\`${word}\` goes from an active element to a storage, as in \`api -- ${word} --> db\`; ${isStorage(a) ? `\`${a.id}\` is a storage` : `\`${b.id}\` is ${article(b.kind)}`}. Between active elements use \`-- sends data -->\` or \`-- calls -->\`.`,
      );
    }
    if (protocol)
      throw new TamError(
        line,
        `A protocol belongs on a channel or interface, not on an access: \`-- calls @${protocol} -->\`.`,
      );
    return;
  }
  if (word === "sends data" || word === "calls" || word === "---") {
    const storage = [a, b].find((node) => !isActive(node));
    if (storage)
      throw new TamError(
        line,
        `\`${storage.id}\` is a storage: agents read or write it (\`agent -- reads --> ${storage.id}\`), they don't ${word === "calls" ? "call it" : word === "---" ? "talk to it" : "send it data"}.`,
      );
    if (isAncestor(diagram, a.id, b.id) || isAncestor(diagram, b.id, a.id)) {
      const [outer, inner] = isAncestor(diagram, a.id, b.id) ? [a, b] : [b, a];
      throw new TamError(
        line,
        // A delegation exists only on design level; elsewhere the hint would turn a modeling slip into one.
        diagram.level === "design"
          ? `\`${outer.id}\` contains \`${inner.id}\`; a container passes on to its part with \`${outer.id} -- delegates --> ${inner.id}\`.`
          : `\`${outer.id}\` contains \`${inner.id}\`, and a container stands for its parts, so the two are never connected; connect \`${inner.id}\` to the element outside \`${outer.id}\` it works with, or leave the connection out.`,
      );
    }
    // TAM standard 3.3.6: a channel is defined between agents only.
    const design = [a, b].find((node) => !talks(diagram, node));
    if (design) {
      const other = design === a ? b : a;
      throw new TamError(
        line,
        `Channels join agents; \`${design.id}\` is ${article(design.kind)}, which connects through interfaces: \`${a.id} -- requires IName --> ${b.id}\`${other.kind === "human" ? "" : `, or \`${design.id} provides IName\``}.`,
      );
    }
    // TAM standard 3.3.6: fewer data flow ends than ends, so data flows one way on a channel.
    if (word === "sends data" && both)
      throw new TamError(
        line,
        `Data flows one way on a channel; for requests both ways write \`${a.id} <-- calls --> ${b.id}\`, for data both ways two channels.`,
      );
    return;
  }
  if (word === "delegates" && !isAncestor(diagram, a.id, b.id))
    throw new TamError(
      line,
      `\`${a.id}\` does not contain \`${b.id}\`; \`delegates\` goes from a container to its part.`,
    );
}

/** Whether an element can be the end of a channel: an agent, or a group of such. */
function talks(diagram: TamDiagram, node: TamNode): boolean {
  if (node.kind === "agent" || node.kind === "human") return true;
  // A group of agents, also with the storages they keep (an FMC object: its methods and its data).
  if (node.kind !== "group" || node.passive) return false;
  return node.children
    .map((child) => diagram.nodes.get(child)!)
    .filter((child) => child.kind !== "dots")
    .every((child) => isStorage(child) || talks(diagram, child));
}

function isAncestor(diagram: TamDiagram, ancestor: string, id: string): boolean {
  for (let node = diagram.nodes.get(id); node?.parent; node = diagram.nodes.get(node.parent))
    if (node.parent === ancestor) return true;
  return false;
}

/** TAM nesting rules: passive elements hold only storages, humans hold nothing, components hold components, classes and storages. */
function validateNesting(diagram: TamDiagram) {
  for (const node of diagram.nodes.values()) {
    if (!node.children.length) continue;
    const children = node.children
      .map((child) => diagram.nodes.get(child)!)
      .filter((child) => child.kind !== "dots");
    if (!children.length) continue;
    if (node.kind === "human")
      throw new TamError(node.line, `Human agent \`${node.id}\` cannot contain elements.`);
    if (node.kind === "storage") {
      const active = children.find(isActive);
      if (active)
        throw new TamError(
          active.line,
          `Storage \`${node.id}\` cannot contain the active element \`${active.id}\`; passive elements hold only storages.`,
        );
    }
    if (node.kind === "component" || node.kind === "class") {
      const wrong = children.find(
        (child) =>
          !["component", "class", "storage"].includes(child.kind) &&
          !(child.kind === "group" && child.passive),
      );
      if (wrong)
        throw new TamError(
          wrong.line,
          `${node.kind === "class" ? "Class" : "Component"} \`${node.id}\` can contain components, classes and storages, not the ${wrong.kind} \`${wrong.id}\`.`,
        );
    }
    if (node.kind === "package") {
      const wrong = children.find(
        (child) => !["package", "class", "component", "subsystem"].includes(child.kind),
      );
      if (wrong)
        throw new TamError(
          wrong.line,
          `Package \`${node.id}\` can contain packages, classes, components and subsystems, not the ${wrong.kind} \`${wrong.id}\`.`,
        );
    }
    if (node.kind === "subsystem") {
      const agent = children.find((child) => child.kind === "agent" || child.kind === "human");
      if (agent)
        throw new TamError(
          agent.line,
          `Subsystem \`${node.id}\` cannot contain the agent \`${agent.id}\`; agents may contain subsystems, not the other way round.`,
        );
      const wrong = children.find(
        (child) =>
          !["subsystem", "component", "class", "storage"].includes(child.kind) &&
          !(child.kind === "group" && child.passive),
      );
      if (wrong)
        throw new TamError(
          wrong.line,
          `Subsystem \`${node.id}\` can contain subsystems, components, classes and storages, not the ${wrong.kind} \`${wrong.id}\`.`,
        );
    }
    // Packages structure a package diagram: they stand at the top or in packages (and frames around them).
    if (node.kind !== "package" && node.kind !== "group") {
      const pkg = children.find((child) => child.kind === "package");
      if (pkg)
        throw new TamError(
          pkg.line,
          `${node.kind[0].toUpperCase()}${node.kind.slice(1)} \`${node.id}\` cannot contain the package \`${pkg.id}\`; packages stand on their own or in packages.`,
        );
    }
  }
}
