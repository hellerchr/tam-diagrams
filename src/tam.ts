/** SAP TAM block diagrams: the text syntax. tam-layout.ts lays a parsed diagram out and draws it. */

import type { Direction } from "./elk.ts";
import { SourceError } from "./source-error.ts";
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
  | "note"
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
  | "required"
  /** The dotted line that attaches a note to an element. */
  | "anchor";

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
export class TamError extends SourceError {}

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
  "note",
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
const LINK = /\s*(?:(<--|--)\s*([^\s-].*?)\s*(-->|---)|-\.\s*(.+?)\s*\.->|(---)|(-\.-)(?!>))\s*/g;

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

/** An interface a statement gives an element: `gateway provides IRefund`. */
type Offer = { line: number; from: string; offers: "provides" | "requires"; label: string };

/** What a parse has read so far: the diagram, the open blocks, and the statements read for later. */
interface Parsing {
  diagram: TamDiagram;
  /** The containers whose blocks are open, innermost last. */
  stack: TamNode[];
  /** The connections and interfaces, added once every element is declared. */
  raw: ((Connection & { line: number }) | Offer)[];
  /** The elements shown as several (`...`). */
  multiples: string[];
  /** Counters for the ids of elements without one, and of connections and interfaces. */
  anonymous: number;
  count: number;
}

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
  const parsing: Parsing = {
    diagram,
    stack: [],
    raw: [],
    multiples: [],
    anonymous: 0,
    count: 0,
  };
  lines.forEach((text, index) => readLine(parsing, text, index + 1));
  const open = parsing.stack.at(-1);
  if (open) throw new TamError(open.line, `\`${open.id}\` is missing its closing \`}\`.`);
  classifyGroups(diagram);
  validateNesting(diagram);
  for (const dots of diagram.nodes.values()) checkDots(diagram, dots);
  addConnections(parsing);
  if (diagram.level === "conceptual") checkConceptual(diagram);
  expandMultiples(diagram, parsing.multiples);
  rowDots(diagram);
  rowPointers(diagram);
  return diagram;
}

/** Adds an element to the diagram, in the container it is declared in. */
function addNode({ diagram }: Parsing, node: TamNode) {
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
}

/** Reads one line of a source into the diagram. */
function readLine(parsing: Parsing, text: string, line: number) {
  const statement = text.replace(/%%.*$/, "").trim();
  if (!statement || readHeader(parsing.diagram, statement, line)) return;
  if (statement === "...") addDots(parsing, line);
  else if (statement === "}") {
    if (!parsing.stack.pop()) throw new TamError(line, "Unmatched `}`.");
  } else if (!readDeclaration(parsing, statement, line)) readStatement(parsing, statement, line);
}

/** Reads a header line: the title, the direction or the level; false for any other statement. */
function readHeader(diagram: TamDiagram, statement: string, line: number): boolean {
  let match: RegExpMatchArray | null;
  if ((match = statement.match(/^title\s+(.+)$/))) diagram.title = unquote(match[1]);
  else if ((match = statement.match(/^direction\s+(\w+)$/)))
    diagram.direction = directionOf(match[1], line);
  else if ((match = statement.match(/^level\s+(\w+)$/))) diagram.level = levelOf(match[1], line);
  return !!match;
}

function directionOf(word: string, line: number): Direction {
  const value = word.toUpperCase().replace(/^TD$/, "TB");
  if (!["TB", "BT", "LR", "RL"].includes(value))
    throw new TamError(line, `Unknown direction \`${word}\`; use TB, BT, LR or RL.`);
  return value as Direction;
}

function levelOf(word: string, line: number): "conceptual" | "design" {
  if (word !== "conceptual" && word !== "design")
    throw new TamError(line, `Unknown level \`${word}\`; use conceptual or design.`);
  return word;
}

