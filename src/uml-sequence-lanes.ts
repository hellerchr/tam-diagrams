/** Sequence diagram lanes: participant headers and the lane positions solved from what messages and frames need. */

import type { Box, Point, Scene } from "./scene.ts";
import type { SequenceDiagram } from "./uml-sequence.ts";
import { addText, FONT, LINE, type Measure, SMALL, wrap } from "./text.ts";
import { smallSize } from "./labels.ts";
import { frameBoxes, type LaneFrame } from "./lane-frames.ts";

export const GAP = 30,
  BAR = 10,
  NEST = 5,
  SELF = 32,
  MARGIN = 14;

/** Where each participant's lane sits and how much room its headers, titles and guards need. */
interface SequenceLanes {
  frameX: Map<string, Box>;
  guardRoom: Map<string, number>;
  head: (id: string) => { width: number; height: number };
  headers: Map<string, LaneHeader>;
  ids: string[];
  labelOf: (text: string) => { width: number; height: number };
  titleRoom: (label: string) => number;
  x: (id: string) => number;
  xs: number[];
}

/** Sizes every participant's header and solves the lane positions from what each message and frame needs. */
export function sequenceLanes(
  diagram: SequenceDiagram,
  measure: Measure,
  places: ReadonlyMap<string, Point> = new Map(),
): SequenceLanes {
  const declared = [...diagram.participants.keys()];
  const headers = new Map<string, LaneHeader>(
    declared.map((id) => {
      const item = diagram.participants.get(id)!;
      return [
        id,
        { lines: wrap(item.label, 160, FONT, 400, measure), kind: item.actor ? "figure" : "box" },
      ];
    }),
  );
  const head = (id: string) => headerSize(headers.get(id)!, measure);
  /** The left edge the source places a participant's head at: its lane stands that far right. */
  const placedAt = (id: string) => places.get(`head:${id}`)?.x;
  const ids = laneOrder(diagram, declared, head, placedAt);
  const sizing: Sizing = {
    diagram,
    measure,
    ids,
    index: new Map(ids.map((id, i) => [id, i])),
    head,
    labelOf: (text: string) => (text ? smallSize(text, measure) : { width: 0, height: 0 }),
    // Columns: wide enough for the heads, the labels of the messages between them and the notes beside them.
    extents: ids.map((id) => ({ left: head(id).width / 2, right: head(id).width / 2 })),
    demands: [],
  };
  for (const event of diagram.events) {
    if (event.type === "message") messageDemand(sizing, event);
    if (event.type === "note") noteDemand(sizing, event);
  }
  // A box around participants is as wide as its title.
  const titleRoom = (label: string) => (label ? measure(label, FONT, 600) + 24 : 0);
  diagram.boxes.forEach((group, number) => groupDemand(sizing, titleRoom(group.label), number));
  barDemands(sizing);
  const guardRoom = fragmentDemands(sizing);
  const xs = laneCenters(sizing, placedAt);
  const x = (id: string) => xs[sizing.index.get(id)!];
  const frameX = frameExtents(sizing, guardRoom, x, xs[0] ?? 0);
  return { frameX, guardRoom, head, headers, ids, labelOf: sizing.labelOf, titleRoom, x, xs };
}

/** What sizing the lanes works with: the lanes in order, their headers and labels, and what their content asks of them. */
interface Sizing {
  diagram: SequenceDiagram;
  measure: Measure;
  ids: string[];
  index: Map<string, number>;
  head: (id: string) => { width: number; height: number };
  labelOf: (text: string) => { width: number; height: number };
  extents: LaneExtent[];
  demands: SpanDemand[];
}

type SequenceEvent = SequenceDiagram["events"][number];
type MessageEvent = SequenceEvent & { type: "message" };

/** The lanes in the order of the source, or of the places it gives their heads (`placedOrder`). */
function laneOrder(
  diagram: SequenceDiagram,
  declared: string[],
  head: (id: string) => { width: number },
  placedAt: (id: string) => number | undefined,
) {
  if (!declared.some((id) => placedAt(id) !== undefined)) return declared;
  return placedOrder(
    declared,
    (id) => diagram.participants.get(id)!.box ?? undefined,
    (id) => {
      const left = placedAt(id);
      return left === undefined ? undefined : left + head(id).width / 2;
    },
  );
}

