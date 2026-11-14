/** ELK layered layout for node-and-edge diagrams, and the wire, label and marker placement on top of it. */

import type { ElkExtendedEdge, ElkLabel, ElkNode } from "elkjs/lib/elk-api";
import type { Box, Point } from "./scene.ts";
import type { Geometry } from "./route.ts";
import { straighten } from "./route-straighten.ts";
import { balanceElements, spreadJogs } from "./route-spread.ts";
import { alignLayers, centerElements, centerEnds, centerFans, centerWires } from "./route-center.ts";

/**
 * Layered graph layout with ELK for every graph-shaped diagram type, handling ELK's quirks the way
 * layoutTam does: compound minimum sizes are given transposed for vertical directions, edge
 * points are relative to the edge's container, labels without text are skipped, and edges must live
 * in the lowest common container of their ends. After ELK, the shared geometry passes (route.ts)
 * straighten routes, center elements and markers, and spread sideways steps, as for TAM diagrams.
 */

export type Direction = "TB" | "BT" | "LR" | "RL";

const DIRECTIONS = { TB: "DOWN", BT: "UP", LR: "RIGHT", RL: "LEFT" } as const;

/** Reach of a self loop beyond its node, and the step between nested loops. */
const LOOP = 26,
  NEST = 14;

/** Runs ELK on a graph; the default runs it in-process, the app runs it in a worker. */
export type ElkLayout = (graph: ElkNode) => Promise<ElkNode>;

let inProcess: Promise<ElkLayout> | undefined;

/** ELK running in-process (elkjs's bundled build, loaded on first use): the default layout. */
export const bundledElk = () =>
  (inProcess ??= import("elkjs/lib/elk.bundled.js").then(({ default: ELK }) => {
    const elk = new ELK();
    return (graph) => elk.layout(graph);
  }));

/**
 * A pool of ELK web workers running `workerUrl` (elkjs's elk-worker.min.js): a diagram's layout
 * strategies run in parallel, off the main thread. Each request goes to the worker with the fewest
 * pending layouts. Undefined where there are no workers.
 */
export async function elkWorkerPool(
  workerUrl: string,
  size = Math.max(1, Math.min(6, (globalThis.navigator?.hardwareConcurrency || 2) - 1)),
): Promise<ElkLayout | undefined> {
  if (typeof Worker === "undefined") return undefined;
  const { default: ELK } = await import("elkjs/lib/elk-api.js");
  const workers = Array.from({ length: size }, () => ({ elk: new ELK({ workerUrl }), pending: 0 }));
  return async (graph) => {
    const worker = workers.reduce((least, item) => (item.pending < least.pending ? item : least));
    worker.pending++;
    try {
      return await worker.elk.layout(graph);
    } finally {
      worker.pending--;
    }
  };
}

/** A node of a layout graph: a leaf with a size, or a container of further nodes. */
export interface GraphNode {
  id: string;
  /** Leaves: the node's size. */
  width?: number;
  height?: number;
  children?: GraphNode[];
  /** Containers: room for the title at the top, and at the sides and bottom. */
  padding?: { top: number; side: number; bottom?: number };
  /** Containers: the smallest width, for the title. */
  minWidth?: number;
  /** Space reserved outside the node, such as a side label or a note; placements as in ELK (`OUTSIDE H_RIGHT V_CENTER`). */
  labels?: { width: number; height: number; placement: string; gap?: number }[];
  /** Wires end on a rounded outline with this corner radius. */
  radius?: number;
  /** Wires to this node run through its center line (small symmetric nodes: diamonds, dots). */
  centered?: boolean;
  /** Wires and text may pass over this node (invisible groups). */
  passable?: boolean;
  /** Leaves: fixed connection points on the outline, relative to the node. */
  ports?: GraphPort[];
}

/** A fixed connection point on a leaf's outline, relative to the leaf. */
export interface GraphPort {
  id: string;
  x: number;
  y: number;
  side: "NORTH" | "EAST" | "SOUTH" | "WEST";
}

/** A connection of a layout graph, between leaves or containers. */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Size of the label at the middle of the edge. */
  label?: { width: number; height: number };
  /** Lay the edge out from target to source (the route still runs from source to target). */
  reversed?: boolean;
  /** Prefer a straight edge (ELK straightness priority). */
  straight?: boolean;
  /** Layout only: never drawn, never straightened. */
  invisible?: boolean;
  /** Ports of the end nodes the edge attaches to. */
  sourcePort?: string;
  targetPort?: string;
  /** Self loops: extra reach for what is drawn at their ends (markers, end labels). */
  room?: number;
}

