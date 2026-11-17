/** Sequence diagrams: lane widths from a column solver, messages, activation bars, frames and notes. */

import type { MessageEvent, SequenceDiagram } from "./uml-sequence.ts";
import { addText, drawNote, finishBounds, FONT, LINE, type Measure, SMALL } from "./text.ts";
import {
  type Box,
  emptyScene,
  overlaps,
  type Point,
  type Scene,
  type SceneShape,
  unit,
} from "./scene.ts";
import { UmlError } from "./uml.ts";
import { smallLines, smallSize } from "./labels.ts";
import {
  BADGE,
  BADGE_GAP,
  BADGE_ROOM,
  BAR,
  drawHeader,
  NEST,
  SELF,
  sequenceLanes,
} from "./uml-sequence-lanes.ts";
import {
  drawFrame,
  frameBoxes,
  type LaneFrame,
  noteBox,
  placeGuard,
  placeLabel,
  TAB,
} from "./lane-frames.ts";

/**
 * Lays a sequence diagram out. Time runs down in the order of the source; `places` gives
 * participants (`head:` and their id) the x their heads stand at, which orders the lifelines and
 * sets the room between them, never less than their messages and notes need.
 */
export async function layoutSequenceDiagram(
  diagram: SequenceDiagram,
  measure: Measure,
  places?: ReadonlyMap<string, Point>,
): Promise<Scene> {
  const timeline = new Timeline(diagram, measure, sequenceLanes(diagram, measure, places));
  // Rows: walk the events, tracking activations and open frames.
  for (const event of diagram.events) {
    const step = STEPS[event.type] as (timeline: Timeline, event: SequenceEvent) => void;
    step(timeline, event);
  }
  timeline.close();
  timeline.drawFrames();
  timeline.drawGroups();
  timeline.drawLifelines();
  timeline.drawBars();
  // Messages last, so their labels can avoid the bars, notes and frames placed above.
  timeline.drawMessages();
  finishBounds(timeline.scene, measure, diagram.title);
  return timeline.scene;
}

type SequenceEvent = SequenceDiagram["events"][number];

/** Each kind of event as the timeline takes it. */
const STEPS: {
  [Type in SequenceEvent["type"]]: (
    timeline: Timeline,
    event: SequenceEvent & { type: Type },
  ) => void;
} = {
  create: (timeline, event) => timeline.pendingCreate.add(event.who),
  destroy: (timeline, event) => timeline.pendingDestroy.add(event.who),
  activate: (timeline, event) => timeline.activate(event.who),
  deactivate: (timeline, event) => timeline.deactivate(event.who, event.line),
  note: (timeline, event) => timeline.note(event),
  start: (timeline, event) => timeline.start(event),
  else: (timeline, event) => timeline.otherwise(event.text),
  end: (timeline) => timeline.end(),
  message: (timeline, event) => timeline.message(event),
};

/** An activation bar: whose, how deep it nests, from and to where, and where it waits for an answer. */
interface Bar {
  who: string;
  depth: number;
  from: number;
  to?: number;
  waits: [number, number][];
}

/** A combined fragment as the timeline opens it, with the frame around it and the lifelines it involves. */
interface Frame extends LaneFrame {
  parent?: Frame;
  who: Set<string>;
}

/**
 * A message waiting to be drawn until all bars are known (an `activate` after a message starts its
 * bar at that message): `from` and `to` name the lifelines whose bar sides the ends move to then.
 */
interface Pending {
  event: MessageEvent;
  start: Point;
  end: Point;
  via: Point[];
  from?: [string, number];
  to?: [string, number];
}

/** The walk down a sequence diagram's events: the row it has reached, and the bars, frames and messages it found. */
class Timeline {
  readonly scene = emptyScene();
  /** Where the heads at the top end. */
  readonly headsBottom: number;
  y: number;
  readonly lifeStart = new Map<string, number>();
  readonly lifeEnd = new Map<string, number>();
  readonly bars: Bar[] = [];
  readonly open = new Map<string, Bar[]>();
  readonly frames: Frame[] = [];
  readonly frameStack: Frame[] = [];
  lastMessage: { y: number; from: string; to: string } | null = null;
  readonly pendingCreate = new Set<string>();
  readonly pendingDestroy = new Set<string>();
  /** Synchronous calls not yet answered. */
  readonly sync: { from: string; to: string; y: number }[] = [];
  readonly pending: Pending[] = [];
  readonly diagram: SequenceDiagram;
  readonly measure: Measure;
  readonly lanes: ReturnType<typeof sequenceLanes>;

