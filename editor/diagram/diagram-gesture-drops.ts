// How the diagram canvas's drags follow the pointer and end (diagram-gestures.svelte.ts), as tam-diagrams' old editor
// had them: a move lines up with the other elements or the grid and shows what it would drop into, a resize snaps its
// dragged edges, a label keeps its distance to its line, a lane's border sizes the lane; each previews the source it
// would make, written when the pointer is let go. A connection ends on what it may reach, or at a new element on the
// empty canvas; refused, the notation's reason shows.
import { toast } from "../lib/overlays.svelte.ts";
import { around } from "./diagram-arrange.ts";
import type { Gesture, GestureOf, Lane } from "./diagram-gesture-kinds.ts";
import { elementUnder } from "./diagram-gesture-press.ts";
import type { Gestures } from "./diagram-gestures.svelte.ts";
import { drawnAt, middle, partAt, type Point, shift } from "./diagram-hit.ts";
import {
  ALIGN,
  alongOneAxis,
  awayFrom,
  dropPlace,
  GRID,
  type MoveBase,
  moveStep,
  movedPast,
  resized,
} from "./diagram-marks.ts";
import type { Port } from "./diagram-ports.ts";
import { wordingOf } from "./palettes.ts";

/** Whether a drag lines up with nothing: Alt held, or Snap off. */
const free = (g: Gestures, e: { altKey: boolean }) => e.altKey || !g.host.layout.snap;

/** Shows the picture of a source a drag would make. */
function preview(g: Gestures, source: string | undefined) {
  if (source) g.host.pictures.previewSource(source, g.host.lang());
}

/** What a move of the selection lines up with: its boxes, the first one's corner, the others. */
function moveBase(g: Gestures): MoveBase {
  const { ed } = g.host;
  const moving = ed.movingBoxes();
  if (!moving.length)
    return { moving: { x: 0, y: 0, width: 0, height: 0 }, lead: { x: 0, y: 0 }, others: [] };
  return {
    moving: around(moving),
    lead: { x: moving[0]!.x, y: moving[0]!.y },
    others: ed.snapTargets(),
  };
}

/** The holder the selection moved by `delta` would drop into, when another than its own (null: the diagram). */
function dropInto(g: Gestures, delta: Point): string | null | undefined {
  const { ed } = g.host;
  const ids = ed.selectedIds();
  if (!ids.length) return undefined;
  if (ed.model && ed.edits) return ed.edits.dropHolder(ed.model, ids, delta);
  const uml = ed.umlEd;
  return uml.model && uml.edits?.can(uml.model, "moveInto")
    ? uml.edits.dropHolder(uml.model, ids, delta)
    : undefined;
}

/** A move follows the pointer once it went past the slop; Shift keeps it to one axis. */
export function followMove(
  g: Gestures,
  gesture: GestureOf<"move">,
  screen: Point,
  e: PointerEvent,
) {
  if (!gesture.base && !movedPast(screen, gesture.screen)) return undefined;
  const p = g.toDiagram(screen);
  const base = gesture.base ?? moveBase(g);
  const { ed } = g.host;
  const raw = alongOneAxis({ x: p.x - gesture.start.x, y: p.y - gesture.start.y }, e.shiftKey);
  // A sequence diagram's participants move along their row.
  if (ed.uml?.kind === "sequence" && ed.selectedIds().length) raw.y = 0;
  const step = moveStep(base, raw, ALIGN / g.view.zoom, free(g, e));
  g.guides = step.guides;
  const copy = gesture.base ? gesture.copy : !!ed.model && (e.ctrlKey || e.metaKey);
  preview(g, copy ? copySource(g, step.delta) : ed.drafted(step.delta));
  return {
    ...gesture,
    base,
    copy,
    delta: step.delta,
    target: copy ? undefined : dropInto(g, step.delta),
  };
}

/** The source with copies of the selected elements `delta` from them. */
function copySource(g: Gestures, delta: Point): string | undefined {
  const { model, edits } = g.host.ed;
  const made =
    model && edits?.attempt(() => edits.copiedBy(model, g.host.ed.selectedIds(), delta).source);
  return made && "source" in made ? made.source : undefined;
}

