// The diagram editor's stage (DiagramView.svelte): the camera over the picture (where the diagram's origin stands and
// its zoom, by lib/zoom.ts), and the pictures it shows, drawn as the source changes and while a drag is under way.
import { drawDiagram, type Picture, type Problem } from "../lib/diagrams.ts";
import { latest } from "../lib/latest.ts";
import type { Theme } from "../styles/themes.ts";
import { center, fit, type View, zoomAt } from "../lib/zoom.ts";
import type { Box, Point } from "./diagram-hit.ts";

/** The zoom range of the canvas. */
const clampZoom = (zoom: number) => Math.min(8, Math.max(0.1, zoom));

/** The factor a wheel event zooms by: a pinch's many small deltas zoom smoothly, a notch of a mouse wheel by 1.2 and no
 *  more (lines and pages as the pixels they scroll). */
function wheelZoom(deltaY: number, deltaMode = 0): number {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  return Math.min(1.2, Math.max(1 / 1.2, Math.exp(-pixels * 0.01)));
}

/** Pan and zoom over the stage; fitted to it until the person pans or zooms, or an edit is made. */
export class Camera {
  view = $state<View>({ x: 0, y: 0, zoom: 1 });
  width = $state(0);
  height = $state(0);
  fitted = true;

  /** How much of the stage's left edge a floating rail covers (the palette): a fitted diagram stays clear of it. */
  left = $state(0);

  /** Shows all of `bounds`, at most at its own size. */
  fit(bounds: Box) {
    if (!this.width) return;
    const area = { width: this.width - this.left, height: this.height };
    const best = fit(bounds, area, 56);
    const next = best.zoom > 1 ? center(bounds, area, 1) : best;
    this.view = {
      zoom: next.zoom,
      x: this.left + next.x - bounds.x * next.zoom,
      y: next.y - bounds.y * next.zoom,
    };
    this.fitted = true;
  }

  /** The diagram's point under a pointer over `stage`. */
  at(stage: HTMLElement, e: { clientX: number; clientY: number }): Point {
    const rect = stage.getBoundingClientRect();
    const { x, y, zoom } = this.view;
    return { x: (e.clientX - rect.left - x) / zoom, y: (e.clientY - rect.top - y) / zoom };
  }

  /** Zooms to `zoom`, keeping the stage's point (`px`, `py`) where it is. */
  zoomAt(zoom: number, px: number, py: number) {
    this.view = zoomAt(this.view, zoom, px, py);
    this.fitted = false;
  }

  /** The view `base` moved by a drag of (`dx`, `dy`) pixels. */
  pan(base: View, dx: number, dy: number) {
    this.view = { ...base, x: base.x + dx, y: base.y + dy };
    this.fitted = false;
  }

  /** An attachment for the stage, as the old editor's: the wheel moves the view (Shift: sideways), with Ctrl (or a
   *  pinch) it zooms about the pointer, by at most 1.2 a notch. Not passive, so the panel behind never scrolls. */
  wheel = (stage: HTMLElement) => {
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view } = this;
      if (e.ctrlKey || e.metaKey) {
        const rect = stage.getBoundingClientRect();
        return this.zoomAt(
          clampZoom(view.zoom * wheelZoom(e.deltaY, e.deltaMode)),
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
      }
      if (e.shiftKey && !e.deltaX) this.pan(view, -e.deltaY, 0);
      else this.pan(view, -e.deltaX, -e.deltaY);
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  };
}

/** A source's pictures: the last drawn that reads, why the newest does not, the kind of diagram the newest says it is,
 *  and the preview of a drag. */
export class Pictures {
  picture = $state.raw<Picture>();
  problem = $state.raw<Problem>();
  kind = $state.raw<string>();
  preview = $state.raw<Picture>();
  #draw = latest();
  #wanted: string | undefined;
  #drawing = false;
  /** The paper the pictures are drawn on (lib/paper.ts); undefined: the theme's colors. */
  readonly #paper: () => Theme | undefined;

  constructor(paper: () => Theme | undefined = () => undefined) {
    this.#paper = paper;
  }

  /** Draws `source` (a fence language's) on the paper; only the newest drawing lands. */
  show(source: string, lang: string) {
    void this.#draw(drawDiagram(source, lang, this.#paper())).then((drawn) => {
      this.problem = "problem" in drawn ? drawn.problem : undefined;
      this.kind = drawn.kind;
      if ("url" in drawn) this.picture = drawn;
    });
  }

  /** Draws the source a drag would make, as a draft (drawDiagram); a drawing under way finishes first, then the newest
   *  is drawn. */
  previewSource(source: string, lang: string) {
    this.#wanted = source;
    if (!this.#drawing) void this.#drawWanted(lang);
  }

  endPreview() {
    this.preview = undefined;
    this.#wanted = undefined;
  }

  async #drawWanted(lang: string) {
    this.#drawing = true;
    for (let next = this.#wanted; next; next = this.#wanted === next ? undefined : this.#wanted) {
      const drawn = await drawDiagram(next, lang, this.#paper(), true);
      if ("url" in drawn && this.#wanted) this.preview = drawn;
    }
    this.#drawing = false;
  }
}
