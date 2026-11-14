/** Wires in a scene: drawing them from ELK's routes, attaching their ends, spreading and straightening them. */

import {
  type Box,
  distance,
  grow,
  type Point,
  type Scene,
  type SceneShape,
  type SceneWire,
  segmentsCross,
  unit,
} from "./scene";
import { clipToOutline, entryPoint, outlineOf } from "./outline";
import { markerBounds, type MarkerKind } from "./markers";
import { type Measure } from "./text";
import type { Placement } from "./elk";
import { smallLines } from "./labels";
import { crossesBox } from "./audit";
import { followLabelClear } from "./marker-clear";
import { bendCandidates, runsAlong } from "./route";

/**
 * Turns an ELK placement into scene wires: ends meet the real outline of round,
 * elliptic and diamond shapes, markers sit at the ends, labels at the middle, and short end labels
 * (multiplicities, roles, guards) beside the ends where they collide with nothing.
 */

interface WireSpec {
  id: string;
  source: string;
  target: string;
  dashed?: boolean;
  thick?: boolean;
  startMarker?: MarkerKind;
  endMarker?: MarkerKind;
  /** Label at the middle, from the placement's edge label box. */
  label?: string;
  italic?: boolean;
  /** Labels beside the ends: multiplicities and roles. */
  startLabel?: string;
  endLabel?: string;
}

/** Index of shapes by id, with their containers for wire homes. */
interface ShapeIndex {
  get(id: string): SceneShape | undefined;
}

/** Corner radius a wire end meets on a shape's outline: round boxes and stadiums; 0 for the rest. */
function endRadius(shape: SceneShape): number {
  if (shape.kind === "round") return shape.radius ?? 10;
  return shape.kind === "stadium" ? shape.box.height / 2 : 0;
}

/** Moves a route end that misses a small round or diamond shape onto its center line. */
function onCenterLine(points: Point[], end: number, box: Box): Point[] {
  const copy = points.map((point) => ({ ...point })),
    neighbour = end === 0 ? 1 : copy.length - 2;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (Math.abs(copy[end].x - copy[neighbour].x) < 0.5) {
    copy[end].x = center.x;
    copy[neighbour].x = center.x;
  } else if (Math.abs(copy[end].y - copy[neighbour].y) < 0.5) {
    copy[end].y = center.y;
    copy[neighbour].y = center.y;
  }
  return copy;
}

/** Adds the wire for an edge; returns its final points, or null when ELK gave no route. */
export function addWire(
  scene: Scene,
  placement: Placement,
  spec: WireSpec,
  shapes: ShapeIndex,
  measure: Measure,
): Point[] | null {
  const route = placement.routes.get(spec.id);
  if (!route || route.length < 2) return null;
  let points: Point[] = route;
  for (const [end, id] of [
    [0, spec.source],
    [points.length - 1, spec.target],
  ] as const) {
    const shape = shapes.get(id);
    if (!shape || shape.container) continue;
    const radius = endRadius(shape);
    if (outlineOf(shape.kind) === "box" && !radius) continue;
    // A wire into a small round or diamond shape aims at its center line when it is the only one on
    // that side; others keep ELK's spot and meet the slanted outline.
    const side = (point: Point) =>
      Math.abs(point.y - shape.box.y) < 1
        ? "top"
        : Math.abs(point.y - shape.box.y - shape.box.height) < 1
          ? "bottom"
          : Math.abs(point.x - shape.box.x) < 1
            ? "left"
            : "right";
    const mine = side(points[end]);
    const crowded = [...placement.routes].some(
      ([other, route]) =>
        other !== spec.id &&
        placement.edges.get(other)?.source !== placement.edges.get(other)?.target &&
        [
          [placement.edges.get(other)?.source, route[0]],
          [placement.edges.get(other)?.target, route.at(-1)!],
        ].some(([node, point]) => node === id && side(point as Point) === mine),
    );
    const small =
      !crowded &&
      outlineOf(shape.kind) !== "box" &&
      Math.max(shape.box.width, shape.box.height) <= 40;
    const clipped: Point[] | null =
      clipToOutline(
        small ? onCenterLine(points, end, shape.box) : points,
        end,
        shape.kind,
        shape.box,
        radius,
      ) ?? clipToOutline(onCenterLine(points, end, shape.box), end, shape.kind, shape.box, radius);
    if (clipped) points = clipped;
  }
  const home = [
    ...new Set(
      [spec.source, spec.target].flatMap((id) => [id, ...(placement.ancestors.get(id) ?? [])]),
    ),
  ];
  const ends = [...new Set([spec.source, spec.target])];
  scene.wires.push({
    edge: spec.id,
    points,
    dashed: spec.dashed,
    thick: spec.thick,
    ends,
    home,
    from: spec.source,
    to: spec.target,
  });
  if (spec.startMarker)
    scene.markers.push({
      kind: spec.startMarker,
      tip: points[0],
      direction: unit(points[1], points[0]),
      wire: spec.id,
    });
  if (spec.endMarker)
    scene.markers.push({
      kind: spec.endMarker,
      tip: points.at(-1)!,
      direction: unit(points.at(-2)!, points.at(-1)!),
      wire: spec.id,
    });
  const box = placement.edgeLabels.get(spec.id);
  if (spec.label && box)
    smallLines(scene, measure, spec.label, box.x + box.width / 2, box.y + box.height / 2, {
      role: "label",
      owner: spec.id,
      italic: spec.italic,
    });
  return points;
}

