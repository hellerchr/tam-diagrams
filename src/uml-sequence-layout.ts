/** Sequence diagrams: lane widths from a column solver, messages, activation bars, frames and notes. */

import type { MessageEvent, SequenceDiagram } from "./uml-sequence.ts";
import { addText, drawNote, finishBounds, FONT, LINE, type Measure, SMALL } from "./text.ts";
import { type Box, emptyScene, overlaps, type Point, type Scene, unit } from "./scene.ts";
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
  const { frameX, guardRoom, head, headers, ids, labelOf, titleRoom, x, xs } = sequenceLanes(
    diagram,
    measure,
    places,
  );
  /** Lifelines and the activation bars open now, as intervals a condition must keep clear of. */
  const blockedNow = () => [
    ...ids.map((id) => [x(id) - 6, x(id) + 6] as [number, number]),
    ...[...open.values()].flat().map((bar) => {
      const left = x(bar.who) - BAR / 2 + bar.depth * NEST;
      return [left - 6, left + BAR + 6] as [number, number];
    }),
  ];

  const scene = emptyScene();
  // Heads at the top, except for participants created later; lifelines run below them.
  const top = 10 + (diagram.boxes.some((item) => item.label) ? LINE + 8 : 0);
  const headsBottom =
    top +
    Math.max(
      ...ids.filter((id) => !diagram.participants.get(id)!.created).map((id) => head(id).height),
      38,
    );
  let y = headsBottom + 22;
  const lifeStart = new Map<string, number>(),
    lifeEnd = new Map<string, number>();
  const drawHead = (id: string, headTop: number) => {
    lifeStart.set(
      id,
      drawHeader(scene, measure, `head:${id}`, headers.get(id)!, x(id), headTop).y +
        head(id).height,
    );
  };
  for (const id of ids)
    if (!diagram.participants.get(id)!.created) drawHead(id, headsBottom - head(id).height);

  // Rows: walk the events, tracking activations and open frames.
  interface Bar {
    who: string;
    depth: number;
    from: number;
    to?: number;
    waits: [number, number][];
  }
  const bars: Bar[] = [],
    open = new Map<string, Bar[]>();
  const depth = (id: string) => open.get(id)?.length ?? 0;
  // Where a message meets a lifeline: the outer side of its stack of activation bars facing the other end
  // (nested bars stand out to the right, the outermost bar sets the left side).
  const edge = (id: string, toward: number, at: number) =>
    barSide(
      x(id),
      toward,
      (open.get(id) ?? []).filter((bar) => bar.from <= at + 0.5),
    );
  interface Frame extends LaneFrame {
    parent?: Frame;
    who: Set<string>;
  }
  const frames: Frame[] = [],
    frameStack: Frame[] = [];
  const involve = (...who: string[]) => {
    for (const frame of frameStack) who.forEach((id) => frame.who.add(id));
  };
  const reach = (amount: number) => {
    for (const frame of frameStack) frame.extra = Math.max(frame.extra, amount);
  };
  let lastMessage: { y: number; from: string; to: string } | null = null;
  const pendingCreate = new Set<string>(),
    pendingDestroy = new Set<string>();
  const sync: { from: string; to: string; y: number }[] = [];
  // Messages are drawn once all bars are known (an `activate` after a message starts its bar at that
  // message): `from` and `to` name the lifelines whose bar sides the ends move to then.
  const pending: {
    event: MessageEvent;
    start: Point;
    end: Point;
    via: Point[];
    from?: [string, number];
    to?: [string, number];
  }[] = [];

  for (const event of diagram.events) {
    switch (event.type) {
      case "create":
        pendingCreate.add(event.who);
        break;
      case "destroy":
        pendingDestroy.add(event.who);
        break;
      case "activate": {
        // With the last message it took part in, below its head if that message created it.
        const at = Math.max(
          lastMessage && (lastMessage.to === event.who || lastMessage.from === event.who)
            ? lastMessage.y
            : y,
          lifeStart.get(event.who) ?? 0,
        );
        const bar: Bar = { who: event.who, depth: depth(event.who), from: at, waits: [] };
        bars.push(bar);
        open.set(event.who, [...(open.get(event.who) ?? []), bar]);
        involve(event.who);
        break;
      }
      case "deactivate": {
        const list = open.get(event.who);
        if (!list?.length) throw new UmlError(event.line, `\`${event.who}\` is not active.`);
        const bar = list.pop()!;
        bar.to = Math.max(
          bar.from + 12,
          lastMessage && (lastMessage.to === event.who || lastMessage.from === event.who)
            ? lastMessage.y
            : y,
        );
        if (bar.to > y - 8) y = bar.to + 10;
        break;
      }
      case "note": {
        const size = labelOf(event.text);
        const box = noteBox(
          event.placement,
          event.who.map(x),
          { width: size.width + 20, height: size.height + 12 },
          y,
          BAR / 2 + depth(event.who[0]) * NEST,
        );
        drawNote(scene, measure, event.id, event.text, box);
        involve(...event.who);
        reach(event.placement === "right" ? box.x + box.width - Math.max(...event.who.map(x)) : 0);
        y += box.height + 18;
        break;
      }
      case "start": {
        const frame: Frame = {
          id: event.id,
          kind: event.kind,
          text: event.text,
          top: y,
          bottom: y,
          members: [],
          extra: guardRoom.get(event.id) ?? 0,
          branches: [],
          children: [],
          parent: frameStack.at(-1),
          depth: frameStack.length,
          who: new Set(),
        };
        frameStack.at(-1)?.children.push(frame);
        frames.push(frame);
        frameStack.push(frame);
        if (event.kind === "rect") {
          y += 10;
          break;
        }
        // The header row: the keyword tab and the condition in the first stretch free of lifelines and bars.
        const box = frameX.get(frame.id)!,
          tab = measure(event.kind, SMALL, 600) + 20;
        if (event.text)
          frame.guard = placeGuard(
            event.text,
            box.x + tab + 8,
            box.x + box.width - 6,
            y + TAB / 2,
            blockedNow(),
            measure,
          );
        y += Math.max(TAB, (frame.guard?.lines.length ?? 1) * 15 + 6) + 12;
        break;
      }
      case "else": {
        const frame = frameStack.at(-1)!,
          box = frameX.get(frame.id)!;
        y += 4;
        const guard = event.text
          ? placeGuard(
              event.text,
              box.x + 8,
              box.x + box.width - 6,
              y + 4 + 15 / 2,
              blockedNow(),
              measure,
            )
          : undefined;
        frame.branches.push({ y, text: event.text, guard });
        y += (guard ? guard.lines.length * 15 : 0) + 16;
        break;
      }
      case "end": {
        const frame = frameStack.pop()!;
        frame.bottom = y + 2;
        y += 14;
        break;
      }
      case "message": {
        const label = labelOf(event.text),
          self = event.from === event.to;
        // A created participant's head appears where the message creating it arrives.
        if (pendingCreate.has(event.to)) {
          pendingCreate.delete(event.to);
          // The head is centred on the message: its top stays below what came before.
          const height = head(event.to).height;
          y += Math.max(label.height + 10, height / 2 + 2);
          drawHead(event.to, y - height / 2);
          const from = edge(event.from, x(event.to), y),
            side = x(event.to) >= from ? -1 : 1;
          pending.push({
            event,
            start: { x: from, y },
            end: { x: x(event.to) + (side * head(event.to).width) / 2, y },
            via: [],
            from: [event.from, x(event.to)],
          });
          // Its activation starts below the head; the sender's may end with the message.
          if (event.activate) {
            const bar: Bar = {
              who: event.to,
              depth: depth(event.to),
              from: y + height / 2,
              waits: [],
            };
            bars.push(bar);
            open.set(event.to, [...(open.get(event.to) ?? []), bar]);
          }
          if (event.deactivate) {
            const list = open.get(event.from);
            if (!list?.length) throw new UmlError(event.line, `\`${event.from}\` is not active.`);
            list.pop()!.to = y;
          }
          lastMessage = { y, from: event.from, to: event.to };
          involve(event.from, event.to);
          // Room below the new head, as much as notes keep from everything.
          y += height / 2 + 18;
          continue;
        }
        y += label.height + 10;
        if (event.activate) {
          const bar: Bar = { who: event.to, depth: depth(event.to), from: y, waits: [] };
          bars.push(bar);
          open.set(event.to, [...(open.get(event.to) ?? []), bar]);
        }
        const at = y;
        if (self) {
          const start = edge(event.from, x(event.from) + 1, at),
            loopEnd = at + 22;
          // A numbered self message leaves past its badge.
          const right =
            x(event.from) +
            depth(event.from) * NEST +
            SELF -
            (depth(event.from) ? 0 : BAR / 2) +
            BAR / 2 +
            (event.number !== undefined ? BADGE_ROOM : 0);
          pending.push({
            event,
            start: { x: start, y: at },
            end: { x: edge(event.from, x(event.from) + 1, loopEnd), y: loopEnd },
            via: [
              { x: right, y: at },
              { x: right, y: loopEnd },
            ],
            from: [event.from, x(event.from) + 1],
            to: [event.from, x(event.from) + 1],
          });
          reach(right + label.width + 12 - x(event.from));
          y = loopEnd;
        } else {
          pending.push({
            event,
            start: { x: edge(event.from, x(event.to), at), y: at },
            end: { x: edge(event.to, x(event.from), at), y: at },
            via: [],
            from: [event.from, x(event.to)],
            to: [event.to, x(event.from)],
          });
          if (event.head === "arrow" && !event.dashed)
            sync.push({ from: event.from, to: event.to, y: at });
          // A return ends the caller's wait for it: no focus of control in between (TAM).
          if (event.dashed && event.head === "open") {
            const call = sync.findLast((item) => item.from === event.to && item.to === event.from);
            if (call) {
              sync.splice(sync.indexOf(call), 1);
              const bar = (open.get(event.to) ?? []).at(-1);
              if (bar && bar.from <= call.y) bar.waits.push([call.y, at]);
            }
          }
        }
        if (event.deactivate) {
          const list = open.get(event.from);
          if (!list?.length) throw new UmlError(event.line, `\`${event.from}\` is not active.`);
          list.pop()!.to = at;
        }
        if (pendingDestroy.has(event.to) || pendingDestroy.has(event.from)) {
          const who = pendingDestroy.has(event.to) ? event.to : event.from;
          pendingDestroy.delete(who);
          lifeEnd.set(who, at + (self ? 22 : 0) + 10);
        }
        lastMessage = { y: at, from: event.from, to: event.to };
        involve(event.from, event.to);
        y += 14;
        break;
      }
    }
  }
  for (const who of pendingDestroy) lifeEnd.set(who, y);
  y += 10;
  for (const bar of bars) if (bar.to === undefined) bar.to = y - 6;

  // Frames around the lifelines of everything inside them, nested frames inside their parents.
  for (const frame of frames) frame.members = [...frame.who].map(x);
  const boxes = frameBoxes(
    frames.filter((frame) => !frame.parent),
    measure,
    { reach: BAR + 10, fallback: xs[0] ?? 0 },
  );
  for (const frame of frames) drawFrame(scene, measure, frame, boxes.get(frame.id)!);
  // Boxes around groups of participants, behind everything.
  diagram.boxes.forEach((group, number) => {
    const members = ids.filter((id) => diagram.participants.get(id)!.box === number);
    if (!members.length) return;
    let left = Math.min(...members.map((id) => x(id) - head(id).width / 2)) - 10,
      right = Math.max(...members.map((id) => x(id) + head(id).width / 2)) + 10;
    const missing = titleRoom(group.label) - (right - left);
    if (missing > 0) {
      left -= missing / 2;
      right += missing / 2;
    }
    const box = { x: left, y: 4, width: right - left, height: y - 4 };
    scene.shapes.unshift({
      id: `box${number}`,
      kind: "rect",
      box,
      container: true,
      depth: 0,
      fill: "shade",
      thin: true,
    });
    if (group.label)
      addText(scene, measure, group.label, box.x + box.width / 2, 4 + 8 + LINE / 2 - 4, {
        size: FONT,
        weight: 600,
        role: "title",
        owner: `box${number}`,
      });
  });
  // Lifelines, activation bars (white while waiting for an answer) and destruction crosses.
  for (const id of ids) {
    const end = lifeEnd.get(id) ?? y;
    scene.lines.push({
      points: [
        { x: x(id), y: lifeStart.get(id) ?? headsBottom },
        { x: x(id), y: end },
      ],
      dashed: true,
      tone: "boundary",
      width: 1,
    });
    if (lifeEnd.has(id))
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
  // Bars go under everything else: notes over a lifeline cover its bar.
  const barShapes: Scene["shapes"] = [];
  bars.forEach((bar, number) => {
    const left = x(bar.who) - BAR / 2 + bar.depth * NEST;
    let from = bar.from;
    const pieces: [number, number, boolean][] = [];
    for (const [a, b] of bar.waits.sort((p, q) => p[0] - q[0])) {
      if (a > from) pieces.push([from, a, true]);
      pieces.push([a, b, false]);
      from = b;
    }
    if (bar.to! > from) pieces.push([from, bar.to!, true]);
    pieces.forEach(([a, b, focus], piece) =>
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
  scene.shapes.unshift(...barShapes);
  // Messages last, so their labels can avoid the bars, notes and frames placed above.
  /** Where a message meets a lifeline once every bar is known: the outer side of the bars open there. */
  const settled = (id: string, toward: number, at: number) =>
    barSide(
      x(id),
      toward,
      bars.filter((bar) => bar.who === id && bar.from <= at + 0.5 && bar.to! >= at - 0.5),
    );
  for (const { event, start, end, via, from, to } of pending) {
    message(
      event,
      from ? { x: settled(from[0], from[1], start.y), y: start.y } : start,
      to ? { x: settled(to[0], to[1], end.y), y: end.y } : end,
      via,
    );
  }
  finishBounds(scene, measure, diagram.title);
  return scene;

  function message(event: MessageEvent, origin: Point, end: Point, via: Point[]) {
    // A sequence number sits in a badge just outside the bar or lifeline the message leaves, on the
    // side it travels; the message starts at the badge's far edge.
    // A two-way message keeps its tail head at the lifeline; its badge sits on the line just after the head.
    const toward = (via[0] ?? end).x >= origin.x ? 1 : -1,
      after = event.tail ? 10 : 0;
    const badge = { x: origin.x + toward * (after + BADGE_GAP + BADGE), y: origin.y };
    const start =
      event.number !== undefined && !event.tail
        ? { x: origin.x + toward * BADGE_ROOM, y: origin.y }
        : origin;
    const points = [start, ...via, end];
    const home = frames
      .filter((frame) => frame.top <= start.y && frame.bottom >= end.y)
      .map((frame) => frame.id);
    const ends = [
      `head:${event.from}`,
      `head:${event.to}`,
      ...(event.number !== undefined ? [`badge:${event.id}`] : []),
    ];
    scene.wires.push({
      edge: event.id,
      points,
      dashed: event.dashed,
      ends,
      home: [...home, ...diagram.boxes.map((_, number) => `box${number}`)],
    });
    if (event.head)
      scene.markers.push({
        kind: event.head,
        tip: end,
        direction: unit(points.at(-2)!, end),
        wire: event.id,
      });
    if (event.tail)
      scene.markers.push({
        kind: event.tail,
        tip: start,
        direction: unit(points[1], start),
        wire: event.id,
      });
    if (event.number !== undefined) {
      scene.shapes.push({
        id: `badge:${event.id}`,
        kind: "badge",
        box: { x: badge.x - BADGE, y: badge.y - BADGE, width: 2 * BADGE, height: 2 * BADGE },
        container: false,
        depth: 0,
        fill: "ink",
        passable: true,
      });
      addText(scene, measure, String(event.number), badge.x, badge.y, {
        size: 10,
        weight: 600,
        tone: "inverse",
        role: "marker",
        owner: `badge:${event.id}`,
      });
    }
    if (!event.text) return;
    const size = smallSize(event.text, measure);
    // Labels keep 8px above their line, so the halo never touches it.
    if (via.length) {
      smallLines(scene, measure, event.text, via[0].x + 6, start.y - size.height / 2 - 8, {
        role: "label",
        owner: event.id,
        anchor: "start",
      });
      return;
    }
    // Above the message, over the stretch nearest its sender that is clear of the activation bars
    // it passes, so that it reads as the sender's; plain lifelines may run behind the label's halo.
    const left = Math.min(start.x, end.x),
      right = Math.max(start.x, end.x),
      labelTop = start.y - 10 - size.height;
    const blocked = scene.shapes
      .filter(
        (shape) =>
          (shape.kind === "activation" || shape.kind === "badge") &&
          shape.box.x + shape.box.width > left &&
          shape.box.x < right &&
          shape.box.y < start.y &&
          shape.box.y + shape.box.height > labelTop,
      )
      .map((shape) => [shape.box.x - 4, shape.box.x + shape.box.width + 4] as const)
      .toSorted((p, q) => p[0] - q[0]);
    const clear: [number, number][] = [];
    let cursor = left;
    for (const [low, high] of blocked) {
      if (low > cursor) clear.push([cursor, Math.min(low, right)]);
      cursor = Math.max(cursor, high);
    }
    if (cursor < right) clear.push([cursor, right]);
    const spans = clear
      .map(
        ([a, b]) =>
          [
            { x: a, y: start.y },
            { x: b, y: start.y },
          ] as const,
      )
      .filter(([a, b]) => b.x - a.x >= size.width + 8);
    const segments = spans.length
      ? spans.toSorted(
          (p, q) =>
            Math.min(Math.abs(p[0].x - start.x), Math.abs(p[1].x - start.x)) -
            Math.min(Math.abs(q[0].x - start.x), Math.abs(q[1].x - start.x)),
        )
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
