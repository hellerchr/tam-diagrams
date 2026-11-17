/** TAM layout, first stage: the diagram's sizes and spacing, its channel and connector nodes, and the ELK graph built from them. */

import { type Box, type Point, STACK } from "./scene.ts";
import type { TamDiagram, TamEdge, TamNode } from "./tam.ts";
import { edgeOwner, type ElkLayout, layeredOptions } from "./elk.ts";
import type { ElkExtendedEdge, ElkLabel, ElkNode } from "elkjs/lib/elk-api";
import { breaks, FONT, LINE, type Measure, SMALL, SMALL_LINE, wrap } from "./text.ts";
import { MARKER_LENGTH } from "./markers.ts";
import { smallSize } from "./labels.ts";

export const PAD = 14,
  WRAP = 168,
  SHADOW = STACK,
  CHANNEL = 16,
  ASSEMBLY = 22,
  TAB = 20,
  ICON = 24;

export const BALL = 5;

/** The gap between a channel's circle and the label or request marker beside it. */
export const MARKER_GAP = 5;

/** A request marker's letter or triangle is about this wide; text beside a boundary line starts ASIDE from it. */
export const GLYPH = 9,
  ASIDE = 7;

/** A container title's first line starts this far below the container's top. */
export const TITLE_TOP = 9;

/** ELK's spacing between elements, and between a wire and an element; the geometry passes keep both. */
export const NODE_SPACING = 32,
  EDGE_SPACING = 18;

/**
 * A note's text is small, as UML notes are, and breaks at NOTE_WRAP unless the source sizes the note.
 * The note keeps NOTE_SIDES beside its text (the inset on the left, the folded corner on the right) and
 * NOTE_ENDS above and below it.
 */
const NOTE_WRAP = 200,
  NOTE_SIDES = 26,
  NOTE_ENDS = 14;

/** The lines of a note's text, broken where the author breaks them and where they grow wider than `width`. */
const noteLines = (text: string, width: number, measure: Measure) =>
  breaks(text).flatMap((line) => wrap(line, width, SMALL, 400, measure));

/** Wire ends on an element's side sit this far apart; a leaf grows along the side so they fit. */
const WIRE_SPACING = 18;

/**
 * A modifying access is a loop of two wires, data in and data back: their ends sit 2 x LOOP_END apart,
 * and drawn straight they bulge up to BULGE further at the middle. ELK lays the access out as one edge
 * that thick, so it keeps that room from elements; the bulge fits the room left beside other wires.
 */
export const LOOP_END = 6,
  BULGE = 7,
  LOOP_WIDTH = 2 * (LOOP_END + BULGE);

/** An element as the layout knows it: its node, its name broken into lines, and how deep it is nested. */
export interface Shape {
  node: TamNode;
  lines: string[];
  textWidth: number;
  container: boolean;
  depth: number;
}

/**
 * Layout variants. `flow` orients read accesses from the storage to the agent so data flows through
 * the layers (pipelines become straight); by default every access points from the agent to its
 * storage, which keeps storages below the agents that use them as TAM diagrams usually show.
 */
export interface LayoutOptions {
  elk?: Record<string, string>;
  flow?: boolean;
  layout?: ElkLayout;
  /** Spacing multiplier for crowded diagrams. */ room?: number;
  /** ELK results by graph, shared across strategies: strategies that build the same graph run ELK once. */ memo?: Map<
    string,
    Promise<ElkNode>
  >;
}

/** A TAM diagram prepared for ELK: the diagram with its channel and connector nodes, and the ELK graph built from it. */
export interface TamGraph {
  chain: (id: string) => string[];
  channelLabels: (edge: TamEdge, upright?: boolean) => ElkLabel[];
  diagram: TamDiagram;
  ends: Map<string, [string, string]>;
  graph: ElkNode;
  markerSize: (count: number, upright?: boolean) => { width: number; height: number };
  reversed: Set<string>;
  scale: number;
  shapes: Map<string, Shape>;
  vertical: boolean;
}

/** Where everything lies once ELK ran and the geometry passes straightened the wires. */
export interface TamGeometry {
  boxes: Map<string, Box>;
  edgeLabels: Map<string, Box>;
  leaves: Set<string>;
  markers: Set<string>;
  nodeLabels: Map<string, Box[]>;
  round: Map<string, number>;
  routes: Map<string, Point[]>;
  /**
   * Layouts placed by hand: whether the wire at a channel or connector runs up or down, by the
   * mark's id. ELK runs every such wire along the diagram's direction, which says it for all.
   */
  upright?: Map<string, boolean>;
  /** Layouts placed by hand: where each row of three dots stands, and whether it runs across. */
  dots?: Map<string, { center: Point; across: boolean }>;
}

