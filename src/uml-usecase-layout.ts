/** Use case diagrams: actors and use cases in rows inside their system boundaries, laid out from the longest paths. */

import { dodgeTitles, smallSize, wrapSmall } from "./labels.ts";
import { type Box, centerOf, distance, emptyScene, type Scene } from "./scene.ts";
import {
  addText,
  addTitleLines,
  drawNote,
  finishBounds,
  FONT,
  LINE,
  type Measure,
  SMALL,
  wrap,
} from "./text.ts";
import { reversePostorder } from "./uml.ts";
import type { Boundary, UseCaseDiagram } from "./uml-usecase.ts";
import { drawLine, drawLoop, labelLine, type Link } from "./uml-usecase-lines.ts";

const FIGURE = { width: 26, height: 42 };

/** Space between the elements of a column, between columns, around a boundary's use cases, and between boundaries. */
const ROW_GAP = 26,
  COLUMN_GAP = 70,
  PAD = 24,
  GROUP_GAP = 40;

/**
 * The layout is structured as use case diagrams are drawn. Actors stand in columns outside the
 * system boundaries: those who start their use cases on the left, machine actors and actors the
 * use cases call on the right, and an actor that specializes another one column further out. Each
 * boundary holds its use cases in columns: a use case right of the use cases that include it, an
 * extension right of the use case it extends, a specialization right of the general use case.
 * Boundaries stand one above the other between the actor columns. Columns are ordered so lines
 * cross little, and each element stands level with the elements it is related to where the others
 * leave room. The layout works in a frame where columns follow each other along x; in TB the frame
 * is turned by 90 degrees.
 */