/** Three dots between the elements declared before and after: more of the same kind. */
function addDots(parsing: Parsing, line: number) {
  addNode(parsing, {
    id: `dots#${++parsing.anonymous}`,
    kind: "dots",
    label: "",
    parent: parsing.stack.at(-1)?.id ?? null,
    children: [],
    stack: false,
    line,
  });
}

/** Reads a declaration of an element; false where the statement is none. */
function readDeclaration(parsing: Parsing, statement: string, line: number): boolean {
  const match = statement.match(ELEMENT);
  if (!match) return false;
  const [, kind, id, , , , opens] = match;
  if (!id && kind !== "group" && kind !== "note")
    throw new TamError(line, `\`${kind}\` needs an id, for example \`${kind} web "Web Server"\`.`);
  const { options, node } = declaredNode(parsing, match, line);
  const several = options.includes("...");
  if (several) parsing.multiples.push(node.id);
  checkDeclaration(node, several, opens, line);
  addNode(parsing, node);
  if (opens === "{") parsing.stack.push(node);
  return true;
}

/** The element a declaration declares, and the options among its modifiers. */
function declaredNode(parsing: Parsing, match: RegExpMatchArray, line: number) {
  const [, kind, id, , , modifiers] = match;
  const { at, copyAt } = placesOf(modifiers, id ?? kind, line),
    { options, color } = optionsOf(modifiers, line);
  const node: TamNode = {
    id: id || `${kind}#${++parsing.anonymous}`,
    kind: kind as NodeKind,
    label: labelOf(match),
    parent: parsing.stack.at(-1)?.id ?? null,
    children: [],
    stack: options.includes("stack"),
    color,
    ...(at ? { at } : {}),
    ...(copyAt ? { copyAt } : {}),
    line,
  };
  return { options, node };
}

/** The label a declaration gives, in brackets or in quotes; a group or a note without one shows none, any other element its id. */
function labelOf([, kind, id, bracketed, quoted]: RegExpMatchArray): string {
  // A blank label (`[]` or `[ ]`) shows no text.
  const label = (bracketed ?? quoted)?.trim();
  return label ?? (kind === "group" || kind === "note" ? "" : id!);
}

/** The placements among the modifiers of a declaration: its own, and its copy's for one shown as several. */
function placesOf(modifiers: string, name: string, line: number) {
  const placements = [...modifiers.matchAll(new RegExp(PLACEMENT, "g"))];
  // An element shown as several (`...`) may place its copy too, with a second position.
  const several = /(^|\s)\.\.\.(\s|$)/.test(modifiers.replace(new RegExp(PLACEMENT, "g"), " "));
  if (placements.length > (several ? 2 : 1))
    throw new TamError(
      line,
      several
        ? `\`${name}\` has more than two positions; the first places it, the second its copy.`
        : `\`${name}\` is placed twice; keep one \`@x,y\`.`,
    );
  const at = placements[0] && placement(placements[0], line);
  const copyAt = placements[1] && placement(placements[1], line);
  if (copyAt?.width !== undefined)
    throw new TamError(line, "A copy is as large as its original; place it with `@x,y` alone.");
  return { at, copyAt };
}

/** The options among the modifiers of a declaration (`stack`, `...`) and its color. */
function optionsOf(modifiers: string, line: number) {
  const options = modifiers
    .replace(new RegExp(PLACEMENT, "g"), " ")
    .replace(/:::/g, " :::")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const color = options.find((option) => option.startsWith(":::"))?.slice(3);
  if (color && !COLORS.has(color))
    throw new TamError(line, `Unknown color \`${color}\`; use ${[...COLORS].join(", ")}.`);
  return { options, color };
}

/** The rules of a declaration: what may be shown as several, and what may hold others. */
function checkDeclaration(
  node: TamNode,
  several: boolean,
  opens: string | undefined,
  line: number,
) {
  if ((node.stack || several) && !["agent", "human", "storage"].includes(node.kind))
    throw new TamError(
      line,
      "Only agents and storages can be shown as multiple (`stack` or `...`).",
    );
  if (node.kind === "note" && opens)
    throw new TamError(line, "A note holds nothing; it stands beside what it remarks on.");
  if (opens === "{" && several)
    throw new TamError(line, "A container cannot use `...`; use `stack` instead.");
}

