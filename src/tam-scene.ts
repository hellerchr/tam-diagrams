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
  drawNote,
  finishBounds,
  FONT,
  LINE,
  MARK,
  type Measure,
  SMALL,
  SMALL_LINE,
} from "./text.ts";
import { isStorage, type TamEdge, type TamNode } from "./tam.ts";
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
  type Shape,
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

/** A container's title, drawn once every shape and wire is: centered at its top, left of a component icon. */
interface Title {
  id: string;
  box: Box;
  lines: string[];
  subsystem: boolean;
  icon: boolean;
}

/** A scene as it is drawn from the final geometry. */
interface Drawing {
  prepared: TamGraph;
  geometry: TamGeometry;
  measure: Measure;
  scene: Scene;
  titled: Title[];
  /** The middle of each channel's and connector's circle, for the protocol boundaries through them. */
  channelCenters: Map<string, Point>;
}

/** Builds the scene from the final geometry: shapes, titles, wires, markers, labels and protocol boundaries. */
export function tamScene(prepared: TamGraph, geometry: TamGeometry, measure: Measure): Scene {
  const { diagram, vertical } = prepared;
  const drawing: Drawing = {
    prepared,
    geometry,
    measure,
    scene: { ...emptyScene(), orthogonal: true },
    titled: [],
    channelCenters: new Map(),
  };
  // Shapes, outside-in so containers paint first.
  const order: string[] = [];
  const collect = (id: string) => {
    order.push(id);
    diagram.nodes.get(id)!.children.forEach(collect);
  };
  diagram.roots.forEach(collect);
  for (const id of order) drawElement(drawing, id);
  // Three dots between the siblings declared before and after them, along the line that joins them.
  for (const dots of diagram.nodes.values()) if (dots.kind === "dots") drawDots(drawing, dots);
  for (const edge of diagram.edges) drawEdge(drawing, edge);
  for (const title of drawing.titled) drawTitle(drawing, title);
  // A boundary crosses its channels' wires: placed by hand they run either way, so each way gets its boundaries.
  for (const upright of geometry.upright ? [true, false] : [vertical])
    drawBoundaries(drawing, upright);
  // Bounds cover every shape with its stack shadow, wire, socket and text, plus the title above.
  finishBounds(drawing.scene, measure, diagram.title, { shape: shadowed, marker: socketBox });
  return drawing.scene;
}

/** The protocol boundaries through the circles on wires that run up or down, or across. */
function drawBoundaries(drawing: Drawing, upright: boolean) {
  const { prepared, geometry, measure } = drawing;
  protocolBoundaries(
    prepared.diagram,
    drawing.scene,
    new Map(
      [...drawing.channelCenters].filter(
        ([edge]) => uprightAt(drawing, `${edge}#node`) === upright,
      ),
    ),
    geometry.nodeLabels,
    upright,
    measure,
  );
}

/** A shape's box with its stack shadow. */
const shadowed = (shape: SceneShape) =>
  shape.stack
    ? { ...shape.box, width: shape.box.width + SHADOW, height: shape.box.height + SHADOW }
    : shape.box;

/** The box a socket takes around its tip; other markers count as they are. */
const socketBox = (marker: Scene["markers"][number]) =>
  marker.kind === "socket"
    ? { x: marker.tip.x - SOCKET, y: marker.tip.y - SOCKET, width: 2 * SOCKET, height: 2 * SOCKET }
    : undefined;

/** Whether the wire at a channel or connector runs up or down: its label then stands beside it. */
const uprightAt = ({ geometry, prepared }: Drawing, id: string) =>
  geometry.upright?.get(id) ?? prepared.vertical;

/** Channel circles and interface balls are small shapes named after their marker node. */
const circle = ({ scene }: Drawing, center: Point, radius: number, owner: string) =>
  scene.shapes.push({
    id: owner,
    kind: "circle",
    box: { x: center.x - radius, y: center.y - radius, width: 2 * radius, height: 2 * radius },
    container: false,
    depth: 0,
    fill: "page",
  });

/** Three dots along `across` (or down), for "more of these". */
const dotsShape = ({ scene }: Drawing, id: string, center: Point, across: boolean) =>
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

type TextOptions = Partial<SceneText> & Pick<SceneText, "role">;

/** A text in the scene, measured as it is drawn. */
const text = (drawing: Drawing, value: string, x: number, y: number, options: TextOptions) => {
  addText(drawing.scene, drawing.measure, value, x, y, options);
};

