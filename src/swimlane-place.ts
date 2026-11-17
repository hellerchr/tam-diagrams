/** Swimlane activities, first stage: the lanes, rows and items sized and placed, and the sides where wires leave them. */

import type { Box, Point } from "./scene.ts";
import type { Flowchart, FlowEdge, FlowNode } from "./uml-activity.ts";
import { FONT, LINE, type Measure, wrap } from "./text.ts";
import {
  degrees,
  MARKERS,
  nodeBox,
  type NodeBox,
  splitDecisions,
  splitFinals,
} from "./uml-activity-layout.ts";
import { reversePostorder } from "./uml.ts";
import { smallSize, wrapSmall } from "./labels.ts";
import { MARKER_LENGTH } from "./markers.ts";

/**
 * Swimlane activity diagrams (`swimlane-beta`): one lane per top-level subgraph, as the TAM flyer
 * draws agents' activities. Nodes sit in a grid of rows (the flow) and lanes (the agents); the flow
 * runs down in TB and right in LR. Edges are routed orthogonally on a sparse grid between the
 * nodes with a shortest-path search that penalizes bends and crossings and never overlaps a wire.
 * The layout is computed in a top-to-bottom frame and transposed for LR.
 */

export const LANE_PAD = 26,
  NODE_GAP = 30,
  ROW_GAP = 46,
  STUB = 12,
  CLEAR = 7,
  BEND = 30,
  CROSS = 50;

export type Side = "top" | "bottom" | "left" | "right";

/** Where every lane, row and item of a swimlane activity sits, and how wires leave the items. */
export interface SwimlanePlacement {
  bands: number[];
  bottom: number;
  boxOf: (item: Item) => Box;
  chart: Flowchart;
  footprint: (item: Item) => Box[];
  forward: (edge: FlowEdge) => boolean;
  gaps: number[];
  header: number;
  items: Map<string, Item>;
  labelBox: (item: Item, side: { width: number; height: number }) => Box;
  laneWidths: number[];
  laneX: number[];
  lanes: { id: string; label: string }[];
  portPoints: Map<string, [Point, Point]>;
  rowHeights: number[];
  rowY: number[];
  rows: number;
  sides: Map<string, [Side, Side]>;
  stub: (point: Point, side: Side, extra?: number) => Point;
  stubLength: Map<string, number>;
  titles: string[][];
  vertical: boolean;
  visible: FlowEdge[];
}

/** The routed wires of a swimlane activity and their labels, in the layout's own orientation (`flip` turns it). */
export interface SwimlaneRoutes {
  flip: (point: Point) => Point;
  flipBox: (box: Box) => Box;
  labelBoxes: Map<string, Box>;
  labelText: Map<string, string>;
  routes: Map<string, Point[]>;
}

/** A lane of the frame: the id of its subgraph and its name; the last lane without a name holds the nodes outside every subgraph. */
interface Lane {
  id: string;
  label: string;
}

/** What placing a chart works from: its lanes, its nodes as items, their rows and cells, and the room between rows. */
interface Frame {
  chart: Flowchart;
  vertical: boolean;
  measure: Measure;
  lanes: Lane[];
  items: Map<string, Item>;
  visible: FlowEdge[];
  forward: (edge: FlowEdge) => boolean;
  rows: number;
  cells: Map<string, Item[]>;
  titles: string[][];
  labelRoom: number[];
  gaps: number[];
  header: number;
}

/** Where a placement puts the lanes and rows: their widths and heights, where each starts, and the frame's bottom. */
interface Grid {
  laneWidths: number[];
  laneX: number[];
  rowHeights: number[];
  rowY: number[];
  bottom: number;
}

