/**
 * The minimap: the whole diagram small at a corner of the canvas, with the part on show framed.
 * It shows while the diagram reaches beyond the canvas, unless it is turned off; a press or a drag
 * on it moves the view there.
 */

import { type Box, inside, type Point, type SceneShape } from "../src/scene.ts";
import { h } from "./dom.ts";
import type { Editor } from "./editor.ts";

const WIDTH = 180,
  HEIGHT = 120,
  PAD = 8;

export class Minimap {
  readonly element = h("canvas", { class: "minimap", "aria-hidden": "true" });
  private readonly editor: Editor;
  /** Whether the minimap shows at all: the View menu turns it off. */
  enabled = true;
  private dragging = false;
  /** How the diagram maps to the minimap as it was drawn last: the scale and the diagram point at its corner. */
  private map = { scale: 1, x: 0, y: 0 };

  constructor(editor: Editor) {
    this.editor = editor;
    const { element } = this;
    element.hidden = true;
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.dragging = true;
      element.setPointerCapture(event.pointerId);
      this.go(event);
    });
    element.addEventListener("pointermove", (event) => {
      if (this.dragging) this.go(event);
    });
    const end = () => {
      this.dragging = false;
      this.draw();
    };
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  }

  /** The point under the pointer comes to the middle of the canvas. */
  private go(event: PointerEvent) {
    const { view } = this.editor,
      rect = this.element.getBoundingClientRect(),
      at: Point = {
        x: (event.clientX - rect.left) / this.map.scale + this.map.x,
        y: (event.clientY - rect.top) / this.map.scale + this.map.y,
      },
      on = view.toScreen(at);
    view.panBy(view.size.width / 2 - on.x, view.size.height / 2 - on.y);
  }

  /** Draws the diagram's boxes and the frame of the view; hides when the whole diagram is on show. */
  draw() {
    const shown = this.shown();
    this.element.hidden = !shown;
    if (!shown) return;
    // While it is dragged the map stays as it is, so the frame follows the pointer steadily.
    if (!this.dragging) this.fit(shown.bounds);
    const ratio = this.sharpen(),
      context = this.element.getContext("2d")!;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);
    this.drawShapes(context, shown.shapes);
    this.drawFrame(context, shown.seen);
  }

  /** What the minimap draws: the diagram's shapes and bounds, and the part on show. Undefined while it hides. */
  private shown() {
    const { picture } = this.editor.doc,
      bounds = picture?.scene.bounds,
      seen = this.seen();
    if (!picture || !bounds || !seen || this.hides(bounds, seen)) return undefined;
    return { shapes: picture.scene.shapes, bounds, seen };
  }

  /** Whether the minimap hides: it is turned off, or the diagram is empty or wholly on show. */
  private hides(bounds: Box, seen: Box) {
    return !this.enabled || !bounds.width || (inside(bounds, seen) && !this.dragging);
  }

  /** Sizes the canvas to the pixels of the screen, and returns how many there are to a point. */
  private sharpen() {
    const { element } = this,
      ratio = window.devicePixelRatio || 1;
    if (element.width !== WIDTH * ratio) {
      element.width = WIDTH * ratio;
      element.height = HEIGHT * ratio;
    }
    return ratio;
  }

  /** The part of the diagram on show; undefined while the canvas has no size. */
  private seen(): Box | undefined {
    const { view } = this.editor,
      { width, height } = view.size;
    if (!width || !height) return undefined;
    const from = view.toScene({ x: 0, y: 0 }),
      to = view.toScene({ x: width, y: height });
    return { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y };
  }

  /** Maps the whole diagram into the minimap, in its middle. */
  private fit(bounds: Box) {
    const scale = Math.min((WIDTH - 2 * PAD) / bounds.width, (HEIGHT - 2 * PAD) / bounds.height);
    this.map = {
      scale,
      x: bounds.x + bounds.width / 2 - WIDTH / 2 / scale,
      y: bounds.y + bounds.height / 2 - HEIGHT / 2 / scale,
    };
  }

  /** A box of the diagram on the minimap: left, top, width and height. */
  private on(box: Box) {
    const { scale, x, y } = this.map;
    return [
      (box.x - x) * scale,
      (box.y - y) * scale,
      box.width * scale,
      box.height * scale,
    ] as const;
  }

  /** The diagram's shapes: a container as its outline, any other filled. */
  private drawShapes(context: CanvasRenderingContext2D, shapes: SceneShape[]) {
    const style = getComputedStyle(this.element);
    context.lineWidth = 1;
    context.strokeStyle = style.getPropertyValue("--line-strong");
    context.fillStyle = style.getPropertyValue("--text-3");
    for (const shape of shapes) {
      const [left, top, wide, high] = this.on(shape.box);
      if (wide < 1 || high < 1) continue;
      if (shape.container) context.strokeRect(left + 0.5, top + 0.5, wide, high);
      else context.fillRect(left, top, Math.max(2, wide), Math.max(2, high));
    }
  }

  /** The frame of the part on show. */
  private drawFrame(context: CanvasRenderingContext2D, seen: Box) {
    const style = getComputedStyle(this.element),
      [left, top, wide, high] = this.on(seen);
    context.fillStyle = style.getPropertyValue("--accent");
    context.globalAlpha = 0.12;
    context.fillRect(left, top, wide, high);
    context.globalAlpha = 1;
    context.strokeStyle = style.getPropertyValue("--accent");
    context.lineWidth = 1.5;
    context.strokeRect(left, top, wide, high);
  }
}
