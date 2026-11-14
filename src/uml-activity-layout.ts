/** Flowcharts as UML activity diagrams: the node shapes, and the layout with ELK. */

import { addWire, attachEnds, spreadVertices, straightenScene } from "./wires.ts";
import {
  dodgeTitles,
  hugLabels,
  placeBeside,
  placeGuardLabel,
  smallSize,
  wrapSmall,
} from "./labels.ts";
import { type ElkLayout, type GraphEdge, type GraphNode, layoutGraph } from "./elk.ts";
import { addVertexPorts, END_ROOM, reversePostorder } from "./uml.ts";
import { bestScene, FLOW_STRATEGIES } from "./best.ts";
import {
  addText,
  addTitleLines,
  finishBounds,
  FONT,
  LINE,
  type Measure,
  SMALL,
  wrap,
} from "./text.ts";
import { type Box, emptyScene, type Scene, type ShapeKind } from "./scene.ts";
import { MARKER_LENGTH, type MarkerKind } from "./markers.ts";
import type { FlowEdge, Flowchart, FlowNode, Marker } from "./uml-activity.ts";

/**
 * Layout and drawing of flowcharts as UML activity diagrams with ELK; swimlane diagrams have their
 * own layout (uml-swimlanes.ts) and share the node shapes defined here.
 */

const PAD = 14,
  INITIAL = 15,
  FINAL = 17,
  DECISION = 18,
  BAR = 5;

export interface NodeBox {
  width: number;
  height: number;
  lines: string[];
  kind: ShapeKind;
  radius?: number;
  centered?: boolean;
  /** Space for a label beside the node: an initial or final node's name, a decision's question. */
  side?: { width: number; height: number };
  /** A decision's question, beside the diamond. */
  question?: string;
  /** Place the question once the wires are known (the decision needs its side vertices). */
  later?: boolean;
}

