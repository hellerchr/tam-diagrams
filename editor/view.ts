/** The canvas an editor draws on: a viewport over the diagram's coordinates, the picture, and what the editor lays over it. */

import type { Box, Point } from "../src/scene.ts";
import { svgUrl } from "../src/index.ts";

/** Fitting a small diagram enlarges it no further than FIT_ZOOM: its natural size. */
const FIT_ZOOM = 1;

/** The zooms a step in or out stops at. */
export const ZOOM_LEVELS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

/** The most one wheel event zooms by. */
const WHEEL_STEP = 1.2;

/**
 * The factor a wheel event zooms by. A pinch on a trackpad comes as many small deltas, which zoom
 * smoothly; a notch of a mouse wheel is one large delta, which zooms by WHEEL_STEP and no more.
 */
export function wheelZoom(deltaY: number, deltaMode = 0): number {
  // Lines and pages as the pixels they scroll.
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  return Math.min(WHEEL_STEP, Math.max(1 / WHEEL_STEP, Math.exp(-pixels * 0.01)));
}

/** The level a step in (1) or out (-1) from a zoom leads to: the next of ZOOM_LEVELS on that side. */
export function zoomLevel(zoom: number, direction: 1 | -1): number {
  // A zoom within a hundredth of a level is on it.
  const above = ZOOM_LEVELS.find((level) => level > zoom * 1.01),
    below = ZOOM_LEVELS.findLast((level) => level < zoom / 1.01);
  return (direction > 0 ? above : below) ?? zoom;
}

/** The zoom range, and the grid dots' distance in diagram coordinates. */
const MIN_ZOOM = 0.1,
  MAX_ZOOM = 8,
  DOTS = 20;

/** The colors of the canvas around and over the picture. */
export interface CanvasColors {
  page: string;
  dots: string;
}

