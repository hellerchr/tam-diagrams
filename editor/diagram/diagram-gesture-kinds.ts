// The gestures of the diagram canvas (diagram-gestures.svelte.ts), from the press of the pointer to its release, as
// tam-diagrams' old editor had them (editor/gesture.ts): what each holds while it runs. A press on the canvas starts
// one by what lies under the pointer, in this order: the handles, the ends of the selected connection, the connection
// dots, a lane's border, a connection's label, a part, the empty canvas.
import type { Box, Part, Point, WireLabel } from "./diagram-hit.ts";
import type { MoveBase, ResizeBase } from "./diagram-marks.ts";
import type { Port } from "./diagram-ports.ts";

/** The border of a UML activity's lane, which sizes the lane. */
export type Lane = { index: number; width: number; across: "x" | "y" };

/** A gesture under way. Points are the diagram's, `screen` ones the stage's. */
export type Gesture =
  | { type: "pan"; last: Point }
  | {
      type: "move";
      screen: Point;
      start: Point;
      /** Set once the pointer went past the slop: what the move lines up with. */
      base?: MoveBase;
      /** How far it has come, lined up, and the holder it would drop into (undefined: its own). */
      delta?: Point;
      target?: string | null;
      /** Ctrl held as the move started: copies are dragged, the originals stay. */
      copy?: boolean;
    }
  /** `natural`: the leaf is back at its least size, and gets no size of its own. */
  | { type: "resize"; id: string; start: Point; base: ResizeBase; box?: Box; natural?: boolean }
  /** A band dragged on the empty canvas, or inside an element that holds others (`inside`: a click selects it). */
  | { type: "frame"; start: Point; current: Point; kept: Part[]; inside?: Part; moved: boolean }
  | {
      type: "connect";
      from: string;
      current: Point;
      target?: string;
      /** Pressed on a connection dot: where, on the stage, to tell a click from a drag. */
      dot?: Point;
      /** Whether the connection may reach an element, by its id, as found. */
      reaches: Map<string, boolean>;
      /** The ports its ends take: pressed on one of `from`, let go on one of `target` (diagram-ports.ts). */
      fromPort?: Port;
      port?: Port;
    }
  /** A shape tool pressed on the canvas: the element is placed where the pointer is released. */
  | { type: "place"; kind: string; free: boolean; keep: boolean }
  /** An end of the selected connection dragged to another element; `fixed` is the end that stays, `port` the one of
   *  the target it would take. */
  | {
      type: "attach";
      id: string;
      end: "from" | "to";
      fixed?: Point;
      current: Point;
      target?: string;
      port?: Port;
    }
  | { type: "lane"; lane: Lane; start: Point; moved: boolean }
  /** A connection's label dragged to another place: `moved` is where its box goes. */
  | { type: "label"; id: string; label: WireLabel; start: Point; screen: Point; moved?: Box };

export type GestureOf<T extends Gesture["type"]> = Extract<Gesture, { type: T }>;

/** What a gesture under way is, for the status bar's hint. */
export type Doing = Gesture["type"];