/** A TAM graph as it is built: the diagram, what is known of its elements, and the ELK graph so far. */
interface Building {
  diagram: TamDiagram;
  measure: Measure;
  options: LayoutOptions;
  vertical: boolean;
  scale: number;
  spacing: Record<string, string>;
  shapes: Map<string, Shape>;
  /** The room the connections of each element need where they arrive. */
  degree: Map<string, number>;
  /** The people who go first: top-level humans no other human reaches. */
  leaders: Set<string>;
  graph: ElkNode;
  elkNodes: Map<string, ElkNode>;
  chain: (id: string) => string[];
  owner: (a: string, b: string) => ElkNode;
  /** The ports on a container's border that a delegation and the connection it continues share, by wire and container. */
  borders: Map<string, string>;
  ends: Map<string, [string, string]>;
  reversed: Set<string>;
  /** The element each pair of elements' connections run from. */
  oriented: Map<string, string>;
}

/** Prepares a copy of the diagram (with channel and connector nodes) and builds its ELK graph. */
export function tamGraph(source: TamDiagram, measure: Measure, options: LayoutOptions): TamGraph {
  // Channel and connector nodes are added to a copy so one parsed diagram can be laid out repeatedly.
  const diagram: TamDiagram = { ...source, nodes: new Map(source.nodes) };
  const vertical = diagram.direction === "TB" || diagram.direction === "BT";
  const scale = options.room ?? 1;
  // ELK expects every edge in the lowest common container of its ends.
  const chain = (id: string) => chainOf(diagram, id);
  const building: Building = {
    diagram,
    measure,
    options,
    vertical,
    scale,
    spacing: spacingOf(scale),
    shapes: new Map(),
    degree: degreesOf(diagram),
    leaders: leadersOf(diagram),
    graph: { id: "root" },
    elkNodes: new Map(),
    chain,
    owner: () => building.graph,
    borders: new Map(),
    ends: new Map(),
    reversed: new Set(),
    oriented: new Map(),
  };
  building.graph = {
    id: "root",
    children: diagram.roots.map((id) => buildNode(building, id, 0)),
    edges: [],
    layoutOptions: layeredOptions(diagram.direction, building.spacing, options.elk),
  };
  building.owner = edgeOwner(building.graph, chain, building.elkNodes);
  joinDelegations(building);
  for (const edge of diagram.edges) addEdge(building, edge);
  return {
    chain,
    channelLabels: (edge, upright = vertical) => channelLabels(building, edge, upright),
    diagram,
    ends: building.ends,
    graph: building.graph,
    markerSize: (count, upright = vertical) => markerSize(count, upright),
    reversed: building.reversed,
    scale,
    shapes: building.shapes,
    vertical,
  };
}

/** ELK's spacing, grown for crowded diagrams. */
function spacingOf(scale: number): Record<string, string> {
  const px = (value: number) => String(Math.round(value * scale));
  return {
    "elk.spacing.nodeNode": px(NODE_SPACING),
    "elk.layered.spacing.nodeNodeBetweenLayers": px(NODE_SPACING),
    // Wire ends on one side of an element sit far enough apart for their arrowheads.
    "elk.spacing.edgeNode": px(EDGE_SPACING),
    "elk.spacing.edgeEdge": px(14),
    "elk.spacing.portPort": px(16),
    "elk.layered.spacing.edgeNodeBetweenLayers": px(18),
    "elk.layered.spacing.edgeEdgeBetweenLayers": px(12),
    "elk.spacing.labelNode": "6",
    "elk.spacing.edgeLabel": px(6),
  };
}

/** An element's id and then its ancestors', innermost first. */
function chainOf(diagram: TamDiagram, id: string): string[] {
  const ids: string[] = [];
  for (
    let node = diagram.nodes.get(id);
    node;
    node = node.parent ? diagram.nodes.get(node.parent) : undefined
  )
    ids.push(node.id);
  return ids;
}

/**
 * Space beside a channel or interface: request marker and label sit in one box next to the circle
 * on vertical layouts. Requests one way: "R" and a triangle along the line; both ways: "R" alone.
 */
