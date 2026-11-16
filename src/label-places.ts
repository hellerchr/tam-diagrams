/**
 * Labels placed by hand: the label of a connection stands where its source says, as an offset of
 * the label's middle from the middle of the connection's line. An offset rather than a position
 * keeps the label with its line when the ends of the line move. The pass works on any scene: a
 * TAM source gives the offsets after its connections (tam.ts), a Mermaid source on comment lines
 * (uml-places.ts).
 */

import { type Box, centerOf, type Point, type Scene, type SceneText } from "./scene.ts";
import { textGroupBox } from "./text.ts";

/**
 * The connection a label of a scene is placed by: its owner without the mark of a channel's circle
 * (`e1#node`) or of the copy of an element shown as several (`e2#2`), whose labels share their
 * original's place.
 */
export const labelKey = (owner: string) => owner.replace(/#node$/, "").replace(/#\d+$/, "");

/** The wire a label belongs to: its owner without the mark of a channel's circle. */
const wireOfLabel = (owner: string) => owner.replace(/#node$/, "");

/**
 * The middle of the line a wire draws: the circle of a channel, where it has one; else the point
 * halfway along its points, across the pieces it is drawn in. Undefined for no wire of the scene.
 */
export function lineMiddle(scene: Scene, wire: string): Point | undefined {
  const circle = scene.shapes.find((shape) => shape.id === `${wire}#node`);
  if (circle) return centerOf(circle.box);
  const points = scene.wires.filter((item) => item.edge === wire).flatMap((item) => item.points);
  if (!points.length) return undefined;
  const steps = points
      .slice(1)
      .map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y)),
    half = steps.reduce((sum, step) => sum + step, 0) / 2;
  let walked = 0;
  for (const [index, step] of steps.entries()) {
    if (walked + step >= half && step > 0) {
      const share = (half - walked) / step,
        from = points[index],
        to = points[index + 1];
      return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
    }
    walked += step;
  }
  return { ...points[0] };
}

/** The labels of a scene's connections, as groups of their lines, by the wire they belong to. */
export function labelGroups(scene: Scene): Map<string, SceneText[]> {
  const groups = new Map<string, SceneText[]>();
  for (const text of scene.texts) {
    if (text.role !== "label" || !text.owner) continue;
    const wire = wireOfLabel(text.owner);
    if (!scene.wires.some((item) => item.edge === wire)) continue;
    groups.set(wire, [...(groups.get(wire) ?? []), text]);
  }
  return groups;
}

/** The offset of a label's middle from the middle of its line, in whole pixels, were it at `box`. */
export function labelOffset(scene: Scene, wire: string, box: Box): Point | undefined {
  const middle = lineMiddle(scene, wire);
  if (!middle) return undefined;
  const at = centerOf(box);
  return { x: Math.round(at.x - middle.x), y: Math.round(at.y - middle.y) };
}

/**
 * A scene with the labels of some connections where `offsets` says, by the key of the connection
 * (`labelKey`): each label's middle at the middle of its line and the offset. The labels of other
 * connections stay; the bounds grow to what moved.
 */
export function placeLabels(scene: Scene, offsets: ReadonlyMap<string, Point>): Scene {
  if (!offsets.size) return scene;
  const texts = scene.texts.map((text) => ({ ...text, box: { ...text.box } })),
    moved: Box[] = [];
  for (const [wire, group] of labelGroups({ ...scene, texts })) {
    const offset = offsets.get(labelKey(wire)),
      middle = offset && lineMiddle(scene, wire);
    if (!offset || !middle) continue;
    const box = textGroupBox(group),
      at = centerOf(box),
      dx = middle.x + offset.x - at.x,
      dy = middle.y + offset.y - at.y;
    for (const text of group) {
      text.x += dx;
      text.y += dy;
      text.box.x += dx;
      text.box.y += dy;
    }
    moved.push({ ...box, x: box.x + dx, y: box.y + dy });
  }
  if (!moved.length) return scene;
  // Room around what moved, as the layouts leave around everything else.
  const margin = 10,
    { bounds } = scene,
    left = Math.min(bounds.x, ...moved.map((box) => box.x - margin)),
    top = Math.min(bounds.y, ...moved.map((box) => box.y - margin)),
    right = Math.max(bounds.x + bounds.width, ...moved.map((box) => box.x + box.width + margin)),
    bottom = Math.max(bounds.y + bounds.height, ...moved.map((box) => box.y + box.height + margin));
  return {
    ...scene,
    texts,
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
  };
}
