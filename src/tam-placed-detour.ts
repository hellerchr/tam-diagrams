/**
 * TAM layout by hand: a wire's way around the elements between its ends, for the pairs no line of
 * two corners joins. A shortest-path search over the lines that pass the elements at a distance;
 * what a wire may cross at a price (a foreign container, another wire) makes a way dearer.
 */

import { type Box, centerOf, grow, type Point, segmentHits, simplifyPath } from "./scene.ts";
import { type Side, sidePoint } from "./tam-placed.ts";

/** A wire's line from one element to another, and the sides it leaves and enters by. */
export interface Line {
  from: Side;
  to: Side;
  points: Point[];
  /**
   * How far the line is from the plain one between its sides: 1 for each end that leaves its side
   * off the middle, a part of 1 for a step off the middle of a gap or a straight line beside the
   * middle of what the sides share.
   */
  off?: number;
}

/** A straight piece of a wire that lies already, with half of the room it takes across. */
export interface Run {
  a: Point;
  b: Point;
  half: number;
  /** The piece meets an element: wire ends on one side are told apart later, along the side. */
  end?: boolean;
}

/** What a detour passes at a price rather than not at all. */
export interface Terrain {
  /** Boxes a wire enters only at a price: foreign containers, titles. */
  costly?: { box: Box; cost: number }[];
  /** The container both ends lie in, and what leaving it costs. */
  home?: { box: Box; cost: number };
  /** Containers: no run follows a border of one closer than BORDER. */
  borders?: Box[];
  /** The wires that lie already: crossing one costs `cross`, running on one `overlap`. */
  wires?: Run[];
  cross?: number;
  overlap?: number;
  /** Half of the room the wire takes across: it passes everything that much further out. */
  half?: number;
}

/** Which way a side faces along its axis: down and right count up. */
export const outward = (side: Side) => (side === "bottom" || side === "right" ? 1 : -1);

/** A wire keeps this far from a container's border it runs along. */
export const BORDER = 8;

/**
 * A detour passes elements at PASS and never nearer than KEEP; a corner costs as much as CORNER
 * pixels of wire, a pixel along a container's border as much as ALONG pixels elsewhere. It passes a
 * wire that lies already at LANE, and its grid has no two lines nearer than MERGE.
 */
const PASS = 14,
  KEEP = 9.5,
  CORNER = 60,
  ALONG = 6,
  LANE = 18,
  MERGE = 6;

/** Beyond this many crossings of lines the search is not worth its time: the wire runs straight through. */
const LIMIT = 60_000;

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
  private costs: number[] = [];
  private values: number[] = [];
  /** The cost and the value of the entry `pop` took last. */
  cost = 0;
  value = 0;
  get size() {
    return this.costs.length;
  }
  push(cost: number, value: number) {
    const { costs, values } = this;
    let index = costs.length;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (costs[parent] <= cost) break;
      costs[index] = costs[parent];
      values[index] = values[parent];
      index = parent;
    }
    costs[index] = cost;
    values[index] = value;
  }
  pop() {
    const { costs, values } = this;
    this.cost = costs[0];
    this.value = values[0];
    const cost = costs.pop()!,
      value = values.pop()!,
      size = costs.length;
    if (!size) return;
    let index = 0;
    for (;;) {
      let least = 2 * index + 1;
      if (least >= size) break;
      if (least + 1 < size && costs[least + 1] < costs[least]) least++;
      if (costs[least] >= cost) break;
      costs[index] = costs[least];
      values[index] = values[least];
      index = least;
    }
    costs[index] = cost;
    values[index] = value;
  }
}

const within = (point: Point, box: Box) =>
  point.x > box.x && point.x < box.x + box.width && point.y > box.y && point.y < box.y + box.height;

/** Whether the run p-q follows a border of the box closer than `keep`. */
export function followsBorder(p: Point, q: Point, box: Box, keep = BORDER): boolean {
  if (Math.abs(p.y - q.y) < 0.5) {
    if (Math.abs(p.y - box.y) >= keep && Math.abs(p.y - box.y - box.height) >= keep) return false;
    return (
      Math.min(Math.max(p.x, q.x), box.x + box.width) - Math.max(Math.min(p.x, q.x), box.x) > 1
    );
  }
  if (Math.abs(p.x - q.x) >= 0.5) return false;
  if (Math.abs(p.x - box.x) >= keep && Math.abs(p.x - box.x - box.width) >= keep) return false;
  return Math.min(Math.max(p.y, q.y), box.y + box.height) - Math.max(Math.min(p.y, q.y), box.y) > 1;
}