  constructor(diagram: SequenceDiagram, measure: Measure, lanes: ReturnType<typeof sequenceLanes>) {
    this.diagram = diagram;
    this.measure = measure;
    this.lanes = lanes;
    const { ids, head } = lanes;
    // Heads at the top, except for participants created later; lifelines run below them.
    const top = 10 + (diagram.boxes.some((item) => item.label) ? LINE + 8 : 0);
    const later = (id: string) => diagram.participants.get(id)!.created;
    this.headsBottom =
      top + Math.max(...ids.filter((id) => !later(id)).map((id) => head(id).height), 38);
    this.y = this.headsBottom + 22;
    for (const id of ids) if (!later(id)) this.drawHead(id, this.headsBottom - head(id).height);
  }

  readonly x = (id: string) => this.lanes.x(id);

  drawHead(id: string, headTop: number) {
    const { measure, lanes } = this;
    const drawn = drawHeader(
      this.scene,
      measure,
      `head:${id}`,
      lanes.headers.get(id)!,
      this.x(id),
      headTop,
    );
    this.lifeStart.set(id, drawn.y + lanes.head(id).height);
  }

  /** Lifelines and the activation bars open now, as intervals a condition must keep clear of. */
  blockedNow(): [number, number][] {
    return [
      ...this.lanes.ids.map((id) => [this.x(id) - 6, this.x(id) + 6] as [number, number]),
      ...[...this.open.values()].flat().map((bar) => {
        const left = this.x(bar.who) - BAR / 2 + bar.depth * NEST;
        return [left - 6, left + BAR + 6] as [number, number];
      }),
    ];
  }

  depth(id: string) {
    return this.open.get(id)?.length ?? 0;
  }

  /**
   * Where a message meets a lifeline: the outer side of its stack of activation bars facing the
   * other end (nested bars stand out to the right, the outermost bar sets the left side).
   */
  edge(id: string, toward: number, at: number) {
    return barSide(
      this.x(id),
      toward,
      (this.open.get(id) ?? []).filter((bar) => bar.from <= at + 0.5),
    );
  }

  involve(...who: string[]) {
    for (const frame of this.frameStack) who.forEach((id) => frame.who.add(id));
  }

  /** The open frames reach `amount` right of their rightmost lifeline. */
  reach(amount: number) {
    for (const frame of this.frameStack) frame.extra = Math.max(frame.extra, amount);
  }

  /** Where the last message `who` took part in stands, else the row reached. */
  sinceLast(who: string) {
    const last = this.lastMessage;
    return last && (last.to === who || last.from === who) ? last.y : this.y;
  }

  openBar(who: string, from: number) {
    const bar: Bar = { who, depth: this.depth(who), from, waits: [] };
    this.bars.push(bar);
    this.open.set(who, [...(this.open.get(who) ?? []), bar]);
  }

  /** Ends the innermost bar of `who` at `at`; throws for a lifeline without one. */
  closeBar(who: string, line: number, at: number) {
    const list = this.open.get(who);
    if (!list?.length) throw new UmlError(line, `\`${who}\` is not active.`);
    list.pop()!.to = at;
  }

  /** A bar opens with the last message its lifeline took part in, below its head if that message created it. */
  activate(who: string) {
    this.openBar(who, Math.max(this.sinceLast(who), this.lifeStart.get(who) ?? 0));
    this.involve(who);
  }

  deactivate(who: string, line: number) {
    const list = this.open.get(who);
    if (!list?.length) throw new UmlError(line, `\`${who}\` is not active.`);
    const bar = list.pop()!;
    bar.to = Math.max(bar.from + 12, this.sinceLast(who));
    if (bar.to > this.y - 8) this.y = bar.to + 10;
  }

  note(event: SequenceEvent & { type: "note" }) {
    const size = this.lanes.labelOf(event.text);
    const box = noteBox(
      event.placement,
      event.who.map(this.x),
      { width: size.width + 20, height: size.height + 12 },
      this.y,
      BAR / 2 + this.depth(event.who[0]) * NEST,
    );
    drawNote(this.scene, this.measure, event.id, event.text, box);
    this.involve(...event.who);
    this.reach(
      event.placement === "right" ? box.x + box.width - Math.max(...event.who.map(this.x)) : 0,
    );
    this.y += box.height + 18;
  }