/** Reads an interface or the connections of a statement; throws for anything else. */
function readStatement(parsing: Parsing, statement: string, line: number) {
  const match = statement.match(INTERFACE);
  if (match) {
    parsing.raw.push({
      line,
      from: match[1],
      offers: match[2] as "provides" | "requires",
      label: unquote(match[3]),
    });
    return;
  }
  const connections = readConnections(statement, line);
  if (!connections) unreadable(statement, line);
  for (const connection of connections) parsing.raw.push({ line, ...connection });
}

/** Throws for a statement that is none: the error says what it looks like. */
function unreadable(statement: string, line: number): never {
  if (/\w\s*(?:<?-->|<?==>|-\.->)/.test(statement))
    throw new TamError(
      line,
      `\`${statement}\` has no connection word. Name what happens on the arrow: \`a -- calls --> b\`, \`a -- sends data --> b\`, \`api -- reads --> db\`, or \`a -. use .-> b\` for a dependency.`,
    );
  if (/^[A-Za-z_]\w*\s*[^\w\s"[{]+\s*[A-Za-z_]\w*/.test(statement))
    throw new TamError(
      line,
      `Cannot read connection \`${statement}\`. Connections name what happens: \`a -- reads --> db\`, \`a -- calls --> b\`, \`a -- sends data --> b\`, \`a --- b\`, \`a -. use .-> b\`.`,
    );
  throw new TamError(
    line,
    `Cannot read \`${statement}\`. Declare elements with ${ELEMENT_KINDS.map((kind) => `\`${kind}\``).join(", ")}, or connect two ids.`,
  );
}

/** The parts of a group that count for its kind: no dots and no notes. */
const partsOf = (diagram: TamDiagram, node: TamNode) =>
  node.children
    .map((child) => diagram.nodes.get(child)!)
    .filter((child) => child.kind !== "dots" && child.kind !== "note");

/** Groups are classified bottom-up (children are declared after parents) so nested storage groups count as storages. */
function classifyGroups(diagram: TamDiagram) {
  for (const node of [...diagram.nodes.values()].toReversed()) {
    if (node.kind !== "group") continue;
    const children = partsOf(diagram, node);
    node.passive = children.length > 0 && children.every(isStorage);
  }
}

/** Multiplicity dots stand between elements of one kind (TAM standard 3.3.11). */
function checkDots(diagram: TamDiagram, dots: TamNode) {
  if (dots.kind !== "dots" || !dots.id.startsWith("dots#")) return;
  const siblings = (dots.parent ? diagram.nodes.get(dots.parent)!.children : diagram.roots).map(
    (id) => diagram.nodes.get(id)!,
  );
  const real = (node: TamNode) => node.kind !== "dots" && node.kind !== "note";
  const index = siblings.indexOf(dots),
    before = siblings.slice(0, index).findLast(real),
    after = siblings.slice(index + 1).find(real);
  if (before && after && !oneKind(before, after))
    throw new TamError(
      dots.line,
      `\`...\` stands between elements of one kind; \`${before.id}\` is ${article(before.kind)} and \`${after.id}\` ${article(after.kind)}.`,
    );
}

/** Whether two elements are of one kind for the dots between them: both storages or not, both humans or not. */
const oneKind = (a: TamNode, b: TamNode) =>
  isStorage(a) === isStorage(b) && (a.kind === "human") === (b.kind === "human");

/** The element an id names; it must be declared. */
function lookup(diagram: TamDiagram, id: string, line: number): TamNode {
  const node = diagram.nodes.get(id);
  if (!node)
    throw new TamError(
      line,
      `Unknown element \`${id}\`. Declare it first, for example \`agent ${id}[Name]\` or \`storage ${id}[Name]\`.`,
    );
  return node;
}