/** Sizes the lanes, rows and items and places them, then picks the sides and stubs where wires leave. */
export function placeSwimlanes(
  original: Flowchart,
  measure: Measure,
  widths: ReadonlyMap<string, number> = new Map(),
): SwimlanePlacement {
  const chart = splitDecisions(splitFinals(original));
  const frame = frameOf(chart, measure);
  const { vertical, items, lanes, visible, forward, rows, titles } = frame;
  const bands = bandsOf(frame);
  frame.gaps = gapsOf(frame, bands);

  // Ports: forward edges leave at the bottom and enter at the top; edges back up the flow use a side.
  // They are chosen on a first placement, which the side labels then follow.
  place(frame, widths);
  const sides = sidesOf(frame);
  for (const item of items.values()) if (isSymbol(item)) spreadVertices(frame, sides, item);
  for (const item of items.values()) pickLabelSide(frame, sides, item);
  const grid = place(frame, widths);
  const portPoints = new Map<string, [Point, Point]>();
  const stubLength = new Map<string, number>();
  for (const item of items.values())
    for (const side of ["top", "bottom", "left", "right"] as Side[])
      placePorts(frame, sides, item, side, { portPoints, stubLength });
  return {
    bands,
    bottom: grid.bottom,
    boxOf,
    chart,
    footprint: (item) => footprint(vertical, item),
    forward,
    gaps: frame.gaps,
    header: frame.header,
    items,
    labelBox: (item, side) => labelBox(vertical, item, side),
    laneWidths: grid.laneWidths,
    laneX: grid.laneX,
    lanes,
    portPoints,
    rowHeights: grid.rowHeights,
    rowY: grid.rowY,
    rows,
    sides,
    stub,
    stubLength,
    titles,
    vertical,
    visible,
  };
}

/** The frame of a chart: its lanes, its nodes as items in their rows and cells, and the room the lanes' names and labels take. */
function frameOf(chart: Flowchart, measure: Measure): Frame {
  const vertical = chart.direction === "TB" || chart.direction === "BT";
  const lanes = lanesOf(chart);
  // Frame sizes: in LR the frame is the drawing turned by 90 degrees.
  const items = itemsOf(chart, lanes, vertical, measure);
  const visible = chart.edges.filter(
    (edge) => edge.stroke !== "invisible" && edge.source !== edge.target,
  );
  const rank = ranksOf(chart, items);
  const forward = (edge: FlowEdge) => rank.get(edge.source)! < rank.get(edge.target)!;
  const byRank = [...items.keys()].toSorted((a, b) => rank.get(a)! - rank.get(b)!);
  assignRows(chart, items, byRank, forward);
  const frame: Frame = {
    chart,
    vertical,
    measure,
    lanes,
    items,
    visible,
    forward,
    rows: Math.max(0, ...[...items.values()].map((item) => item.row)) + 1,
    cells: cellsOf(items, byRank),
    titles: lanes.map((lane) =>
      lane.label ? wrap(lane.label, vertical ? 220 : 160, FONT, 600, measure) : [],
    ),
    labelRoom: lanes.map((_, index) => labelRoomOf(items, visible, vertical, measure, index)),
    gaps: [],
    header: 0,
  };
  frame.header = headerOf(frame);
  return frame;
}

/** Lanes in source order; nodes outside every subgraph go to a last lane without a name. */
function lanesOf(chart: Flowchart): Lane[] {
  const lanes = [...chart.subgraphs.values()]
    .filter((subgraph) => !subgraph.parent)
    .map((subgraph) => ({ id: subgraph.id, label: subgraph.label }));
  if ([...chart.nodes.values()].some((node) => !node.parent) || !lanes.length)
    lanes.push({ id: "", label: "" });
  return lanes;
}

/** The chart's nodes as items in the frame, each in its lane, with its size and side label. */
function itemsOf(chart: Flowchart, lanes: Lane[], vertical: boolean, measure: Measure) {
  const degree = degrees(chart.edges);
  return new Map<string, Item>(
    [...chart.nodes.values()].map((node) => {
      const lane = Math.max(
        0,
        lanes.findIndex((lane) => lane.id === (node.parent ?? "")),
      );
      return [
        node.id,
        itemOf(node, sizeOf(node, degree(node.id), vertical, measure), lane, vertical),
      ];
    }),
  );
}

/** A node's box; a symbol whose wires take all four vertices has its name or question in a corner (see `corner`). */
function sizeOf(
  node: FlowNode,
  ends: { in: number; out: number },
  vertical: boolean,
  measure: Measure,
): NodeBox {
  const plain = nodeBox(node, ends, vertical, measure);
  return plain.centered && plain.side && ends.in + ends.out >= 4
    ? { ...plain, later: true }
    : plain;
}

/** A node as an item of the frame, in its lane, before it has a row and a place. */
function itemOf(node: FlowNode, size: NodeBox, lane: number, vertical: boolean): Item {
  return {
    id: node.id,
    size,
    lane,
    row: 0,
    w: vertical ? size.width : size.height,
    h: vertical ? size.height : size.width,
    x: 0,
    y: 0,
    side: size.side && node.label ? size.side : undefined,
    labelSide: vertical ? "right" : "left",
  };
}

