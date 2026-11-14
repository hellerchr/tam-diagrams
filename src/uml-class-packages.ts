/** Class diagram layout helpers: packages as folders, straight runs of relations, end labels and merged inheritance trees. */

import { crossesBox } from "./audit.ts";
import {
  type Graph,
  type GraphEdge,
  type GraphNode,
  type GraphPort,
  improveRoutes,
  layoutGraph,
  type LayoutOptions,
  orthogonal,
  type Placement,
} from "./elk.ts";
import { smallLines, smallSize } from "./labels.ts";
import { MARKER_LENGTH, markerBounds } from "./markers.ts";
import { runsAlong } from "./route.ts";
import {
  type Box,
  distance,
  grow,
  inside,
  overlaps,
  type Point,
  type Scene,
  segmentsCross,
  simplifyPath,
  unit,
} from "./scene.ts";
import type { Measure } from "./text.ts";

/**
 * Packages side by side: each top-level container is laid out on its own along the flow, then the
 * containers and the loose nodes are laid out across it, with ports where the connections leave the
 * containers at their inner nodes. Each connection between packages is the outer route plus a short
 * stub inside each container. Null when there is nothing to arrange.
 */
export async function layoutPackages(
  graph: Graph,
  options: LayoutOptions,
): Promise<Placement | null> {
  const containers = graph.children.filter((node) => node.children?.length);
  if (containers.length < 2) return null;
  const top = new Map<string, string>();
  const mark = (node: GraphNode, id: string) => {
    top.set(node.id, id);
    node.children?.forEach((child) => mark(child, id));
  };
  graph.children.forEach((node) => mark(node, node.id));
  const packaged = new Set(containers.map((node) => node.id));
  const cross = graph.edges.filter((edge) => top.get(edge.source) !== top.get(edge.target));
  if (
    !cross.some(
      (edge) => packaged.has(top.get(edge.source)!) || packaged.has(top.get(edge.target)!),
    )
  )
    return null;
  const vertical = graph.direction === "TB" || graph.direction === "BT";
  const parts = new Map(
    await Promise.all(
      containers.map(
        async (container) =>
          [
            container.id,
            await layoutGraph(
              {
                direction: graph.direction,
                children: [container],
                edges: graph.edges.filter(
                  (edge) =>
                    top.get(edge.source) === container.id && top.get(edge.target) === container.id,
                ),
              },
              options,
            ),
          ] as const,
      ),
    ),
  );

  // Ports: where the laid-out source leaves its container (forward across the flow) and the target enters.
  type Side = GraphPort["side"];
  const forward: Side = vertical ? "EAST" : "SOUTH",
    backward: Side = vertical ? "WEST" : "NORTH";
  const ends = new Map<string, { edge: GraphEdge; end: "source" | "target"; side: Side }[]>();
  for (const edge of cross) {
    for (const end of ["source", "target"] as const) {
      const id = edge[end],
        owner = top.get(id)!;
      if (!packaged.has(owner) || id === owner) continue;
      const side = (end === "source") !== !!edge.reversed ? forward : backward,
        key = `${id}\u0000${side}`;
      ends.set(key, [...(ends.get(key) ?? []), { edge, end, side }]);
    }
  }
  const ports = new Map<string, GraphPort[]>(),
    portOf = new Map<string, string>();
  for (const [key, list] of ends) {
    const id = key.split("\u0000")[0],
      owner = top.get(id)!,
      part = parts.get(owner)!;
    const frame = part.boxes.get(owner)!,
      box = part.boxes.get(id)!;
    list.forEach(({ edge, end, side }, index) => {
      const share = (index + 1) / (list.length + 1),
        port = `${edge.id}@${end}`;
      const x =
        side === "EAST" ? frame.width : side === "WEST" ? 0 : box.x - frame.x + box.width * share;
      const y =
        side === "SOUTH"
          ? frame.height
          : side === "NORTH"
            ? 0
            : box.y - frame.y + box.height * share;
      ports.set(owner, [...(ports.get(owner) ?? []), { id: port, x, y, side }]);
      portOf.set(port, id);
    });
  }
  const outer = await layoutGraph(
    {
      direction: vertical ? "LR" : "TB",
      children: graph.children.map((node) => {
        if (!packaged.has(node.id)) return node;
        const frame = parts.get(node.id)!.boxes.get(node.id)!;
        return { id: node.id, width: frame.width, height: frame.height, ports: ports.get(node.id) };
      }),
      edges: [
        ...cross.map((edge) => ({
          ...edge,
          source: top.get(edge.source)!,
          target: top.get(edge.target)!,
          sourcePort: portOf.has(`${edge.id}@source`) ? `${edge.id}@source` : undefined,
          targetPort: portOf.has(`${edge.id}@target`) ? `${edge.id}@target` : undefined,
        })),
        ...graph.edges.filter(
          (edge) => edge.source === edge.target && !packaged.has(top.get(edge.source)!),
        ),
      ],
    },
    { ...options, loops: vertical ? "vertical" : "horizontal" },
  );

  const placement: Placement = {
    boxes: new Map(),
    routes: new Map(),
    edgeLabels: new Map(),
    nodeLabels: new Map(),
    ancestors: new Map(),
    nodes: new Map(),
    edges: new Map(graph.edges.map((edge) => [edge.id, edge])),
  };
  const move = (box: Box, dx: number, dy: number): Box => ({
    ...box,
    x: box.x + dx,
    y: box.y + dy,
  });
  for (const node of graph.children) {
    if (packaged.has(node.id)) continue;
    placement.boxes.set(node.id, outer.boxes.get(node.id)!);
    placement.nodes.set(node.id, node);
    placement.ancestors.set(node.id, []);
    const labels = outer.nodeLabels.get(node.id);
    if (labels) placement.nodeLabels.set(node.id, labels);
  }
  for (const edge of graph.edges)
    if (edge.source === edge.target && !packaged.has(top.get(edge.source)!)) {
      placement.routes.set(edge.id, outer.routes.get(edge.id)!);
      const label = outer.edgeLabels.get(edge.id);
      if (label) placement.edgeLabels.set(edge.id, label);
    }
  for (const [id, part] of parts) {
    const frame = part.boxes.get(id)!,
      at = outer.boxes.get(id)!,
      dx = at.x - frame.x,
      dy = at.y - frame.y;
    for (const [node, box] of part.boxes) placement.boxes.set(node, move(box, dx, dy));
    for (const [edge, route] of part.routes)
      placement.routes.set(
        edge,
        route.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      );
    for (const [edge, label] of part.edgeLabels)
      placement.edgeLabels.set(edge, move(label, dx, dy));
    for (const [node, labels] of part.nodeLabels)
      placement.nodeLabels.set(
        node,
        labels.map((label) => move(label, dx, dy)),
      );
    for (const [node, item] of part.nodes) placement.nodes.set(node, item);
    for (const [node, list] of part.ancestors) placement.ancestors.set(node, list);
  }
  // A connection between packages: from its node straight out to the port, the outer route, and in again.
  const stub = (id: string, port: Point): Point => {
    const box = placement.boxes.get(id)!;
    if (port.x <= box.x || port.x >= box.x + box.width)
      return { x: port.x <= box.x ? box.x : box.x + box.width, y: port.y };
    return { x: port.x, y: port.y <= box.y ? box.y : box.y + box.height };
  };
  for (const edge of cross) {
    const route = outer.routes.get(edge.id);
    if (!route) continue;
    const points = [...route];
    if (portOf.has(`${edge.id}@source`)) points.unshift(stub(edge.source, route[0]));
    if (portOf.has(`${edge.id}@target`)) points.push(stub(edge.target, route.at(-1)!));
    placement.routes.set(edge.id, simplifyPath(orthogonal(points)));
    const label = outer.edgeLabels.get(edge.id);
    if (label) placement.edgeLabels.set(edge.id, label);
  }
  improveRoutes(placement, vertical, { node: 32, edgeNode: 18, ...options.spacing });
  return placement;
}