/** The fields of an edge beside its id and line. */
type EdgeFields = Omit<TamEdge, "id" | "line">;

/** Adds the connections and interfaces read, now that every element is declared. */
function addConnections(parsing: Parsing) {
  const { diagram, raw } = parsing;
  // An interface an assembly connector already draws is not drawn a second time.
  const assembled = new Set(
    raw.flatMap((entry) =>
      "word" in entry && entry.word === "requires"
        ? [`${entry.to} provides ${entry.label}`, `${entry.from} requires ${entry.label}`]
        : [],
    ),
  );
  for (const entry of raw) {
    const a = lookup(diagram, entry.from, entry.line);
    if ("offers" in entry) addOffer(parsing, entry, a, assembled);
    else addEdge(parsing, entry, connectionFields(diagram, entry, a));
  }
}

/** Adds an edge with an id of its own, and the place of its label where the source gives one. */
function addEdge(
  parsing: Parsing,
  entry: { line: number; labelAt?: { x: number; y: number } },
  fields: EdgeFields,
) {
  parsing.diagram.edges.push({
    id: `e${++parsing.count}`,
    line: entry.line,
    ...fields,
    ...(entry.labelAt ? { labelAt: entry.labelAt } : {}),
  });
}

/** Adds an interface an element provides or requires, with its line; none where a connector draws it. */
function addOffer(parsing: Parsing, entry: Offer, a: TamNode, assembled: Set<string>) {
  const { offers, label, line } = entry;
  if (!isActive(a) || a.kind === "human")
    throw new TamError(
      line,
      `Only components, subsystems, classes and agents ${offers.slice(0, -1)} interfaces; \`${a.id}\` is a ${a.kind}.`,
    );
  if (assembled.has(`${a.id} ${offers} ${label}`)) return;
  const id = `${a.id}#${offers}#${++parsing.count}`;
  addNode(parsing, {
    id,
    kind: "interface",
    label: label || "",
    parent: a.parent,
    children: [],
    stack: false,
    line,
  });
  addEdge(parsing, entry, {
    kind: offers === "provides" ? "provided" : "required",
    source: a.id,
    target: id,
  });
}

/** The edge a connection draws, once it is checked against the rules of the notation. */
function connectionFields(
  diagram: TamDiagram,
  entry: Connection & { line: number },
  a: TamNode,
): EdgeFields {
  const { word, both, protocol, line } = entry,
    b = lookup(diagram, entry.to, line);
  if (a === b) throw new TamError(line, `\`${a.id}\` cannot connect to itself.`);
  checkWord(diagram, word, a, b, protocol, line, both);
  checkEnds(diagram, word, a, b, line);
  // checkWord has settled which kinds of elements each word connects.
  return edgeFields(entry, a, b);
}

/** Nested elements share their container's connections; packages connect only through dependencies. */
function checkEnds(diagram: TamDiagram, word: Word, a: TamNode, b: TamNode, line: number) {
  if (sharesConnections(diagram, word, a, b))
    throw new TamError(
      line,
      `\`${a.id}\` contains \`${b.id}\` or the other way round; nested elements share their container's connections.`,
    );
  const pkg = [a, b].find((node) => node.kind === "package");
  if (pkg && word !== "dependency" && word !== "anchor")
    throw new TamError(
      line,
      `Package \`${pkg.id}\` connects only through dependencies such as \`-. import .->\`.`,
    );
}

/** Whether a connection joins a container and its part, other than a delegation between active elements or a note's line. */
function sharesConnections(diagram: TamDiagram, word: Word, a: TamNode, b: TamNode) {
  if (word === "delegates") return !isActive(a) || !isActive(b);
  return word !== "anchor" && (isAncestor(diagram, a.id, b.id) || isAncestor(diagram, b.id, a.id));
}

/** The kind of edge each access word draws. */
const ACCESSES: Partial<Record<Word, EdgeKind>> = {
  reads: "read",
  writes: "write",
  "reads/writes": "modify",
};

