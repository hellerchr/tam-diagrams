/**
 * TAM block diagrams as draw.io pages and back. Agents, human agents, storages, channels with their
 * request markers, accesses and multiplicity are drawn with the shapes of the TAMshapes TAM-BD
 * library; the design level (components, subsystems, classes, packages, interfaces) with draw.io's
 * UML shapes. A page is read back by its picture: a rectangle is an agent, a rounded rectangle a
 * storage, a connector with a circle on it a channel, a rectangle with a stick figure a human agent,
 * and what stands inside an element's box belongs to it. The `tam` role of a cell this package
 * wrote settles what the picture leaves open.
 */

import {
  type Cell,
  type Drawing,
  DrawioError,
  isOn,
  LAYER,
  shapeOf,
  type Style,
  textToHtml,
} from "./drawio-file.ts";
import type { DrawioType, Imported } from "./drawio.ts";
import {
  arrowAt,
  cell,
  dashed,
  edgeRoute,
  fillOf,
  FONT_SIZE,
  Ids,
  isDark,
  labelAt,
  markOnEdge,
  pageTitle,
  paletteColor,
  quotedOr,
  readingOrder,
  REQUEST_STENCIL,
  roleOf,
  TAMSHAPES,
  titleCell,
  vertexGeometry,
} from "./drawio-shapes.ts";
import {
  around,
  type Box,
  centerOf,
  inside,
  type Point,
  type Scene,
  type SceneShape,
  type SceneText,
  STACK,
} from "./scene.ts";
import {
  COLORS,
  ELEMENT_KINDS,
  parseTam,
  type TamDiagram,
  type TamEdge,
  type TamNode,
} from "./tam.ts";
import { holdsDeep } from "./scene-tree.ts";
import { holder } from "./tam-edit.ts";
import { SMALL } from "./text.ts";

// ---------------------------------------------------------------------------------------------
// Export

/** A TAM label as an HTML value: its `<br>`s stay line breaks, the rest is text. */
const html = (label: string) =>
  label
    .split(/<br\s*\/?>/i)
    .map(textToHtml)
    .join("<br>");

/** The stick figure of a human agent, as TAMshapes draws it: a head and five lines, in a group. */
function figure(owner: string, box: Box): Cell[] {
  const group = `${owner}#figure`,
    width = 20,
    height = 34,
    scale = height / 40;
  const line = (index: number, from: Point, to: Point): Cell =>
    cell(
      {
        id: `${group}#${index}`,
        parent: group,
        edge: true,
        style: { edgeStyle: "none", strokeWidth: 2, html: 1, startArrow: "none", endArrow: "none" },
        geometry: {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          sourcePoint: { x: from.x, y: from.y * scale },
          targetPoint: { x: to.x, y: to.y * scale },
        },
      },
      "figure",
    );
  return [
    cell(
      {
        id: group,
        parent: owner,
        vertex: true,
        connectable: false,
        style: { group: "", strokeWidth: 2, rotatable: 0, editable: 0, fillColor: "none" },
        geometry: { x: (box.width - width) / 2, y: 5, width, height },
      },
      "figure",
    ),
    cell(
      {
        id: `${group}#head`,
        parent: group,
        vertex: true,
        style: { ellipse: "", strokeWidth: 2, whiteSpace: "wrap", html: 1 },
        geometry: { x: 4, y: 0, width: 12, height: 12 * scale },
      },
      "figure",
    ),
    line(1, { x: 10, y: 12 }, { x: 10, y: 26 }),
    line(2, { x: 10, y: 18 }, { x: 20, y: 12 }),
    line(3, { x: 10, y: 18 }, { x: 0, y: 12 }),
    line(4, { x: 10, y: 26 }, { x: 0, y: 40 }),
    line(5, { x: 10, y: 26 }, { x: 20, y: 40 }),
  ];
}

/** The UML component icon in the top right of a component or subsystem. */
const componentIcon = (owner: string, box: Box): Cell =>
  cell(
    {
      id: `${owner}#icon`,
      parent: owner,
      vertex: true,
      connectable: false,
      style: { shape: "module", jettyWidth: 6, jettyHeight: 3, html: 1, strokeWidth: 1 },
      geometry: { x: box.width - 22, y: 6, width: 14, height: 16 },
    },
    "icon",
  );

/** Three dots for "more of these", in a group as TAMshapes draws them. */
function dots(id: string, parent: string, box: Box, outer: Box | undefined, role: string): Cell[] {
  const across = box.width >= box.height,
    size = 4;
  const group = cell(
    {
      id,
      parent,
      vertex: true,
      connectable: false,
      style: { group: "" },
      geometry: vertexGeometry(box, outer),
    },
    role,
  );
  return [
    group,
    ...[0, 0.5, 1].map((share, index) =>
      cell(
        {
          id: `${id}#${index + 1}`,
          parent: id,
          vertex: true,
          connectable: false,
          style: {
            ellipse: "",
            aspect: "fixed",
            strokeColor: "none",
            fillColor: "#000000",
            html: 1,
          },
          geometry: across
            ? {
                x: share * (box.width - size),
                y: (box.height - size) / 2,
                width: size,
                height: size,
              }
            : {
                x: (box.width - size) / 2,
                y: share * (box.height - size),
                width: size,
                height: size,
              },
        },
        "dot",
      ),
    ),
  ];
}

/**
 * A note's text as the scene draws it: its size, and where it starts in the note, less the 2px
 * draw.io keeps around every label.
 */
function noteText(scene: Scene, id: string, box: Box) {
  const lines = scene.texts.filter((text) => text.owner === id);
  if (!lines.length) return { fontSize: SMALL };
  return {
    fontSize: lines[0].size,
    boundedLbl: 0,
    spacingTop: Math.max(0, Math.round(Math.min(...lines.map((line) => line.box.y)) - box.y - 2)),
    spacingLeft: Math.max(0, Math.round(Math.min(...lines.map((line) => line.box.x)) - box.x - 2)),
    spacingRight: 0,
  };
}

/** The value of an element's cell: its name, and «subsystem» above a subsystem's. */
const valueOf = (node: TamNode) =>
  node.kind === "subsystem"
    ? `<font style="font-size: ${SMALL}px;">«subsystem»</font><br>${html(node.label)}`
    : html(node.label);

/** The shape an element is drawn with, before its fill, size, nesting and color. */
function shapeStyle(node: TamNode, container: boolean): Record<string, string | number> {
  if (node.kind === "package") return TAMSHAPES.package;
  if (node.kind === "group")
    return {
      rounded: 1,
      absoluteArcSize: 1,
      arcSize: node.passive ? 36 : 8,
      whiteSpace: "wrap",
      html: 1,
      strokeWidth: 1,
      fillColor: "none",
    };
  if (node.kind === "storage")
    return container
      ? { ...TAMSHAPES.storage, absoluteArcSize: 1, arcSize: 36 }
      : TAMSHAPES.storage;
  if (node.kind === "human")
    return { ...TAMSHAPES.agent, verticalAlign: "bottom", spacingBottom: 4 };
  return TAMSHAPES.agent;
}

/** What a container adds to its style: its name on top, and parts that move with it. */
const CONTAINER = {
  container: 1,
  collapsible: 0,
  verticalAlign: "top",
  fontStyle: 1,
  recursiveResize: 0,
};

/** The style of an element's cell. An uncolored group keeps its outline only. */
function elementStyle(node: TamNode, shape: SceneShape | undefined, container: boolean) {
  const fill = shape && fillOf(shape);
  const color = node.color ? { tamColor: node.color } : {};
  if (node.kind === "note")
    return {
      ...TAMSHAPES.note,
      ...(fill ? { fillColor: fill } : {}),
      fontSize: FONT_SIZE,
      ...color,
    };
  const filled = fill && (node.kind !== "group" || node.color);
  return {
    ...shapeStyle(node, container),
    ...(filled ? { fillColor: fill } : {}),
    fontSize: FONT_SIZE,
    ...(container ? CONTAINER : {}),
    ...color,
  };
}

/** The distance from a point to a box, 0 without a box. */
const distanceOr0 = (point: Point, box: Box | undefined) => (box ? distanceTo(box, point) : 0);

/** A leg oriented to start at the box. */
const orientedFrom = (points: Point[], box: Box | undefined) =>
  distanceOr0(points[0], box) <= distanceOr0(points.at(-1)!, box) ? points : points.toReversed();

/** The scene's wires of an edge, oriented from the source end to the target end and joined. */
function edgePath(
  scene: Scene,
  edge: TamEdge,
  from: Box | undefined,
  to: Box | undefined,
): Point[] | undefined {
  const wires = scene.wires.filter((wire) => wire.edge === edge.id && wire.points.length > 1);
  if (!wires.length) return undefined;
  if (wires.length === 1) return orientedFrom(wires[0].points, from);
  // Two legs that meet at a channel's circle or an assembly's ball: the source's leg first.
  const nearFrom = (points: Point[]) =>
    Math.min(distanceOr0(points[0], from), distanceOr0(points.at(-1)!, from));
  const [a, b] = wires.toSorted((p, q) => nearFrom(p.points) - nearFrom(q.points));
  return [...orientedFrom(a.points, from), ...orientedTo(b.points, to)];
}

/** A leg oriented to end at the box. */
function orientedTo(points: Point[], box: Box | undefined): Point[] {
  if (!box) return points;
  return distanceTo(box, points.at(-1)!) <= distanceTo(box, points[0])
    ? points
    : points.toReversed();
}

/** The rotation that turns the request marker's triangle, which points down, toward `way`. */
const rotation = (way: Point) =>
  Math.abs(way.x) >= Math.abs(way.y) ? (way.x > 0 ? -90 : 90) : way.y > 0 ? 0 : 180;

/** What the cells of a TAM block diagram are drawn from: the diagram, its scene, and the boxes of the elements drawn so far. */
interface Layout {
  diagram: TamDiagram;
  scene: Scene;
  shapes: Map<string, SceneShape>;
  boxes: Map<string, Box>;
}