const markerSize = (count: number, upright: boolean) =>
  upright
    ? { width: 9, height: count === 1 ? 22 : 16 }
    : { width: count === 1 ? 19 : 9, height: 13 };

/** Whether dots stand between two siblings, which are no dots and no notes. */
function between(diagram: TamDiagram, id: string) {
  const node = diagram.nodes.get(id)!,
    siblings = node.parent ? diagram.nodes.get(node.parent)!.children : diagram.roots,
    index = siblings.indexOf(id);
  const real = (other: string) => !["dots", "note"].includes(diagram.nodes.get(other)!.kind);
  return siblings.slice(0, index).some(real) && siblings.slice(index + 1).some(real);
}

/**
 * Connections per element: a leaf grows along the side where they arrive, so their ends (and
 * arrowheads) keep apart. Each needs the wire spacing where it arrives, plus a loop's drawn width.
 */
function degreesOf(diagram: TamDiagram): Map<string, number> {
  const degree = new Map<string, number>();
  for (const edge of diagram.edges)
    for (const end of edge.aside ? [] : [edge.source, edge.target])
      degree.set(
        end,
        (degree.get(end) ?? 0) + WIRE_SPACING + (edge.kind === "modify" ? LOOP_WIDTH : 0),
      );
  return degree;
}

/** Whether an element stands at the top level, or in rows there. */
function topLevel(diagram: TamDiagram, id: string) {
  for (
    let parent = diagram.nodes.get(id)!.parent;
    parent;
    parent = diagram.nodes.get(parent)!.parent
  )
    if (!parent.endsWith("#row")) return false;
  return true;
}

/**
 * The people who use the system come first in the layout direction, in one row, as TAM figures show
 * them: top-level human agents (also in rows of multiples) go into ELK's first layer, and every
 * connection at them is laid out pointing away from them. A person reached from another person follows.
 */
function leadersOf(diagram: TamDiagram): Set<string> {
  const humans = new Set(
    [...diagram.nodes.values()]
      .filter((node) => node.kind === "human" && topLevel(diagram, node.id))
      .map((node) => node.id),
  );
  return new Set(
    [...humans].filter(
      (id) => !diagram.edges.some((edge) => edge.target === id && humans.has(edge.source)),
    ),
  );
}

/** Whether an element goes first: a leading person, or a top-level row of them. */
function leads(building: Building, id: string): boolean {
  if (building.leaders.has(id)) return true;
  const { diagram } = building;
  if (!id.endsWith("#row") || !topLevel(diagram, id)) return false;
  const { children } = diagram.nodes.get(id)!;
  return (
    children.some((child) => leads(building, child)) &&
    children.every((child) => leads(building, child) || diagram.nodes.get(child)!.kind === "dots")
  );
}

const first = (building: Building, id: string): Record<string, string> =>
  leads(building, id) ? { "elk.layered.layering.layerConstraint": "FIRST" } : {};

/** The ELK node of an element, with its parts; notes what the layout knows of it in `shapes`. */
function buildNode(building: Building, id: string, depth: number): ElkNode {
  const { diagram, measure } = building,
    node = diagram.nodes.get(id)!;
  // Dots between two siblings are drawn in the gap between them; dots at the start or end of a row need room of their own.
  const children = node.children.filter(
    (child) => diagram.nodes.get(child)!.kind !== "dots" || !between(diagram, child),
  );
  const container = children.length > 0,
    note = node.kind === "note",
    weight = container ? 600 : 400;
  const lines = nameLines(node, container, measure);
  const textWidth = Math.max(
    0,
    ...lines.map((line) => measure(line, note ? SMALL : FONT, note ? 400 : weight)),
  );
  building.shapes.set(id, { node, lines, textWidth, container, depth });
  if (container) return containerNode(building, node, children, depth);
  return leafNode(building, node);
}

/** An element's name broken into lines: a note's at its width, any other's as wide as its size or the wrap allows. */
function nameLines(node: TamNode, container: boolean, measure: Measure): string[] {
  const given = givenWidth(node);
  if (node.kind === "note")
    return noteLines(node.label, Math.max(NOTE_WRAP, given - NOTE_SIDES), measure);
  if (!node.label || node.kind === "interface") return [];
  // A name runs as wide as the size the source gives its element.
  return wrap(
    node.label,
    Math.max(container ? 320 : WRAP, given - 2 * PAD),
    FONT,
    container ? 600 : 400,
    measure,
  );
}