/** How a channel word marks its ends: data flow, requests, or neither (`---`). */
const CHANNELS: Partial<Record<Word, (both: boolean) => Pick<TamEdge, "flow" | "request">>> = {
  "sends data": (both) => ({ flow: { toSource: both, toTarget: true } }),
  calls: (both) => ({ request: { toSource: both, toTarget: true } }),
  "---": () => ({ flow: { toSource: false, toTarget: false } }),
};

/** The edge a connection word draws between two elements. */
function edgeFields(entry: Connection & { line: number }, a: TamNode, b: TamNode): EdgeFields {
  const { word, label, protocol, both, line } = entry,
    source = a.id,
    target = b.id,
    access = ACCESSES[word],
    channel = CHANNELS[word];
  if (access) return { kind: access, source, target, label };
  if (channel) return { kind: "channel", source, target, label, protocol, ...channel(both) };
  if (word === "delegates") return { kind: "delegation", source, target, label };
  if (word === "anchor") return { kind: "anchor", source, target };
  if (word === "dependency") return dependencyFields(a, b, label!, line);
  // `a -- requires IName --> b`: a requires the interface b provides.
  for (const node of [a, b])
    if (!isActive(node) || node.kind === "human")
      throw new TamError(
        line,
        `Interfaces connect components, subsystems, classes or agents; \`${node.id}\` is a ${node.kind}.`,
      );
  return { kind: "assembly", source, target, label, protocol };
}

/** A dependency with its keyword: a «pointer» joins storages, a «create» or «generate» active elements. */
function dependencyFields(a: TamNode, b: TamNode, label: string, line: number): EdgeFields {
  const keyword = KEYWORDS[label];
  if (keyword === "pointer" && !(isStorage(a) && isStorage(b)))
    throw new TamError(line, "A «pointer» dependency connects two storages.");
  if ((keyword === "create" || keyword === "generate") && !(isActive(a) && isActive(b)))
    throw new TamError(line, `A «${keyword}» dependency connects active elements, not storages.`);
  return { kind: "dependency", source: a.id, target: b.id, label: `«${keyword}»` };
}

/** On conceptual level there are no design elements, interfaces, assemblies or delegations. */
function checkConceptual(diagram: TamDiagram) {
  for (const node of diagram.nodes.values())
    if (isDesign(node) || node.kind === "interface")
      throw new TamError(
        node.line,
        `${node.kind === "interface" ? "Interfaces" : `${capital(node.kind)}s`} belong to the design level; remove \`level conceptual\` or use agents.`,
      );
  const design = diagram.edges.find(
    (edge) => edge.kind === "assembly" || edge.kind === "delegation",
  );
  if (design)
    throw new TamError(
      design.line,
      "Assembly and delegation connectors belong to the design level.",
    );
}