/** The cells of a TAM block diagram as `scene` lays it out. */
function tamCells(source: string, scene: Scene): Cell[] {
  const diagram = parseTam(source);
  const layout: Layout = {
    diagram,
    scene,
    shapes: new Map(scene.shapes.map((shape) => [shape.id, shape])),
    boxes: new Map(),
  };
  const page: Cell = {
    id: "0",
    data: {
      tamDirection: diagram.direction,
      ...(diagram.level ? { tamLevel: diagram.level } : {}),
    },
  };
  // The elements come first, as the connections need their boxes; a container's cell comes before
  // its parts'.
  const elements = outsideIn(diagram).flatMap((node) => elementCells(layout, node));
  const interfaces = [...diagram.nodes.values()].flatMap((node) => interfaceCells(layout, node));
  const connections = diagram.edges.flatMap((edge) => connectionCells(layout, edge));
  const title = titleCell(scene);
  return [
    page,
    ...elements,
    ...interfaces,
    ...connections,
    ...protocolCells(scene),
    ...(title && diagram.title ? [title] : []),
  ];
}

/** The elements of a diagram, outside in: each before its parts. */
function outsideIn(diagram: TamDiagram): TamNode[] {
  const order: TamNode[] = [];
  const walk = (ids: string[]) =>
    ids.forEach((id) => {
      const node = diagram.nodes.get(id)!;
      order.push(node);
      walk(node.children);
    });
  walk(diagram.roots);
  return order;
}

/** Where an element's cell goes: the cell of the element it stands in, and that element's box. */
function placeOf(layout: Layout, id: string): { parent: string; outer?: Box } {
  const parent = holder(layout.diagram, id);
  const outer = parent ? layout.boxes.get(parent) : undefined;
  return outer ? { parent: parent!, outer } : { parent: LAYER };
}

/**
 * The cells of an element: its box, the outline behind a stack, and the stick figure or the
 * component icon in it. Rows of copies and interfaces have none of their own.
 */
function elementCells(layout: Layout, node: TamNode): Cell[] {
  if (node.id.endsWith("#row") || node.kind === "interface") return [];
  const shape = layout.shapes.get(node.id);
  if (!shape) return [];
  const { parent, outer } = placeOf(layout, node.id);
  if (node.kind === "dots")
    return dots(
      node.id,
      parent,
      shape.box,
      outer,
      node.id.endsWith("#dots") ? "copy-dots" : "dots",
    );
  layout.boxes.set(node.id, shape.box);
  const copy = isCopy(node);
  const style = boxStyle(layout, node, shape);
  const box = cell(
    {
      id: node.id,
      parent,
      value: valueOf(node),
      vertex: true,
      style,
      geometry: vertexGeometry(shape.box, outer),
    },
    copy ? "copy" : node.kind,
  );
  return [
    ...(node.stack ? [stackCell(node.id, parent, style, shape.box, outer)] : []),
    box,
    ...markCells(node, shape.box),
  ];
}

/** Whether an element is a copy of another, shown as several. */
const isCopy = (node: TamNode) => !!node.origin && node.origin !== node.id;

/** The style of an element's box: its shape, a note's text, and the element a copy shows. */
const boxStyle = (layout: Layout, node: TamNode, shape: SceneShape): CellStyle => ({
  ...elementStyle(node, shape, isContainer(layout.diagram, node) && shape.container),
  ...(node.kind === "note" ? noteText(layout.scene, node.id, shape.box) : {}),
  ...(isCopy(node) ? { tamOf: node.origin } : {}),
});

/** Whether an element holds other elements; interfaces it offers do not count. */
const isContainer = (diagram: TamDiagram, node: TamNode) =>
  node.children.some((id) => diagram.nodes.get(id)!.kind !== "interface");

/** The outline a little behind and below a stacked element, styled like the element. */
function stackCell(
  id: string,
  parent: string,
  style: CellStyle,
  box: Box,
  outer: Box | undefined,
): Cell {
  return cell(
    {
      id: `${id}#stack`,
      parent,
      vertex: true,
      connectable: false,
      style: { ...style, container: undefined, tamOf: id },
      geometry: vertexGeometry({ ...box, x: box.x + STACK, y: box.y + STACK }, outer),
    },
    "stack",
  );
}

/** What is drawn inside an element's box: a human agent's stick figure, a component's icon. */
function markCells(node: TamNode, box: Box): Cell[] {
  if (node.kind === "human") return figure(node.id, box);
  if (node.kind === "component" || node.kind === "subsystem") return [componentIcon(node.id, box)];
  return [];
}

/** How the ball of a provided interface and the socket of a required one are drawn. */
const INTERFACE_STYLES = {
  provided: {
    ellipse: "",
    html: 1,
    aspect: "fixed",
    strokeWidth: 1.5,
    labelPosition: "right",
    align: "left",
    spacingLeft: 2,
    fontSize: SMALL,
  },
  required: {
    shape: "requiredInterface",
    html: 1,
    strokeWidth: 1.5,
    labelPosition: "right",
    align: "left",
    spacingLeft: 2,
    fontSize: SMALL,
  },
};

/** Where an interface's ball or socket stands: the ball's center, or the tip of the socket. */
function interfaceTip(layout: Layout, node: TamNode, edge: TamEdge): Point | undefined {
  if (edge.kind !== "provided")
    return layout.scene.markers.find(
      (marker) => marker.wire === edge.id && marker.kind === "socket",
    )?.tip;
  const ball = layout.shapes.get(node.id);
  return ball && centerOf(ball.box);
}

/** An interface a component provides or requires alone: a ball or a socket at the end of a line. */
function interfaceCells(layout: Layout, node: TamNode): Cell[] {
  if (node.kind !== "interface") return [];
  const edge = layout.diagram.edges.find((item) => item.target === node.id)!;
  const tip = interfaceTip(layout, node, edge);
  if (!tip) return [];
  const provided = edge.kind === "provided";
  const size = provided ? 10 : 14;
  const box = { x: tip.x - size / 2, y: tip.y - size / 2, width: size, height: size };
  layout.boxes.set(node.id, box);
  const label = layout.scene.texts.find((text) => text.owner === node.id);
  // A socket opens toward its name.
  const direction = label && label.box.x < tip.x ? "west" : "east";
  return [
    cell(
      {
        id: node.id,
        parent: LAYER,
        value: html(node.label),
        vertex: true,
        style: provided ? INTERFACE_STYLES.provided : { ...INTERFACE_STYLES.required, direction },
        geometry: vertexGeometry(box),
      },
      provided ? "provided" : "required",
    ),
  ];
}

/** A connection as it is drawn: the boxes of its ends, its path, and where its label stands. */
interface Wiring {
  layout: Layout;
  edge: TamEdge;
  from: Box;
  to: Box;
  path: Point[];
  label?: Point;
}

type CellStyle = Record<string, string | number | undefined>;

/** Where the scene draws a label: the box around all its lines. */
function labelBox(scene: Scene, owner: string, role: SceneText["role"] = "label") {
  const lines = scene.texts.filter((text) => text.owner === owner && text.role === role);
  return lines.length ? around(lines.map((text) => text.box)) : undefined;
}

/** The style every connection starts from. */
const CONNECTION = {
  ...TAMSHAPES.connection,
  fontSize: SMALL,
  edgeStyle: "orthogonalEdgeStyle" as string,
};

/** The cells of a connection, by its kind. */
function connectionCells(layout: Layout, edge: TamEdge): Cell[] {
  const from = layout.boxes.get(edge.source),
    to = layout.boxes.get(edge.target);
  const path = edgePath(layout.scene, edge, from, to);
  if (!path || !from || !to) return [];
  const text = labelBox(layout.scene, edge.id);
  return CONNECTIONS[edge.kind]({ layout, edge, from, to, path, label: text && centerOf(text) });
}

/** A connector cell along the wiring's path; a copy's connections all say so. */
function connector(
  wiring: Wiring,
  style: CellStyle,
  role: string,
  value?: string,
  at?: Point,
): Cell {
  const { edge, path } = wiring;
  const route = edgeRoute(path, wiring.from, wiring.to);
  return cell(
    {
      id: edge.id,
      parent: LAYER,
      ...(value ? { value: html(value) } : {}),
      edge: true,
      source: edge.source,
      target: edge.target,
      style: { ...CONNECTION, ...route.style, ...style },
      geometry: at ? labelAt(route.geometry, path, at) : route.geometry,
    },
    edge.id.includes("#") ? "copy" : role,
  );
}

/** A connector that carries the connection's label where the scene draws it. */
const labeled = (wiring: Wiring, style: CellStyle, role: string) =>
  connector(wiring, style, role, wiring.edge.label, wiring.label);

const CONNECTIONS: Record<TamEdge["kind"], (wiring: Wiring) => Cell[]> = {
  channel: channelCells,
  assembly: channelCells,
  read: (wiring) => [
    labeled(wiring, { startArrow: "classic", startFill: 1, endArrow: "none" }, "read"),
  ],
  write: (wiring) => [
    labeled(wiring, { startArrow: "none", endArrow: "classic", endFill: 1 }, "write"),
  ],
  modify: modifyCells,
  delegation: (wiring) => [labeled(wiring, { endArrow: "open", endFill: 0 }, "delegates")],
  dependency: (wiring) => [
    labeled(
      wiring,
      {
        dashed: 1,
        endArrow: "open",
        endFill: 0,
        ...(wiring.edge.aside ? { edgeStyle: "none" } : {}),
      },
      "dependency",
    ),
  ],
  provided: (wiring) => [connector(wiring, { startArrow: "none", endArrow: "none" }, "provides")],
  required: (wiring) => [connector(wiring, { startArrow: "none", endArrow: "none" }, "requires")],
  // A note's dotted line, as TAM-Ann draws borders: dashed, without heads.
  anchor: (wiring) => [
    connector(
      wiring,
      { dashed: 1, dashPattern: "3 3", startArrow: "none", endArrow: "none", strokeWidth: 1 },
      "anchor",
    ),
  ],
};

/** The role of a channel's line: what it carries, or an assembly. */
function channelRole(edge: TamEdge): string {
  if (edge.kind === "assembly") return "assembly";
  if (edge.request) return "calls";
  return edge.flow?.toTarget || edge.flow?.toSource ? "sends" : "channel";
}

