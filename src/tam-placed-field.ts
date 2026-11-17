/**
 * TAM layout by hand: what stands in a wire's way, and what a line through it costs. The field
 * holds the elements, the containers with their borders and titles, and, as the layout goes on, the
 * wires that lie already and the circles and labels placed on them.
 */

import { type Box, grow, overlaps, type Point, segmentHits } from "./scene.ts";
import type { Measure } from "./text.ts";
import { containerInsets, type Shape, type TamGraph } from "./tam-graph.ts";
import type { PlacedElements } from "./tam-placed.ts";
import type { Side } from "./tam-placed.ts";
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

/**
 * The runs of a line, as they lie in the field for other wires to meet; `sides` are the keys of the
 * sides its first and its last run end on.
 */
export const runsOf = (points: Point[], half: number, sides: string[] = []): Run[] =>
  points.slice(1).map((point, index) => ({
    a: points[index],
    b: point,
    half,
    sides: [
      ...(index === 0 ? sides.slice(0, 1) : []),
      ...(index === points.length - 2 ? sides.slice(1) : []),
    ],
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
  const { shapes } = prepared,
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
  addInterfaces(field, prepared, placed);
  // Three dots are as solid as the elements they stand between.
  for (const [id, { center }] of placed.dots)
    field.solids.push({ id, box: { x: center.x - 8, y: center.y - 8, width: 16, height: 16 } });
  // A container's title stands in a wire's way: it is crossed only where no other line leads on.
  for (const id of elements) {
    const title = titleOf(shapes.get(id)!, boxes.get(id)!, measure);
    if (title) field.titles.push({ id, box: title });
  }
  return field;
}

/** Interface circles and their names stand in a wire's way like elements, their lines lie like wires. */
function addInterfaces(field: Field, { diagram }: TamGraph, placed: PlacedElements) {
  const { boxes } = placed;
  for (const [edge, stub] of placed.stubs) {
    const target = diagram.edges.find((item) => item.id === edge)?.target;
    if (!target || !boxes.has(target)) continue;
    field.solids.push({ id: target, box: boxes.get(target)! });
    for (const box of placed.labels.get(target) ?? []) field.solids.push({ id: target, box });
    field.wires.set(`${edge}\u0000stub`, runsOf(stub, 0));
  }
}

/** Where the title of a container stands in its box; nothing for a leaf or a container without a name. */
function titleOf(shape: Shape, box: Box, measure: Measure): Box | undefined {
  if (!shape.container || !shape.lines.length) return undefined;
  const { top } = containerInsets(shape.node, shape.lines, shape.textWidth, measure);
  return {
    x: box.x + box.width / 2 - shape.textWidth / 2 - 4,
    y: box.y + 2,
    width: shape.textWidth + 8,
    height: top - 8,
  };
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
  /** The keys of the sides of its two ends, for the wire ends that lie on them. */
  sides?: [Record<Side, string>, Record<Side, string>];
}

/**
 * What a line pays for what it meets, in pixels of wire: an element or a placed circle or label in
 * its way more than any detour; running along inside a title, a foreign container, leaving the
 * container of both ends, running on or beside another wire, turning on one, crossing a title or
 * running along a border less, but more than a detour of reasonable length; passing an element
 * closer than an arrowhead is long or a crossing of two wires little. A line that pays TROUBLE or
 * more is worth a search for a way around.
 */
const THROUGH = 3000,
  MARK = 1500,
  OVERLAP = 1200,
  FOREIGN = 1000,
  LEAVE = 900,
  STRIKE = 900,
  ALONG = 600,
  TITLE = 300,
  SQUEEZE = 150,
  CROSS = 60,
  TROUBLE = 150;

export { ALONG, THROUGH, TROUBLE };

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
  sides?: [Record<Side, string>, Record<Side, string>];
}

/** The box a run of wire covers, a pixel wider on every side. */
const runBox = (run: Run): Box => ({
  x: Math.min(run.a.x, run.b.x) - 1,
  y: Math.min(run.a.y, run.b.y) - 1,
  width: Math.abs(run.a.x - run.b.x) + 2,
  height: Math.abs(run.a.y - run.b.y) + 2,
});

/** What the field holds of other wires than the traveller's, under their bundle's key, where `seen` sees it. */
function othersOf<T>(filed: Map<string, T[]>, traveller: Traveller, seen: (item: T) => boolean) {
  const found: T[] = [];
  for (const [key, list] of filed)
    if (key !== traveller.key) for (const item of list) if (seen(item)) found.push(item);
  return found;
}

/** The scope of a wire: everything of the field in `window` that is not its own. */
export function scopeOf(field: Field, traveller: Traveller, window?: Box): Scope {
  const seen = (box: Box) => !window || overlaps(box, window);
  const runs = othersOf(field.wires, traveller, (run) => seen(runBox(run))),
    marks = othersOf(field.marks, traveller, seen);
  const near = Math.max(CLEAR, traveller.half + 6);
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
    titles: field.titles
      .filter((wall) => seen(wall.box))
      .map((wall) => grow(wall.box, traveller.half)),
    runs,
    home: traveller.home,
    half: traveller.half,
    sides: traveller.sides,
  };
}