/** Whether two segments cross at a point inside both. */

/** Replaces a wire's points and moves the markers at its ends along. */
function reroute(scene: Scene, wire: Scene["wires"][number], points: Point[]) {
  const [oldStart, oldEnd] = [wire.points[0], wire.points.at(-1)!];
  wire.points = points;
  for (const marker of scene.markers) {
    if (marker.wire !== wire.edge) continue;
    if (distance(marker.tip, oldStart) < 0.75) {
      marker.tip = points[0];
      marker.direction = unit(points[1], points[0]);
    } else if (distance(marker.tip, oldEnd) < 0.75) {
      marker.tip = points.at(-1)!;
      marker.direction = unit(points.at(-2)!, points.at(-1)!);
    }
  }
}

/** Drops points in the middle of straight runs. */
function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    result.push(point);
    while (result.length >= 3) {
      const [a, b, c] = result.slice(-3);
      if (
        (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) ||
        (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)
      )
        result.splice(-2, 1);
      else break;
    }
  }
  return result;
}

/**
 * Every wire at a diamond (decision, merge, choice) starts or ends exactly on one of its vertices,
 * as UML draws them (TAM flyer); small circles take their wires at the same four points. On each
 * side the wire nearest the middle takes that side's vertex, shifting its first segment sideways
 * (and its other end along the other shape's side when the wire is straight); the others turn
 * into a free vertex toward their other end, or get a short orthogonal detour to one.
 */
