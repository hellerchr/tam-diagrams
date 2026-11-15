/**
 * The minimap: the whole diagram small at a corner of the canvas, with the part on show framed.
 * It shows while the diagram reaches beyond the canvas, unless it is turned off; a press or a drag
 * on it moves the view there.
 */

import type { Box, Point } from "../src/scene.ts";
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
    const go = (event: PointerEvent) => {
      const { view } = editor,
        rect = element.getBoundingClientRect(),
        at: Point = {
          x: (event.clientX - rect.left) / this.map.scale + this.map.x,
          y: (event.clientY - rect.top) / this.map.scale + this.map.y,
        },
        on = view.toScreen(at);
      // The point under the pointer comes to the middle of the canvas.
      view.panBy(view.size.width / 2 - on.x, view.size.height / 2 - on.y);
    };
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.dragging = true;
      element.setPointerCapture(event.pointerId);
      go(event);
    });
    element.addEventListener("pointermove", (event) => {
      if (this.dragging) go(event);
    });
    const end = () => {
      this.dragging = false;
      this.draw();
    };
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  }

  /** Draws the diagram's boxes and the frame of the view; hides when the whole diagram is on show. */
  draw() {
    const { editor, element } = this,
      { view } = editor,
      { picture } = editor.doc,
      bounds = picture?.scene.bounds,
      { width, height } = view.size;
    if (!this.enabled || !picture || !bounds?.width || !width || !height)
      return void (element.hidden = true);
    const from = view.toScene({ x: 0, y: 0 }),
      to = view.toScene({ x: width, y: height }),
      seen: Box = { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y };
    const inside =
      bounds.x >= seen.x &&
      bounds.y >= seen.y &&
      bounds.x + bounds.width <= seen.x + seen.width &&
      bounds.y + bounds.height <= seen.y + seen.height;
    if (inside && !this.dragging) return void (element.hidden = true);
    element.hidden = false;
    // While it is dragged the map stays as it is, so the frame follows the pointer steadily.
    if (!this.dragging) {
      const scale = Math.min((WIDTH - 2 * PAD) / bounds.width, (HEIGHT - 2 * PAD) / bounds.height);
      this.map = {
        scale,
        x: bounds.x + bounds.width / 2 - WIDTH / 2 / scale,
        y: bounds.y + bounds.height / 2 - HEIGHT / 2 / scale,
      };
    }
    const ratio = window.devicePixelRatio || 1;
    if (element.width !== WIDTH * ratio) {
      element.width = WIDTH * ratio;
      element.height = HEIGHT * ratio;
    }
    const context = element.getContext("2d")!,
      style = getComputedStyle(element),
      { scale, x, y } = this.map;
    const on = (box: Box) =>
      [(box.x - x) * scale, (box.y - y) * scale, box.width * scale, box.height * scale] as const;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.lineWidth = 1;
    context.strokeStyle = style.getPropertyValue("--line-strong");
    context.fillStyle = style.getPropertyValue("--text-3");
    for (const shape of picture.scene.shapes) {
      const [left, top, wide, high] = on(shape.box);
      if (wide < 1 || high < 1) continue;
      if (shape.container) context.strokeRect(left + 0.5, top + 0.5, wide, high);
      else context.fillRect(left, top, Math.max(2, wide), Math.max(2, high));
    }
    const [left, top, wide, high] = on(seen);
    context.fillStyle = style.getPropertyValue("--accent");
    context.globalAlpha = 0.12;
    context.fillRect(left, top, wide, high);
    context.globalAlpha = 1;
    context.strokeStyle = style.getPropertyValue("--accent");
    context.lineWidth = 1.5;
    context.strokeRect(left, top, wide, high);
  }
}
