// The labels of a diagram's connections where the picture draws them (diagram-edit.ts and diagram-uml-model.ts give
// them to the hits): the box around each label's lines, the middle of its line it is placed from, and the key the
// source places it by. A label is dragged to another place on the canvas (diagram-gestures.svelte.ts).
import { labelGroups, labelKey, lineMiddle } from "../../src/label-places.ts";
import type { Scene } from "../../src/scene.ts";
import { textGroupBox } from "../../src/text.ts";
import type { WireLabel } from "./diagram-hit.ts";

/** The labels of a scene's wires, by the wire (its edge) they belong to. */
export function wireLabels(scene: Scene): Map<string, WireLabel> {
  const labels = new Map<string, WireLabel>();
  for (const [wire, texts] of labelGroups(scene)) {
    const middle = lineMiddle(scene, wire);
    if (middle) labels.set(wire, { box: textGroupBox(texts), middle, key: labelKey(wire) });
  }
  return labels;
}

/** The side of its line a label stands on: above or below a line that runs across, left or right of one that runs
 *  up and down, by where its middle is from the line's. */
export type LabelSide = "above" | "below" | "left" | "right";

/** Which side of its line a label stands on, and the offset from the line's middle (as the source places labels:
 *  label-places.ts) that stands it on the other side, as in a mirror. */
export function labelSide(label: WireLabel): {
  side: LabelSide;
  flipped: { x: number; y: number };
} {
  const dx = label.box.x + label.box.width / 2 - label.middle.x,
    dy = label.box.y + label.box.height / 2 - label.middle.y;
  const round = (value: number) => Math.round(value) || 0;
  if (Math.abs(dy) >= Math.abs(dx))
    return { side: dy < 0 ? "above" : "below", flipped: { x: round(dx), y: round(-dy) } };
  return { side: dx < 0 ? "left" : "right", flipped: { x: round(-dx), y: round(dy) } };
}