export function spreadVertices(scene: Scene) {
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  for (const shape of scene.shapes) {
    const round =
      outlineOf(shape.kind) === "ellipse" && Math.max(shape.box.width, shape.box.height) <= 40;
    if (shape.container || !(shape.kind === "diamond" || round)) continue;
    const { x, y, width, height } = shape.box,
      cx = x + width / 2,
      cy = y + height / 2;
    const vertices = [
      { x: cx, y },
      { x: x + width, y: cy },
      { x: cx, y: y + height },
      { x, y: cy },
    ];
    const normals = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];
    type End = { wire: Scene["wires"][number]; atStart: boolean; side: number; offset: number };
    const ends: End[] = [];
    for (const wire of scene.wires) {
      for (const atStart of [true, false]) {
        if (
          (atStart ? wire.from : wire.to) !== shape.id ||
          wire.points.length < 2 ||
          wire.from === wire.to
        )
          continue;
        const point = atStart ? wire.points[0] : wire.points.at(-1)!,
          next = atStart ? wire.points[1] : wire.points.at(-2)!;
        const upright = Math.abs(next.x - point.x) < 0.5;
        const side = upright ? (next.y < point.y ? 0 : 2) : next.x > point.x ? 1 : 3;
        ends.push({
          wire,
          atStart,
          side,
          offset: upright ? Math.abs(point.x - cx) : Math.abs(point.y - cy),
        });
      }
    }
    const used = new Set<number>();
    const oriented = (end: End) =>
      end.atStart ? end.wire.points : [...end.wire.points].toReversed();
    const apply = (end: End, points: Point[]) =>
      reroute(scene, end.wire, end.atStart ? points : points.toReversed());
    const other = (end: End) => shapes.get((end.atStart ? end.wire.to : end.wire.from) ?? "");
    /** The route moved onto the side's vertex by shifting its first segment sideways. */
    const shifted = (end: End, side: number): Point[] | null => {
      const points = oriented(end).map((point) => ({ ...point })),
        upright = side % 2 === 0,
        v = vertices[side];
      if (points.length === 2) {
        // A straight wire: its other end slides along the other shape's side, if it stays on it.
        const far = other(end),
          q = points[1];
        const moved = upright ? { x: v.x, y: q.y } : { x: q.x, y: v.y };
        if (
          !far ||
          far.container ||
          (upright
            ? moved.x < far.box.x + 3 || moved.x > far.box.x + far.box.width - 3
            : moved.y < far.box.y + 3 || moved.y > far.box.y + far.box.height - 3)
        )
          return null;
        if (outlineOf(far.kind) !== "box" && far.kind !== "round") return null;
        return [{ ...v }, moved];
      }
      if (upright) points[1].x = v.x;
      else points[1].y = v.y;
      points[0] = { ...v };
      return simplify(points);
    };
    /** A route leaving through vertex `side`: a short stub out, then a corner to the route's next point. */
    const detour = (end: End, side: number): Point[][] => {
      const route = oriented(end),
        v = vertices[side],
        n = normals[side];
      const stub = { x: v.x + n.x * 14, y: v.y + n.y * 14 };
      const rest = route.length > 2 ? route.slice(2) : route.slice(1),
        target = rest[0];
      return [
        [v, stub, { x: stub.x, y: target.y }, ...rest],
        [v, stub, { x: target.x, y: stub.y }, ...rest],
      ]
        .map(simplify)
        .filter((points) =>
          points.slice(1).every((point, index) => {
            const p = points[index];
            return Math.abs(p.x - point.x) < 0.5 || Math.abs(p.y - point.y) < 0.5;
          }),
        );
    };
    const pending: End[] = [];
    for (let side = 0; side < 4; side++) {
      const group = ends.filter((end) => end.side === side).toSorted((a, b) => a.offset - b.offset);
      if (!group.length) continue;
      const first = group[0];
      if (first.offset < 0.5) used.add(side);
      else {
        const next = shifted(first, side);
        if (next && clearRoute(scene, first.wire, next, group.length > 1)) {
          apply(first, next);
          used.add(side);
        } else pending.push(first);
      }
      pending.push(...group.slice(1));
    }
    for (const end of pending) {
      const route = oriented(end),
        acrossX = end.side % 2 === 0,
        turn = route[Math.min(2, route.length - 1)];
      // The free vertex facing the wire's other end first, then the others.
      const facing = acrossX ? (turn.x < cx ? 3 : 1) : turn.y < cy ? 0 : 2;
      const order = [facing, end.side, (facing + 2) % 4, (end.side + 2) % 4].filter(
        (side, index, all) => all.indexOf(side) === index && !used.has(side),
      );
      // Without new crossings first; else the vertex rule still holds where a route hits nothing.
      search: for (const strict of [true, false])
        for (const side of order) {
          const candidates = [
            ...(side === end.side ? [shifted(end, side)] : []),
            ...detour(end, side),
          ];
          const route = candidates.find(
            (points) => points && clearRoute(scene, end.wire, points, strict),
          );
          if (route) {
            apply(end, route);
            used.add(side);
            break search;
          }
        }
    }
    // Self loops take two free vertices: around the corner between neighbouring ones (right and top
    // first), else around one of the other sides between opposite ones.
    const loops = scene.wires.filter((wire) => wire.from === shape.id && wire.to === shape.id);
    loops.forEach((wire, index) => {
      const reach = 14 + 10 * index,
        half = { x: width / 2 + reach, y: height / 2 + reach };
      const out = (side: number) => ({
        x: cx + normals[side].x * half.x,
        y: cy + normals[side].y * half.y,
      });
      const corner = (a: number, b: number) => ({
        x: cx + (normals[a].x + normals[b].x) * half.x,
        y: cy + (normals[a].y + normals[b].y) * half.y,
      });
      // [from, to, side passed]: the passed side is only crossed by opposite pairs.
      const ways: [number, number, number | null][] = [
        [0, 1, null],
        [1, 2, null],
        [3, 0, null],
        [2, 3, null],
        [3, 1, 0],
        [3, 1, 2],
        [0, 2, 1],
        [0, 2, 3],
      ];
      const usable = ways.filter(([a, b]) => !used.has(a) && !used.has(b));
      const routes = usable.map(([a, b, pass]) =>
        pass === null
          ? [{ ...vertices[a] }, out(a), corner(a, b), out(b), { ...vertices[b] }]
          : [
              { ...vertices[a] },
              out(a),
              corner(a, pass),
              corner(b, pass),
              out(b),
              { ...vertices[b] },
            ],
      );
      const chosen =
        routes.find((points) => clearRoute(scene, wire, points)) ??
        routes.find((points) => clearRoute(scene, wire, points, false));
      if (!chosen) return;
      reroute(scene, wire, chosen);
      const [a, b] = usable[routes.indexOf(chosen)];
      used.add(a);
      used.add(b);
    });
  }
}

