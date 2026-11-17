/**
 * Where elements stand when the editor places them: on the grid, at the size a new element of a
 * kind has, and in room of their own, a grid step away from what stands there already.
 */

import type { Box, Point } from "../src/scene.ts";
import type { Placement } from "../src/tam.ts";
import type { ElementKind } from "../src/tam-edit.ts";
import { elementShapes } from "./hit.ts";
import type { Picture } from "./document.ts";

/** Elements snap to this grid; Alt moves them freely. */
export const GRID = 10;

export const snap = (value: number, free: boolean) =>
  free ? Math.round(value) : Math.round(value / GRID) * GRID;

/** The size a new element of a kind is shown at before it is placed; its name sizes it after. */
export const sizeOf = (kind: ElementKind) =>
  kind === "group"
    ? { width: 160, height: 100 }
    : kind === "note"
      ? { width: 80, height: 30 }
      : kind === "human"
        ? { width: 76, height: 66 }
        : { width: 96, height: kind === "storage" ? 36 : 40 };

/** Where a new element of a kind stands when dropped at a point: around it, on the grid. */
export const dropPlace = (kind: ElementKind, at: Point, free: boolean): Point => ({
  x: snap(at.x - sizeOf(kind).width / 2, free),
  y: snap(at.y - sizeOf(kind).height / 2, free),
});

/** The name a new element of a kind gets until one is typed; a group gets none. */
export const NAMES: Record<ElementKind, string> = {
  agent: "Agent",
  human: "User",
  storage: "Storage",
  component: "Component",
  subsystem: "Subsystem",
  class: "Class",
  package: "Package",
  group: "",
  note: "Note",
};

/** Placements moved by a step. */
export function shifted(places: Map<string, Placement>, dx: number, dy: number) {
  return new Map([...places].map(([id, at]) => [id, { ...at, x: at.x + dx, y: at.y + dy }]));
}

/** The boxes of the elements that hold nothing: what a new element keeps its distance to. */
export const takenBoxes = (picture: Picture): Box[] =>
  elementShapes(picture)
    .filter(({ shape }) => !shape.container)
    .map(({ shape }) => shape.box);

/** Whether a box keeps at least a grid step away from every box taken. */
const clearOf = (box: Box, taken: Box[]) =>
  taken.every(
    (other) =>
      box.x >= other.x + other.width + GRID ||
      other.x >= box.x + box.width + GRID ||
      box.y >= other.y + other.height + GRID ||
      other.y >= box.y + box.height + GRID,
  );

/**
 * The first of a row of spots, from `start` on by `next`, whose box (by `boxAt`) is clear of the
 * boxes taken; after forty tries the fortieth.
 */
export function roomAt<T>(start: T, next: (spot: T) => T, boxAt: (spot: T) => Box, taken: Box[]) {
  let spot = start;
  for (let tries = 0; tries < 40 && !clearOf(boxAt(spot), taken); tries++) spot = next(spot);
  return spot;
}
