/**
 * TAM layout by hand: what stands in a wire's way, and what a line through it costs. The field
 * holds the elements, the containers with their borders and titles, and, as the layout goes on, the
 * wires that lie already and the circles and labels placed on them.
 */

import { type Box, grow, overlaps, type Point, segmentHits } from "./scene.ts";
import type { Measure } from "./text.ts";
import { containerInsets, type TamGraph } from "./tam-graph.ts";
import type { PlacedElements } from "./tam-placed.ts";
import { BORDER, followsBorder, meets, type Run, type Terrain } from "./tam-placed-detour.ts";

/** Something a wire keeps out of, by the id of what it belongs to. */
export interface Wall {
  id: string;
  box: Box;
}

/** Everything a wire can meet. */
export interface Field {
  /** Elements that hold nothing, interface circles and their names: never crossed while a way around exists. */
  solids: Wall[];
  /** Elements that hold others, by their own id. */
  containers: Wall[];
  /** The titles of containers, by the container's id. */
  titles: Wall[];
  /** The wires that lie already, by the key of their bundle. */
  wires: Map<string, Run[]>;
  /** The circles and labels placed already, by the key of their bundle. */
  marks: Map<string, Box[]>;
}

/** The runs of a line, as they lie in the field for other wires to meet. */
export const runsOf = (points: Point[], half: number): Run[] =>
  points.slice(1).map((point, index) => ({
    a: points[index],
    b: point,
    half,
    end: index === 0 || index === points.length - 2,
  }));

/**
 * The field before the first wire lies: the placed `elements`, the interfaces with their lines and
 * names, the rows of dots, and the titles of the containers.
 */
export function fieldOf(
  prepared: TamGraph,
  placed: PlacedElements,
  elements: string[],
  measure: Measure,
): Field {
  const { diagram, shapes } = prepared,
    { boxes } = placed;
  const field: Field = {
    solids: elements
      .filter((id) => !shapes.get(id)!.container)
      .map((id) => ({ id, box: boxes.get(id)! })),
    containers: elements
      .filter((id) => shapes.get(id)!.container)
      .map((id) => ({ id, box: boxes.get(id)! })),
    titles: [],
    wires: new Map(),
    marks: new Map(),
  };
  // Interface circles and their names stand in a wire's way like elements, their lines lie like wires.
  for (const [edge, stub] of placed.stubs) {
    const target = diagram.edges.find((item) => item.id === edge)?.target;
    if (!target || !boxes.has(target)) continue;
    field.solids.push({ id: target, box: boxes.get(target)! });
    for (const box of placed.labels.get(target) ?? []) field.solids.push({ id: target, box });
    field.wires.set(`${edge}\u0000stub`, runsOf(stub, 0));
  }
  // Three dots are as solid as the elements they stand between.
  for (const [id, { center }] of placed.dots)
    field.solids.push({ id, box: { x: center.x - 8, y: center.y - 8, width: 16, height: 16 } });
  // A container's title is crossed like a border: only where no other line is as simple.
  for (const id of elements) {
    const shape = shapes.get(id)!,
      box = boxes.get(id)!;
    if (!shape.container || !shape.lines.length) continue;
    const { top } = containerInsets(shape.node, shape.lines, shape.textWidth, measure);
    field.titles.push({
      id,
      box: {
        x: box.x + box.width / 2 - shape.textWidth / 2 - 4,
        y: box.y + 2,
        width: shape.textWidth + 8,
        height: top - 8,
      },
    });
  }
  return field;
}

/** The wire a line is priced for. */
export interface Traveller {
  /** The key its own wires and marks are filed under in the field. */
  key: string;
  /** Its ends and every container that holds one of them. */
  own: Set<string>;
  /** The elements it joins, which it never runs through; none where one end holds the other. */
  ends: Box[];
  /** The innermost container that holds both ends: the wire stays inside it. */
  home?: Box;
  /** Half of the room it takes across. */
  half: number;
}

/**
 * What a line pays for what it meets, in pixels of wire: an element or a placed circle or label in
 * its way more than any detour, a foreign container, leaving the container of both ends, running on
 * another wire or along a border less, but more than a detour of reasonable length; passing an
 * element closer than an arrowhead is long, a title or a crossing of two wires little. A line that pays TROUBLE or more is worth a search for a way around.
 */
export const THROUGH = 1000,
  MARK = 700,
  FOREIGN = 600,
  LEAVE = 500,
  OVERLAP = 400,
  ALONG = 300,
  SQUEEZE = 150,
  TITLE = 160,
  CROSS = 60,
  TROUBLE = 150;

/** A wire passes an element at NEAR at least, and at CLEAR to stay off the arrowheads that end on it. */
const NEAR = 4,
  CLEAR = 10;