/** Content `width` wide beside a lane: room up to the neighbour on that side, or on the lane itself at the edge. */
function beyond(sizing: Sizing, lane: number, side: "left" | "right", width: number) {
  const neighbour = side === "right" ? lane + 1 : lane - 1;
  if (neighbour >= 0 && neighbour < sizing.ids.length)
    sizing.demands.push({ from: lane, to: neighbour, width });
  else sizing.extents[lane][side] = Math.max(sizing.extents[lane][side], width);
}

/** A lane's content reaches `half` to both sides of its center line. */
function widen(extent: LaneExtent, half: number) {
  extent.left = Math.max(extent.left, half);
  extent.right = Math.max(extent.right, half);
}

/** A message between two lanes keeps them apart by its label, its bars and its badge. */
function messageDemand(sizing: Sizing, event: MessageEvent) {
  const a = sizing.index.get(event.from)!,
    b = sizing.index.get(event.to)!,
    label = sizing.labelOf(event.text),
    badge = event.number !== undefined ? BADGE_ROOM + 10 + (event.tail ? 10 : 0) : 0;
  if (a !== b) sizing.demands.push({ from: a, to: b, width: label.width + 2 * BAR + 30 + badge });
}

/** A note beside a lane, over two lanes, or over one. */
function noteDemand(sizing: Sizing, event: SequenceEvent & { type: "note" }) {
  const width = sizing.labelOf(event.text).width + 22,
    a = sizing.index.get(event.who[0])!;
  if (event.placement !== "over") beyond(sizing, a, event.placement, width + 34);
  else if (event.who.length === 2)
    sizing.demands.push({ from: a, to: sizing.index.get(event.who[1])!, width: width - 30 });
  else widen(sizing.extents[a], width / 2 + MARGIN);
}

/** A box around participants as wide as its title, `room`. */
function groupDemand(sizing: Sizing, room: number, number: number) {
  const { diagram, ids, index, head } = sizing;
  const members = ids
    .filter((id) => diagram.participants.get(id)!.box === number)
    .map((id) => index.get(id)!);
  if (!members.length || !room) return;
  const first = Math.min(...members),
    last = Math.max(...members);
  if (first === last) widen(sizing.extents[first], room / 2);
  else
    sizing.demands.push({
      from: first,
      to: last,
      width: room - head(ids[first]).width / 2 - head(ids[last]).width / 2 - 20,
    });
}

/** How many bars are open on each lifeline. */
type Nesting = Map<string, number>;

/** Opens (`by` 1) or closes (`by` -1) a bar on a lifeline. */
const nest = (nesting: Nesting, who: string, by: number) =>
  nesting.set(who, Math.max(0, (nesting.get(who) ?? 0) + by));

/** Follows the bars a message opens and closes. */
function nestMessage(nesting: Nesting, event: MessageEvent) {
  if (event.activate) nest(nesting, event.to, 1);
  if (event.deactivate) nest(nesting, event.from, -1);
}

/**
 * A message label stands between activation bars of the lifelines it passes: the widest stretch
 * between two of them (or the message's ends) is made wide enough for it. A self message's loop
 * and label stand right of its bars, clear of the next lifeline's bars.
 */
function barDemands(sizing: Sizing) {
  const nesting: Nesting = new Map();
  for (const event of sizing.diagram.events) {
    if (event.type === "activate") nest(nesting, event.who, 1);
    else if (event.type === "deactivate") nest(nesting, event.who, -1);
    else if (event.type === "message") {
      if (event.from === event.to) selfDemand(sizing, nesting, event);
      acrossBars(sizing, nesting, event);
      nestMessage(nesting, event);
    }
  }
}

/** A self message's loop and label stand right of its bars. */
function selfDemand(sizing: Sizing, nesting: Nesting, event: MessageEvent) {
  beyond(
    sizing,
    sizing.index.get(event.from)!,
    "right",
    (nesting.get(event.from) ?? 0) * NEST +
      SELF +
      sizing.labelOf(event.text).width +
      30 +
      (event.number !== undefined ? BADGE_ROOM + 10 : 0) +
      BAR / 2 +
      2 * NEST,
  );
}

