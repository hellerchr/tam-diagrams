/**
 * What the editor draws over the picture, in canvas pixels: what the pointer is over, the
 * selection with its handles and dots, and what a gesture under way shows.
 */

import type { Box, Point } from "../src/scene.ts";
import { lineMiddle } from "../src/label-places.ts";
import type { ElementKind } from "../src/tam-edit.ts";
import type { Picture } from "./document.ts";
import { frameOf, type GestureOf, HANDLE, HANDLES, REACH } from "./gesture.ts";
import type { Guide } from "./guides.ts";
import { boxesOf, boxOf, type Part, wireParts } from "./hit.ts";
import { sizeOf } from "./placing.ts";
import type { View } from "./view.ts";

/** The handles of a box, where they stand on the canvas. */
export function handlePoints(view: View, box: Box) {
  const on = view.boxOnScreen(box);
  return HANDLES.map((handle) => ({
    handle,
    x: on.x + ((handle.x + 1) / 2) * on.width,
    y: on.y + ((handle.y + 1) / 2) * on.height,
  }));
}

/** Where a connection is drawn from: a dot off the middle of each side, on the canvas. */
export function linkPoints(view: View, box: Box) {
  const on = view.boxOnScreen(box);
  return [
    { x: on.x + on.width / 2, y: on.y - REACH },
    { x: on.x + on.width + REACH, y: on.y + on.height / 2 },
    { x: on.x + on.width / 2, y: on.y + on.height + REACH },
    { x: on.x - REACH, y: on.y + on.height / 2 },
  ];
}

/** The context drawn with, the view it draws through, the picture it draws over, and the accent color. */
export class Pen {
  readonly context: CanvasRenderingContext2D;
  readonly view: View;
  readonly picture: Picture;
  readonly accent: string;

  constructor(context: CanvasRenderingContext2D, view: View, picture: Picture, accent: string) {
    this.context = context;
    this.view = view;
    this.picture = picture;
    this.accent = accent;
  }

  /** Frames a box of the diagram, `pad` pixels out. */
  outline(box: Box, pad = 0) {
    const on = this.view.boxOnScreen(box);
    this.context.strokeRect(on.x - pad, on.y - pad, on.width + 2 * pad, on.height + 2 * pad);
  }

  /** Frames every box an element is drawn in. */
  outlineElement(id: string, pad: number) {
    boxesOf(this.picture, id).forEach((box) => this.outline(box, pad));
  }

  /** A dashed line between two points of the canvas. */
  dashedLine(from: Point, to: Point) {
    const { context } = this;
    context.lineWidth = 1.5;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.setLineDash([]);
  }

  /** Draws over the lines and circles of a connection. */
  strokeWire(id: string, width: number) {
    const { context, view, picture } = this,
      { lines, circles } = wireParts(picture.scene, picture.diagram, id);
    context.lineWidth = width;
    for (const points of lines) {
      context.beginPath();
      points.forEach((point, index) => {
        const on = view.toScreen(point);
        if (index) context.lineTo(on.x, on.y);
        else context.moveTo(on.x, on.y);
      });
      context.stroke();
    }
    for (const box of circles) {
      const on = view.boxOnScreen(box);
      context.beginPath();
      context.arc(on.x + on.width / 2, on.y + on.height / 2, on.width / 2 + 1, 0, 2 * Math.PI);
      context.stroke();
    }
  }
}

/** What the pointer is over, lightly. */
export function drawHover(pen: Pen, hover: Part) {
  const { context } = pen;
  context.strokeStyle = pen.accent;
  context.globalAlpha = 0.45;
  context.lineWidth = 1.5;
  if (hover.type === "element") pen.outlineElement(hover.id, 2);
  else pen.strokeWire(hover.id, 3);
  context.globalAlpha = 1;
}

/** Elements that lie on each other, which the notation does not allow. */
export function drawOverlaps(pen: Pen) {
  const { context, picture } = pen;
  if (!picture.overlaps.length) return;
  context.strokeStyle = "#d9363e";
  context.lineWidth = 2;
  context.setLineDash([4, 3]);
  const boxes = new Map(picture.scene.shapes.map((shape) => [shape.id, shape.box]));
  for (const id of new Set(picture.overlaps.flat())) {
    const box = boxes.get(id);
    if (box) pen.outline(box, 2);
  }
  context.setLineDash([]);
}

/** Selected connections are drawn over in the accent color, selected elements framed. */
export function drawSelection(pen: Pen, wires: string[], elements: string[]) {
  const { context } = pen;
  context.strokeStyle = pen.accent;
  for (const id of wires) pen.strokeWire(id, 2.5);
  context.lineWidth = 1.5;
  for (const id of elements) pen.outlineElement(id, 3);
}

/** The handles of the one selected element, on its frame, which lies 3 outside it. */
export function drawHandles(pen: Pen, box: Box) {
  const { context } = pen;
  context.fillStyle = "#ffffff";
  for (const spot of handlePoints(pen.view, box)) {
    const x = spot.x + spot.handle.x * 3 - HANDLE / 2,
      y = spot.y + spot.handle.y * 3 - HANDLE / 2;
    context.fillRect(x, y, HANDLE, HANDLE);
    context.strokeRect(x, y, HANDLE, HANDLE);
  }
}

