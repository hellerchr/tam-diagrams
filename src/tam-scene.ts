/** TAM layout, last stage: the scene drawn from the final geometry, with shapes, titles, wires, markers, labels and protocol boundaries. */

import {
  type Box,
  centerOf,
  emptyScene,
  type Point,
  type Scene,
  type SceneShape,
  type SceneText,
  type SceneWire,
  simplifyPath,
  unit,
} from "./scene.ts";
import { fallback, outline } from "./route.ts";
import {
  addText,
  breaks,
  finishBounds,
  FONT,
  LINE,
  MARK,
  type Measure,
  SMALL,
  SMALL_LINE,
} from "./text.ts";
import type { TamEdge } from "./tam.ts";
import { smallLines } from "./labels.ts";
import { protocolBoundaries } from "./tam-protocols.ts";
import { SOCKET } from "./markers.ts";
import {
  ASIDE,
  BALL,
  BULGE,
  CHANNEL,
  GLYPH,
  ICON,
  LOOP_END,
  PAD,
  SHADOW,
  TAB,
  type TamGeometry,
  type TamGraph,
  TITLE_TOP,
} from "./tam-graph.ts";

const add = (a: Point, b: Point, scale = 1) => ({ x: a.x + b.x * scale, y: a.y + b.y * scale });

/**
 * Inserts a corner into every slanted step. The corner keeps the turn: after a vertical run the step
 * continues horizontally first, and vice versa; a first step bends so the next run stays straight.
 */
function square(points: Point[]): Point[] {
  const result: Point[] = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const a = result.at(-1)!,
      b = points[i];
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
      fallback("square-corner");
      const before = result.at(-2),
        after = points[i + 1];
      const cameVertically = before
        ? Math.abs(before.x - a.x) < 0.5
        : after
          ? Math.abs(after.x - b.x) > 0.5
          : true;
      result.push(cameVertically ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
    }
    result.push({ ...b });
  }
  return result;
}

