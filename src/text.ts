/** Text in a scene: fonts, measuring, wrapping, and placing text, titles and notes. */

import type { Box, Scene, SceneMarker, SceneShape, SceneText } from "./scene.ts";

/** Adds a text to the scene with its box. */
export function addText(
  scene: Scene,
  measure: Measure,
  value: string,
  x: number,
  y: number,
  options: Partial<SceneText> & Pick<SceneText, "role">,
): SceneText {
  const size = options.size ?? FONT,
    weight = options.weight ?? 400,
    anchor = options.anchor ?? "middle";
  const item: SceneText = {
    text: value,
    x,
    y,
    size,
    weight,
    anchor,
    tone: "text",
    ...options,
    box: textBox(value, x, y, size, weight, anchor, measure),
  };
  scene.texts.push(item);
  return item;
}

/** The box around the boxes of a group of texts. */
export function textGroupBox(texts: { box: Box }[]): Box {
  const x = Math.min(...texts.map((text) => text.box.x)),
    y = Math.min(...texts.map((text) => text.box.y));
  return {
    x,
    y,
    width: Math.max(...texts.map((text) => text.box.x + text.box.width)) - x,
    height: Math.max(...texts.map((text) => text.box.y + text.box.height)) - y,
  };
}

/** How much room a shape or marker takes for the bounds; a marker without a box adds none. */
export interface Extent {
  shape?: (shape: SceneShape) => Box;
  marker?: (marker: SceneMarker) => Box | undefined;
}

/**
 * Bounds around every shape, wire, line, marker and text, with a margin of 10; a title goes above.
 * By default a shape takes its box and a marker 9 around its tip; `extent` overrides either.
 */
export function finishBounds(scene: Scene, measure: Measure, title?: string, extent: Extent = {}) {
  const margin = 10;
  const xs: number[] = [],
    ys: number[] = [];
  const take = (box: Box | undefined) => {
    if (!box) return;
    xs.push(box.x, box.x + box.width);
    ys.push(box.y, box.y + box.height);
  };
  const shapeBox = extent.shape ?? ((shape: SceneShape) => shape.box);
  const markerBox =
    extent.marker ??
    ((marker: SceneMarker) => ({
      x: marker.tip.x - 9,
      y: marker.tip.y - 9,
      width: 18,
      height: 18,
    }));
  scene.shapes.forEach((shape) => take(shapeBox(shape)));
  for (const item of [...scene.wires, ...scene.lines])
    item.points.forEach((point) => take({ ...point, width: 0, height: 0 }));
  scene.markers.forEach((marker) => take(markerBox(marker)));
  scene.texts.forEach((text) => take(text.box));
  if (!xs.length) {
    xs.push(0);
    ys.push(0);
  }
  let minX = Math.min(...xs) - margin,
    minY = Math.min(...ys) - margin;
  let maxX = Math.max(...xs) + margin;
  const maxY = Math.max(...ys) + margin;
  if (title) {
    minY -= 34;
    const heading = addText(scene, measure, title, minX + margin, minY + margin + 10, {
      size: 16,
      weight: 600,
      anchor: "start",
      role: "heading",
    });
    maxX = Math.max(maxX, heading.box.x + heading.box.width + margin);
  }
  minX = Math.floor(minX);
  minY = Math.floor(minY);
  scene.bounds = {
    x: minX,
    y: minY,
    width: Math.ceil(maxX - minX),
    height: Math.ceil(maxY - minY),
  };
}

/** Text width in pixels at a font size and weight; textMeasure returns one for a font family. */
export interface Measure {
  (text: string, size: number, weight: number): number;
}

/**
 * Type scale: element names (FONT) at chat size, connection labels (SMALL) one step smaller, markers
 * (MARK) smaller still; LINE and SMALL_LINE are the line heights of FONT and SMALL text.
 */
export const FONT = 14,
  SMALL = 12,
  MARK = 11,
  LINE = 18,
  SMALL_LINE = 15;

