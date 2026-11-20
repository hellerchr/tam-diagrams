/**
 * TAM layout by hand: a wire's way around the elements between its ends, for the pairs no line of
 * two corners joins. A shortest-path search over the lines that pass the elements at a distance;
 * what a wire may cross at a price (a foreign container, another wire) makes a way dearer.
 */

import { type Box, centerOf, grow, type Point, segmentHits, simplifyPath } from "./scene.ts";
import { type Side, sidePoint } from "./tam-placed.ts";
import { type Port, portAlong } from "./tam-ports.ts";

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
  /** The sides of elements the piece ends on, by their keys: a wire end is told apart from the others on its side along that side. */
  sides?: string[];
}

/** What a detour passes at a price rather than not at all. */
export interface Terrain {
  /** Boxes a wire enters only at a price: foreign containers, titles. */
  costly?: { box: Box; cost: number }[];
  /** The container both ends lie in, and what leaving it costs. */
  home?: { box: Box; cost: number };
  /** Containers: no run follows a border of one closer than BORDER. */
  borders?: Box[];
  /** The wires that lie already: crossing one costs `cross`, running on one or turning on one `overlap`. */
  wires?: Run[];
  cross?: number;
  overlap?: number;
  /** The keys of the sides of both ends, for the wire ends that lie on them already. */
  sides?: [Record<Side, string>, Record<Side, string>];
  /** Half of the room the wire takes across: it passes everything that much further out. */
  half?: number;
  /** The ports the line leaves `a` and enters `b` by, where its connection names them (tam-ports.ts). */
  ports?: [Port | undefined, Port | undefined];
}

/** Which way a side faces along its axis: down and right count up. */
export const outward = (side: Side) => (side === "bottom" || side === "right" ? 1 : -1);

/** A wire keeps this far from a container's border it runs along. */
export const BORDER = 8;

/** Two wires side by side keep GAP apart, so they read as two; TOUCH is how near a point lies on a line. */
export const GAP = 10,
  TOUCH = 1.5;

/**
 * A detour passes elements at PASS and never nearer than KEEP; a corner costs as much as CORNER
 * pixels of wire, a pixel along a container's border as much as ALONG pixels elsewhere. It passes a
 * wire that lies already at LANE, and its grid has no two lines nearer than MERGE.
 */
const PASS = 14,
  KEEP = 8,
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
 * other or closer than GAP, or follow each other on one line as if they were one wire; 3 when an
 * end of one lies on the other, which reads as a junction; 1 when they cross; 0 when they pass.
 * Of a `step` of a longer straight run, a crossing at its far end `q` counts and one at `p` not, so
 * each crossing counts once.
 */
export function meets(p: Point, q: Point, half: number, run: Run, step = false): number {
  const upright = Math.abs(p.x - q.x) < 0.5,
    other = Math.abs(run.a.x - run.b.x) < 0.5;
  if (upright === other && Math.abs(run.a.x - run.b.x) + Math.abs(run.a.y - run.b.y) > 0.5)
    return alongside(p, q, half, run, upright, step);
  return across(p, q, run, upright, step);
}

/** The axis a run that goes up or down runs along, and the one it lies on. */
const axesOf = (upright: boolean) => (upright ? (["y", "x"] as const) : (["x", "y"] as const));

/** How the run p-q meets a run that lies already in the same direction: 2 on or beside it, else 0. */
function alongside(p: Point, q: Point, half: number, run: Run, upright: boolean, step: boolean) {
  const [along, level] = axesOf(upright);
  const apart = Math.abs(p[level] - run.a[level]);
  if (apart >= half + run.half + GAP) return 0;
  const shared =
    Math.min(Math.max(p[along], q[along]), Math.max(run.a[along], run.b[along])) -
    Math.max(Math.min(p[along], q[along]), Math.min(run.a[along], run.b[along]));
  return shared > (apart < 3 && !step ? -GAP : 2) ? 2 : 0;
}

