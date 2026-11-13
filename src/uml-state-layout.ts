/** State machine diagrams: the layout with ELK, composite states, concurrent regions and notes. */

import type { StateDiagram, StateNote, UmlState } from "./uml-state";
import {
  addText,
  addTitleLines,
  drawNote,
  finishBounds,
  FONT,
  LINE,
  type Measure,
  SMALL,
  SMALL_LINE,
  wrap,
} from "./text";
import { type ElkLayout, type GraphEdge, type GraphNode, layoutGraph, type Placement } from "./elk";
import { type Box, emptyScene, type Scene, type SceneShape } from "./scene";
import { dodgeTitles, hugLabels, placeGuardLabel, smallSize, wrapSmall } from "./labels";
import { addVertexPorts, END_ROOM, reversePostorder } from "./uml";
import { addWire, attachEnds, spreadVertices, straightenScene } from "./wires";
import { bestScene, FLOW_STRATEGIES } from "./best";

const PAD = 12,
  RADIUS = 10,
  INITIAL = 15,
  FINAL = 17,
  CHOICE = 18,
  BAR = 5;

/**
 * Choice diamonds keep one transition per vertex: a choice that is entered more than once and
 * also branches is preceded by a joining choice, and more than three branches or entries continue
 * in further choices (each passing straight on, so the machine's meaning is unchanged).
 */
function splitChoices(source: StateDiagram): StateDiagram {
  const diagram: StateDiagram = {
    ...source,
    states: new Map(
      [...source.states].map(([id, state]) => [id, { ...state, children: [...state.children] }]),
    ),
    roots: [...source.roots],
    transitions: source.transitions.map((transition) => ({ ...transition })),
  };
  let count = 0;
  const add = (like: UmlState, next: string) => {
    const state: UmlState = { ...like, id: `${like.id}#${next}${++count}`, children: [] };
    diagram.states.set(state.id, state);
    const siblings = like.parent ? diagram.states.get(like.parent)!.children : diagram.roots;
    siblings.splice(siblings.indexOf(like.id), 0, state.id);
    return state;
  };
  const link = (from: string, to: string, line: number) =>
    diagram.transitions.push({ id: `${from}->${to}`, source: from, target: to, line });
  const into = (id: string) =>
    diagram.transitions.filter(
      (transition) => transition.target === id && transition.source !== id,
    );
  const out = (id: string) =>
    diagram.transitions.filter(
      (transition) => transition.source === id && transition.target !== id,
    );
  for (const original of source.states.values()) {
    if (original.kind !== "choice") continue;
    const choice = diagram.states.get(original.id)!;
    let target = choice;
    if (into(choice.id).length >= 2 && out(choice.id).length >= 2) {
      const join = add(choice, "join");
      for (const transition of into(choice.id)) transition.target = join.id;
      link(join.id, choice.id, choice.line);
      target = join;
    }
    while (into(target.id).length > 3) {
      const extra = add(choice, "join");
      for (const transition of into(target.id).slice(2)) transition.target = extra.id;
      link(extra.id, target.id, choice.line);
      target = extra;
    }
    for (let from = choice; out(from.id).length > 3;) {
      const extra = add(choice, "branch");
      for (const transition of out(from.id).slice(2)) transition.source = extra.id;
      link(from.id, extra.id, choice.line);
      from = extra;
    }
  }
  return diagram;
}

