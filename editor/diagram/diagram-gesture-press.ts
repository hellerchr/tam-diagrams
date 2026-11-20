// What a press on the diagram canvas starts (diagram-gestures.svelte.ts), as tam-diagrams' old editor decided it
// (editor/editor.ts down, pressTool, pressMark, pressPart): the marks the selection shows come first (handles, the
// ends of the selected connection, connection dots, a lane's border, a label), then the part under the pointer, then
// the empty canvas; with the elements a connection being drawn may reach, and the cursor that says what a press does.
import type { Gesture, GestureOf } from "./diagram-gesture-kinds.ts";
import type { Gestures } from "./diagram-gestures.svelte.ts";
import { type Box, inBox, grown, type Part, partAt, type Point, pressed } from "./diagram-hit.ts";
import {
  endNear,
  handleAt,
  HANDLE,
  nearDots,
  onLinkDot,
  type ResizeBase,
  toScreen,
} from "./diagram-marks.ts";
import { portSnap } from "./diagram-ports.ts";
import { lifelineAt } from "./diagram-uml-hits.ts";
import { wordingOf } from "./palettes.ts";

const POINTER_TOOLS = new Set(["select", "pan", "connect"]);

/** Whether a press pans: the middle button, Space held, the hand tool, or a picture edited as text. */
const pans = (g: Gestures, e: PointerEvent) =>
  e.button === 1 || g.host.space() || g.host.tool() === "pan" || !g.host.ed.shown;

/** The one selected element, with its box. */
function single(g: Gestures): { id: string; box: Box } | undefined {
  const { ed } = g.host;
  const [only, ...more] = ed.selection;
  const box = only?.type === "element" && !more.length ? ed.elementBox(only.id) : undefined;
  return box && only && { id: only.id, box };
}

/** The one selected element when its handles show: with the select tool, in a block diagram (its places size it). */
export const handled = (g: Gestures) =>
  g.host.tool() === "select" && g.host.ed.model ? single(g) : undefined;

/** The ends of the one selected connection of a block diagram, where it meets its elements: handles to drag to
 *  another element. None for an interface's line. */