/** How the run p-q meets a run that lies already across it: 1 for a crossing, 3 for a junction, else 0. */
function across(p: Point, q: Point, run: Run, upright: boolean, step: boolean) {
  // The run across: where it lies, and from where to where; the run p-q likewise.
  const [along, side] = axesOf(upright);
  const level = run.a[along],
    low = Math.min(run.a[side], run.b[side]),
    high = Math.max(run.a[side], run.b[side]),
    at = p[side],
    from = p[along],
    to = q[along];
  if (at < low - TOUCH || at > high + TOUCH) return 0;
  if (level < Math.min(from, to) - TOUCH || level > Math.max(from, to) + TOUCH) return 0;
  const inner = level > Math.min(from, to) + TOUCH && level < Math.max(from, to) - TOUCH;
  if (inner) return at > low + TOUCH && at < high - TOUCH ? 1 : 3;
  return atEnd(level, to, step);
}

/**
 * How a run meets one across it at one of its ends: a junction, but of a step of a longer run a
 * crossing at its far end and nothing at its near one.
 */
function atEnd(level: number, to: number, step: boolean) {
  if (!step) return 3;
  return Math.abs(level - to) <= TOUCH ? 1 : 0;
}

/** What a step along one line of the grid can meet: only that is looked at for each step on the line. */
interface Near {
  walls: Box[];
  costly: { box: Box; cost: number }[];
  borders: Box[];
  wires: Run[];
}

/** Where a line leaves an element by a side: `on` the middle of the side (or `along` it), `out` PASS out from there. */
function gatePoints(box: Box, side: Side, pass: number, along?: number) {
  const center = centerOf(box),
    on = sidePoint(box, side, along ?? (side === "top" || side === "bottom" ? center.x : center.y)),
    move = STEPS[SIDES.indexOf(side)];
  return { on, out: { x: on.x + move.x * pass, y: on.y + move.y * pass } };
}

/** The lines of the grid along one axis: those the ends need, and of the others none nearer than MERGE to one kept. */
function gridLines(needed: number[], others: number[]): number[] {
  const kept = [...new Set(needed.map((value) => Math.round(value * 2) / 2))];
  for (const value of others.toSorted((p, q) => p - q)) {
    const line = Math.round(value * 2) / 2;
    if (kept.every((other) => Math.abs(other - line) >= MERGE)) kept.push(line);
  }
  return kept.toSorted((p, q) => p - q);
}

/** A goal of the search: a gate of the element the line leads to, and what entering by it costs. */
interface Goal {
  on: Point;
  side: Side;
  fee: number;
}

/** The search for one detour: its grid, what each line of the grid meets, and the costs found so far. */
class Search {
  private readonly half: number;
  private readonly pass: number;
  private readonly margin: number;
  private readonly walls: Box[];
  private readonly inside: Box[];
  private readonly costly: { box: Box; cost: number }[];
  private readonly borders: Box[];
  private readonly wires: Run[];
  private readonly home?: { box: Box; cost: number };
  private readonly outside?: Box;
  private readonly cross: number;
  private readonly overlap: number;
  readonly xs: number[];
  readonly ys: number[];
  readonly width: number;
  readonly height: number;
  private column!: Map<number, number>;
  private row!: Map<number, number>;
  private columns!: Near[];
  private rows!: Near[];
  /** Whether a crossing of the grid lies on a wire, worked out as the search comes to it. */
  private wired!: Int8Array;
  /** Tolls are worked out once per step and direction, as the search comes to it. */
  private tolls!: Float64Array;
  private costs!: Float64Array;
  private came!: Int32Array;
  private readonly queue = new Heap();
  private readonly goals = new Map<number, Goal[]>();
  private best: { key: number; cost: number; goal: Goal } | undefined;

  private readonly a: Box;
  private readonly b: Box;
  private readonly terrain: Terrain;

  constructor(a: Box, b: Box, blocked: { box: Box }[], terrain: Terrain) {
    this.a = a;
    this.b = b;
    this.terrain = terrain;
    const half = terrain.half ?? 0;
    this.half = half;
    this.pass = PASS + half;
    this.margin = BORDER + half;
    this.walls = [a, b, ...blocked.map((item) => item.box)];
    this.inside = this.walls.map((box) => grow(box, KEEP + half));
    this.costly = terrain.costly ?? [];
    this.borders = terrain.borders ?? [];
    this.wires = terrain.wires ?? [];
    this.home = terrain.home;
    this.outside = terrain.home ? grow(terrain.home.box, 0.5) : undefined;
    this.cross = terrain.cross ?? 0;
    this.overlap = terrain.overlap ?? 0;
    this.xs = this.axis(blocked, "x", "width");
    this.ys = this.axis(blocked, "y", "height");
    this.width = this.xs.length;
    this.height = this.ys.length;
  }