/** A channel's line: its heads where data flows, and its protocol. An assembly has no heads at its ball's end. */
function channelLine(wiring: Wiring): Cell {
  const { layout, edge } = wiring;
  const nodeLabel = labelBox(layout.scene, `${edge.id}#node`);
  return connector(
    wiring,
    {
      startArrow: edge.flow?.toSource ? "classic" : "none",
      endArrow: edge.kind !== "assembly" && edge.flow?.toTarget ? "classic" : "none",
      startFill: 1,
      endFill: 1,
      ...(edge.protocol ? { tamProtocol: edge.protocol } : {}),
    },
    channelRole(edge),
    edge.label,
    nodeLabel ? centerOf(nodeLabel) : undefined,
  );
}

/** The circle on a channel, or the ball of an assembly, where the scene draws it. */
function circleCell(edge: TamEdge, path: Point[], box: Box): Cell {
  const assembly = edge.kind === "assembly";
  return cell(
    {
      id: `${edge.id}#circle`,
      parent: edge.id,
      vertex: true,
      connectable: false,
      style: assembly
        ? { ellipse: "", html: 1, aspect: "fixed", strokeWidth: 1.5, rotatable: 0, deletable: 0 }
        : { ...TAMSHAPES.channel, deletable: 0, connectable: 0 },
      geometry: markOnEdge(path, centerOf(box), box),
    },
    assembly ? "ball" : "circle",
  );
}

/**
 * A channel or an assembly: the line with its heads and protocol, the circle or ball on it, and
 * the request marker.
 */
function channelCells(wiring: Wiring): Cell[] {
  const { layout, edge, path } = wiring;
  const circle = layout.shapes.get(`${edge.id}#node`);
  const line = channelLine(wiring);
  if (!circle) return [line];
  const request = edge.request ? requestCells(layout.scene, layout.shapes, edge, path) : [];
  return [line, circleCell(edge, path, circle.box), ...request];
}

/**
 * A channel's request marker where the scene draws it: the R with its triangle, or a lone R for
 * requests both ways.
 */
function requestCells(
  scene: Scene,
  shapes: Map<string, SceneShape>,
  edge: TamEdge,
  path: Point[],
): Cell[] {
  const node = `${edge.id}#node`;
  const pointer = shapes.get(`${node}#pointer`),
    letter = scene.texts.find((item) => item.owner === node && item.role === "marker");
  if (!letter) return [];
  const marker = (style: CellStyle, at: Point, size: number, role: string, value?: string) =>
    cell(
      {
        id: `${edge.id}#request`,
        parent: edge.id,
        ...(value ? { value } : {}),
        vertex: true,
        connectable: false,
        style,
        geometry: markOnEdge(path, at, { width: size, height: size }),
      },
      role,
    );
  // The marker stands where the scene draws the letter and its triangle.
  if (pointer?.facing)
    return [
      marker(
        { ...TAMSHAPES.request, rotation: rotation(pointer.facing) },
        centerOf(around([pointer.box, letter.box])),
        16,
        "request",
      ),
    ];
  return [
    marker(
      { ...TAMSHAPES.text, fontStyle: 1, fontSize: SMALL },
      centerOf(letter.box),
      14,
      "request-both",
      "R",
    ),
  ];
}

/** The heads of a modifying access's arc: at the storage for data in, at the agent for data back. */
const ARC_HEADS = {
  in: { startArrow: "none", endArrow: "classic", endFill: 1 },
  back: { startArrow: "classic", startFill: 1, endArrow: "none" },
};

/** A modifying access: two arcs, data in and data back, as two curved connectors between the same two elements. */
function modifyCells(wiring: Wiring): Cell[] {
  const { layout, edge } = wiring;
  return layout.scene.wires
    .filter((wire) => wire.edge === edge.id && wire.points.length > 1)
    .map((arc, index) => arcCell(wiring, arc.points, index === 0));
}

/** One arc of a modifying access, curved through its middle; the first carries the name. */
function arcCell({ edge, from, to, label }: Wiring, arc: Point[], named: boolean): Cell {
  const toTarget = orientedTo(arc, to) === arc;
  const points = toTarget ? arc : arc.toReversed();
  const bend = points[Math.floor(points.length / 2)];
  const route = edgeRoute([points[0], bend, points.at(-1)!], from, to);
  return cell(
    {
      id: named ? edge.id : `${edge.id}#back`,
      parent: LAYER,
      ...(named && edge.label ? { value: html(edge.label) } : {}),
      edge: true,
      source: edge.source,
      target: edge.target,
      style: {
        ...CONNECTION,
        edgeStyle: "none",
        curved: 1,
        ...route.style,
        ...ARC_HEADS[toTarget ? "in" : "back"],
      },
      geometry: named && label ? labelAt(route.geometry, points, label) : route.geometry,
    },
    edge.id.includes("#") ? "copy" : "modify",
  );
}

/** Protocol boundaries: dashed lines with the protocol's name nearest an end. */
function protocolCells(scene: Scene): Cell[] {
  const names = scene.texts.filter((text) => text.role === "protocol");
  return scene.lines
    .filter((line) => line.clear && line.dashed)
    .map((line, index) => {
      const [start, end] = [line.points[0], line.points.at(-1)!];
      const reach = (text: SceneText) =>
        Math.min(
          ...[start, end].map((p) =>
            Math.hypot(centerOf(text.box).x - p.x, centerOf(text.box).y - p.y),
          ),
        );
      const name = names.toSorted((a, b) => reach(a) - reach(b))[0];
      const geometry = {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        relative: true,
        sourcePoint: start,
        targetPoint: end,
      };
      return cell(
        {
          id: `protocol#${index + 1}`,
          parent: LAYER,
          ...(name ? { value: textToHtml(name.text) } : {}),
          edge: true,
          style: {
            ...TAMSHAPES.border,
            strokeWidth: 1.5,
            fontSize: SMALL,
            fontStyle: 2,
            labelBackgroundColor: "#FFFFFF",
          },
          geometry: name ? labelAt(geometry, line.points, centerOf(name.box)) : geometry,
        },
        "protocol",
      );
    });
}

// ---------------------------------------------------------------------------------------------
// Import

type ElementKind = (typeof ELEMENT_KINDS)[number];

/** An element read from the page. */
interface Element {
  cell: Cell;
  kind: ElementKind;
  label: string;
  box: Box;
  stack: boolean;
  color?: string;
  /** The cell of its copy, for an element shown as several. */
  copy?: Cell;
  id: string;
  parent?: Element;
  /** An anonymous group: no id in the source unless a connection needs one. */
  anonymous: boolean;
}

/** What a cell on the page is to a TAM block diagram. */
type Part =
  /** An element; `drawn` names a shape the syntax has no word for, read as this kind. */
  | { as: "element"; kind: ElementKind; drawn?: string }
  | { as: "circle" }
  | { as: "request" }
  | { as: "dots" }
  | { as: "ball" | "socket" }
  | { as: "border" }
  | { as: "text" }
  /** A stick figure standing on its own: a human agent, or what makes the agent under it one. */
  | { as: "figure" }
  /** The modifying access of TAM-BD: two arcs with heads, set between an agent and a storage. */
  | { as: "modify" }
  /** What only decorates: a background area, a group around other cells, a mark inside a shape. */
  | { as: "decoration" }
  | { as: "unknown"; shape: string };

const ROLE_KINDS = new Set<string>(ELEMENT_KINDS);

/** Whether a group cell holds a stick figure: a head and at least four lines. */
function isFigure(drawing: Drawing, group: Cell): boolean {
  const parts = drawing.children(group.id);
  return (
    parts.some((part) => part.vertex && shapeOf(drawing.style(part)) === "ellipse") &&
    parts.filter((part) => part.edge).length >= 4
  );
}

/** Whether a group cell holds three small filled dots. */
function isDotsGroup(drawing: Drawing, group: Cell): boolean {
  const parts = drawing.children(group.id).filter((part) => part.vertex);
  return (
    parts.length === 3 &&
    parts.every((part) => {
      const style = drawing.style(part);
      return shapeOf(style) === "ellipse" && isDark(style) && drawing.box(part).width <= 8;
    })
  );
}

/**
 * Whether a group cell is the modifying access of TAM-BD: two curved lines that end nowhere, with
 * a head each.
 */
function isModifyGroup(drawing: Drawing, group: Cell): boolean {
  const lines = drawing.children(group.id).filter((part) => part.edge);
  return (
    lines.length === 2 &&
    drawing.children(group.id).length === 2 &&
    lines.every(
      (line) =>
        !line.source &&
        !line.target &&
        (arrowAt(drawing.style(line), "start") !== "none" ||
          arrowAt(drawing.style(line), "end") !== "none"),
    )
  );
}

/** Whether a vertex is drawn with text only: no outline, no fill. */
const isTextOnly = (drawing: Drawing, item: Cell) => {
  const style = drawing.style(item);
  return (
    shapeOf(style) === "text" ||
    shapeOf(style) === "edgeLabel" ||
    (style.get("strokeColor") === "none" && (style.get("fillColor") ?? "none") === "none")
  );
};

/** What a cell this package wrote is, by its role other than an element kind. */
const PARTS_BY_ROLE = new Map<string, Part>([
  ["circle", { as: "circle" }],
  ["request", { as: "request" }],
  // A lone R: requests both ways.
  ["request-both", { as: "text" }],
  // Copies and stack outlines are read with the elements they belong to.
  ["copy", { as: "element", kind: "agent" }],
  ["stack", { as: "element", kind: "agent" }],
  ["dots", { as: "dots" }],
  ["provided", { as: "ball" }],
  ["ball", { as: "ball" }],
  ["required", { as: "socket" }],
  ["title", { as: "text" }],
]);

/**
 * What a shape is by its name alone: the shapes of the tam-drawio plugin, which draws TAM with
 * shapes of its own, of TAMshapes and TAM-Ann, and draw.io's own UML shapes.
 */