/** The part of the field one wire can meet: what lies in a window around its ends, without its own wires and marks. */
export interface Scope {
  /** The elements, circles and labels as they stand; the other lists hold them with the room a wire keeps. */
  walls: Box[];
  solids: Box[];
  ends: Box[];
  marks: Box[];
  foreign: Box[];
  borders: Box[];
  titles: Box[];
  runs: Run[];
  home?: Box;
  half: number;
}

/** The scope of a wire: everything of the field in `window` that is not its own. */
export function scopeOf(field: Field, traveller: Traveller, window?: Box): Scope {
  const seen = (box: Box) => !window || overlaps(box, window);
  const runs: Run[] = [],
    marks: Box[] = [];
  for (const [key, list] of field.wires)
    if (key !== traveller.key)
      for (const run of list)
        if (
          seen({
            x: Math.min(run.a.x, run.b.x) - 1,
            y: Math.min(run.a.y, run.b.y) - 1,
            width: Math.abs(run.a.x - run.b.x) + 2,
            height: Math.abs(run.a.y - run.b.y) + 2,
          })
        )
          runs.push(run);
  for (const [key, list] of field.marks)
    if (key !== traveller.key) for (const box of list) if (seen(box)) marks.push(box);
  const near = Math.max(CLEAR, traveller.half + 2);
  const solids = field.solids
    .filter((wall) => !traveller.own.has(wall.id) && seen(wall.box))
    .map((wall) => wall.box);
  return {
    walls: [...solids, ...marks],
    solids: solids.map((box) => grow(box, near)),
    ends: traveller.ends.map((box) => grow(box, -1)),
    marks: marks.map((box) => grow(box, traveller.half + 2)),
    foreign: field.containers
      .filter((wall) => !traveller.own.has(wall.id) && seen(wall.box))
      .map((wall) => grow(wall.box, -1)),
    borders: field.containers.filter((wall) => seen(wall.box)).map((wall) => wall.box),
    titles: field.titles.filter((wall) => seen(wall.box)).map((wall) => wall.box),
    runs,
    home: traveller.home,
    half: traveller.half,
  };
}

/** What a line pays for everything it meets in its scope; 0 for a line that meets nothing. */
export function price(scope: Scope, points: Point[]): number {
  let total = 0,
    away = false;
  const entered: Box[] = [],
    followed: Box[] = [];
  const { home } = scope;
  for (let index = 0; index < points.length - 1; index++) {
    const p = points[index],
      q = points[index + 1],
      end = index === 0 || index === points.length - 2;
    for (const box of scope.solids)
      if (segmentHits(p, q, box))
        total += segmentHits(p, q, grow(box, NEAR - CLEAR)) ? THROUGH : SQUEEZE;
    for (const box of scope.ends) if (segmentHits(p, q, box)) total += THROUGH;
    for (const box of scope.marks) if (segmentHits(p, q, box)) total += MARK;
    for (const box of scope.foreign)
      if (segmentHits(p, q, box) && !entered.includes(box)) {
        entered.push(box);
        total += FOREIGN;
      }
    for (const box of scope.titles) if (segmentHits(p, q, box)) total += TITLE;
    for (const box of scope.borders)
      if (followsBorder(p, q, box, BORDER + scope.half) && !followed.includes(box)) {
        followed.push(box);
        total += ALONG;
      }
    if (home)
      for (const point of [p, q])
        if (
          point.x < home.x - 0.5 ||
          point.x > home.x + home.width + 0.5 ||
          point.y < home.y - 0.5 ||
          point.y > home.y + home.height + 0.5
        )
          away = true;
    for (const run of scope.runs) {
      const how = meets(p, q, scope.half, run);
      // Wire ends on one side of an element are told apart along the side once every wire has its line.
      if (how === 2 && !(end && run.end)) total += OVERLAP;
      else if (how === 1) total += CROSS;
    }
  }
  return total + (away ? LEAVE : 0);
}

/** A scope as the terrain of a search for a way around, and the elements the search keeps out of. */
export function terrainOf(scope: Scope): { blocked: { box: Box }[]; terrain: Terrain } {
  return {
    blocked: scope.walls.map((box) => ({ box })),
    terrain: {
      costly: [
        ...scope.foreign.map((box) => ({ box, cost: FOREIGN })),
        ...scope.titles.map((box) => ({ box, cost: TITLE })),
      ],
      home: scope.home ? { box: scope.home, cost: LEAVE } : undefined,
      borders: scope.borders,
      wires: scope.runs,
      cross: CROSS,
      overlap: OVERLAP,
      half: scope.half,
    },
  };
}