type Context = { font: string; measureText(text: string): { width: number } };

let context: Context | null | undefined,
  current = "";

const cache = new Map<string, Map<string, number>>();
const measures = new Map<string, Measure>();

/**
 * Canvas text metrics for the diagram font, one function per font: layouts kept by measure
 * (uml-placed.ts) find each other. Where no canvas exists (tests) or the canvas rejects the font, a
 * generous average glyph width keeps labels inside their boxes.
 */
export function textMeasure(family: string): Measure {
  let measure = measures.get(family);
  if (!measure) measures.set(family, (measure = newMeasure(family)));
  return measure;
}

function newMeasure(family: string): Measure {
  if (context === undefined) {
    context = null;
    try {
      if (typeof OffscreenCanvas !== "undefined")
        context = new OffscreenCanvas(1, 1).getContext("2d") as Context | null;
      else if (typeof document !== "undefined" && !/jsdom/i.test(navigator.userAgent))
        context = document.createElement("canvas").getContext("2d");
    } catch {
      context = null;
    }
  }
  // Widths are memoized per font, size, weight and text: layout measures the same strings many times
  // (labels, word wraps, every strategy), and setting a canvas font means parsing a CSS font string.
  const widths = cache.get(family) ?? new Map<string, number>();
  cache.set(family, widths);
  return (text, size, weight) => {
    const key = `${size}|${weight}|${text}`;
    let width = widths.get(key);
    if (width !== undefined) return width;
    width = text.length * size * (weight >= 600 ? 0.62 : 0.58);
    if (context) {
      const font = `${weight} ${size}px ${family}`;
      if (current !== font) {
        context.font = font;
        current = font;
      }
      // An unparsable font list leaves the previous font in place.
      if (context.font.includes(`${size}px`)) width = context.measureText(text).width;
    }
    if (widths.size > 20_000) widths.clear();
    widths.set(key, width);
    return width;
  };
}

/** Lines of a label: `<br>` breaks as in Mermaid. */
export const breaks = (text: string) => text.split(/<br\s*\/?>/i);

/** A note's shape with its text left-aligned, `inset` from the box's left edge. */
export function drawNote(
  scene: Scene,
  measure: Measure,
  id: string,
  text: string,
  box: Box,
  { depth = 0, inset = 9, color }: { depth?: number; inset?: number; color?: string } = {},
) {
  scene.shapes.push({
    id,
    kind: "note",
    box,
    container: false,
    depth,
    fill: "page",
    thin: true,
    ...(color ? { color } : {}),
  });
  breaks(text).forEach((line, row, all) =>
    addText(
      scene,
      measure,
      line,
      box.x + inset,
      box.y + box.height / 2 + (row - (all.length - 1) / 2) * SMALL_LINE,
      { size: SMALL, anchor: "start", role: "member", owner: id },
    ),
  );
}

/** The lines of a container's title, centred on `cx`, the first line's top `top` down from the box. */
export function addTitleLines(
  scene: Scene,
  measure: Measure,
  lines: string[],
  owner: string,
  cx: number,
  top: number,
) {
  lines.forEach((line, index) =>
    addText(scene, measure, line, cx, top + LINE / 2 + index * LINE, {
      size: FONT,
      weight: 600,
      role: "title",
      owner,
    }),
  );
}

/** Greedy word wrap; `<br>` forces a break. Words longer than the width stay whole. */
export function wrap(
  text: string,
  width: number,
  size: number,
  weight: number,
  measure: Measure,
): string[] {
  const lines: string[] = [];
  for (const paragraph of breaks(text)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, size, weight) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Text box from its anchor point: `y` is the visual center of the line. */
export function textBox(
  text: string,
  x: number,
  y: number,
  size: number,
  weight: number,
  anchor: "start" | "middle" | "end",
  measure: Measure,
): Box {
  const width = measure(text, size, weight);
  return {
    x: anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x,
    y: y - size * 0.62,
    width,
    height: size * 1.24,
  };
}