const capital = (word: string) => `${word[0].toUpperCase()}${word.slice(1)}`;

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
  | "dependency"
  /** `-.-`: a note attached to an element. */
  | "anchor";

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
    labelAt = placed ? labelPlaceOf(placed, line) : undefined;
  const split = splitLinks(statement);
  if (!split) return null;
  const connections: Connection[] = [];
  split.links.forEach((link, index) => {
    const { word, label, protocol } = readLink(link, line),
      both = link[1] === "<--";
    for (const from of split.ends[index])
      for (const to of split.ends[index + 1])
        connections.push({ from, to, word, both, label, protocol });
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

/** The place of a label as LABEL_PLACE matched it, within the limits of a drawable picture. */
function labelPlaceOf(placed: RegExpMatchArray, line: number) {
  const labelAt = { x: Number(placed[1]), y: Number(placed[2]) };
  if (Math.abs(labelAt.x) > MAX_COORDINATE || Math.abs(labelAt.y) > MAX_COORDINATE)
    throw new TamError(line, `\`${placed[0].trim()}\` is too far out for a label's place.`);
  return labelAt;
}

/** A statement split at its links, with the ids at either end of each; undefined for no connection. */
function splitLinks(statement: string) {
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
  if (!links.length || !pieces.every((piece) => ENDS.test(piece.trim()))) return undefined;
  return { links, ends: pieces.map((piece) => piece.split("&").map((end) => end.trim())) };
}

/** What a link says: its word, label and protocol. */
type Reading = { word: Word; label?: string; protocol?: string };

/** Reads one link of a statement: a note's line, a bare channel, a dependency, or a link with a word. */
function readLink(link: RegExpExecArray, line: number): Reading {
  const [, open, text, close, dotted, bare, anchor] = link;
  if (anchor) return { word: "anchor" };
  if (bare) return { word: "---" };
  if (dotted) return { word: "dependency", label: dependencyKeyword(dotted, line) };
  // `word: label @Protocol`, each part optional except the word on arrows.
  const at = text.match(/^(.*?)\s*@\s*([^@\s][^@]*)$/);
  const body = (at ? at[1] : text).trim(),
    protocol = at ? unquote(at[2]) : undefined;
  if (close !== "---") return { ...arrowWord(open, body, line), protocol };
  if (open !== "--")
    throw new TamError(line, "A channel without direction is `a --- b`, or `a -- label --- b`.");
  return { word: "---", label: body || undefined, protocol };
}

/** The keyword of a dependency, which carries nothing else. */
function dependencyKeyword(dotted: string, line: number): string {
  const keyword = dotted.toLowerCase(),
    first = keyword.split(/[:@\s]/)[0];
  if (/[:@]/.test(dotted) && KEYWORDS[first])
    throw new TamError(line, `A dependency carries only its keyword: \`-. ${first} .->\`.`);
  if (!KEYWORDS[keyword])
    throw new TamError(
      line,
      `\`-. ${dotted} .->\` is no dependency; use \`-. create .->\`, \`-. generate .->\`, \`-. pointer .->\`, \`-. use .->\` or \`-. import .->\`.`,
    );
  return keyword;
}

/** The head of an arrow's text, its word, and the label after a colon. */
function headOf(body: string): [string, string | undefined] {
  const colon = body.indexOf(":");
  if (colon < 0) return [body.trim(), undefined];
  return [body.slice(0, colon).trim(), unquote(body.slice(colon + 1)) || undefined];
}

/** The word and label of an arrow: `calls: label`, `requires IName`. */
function arrowWord(open: string, body: string, line: number): Reading {
  const [head, label] = headOf(body);
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
  if (found === "requires")
    return { word: found, label: head.replace(/^requires?\s*/i, "") || undefined };
  return { word: found, label };
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
  // A note takes part in no connection of the notation: a dotted line attaches it to what it remarks on.
  const note = [a, b].find((node) => node.kind === "note");
  if (word === "anchor") checkAnchor(a, b, note, line);
  else if (note)
    throw new TamError(
      line,
      `\`${note.id}\` is a note: it is attached to an element with \`${note.id} -.- ${(note === a ? b : a).id}\`, and connects in no other way.`,
    );
  else if (word in ACCESSES) checkAccess(word, a, b, protocol, line);
  else if (word in STORAGE_VERBS) checkChannel(diagram, word, a, b, line, both);
  else if (word === "delegates" && !isAncestor(diagram, a.id, b.id))
    throw new TamError(
      line,
      `\`${a.id}\` does not contain \`${b.id}\`; \`delegates\` goes from a container to its part.`,
    );
}

/** `-.-` attaches a note to an element: one end a note, the other not. */
function checkAnchor(a: TamNode, b: TamNode, note: TamNode | undefined, line: number) {
  if (!note || (a.kind === "note" && b.kind === "note"))
    throw new TamError(
      line,
      `\`-.-\` attaches a note to an element: \`${note ? a.id : "note"} -.- ${note ? b.id : a.id}\` needs one note and one element.`,
    );
}

/** An access goes from an active element to a storage, and carries no protocol. */
function checkAccess(
  word: Word,
  a: TamNode,
  b: TamNode,
  protocol: string | undefined,
  line: number,
) {
  if (isStorage(a) && isActive(b))
    throw new TamError(
      line,
      `\`${a.id}\` is a storage and does not act; write the access from \`${b.id}\`: \`${b.id} -- ${word} --> ${a.id}\`.`,
    );
  if (!isActive(a) || !isStorage(b))
    throw new TamError(
      line,
      `\`${word}\` goes from an active element to a storage, as in \`api -- ${word} --> db\`; ${isStorage(a) ? `\`${a.id}\` is a storage` : `\`${b.id}\` is ${article(b.kind)}`}. Between active elements use \`-- sends data -->\` or \`-- calls -->\`.`,
    );
  if (protocol)
    throw new TamError(
      line,
      `A protocol belongs on a channel or interface, not on an access: \`-- calls @${protocol} -->\`.`,
    );
}

/** What a channel to a storage would do to it, for the error that says agents don't. */
const STORAGE_VERBS: Partial<Record<Word, string>> = {
  calls: "call it",
  "---": "talk to it",
  "sends data": "send it data",
};

/** A channel joins two agents that do not hold each other; data flows one way on it. */
function checkChannel(
  diagram: TamDiagram,
  word: Word,
  a: TamNode,
  b: TamNode,
  line: number,
  both: boolean,
) {
  const storage = [a, b].find((node) => !isActive(node));
  if (storage)
    throw new TamError(
      line,
      `\`${storage.id}\` is a storage: agents read or write it (\`agent -- reads --> ${storage.id}\`), they don't ${STORAGE_VERBS[word]}.`,
    );
  checkApart(diagram, a, b, line);
  checkTalks(diagram, a, b, line);
  // TAM standard 3.3.6: fewer data flow ends than ends, so data flows one way on a channel.
  if (word === "sends data" && both)
    throw new TamError(
      line,
      `Data flows one way on a channel; for requests both ways write \`${a.id} <-- calls --> ${b.id}\`, for data both ways two channels.`,
    );
}

/** No channel joins a container and its part: a container stands for its parts. */
function checkApart(diagram: TamDiagram, a: TamNode, b: TamNode, line: number) {
  if (!isAncestor(diagram, a.id, b.id) && !isAncestor(diagram, b.id, a.id)) return;
  const [outer, inner] = isAncestor(diagram, a.id, b.id) ? [a, b] : [b, a];
  throw new TamError(
    line,
    // A delegation exists only on design level; elsewhere the hint would turn a modeling slip into one.
    diagram.level === "design"
      ? `\`${outer.id}\` contains \`${inner.id}\`; a container passes on to its part with \`${outer.id} -- delegates --> ${inner.id}\`.`
      : `\`${outer.id}\` contains \`${inner.id}\`, and a container stands for its parts, so the two are never connected; connect \`${inner.id}\` to the element outside \`${outer.id}\` it works with, or leave the connection out.`,
  );
}

/** TAM standard 3.3.6: a channel is defined between agents only. */
function checkTalks(diagram: TamDiagram, a: TamNode, b: TamNode, line: number) {
  const design = [a, b].find((node) => !talks(diagram, node));
  if (!design) return;
  const other = design === a ? b : a;
  throw new TamError(
    line,
    `Channels join agents; \`${design.id}\` is ${article(design.kind)}, which connects through interfaces: \`${a.id} -- requires IName --> ${b.id}\`${other.kind === "human" ? "" : `, or \`${design.id} provides IName\``}.`,
  );
}

/** Whether an element can be the end of a channel: an agent, or a group of such. */
function talks(diagram: TamDiagram, node: TamNode): boolean {
  if (node.kind === "agent" || node.kind === "human") return true;
  // A group of agents, also with the storages they keep (an FMC object: its methods and its data).
  if (node.kind !== "group" || node.passive) return false;
  return node.children
    .map((child) => diagram.nodes.get(child)!)
    .filter((child) => child.kind !== "dots" && child.kind !== "note")
    .every((child) => isStorage(child) || talks(diagram, child));
}

/** Whether an element holds another, at any depth. */
export function isAncestor(diagram: TamDiagram, ancestor: string, id: string): boolean {
  for (let node = diagram.nodes.get(id); node?.parent; node = diagram.nodes.get(node.parent))
    if (node.parent === ancestor) return true;
  return false;
}

/** TAM nesting rules: passive elements hold only storages, humans hold nothing, components hold components, classes and storages. */
function validateNesting(diagram: TamDiagram) {
  for (const node of diagram.nodes.values()) {
    if (!node.children.length) continue;
    // Notes stand anywhere: they remark on a part of the diagram and take part in none of its rules.
    const children = partsOf(diagram, node);
    if (!children.length) continue;
    NESTING[node.kind]?.(node, children);
    checkPackages(node, children);
  }
}

/** Whether a part is a storage or a group of storages, which design elements hold too. */
const passivePart = (child: TamNode) =>
  child.kind === "storage" || (child.kind === "group" && !!child.passive);

/** The first part whose kind is not among `kinds`. */
const outsider = (children: TamNode[], kinds: string[], passive = false) =>
  children.find((child) => !kinds.includes(child.kind) && !(passive && passivePart(child)));

/** The rules of what each kind of element holds. */
const NESTING: Partial<Record<NodeKind, (node: TamNode, children: TamNode[]) => void>> = {
  human: holdsNothing,
  storage: holdsStorages,
  component: holdsDesign,
  class: holdsDesign,
  package: holdsPackaged,
  subsystem: holdsSubsystemParts,
};

function holdsNothing(node: TamNode) {
  throw new TamError(node.line, `Human agent \`${node.id}\` cannot contain elements.`);
}

