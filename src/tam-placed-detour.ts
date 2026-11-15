/**
 * TAM layout by hand: a wire's way around the elements between its ends, for the pairs no line of
 * two corners joins. A shortest-path search over the lines that pass the elements at a distance.
 */

import { type Box, centerOf, grow, type Point, segmentHits, simplifyPath } from "./scene.ts";
import { type Side, sidePoint } from "./tam-placed.ts";

/** A wire's line from one element to another, and the sides it leaves and enters by. */
export interface Line {
  from: Side;
  to: Side;
  points: Point[];
  /** How many of its ends leave their side off its middle. */
  off?: number;
}

/** Which way a side faces along its axis: down and right count up. */
export const outward = (side: Side) => (side === "bottom" || side === "right" ? 1 : -1);

/** A detour passes elements at this distance, and a corner costs as much as this many pixels of wire. */
const PASS = 14,
  CORNER = 60;

/** Beyond this many crossings of lines the search is not worth its time: the wire runs straight through. */
const LIMIT = 40_000;

const SIDES: Side[] = ["top", "right", "bottom", "left"];

/** The step of each direction; a side's index is the direction it faces. */
const STEPS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** A queue that gives its cheapest entry first. */
class Heap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(cost: number, value: number) {
    const { items } = this;
    let index = items.push([cost, value]) - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent][0] <= items[index][0]) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }
  pop(): [number, number] {
    const { items } = this,
      top = items[0],
      last = items.pop()!;
    if (items.length) {
      items[0] = last;
      for (let index = 0; ;) {
        const left = 2 * index + 1,
          right = left + 1;
        let least = index;
        if (left < items.length && items[left][0] < items[least][0]) least = left;
        if (right < items.length && items[right][0] < items[least][0]) least = right;
        if (least === index) break;
        [items[least], items[index]] = [items[index], items[least]];
        index = least;
      }
    }
    return top;
  }
}

/**
 * The cheapest line from `a` to `b` around the `blocked` elements: it leaves and enters at the
 * middle of a side and turns only on the lines that pass an element at PASS. Undefined when the
 * elements leave no way, or the diagram is too large to search.
 */
export function detour(a: Box, b: Box, blocked: { box: Box }[]): Line | undefined {
  const walls = [a, b, ...blocked.map((item) => item.box)];
  const unique = (values: number[]) =>
    [...new Set(values.map((value) => Math.round(value * 2) / 2))].toSorted((p, q) => p - q);
  const xs = unique(
      walls.flatMap((box) => [box.x - PASS, centerOf(box).x, box.x + box.width + PASS]),
    ),
    ys = unique(walls.flatMap((box) => [box.y - PASS, centerOf(box).y, box.y + box.height + PASS]));
  if (xs.length * ys.length > LIMIT) return undefined;
  const column = new Map(xs.map((x, index) => [x, index])),
    row = new Map(ys.map((y, index) => [y, index]));
  const inside = walls.map((box) => grow(box, PASS - 1));
  const free = (p: Point, q: Point) => !inside.some((box) => segmentHits(p, q, box));
  /** Where a line leaves an element by a side: PASS out from the side's middle, on the grid. */
  const gate = (box: Box, side: Side) => {
    const center = centerOf(box),
      on = sidePoint(box, side, side === "top" || side === "bottom" ? center.x : center.y);
    const step = STEPS[SIDES.indexOf(side)],
      out = { x: on.x + step.x * PASS, y: on.y + step.y * PASS };
    const i = column.get(Math.round(out.x * 2) / 2),
      j = row.get(Math.round(out.y * 2) / 2);
    // The gate is free when only its own element is near.
    const others = inside.filter((_, index) => walls[index] !== box);
    const open = !others.some(
      (other) =>
        out.x > other.x &&
        out.x < other.x + other.width &&
        out.y > other.y &&
        out.y < other.y + other.height,
    );
    return i === undefined || j === undefined || !open ? undefined : { on, i, j, side };
  };
  const width = xs.length,
    state = (i: number, j: number, direction: number) => (j * width + i) * 4 + direction;
  const costs = new Map<number, number>(),
    came = new Map<number, number>(),
    queue = new Heap();
  for (const side of SIDES) {
    const start = gate(a, side);
    if (!start) continue;
    const key = state(start.i, start.j, SIDES.indexOf(side));
    costs.set(key, PASS);
    queue.push(PASS, key);
  }
  const goals = new Map<number, { on: Point; side: Side }>();
  for (const side of SIDES) {
    const goal = gate(b, side);
    if (goal) goals.set(goal.j * width + goal.i, goal);
  }
  if (!queue.size || !goals.size) return undefined;
  let best: { key: number; cost: number; goal: { on: Point; side: Side } } | undefined;
  while (queue.size) {
    const [cost, key] = queue.pop();
    if (best && cost >= best.cost) break;
    if (cost > (costs.get(key) ?? Infinity)) continue;
    const direction = key % 4,
      cell = (key - direction) / 4,
      i = cell % width,
      j = (cell - i) / width;
    const goal = goals.get(cell);
    if (goal) {
      // The line enters against the way the side faces.
      const inward = (SIDES.indexOf(goal.side) + 2) % 4;
      if (direction !== SIDES.indexOf(goal.side)) {
        const total = cost + PASS + (direction === inward ? 0 : CORNER);
        if (!best || total < best.cost) best = { key, cost: total, goal };
      }
    }
    for (let next = 0; next < 4; next++) {
      // A wire never turns back on itself.
      if (next === (direction + 2) % 4) continue;
      const ni = i + STEPS[next].x,
        nj = j + STEPS[next].y;
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) continue;
      const p = { x: xs[i], y: ys[j] },
        q = { x: xs[ni], y: ys[nj] };
      if (!free(p, q)) continue;
      const total =
        cost + Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + (next === direction ? 0 : CORNER);
      const target = state(ni, nj, next);
      if (total < (costs.get(target) ?? Infinity)) {
        costs.set(target, total);
        came.set(target, key);
        queue.push(total, target);
      }
    }
  }
  if (!best) return undefined;
  const points: Point[] = [best.goal.on];
  let from: Side = "top";
  for (let key: number | undefined = best.key; key !== undefined; key = came.get(key)) {
    const cell = (key - (key % 4)) / 4;
    points.push({ x: xs[cell % width], y: ys[(cell - (cell % width)) / width] });
    if (!came.has(key)) from = SIDES[key % 4];
  }
  const start = gate(a, from)!;
  points.push(start.on);
  return { from, to: best.goal.side, points: simplifyPath(points.toReversed()) };
}