/** Size and text of a node: actions grow with their text, symbols keep a fixed size and name themselves beside. */
export function nodeBox(
  node: FlowNode,
  degree: { in: number; out: number },
  vertical: boolean,
  measure: Measure,
): NodeBox {
  const symbol =
    node.shape === "initial" ||
    node.shape === "final" ||
    node.shape === "flow-final" ||
    node.shape === "bar";
  const side = symbol && node.label ? smallSize(node.label, measure) : undefined;
  if (node.shape === "initial" || node.shape === "final" || node.shape === "flow-final") {
    // One wire per vertex; a symbol with more wires grows as a decision with many branches does,
    // so they meet its outline apart.
    if (degree.in + degree.out <= 4) {
      const size = node.shape === "final" ? FINAL : INITIAL;
      return { width: size, height: size, lines: [], kind: node.shape, centered: true, side };
    }
    const size = 6 * Math.max(degree.in, degree.out) + 6;
    return { width: size, height: size, lines: [], kind: node.shape, side };
  }
  if (node.shape === "bar") {
    const length = Math.max(60, 46 * Math.max(degree.in, degree.out));
    return {
      width: vertical ? length : BAR,
      height: vertical ? BAR : length,
      lines: [],
      kind: "bar",
      side,
    };
  }
  if (node.shape === "diamond") {
    // Decisions and merges are always the small UML diamond; their question is a label beside it.
    const most = Math.max(degree.in, degree.out),
      size = most <= 3 ? DECISION : 6 * most + 6;
    const text = node.label.trim() ? wrapSmall(node.label, measure, 150) : "";
    return {
      width: size,
      height: size,
      lines: [],
      kind: "diamond",
      centered: size === DECISION,
      side: text ? smallSize(text, measure) : undefined,
      question: text || undefined,
      later: degree.out > 2 || degree.in > 2,
    };
  }
  const lines = wrap(
    node.label,
    node.shape === "circle" || node.shape === "double-circle" ? 120 : 170,
    FONT,
    400,
    measure,
  );
  const textWidth = Math.max(0, ...lines.map((line) => measure(line, FONT, 400))),
    textHeight = lines.length * LINE;
  // The side across the flow holds the wires along the flow apart with their markers, and one more
  // turning back against it (ELK spreads the wires on a side evenly).
  const across = (Math.max(degree.in, degree.out) + 2) * END_ROOM;
  const fit = (box: NodeBox): NodeBox =>
    vertical
      ? { ...box, width: Math.max(box.width, across) }
      : { ...box, height: Math.max(box.height, across) };
  switch (node.shape) {
    case "circle":
    case "double-circle": {
      const size = Math.ceil(
        Math.max(
          44,
          across,
          Math.hypot(textWidth, textHeight) + (node.shape === "double-circle" ? 20 : 12),
        ),
      );
      return { width: size, height: size, lines, kind: node.shape };
    }
    // Actions: whichever of the box brackets the author wrote, a rounded rectangle as in TAM activity diagrams.
    case "rect":
    case "round":
    case "stadium":
      return fit({
        width: Math.ceil(Math.max(80, textWidth + 2 * PAD + 4)),
        height: Math.max(36, textHeight + 18),
        lines,
        kind: "round",
        radius: 10,
      });
    case "subroutine":
      return fit({
        width: Math.ceil(Math.max(90, textWidth + 2 * PAD + 16)),
        height: Math.max(38, textHeight + 18),
        lines,
        kind: "subroutine",
      });
    case "cylinder":
      return fit({
        width: Math.ceil(Math.max(80, textWidth + 2 * PAD)),
        height: Math.max(52, textHeight + 32),
        lines,
        kind: "cylinder",
      });
    case "hexagon":
      return fit({
        width: Math.ceil(Math.max(90, textWidth + 2 * PAD + 28)),
        height: Math.max(38, textHeight + 18),
        lines,
        kind: "hexagon",
      });
    case "lean-right":
    case "lean-left":
    case "trapezoid":
    case "trapezoid-top":
      return fit({
        width: Math.ceil(Math.max(90, textWidth + 2 * PAD + 28)),
        height: Math.max(38, textHeight + 18),
        lines,
        kind: node.shape,
      });
    case "flag":
      return fit({
        width: Math.ceil(Math.max(80, textWidth + 2 * PAD + 12)),
        height: Math.max(38, textHeight + 18),
        lines,
        kind: "flag",
      });
    default:
      return fit({
        width: Math.ceil(Math.max(80, textWidth + 2 * PAD)),
        height: Math.max(36, textHeight + 18),
        lines,
        kind: "rect",
      });
  }
}

/** Draws a node's shape and text into the scene. */
export function drawNode(
  scene: Scene,
  measure: Measure,
  id: string,
  size: NodeBox,
  box: Box,
  depth: number,
  label: string,
  sideBox?: Box,
) {
  scene.shapes.push({
    id,
    kind: size.kind,
    box,
    container: false,
    depth,
    fill: "page",
    radius: size.radius,
  });
  const cx = box.x + box.width / 2 + (size.kind === "flag" ? 5 : 0);
  const cy = box.y + box.height / 2 + (size.kind === "cylinder" ? 4 : 0);
  size.lines.forEach((line, index) =>
    addText(scene, measure, line, cx, cy + (index - (size.lines.length - 1) / 2) * LINE, {
      size: FONT,
      role: "node",
      owner: id,
    }),
  );
  if (sideBox && (size.question ?? label) && !size.later) {
    label = size.question ?? label;
    label
      .split(/<br\s*\/?>/i)
      .forEach((line, index, all) =>
        addText(
          scene,
          measure,
          line,
          sideBox.x + sideBox.width / 2,
          sideBox.y + sideBox.height / 2 + (index - (all.length - 1) / 2) * 15,
          { size: SMALL, tone: "secondary", role: "label", owner: id },
        ),
      );
  }
}

export const MARKERS: Record<Marker, MarkerKind> = {
  arrow: "arrow",
  circle: "circle",
  cross: "cross",
};