/** Ends a move: the selection stands where it was dropped; dragged with Ctrl, its copies do, and are selected. */
function dropMove(g: Gestures, { delta, copy }: GestureOf<"move">): boolean {
  const { ed } = g.host;
  if (!delta || (!delta.x && !delta.y)) return false;
  if (!copy) return ed.drop(delta);
  let ids: string[] = [];
  const chosen = ed.selectedIds();
  const done = ed.apply((m, edits) => {
    const made = edits.copiedBy(m, chosen, delta);
    ids = made.ids;
    return made.source;
  });
  if (done) ed.selection = ids.map((id) => ({ type: "element", id }));
  return done;
}

/** A resize follows the pointer: the dragged edges snap, the element keeps its least size. */
export function followResize(g: Gestures, gesture: GestureOf<"resize">, p: Point, e: PointerEvent) {
  const delta = { x: p.x - gesture.start.x, y: p.y - gesture.start.y };
  const sized = resized(gesture.base, delta, ALIGN / g.view.zoom, free(g, e));
  g.guides = sized.guides;
  const { model, edits } = g.host.ed;
  const made =
    model && edits?.attempt(() => edits.resized(model, gesture.id, sized.box, sized.natural));
  preview(g, made && "source" in made ? made.source : undefined);
  return { ...gesture, box: sized.box, natural: sized.natural };
}

/** The width a dragged border gives its lane. */
const laneWidth = (lane: Lane, from: Point, p: Point) =>
  Math.max(1, Math.round(lane.width + p[lane.across] - from[lane.across]));

export function followLane(g: Gestures, gesture: GestureOf<"lane">, p: Point) {
  preview(
    g,
    g.host.ed.umlEd.laneSized(gesture.lane.index, laneWidth(gesture.lane, gesture.start, p), false),
  );
  return { ...gesture, moved: true };
}

/** The source with a label's middle `offset` from the middle of its line. */
function labelSource(g: Gestures, gesture: GestureOf<"label">, offset: Point): string | undefined {
  const { ed } = g.host;
  if (ed.model && ed.edits) return ed.edits.labelMoved(ed.model, gesture.id, offset);
  const uml = ed.umlEd;
  return uml.model && uml.edits?.labelMoved(uml.model, gesture.label.key, offset);
}

/** The offset of a label's middle from the middle of its line, at the box it was dragged to. */
const labelOffset = (gesture: GestureOf<"label">) => {
  const at = middle(gesture.moved!);
  return {
    x: Math.round(at.x - gesture.label.middle.x),
    y: Math.round(at.y - gesture.label.middle.y),
  };
};

/** A label follows the pointer once it went past the slop. */
export function followLabel(g: Gestures, gesture: GestureOf<"label">, screen: Point, p: Point) {
  if (!gesture.moved && !movedPast(screen, gesture.screen)) return undefined;
  const moved = shift(gesture.label.box, {
    x: Math.round(p.x - gesture.start.x),
    y: Math.round(p.y - gesture.start.y),
  });
  const next = { ...gesture, moved };
  preview(g, labelSource(g, next, labelOffset(next)));
  return next;
}

/** A connection dropped on the empty canvas ends at a new element there: a block diagram's when it is well away from
 *  its element, a UML diagram's first kind of piece. */
function connectNew(g: Gestures, from: string, at: Point) {
  const { ed } = g.host;
  const shown = ed.shown;
  if (!shown || partAt(shown.hits, at, 0)) return;
  if (ed.uml) return connectNewPart(g, from, at);
  const start = ed.elementBox(from);
  if (!start || awayFrom(start, at) < 3 * GRID) return;
  let id = "";
  const done = ed.apply((m, edits) => {
    const made = edits.connectedNew(
      m,
      from,
      dropPlace("agent", at, false),
      ed.link ? wordingOf(ed.link) : undefined,
    );
    id = made.id;
    return made.source;
  });
  if (!done) return;
  g.host.select();
  ed.selection = [{ type: "element", id }];
  g.host.placed(id);
}

/** A UML connection dropped on nothing ends at a new piece of the type's first kind, joined from its part; its name
 *  opens. Only where nothing else is drawn: a note or a frame is no place for it. */