/** The input of layoutGraph: the top-level nodes, every edge and the flow direction. */
export interface Graph {
  direction: Direction;
  children: GraphNode[];
  edges: GraphEdge[];
}

/**
 * layoutGraph options: `layout` runs ELK (default: in-process), `elk` overrides root layout options,
 * `spacing` replaces the default gaps.
 */
export interface LayoutOptions {
  layout?: ElkLayout;
  elk?: Record<string, string>;
  spacing?: Partial<{ node: number; layer: number; edge: number; port: number; edgeNode: number }>;
  /** Draw self loops for this orientation instead of the layout direction's. */
  loops?: "vertical" | "horizontal";
}

/** The result of layoutGraph: absolute boxes, routes and label boxes by id. */
export interface Placement {
  boxes: Map<string, Box>;
  /** Routes from source to target in absolute coordinates. */
  routes: Map<string, Point[]>;
  edgeLabels: Map<string, Box>;
  nodeLabels: Map<string, Box[]>;
  /** Containers around each node, innermost first. */
  ancestors: Map<string, string[]>;
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
}

/** Root options of every layered layout, between the spacing and the caller's `elk` overrides. */
export const layeredOptions = (
  direction: Direction,
  spacing: Record<string, string>,
  elk?: Record<string, string>,
) => ({
  ...spacing,
  "elk.algorithm": "layered",
  "elk.direction": DIRECTIONS[direction],
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.padding": "[top=12,left=12,bottom=12,right=12]",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.thoroughness": "20",
  // Every connection keeps its own port where it crosses a container border, so arrowheads never share a point.
  "elk.layered.mergeHierarchyEdges": "false",
  "elk.layered.mergeEdges": "false",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.edgeLabels.placement": "CENTER",
  ...elk,
});

/** Absolute geometry of an ELK result: ELK places nodes relative to their parent and edge points relative to the edge's container. */
export function readLayout(result: ElkNode, reversed: (edge: string) => boolean) {
  const boxes = new Map<string, Box>(),
    routes = new Map<string, Point[]>(),
    edgeLabels = new Map<string, Box>(),
    nodeLabels = new Map<string, Box[]>();
  const at = (item: ElkLabel | ElkNode, origin: Point): Box => ({
    x: origin.x + (item.x ?? 0),
    y: origin.y + (item.y ?? 0),
    width: item.width ?? 0,
    height: item.height ?? 0,
  });
  const walk = (node: ElkNode, origin: Point) => {
    const box = at(node, origin);
    if (node.id !== "root") {
      boxes.set(node.id, box);
      if (node.labels?.length)
        nodeLabels.set(
          node.id,
          node.labels.map((label) => at(label, box)),
        );
    }
    node.children?.forEach((child) => walk(child, box));
  };
  walk(result, { x: 0, y: 0 });
  const visit = (node: ElkNode) => {
    for (const edge of node.edges ?? []) {
      const container = (edge as ElkExtendedEdge & { container?: string }).container;
      const origin = container && container !== "root" ? boxes.get(container)! : { x: 0, y: 0 };
      const section = edge.sections?.[0];
      if (section) {
        const points = orthogonal(
          [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point) => ({
            x: origin.x + point.x,
            y: origin.y + point.y,
          })),
        );
        // Routes run from the edge's source, whichever way ELK layered it.
        routes.set(edge.id, reversed(edge.id) ? points.toReversed() : points);
      }
      const label = edge.labels?.[0];
      if (label) edgeLabels.set(edge.id, at(label, origin));
    }
    node.children?.forEach(visit);
  };
  visit(result);
  return { boxes, routes, edgeLabels, nodeLabels };
}

/**
 * ELK expects every edge in the lowest common container of its ends; an edge to a part lives in its
 * container. `chain` lists a node's id and then its ancestors', innermost first; `elkNodes` receives
 * every ELK node by id, and nodes added to it later are found too.
 */