  start(event: SequenceEvent & { type: "start" }) {
    const frame: Frame = {
      id: event.id,
      kind: event.kind,
      text: event.text,
      top: this.y,
      bottom: this.y,
      members: [],
      extra: this.lanes.guardRoom.get(event.id) ?? 0,
      branches: [],
      children: [],
      parent: this.frameStack.at(-1),
      depth: this.frameStack.length,
      who: new Set(),
    };
    this.frameStack.at(-1)?.children.push(frame);
    this.frames.push(frame);
    this.frameStack.push(frame);
    if (event.kind === "rect") this.y += 10;
    else this.header(frame, event.kind, event.text);
  }

  /** The header row: the keyword tab and the condition in the first stretch free of lifelines and bars. */
  header(frame: Frame, kind: string, text: string) {
    const box = this.lanes.frameX.get(frame.id)!,
      tab = this.measure(kind, SMALL, 600) + 20;
    if (text)
      frame.guard = placeGuard(
        text,
        box.x + tab + 8,
        box.x + box.width - 6,
        this.y + TAB / 2,
        this.blockedNow(),
        this.measure,
      );
    this.y += Math.max(TAB, (frame.guard?.lines.length ?? 1) * 15 + 6) + 12;
  }

  /** A separator in the innermost frame (`else`, `and`), with its condition. */
  otherwise(text: string) {
    const frame = this.frameStack.at(-1)!,
      box = this.lanes.frameX.get(frame.id)!;
    this.y += 4;
    const guard = text
      ? placeGuard(
          text,
          box.x + 8,
          box.x + box.width - 6,
          this.y + 4 + 15 / 2,
          this.blockedNow(),
          this.measure,
        )
      : undefined;
    frame.branches.push({ y: this.y, text, guard });
    this.y += (guard ? guard.lines.length * 15 : 0) + 16;
  }

  end() {
    const frame = this.frameStack.pop()!;
    frame.bottom = this.y + 2;
    this.y += 14;
  }

  message(event: MessageEvent) {
    const label = this.lanes.labelOf(event.text),
      self = event.from === event.to;
    if (this.pendingCreate.has(event.to)) return this.creating(event, label.height);
    this.y += label.height + 10;
    if (event.activate) this.openBar(event.to, this.y);
    const at = this.y;
    if (self) this.selfMessage(event, label.width, at);
    else this.between(event, at);
    if (event.deactivate) this.closeBar(event.from, event.line, at);
    this.destroyAfter(event, at + (self ? 22 : 0) + 10);
    this.lastMessage = { y: at, from: event.from, to: event.to };
    this.involve(event.from, event.to);
    this.y += 14;
  }

  /** A created participant's head appears where the message creating it arrives. */
  creating(event: MessageEvent, labelHeight: number) {
    const { x, lanes } = this;
    this.pendingCreate.delete(event.to);
    // The head is centred on the message: its top stays below what came before.
    const height = lanes.head(event.to).height;
    this.y += Math.max(labelHeight + 10, height / 2 + 2);
    const y = this.y;
    this.drawHead(event.to, y - height / 2);
    const from = this.edge(event.from, x(event.to), y),
      side = x(event.to) >= from ? -1 : 1;
    this.pending.push({
      event,
      start: { x: from, y },
      end: { x: x(event.to) + (side * lanes.head(event.to).width) / 2, y },
      via: [],
      from: [event.from, x(event.to)],
    });
    // Its activation starts below the head; the sender's may end with the message.
    if (event.activate) this.openBar(event.to, y + height / 2);
    if (event.deactivate) this.closeBar(event.from, event.line, y);
    this.lastMessage = { y, from: event.from, to: event.to };
    this.involve(event.from, event.to);
    // Room below the new head, as much as notes keep from everything.
    this.y += height / 2 + 18;
  }

