/** Use case line labels: a label beside the middle of its line, on whichever side has room. */

import { crossesBox, insideFraction } from "./audit.ts";
import { smallLines, smallSize } from "./labels.ts";
import { markerBounds } from "./markers.ts";
import {
  type Box,
  distance,
  grow,
  overlaps,
  type Point,
  type Scene,
  type SceneWire,
  straddles,
  unit,
} from "./scene.ts";
import type { Measure } from "./text.ts";

/** How much room a label box keeps from what it meets; a negative value lets it graze. */
interface Room {
  shape: number;
  container: number;
  text: number;
  label: number;
  marker: number;
  wire: number;
  ownWire: number;
}

/** Room all round: a gap from every shape, wire and marker, and a wider one from other labels. */
const WANTED: Room = { shape: 3, container: 2, text: 2, label: 10, marker: 2, wire: 2, ownWire: 4 };

/**
 * The room audit.ts accepts, check by check: text-on-shape allows 1px of overlap, text-collision
 * 1px between texts and labels, marker-on-text 0.5px, wire-through-text a wire through the box
 * shrunk by 2px, and halo-on-wire a wire outside the box grown by 3px. A boundary edge is not
 * audited, but a label never straddles one.
 */
export const ACCEPTED: Room = {
  shape: -1,
  container: 0,
  text: -1,
  label: -1,
  marker: -0.5,
  wire: -2,
  ownWire: 3,
};

/** Whether `box` keeps `room` from every shape, text, marker and wire of the scene. */
export function hasRoom(scene: Scene, wire: SceneWire, box: Box, room: Room): boolean {
  return (
    !scene.shapes.some((shape) =>
      shape.container
        ? straddles(grow(box, room.container), shape.box)
        : overlaps(grow(box, room.shape), shape.box),
    ) &&
    !scene.texts.some((other) =>
      overlaps(grow(box, other.role === "label" ? room.label : room.text), other.box),
    ) &&
    !scene.markers.some((marker) =>
      overlaps(
        grow(box, room.marker),
        markerBounds(marker.kind, marker.tip, marker.direction, marker.small),
      ),
    ) &&
    !scene.wires.some((other) =>
      other.points
        .slice(1)
        .some((point, index) =>
          crossesBox(
            other.points[index],
            point,
            grow(box, other === wire ? room.ownWire : room.wire),
          ),
        ),
    )
  );
}

/** How many things a label box runs into, other wires above all. */
function crowding(scene: Scene, wire: SceneWire, box: Box): number {
  return (
    scene.shapes.filter((shape) =>
      shape.container ? straddles(box, shape.box) : overlaps(box, shape.box),
    ).length *
      2 +
    scene.texts.filter((other) => overlaps(box, other.box)).length * 2 +
    scene.wires.filter(
      (other) =>
        other !== wire &&
        other.points.slice(1).some((point, index) => crossesBox(other.points[index], point, box)),
    ).length *
      3
  );
}

/**
 * Where the halo (stroke-width 7 in draw.ts) erases a wire, relative to a label box, from
 * rasterised labels over wires: sideways it reaches 2.5px past the box, under it 1px for the
 * descenders of p, y and g. The top 2px of the box are not counted: a wire only that deep (all the
 * audit lets through there) meets the ascenders alone, and counting the nick a sloped wire cuts
 * from a corner moved labels that had lost nothing.
 */
const HALO_REACH = { side: 2.5, bottom: 1, topSkipped: 2 };

/** Lengths this close are equal: the pieces of a wire sum to a different last digit per spot. */
const SAME_LENGTH = 1e-6;

/** Length of other wires inside the halo's reach round `box`: what the label would erase. */
function wireUnderHalo(scene: Scene, wire: SceneWire, box: Box): number {
  const halo: Box = {
    x: box.x - HALO_REACH.side,
    y: box.y + HALO_REACH.topSkipped,
    width: box.width + 2 * HALO_REACH.side,
    height: box.height - HALO_REACH.topSkipped + HALO_REACH.bottom,
  };
  let length = 0;
  for (const other of scene.wires) {
    if (other === wire) continue;
    other.points.slice(1).forEach((point, index) => {
      const from = other.points[index];
      length += insideFraction(from, point, halo) * distance(from, point);
    });
  }
  return length;
}

/** Of the spots the audit accepts, the one that hides the least wire; ties keep the earlier. */
export function leastHiding(scene: Scene, wire: SceneWire, spots: Box[]): Box | undefined {
  let best: Box | undefined,
    least = Infinity;
  for (const spot of spots) {
    if (!hasRoom(scene, wire, spot, ACCEPTED)) continue;
    const hidden = wireUnderHalo(scene, wire, spot);
    if (hidden < least - SAME_LENGTH) [best, least] = [spot, hidden];
  }
  return best;
}

/** Boxes of `size` beside the middle of a line, on both sides, the nearest and middlest first. */
function labelSpots(points: Point[], size: Pick<Box, "width" | "height">): Box[] {
  const lengths = points.slice(1).map((point, index) => distance(points[index], point)),
    total = lengths.reduce((sum, value) => sum + value, 0);
  /** The point at a fraction of the line's length, and the line's direction there. */
  const at = (t: number) => {
    let rest = t * total,
      k = 0;
    while (k < lengths.length - 1 && rest > lengths[k]) rest -= lengths[k++];
    const a = points[k],
      b = points[k + 1],
      f = lengths[k] ? rest / lengths[k] : 0;
    return { point: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, d: unit(a, b) };
  };
  return [6, 12, 20, 30].flatMap((gap) =>
    [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82].flatMap((t) => {
      const { point, d } = at(t),
        n = { x: -d.y, y: d.x };
      return [1, -1].map((side) => {
        // The box's nearest corner keeps `gap` from the line.
        const reach = (Math.abs(n.x) * size.width) / 2 + (Math.abs(n.y) * size.height) / 2 + gap;
        return {
          x: point.x + n.x * side * reach - size.width / 2,
          y: point.y + n.y * side * reach - size.height / 2,
          ...size,
        };
      });
    }),
  );
}

/**
 * A label beside the middle of its line (straight or curved), on whichever side is free: clear of
 * shapes, text, markers and wires, a clear gap from other labels, and either inside a boundary or
 * outside it, never across its edge.
 */
export function labelLine(scene: Scene, measure: Measure, id: string, text: string) {
  const wire = scene.wires.find((item) => item.edge === id);
  if (!wire) return;
  const spots = labelSpots(wire.points, smallSize(text, measure));
  // Three tiers: a spot with room all round; else, of the spots the audit accepts, the one whose
  // halo erases the least other wire (the audit lets a wire graze the box, but the halo would
  // cut it under the whole word); else the one that runs into the fewest things. Counting alone
  // would score a wire grazing the box like one through its middle, and shape overlaps below
  // wires, though the audit reports every overlap and only the wire through the box.
  const box =
    spots.find((spot) => hasRoom(scene, wire, spot, WANTED)) ??
    leastHiding(scene, wire, spots) ??
    spots.reduce((best, spot) =>
      crowding(scene, wire, spot) < crowding(scene, wire, best) ? spot : best,
    );
  smallLines(scene, measure, text, box.x + box.width / 2, box.y + box.height / 2, {
    role: "label",
    owner: id,
  });
}