/**
 * How far a node's side label reaches left and right of it across the flow: right of the node in
 * TB (frame right), above it in LR (frame left), unless the symbol's wires take that vertex (see
 * the ports). A question whose diamond takes a wire at every vertex stands in the free corner
 * above right of it instead.
 */
function extent(vertical: boolean, item: Item) {
  if (!item.side) return { left: 0, right: 0 };
  if (item.size.later)
    return vertical
      ? { left: 0, right: Math.max(0, 8 + item.side.width - item.w / 2) }
      : { left: item.side.height + 1, right: 0 };
  const room = (vertical ? item.side.width : item.side.height) + 6;
  return item.labelSide === "left" ? { left: room, right: 0 } : { left: 0, right: room };
}

/** How far a node with its side label reaches left of its middle, across the flow. */
const leftOf = (vertical: boolean, item: Item) => item.w / 2 + extent(vertical, item).left;

/** How far a node with its side label reaches right of its middle, across the flow. */
const rightOf = (vertical: boolean, item: Item) => item.w / 2 + extent(vertical, item).right;

/** Each node's place in a depth-first order of the edges from the start nodes. */
function ranksOf(chart: Flowchart, items: Map<string, Item>): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  for (const edge of chart.edges)
    if (edge.source !== edge.target)
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const incoming = new Set(chart.edges.map((edge) => edge.target));
  const starts = [...items.keys()]
    .filter((id) => chart.nodes.get(id)!.shape === "initial")
    .concat(
      [...items.keys()].filter((id) => !incoming.has(id)),
      [...items.keys()],
    );
  return reversePostorder(starts, (id) => outgoing.get(id) ?? []);
}

/**
 * Rows: the longest path over the edges that go forward. Nodes nothing leads to then sit just
 * above the first node they lead to.
 */
function assignRows(
  chart: Flowchart,
  items: Map<string, Item>,
  byRank: string[],
  forward: (edge: FlowEdge) => boolean,
) {
  rowsDown(chart, items, byRank, forward);
  for (const id of byRank.toReversed()) {
    if (
      chart.edges.some((edge) => edge.target === id && forward(edge)) ||
      chart.nodes.get(id)!.shape === "initial"
    )
      continue;
    const item = items.get(id)!,
      succs = chart.edges
        .filter((edge) => edge.source === id && forward(edge))
        .map((edge) => items.get(edge.target)!.row);
    if (succs.length) item.row = Math.max(item.row, Math.min(...succs) - 1);
  }
}

/** Each node a row below the lowest of the nodes that lead forward to it. */
function rowsDown(
  chart: Flowchart,
  items: Map<string, Item>,
  byRank: string[],
  forward: (edge: FlowEdge) => boolean,
) {
  for (const id of byRank) {
    const preds = chart.edges.filter(
      (edge) => edge.target === id && edge.source !== id && forward(edge),
    );
    items.get(id)!.row = Math.max(0, ...preds.map((edge) => items.get(edge.source)!.row + 1));
  }
}

/** Nodes of one lane and row share the cell side by side, in flow order. */
function cellsOf(items: Map<string, Item>, byRank: string[]): Map<string, Item[]> {
  const cells = new Map<string, Item[]>();
  for (const id of byRank) {
    const item = items.get(id)!,
      key = `${item.row}:${item.lane}`;
    cells.set(key, [...(cells.get(key) ?? []), item]);
  }
  return cells;
}

/** The width of a lane's name, the widest of its lines. */
const titleWidth = (frame: Frame, index: number) =>
  Math.max(0, ...frame.titles[index].map((line) => frame.measure(line, FONT, 600)));

/** The room the lanes' names take: above the lanes in TB, left of them in LR. */
const headerOf = (frame: Frame) =>
  frame.vertical
    ? Math.max(...frame.titles.map((lines) => lines.length)) * LINE + 18
    : Math.max(...frame.lanes.map((_, index) => titleWidth(frame, index))) + 28;

/** The size of a wire's label, wrapped as wires' labels are. */
const edgeLabelSize = (edge: FlowEdge, measure: Measure) =>
  smallSize(wrapSmall(edge.label!, measure, 160), measure);