export function edgeOwner(
  root: ElkNode,
  chain: (id: string) => string[],
  elkNodes = new Map<string, ElkNode>(),
) {
  const index = (node: ElkNode) => {
    elkNodes.set(node.id, node);
    node.children?.forEach(index);
  };
  index(root);
  return (a: string, b: string): ElkNode => {
    const left = chain(a),
      right = chain(b);
    if (right.includes(a)) return elkNodes.get(a)!;
    if (left.includes(b)) return elkNodes.get(b)!;
    const common = left.slice(1).find((id) => right.includes(id));
    return common ? elkNodes.get(common)! : root;
  };
}

/**
 * Lays out a graph with ELK and the shared geometry passes; self loops are drawn as UML corner loops
 * (arches on horizontal layouts), with room reserved around their nodes.
 */
export async function layoutGraph(graph: Graph, options: LayoutOptions = {}): Promise<Placement> {
  const layout = options.layout ?? (await bundledElk());
  const vertical = graph.direction === "TB" || graph.direction === "BT";
  const upright = options.loops ? options.loops === "vertical" : vertical;
  const s = { node: 32, layer: 36, edge: 14, port: 16, edgeNode: 18, ...options.spacing };
  const spacing = {
    "elk.spacing.nodeNode": String(s.node),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(s.layer),
    "elk.spacing.edgeNode": String(s.edgeNode),
    "elk.spacing.edgeEdge": String(s.edge),
    "elk.spacing.portPort": String(s.port),
    "elk.layered.spacing.edgeNodeBetweenLayers": String(s.edgeNode),
    "elk.layered.spacing.edgeEdgeBetweenLayers": String(Math.max(10, s.edge - 2)),
    "elk.spacing.labelNode": "6",
    "elk.spacing.edgeLabel": "6",
  };
  const nodes = new Map<string, GraphNode>(),
    parents = new Map<string, string | null>();
  // Self loops are UML corner loops: in vertical layouts from the top side around the top right
  // corner into the right side, in horizontal ones an arch on the top side. ELK reserves their
  // space as outside labels (it leaves those out of container sizes, so containers get padding).
  const loops = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges)
    if (edge.source === edge.target && !edge.invisible)
      loops.set(edge.source, [...(loops.get(edge.source) ?? []), edge]);
  const loopLabel = (edges: GraphEdge[]) => ({
    width: Math.max(0, ...edges.map((edge) => edge.label?.width ?? 0)),
    height: Math.max(0, ...edges.map((edge) => edge.label?.height ?? 0)),
  });
  // A node's loops reach further when their ends carry markers or labels.
  const loopBase = (edges: GraphEdge[]) =>
    LOOP + Math.max(0, ...edges.map((edge) => edge.room ?? 0));
  const loopReach = (edges: GraphEdge[]) => loopBase(edges) + (edges.length - 1) * NEST + 18;
  // A note on the right moves the loops to the top left corner.
  const mirrored = (node: GraphNode) =>
    upright && !!node.labels?.some((label) => label.placement.includes("H_RIGHT"));
  const reservations = (node: GraphNode, edges: GraphEdge[]) => {
    const reach = loopReach(edges),
      label = loopLabel(edges),
      inset = loopInset(node);
    const flip = (placement: string) =>
      mirrored(node) ? placement.replace("H_RIGHT", "H_LEFT") : placement;
    return upright
      ? [
          {
            width: inset.along + (edges.length - 1) * 8 + 4,
            height: reach,
            placement: flip("OUTSIDE V_TOP H_RIGHT"),
          },
          {
            width: reach + (label.width ? label.width + 6 : 0),
            height: Math.max(
              inset.across + (edges.length - 1) * 8 + 8,
              edges.length > 1
                ? edges.reduce((sum, edge) => sum + (edge.label ? edge.label.height + 2 : 0), 0) -
                    reach +
                    8
                : 0,
            ),
            placement: flip("OUTSIDE H_RIGHT V_TOP H_PRIORITY"),
          },
        ]
      : [
          {
            width:
              inset.along +
              Math.max(
                loopBase(edges) + 8 + (edges.length - 1) * 16,
                edges.reduce((sum, edge) => sum + (edge.label ? edge.label.width + 8 : 0), 0),
              ),
            height: reach + (label.height ? label.height + 6 : 0),
            placement: "OUTSIDE V_TOP H_LEFT",
          },
        ];
  };
  const build = (node: GraphNode, parent: string | null): ElkNode => {
    nodes.set(node.id, node);
    parents.set(node.id, parent);
    const own = loops.get(node.id);
    const reserved = own ? reservations(node, own) : [];
    // ELK ignores per-node label spacing: a label's gap is reserved as part of the label instead.
    const labels: ElkLabel[] = [...(node.labels ?? []), ...reserved].map((label, index) => {
      const gap = (label as { gap?: number }).gap ?? 0,
        side =
          /H_(LEFT|RIGHT)/.test(label.placement) &&
          (/H_PRIORITY/.test(label.placement) || /V_CENTER/.test(label.placement));
      return {
        id: `${node.id}#label${index}`,
        text: "n",
        width: label.width + (side ? gap : 0),
        height: label.height + (side ? 0 : gap),
        layoutOptions: { "elk.nodeLabels.placement": label.placement },
      };
    });
    const gap = own ? 0 : node.labels?.length ? 0 : undefined;
    if (node.children?.length) {
      const base = node.padding ?? { top: 12, side: 12 };
      // ELK leaves outside labels out of a container's size: make room for the self loops inside.
      const looped = descendants(node)
        .filter((child) => loops.has(child.id))
        .map((child) => reservations(child, loops.get(child.id)!));
      const reach = (index: number, key: "width" | "height") =>
        Math.max(0, ...looped.map((list) => list[index]?.[key] ?? 0));
      const padding = {
        ...base,
        bottom: base.bottom ?? base.side,
        right: base.side + (upright ? reach(1, "width") : 0),
        top: base.top + reach(0, "height"),
        left:
          base.side +
          (upright && descendants(node).some((child) => loops.has(child.id) && mirrored(child))
            ? reach(1, "width")
            : 0),
      };
      const minimum = node.minWidth ?? 0,
        height = padding.top + 24;
      return {
        id: node.id,
        labels,
        children: node.children.map((child) => build(child, node.id)),
        layoutOptions: {
          ...spacing,
          ...options.elk,
          "elk.alignment": "CENTER",
          "elk.padding": `[top=${padding.top},left=${padding.left},bottom=${padding.bottom},right=${padding.right}]`,
          // ELK applies compound minimum sizes before transposing vertical layouts, so swap them here.
          ...(minimum
            ? {
                "elk.nodeSize.constraints": "MINIMUM_SIZE",
                "elk.nodeSize.minimum": vertical
                  ? `(${height},${minimum})`
                  : `(${minimum},${height})`,
              }
            : {}),
          ...(gap !== undefined ? { "elk.spacing.labelNode": String(gap) } : {}),
        },
      };
    }
    return {
      id: node.id,
      width: node.width ?? 40,
      height: node.height ?? 30,
      labels,
      ...(node.ports?.length
        ? {
            ports: node.ports.map((port) => ({
              id: port.id,
              x: port.x,
              y: port.y,
              width: 0,
              height: 0,
              layoutOptions: { "elk.port.side": port.side },
            })),
          }
        : {}),
      // Connections on one side of a node keep apart, for their markers and end labels.
      layoutOptions: {
        "elk.alignment": "CENTER",
        "elk.spacing.portPort": String(s.port),
        ...(gap !== undefined ? { "elk.spacing.labelNode": String(gap) } : {}),
        ...(node.ports?.length ? { "elk.portConstraints": "FIXED_POS" } : {}),
      },
    };
  };
  const root: ElkNode = {
    id: "root",
    children: graph.children.map((node) => build(node, null)),
    edges: [],
    layoutOptions: layeredOptions(graph.direction, spacing, options.elk),
  };
  const chain = (id: string) => {
    const ids: string[] = [];
    for (let node: string | null | undefined = id; node; node = parents.get(node)) ids.push(node);
    return ids;
  };
  const owner = edgeOwner(root, chain);
  const edges = new Map<string, GraphEdge>();
  for (const edge of graph.edges) {
    edges.set(edge.id, edge);
    if (edge.source === edge.target) continue;
    const [source, target] = edge.reversed
      ? [edge.target, edge.source]
      : [edge.source, edge.target];
    const [sourcePort, targetPort] = edge.reversed
      ? [edge.targetPort, edge.sourcePort]
      : [edge.sourcePort, edge.targetPort];
    const labels = edge.label
      ? [{ text: "l", width: edge.label.width, height: edge.label.height }]
      : [];
    (owner(source, target).edges ??= []).push({
      id: edge.id,
      sources: [sourcePort ?? source],
      targets: [targetPort ?? target],
      labels,
      ...(edge.straight ? { layoutOptions: { "elk.layered.priority.straightness": "10" } } : {}),
    } as ElkExtendedEdge);
  }

  const { boxes, routes, edgeLabels, nodeLabels } = readLayout(
    await layout(root),
    (id) => !!edges.get(id)?.reversed,
  );
  // A label's gap is no part of it: drop it on the side facing the node.
  for (const [id, labels] of nodeLabels) {
    const node = boxes.get(id)!,
      specs = nodes.get(id)?.labels ?? [];
    nodeLabels.set(
      id,
      labels.map((box, index) => {
        const spec = specs[index];
        if (!spec?.gap) return box;
        const cx = box.x + box.width / 2 - node.x - node.width / 2,
          cy = box.y + box.height / 2 - node.y - node.height / 2;
        if (box.width > spec.width + 0.5)
          return { ...box, x: cx > 0 ? box.x + spec.gap : box.x, width: spec.width };
        if (box.height > spec.height + 0.5)
          return { ...box, y: cy > 0 ? box.y + spec.gap : box.y, height: spec.height };
        return box;
      }),
    );
  }
  for (const [id, own] of loops) {
    const box = boxes.get(id),
      node = nodes.get(id)!;
    if (!box) continue;
    const inset = loopInset(node),
      right = box.x + box.width,
      top = box.y;
    own.forEach((edge, index) => {
      const base = loopBase(own),
        reach = base + index * NEST;
      // Narrow nodes (bars) cannot hold an arch on their top: they get the corner loop as well.
      if (upright || box.width < 40) {
        // Up from the top side, around the corner, into the right side; nested loops reach further.
        const along = inset.along + index * 8,
          across = Math.min(inset.across + index * 8, box.height - 4);
        routes.set(edge.id, [
          { x: right - along, y: top },
          { x: right - along, y: top - reach },
          { x: right + reach, y: top - reach },
          { x: right + reach, y: top + across },
          { x: right, y: top + across },
        ]);
        // Labels go right of the outermost loop, one under the other.
        if (edge.label) {
          const outer = base + (own.length - 1) * NEST,
            above = own
              .slice(0, index)
              .reduce((sum, item) => sum + (item.label ? item.label.height + 2 : 0), 0);
          edgeLabels.set(
            edge.id,
            own.length > 1
              ? { x: right + outer + 6, y: top - outer + above, ...edge.label }
              : {
                  x: right + reach + 6,
                  y: top + (across - reach) / 2 - edge.label.height / 2,
                  ...edge.label,
                },
          );
        }
      } else {
        // Nested arches: the innermost in the middle, each further one wider and higher.
        const inner = Math.max(
          14,
          Math.min(base, box.width - 2 * inset.along - 16 * (own.length - 1)),
        );
        const left = box.x + inset.along + (own.length - 1 - index) * 8,
          span = inner + 16 * index;
        routes.set(edge.id, [
          { x: left, y: top },
          { x: left, y: top - reach },
          { x: left + span, y: top - reach },
          { x: left + span, y: top },
        ]);
        // Labels go above the outermost loop, one beside the other.
        if (edge.label) {
          const outer = base + (own.length - 1) * NEST,
            before = own
              .slice(0, index)
              .reduce((sum, item) => sum + (item.label ? item.label.width + 8 : 0), 0);
          edgeLabels.set(
            edge.id,
            own.length > 1
              ? {
                  x: box.x + inset.along + before,
                  y: top - outer - 6 - edge.label.height,
                  ...edge.label,
                }
              : {
                  x: left + span / 2 - edge.label.width / 2,
                  y: top - reach - 6 - edge.label.height,
                  ...edge.label,
                },
          );
        }
      }
    });
    if (mirrored(node)) {
      const cx = box.x + box.width / 2;
      for (const edge of own) {
        routes.set(
          edge.id,
          routes.get(edge.id)!.map((point) => ({ x: 2 * cx - point.x, y: point.y })),
        );
        const label = edgeLabels.get(edge.id);
        if (label) edgeLabels.set(edge.id, { ...label, x: 2 * cx - label.x - label.width });
      }
    }
    // The reservations are no labels of the node's own.
    const labels = nodeLabels.get(id);
    if (labels) {
      labels.splice(labels.length - (upright ? 2 : 1));
      if (!labels.length) nodeLabels.delete(id);
    }
  }
  const ancestors = new Map([...nodes.keys()].map((id) => [id, chain(id).slice(1)]));
  const placement: Placement = { boxes, routes, edgeLabels, nodeLabels, ancestors, nodes, edges };
  improveRoutes(placement, vertical, s);
  return placement;
}