export interface EndLabel {
  wire: string;
  text: string;
  atStart: boolean;
}

/**
 * Places labels beside wire ends (multiplicities and roles): just off the shape, on whichever side
 * of the wire is free of shapes, wires, markers and other text; around the first bend for short
 * end segments; the spot that covers the least when nothing is free.
 */
export function placeEndLabels(scene: Scene, labels: EndLabel[], measure: Measure) {
  for (const label of labels) {
    const wire = scene.wires.find((item) => item.edge === label.wire);
    if (!wire) continue;
    const points = label.atStart ? wire.points : [...wire.points].toReversed();
    const end = points[0],
      d = unit(points[0], points[1]),
      n = { x: -d.y, y: d.x };
    const { width, height } = smallSize(label.text, measure);
    const reach = Math.min(distance(points[0], points[1]), 60);
    const marker = scene.markers.find(
      (item) => distance(item.tip, end) < 0.75 && item.wire === wire.edge,
    );
    const start = marker ? MARKER_LENGTH[marker.kind] + 3 : 4;
    const candidates: Box[] = [];
    // Close to the end first, then further along the first segment and further out beside it.
    const spots: [number, number][] = [
      [start, 6],
      [start + 8, 6],
      [start + 16, 6],
      [start + 26, 6],
      [start, 14],
      [start + 12, 14],
      [start + 38, 6],
      [start + 52, 6],
      [start + 26, 14],
    ];
    for (let along = start; along <= reach - 4; along += 6)
      for (const off of [6, 12, 20]) spots.push([along, off]);
    for (const [along, off] of spots) {
      if (along > reach + 4 && candidates.length >= 2) continue;
      for (const side of [1, -1]) {
        // The label's near corner sits `along` from the end and `off` beside the wire.
        const anchor = {
          x: end.x + d.x * along + n.x * side * off,
          y: end.y + d.y * along + n.y * side * off,
        };
        candidates.push({
          x:
            anchor.x + (Math.abs(d.x) > 0.5 ? (d.x > 0 ? 0 : -width) : n.x * side > 0 ? 0 : -width),
          y:
            anchor.y +
            (Math.abs(d.y) > 0.5 ? (d.y > 0 ? 0 : -height) : n.y * side > 0 ? 0 : -height),
          width,
          height,
        });
      }
    }
    if (points.length > 2) {
      const bend = points[1];
      for (const [sx, sy] of [
        [1, -1],
        [-1, -1],
        [1, 1],
        [-1, 1],
      ])
        candidates.push({
          x: sx > 0 ? bend.x + 5 : bend.x - 5 - width,
          y: sy > 0 ? bend.y + 5 : bend.y - 5 - height,
          width,
          height,
        });
    }
    const cost = (box: Box) => {
      let sum = 0;
      const padded = grow(box, 2);
      for (const shape of scene.shapes)
        if (shape.kind !== "region" && !shape.container && overlaps(padded, shape.box)) sum += 1000;
      for (const shape of scene.shapes)
        if (shape.container && overlaps(padded, shape.box) && !inside(box, shape.box)) sum += 300;
      for (const text of scene.texts) if (overlaps(padded, text.box)) sum += 1000;
      for (const other of scene.wires)
        other.points.slice(1).forEach((point, index) => {
          if (crossesBox(other.points[index], point, grow(box, 3)))
            sum += other === wire ? 500 : 400;
        });
      for (const item of scene.markers)
        if (
          overlaps(padded, grow(markerBounds(item.kind, item.tip, item.direction, item.small), 1))
        )
          sum += 500;
      return sum;
    };
    let best = candidates[0],
      bestCost = Infinity;
    for (const box of candidates) {
      const value = cost(box);
      if (value < bestCost) {
        best = box;
        bestCost = value;
      }
      if (!value) break;
    }
    smallLines(scene, measure, label.text, best.x + best.width / 2, best.y + best.height / 2, {
      role: "end",
      owner: wire.edge,
    });
  }
}