/** The widest stretch between the bars a message's label passes is wide enough for the label. */
function acrossBars(sizing: Sizing, nesting: Nesting, event: MessageEvent) {
  const a = sizing.index.get(event.from)!,
    b = sizing.index.get(event.to)!,
    low = Math.min(a, b),
    high = Math.max(a, b);
  const barred = sizing.ids
    .slice(low + 1, high)
    .map((id, k) => ((nesting.get(id) ?? 0) > 0 ? low + 1 + k : -1))
    .filter((lane) => lane >= 0);
  if (!event.text || !barred.length) return;
  const stops = [low, ...barred, high];
  const [p, q] = stops
    .slice(1)
    .map((lane, k) => [stops[k], lane])
    .toSorted((u, v) => v[1] - v[0] - (u[1] - u[0]))[0];
  const margin = (lane: number) =>
    (lane === low || lane === high ? BAR / 2 + 2 * NEST : BAR / 2 + 2 * NEST + 4) +
    (lane === a ? badgeRoom(event) : 0);
  sizing.demands.push({
    from: p,
    to: q,
    width: sizing.labelOf(event.text).width + 8 + margin(p) + margin(q),
  });
}

/** The room a message's badge takes beside its sender's lifeline. */
const badgeRoom = (event: MessageEvent) =>
  event.number !== undefined ? BADGE_ROOM + (event.tail ? 10 : 0) : 0;

/** A fragment as sizing sees it: the lanes it involves, the widths of its conditions, the fragment around it. */
interface Fragment {
  id: string;
  kind: string;
  lanes: Set<number>;
  widths: number[];
  parent?: Fragment;
}

/** The lifelines an event takes part in. */
function involved(event: SequenceEvent): string[] {
  if (event.type === "message") return [event.from, event.to];
  if (event.type === "note") return event.who;
  return event.type === "activate" || event.type === "deactivate" ? [event.who] : [];
}

/** The width of a condition: its words wrapped at 200px, never wider than on one line. */
function guardWidth(measure: Measure, text: string) {
  const label = `[${text}]`,
    full = measure(label, SMALL, 400);
  return Math.min(
    full,
    Math.max(200, ...label.split(/\s+/).map((word) => measure(word, SMALL, 400))),
  );
}

/** A fragment that starts, with the width of its first condition. */
const fragmentOf = (
  measure: Measure,
  event: SequenceEvent & { type: "start" },
  parent: Fragment | undefined,
): Fragment => ({
  id: event.id,
  kind: event.kind,
  lanes: new Set<number>(),
  widths: event.kind !== "rect" && event.text ? [guardWidth(measure, event.text)] : [],
  parent,
});

/** The fragments of a diagram, each with the lanes it involves and the widths of its conditions. */
function fragmentsOf(sizing: Sizing): Fragment[] {
  const stack: Fragment[] = [],
    frames: Fragment[] = [];
  for (const event of sizing.diagram.events) {
    if (event.type === "start") {
      const frame = fragmentOf(sizing.measure, event, stack.at(-1));
      stack.push(frame);
      frames.push(frame);
    } else if (event.type === "else") {
      if (event.text) stack.at(-1)?.widths.push(guardWidth(sizing.measure, event.text));
    } else if (event.type === "end") stack.pop();
    else
      for (const id of involved(event))
        stack.forEach((frame) => frame.lanes.add(sizing.index.get(id)!));
  }
  return frames;
}

/**
 * A fragment's conditions stand right of the lifeline of its first participant: the stretch up
 * to the next lifeline is made wide enough (or, for a fragment around one lifeline, the fragment
 * itself). Returns the room those around one lifeline keep right of it.
 */
function fragmentDemands(sizing: Sizing): Map<string, number> {
  const guardRoom = new Map<string, number>();
  const frames = fragmentsOf(sizing);
  for (const frame of frames) {
    if (!frame.lanes.size || !frame.widths.length) continue;
    const lo = Math.min(...frame.lanes),
      need = 6 + BAR / 2 + 2 * NEST + Math.max(...frame.widths) + 8;
    if (lo + 1 < sizing.ids.length) sizing.demands.push({ from: lo, to: lo + 1, width: need + 6 });
    else sizing.extents[lo].right = Math.max(sizing.extents[lo].right, need);
    if (frame.lanes.size === 1) guardRoom.set(frame.id, need - (BAR + 10 + 8));
  }
  tabDemands(sizing, frames);
  return guardRoom;
}