const PARTS_BY_SHAPE = new Map<string, Part>([
  ["tamPluginMissing", { as: "decoration" }],
  ["agent", { as: "element", kind: "agent" }],
  ["lshape", { as: "element", kind: "agent", drawn: "an L-shaped agent" }],
  ["ushape", { as: "element", kind: "agent", drawn: "an U-shaped agent" }],
  ["corner", { as: "element", kind: "agent", drawn: "an L-shaped agent" }],
  ["queue", { as: "element", kind: "storage", drawn: "a queue" }],
  ["dot3", { as: "dots" }],
  ["actor", { as: "element", kind: "human" }],
  ["module", { as: "decoration" }],
  ["component", { as: "decoration" }],
  ["umlActor", { as: "element", kind: "human" }],
  // TAM-Ann's Note, and draw.io's own.
  ["note2", { as: "element", kind: "note" }],
  ["note", { as: "element", kind: "note" }],
  ["folder", { as: "element", kind: "package" }],
  ["requiredInterface", { as: "socket" }],
]);

/** The shapes of a storage drawn as a cylinder. */
const CYLINDERS = new Set(["cylinder3", "cylinder", "datastore"]);

/** What a vertex is, by its role when this package wrote it, else by its picture. */
function partOf(drawing: Drawing, item: Cell): Part {
  const role = roleOf(drawing, item);
  if (role) return partByRole(role);
  // Inside a figure, a dots group or a modifying access: part of something else.
  if (inSymbol(drawing, item)) return { as: "decoration" };
  return partByPicture(drawing, item);
}

/** What a vertex is by its picture: its shape, else its outline, fill and size. */
function partByPicture(drawing: Drawing, item: Cell): Part {
  const style = drawing.style(item);
  const shape = shapeOf(style);
  // A group around other cells is no part of its own; the cells in it are read one by one.
  if (shape === "group") return groupPart(drawing, item);
  const named = PARTS_BY_SHAPE.get(shape);
  if (named) return named;
  if (shape === "stencil")
    return (item.style ?? "").includes(REQUEST_STENCIL.slice(0, 40))
      ? { as: "request" }
      : { as: "unknown", shape };
  if (shape === "partialRectangle" || style.get("edgeStyle")) return { as: "unknown", shape };
  if (shape === "ellipse") return ellipsePart(drawing, item, style);
  return plainPart(drawing, item, style, shape);
}

/** What a cell this package wrote is, by its role. */
function partByRole(role: string): Part {
  if (ROLE_KINDS.has(role)) return { as: "element", kind: role as ElementKind };
  return PARTS_BY_ROLE.get(role) ?? { as: "decoration" };
}

/** Whether a group of several cells drawn as one symbol: a stick figure, three dots, a modifying access. */
const isSymbol = (drawing: Drawing, group: Cell) =>
  shapeOf(drawing.style(group)) === "group" &&
  (isFigure(drawing, group) || isDotsGroup(drawing, group) || isModifyGroup(drawing, group));

/** Whether a cell stands inside a symbol, at any depth. */
function inSymbol(drawing: Drawing, item: Cell): boolean {
  for (let up = drawing.parentOf(item); up; up = drawing.parentOf(up))
    if (isSymbol(drawing, up)) return true;
  return false;
}

/** What a group is: the symbol it draws, else a mere decoration. */
function groupPart(drawing: Drawing, group: Cell): Part {
  if (isFigure(drawing, group)) return { as: "figure" };
  if (isDotsGroup(drawing, group)) return { as: "dots" };
  if (isModifyGroup(drawing, group)) return { as: "modify" };
  return { as: "decoration" };
}

/** What a circle is: by its size a channel's circle or an interface's ball; filled, no TAM. */
function ellipsePart(drawing: Drawing, item: Cell, style: Style): Part {
  if (isDark(style)) return { as: "unknown", shape: "dot" };
  if (drawing.parentOf(item)?.edge) return { as: "circle" };
  const size = Math.max(drawing.box(item).width, drawing.box(item).height);
  if (size <= 12) return { as: "ball" };
  if (size <= 32) return { as: "circle" };
  return { as: "unknown", shape: "ellipse" };
}

/** What a shape is that its name does not settle: a text, an area, a storage, a group or an agent. */
function plainPart(drawing: Drawing, item: Cell, style: Style, shape: string): Part {
  if (isTextOnly(drawing, item)) return { as: "text" };
  // An area: a filled background without an outline (TAM-Ann Area).
  if (style.get("strokeColor") === "none" || style.get("strokeWidth") === "0")
    return { as: "decoration" };
  if (CYLINDERS.has(shape)) return { as: "element", kind: "storage" };
  if (shape === "rect" || shape === "rectangle" || shape === "label")
    return rectanglePart(drawing, item, style);
  return { as: "unknown", shape };
}

/**
 * What a rectangle is: a thin one without fill a group, a rounded one a storage, a dashed rounded
 * one a structure variance, else an agent.
 */
function rectanglePart(drawing: Drawing, item: Cell, style: Style): Part {
  const thin =
    Number(style.get("strokeWidth") ?? 1) <= 1 && (style.get("fillColor") ?? "") === "none";
  if (thin) return { as: "element", kind: "group" };
  if (!isOn(style, "rounded")) return { as: "element", kind: "agent" };
  if (dashed(style)) return { as: "element", kind: "group", drawn: "a structure variance" };
  // TAM-BD's Queue: a storage with an arrow drawn inside it.
  if (drawing.children(item.id).some((child) => child.edge))
    return { as: "element", kind: "storage", drawn: "a queue" };
  return { as: "element", kind: "storage" };
}

/** The ids the syntax takes. */
const ID = /^[A-Za-z_]\w*$/;

const RESERVED = [...ELEMENT_KINDS, "title", "direction", "level", "provides", "requires"];

/** A label in the source: in brackets, or in quotes when it holds a bracket. */
function bracketed(label: string): string {
  const text = label.replace(/\n/g, "<br>");
  if (!text.includes("]")) return `[${text}]`;
  return `"${text.replace(/"/g, "'")}"`;
}

/** A label or a protocol inside an arrow: quoted when it holds what the arrow syntax reads. */
function inArrow(text: string): string {
  const single = text
    .replace(/\n/g, "<br>")
    .replace(/-->|---|\.->/g, "->")
    .trim();
  return /[:@"]|^-/.test(single) ? `"${single.replace(/"/g, "'")}"` : single;
}

/** The request marker's direction: rotation 0 points down, -90 right, 90 left, 180 up. */
function requestWay(drawing: Drawing, marker: Cell): Point {
  const degrees = Number(drawing.style(marker).get("rotation") ?? 0),
    radians = (degrees * Math.PI) / 180;
  return { x: -Math.sin(radians), y: Math.cos(radians) };
}

/** The distance from a point to a box (0 inside it). */
const distanceTo = (box: Box, point: Point) =>
  Math.hypot(
    Math.max(box.x - point.x, 0, point.x - box.x - box.width),
    Math.max(box.y - point.y, 0, point.y - box.y - box.height),
  );

/** The distance from a point to a polyline. */
function distanceToPath(path: Point[], point: Point): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.max(
      0,
      Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length ** 2),
    );
    best = Math.min(
      best,
      Math.hypot(point.x - a.x - t * (b.x - a.x), point.y - a.y - t * (b.y - a.y)),
    );
  }
  return best;
}

/**
 * The texts that stand on their own on a page: drawn by hand, a label is often a text beside the
 * shape or connection it names. Each is taken once, by what stands nearest; the rest are left over.
 */
class FreeTexts {
  private readonly items: { cell: Cell; box: Box; text: string; taken: boolean }[];
  constructor(drawing: Drawing, cells: Cell[]) {
    this.items = cells
      .map((cell) => ({ cell, box: drawing.box(cell), text: drawing.label(cell), taken: false }))
      .filter((item) => item.text);
  }
  /** The nearest text not taken yet within `reach` of a box, taken. */
  take(near: Box, reach: number): string | undefined {
    const found = this.items
      .filter((item) => !item.taken)
      .map((item) => ({ item, distance: gap(item.box, near) }))
      .filter(({ distance }) => distance <= reach)
      .toSorted((a, b) => a.distance - b.distance)[0];
    if (!found) return undefined;
    found.item.taken = true;
    return found.item.text;
  }
  /** The texts nothing took. */
  get left(): Cell[] {
    return this.items.filter((item) => !item.taken).map((item) => item.cell);
  }
}

/** The distance between two boxes, 0 where they touch or overlap. */
const gap = (a: Box, b: Box) =>
  Math.hypot(
    Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width)),
    Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height)),
  );

/** A point as a box. */
const spot = (point: Point): Box => ({ x: point.x, y: point.y, width: 0, height: 0 });

/** A connection read from the page, before its protocol is known. */
type Connection = { text: string } | Channel;

/** A channel read from the page, before its protocol is known. */
interface Channel {
  from: Element;
  to: Element;
  word: Word;
  both: boolean;
  label?: string;
  carrier: Cell;
  /** Where a text that names it would stand: by its circle. */
  at: Box;
}

/** What a channel carries: requests, data, or nothing said. */
type Word = "calls" | "sends data" | "---";

/** What a channel carries and which way: `swap` turns it from the line's target to its source. */
interface Way {
  word: Word;
  both: boolean;
  swap: boolean;
}

/** An access read from the page: an agent reading or writing a storage. */
interface Access {
  agent: Element;
  storage: Element;
  toStorage: boolean;
  toAgent: boolean;
  label?: string;
  /** Where a text that names it would stand. */
  at: Box;
}

/** A connection's line as drawn between two elements: its heads, its label and the marks on it. */
interface Line {
  edge: Cell;
  path: Point[];
  style: Style;
  role?: string;
  from: Element;
  to: Element;
  label?: string;
  startArrow: boolean;
  endArrow: boolean;
  /** The circle of a channel drawn on the line. */
  circle?: Cell;
  /** The tam-drawio plugin's channel line, which draws its circle and its R itself. */
  useEdge: boolean;
  /** A modifying access, drawn by this package or as the plugin's line drawn as two arrows. */
  modify: boolean;
  channelLike: boolean;
}

/**
 * The plugin's R: north or east sends requests toward the line's target, south or west toward its
 * source, whichever way the line runs where the R stands (resolveUseSign in tam-drawio).
 */