/** Small text, broken into its lines. */
const small = (drawing: Drawing, value: string, x: number, y: number, options: TextOptions) => {
  smallLines(drawing.scene, drawing.measure, value, x, y, options);
};

const lineY = (index: number, count: number, center: number, height = LINE) =>
  center + (index - (count - 1) / 2) * height;

/** Draws an element: its shape, and its name inside it or its title for later. */
function drawElement(drawing: Drawing, id: string) {
  const { prepared, geometry, scene, measure } = drawing,
    shape = prepared.shapes.get(id),
    full = geometry.boxes.get(id);
  // Interfaces and channels are drawn with their connections.
  if (!shape || !full || shape.node.kind === "interface" || shape.node.kind === "dots") return;
  const { node } = shape;
  if (id.endsWith("#row")) return;
  if (node.kind === "note") {
    drawNote(scene, measure, id, shape.lines.join("<br>"), full, {
      depth: shape.depth,
      color: node.color,
    });
    return;
  }
  const box = node.stack
    ? { ...full, width: full.width - SHADOW, height: full.height - SHADOW }
    : full;
  const icon = ICONS[node.kind];
  scene.shapes.push(elementShape(drawing, shape, box, icon));
  if (shape.container) addTitle(drawing, shape, box, icon);
  else drawName(drawing, shape, box, icon);
}

/** The icon each kind of element carries. */
const ICONS: Partial<Record<string, SceneShape["icon"]>> = {
  component: "component",
  subsystem: "component",
  human: "human",
};

/** The shape of an element: its kind, fill, tint, tab, stack and icon. */
function elementShape(drawing: Drawing, shape: Shape, box: Box, icon: SceneShape["icon"]) {
  const { node } = shape,
    storage = isStorage(node),
    tab = tabOf(drawing, shape, box),
    color = tintOf(drawing, shape);
  // Storages are pills, storage containers and passive groups rounded, groups thin frames that show what is behind them.
  const thin = node.kind === "group";
  const kind = shapeKind(tab !== undefined, storage, shape.container, thin);
  return {
    id: node.id,
    kind,
    box,
    container: shape.container,
    depth: shape.depth,
    fill: fillOf(shape),
    ...(kind === "round" ? { radius: storage ? 18 : 4 } : {}),
    ...(tab !== undefined ? { tab: { width: tab, height: TAB } } : {}),
    ...(thin ? { thin } : {}),
    ...(color ? { color } : {}),
    ...(node.stack ? { stack: true } : {}),
    ...(icon ? { icon } : {}),
  } satisfies SceneShape;
}

/**
 * What an element is filled with: a container a shade, a leaf the page. A group is a thin frame
 * that shows what is behind it; given a color of its own, it is highlighted with a tint of it.
 */
function fillOf({ node, container }: Shape): SceneShape["fill"] {
  if (node.kind === "group") return node.color ? "shade" : "none";
  return container ? "shade" : "page";
}

/** The kind of shape an element is drawn as. */
function shapeKind(
  tab: boolean,
  storage: boolean,
  container: boolean,
  thin: boolean,
): SceneShape["kind"] {
  if (tab) return "folder";
  if (storage) return container ? "round" : "stadium";
  return thin ? "round" : "rect";
}

/** The width of a package's tab: as wide as its name on a container. */
function tabOf({ measure }: Drawing, { node, container }: Shape, box: Box) {
  if (node.kind !== "package") return undefined;
  return Math.min(box.width - 12, container ? measure(node.label, SMALL, 600) + 20 : 40);
}

/** A container's tint carries over to the containers inside it, one shade deeper per level. */
function tintOf({ prepared: { diagram } }: Drawing, { node, container }: Shape) {
  let color = node.color;
  for (
    let parent = node.parent ? diagram.nodes.get(node.parent) : undefined;
    !color && container && parent;
    parent = parent.parent ? diagram.nodes.get(parent.parent) : undefined
  )
    color = parent.color;
  return color;
}

/** A package's name stands in its tab; any other container's title is drawn last. */
function addTitle(drawing: Drawing, shape: Shape, box: Box, icon: SceneShape["icon"]) {
  const { node, lines } = shape;
  if (node.kind === "package")
    text(drawing, node.label, box.x + 10, box.y + TAB / 2, {
      size: SMALL,
      weight: 600,
      anchor: "start",
      role: "title",
      owner: node.id,
    });
  else if (lines.length)
    drawing.titled.push({
      id: node.id,
      box,
      lines,
      subsystem: node.kind === "subsystem",
      icon: !!icon,
    });
}