  /** A message to its own lifeline: a loop right of its bars; a numbered one leaves past its badge. */
  selfMessage(event: MessageEvent, labelWidth: number, at: number) {
    const { x } = this,
      who = event.from,
      start = this.edge(who, x(who) + 1, at),
      loopEnd = at + 22;
    const right =
      x(who) +
      this.depth(who) * NEST +
      SELF -
      (this.depth(who) ? 0 : BAR / 2) +
      BAR / 2 +
      (event.number !== undefined ? BADGE_ROOM : 0);
    this.pending.push({
      event,
      start: { x: start, y: at },
      end: { x: this.edge(who, x(who) + 1, loopEnd), y: loopEnd },
      via: [
        { x: right, y: at },
        { x: right, y: loopEnd },
      ],
      from: [who, x(who) + 1],
      to: [who, x(who) + 1],
    });
    this.reach(right + labelWidth + 12 - x(who));
    this.y = loopEnd;
  }

  /** A message between two lifelines; a call waits for its answer, a return ends the wait. */
  between(event: MessageEvent, at: number) {
    const { x } = this;
    this.pending.push({
      event,
      start: { x: this.edge(event.from, x(event.to), at), y: at },
      end: { x: this.edge(event.to, x(event.from), at), y: at },
      via: [],
      from: [event.from, x(event.to)],
      to: [event.to, x(event.from)],
    });
    if (event.head === "arrow" && !event.dashed)
      this.sync.push({ from: event.from, to: event.to, y: at });
    if (event.dashed && event.head === "open") this.answer(event, at);
  }

  /** A return ends the caller's wait for it: no focus of control in between (TAM). */
  answer(event: MessageEvent, at: number) {
    const call = this.sync.findLast((item) => item.from === event.to && item.to === event.from);
    if (!call) return;
    this.sync.splice(this.sync.indexOf(call), 1);
    const bar = (this.open.get(event.to) ?? []).at(-1);
    if (bar && bar.from <= call.y) bar.waits.push([call.y, at]);
  }

  /** A participant to destroy ends its lifeline at the message that next takes it part, receiver first. */
  destroyAfter(event: MessageEvent, end: number) {
    const who = [event.to, event.from].find((id) => this.pendingDestroy.has(id));
    if (who === undefined) return;
    this.pendingDestroy.delete(who);
    this.lifeEnd.set(who, end);
  }

  /** After the last event: lifelines still to destroy end here, and bars still open close here. */
  close() {
    for (const who of this.pendingDestroy) this.lifeEnd.set(who, this.y);
    this.y += 10;
    for (const bar of this.bars) if (bar.to === undefined) bar.to = this.y - 6;
  }

  /** Frames around the lifelines of everything inside them, nested frames inside their parents. */
  drawFrames() {
    for (const frame of this.frames) frame.members = [...frame.who].map(this.x);
    const boxes = frameBoxes(
      this.frames.filter((frame) => !frame.parent),
      this.measure,
      { reach: BAR + 10, fallback: this.lanes.xs[0] ?? 0 },
    );
    for (const frame of this.frames)
      drawFrame(this.scene, this.measure, frame, boxes.get(frame.id)!);
  }

  /** Boxes around groups of participants, behind everything. */
  drawGroups() {
    this.diagram.boxes.forEach((group, number) => this.drawGroup(group.label, number));
  }

  drawGroup(label: string, number: number) {
    const { x, lanes } = this;
    const members = lanes.ids.filter((id) => this.diagram.participants.get(id)!.box === number);
    if (!members.length) return;
    let left = Math.min(...members.map((id) => x(id) - lanes.head(id).width / 2)) - 10,
      right = Math.max(...members.map((id) => x(id) + lanes.head(id).width / 2)) + 10;
    const missing = lanes.titleRoom(label) - (right - left);
    if (missing > 0) {
      left -= missing / 2;
      right += missing / 2;
    }
    const box = { x: left, y: 4, width: right - left, height: this.y - 4 };
    this.scene.shapes.unshift({
      id: `box${number}`,
      kind: "rect",
      box,
      container: true,
      depth: 0,
      fill: "shade",
      thin: true,
    });
    if (label)
      addText(this.scene, this.measure, label, box.x + box.width / 2, 4 + 8 + LINE / 2 - 4, {
        size: FONT,
        weight: 600,
        role: "title",
        owner: `box${number}`,
      });
  }