/** The width the source gives an element; 0 without one. */
const givenWidth = (node: TamNode) => node.at?.width ?? 0;

/** The ELK node of a container, with its parts. */
function containerNode(building: Building, node: TamNode, children: string[], depth: number) {
  const { id } = node,
    shape = building.shapes.get(id)!,
    extra = node.stack ? SHADOW : 0,
    row = id.endsWith("#row");
  const { top, side, minimum } = containerInsets(
    node,
    shape.lines,
    shape.textWidth,
    building.measure,
  );
  return {
    id,
    children: children.map((child) => buildNode(building, child, row ? depth : depth + 1)),
    layoutOptions: {
      ...building.spacing,
      ...first(building, id),
      "elk.alignment": "CENTER",
      "elk.padding": `[top=${top},left=${side},bottom=${side + extra},right=${side + extra}]`,
      ...minimumSize(building.vertical, top, minimum),
    },
  };
}

/** ELK applies compound minimum sizes before transposing vertical layouts, so they are swapped here. */
function minimumSize(vertical: boolean, top: number, minimum: number): Record<string, string> {
  if (!minimum) return {};
  return {
    "elk.nodeSize.constraints": "MINIMUM_SIZE",
    "elk.nodeSize.minimum": vertical ? `(${top + 24},${minimum})` : `(${minimum},${top + 24})`,
  };
}

/** The ELK node of a leaf: dots, an interface's circle, or an element as large as its name. */
function leafNode(building: Building, node: TamNode): ElkNode {
  const { id } = node;
  if (node.kind === "dots") return { id, width: 22, height: 12 };
  if (node.kind === "interface")
    return {
      id,
      width: CHANNEL,
      height: CHANNEL,
      labels: node.label ? [sideLabel(building, node.label, 0, false, building.vertical)] : [],
      layoutOptions: { "elk.spacing.labelNode": String(MARKER_GAP) },
    };
  const shape = building.shapes.get(id)!,
    { width, height } = leafSize(node, shape.lines, shape.textWidth, building.measure);
  return sizedLeaf(building, node, width, height);
}

/**
 * A leaf at least as large as its name, and as long as its connections need where they arrive:
 * elements of different sizes in one layer share a center line. ELK grows an element whose sized
 * ports (thick connections) do not fit on a side; this size is the least.
 */
function sizedLeaf(building: Building, node: TamNode, width: number, height: number): ElkNode {
  const { id } = node,
    { vertical, scale } = building,
    extra = node.stack ? SHADOW : 0,
    room = (((building.degree.get(id) ?? 0) + WIRE_SPACING) * scale) / 2 + 8;
  const w = Math.ceil((vertical ? Math.max(width, room) : width) + extra),
    h = Math.ceil((vertical ? height : Math.max(height, room)) + extra);
  return {
    id,
    width: w,
    height: h,
    layoutOptions: {
      "elk.alignment": "CENTER",
      "elk.nodeSize.constraints": "PORTS MINIMUM_SIZE",
      "elk.nodeSize.minimum": `(${w},${h})`,
      ...first(building, id),
    },
  };
}

/** The label beside a channel's or an interface's circle, with room for `marker` request markers. */
function sideLabel(
  { measure }: Building,
  text: string,
  marker: number,
  split: boolean,
  upright: boolean,
): ElkLabel {
  // On a protocol boundary the label sits above the line and the marker below it, so ELK keeps room for both.
  if (split) return splitLabel(measure, text, marker, upright);
  if (upright) return uprightLabel(measure, text, marker);
  return {
    text,
    width: smallSize(text, measure).width,
    height: Math.max(LINE - 2, smallSize(text, measure).height),
    layoutOptions: { "elk.nodeLabels.placement": "OUTSIDE V_TOP H_CENTER" },
  };
}