/** The name of a leaf, in the middle of what its shape leaves free. */
function drawName(drawing: Drawing, shape: Shape, box: Box, icon: SceneShape["icon"]) {
  const { node } = shape,
    id = node.id;
  let cy = box.y + box.height / 2;
  if (node.kind === "human") cy = box.y + 40 + (box.height - 46) / 2;
  if (node.kind === "subsystem") {
    text(drawing, "«subsystem»", box.x + (box.width - ICON + 4) / 2, box.y + 15, {
      size: SMALL,
      tone: "secondary",
      role: "stereotype",
      owner: id,
    });
    cy += 8;
  }
  if (node.kind === "package") cy += TAB / 2 - 2;
  // Component names center in the space left of the icon.
  const textX = icon === "component" ? box.x + (box.width - ICON + 4) / 2 : box.x + box.width / 2;
  shape.lines.forEach((line, index) =>
    text(drawing, line, textX, lineY(index, shape.lines.length, cy), { role: "node", owner: id }),
  );
}

/** Draws three dots: where the geometry sets them, at the end of a row, or between their neighbours. */
function drawDots(drawing: Drawing, dots: TamNode) {
  const { prepared, geometry } = drawing,
    { diagram } = prepared,
    { boxes } = geometry;
  const set = geometry.dots?.get(dots.id);
  if (set) {
    dotsShape(drawing, dots.id, set.center, set.across);
    return;
  }
  const siblings = dots.parent ? diagram.nodes.get(dots.parent)!.children : diagram.roots,
    index = siblings.indexOf(dots.id);
  // Notes stand beside the elements they remark on and are no neighbours of the dots.
  const real = (id: string) => boxes.has(id) && diagram.nodes.get(id)?.kind !== "note";
  const before = siblings.slice(0, index).findLast(real),
    after = siblings.slice(index + 1).find(real);
  if (before && after) {
    const { center, across } = dotsGap(drawing, siblings.filter(real), before, after);
    dotsShape(drawing, dots.id, center, across);
    return;
  }
  // Dots at the end of a row were laid out as a node of their own.
  const own = boxes.get(dots.id);
  if (own) dotsShape(drawing, dots.id, centerOf(own), prepared.vertical);
}

/**
 * Where dots stand between their declared neighbours. These normally sit side by side; when
 * crossing minimization put another sibling between them, the dots take the gap next to the
 * declared neighbour in that row instead: they still read "more of these". The geometry passes may
 * have moved the elements of a row apart across it: a row is every sibling level with the declared
 * neighbour, and the dots stand on the declared neighbour's center line, within the level the two
 * elements beside them share.
 */
function dotsGap(
  { geometry: { boxes } }: Drawing,
  siblings: string[],
  before: string,
  after: string,
) {
  const ca = centerOf(boxes.get(before)!),
    cb = centerOf(boxes.get(after)!);
  const across = Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y),
    axis = across ? "x" : "y",
    cross = across ? "y" : "x",
    thick = across ? "height" : "width";
  const level = (p: Box, q: Box) => ({
    low: Math.max(p[cross], q[cross]),
    high: Math.min(p[cross] + p[thick], q[cross] + q[thick]),
  });
  const home = boxes.get(before)!;
  const row = siblings
    .filter((id) => {
      const shared = level(home, boxes.get(id)!);
      return shared.high - shared.low > 0;
    })
    .toSorted((p, q) => boxes.get(p)![axis] - boxes.get(q)![axis]);
  const at = row.indexOf(before),
    toward = ca[axis] <= cb[axis] ? 1 : -1;
  const neighbour = row[at + toward] ?? row[at - toward];
  // Without a sibling level with the declared neighbour, the dots stand in the gap between the two neighbours.
  const [first, second] = [home, boxes.get(neighbour ?? after)!].toSorted(
    (p, q) => p[axis] - q[axis],
  );
  const shared = level(first, second),
    middle =
      shared.high - shared.low >= 8
        ? Math.min(Math.max(ca[cross], shared.low + 4), shared.high - 4)
        : (centerOf(first)[cross] + centerOf(second)[cross]) / 2;
  return {
    across,
    center: across
      ? { x: (first.x + first.width + second.x) / 2, y: middle }
      : { x: middle, y: (first.y + first.height + second.y) / 2 },
  };
}