export async function layoutUseCaseDiagram(
  diagram: UseCaseDiagram,
  measure: Measure,
): Promise<Scene> {
  const transposed = diagram.direction === "TB" || diagram.direction === "BT",
    mirrored = diagram.direction === "RL" || diagram.direction === "BT";
  interface Shape {
    width: number;
    height: number;
    lines: string[];
    stereotype?: string;
    below?: { width: number; height: number };
  }
  const shapes = new Map<string, Shape>();
  for (const item of diagram.elements.values()) {
    if (item.shape === "figure") {
      const lines = wrap(item.label, 120, FONT, 400, measure);
      // The figure and its name below, so lines never cross the name.
      const below = {
        width: Math.ceil(Math.max(...lines.map((line) => measure(line, FONT, 400)))),
        height: lines.length * LINE,
      };
      shapes.set(item.id, {
        width: Math.ceil(Math.max(FIGURE.width, below.width + 8)),
        height: FIGURE.height + 8 + below.height,
        lines,
        below,
      });
    } else if (item.shape === "box") {
      const lines = wrap(item.label, 150, FONT, 400, measure),
        stereotype = `«${item.stereotype}»`;
      const width = Math.max(
        ...lines.map((line) => measure(line, FONT, 400)),
        measure(stereotype, SMALL, 400),
      );
      shapes.set(item.id, {
        width: Math.ceil(Math.max(90, width + 24)),
        height: lines.length * LINE + 15 + 16,
        lines,
        stereotype,
      });
    } else {
      const lines = wrap(item.label, 140, FONT, 400, measure);
      const tw = Math.max(...lines.map((line) => measure(line, FONT, 400))),
        th = lines.length * LINE;
      // An ellipse around the text box: half axes √2 times the half text box, plus a margin.
      shapes.set(
        item.id,
        item.shape === "rect"
          ? { width: Math.ceil(Math.max(90, tw + 28)), height: Math.max(38, th + 18), lines }
          : {
              width: Math.ceil(Math.max(96, tw * 1.42 + 20)),
              height: Math.ceil(Math.max(46, th * 1.42 + 16)),
              lines,
            },
      );
    }
  }
  for (const note of diagram.notes) {
    const size = smallSize(note.text, measure);
    shapes.set(note.id, { width: size.width + 26, height: size.height + 12, lines: [] });
  }
  const titles = new Map(
    [...diagram.boundaries.values()].map((boundary) => [
      boundary.id,
      wrap(boundary.label, 320, FONT, 600, measure),
    ]),
  );
  const labels = new Map(
    diagram.relations
      .filter((relation) => relation.label)
      .map((relation) => [relation.id, wrapSmall(relation.label!, measure)]),
  );

  // Frame sizes and centers.
  const nodes = new Map(
    [...shapes].map(([id, shape]) => [
      id,
      {
        w: transposed ? shape.height : shape.width,
        h: transposed ? shape.width : shape.height,
        x: 0,
        y: 0,
      },
    ]),
  );
  const element = (id: string) => diagram.elements.get(id)!;
  const isActor = (id: string) => element(id).kind === "actor";
  const relations = diagram.relations.filter((relation) => relation.source !== relation.target);
  const neighbours = new Map<string, string[]>();
  for (const { source, target } of relations) {
    neighbours.set(source, [...(neighbours.get(source) ?? []), target]);
    neighbours.set(target, [...(neighbours.get(target) ?? []), source]);
  }

  // Boundaries in source order, then the use cases outside every boundary; columns by longest path.
  const useCases = [...diagram.elements.values()].filter((item) => item.kind === "usecase");
  const groups = [...diagram.boundaries.values()].map((boundary) => ({
    id: boundary.id,
    boundary: boundary as Boundary | undefined,
    members: useCases.filter((item) => item.boundary === boundary.id).map((item) => item.id),
  }));
  if (useCases.some((item) => !item.boundary))
    groups.push({
      id: "",
      boundary: undefined,
      members: useCases.filter((item) => !item.boundary).map((item) => item.id),
    });
  const layerOf = new Map<string, number>();
  for (const group of groups) {
    const inside = new Set(group.members);
    const edges = relations
      .filter((relation) => inside.has(relation.source) && inside.has(relation.target))
      .map(
        (relation) =>
          (relation.kind === "extend" || relation.kind === "generalization"
            ? [relation.target, relation.source]
            : [relation.source, relation.target]) as [string, string],
      );
    for (const [id, layer] of longestPath(group.members, edges)) layerOf.set(id, layer);
  }
  const layerCount = Math.max(1, ...[...layerOf.values()].map((layer) => layer + 1));
  const layers = groups.map((group) =>
    Array.from({ length: layerCount }, (_, layer) =>
      group.members.filter((id) => layerOf.get(id) === layer),
    ),
  );

  // Actor sides: right for machine actors, actors their use cases call, and actors whose use cases
  // all stand in the last column; others left. An actor without use cases goes with the actors it relates to.
  const actors = [...diagram.elements.values()]
    .filter((item) => item.kind === "actor")
    .map((item) => item.id);
  const side = new Map<string, "left" | "right">();
  for (const id of actors) {
    const links = relations.filter(
      (relation) =>
        (relation.source === id && !isActor(relation.target)) ||
        (relation.target === id && !isActor(relation.source)),
    );
    if (!links.length) continue;
    const others = links.map((relation) =>
      relation.source === id ? relation.target : relation.source,
    );
    const last = layerCount > 1 && others.every((other) => layerOf.get(other) === layerCount - 1);
    side.set(
      id,
      element(id).shape === "box" || links.every((relation) => relation.target === id) || last
        ? "right"
        : "left",
    );
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const id of actors) {
      const known = side.has(id)
        ? undefined
        : (neighbours.get(id) ?? []).find((other) => isActor(other) && side.has(other));
      if (known) {
        side.set(id, side.get(known)!);
        changed = true;
      }
    }
  }
  for (const id of actors) if (!side.has(id)) side.set(id, "left");
  // Specialized actors one column further out than the actor they specialize.
  const depth = longestPath(
    actors,
    relations
      .filter(
        (relation) =>
          relation.kind === "generalization" &&
          isActor(relation.source) &&
          isActor(relation.target) &&
          side.get(relation.source) === side.get(relation.target),
      )
      .map((relation) => [relation.target, relation.source] as [string, string]),
  );
  const actorColumns = (which: "left" | "right") => {
    const mine = actors.filter((id) => side.get(id) === which);
    return Array.from(
      { length: Math.max(0, ...mine.map((id) => depth.get(id)! + 1)) },
      (_, level) => mine.filter((id) => depth.get(id) === level),
    );
  };
  const left = actorColumns("left"),
    right = actorColumns("right");
  // Columns in frame order, left to right: outer actors first.
  const columns = [
    ...left.toReversed(),
    ...Array.from({ length: layerCount }, (_, layer) => layers.flatMap((list) => list[layer])),
    ...right,
  ];
  const columnOf = new Map(
    columns.flatMap((list, index) => list.map((id) => [id, index] as const)),
  );

  // Order: each column sorted by where its elements' relatives stand (the barycenter of the actors
  // and use cases related to them), a few sweeps each way; use cases stay in their boundary.
  // Positions estimate the drawing: columns centered, one step per element, boundaries one above the other.
  const lists = [...left, ...layers.flat(), ...right];
  const step = Math.max(1, ...lists.map((list) => list.length));
  const position = new Map<string, number>();
  const measurePositions = () => {
    for (const list of [...left, ...right])
      list.forEach((id, index) =>
        position.set(id, (groups.length * step) / 2 + index - (list.length - 1) / 2),
      );
    layers.forEach((group, index) =>
      group.forEach((list) =>
        list.forEach((id, row) =>
          position.set(id, (index + 0.5) * step + row - (list.length - 1) / 2),
        ),
      ),
    );
  };
  measurePositions();
  for (let sweep = 0; sweep < 6; sweep++) {
    for (const list of sweep % 2 ? lists.toReversed() : lists) {
      const center = (id: string) => {
        const near = (neighbours.get(id) ?? []).filter(
          (other) => columnOf.get(other) !== columnOf.get(id),
        );
        return near.length
          ? near.reduce((sum, other) => sum + position.get(other)!, 0) / near.length
          : position.get(id)!;
      };
      const wanted = new Map(list.map((id) => [id, center(id)]));
      list.sort((a, b) => wanted.get(a)! - wanted.get(b)!);
      measurePositions();
    }
  }
  // Then neighbours in a column swap places while that saves crossings, counted on lines between
  // the columns' positions.
  const spans = relations.filter(
    (relation) => columnOf.get(relation.source) !== columnOf.get(relation.target),
  );
  const crossed = () => {
    const ends = spans.map((relation) => {
      const [a, b] = [relation.source, relation.target].toSorted(
        (p, q) => columnOf.get(p)! - columnOf.get(q)!,
      );
      return {
        c0: columnOf.get(a)!,
        y0: position.get(a)!,
        c1: columnOf.get(b)!,
        y1: position.get(b)!,
      };
    });
    const at = (end: (typeof ends)[number], c: number) =>
      end.y0 + ((end.y1 - end.y0) * (c - end.c0)) / (end.c1 - end.c0);
    let count = 0;
    ends.forEach((p, i) =>
      ends.slice(i + 1).forEach((q) => {
        const lo = Math.max(p.c0, q.c0),
          hi = Math.min(p.c1, q.c1);
        if (hi > lo && (at(p, lo) - at(q, lo)) * (at(p, hi) - at(q, hi)) < 0) count++;
      }),
    );
    return count;
  };
  for (let pass = 0, better = true; pass < 6 && better; pass++) {
    better = false;
    for (const list of lists)
      for (let k = 1; k < list.length; k++) {
        const before = crossed();
        [list[k - 1], list[k]] = [list[k], list[k - 1]];
        measurePositions();
        if (crossed() < before) {
          better = true;
          continue;
        }
        [list[k - 1], list[k]] = [list[k], list[k - 1]];
        measurePositions();
      }
  }
  // Notes stand right after their target in its column.
  diagram.notes.forEach((note, index) => {
    const list = lists.find((item) => item.includes(note.target));
    list?.splice(
      list.indexOf(note.target) +
        1 +
        diagram.notes.slice(0, index).filter((other) => other.target === note.target).length,
      0,
      note.id,
    );
  });
  const noteTarget = new Map(diagram.notes.map((note) => [note.id, note.target]));

  // Across the columns (frame y): boundaries one above the other, each as tall as its tallest column.
  const length = (list: string[]) =>
    list.reduce((sum, id) => sum + nodes.get(id)!.h, 0) + Math.max(0, list.length - 1) * ROW_GAP;
  const titleRoom = (group: (typeof groups)[number]) =>
    group.boundary ? titles.get(group.id)!.length * LINE + 20 : 0;
  const titleWidth = (group: (typeof groups)[number]) =>
    group.boundary
      ? Math.ceil(Math.max(...titles.get(group.id)!.map((line) => measure(line, FONT, 600)))) + 36
      : 0;
  // Padding around a boundary's use cases in the frame; the title goes to the side that is the top in the drawing.
  const pads = groups.map((group) => {
    if (!group.boundary) return { x0: 0, x1: 0, y0: 0, y1: 0 };
    const title = titleRoom(group);
    return !transposed
      ? { x0: PAD, x1: PAD, y0: title, y1: 18 }
      : mirrored
        ? { x0: 18, x1: title, y0: PAD, y1: PAD }
        : { x0: title, x1: 18, y0: PAD, y1: PAD };
  });
  const bands: { top: number; lo: number; hi: number; bottom: number }[] = [];
  groups.reduce((y, group, index) => {
    const pad = pads[index],
      inner = Math.max(
        20,
        ...layers[index].map(length),
        transposed ? titleWidth(group) - pad.y0 - pad.y1 : 0,
      );
    bands.push({
      top: y,
      lo: y + pad.y0,
      hi: y + pad.y0 + inner,
      bottom: y + pad.y0 + inner + pad.y1,
    });
    return y + pad.y0 + inner + pad.y1 + GROUP_GAP;
  }, 0);
  // Each element as near the middle of its relatives as its column allows: use cases first centered
  // in their boundary, then actors level with their use cases and use cases with their relatives.
  const nodeY = (id: string) => nodes.get(id)!.y;
  const settle = (list: string[], wanted: (id: string) => number, lo?: number, hi?: number) => {
    const ys = spread(
      list.map((id) => nodes.get(id)!.h),
      list.map(wanted),
      ROW_GAP,
      lo,
      hi,
    );
    list.forEach((id, index) => {
      nodes.get(id)!.y = ys[index];
    });
  };
  const relatives = (id: string) => {
    if (noteTarget.has(id)) {
      const target = noteTarget.get(id)!;
      return nodeY(target) + (nodes.get(target)!.h + nodes.get(id)!.h) / 2 + ROW_GAP;
    }
    const near = (neighbours.get(id) ?? []).filter(
      (other) => columnOf.get(other) !== columnOf.get(id),
    );
    return near.length
      ? near.reduce((sum, other) => sum + nodeY(other), 0) / near.length
      : nodeY(id);
  };
  layers.forEach((group, index) =>
    group.forEach((list) =>
      settle(list, () => (bands[index].lo + bands[index].hi) / 2, bands[index].lo, bands[index].hi),
    ),
  );
  const actorLists = [...left, ...right].filter((list) => list.length);
  for (let round = 0; round < 3; round++) {
    for (const list of actorLists) settle(list, relatives);
    layers.forEach((group, index) =>
      group.forEach((list) => settle(list, relatives, bands[index].lo, bands[index].hi)),
    );
  }
  for (const list of actorLists) settle(list, relatives);

  // Along the frame (x): columns side by side; between two columns room for the labels of the lines
  // that join them, and around the use cases the boundaries' padding.
  const widths = columns.map((list, index) =>
    Math.max(
      0,
      ...list.map((id) => nodes.get(id)!.w),
      ...[...noteTarget]
        .filter(([, target]) => columnOf.get(target) === index)
        .map(([id]) => nodes.get(id)!.w),
    ),
  );
  const gapAfter = (index: number) =>
    Math.max(
      COLUMN_GAP,
      ...relations
        .filter(
          (relation) =>
            labels.has(relation.id) &&
            Math.min(columnOf.get(relation.source)!, columnOf.get(relation.target)!) === index &&
            Math.abs(columnOf.get(relation.source)! - columnOf.get(relation.target)!) === 1,
        )
        .map((relation) => {
          const size = smallSize(labels.get(relation.id)!, measure);
          return (transposed ? size.height : size.width) + 50;
        }),
    );
  const x0 = Math.max(0, ...pads.map((pad) => pad.x0)),
    x1 = Math.max(0, ...pads.map((pad) => pad.x1));
  const first = left.length,
    last = left.length + layerCount - 1;
  const columnX: number[] = [];
  let cursor = 0,
    groupLeft = 0,
    groupRight = 0;
  columns.forEach((_, index) => {
    if (index === first) {
      groupLeft = cursor;
      cursor += x0;
    }
    columnX[index] = cursor + widths[index] / 2;
    cursor += widths[index];
    if (index === last) {
      cursor += x1;
      // A boundary at least as wide as its title in LR.
      const extra = transposed ? 0 : Math.max(0, ...groups.map(titleWidth)) - (cursor - groupLeft);
      if (extra > 0) {
        for (let k = first; k <= last; k++) columnX[k] += extra / 2;
        cursor += extra;
      }
      groupRight = cursor;
    }
    cursor += gapAfter(index);
  });
  for (const [id, index] of columnOf) nodes.get(id)!.x = columnX[index];
  for (const id of noteTarget.keys()) {
    const target = noteTarget.get(id)!;
    if (columnOf.has(target)) nodes.get(id)!.x = columnX[columnOf.get(target)!];
  }

  // Into the drawing: turned for TB, mirrored for RL and BT.
  const toDrawing = (box: Box): Box => {
    const along = mirrored ? -(box.x + box.width) : box.x;
    return transposed
      ? { x: box.y, y: along, width: box.height, height: box.width }
      : { x: along, y: box.y, width: box.width, height: box.height };
  };
  const boxOf = (id: string) => {
    const node = nodes.get(id)!;
    return toDrawing({
      x: node.x - node.w / 2,
      y: node.y - node.h / 2,
      width: node.w,
      height: node.h,
    });
  };
  const scene = emptyScene();
  groups.forEach((group, index) => {
    if (!group.boundary) return;
    const box = toDrawing({
      x: groupLeft,
      y: bands[index].top,
      width: groupRight - groupLeft,
      height: bands[index].bottom - bands[index].top,
    });
    scene.shapes.push({
      id: group.id,
      kind: "rect",
      box,
      container: true,
      depth: 0,
      fill: "shade",
    });
    addTitleLines(
      scene,
      measure,
      titles.get(group.id)!,
      group.id,
      box.x + box.width / 2,
      box.y + 10,
    );
  });
  for (const item of diagram.elements.values()) {
    const box = boxOf(item.id),
      shape = shapes.get(item.id)!;
    const depth = item.boundary ? 1 : 0,
      cx = box.x + box.width / 2;
    if (item.shape === "figure") {
      scene.shapes.push({
        id: item.id,
        kind: "actor",
        box,
        container: false,
        depth,
        fill: "page",
        tab: FIGURE,
      });
      shape.lines.forEach((line, index) =>
        addText(scene, measure, line, cx, box.y + FIGURE.height + 4 + LINE / 2 + index * LINE, {
          size: FONT,
          role: "node",
          owner: item.id,
        }),
      );
      continue;
    }
    scene.shapes.push({
      id: item.id,
      kind: item.shape === "ellipse" ? "ellipse" : "rect",
      box,
      container: false,
      depth,
      fill: "page",
    });
    let top = box.y + (box.height - shape.lines.length * LINE) / 2;
    if (shape.stereotype) {
      addText(scene, measure, shape.stereotype, cx, box.y + 8 + 7.5, {
        size: SMALL,
        tone: "secondary",
        role: "stereotype",
        owner: item.id,
      });
      top = box.y + 8 + 15 + 2;
    }
    shape.lines.forEach((line, index) =>
      addText(scene, measure, line, cx, top + LINE / 2 + index * LINE, {
        size: FONT,
        role: "node",
        owner: item.id,
      }),
    );
  }
  for (const note of diagram.notes) {
    const box = boxOf(note.id);
    drawNote(scene, measure, note.id, note.text, box);
  }

  // Lines: those between use cases first, then the actors', then the notes'; short ones first.
  // Their labels' room is reserved in the gaps between the columns.
  const shapeIndex = new Map(scene.shapes.map((shape) => [shape.id, shape]));
  const links: Link[] = [
    ...relations.map((relation) => ({
      ...relation,
      dashed: relation.kind === "include" || relation.kind === "extend",
    })),
    ...diagram.notes.map((note) => ({
      id: `${note.id}:link`,
      source: note.id,
      target: note.target,
      dashed: true,
    })),
  ];
  const rank = (link: Link) =>
    noteTarget.has(link.source) ? 2 : isActor(link.source) || isActor(link.target) ? 1 : 0;
  const span = (link: Link) =>
    distance(
      centerOf(shapeIndex.get(link.source)!.box),
      centerOf(shapeIndex.get(link.target)!.box),
    );
  links.sort((a, b) => rank(a) - rank(b) || span(a) - span(b));
  for (const link of links)
    drawLine(
      scene,
      shapeIndex,
      link,
      new Set([
        link.source,
        link.target,
        ...[link.source, link.target].flatMap((id) => diagram.elements.get(id)?.boundary ?? []),
      ]),
    );
  for (const relation of diagram.relations.filter(
    (relation) => relation.source === relation.target,
  ))
    drawLoop(scene, shapeIndex.get(relation.source)!, {
      ...relation,
      dashed: relation.kind === "include" || relation.kind === "extend",
    });
  // Labels once every line is drawn, each beside its line where nothing else is.
  for (const link of [...links, ...diagram.relations]) {
    const text = labels.get(link.id);
    if (text && !scene.texts.some((item) => item.owner === link.id))
      labelLine(scene, measure, link.id, text);
  }
  dodgeTitles(scene, measure);
  finishBounds(scene, measure, diagram.title);
  return scene;
}