/** What a run from `p` to `q` pays for the elements, wire ends and marks in its way. */
function wallsPrice(scope: Scope, p: Point, q: Point): number {
  let total = 0;
  for (const box of scope.solids)
    if (segmentHits(p, q, box))
      total += segmentHits(p, q, grow(box, NEAR - CLEAR)) ? THROUGH : SQUEEZE;
  for (const box of scope.ends) if (segmentHits(p, q, box)) total += THROUGH;
  for (const box of scope.marks) if (segmentHits(p, q, box)) total += MARK;
  return total;
}

/**
 * What a run pays for the containers it meets: each foreign container it enters and each border it
 * runs along once for the whole line, which `entered` and `followed` keep track of.
 */
function containersPrice(
  scope: Scope,
  p: Point,
  q: Point,
  entered: Box[],
  followed: Box[],
): number {
  let total = 0;
  for (const box of scope.foreign)
    if (segmentHits(p, q, box) && !entered.includes(box)) {
      entered.push(box);
      total += FOREIGN;
    }
  for (const box of scope.borders)
    if (followsBorder(p, q, box, BORDER + scope.half) && !followed.includes(box)) {
      followed.push(box);
      total += ALONG;
    }
  return total;
}

/** What a run pays for the titles in its way: one along a title strikes it through, one across it only cuts it. */
function titlesPrice(scope: Scope, p: Point, q: Point): number {
  let total = 0;
  for (const box of scope.titles)
    if (segmentHits(p, q, box)) total += Math.abs(p.y - q.y) < 0.5 ? STRIKE : TITLE;
  return total;
}

/** Whether a corner lies outside `home`, with `by` of the wire's room kept inside. */
const outside = (point: Point, home: Box, by: number) =>
  point.x < home.x + by - 0.5 ||
  point.x > home.x + home.width - by + 0.5 ||
  point.y < home.y + by - 0.5 ||
  point.y > home.y + home.height - by + 0.5;

/** What a run pays for the wires it crosses or lies on; `mine` are the keys of the sides it ends on. */
function wiresPrice(scope: Scope, p: Point, q: Point, mine: (string | undefined)[]): number {
  let total = 0;
  for (const run of scope.runs) {
    const how = meets(p, q, scope.half, run);
    if (how === 1) total += CROSS;
    else if (how && !mine.some((key) => key && run.sides?.includes(key))) total += OVERLAP;
  }
  return total;
}

/**
 * What a line pays for everything it meets in its scope; 0 for a line that meets nothing. `from`
 * and `to` are the sides it leaves and enters by: a wire end that lies on one of them already is
 * told apart from the line's own along the side, so the two may lie on each other.
 */
export function price(scope: Scope, points: Point[], from?: Side, to?: Side): number {
  let total = 0;
  const first = from && scope.sides?.[0][from],
    last = to && scope.sides?.[1][to];
  const entered: Box[] = [],
    followed: Box[] = [],
    lastRun = points.length - 2;
  for (let index = 0; index <= lastRun; index++) {
    const p = points[index],
      q = points[index + 1],
      mine = [index === 0 ? first : undefined, index === lastRun ? last : undefined];
    total +=
      wallsPrice(scope, p, q) +
      containersPrice(scope, p, q, entered, followed) +
      titlesPrice(scope, p, q) +
      wiresPrice(scope, p, q, mine);
  }
  return total + (leavesHome(scope, points) ? LEAVE : 0);
}

/** Whether a corner of a line lies outside the container of both ends, with all of the wire's room; its ends need none. */
function leavesHome({ home, half }: Scope, points: Point[]): boolean {
  if (!home || points.length < 2) return false;
  const last = points.length - 1;
  return points.some((point, index) => outside(point, home, index > 0 && index < last ? half : 0));
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
      sides: scope.sides,
    },
  };
}