/** The room a lane keeps for the labels beside the wires leaving its nodes. */
function labelRoomOf(
  items: Map<string, Item>,
  visible: FlowEdge[],
  vertical: boolean,
  measure: Measure,
  lane: number,
) {
  return Math.max(
    0,
    ...visible
      .filter((edge) => edge.label && items.get(edge.source)!.lane === lane)
      .map((edge) => {
        const size = edgeLabelSize(edge, measure);
        return (vertical ? size.width : size.height) + 12;
      }),
  );
}

/** The wires that leave a row, down to a later one or back up from it. */
const leaving = (frame: Frame, row: number) =>
  frame.visible.filter(
    (edge) =>
      Math.min(frame.items.get(edge.source)!.row, frame.items.get(edge.target)!.row) === row,
  );

/**
 * Each gap between rows gets room for the wires that turn in it and, below their tracks, a band
 * for the labels of wires leaving the row above, which the wires cross only on their way down.
 */
const bandsOf = (frame: Frame) =>
  Array.from({ length: frame.rows }, (_, row) => {
    const labels = Math.max(
      0,
      ...leaving(frame, row)
        .filter((edge) => edge.label)
        .map((edge) => {
          const size = edgeLabelSize(edge, frame.measure);
          return frame.vertical ? size.height : size.width;
        }),
    );
    return labels ? labels + 8 : 0;
  });

/** Whether a wire turns in the gap below its row: to another lane, or back up the flow. */
const turns = (frame: Frame, edge: FlowEdge) => {
  const source = frame.items.get(edge.source)!,
    target = frame.items.get(edge.target)!;
  return source.lane !== target.lane || target.row <= source.row;
};

/** The gap below each row: room for the wires that turn in it, and its band of labels. */
const gapsOf = (frame: Frame, bands: number[]) =>
  Array.from({ length: frame.rows }, (_, row) => {
    const turning = leaving(frame, row).filter((edge) => turns(frame, edge)).length;
    return Math.max(ROW_GAP, 30 + 9 * turning + bands[row]) + bands[row];
  });

/** How wide a cell's nodes stand side by side, with their side labels. */
const cellWidth = (vertical: boolean, list: Item[]) =>
  list.reduce(
    (sum, item) => sum + item.w + extent(vertical, item).left + extent(vertical, item).right,
    0,
  ) +
  (list.length - 1) * NODE_GAP;

/**
 * How far a node reaches along the flow: with a side label it needs room for that too (in LR the
 * label stands above or below the node); a question in the corner above right of its diamond
 * reaches beyond the diamond's half.
 */
function along(vertical: boolean, item: Item) {
  if (!item.side) return item.h;
  if (item.size.later)
    return Math.max(
      item.h,
      2 * (vertical ? item.w / 2 + 1 + item.side.height : 8 + item.side.width),
    );
  return vertical ? item.h : Math.max(item.h, item.side.width + 4);
}

/**
 * A lane's width: the widest cell, room for labels beside wires, and the lane's name. A width the
 * source gives a lane counts down to what these need, not to the least width of a lane.
 */
function laneWidth(frame: Frame, widths: ReadonlyMap<string, number>, lane: Lane, index: number) {
  const { vertical, titles, labelRoom } = frame;
  const needs = Math.max(
      vertical ? titleWidth(frame, index) + 24 : titles[index].length * LINE + 24,
      ...[...frame.cells]
        .filter(([key]) => Number(key.split(":")[1]) === index)
        .map(([, list]) => cellWidth(vertical, list) + 2 * LANE_PAD + labelRoom[index]),
    ),
    given = lane.id ? widths.get(lane.id) : undefined;
  return Math.ceil(given === undefined ? Math.max(needs, 120) : Math.max(needs, given));
}

/** Where each of a run of sizes starts, laid one after the other from `start` with `gap(index)` after each. */
function starts(sizes: number[], start: number, gap: (index: number) => number): number[] {
  const at: number[] = [];
  sizes.reduce((x, size, index) => {
    at[index] = x;
    return x + size + gap(index);
  }, start);
  return at;
}