export const isDecision = (chart: Flowchart, id: string) =>
  chart.nodes.get(id)?.shape === "diamond";
/** An edge's label; leaving a decision it is a guard, shown in brackets as UML does. */
export function guardText(chart: Flowchart, edge: FlowEdge): string {
  const text = edge.label ?? "";
  return isDecision(chart, edge.source) && text && !/^\[.*\]$/.test(text) ? `[${text}]` : text;
}

export function degrees(edges: FlowEdge[]) {
  const degree = new Map<string, { in: number; out: number }>();
  const get = (id: string) =>
    degree.get(id) ?? (degree.set(id, { in: 0, out: 0 }), degree.get(id)!);
  for (const edge of edges)
    if (edge.stroke !== "invisible" && edge.source !== edge.target) {
      get(edge.source).out++;
      get(edge.target).in++;
    }
  return (id: string) => degree.get(id) ?? { in: 0, out: 0 };
}

/**
 * Rank of each node in a topological order without loops: reverse postorder of a depth-first
 * search that starts at the initial nodes (then at nodes nothing leads to) and follows edges in
 * source order. Subgraphs rank with their earliest member.
 */
function flowRank(chart: Flowchart): (id: string) => number {
  const outgoing = new Map<string, string[]>();
  for (const edge of chart.edges)
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const children = new Map<string, string[]>();
  for (const id of chart.order) {
    const parent = chart.nodes.get(id)?.parent ?? chart.subgraphs.get(id)?.parent;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const incoming = new Set(chart.edges.map((edge) => edge.target));
  const starts = [...chart.nodes.values()]
    .filter((node) => node.shape === "initial")
    .map((node) => node.id)
    .concat(chart.order.filter((id) => chart.nodes.has(id) && !incoming.has(id)));
  const order = reversePostorder([...starts, ...chart.order], (id) => [
    ...(outgoing.get(id) ?? []),
    ...(children.get(id) ?? []),
  ]);
  const memo = new Map<string, number>();
  const rank = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    memo.set(id, order.get(id) ?? Infinity);
    // A subgraph ranks where its contents start, whatever leads to the subgraph itself.
    const kids = children.get(id) ?? [];
    const value = kids.length ? Math.min(...kids.map(rank)) : (order.get(id) ?? Infinity);
    memo.set(id, value);
    return value;
  };
  return rank;
}

/** A copy of a flowchart whose nodes, edges and order can change without touching the original. */
function copyChart(source: Flowchart): Flowchart {
  return {
    ...source,
    nodes: new Map(source.nodes),
    edges: source.edges.map((edge) => ({ ...edge })),
    order: [...source.order],
  };
}

/**
 * An activity may end in several final nodes (TAM standard figure 2-8): a final node with several
 * incoming flows becomes one final node per flow, so the flows need not converge on one small circle.
 */
export function splitFinals(source: Flowchart): Flowchart {
  const chart = copyChart(source);
  for (const node of source.nodes.values()) {
    if (node.shape !== "final" && node.shape !== "flow-final") continue;
    const incoming = chart.edges.filter(
      (edge) => edge.target === node.id && edge.stroke !== "invisible" && edge.source !== node.id,
    );
    if (
      incoming.length < 2 ||
      chart.edges.some((edge) => edge.source === node.id && edge.stroke !== "invisible")
    )
      continue;
    incoming.slice(1).forEach((edge, index) => {
      const copy = { ...node, id: `${node.id}#${index + 2}` };
      chart.nodes.set(copy.id, copy);
      chart.order.splice(chart.order.indexOf(node.id) + 1 + index, 0, copy.id);
      edge.target = copy.id;
    });
  }
  return chart;
}

/**
 * Diamonds keep one wire per vertex: a diamond that both merges and decides becomes a merge diamond
 * followed by a decision diamond, as UML draws them; a merge of more than three flows becomes a
 * chain of merges, and a decision with more than three branches a chain of decisions.
 */