const USE_SIGNS = new Map<string, Way>([
  ["both", { word: "calls", both: true, swap: false }],
  ["north", { word: "calls", both: false, swap: false }],
  ["east", { word: "calls", both: false, swap: false }],
  ["south", { word: "calls", both: false, swap: true }],
  ["west", { word: "calls", both: false, swap: true }],
]);

/** The dependencies the syntax has a word for. */
const DEPENDENCY = /^«\s*(use|import|create|generate|pointer)\s*»$/i;

/** The dependency a connection's label names, in lower case. */
const dependencyKeyword = (label: string | undefined) =>
  label?.match(DEPENDENCY)?.[1]?.toLowerCase();

/** Whether a line is drawn as a dependency: written as one, or dashed and no channel. */
const isDependencyLine = (line: Line) =>
  line.role === "dependency" || (dashed(line.style) && !line.channelLike);

/** The words of an access by the way data flows. */
const accessWord = (toStorage: boolean, toAgent: boolean) =>
  toStorage && toAgent ? "reads/writes" : toStorage ? "writes" : "reads";

/** The dot product of two directions. */
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

/** The area of a box. */
const area = (box: Box) => box.width * box.height;

/**
 * A page read as a TAM block diagram, in its phases: the parts by their picture, the elements and
 * what holds what, the connections, the protocols, the labels from free texts, and the source
 * written out.
 */
class TamPage {
  readonly warnings: string[] = [];
  private readonly drawing: Drawing;
  private readonly parts = new Map<string, Part>();
  /** Texts on their own, which may name a figure, a protocol or a connection. */
  private readonly texts: FreeTexts;
  private readonly list: Element[];
  private readonly elements: Map<string, Element>;
  private readonly ids = new Ids(RESERVED);
  /** Interfaces standing alone: what they offer and their name. */
  private readonly interfaces: Map<string, { offers: string; label: string }>;
  /** Channel circles standing alone that hand-drawn channels run through. */
  private readonly circles: Set<string>;
  /** The lines that run into each circle standing alone. */
  private readonly throughCircle = new Map<string, Cell[]>();
  private readonly edges: Cell[];
  /** Dashed lines that end nowhere: the borders that name a protocol. */
  private readonly borders: Cell[];
  private readonly connections: Connection[] = [];
  private readonly protocols = new Map<Cell, string>();
  private readonly accesses = new Map<string, Access>();

  constructor(drawing: Drawing) {
    this.drawing = drawing;
    for (const item of drawing.parts)
      if (item.vertex) this.parts.set(item.id, partOf(drawing, item));
    this.texts = new FreeTexts(
      drawing,
      drawing.parts.filter((item) => item.vertex && this.isFreeText(item)),
    );
    this.list = readElements(drawing, this.parts, this.texts, this.warnings);
    if (!this.list.length)
      throw new DrawioError(
        `Nothing on the page “${drawing.name}” reads as an element of a TAM block diagram.`,
      );
    this.elements = new Map(this.list.map((element) => [element.cell.id, element]));
    this.nameElements();
    this.interfaces = this.looseInterfaces();
    this.circles = new Set(
      drawing.parts
        .filter((item) => this.partIs(item, "circle") && this.loose(item))
        .map((item) => item.id),
    );
    this.edges = drawing.parts.filter((item) => this.isConnection(item));
    this.borders = this.edges.filter((item) => this.isBorder(item));
  }

  /** The diagram the page draws, as a source. */
  read(): Imported {
    for (const edge of this.edges) this.readEdge(edge);
    for (const [circle, legs] of this.throughCircle) this.readCircle(circle, legs);
    for (const symbol of this.modifySymbols()) this.readModifySymbol(symbol);
    for (const border of this.borders) this.readBorder(border);
    this.nameByTexts();
    for (const { agent, storage, toStorage, toAgent, label } of this.accesses.values())
      this.connections.push({
        text: `${this.idOf(agent)} -- ${accessWord(toStorage, toAgent)}${label ? `: ${inArrow(label)}` : ""} --> ${this.idOf(storage)}`,
      });
    const statements = this.connections.map((connection) => this.statement(connection));
    this.warnUnknown();
    const source = [...this.header(), ...this.body(), ...new Set(statements)].join("\n") + "\n";
    try {
      parseTam(source);
    } catch (error) {
      this.warnings.push(
        `The diagram breaks a rule of the TAM notation, to mend in the source: ${(error as Error).message}`,
      );
    }
    return { source, kind: "tam", warnings: this.warnings };
  }

  // Parts and elements

  private partIs(item: Cell, as: Part["as"]) {
    return this.parts.get(item.id)?.as === as;
  }

  /** Whether a vertex stands on its own, not on a connection. */
  private loose(item: Cell) {
    return !this.drawing.parentOf(item)?.edge;
  }

  /** Interfaces standing alone: what they offer and their name. */
  private looseInterfaces() {
    const { drawing } = this;
    return new Map(
      drawing.parts
        .filter(
          (item) => (this.partIs(item, "ball") || this.partIs(item, "socket")) && this.loose(item),
        )
        .map((item) => [
          item.id,
          {
            offers: this.partIs(item, "ball") ? "provides" : "requires",
            label: drawing.label(item),
          },
        ]),
    );
  }

  /** Whether a cell is a line of its own: not inside a shape, a copy or a stick figure. */
  private isConnection(item: Cell) {
    const { drawing } = this;
    return (
      !!item.edge &&
      !drawing.parentOf(item)?.vertex &&
      !["copy", "figure"].includes(roleOf(drawing, item) ?? "")
    );
  }

  private isFreeText(item: Cell) {
    return this.partIs(item, "text") && !roleOf(this.drawing, item) && this.loose(item);
  }

  private isBorder(item: Cell) {
    const role = roleOf(this.drawing, item);
    if (role) return role === "protocol";
    return !item.source && !item.target && dashed(this.drawing.style(item));
  }

  private named(item: Cell) {
    const label = this.drawing.label(item).replace(/\n/g, " ");
    return quotedOr(label, `the ${item.edge ? "connection" : "shape"} ${item.id}`);
  }

  /**
   * Ids: the cell's own where the syntax takes it, else one from the label, written as the editor
   * writes them (`Order API` gives `order_api`). An anonymous group gets one only when a connection
   * names it.
   */
  private nameElements() {
    const byReading = readingOrder(this.list, (element) => element.box);
    for (const element of byReading)
      if (!element.anonymous && ID.test(element.cell.id))
        element.id = this.ids.of(element.cell.id, element.label, element.kind);
    for (const element of byReading)
      if (!element.anonymous && !element.id)
        element.id = this.ids.of(element.cell.id, element.label.toLowerCase(), element.kind);
  }

  private idOf(element: Element) {
    return (element.id ||=
      element.kind === "note"
        ? this.ids.of(element.cell.id, "", "note")
        : this.ids.of(element.cell.id, element.label.toLowerCase(), "group"));
  }

  /** The element a cell belongs to: itself, or the element it is a part, a copy or an outline of. */
  private elementOf(id: string | undefined): Element | undefined {
    const { drawing, elements } = this;
    for (let item = id ? drawing.cells.get(id) : undefined; item; item = drawing.parentOf(item)) {
      const element = elements.get(item.id) ?? elements.get(drawing.style(item).get("tamOf") ?? "");
      if (element) return element;
    }
    return undefined;
  }

  /**
   * The element at a loose end of a connection: the one whose outline is nearest, within reach. An
   * end dropped inside a container next to one of its parts belongs to the part: what counts is how
   * far the end is from an outline, from inside or outside.
   */
  private elementAt(point: Point | undefined) {
    if (!point) return undefined;
    return this.list
      .filter((element) => toOutline(element.box, point) <= 10)
      .toSorted(
        (a, b) => toOutline(a.box, point) - toOutline(b.box, point) || area(a.box) - area(b.box),
      )[0];
  }

  /** The element at an end of a connection: the one it is attached to, else the one it ends at. */
  private endOf(id: string | undefined, point: Point | undefined) {
    return this.elementOf(id) ?? this.elementAt(point);
  }

  private passive(element: Element) {
    return (
      element.kind === "storage" || (element.kind === "group" && isPassive(element, this.list))
    );
  }

  // Connections

  private marksOn(edge: Cell) {
    return this.drawing.children(edge.id).filter((item) => item.vertex);
  }

  /** A connection's label: its own, or the label cells draw.io adds on it. */
  private labelOf(edge: Cell) {
    const { drawing } = this;
    return (
      drawing.label(edge) ||
      this.marksOn(edge)
        .filter((mark) => this.partIs(mark, "text") && drawing.label(mark) !== "R")
        .map((mark) => drawing.label(mark))
        .join("\n") ||
      undefined
    );
  }

  private readEdge(edge: Cell) {
    if (this.borders.includes(edge) || this.intoCircle(edge)) return;
    // Our own interfaces are read from the ball or socket the line ends at.
    const offered = this.interfaceAt(edge);
    if (offered) return this.readInterface(edge, offered);
    const path = this.drawing.path(edge);
    const [from, to] = [this.endOf(edge.source, path[0]), this.endOf(edge.target, path.at(-1))];
    if (!from || !to || from === to) {
      this.warnings.push(
        `The connection ${this.named(edge)} does not join two elements; it is left out.`,
      );
      return;
    }
    // A line from a note attaches it to what it remarks on, whatever the line looks like.
    if (from.kind === "note" || to.kind === "note") return this.readAnchor(edge, from, to);
    this.readConnection(this.lineOf(edge, path, from, to));
  }

  /** The interface standing alone a line ends at. */
  private interfaceAt(edge: Cell) {
    return [edge.source, edge.target].find((end) => end && this.interfaces.has(end));
  }

  /** Whether a line runs into a circle standing alone; it is kept to read with the circle. */
  private intoCircle(edge: Cell) {
    const circle = [edge.source, edge.target].find((end) => end && this.circles.has(end));
    if (circle) this.throughCircle.set(circle, [...(this.throughCircle.get(circle) ?? []), edge]);
    return !!circle;
  }

