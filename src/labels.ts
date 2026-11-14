/** Text beside wires and shapes: small label text, and placing wire, guard and side labels where they collide with nothing. */

import {
  type Box,
  distance,
  grow,
  overlaps,
  type Point,
  type Scene,
  type SceneText,
  straddles,
  unit,
} from "./scene.ts";
import { breaks, type Measure, SMALL, SMALL_LINE, textBox, textGroupBox, wrap } from "./text.ts";
import { markerBounds } from "./markers.ts";
import { crossesBox } from "./audit.ts";

/** A small label of one or more lines centered on `y`, with a halo. */
export function smallLines(
  scene: Scene,
  measure: Measure,
  value: string,
  x: number,
  y: number,
  options: Partial<SceneText> & Pick<SceneText, "role">,
) {
  const parts = breaks(value);
  parts.forEach((part, index) => {
    const lineY = y + (index - (parts.length - 1) / 2) * SMALL_LINE,
      anchor = options.anchor ?? "middle";
    scene.texts.push({
      text: part,
      x,
      y: lineY,
      size: SMALL,
      weight: 400,
      anchor,
      tone: "secondary",
      halo: "background",
      ...options,
      box: textBox(part, x, lineY, SMALL, 400, anchor, measure),
    });
  });
}

/** A connection label broken into lines of at most `width` pixels where the author did not break it. */
export function wrapSmall(text: string, measure: Measure, width = 220): string {
  return breaks(text)
    .map((line) => wrap(line, width, SMALL, 400, measure).join("<br>"))
    .join("<br>");
}

/** Size of a small multi-line label. */
export function smallSize(value: string, measure: Measure) {
  const lines = breaks(value);
  return {
    width: Math.ceil(Math.max(...lines.map((line) => measure(line, SMALL, 400)))),
    height: lines.length * SMALL_LINE + 2,
  };
}

/**
 * Container titles stay centered unless wires cross them there; then they move to the left or the
 * right end of their strip, whichever is crossed least.
 */
export function dodgeTitles(scene: Scene, measure: Measure) {
  for (const shape of scene.shapes) {
    if (!shape.container) continue;
    const titles = scene.texts.filter(
      (text) => text.owner === shape.id && (text.role === "title" || text.role === "stereotype"),
    );
    if (!titles.length || titles.some((text) => text.anchor !== "middle")) continue;
    const width = Math.max(...titles.map((text) => text.box.width));
    const crossed = (shift: number) =>
      scene.wires.reduce(
        (sum, wire) =>
          sum +
          titles.filter((text) =>
            wire.points
              .slice(1)
              .some((point, index) =>
                crossesBox(
                  wire.points[index],
                  point,
                  grow({ ...text.box, x: text.box.x + shift }, 3),
                ),
              ),
          ).length,
        0,
      );
    if (!crossed(0)) continue;
    const center = shape.box.x + shape.box.width / 2;
    const left = shape.box.x + 12 + width / 2 - center,
      right = shape.box.x + shape.box.width - 12 - width / 2 - center;
    const best = [left, right]
      .map((shift) => ({ shift, count: crossed(shift) }))
      .toSorted((a, b) => a.count - b.count)[0];
    if (best.count >= crossed(0)) continue;
    for (const text of titles) {
      text.x += best.shift;
      text.box = textBox(text.text, text.x, text.y, text.size, text.weight, text.anchor, measure);
    }
  }
}

/**
 * Moves a connection label that sits away from its wire, touches it, or is crossed by another wire
 * next to the wire: beside its longest segments first, as close as possible, wherever it collides
 * with nothing.
 */