export class View {
  readonly canvas: HTMLCanvasElement;
  zoom = 1;
  /** Where the diagram's origin lies on the canvas, in CSS pixels. */
  origin: Point = { x: 0, y: 0 };
  colors: CanvasColors = { page: "#ffffff", dots: "#d5d7dc" };
  grid = true;
  /** Draws what lies over the picture; the context is in CSS pixels. */
  overlay: (context: CanvasRenderingContext2D) => void = () => {};
  /** Called when the viewport changed. */
  onView: () => void = () => {};
  private picture: { image: HTMLImageElement; bounds: Box } | undefined;
  /** The page color and the grid, under the picture; `canvas` lies over it with what the editor draws. */
  private readonly back: HTMLCanvasElement;
  private loading = 0;
  private pending = false;
  /** The box the view was fitted to last, with the viewport that gave: a canvas that changes its size fits it again while the viewport is still that one. */
  private fitted: { box: Box; margin: number; zoom: number; origin: Point } | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Three layers: the page with its grid, the picture as an image, and the overlay that takes the
    // pointer. The browser draws the image from its vectors at every zoom, so it stays sharp.
    this.back = document.createElement("canvas");
    this.back.className = "layer";
    canvas.before(this.back);
    new ResizeObserver(() => {
      const { fitted } = this;
      if (
        fitted &&
        fitted.zoom === this.zoom &&
        fitted.origin.x === this.origin.x &&
        fitted.origin.y === this.origin.y
      )
        this.fit(fitted.box, fitted.margin);
      this.draw();
    }).observe(canvas);
    // A pinch or Ctrl with the wheel zooms about the pointer; the wheel alone is left to move the view.
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.zoomBy(wheelZoom(event.deltaY, event.deltaMode), this.pointOf(event));
      },
      { passive: false },
    );
  }

  /** The canvas size in CSS pixels. */
  get size() {
    return { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
  }

  toScene(point: Point): Point {
    return { x: (point.x - this.origin.x) / this.zoom, y: (point.y - this.origin.y) / this.zoom };
  }

  toScreen(point: Point): Point {
    return { x: point.x * this.zoom + this.origin.x, y: point.y * this.zoom + this.origin.y };
  }

  /** A box of the diagram on the canvas. */
  boxOnScreen(box: Box): Box {
    const { x, y } = this.toScreen(box);
    return { x, y, width: box.width * this.zoom, height: box.height * this.zoom };
  }

  /** A pointer event's position on the canvas. */
  pointOf(event: { clientX: number; clientY: number }): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /**
   * Shows a picture: an SVG drawn at `bounds`. The SVG is decoded as an image, never inserted into
   * the page; the picture before stays until the new one is ready, and a later one overtakes it.
   */
  async show(svg: string | undefined, bounds: Box): Promise<void> {
    const turn = ++this.loading;
    if (!svg) {
      this.picture?.image.remove();
      this.picture = undefined;
      this.invalidate();
      return;
    }
    const image = new Image();
    image.src = svgUrl(svg);
    try {
      await image.decode();
    } catch {
      return;
    }
    if (turn !== this.loading) return;
    // The new picture takes the place of the one before in one step, so nothing flickers.
    image.className = "layer picture";
    image.alt = "";
    image.draggable = false;
    if (this.picture) this.picture.image.replaceWith(image);
    else this.canvas.before(image);
    this.picture = { image, bounds };
    this.place();
    this.invalidate();
  }

  /** Zooms by a factor, keeping the diagram point under `at` (canvas pixels) in place. */
  zoomBy(factor: number, at: Point = { x: this.size.width / 2, y: this.size.height / 2 }) {
    this.zoomTo(this.zoom * factor, at);
  }

  zoomTo(zoom: number, at: Point = { x: this.size.width / 2, y: this.size.height / 2 }) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)),
      fixed = this.toScene(at);
    this.zoom = next;
    this.origin = { x: at.x - fixed.x * next, y: at.y - fixed.y * next };
    this.changed();
  }

  /** Zooms in (1) or out (-1) to the next round level. */
  zoomStep(direction: 1 | -1) {
    this.zoomTo(zoomLevel(this.zoom, direction));
  }

  panBy(dx: number, dy: number) {
    this.origin = { x: this.origin.x + dx, y: this.origin.y + dy };
    this.changed();
  }

  /** Shows a box of the diagram whole and centered, as large as the canvas allows up to FIT_ZOOM. */
  fit(box: Box, margin = 56) {
    const { width, height } = this.size;
    if (!width || !height) return;
    const zoom = Math.min(
      FIT_ZOOM,
      (width - 2 * margin) / Math.max(1, box.width),
      (height - 2 * margin) / Math.max(1, box.height),
    );
    this.zoom = Math.max(MIN_ZOOM, zoom);
    this.origin = {
      x: width / 2 - (box.x + box.width / 2) * this.zoom,
      y: height / 2 - (box.y + box.height / 2) * this.zoom,
    };
    this.fitted = { box, margin, zoom: this.zoom, origin: this.origin };
    this.changed();
  }

  private changed() {
    this.onView();
    this.invalidate();
  }

  /** Draws again before the next frame; several calls draw once. */
  invalidate() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.draw();
    });
  }

  /** Puts the picture where the viewport shows it. */
  private place() {
    if (!this.picture) return;
    const at = this.boxOnScreen(this.picture.bounds);
    Object.assign(this.picture.image.style, {
      left: `${at.x}px`,
      top: `${at.y}px`,
      width: `${at.width}px`,
      height: `${at.height}px`,
    });
  }

  private draw() {
    const { width, height } = this.size,
      ratio = window.devicePixelRatio || 1;
    if (!width || !height) return;
    const fitted = (canvas: HTMLCanvasElement) => {
      if (
        canvas.width !== Math.round(width * ratio) ||
        canvas.height !== Math.round(height * ratio)
      ) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      const context = canvas.getContext("2d")!;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      return context;
    };
    const page = fitted(this.back);
    page.fillStyle = this.colors.page;
    page.fillRect(0, 0, width, height);
    if (this.grid) this.drawGrid(page, width, height);
    this.place();
    const context = fitted(this.canvas);
    context.clearRect(0, 0, width, height);
    this.overlay(context);
  }

  /** Dots on the grid elements snap to; every fifth one a little stronger, and wider apart when zoomed out. */
  private drawGrid(context: CanvasRenderingContext2D, width: number, height: number) {
    let step = DOTS;
    while (step * this.zoom < 14) step *= 5;
    const start = this.toScene({ x: 0, y: 0 });
    context.fillStyle = this.colors.dots;
    for (let x = Math.floor(start.x / step) * step; ; x += step) {
      const sx = Math.round(x * this.zoom + this.origin.x);
      if (sx > width) break;
      for (let y = Math.floor(start.y / step) * step; ; y += step) {
        const sy = Math.round(y * this.zoom + this.origin.y);
        if (sy > height) break;
        const strong = x % (step * 5) === 0 && y % (step * 5) === 0;
        context.fillRect(
          sx - (strong ? 1 : 0.5),
          sy - (strong ? 1 : 0.5),
          strong ? 2 : 1,
          strong ? 2 : 1,
        );
      }
    }
  }
}
