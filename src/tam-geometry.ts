/** TAM layout, second stage: ELK's result read into boxes and routes, then the geometry passes that straighten wires. */

import { type Box, grow, type Point } from "./scene";
import { crossesBox as crossesOpenBox } from "./audit";
import type { ElkNode } from "elkjs/lib/elk-api";
import { FONT, LINE, type Measure, SMALL } from "./text";
import { readLayout } from "./elk";
import { alignDelegations, alignProtocols, straighten } from "./route-straighten";
import { balanceElements, spreadJogs } from "./route-spread";
import {
  alignLayers,
  centerElements,
  centerEnds,
  centerFans,
  centerPairs,
  centerWires,
} from "./route-center";
import { outline } from "./route";
import {
  BULGE,
  EDGE_SPACING,
  LOOP_END,
  NODE_SPACING,
  PAD,
  SHADOW,
  type TamGeometry,
  type TamGraph,
} from "./tam-graph";

/** Whether a segment passes through the box, not just along its border. */
const crossesBox = (a: Point, b: Point, box: Box) => crossesOpenBox(a, b, grow(box, -1));

/** Reads ELK's result and runs the geometry passes: straight connections wherever the elements allow. */
export function tamGeometry(prepared: TamGraph, result: ElkNode, measure: Measure): TamGeometry {
  const { chain, diagram, ends, reversed, scale, shapes, vertical } = prepared;
  const { boxes, routes, edgeLabels, nodeLabels } = readLayout(result, (id) => reversed.has(id));

  // Straight connections wherever the elements allow, then the scene is built from the final geometry.
  const leaves = new Set(
    [...shapes]
      .filter(
        ([id, shape]) =>
          !shape.container &&
          shape.node.kind !== "interface" &&
          shape.node.kind !== "dots" &&
          boxes.has(id),
      )
      .map(([id]) => id),
  );
  const markers = new Set(
    [...boxes.keys()].filter(
      (id) => id.endsWith("#node") || diagram.nodes.get(id)?.kind === "interface",
    ),
  );
  // Rounded shapes: leaf storages are pills, storage containers and groups have rounded corners.
  const round = new Map<string, number>();
  for (const [id, shape] of shapes) {
    const box = boxes.get(id),
      kind = shape.node.kind;
    if (!box || id.endsWith("#row")) continue;
    if (kind === "storage" && !shape.container)
      round.set(id, (box.height - (shape.node.stack ? SHADOW : 0)) / 2);
    else if (shape.container && (kind === "storage" || (kind === "group" && shape.node.passive)))
      round.set(id, 18);
  }
  const ancestors = new Map([...boxes.keys()].map((id) => [id, chain(id).slice(1)]));
  const containers = new Set(
    [...shapes]
      .filter(([id, shape]) => shape.container && !id.endsWith("#row") && boxes.has(id))
      .map(([id]) => id),
  );
  // Title areas of containers, centered at the top as drawn later.
  const titles = [...containers].flatMap((id) => {
    const shape = shapes.get(id)!,
      box = boxes.get(id)!;
    if (!shape.lines.length || shape.node.kind === "package") return [];
    const width = Math.max(
      ...shape.lines.map((line) => measure(line, FONT, 600)),
      shape.node.kind === "subsystem" ? measure("«subsystem»", SMALL, 400) : 0,
    );
    const icon = shape.node.kind === "component" || shape.node.kind === "subsystem";
    const cx = Math.min(
      box.x + box.width / 2,
      box.x + box.width - PAD - (icon ? 26 : 0) - width / 2,
    );
    return [
      {
        x: cx - width / 2,
        y: box.y + 4,
        width,
        height: (shape.node.kind === "subsystem" ? 16 : 0) + shape.lines.length * LINE + 6,
      },
    ];
  });
  // A loop reaches LOOP_END + BULGE to either side of its route, which needs that much more clearance.
  const widths = new Map(
    diagram.edges
      .filter((edge) => edge.kind === "modify")
      .map((edge) => [edge.id, LOOP_END + BULGE] as [string, number]),
  );
  const geometry = {
    boxes,
    routes,
    nodeLabels,
    edgeLabels,
    ends,
    leaves,
    markers,
    round,
    ancestors,
    containers,
    titles,
    widths,
    spacing: { node: NODE_SPACING * scale, edge: EDGE_SPACING * scale },
  };
  straighten(geometry, vertical);
  const protocols = new Map<string, string[]>();
  for (const edge of diagram.edges)
    if (edge.protocol && edge.kind === "channel")
      protocols.set(edge.protocol, [...(protocols.get(edge.protocol) ?? []), `${edge.id}#node`]);
  // Elements sit centered among their neighbours and in the free space along the layout direction; channels of one row share one level.
  balanceElements(geometry, vertical);
  centerWires(geometry, vertical);
  centerEnds(geometry, vertical);
  centerElements(geometry, vertical);
  centerFans(geometry, vertical);
  centerPairs(
    geometry,
    vertical,
    diagram.edges.filter((edge) => edge.aside).map((edge) => [edge.source, edge.target]),
  );
  alignLayers(geometry, vertical);
  // A channel or connector marker can slide along the straight wire pieces at it, from the bend before to
  // the bend after (keeping each piece some length): markers whose reachable spans overlap form a row.
  const reach = diagram.edges
    .filter(
      (edge) =>
        (edge.kind === "channel" || edge.kind === "assembly") && boxes.has(`${edge.id}#node`),
    )
    .flatMap((edge) => {
      const into = routes.get(`${edge.id}:a`),
        out = routes.get(`${edge.id}:b`),
        box = boxes.get(`${edge.id}#node`)!;
      if (!into || !out) return [];
      const main = vertical ? "y" : "x",
        cross = vertical ? "x" : "y",
        half = (vertical ? box.height : box.width) / 2;
      const along = (p: Point, q: Point) => Math.abs(p[cross] - q[cross]) < 0.5;
      if (!along(into.at(-2)!, into.at(-1)!) || !along(out[0], out[1])) return [];
      const [low, high] = [into.at(-2)![main], out[1][main]].toSorted((p, q) => p - q);
      return [{ id: `${edge.id}#node`, low: low + 6 + half, high: high - 6 - half }];
    })
    .filter((item) => item.low <= item.high)
    .toSorted((p, q) => p.low - q.low);
  const rows: string[][] = [];
  let shared = { low: -Infinity, high: -Infinity };
  for (const item of reach) {
    const low = Math.max(shared.low, item.low),
      high = Math.min(shared.high, item.high);
    if (rows.length && low <= high) {
      rows.at(-1)!.push(item.id);
      shared = { low, high };
    } else {
      rows.push([item.id]);
      shared = { low: item.low, high: item.high };
    }
  }
  alignProtocols(
    geometry,
    rows.filter((row) => row.length > 1),
    vertical,
  );
  alignProtocols(geometry, [...protocols.values()], vertical);
  alignDelegations(
    geometry,
    diagram.edges
      .filter((edge) => edge.kind === "delegation")
      .map((edge) => [edge.id, edge.source, edge.target]),
    vertical,
  );
  spreadJogs(geometry, vertical);
  // Every wire end on a rounded shape meets its curved outline.
  for (const [id, route] of routes) {
    const [source, target] = ends.get(id) ?? [];
    const shapeBox = (node?: string) => (node && round.has(node) ? boxes.get(node) : undefined);
    const startBox = shapeBox(source),
      endBox = shapeBox(target);
    if (!startBox && !endBox) continue;
    const next = route.map((point) => ({ ...point }));
    // Ends in the steep part of a rounded corner slide toward the flat part, with the segment that reaches them.
    const settle = (index: number, neighbour: number, box: Box, radius: number) => {
      const end = next[index],
        along: "x" | "y" = Math.abs(end.x - next[neighbour].x) < 0.5 ? "x" : "y",
        extent = along === "x" ? box.width : box.height;
      const limit = Math.min(
        Math.max(end[along], box[along] + 0.4 * radius),
        box[along] + extent - 0.4 * radius,
      );
      if (Math.abs(limit - end[along]) < 0.5 || next.length < 3) return;
      const moved = next.map((point, i) =>
        i === index || i === neighbour ? { ...point, [along]: limit } : point,
      );
      const blocked = [...leaves, ...markers].some(
        (id) =>
          id !== source &&
          id !== target &&
          boxes.has(id) &&
          moved.slice(1).some((point, i) => crossesBox(moved[i], point, boxes.get(id)!)),
      );
      if (!blocked) next.splice(0, next.length, ...moved);
    };
    if (startBox) settle(0, 1, startBox, round.get(source!)!);
    if (endBox) settle(next.length - 1, next.length - 2, endBox, round.get(target!)!);
    if (startBox) next[0] = outline(next[0], next[1], startBox, round.get(source!)!);
    if (endBox)
      next[next.length - 1] = outline(next.at(-1)!, next.at(-2)!, endBox, round.get(target!)!);
    routes.set(id, next);
  }
  return { boxes, edgeLabels, leaves, markers, nodeLabels, round, routes };
}