  /** A line from an element to an interface standing alone: the element provides or requires it. */
  private readInterface(edge: Cell, offered: string) {
    const path = this.drawing.path(edge);
    const owner =
      offered === edge.source
        ? this.endOf(edge.target, path.at(-1))
        : this.endOf(edge.source, path[0]);
    const { offers, label } = this.interfaces.get(offered)!;
    if (owner)
      this.connections.push({
        text: `${this.idOf(owner)} ${offers} ${label.replace(/\n/g, " ") || "IInterface"}`,
      });
    else
      this.warnings.push(
        `The interface ${this.named(this.drawing.cells.get(offered)!)} is not connected to an element; it is left out.`,
      );
  }

  private readAnchor(edge: Cell, from: Element, to: Element) {
    if (from.kind === "note" && to.kind === "note")
      this.warnings.push(`The line ${this.named(edge)} joins two notes; it is left out.`);
    else this.connections.push({ text: `${this.idOf(from)} -.- ${this.idOf(to)}` });
  }

  private lineOf(edge: Cell, path: Point[], from: Element, to: Element): Line {
    const style = this.drawing.style(edge),
      role = roleOf(this.drawing, edge);
    const circle = this.marksOn(edge).find((mark) => this.partIs(mark, "circle"));
    const useEdge = shapeOf(style) === "useedge";
    return {
      edge,
      path,
      style,
      role,
      from,
      to,
      label: this.labelOf(edge),
      startArrow: arrowAt(style, "start") !== "none",
      endArrow: arrowAt(style, "end") !== "none",
      circle,
      useEdge,
      modify: role === "modify" || shapeOf(style) === "updateedge",
      channelLike: !!circle || useEdge,
    };
  }

  /** A connection between two elements: by what it looks like and what it joins. */
  private readConnection(line: Line) {
    const protocol = line.style.get("tamProtocol");
    if (protocol) this.protocols.set(line.edge, protocol);
    if (
      this.readAssembly(line, protocol) ||
      this.readDelegation(line) ||
      this.readDependency(line) ||
      this.readPointer(line) ||
      this.readAccess(line)
    )
      return;
    this.readChannel(line);
  }

  /** An assembly: a ball on the line, where one component requires what the other provides. */
  private readAssembly({ edge, role, from, to, label }: Line, protocol: string | undefined) {
    const ball = this.marksOn(edge).find((mark) => this.partIs(mark, "ball"));
    if (role !== "assembly" && !ball) return false;
    const proto = protocol ? ` @${inArrow(protocol)}` : "";
    this.connections.push({
      text: `${this.idOf(from)} -- requires${label ? ` ${inArrow(label)}` : ""}${proto} --> ${this.idOf(to)}`,
    });
    return true;
  }

  /** A delegation: a line between an element and one of its parts, at any depth. */
  private readDelegation({ role, from, to, label }: Line) {
    if (role !== "delegates" && !holdsDeep(from, to) && !holdsDeep(to, from)) return false;
    const [outer, inner] = holdsDeep(to, from) ? [to, from] : [from, to];
    this.connections.push({
      text: `${this.idOf(outer)} -- delegates${label ? `: ${inArrow(label)}` : ""} --> ${this.idOf(inner)}`,
    });
    return true;
  }

  /** A dependency: dashed, or named with a stereotype the syntax knows. */
  private readDependency(line: Line) {
    const keyword = dependencyKeyword(line.label);
    if (!keyword && !isDependencyLine(line)) return false;
    if (!keyword)
      this.warnings.push(
        `The dashed connection ${this.named(line.edge)} is no dependency («use», «import», «create», «generate» or «pointer»); it is read as «use».`,
      );
    // A line with its only head at the start depends the other way.
    const [a, b] = !line.endArrow && line.startArrow ? [line.to, line.from] : [line.from, line.to];
    this.connections.push({ text: `${this.idOf(a)} -. ${keyword ?? "use"} .-> ${this.idOf(b)}` });
    return true;
  }

  /** A line between two storages, which only a «pointer» joins. */
  private readPointer({ edge, from, to, channelLike }: Line) {
    if (channelLike || !this.passive(from) || !this.passive(to)) return false;
    this.warnings.push(
      `The connection ${this.named(edge)} joins two storages; it is read as a «pointer».`,
    );
    this.connections.push({ text: `${this.idOf(from)} -. pointer .-> ${this.idOf(to)}` });
    return true;
  }

  /**
   * An access, written from the active element: an arrow into the storage writes, one out of it
   * reads.
   */
  private readAccess(line: Line) {
    const { from, to } = line;
    if (line.channelLike || (!this.passive(from) && !this.passive(to))) return false;
    const [agent, storage] = this.passive(to) ? [from, to] : [to, from];
    const key = accessKey(line, agent, storage);
    const access = this.accesses.get(key) ?? {
      agent,
      storage,
      toStorage: false,
      toAgent: false,
      at: spot(this.drawing.along(line.path, 0.5).point),
    };
    this.addFlow(access, line, storage === to);
    this.accesses.set(key, access);
    return true;
  }

  /**
   * What a line adds to an access: the ways its heads point, and its label. `forward` says the line
   * runs from the agent to the storage. One without heads reads and writes.
   */
  private addFlow(access: Access, line: Line, forward: boolean) {
    const intoStorage = forward ? line.endArrow : line.startArrow,
      intoAgent = forward ? line.startArrow : line.endArrow;
    access.toStorage ||= intoStorage || line.modify;
    access.toAgent ||= intoAgent || line.modify;
    if (line.label) access.label ??= line.label;
    if (intoStorage || intoAgent || line.modify) return;
    this.warnings.push(
      `The access ${this.named(line.edge)} has no arrow; it is read as reads/writes.`,
    );
    access.toStorage = access.toAgent = true;
  }

  /** A channel: with a request marker it carries requests, with an arrow data, else it is undirected. */
  private readChannel(line: Line) {
    const { from, to, path } = line;
    const { word, both, swap } = this.channelWay(line);
    this.connections.push({
      from: swap ? to : from,
      to: swap ? from : to,
      word,
      both,
      label: line.label,
      carrier: line.edge,
      at: line.circle
        ? this.drawing.box(line.circle)
        : spot(line.useEdge ? middleOfMiddle(path) : this.drawing.along(path, 0.5).point),
    });
  }

  /** What a channel carries and which way: by the plugin's R, a request marker, or its arrows. */
  private channelWay(line: Line): Way {
    const sign = line.useEdge
      ? USE_SIGNS.get(line.style.get("useSignDirection") ?? "none")
      : undefined;
    if (sign) return sign;
    const request = this.requestOn(line.edge);
    return request ? this.markerWay(line, request) : this.arrowWay(line);
  }

  /** The request marker on a line: the triangle with its R, or a lone R. */
  private requestOn(edge: Cell) {
    return this.marksOn(edge).find(
      (mark) =>
        this.partIs(mark, "request") ||
        (this.partIs(mark, "text") && this.drawing.label(mark) === "R"),
    );
  }

  /** What a channel without a request marker carries: data the way its head points. */
  private arrowWay({ edge, startArrow, endArrow }: Line): Way {
    if (startArrow && endArrow) {
      this.warnings.push(
        `The channel ${this.named(edge)} carries data both ways; it is read as requests both ways.`,
      );
      return { word: "calls", both: true, swap: false };
    }
    if (startArrow || endArrow) return { word: "sends data", both: false, swap: startArrow };
    return { word: "---", both: false, swap: false };
  }

  /**
   * Which way a request marker sends requests: along the line where it stands, or, set across the
   * line, from one element toward the other. A lone R sends them both ways.
   */
  private markerWay({ path, from, to }: Line, request: Cell): Way {
    if (!this.partIs(request, "request")) return { word: "calls", both: true, swap: false };
    const way = requestWay(this.drawing, request);
    const tangent = tangentAt(path, nearestShare(path, centerOf(this.drawing.box(request))));
    let toward = dot(way, tangent);
    if (Math.abs(toward) < 0.3) {
      const a = centerOf(from.box),
        b = centerOf(to.box);
      toward = dot(way, { x: b.x - a.x, y: b.y - a.y });
    }
    return { word: "calls", both: false, swap: toward < 0 };
  }

  /** A channel drawn as two lines through a circle that stands alone. */
  private readCircle(circle: string, legs: Cell[]) {
    const circleCell = this.drawing.cells.get(circle)!;
    const ends = legs.map((leg) => this.legEnd(circle, leg));
    const [a, b] = ends;
    if (ends.length !== 2 || !a.element || !b.element) {
      this.warnings.push(
        `The channel ${this.named(circleCell)} does not join two elements; it is left out.`,
      );
      return;
    }
    const label =
      this.drawing.label(circleCell) ||
      ends.map((end) => this.drawing.label(end.leg)).find(Boolean) ||
      undefined;
    const { word, swap } = this.circleWay(circleCell, a, b);
    this.connections.push({
      from: swap ? b.element : a.element,
      to: swap ? a.element : b.element,
      word,
      both: false,
      label,
      carrier: circleCell,
      at: this.drawing.box(circleCell),
    });
  }

  /** The far end of a line into a circle: its element, and the heads at the circle and away from it. */
  private legEnd(circle: string, leg: Cell) {
    const atStart = leg.source === circle,
      path = this.drawing.path(leg),
      style = this.drawing.style(leg);
    return {
      element: atStart ? this.endOf(leg.target, path.at(-1)) : this.endOf(leg.source, path[0]),
      intoCircle: arrowAt(style, atStart ? "start" : "end") !== "none",
      outward: arrowAt(style, atStart ? "end" : "start") !== "none",
      leg,
    };
  }

  /** What a channel through a circle carries: requests by the marker beside it, else data by its heads. */
  private circleWay(
    circle: Cell,
    a: ReturnType<TamPage["legEnd"]>,
    b: ReturnType<TamPage["legEnd"]>,
  ): Omit<Way, "both"> {
    const marker = this.drawing.parts.find(
      (item) =>
        this.partIs(item, "request") &&
        this.loose(item) &&
        distanceTo(this.drawing.box(item), centerOf(this.drawing.box(circle))) < 40,
    );
    if (marker) {
      const way = requestWay(this.drawing, marker),
        p = centerOf(a.element!.box),
        q = centerOf(b.element!.box);
      return { word: "calls", swap: dot(way, { x: q.x - p.x, y: q.y - p.y }) < 0 };
    }
    if (b.outward || a.intoCircle) return { word: "sends data", swap: false };
    if (a.outward || b.intoCircle) return { word: "sends data", swap: true };
    return { word: "---", swap: false };
  }