/** Where a self loop leaves and enters its node: clear of rounded corners, inside small nodes. */
function loopInset(node: GraphNode) {
  const width = node.width ?? 40,
    height = node.height ?? 30,
    radius = node.radius ?? 0;
  // Small symmetric symbols (diamonds, circles): from the top vertex into the right one.
  if (node.centered) return { along: width / 2, across: height / 2 };
  // Never beyond the middle, so loops on thin nodes (bars) still start and end on them.
  return {
    along: Math.min(width / 2, Math.max(8, Math.min(radius + 8, width / 2 - 2, 18))),
    across: Math.min(height / 2, Math.max(8, Math.min(radius + 8, height / 2, 18))),
  };
}

const descendants = (node: GraphNode): GraphNode[] =>
  (node.children ?? []).flatMap((child) => [child, ...descendants(child)]);

/** Makes nearly axis-aligned segments exact and drops repeated points. */
export function orthogonal(points: Point[]): Point[] {
  const copy = points.map((point) => ({ ...point }));
  for (let i = 1; i < copy.length; i++) {
    const [a, b] = [copy[i - 1], copy[i]];
    if (Math.abs(a.x - b.x) < 1) b.x = a.x;
    else if (Math.abs(a.y - b.y) < 1) b.y = a.y;
  }
  return copy.filter(
    (point, index) =>
      !index || Math.hypot(point.x - copy[index - 1].x, point.y - copy[index - 1].y) > 0.01,
  );
}