/**
 * How the run p-q of a wire `half` thick meets a run that lies already: 2 when they run on each
 * other, 1 when they cross, 0 when they pass. A crossing at the far end `q` counts, one at `p` not,
 * so a line of several runs counts each crossing once.
 */
export function meets(p: Point, q: Point, half: number, run: Run): number {
  const upright = Math.abs(p.x - q.x) < 0.5,
    other = Math.abs(run.a.x - run.b.x) < 0.5;
  if (upright === other && Math.abs(run.a.x - run.b.x) + Math.abs(run.a.y - run.b.y) > 0.5) {
    const apart = upright ? Math.abs(p.x - run.a.x) : Math.abs(p.y - run.a.y);
    if (apart >= half + run.half + 5) return 0;
    const shared = upright
      ? Math.min(Math.max(p.y, q.y), Math.max(run.a.y, run.b.y)) -
        Math.max(Math.min(p.y, q.y), Math.min(run.a.y, run.b.y))
      : Math.min(Math.max(p.x, q.x), Math.max(run.a.x, run.b.x)) -
        Math.max(Math.min(p.x, q.x), Math.min(run.a.x, run.b.x));
    return shared > 2 ? 2 : 0;
  }
  if (upright) {
    const y = run.a.y,
      low = Math.min(run.a.x, run.b.x),
      high = Math.max(run.a.x, run.b.x);
    if (p.x <= low || p.x >= high) return 0;
    return q.y > p.y ? +(y > p.y && y <= q.y) : +(y < p.y && y >= q.y);
  }
  const x = run.a.x,
    low = Math.min(run.a.y, run.b.y),
    high = Math.max(run.a.y, run.b.y);
  if (p.y <= low || p.y >= high) return 0;
  return q.x > p.x ? +(x > p.x && x <= q.x) : +(x < p.x && x >= q.x);
}

/**
 * The cheapest line from `a` to `b` around the `blocked` elements: it leaves and enters at the
 * middle of a side and turns only on the lines that pass an element, a border or a wire at a
 * distance. `terrain` names what it may cross at a price. Undefined when the elements leave no
 * way, or the diagram is too large to search.
 */