  /**
   * The lines of the grid along one axis: around the ends, beside the blocked elements, the
   * containers and titles, and a lane beside every wire.
   */
  private axis(blocked: { box: Box }[], pos: "x" | "y", size: "width" | "height"): number[] {
    const { pass, half } = this,
      soft = [...this.costly.map((item) => item.box), ...this.borders],
      lane = LANE + half,
      // Beside its own ends a wire may pass as near as it may anywhere, through the gap to a neighbour.
      tight = KEEP + half + 0.5;
    return gridLines(
      [this.a, this.b].flatMap((box) => [
        box[pos] - pass,
        box[pos] - tight,
        centerOf(box)[pos],
        ...this.portLine(box, pos),
        box[pos] + box[size] + tight,
        box[pos] + box[size] + pass,
      ]),
      [
        ...blocked.flatMap(({ box }) => [box[pos] - pass, box[pos] + box[size] + pass]),
        ...soft.flatMap((box) => [
          box[pos] - pass,
          box[pos] + pass,
          box[pos] + box[size] - pass,
          box[pos] + box[size] + pass,
        ]),
        ...this.wires.flatMap((run) =>
          Math.abs(run.a[pos] - run.b[pos]) < 0.5
            ? [run.a[pos] - lane - run.half, run.a[pos] + lane + run.half]
            : [],
        ),
      ],
    );
  }

  /** The port an end is pinned to: the line leaves or enters by it alone. */
  private portOf(box: Box): Port | undefined {
    const ports = this.terrain.ports;
    return box === this.a ? ports?.[0] : box === this.b ? ports?.[1] : undefined;
  }

  /** Where along a side a line leaves or enters an end: at its port, else the middle (undefined). */
  private alongOf(box: Box, side: Side): number | undefined {
    const port = this.portOf(box);
    return port?.side === side ? portAlong(box, port) : undefined;
  }

  /** The line of the grid along one axis through an end's port, which its gate needs. */
  private portLine(box: Box, pos: "x" | "y"): number[] {
    const port = this.portOf(box);
    if (!port || (port.side === "top" || port.side === "bottom") !== (pos === "x")) return [];
    return [portAlong(box, port)];
  }

  /** Readies the grid for the search: what each of its lines meets, and no cost found yet. */
  prepare() {
    const { xs, ys, width, height } = this;
    this.column = new Map(xs.map((x, index) => [x, index]));
    this.row = new Map(ys.map((y, index) => [y, index]));
    this.columns = xs.map((x) => this.near(x, true));
    this.rows = ys.map((y) => this.near(y, false));
    this.wired = new Int8Array(width * height).fill(-1);
    this.tolls = new Float64Array(width * height * 4).fill(-1);
    this.costs = new Float64Array(width * height * 4).fill(Infinity);
    this.came = new Int32Array(width * height * 4).fill(-1);
  }

  /** What a line of the grid at `at`, upright or across, can meet. */
  private near(at: number, upright: boolean): Near {
    const low = (box: Box) => (upright ? box.x : box.y),
      high = (box: Box) => (upright ? box.x + box.width : box.y + box.height),
      spans = (box: Box) => at > low(box) && at < high(box),
      { margin, half } = this;
    return {
      walls: this.inside.filter(spans),
      costly: this.costly.filter((item) => spans(item.box)),
      borders: this.borders.filter(
        (box) => Math.abs(at - low(box)) < margin || Math.abs(at - high(box)) < margin,
      ),
      wires: this.wires.filter((run) => {
        const p = upright ? run.a.x : run.a.y,
          q = upright ? run.b.x : run.b.y;
        return Math.abs(p - q) < 0.5
          ? Math.abs(at - p) < half + run.half + GAP
          : at >= Math.min(p, q) - TOUCH && at <= Math.max(p, q) + TOUCH;
      }),
    };
  }

  /** What the step p-q costs beyond its length; Infinity where an element stands. */
  private toll(p: Point, q: Point, around: Near): number {
    for (const box of around.walls) if (segmentHits(p, q, box)) return Infinity;
    let cost = 0;
    for (const item of around.costly)
      if (!within(p, item.box) && segmentHits(p, q, item.box)) cost += item.cost;
    const { outside } = this;
    if (outside && within(p, outside) && !within(q, outside)) cost += this.home!.cost;
    return cost + this.borderToll(p, q, around) + this.wireToll(p, q, around);
  }