export function hugLabels(scene: Scene) {
  const owners = new Set(
    scene.texts.filter((text) => text.role === "label").map((text) => text.owner),
  );
  for (const owner of owners) {
    const wire = scene.wires.find((item) => item.edge === owner);
    if (!wire) continue;
    const texts = scene.texts.filter((text) => text.owner === owner && text.role === "label");
    const box = textGroupBox(texts);
    const gap = Math.min(
      ...wire.points.slice(1).map((point, index) => boxDistance(box, wire.points[index], point)),
    );
    const others = scene.texts.filter((text) => !texts.includes(text));
    const hidden = { ...scene, texts: others };
    // Labels near their wire and on free space stay; others move next to the wire.
    const crossed =
      scene.wires.some((other) =>
        other.points
          .slice(1)
          .some((point, index) =>
            crossesBox(other.points[index], point, grow(box, other === wire ? 3 : 0)),
          ),
      ) || others.some((text) => overlaps(box, text.box));
    if (gap <= 9 && !crossed) continue;
    const segments = wire.points
      .slice(1)
      .map((point, index) => [wire.points[index], point] as const)
      .filter(([a, b]) => distance(a, b) >= 24)
      .toSorted((a, b) => distance(b[0], b[1]) - distance(a[0], a[1]));
    // The segment ends come last, after the inner points of every segment: a free spot beside a
    // shorter segment beats a longer one's end, and an end beats leaving the label on a wire.
    const spots = [[0.5, 0.3, 0.7, 0.15, 0.85], [1, 0]].flatMap((ts) =>
      segments.flatMap(([a, b]) => ts.map((t) => ({ a, b, t }))),
    );
    let placed: Box | undefined;
    for (const away of [8, 16, 28]) {
      for (const { a, b, t } of spots) {
        const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
          upright = Math.abs(a.x - b.x) < 0.5;
        const candidates = upright
          ? [
              { x: at.x + away, y: at.y - box.height / 2 },
              { x: at.x - away - box.width, y: at.y - box.height / 2 },
            ]
          : [
              { x: at.x - box.width / 2, y: at.y - away + 2 - box.height },
              { x: at.x - box.width / 2, y: at.y + away - 2 },
            ];
        placed = candidates
          .map((place) => ({ ...box, ...place }))
          .find((candidate) => labelFree(hidden, candidate));
        if (placed) break;
      }
      if (placed) break;
    }
    if (!placed) continue;
    const dx = placed.x - box.x,
      dy = placed.y - box.y;
    moveTexts(texts, dx, dy);
  }
}

/** Moves texts and their boxes by (dx, dy). */
function moveTexts(texts: SceneText[], dx: number, dy: number) {
  for (const text of texts) {
    text.x += dx;
    text.y += dy;
    text.box = { ...text.box, x: text.box.x + dx, y: text.box.y + dy };
  }
}

function boxDistance(box: Box, a: Point, b: Point): number {
  if (crossesBox(a, b, box)) return 0;
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ];
  const toSegment = (p: Point) => {
    const length = distance(a, b) ** 2 || 1,
      t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length),
      );
    return distance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  };
  const fromSegment = [a, b]
    .map(
      (p) =>
        Math.max(box.x - p.x, 0, p.x - box.x - box.width) ** 2 +
        Math.max(box.y - p.y, 0, p.y - box.y - box.height) ** 2,
    )
    .map(Math.sqrt);
  return Math.min(...corners.map(toSegment), ...fromSegment);
}

/**
 * Puts a wire's label beside one of its segments, the longest free one first: right of vertical
 * segments and above horizontal ones, else on the other side or further along.
 */
function placeWireLabel(scene: Scene, measure: Measure, id: string, text: string) {
  const wire = scene.wires.find((item) => item.edge === id);
  if (!wire) return;
  const { width, height } = smallSize(text, measure);
  const segments = wire.points
    .slice(1)
    .map((point, index) => [wire.points[index], point] as const)
    .toSorted((a, b) => distance(b[0], b[1]) - distance(a[0], a[1]));
  const candidates: Box[] = [];
  for (const [a, b] of segments) {
    for (const t of [0.5, 0.3, 0.7]) {
      const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        upright = Math.abs(a.x - b.x) < 0.5;
      if (upright)
        candidates.push(
          { x: at.x + 6, y: at.y - height / 2, width, height },
          { x: at.x - 6 - width, y: at.y - height / 2, width, height },
        );
      else
        candidates.push(
          { x: at.x - width / 2, y: at.y - 4 - height, width, height },
          { x: at.x - width / 2, y: at.y + 4, width, height },
        );
    }
  }
  // Short wires: beside an end, a little further out.
  for (const [a, b] of segments) {
    const upright = Math.abs(a.x - b.x) < 0.5;
    for (const at of [a, b]) {
      if (upright)
        candidates.push(
          { x: at.x + 6, y: at.y + (b.y > a.y === (at === a) ? 6 : -6 - height), width, height },
          {
            x: at.x - 6 - width,
            y: at.y + (b.y > a.y === (at === a) ? 6 : -6 - height),
            width,
            height,
          },
        );
      else
        candidates.push(
          {
            x: at.x + (b.x > a.x === (at === a) ? 8 : -8 - width),
            y: at.y - 4 - height,
            width,
            height,
          },
          { x: at.x + (b.x > a.x === (at === a) ? 8 : -8 - width), y: at.y + 4, width, height },
        );
    }
  }
  const free = (box: Box) => labelFree(scene, box, { wireGap: 2, containers: false });
  const box = candidates.find(free) ?? candidates[0];
  if (box)
    smallLines(scene, measure, text, box.x + box.width / 2, box.y + box.height / 2, {
      role: "label",
      owner: id,
    });
}

