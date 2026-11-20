// The dot grid under the diagram canvas's picture (DiagramCanvas.svelte), as tam-diagrams' old editor drew it
// (editor/view.ts): a dot every 20 of the diagram's units, every fifth one a little stronger, five times wider apart
// while the dots would come nearer than 14 pixels; one tile of them (gridTile) repeated over an element larger than the
// stage, at one zoom, which panning and zooming only move and scale (gridPlace), the compositor's work: it is drawn
// again when the view rests.
import type { View } from "../lib/zoom.ts";

/** The dots' distance in the diagram's units. */
const DOTS = 20;

/** The distance of the grid's dots at a zoom: wider apart when zoomed out. */
export function gridStep(zoom: number): number {
  let step = DOTS;
  while (step * zoom < 14) step *= 5;
  return step;
}

/** The grid's dots over a stage `width` by `height`: where each stands on it, and whether it is a strong one. */
export function gridDots(
  view: View,
  width: number,
  height: number,
): { x: number; y: number; strong: boolean }[] {
  const step = gridStep(view.zoom);
  const dots: { x: number; y: number; strong: boolean }[] = [];
  const first = (origin: number) => Math.floor(-origin / view.zoom / step) * step;
  for (let x = first(view.x); ; x += step) {
    const sx = Math.round(x * view.zoom + view.x);
    if (sx > width) break;
    for (let y = first(view.y); ; y += step) {
      const sy = Math.round(y * view.zoom + view.y);
      if (sy > height) break;
      dots.push({ x: sx, y: sy, strong: x % (step * 5) === 0 && y % (step * 5) === 0 });
    }
  }
  return dots;
}

/** How far the grid drawn at one zoom may be scaled down (its element has the room for it) and up (its dots grow); past
 *  that it hides until it is drawn again. */
export const GRID_SCALE = { least: 0.8, most: 1.5 };

/** Whether the grid drawn at zoom `drawn` is scaled past GRID_SCALE at `zoom`. */
export const gridStale = (zoom: number, drawn: number) =>
  zoom / drawn < GRID_SCALE.least || zoom / drawn > GRID_SCALE.most;

/** The element the grid is drawn on at zoom `drawn` (gridTile), in CSS pixels: the stage with the room to shrink, and a period (five
 *  steps, where the grid repeats itself, strong dots too) more each way. */
export function gridBox(stage: { width: number; height: number }, drawn: number) {
  const period = Math.ceil(gridStep(drawn) * 5 * drawn);
  return {
    width: Math.ceil(stage.width / GRID_SCALE.least) + period,
    height: Math.ceil(stage.height / GRID_SCALE.least) + period,
  };
}

/** Where the grid drawn from the diagram's origin at zoom `drawn` (gridTile) stands on the stage under `view`: shifted
 *  less than a period up and left and scaled to the view's zoom, so that panning and zooming only move it. */
export function gridPlace(view: View, drawn: number): { x: number; y: number; scale: number } {
  const scale = view.zoom / drawn;
  const period = gridStep(drawn) * 5 * view.zoom;
  const shift = (origin: number) => {
    const by = (((origin % period) + period) % period) - period;
    return scale === 1 ? Math.round(by) : by;
  };
  return { x: shift(view.x), y: shift(view.y), scale };
}

/** One period of the grid at zoom `drawn` as an SVG image, `size` CSS pixels each way: five steps of dots each way, a
 *  strong one first, a dot one pixel and a strong one two. Each dot stands half a step in, so none is cut at the tile's
 *  edge: worn at `offset` it puts the dots where gridDots does from the diagram's origin. In `color`: a background, which
 *  the compositor keeps as drawn while it moves and scales (a mask it draws again at every scale). */
export function gridTile(
  drawn: number,
  color: string,
): { url: string; size: number; offset: number } {
  const step = gridStep(drawn) * drawn;
  const size = step * 5;
  const dots: string[] = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const dot = i === 0 && j === 0 ? 2 : 1;
      const at = (k: number) => (k * step + step / 2 - dot / 2).toFixed(2);
      dots.push(`<rect x="${at(i)}" y="${at(j)}" width="${dot}" height="${dot}"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" fill="${color}">${dots.join("")}</svg>`;
  return { url: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, size, offset: -step / 2 };
}