  /** What a step pays for running along the borders of containers, by its length. */
  private borderToll(p: Point, q: Point, around: Near): number {
    if (!around.borders.length) return 0;
    let cost = 0;
    const length = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    for (const box of around.borders)
      if (followsBorder(p, q, box, this.margin)) cost += ALONG * length;
    return cost;
  }

  /** What a step pays for the wires it crosses or runs on. */
  private wireToll(p: Point, q: Point, around: Near): number {
    let cost = 0;
    for (const run of around.wires) {
      const how = meets(p, q, this.half, run, true);
      if (how) cost += how === 1 ? this.cross : this.overlap;
    }
    return cost;
  }

  /** Whether a crossing of the grid lies on a wire: a corner there reads as a junction of two wires. */
  private onWire(i: number, j: number): boolean {
    const cell = j * this.width + i,
      { wired } = this;
    if (wired[cell] < 0) {
      const x = this.xs[i],
        y = this.ys[j];
      wired[cell] = +[...this.columns[i].wires, ...this.rows[j].wires].some(
        (run) =>
          x >= Math.min(run.a.x, run.b.x) - TOUCH &&
          x <= Math.max(run.a.x, run.b.x) + TOUCH &&
          y >= Math.min(run.a.y, run.b.y) - TOUCH &&
          y <= Math.max(run.a.y, run.b.y) + TOUCH,
      );
    }
    return wired[cell] === 1;
  }

  private state(i: number, j: number, direction: number) {
    return (j * this.width + i) * 4 + direction;
  }

  /** What the step from a crossing in a direction costs beyond its length. */
  private step(i: number, j: number, direction: number): number {
    const key = this.state(i, j, direction),
      { tolls, xs, ys } = this;
    if (tolls[key] < 0)
      tolls[key] = this.toll(
        { x: xs[i], y: ys[j] },
        { x: xs[i + STEPS[direction].x], y: ys[j + STEPS[direction].y] },
        direction % 2 ? this.rows[j] : this.columns[i],
      );
    return tolls[key];
  }

  /** Where a line leaves an element by a side: PASS out from its middle (or the port it is pinned to), on the grid. */
  gate(box: Box, side: Side) {
    const port = this.portOf(box);
    if (port && port.side !== side) return undefined;
    const { on, out } = gatePoints(box, side, this.pass, this.alongOf(box, side));
    const i = this.column.get(Math.round(out.x * 2) / 2),
      j = this.row.get(Math.round(out.y * 2) / 2);
    // The gate is free when only its own element is near.
    const open = !this.inside.some(
      (other, index) => this.walls[index] !== box && within(out, other),
    );
    return i === undefined || j === undefined || !open ? undefined : { on, i, j, side };
  }

  /** What is left of the way from a crossing at least: straight to the box `b`. */
  private left(i: number, j: number) {
    const { b, xs, ys } = this;
    return (
      Math.max(b.x - xs[i], 0, xs[i] - b.x - b.width) +
      Math.max(b.y - ys[j], 0, ys[j] - b.y - b.height)
    );
  }

  /** What leaving or entering an element by a gate costs: the piece between the side and the gate. */
  private entry(box: Box, side: Side, key?: string): number {
    const { on, out } = gatePoints(box, side, this.pass, this.alongOf(box, side)),
      { home } = this;
    let cost = 0;
    for (const item of this.costly)
      if (within(out, item.box) && !within(centerOf(box), item.box)) cost += item.cost;
    if (home && !within(out, grow(home.box, 0.5))) cost += home.cost;
    return cost + this.entryWires(on, out, key);
  }

  /** What the piece between a side and its gate pays for the wires it meets. */
  private entryWires(on: Point, out: Point, key?: string): number {
    let cost = 0;
    for (const run of this.wires) {
      const how = meets(on, out, this.half, run, true);
      // Wire ends on one side are told apart along the side once every wire has its line.
      if (how === 1 || (how > 1 && !(key && run.sides?.includes(key))))
        cost += how === 1 ? this.cross : this.overlap;
    }
    return cost;
  }