/** Whether a new route for a wire stays off shapes, text and other wires and crosses no more wires than before. */
function clearRoute(
  scene: Scene,
  wire: Scene["wires"][number],
  points: Point[],
  strict = true,
): boolean {
  const others = scene.wires.filter((other) => other !== wire);
  const own = new Set(wire.ends);
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    if (
      scene.shapes.some(
        (shape) =>
          !shape.container &&
          !shape.passable &&
          shape.kind !== "region" &&
          !own.has(shape.id) &&
          crossesBox(a, b, grow(shape.box, 2)),
      )
    )
      return false;
    if (
      scene.shapes.some(
        (shape) => shape.container && !wire.home.includes(shape.id) && crossesBox(a, b, shape.box),
      )
    )
      return false;
    if (scene.texts.some((text) => text.owner !== wire.edge && crossesBox(a, b, grow(text.box, 1))))
      return false;
    // Other connections' arrowheads and markers are drawn things too: a rerouted wire keeps off them.
    if (
      scene.markers.some(
        (marker) =>
          marker.wire !== wire.edge &&
          crossesBox(
            a,
            b,
            grow(markerBounds(marker.kind, marker.tip, marker.direction, marker.small), 2),
          ),
      )
    )
      return false;
    if (
      others.some((other) =>
        other.points.slice(1).some((q, j) => runsAlong(a, b, other.points[j], q)),
      )
    )
      return false;
  }
  if (!strict) return true;
  const count = (route: Point[]) =>
    route
      .slice(1)
      .reduce(
        (sum, point, index) =>
          sum +
          others.reduce(
            (inner, other) =>
              inner +
              other.points
                .slice(1)
                .filter((q, j) => segmentsCross(route[index], point, other.points[j], q)).length,
            0,
          ),
        0,
      );
  return count(points) <= count(wire.points);
}

/** Final pass: every wire end that should touch a round or diamond shape meets its outline. */
export function attachEnds(scene: Scene) {
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  for (const wire of scene.wires) {
    let points = wire.points;
    for (const [id, end] of [
      [wire.from, 0],
      [wire.to, points.length - 1],
    ] as const) {
      const shape = id ? shapes.get(id) : undefined;
      if (!shape || shape.container || points.length < 2) continue;
      const radius = endRadius(shape);
      if (outlineOf(shape.kind) === "box" && !radius) continue;
      const neighbour = end === 0 ? 1 : points.length - 2;
      // Back the end out to the bounding box first, then in to the outline.
      const d = unit(points[neighbour], points[end]);
      const far = {
        x: points[end].x + d.x * (shape.box.width + shape.box.height),
        y: points[end].y + d.y * (shape.box.width + shape.box.height),
      };
      const hit = entryPoint(points[neighbour], far, shape.kind, shape.box, radius);
      if (hit && distance(hit, points[end]) > 0.75 && distance(hit, points[neighbour]) > 2) {
        points = points.map((point, index) => (index === end ? hit : point));
      }
    }
    if (points !== wire.points) reroute(scene, wire, points);
  }
}