/**
 * A frame reaches left of its first lifeline by its keyword tab (as frameBoxes draws it), and 8
 * more around each frame inside it that starts there: the stretch from the lifeline before is
 * made wide enough that the tab clears that lifeline's activation bars.
 */
function tabDemands(sizing: Sizing, frames: Fragment[]) {
  const lowest = (frame: Fragment) => (frame.lanes.size ? Math.min(...frame.lanes) : -1);
  const reach = (frame: Fragment): number =>
    Math.max(
      BAR + 18,
      (frame.kind === "rect" ? 0 : sizing.measure(frame.kind, SMALL, 600) + 20) + BAR + 2,
      ...frames
        .filter((child) => child.parent === frame && lowest(child) === lowest(frame))
        .map((child) => reach(child) + 8),
    );
  for (const frame of frames) {
    const lo = lowest(frame);
    if (lo > 0)
      sizing.demands.push({ from: lo - 1, to: lo, width: reach(frame) + BAR / 2 + 2 * NEST + 6 });
  }
}

/** The lanes' center lines: solved from what their content needs, then moved to where the source places them. */
function laneCenters(sizing: Sizing, placedAt: (id: string) => number | undefined) {
  const { extents, demands, ids, head } = sizing;
  // Frames need room for their keyword tab left of the first column.
  const framed = sizing.diagram.events.some((event) => event.type === "start");
  const { centers } = solveLanes(extents, demands, {
    gap: GAP,
    start: 0,
    margin: MARGIN + (framed ? 48 : 12),
  });
  // A place that is the rounded automatic position means that position.
  const wanted = ids.map((id, lane) => {
    const left = placedAt(id);
    if (left === undefined) return undefined;
    return Math.round(centers[lane] - head(id).width / 2) === left
      ? centers[lane]
      : left + head(id).width / 2;
  });
  return wanted.some((center) => center !== undefined)
    ? placedLanes(extents, demands, GAP, centers[0], wanted)
    : centers;
}

/** A frame as its horizontal extent is found: the lifelines it involves and the frame around it. */
type Extent = LaneFrame & { who: Set<string>; parent?: LaneFrame };

/** The frames still open, the bars open on each lifeline, and the room the frames need right of their lifelines. */
interface FrameWalk {
  sizing: Sizing;
  stack: Extent[];
  nesting: Nesting;
}

/** The open frames reach `amount` right of their rightmost lifeline. */
function reachRight(walk: FrameWalk, amount: number) {
  walk.stack.forEach((frame) => {
    frame.extra = Math.max(frame.extra, amount);
  });
}

/**
 * What an event inside the open frames asks of them: its lifelines (a bar that closes takes no
 * part), and room for a note or a self message right of them.
 */
function frameContent(walk: FrameWalk, event: SequenceEvent) {
  const { stack, nesting, sizing } = walk;
  if (event.type === "deactivate") {
    nest(nesting, event.who, -1);
    return;
  }
  for (const id of involved(event)) stack.forEach((frame) => frame.who.add(id));
  if (event.type === "activate") nest(nesting, event.who, 1);
  else if (event.type === "note" && event.placement === "right")
    reachRight(walk, sizing.labelOf(event.text).width + 20 + 16 + BAR);
  else if (event.type === "message") frameMessage(walk, event);
}

/** A message inside the open frames: the bars it opens and closes, and room for a self message's loop and label. */
function frameMessage(walk: FrameWalk, event: MessageEvent) {
  const { nesting, sizing } = walk;
  if (event.activate) nest(nesting, event.to, 1);
  if (event.from === event.to)
    reachRight(
      walk,
      (nesting.get(event.from) ?? 0) * NEST + SELF + sizing.labelOf(event.text).width + 12,
    );
  if (event.deactivate) nest(nesting, event.from, -1);
}

