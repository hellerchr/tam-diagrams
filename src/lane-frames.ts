/** Frames spanning lanes (fragments of a sequence, regions of an activity), their guards, notes and labels beside connections. */

import type { Box, Point, Scene } from "./scene.ts";
import { besideSegments, longestFirst } from "./labels.ts";
import { addText, type Measure, SMALL, SMALL_LINE } from "./text.ts";

/**
 * A spot for a label beside a connection: along its segments (longest first, or in the given
 * order) and on the allowed sides, the first that `free` accepts; otherwise the one with the
 * fewest `conflicts`.
 */
export function placeLabel(
  segments: (readonly [Point, Point])[],
  size: { width: number; height: number },
  free: (box: Box) => boolean,
  options: {
    sides?: "both" | "above";
    conflicts?: (box: Box) => number;
    gaps?: number[];
    sorted?: boolean;
    positions?: number[];
  } = {},
): Box | undefined {
  const { width, height } = size;
  const candidates = besideSegments(
    options.sorted ? segments : longestFirst(segments),
    width,
    height,
    options.gaps ?? [8, 16, 28],
    options.positions ?? [0.5, 0.3, 0.7, 0.15, 0.85],
    options.sides !== "above",
  );
  const found = candidates.find(free);
  if (found || !options.conflicts) return found ?? candidates[0];
  const conflicts = options.conflicts;
  return candidates.reduce(
    (best, box) => (conflicts(box) < conflicts(best) ? box : best),
    candidates[0],
  );
}

/** A frame spanning columns: a fragment of a sequence or a region of an activity. */
export interface LaneFrame {
  id: string;
  kind: string;
  text: string;
  top: number;
  bottom: number;
  /** The columns' center lines the frame must enclose, and how far content reaches right of the rightmost one. */
  members: number[];
  extra: number;
  /** Separators (`else`, `and`) at these heights, with their conditions. */
  branches: { y: number; text: string; guard?: Guard }[];
  /** Where the condition goes when the layout placed it (clear of lifelines and bars). */
  guard?: Guard;
  children: LaneFrame[];
  depth: number;
}

/** Boxes of nested frames: around their columns with room for the keyword tab, around their inner frames with a margin. */
export function frameBoxes(
  roots: LaneFrame[],
  measure: Measure,
  options: { reach: number; fallback: number },
): Map<string, Box> {
  const boxes = new Map<string, Box>();
  const visit = (frame: LaneFrame): Box => {
    const inner = frame.children.map(visit);
    const tab = frame.kind === "rect" ? 0 : measure(frame.kind, SMALL, 600) + 20;
    let left = frame.members.length
      ? Math.min(...frame.members) - Math.max(options.reach + 8, tab + options.reach - 8)
      : options.fallback;
    let right = frame.members.length
      ? Math.max(...frame.members) + options.reach + 8 + frame.extra
      : options.fallback + 120;
    for (const box of inner) {
      left = Math.min(left, box.x - 8);
      right = Math.max(right, box.x + box.width + 8);
    }
    const width = Math.max(
      right - left,
      tab + 4 + (frame.text ? measure(`[${frame.text}]`, SMALL, 400) + 16 : 0),
    );
    const box = { x: left, y: frame.top, width, height: frame.bottom - frame.top };
    boxes.set(frame.id, box);
    return box;
  };
  roots.forEach(visit);
  return boxes;
}

export const TAB = 20;

/** Draws a frame: a shaded area for `rect`, else an outline with the keyword in a tab, the condition beside it and dashed separators between branches. */
export function drawFrame(scene: Scene, measure: Measure, frame: LaneFrame, box: Box) {
  if (frame.kind === "rect") {
    scene.shapes.push({
      id: frame.id,
      kind: "rect",
      box,
      container: true,
      depth: frame.depth,
      fill: "shade",
      thin: true,
    });
    return;
  }
  const tabWidth = Math.ceil(measure(frame.kind, SMALL, 600) + 20);
  scene.shapes.push({
    id: frame.id,
    kind: "frame",
    box,
    container: true,
    depth: frame.depth,
    fill: "none",
    tab: { width: tabWidth, height: TAB },
  });
  addText(scene, measure, frame.kind, box.x + 7, box.y + TAB / 2, {
    size: SMALL,
    weight: 600,
    anchor: "start",
    role: "title",
    owner: frame.id,
  });
  const guard = (placed: Guard | undefined, text: string, x: number, y: number) =>
    (placed ?? { x, y, lines: [`[${text}]`] }).lines.forEach((line, row) =>
      addText(scene, measure, line, (placed ?? { x }).x, (placed ?? { y }).y + row * SMALL_LINE, {
        size: SMALL,
        anchor: "start",
        role: "label",
        owner: frame.id,
        tone: "secondary",
      }),
    );
  if (frame.text) guard(frame.guard, frame.text, box.x + tabWidth + 8, box.y + TAB / 2);
  for (const branch of frame.branches) {
    scene.lines.push({
      points: [
        { x: box.x, y: branch.y },
        { x: box.x + box.width, y: branch.y },
      ],
      dashed: true,
      tone: "ink",
      width: 1,
    });
    if (branch.text) guard(branch.guard, branch.text, box.x + 8, branch.y + 4 + SMALL_LINE / 2);
  }
}

/** A frame's condition: its lines (the first centered at `y`) starting at `x`. */
interface Guard {
  x: number;
  y: number;
  lines: string[];
}

/**
 * Places a condition `[text]` in a header row from `start` to `end`, in the first stretch free of
 * the `blocked` intervals (lifelines and activation bars, with their clearance) that fits it;
 * otherwise wrapped to the widest free stretch.
 */
export function placeGuard(
  text: string,
  start: number,
  end: number,
  y: number,
  blocked: [number, number][],
  measure: Measure,
): Guard {
  const label = `[${text}]`,
    width = measure(label, SMALL, 400);
  const spans: [number, number][] = [];
  let from = start;
  for (const [a, b] of blocked.toSorted((p, q) => p[0] - q[0])) {
    if (b <= from) continue;
    if (a > from) spans.push([from, Math.min(a, end)]);
    from = Math.max(from, b);
    if (from >= end) break;
  }
  if (from < end) spans.push([from, end]);
  const fit = spans.find(([a, b]) => b - a >= width);
  if (fit) return { x: fit[0], y, lines: [label] };
  const widest = spans.reduce(
    (best, span) => (span[1] - span[0] > best[1] - best[0] ? span : best),
    spans[0] ?? [start, end],
  );
  const lines: string[] = [];
  let line = "";
  for (const word of label.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, SMALL, 400) > widest[1] - widest[0]) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  return { x: widest[0], y, lines };
}

/** A note's box beside (`left`, `right`) or over one or two columns, its top at `y`; `reach` is how far content reaches from a center line. */
export function noteBox(
  placement: "left" | "right" | "over",
  centers: number[],
  size: { width: number; height: number },
  y: number,
  reach: number,
): Box {
  const a = centers[0],
    b = centers[1] ?? a;
  if (placement === "over") {
    const width = Math.max(size.width, Math.abs(b - a) + 40);
    return { x: (a + b) / 2 - width / 2, y, width, height: size.height };
  }
  // Beside a lifeline the note keeps 16px from its activation bar.
  return placement === "right"
    ? { x: a + reach + 16, y, ...size }
    : { x: a - reach - 16 - size.width, y, ...size };
}