  /** Queues the gates of `a` the line may leave by, and notes those of `b` it may enter by; false where there are none. */
  seed(): boolean {
    for (const side of SIDES) {
      const start = this.gate(this.a, side);
      if (!start) continue;
      const key = this.state(start.i, start.j, SIDES.indexOf(side)),
        cost = this.pass + this.entry(this.a, side, this.terrain.sides?.[0][side]);
      this.costs[key] = cost;
      this.queue.push(cost + this.left(start.i, start.j), key);
    }
    for (const side of SIDES) {
      const goal = this.gate(this.b, side);
      if (!goal) continue;
      const cell = goal.j * this.width + goal.i;
      this.goals.set(cell, [
        ...(this.goals.get(cell) ?? []),
        { ...goal, fee: this.entry(this.b, side, this.terrain.sides?.[1][side]) },
      ]);
    }
    return this.queue.size > 0 && this.goals.size > 0;
  }

  /** Searches the cheapest way to a goal: the state it reaches the goal from, and the goal. */
  run() {
    const { queue, width } = this;
    while (queue.size) {
      queue.pop();
      const estimate = queue.cost,
        key = queue.value;
      if (this.best && estimate >= this.best.cost) break;
      const direction = key % 4,
        cell = (key - direction) / 4,
        i = cell % width,
        j = (cell - i) / width,
        cost = this.costs[key];
      if (estimate > cost + this.left(i, j) + 1e-6) continue;
      this.arrive(key, cell, direction, cost);
      for (let next = 0; next < 4; next++) this.advance(key, i, j, next, cost);
    }
    return this.best;
  }

  /** Notes the goals at a crossing, entered from the direction the search comes in. */
  private arrive(key: number, cell: number, direction: number, cost: number) {
    for (const goal of this.goals.get(cell) ?? []) {
      // The line enters against the way the side faces.
      const facing = SIDES.indexOf(goal.side),
        inward = (facing + 2) % 4;
      if (direction === facing) continue;
      const total = cost + this.pass + goal.fee + (direction === inward ? 0 : CORNER);
      if (!this.best || total < this.best.cost) this.best = { key, cost: total, goal };
    }
  }

  /** Takes one step from a crossing in the direction `next`, where it is cheaper than any way there so far. */
  private advance(key: number, i: number, j: number, next: number, cost: number) {
    const direction = key % 4;
    // A wire never turns back on itself.
    if (next === (direction + 2) % 4) return;
    const ni = i + STEPS[next].x,
      nj = j + STEPS[next].y;
    if (ni < 0 || nj < 0 || ni >= this.width || nj >= this.height) return;
    const fee = this.step(i, j, next);
    if (fee === Infinity) return;
    const total =
      cost +
      Math.abs(this.xs[ni] - this.xs[i]) +
      Math.abs(this.ys[nj] - this.ys[j]) +
      fee +
      (next === direction ? 0 : CORNER + this.junction(i, j));
    const target = this.state(ni, nj, next);
    if (total < this.costs[target]) {
      this.costs[target] = total;
      this.came[target] = key;
      this.queue.push(total + this.left(ni, nj), target);
    }
  }

  /** What a corner at a crossing pays beside CORNER: a corner on a wire reads as a junction. */
  private junction(i: number, j: number) {
    return this.overlap && this.onWire(i, j) ? this.overlap : 0;
  }

  /** The line the search found, from the gate it left `a` by to the goal. */
  line(best: { key: number; goal: Goal }): Line {
    const { xs, ys, width, came } = this;
    const points: Point[] = [best.goal.on];
    let from: Side = "top";
    for (let key = best.key; key >= 0; key = came[key]) {
      const cell = (key - (key % 4)) / 4;
      points.push({ x: xs[cell % width], y: ys[(cell - (cell % width)) / width] });
      if (came[key] < 0) from = SIDES[key % 4];
    }
    const start = this.gate(this.a, from)!;
    points.push(start.on);
    return { from, to: best.goal.side, points: simplifyPath(points.toReversed()) };
  }
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
  const search = new Search(a, b, blocked, terrain);
  if (search.width * search.height > LIMIT) return undefined;
  search.prepare();
  if (!search.seed()) return undefined;
  const best = search.run();
  return best && search.line(best);
}