/**
 * Frames' horizontal extent depends only on what happens inside them: found first, so their
 * conditions can be placed clear of the lifelines and bars in their header rows.
 */
function frameExtents(
  sizing: Sizing,
  guardRoom: Map<string, number>,
  x: (id: string) => number,
  fallback: number,
): Map<string, Box> {
  const walk: FrameWalk = { sizing, stack: [], nesting: new Map() },
    all: Extent[] = [];
  for (const event of sizing.diagram.events) {
    if (event.type === "start") {
      const frame: Extent = {
        id: event.id,
        kind: event.kind,
        text: event.text,
        top: 0,
        bottom: 1,
        members: [],
        extra: guardRoom.get(event.id) ?? 0,
        branches: [],
        children: [],
        depth: walk.stack.length,
        who: new Set<string>(),
        parent: walk.stack.at(-1),
      };
      walk.stack.at(-1)?.children.push(frame);
      all.push(frame);
      walk.stack.push(frame);
    } else if (event.type === "end") walk.stack.pop();
    else frameContent(walk, event);
  }
  for (const frame of all) frame.members = [...frame.who].map(x);
  return new Map(
    frameBoxes(
      all.filter((frame) => !frame.parent),
      sizing.measure,
      { reach: BAR + 10, fallback },
    ),
  );
}

/** A sequence number badge: its radius, its gap to the bar or lifeline it leaves, and the room it takes on the message. */
export const BADGE = 9,
  BADGE_GAP = 4,
  BADGE_ROOM = BADGE_GAP + 2 * BADGE;

/**
 * Lane layouts: diagrams with one column per agent and progress down the columns, as swimlane
 * activity diagrams (one lane per agent) and sequence diagrams (one lifeline per agent) are. This
 * module holds what they share: column sizing from their content and the connections between
 * them, lane headers, label placement beside connections, frames spanning columns, and notes
 * beside or over columns. The type-specific parts (activations, bars, decisions) live with the
 * diagram types (swimlanes in uml-activity.ts, and sequence diagrams).
 */

/** How far a column's content reaches left and right of its center line. */
interface LaneExtent {
  left: number;
  right: number;
}

/** Two columns' center lines must be at least `width` apart (a label between them, a note beside one). */
interface SpanDemand {
  from: number;
  to: number;
  width: number;
}

/**
 * Column center lines: neighbours keep `gap` between their content, and every span demand is met
 * by widening the gaps it spans evenly. `bounds` are the lane borders, halfway between neighbours'
 * content, with `margin` outside the first and last column.
 */
function solveLanes(
  extents: LaneExtent[],
  demands: SpanDemand[],
  options: { gap: number; start: number; margin?: number },
): { centers: number[]; bounds: number[] } {
  const gaps = extents.slice(1).map((extent, k) => extents[k].right + options.gap + extent.left);
  // Widest spans last, so the narrow ones they contain are settled first.
  for (const { from, to, width } of demands.toSorted(
    (a, b) => Math.abs(a.to - a.from) - Math.abs(b.to - b.from),
  )) {
    const [a, b] = from < to ? [from, to] : [to, from];
    if (a === b) continue;
    const have = gaps.slice(a, b).reduce((sum, gap) => sum + gap, 0);
    if (have < width) for (let k = a; k < b; k++) gaps[k] += (width - have) / (b - a);
  }
  const margin = options.margin ?? options.gap / 2;
  const centers: number[] = [];
  extents.forEach((extent, k) => {
    centers[k] = k ? centers[k - 1] + gaps[k - 1] : options.start + margin + extent.left;
  });
  const bounds = [
    options.start,
    ...extents.slice(1).map((extent, k) => {
      const free = gaps[k] - extents[k].right - extent.left;
      return centers[k] + extents[k].right + free / 2;
    }),
    (centers.at(-1) ?? options.start) + (extents.at(-1)?.right ?? 0) + margin,
  ];
  return { centers, bounds };
}

/**
 * Column center lines where the source places some: each lane at its wanted center, or as near
 * to the lane before it as the content of both and every span demand allow, and never nearer. A
 * first lane without a place starts at `start`.
 */