/** The label of a channel on a protocol boundary: room for the label on one side of the line and the marker on the other. */
function splitLabel(measure: Measure, text: string, marker: number, upright: boolean): ElkLabel {
  const size = markerSize(marker, upright),
    labelHeight = text ? smallSize(text, measure).height : 0,
    labelWidth = text ? smallSize(text, measure).width : 0;
  return upright
    ? {
        text: text || "R",
        width: Math.max(labelWidth, size.width) + 2,
        height: 2 * (Math.max(labelHeight, size.height) + ASIDE),
        layoutOptions: { "elk.nodeLabels.placement": "OUTSIDE H_RIGHT V_CENTER" },
      }
    : {
        text: text || "R",
        width: 2 * Math.max(labelWidth, marker ? 20 : 0) + 14,
        height: Math.max(LINE - 2, labelHeight),
        layoutOptions: { "elk.nodeLabels.placement": "OUTSIDE V_TOP H_CENTER" },
      };
}

/** The label right of a circle on a wire that runs up or down: the marker, then the text. */
function uprightLabel(measure: Measure, text: string, marker: number): ElkLabel {
  const size = markerSize(marker, true),
    textSize = text ? smallSize(text, measure) : { width: 0, height: 0 };
  // ELK skips labels without text, so a marker-only label carries the marker's letter.
  return {
    text: text || "R",
    width: (marker ? size.width + (text ? 8 : 0) : 0) + textSize.width,
    height: Math.max(textSize.height, LINE - 2, marker ? size.height : 0),
    layoutOptions: { "elk.nodeLabels.placement": "OUTSIDE H_RIGHT V_CENTER" },
  };
}

/** A marker below a circle. */
const below = (size: { width: number; height: number }): ElkLabel => ({
  text: "R",
  ...size,
  layoutOptions: { "elk.nodeLabels.placement": "OUTSIDE V_BOTTOM H_CENTER" },
});

/**
 * The room a channel or connector keeps beside its circle for its label and request marker, as
 * ELK labels: right of the circle on a wire that runs up or down (`upright`), above and below it else.
 */
function channelLabels(building: Building, edge: TamEdge, upright: boolean): ElkLabel[] {
  const marker = requestMarkers(edge),
    label = edge.label ?? "";
  if (edge.protocol && (edge.label || marker))
    return protocolLabels(building, label, marker, upright);
  if (upright) return label || marker ? [sideLabel(building, label, marker, false, true)] : [];
  return acrossLabels(building, label, marker);
}

/** The labels of a channel on a wire across: the label above the circle, the marker below it. */
const acrossLabels = (building: Building, label: string, marker: number) => [
  ...(label ? [sideLabel(building, label, 0, false, false)] : []),
  ...(marker ? [below(markerSize(marker, false))] : []),
];

/** How many request markers a channel carries: one for each way requests go. */
const requestMarkers = (edge: TamEdge) =>
  edge.request ? +edge.request.toSource + +edge.request.toTarget : 0;

/** The labels of a channel on a protocol boundary: across the line, the marker below it apart. */
const protocolLabels = (building: Building, label: string, marker: number, upright: boolean) => [
  sideLabel(building, label, marker, true, upright),
  ...(!upright && marker ? [below({ width: 54, height: 13 })] : []),
];

/** The innermost container that holds both elements, besides themselves. */
function common({ chain }: Building, a: string, b: string): string | null {
  const right = new Set(chain(b).slice(1));
  return (
    chain(a)
      .slice(1)
      .find((id) => right.has(id)) ?? null
  );
}

/** How an ELK edge is laid out: straight, the other way round (its route is reversed back), as thick as a loop. */
interface EdgeStyle {
  labels?: ElkLabel[];
  straight?: boolean;
  flip?: boolean;
  thickness?: number;
}

/** Adds an ELK edge for a wire drawn from `from` to `to`. */
function connect(building: Building, id: string, from: string, to: string, style: EdgeStyle = {}) {
  const { labels = [], straight = false, thickness = 0 } = style,
    flip = flipOf(building, from, to, style.flip ?? false);
  building.ends.set(id, [from, to]);
  if (flip) building.reversed.add(id);
  const [source, target] = flip ? [to, from] : [from, to];
  const layoutOptions = {
    ...(straight ? { "elk.layered.priority.straightness": "10" } : {}),
    ...(thickness ? { "elk.edge.thickness": String(thickness) } : {}),
  };
  (building.owner(source, target).edges ??= []).push({
    id,
    sources: [endOf(building, id, source, "out", thickness)],
    targets: [endOf(building, id, target, "in", thickness)],
    labels,
    ...(Object.keys(layoutOptions).length ? { layoutOptions } : {}),
  } as ElkExtendedEdge);
}