  /**
   * The modifying access of TAM-BD, two arcs set between an agent and a storage, and the plugin's
   * access line left loose.
   */
  private modifySymbols(): { cell: Cell; path: Point[] }[] {
    const { drawing } = this;
    return [
      ...drawing.parts
        .filter((item) => this.partIs(item, "modify"))
        .map((item) => {
          const arc = drawing.children(item.id).find((line) => line.edge)!;
          return { cell: item, path: drawing.path(arc) };
        }),
      ...this.edges
        .filter(
          (edge) =>
            shapeOf(drawing.style(edge)) === "updateedge" &&
            !(this.elementOf(edge.source) && this.elementOf(edge.target)),
        )
        .map((edge) => ({ cell: edge, path: drawing.path(edge) })),
    ];
  }

  /** A modifying access drawn on its own: the elements nearest its two ends are what it joins. */
  private readModifySymbol(symbol: { cell: Cell; path: Point[] }) {
    const a = this.nearest(symbol.path[0]),
      b = a && this.nearest(symbol.path.at(-1)!, a);
    const storage = [a, b].find((end) => end && this.passive(end)),
      agent = [a, b].find((end) => end && !this.passive(end));
    if (!storage || !agent) {
      this.warnings.push(
        `The modifying access ${this.named(symbol.cell)} stands between no agent and storage; it is left out.`,
      );
      return;
    }
    // Several symbols between the same pair are one access.
    this.accesses.set(`modify\u0000${agent.cell.id}\u0000${storage.cell.id}`, {
      agent,
      storage,
      toStorage: true,
      toAgent: true,
      at: this.drawing.box(symbol.cell),
    });
  }

  /** The element nearest a point outside it, within reach, other than `other`. */
  private nearest(point: Point, other?: Element) {
    return this.list
      .filter(
        (element) =>
          element !== other && !holds(element.box, point) && distanceTo(element.box, point) <= 60,
      )
      .toSorted((a, b) => distanceTo(a.box, point) - distanceTo(b.box, point))[0];
  }

  // Protocols and labels

  /** The lines a channel is drawn with: its own, or the two through its circle. */
  private routeOf(carrier: Cell): Point[][] {
    return carrier.edge
      ? [this.drawing.path(carrier)]
      : (this.throughCircle.get(carrier.id) ?? []).map((leg) => this.drawing.path(leg));
  }

  /**
   * The protocol of hand-drawn channels: a dashed border that crosses the channel's line, named by
   * its own label or by the text at it.
   */
  private readBorder(border: Cell) {
    const path = this.drawing.path(border);
    const crossed = this.connections.filter(
      (connection): connection is Channel =>
        "carrier" in connection &&
        !this.protocols.has(connection.carrier) &&
        (crosses(path, this.routeOf(connection.carrier)) ||
          distanceToPath(path, centerOf(connection.at)) <= 12),
    );
    if (!crossed.length) return;
    const name = (this.drawing.label(border) || this.texts.take(boxAround(path), 40) || "").replace(
      /\n/g,
      " ",
    );
    if (!name) return;
    for (const { carrier } of crossed) this.protocols.set(carrier, name);
  }

  /** Drawn by hand, a connection is often named by a text beside it. */
  private nameByTexts() {
    for (const connection of this.connections)
      if ("carrier" in connection && !connection.label)
        connection.label = this.texts.take(connection.at, 40);
    for (const access of this.accesses.values()) access.label ??= this.texts.take(access.at, 30);
    for (const item of this.texts.left)
      this.warnings.push(
        `The text “${this.drawing.label(item).replace(/\n/g, " ")}” names nothing on the page; it is left out.`,
      );
  }

  private warnUnknown() {
    for (const item of this.drawing.parts) {
      const part = this.parts.get(item.id);
      if (part?.as === "unknown" && this.loose(item) && part.shape !== "dot")
        this.warnings.push(
          `The shape ${part.shape} ${this.named(item)} has no meaning in a TAM block diagram; it is left out.`,
        );
    }
  }

  // The source

  /** A connection's statement: a channel's with its word, label and protocol. */
  private statement(connection: Connection): string {
    if ("text" in connection) return connection.text;
    const { from, to, word, both, label, carrier } = connection;
    const protocol = this.protocols.get(carrier),
      proto = protocol ? `@${inArrow(protocol)}` : "";
    if (word === "---") return this.undirected(from, to, label, proto);
    const named = label ? `: ${inArrow(label)}` : "";
    return `${this.idOf(from)} ${both ? "<--" : "--"} ${word}${named}${proto ? ` ${proto}` : ""} --> ${this.idOf(to)}`;
  }

  /** The statement of a channel that says nothing of what it carries. */
  private undirected(from: Element, to: Element, label: string | undefined, proto: string) {
    if (!label && !proto) return `${this.idOf(from)} --- ${this.idOf(to)}`;
    const middle = [label && inArrow(label), proto].filter(Boolean).join(" ");
    return `${this.idOf(from)} -- ${middle} --- ${this.idOf(to)}`;
  }

  private header(): string[] {
    const { drawing } = this;
    const title = pageTitle(drawing, /^TAM block diagram$/);
    const direction = drawing.data.tamDirection;
    return [
      ...(title ? [`title ${title}`] : []),
      ...(direction && direction !== "TB" ? [`direction ${direction}`] : []),
      ...(drawing.data.tamLevel ? [`level ${drawing.data.tamLevel}`] : []),
    ];
  }

  /** The elements nested in reading order, with the dots between them. */
  private body(): string[] {
    const { drawing, list } = this;
    const dotsHolder = (box: Box) =>
      list
        .filter(
          (element) =>
            element.kind !== "note" && inside(box, element.box, 2) && area(element.box) > area(box),
        )
        .toSorted((a, b) => area(a.box) - area(b.box))[0];
    const dots = drawing.parts
      .filter((item) => this.partIs(item, "dots") && roleOf(drawing, item) !== "copy-dots")
      .map((item): Dots => ({ box: drawing.box(item), in: dotsHolder(drawing.box(item)) }));
    const body: string[] = [];
    const declare = (parent: Element | undefined, indent: string) => {
      const items = readingOrder<Element | Dots>(
        [
          ...list.filter((element) => element.parent === parent),
          ...dots.filter((item) => item.in === parent),
        ],
        (item) => item.box,
      );
      for (const item of items) {
        if (!("kind" in item)) {
          body.push(`${indent}...`);
          continue;
        }
        const holds =
          list.some((other) => other.parent === item) || dots.some((other) => other.in === item);
        body.push(`${indent}${this.declaration(item)}${holds ? " {" : ""}`);
        if (holds) {
          declare(item, `${indent}  `);
          body.push(`${indent}}`);
        }
      }
    };
    declare(undefined, "");
    return body;
  }

  /** An element's declaration: kind, id, name, color, stack, and where it and its copy stand. */
  private declaration({ box, kind, label, color, stack, copy, id }: Element): string {
    // An element without an id keeps a space before its name: `note [A remark]`.
    const named = id ? ` ${id}` : label ? " " : "";
    const name = label ? bracketed(label) : kind === "group" ? "" : "[]";
    const at = ` @${round(box.x)},${round(box.y)} ${round(Math.max(1, box.width))}x${round(Math.max(1, box.height))}`;
    const copyAt = copy
      ? ` ... @${round(this.drawing.box(copy).x)},${round(this.drawing.box(copy).y)}`
      : "";
    return `${kind}${named}${name}${color ? `:::${color}` : ""}${stack ? " stack" : ""}${at}${copyAt}`;
  }
}

/** Three dots on the page, and the element they stand in. */
type Dots = { box: Box; in?: Element };

/** A number as the source writes a position. */
const round = (value: number) => String(Math.round(value));

/**
 * Which access a line is part of. The two arcs of a modifying access are one access; so are two
 * unnamed arrows drawn by hand between the same two elements. Named or written as reads and
 * writes, they stay apart.
 */
function accessKey({ edge, role, label, modify }: Line, agent: Element, storage: Element) {
  if (role === "modify") return `modify\u0000${edge.id.replace(/#.*$/, "")}`;
  if (role || label || modify) return `edge\u0000${edge.id}`;
  return `pair\u0000${agent.cell.id}\u0000${storage.cell.id}`;
}

/** The TAM block diagram a page draws. */
const readTam = (drawing: Drawing): Imported => new TamPage(drawing).read();

/** The elements on a page: kinds, labels, boxes, stacks, copies, colors and what holds what. */
function readElements(
  drawing: Drawing,
  parts: Map<string, Part>,
  texts: FreeTexts,
  warnings: string[],
): Element[] {
  const elements = new Map<string, Element>();
  const marks: Cell[] = [];
  for (const item of drawing.parts) {
    const part = parts.get(item.id);
    if (part?.as !== "element") continue;
    if (part.drawn) warnings.push(drawnWarning(drawing, item, part.drawn, part.kind));
    const role = roleOf(drawing, item);
    if (role === "copy" || role === "stack") marks.push(item);
    else elements.set(item.id, readElement(drawing, item, part.kind));
  }
  readActors(drawing, elements);
  readFigures(drawing, parts, elements, texts);
  readMarks(drawing, elements, marks);
  readStacks(elements);
  const list = [...elements.values()];
  for (const element of list) element.parent = holderOf(drawing, elements, list, element);
  return list;
}

/** The warning for a shape the syntax has no word for. */
function drawnWarning(drawing: Drawing, item: Cell, drawn: string, kind: ElementKind) {
  const label = drawing.label(item);
  const name = label ? `“${label.replace(/\n/g, " ")}”` : `The shape ${item.id}`;
  return `${name} is drawn as ${drawn}, which the syntax has no word for; it is read as ${kind === "agent" ? "an" : "a"} ${kind}.`;
}

