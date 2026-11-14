/** Swimlane activities, first stage: the lanes, rows and items sized and placed, and the sides where wires leave them. */

import type { Box, Point } from "./scene.ts";
import type { Flowchart, FlowEdge } from "./uml-activity.ts";
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

/** Sizes the lanes, rows and items and places them, then picks the sides and stubs where wires leave. */
export function placeSwimlanes(original: Flowchart, measure: Measure): SwimlanePlacement {
  const chart = splitDecisions(splitFinals(original));
  const vertical = chart.direction === "TB" || chart.direction === "BT";
  const degree = degrees(chart.edges);
  // Lanes in source order; nodes outside every subgraph go to a last lane without a name.
  const lanes = [...chart.subgraphs.values()]
    .filter((subgraph) => !subgraph.parent)
    .map((subgraph) => ({ id: subgraph.id, label: subgraph.label }));
  if ([...chart.nodes.values()].some((node) => !node.parent) || !lanes.length)
    lanes.push({ id: "", label: "" });
  const laneOf = (id: string) =>
    Math.max(
      0,
      lanes.findIndex((lane) => lane.id === (chart.nodes.get(id)!.parent ?? "")),
    );

  // Frame sizes: in LR the frame is the drawing turned by 90 degrees.
  const items = new Map<string, Item>();
  for (const node of chart.nodes.values()) {
    // A symbol whose wires take all four vertices has its name or question in a corner (see `corner`).
    const ends = degree(node.id),
      plain = nodeBox(node, ends, vertical, measure);
    const size =
      plain.centered && plain.side && ends.in + ends.out >= 4 ? { ...plain, later: true } : plain;
    const side = size.side && node.label ? size.side : undefined;
    items.set(node.id, {
      id: node.id,
      size,
      lane: laneOf(node.id),
      row: 0,
      w: vertical ? size.width : size.height,
      h: vertical ? size.height : size.width,
      x: 0,
      y: 0,
      side,
      labelSide: vertical ? "right" : "left",
    });
  }
  // Side labels: right of the node in TB (frame right), above it in LR (frame left), unless the
  // symbol's wires take that vertex (see the ports). A question whose diamond takes a wire at every
  // vertex stands in the free corner above right of it instead.
  const extent = (item: Item) => {
    if (!item.side) return { left: 0, right: 0 };
    if (item.size.later)
      return vertical
        ? { left: 0, right: Math.max(0, 8 + item.side.width - item.w / 2) }
        : { left: item.side.height + 1, right: 0 };
    const room = (vertical ? item.side.width : item.side.height) + 6;
    return item.labelSide === "left" ? { left: room, right: 0 } : { left: 0, right: room };
  };

  // Rows: longest path over the edges that go forward in a depth-first order from the start nodes.
  const visible = chart.edges.filter(
    (edge) => edge.stroke !== "invisible" && edge.source !== edge.target,
  );
  const rank = new Map<string, number>();
  {
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
    for (const [id, index] of reversePostorder(starts, (id) => outgoing.get(id) ?? []))
      rank.set(id, index);
  }
  const forward = (edge: FlowEdge) => rank.get(edge.source)! < rank.get(edge.target)!;
  const byRank = [...items.keys()].toSorted((a, b) => rank.get(a)! - rank.get(b)!);
  for (const id of byRank) {
    const preds = chart.edges.filter(
      (edge) => edge.target === id && edge.source !== id && forward(edge),
    );
    items.get(id)!.row = Math.max(0, ...preds.map((edge) => items.get(edge.source)!.row + 1));
  }
  // Nodes nothing leads to sit just above the first node they lead to.
  for (const id of byRank.toReversed()) {
    const item = items.get(id)!;
    if (
      chart.edges.some((edge) => edge.target === id && forward(edge)) ||
      chart.nodes.get(id)!.shape === "initial"
    )
      continue;
    const succs = chart.edges
      .filter((edge) => edge.source === id && forward(edge))
      .map((edge) => items.get(edge.target)!.row);
    if (succs.length) item.row = Math.max(item.row, Math.min(...succs) - 1);
  }
  // Nodes of one lane and row share the cell side by side, in flow order.
  const rows = Math.max(0, ...[...items.values()].map((item) => item.row)) + 1;
  const cells = new Map<string, Item[]>();
  for (const id of byRank) {
    const item = items.get(id)!,
      key = `${item.row}:${item.lane}`;
    cells.set(key, [...(cells.get(key) ?? []), item]);
  }

  const titles = lanes.map((lane) =>
    lane.label ? wrap(lane.label, vertical ? 220 : 160, FONT, 600, measure) : [],
  );
  const titleWidth = (index: number) =>
    Math.max(0, ...titles[index].map((line) => measure(line, FONT, 600)));
  const header = vertical
    ? Math.max(...titles.map((lines) => lines.length)) * LINE + 18
    : Math.max(...lanes.map((_, index) => titleWidth(index))) + 28;
  const labelRoom = lanes.map((_, index) =>
    Math.max(
      0,
      ...visible
        .filter((edge) => edge.label && items.get(edge.source)!.lane === index)
        .map((edge) => {
          const size = smallSize(wrapSmall(edge.label!, measure, 160), measure);
          return (vertical ? size.width : size.height) + 12;
        }),
    ),
  );
  // Each gap between rows gets room for the wires that turn in it and, below their tracks, a band
  // for the labels of wires leaving the row above, which the wires cross only on their way down.
  const leaving = (row: number) =>
    visible.filter(
      (edge) => Math.min(items.get(edge.source)!.row, items.get(edge.target)!.row) === row,
    );
  const bands = Array.from({ length: rows }, (_, row) => {
    const labels = Math.max(
      0,
      ...leaving(row)
        .filter((edge) => edge.label)
        .map((edge) => {
          const size = smallSize(wrapSmall(edge.label!, measure, 160), measure);
          return vertical ? size.height : size.width;
        }),
    );
    return labels ? labels + 8 : 0;
  });
  const gaps = Array.from({ length: rows }, (_, row) => {
    const turning = leaving(row).filter(
      (edge) =>
        items.get(edge.source)!.lane !== items.get(edge.target)!.lane ||
        items.get(edge.target)!.row <= items.get(edge.source)!.row,
    ).length;
    return Math.max(ROW_GAP, 30 + 9 * turning + bands[row]) + bands[row];
  });
  const cellWidth = (list: Item[]) =>
    list.reduce((sum, item) => sum + item.w + extent(item).left + extent(item).right, 0) +
    (list.length - 1) * NODE_GAP;
  // Along the flow a node with a side label needs room for it too (in LR the label stands above or
  // below the node); a question in the corner above right of its diamond reaches beyond the diamond's half.
  const along = (item: Item) =>
    !item.side
      ? item.h
      : item.size.later
        ? Math.max(item.h, 2 * (vertical ? item.w / 2 + 1 + item.side.height : 8 + item.side.width))
        : !vertical
          ? Math.max(item.h, item.side.width + 4)
          : item.h;
  const center = (lane: number) => laneX[lane] + (laneWidths[lane] - labelRoom[lane]) / 2;
  const declared = (id: string) => chart.order.indexOf(id);
  let laneWidths: number[] = [],
    laneX: number[] = [],
    rowHeights: number[] = [],
    rowY: number[] = [],
    bottom = 0;
  /** Lane widths, rows and node positions for the side labels' current sides. */
  function place() {
    // Bars widened by an earlier placement start over.
    for (const item of items.values()) item.w = vertical ? item.size.width : item.size.height;
    // Lane widths: the widest cell, room for labels beside wires, and the lane's name.
    laneWidths = lanes.map((_, index) =>
      Math.ceil(
        Math.max(
          vertical ? titleWidth(index) + 24 : titles[index].length * LINE + 24,
          120,
          ...[...cells]
            .filter(([key]) => Number(key.split(":")[1]) === index)
            .map(([, list]) => cellWidth(list) + 2 * LANE_PAD + labelRoom[index]),
        ),
      ),
    );
    laneX = [];
    laneWidths.reduce((x, width, index) => {
      laneX[index] = x;
      return x + width;
    }, 0);
    rowHeights = Array.from({ length: rows }, (_, row) =>
      Math.max(20, ...[...items.values()].filter((item) => item.row === row).map(along)),
    );
    rowY = [];
    rowHeights.reduce((y, height, row) => {
      rowY[row] = y;
      return y + height + gaps[row];
    }, header + 30);
    bottom = rowY[rows - 1] + rowHeights[rows - 1] + Math.max(30, gaps[rows - 1] - 16);
    // Row by row, each node goes where its predecessors in the lane are (straight wires), else on the
    // lane's center line; nodes of one cell keep their gap and stay inside the lane.
    for (let row = 0; row < rows; row++) {
      for (const [key, list] of cells) {
        const [cellRow, lane] = key.split(":").map(Number);
        if (cellRow !== row) continue;
        const wanted = new Map(
          list.map((item) => {
            const preds = visible
              .filter((edge) => edge.target === item.id && forward(edge))
              .map((edge) => items.get(edge.source)!)
              .filter((pred) => pred.lane === lane && pred.row < row);
            return [
              item.id,
              preds.length
                ? preds.reduce((sum, pred) => sum + pred.x, 0) / preds.length
                : center(lane),
            ];
          }),
        );
        if (list.length > 1)
          list.sort(
            (a, b) => wanted.get(a.id)! - wanted.get(b.id)! || declared(a.id) - declared(b.id),
          );
        const low = laneX[lane] + LANE_PAD,
          high = laneX[lane] + laneWidths[lane] - labelRoom[lane] - LANE_PAD;
        const left = (item: Item) => item.w / 2 + extent(item).left,
          right = (item: Item) => item.w / 2 + extent(item).right;
        const xs = list.map((item) =>
          list.length === 1 &&
          Math.abs(wanted.get(item.id)! - center(lane)) > 0.5 &&
          wanted.get(item.id)! - left(item) >= low &&
          wanted.get(item.id)! + right(item) <= high
            ? wanted.get(item.id)!
            : list.length === 1
              ? center(lane)
              : wanted.get(item.id)!,
        );
        if (list.length > 1) {
          // Overlapping nodes form blocks centered on what their members want, merged until none overlap.
          const blocks = list.map((item, index) => ({
            members: [index],
            offsets: [0],
            width: left(item) + right(item),
            wanted: [xs[index]],
          }));
          const position = (block: (typeof blocks)[number]) =>
            block.wanted.reduce((sum, value, k) => sum + value - block.offsets[k], 0) /
            block.members.length;
          for (let merged = true; merged;) {
            merged = false;
            for (let k = 1; k < blocks.length; k++) {
              const a = blocks[k - 1],
                b = blocks[k];
              const aEnd = position(a) - left(list[a.members[0]]) + a.width,
                bStart = position(b) - left(list[b.members[0]]);
              if (aEnd + NODE_GAP <= bStart) continue;
              const shift =
                a.width + NODE_GAP + left(list[b.members[0]]) - left(list[a.members[0]]);
              a.members.push(...b.members);
              a.offsets.push(...b.offsets.map((offset) => offset + shift));
              a.wanted.push(...b.wanted);
              a.width += NODE_GAP + b.width;
              blocks.splice(k, 1);
              merged = true;
              break;
            }
          }
          for (const block of blocks)
            block.members.forEach((member, k) => {
              xs[member] = position(block) + block.offsets[k];
            });
          const overRight = xs.at(-1)! + right(list.at(-1)!) - high,
            overLeft = low - (xs[0] - left(list[0]));
          if (overRight > 0)
            xs.forEach((_, index) => {
              xs[index] -= overRight;
            });
          else if (overLeft > 0)
            xs.forEach((_, index) => {
              xs[index] += overLeft;
            });
        }
        // On the routing grid's half pixels, so wires leave their ports straight.
        list.forEach((item, index) => {
          item.x = round(xs[index]);
          item.y = round(rowY[row] + rowHeights[row] / 2);
        });
      }
    }
    // Fork and join bars reach across the wires that meet them, within their lane.
    for (const item of items.values()) {
      if (item.size.kind !== "bar") continue;
      const neighbours = visible
        .filter((edge) => edge.source === item.id || edge.target === item.id)
        .map((edge) => items.get(edge.source === item.id ? edge.target : edge.source)!)
        .filter((other) => other.lane === item.lane);
      if (neighbours.length < 2) continue;
      const lo = Math.max(
        laneX[item.lane] + 10,
        Math.min(item.x - item.w / 2, ...neighbours.map((other) => other.x - 14)),
      );
      const hi = Math.min(
        laneX[item.lane] + laneWidths[item.lane] - 10,
        Math.max(item.x + item.w / 2, ...neighbours.map((other) => other.x + 14)),
      );
      const clash = [...items.values()].some(
        (other) =>
          other !== item &&
          other.row === item.row &&
          other.x + other.w / 2 > lo - 10 &&
          other.x - other.w / 2 < hi + 10,
      );
      if (!clash) {
        item.x = round((lo + hi) / 2);
        item.w = hi - lo;
      }
    }
  }

  const boxOf = (item: Item): Box => ({
    x: item.x - item.w / 2,
    y: item.y - item.h / 2,
    width: item.w,
    height: item.h,
  });
  /** The corner above right of a diamond, in the frame, for a question that finds every vertex taken. */
  const corner = (item: Item, side: { width: number; height: number }): Box => {
    const drawn = {
      x: (vertical ? item.x : item.y) + 8,
      y: (vertical ? item.y : item.x) - item.w / 2 - 1 - side.height,
      ...side,
    };
    return vertical ? drawn : { x: drawn.y, y: drawn.x, width: drawn.height, height: drawn.width };
  };
  /** A side label's box in the frame: beside the node on its side, else in the corner (in LR the label stands across the flow). */
  const labelBox = (item: Item, side: { width: number; height: number }): Box => {
    if (item.size.later) return corner(item, side);
    const box = boxOf(item),
      width = vertical ? side.width : side.height,
      height = vertical ? side.height : side.width;
    return {
      x: item.labelSide === "left" ? box.x - 6 - width : box.x + box.width + 6,
      y: item.y - height / 2,
      width,
      height,
    };
  };
  /** The node and its side label, as separate boxes. */
  const footprint = (item: Item): Box[] =>
    item.side ? [boxOf(item), labelBox(item, item.side)] : [boxOf(item)];

  // Ports: forward edges leave at the bottom and enter at the top; edges back up the flow use a side.
  // They are chosen on a first placement, which the side labels then follow.
  place();
  const sides = new Map<string, [Side, Side]>();
  for (const edge of visible) {
    const s = items.get(edge.source)!,
      t = items.get(edge.target)!;
    if (t.row > s.row) sides.set(edge.id, ["bottom", "top"]);
    else if (t.row < s.row)
      sides.set(edge.id, t.x < s.x - 1 ? ["left", "left"] : ["right", "right"]);
    else sides.set(edge.id, t.x > s.x ? ["right", "left"] : ["left", "right"]);
  }
  /** The vertices (sides) the wires take at a node. */
  const taken = (item: Item) =>
    new Set<Side>(
      visible.flatMap((edge) => {
        const pair = sides.get(edge.id)!;
        return [
          ...(edge.source === item.id ? [pair[0]] : []),
          ...(edge.target === item.id ? [pair[1]] : []),
        ];
      }),
    );
  // Decisions, merges and circles take extra wires at their side vertices: the wire best in line
  // keeps the bottom (or top), the others turn to the side facing their other end, the last one to
  // the vertex opposite.
  for (const item of items.values()) {
    if (!(item.size.kind === "diamond" || item.size.centered)) continue;
    for (const [side, end] of [
      ["bottom", 0],
      ["top", 1],
    ] as const) {
      const list = visible.filter(
        (edge) =>
          (end === 0 ? edge.source : edge.target) === item.id && sides.get(edge.id)![end] === side,
      );
      if (list.length < 2) continue;
      const other = (edge: FlowEdge) => items.get(end === 0 ? edge.target : edge.source)!;
      list.sort((a, b) => Math.abs(other(a).x - item.x) - Math.abs(other(b).x - item.x));
      const used = taken(item);
      for (const edge of list.slice(1)) {
        // The side facing the other end, else the opposite one, else the far vertex: one wire per vertex.
        const facing: Side = other(edge).x < item.x ? "left" : "right",
          opposite: Side = facing === "left" ? "right" : "left";
        const want = [facing, opposite, side === "bottom" ? "top" : "bottom"].find(
          (side) => !used.has(side as Side),
        ) as Side | undefined;
        if (!want) continue;
        used.add(want);
        const pair = sides.get(edge.id)!;
        pair[end] = want;
      }
    }
  }
  // A symbol's question or name then takes a side vertex the wires left free, right in TB (above
  // in LR) if it can, else in the corner; the final placement reserves its room on that side.
  for (const item of items.values()) {
    if (!item.side || !(item.size.kind === "diamond" || item.size.centered)) continue;
    const used = taken(item),
      free = ([vertical ? "right" : "left", vertical ? "left" : "right"] as Side[]).find(
        (side) => !used.has(side),
      );
    if (free) item.labelSide = free;
    item.size = { ...item.size, later: !free };
  }
  place();
  const portPoints = new Map<string, [Point, Point]>();
  const stubLength = new Map<string, number>();
  for (const item of items.values()) {
    const box = boxOf(item);
    for (const side of ["top", "bottom", "left", "right"] as Side[]) {
      const list = visible.flatMap((edge) => {
        const pair = sides.get(edge.id)!,
          result: { edge: FlowEdge; end: 0 | 1; other: Item }[] = [];
        if (edge.source === item.id && pair[0] === side)
          result.push({ edge, end: 0, other: items.get(edge.target)! });
        if (edge.target === item.id && pair[1] === side)
          result.push({ edge, end: 1, other: items.get(edge.source)! });
        return result;
      });
      if (!list.length) continue;
      const across = side === "top" || side === "bottom";
      list.sort((a, b) => (across ? a.other.x - b.other.x : a.other.y - b.other.y));
      const length = across ? box.width : box.height,
        spacing = Math.min(18, (length - 8) / list.length);
      // Each end where its wire can run straight (facing the other end) if the side allows,
      // else spread evenly; then pushed apart to the spacing, inside the side.
      const symbol =
        item.size.centered ||
        item.size.kind === "diamond" ||
        item.size.kind === "initial" ||
        item.size.kind === "final";
      const limit = (length - 8) / 2;
      const offsets = list.map(({ other }, index) => {
        const even = (index - (list.length - 1) / 2) * spacing;
        if (symbol && list.length === 1) return 0;
        const wanted = across ? other.x - item.x : other.y - item.y;
        return Math.abs(wanted) <= limit - (item.size.kind === "bar" ? 0 : 8) && !symbol
          ? wanted
          : list.length === 1
            ? 0
            : even;
      });
      for (let pass = 0; pass < 3; pass++) {
        for (let index = 1; index < offsets.length; index++)
          offsets[index] = Math.max(offsets[index], offsets[index - 1] + spacing);
        const over = offsets.at(-1)! - limit;
        if (over > 0)
          for (let index = offsets.length - 1; index >= 0; index--)
            offsets[index] = Math.min(
              offsets[index],
              index === offsets.length - 1 ? limit : offsets[index + 1] - spacing,
            );
        offsets.forEach((value, index) => {
          offsets[index] = Math.max(-limit, Math.min(limit, value));
        });
      }
      list.forEach(({ edge, end }, index) => {
        const offset = offsets[index];
        const point =
          side === "top"
            ? { x: round(item.x + offset), y: box.y }
            : side === "bottom"
              ? { x: round(item.x + offset), y: box.y + box.height }
              : side === "left"
                ? { x: box.x, y: round(item.y + offset) }
                : { x: box.x + box.width, y: round(item.y + offset) };
        const pair = portPoints.get(edge.id) ?? [point, point];
        pair[end] = point;
        portPoints.set(edge.id, pair);
        // The middle ports get the shortest stubs, the outer ones longer, so the fan stays untangled.
        // An end with a marker keeps a straight stretch as long as the marker before the wire may turn.
        const marker = end === 0 ? edge.start : edge.end;
        stubLength.set(
          `${edge.id}:${end}`,
          (list.length > 1 ? Math.round(Math.abs(index - (list.length - 1) / 2)) * 7 : 0) +
            (marker ? MARKER_LENGTH[MARKERS[marker]] : 0),
        );
      });
    }
  }
  // Ports on one side get stubs of different lengths, so the wires leaving them can part without crossing.
  const stub = (point: Point, side: Side, extra = 0): Point => {
    const length = STUB + extra;
    return side === "top"
      ? { x: point.x, y: point.y - length }
      : side === "bottom"
        ? { x: point.x, y: point.y + length }
        : side === "left"
          ? { x: point.x - length, y: point.y }
          : { x: point.x + length, y: point.y };
  };
  return {
    bands,
    bottom,
    boxOf,
    chart,
    footprint,
    forward,
    gaps,
    header,
    items,
    labelBox,
    laneWidths,
    laneX,
    lanes,
    portPoints,
    rowHeights,
    rowY,
    rows,
    sides,
    stub,
    stubLength,
    titles,
    vertical,
    visible,
  };
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