/**
 * Straightening on the finished scene, for every diagram type (after ELK, after the swimlane
 * router, after vertex snapping): a wire between two shapes that overlap across the line becomes
 * one straight segment, else bends no more than its ends need (an L or a Z). As in TAM, a change is
 * kept only if the wire stays off other shapes, text and foreign containers, keeps `gap` from
 * parallel wires and crosses no more wires than before; its label moves with it.
 */
export function straightenScene(scene: Scene, gap = 9) {
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  for (let pass = 0; pass < 2; pass++) {
    for (const wire of scene.wires) {
      if (wire.points.length <= 2 || !wire.from || !wire.to || wire.from === wire.to) continue;
      const a = shapes.get(wire.from),
        b = shapes.get(wire.to);
      if (!a || !b || a.container || b.container) continue;
      const candidates = [...straightCandidates(wire.points, a, b), ...bendCandidates(wire.points)];
      for (const points of candidates) {
        if (!clearRoute(scene, wire, points) || crowded(scene, wire, points, gap)) continue;
        const before = wire.points;
        reroute(scene, wire, points);
        if (followLabelClear(scene, wire)) break;
        reroute(scene, wire, before);
      }
    }
  }
}

/** Straight segments between two shapes along each axis where they overlap; symbols only through their center. */
function straightCandidates(route: Point[], a: SceneShape, b: SceneShape): Point[][] {
  const result: Point[][] = [];
  const symbol = (shape: SceneShape) =>
    outlineOf(shape.kind) !== "box" && Math.max(shape.box.width, shape.box.height) <= 40;
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height",
      along = axis === "x" ? "y" : "x",
      alongSize = axis === "x" ? "height" : "width";
    const margin = (shape: SceneShape) =>
      shape.kind === "round"
        ? Math.max(6, (shape.radius ?? 10) * 0.6)
        : outlineOf(shape.kind) === "box"
          ? 6
          : 0;
    const centers = [a, b].filter(symbol).map((shape) => shape.box[axis] + shape.box[size] / 2);
    const low = Math.max(a.box[axis] + margin(a), b.box[axis] + margin(b)),
      high = Math.min(a.box[axis] + a.box[size] - margin(a), b.box[axis] + b.box[size] - margin(b));
    if (high < low) continue;
    const mid = (low + high) / 2;
    const options = centers.length
      ? centers
      : [
          ...new Set([
            ...route.map((point) => point[axis]),
            mid,
            mid - 10,
            mid + 10,
            mid - 20,
            mid + 20,
          ]),
        ].filter((at) => at >= low && at <= high);
    for (const at of options) {
      if (at < low - 0.5 || at > high + 0.5) continue;
      // The two shapes must be apart along the line.
      const [first, second] = a.box[along] <= b.box[along] ? [a, b] : [b, a];
      if (first.box[along] + first.box[alongSize] > second.box[along] - 4) continue;
      const point = (value: number): Point =>
        axis === "x" ? { x: at, y: value } : { x: value, y: at };
      const start = point(first.box[along] + first.box[alongSize]),
        end = point(second.box[along]);
      let points = first === a ? [start, end] : [end, start];
      // Onto the real outlines.
      for (const [end, shape] of [
        [0, a],
        [1, b],
      ] as const)
        points =
          clipToOutline(
            points,
            end,
            shape.kind,
            shape.box,
            shape.kind === "round" ? (shape.radius ?? 10) : 0,
          ) ?? points;
      result.push(points);
    }
  }
  return result;
}

/** Whether a route runs closer than `gap` alongside another wire. */
function crowded(scene: Scene, wire: SceneWire, points: Point[], gap: number): boolean {
  return scene.wires.some(
    (other) =>
      other !== wire &&
      other.points
        .slice(1)
        .some((q, j) =>
          points.slice(1).some((p, i) => runsAlong(points[i], p, other.points[j], q, gap)),
        ),
  );
}