/** Whether an ELK edge is laid out the other way: connections at a person who goes first point away from them. */
function flipOf(building: Building, from: string, to: string, flip: boolean): boolean {
  return leads(building, flip ? from : to) && !leads(building, flip ? to : from) ? !flip : flip;
}

/** Where a wire attaches: a thick connection through a port as wide as it is, so ELK keeps other wire ends that far apart. */
function endOf(building: Building, id: string, node: string, side: string, thickness: number) {
  const border = building.borders.get(`${id}@${node}`);
  if (border) return border;
  if (!thickness) return node;
  const port = {
    id: `${id}:${side}`,
    width: building.vertical ? thickness : 0,
    height: building.vertical ? 0 : thickness,
  };
  (building.elkNodes.get(node)!.ports ??= []).push(port);
  return port.id;
}

/**
 * A delegation continues the connection that arrives at its container: when there is one of each,
 * both attach to one port on the container's border, so ELK lays them out as one line, as UML draws them.
 */
function joinDelegations(building: Building) {
  const { diagram } = building;
  for (const container of new Set(
    diagram.edges.filter((edge) => edge.kind === "delegation").map((edge) => edge.source),
  ))
    joinDelegation(building, container);
}

function joinDelegation(building: Building, container: string) {
  const { diagram, chain, borders } = building;
  const delegations = diagram.edges.filter(
    (edge) => edge.kind === "delegation" && edge.source === container,
  );
  const arriving = diagram.edges.filter((edge) => arrives(chain, edge, container));
  if (delegations.length !== 1 || arriving.length !== 1) return;
  const [delegation] = delegations,
    [connection] = arriving,
    port = `${container}#border`;
  (building.elkNodes.get(container)!.ports ??= []).push({ id: port, width: 0, height: 0 });
  borders.set(`${delegation.id}@${container}`, port);
  borders.set(`${wireAt(connection, container)}@${container}`, port);
}

/** Whether a connection other than a delegation arrives at a container from outside it. */
function arrives(chain: (id: string) => string[], edge: TamEdge, container: string) {
  if (edge.kind === "delegation") return false;
  if (edge.source !== container && edge.target !== container) return false;
  return !chain(edge.source === container ? edge.target : edge.source).includes(container);
}

/** The ELK edge of a connection at an element: a channel's or connector's half on that side. */
const wireAt = (connection: TamEdge, id: string) =>
  connection.kind === "channel" || connection.kind === "assembly"
    ? `${connection.id}:${connection.source === id ? "a" : "b"}`
    : connection.id;

/** Adds the ELK edges of a connection; a pointer beside its storage is drawn after layout. */
function addEdge(building: Building, edge: TamEdge) {
  if (edge.aside) return;
  if (edge.kind === "channel" || edge.kind === "assembly") addChannel(building, edge);
  else if (edge.kind === "anchor") {
    // ELK lays a note out a layer beyond the element it remarks on, so the note stands next to it.
    const note = building.diagram.nodes.get(edge.source)!.kind === "note";
    connect(building, edge.id, edge.source, edge.target, { straight: true, flip: note });
  } else {
    const { measure } = building;
    const labels = edge.label
      ? [
          {
            text: edge.label,
            width: smallSize(edge.label, measure).width + 4,
            height: Math.max(LINE - 2, smallSize(edge.label, measure).height),
          },
        ]
      : [];
    connect(building, edge.id, edge.source, edge.target, {
      labels,
      straight: edge.kind !== "dependency",
      flip: !!building.options.flow && edge.kind === "read",
      thickness: edge.kind === "modify" ? LOOP_WIDTH : 0,
    });
  }
}

/**
 * Channels and ball-and-socket connectors are small nodes on the connection, so ELK keeps room for
 * their markers and labels.
 */
function addChannel(building: Building, edge: TamEdge) {
  const { diagram } = building,
    id = `${edge.id}#node`,
    parent = common(building, edge.source, edge.target);
  const size = edge.kind === "assembly" ? ASSEMBLY : CHANNEL;
  const node: ElkNode = {
    id,
    width: size,
    height: size,
    labels: channelLabels(building, edge, building.vertical),
    layoutOptions: { "elk.spacing.labelNode": String(MARKER_GAP) },
  };
  (parent ? building.elkNodes.get(parent)! : building.graph).children!.push(node);
  building.elkNodes.set(id, node);
  diagram.nodes.set(id, {
    id,
    kind: edge.kind === "assembly" ? "interface" : "channel",
    label: "",
    parent,
    children: [],
    stack: false,
    line: edge.line,
  });
  const flipped = startOf(building, edge) !== edge.source;
  connect(building, `${edge.id}:a`, edge.source, id, { straight: true, flip: flipped });
  connect(building, `${edge.id}:b`, id, edge.target, { straight: true, flip: flipped });
}