export function splitDecisions(source: Flowchart): Flowchart {
  const chart = copyChart(source);
  const live = (edge: FlowEdge) => edge.stroke !== "invisible" && edge.source !== edge.target;
  const add = (node: FlowNode, id: string, before: string) => {
    const copy = { ...node, id, label: "" };
    chart.nodes.set(id, copy);
    chart.order.splice(chart.order.indexOf(before) + (before === node.id ? 0 : 1), 0, id);
    return copy;
  };
  const link = (source: string, target: string, line: number) =>
    chart.edges.push({
      id: `${source}->${target}`,
      source,
      target,
      stroke: "solid",
      end: "arrow",
      line,
    });
  for (const node of source.nodes.values()) {
    if (node.shape !== "diamond") continue;
    const incoming = chart.edges.filter((edge) => edge.target === node.id && live(edge));
    const outgoing = chart.edges.filter((edge) => edge.source === node.id && live(edge));
    // Merges first: chains of up to three flows each, the last one leading into the node.
    let tail = node;
    if (incoming.length >= 2 && outgoing.length >= 2) {
      tail = add(node, `${node.id}#merge`, node.id);
      for (const edge of incoming) edge.target = tail.id;
      link(tail.id, node.id, node.line);
    }
    for (
      let target = tail, step = 2;
      chart.edges.filter((edge) => edge.target === target.id && live(edge)).length > 3;
      step++
    ) {
      const into = chart.edges.filter((edge) => edge.target === target.id && live(edge));
      const extra = add(node, `${node.id}#merge${step}`, target.id);
      for (const edge of into.slice(2)) edge.target = extra.id;
      link(extra.id, target.id, node.line);
      target = extra;
    }
    // Decisions: more than three branches continue in a further decision.
    for (
      let from = node, step = 2;
      chart.edges.filter((edge) => edge.source === from.id && live(edge)).length > 3;
      step++
    ) {
      const out = chart.edges.filter((edge) => edge.source === from.id && live(edge));
      const extra = add(node, `${node.id}#decision${step}`, from.id);
      for (const edge of out.slice(2)) edge.source = extra.id;
      link(from.id, extra.id, node.line);
      from = extra;
    }
  }
  return chart;
}