export async function layoutStateDiagram(
  source: StateDiagram,
  measure: Measure,
  options: { layout?: ElkLayout } = {},
): Promise<Scene> {
  const diagram = splitChoices(source);
  const vertical = diagram.direction === "TB" || diagram.direction === "BT";
  const degree = new Map<string, { in: number; out: number }>();
  for (const transition of diagram.transitions) {
    if (transition.source === transition.target) continue;
    degree.set(transition.source, {
      in: degree.get(transition.source)?.in ?? 0,
      out: (degree.get(transition.source)?.out ?? 0) + 1,
    });
    degree.set(transition.target, {
      in: (degree.get(transition.target)?.in ?? 0) + 1,
      out: degree.get(transition.target)?.out ?? 0,
    });
  }
  const notes = new Map<string, StateNote[]>();
  for (const note of diagram.notes)
    notes.set(note.target, [...(notes.get(note.target) ?? []), note]);
  const noteSize = (note: StateNote) => {
    const size = smallSize(note.text, measure);
    return { width: size.width + 26, height: size.height + 12 };
  };
  interface Text {
    name: string[];
    descriptions: string[];
    header: number;
  }
  // States in the order the machine reaches them, so source-order layouts start at the initial state
  // and turn back only the transitions that return to a state reached before.
  const rank = flowOrder(diagram);
  const ordered = (ids: string[]) => ids.toSorted((a, b) => rank(a) - rank(b));
  const texts = new Map<string, Text>();

  const build = (id: string): GraphNode => {
    const state = diagram.states.get(id)!;
    // In horizontal layouts self loops take the top, so notes there go below.
    const looped = diagram.transitions.some(
      (transition) => transition.source === id && transition.target === id,
    );
    const sideNotes = (notes.get(id) ?? []).map((note) => ({
      ...noteSize(note),
      placement: vertical
        ? `OUTSIDE ${note.side === "left" ? "H_LEFT" : "H_RIGHT"} V_CENTER`
        : `OUTSIDE ${note.side === "left" && !looped ? "V_TOP" : "V_BOTTOM"} H_CENTER`,
      gap: 28,
    }));
    if (state.kind === "region")
      return {
        id,
        children: ordered(state.children).map(build),
        padding: { top: 10, side: 10 },
        labels: sideNotes,
      };
    if (state.children.length) {
      const name = wrap(state.label, 280, FONT, 600, measure);
      texts.set(id, { name, descriptions: [], header: name.length * LINE + 14 });
      return {
        id,
        children: ordered(state.children).map(build),
        padding: { top: name.length * LINE + 26, side: PAD },
        minWidth: Math.ceil(Math.max(...name.map((line) => measure(line, FONT, 600))) + 2 * PAD),
        radius: RADIUS + 2,
        labels: sideNotes,
      };
    }
    switch (state.kind) {
      case "initial":
        return { id, width: INITIAL, height: INITIAL, centered: true, labels: sideNotes };
      case "final":
        return { id, width: FINAL, height: FINAL, centered: true, labels: sideNotes };
      case "choice": {
        // Room on each side for the wires that meet there.
        const most = Math.max(degree.get(id)?.in ?? 0, degree.get(id)?.out ?? 0),
          size = most <= 3 ? CHOICE : 6 * most + 6;
        return { id, width: size, height: size, centered: size === CHOICE, labels: sideNotes };
      }
      case "fork":
      case "join": {
        const count = Math.max(degree.get(id)?.in ?? 0, degree.get(id)?.out ?? 0);
        const length = Math.max(60, count * 46);
        return {
          id,
          width: vertical ? length : BAR,
          height: vertical ? BAR : length,
          labels: sideNotes,
        };
      }
      default: {
        const name = wrap(state.label, 200, FONT, 400, measure);
        const descriptions = state.descriptions.flatMap((line) =>
          wrap(line, 240, SMALL, 400, measure),
        );
        const header = name.length * LINE + 16;
        texts.set(id, { name, descriptions, header });
        const width = Math.max(
          80,
          ...name.map((line) => measure(line, FONT, 400) + 2 * PAD + 4),
          ...descriptions.map((line) => measure(line, SMALL, 400) + 2 * PAD),
        );
        const height = header + (descriptions.length ? descriptions.length * SMALL_LINE + 12 : 0);
        // The side across the flow holds the transitions along the flow apart with their arrowheads, and one more against it.
        const across = (Math.max(degree.get(id)?.in ?? 0, degree.get(id)?.out ?? 0) + 2) * END_ROOM;
        return {
          id,
          width: Math.ceil(Math.max(width, vertical ? across : 0)),
          height: Math.max(36, Math.ceil(height), vertical ? 0 : across),
          radius: RADIUS,
          labels: sideNotes,
        };
      }
    }
  };
  const roots = ordered(diagram.roots).map(build);
  const labels = new Map(
    diagram.transitions
      .filter((transition) => transition.label)
      .map((transition) => [transition.id, wrapSmall(transition.label!, measure)]),
  );
  const edges: GraphEdge[] = diagram.transitions.map((transition) => ({
    id: transition.id,
    source: transition.source,
    target: transition.target,
    label: labels.has(transition.id) ? smallSize(labels.get(transition.id)!, measure) : undefined,
  }));
  // A note beside a symbol whose vertices all take wires stands in the corner beyond its side
  // instead: ELK reserves the corner and the room toward the symbol, the note takes the far end.
  const cornered = new Set<string>(),
    crowded = addVertexPorts(roots, edges, diagram.direction, rank);
  const corner = (node: GraphNode) => {
    if (crowded.get(node.id)) {
      cornered.add(node.id);
      const width = node.width ?? 0,
        height = node.height ?? 0;
      node.labels = node.labels?.map((label) =>
        vertical
          ? {
              ...label,
              width: label.width + (label.gap ?? 0) + width,
              placement: label.placement.includes("H_LEFT")
                ? "OUTSIDE V_TOP H_RIGHT"
                : "OUTSIDE V_TOP H_LEFT",
            }
          : {
              ...label,
              height: label.height + (label.gap ?? 0) + height,
              placement: label.placement.includes("V_TOP")
                ? "OUTSIDE H_LEFT V_BOTTOM H_PRIORITY"
                : "OUTSIDE H_LEFT V_TOP H_PRIORITY",
            },
      );
    }
    node.children?.forEach(corner);
  };
  roots.forEach(corner);

  const run = async (elk: Record<string, string>) => {
    const placement = await layoutGraph(
      { direction: diagram.direction, children: roots, edges },
      {
        layout: options.layout,
        elk,
        spacing: { layer: 40, node: 30, port: 18 },
      },
    );
    permuteRegions(placement, diagram);
    const scene = emptyScene();
    const depthOf = (id: string) =>
      (placement.ancestors.get(id) ?? []).filter(
        (other) => diagram.states.get(other)?.kind !== "region",
      ).length;
    const order: string[] = [];
    const collect = (id: string) => {
      order.push(id);
      diagram.states.get(id)!.children.forEach(collect);
    };
    diagram.roots.forEach(collect);
    for (const id of order) {
      const state = diagram.states.get(id)!,
        box = placement.boxes.get(id);
      if (!box) continue;
      const depth = depthOf(id),
        cx = box.x + box.width / 2;
      if (state.kind === "region") {
        scene.shapes.push({ id, kind: "region", box, container: true, depth, fill: "none" });
        continue;
      }
      if (state.children.length) {
        const { name, header } = texts.get(id)!;
        scene.shapes.push({
          id,
          kind: "round",
          radius: RADIUS + 2,
          box,
          container: true,
          depth,
          fill: "shade",
          dividers: [box.y + header],
        });
        addTitleLines(scene, measure, name, id, cx, box.y + 7);
        continue;
      }
      const kinds: Record<string, SceneShape["kind"]> = {
        initial: "initial",
        final: "final",
        choice: "diamond",
        fork: "bar",
        join: "bar",
      };
      if (state.kind !== "state") {
        scene.shapes.push({
          id,
          kind: kinds[state.kind],
          box,
          container: false,
          depth,
          fill: "page",
        });
        continue;
      }
      const { name, descriptions, header } = texts.get(id)!;
      scene.shapes.push({
        id,
        kind: "round",
        radius: RADIUS,
        box,
        container: false,
        depth,
        fill: "page",
        dividers: descriptions.length ? [box.y + header] : [],
      });
      const top = descriptions.length ? box.y + 8 : box.y + (box.height - name.length * LINE) / 2;
      name.forEach((line, index) =>
        addText(scene, measure, line, cx, top + LINE / 2 + index * LINE, {
          size: FONT,
          role: "node",
          owner: id,
        }),
      );
      descriptions.forEach((line, index) =>
        addText(
          scene,
          measure,
          line,
          box.x + PAD,
          box.y + header + 6 + SMALL_LINE / 2 + index * SMALL_LINE,
          { size: SMALL, anchor: "start", role: "member", owner: id },
        ),
      );
    }
    regionSeparators(scene, diagram, placement.boxes);
    // Notes sit in the space ELK reserved beside their state, joined to it by a dashed line.
    for (const [target, list] of notes) {
      const boxes = placement.nodeLabels.get(target) ?? [],
        box = placement.boxes.get(target);
      if (!box) continue;
      list.forEach((note, index) => {
        const area = boxes[index];
        if (!area) return;
        // A note in a corner takes the end of its area away from the state.
        const far = (start: number, length: number, extent: number, center: number) =>
          Math.abs(start + extent / 2 - center) > Math.abs(start + length - extent / 2 - center)
            ? start
            : start + length - extent;
        const size = noteSize(note),
          noteBox: Box = cornered.has(target)
            ? {
                x: far(area.x, area.width, size.width, box.x + box.width / 2),
                y: far(area.y, area.height, size.height, box.y + box.height / 2),
                ...size,
              }
            : {
                x: area.x + (area.width - size.width) / 2,
                y: area.y + (area.height - size.height) / 2,
                ...size,
              };
        drawNote(scene, measure, note.id, note.text, noteBox, { depth: depthOf(target) });
        // A short dashed connector between the note and its state, along the axis they share.
        const link = cornered.has(target)
          ? cornerLink(noteBox, box, diagram.states.get(target)!.kind === "choice")
          : noteLink(noteBox, box);
        if (link)
          scene.wires.push({
            edge: `${note.id}:link`,
            points: link,
            dashed: true,
            ends: [note.id, target],
            home: [note.id, target, ...(placement.ancestors.get(target) ?? [])],
            from: note.id,
          });
      });
    }
    const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
    // Transitions out of a choice carry guards: shown next to the choice, as decisions' guards are.
    const guards = new Set(
      diagram.transitions
        .filter(
          (transition) =>
            diagram.states.get(transition.source)?.kind === "choice" && labels.has(transition.id),
        )
        .map((transition) => transition.id),
    );
    for (const transition of diagram.transitions) {
      addWire(
        scene,
        placement,
        {
          id: transition.id,
          source: transition.source,
          target: transition.target,
          endMarker: "arrow",
          label: guards.has(transition.id) ? undefined : labels.get(transition.id),
        },
        shapes,
        measure,
      );
    }
    spreadVertices(scene);
    attachEnds(scene);
    straightenScene(scene);
    attachEnds(scene);
    hugLabels(scene);
    for (const id of guards) placeGuardLabel(scene, measure, id, labels.get(id)!);
    dodgeTitles(scene, measure);
    finishBounds(scene, measure, diagram.title);
    return scene;
  };
  return bestScene(run, FLOW_STRATEGIES, 150);
}