/**
 * Whether a label box lies clear of shapes, text, wires (`wireGap` away), markers and lines, and,
 * with `containers`, of the edges of containers it only partly lies in.
 */
function labelFree(
  scene: Scene,
  box: Box,
  { wireGap = 4, containers = true }: { wireGap?: number; containers?: boolean } = {},
): boolean {
  return (
    !scene.shapes.some(
      (shape) => !shape.container && shape.kind !== "region" && overlaps(grow(box, 3), shape.box),
    ) &&
    !scene.texts.some((other) => overlaps(grow(box, 2), other.box)) &&
    !scene.wires.some((other) =>
      other.points
        .slice(1)
        .some((point, index) => crossesBox(other.points[index], point, grow(box, wireGap))),
    ) &&
    !scene.markers.some((marker) =>
      overlaps(grow(box, 2), markerBounds(marker.kind, marker.tip, marker.direction, marker.small)),
    ) &&
    !scene.lines.some((line) =>
      line.points
        .slice(1)
        .some((point, index) => crossesBox(line.points[index], point, grow(box, 2))),
    ) &&
    !(containers && scene.shapes.some((shape) => shape.container && straddles(box, shape.box)))
  );
}

/**
 * A label beside a small node (a decision's question): upper right of it by preference, else
 * right, lower right or the left side, wherever nothing is in the way.
 */
export function placeBeside(scene: Scene, measure: Measure, owner: string, box: Box, text: string) {
  const { width, height } = smallSize(text, measure);
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const candidates: Box[] = [
    { x: cx + 8, y: box.y - height - 1, width, height },
    { x: box.x + box.width + 6, y: cy - height / 2, width, height },
    { x: cx + 8, y: box.y + box.height + 1, width, height },
    { x: cx - 8 - width, y: box.y - height - 1, width, height },
    { x: box.x - 6 - width, y: cy - height / 2, width, height },
    { x: cx - 8 - width, y: box.y + box.height + 1, width, height },
    { x: box.x + box.width + 6, y: box.y - height - 4, width, height },
    { x: box.x - 6 - width, y: box.y - height - 4, width, height },
    // Further out, where the wires near the node leave room.
    ...[14, 26].flatMap((more) => [
      { x: cx + 8, y: box.y - height - 1 - more, width, height },
      { x: cx + 8, y: box.y + box.height + 1 + more, width, height },
      { x: box.x + box.width + 6 + more, y: cy - height / 2, width, height },
      { x: cx - 8 - width, y: box.y + box.height + 1 + more, width, height },
      { x: cx - 8 - width, y: box.y - height - 1 - more, width, height },
      { x: box.x - 6 - width - more, y: cy - height / 2, width, height },
    ]),
  ];
  const spot = candidates.find((candidate) => labelFree(scene, candidate)) ?? candidates[0];
  smallLines(scene, measure, text, spot.x + width / 2, spot.y + height / 2, {
    role: "label",
    owner,
    halo: undefined,
  });
}