/** Straight wires are always orthogonal: any slanted step gets a corner. */
const wire = (
  { scene, prepared }: Drawing,
  edge: TamEdge,
  points: Point[],
  ends: string[],
  extra: Partial<SceneWire> = {},
) =>
  scene.wires.push({
    edge: edge.id,
    points: extra.path ? points : square(points),
    ends,
    home: [...new Set(ends.flatMap((end) => prepared.chain(end)))],
    ...extra,
  });

/** An arrowhead at the end of a wire; `open` for a dependency or delegation, `small` on a loop's arc. */
const head = (
  { scene }: Drawing,
  edge: TamEdge,
  from: Point,
  tip: Point,
  open = false,
  small = false,
) =>
  scene.markers.push({
    kind: open ? "open" : "arrow",
    tip,
    direction: unit(from, tip),
    wire: edge.id,
    ...(small ? { small } : {}),
  });

/**
 * "R" and its triangle in a reserved box, side by side along its longer side; the triangle leads in the
 * direction requests travel (TAM "R ▸"). Without a direction (requests both ways) the "R" stands alone.
 */
function requestMarker(drawing: Drawing, box: Box, way: Point | undefined, owner: string) {
  const center = centerOf(box);
  if (!way) {
    text(drawing, "R", center.x, center.y, {
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
  text(drawing, "R", r.x, r.y, {
    size: MARK,
    tone: "ink",
    halo: "background",
    role: "marker",
    owner,
  });
  drawing.scene.shapes.push({
    id: `${owner}#pointer`,
    kind: "pointer",
    box: { x: triangle.x - 3.5, y: triangle.y - 3.5, width: 7, height: 7 },
    container: false,
    depth: 0,
    fill: "ink",
    facing: way,
  });
}

/** A connection's label, in the room the geometry keeps for it. */
function edgeLabel(drawing: Drawing, edge: TamEdge) {
  const box = drawing.geometry.edgeLabels.get(edge.id);
  if (box && edge.label)
    small(drawing, edge.label, box.x + box.width / 2, box.y + box.height / 2, {
      role: "label",
      owner: edge.id,
    });
}

/** A straight run of wire, as the axis it runs along and the span it covers there. */
interface Stretch {
  along: "x" | "y";
  across: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/** How far a box or run that lies alongside a stretch stands from it; Infinity for one that does not lie alongside it. */
function distance(stretch: Stretch, low: number, high: number, start: number, end: number) {
  const { at, from, to } = stretch;
  if (Math.min(end, to) - Math.max(start, from) <= 0.5) return Infinity;
  return low > at ? low - at : high < at ? at - high : 0;
}

/** Distance from a straight segment to the nearest parallel wire, element, marker or text alongside it. */
function freeBeside(drawing: Drawing, a: Point, b: Point, own: string, ends: string[]) {
  const along = Math.abs(a.x - b.x) < 0.5 ? "y" : "x",
    across = along === "y" ? "x" : "y";
  const stretch: Stretch = {
    along,
    across,
    at: a[across],
    from: Math.min(a[along], b[along]),
    to: Math.max(a[along], b[along]),
  };
  const size = along === "y" ? "height" : "width",
    side = along === "y" ? "width" : "height";
  let free = wiresBeside(drawing, stretch, own);
  for (const box of boxesBeside(drawing, own, ends))
    if (box)
      free = Math.min(
        free,
        distance(stretch, box[across], box[across] + box[side], box[along], box[along] + box[size]),
      );
  return free;
}

/** Distance from a stretch to the nearest wire but `own` that runs alongside it. */
function wiresBeside({ geometry }: Drawing, stretch: Stretch, own: string) {
  const { along, across } = stretch;
  let free = Infinity;
  for (const [id, points] of geometry.routes) {
    if (id === own) continue;
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1],
        q = points[i];
      if (Math.abs(p[across] - q[across]) < 0.5)
        free = Math.min(
          free,
          distance(
            stretch,
            p[across],
            p[across],
            Math.min(p[along], q[along]),
            Math.max(p[along], q[along]),
          ),
        );
    }
  }
  return free;
}

/** The elements, markers and labels a loop keeps room from: all but its own ends and label. */
function boxesBeside({ geometry }: Drawing, own: string, ends: string[]): (Box | undefined)[] {
  const { boxes, edgeLabels, leaves, markers, nodeLabels } = geometry;
  return [
    ...[...leaves, ...markers].filter((id) => !ends.includes(id)).map((id) => boxes.get(id)!),
    ...[...nodeLabels.values()].flat(),
    ...[...edgeLabels].filter(([id]) => id !== own).map(([, box]) => box),
  ];
}

/** Draws a connection: a channel or connector, an access, a loop, a pointer, an interface's line or a note's. */
function drawEdge(drawing: Drawing, edge: TamEdge) {
  if (edge.kind === "channel" || edge.kind === "assembly") return drawChannel(drawing, edge);
  if (edge.kind === "modify") return drawModify(drawing, edge);
  if (edge.aside) return drawPointer(drawing, edge);
  const route = drawing.geometry.routes.get(edge.id);
  if (!route) return;
  const ends = [edge.source, edge.target];
  // A note hangs on a thin dashed line without heads.
  if (edge.kind === "anchor") wire(drawing, edge, route, ends, { dashed: true });
  else if (edge.kind === "provided" || edge.kind === "required")
    drawInterface(drawing, edge, route);
  else drawAccess(drawing, edge, route);
}

/** An access, a delegation or a dependency: a wire with its head, and its label. */
function drawAccess(drawing: Drawing, edge: TamEdge, route: Point[]) {
  wire(drawing, edge, route, [edge.source, edge.target], { dashed: edge.kind === "dependency" });
  if (edge.kind === "read") head(drawing, edge, route[1], route[0]);
  else
    head(
      drawing,
      edge,
      route.at(-2)!,
      route.at(-1)!,
      edge.kind === "dependency" || edge.kind === "delegation",
    );
  edgeLabel(drawing, edge);
}

/** A channel's or connector's two wires from its circle, and its label and request marker beside the circle. */
function drawChannel(drawing: Drawing, edge: TamEdge) {
  const { boxes, routes } = drawing.geometry,
    node = `${edge.id}#node`,
    middle = centerOf(boxes.get(node)!);
  const a = routes.get(`${edge.id}:a`),
    b = routes.get(`${edge.id}:b`);
  if (!a || !b) return;
  const toSource = reverse(snapEnd(a, middle)),
    toTarget = reverse(snapEnd(reverse(b), middle));
  const ends = [edge.source, edge.target, node];
  if (edge.kind === "assembly") drawAssembly(drawing, edge, toSource, toTarget, ends);
  else drawChannelWires(drawing, edge, toSource, toTarget, ends);
  drawing.channelCenters.set(edge.id, middle);
  drawChannelMarks(drawing, edge, toSource, toTarget);
}

/** The requirer's line ends in a socket around the provider's ball. */
function drawAssembly(
  drawing: Drawing,
  edge: TamEdge,
  toSource: Point[],
  toTarget: Point[],
  ends: string[],
) {
  const middle = toSource[0];
  wire(drawing, edge, reverse(toSource), ends);
  wire(drawing, edge, trimEnd(reverse(toTarget), BALL), ends);
  drawing.scene.markers.push({
    kind: "socket",
    tip: middle,
    direction: unit(toSource[1], toSource[0]),
    wire: edge.id,
  });
  circle(drawing, middle, BALL, ends[2]);
}

/** A channel's wires into its circle, with the heads of its data flow. */
function drawChannelWires(
  drawing: Drawing,
  edge: TamEdge,
  toSource: Point[],
  toTarget: Point[],
  ends: string[],
) {
  const radius = CHANNEL / 2;
  const inbound = trimEnd(reverse(toSource), radius),
    outbound = trimEnd(reverse(toTarget), radius);
  wire(drawing, edge, inbound, ends);
  wire(drawing, edge, reverse(outbound), ends);
  circle(drawing, toSource[0], radius, ends[2]);
  // Data flow: one way draws heads into the circle and into the receiver; both ways draws heads at both outer ends.
  for (const [from, tip] of flowHeads(edge.flow, inbound, outbound)) head(drawing, edge, from, tip);
}

/** Where the heads of a channel's data flow stand, as the point before each tip and the tip. */
function flowHeads(flow: TamEdge["flow"], inbound: Point[], outbound: Point[]): [Point, Point][] {
  if (!flow) return [];
  if (flow.toTarget && !flow.toSource)
    return [
      [inbound.at(-2)!, inbound.at(-1)!],
      [outbound.at(1)!, outbound[0]],
    ];
  if (flow.toSource && !flow.toTarget)
    return [
      [outbound.at(-2)!, outbound.at(-1)!],
      [inbound[1], inbound[0]],
    ];
  if (flow.toSource && flow.toTarget)
    return [
      [inbound[1], inbound[0]],
      [outbound[1], outbound[0]],
    ];
  return [];
}

/** Where a channel's label and request marker stand: the marker's box, and the label's anchor point. */
interface ChannelMarks {
  marker?: Box;
  at?: { x: number; y: number; anchor: "start" | "middle" };
}

/** The circle of a channel, the room reserved beside it, and what it carries. */
interface Carried {
  edge: TamEdge;
  middle: Point;
  labels: Box[];
  glyph: { width: number; height: number };
  directions: Point[];
  textHeight: number;
}

/**
 * The request marker "R" (with a triangle pointing the way requests travel, or "R" alone both
 * ways) and the label are drawn in the boxes ELK reserved beside the circle; with a protocol, the
 * label sits above the dashed boundary line and the marker below it.
 */
function drawChannelMarks(drawing: Drawing, edge: TamEdge, toSource: Point[], toTarget: Point[]) {
  const node = `${edge.id}#node`,
    upright = uprightAt(drawing, node),
    directions = requestDirections(edge, toSource, toTarget);
  const { marker, at } = channelMarks(
    {
      edge,
      middle: toSource[0],
      labels: drawing.geometry.nodeLabels.get(node) ?? [],
      glyph: directions.length
        ? drawing.prepared.markerSize(directions.length, upright)
        : { width: 0, height: 0 },
      directions,
      textHeight: edge.label ? breaks(edge.label).length * SMALL_LINE : 0,
    },
    upright,
  );
  if (edge.label && at)
    small(drawing, edge.label, at.x, at.y, { anchor: at.anchor, role: "label", owner: node });
  if (directions.length && marker)
    requestMarker(
      drawing,
      marker,
      directions.length === 1 ? axial(directions[0]) : undefined,
      node,
    );
}

/** Where a channel's label and marker stand: on either side of a protocol's boundary, or beside the circle. */
const channelMarks = (carried: Carried, upright: boolean) =>
  carried.edge.protocol && (carried.edge.label || carried.directions.length)
    ? protocolMarks(carried, upright)
    : plainMarks(carried, upright);

/** The ways requests travel on a channel, from its circle. */
function requestDirections(edge: TamEdge, toSource: Point[], toTarget: Point[]): Point[] {
  if (!edge.request) return [];
  return [
    ...(edge.request.toTarget ? [unit(toTarget[0], toTarget[1])] : []),
    ...(edge.request.toSource ? [unit(toSource[0], toSource[1])] : []),
  ];
}

/** A direction as the axis it runs nearest to. */
const axial = (d: Point) =>
  Math.abs(d.x) >= Math.abs(d.y) ? { x: Math.sign(d.x), y: 0 } : { x: 0, y: Math.sign(d.y) };

/** The marks of a channel on a protocol boundary: the label on one side of the line, the marker on the other. */
function protocolMarks(carried: Carried, upright: boolean): ChannelMarks {
  const { middle, labels, glyph, textHeight } = carried;
  if (upright) {
    if (!labels[0]) return {};
    // One reserved box right of the circle: its upper half above the line, its lower half below.
    return {
      marker: { x: labels[0].x, y: middle.y + ASIDE, ...glyph },
      at: { x: labels[0].x, y: middle.y - ASIDE - textHeight / 2, anchor: "start" },
    };
  }
  // Boxes above and below the circle; their right halves are beside the vertical line.
  return {
    marker: labels[1]
      ? { x: middle.x + ASIDE, y: labels[1].y + (labels[1].height - glyph.height) / 2, ...glyph }
      : undefined,
    at: labels[0]
      ? { x: middle.x + ASIDE, y: labels[0].y + labels[0].height / 2, anchor: "start" }
      : undefined,
  };
}

/** The marks of a channel without a protocol boundary. */
function plainMarks(carried: Carried, upright: boolean): ChannelMarks {
  const { edge, middle, labels, glyph, directions } = carried;
  if (upright) {
    if (!labels[0]) return {};
    // One reserved box right of the circle: the marker, then the label.
    return {
      marker: { x: labels[0].x, y: middle.y - glyph.height / 2, ...glyph },
      at: {
        x: labels[0].x + (directions.length ? glyph.width + 8 : 0),
        y: middle.y,
        anchor: "start",
      },
    };
  }
  // The label above the circle, the marker below it.
  const label = edge.label ? labels[0] : undefined,
    below = directions.length ? labels[edge.label ? 1 : 0] : undefined;
  return {
    at: label && { x: label.x + label.width / 2, y: label.y + label.height / 2, anchor: "middle" },
    marker: below && {
      x: below.x + (below.width - glyph.width) / 2,
      y: below.y + (below.height - glyph.height) / 2,
      ...glyph,
    },
  };
}

/** A reads/writes access: a loop whose two sides run along the access's route, and its label. */
function drawModify(drawing: Drawing, edge: TamEdge) {
  const route = drawing.geometry.routes.get(edge.id);
  if (!route) return;
  const path = simplifyPath(route);
  if (path.length === 2) drawArcs(drawing, edge, path);
  else drawParallels(drawing, edge, path);
  edgeLabel(drawing, edge);
}

/** An end on a rounded shape moves along its side onto the curved outline. */
function meet({ geometry: { round, boxes } }: Drawing, point: Point, toward: Point, end: string) {
  return round.has(end) ? outline(point, toward, boxes.get(end)!, round.get(end)!) : point;
}

/** Straight: two mirror-image circular arcs bulging away from each other, "( )", heads on the arcs' tangents. */
function drawArcs(drawing: Drawing, edge: TamEdge, path: Point[]) {
  const d = unit(path[0], path[1]),
    n = { x: -d.y, y: d.x };
  // The bulge fits the room beside the loop: the nearest parallel wire, element or text alongside keeps 6px.
  const room =
    freeBeside(drawing, path[0], path[1], edge.id, [edge.source, edge.target]) - LOOP_END - 6;
  const fitted = Math.max(2, Math.min(BULGE, room));
  if (fitted < BULGE) fallback("loop-fitted");
  for (const side of [1, -1]) {
    const outward = { x: n.x * side, y: n.y * side };
    let a = meet(drawing, add(path[0], outward, LOOP_END), add(path[0], d, 1), edge.source),
      b = meet(drawing, add(path[1], outward, LOOP_END), add(path[1], d, -1), edge.target);
    // One side carries data to the target, the other back to the source.
    if (side < 0) [a, b] = [b, a];
    drawArc(drawing, edge, a, b, outward, fitted);
  }
}

/** One arc of a loop from `a` to `b`, bulging `outward`, with its head at `b`. */
function drawArc(
  drawing: Drawing,
  edge: TamEdge,
  a: Point,
  b: Point,
  outward: Point,
  fitted: number,
) {
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
  wire(drawing, edge, samples, [edge.source, edge.target], {
    path: `M${r(a.x)} ${r(a.y)}A${r(radius)} ${r(radius)} 0 0 ${sweep} ${r(b.x)} ${r(b.y)}`,
  });
  const radial = unit(center, b),
    tangent = sweep === 1 ? { x: -radial.y, y: radial.x } : { x: radial.y, y: -radial.x };
  head(drawing, edge, add(b, tangent, -8), b, false, true);
}

/** Bent: two parallel lines along the path with sharp corners, so they read as a pair of wires. */
function drawParallels(drawing: Drawing, edge: TamEdge, path: Point[]) {
  for (const side of [1, -1]) {
    const line = offset(path, side * LOOP_END);
    line[0] = meet(drawing, line[0], line[1], edge.source);
    line[line.length - 1] = meet(drawing, line.at(-1)!, line.at(-2)!, edge.target);
    const way = side > 0 ? line : reverse(line);
    wire(drawing, edge, way, [edge.source, edge.target], { path: rounded(way, 0) });
    head(drawing, edge, way.at(-2)!, way.at(-1)!);
  }
}

/** A pointer between the storages of a row: straight across the gap, keyword above the line. */
function drawPointer(drawing: Drawing, edge: TamEdge) {
  const { boxes } = drawing.geometry,
    from = boxes.get(edge.source)!,
    to = boxes.get(edge.target)!;
  const across =
      Math.abs(centerOf(to).x - centerOf(from).x) >= Math.abs(centerOf(to).y - centerOf(from).y),
    [axis, cross, extent, thick] = across
      ? (["x", "y", "width", "height"] as const)
      : (["y", "x", "height", "width"] as const);
  const sign = centerOf(to)[axis] >= centerOf(from)[axis] ? 1 : -1;
  const edgeOf = (box: Box, outward: number) => box[axis] + (outward > 0 ? box[extent] : 0);
  // Dots between the two (a row of several) keep the middle: the line runs above them.
  const low = Math.min(edgeOf(from, sign), edgeOf(to, -sign)),
    high = Math.max(edgeOf(from, sign), edgeOf(to, -sign));
  const at =
    sharedMiddle(from, to, cross, thick) - (dotsWithin(drawing, axis, extent, low, high) ? 9 : 0);
  const start = { [axis]: edgeOf(from, sign), [cross]: at } as unknown as Point,
    end = { [axis]: edgeOf(to, -sign), [cross]: at } as unknown as Point;
  wire(drawing, edge, [start, end], [edge.source, edge.target], { dashed: true });
  head(drawing, edge, start, end, true);
  // The gap is as narrow as between any two elements, so a shared neighbour can reach both storages
  // with straight accesses; the keyword sits below the pair, centered on the line.
  if (!edge.label) return;
  const below = Math.max(from[cross] + from[thick], to[cross] + to[thick]) + SMALL_LINE / 2 + 4;
  small(
    drawing,
    edge.label,
    across ? (start.x + end.x) / 2 : below + 20,
    across ? below : (start.y + end.y) / 2,
    { role: "label", owner: edge.id },
  );
}

/** Whether dots stand between `low` and `high` along an axis. */
const dotsWithin = (
  { scene }: Drawing,
  axis: "x" | "y",
  extent: "width" | "height",
  low: number,
  high: number,
) =>
  scene.shapes.some(
    (shape) =>
      shape.kind === "dots" &&
      shape.box[axis] >= low &&
      shape.box[axis] + shape.box[extent] <= high,
  );

/** The middle of what two boxes share across a pointer's line. */
function sharedMiddle(a: Box, b: Box, cross: "x" | "y", thick: "width" | "height") {
  const low = Math.max(a[cross], b[cross]),
    high = Math.min(a[cross] + a[thick], b[cross] + b[thick]);
  return (low + high) / 2;
}

/** An interface's line with its ball or socket, and its name beside it. */
function drawInterface(drawing: Drawing, edge: TamEdge, route: Point[]) {
  const { geometry, prepared, scene } = drawing,
    middle = centerOf(geometry.boxes.get(edge.target)!),
    shaped = snapEnd(route, middle);
  const facing = unit(shaped.at(-2)!, middle);
  wire(drawing, edge, edge.kind === "provided" ? trimEnd(shaped, BALL) : shaped, [
    edge.source,
    edge.target,
  ]);
  if (edge.kind === "provided") circle(drawing, middle, BALL, edge.target);
  else scene.markers.push({ kind: "socket", tip: middle, direction: facing, wire: edge.id });
  const box = geometry.nodeLabels.get(edge.target)?.[0],
    name = prepared.diagram.nodes.get(edge.target)?.label;
  if (!box || !name) return;
  if (uprightAt(drawing, edge.target))
    text(drawing, name, box.x, middle.y, {
      size: SMALL,
      anchor: "start",
      tone: "secondary",
      halo: "background",
      role: "label",
      owner: edge.target,
    });
  else
    text(drawing, name, box.x + box.width / 2, box.y + box.height / 2, {
      size: SMALL,
      tone: "secondary",
      halo: "background",
      role: "label",
      owner: edge.target,
    });
}

/** Container titles sit centered at the top (left of a component icon); a wire through the title stops at its halo. */
function drawTitle(drawing: Drawing, { id, box, lines, subsystem, icon }: Title) {
  const { measure } = drawing;
  const stereotype = subsystem ? 16 : 0,
    width = Math.max(
      ...lines.map((line) => measure(line, FONT, 600)),
      subsystem ? measure("«subsystem»", SMALL, 400) : 0,
    );
  const cx = Math.min(box.x + box.width / 2, box.x + box.width - PAD - (icon ? 26 : 0) - width / 2);
  if (stereotype)
    text(drawing, "«subsystem»", cx, box.y + 15, {
      size: SMALL,
      tone: "secondary",
      role: "stereotype",
      owner: id,
    });
  lines.forEach((line, index) =>
    text(drawing, line, cx, box.y + TITLE_TOP + stereotype + LINE / 2 + index * LINE, {
      weight: 600,
      role: "title",
      owner: id,
    }),
  );
}