function connectNewPart(g: Gestures, from: string, at: Point) {
  const ued = g.host.ed.umlEd;
  const kind = ued.palette?.shapes[0]?.kind;
  const scene = ued.model?.scene;
  if (!kind || !scene || drawnAt(scene, at)) return;
  let id = "";
  const done = ued.apply((m, edits) => {
    const made = edits.addedJoined(m, kind, { from, at, link: ued.link });
    id = made.id;
    return made.source;
  });
  if (!done) return;
  g.host.select();
  g.host.ed.selection = [{ type: "element", id }];
  g.host.placed(id);
}

/** Ends the drawing of a connection: to what it reaches, or a new element on the empty canvas; a click on a dot only
 *  selects its element, so a slip adds nothing. */
function dropConnection(g: Gestures, gesture: GestureOf<"connect">, screen: Point) {
  const { ed } = g.host;
  if (gesture.dot && !movedPast(screen, gesture.dot))
    return void (ed.selection = [{ type: "element", id: gesture.from }]);
  if (gesture.target) {
    const ports = new Map([
      [gesture.from, gesture.fromPort],
      [gesture.target, gesture.port],
    ]);
    ed.connect(
      gesture.from,
      gesture.target,
      new Map([...ports].filter((entry): entry is [string, Port] => !!entry[1])),
    );
    return g.host.select();
  }
  const to = ed.uml ? undefined : elementUnder(g, gesture.current);
  const why =
    to && to !== gesture.from && ed.model && ed.edits
      ? ed.edits.connectRefusal(
          ed.model,
          gesture.from,
          to,
          ed.link ? wordingOf(ed.link) : undefined,
        )
      : undefined;
  if (why) toast(why, "error");
  else if (!to) connectNew(g, gesture.from, gesture.current);
}

/** Ends a drag of an end of a connection: on an element it may end at, it ends there, at the port it was let go on (else
 *  where the layout chooses); elsewhere the reason shows. */
function dropEnd(g: Gestures, gesture: GestureOf<"attach">) {
  const { ed } = g.host;
  const { id, end, target, port } = gesture;
  if (target) return ed.apply((m, edits) => edits.reattached(m, id, { end, to: target, port }));
  const to = elementUnder(g, gesture.current);
  const why = to && ed.model && ed.edits?.reattachRefusal(ed.model, id, { end, to });
  if (why) toast(why, "error");
  return false;
}

/** Ends a drag of a label: it stands where it was let go. */
function dropLabel(g: Gestures, gesture: GestureOf<"label">): boolean {
  if (!gesture.moved) return false;
  const { ed } = g.host;
  const offset = labelOffset(gesture);
  if (ed.model) return ed.apply((m, edits) => edits.labelMoved(m, gesture.id, offset));
  return ed.applyUml((m, edits) => edits.labelMoved(m, gesture.label.key, offset));
}

/** How each gesture ends when the pointer is let go at `p`: true when it made an edit (its preview stays until its
 *  picture shows). */
const FINISH: {
  [T in Gesture["type"]]: (
    g: Gestures,
    gesture: GestureOf<T>,
    p: Point,
    e: PointerEvent,
  ) => boolean;
} = {
  move: (g, gesture) => dropMove(g, gesture),
  resize: (g, { box, id, natural }) =>
    !!box && g.host.ed.apply((m, edits) => edits.resized(m, id, box, natural)),
  frame: (g, { inside, moved }) => {
    // A press inside a container that framed nothing selects the container.
    if (inside && !moved) g.host.ed.selection = [inside];
    return false;
  },
  connect: (g, gesture, p, e) => {
    dropConnection(g, { ...gesture, current: p }, g.screenOf(e));
    return false;
  },
  attach: (g, gesture, p) => dropEnd(g, { ...gesture, current: p }),
  place: (g, gesture, p) => {
    g.host.ghost();
    g.host.create(gesture.kind, p, gesture.free, gesture.keep);
    return false;
  },
  lane: (g, { moved, lane, start }, p) =>
    moved && !!g.host.ed.umlEd.laneSized(lane.index, laneWidth(lane, start, p), true),
  label: (g, gesture) => dropLabel(g, gesture),
  pan: () => false,
};

/** Ends a gesture with its edit; true when one was made. */
export const finish = (g: Gestures, gesture: Gesture, p: Point, e: PointerEvent): boolean =>
  (FINISH[gesture.type] as (g: Gestures, gesture: Gesture, p: Point, e: PointerEvent) => boolean)(
    g,
    gesture,
    p,
    e,
  );