export function wireEnds(g: Gestures): { id: string; end: "from" | "to"; at: Point }[] {
  const { ed } = g.host;
  const [only, ...more] = ed.selection;
  const m = ed.model;
  if (!m || !ed.edits || only?.type !== "wire" || more.length || g.host.tool() !== "select")
    return [];
  const ends = ed.edits.endsOf(m, only.id);
  const points = m.hits.wires
    .filter((w) => w.id.replace(/#\d+$/, "") === only.id)
    .flatMap((w) => w.points);
  return (["from", "to"] as const).flatMap((end) => {
    const box = ends && ed.elementBox(ends[end]);
    const at = box && endNear(points, box);
    return at ? [{ id: only.id, end, at }] : [];
  });
}

/** The elements whose connection dots show: the selected one and the one under the pointer. */
export function linkHosts(g: Gestures): { id: string; box: Box }[] {
  if (g.host.tool() !== "select" || !g.host.ed.shown) return [];
  const one = single(g);
  const box = g.dotted && g.dotted !== one?.id ? g.host.ed.elementBox(g.dotted) : undefined;
  return [...(one ? [one] : []), ...(box && g.dotted ? [{ id: g.dotted, box }] : [])];
}

/** The element whose dots show besides the selected one: the one under the pointer, kept while the pointer is on its
 *  way to its dots. */
export function linkHost(g: Gestures, p: Point): string | undefined {
  if (g.host.tool() !== "select") return undefined;
  const host = g.hover?.type === "element" ? g.hover.id : g.dotted;
  const box = host && g.host.ed.elementBox(host);
  return box && nearDots(box, p, g.view.zoom) ? host : undefined;
}

const endAt = (g: Gestures, screen: Point) =>
  wireEnds(g).find(({ at }) => {
    const on = toScreen(g.view, at);
    return Math.hypot(on.x - screen.x, on.y - screen.y) <= HANDLE;
  });
const dotAt = (g: Gestures, screen: Point) =>
  linkHosts(g).find(({ box }) => onLinkDot(g.view, box, screen));
const laneAt = (g: Gestures, p: Point) =>
  g.host.tool() === "select" ? g.host.ed.umlEd.laneBorder(p, HANDLE / 2 / g.view.zoom) : undefined;

/** The connection whose label lies at `p`, with the label. */
function labelAt(g: Gestures, p: Point) {
  const wire = g.host.ed.shown?.hits.wires.find((w) => w.label && inBox(grown(w.label.box, 2), p));
  return wire?.label && { id: wire.id, label: wire.label };
}

/** What a resize of an element starts from: the boxes its edges line up with, and its least box. */
function resizeBase(g: Gestures, id: string, box: Box, handle: ResizeBase["handle"]): ResizeBase {
  const { ed } = g.host;
  const container = !!ed.model?.hits.elements.some((e) => e.parent === id);
  const least = (ed.model && ed.edits?.leastBox(ed.model, id)) ?? { ...box, width: 24, height: 24 };
  return { box, handle, others: ed.snapTargets(), least, container };
}

/** A press on a mark of the selection: a handle, an end of the selected connection, a connection dot, the border of
 *  a lane, a label. */
function pressMark(g: Gestures, e: PointerEvent, screen: Point, p: Point): Gesture | undefined {
  const one = handled(g);
  const handle = one && handleAt(g.view, one.box, screen);
  if (one && handle)
    return { type: "resize", id: one.id, start: p, base: resizeBase(g, one.id, one.box, handle) };
  const end = endAt(g, screen);
  if (end) {
    const fixed = wireEnds(g).find((other) => other.end !== end.end)?.at;
    return { type: "attach", id: end.id, end: end.end, fixed, current: p };
  }
  const dot = dotAt(g, screen);
  if (dot) return { type: "connect", from: dot.id, current: p, dot: screen, reaches: new Map() };
  const lane = laneAt(g, p);
  if (lane) return { type: "lane", lane, start: p, moved: false };
  const label = e.shiftKey ? undefined : labelAt(g, p);
  if (!label) return undefined;
  const wire: Part = { type: "wire", id: label.id };
  if (!g.host.ed.isSelected(wire)) g.host.ed.selection = [wire];
  return { type: "label", ...label, start: p, screen };
}

/** Whether a press on an element that holds others, below its title and not selected, frames what it holds. */
function framesInside(g: Gestures, e: PointerEvent, p: Point, part: Part): boolean {
  const { ed } = g.host;
  const box = part.type === "element" && ed.model ? ed.elementBox(part.id) : undefined;
  const holds = !!box && ed.model!.hits.elements.some((other) => other.parent === part.id);
  return !!box && holds && !e.shiftKey && !ed.isSelected(part) && p.y > box.y + 36;
}

/** A press on a part selects it (Shift adds it or takes it out) and starts a move of what is selected; on the empty
 *  canvas it starts a frame, which keeps the selection with Shift. */
function pressPart(g: Gestures, e: PointerEvent, screen: Point, p: Point): Gesture | undefined {
  const { ed } = g.host;
  const part = g.partAt(p);
  if (!part) {
    const kept = e.shiftKey ? ed.selection : [];
    ed.selection = kept;
    return { type: "frame", start: p, current: p, kept, moved: false };
  }
  if (framesInside(g, e, p, part))
    return { type: "frame", start: p, current: p, kept: [], inside: part, moved: false };
  ed.selection = pressed(ed.selection, part, e.shiftKey);
  // A sequence diagram's message is moved along its lifelines.
  const moves = part.type === "element" || ed.uml?.kind === "sequence";
  return moves && ed.isSelected(part) ? { type: "move", screen, start: p } : undefined;
}

/** The gesture a press starts; undefined when it starts none. */
export function press(g: Gestures, e: PointerEvent, screen: Point, p: Point): Gesture | undefined {
  if (pans(g, e)) return { type: "pan", last: screen };
  if (e.button !== 0) return undefined;
  const tool = g.host.tool();
  if (tool === "connect") {
    // On a port of a block diagram's element, the connection leaves by it.
    const snap =
      g.host.ed.model && portSnap(g.view, g.host.ed.model.hits.elements, screen, () => true);
    if (snap)
      return {
        type: "connect",
        from: snap.id,
        fromPort: snap.port,
        current: p,
        reaches: new Map(),
      };
    const part = g.partAt(p);
    return part?.type === "element"
      ? { type: "connect", from: part.id, current: p, reaches: new Map() }
      : undefined;
  }
  if (!POINTER_TOOLS.has(tool))
    return { type: "place", kind: tool, free: e.altKey, keep: g.host.sticky() || e.shiftKey };
  return pressMark(g, e, screen, p) ?? pressPart(g, e, screen, p);
}

/** The element under `p` a connection would end at: one under the pointer, or a sequence diagram's lifeline. */
export function elementUnder(g: Gestures, p: Point): string | undefined {
  const shown = g.host.ed.shown;
  const part = shown && partAt(shown.hits, p, 0);
  if (part?.type === "element") return part.id;
  return shown && g.host.ed.uml?.kind === "sequence" ? lifelineAt(shown.hits, p) : undefined;
}

/** Whether a connection drawn from an element may reach another; each answer is kept for the gesture. */
function reaches(g: Gestures, gesture: GestureOf<"connect">, to: string): boolean {
  const { ed } = g.host;
  let fits = gesture.reaches.get(to);
  if (fits === undefined && ed.model && ed.edits) {
    fits =
      ed.edits.connectRefusal(
        ed.model,
        gesture.from,
        to,
        ed.link ? wordingOf(ed.link) : undefined,
      ) === undefined;
    gesture.reaches.set(to, fits);
  }
  return !!fits;
}

/** Whether a connection being drawn, or an end of one being dragged, may end at an element. A part of a UML diagram
 *  may join itself (a self message, a transition back to its state). */
function mayEnd(
  g: Gestures,
  gesture: GestureOf<"connect"> | GestureOf<"attach">,
  to: string,
): boolean {
  const { ed } = g.host;
  if (gesture.type === "attach")
    return (
      !!ed.model &&
      ed.edits?.reattachRefusal(ed.model, gesture.id, { end: gesture.end, to }) === undefined
    );
  if (ed.uml) return true;
  return to !== gesture.from && reaches(g, gesture, to);
}

/** A connection being drawn, or an end of one being dragged, follows the pointer: it reaches the element under it
 *  that it may end at, and on a block diagram's element the port the pointer is on (diagram-ports.ts). */
export function followEnd<T extends GestureOf<"connect"> | GestureOf<"attach">>(
  g: Gestures,
  gesture: T,
  screen: Point,
  p: Point,
): T {
  const elements = g.host.ed.model?.hits.elements;
  const snap = elements && portSnap(g.view, elements, screen, (id) => mayEnd(g, gesture, id));
  if (snap) return { ...gesture, current: p, target: snap.id, port: snap.port };
  const to = elementUnder(g, p);
  return {
    ...gesture,
    current: p,
    target: to && mayEnd(g, gesture, to) ? to : undefined,
    port: undefined,
  };
}

/** The cursor over a point of the stage, in the order a press takes what lies there. */
export function cursorAt(g: Gestures, screen: Point): string {
  const { host } = g;
  const tool = host.tool();
  if (g.gesture?.type === "pan") return "grabbing";
  if (host.space() || tool === "pan" || !host.ed.shown) return "grab";
  if (tool !== "select") return "crosshair";
  const mark = markCursor(g, screen);
  if (mark) return mark;
  if (!g.hover) return "default";
  return g.hover.type === "element" ? "move" : "pointer";
}

/** The cursor over a mark of the selection at a point of the stage: a handle, an end, a dot, a lane's border, a label. */
function markCursor(g: Gestures, screen: Point): string | undefined {
  const one = handled(g);
  const handle = one && handleAt(g.view, one.box, screen);
  if (handle) return handle.cursor;
  if (endAt(g, screen) || dotAt(g, screen)) return "crosshair";
  const p = g.toDiagram(screen);
  const lane = laneAt(g, p);
  if (lane) return lane.across === "x" ? "col-resize" : "row-resize";
  return labelAt(g, p) ? "move" : undefined;
}