/** Lane widths, rows and node positions for the side labels' current sides. */
function place(frame: Frame, widths: ReadonlyMap<string, number>): Grid {
  const { items, rows, vertical } = frame;
  // Bars widened by an earlier placement start over.
  for (const item of items.values()) item.w = vertical ? item.size.width : item.size.height;
  const laneWidths = frame.lanes.map((lane, index) => laneWidth(frame, widths, lane, index));
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(
      20,
      ...[...items.values()]
        .filter((item) => item.row === row)
        .map((item) => along(vertical, item)),
    ),
  );
  const rowY = starts(rowHeights, frame.header + 30, (row) => frame.gaps[row]);
  const grid: Grid = {
    laneWidths,
    laneX: starts(laneWidths, 0, () => 0),
    rowHeights,
    rowY,
    bottom: rowY[rows - 1] + rowHeights[rows - 1] + Math.max(30, frame.gaps[rows - 1] - 16),
  };
  for (let row = 0; row < rows; row++)
    for (const [key, list] of frame.cells) {
      const [cellRow, lane] = key.split(":").map(Number);
      if (cellRow === row) placeCell(frame, grid, list, row, lane);
    }
  for (const item of items.values()) if (item.size.kind === "bar") widenBar(frame, grid, item);
  return grid;
}

/** The center line of a lane, clear of the room it keeps for labels. */
const laneCenter = (frame: Frame, grid: Grid, lane: number) =>
  grid.laneX[lane] + (grid.laneWidths[lane] - frame.labelRoom[lane]) / 2;

/** Where a node would stand across the flow: below its predecessors in the lane (straight wires), else on the lane's center line. */
function wantedX(frame: Frame, grid: Grid, item: Item, row: number, lane: number) {
  const preds = frame.visible
    .filter((edge) => edge.target === item.id && frame.forward(edge))
    .map((edge) => frame.items.get(edge.source)!)
    .filter((pred) => pred.lane === lane && pred.row < row);
  return preds.length
    ? preds.reduce((sum, pred) => sum + pred.x, 0) / preds.length
    : laneCenter(frame, grid, lane);
}

/**
 * Row by row, each node goes where its predecessors in the lane are (straight wires), else on the
 * lane's center line; nodes of one cell keep their gap and stay inside the lane.
 */
function placeCell(frame: Frame, grid: Grid, list: Item[], row: number, lane: number) {
  const wanted = new Map(list.map((item) => [item.id, wantedX(frame, grid, item, row, lane)]));
  const declared = (id: string) => frame.chart.order.indexOf(id);
  if (list.length > 1)
    list.sort((a, b) => wanted.get(a.id)! - wanted.get(b.id)! || declared(a.id) - declared(b.id));
  const low = grid.laneX[lane] + LANE_PAD,
    high = grid.laneX[lane] + grid.laneWidths[lane] - frame.labelRoom[lane] - LANE_PAD;
  const xs =
    list.length === 1
      ? [aloneX(frame, grid, list[0], wanted.get(list[0].id)!, lane, [low, high])]
      : packed(
          frame.vertical,
          list,
          list.map((item) => wanted.get(item.id)!),
          low,
          high,
        );
  // On the routing grid's half pixels, so wires leave their ports straight.
  list.forEach((item, index) => {
    item.x = round(xs[index]);
    item.y = round(grid.rowY[row] + grid.rowHeights[row] / 2);
  });
}

/** Where the only node of a cell stands: where it wants to be if it fits in the lane there, else on the center line. */
function aloneX(
  frame: Frame,
  grid: Grid,
  item: Item,
  wanted: number,
  lane: number,
  [low, high]: [number, number],
) {
  const center = laneCenter(frame, grid, lane);
  return Math.abs(wanted - center) > 0.5 &&
    wanted - leftOf(frame.vertical, item) >= low &&
    wanted + rightOf(frame.vertical, item) <= high
    ? wanted
    : center;
}

/** Nodes of one cell that overlap, held together at their offsets from the first. */
interface Block {
  members: number[];
  offsets: number[];
  width: number;
  wanted: number[];
}

/** Where a block stands: the mean of where its members want it. */
const blockAt = (block: Block) =>
  block.wanted.reduce((sum, value, k) => sum + value - block.offsets[k], 0) / block.members.length;

/**
 * The nodes of a cell side by side: overlapping nodes form blocks centered on what their members
 * want, merged until none overlap; then all of them pushed inside the lane.
 */