function placedLanes(
  extents: LaneExtent[],
  demands: SpanDemand[],
  gap: number,
  start: number,
  wanted: (number | undefined)[],
): number[] {
  const centers: number[] = [];
  extents.forEach((extent, k) => {
    const least = Math.max(
      k ? centers[k - 1] + extents[k - 1].right + gap + extent.left : -Infinity,
      ...demands
        .filter(({ from, to }) => from !== to && Math.max(from, to) === k)
        .map(({ from, to, width }) => centers[Math.min(from, to)] + width),
    );
    const center = Math.max(least, wanted[k] ?? -Infinity);
    centers[k] = Number.isFinite(center) ? center : start;
  });
  return centers;
}

/**
 * The order of the lanes where the source places some: by their wanted centers, a lane without a
 * place after the lane it follows in the source, and the lanes of one group side by side where
 * the first of them stands.
 */
function placedOrder(
  ids: string[],
  groupOf: (id: string) => number | undefined,
  wanted: (id: string) => number | undefined,
): string[] {
  /** Sorted by their wanted centers; one without follows the one before it. */
  const sorted = <T>(items: T[], at: (item: T) => number | undefined): T[] => {
    let last = -Infinity;
    return items
      .map((item, index) => ({ item, index, key: (last = at(item) ?? last) }))
      .toSorted((a, b) => a.key - b.key || a.index - b.index)
      .map(({ item }) => item);
  };
  const units: string[][] = [];
  for (const id of ids) {
    const group = groupOf(id),
      unit = group === undefined ? undefined : units.find((list) => groupOf(list[0]) === group);
    if (unit) unit.push(id);
    else units.push([id]);
  }
  return sorted(units, (unit) => {
    const centers = unit.map(wanted).filter((center) => center !== undefined);
    return centers.length ? Math.min(...centers) : undefined;
  }).flatMap((unit) => sorted(unit, wanted));
}

/** A lane's header: a bold title (swimlanes), a box with the agent's underlined name, or a stick figure with the name below (human agents). */
interface LaneHeader {
  lines: string[];
  kind: "title" | "box" | "figure";
}

const FIGURE = { width: 26, height: 42 };

function headerSize(header: LaneHeader, measure: Measure): { width: number; height: number } {
  const text = Math.max(
    0,
    ...header.lines.map((line) => measure(line, FONT, header.kind === "title" ? 600 : 400)),
  );
  if (header.kind === "figure")
    return {
      width: Math.ceil(Math.max(40, text + 24)),
      height: FIGURE.height + 6 + header.lines.length * LINE + 4,
    };
  if (header.kind === "box")
    return {
      width: Math.ceil(Math.max(80, text + 24)),
      height: Math.max(38, header.lines.length * LINE + 18),
    };
  return { width: Math.ceil(text + 24), height: header.lines.length * LINE + 18 };
}

/** Draws a header centered on `center` with its top at `top`; returns its box. */
export function drawHeader(
  scene: Scene,
  measure: Measure,
  id: string,
  header: LaneHeader,
  center: number,
  top: number,
): Box {
  const { width, height } = headerSize(header, measure),
    box = { x: center - width / 2, y: top, width, height };
  if (header.kind === "figure") {
    scene.shapes.push({
      id,
      kind: "actor",
      box,
      container: false,
      depth: 0,
      fill: "page",
      tab: FIGURE,
    });
    header.lines.forEach((line, row) =>
      addText(scene, measure, line, center, top + FIGURE.height + 6 + LINE / 2 + row * LINE, {
        size: FONT,
        role: "node",
        owner: id,
      }),
    );
  } else if (header.kind === "box") {
    scene.shapes.push({ id, kind: "rect", box, container: false, depth: 0, fill: "page" });
    // Underlined: the column stands for an instance (TAM).
    header.lines.forEach((line, row) =>
      addText(
        scene,
        measure,
        line,
        center,
        top + height / 2 + (row - (header.lines.length - 1) / 2) * LINE,
        { size: FONT, underline: true, role: "node", owner: id },
      ),
    );
  } else {
    header.lines.forEach((line, row) =>
      addText(scene, measure, line, center, top + 10 + LINE / 2 + row * LINE, {
        size: FONT,
        weight: 600,
        role: "title",
        owner: id,
      }),
    );
  }
  return box;
}