/**
 * Rank of each state in a topological order of the machine without its loops: reverse postorder
 * of a depth-first search from the initial states that follows transitions in source order and
 * enters composites through their initial states. Transitions back to a state on the search path
 * are the loops; unreachable states follow in declaration order, composites rank with their earliest member.
 */
function flowOrder(diagram: StateDiagram): (id: string) => number {
  const outgoing = new Map<string, string[]>();
  for (const transition of diagram.transitions)
    outgoing.set(transition.source, [
      ...(outgoing.get(transition.source) ?? []),
      transition.target,
    ]);
  const initials = (id: string | null): string[] => {
    const children = id ? diagram.states.get(id)!.children : diagram.roots;
    return children.flatMap((child) => {
      const state = diagram.states.get(child)!;
      return state.kind === "initial" ? [child] : state.kind === "region" ? [child] : [];
    });
  };
  const successors = (id: string) => {
    const state = diagram.states.get(id)!;
    return [
      ...(state.kind === "region" || state.children.length
        ? [...initials(id), ...state.children]
        : []),
      ...(outgoing.get(id) ?? []),
    ];
  };
  const order = reversePostorder([...initials(null), ...diagram.states.keys()], successors);
  const memo = new Map<string, number>();
  const rank = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    const value = Math.min(
      order.get(id) ?? Infinity,
      ...diagram.states.get(id)!.children.map(rank),
    );
    memo.set(id, value);
    return value;
  };
  return rank;
}