function packed(vertical: boolean, list: Item[], xs: number[], low: number, high: number) {
  const left = (item: Item) => leftOf(vertical, item);
  const blocks: Block[] = list.map((item, index) => ({
    members: [index],
    offsets: [0],
    width: left(item) + rightOf(vertical, item),
    wanted: [xs[index]],
  }));
  while (mergeOnce(blocks, list, left));
  for (const block of blocks)
    block.members.forEach((member, k) => {
      xs[member] = blockAt(block) + block.offsets[k];
    });
  const overRight = xs.at(-1)! + rightOf(vertical, list.at(-1)!) - high,
    overLeft = low - (xs[0] - left(list[0]));
  const shift = overRight > 0 ? -overRight : overLeft > 0 ? overLeft : 0;
  return shift ? xs.map((x) => x + shift) : xs;
}

/** Merges the first two neighbouring blocks that overlap; returns whether it found two. */
function mergeOnce(blocks: Block[], list: Item[], left: (item: Item) => number): boolean {
  for (let k = 1; k < blocks.length; k++) {
    const a = blocks[k - 1],
      b = blocks[k];
    const aEnd = blockAt(a) - left(list[a.members[0]]) + a.width,
      bStart = blockAt(b) - left(list[b.members[0]]);
    if (aEnd + NODE_GAP <= bStart) continue;
    const shift = a.width + NODE_GAP + left(list[b.members[0]]) - left(list[a.members[0]]);
    a.members.push(...b.members);
    a.offsets.push(...b.offsets.map((offset) => offset + shift));
    a.wanted.push(...b.wanted);
    a.width += NODE_GAP + b.width;
    blocks.splice(k, 1);
    return true;
  }
  return false;
}

/** A fork or join bar reaches across the wires that meet it, within its lane, where no node of its row is in the way. */
function widenBar(frame: Frame, grid: Grid, item: Item) {
  const { items } = frame;
  const neighbours = frame.visible
    .filter((edge) => edge.source === item.id || edge.target === item.id)
    .map((edge) => items.get(edge.source === item.id ? edge.target : edge.source)!)
    .filter((other) => other.lane === item.lane);
  if (neighbours.length < 2) return;
  const lo = Math.max(
    grid.laneX[item.lane] + 10,
    Math.min(item.x - item.w / 2, ...neighbours.map((other) => other.x - 14)),
  );
  const hi = Math.min(
    grid.laneX[item.lane] + grid.laneWidths[item.lane] - 10,
    Math.max(item.x + item.w / 2, ...neighbours.map((other) => other.x + 14)),
  );
  const clash = [...items.values()].some(
    (other) =>
      other !== item &&
      other.row === item.row &&
      other.x + other.w / 2 > lo - 10 &&
      other.x - other.w / 2 < hi + 10,
  );
  if (clash) return;
  item.x = round((lo + hi) / 2);
  item.w = hi - lo;
}

/** A node's box in the frame. */
const boxOf = (item: Item): Box => ({
  x: item.x - item.w / 2,
  y: item.y - item.h / 2,
  width: item.w,
  height: item.h,
});

/** The corner above right of a diamond, in the frame, for a question that finds every vertex taken. */
function corner(vertical: boolean, item: Item, side: { width: number; height: number }): Box {
  const drawn = {
    x: (vertical ? item.x : item.y) + 8,
    y: (vertical ? item.y : item.x) - item.w / 2 - 1 - side.height,
    ...side,
  };
  return vertical ? drawn : { x: drawn.y, y: drawn.x, width: drawn.height, height: drawn.width };
}

/** A side label's box in the frame: beside the node on its side, else in the corner (in LR the label stands across the flow). */
function labelBox(vertical: boolean, item: Item, side: { width: number; height: number }): Box {
  if (item.size.later) return corner(vertical, item, side);
  const box = boxOf(item),
    width = vertical ? side.width : side.height,
    height = vertical ? side.height : side.width;
  return {
    x: item.labelSide === "left" ? box.x - 6 - width : box.x + box.width + 6,
    y: item.y - height / 2,
    width,
    height,
  };
}

/** The node and its side label, as separate boxes. */
const footprint = (vertical: boolean, item: Item): Box[] =>
  item.side ? [boxOf(item), labelBox(vertical, item, item.side)] : [boxOf(item)];

/** The sides a wire leaves its source and enters its target by: down the flow, back up it on a side, or across a row. */
function sidePair(source: Item, target: Item): [Side, Side] {
  if (target.row > source.row) return ["bottom", "top"];
  if (target.row < source.row)
    return target.x < source.x - 1 ? ["left", "left"] : ["right", "right"];
  return target.x > source.x ? ["right", "left"] : ["left", "right"];
}