export async function layoutFlowchart(
  original: Flowchart,
  measure: Measure,
  options: { layout?: ElkLayout } = {},
): Promise<Scene> {
  const chart = splitDecisions(splitFinals(original));
  const vertical = chart.direction === "TB" || chart.direction === "BT";
  const degree = degrees(chart.edges);
  const sizes = new Map(
    [...chart.nodes.values()].map((node) => [
      node.id,
      nodeBox(node, degree(node.id), vertical, measure),
    ]),
  );
  const titles = new Map(
    [...chart.subgraphs.values()].map((subgraph) => [
      subgraph.id,
      subgraph.label ? wrap(subgraph.label, 300, FONT, 600, measure) : [],
    ]),
  );
  const rank = flowRank(chart);
  const children = new Map<string | null, string[]>();
  for (const id of chart.order) {
    const parent = chart.nodes.get(id)?.parent ?? chart.subgraphs.get(id)?.parent ?? null;
    children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const build = (id: string): GraphNode => {
    if (chart.subgraphs.has(id)) {
      const lines = titles.get(id)!,
        kids = [...(children.get(id) ?? [])].toSorted((a, b) => rank(a) - rank(b));
      return {
        id,
        children: kids.length
          ? kids.map(build)
          : [{ id: `${id}#empty`, width: 60, height: 10, passable: true }],
        // Below the title, room for an arrowhead into a node at the top of the group.
        padding: {
          top: lines.length ? 9 + lines.length * LINE + Math.ceil(MARKER_LENGTH.arrow) + 6 : 14,
          side: 14,
        },
        minWidth: lines.length
          ? Math.ceil(Math.max(...lines.map((line) => measure(line, FONT, 600))) + 28)
          : 0,
      };
    }
    const size = sizes.get(id)!;
    return {
      id,
      width: size.width,
      height: size.height,
      radius:
        size.kind === "round" ? size.radius : size.kind === "stadium" ? size.height / 2 : undefined,
      centered: size.centered,
      labels: size.side
        ? [
            {
              ...size.side,
              placement: vertical ? "OUTSIDE H_RIGHT V_CENTER" : "OUTSIDE V_TOP H_CENTER",
              gap: 6,
            },
          ]
        : [],
    };
  };
  const roots = [...(children.get(null) ?? [])].toSorted((a, b) => rank(a) - rank(b)).map(build);
  const labels = new Map(
    chart.edges
      .filter((edge) => edge.label)
      .map((edge) => [edge.id, wrapSmall(guardText(chart, edge), measure)]),
  );
  const edges: GraphEdge[] = chart.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    invisible: edge.stroke === "invisible",
    label: labels.has(edge.id) ? smallSize(labels.get(edge.id)!, measure) : undefined,
  }));
  // A symbol's question or name stands beside a free vertex, where ELK reserves room for it; when
  // the wires take every vertex, it finds a spot once they are drawn.
  for (const [id, crowded] of addVertexPorts(roots, edges, chart.direction, rank, {
    moveLabels: true,
  })) {
    const size = sizes.get(id)!;
    if (size.side) sizes.set(id, { ...size, later: crowded });
  }

  const run = async (elk: Record<string, string>) => {
    const placement = await layoutGraph(
      { direction: chart.direction, children: roots, edges },
      {
        layout: options.layout,
        elk,
        spacing: { layer: 40, node: 30, port: 18 },
      },
    );
    const scene = emptyScene();
    const depthOf = (id: string) => placement.ancestors.get(id)?.length ?? 0;
    const order = [...chart.subgraphs.keys()].toSorted((a, b) => depthOf(a) - depthOf(b));
    for (const id of order) {
      const box = placement.boxes.get(id);
      if (!box) continue;
      scene.shapes.push({
        id,
        kind: "rect",
        box,
        container: true,
        depth: depthOf(id),
        fill: "shade",
      });
      addTitleLines(scene, measure, titles.get(id)!, id, box.x + box.width / 2, box.y + 9);
    }
    for (const node of chart.nodes.values()) {
      const box = placement.boxes.get(node.id);
      if (box)
        drawNode(
          scene,
          measure,
          node.id,
          sizes.get(node.id)!,
          box,
          depthOf(node.id),
          node.label,
          placement.nodeLabels.get(node.id)?.[0],
        );
    }
    const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
    const guards = new Set(
      chart.edges
        .filter((edge) => isDecision(chart, edge.source) && labels.has(edge.id))
        .map((edge) => edge.id),
    );
    for (const edge of chart.edges) {
      if (edge.stroke === "invisible") continue;
      addWire(
        scene,
        placement,
        {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          dashed: edge.stroke === "dotted",
          thick: edge.stroke === "thick",
          startMarker: edge.start && MARKERS[edge.start],
          endMarker: edge.end && MARKERS[edge.end],
          label: guards.has(edge.id) ? undefined : labels.get(edge.id),
        },
        shapes,
        measure,
      );
    }
    spreadVertices(scene);
    attachEnds(scene);
    straightenScene(scene);
    attachEnds(scene);
    hugLabels(scene);
    // Guards next to their edge where it leaves the decision; the question beside the diamond.
    for (const id of guards) placeGuardLabel(scene, measure, id, labels.get(id)!);
    for (const node of chart.nodes.values()) {
      const size = sizes.get(node.id)!,
        shape = scene.shapes.find((item) => item.id === node.id),
        text = size.question ?? node.label;
      if (size.side && size.later && text && shape)
        placeBeside(scene, measure, node.id, shape.box, text);
    }

    dodgeTitles(scene, measure);
    finishBounds(scene, measure, chart.title);
    return scene;
  };
  return bestScene(run, FLOW_STRATEGIES, 150);
}