/** An orthogonal polyline as an SVG path with rounded corners. */
function rounded(points: Point[], radius: number): string {
  const r = (value: number) => Math.round(value * 10) / 10;
  let d = `M${r(points[0].x)} ${r(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [p, q, n] = [points[i - 1], points[i], points[i + 1]];
    const before = Math.min(radius, Math.hypot(q.x - p.x, q.y - p.y) / 2),
      after = Math.min(radius, Math.hypot(n.x - q.x, n.y - q.y) / 2);
    const a = add(q, unit(q, p), before),
      b = add(q, unit(q, n), after);
    d += `L${r(a.x)} ${r(a.y)}Q${r(q.x)} ${r(q.y)} ${r(b.x)} ${r(b.y)}`;
  }
  return `${d}L${r(points.at(-1)!.x)} ${r(points.at(-1)!.y)}`;
}

/** An orthogonal polyline moved `distance` to its left (corners move along both neighbouring normals). */
function offset(points: Point[], distance: number): Point[] {
  return points.map((point, index) => {
    const normal = (from: Point, to: Point) => {
      const d = unit(from, to);
      return { x: -d.y, y: d.x };
    };
    const a = index > 0 ? normal(points[index - 1], point) : null,
      b = index < points.length - 1 ? normal(point, points[index + 1]) : null;
    return {
      x: point.x + ((a?.x ?? 0) + (b?.x ?? 0)) * distance,
      y: point.y + ((a?.y ?? 0) + (b?.y ?? 0)) * distance,
    };
  });
}

/** Moves a route's end onto `center`, keeping its last segment axis-aligned. */
function snapEnd(points: Point[], center: Point): Point[] {
  const copy = points.map((point) => ({ ...point }));
  const last = copy.length - 1,
    previous = copy[last - 1],
    end = copy[last];
  if (Math.abs(previous.x - end.x) < 0.5) previous.x = center.x;
  else if (Math.abs(previous.y - end.y) < 0.5) previous.y = center.y;
  copy[last] = { ...center };
  return copy;
}

/** Shortens the end of a route by `length`, so it stops at a marker's outline. */
function trimEnd(points: Point[], length: number): Point[] {
  const copy = points.map((point) => ({ ...point })),
    last = copy.length - 1;
  copy[last] = add(copy[last], unit(copy[last - 1], copy[last]), -length);
  return copy;
}

const reverse = (points: Point[]) => points.toReversed();

/** Builds the scene from the final geometry: shapes, titles, wires, markers, labels and protocol boundaries. */
export function tamScene(prepared: TamGraph, geometry: TamGeometry, measure: Measure): Scene {
  const { chain, diagram, markerSize, shapes, vertical } = prepared;
  const { boxes, edgeLabels, leaves, markers, nodeLabels, round, routes } = geometry;
  const scene: Scene = { ...emptyScene(), orthogonal: true };
  /** Channel circles and interface balls are small shapes named after their marker node. */
  const circle = (center: Point, radius: number, owner: string) =>
    scene.shapes.push({
      id: owner,
      kind: "circle",
      box: { x: center.x - radius, y: center.y - radius, width: 2 * radius, height: 2 * radius },
      container: false,
      depth: 0,
      fill: "page",
    });
  /** Three dots along `across` (or down), for "more of these". */
  const dots = (id: string, center: Point, across: boolean) =>
    scene.shapes.push({
      id,
      kind: "dots",
      box: across
        ? { x: center.x - 8, y: center.y - 2, width: 16, height: 4 }
        : { x: center.x - 2, y: center.y - 8, width: 4, height: 16 },
      container: false,
      depth: 0,
      fill: "none",
    });
  const text = (
    value: string,
    x: number,
    y: number,
    options: Partial<SceneText> & Pick<SceneText, "role">,
  ) => {
    addText(scene, measure, value, x, y, options);
  };
  const lineY = (index: number, count: number, center: number, height = LINE) =>
    center + (index - (count - 1) / 2) * height;

  const titled: { id: string; box: Box; lines: string[]; subsystem: boolean; icon: boolean }[] = [];
  // Shapes, outside-in so containers paint first.
  const order: string[] = [];
  const collect = (id: string) => {
    order.push(id);
    diagram.nodes.get(id)!.children.forEach(collect);
  };
  diagram.roots.forEach(collect);
  for (const id of order) {
    const shape = shapes.get(id),
      full = boxes.get(id);
    // Interfaces and channels are drawn with their connections.
    if (!shape || !full || shape.node.kind === "interface" || shape.node.kind === "dots") continue;
    const { node } = shape;
    if (id.endsWith("#row")) continue;
    const box = node.stack
      ? { ...full, width: full.width - SHADOW, height: full.height - SHADOW }
      : full;
    const storage = node.kind === "storage" || (node.kind === "group" && !!node.passive);
    const icon =
      node.kind === "component" || node.kind === "subsystem"
        ? "component"
        : node.kind === "human"
          ? "human"
          : undefined;
    const tab =
      node.kind === "package"
        ? Math.min(box.width - 12, shape.container ? measure(node.label, SMALL, 600) + 20 : 40)
        : undefined;
    // A container's tint carries over to the containers inside it, one shade deeper per level.
    let color = node.color;
    for (
      let parent = node.parent ? diagram.nodes.get(node.parent) : undefined;
      !color && shape.container && parent;
      parent = parent.parent ? diagram.nodes.get(parent.parent) : undefined
    )
      color = parent.color;
    // Storages are pills, storage containers and passive groups rounded, groups thin frames that show what is behind them.
    const thin = node.kind === "group";
    const kind: SceneShape["kind"] =
      tab !== undefined
        ? "folder"
        : storage
          ? shape.container
            ? "round"
            : "stadium"
          : thin
            ? "round"
            : "rect";
    scene.shapes.push({
      id,
      kind,
      box,
      container: shape.container,
      depth: shape.depth,
      fill: thin ? "none" : shape.container ? "shade" : "page",
      ...(kind === "round" ? { radius: storage ? 18 : 4 } : {}),
      ...(tab !== undefined ? { tab: { width: tab, height: TAB } } : {}),
      ...(thin ? { thin } : {}),
      ...(color ? { color } : {}),
      ...(node.stack ? { stack: true } : {}),
      ...(icon ? { icon } : {}),
    });
    const cx = box.x + box.width / 2;
    if (shape.container) {
      if (node.kind === "package")
        text(node.label, box.x + 10, box.y + TAB / 2, {
          size: SMALL,
          weight: 600,
          anchor: "start",
          role: "title",
          owner: id,
        });
      else if (shape.lines.length)
        titled.push({
          id,
          box,
          lines: shape.lines,
          subsystem: node.kind === "subsystem",
          icon: !!icon,
        });
      continue;
    }
    let cy = box.y + box.height / 2;
    if (node.kind === "human") cy = box.y + 40 + (box.height - 46) / 2;
    if (node.kind === "subsystem") {
      text("«subsystem»", box.x + (box.width - ICON + 4) / 2, box.y + 15, {
        size: SMALL,
        tone: "secondary",
        role: "stereotype",
        owner: id,
      });
      cy += 8;
    }
    if (node.kind === "package") cy += TAB / 2 - 2;
    // Component names center in the space left of the icon.
    const textX = icon === "component" ? box.x + (box.width - ICON + 4) / 2 : cx;
    shape.lines.forEach((line, index) =>
      text(line, textX, lineY(index, shape.lines.length, cy), { role: "node", owner: id }),
    );
  }

  // Three dots between the siblings declared before and after them, along the line that joins them.
  for (const dots_ of diagram.nodes.values()) {
    if (dots_.kind !== "dots") continue;
    const siblings = dots_.parent ? diagram.nodes.get(dots_.parent)!.children : diagram.roots,
      index = siblings.indexOf(dots_.id);
    const before = siblings.slice(0, index).findLast((id) => boxes.has(id)),
      after = siblings.slice(index + 1).find((id) => boxes.has(id));
    if (!before || !after) {
      // Dots at the end of a row were laid out as a node of their own.
      const own = boxes.get(dots_.id);
      if (own) dots(dots_.id, centerOf(own), vertical);
      continue;
    }
    // The declared neighbours normally sit side by side; when crossing minimization put another sibling between
    // them, the dots take the gap next to the declared neighbour in that row instead: they still read "more of these".
    const ca = centerOf(boxes.get(before)!),
      cb = centerOf(boxes.get(after)!);
    const across = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y),
      axis = across ? "x" : "y",
      cross = across ? "y" : "x";
    const row = siblings
      .filter((id) => boxes.has(id) && Math.abs(centerOf(boxes.get(id)!)[cross] - ca[cross]) < 4)
      .toSorted((p, q) => boxes.get(p)![axis] - boxes.get(q)![axis]);
    const at = row.indexOf(before),
      toward = ca[axis] <= cb[axis] ? 1 : -1;
    const neighbour = row[at + toward] ?? row[at - toward];
    if (!neighbour) continue;
    const [first, second] = [boxes.get(before)!, boxes.get(neighbour)!].toSorted(
      (p, q) => p[axis] - q[axis],
    );
    const gap = across
      ? { x: (first.x + first.width + second.x) / 2, y: ca.y }
      : { x: ca.x, y: (first.y + first.height + second.y) / 2 };
    dots(dots_.id, gap, across);
  }

  // Connections.
  // Straight wires are always orthogonal: any slanted step gets a corner.
  const wire = (edge: TamEdge, points: Point[], ends: string[], extra: Partial<SceneWire> = {}) =>
    scene.wires.push({
      edge: edge.id,
      points: extra.path ? points : square(points),
      ends,
      home: [...new Set(ends.flatMap((end) => chain(end)))],
      ...extra,
    });
  const head = (edge: TamEdge, from: Point, tip: Point, open = false, small = false) =>
    scene.markers.push({
      kind: open ? "open" : "arrow",
      tip,
      direction: unit(from, tip),
      wire: edge.id,
      ...(small ? { small } : {}),
    });
  const small = (
    value: string,
    x: number,
    y: number,
    options: Partial<SceneText> & Pick<SceneText, "role">,
  ) => {
    smallLines(scene, measure, value, x, y, options);
  };
  /**
   * "R" and its triangle in a reserved box, side by side along its longer side; the triangle leads in the
   * direction requests travel (TAM "R ▸"). Without a direction (requests both ways) the "R" stands alone.
   */
  const requestMarker = (box: Box, way: Point | undefined, owner: string) => {
    const center = centerOf(box);
    if (!way) {
      text("R", center.x, center.y, {
        size: MARK,
        tone: "ink",
        halo: "background",
        role: "marker",
        owner,
      });
      return;
    }
    const stacked = box.height > box.width,
      half = (stacked ? box.height : box.width) / 2 - GLYPH / 2;
    // Along the box: the triangle on the side requests travel toward (forward along it when they travel across it).
    const ahead = stacked ? way.y || 1 : way.x || 1;
    const spot = (offset: number): Point =>
      stacked ? { x: center.x, y: center.y + offset } : { x: center.x + offset, y: center.y };
    const r = spot(-ahead * half),
      triangle = spot(ahead * half);
    text("R", r.x, r.y, { size: MARK, tone: "ink", halo: "background", role: "marker", owner });
    scene.shapes.push({
      id: `${owner}#pointer`,
      kind: "pointer",
      box: { x: triangle.x - 3.5, y: triangle.y - 3.5, width: 7, height: 7 },
      container: false,
      depth: 0,
      fill: "ink",
      facing: way,
    });
  };
  const edgeLabel = (edge: TamEdge) => {
    const box = edgeLabels.get(edge.id);
    if (box && edge.label)
      small(edge.label, box.x + box.width / 2, box.y + box.height / 2, {
        role: "label",
        owner: edge.id,
      });
  };
  /** Distance from a straight segment to the nearest parallel wire, element, marker or text alongside it. */
  const freeBeside = (a: Point, b: Point, own: string, ends: string[]) => {
    const along = Math.abs(a.x - b.x) < 0.5 ? "y" : "x",
      across = along === "y" ? "x" : "y",
      at = a[across];
    const from = Math.min(a[along], b[along]),
      to = Math.max(a[along], b[along]);
    let free = Infinity;
    const consider = (low: number, high: number, start: number, end: number) => {
      if (Math.min(end, to) - Math.max(start, from) <= 0.5) return;
      free = Math.min(free, low > at ? low - at : high < at ? at - high : 0);
    };
    for (const [id, points] of routes) {
      if (id === own) continue;
      for (let i = 1; i < points.length; i++) {
        const p = points[i - 1],
          q = points[i];
        if (Math.abs(p[across] - q[across]) < 0.5)
          consider(
            p[across],
            p[across],
            Math.min(p[along], q[along]),
            Math.max(p[along], q[along]),
          );
      }
    }
    const size = along === "y" ? "height" : "width",
      side = along === "y" ? "width" : "height";
    const boxesAlong = [
      ...[...leaves, ...markers].filter((id) => !ends.includes(id)).map((id) => boxes.get(id)!),
      ...[...nodeLabels.values()].flat(),
      ...[...edgeLabels].filter(([id]) => id !== own).map(([, box]) => box),
    ];
    for (const box of boxesAlong)
      if (box) consider(box[across], box[across] + box[side], box[along], box[along] + box[size]);
    return free;
  };
  const channelCenters = new Map<string, Point>();
  for (const edge of diagram.edges) {
    if (edge.kind === "channel" || edge.kind === "assembly") {
      const node = `${edge.id}#node`,
        middle = centerOf(boxes.get(node)!);
      const a = routes.get(`${edge.id}:a`),
        b = routes.get(`${edge.id}:b`);
      if (!a || !b) continue;
      const toSource = reverse(snapEnd(a, middle)),
        toTarget = reverse(snapEnd(reverse(b), middle));
      const ends = [edge.source, edge.target, node];
      if (edge.kind === "assembly") {
        // The requirer's line ends in a socket around the provider's ball.
        wire(edge, reverse(toSource), ends);
        wire(edge, trimEnd(reverse(toTarget), BALL), ends);
        scene.markers.push({
          kind: "socket",
          tip: middle,
          direction: unit(toSource[1], toSource[0]),
          wire: edge.id,
        });
        channelCenters.set(edge.id, middle);
        circle(middle, BALL, node);
      } else {
        const radius = CHANNEL / 2;
        const inbound = trimEnd(reverse(toSource), radius),
          outbound = trimEnd(reverse(toTarget), radius);
        wire(edge, inbound, ends);
        wire(edge, reverse(outbound), ends);
        circle(middle, radius, node);
        channelCenters.set(edge.id, middle);
        // Data flow: one way draws heads into the circle and into the receiver; both ways draws heads at both outer ends.
        const flow = edge.flow;
        if (flow?.toTarget && !flow.toSource) {
          head(edge, inbound.at(-2)!, inbound.at(-1)!);
          head(edge, outbound.at(1)!, outbound[0]);
        }
        if (flow?.toSource && !flow.toTarget) {
          head(edge, outbound.at(-2)!, outbound.at(-1)!);
          head(edge, inbound[1], inbound[0]);
        }
        if (flow?.toSource && flow.toTarget) {
          head(edge, inbound[1], inbound[0]);
          head(edge, outbound[1], outbound[0]);
        }
      }
      // The request marker "R" (with a triangle pointing the way requests travel, or "R" alone both ways) and the
      // label are drawn in the boxes ELK reserved beside the circle; with a protocol, the label sits above the
      // dashed boundary line and the marker below it.
      const directions = edge.request
        ? [
            ...(edge.request.toTarget ? [unit(toTarget[0], toTarget[1])] : []),
            ...(edge.request.toSource ? [unit(toSource[0], toSource[1])] : []),
          ]
        : [];
      const axial = (d: Point) =>
        Math.abs(d.x) >= Math.abs(d.y) ? { x: Math.sign(d.x), y: 0 } : { x: 0, y: Math.sign(d.y) };
      const way = directions.length === 1 ? axial(directions[0]) : undefined;
      const glyph = directions.length ? markerSize(directions.length) : { width: 0, height: 0 };
      const textHeight = edge.label ? breaks(edge.label).length * SMALL_LINE : 0;
      const labels = nodeLabels.get(node) ?? [];
      let marker: Box | undefined,
        at: { x: number; y: number; anchor: "start" | "middle" } | undefined;
      if (edge.protocol && (edge.label || directions.length)) {
        if (vertical && labels[0]) {
          // One reserved box right of the circle: its upper half above the line, its lower half below.
          marker = { x: labels[0].x, y: middle.y + ASIDE, ...glyph };
          at = { x: labels[0].x, y: middle.y - ASIDE - textHeight / 2, anchor: "start" };
        } else if (!vertical) {
          // Boxes above and below the circle; their right halves are beside the vertical line.
          marker = labels[1]
            ? {
                x: middle.x + ASIDE,
                y: labels[1].y + (labels[1].height - glyph.height) / 2,
                ...glyph,
              }
            : undefined;
          at = labels[0]
            ? { x: middle.x + ASIDE, y: labels[0].y + labels[0].height / 2, anchor: "start" }
            : undefined;
        }
      } else if (vertical && labels[0]) {
        // One reserved box right of the circle: the marker, then the label.
        marker = { x: labels[0].x, y: middle.y - glyph.height / 2, ...glyph };
        at = {
          x: labels[0].x + (directions.length ? glyph.width + 8 : 0),
          y: middle.y,
          anchor: "start",
        };
      } else if (!vertical) {
        // The label above the circle, the marker below it.
        const label = edge.label ? labels[0] : undefined,
          below = directions.length ? labels[edge.label ? 1 : 0] : undefined;
        if (label)
          at = { x: label.x + label.width / 2, y: label.y + label.height / 2, anchor: "middle" };
        if (below)
          marker = {
            x: below.x + (below.width - glyph.width) / 2,
            y: below.y + (below.height - glyph.height) / 2,
            ...glyph,
          };
      }
      if (edge.label && at)
        small(edge.label, at.x, at.y, { anchor: at.anchor, role: "label", owner: node });
      if (directions.length && marker) requestMarker(marker, way, node);
      continue;
    }
    if (edge.kind === "modify") {
      const route = routes.get(edge.id);
      if (!route) continue;
      // The loop's two sides run along the access's route.
      const path = simplifyPath(route),
        ends = [edge.source, edge.target];
      // An end on a rounded shape moves along its side onto the curved outline.
      const meet = (point: Point, toward: Point, end: string) =>
        round.has(end) ? outline(point, toward, boxes.get(end)!, round.get(end)!) : point;
      if (path.length === 2) {
        // Straight: two mirror-image circular arcs bulging away from each other, "( )", heads on the arcs' tangents.
        const d = unit(path[0], path[1]),
          n = { x: -d.y, y: d.x };
        // The bulge fits the room beside the loop: the nearest parallel wire, element or text alongside keeps 6px.
        const room = freeBeside(path[0], path[1], edge.id, ends) - LOOP_END - 6;
        const fitted = Math.max(2, Math.min(BULGE, room));
        if (fitted < BULGE) fallback("loop-fitted");
        for (const side of [1, -1]) {
          const outward = { x: n.x * side, y: n.y * side };
          let a = meet(add(path[0], outward, LOOP_END), add(path[0], d, 1), edge.source),
            b = meet(add(path[1], outward, LOOP_END), add(path[1], d, -1), edge.target);
          // One side carries data to the target, the other back to the source.
          if (side < 0) [a, b] = [b, a];
          const chord = Math.hypot(b.x - a.x, b.y - a.y),
            bulge = Math.min(fitted, chord * 0.2);
          const radius = ((chord * chord) / 4 + bulge * bulge) / (2 * bulge),
            center = add({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, outward, bulge - radius);
          const travel = unit(a, b),
            sweep = travel.x * outward.y - travel.y * outward.x > 0 ? 0 : 1;
          const angle = (point: Point) => Math.atan2(point.y - center.y, point.x - center.x);
          const from = angle(a);
          let to = angle(b);
          if (sweep === 1 && to < from) to += 2 * Math.PI;
          if (sweep === 0 && to > from) to -= 2 * Math.PI;
          const samples = Array.from({ length: 9 }, (_, i) => {
            const t = from + ((to - from) * i) / 8;
            return { x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) };
          });
          const r = (value: number) => Math.round(value * 10) / 10;
          wire(edge, samples, ends, {
            path: `M${r(a.x)} ${r(a.y)}A${r(radius)} ${r(radius)} 0 0 ${sweep} ${r(b.x)} ${r(b.y)}`,
          });
          const radial = unit(center, b),
            tangent = sweep === 1 ? { x: -radial.y, y: radial.x } : { x: radial.y, y: -radial.x };
          head(edge, add(b, tangent, -8), b, false, true);
        }
      } else {
        // Bent: two parallel lines along the path with sharp corners, so they read as a pair of wires.
        for (const side of [1, -1]) {
          const line = offset(path, side * LOOP_END);
          line[0] = meet(line[0], line[1], edge.source);
          line[line.length - 1] = meet(line.at(-1)!, line.at(-2)!, edge.target);
          const way = side > 0 ? line : reverse(line);
          wire(edge, way, ends, { path: rounded(way, 0) });
          head(edge, way.at(-2)!, way.at(-1)!);
        }
      }
      edgeLabel(edge);
      continue;
    }
    if (edge.aside) {
      // A pointer between the storages of a row: straight across the gap, keyword above the line.
      const from = boxes.get(edge.source)!,
        to = boxes.get(edge.target)!;
      const across =
          Math.abs(centerOf(to).x - centerOf(from).x) >=
          Math.abs(centerOf(to).y - centerOf(from).y),
        axis = across ? "x" : "y",
        cross = across ? "y" : "x",
        extent = across ? "width" : "height",
        thick = across ? "height" : "width";
      const sign = centerOf(to)[axis] >= centerOf(from)[axis] ? 1 : -1;
      const level = (a: Box, b: Box) => {
        const low = Math.max(a[cross], b[cross]),
          high = Math.min(a[cross] + a[thick], b[cross] + b[thick]);
        return (low + high) / 2;
      };
      const at = level(from, to);
      const edgeOf = (box: Box, outward: number) => box[axis] + (outward > 0 ? box[extent] : 0);
      const start = { [axis]: edgeOf(from, sign), [cross]: at } as unknown as Point,
        end = { [axis]: edgeOf(to, -sign), [cross]: at } as unknown as Point;
      wire(edge, [start, end], [edge.source, edge.target], { dashed: true });
      head(edge, start, end, true);
      // The gap is as narrow as between any two elements, so a shared neighbour can reach both storages
      // with straight accesses; the keyword sits below the pair, centered on the line.
      if (edge.label) {
        const below =
          Math.max(from[cross] + from[thick], to[cross] + to[thick]) + SMALL_LINE / 2 + 4;
        small(
          edge.label,
          across ? (start.x + end.x) / 2 : below + 20,
          across ? below : (start.y + end.y) / 2,
          { role: "label", owner: edge.id },
        );
      }
      continue;
    }
    const route = routes.get(edge.id);
    if (!route) continue;
    const ends = [edge.source, edge.target];
    if (edge.kind === "provided" || edge.kind === "required") {
      const middle = centerOf(boxes.get(edge.target)!),
        shaped = snapEnd(route, middle);
      const facing = unit(shaped.at(-2)!, middle);
      wire(edge, edge.kind === "provided" ? trimEnd(shaped, BALL) : shaped, ends);
      if (edge.kind === "provided") circle(middle, BALL, edge.target);
      else scene.markers.push({ kind: "socket", tip: middle, direction: facing, wire: edge.id });
      const box = nodeLabels.get(edge.target)?.[0],
        name = diagram.nodes.get(edge.target)?.label;
      if (box && name) {
        if (vertical)
          text(name, box.x, middle.y, {
            size: SMALL,
            anchor: "start",
            tone: "secondary",
            halo: "background",
            role: "label",
            owner: edge.target,
          });
        else
          text(name, box.x + box.width / 2, box.y + box.height / 2, {
            size: SMALL,
            tone: "secondary",
            halo: "background",
            role: "label",
            owner: edge.target,
          });
      }
      continue;
    }
    wire(edge, route, ends, { dashed: edge.kind === "dependency" });
    if (edge.kind === "read") head(edge, route[1], route[0]);
    else
      head(
        edge,
        route.at(-2)!,
        route.at(-1)!,
        edge.kind === "dependency" || edge.kind === "delegation",
      );
    edgeLabel(edge);
  }

  // Container titles sit centered at the top (left of a component icon); a wire through the title stops at its halo.
  for (const { id, box, lines, subsystem, icon } of titled) {
    const stereotype = subsystem ? 16 : 0,
      width = Math.max(
        ...lines.map((line) => measure(line, FONT, 600)),
        subsystem ? measure("«subsystem»", SMALL, 400) : 0,
      );
    const cx = Math.min(
      box.x + box.width / 2,
      box.x + box.width - PAD - (icon ? 26 : 0) - width / 2,
    );
    if (stereotype)
      text("«subsystem»", cx, box.y + 15, {
        size: SMALL,
        tone: "secondary",
        role: "stereotype",
        owner: id,
      });
    lines.forEach((line, index) =>
      text(line, cx, box.y + TITLE_TOP + stereotype + LINE / 2 + index * LINE, {
        weight: 600,
        role: "title",
        owner: id,
      }),
    );
  }

  protocolBoundaries(diagram, scene, channelCenters, nodeLabels, vertical, measure);

  // Bounds cover every shape with its stack shadow, wire, socket and text, plus the title above.
  finishBounds(scene, measure, diagram.title, {
    shape: (shape) =>
      shape.stack
        ? { ...shape.box, width: shape.box.width + SHADOW, height: shape.box.height + SHADOW }
        : shape.box,
    marker: (marker) =>
      marker.kind === "socket"
        ? {
            x: marker.tip.x - SOCKET,
            y: marker.tip.y - SOCKET,
            width: 2 * SOCKET,
            height: 2 * SOCKET,
          }
        : undefined,
  });
  return scene;
}