/** The sides every drawn wire leaves and enters by, on the first placement. */
const sidesOf = (frame: Frame) =>
  new Map<string, [Side, Side]>(
    frame.visible.map((edge) => [
      edge.id,
      sidePair(frame.items.get(edge.source)!, frame.items.get(edge.target)!),
    ]),
  );

/** The vertices (sides) the wires take at a node. */
const taken = (frame: Frame, sides: Map<string, [Side, Side]>, item: Item) =>
  new Set<Side>(
    frame.visible.flatMap((edge) => {
      const pair = sides.get(edge.id)!;
      return [
        ...(edge.source === item.id ? [pair[0]] : []),
        ...(edge.target === item.id ? [pair[1]] : []),
      ];
    }),
  );

/** Decisions, merges and circles: symbols whose wires meet them at their vertices. */
const isSymbol = (item: Item) => item.size.kind === "diamond" || !!item.size.centered;

/**
 * Decisions, merges and circles take extra wires at their side vertices: the wire best in line
 * keeps the bottom (or top), the others turn to the side facing their other end, the last one to
 * the vertex opposite.
 */
function spreadVertices(frame: Frame, sides: Map<string, [Side, Side]>, item: Item) {
  for (const [side, end] of [
    ["bottom", 0],
    ["top", 1],
  ] as const) {
    const list = frame.visible.filter(
      (edge) =>
        (end === 0 ? edge.source : edge.target) === item.id && sides.get(edge.id)![end] === side,
    );
    if (list.length < 2) continue;
    const other = (edge: FlowEdge) => frame.items.get(end === 0 ? edge.target : edge.source)!;
    list.sort((a, b) => Math.abs(other(a).x - item.x) - Math.abs(other(b).x - item.x));
    const used = taken(frame, sides, item);
    for (const edge of list.slice(1)) {
      const want = freeVertex(used, other(edge).x < item.x ? "left" : "right", side);
      if (!want) continue;
      used.add(want);
      sides.get(edge.id)![end] = want;
    }
  }
}

/** The side facing the other end, else the opposite one, else the far vertex: one wire per vertex. */
function freeVertex(used: Set<Side>, facing: Side, side: Side): Side | undefined {
  const opposite: Side = facing === "left" ? "right" : "left";
  return ([facing, opposite, side === "bottom" ? "top" : "bottom"] as Side[]).find(
    (vertex) => !used.has(vertex),
  );
}

/**
 * A symbol's question or name takes a side vertex the wires left free, right in TB (above in LR)
 * if it can, else in the corner; the final placement reserves its room on that side.
 */
function pickLabelSide(frame: Frame, sides: Map<string, [Side, Side]>, item: Item) {
  if (!item.side || !isSymbol(item)) return;
  const used = taken(frame, sides, item),
    free = ([frame.vertical ? "right" : "left", frame.vertical ? "left" : "right"] as Side[]).find(
      (side) => !used.has(side),
    );
  if (free) item.labelSide = free;
  item.size = { ...item.size, later: !free };
}

/** A wire's end at a node: which end of the wire it is, and the node at its other end. */
interface PortEnd {
  edge: FlowEdge;
  end: 0 | 1;
  other: Item;
}

/** The ends of the wires on a side of a node. */
function endsOn(frame: Frame, sides: Map<string, [Side, Side]>, item: Item, side: Side) {
  return frame.visible.flatMap((edge) => {
    const pair = sides.get(edge.id)!,
      result: PortEnd[] = [];
    if (edge.source === item.id && pair[0] === side)
      result.push({ edge, end: 0, other: frame.items.get(edge.target)! });
    if (edge.target === item.id && pair[1] === side)
      result.push({ edge, end: 1, other: frame.items.get(edge.source)! });
    return result;
  });
}

/** Nodes whose wires meet them at a point of their outline: symbols, and the start and end circles. */
const pointed = (item: Item) =>
  isSymbol(item) || item.size.kind === "initial" || item.size.kind === "final";

/**
 * Each end where its wire can run straight (facing the other end) if the side allows, else spread
 * evenly; a symbol's only end at the middle.
 */