/** A guard next to its wire, close to where the wire leaves its decision. */
export function placeGuardLabel(scene: Scene, measure: Measure, id: string, text: string) {
  const wire = scene.wires.find((item) => item.edge === id);
  if (!wire || wire.points.length < 2) return;
  const { width, height } = smallSize(text, measure);
  const [a, b] = wire.points,
    d = unit(a, b),
    length = distance(a, b),
    upright = Math.abs(d.x) < 0.5;
  const candidates: Box[] = [];
  for (const along of [5, 12, 22, 34]) {
    if (along > length - 6 && candidates.length) break;
    for (const side of [1, -1]) {
      if (upright) {
        const y = d.y > 0 ? a.y + along : a.y - along - height;
        candidates.push({ x: side > 0 ? a.x + 8 : a.x - 8 - width, y, width, height });
      } else {
        const x = d.x > 0 ? a.x + along : a.x - along - width;
        candidates.push({ x, y: side > 0 ? a.y - 7 - height : a.y + 7, width, height });
      }
    }
  }
  const spot = candidates.find((candidate) => labelFree(scene, candidate));
  if (spot)
    smallLines(scene, measure, text, spot.x + width / 2, spot.y + height / 2, {
      role: "label",
      owner: id,
    });
  else placeWireLabel(scene, measure, id, text);
}

/** Moves a wire's label next to its (new) route when it is no longer beside it; false if no spot is free. */
export function followLabel(scene: Scene, wire: Scene["wires"][number]): boolean {
  const texts = scene.texts.filter((text) => text.owner === wire.edge && text.role === "label");
  if (!texts.length) return true;
  const box = textGroupBox(texts);
  const near = Math.min(
    ...wire.points.slice(1).map((point, index) => boxDistance(box, wire.points[index], point)),
  );
  const crossed = wire.points
    .slice(1)
    .some((point, index) => crossesBox(wire.points[index], point, grow(box, 3)));
  if (near <= 14 && !crossed) return true;
  const others = scene.texts.filter((text) => !texts.includes(text));
  const hidden = { ...scene, texts: others };
  const segments = wire.points
    .slice(1)
    .map((point, index) => [wire.points[index], point] as const)
    .toSorted((p, q) => distance(q[0], q[1]) - distance(p[0], p[1]));
  for (const [a, b] of segments) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      upright = Math.abs(a.x - b.x) < 0.5;
    const spots = upright
      ? [
          { x: mid.x + 8, y: mid.y - box.height / 2 },
          { x: mid.x - 8 - box.width, y: mid.y - box.height / 2 },
        ]
      : [
          { x: mid.x - box.width / 2, y: mid.y - 7 - box.height },
          { x: mid.x - box.width / 2, y: mid.y + 7 },
        ];
    const spot = spots
      .map((place) => ({ ...box, ...place }))
      .find((candidate) => labelFree(hidden, candidate));
    if (!spot) continue;
    const dx = spot.x - box.x,
      dy = spot.y - box.y;
    moveTexts(texts, dx, dy);
    return true;
  }
  return false;
}

/** A path's segments, longest first (a stable sort keeps equal lengths in path order). */
export function longestFirst(segments: (readonly [Point, Point])[]): (readonly [Point, Point])[] {
  return segments.toSorted(
    (a, b) =>
      Math.hypot(b[1].x - b[0].x, b[1].y - b[0].y) - Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y),
  );
}

/**
 * Label boxes of `width` by `height` beside segments, in order of preference: for each gap, along each
 * segment at each position (a fraction of its length), right then left of a vertical segment, else
 * above and, with `below`, below it.
 */
export function besideSegments(
  segments: readonly (readonly [Point, Point])[],
  width: number,
  height: number,
  gaps: number[],
  positions: number[],
  below = true,
): Box[] {
  const candidates: Box[] = [];
  for (const gap of gaps)
    for (const [a, b] of segments)
      for (const t of positions) {
        const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (Math.abs(a.x - b.x) < 0.5)
          candidates.push(
            { x: at.x + gap, y: at.y - height / 2, width, height },
            { x: at.x - gap - width, y: at.y - height / 2, width, height },
          );
        else {
          candidates.push({ x: at.x - width / 2, y: at.y - gap + 2 - height, width, height });
          if (below) candidates.push({ x: at.x - width / 2, y: at.y + gap - 2, width, height });
        }
      }
  return candidates;
}
