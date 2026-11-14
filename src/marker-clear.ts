/**
 * The audit's marker-on-text and wire-on-marker checks, applied to a wire's own markers while it is
 * being rerouted.
 */

import { type Scene, type SceneWire } from "./scene.ts";
import { coversText, touchesPolygon } from "./audit.ts";
import { followLabel } from "./labels.ts";
import { markerBounds, markerPoints } from "./markers.ts";

/**
 * Whether the wire's own markers, where its route now ends, stay off text and other connections' wires:
 * the audit's marker-on-text and wire-on-marker checks (not marker-collision or marker-on-line).
 */
export function markersClear(scene: Scene, wire: SceneWire): boolean {
  return scene.markers
    .filter((marker) => marker.wire === wire.edge)
    .every((marker) => {
      const reach = markerBounds(marker.kind, marker.tip, marker.direction, marker.small),
        outline = markerPoints(marker.kind, marker.tip, marker.direction, marker.small);
      return (
        !scene.texts.some((text) => coversText(reach, text)) &&
        !scene.wires.some(
          (other) =>
            other.edge !== marker.wire &&
            other.points
              .slice(1)
              .some((point, index) => touchesPolygon(other.points[index], point, outline)),
        )
      );
    });
}

/**
 * Moves the wire's label beside its new route and checks its markers against the labels as they now
 * lie (a label that follows the wire may have been what covered the marker). On failure the label stays put.
 */
export function followLabelClear(scene: Scene, wire: SceneWire): boolean {
  const labels = scene.texts.filter((text) => text.owner === wire.edge && text.role === "label"),
    saved = labels.map(({ x, y, box }) => ({ x, y, box }));
  if (followLabel(scene, wire) && markersClear(scene, wire)) return true;
  labels.forEach((label, index) => Object.assign(label, saved[index]));
  return false;
}