/** The connection dots of some boxes; the one the pointer is on, at `at` on the canvas, larger. */
export function drawLinkDots(pen: Pen, boxes: Box[], at: Point) {
  const { context } = pen;
  for (const box of boxes)
    for (const spot of linkPoints(pen.view, box)) {
      const on = Math.hypot(spot.x - at.x, spot.y - at.y) <= HANDLE;
      context.beginPath();
      context.arc(spot.x, spot.y, on ? 6.5 : 4.5, 0, 2 * Math.PI);
      context.fillStyle = pen.accent;
      context.globalAlpha = on ? 1 : 0.75;
      context.fill();
      context.globalAlpha = 1;
    }
}

/** The lines a moved or resized element is aligned on. */
export function drawGuides(pen: Pen, guides: Guide[]) {
  const { context, view } = pen;
  context.strokeStyle = "#e0457b";
  context.lineWidth = 1;
  for (const [from, to] of guides) {
    const a = view.toScreen(from),
      b = view.toScreen(to);
    context.beginPath();
    context.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
    context.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
    context.stroke();
  }
  context.strokeStyle = pen.accent;
}

/** A new element where it would stand, and the element it would stand in. */
export function drawGhost(
  pen: Pen,
  ghost: { kind: ElementKind; at: Point; target: string | null },
) {
  const { context, view } = pen,
    on = view.boxOnScreen({ ...ghost.at, ...sizeOf(ghost.kind) });
  context.lineWidth = 1.5;
  if (ghost.target) {
    context.setLineDash([6, 4]);
    pen.outlineElement(ghost.target, 4);
    context.setLineDash([]);
  }
  context.fillStyle = pen.accent;
  context.globalAlpha = 0.12;
  context.beginPath();
  context.roundRect(
    on.x,
    on.y,
    on.width,
    on.height,
    ghost.kind === "storage" ? on.height / 2 : ghost.kind === "group" ? 4 * view.zoom : 0,
  );
  context.fill();
  context.globalAlpha = 1;
  context.stroke();
}

/** The element something dragged would join or go into, framed with dashes. */
export function drawTarget(pen: Pen, id: string) {
  const { context } = pen;
  context.strokeStyle = pen.accent;
  context.setLineDash([6, 4]);
  context.lineWidth = 2;
  pen.outlineElement(id, 4);
  context.setLineDash([]);
}

/** A dragged label where it goes, tied to the middle of its line, which it keeps its distance to. */
export function drawLabelDrag(pen: Pen, gesture: GestureOf<"label">, box: Box) {
  const { context, view } = pen,
    middle = lineMiddle(gesture.picture.scene, gesture.wire);
  context.strokeStyle = pen.accent;
  context.lineWidth = 1;
  context.setLineDash([4, 3]);
  pen.outline(box, 2);
  if (middle) {
    const from = view.toScreen(middle),
      to = view.toScreen({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
  context.setLineDash([]);
}

/** The frame a drag on the empty canvas selects with. */
export function drawFrame(pen: Pen, gesture: GestureOf<"frame">) {
  const { context } = pen,
    on = pen.view.boxOnScreen(frameOf(gesture.start, gesture.current));
  context.fillStyle = pen.accent;
  context.globalAlpha = 0.08;
  context.fillRect(on.x, on.y, on.width, on.height);
  context.globalAlpha = 1;
  context.lineWidth = 1;
  context.strokeRect(on.x, on.y, on.width, on.height);
}

/** The ends of the selected connection, which are dragged to another element. */
export function drawWireEnds(pen: Pen, ends: Point[]) {
  const { context } = pen;
  for (const at of ends) {
    const on = pen.view.toScreen(at);
    context.beginPath();
    context.arc(on.x, on.y, 5, 0, 2 * Math.PI);
    context.fillStyle = "#ffffff";
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = pen.accent;
    context.stroke();
  }
}

/** An end of a connection on its way to another element: from the end that stays to the pointer. */
export function drawAttach(pen: Pen, gesture: GestureOf<"attach">, fixed: Point | undefined) {
  const { context, view } = pen;
  context.strokeStyle = pen.accent;
  if (gesture.target) {
    context.lineWidth = 2;
    pen.outlineElement(gesture.target, 3);
  }
  if (fixed) pen.dashedLine(view.toScreen(fixed), view.toScreen(gesture.current));
}

/** A connection being drawn: from the middle of its element to the pointer, and the element it would reach. */
export function drawConnect(pen: Pen, gesture: GestureOf<"connect">) {
  const { context, view } = pen,
    from = boxOf(pen.picture, gesture.from);
  if (!from) return;
  const start = view.toScreen({ x: from.x + from.width / 2, y: from.y + from.height / 2 }),
    end = view.toScreen(gesture.current);
  context.lineWidth = 1.5;
  pen.outlineElement(gesture.from, 3);
  if (gesture.target) {
    context.lineWidth = 2;
    pen.outlineElement(gesture.target, 3);
  }
  pen.dashedLine(start, end);
}