export function detour(
  a: Box,
  b: Box,
  blocked: { box: Box }[],
  terrain: Terrain = {},
): Line | undefined {
  const half = terrain.half ?? 0,
    pass = PASS + half,
    margin = BORDER + half,
    walls = [a, b, ...blocked.map((item) => item.box)],
    inside = walls.map((box) => grow(box, KEEP + half)),
    costly = terrain.costly ?? [],
    borders = terrain.borders ?? [],
    wires = terrain.wires ?? [],
    { home } = terrain,
    cross = terrain.cross ?? 0,
    overlap = terrain.overlap ?? 0;
  /** The lines of the grid along one axis: those the ends need, and of the others none nearer than MERGE to one kept. */
  const grid = (needed: number[], others: number[]) => {
    const kept = [...new Set(needed.map((value) => Math.round(value * 2) / 2))];
    for (const value of others.toSorted((p, q) => p - q)) {
      const line = Math.round(value * 2) / 2;
      if (kept.every((other) => Math.abs(other - line) >= MERGE)) kept.push(line);
    }
    return kept.toSorted((p, q) => p - q);
  };
  const soft = [...costly.map((item) => item.box), ...borders];
  const lane = LANE + half;
  const xs = grid(
      [a, b].flatMap((box) => [box.x - pass, centerOf(box).x, box.x + box.width + pass]),
      [
        ...blocked.flatMap(({ box }) => [box.x - pass, box.x + box.width + pass]),
        ...soft.flatMap((box) => [
          box.x - pass,
          box.x + pass,
          box.x + box.width - pass,
          box.x + box.width + pass,
        ]),
        ...wires.flatMap((run) =>
          Math.abs(run.a.x - run.b.x) < 0.5
            ? [run.a.x - lane - run.half, run.a.x + lane + run.half]
            : [],
        ),
      ],
    ),
    ys = grid(
      [a, b].flatMap((box) => [box.y - pass, centerOf(box).y, box.y + box.height + pass]),
      [
        ...blocked.flatMap(({ box }) => [box.y - pass, box.y + box.height + pass]),
        ...soft.flatMap((box) => [
          box.y - pass,
          box.y + pass,
          box.y + box.height - pass,
          box.y + box.height + pass,
        ]),
        ...wires.flatMap((run) =>
          Math.abs(run.a.y - run.b.y) < 0.5
            ? [run.a.y - lane - run.half, run.a.y + lane + run.half]
            : [],
        ),
      ],
    );
  const width = xs.length,
    height = ys.length;
  if (width * height > LIMIT) return undefined;
  const column = new Map(xs.map((x, index) => [x, index])),
    row = new Map(ys.map((y, index) => [y, index]));
  /** What a step along one line of the grid can meet: only that is looked at for each step on the line. */
  interface Near {
    walls: Box[];
    costly: { box: Box; cost: number }[];
    borders: Box[];
    wires: Run[];
  }
  const near = (at: number, upright: boolean): Near => {
    const low = (box: Box) => (upright ? box.x : box.y),
      high = (box: Box) => (upright ? box.x + box.width : box.y + box.height),
      spans = (box: Box) => at > low(box) && at < high(box);
    return {
      walls: inside.filter(spans),
      costly: costly.filter((item) => spans(item.box)),
      borders: borders.filter(
        (box) => Math.abs(at - low(box)) < margin || Math.abs(at - high(box)) < margin,
      ),
      wires: wires.filter((run) => {
        const p = upright ? run.a.x : run.a.y,
          q = upright ? run.b.x : run.b.y;
        return Math.abs(p - q) < 0.5
          ? Math.abs(at - p) < half + run.half + 5
          : at > Math.min(p, q) && at < Math.max(p, q);
      }),
    };
  };
  const columns = xs.map((x) => near(x, true)),
    rows = ys.map((y) => near(y, false));
  const outside = home ? grow(home.box, 0.5) : undefined;
  /** What the step p-q costs beyond its length; Infinity where an element stands. */
  const toll = (p: Point, q: Point, around: Near): number => {
    for (const box of around.walls) if (segmentHits(p, q, box)) return Infinity;
    let cost = 0;
    for (const item of around.costly)
      if (!within(p, item.box) && segmentHits(p, q, item.box)) cost += item.cost;
    if (outside && within(p, outside) && !within(q, outside)) cost += home!.cost;
    if (around.borders.length) {
      const length = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      for (const box of around.borders)
        if (followsBorder(p, q, box, margin)) cost += ALONG * length;
    }
    for (const run of around.wires) {
      const how = meets(p, q, half, run);
      if (how) cost += how === 2 ? overlap : cross;
    }
    return cost;
  };
  const state = (i: number, j: number, direction: number) => (j * width + i) * 4 + direction;
  // Tolls are worked out once per step and direction, as the search comes to it.
  const tolls = new Float64Array(width * height * 4).fill(-1);
  const step = (i: number, j: number, direction: number): number => {
    const key = state(i, j, direction);
    if (tolls[key] < 0)
      tolls[key] = toll(
        { x: xs[i], y: ys[j] },
        { x: xs[i + STEPS[direction].x], y: ys[j + STEPS[direction].y] },
        direction % 2 ? rows[j] : columns[i],
      );
    return tolls[key];
  };
  /** Where a line leaves an element by a side: PASS out from the side's middle, on the grid. */
  const gate = (box: Box, side: Side) => {
    const center = centerOf(box),
      on = sidePoint(box, side, side === "top" || side === "bottom" ? center.x : center.y);
    const move = STEPS[SIDES.indexOf(side)],
      out = { x: on.x + move.x * pass, y: on.y + move.y * pass };
    const i = column.get(Math.round(out.x * 2) / 2),
      j = row.get(Math.round(out.y * 2) / 2);
    // The gate is free when only its own element is near.
    const open = !inside.some((other, index) => walls[index] !== box && within(out, other));
    return i === undefined || j === undefined || !open ? undefined : { on, i, j, side };
  };
  /** What is left of the way from a crossing at least: straight to the box `b`. */
  const left = (i: number, j: number) =>
    Math.max(b.x - xs[i], 0, xs[i] - b.x - b.width) +
    Math.max(b.y - ys[j], 0, ys[j] - b.y - b.height);
  const costs = new Float64Array(width * height * 4).fill(Infinity),
    came = new Int32Array(width * height * 4).fill(-1),
    queue = new Heap();
  /** What leaving or entering an element by a gate costs: the piece between the side and the gate. */
  const entry = (box: Box, side: Side): number => {
    const center = centerOf(box),
      on = sidePoint(box, side, side === "top" || side === "bottom" ? center.x : center.y),
      move = STEPS[SIDES.indexOf(side)],
      out = { x: on.x + move.x * pass, y: on.y + move.y * pass };
    let cost = 0;
    for (const item of costly)
      if (within(out, item.box) && !within(centerOf(box), item.box)) cost += item.cost;
    if (home && !within(out, grow(home.box, 0.5))) cost += home.cost;
    for (const run of wires) {
      const how = meets(on, out, half, run);
      // Wire ends on one side are told apart along the side once every wire has its line.
      if (how === 1 || (how === 2 && !run.end)) cost += how === 2 ? overlap : cross;
    }
    return cost;
  };
  for (const side of SIDES) {
    const start = gate(a, side);
    if (!start) continue;
    const key = state(start.i, start.j, SIDES.indexOf(side)),
      cost = pass + entry(a, side);
    costs[key] = cost;
    queue.push(cost + left(start.i, start.j), key);
  }
  const goals = new Map<number, { on: Point; side: Side; fee: number }[]>();
  for (const side of SIDES) {
    const goal = gate(b, side);
    if (!goal) continue;
    const cell = goal.j * width + goal.i;
    goals.set(cell, [...(goals.get(cell) ?? []), { ...goal, fee: entry(b, side) }]);
  }
  if (!queue.size || !goals.size) return undefined;
  let best: { key: number; cost: number; goal: { on: Point; side: Side } } | undefined;
  while (queue.size) {
    queue.pop();
    const estimate = queue.cost,
      key = queue.value;
    if (best && estimate >= best.cost) break;
    const direction = key % 4,
      cell = (key - direction) / 4,
      i = cell % width,
      j = (cell - i) / width,
      cost = costs[key];
    if (estimate > cost + left(i, j) + 1e-6) continue;
    for (const goal of goals.get(cell) ?? []) {
      // The line enters against the way the side faces.
      const inward = (SIDES.indexOf(goal.side) + 2) % 4;
      if (direction === SIDES.indexOf(goal.side)) continue;
      const total = cost + pass + goal.fee + (direction === inward ? 0 : CORNER);
      if (!best || total < best.cost) best = { key, cost: total, goal };
    }
    for (let next = 0; next < 4; next++) {
      // A wire never turns back on itself.
      if (next === (direction + 2) % 4) continue;
      const ni = i + STEPS[next].x,
        nj = j + STEPS[next].y;
      if (ni < 0 || nj < 0 || ni >= width || nj >= height) continue;
      const fee = step(i, j, next);
      if (fee === Infinity) continue;
      const total =
        cost +
        Math.abs(xs[ni] - xs[i]) +
        Math.abs(ys[nj] - ys[j]) +
        fee +
        (next === direction ? 0 : CORNER);
      const target = state(ni, nj, next);
      if (total < costs[target]) {
        costs[target] = total;
        came[target] = key;
        queue.push(total + left(ni, nj), target);
      }
    }
  }
  if (!best) return undefined;
  const points: Point[] = [best.goal.on];
  let from: Side = "top";
  for (let key = best.key; key >= 0; key = came[key]) {
    const cell = (key - (key % 4)) / 4;
    points.push({ x: xs[cell % width], y: ys[(cell - (cell % width)) / width] });
    if (came[key] < 0) from = SIDES[key % 4];
  }
  const start = gate(a, from)!;
  points.push(start.on);
  return { from, to: best.goal.side, points: simplifyPath(points.toReversed()) };
}
