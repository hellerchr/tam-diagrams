/** Sequence diagram lanes: participant headers and the lane positions solved from what messages and frames need. */

import type { Box, Scene } from "./scene";
import type { SequenceDiagram } from "./uml-sequence";
import { addText, FONT, LINE, type Measure, SMALL, wrap } from "./text";
import { smallSize } from "./labels";
import { frameBoxes, type LaneFrame } from "./lane-frames";

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
export function sequenceLanes(diagram: SequenceDiagram, measure: Measure): SequenceLanes {
  const ids = [...diagram.participants.keys()],
    index = new Map(ids.map((id, i) => [id, i]));
  const headers = new Map<string, LaneHeader>(
    ids.map((id) => {
      const item = diagram.participants.get(id)!;
      return [
        id,
        { lines: wrap(item.label, 160, FONT, 400, measure), kind: item.actor ? "figure" : "box" },
      ];
    }),
  );
  const head = (id: string) => headerSize(headers.get(id)!, measure);
  const labelOf = (text: string) => (text ? smallSize(text, measure) : { width: 0, height: 0 });

  // Columns: wide enough for the heads, the labels of the messages between them and the notes beside them.
  const extents = ids.map((id) => ({ left: head(id).width / 2, right: head(id).width / 2 }));
  const demands: SpanDemand[] = [];
  const beyond = (lane: number, side: "left" | "right", width: number) => {
    const neighbour = side === "right" ? lane + 1 : lane - 1;
    if (neighbour >= 0 && neighbour < ids.length)
      demands.push({ from: lane, to: neighbour, width });
    else extents[lane][side] = Math.max(extents[lane][side], width);
  };
  for (const event of diagram.events) {
    if (event.type === "message") {
      const a = index.get(event.from)!,
        b = index.get(event.to)!,
        label = labelOf(event.text),
        badge = event.number !== undefined ? BADGE_ROOM + 10 + (event.tail ? 10 : 0) : 0;
      if (a !== b) demands.push({ from: a, to: b, width: label.width + 2 * BAR + 30 + badge });
    }
    if (event.type === "note") {
      const width = labelOf(event.text).width + 22,
        a = index.get(event.who[0])!;
      if (event.placement !== "over") beyond(a, event.placement, width + 34);
      else if (event.who.length === 2)
        demands.push({ from: a, to: index.get(event.who[1])!, width: width - 30 });
      else {
        extents[a].left = Math.max(extents[a].left, width / 2 + MARGIN);
        extents[a].right = Math.max(extents[a].right, width / 2 + MARGIN);
      }
    }
  }
  // A box around participants is as wide as its title.
  const titleRoom = (label: string) => (label ? measure(label, FONT, 600) + 24 : 0);
  diagram.boxes.forEach((group, number) => {
    const members = ids
      .filter((id) => diagram.participants.get(id)!.box === number)
      .map((id) => index.get(id)!);
    const room = titleRoom(group.label);
    if (!members.length || !room) return;
    const first = Math.min(...members),
      last = Math.max(...members);
    if (first === last) {
      extents[first].left = Math.max(extents[first].left, room / 2);
      extents[first].right = Math.max(extents[first].right, room / 2);
    } else
      demands.push({
        from: first,
        to: last,
        width: room - head(ids[first]).width / 2 - head(ids[last]).width / 2 - 20,
      });
  });
  // A message label stands between activation bars of the lifelines it passes: the widest stretch
  // between two of them (or the message's ends) is made wide enough for it. A self message's loop
  // and label stand right of its bars, clear of the next lifeline's bars.
  {
    const nesting = new Map<string, number>(),
      active = (id: string) => (nesting.get(id) ?? 0) > 0;
    for (const event of diagram.events) {
      if (event.type === "activate") nesting.set(event.who, (nesting.get(event.who) ?? 0) + 1);
      else if (event.type === "deactivate")
        nesting.set(event.who, Math.max(0, (nesting.get(event.who) ?? 0) - 1));
      else if (event.type === "message") {
        const a = index.get(event.from)!,
          b = index.get(event.to)!,
          low = Math.min(a, b),
          high = Math.max(a, b);
        if (a === b)
          beyond(
            a,
            "right",
            (nesting.get(event.from) ?? 0) * NEST +
              SELF +
              labelOf(event.text).width +
              30 +
              (event.number !== undefined ? BADGE_ROOM + 10 : 0) +
              BAR / 2 +
              2 * NEST,
          );
        const barred = ids
          .slice(low + 1, high)
          .map((id, k) => (active(id) ? low + 1 + k : -1))
          .filter((lane) => lane >= 0);
        if (event.text && barred.length) {
          const stops = [low, ...barred, high];
          const [p, q] = stops
            .slice(1)
            .map((lane, k) => [stops[k], lane])
            .toSorted((u, v) => v[1] - v[0] - (u[1] - u[0]))[0];
          const margin = (lane: number) =>
            (lane === low || lane === high ? BAR / 2 + 2 * NEST : BAR / 2 + 2 * NEST + 4) +
            (lane === a && event.number !== undefined ? BADGE_ROOM + (event.tail ? 10 : 0) : 0);
          demands.push({
            from: p,
            to: q,
            width: labelOf(event.text).width + 8 + margin(p) + margin(q),
          });
        }
        if (event.activate) nesting.set(event.to, (nesting.get(event.to) ?? 0) + 1);
        if (event.deactivate)
          nesting.set(event.from, Math.max(0, (nesting.get(event.from) ?? 0) - 1));
      }
    }
  }
  // A fragment's conditions stand right of the lifeline of its first participant: the stretch up to
  // the next lifeline is made wide enough (or, for a fragment around one lifeline, the fragment itself).
  const guardRoom = new Map<string, number>();
  {
    type Open = { id: string; kind: string; lanes: Set<number>; widths: number[]; parent?: Open };
    const stack: Open[] = [],
      frames: Open[] = [];
    const width = (text: string) => {
      const label = `[${text}]`,
        full = measure(label, SMALL, 400);
      return Math.min(
        full,
        Math.max(200, ...label.split(/\s+/).map((word) => measure(word, SMALL, 400))),
      );
    };
    for (const event of diagram.events) {
      const involve = (...who: string[]) =>
        stack.forEach((frame) => who.forEach((id) => frame.lanes.add(index.get(id)!)));
      if (event.type === "start") {
        const frame: Open = {
          id: event.id,
          kind: event.kind,
          lanes: new Set<number>(),
          widths: event.kind !== "rect" && event.text ? [width(event.text)] : [],
          parent: stack.at(-1),
        };
        stack.push(frame);
        frames.push(frame);
      } else if (event.type === "else") {
        if (event.text) stack.at(-1)?.widths.push(width(event.text));
      } else if (event.type === "end") stack.pop();
      else if (event.type === "message") involve(event.from, event.to);
      else if (event.type === "note") involve(...event.who);
      else if (event.type === "activate" || event.type === "deactivate") involve(event.who);
    }
    for (const frame of frames) {
      if (!frame.lanes.size || !frame.widths.length) continue;
      const lo = Math.min(...frame.lanes),
        need = 6 + BAR / 2 + 2 * NEST + Math.max(...frame.widths) + 8;
      if (lo + 1 < ids.length) demands.push({ from: lo, to: lo + 1, width: need + 6 });
      else extents[lo].right = Math.max(extents[lo].right, need);
      if (frame.lanes.size === 1) guardRoom.set(frame.id, need - (BAR + 10 + 8));
    }
    // A frame reaches left of its first lifeline by its keyword tab (as frameBoxes draws it), and 8 more
    // around each frame inside it that starts there: the stretch from the lifeline before is made wide
    // enough that the tab clears that lifeline's activation bars.
    const lowest = (frame: Open) => (frame.lanes.size ? Math.min(...frame.lanes) : -1);
    const reach = (frame: Open): number =>
      Math.max(
        BAR + 18,
        (frame.kind === "rect" ? 0 : measure(frame.kind, SMALL, 600) + 20) + BAR + 2,
        ...frames
          .filter((child) => child.parent === frame && lowest(child) === lowest(frame))
          .map((child) => reach(child) + 8),
      );
    for (const frame of frames) {
      const lo = lowest(frame);
      if (lo > 0)
        demands.push({ from: lo - 1, to: lo, width: reach(frame) + BAR / 2 + 2 * NEST + 6 });
    }
  }
  // Frames need room for their keyword tab left of the first column.
  const framed = diagram.events.some((event) => event.type === "start");
  const { centers: xs } = solveLanes(extents, demands, {
    gap: GAP,
    start: 0,
    margin: MARGIN + (framed ? 48 : 12),
  });
  const x = (id: string) => xs[index.get(id)!];

  // Frames' horizontal extent depends only on what happens inside them: find it first, so their
  // conditions can be placed clear of the lifelines and bars in their header rows.
  const frameX = new Map<string, Box>();
  {
    const stack: (LaneFrame & { who: Set<string> })[] = [],
      all: (LaneFrame & { who: Set<string>; parent?: LaneFrame })[] = [];
    const nesting = new Map<string, number>();
    for (const event of diagram.events) {
      const involve = (...who: string[]) =>
        stack.forEach((frame) => who.forEach((id) => frame.who.add(id)));
      if (event.type === "start") {
        const frame = {
          id: event.id,
          kind: event.kind,
          text: event.text,
          top: 0,
          bottom: 1,
          members: [],
          extra: guardRoom.get(event.id) ?? 0,
          branches: [],
          children: [],
          depth: stack.length,
          who: new Set<string>(),
          parent: stack.at(-1),
        };
        stack.at(-1)?.children.push(frame);
        all.push(frame);
        stack.push(frame);
      } else if (event.type === "end") stack.pop();
      else if (event.type === "activate") {
        nesting.set(event.who, (nesting.get(event.who) ?? 0) + 1);
        involve(event.who);
      } else if (event.type === "deactivate")
        nesting.set(event.who, Math.max(0, (nesting.get(event.who) ?? 0) - 1));
      else if (event.type === "note") {
        involve(...event.who);
        if (event.placement === "right")
          stack.forEach((frame) => {
            frame.extra = Math.max(frame.extra, labelOf(event.text).width + 20 + 16 + BAR);
          });
      } else if (event.type === "message") {
        if (event.activate) nesting.set(event.to, (nesting.get(event.to) ?? 0) + 1);
        involve(event.from, event.to);
        if (event.from === event.to)
          stack.forEach((frame) => {
            frame.extra = Math.max(
              frame.extra,
              (nesting.get(event.from) ?? 0) * NEST + SELF + labelOf(event.text).width + 12,
            );
          });
        if (event.deactivate)
          nesting.set(event.from, Math.max(0, (nesting.get(event.from) ?? 0) - 1));
      }
    }
    for (const frame of all) frame.members = [...frame.who].map(x);
    for (const [id, box] of frameBoxes(
      all.filter((frame) => !frame.parent),
      measure,
      { reach: BAR + 10, fallback: xs[0] ?? 0 },
    ))
      frameX.set(id, box);
  }
  return { frameX, guardRoom, head, headers, ids, labelOf, titleRoom, x, xs };
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