/**
 * Concurrent regions show in source order. ELK may order them differently; regions that no
 * transition leaves are swapped back into place, with everything inside them.
 */
function permuteRegions(placement: Placement, diagram: StateDiagram) {
  for (const state of diagram.states.values()) {
    const regions = state.children.filter(
      (id) => diagram.states.get(id)?.kind === "region" && placement.boxes.has(id),
    );
    if (regions.length < 2) continue;
    const boxes = regions.map((id) => placement.boxes.get(id)!);
    const sideBySide = boxes.every((a, i) =>
      boxes.every((b, j) => i === j || (a.y < b.y + b.height && b.y < a.y + a.height)),
    );
    const axis = sideBySide ? "x" : "y",
      size = sideBySide ? "width" : "height";
    const current = regions.toSorted(
      (a, b) => placement.boxes.get(a)![axis] - placement.boxes.get(b)![axis],
    );
    if (current.every((id, index) => id === regions[index])) continue;
    // Only self-contained regions move: every transition touching one stays inside it.
    const inside = (region: string, id: string) =>
      id === region || placement.ancestors.get(id)?.includes(region);
    const contained = regions.every((region) =>
      diagram.transitions.every(
        (transition) => inside(region, transition.source) === inside(region, transition.target),
      ),
    );
    if (!contained) continue;
    const start = placement.boxes.get(current[0])![axis];
    const gaps = current
      .slice(1)
      .map(
        (id, index) =>
          placement.boxes.get(id)![axis] -
          placement.boxes.get(current[index])![axis] -
          placement.boxes.get(current[index])![size],
      );
    let at = start;
    regions.forEach((region, index) => {
      const shift = at - placement.boxes.get(region)![axis];
      at += placement.boxes.get(region)![size] + (gaps[index] ?? 0);
      if (!shift) return;
      const move = <T extends { x: number; y: number }>(item: T): T => ({
        ...item,
        [axis]: item[axis] + shift,
      });
      for (const [id, box] of placement.boxes)
        if (inside(region, id)) placement.boxes.set(id, move(box));
      for (const [id, labels] of placement.nodeLabels)
        if (inside(region, id)) placement.nodeLabels.set(id, labels.map(move));
      for (const transition of diagram.transitions) {
        if (!inside(region, transition.source)) continue;
        const route = placement.routes.get(transition.id),
          label = placement.edgeLabels.get(transition.id);
        if (route) placement.routes.set(transition.id, route.map(move));
        if (label) placement.edgeLabels.set(transition.id, move(label));
      }
    });
  }
}