function wantedOffsets(
  item: Item,
  list: PortEnd[],
  across: boolean,
  spacing: number,
  limit: number,
) {
  const symbol = pointed(item),
    reach = limit - (item.size.kind === "bar" ? 0 : 8);
  return list.map(({ other }, index) => {
    if (list.length === 1 && symbol) return 0;
    const wanted = across ? other.x - item.x : other.y - item.y;
    if (Math.abs(wanted) <= reach && !symbol) return wanted;
    return list.length === 1 ? 0 : (index - (list.length - 1) / 2) * spacing;
  });
}

/** Pushes offsets apart to the spacing, inside the side: three passes over them. */
function pushApart(offsets: number[], spacing: number, limit: number) {
  for (let pass = 0; pass < 3; pass++) {
    for (let index = 1; index < offsets.length; index++)
      offsets[index] = Math.max(offsets[index], offsets[index - 1] + spacing);
    if (offsets.at(-1)! - limit > 0)
      for (let index = offsets.length - 1; index >= 0; index--)
        offsets[index] = Math.min(
          offsets[index],
          index === offsets.length - 1 ? limit : offsets[index + 1] - spacing,
        );
    offsets.forEach((value, index) => {
      offsets[index] = Math.max(-limit, Math.min(limit, value));
    });
  }
}

/** The point on a side of a node `offset` from its middle. */
function portPoint(item: Item, side: Side, offset: number): Point {
  const box = boxOf(item);
  switch (side) {
    case "top":
      return { x: round(item.x + offset), y: box.y };
    case "bottom":
      return { x: round(item.x + offset), y: box.y + box.height };
    case "left":
      return { x: box.x, y: round(item.y + offset) };
    case "right":
      return { x: box.x + box.width, y: round(item.y + offset) };
  }
}

/** Where wires end on a node and how long a straight stub each keeps. */
interface Ports {
  portPoints: Map<string, [Point, Point]>;
  stubLength: Map<string, number>;
}

/** Places the ends of the wires on a side of a node, and the length of their stubs. */
function placePorts(
  frame: Frame,
  sides: Map<string, [Side, Side]>,
  item: Item,
  side: Side,
  ports: Ports,
) {
  const list = endsOn(frame, sides, item, side);
  if (!list.length) return;
  const across = side === "top" || side === "bottom";
  list.sort((a, b) => (across ? a.other.x - b.other.x : a.other.y - b.other.y));
  const box = boxOf(item),
    length = across ? box.width : box.height,
    spacing = Math.min(18, (length - 8) / list.length),
    limit = (length - 8) / 2;
  const offsets = wantedOffsets(item, list, across, spacing, limit);
  pushApart(offsets, spacing, limit);
  list.forEach(({ edge, end }, index) => {
    const point = portPoint(item, side, offsets[index]);
    const pair = ports.portPoints.get(edge.id) ?? [point, point];
    pair[end] = point;
    ports.portPoints.set(edge.id, pair);
    ports.stubLength.set(`${edge.id}:${end}`, stubOf(edge, end, index, list.length));
  });
}

/**
 * The stub of a wire's end: the middle ports get the shortest stubs, the outer ones longer, so the
 * fan stays untangled. An end with a marker keeps a straight stretch as long as the marker before
 * the wire may turn.
 */
function stubOf(edge: FlowEdge, end: 0 | 1, index: number, count: number) {
  const marker = end === 0 ? edge.start : edge.end;
  return (
    (count > 1 ? Math.round(Math.abs(index - (count - 1) / 2)) * 7 : 0) +
    (marker ? MARKER_LENGTH[MARKERS[marker]] : 0)
  );
}

/** The way out of each side of a node. */
const OUTWARD: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Ports on one side get stubs of different lengths, so the wires leaving them can part without crossing. */
function stub(point: Point, side: Side, extra = 0): Point {
  const length = STUB + extra,
    { x, y } = OUTWARD[side];
  return { x: point.x + x * length, y: point.y + y * length };
}

/** A node in the frame; `labelSide` is the side of the frame its side label stands on. */
interface Item {
  id: string;
  size: NodeBox;
  lane: number;
  row: number;
  w: number;
  h: number;
  x: number;
  y: number;
  side?: { width: number; height: number };
  labelSide: Side;
}

/** The nearest half pixel, the routing grid's resolution. */
export const round = (value: number) => Math.round(value * 2) / 2;