  /** Lifelines and destruction crosses. */
  drawLifelines() {
    const { x, scene } = this;
    for (const id of this.lanes.ids) {
      const end = this.lifeEnd.get(id) ?? this.y;
      scene.lines.push({
        points: [
          { x: x(id), y: this.lifeStart.get(id) ?? this.headsBottom },
          { x: x(id), y: end },
        ],
        dashed: true,
        tone: "boundary",
        width: 1,
      });
      if (this.lifeEnd.has(id))
        scene.shapes.push({
          id: `destroy:${id}`,
          kind: "destroy",
          box: { x: x(id) - 7, y: end - 7, width: 14, height: 14 },
          container: false,
          depth: 0,
          fill: "none",
          passable: true,
        });
    }
  }

  /** Activation bars, white while waiting for an answer; they go under everything else: notes over a lifeline cover its bar. */
  drawBars() {
    const barShapes: Scene["shapes"] = [];
    this.bars.forEach((bar, number) => {
      const left = this.x(bar.who) - BAR / 2 + bar.depth * NEST;
      barPieces(bar).forEach(([a, b, focus], piece) =>
        barShapes.push({
          id: `bar${number}:${piece}`,
          kind: "activation",
          box: { x: left, y: a, width: BAR, height: Math.max(4, b - a) },
          container: false,
          depth: bar.depth,
          fill: focus ? "strong" : "page",
          passable: true,
        }),
      );
    });
    this.scene.shapes.unshift(...barShapes);
  }

  /** Where a message meets a lifeline once every bar is known: the outer side of the bars open there. */
  settled(id: string, toward: number, at: number) {
    return barSide(
      this.x(id),
      toward,
      this.bars.filter((bar) => bar.who === id && bar.from <= at + 0.5 && bar.to! >= at - 0.5),
    );
  }

  drawMessages() {
    for (const { event, start, end, via, from, to } of this.pending)
      this.drawMessage(
        event,
        from ? { x: this.settled(from[0], from[1], start.y), y: start.y } : start,
        to ? { x: this.settled(to[0], to[1], end.y), y: end.y } : end,
        via,
      );
  }

  /**
   * A message's wire and markers, its sequence number and its label. The number sits in a badge
   * just outside the bar or lifeline the message leaves, on the side it travels; the message
   * starts at the badge's far edge. A two-way message keeps its tail head at the lifeline; its
   * badge sits on the line just after the head.
   */
  drawMessage(event: MessageEvent, origin: Point, end: Point, via: Point[]) {
    const numbered = event.number !== undefined,
      toward = (via[0] ?? end).x >= origin.x ? 1 : -1;
    const start =
      numbered && !event.tail ? { x: origin.x + toward * BADGE_ROOM, y: origin.y } : origin;
    const points = [start, ...via, end];
    this.drawWire(event, points);
    if (numbered) {
      const after = event.tail ? 10 : 0;
      this.drawBadge(event, { x: origin.x + toward * (after + BADGE_GAP + BADGE), y: origin.y });
    }
    if (!event.text) return;
    if (via.length) {
      const size = smallSize(event.text, this.measure);
      smallLines(
        this.scene,
        this.measure,
        event.text,
        via[0].x + 6,
        start.y - size.height / 2 - 8,
        { role: "label", owner: event.id, anchor: "start" },
      );
    } else labelMessage(this.scene, this.measure, event, start, end);
  }

  /** A message's wire, in the frames around it and the boxes, with its heads. */
  drawWire(event: MessageEvent, points: Point[]) {
    const start = points[0],
      end = points.at(-1)!;
    const home = this.frames
      .filter((frame) => frame.top <= start.y && frame.bottom >= end.y)
      .map((frame) => frame.id);
    const ends = [
      `head:${event.from}`,
      `head:${event.to}`,
      ...(event.number !== undefined ? [`badge:${event.id}`] : []),
    ];
    this.scene.wires.push({
      edge: event.id,
      points,
      dashed: event.dashed,
      ends,
      home: [...home, ...this.diagram.boxes.map((_, number) => `box${number}`)],
    });
    if (event.head)
      this.scene.markers.push({
        kind: event.head,
        tip: end,
        direction: unit(points.at(-2)!, end),
        wire: event.id,
      });
    if (event.tail)
      this.scene.markers.push({
        kind: event.tail,
        tip: start,
        direction: unit(points[1], start),
        wire: event.id,
      });
  }