/** A straight dashed line between a note and its state, or null when they do not face each other. */
function noteLink(note: Box, state: Box): { x: number; y: number }[] | null {
  const low = Math.max(note.y, state.y),
    high = Math.min(note.y + note.height, state.y + state.height);
  if (high - low > 4) {
    const y = (low + high) / 2;
    return note.x >= state.x + state.width
      ? [
          { x: note.x, y },
          { x: state.x + state.width, y },
        ]
      : [
          { x: note.x + note.width, y },
          { x: state.x, y },
        ];
  }
  const left = Math.max(note.x, state.x),
    right = Math.min(note.x + note.width, state.x + state.width);
  if (right - left > 4) {
    const x = (left + right) / 2;
    return note.y >= state.y + state.height
      ? [
          { x, y: note.y },
          { x, y: state.y + state.height },
        ]
      : [
          { x, y: note.y + note.height },
          { x, y: state.y },
        ];
  }
  return null;
}

/** A slanted dashed line from a note in a corner to the outline of its small symbol (a diamond's edge, a circle). */
function cornerLink(note: Box, state: Box, diamond: boolean): { x: number; y: number }[] {
  const cx = state.x + state.width / 2,
    cy = state.y + state.height / 2;
  const from = {
    x: Math.max(note.x, Math.min(cx, note.x + note.width)),
    y: Math.max(note.y, Math.min(cy, note.y + note.height)),
  };
  const reach = diamond ? 0.5 : Math.SQRT1_2;
  return [
    from,
    {
      x: cx + ((Math.sign(from.x - cx) * state.width) / 2) * reach,
      y: cy + ((Math.sign(from.y - cy) * state.height) / 2) * reach,
    },
  ];
}

/** Concurrent regions of a composite state are separated by dashed lines through the gaps between them. */
function regionSeparators(scene: Scene, diagram: StateDiagram, boxes: Map<string, Box>) {
  for (const state of diagram.states.values()) {
    const regions = state.children
      .filter((id) => diagram.states.get(id)?.kind === "region")
      .map((id) => boxes.get(id)!)
      .filter(Boolean);
    const outer = boxes.get(state.id);
    if (regions.length < 2 || !outer) continue;
    // Side by side when the regions overlap vertically, else stacked.
    const sideBySide = regions.every((a, i) =>
      regions.every((b, j) => i === j || (a.y < b.y + b.height && b.y < a.y + a.height)),
    );
    const sorted = regions.toSorted((a, b) => (sideBySide ? a.x - b.x : a.y - b.y));
    const top = Math.min(...regions.map((box) => box.y)),
      bottom = Math.max(...regions.map((box) => box.y + box.height));
    const left = Math.min(...regions.map((box) => box.x)),
      right = Math.max(...regions.map((box) => box.x + box.width));
    for (let i = 1; i < sorted.length; i++) {
      const [a, b] = [sorted[i - 1], sorted[i]];
      if (sideBySide) {
        const x = (a.x + a.width + b.x) / 2;
        scene.lines.push({
          points: [
            { x, y: top },
            { x, y: bottom },
          ],
          dashed: true,
          tone: "ink",
          width: 1.2,
        });
      } else {
        const y = (a.y + a.height + b.y) / 2;
        scene.lines.push({
          points: [
            { x: left, y },
            { x: right, y },
          ],
          dashed: true,
          tone: "ink",
          width: 1.2,
        });
      }
    }
  }
}