function holdsStorages(node: TamNode, children: TamNode[]) {
  const active = children.find(isActive);
  if (active)
    throw new TamError(
      active.line,
      `Storage \`${node.id}\` cannot contain the active element \`${active.id}\`; passive elements hold only storages.`,
    );
}

function holdsDesign(node: TamNode, children: TamNode[]) {
  const wrong = outsider(children, ["component", "class", "storage"], true);
  if (wrong)
    throw new TamError(
      wrong.line,
      `${node.kind === "class" ? "Class" : "Component"} \`${node.id}\` can contain components, classes and storages, not the ${wrong.kind} \`${wrong.id}\`.`,
    );
}

function holdsPackaged(node: TamNode, children: TamNode[]) {
  const wrong = outsider(children, ["package", "class", "component", "subsystem"]);
  if (wrong)
    throw new TamError(
      wrong.line,
      `Package \`${node.id}\` can contain packages, classes, components and subsystems, not the ${wrong.kind} \`${wrong.id}\`.`,
    );
}

function holdsSubsystemParts(node: TamNode, children: TamNode[]) {
  const agent = children.find((child) => child.kind === "agent" || child.kind === "human");
  if (agent)
    throw new TamError(
      agent.line,
      `Subsystem \`${node.id}\` cannot contain the agent \`${agent.id}\`; agents may contain subsystems, not the other way round.`,
    );
  const wrong = outsider(children, ["subsystem", "component", "class", "storage"], true);
  if (wrong)
    throw new TamError(
      wrong.line,
      `Subsystem \`${node.id}\` can contain subsystems, components, classes and storages, not the ${wrong.kind} \`${wrong.id}\`.`,
    );
}

/** Packages structure a package diagram: they stand at the top or in packages (and frames around them). */
function checkPackages(node: TamNode, children: TamNode[]) {
  if (node.kind === "package" || node.kind === "group") return;
  const pkg = children.find((child) => child.kind === "package");
  if (pkg)
    throw new TamError(
      pkg.line,
      `${capital(node.kind)} \`${node.id}\` cannot contain the package \`${pkg.id}\`; packages stand on their own or in packages.`,
    );
}