/** Layers of a graph by longest path; edges that close a cycle (against a depth-first order) do not count. */
function longestPath(ids: string[], edges: [string, string][]): Map<string, number> {
  const next = new Map<string, string[]>();
  for (const [a, b] of edges) next.set(a, [...(next.get(a) ?? []), b]);
  const targets = new Set(edges.map(([, b]) => b));
  const order = reversePostorder(
    [...ids.filter((id) => !targets.has(id)), ...ids],
    (id) => next.get(id) ?? [],
  );
  const layer = new Map<string, number>();
  for (const id of order.keys())
    layer.set(
      id,
      Math.max(
        0,
        ...edges
          .filter(([a, b]) => b === id && order.get(a)! < order.get(id)!)
          .map(([a]) => layer.get(a)! + 1),
      ),
    );
  return layer;
}

/**
 * Centers along a column for items of the given sizes, in order and `gap` apart, each as near its
 * wanted center as the others allow, within `lo` and `hi`: touching items form blocks centered on
 * what their members want, merged until none overlap.
 */
function spread(
  sizes: number[],
  wanted: number[],
  gap: number,
  lo = -Infinity,
  hi = Infinity,
): number[] {
  const offset = (first: number, k: number) =>
    sizes.slice(first, k).reduce((sum, size) => sum + size + gap, 0) + sizes[k] / 2;
  const blocks = sizes.map((_, index) => ({ first: index, last: index }));
  const top = (block: (typeof blocks)[number]) => {
    let sum = 0;
    for (let k = block.first; k <= block.last; k++) sum += wanted[k] - offset(block.first, k);
    return sum / (block.last - block.first + 1);
  };
  for (let merged = true; merged;) {
    merged = false;
    for (let k = 1; k < blocks.length; k++) {
      const a = blocks[k - 1],
        b = blocks[k];
      if (top(a) + offset(a.first, a.last) + sizes[a.last] / 2 + gap <= top(b)) continue;
      a.last = b.last;
      blocks.splice(k, 1);
      merged = true;
      break;
    }
  }
  const centers: number[] = [];
  for (const block of blocks) {
    const start = top(block);
    for (let k = block.first; k <= block.last; k++) centers[k] = start + offset(block.first, k);
  }
  for (let k = 0; k < centers.length; k++)
    centers[k] = Math.max(
      centers[k],
      (k ? centers[k - 1] + sizes[k - 1] / 2 + gap : lo) + sizes[k] / 2,
    );
  for (let k = centers.length - 1; k >= 0; k--)
    centers[k] = Math.min(
      centers[k],
      (k < centers.length - 1 ? centers[k + 1] - sizes[k + 1] / 2 - gap : hi) - sizes[k] / 2,
    );
  return centers;
}
