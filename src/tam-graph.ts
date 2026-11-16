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
export const NOTE_WRAP = 200,
  NOTE_SIDES = 26,
  NOTE_ENDS = 14;

/** The lines of a note's text, broken where the author breaks them and where they grow wider than `width`. */
export const noteLines = (text: string, width: number, measure: Measure) =>
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

interface Shape {
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

/** Prepares a copy of the diagram (with channel and connector nodes) and builds its ELK graph. */
export function tamGraph(source: TamDiagram, measure: Measure, options: LayoutOptions): TamGraph {
  // Channel and connector nodes are added to a copy so one parsed diagram can be laid out repeatedly.
  const diagram: TamDiagram = { ...source, nodes: new Map(source.nodes) };
  const vertical = diagram.direction === "TB" || diagram.direction === "BT";
  const shapes = new Map<string, Shape>();
  const scale = options.room ?? 1,
    px = (value: number) => String(Math.round(value * scale));
  const spacing = {
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
  /** Space beside a channel or interface: request marker and label sit in one box next to the circle on vertical layouts. */
  // Requests one way: "R" and a triangle along the line; both ways: "R" alone.
  const markerSize = (count: number, upright = vertical) =>
    upright
      ? { width: 9, height: count === 1 ? 22 : 16 }
      : { width: count === 1 ? 19 : 9, height: 13 };

  const between = (id: string) => {
    const node = diagram.nodes.get(id)!,
      siblings = node.parent ? diagram.nodes.get(node.parent)!.children : diagram.roots,
      index = siblings.indexOf(id);
    const real = (other: string) => !["dots", "note"].includes(diagram.nodes.get(other)!.kind);
    return siblings.slice(0, index).some(real) && siblings.slice(index + 1).some(real);
  };
  // Connections per element: a leaf grows along the side where they arrive, so their ends (and arrowheads) keep apart.
  const degree = new Map<string, number>();
  // Room each connection needs where it arrives: the wire spacing, plus a loop's drawn width.
  for (const edge of diagram.edges)
    for (const end of edge.aside ? [] : [edge.source, edge.target])
      degree.set(
        end,
        (degree.get(end) ?? 0) + WIRE_SPACING + (edge.kind === "modify" ? LOOP_WIDTH : 0),
      );
  // The people who use the system come first in the layout direction, in one row, as TAM figures show
  // them: top-level human agents (also in rows of multiples) go into ELK's first layer, and every
  // connection at them is laid out pointing away from them. A person reached from another person follows.
  const topLevel = (id: string) => {
    for (
      let parent = diagram.nodes.get(id)!.parent;
      parent;
      parent = diagram.nodes.get(parent)!.parent
    )
      if (!parent.endsWith("#row")) return false;
    return true;
  };
  const humans = new Set(
    [...diagram.nodes.values()]
      .filter((node) => node.kind === "human" && topLevel(node.id))
      .map((node) => node.id),
  );
  const leaders = new Set(
    [...humans].filter(
      (id) => !diagram.edges.some((edge) => edge.target === id && humans.has(edge.source)),
    ),
  );
  const leads = (id: string): boolean =>
    leaders.has(id) ||
    (id.endsWith("#row") &&
      topLevel(id) &&
      diagram.nodes.get(id)!.children.some(leads) &&
      diagram.nodes
        .get(id)!
        .children.every((child) => leads(child) || diagram.nodes.get(child)!.kind === "dots"));
  const first = (id: string): Record<string, string> =>
    leads(id) ? { "elk.layered.layering.layerConstraint": "FIRST" } : {};
  const build = (id: string, depth: number): ElkNode => {
    const node = diagram.nodes.get(id)!;
    // Dots between two siblings are drawn in the gap between them; dots at the start or end of a row need room of their own.
    const children = node.children.filter(
      (child) => diagram.nodes.get(child)!.kind !== "dots" || !between(child),
    );
    const container = children.length > 0;
    const row = id.endsWith("#row");
    const weight = container ? 600 : 400;
    const note = node.kind === "note";
    const lines = note
      ? noteLines(node.label, Math.max(NOTE_WRAP, (node.at?.width ?? 0) - NOTE_SIDES), measure)
      : node.label && node.kind !== "interface"
        ? // A name runs as wide as the size the source gives its element.
          wrap(
            node.label,
            Math.max(container ? 320 : WRAP, (node.at?.width ?? 0) - 2 * PAD),
            FONT,
            weight,
            measure,
          )
        : [];
    const textWidth = Math.max(
      0,
      ...lines.map((line) => measure(line, note ? SMALL : FONT, note ? 400 : weight)),
    );
    shapes.set(id, { node, lines, textWidth, container, depth });
    const extra = node.stack ? SHADOW : 0;
    if (container) {
      const { top, side, minimum } = containerInsets(node, lines, textWidth, measure);
      return {
        id,
        children: children.map((child) => build(child, row ? depth : depth + 1)),
        layoutOptions: {
          ...spacing,
          ...first(id),
          "elk.alignment": "CENTER",
          "elk.padding": `[top=${top},left=${side},bottom=${side + extra},right=${side + extra}]`,
          // ELK applies compound minimum sizes before transposing vertical layouts, so swap them here.
          ...(minimum
            ? {
                "elk.nodeSize.constraints": "MINIMUM_SIZE",
                "elk.nodeSize.minimum": vertical
                  ? `(${top + 24},${minimum})`
                  : `(${minimum},${top + 24})`,
              }
            : {}),
        },
      };
    }
    // Elements of different sizes in one layer share a center line.
    const room = (((degree.get(id) ?? 0) + WIRE_SPACING) * scale) / 2 + 8;
    // ELK grows an element whose sized ports (thick connections) do not fit on a side; this size is the least.
    const size = (width: number, height: number): ElkNode => {
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
          ...first(id),
        },
      };
    };
    if (node.kind === "dots") return { id, width: 22, height: 12 };
    if (node.kind === "interface")
      return {
        id,
        width: CHANNEL,
        height: CHANNEL,
        labels: node.label ? [sideLabel(node.label)] : [],
        layoutOptions: { "elk.spacing.labelNode": String(MARKER_GAP) },
      };
    const { width, height } = leafSize(node, lines, textWidth, measure);
    return size(width, height);
  };
  const sideLabel = (text: string, marker = 0, split = false, upright = vertical): ElkLabel => {
    const size = markerSize(marker, upright);
    // On a protocol boundary the label sits above the line and the marker below it, so ELK keeps room for both.
    if (split) {
      const labelHeight = text ? smallSize(text, measure).height : 0,
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
    if (upright) {
      const width =
        (marker ? size.width + (text ? 8 : 0) : 0) + (text ? smallSize(text, measure).width : 0);
      // ELK skips labels without text, so a marker-only label carries the marker's letter.
      return {
        text: text || "R",
        width,
        height: Math.max(
          text ? smallSize(text, measure).height : 0,
          LINE - 2,
          marker ? size.height : 0,
        ),
        layoutOptions: { "elk.nodeLabels.placement": "OUTSIDE H_RIGHT V_CENTER" },
      };
    }
    return {
      text,
      width: smallSize(text, measure).width,
      height: Math.max(LINE - 2, smallSize(text, measure).height),
      layoutOptions: { "elk.nodeLabels.placement": "OUTSIDE V_TOP H_CENTER" },
    };
  };
  /**
   * The room a channel or connector keeps beside its circle for its label and request marker, as
   * ELK labels: right of the circle on a wire that runs up or down (`upright`), above and below it else.
   */
  const channelLabels = (edge: TamEdge, upright = vertical): ElkLabel[] => {
    const marker = edge.request ? +edge.request.toSource + +edge.request.toTarget : 0;
    const below = (size: { width: number; height: number }): ElkLabel => ({
      text: "R",
      ...size,
      layoutOptions: { "elk.nodeLabels.placement": "OUTSIDE V_BOTTOM H_CENTER" },
    });
    if (edge.protocol && (edge.label || marker))
      return [
        sideLabel(edge.label ?? "", marker, true, upright),
        ...(!upright && marker ? [below({ width: 54, height: 13 })] : []),
      ];
    if (upright)
      return edge.label || marker ? [sideLabel(edge.label ?? "", marker, false, true)] : [];
    return [
      ...(edge.label ? [sideLabel(edge.label, 0, false, false)] : []),
      ...(marker ? [below(markerSize(marker, false))] : []),
    ];
  };

  const graph: ElkNode = {
    id: "root",
    children: diagram.roots.map((id) => build(id, 0)),
    edges: [],
    layoutOptions: layeredOptions(diagram.direction, spacing, options.elk),
  };

  // ELK expects every edge in the lowest common container of its ends.
  const chain = (id: string) => {
    const ids: string[] = [];
    for (
      let node = diagram.nodes.get(id);
      node;
      node = node.parent ? diagram.nodes.get(node.parent) : undefined
    )
      ids.push(node.id);
    return ids;
  };
  const elkNodes = new Map<string, ElkNode>();
  const owner = edgeOwner(graph, chain, elkNodes);
  const common = (a: string, b: string) => {
    const right = new Set(chain(b).slice(1));
    return (
      chain(a)
        .slice(1)
        .find((id) => right.has(id)) ?? null
    );
  };
  const reversed = new Set<string>(),
    oriented = new Map<string, string>();

  const ends = new Map<string, [string, string]>();
  /** Ports by id, with the node they belong to. */
  const ports = new Map<string, string>();
  /** An ELK edge for a wire drawn from `from` to `to`; `flip` lays it out the other way (its route is reversed back). */
  const connect = (
    id: string,
    from: string,
    to: string,
    labels: ElkLabel[] = [],
    straight = false,
    flip = false,
    thickness = 0,
  ) => {
    // Connections at a person who goes first point away from them.
    if (leads(flip ? from : to) && !leads(flip ? to : from)) flip = !flip;
    ends.set(id, [from, to]);
    if (flip) reversed.add(id);
    const [source, target] = flip ? [to, from] : [from, to];
    const layoutOptions = {
      ...(straight ? { "elk.layered.priority.straightness": "10" } : {}),
      ...(thickness ? { "elk.edge.thickness": String(thickness) } : {}),
    };
    // A thick connection attaches through ports as wide as it is, so ELK keeps other wire ends that far apart.
    const end = (node: string, side: string) => {
      const border = borders.get(`${id}@${node}`);
      if (border) return border;
      if (!thickness) return node;
      const port = {
        id: `${id}:${side}`,
        width: vertical ? thickness : 0,
        height: vertical ? 0 : thickness,
      };
      (elkNodes.get(node)!.ports ??= []).push(port);
      ports.set(port.id, node);
      return port.id;
    };
    (owner(source, target).edges ??= []).push({
      id,
      sources: [end(source, "out")],
      targets: [end(target, "in")],
      labels,
      ...(Object.keys(layoutOptions).length ? { layoutOptions } : {}),
    } as ElkExtendedEdge);
  };
  // A delegation continues the connection that arrives at its container: when there is one of each, both
  // attach to one port on the container's border, so ELK lays them out as one line, as UML draws them.
  const borders = new Map<string, string>();
  for (const container of new Set(
    diagram.edges.filter((edge) => edge.kind === "delegation").map((edge) => edge.source),
  )) {
    const delegations = diagram.edges.filter(
      (edge) => edge.kind === "delegation" && edge.source === container,
    );
    const arriving = diagram.edges.filter(
      (edge) =>
        edge.kind !== "delegation" &&
        (edge.source === container || edge.target === container) &&
        !chain(edge.source === container ? edge.target : edge.source).includes(container),
    );
    if (delegations.length !== 1 || arriving.length !== 1) continue;
    const [delegation] = delegations,
      [connection] = arriving,
      port = `${container}#border`;
    (elkNodes.get(container)!.ports ??= []).push({ id: port, width: 0, height: 0 });
    ports.set(port, container);
    borders.set(`${delegation.id}@${container}`, port);
    const wire =
      connection.kind === "channel" || connection.kind === "assembly"
        ? `${connection.id}:${connection.source === container ? "a" : "b"}`
        : connection.id;
    borders.set(`${wire}@${container}`, port);
  }
  for (const edge of diagram.edges) {
    // A pointer beside its storage is drawn after layout.
    if (edge.aside) continue;
    if (edge.kind === "channel" || edge.kind === "assembly") {
      // Channels and ball-and-socket connectors are small nodes on the connection, so ELK keeps room for their markers and labels.
      const id = `${edge.id}#node`,
        parent = common(edge.source, edge.target);
      const size = edge.kind === "assembly" ? ASSEMBLY : CHANNEL;
      const node: ElkNode = {
        id,
        width: size,
        height: size,
        labels: channelLabels(edge),
        layoutOptions: { "elk.spacing.labelNode": String(MARKER_GAP) },
      };
      (parent ? elkNodes.get(parent)! : graph).children!.push(node);
      elkNodes.set(id, node);
      diagram.nodes.set(id, {
        id,
        kind: edge.kind === "assembly" ? "interface" : "channel",
        label: "",
        parent,
        children: [],
        stack: false,
        line: edge.line,
      });
      // All connections between two elements are laid out the way the first one runs, so an inbound
      // and an outbound channel sit side by side instead of one looping back around.
      // A person who goes first starts the pair's direction.
      const pair = [edge.source, edge.target].toSorted().join("\u0000");
      const lead =
        leads(edge.target) && !leads(edge.source)
          ? edge.target
          : leads(edge.source) && !leads(edge.target)
            ? edge.source
            : undefined;
      const start = lead ?? oriented.get(pair) ?? edge.source;
      oriented.set(pair, start);
      const flipped = start !== edge.source;
      connect(`${edge.id}:a`, edge.source, id, [], true, flipped);
      connect(`${edge.id}:b`, id, edge.target, [], true, flipped);
    } else if (edge.kind === "anchor") {
      // ELK lays a note out a layer beyond the element it remarks on, so the note stands next to it.
      const note = diagram.nodes.get(edge.source)!.kind === "note";
      connect(edge.id, edge.source, edge.target, [], true, note);
    } else {
      const labels = edge.label
        ? [
            {
              text: edge.label,
              width: smallSize(edge.label, measure).width + 4,
              height: Math.max(LINE - 2, smallSize(edge.label, measure).height),
            },
          ]
        : [];
      connect(
        edge.id,
        edge.source,
        edge.target,
        labels,
        edge.kind !== "dependency",
        !!options.flow && edge.kind === "read",
        edge.kind === "modify" ? LOOP_WIDTH : 0,
      );
    }
  }
  return {
    chain,
    channelLabels,
    diagram,
    ends,
    graph,
    markerSize,
    reversed,
    scale,
    shapes,
    vertical,
  };
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
      return lines.length
        ? { width: Math.max(76, textWidth + 2 * PAD), height: 38 + text + 10 }
        : { width: 48, height: 46 };
    // Storages are pills: the round ends take half the height on each side.
    case "storage": {
      const height = Math.max(36, text + 18);
      return lines.length
        ? { width: Math.max(96, textWidth + height + 8), height }
        : { width: 36, height: 36 };
    }
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
  const subsystem = node.kind === "subsystem" ? 16 : 0,
    icon = node.kind === "component" || node.kind === "subsystem" ? 24 : 0;
  // Below the title there is room for an arrowhead that enters a part from above, clear of the title's glyphs.
  const titleBottom = TITLE_TOP + subsystem + (lines.length - 0.5) * LINE + 0.62 * FONT;
  return {
    top:
      node.kind === "package"
        ? TAB + 14
        : lines.length
          ? Math.ceil(titleBottom + MARKER_LENGTH.arrow + 4)
          : 12,
    side: node.kind === "group" ? 12 : PAD,
    minimum:
      Math.ceil(
        node.kind === "package" ? measure(node.label, SMALL, 600) + 24 : textWidth + 2 * PAD + icon,
      ) + (node.stack ? SHADOW : 0),
  };
}