/**
 * The shared geometry passes on a placement: routes between nodes straighten, symbols (centered nodes)
 * act as markers, elements center among their neighbours and in their free space, and sideways steps
 * spread over their channel. Wires on fixed ports and self loops stay as they are but count as obstacles;
 * invisible edges take no part.
 */
export function improveRoutes(
  placement: Placement,
  vertical: boolean,
  spacing: { node: number; edgeNode: number },
) {
  const nodes = [...placement.nodes.values()].filter((node) => placement.boxes.has(node.id));
  const visible = [...placement.edges.values()].filter(
    (edge) => !edge.invisible && placement.routes.has(edge.id),
  );
  const geometry: Geometry = {
    boxes: placement.boxes,
    nodeLabels: placement.nodeLabels,
    edgeLabels: placement.edgeLabels,
    ancestors: placement.ancestors,
    routes: new Map(visible.map((edge) => [edge.id, placement.routes.get(edge.id)!])),
    ends: new Map(visible.map((edge) => [edge.id, [edge.source, edge.target]])),
    leaves: new Set(
      nodes
        .filter((node) => !node.children?.length && !node.passable && !node.centered)
        .map((node) => node.id),
    ),
    markers: new Set(
      nodes.filter((node) => !node.children?.length && node.centered).map((node) => node.id),
    ),
    round: new Map(nodes.filter((node) => node.radius).map((node) => [node.id, node.radius!])),
    containers: new Set(
      nodes.filter((node) => node.children?.length && !node.passable).map((node) => node.id),
    ),
    titles: [],
    widths: new Map(),
    spacing: { node: spacing.node, edge: spacing.edgeNode },
    insets: new Map(
      nodes
        .filter((node) => node.children?.length && node.padding)
        .map((node) => [
          node.id,
          {
            top: node.padding!.top,
            side: node.padding!.side,
            bottom: node.padding!.bottom ?? node.padding!.side,
          },
        ]),
    ),
    pinned: new Set(
      visible
        .filter((edge) => edge.source === edge.target || edge.sourcePort || edge.targetPort)
        .map((edge) => edge.id),
    ),
  };
  straighten(geometry, vertical);
  balanceElements(geometry, vertical);
  centerWires(geometry, vertical);
  centerEnds(geometry, vertical);
  centerElements(geometry, vertical);
  centerFans(geometry, vertical);
  alignLayers(geometry, vertical);
  spreadJogs(geometry, vertical);
  for (const [id, route] of geometry.routes) placement.routes.set(id, route);
}