  /** A message's sequence number in its badge. */
  drawBadge(event: MessageEvent, badge: Point) {
    this.scene.shapes.push({
      id: `badge:${event.id}`,
      kind: "badge",
      box: { x: badge.x - BADGE, y: badge.y - BADGE, width: 2 * BADGE, height: 2 * BADGE },
      container: false,
      depth: 0,
      fill: "ink",
      passable: true,
    });
    addText(this.scene, this.measure, String(event.number), badge.x, badge.y, {
      size: 10,
      weight: 600,
      tone: "inverse",
      role: "marker",
      owner: `badge:${event.id}`,
    });
  }
}

/** A bar's pieces from top to bottom, each with whether it has the focus of control or waits. */
function barPieces(bar: Bar): [number, number, boolean][] {
  let from = bar.from;
  const pieces: [number, number, boolean][] = [];
  for (const [a, b] of bar.waits.sort((p, q) => p[0] - q[0])) {
    if (a > from) pieces.push([from, a, true]);
    pieces.push([a, b, false]);
    from = b;
  }
  if (bar.to! > from) pieces.push([from, bar.to!, true]);
  return pieces;
}

/**
 * A straight message's label, above the message, over the stretch nearest its sender that is
 * clear of the activation bars it passes, so that it reads as the sender's; plain lifelines may
 * run behind the label's halo. Labels keep 8px above their line, so the halo never touches it.
 */
function labelMessage(
  scene: Scene,
  measure: Measure,
  event: MessageEvent,
  start: Point,
  end: Point,
) {
  const size = smallSize(event.text, measure);
  const left = Math.min(start.x, end.x),
    right = Math.max(start.x, end.x);
  const spans = clearStretches(scene, left, right, start.y, start.y - 10 - size.height)
    .map(
      ([a, b]) =>
        [
          { x: a, y: start.y },
          { x: b, y: start.y },
        ] as const,
    )
    .filter(([a, b]) => b.x - a.x >= size.width + 8);
  const nearness = ([a, b]: readonly [Point, Point]) =>
    Math.min(Math.abs(a.x - start.x), Math.abs(b.x - start.x));
  const segments = spans.length
    ? spans.toSorted((p, q) => nearness(p) - nearness(q))
    : [
        [
          { x: left, y: start.y },
          { x: right, y: start.y },
        ] as const,
      ];
  const free = (box: Box) =>
    !scene.shapes.some((shape) => !shape.container && overlaps(box, shape.box)) &&
    !scene.texts.some((text) => overlaps(box, text.box));
  const box = placeLabel(segments, size, free, {
    sides: "above",
    gaps: [10],
    positions: [0.5, 0.3, 0.7, 0.15, 0.85],
    sorted: true,
  }) ?? { x: (left + right) / 2 - size.width / 2, y: start.y - 8 - size.height, ...size };
  smallLines(scene, measure, event.text, box.x + box.width / 2, box.y + box.height / 2, {
    role: "label",
    owner: event.id,
  });
}

/** Whether a shape is a bar or badge a label above a message from `left` to `right` at `y` must keep clear of. */
const inLabelsWay = (shape: SceneShape, left: number, right: number, y: number, top: number) =>
  (shape.kind === "activation" || shape.kind === "badge") &&
  shape.box.x + shape.box.width > left &&
  shape.box.x < right &&
  shape.box.y < y &&
  shape.box.y + shape.box.height > top;

/** The stretches from `left` to `right` clear of the bars and badges between `top` and `y`. */
function clearStretches(scene: Scene, left: number, right: number, y: number, top: number) {
  const blocked = scene.shapes
    .filter((shape) => inLabelsWay(shape, left, right, y, top))
    .map((shape) => [shape.box.x - 4, shape.box.x + shape.box.width + 4] as const)
    .toSorted((p, q) => p[0] - q[0]);
  const clear: [number, number][] = [];
  let cursor = left;
  for (const [low, high] of blocked) {
    if (low > cursor) clear.push([cursor, Math.min(low, right)]);
    cursor = Math.max(cursor, high);
  }
  if (cursor < right) clear.push([cursor, right]);
  return clear;
}

/**
 * Where a message meets a lifeline at `x`: the outer side of the activation bars `active` facing the
 * message's other end at `toward`, or the lifeline itself when none is open.
 */
function barSide(x: number, toward: number, active: { depth: number }[]): number {
  if (!active.length) return x;
  return toward >= x
    ? x + Math.max(...active.map((bar) => bar.depth)) * NEST + BAR / 2
    : x + Math.min(...active.map((bar) => bar.depth)) * NEST - BAR / 2;
}