/**
 * Generalizations to one parent share a single triangle, as in the TAM standard's class diagrams:
 * the wires from the children rise to a common bar, and one stem carries the triangle into the
 * parent. Applied only where every wire leaves its child and enters the parent along the same
 * axis, the bar fits between them, and the new segments hit nothing and add no crossing.
 */
export function mergeTrees(scene: Scene, groups: { parent: string; wires: string[] }[]) {
  type Axis = "x" | "y";
  for (const group of groups) {
    const parent = scene.shapes.find((shape) => shape.id === group.parent);
    const wires = group.wires
      .map((id) => scene.wires.find((wire) => wire.edge === id))
      .filter((wire) => wire !== undefined);
    if (!parent || wires.length < 2 || wires.length !== group.wires.length) continue;
    if (scene.texts.some((text) => text.owner && group.wires.includes(text.owner))) continue;
    const routes = wires.map((wire) => {
      const marker = scene.markers.find(
        (item) => item.wire === wire.edge && item.kind === "triangle",
      );
      if (!marker) return null;
      const atEnd = distance(marker.tip, wire.points.at(-1)!) < 0.75;
      return { wire, marker, atEnd, points: atEnd ? wire.points : [...wire.points].toReversed() };
    });
    if (routes.some((route) => !route)) continue;
    const list = routes as NonNullable<(typeof routes)[number]>[];
    const d = unit(list[0].points.at(-2)!, list[0].points.at(-1)!);
    const main: Axis = Math.abs(d.y) > 0.99 ? "y" : Math.abs(d.x) > 0.99 ? "x" : "y";
    if (Math.abs(d[main]) < 0.99) continue;
    const cross: Axis = main === "y" ? "x" : "y",
      s = Math.sign(d[main]);
    const sameWay = (p: Point, q: Point) =>
      Math.abs(q[cross] - p[cross]) < 0.5 && Math.sign(q[main] - p[main]) === s;
    if (!list.every((route) => sameWay(route.points.at(-2)!, route.points.at(-1)!))) continue;
    const edge = list[0].points.at(-1)![main];
    if (!list.every((route) => Math.abs(route.points.at(-1)![main] - edge) < 0.5)) continue;
    // The bar 28px from the parent, or where a child's route already turns near there, so the two make one line.
    const levels = [
      ...new Set(
        list
          .filter((route) => route.points.length > 2)
          .map((route) => route.points.at(-2)![main])
          .filter((level) => (edge - level) * s >= 16 && (edge - level) * s <= 40),
      ),
    ].toSorted((a, b) => Math.abs(Math.abs(edge - a) - 28) - Math.abs(Math.abs(edge - b) - 28));
    const buses = [...levels, edge - s * 28];
    const make = (m: number, c: number): Point => (main === "y" ? { x: c, y: m } : { x: m, y: c });
    const center = parent.box[cross] + (cross === "x" ? parent.box.width : parent.box.height) / 2;
    const allowed = new Set([group.parent, ...list.flatMap((route) => route.wire.ends)]);
    const others = scene.wires.filter((wire) => !group.wires.includes(wire.edge));
    const crossingsOf = (all: Point[][]) =>
      all.reduce(
        (sum, points) =>
          sum +
          points
            .slice(1)
            .reduce(
              (inner, point, index) =>
                inner +
                others.reduce(
                  (count, wire) =>
                    count +
                    wire.points
                      .slice(1)
                      .filter((q, j) => segmentsCross(points[index], point, wire.points[j], q))
                      .length,
                  0,
                ),
              0,
            ),
        0,
      );
    const hits = (points: Point[]) =>
      points.slice(1).some((point, index) => {
        const a = points[index];
        return (
          scene.shapes.some(
            (shape) =>
              !shape.container &&
              !shape.passable &&
              shape.kind !== "region" &&
              !allowed.has(shape.id) &&
              crossesBox(a, point, grow(shape.box, 3)),
          ) ||
          scene.texts.some((text) => crossesBox(a, point, grow(text.box, 1))) ||
          others.some((wire) =>
            wire.points.slice(1).some((q, j) => runsAlong(a, point, wire.points[j], q)),
          ) ||
          scene.markers.some(
            (marker) => !group.wires.includes(marker.wire) && distance(marker.tip, point) < 10,
          )
        );
      });
    /**
     * The wires joined at a stem. A child's straight wire at the stem stays as it is; other children rise
     * straight to the bar where that is clear, and the outermost on each side draws the bar to the stem.
     * A child whose way up is blocked keeps its route and turns onto the stem at the level of its last turn.
     */
    const join = (stem: number, bus: number) => {
      const paths = new Map<(typeof list)[number], Point[]>();
      const straight = list.find(
        (route) => route.points.length === 2 && Math.abs(route.points[0][cross] - stem) < 0.5,
      );
      if (straight) paths.set(straight, [straight.points[0], make(edge, stem)]);
      const rising = new Map<(typeof list)[number], Point[]>(),
        turning = new Map<(typeof list)[number], Point[]>();
      for (const route of list) {
        if (route === straight) continue;
        const start = route.points[0],
          up = [start, make(bus, start[cross])];
        if (sameWay(start, route.points[1]) && (bus - start[main]) * s >= 10 && !hits(up)) {
          rising.set(route, up);
          continue;
        }
        // The last turn ends on the stem instead, which reaches from the parent to the bar and beyond it as needed.
        const turn = route.points.at(-2)!,
          level = turn[main];
        if (route.points.length < 3 || (edge - level) * s < 10) return null;
        const path = [...route.points.slice(0, -2), make(level, stem)];
        if (hits(path)) return null;
        turning.set(route, path);
      }
      let owner = straight;
      for (const sign of [-1, 1]) {
        const members = [...rising]
          .filter(([route]) => (Math.sign(Math.round(route.points[0][cross] - stem)) || 1) === sign)
          .toSorted(
            ([a], [b]) => Math.abs(b.points[0][cross] - stem) - Math.abs(a.points[0][cross] - stem),
          );
        members.forEach(([route, up], index) => {
          if (index) {
            paths.set(route, up);
            return;
          }
          const reach = Math.abs(up[1][cross] - stem) < 0.5 ? up : [...up, make(bus, stem)];
          if (!owner) {
            owner = route;
            paths.set(route, [...reach, make(edge, stem)]);
          } else paths.set(route, reach);
        });
      }
      for (const [route, path] of turning) {
        // On the bar's level the run ends where it reaches the bar; beyond the bar the stem is extended
        // to the turn; between bar and parent the turn meets the stem.
        const from = path.at(-2)![cross],
          sign = Math.sign(from - stem);
        const feet = [...rising.values()]
          .map((up) => up[1][cross])
          .filter((foot) => Math.sign(foot - stem) === sign);
        const outer = feet.reduce(
          (far, foot) => (Math.abs(foot - stem) > Math.abs(far - stem) ? foot : far),
          stem,
        );
        if (Math.abs(path.at(-1)![main] - bus) < 0.5 && outer !== stem) {
          paths.set(
            route,
            Math.abs(from - stem) > Math.abs(outer - stem)
              ? [...path.slice(0, -1), make(bus, outer)]
              : path.slice(0, -1),
          );
          continue;
        }
        if (!owner) {
          owner = route;
          paths.set(route, [...path, make(edge, stem)]);
        } else
          paths.set(
            route,
            (bus - path.at(-1)![main]) * s > 0.5 ? [...path, make(bus, stem)] : path,
          );
      }
      if (!owner || paths.size !== list.length || [...paths.values()].some(hits)) return null;
      return crossingsOf([...paths.values()]) > crossingsOf(list.map((route) => route.points))
        ? null
        : { stem, paths, owner };
    };
    // The stem enters the parent in the middle; else under a child whose wire is already straight.
    const straightStems = list
      .filter((route) => route.points.length === 2)
      .map((route) => route.points[0][cross]);
    const near = straightStems.find((at) => Math.abs(at - center) < 6);
    const joined = [near ?? center, ...straightStems]
      .flatMap((stem) => buses.map((bus) => [stem, bus]))
      .reduce<ReturnType<typeof join>>((found, [stem, bus]) => found ?? join(stem, bus), null);
    if (!joined) continue;
    const { stem, paths, owner } = joined;
    for (const route of list) {
      const points = paths.get(route)!;
      route.wire.points = route.atEnd ? points : points.toReversed();
      if (route !== owner) {
        if (route.atEnd) route.wire.to = undefined;
        else route.wire.from = undefined;
      }
    }
    scene.markers = scene.markers.filter(
      (marker) => !list.some((route) => route.marker === marker),
    );
    scene.markers.push({
      kind: "triangle",
      tip: make(edge, stem),
      direction: d,
      wire: owner.wire.edge,
    });
  }
}
