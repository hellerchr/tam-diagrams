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
  readingOrder,
  REQUEST_STENCIL,
  roleOf,
  TAMSHAPES,
  titleCell,
  vertexGeometry,
  within,
} from "./drawio-shapes.ts";
import {
  type Box,
  centerOf,
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

/** The box around boxes. */
function around(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x)),
    y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

/** The cell id of an element: its id; anonymous groups and copies keep theirs, `#` and all. */
const cellId = (id: string) => id;

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
function dots(id: string, parent: string, box: Box, outer: Box | undefined): Cell[] {
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
    "dots",
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

/** The style of an element's cell. */
function elementStyle(node: TamNode, shape: SceneShape | undefined, container: boolean) {
  const storage = node.kind === "storage" || (node.kind === "group" && !!node.passive);
  const fill = shape && fillOf(shape);
  if (node.kind === "note")
    return {
      ...TAMSHAPES.note,
      ...(fill ? { fillColor: fill } : {}),
      fontSize: FONT_SIZE,
      ...(node.color ? { tamColor: node.color } : {}),
    };
  const base =
    node.kind === "package"
      ? { ...TAMSHAPES.package, fillColor: fill ?? TAMSHAPES.package.fillColor }
      : node.kind === "group"
        ? {
            rounded: 1,
            absoluteArcSize: 1,
            arcSize: storage ? 36 : 8,
            whiteSpace: "wrap",
            html: 1,
            strokeWidth: 1,
            fillColor: "none",
          }
        : storage
          ? container
            ? { ...TAMSHAPES.storage, absoluteArcSize: 1, arcSize: 36 }
            : TAMSHAPES.storage
          : node.kind === "human"
            ? { ...TAMSHAPES.agent, verticalAlign: "bottom", spacingBottom: 4 }
            : TAMSHAPES.agent;
  return {
    ...base,
    ...(fill && node.kind !== "package" && (node.kind !== "group" || node.color)
      ? { fillColor: fill }
      : {}),
    fontSize: FONT_SIZE,
    ...(container
      ? { container: 1, collapsible: 0, verticalAlign: "top", fontStyle: 1, recursiveResize: 0 }
      : {}),
    ...(node.color ? { tamColor: node.color } : {}),
  };
}

/** The scene's wires of an edge, oriented from the source end to the target end and joined. */
function edgePath(
  scene: Scene,
  edge: TamEdge,
  from: Box | undefined,
  to: Box | undefined,
): Point[] | undefined {
  const wires = scene.wires.filter((wire) => wire.edge === edge.id && wire.points.length > 1);
  if (!wires.length) return undefined;
  const distance = (point: Point, box: Box | undefined) =>
    box
      ? Math.hypot(
          Math.max(box.x - point.x, 0, point.x - box.x - box.width),
          Math.max(box.y - point.y, 0, point.y - box.y - box.height),
        )
      : 0;
  const oriented = (points: Point[], start: Box | undefined) =>
    distance(points[0], start) <= distance(points.at(-1)!, start) ? points : points.toReversed();
  if (wires.length === 1) return oriented(wires[0].points, from);
  // Two legs that meet at a channel's circle or an assembly's ball: the source's leg first.
  const [a, b] = wires.toSorted(
    (p, q) =>
      Math.min(distance(p.points[0], from), distance(p.points.at(-1)!, from)) -
      Math.min(distance(q.points[0], from), distance(q.points.at(-1)!, from)),
  );
  return [...oriented(a.points, from), ...orientedTo(b.points, to)];
}

/** A leg oriented to end at the box. */
function orientedTo(points: Point[], box: Box | undefined): Point[] {
  if (!box) return points;
  const distance = (point: Point) =>
    Math.hypot(
      Math.max(box.x - point.x, 0, point.x - box.x - box.width),
      Math.max(box.y - point.y, 0, point.y - box.y - box.height),
    );
  return distance(points.at(-1)!) <= distance(points[0]) ? points : points.toReversed();
}

/** The rotation that turns the request marker's triangle, which points down, toward `way`. */
const rotation = (way: Point) =>
  Math.abs(way.x) >= Math.abs(way.y) ? (way.x > 0 ? -90 : 90) : way.y > 0 ? 0 : 180;

/** The cells of a TAM block diagram as `scene` lays it out. */
function tamCells(source: string, scene: Scene): Cell[] {
  const diagram = parseTam(source);
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  const cells: Cell[] = [];
  const boxes = new Map<string, Box>();
  /** The element an element stands in, rows of copies and of dots skipped. */
  const parentOf = (id: string) => holder(diagram, id);
  const page: Cell = {
    id: "0",
    data: {
      tamDirection: diagram.direction,
      ...(diagram.level ? { tamLevel: diagram.level } : {}),
    },
  };
  cells.push(page);

  // Elements, outside in: a container's cell comes before its parts'.
  const order: TamNode[] = [];
  const walk = (ids: string[]) =>
    ids.forEach((id) => {
      const node = diagram.nodes.get(id)!;
      order.push(node);
      walk(node.children);
    });
  walk(diagram.roots);
  for (const node of order) {
    const shape = shapes.get(node.id);
    if (node.id.endsWith("#row") || node.kind === "interface") continue;
    const parent = parentOf(node.id),
      outer = parent ? boxes.get(parent) : undefined,
      parentCell = parent && boxes.has(parent) ? cellId(parent) : LAYER;
    if (node.kind === "dots") {
      if (shape)
        cells.push(
          ...dots(cellId(node.id), parentCell, shape.box, outer).map((item, index) =>
            index === 0 && node.id.endsWith("#dots")
              ? { ...item, style: item.style!.replace("tam=dots", "tam=copy-dots") }
              : item,
          ),
        );
      continue;
    }
    if (!shape) continue;
    const container = node.children.some((id) => {
      const child = diagram.nodes.get(id)!;
      return child.kind !== "interface";
    });
    boxes.set(node.id, shape.box);
    const copy = node.origin && node.origin !== node.id;
    const role = copy ? "copy" : node.kind;
    const style = {
      ...elementStyle(node, shape, container && shape.container),
      ...(node.kind === "note" ? noteText(scene, node.id, shape.box) : {}),
      ...(copy ? { tamOf: node.origin } : {}),
    };
    if (node.stack)
      cells.push(
        cell(
          {
            id: `${cellId(node.id)}#stack`,
            parent: parentCell,
            vertex: true,
            connectable: false,
            style: { ...style, container: undefined, tamOf: node.id },
            geometry: vertexGeometry(
              { ...shape.box, x: shape.box.x + STACK, y: shape.box.y + STACK },
              outer,
            ),
          },
          "stack",
        ),
      );
    cells.push(
      cell(
        {
          id: cellId(node.id),
          parent: parentCell,
          value: valueOf(node),
          vertex: true,
          style,
          geometry: vertexGeometry(shape.box, outer),
        },
        role,
      ),
    );
    if (node.kind === "human") cells.push(...figure(cellId(node.id), shape.box));
    if (node.kind === "component" || node.kind === "subsystem")
      cells.push(componentIcon(cellId(node.id), shape.box));
  }

  // Interfaces a component provides or requires alone: a ball or a socket at the end of a line.
  for (const node of diagram.nodes.values()) {
    if (node.kind !== "interface") continue;
    const edge = diagram.edges.find((item) => item.target === node.id)!;
    const provided = edge.kind === "provided";
    const tip = provided
      ? shapes.get(node.id) && centerOf(shapes.get(node.id)!.box)
      : scene.markers.find((marker) => marker.wire === edge.id && marker.kind === "socket")?.tip;
    if (!tip) continue;
    const size = provided ? 10 : 14;
    const box = { x: tip.x - size / 2, y: tip.y - size / 2, width: size, height: size };
    boxes.set(node.id, box);
    const label = scene.texts.find((text) => text.owner === node.id);
    cells.push(
      cell(
        {
          id: cellId(node.id),
          parent: LAYER,
          value: html(node.label),
          vertex: true,
          style: provided
            ? {
                ellipse: "",
                html: 1,
                aspect: "fixed",
                strokeWidth: 1.5,
                labelPosition: "right",
                align: "left",
                spacingLeft: 2,
                fontSize: SMALL,
              }
            : {
                shape: "requiredInterface",
                html: 1,
                strokeWidth: 1.5,
                labelPosition: "right",
                align: "left",
                spacingLeft: 2,
                fontSize: SMALL,
                direction: label && label.box.x < tip.x ? "west" : "east",
              },
          geometry: vertexGeometry(box),
        },
        provided ? "provided" : "required",
      ),
    );
  }

  // Connections.
  for (const edge of diagram.edges) {
    const from = boxes.get(edge.source),
      to = boxes.get(edge.target);
    const path = edgePath(scene, edge, from, to);
    if (!path || !from || !to) continue;
    const copy = edge.id.includes("#");
    /** Where the scene draws a label: the box around all its lines. */
    const labelBox = (owner: string, role: SceneText["role"] = "label") => {
      const lines = scene.texts.filter((text) => text.owner === owner && text.role === role);
      return lines.length ? around(lines.map((text) => text.box)) : undefined;
    };
    const base = {
      ...TAMSHAPES.connection,
      fontSize: SMALL,
      edgeStyle: "orthogonalEdgeStyle" as string,
    };
    const connect = (
      id: string,
      points: Point[],
      style: Record<string, string | number | undefined>,
      role: string,
      value?: string,
      at?: Point,
    ) => {
      const route = edgeRoute(points, from, to);
      cells.push(
        cell(
          {
            id,
            parent: LAYER,
            ...(value ? { value: html(value) } : {}),
            edge: true,
            source: cellId(edge.source),
            target: cellId(edge.target),
            style: { ...base, ...route.style, ...style },
            geometry: at ? labelAt(route.geometry, points, at) : route.geometry,
          },
          copy ? "copy" : role,
        ),
      );
    };
    const text = labelBox(edge.id);
    switch (edge.kind) {
      case "channel":
      case "assembly": {
        const node = `${edge.id}#node`,
          circle = shapes.get(node);
        const nodeLabel = labelBox(node);
        const protocol = edge.protocol ? { tamProtocol: edge.protocol } : {};
        const flow = edge.flow?.toTarget || edge.flow?.toSource;
        connect(
          edge.id,
          path,
          {
            startArrow: edge.flow?.toSource ? "classic" : "none",
            endArrow:
              edge.flow?.toTarget || edge.kind === "assembly"
                ? edge.kind === "assembly"
                  ? "none"
                  : "classic"
                : "none",
            startFill: 1,
            endFill: 1,
            ...protocol,
            ...(edge.kind === "assembly" && edge.label ? {} : {}),
          },
          edge.kind === "assembly"
            ? "assembly"
            : edge.request
              ? "calls"
              : flow
                ? "sends"
                : "channel",
          edge.label,
          nodeLabel ? centerOf(nodeLabel) : undefined,
        );
        if (!circle) break;
        const center = centerOf(circle.box);
        cells.push(
          cell(
            {
              id: `${edge.id}#circle`,
              parent: edge.id,
              vertex: true,
              connectable: false,
              style:
                edge.kind === "assembly"
                  ? {
                      ellipse: "",
                      html: 1,
                      aspect: "fixed",
                      strokeWidth: 1.5,
                      rotatable: 0,
                      deletable: 0,
                    }
                  : { ...TAMSHAPES.channel, deletable: 0, connectable: 0 },
              geometry: markOnEdge(path, center, circle.box),
            },
            edge.kind === "assembly" ? "ball" : "circle",
          ),
        );
        if (edge.request) {
          const pointer = shapes.get(`${node}#pointer`),
            letter = scene.texts.find((item) => item.owner === node && item.role === "marker");
          if (pointer?.facing && letter) {
            // The marker stands where the scene draws the letter and its triangle.
            const middle = centerOf({
              x: Math.min(pointer.box.x, letter.box.x),
              y: Math.min(pointer.box.y, letter.box.y),
              width:
                Math.max(pointer.box.x + pointer.box.width, letter.box.x + letter.box.width) -
                Math.min(pointer.box.x, letter.box.x),
              height:
                Math.max(pointer.box.y + pointer.box.height, letter.box.y + letter.box.height) -
                Math.min(pointer.box.y, letter.box.y),
            });
            cells.push(
              cell(
                {
                  id: `${edge.id}#request`,
                  parent: edge.id,
                  vertex: true,
                  connectable: false,
                  style: { ...TAMSHAPES.request, rotation: rotation(pointer.facing) },
                  geometry: markOnEdge(path, middle, { width: 16, height: 16 }),
                },
                "request",
              ),
            );
          } else if (letter)
            cells.push(
              cell(
                {
                  id: `${edge.id}#request`,
                  parent: edge.id,
                  value: "R",
                  vertex: true,
                  connectable: false,
                  style: { ...TAMSHAPES.text, fontStyle: 1, fontSize: SMALL },
                  geometry: markOnEdge(path, centerOf(letter.box), { width: 14, height: 14 }),
                },
                "request-both",
              ),
            );
        }
        break;
      }
      case "read":
      case "write":
        connect(
          edge.id,
          path,
          edge.kind === "read"
            ? { startArrow: "classic", startFill: 1, endArrow: "none" }
            : { startArrow: "none", endArrow: "classic", endFill: 1 },
          edge.kind,
          edge.label,
          text && centerOf(text),
        );
        break;
      case "modify": {
        // Two arcs, data in and data back, as two curved connectors between the same two elements.
        const arcs = scene.wires.filter((wire) => wire.edge === edge.id && wire.points.length > 1);
        arcs.forEach((arc, index) => {
          const toTarget = orientedTo(arc.points, to) === arc.points;
          const points = toTarget ? arc.points : arc.points.toReversed();
          const bend = points[Math.floor(points.length / 2)];
          const route = edgeRoute([points[0], bend, points.at(-1)!], from, to);
          cells.push(
            cell(
              {
                id: index ? `${edge.id}#back` : edge.id,
                parent: LAYER,
                ...(index === 0 && edge.label ? { value: html(edge.label) } : {}),
                edge: true,
                source: cellId(edge.source),
                target: cellId(edge.target),
                style: {
                  ...base,
                  edgeStyle: "none",
                  curved: 1,
                  ...route.style,
                  ...(toTarget
                    ? { startArrow: "none", endArrow: "classic", endFill: 1 }
                    : { startArrow: "classic", startFill: 1, endArrow: "none" }),
                },
                geometry:
                  index === 0 && text
                    ? labelAt(route.geometry, points, centerOf(text))
                    : route.geometry,
              },
              copy ? "copy" : "modify",
            ),
          );
        });
        break;
      }
      case "delegation":
        connect(
          edge.id,
          path,
          { endArrow: "open", endFill: 0 },
          "delegates",
          edge.label,
          text && centerOf(text),
        );
        break;
      case "dependency":
        connect(
          edge.id,
          path,
          { dashed: 1, endArrow: "open", endFill: 0, ...(edge.aside ? { edgeStyle: "none" } : {}) },
          "dependency",
          edge.label,
          text && centerOf(text),
        );
        break;
      case "provided":
      case "required":
        connect(
          edge.id,
          path,
          { startArrow: "none", endArrow: "none" },
          edge.kind === "provided" ? "provides" : "requires",
        );
        break;
      case "anchor":
        // A note's dotted line, as TAM-Ann draws borders: dashed, without heads.
        connect(
          edge.id,
          path,
          { dashed: 1, dashPattern: "3 3", startArrow: "none", endArrow: "none", strokeWidth: 1 },
          "anchor",
        );
        break;
    }
  }

  // Protocol boundaries: dashed lines with the protocol's name.
  const names = scene.texts.filter((text) => text.role === "protocol");
  scene.lines
    .filter((line) => line.clear && line.dashed)
    .forEach((line, index) => {
      const [start, end] = [line.points[0], line.points.at(-1)!];
      const name = names.toSorted(
        (a, b) =>
          Math.min(
            ...[start, end].map((p) =>
              Math.hypot(centerOf(a.box).x - p.x, centerOf(a.box).y - p.y),
            ),
          ) -
          Math.min(
            ...[start, end].map((p) =>
              Math.hypot(centerOf(b.box).x - p.x, centerOf(b.box).y - p.y),
            ),
          ),
      )[0];
      const geometry = {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        relative: true,
        sourcePoint: start,
        targetPoint: end,
      };
      cells.push(
        cell(
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
        ),
      );
    });

  const title = titleCell(scene);
  if (title && diagram.title) cells.push(title);
  return cells;
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

/** What a vertex is, by its role when this package wrote it, else by its picture. */
function partOf(drawing: Drawing, item: Cell): Part {
  const role = roleOf(drawing, item);
  const style = drawing.style(item);
  const shape = shapeOf(style);
  const parent = drawing.parentOf(item);
  if (role) {
    if (ROLE_KINDS.has(role)) return { as: "element", kind: role as ElementKind };
    if (role === "circle") return { as: "circle" };
    if (role === "request") return { as: "request" };
    // A lone R: requests both ways.
    if (role === "request-both") return { as: "text" };
    // Copies and stack outlines are read with the elements they belong to.
    if (role === "copy" || role === "stack") return { as: "element", kind: "agent" };
    if (role === "dots") return { as: "dots" };
    if (role === "provided" || role === "ball") return { as: "ball" };
    if (role === "required") return { as: "socket" };
    if (role === "title") return { as: "text" };
    return { as: "decoration" };
  }
  // Inside a figure, a dots group or a modifying access: part of something else.
  for (let up = parent; up; up = drawing.parentOf(up))
    if (
      shapeOf(drawing.style(up)) === "group" &&
      (isFigure(drawing, up) || isDotsGroup(drawing, up) || isModifyGroup(drawing, up))
    )
      return { as: "decoration" };
  // A group around other cells is no part of its own; the cells in it are read one by one.
  if (shape === "group")
    return isFigure(drawing, item)
      ? { as: "figure" }
      : isDotsGroup(drawing, item)
        ? { as: "dots" }
        : isModifyGroup(drawing, item)
          ? { as: "modify" }
          : { as: "decoration" };
  // The shapes of the tam-drawio plugin, which draws TAM with shapes of its own.
  if (shape === "tamPluginMissing") return { as: "decoration" };
  if (shape === "agent") return { as: "element", kind: "agent" };
  if (shape === "lshape" || shape === "ushape" || shape === "corner")
    return {
      as: "element",
      kind: "agent",
      drawn: `an ${shape === "ushape" ? "U" : "L"}-shaped agent`,
    };
  if (shape === "queue") return { as: "element", kind: "storage", drawn: "a queue" };
  if (shape === "dot3") return { as: "dots" };
  if (shape === "actor") return { as: "element", kind: "human" };
  if (shape === "stencil")
    return (item.style ?? "").includes(REQUEST_STENCIL.slice(0, 40))
      ? { as: "request" }
      : { as: "unknown", shape };
  if (shape === "module" || shape === "component") return { as: "decoration" };
  if (shape === "umlActor") return { as: "element", kind: "human" };
  // TAM-Ann's Note, and draw.io's own.
  if (shape === "note2" || shape === "note") return { as: "element", kind: "note" };
  if (shape === "folder") return { as: "element", kind: "package" };
  if (shape === "requiredInterface") return { as: "socket" };
  if (shape === "partialRectangle" || style.get("edgeStyle")) return { as: "unknown", shape };
  const box = drawing.box(item);
  if (shape === "ellipse") {
    if (isDark(style)) return { as: "unknown", shape: "dot" };
    if (parent?.edge) return { as: "circle" };
    if (Math.max(box.width, box.height) <= 12) return { as: "ball" };
    if (Math.max(box.width, box.height) <= 32) return { as: "circle" };
    return { as: "unknown", shape };
  }
  if (isTextOnly(drawing, item)) return { as: "text" };
  // An area: a filled background without an outline (TAM-Ann Area).
  if (style.get("strokeColor") === "none" || style.get("strokeWidth") === "0")
    return { as: "decoration" };
  if (shape === "cylinder3" || shape === "cylinder" || shape === "datastore")
    return { as: "element", kind: "storage" };
  if (shape === "rect" || shape === "rectangle" || shape === "label") {
    const thin =
      Number(style.get("strokeWidth") ?? 1) <= 1 && (style.get("fillColor") ?? "") === "none";
    if (isOn(style, "rounded") || style.get("rounded") === "1")
      return thin
        ? { as: "element", kind: "group" }
        : dashed(style)
          ? { as: "element", kind: "group", drawn: "a structure variance" }
          : // TAM-BD's Queue: a storage with an arrow drawn inside it.
            drawing.children(item.id).some((child) => child.edge)
            ? { as: "element", kind: "storage", drawn: "a queue" }
            : { as: "element", kind: "storage" };
    if (thin) return { as: "element", kind: "group" };
    return { as: "element", kind: "agent" };
  }
  return { as: "unknown", shape };
}

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
type Connection =
  | { text: string }
  | {
      from: Element;
      to: Element;
      word: "calls" | "sends data" | "---";
      both: boolean;
      label?: string;
      carrier: Cell;
      /** Where a text that names it would stand: by its circle. */
      at: Box;
    };

/** The TAM block diagram a page draws. */
function readTam(drawing: Drawing): Imported {
  const warnings: string[] = [];
  const named = (item: Cell) => {
    const label = drawing.label(item).replace(/\n/g, " ");
    return label ? `“${label}”` : `the ${item.edge ? "connection" : "shape"} ${item.id}`;
  };
  const parts = new Map<string, Part>();
  for (const item of drawing.parts) if (item.vertex) parts.set(item.id, partOf(drawing, item));
  const partIs = (item: Cell, as: Part["as"]) => parts.get(item.id)?.as === as;

  // Texts on their own, which may name a figure, a protocol or a connection.
  const texts = new FreeTexts(
    drawing,
    drawing.parts.filter(
      (item) =>
        item.vertex &&
        partIs(item, "text") &&
        !roleOf(drawing, item) &&
        !drawing.parentOf(item)?.edge,
    ),
  );
  const list = readElements(drawing, parts, texts, warnings);
  if (!list.length)
    throw new DrawioError(
      `Nothing on the page “${drawing.name}” reads as an element of a TAM block diagram.`,
    );
  const elements = new Map(list.map((element) => [element.cell.id, element]));
  const area = (box: Box) => box.width * box.height;

  // Ids: the cell's own where the syntax takes it, else one from the label; an anonymous group gets
  // one only when a connection names it.
  const ids = new Ids(RESERVED);
  const byReading = readingOrder(list, (element) => element.box);
  for (const element of byReading)
    if (!element.anonymous && /^[A-Za-z_]\w*$/.test(element.cell.id))
      element.id = ids.of(element.cell.id, element.label, element.kind);
  // Ids made from a label are written as the editor writes them: `Order API` gives `order_api`.
  for (const element of byReading)
    if (!element.anonymous && !element.id)
      element.id = ids.of(element.cell.id, element.label.toLowerCase(), element.kind);
  const idOf = (element: Element) =>
    (element.id ||=
      element.kind === "note"
        ? ids.of(element.cell.id, "", "note")
        : ids.of(element.cell.id, element.label.toLowerCase(), "group"));

  /** The element a cell belongs to: itself, or the element it is a part, a copy or an outline of. */
  const elementOf = (id: string | undefined): Element | undefined => {
    for (let item = id ? drawing.cells.get(id) : undefined; item; item = drawing.parentOf(item)) {
      const element = elements.get(item.id) ?? elements.get(drawing.style(item).get("tamOf") ?? "");
      if (element) return element;
    }
    return undefined;
  };
  /** The element at a loose end of a connection: the one whose outline is nearest, within reach. */
  // An end dropped inside a container next to one of its parts belongs to the part: what counts
  // is how far the end is from an outline, from inside or outside.
  const elementAt = (point: Point | undefined) =>
    point
      ? list
          .filter((element) => toOutline(element.box, point) <= 10)
          .toSorted(
            (a, b) =>
              toOutline(a.box, point) - toOutline(b.box, point) || area(a.box) - area(b.box),
          )[0]
      : undefined;
  const nested = (outer: Element, inner: Element) => {
    for (let up = inner.parent; up; up = up.parent) if (up === outer) return true;
    return false;
  };

  // Interfaces standing alone, and channel circles standing alone that hand-drawn channels run through.
  const loose = (item: Cell) => !drawing.parentOf(item)?.edge;
  const interfaces = new Map(
    drawing.parts
      .filter((item) => (partIs(item, "ball") || partIs(item, "socket")) && loose(item))
      .map((item) => [
        item.id,
        { offers: partIs(item, "ball") ? "provides" : "requires", label: drawing.label(item) },
      ]),
  );
  const circles = new Set(
    drawing.parts.filter((item) => partIs(item, "circle") && loose(item)).map((item) => item.id),
  );
  const marksOn = (edge: Cell) => drawing.children(edge.id).filter((item) => item.vertex);
  /** A connection's label: its own, or the label cells draw.io adds on it. */
  const labelOf = (edge: Cell) =>
    drawing.label(edge) ||
    marksOn(edge)
      .filter((mark) => partIs(mark, "text") && drawing.label(mark) !== "R")
      .map((mark) => drawing.label(mark))
      .join("\n") ||
    undefined;

  const edges = drawing.parts.filter(
    (item) =>
      item.edge &&
      !drawing.parentOf(item)?.vertex &&
      !["copy", "figure"].includes(roleOf(drawing, item) ?? ""),
  );
  const borders = edges.filter(
    (item) =>
      roleOf(drawing, item) === "protocol" ||
      (!roleOf(drawing, item) && !item.source && !item.target && dashed(drawing.style(item))),
  );
  const connections: Connection[] = [];
  const protocols = new Map<Cell, string>();
  const accesses = new Map<
    string,
    {
      agent: Element;
      storage: Element;
      toStorage: boolean;
      toAgent: boolean;
      label?: string;
      /** Where a text that names it would stand. */
      at: Box;
    }
  >();
  const throughCircle = new Map<string, Cell[]>();

  for (const edge of edges) {
    if (borders.includes(edge)) continue;
    const circle = [edge.source, edge.target].find((end) => end && circles.has(end));
    if (circle) {
      throughCircle.set(circle, [...(throughCircle.get(circle) ?? []), edge]);
      continue;
    }
    const path = drawing.path(edge),
      style = drawing.style(edge),
      role = roleOf(drawing, edge);
    if (role === "provides" || role === "requires") {
      // Our own interfaces are read from the ball or socket the line ends at, below.
    }
    const offered = [edge.source, edge.target].find((end) => end && interfaces.has(end));
    if (offered) {
      const owner =
        elementOf(offered === edge.source ? edge.target : edge.source) ??
        elementAt(offered === edge.source ? path.at(-1) : path[0]);
      const { offers, label } = interfaces.get(offered)!;
      if (owner)
        connections.push({
          text: `${idOf(owner)} ${offers} ${label.replace(/\n/g, " ") || "IInterface"}`,
        });
      else
        warnings.push(
          `The interface ${named(drawing.cells.get(offered)!)} is not connected to an element; it is left out.`,
        );
      continue;
    }
    const from = elementOf(edge.source) ?? elementAt(path[0]),
      to = elementOf(edge.target) ?? elementAt(path.at(-1));
    if (!from || !to || from === to) {
      warnings.push(`The connection ${named(edge)} does not join two elements; it is left out.`);
      continue;
    }
    // A line from a note attaches it to what it remarks on, whatever the line looks like.
    if (from.kind === "note" || to.kind === "note") {
      if (from.kind === "note" && to.kind === "note")
        warnings.push(`The line ${named(edge)} joins two notes; it is left out.`);
      else connections.push({ text: `${idOf(from)} -.- ${idOf(to)}` });
      continue;
    }
    const label = labelOf(edge);
    const startArrow = arrowAt(style, "start") !== "none",
      endArrow = arrowAt(style, "end") !== "none";
    const marks = marksOn(edge);
    const circleMark = marks.find((mark) => partIs(mark, "circle"));
    // The tam-drawio plugin draws a channel's circle and its R with the line itself, and a
    // modifying access as one line drawn as two arrows.
    const useEdge = shapeOf(style) === "useedge",
      modify = role === "modify" || shapeOf(style) === "updateedge",
      channelLike = !!circleMark || useEdge;
    const ball = marks.find((mark) => partIs(mark, "ball"));
    const request = marks.find(
      (mark) => partIs(mark, "request") || (partIs(mark, "text") && drawing.label(mark) === "R"),
    );
    const protocol = style.get("tamProtocol");
    if (protocol) protocols.set(edge, protocol);
    const proto = protocol ? ` @${inArrow(protocol)}` : "";

    if (role === "assembly" || ball) {
      connections.push({
        text: `${idOf(from)} -- requires${label ? ` ${inArrow(label)}` : ""}${proto} --> ${idOf(to)}`,
      });
      continue;
    }
    if (role === "delegates" || nested(from, to) || nested(to, from)) {
      const [outer, inner] = nested(to, from) ? [to, from] : [from, to];
      connections.push({
        text: `${idOf(outer)} -- delegates${label ? `: ${inArrow(label)}` : ""} --> ${idOf(inner)}`,
      });
      continue;
    }
    const keyword = label
      ?.match(/^«\s*(use|import|create|generate|pointer)\s*»$/i)?.[1]
      ?.toLowerCase();
    if (role === "dependency" || keyword || (dashed(style) && !channelLike)) {
      if (!keyword)
        warnings.push(
          `The dashed connection ${named(edge)} is no dependency («use», «import», «create», «generate» or «pointer»); it is read as «use».`,
        );
      const [a, b] = !endArrow && startArrow ? [to, from] : [from, to];
      connections.push({ text: `${idOf(a)} -. ${keyword ?? "use"} .-> ${idOf(b)}` });
      continue;
    }
    const passive = (element: Element) =>
      element.kind === "storage" || (element.kind === "group" && isPassive(element, list));
    if (!channelLike && passive(from) && passive(to)) {
      warnings.push(`The connection ${named(edge)} joins two storages; it is read as a «pointer».`);
      connections.push({ text: `${idOf(from)} -. pointer .-> ${idOf(to)}` });
      continue;
    }
    if (!channelLike && (passive(from) || passive(to))) {
      // An access, written from the active element: an arrow into the storage writes, one out of it reads.
      const [agent, storage] = passive(to) ? [from, to] : [to, from];
      const intoStorage = storage === to ? endArrow : startArrow,
        intoAgent = storage === to ? startArrow : endArrow;
      // The two arcs of a modifying access are one access; so are two unnamed arrows drawn by hand
      // between the same two elements. Named or written as reads and writes, they stay apart.
      const key =
        role === "modify"
          ? `modify\u0000${edge.id.replace(/#.*$/, "")}`
          : role || label || modify
            ? `edge\u0000${edge.id}`
            : `pair\u0000${agent.cell.id}\u0000${storage.cell.id}`;
      const access = accesses.get(key) ?? {
        agent,
        storage,
        toStorage: false,
        toAgent: false,
        at: spot(drawing.along(path, 0.5).point),
      };
      access.toStorage ||= intoStorage || modify;
      access.toAgent ||= intoAgent || modify;
      if (label) access.label ??= label;
      if (!intoStorage && !intoAgent && !modify) {
        warnings.push(`The access ${named(edge)} has no arrow; it is read as reads/writes.`);
        access.toStorage = access.toAgent = true;
      }
      accesses.set(key, access);
      continue;
    }
    // A channel: with a request marker it carries requests, with an arrow data, else it is undirected.
    const channel = (word: "calls" | "sends data" | "---", both: boolean, swap: boolean) =>
      connections.push({
        from: swap ? to : from,
        to: swap ? from : to,
        word,
        both,
        label,
        carrier: edge,
        at: circleMark
          ? drawing.box(circleMark)
          : useEdge
            ? spot(middleOfMiddle(path))
            : spot(drawing.along(path, 0.5).point),
      });
    // The plugin's R: north or east sends requests toward the line's target, south or west toward
    // its source, whichever way the line runs where the R stands (resolveUseSign in tam-drawio).
    const sign = useEdge ? (style.get("useSignDirection") ?? "none") : "none";
    if (sign === "both") channel("calls", true, false);
    else if (sign === "north" || sign === "east") channel("calls", false, false);
    else if (sign === "south" || sign === "west") channel("calls", false, true);
    else if (request) {
      if (!partIs(request, "request")) channel("calls", true, false);
      else {
        const way = requestWay(drawing, request);
        const tangent = tangentAt(path, nearestShare(path, centerOf(drawing.box(request))));
        let toward = way.x * tangent.x + way.y * tangent.y;
        if (Math.abs(toward) < 0.3) {
          const a = centerOf(from.box),
            b = centerOf(to.box);
          toward = way.x * (b.x - a.x) + way.y * (b.y - a.y);
        }
        channel("calls", false, toward < 0);
      }
    } else if (startArrow && endArrow) {
      warnings.push(
        `The channel ${named(edge)} carries data both ways; it is read as requests both ways.`,
      );
      channel("calls", true, false);
    } else if (startArrow || endArrow) channel("sends data", false, startArrow);
    else channel("---", false, false);
  }

  // Channels drawn as two lines through a circle that stands alone.
  for (const [circle, legs] of throughCircle) {
    const circleCell = drawing.cells.get(circle)!;
    const ends = legs.map((leg) => {
      const atStart = leg.source === circle,
        path = drawing.path(leg),
        style = drawing.style(leg);
      return {
        element:
          elementOf(atStart ? leg.target : leg.source) ??
          elementAt(atStart ? path.at(-1) : path[0]),
        intoCircle: arrowAt(style, atStart ? "start" : "end") !== "none",
        outward: arrowAt(style, atStart ? "end" : "start") !== "none",
        leg,
      };
    });
    if (ends.length !== 2 || !ends[0].element || !ends[1].element) {
      warnings.push(`The channel ${named(circleCell)} does not join two elements; it is left out.`);
      continue;
    }
    const [a, b] = ends;
    const label =
      drawing.label(circleCell) ||
      ends.map((end) => drawing.label(end.leg)).find(Boolean) ||
      undefined;
    const marker = drawing.parts.find(
      (item) =>
        partIs(item, "request") &&
        loose(item) &&
        distanceTo(drawing.box(item), centerOf(drawing.box(circleCell))) < 40,
    );
    let word: "calls" | "sends data" | "---" = "---",
      swap = false;
    if (marker) {
      const way = requestWay(drawing, marker),
        p = centerOf(a.element!.box),
        q = centerOf(b.element!.box);
      word = "calls";
      swap = way.x * (q.x - p.x) + way.y * (q.y - p.y) < 0;
    } else if (b.outward || a.intoCircle) word = "sends data";
    else if (a.outward || b.intoCircle) {
      word = "sends data";
      swap = true;
    }
    connections.push({
      from: swap ? b.element! : a.element!,
      to: swap ? a.element! : b.element!,
      word,
      both: false,
      label,
      carrier: circleCell,
      at: drawing.box(circleCell),
    });
  }

  // The modifying access of TAM-BD, two arcs set between an agent and a storage, and the plugin's
  // access line left loose: the elements nearest its two ends are what it joins.
  const symbols = [
    ...drawing.parts
      .filter((item) => partIs(item, "modify"))
      .map((item) => {
        const arc = drawing.children(item.id).find((line) => line.edge)!;
        return { cell: item, path: drawing.path(arc) };
      }),
    ...edges
      .filter(
        (edge) =>
          shapeOf(drawing.style(edge)) === "updateedge" &&
          !(elementOf(edge.source) && elementOf(edge.target)),
      )
      .map((edge) => ({ cell: edge, path: drawing.path(edge) })),
  ];
  for (const symbol of symbols) {
    const nearest = (point: Point, other?: Element) =>
      list
        .filter(
          (element) =>
            element !== other && !holds(element.box, point) && distanceTo(element.box, point) <= 60,
        )
        .toSorted((a, b) => distanceTo(a.box, point) - distanceTo(b.box, point))[0];
    const a = nearest(symbol.path[0]),
      b = a && nearest(symbol.path.at(-1)!, a);
    const passive = (element: Element) =>
      element.kind === "storage" || (element.kind === "group" && isPassive(element, list));
    const storage = [a, b].find((end) => end && passive(end)),
      agent = [a, b].find((end) => end && !passive(end));
    if (!storage || !agent) {
      warnings.push(
        `The modifying access ${named(symbol.cell)} stands between no agent and storage; it is left out.`,
      );
      continue;
    }
    // Several symbols between the same pair are one access.
    accesses.set(`modify\u0000${agent.cell.id}\u0000${storage.cell.id}`, {
      agent,
      storage,
      toStorage: true,
      toAgent: true,
      at: drawing.box(symbol.cell),
    });
  }

  // Protocols of hand-drawn channels: a dashed border that crosses the channel's line, named by its
  // own label or by the text at it.
  const routeOf = (carrier: Cell): Point[][] =>
    carrier.edge
      ? [drawing.path(carrier)]
      : (throughCircle.get(carrier.id) ?? []).map((leg) => drawing.path(leg));
  for (const border of borders) {
    const path = drawing.path(border);
    const crossed = connections.filter(
      (connection): connection is Extract<Connection, { carrier: Cell }> =>
        "carrier" in connection &&
        !protocols.has(connection.carrier) &&
        (crosses(path, routeOf(connection.carrier)) ||
          distanceToPath(path, centerOf(connection.at)) <= 12),
    );
    if (!crossed.length) continue;
    const name = (drawing.label(border) || texts.take(boxAround(path), 40) || "").replace(
      /\n/g,
      " ",
    );
    if (!name) continue;
    for (const { carrier } of crossed) protocols.set(carrier, name);
  }

  // Drawn by hand, a connection is often named by a text beside it.
  for (const connection of connections)
    if ("carrier" in connection && !connection.label)
      connection.label = texts.take(connection.at, 40);
  for (const access of accesses.values()) access.label ??= texts.take(access.at, 30);
  for (const item of texts.left)
    warnings.push(
      `The text “${drawing.label(item).replace(/\n/g, " ")}” names nothing on the page; it is left out.`,
    );

  for (const { agent, storage, toStorage, toAgent, label } of accesses.values()) {
    const word = toStorage && toAgent ? "reads/writes" : toStorage ? "writes" : "reads";
    connections.push({
      text: `${idOf(agent)} -- ${word}${label ? `: ${inArrow(label)}` : ""} --> ${idOf(storage)}`,
    });
  }

  const statements = connections.map((connection) => {
    if ("text" in connection) return connection.text;
    const { from, to, word, both, label, carrier } = connection;
    const protocol = protocols.get(carrier),
      proto = protocol ? `@${inArrow(protocol)}` : "";
    if (word === "---")
      return label || proto
        ? `${idOf(from)} -- ${[label && inArrow(label), proto].filter(Boolean).join(" ")} --- ${idOf(to)}`
        : `${idOf(from)} --- ${idOf(to)}`;
    return `${idOf(from)} ${both ? "<--" : "--"} ${word}${label ? `: ${inArrow(label)}` : ""}${proto ? ` ${proto}` : ""} --> ${idOf(to)}`;
  });

  for (const item of drawing.parts) {
    const part = parts.get(item.id);
    if (part?.as === "unknown" && loose(item) && part.shape !== "dot")
      warnings.push(
        `The shape ${part.shape} ${named(item)} has no meaning in a TAM block diagram; it is left out.`,
      );
  }

  // The header, then the elements nested in reading order with the dots between them.
  const title = pageTitle(drawing, /^TAM block diagram$/);
  const header = [
    ...(title ? [`title ${title}`] : []),
    ...(drawing.data.tamDirection && drawing.data.tamDirection !== "TB"
      ? [`direction ${drawing.data.tamDirection}`]
      : []),
    ...(drawing.data.tamLevel ? [`level ${drawing.data.tamLevel}`] : []),
  ];
  const holderOf = (box: Box) =>
    list
      .filter(
        (element) =>
          element.kind !== "note" && within(box, element.box) && area(element.box) > area(box),
      )
      .toSorted((a, b) => area(a.box) - area(b.box))[0];
  const dots = drawing.parts
    .filter((item) => partIs(item, "dots") && roleOf(drawing, item) !== "copy-dots")
    .map((item) => ({ box: drawing.box(item), in: holderOf(drawing.box(item)) }));
  const body: string[] = [];
  const round = (value: number) => String(Math.round(value));
  const declare = (parent: Element | undefined, indent: string) => {
    const items = readingOrder<Element | { box: Box; in?: Element }>(
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
      const { box, kind, label, color, stack, copy } = item;
      const holds =
        list.some((other) => other.parent === item) || dots.some((other) => other.in === item);
      // An element without an id keeps a space before its name: `note [A remark]`.
      const id = item.id ? ` ${item.id}` : label ? " " : "";
      const name = label ? bracketed(label) : kind === "group" ? "" : "[]";
      // The first position places the element, the second its copy.
      const at = ` @${round(box.x)},${round(box.y)} ${round(Math.max(1, box.width))}x${round(Math.max(1, box.height))}`;
      const copyAt = copy
        ? ` ... @${round(drawing.box(copy).x)},${round(drawing.box(copy).y)}`
        : "";
      body.push(
        `${indent}${kind}${id}${name}${color ? `:::${color}` : ""}${stack ? " stack" : ""}${at}${copyAt}${holds ? " {" : ""}`,
      );
      if (holds) {
        declare(item, `${indent}  `);
        body.push(`${indent}}`);
      }
    }
  };
  declare(undefined, "");
  const source = [...header, ...body, ...new Set(statements)].join("\n") + "\n";
  try {
    parseTam(source);
  } catch (error) {
    warnings.push(
      `The diagram breaks a rule of the TAM notation, to mend in the source: ${(error as Error).message}`,
    );
  }
  return { source, kind: "tam", warnings };
}

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
    if (part.drawn)
      warnings.push(
        `${drawing.label(item) ? `“${drawing.label(item).replace(/\n/g, " ")}”` : `The shape ${item.id}`} is drawn as ${part.drawn}, which the syntax has no word for; it is read as ${part.kind === "agent" ? "an" : "a"} ${part.kind}.`,
      );
    const role = roleOf(drawing, item);
    if (role === "copy" || role === "stack") {
      marks.push(item);
      continue;
    }
    const style = drawing.style(item);
    let kind = part.kind,
      label = drawing.label(item);
    // A rectangle with a stick figure in it is a human agent; one with the component icon a component.
    const inside = drawing.children(item.id).filter((child) => child.vertex);
    if (
      kind === "agent" &&
      inside.some((child) => shapeOf(drawing.style(child)) === "group" && isFigure(drawing, child))
    )
      kind = "human";
    if ((kind === "agent" || kind === "component") && /^«subsystem»\n/.test(label))
      kind = "subsystem";
    else if (
      kind === "agent" &&
      inside.some((child) => ["module", "component"].includes(shapeOf(drawing.style(child))))
    )
      kind = "component";
    if (kind === "subsystem") label = label.replace(/^«subsystem»\n/, "");
    // Our own cells say their color; a container's tint that carries over to its parts is no color of theirs.
    const color = role
      ? style.get("tamColor")
      : kind === "package" || kind === "group"
        ? undefined
        : paletteColor(style);
    elements.set(item.id, {
      cell: item,
      kind,
      label,
      box: drawing.box(item),
      // The tam-drawio plugin draws several of an agent as one shape that says so.
      stack: isOn(style, "multiple"),
      ...(color && COLORS.has(color) ? { color } : {}),
      id: "",
      // An unnamed group, or a note: neither needs an id unless a line names it.
      anonymous:
        kind === "note"
          ? !/^[A-Za-z_]\w*$/.test(item.id)
          : kind === "group" && (item.id.startsWith("group#") || !label),
    });
  }
  // A stick figure standing in an agent's box makes the agent a human agent.
  for (const [id, element] of elements)
    if (
      element.kind === "human" &&
      ["umlActor", "actor"].includes(shapeOf(drawing.style(element.cell)))
    ) {
      const around = [...elements.values()].find(
        (other) => other !== element && other.kind === "agent" && within(element.box, other.box),
      );
      if (around) {
        around.kind = "human";
        elements.delete(id);
      }
    }
  // A stick figure set onto an agent makes it a human agent; standing alone, it is a human agent
  // named by the text beside it.
  for (const item of drawing.parts) {
    if (parts.get(item.id)?.as !== "figure") continue;
    // One that draw.io keeps in an agent has made that agent a human agent already.
    const holder = drawing.parentOf(item);
    if (holder && elements.has(holder.id)) continue;
    const box = drawing.box(item);
    const around = [...elements.values()]
      .filter(
        (other) => (other.kind === "agent" || other.kind === "human") && within(box, other.box),
      )
      .toSorted((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
    if (around) {
      around.kind = "human";
      continue;
    }
    const label = texts.take(box, 30) ?? "";
    elements.set(item.id, {
      cell: item,
      kind: "human",
      label,
      box,
      stack: false,
      id: "",
      anonymous: false,
    });
  }
  // Copies and stack outlines this package wrote name the element they belong to.
  for (const item of marks) {
    const owner = elements.get(drawing.style(item).get("tamOf") ?? "");
    if (!owner) continue;
    if (roleOf(drawing, item) === "stack") owner.stack = true;
    else owner.copy = item;
  }
  // Drawn by hand, a stack is an unnamed outline of the same size a little behind and below an element.
  for (const [id, back] of [...elements]) {
    if (back.label) continue;
    const front = [...elements.values()].find((other) => {
      const dx = back.box.x - other.box.x,
        dy = back.box.y - other.box.y;
      return (
        other !== back &&
        other.kind === back.kind &&
        Math.abs(other.box.width - back.box.width) < 1 &&
        Math.abs(other.box.height - back.box.height) < 1 &&
        dx > 0 &&
        dx <= 12 &&
        dy > 0 &&
        dy <= 12
      );
    });
    if (front) {
      front.stack = true;
      elements.delete(id);
    }
  }
  // An element belongs to the element draw.io nests it in; drawn loose, to the smallest element whose
  // box holds its box.
  const list = [...elements.values()];
  const area = (box: Box) => box.width * box.height;
  for (const element of list) {
    let nest: Element | undefined;
    for (let up = drawing.parentOf(element.cell); up && !nest; up = drawing.parentOf(up))
      nest = elements.get(up.id);
    element.parent =
      nest ??
      list
        .filter(
          (other) =>
            other !== element &&
            other.kind !== "note" &&
            area(other.box) > area(element.box) &&
            within(element.box, other.box),
        )
        .toSorted((a, b) => area(a.box) - area(b.box))[0];
  }
  return list;
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

/** How much a page looks like a TAM block diagram. */
function tamLikeness(drawing: Drawing): number {
  let score = 0;
  for (const item of drawing.parts) {
    const role = roleOf(drawing, item);
    if (
      role &&
      (ROLE_KINDS.has(role) ||
        ["circle", "request", "calls", "sends", "channel", "read", "write", "modify"].includes(
          role,
        ))
    )
      score += 10;
    if (!item.vertex) continue;
    const part = partOf(drawing, item);
    if (part.as === "circle" || part.as === "request") score += 3;
    else if (part.as === "element")
      score += part.kind === "human" || part.kind === "storage" ? 1.5 : 1;
  }
  return score;
}

export const tamDrawio: DrawioType = {
  kinds: ["tam"],
  cells: tamCells,
  likeness: tamLikeness,
  read: readTam,
};