/**
 * The element a channel runs from. All connections between two elements are laid out the way the
 * first one runs, so an inbound and an outbound channel sit side by side instead of one looping
 * back around. A person who goes first starts the pair's direction.
 */
function startOf(building: Building, edge: TamEdge): string {
  const pair = [edge.source, edge.target].toSorted().join("\u0000");
  const start = leadOf(building, edge) ?? building.oriented.get(pair) ?? edge.source;
  building.oriented.set(pair, start);
  return start;
}

/** The end of a connection that goes first where only one of them does. */
function leadOf(building: Building, edge: TamEdge): string | undefined {
  const source = leads(building, edge.source),
    target = leads(building, edge.target);
  if (target && !source) return edge.target;
  if (source && !target) return edge.source;
  return undefined;
}

/** The room above a container's parts: its tab, or its title with room below for an arrowhead that enters a part from above, clear of the title's glyphs. */
function titleRoom(node: TamNode, lines: string[]): number {
  if (node.kind === "package") return TAB + 14;
  if (!lines.length) return 12;
  const subsystem = node.kind === "subsystem" ? 16 : 0;
  const titleBottom = TITLE_TOP + subsystem + (lines.length - 0.5) * LINE + 0.62 * FONT;
  return Math.ceil(titleBottom + MARKER_LENGTH.arrow + 4);
}

/** A leaf element's size around its name: what it takes before its connections ask for more. */
export function leafSize(
  node: TamNode,
  lines: string[],
  textWidth: number,
  measure: Measure,
): { width: number; height: number } {
  const text = lines.length * LINE;
  switch (node.kind) {
    // A note is as large as its small text, as UML notes are.
    case "note":
      return {
        width: Math.max(40, Math.ceil(textWidth) + NOTE_SIDES),
        height: Math.max(1, lines.length) * SMALL_LINE + NOTE_ENDS,
      };
    case "human":
      return humanSize(lines, textWidth);
    case "storage":
      return storageSize(lines, textWidth);
    case "component":
      return {
        width: Math.max(104, textWidth + 2 * PAD + ICON),
        height: Math.max(42, text + 22),
      };
    case "subsystem":
      return {
        width: Math.max(
          112,
          textWidth + 2 * PAD + ICON,
          measure("«subsystem»", SMALL, 400) + 2 * PAD + ICON,
        ),
        height: text + 40,
      };
    case "package":
      return {
        width: Math.max(96, textWidth + 2 * PAD),
        height: Math.max(40, text + 20) + TAB - 4,
      };
    default:
      return { width: Math.max(96, textWidth + 2 * PAD), height: Math.max(40, text + 20) };
  }
}

/** A human agent: a figure above its name, or the figure alone. */
function humanSize(lines: string[], textWidth: number) {
  return lines.length
    ? { width: Math.max(76, textWidth + 2 * PAD), height: 38 + lines.length * LINE + 10 }
    : { width: 48, height: 46 };
}

/** Storages are pills: the round ends take half the height on each side. */
function storageSize(lines: string[], textWidth: number) {
  const height = Math.max(36, lines.length * LINE + 18);
  return lines.length
    ? { width: Math.max(96, textWidth + height + 8), height }
    : { width: 36, height: 36 };
}

/**
 * What a container keeps free around its parts: `top` for its title, `side` on the other three
 * sides, and the least width its title needs. A row of copies is no shape and keeps nothing.
 */
export function containerInsets(
  node: TamNode,
  lines: string[],
  textWidth: number,
  measure: Measure,
): { top: number; side: number; minimum: number } {
  if (node.id.endsWith("#row")) return { top: 0, side: 0, minimum: 0 };
  const icon = node.kind === "component" || node.kind === "subsystem" ? 24 : 0;
  return {
    top: titleRoom(node, lines),
    side: node.kind === "group" ? 12 : PAD,
    minimum:
      Math.ceil(
        node.kind === "package" ? measure(node.label, SMALL, 600) + 24 : textWidth + 2 * PAD + icon,
      ) + (node.stack ? SHADOW : 0),
  };
}