const SUBSYSTEM = /^«subsystem»\n/;

/** An element as one cell draws it. */
function readElement(drawing: Drawing, item: Cell, drawnAs: ElementKind): Element {
  const style = drawing.style(item);
  const kind = kindOf(drawing, item, drawnAs);
  const label =
    kind === "subsystem" ? drawing.label(item).replace(SUBSYSTEM, "") : drawing.label(item);
  const color = colorOf(style, roleOf(drawing, item), kind);
  return {
    cell: item,
    kind,
    label,
    box: drawing.box(item),
    // The tam-drawio plugin draws several of an agent as one shape that says so.
    stack: isOn(style, "multiple"),
    ...(color && COLORS.has(color) ? { color } : {}),
    id: "",
    anonymous: isAnonymous(item.id, kind, label),
  };
}

/** Whether a cell holds a vertex whose shape passes `test`. */
const holdsShape = (drawing: Drawing, item: Cell, test: (child: Cell, shape: string) => boolean) =>
  drawing
    .children(item.id)
    .some((child) => child.vertex && test(child, shapeOf(drawing.style(child))));

/**
 * An element's kind by what is drawn in it: a rectangle with a stick figure in it is a human
 * agent, one with the component icon a component, and «subsystem» over its name a subsystem.
 */
function kindOf(drawing: Drawing, item: Cell, kind: ElementKind): ElementKind {
  const agent = kind === "agent";
  const figure = (child: Cell, shape: string) => shape === "group" && isFigure(drawing, child);
  if (agent && holdsShape(drawing, item, figure)) return "human";
  if ((agent || kind === "component") && SUBSYSTEM.test(drawing.label(item))) return "subsystem";
  if (agent && holdsShape(drawing, item, (_, shape) => COMPONENT_ICONS.has(shape)))
    return "component";
  return kind;
}

/** The shapes of the UML component icon. */
const COMPONENT_ICONS = new Set(["module", "component"]);

/**
 * An element's color: our own cells say theirs; a container's tint that carries over to its parts
 * is no color of theirs.
 */
function colorOf(style: Style, role: string | undefined, kind: ElementKind) {
  if (role) return style.get("tamColor");
  return kind === "package" || kind === "group" ? undefined : paletteColor(style);
}

/** Whether an element needs no id unless a line names it: an unnamed group, or a note. */
function isAnonymous(id: string, kind: ElementKind, label: string) {
  if (kind === "note") return !ID.test(id);
  return kind === "group" && (id.startsWith("group#") || !label);
}

/** A stick figure standing in an agent's box makes the agent a human agent. */
function readActors(drawing: Drawing, elements: Map<string, Element>) {
  for (const [id, element] of elements) {
    if (element.kind !== "human" || !isActor(drawing, element.cell)) continue;
    const around = [...elements.values()].find(
      (other) => other !== element && other.kind === "agent" && inside(element.box, other.box, 2),
    );
    if (around) {
      around.kind = "human";
      elements.delete(id);
    }
  }
}

const isActor = (drawing: Drawing, item: Cell) =>
  ["umlActor", "actor"].includes(shapeOf(drawing.style(item)));

/**
 * A stick figure set onto an agent makes it a human agent; standing alone, it is a human agent
 * named by the text beside it.
 */
function readFigures(
  drawing: Drawing,
  parts: Map<string, Part>,
  elements: Map<string, Element>,
  texts: FreeTexts,
) {
  for (const item of drawing.parts) {
    if (parts.get(item.id)?.as !== "figure") continue;
    // One that draw.io keeps in an agent has made that agent a human agent already.
    const holder = drawing.parentOf(item);
    if (holder && elements.has(holder.id)) continue;
    const box = drawing.box(item);
    const around = agentAround(elements, box);
    if (around) around.kind = "human";
    else
      elements.set(item.id, {
        cell: item,
        kind: "human",
        label: texts.take(box, 30) ?? "",
        box,
        stack: false,
        id: "",
        anonymous: false,
      });
  }
}

/** The smallest agent whose box holds a box. */
const agentAround = (elements: Map<string, Element>, box: Box) =>
  [...elements.values()]
    .filter(
      (other) => (other.kind === "agent" || other.kind === "human") && inside(box, other.box, 2),
    )
    .toSorted((a, b) => area(a.box) - area(b.box))[0];

/** Copies and stack outlines this package wrote name the element they belong to. */
function readMarks(drawing: Drawing, elements: Map<string, Element>, marks: Cell[]) {
  for (const item of marks) {
    const owner = elements.get(drawing.style(item).get("tamOf") ?? "");
    if (!owner) continue;
    if (roleOf(drawing, item) === "stack") owner.stack = true;
    else owner.copy = item;
  }
}

/** Drawn by hand, a stack is an unnamed outline of the same size a little behind and below an element. */
function readStacks(elements: Map<string, Element>) {
  for (const [id, back] of [...elements]) {
    if (back.label) continue;
    const front = [...elements.values()].find((other) => isBehind(back, other));
    if (front) {
      front.stack = true;
      elements.delete(id);
    }
  }
}

/** Whether `back` is the outline of a stack behind `front`. */
function isBehind(back: Element, front: Element): boolean {
  const dx = back.box.x - front.box.x,
    dy = back.box.y - front.box.y;
  return (
    front !== back &&
    front.kind === back.kind &&
    Math.abs(front.box.width - back.box.width) < 1 &&
    Math.abs(front.box.height - back.box.height) < 1 &&
    dx > 0 &&
    dx <= 12 &&
    dy > 0 &&
    dy <= 12
  );
}

/**
 * The element an element belongs to: the one draw.io nests it in; drawn loose, the smallest
 * element whose box holds its box.
 */
function holderOf(
  drawing: Drawing,
  elements: Map<string, Element>,
  list: Element[],
  element: Element,
): Element | undefined {
  for (let up = drawing.parentOf(element.cell); up; up = drawing.parentOf(up)) {
    const nest = elements.get(up.id);
    if (nest) return nest;
  }
  return list
    .filter(
      (other) =>
        other !== element &&
        other.kind !== "note" &&
        area(other.box) > area(element.box) &&
        inside(element.box, other.box, 2),
    )
    .toSorted((a, b) => area(a.box) - area(b.box))[0];
}

/** Whether a group counts as a storage: all its elements are storages. */
function isPassive(group: Element, list: Element[]): boolean {
  const inside = list.filter((element) => element.parent === group && element.kind !== "note");
  return (
    inside.length > 0 &&
    inside.every(
      (element) =>
        element.kind === "storage" || (element.kind === "group" && isPassive(element, list)),
    )
  );
}

/** The distance from a point to a box's outline, from inside or outside it. */
const toOutline = (box: Box, point: Point) =>
  holds(box, point)
    ? Math.min(
        point.x - box.x,
        box.x + box.width - point.x,
        point.y - box.y,
        box.y + box.height - point.y,
      )
    : distanceTo(box, point);

/** Where the tam-drawio plugin draws a channel's circle: in the middle of the middle segment. */
function middleOfMiddle(path: Point[]): Point {
  const first = path.length > 2 ? Math.floor(path.length / 2) - 1 : 0;
  const [a, b] = [path[first], path[first + 1] ?? path[first]];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Whether a box holds a point. */
const holds = (box: Box, point: Point) =>
  point.x > box.x && point.x < box.x + box.width && point.y > box.y && point.y < box.y + box.height;

/** The box around a path's points. */
function boxAround(path: Point[]): Box {
  const xs = path.map((p) => p.x),
    ys = path.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Whether a polyline crosses any of the polylines of a route. */
function crosses(line: Point[], route: Point[][]): boolean {
  const cut = (a: Point, b: Point, c: Point, d: Point) => {
    const side = (p: Point, q: Point, r: Point) =>
      (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const [d1, d2, d3, d4] = [side(c, d, a), side(c, d, b), side(a, b, c), side(a, b, d)];
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  return route.some((path) =>
    path.slice(1).some((q, j) => line.slice(1).some((b, i) => cut(line[i], b, path[j], q))),
  );
}

/** The share of a path's length nearest a point. */
function nearestShare(path: Point[], point: Point): number {
  let total = 0,
    best = { distance: Infinity, at: 0 };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      length = Math.hypot(b.x - a.x, b.y - a.y);
    const t = length
      ? Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length ** 2,
          ),
        )
      : 0;
    const distance = Math.hypot(point.x - a.x - t * (b.x - a.x), point.y - a.y - t * (b.y - a.y));
    if (distance < best.distance) best = { distance, at: total + t * length };
    total += length;
  }
  return total ? best.at / total : 0.5;
}

/** The direction of a path at a share of its length. */
function tangentAt(path: Point[], share: number): Point {
  const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
  let left = share * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const length = lengths[i] || 1;
      return { x: (path[i + 1].x - path[i].x) / length, y: (path[i + 1].y - path[i].y) / length };
    }
    left -= lengths[i];
  }
  return { x: 1, y: 0 };
}

/** The roles this package writes that only a TAM block diagram has. */
const TAM_ROLES = new Set<string>([
  ...ELEMENT_KINDS,
  "circle",
  "request",
  "calls",
  "sends",
  "channel",
  "read",
  "write",
  "modify",
]);

/** How much a vertex's picture says TAM: a circle or a request marker most, a human agent or a storage more than other elements. */
function pictureScore(part: Part): number {
  if (part.as === "circle" || part.as === "request") return 3;
  if (part.as !== "element") return 0;
  return part.kind === "human" || part.kind === "storage" ? 1.5 : 1;
}

/** How much a page looks like a TAM block diagram. */
function tamLikeness(drawing: Drawing): number {
  let score = 0;
  for (const item of drawing.parts) {
    const role = roleOf(drawing, item);
    if (role && TAM_ROLES.has(role)) score += 10;
    if (item.vertex) score += pictureScore(partOf(drawing, item));
  }
  return score;
}

export const tamDrawio: DrawioType = {
  kinds: ["tam"],
  cells: tamCells,
  likeness: tamLikeness,
  read: readTam,
};
