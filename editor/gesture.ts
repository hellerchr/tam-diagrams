/**
 * The gestures on the canvas, from the press of the pointer to its release: what each holds while
 * it runs, and how far the pointer goes before a press becomes one.
 */

import type { Box, Point } from "../src/scene.ts";
import type { Placement } from "../src/tam.ts";
import type { ElementKind } from "../src/tam-edit.ts";
import type { LaneFrame } from "../src/uml-placed.ts";
import type { Picture } from "./document.ts";
import type { Guide } from "./guides.ts";
import type { Part } from "./hit.ts";

/** A pointer moves this far before a press becomes a drag. */
export const SLOP = 4;

/** Handles are this large on screen, and connection handles this far from their element. */
export const HANDLE = 8,
  REACH = 22;

/** The handles of a selected element: which edges each moves. */
export const HANDLES = [
  { x: -1, y: -1, cursor: "nwse-resize" },
  { x: 0, y: -1, cursor: "ns-resize" },
  { x: 1, y: -1, cursor: "nesw-resize" },
  { x: 1, y: 0, cursor: "ew-resize" },
  { x: 1, y: 1, cursor: "nwse-resize" },
  { x: 0, y: 1, cursor: "ns-resize" },
  { x: -1, y: 1, cursor: "nesw-resize" },
  { x: -1, y: 0, cursor: "ew-resize" },
] as const;

export type Handle = (typeof HANDLES)[number];

/** A gesture under way, from the press of the pointer to its release. */
export type Gesture =
  | { type: "pan"; last: Point }
  | {
      type: "move";
      /** The press, on the canvas and in the diagram. */
      screen: Point;
      start: Point;
      /** Set once the pointer moved past SLOP: the placed source the move starts from. */
      base?: {
        picture: Picture;
        outer: string[];
        places: Map<string, Placement>;
        all: Set<string>;
        /** In a diagram with a structure: its source with every part placed where it stands. */
        pinned?: string;
      };
      result?: string;
      target?: string | null;
      /** Lines the moved element is aligned on with others, in the diagram. */
      guides?: Guide[];
      /** The copies a drag with Ctrl makes: selected when it ends. */
      copies?: string[];
    }
  | {
      type: "resize";
      id: string;
      handle: Handle;
      start: Point;
      base: string;
      box: Box;
      /** A leaf's least size, or the box around a container's parts. */
      least: { width: number; height: number } | Box;
      container: boolean;
      /** The boxes of the other elements, which the dragged edges line up with. */
      others: Box[];
      guides?: Guide[];
      result?: string;
    }
  | {
      type: "frame";
      start: Point;
      current: Point;
      kept: Part[];
      /** The container the frame was started in: a press without a drag selects it. */
      inside?: Part;
    }
  | {
      type: "connect";
      from: string;
      current: Point;
      target?: string;
      /** Pressed on a connection dot: where, to tell a click from a drag. */
      dot?: { screen: Point };
      /** In a block diagram: whether the connection may reach an element, by its id, as found. */
      reaches?: Map<string, boolean>;
    }
  /** A shape tool pressed on the canvas: the element is placed where the pointer is released. */
  | { type: "place"; kind: ElementKind; free: boolean; keep: boolean }
  /** An end of a connection dragged to another element. */
  | { type: "attach"; id: string; end: "from" | "to"; current: Point; target?: string }
  /** The far border of a lane of an activity with lanes dragged: the lane gets that width. */
  | {
      type: "lane";
      /** The lane, by its id and its place among the lanes. */
      id: string;
      index: number;
      across: "x" | "y";
      start: Point;
      /** The lane's width when the drag started. */
      width: number;
      /** The source the drag starts from, and the width and source it has come to. */
      base: string;
      now?: number;
      result?: string;
    }
  /** The label of a connection dragged to another place. */
  | {
      type: "label";
      /** The connection, as the selection names it, and the wire of the scene the label is drawn at. */
      id: string;
      wire: string;
      start: Point;
      /** The picture the drag started on, and the box around the label's lines there. */
      picture: Picture;
      box: Box;
      /** Where the label is dragged to, once the pointer moved past SLOP. */
      moved?: Box;
    };

/** A moved element snaps to the edges and middles of others within this many screen pixels. */
export const ALIGN = 8;

/** Whether the pointer went at least SLOP from where it was pressed, on the canvas. */
export const movedPast = (screen: Point, start: Point) =>
  Math.hypot(screen.x - start.x, screen.y - start.y) >= SLOP;

/** The box between two corners. */
export const frameOf = (a: Point, b: Point): Box => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

/** The gesture of a type, with what it holds. */
export type GestureOf<T extends Gesture["type"]> = Extract<Gesture, { type: T }>;

/** Where the pointer is, on the canvas and in the diagram, and the event that says so. */
export type Pointed = { screen: Point; point: Point; event: PointerEvent };

/** Whether a gesture shows a preview of the document, which ends with it. */
export function showsPreview(gesture: Gesture): boolean {
  switch (gesture.type) {
    case "move":
    case "resize":
      return true;
    case "lane":
      return gesture.result !== undefined;
    case "label":
      return !!gesture.moved;
    default:
      return false;
  }
}

/** The far border of a lane: the lane by its id and its place among the lanes, and its width. */
export type LaneBorder = { id: string; index: number; across: "x" | "y"; width: number };

/** The border of a named lane within `reach` of a point of the diagram, along the frame of the lanes. */
export function laneBorderAt(
  lanes: LaneFrame,
  point: Point,
  reach: number,
): LaneBorder | undefined {
  const { across, bounds, ids, frame } = lanes,
    along = across === "x" ? "y" : "x",
    length = across === "x" ? "height" : "width";
  if (point[along] < frame[along] || point[along] > frame[along] + frame[length]) return undefined;
  const index = bounds.findIndex(
    (bound, at) => at > 0 && Math.abs(point[across] - bound) <= reach && ids[at - 1] !== undefined,
  );
  return index > 0
    ? { id: ids[index - 1]!, index: index - 1, across, width: bounds[index] - bounds[index - 1] }
    : undefined;
}

/** The lines a move or a resize under way is aligned on. */
export const guidesOf = (gesture: Gesture | undefined): Guide[] =>
  gesture?.type === "move" || gesture?.type === "resize" ? (gesture.guides ?? []) : [];
