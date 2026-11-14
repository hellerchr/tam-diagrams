/** Swimlane activities, second stage: wires routed through the free channels between items, then their labels and guards. */

import type { Measure } from "./text";
import { type Box, grow, overlaps, type Point, segmentHits, simplifyPath, unit } from "./scene";
import { markerBounds } from "./markers";
import { guardText, isDecision, MARKERS } from "./uml-activity-layout";
import { besideSegments, longestFirst, smallSize, wrapSmall } from "./labels";
import type { FlowEdge } from "./uml-activity";
import {
  BEND,
  CLEAR,
  CROSS,
  round,
  type Side,
  type SwimlanePlacement,
  type SwimlaneRoutes,
} from "./swimlane-place";
import { forbidden, type Tier } from "./swimlane-tiers";

/** Routes every wire through the free channels between items, then places the wire labels and guards. */
export function routeSwimlanes(placed: SwimlanePlacement, measure: Measure): SwimlaneRoutes {
  const {
    bands,
    bottom,
    chart,
    footprint,
    forward,
    gaps,
    header,
    items,
    laneWidths,
    laneX,
    lanes,
    portPoints,
    rowHeights,
    rowY,
    rows,
    sides,
    stub,
    stubLength,
    vertical,
    visible,
  } = placed;
  // The routing grid: lines along node outlines, ports, lane edges and the gaps between rows.
  const obstacles = [...items.values()].flatMap((item) => footprint(item));
  const headerBoxes = lanes.map((_, index) => ({
    x: laneX[index],
    y: 0,
    width: laneWidths[index],
    height: header + 10,
  }));
  const xsSet = new Set<number>(),
    ysSet = new Set<number>();
  for (const box of obstacles) {
    [box.x - 12, box.x + box.width + 12, box.x - 24, box.x + box.width + 24].forEach((x) =>
      xsSet.add(round(x)),
    );
    [box.y - 12, box.y + box.height + 12].forEach((y) => ysSet.add(round(y)));
  }
  laneX.forEach((x, index) => {
    xsSet.add(round(x + 12));
    xsSet.add(round(x + laneWidths[index] - 12));
    xsSet.add(round(x + laneWidths[index] / 2));
  });
  // A lattice of vertical tracks, so wires find a way between the nodes of busy lanes.
  for (let x = 8; x < laneX[lanes.length - 1] + laneWidths[lanes.length - 1]; x += 10) xsSet.add(x);
  for (let row = 0; row < rows; row++) {
    // Tracks every 7px across the gap, above its label band.
    const gapTop = rowY[row] + rowHeights[row];
    for (let y = gapTop + 12; y <= gapTop + gaps[row] - 12 - bands[row]; y += 7)
      ysSet.add(round(y));
    ysSet.add(round(rowY[row] - 12));
  }
  ysSet.add(round(header + 18));
  ysSet.add(round(bottom - 10));
  for (const [id, [a, b]] of portPoints) {
    const [sa, sb] = sides.get(id)!;
    for (const point of [
      stub(a, sa, stubLength.get(`${id}:0`)),
      stub(b, sb, stubLength.get(`${id}:1`)),
    ]) {
      xsSet.add(round(point.x));
      ysSet.add(round(point.y));
    }
  }
  const xs = [...xsSet].toSorted((a, b) => a - b),
    ys = [...ysSet].toSorted((a, b) => a - b);
  // The markers at the ports belong to the drawing: other wires and labels keep off them.
  const inward: Record<Side, Point> = {
    top: { x: 0, y: 1 },
    bottom: { x: 0, y: -1 },
    left: { x: 1, y: 0 },
    right: { x: -1, y: 0 },
  };
  const heads = visible.flatMap((edge) => {
    const [sa, sb] = sides.get(edge.id)!,
      [pa, pb] = portPoints.get(edge.id)!;
    return (
      [
        [edge.start, pa, sa],
        [edge.end, pb, sb],
      ] as const
    ).flatMap(([kind, point, side]) =>
      kind ? [grow(markerBounds(MARKERS[kind], point, inward[side]), 1)] : [],
    );
  });
  const blocked = (a: Point, b: Point) =>
    obstacles.some((box) => segmentHits(a, b, grow(box, CLEAR))) ||
    heads.some((box) => segmentHits(a, b, box)) ||
    headerBoxes.some((box) => segmentHits(a, b, box));
  // Unit segments: horizontal ones between xs[i] and xs[i+1] on ys[j], vertical ones between ys[j] and ys[j+1] on xs[i].
  const hBlocked = ys.map((y) =>
    xs.slice(0, -1).map((x, i) => blocked({ x, y }, { x: xs[i + 1], y })),
  );
  const vBlocked = xs.map((x) =>
    ys.slice(0, -1).map((y, j) => blocked({ x, y }, { x, y: ys[j + 1] })),
  );
  const hUsed = ys.map(() => xs.map(() => 0)),
    vUsed = xs.map(() => ys.map(() => 0));
  const hLabel = ys.map(() => xs.map(() => 0)),
    vLabel = xs.map(() => ys.map(() => 0));
  // The exact lines wires run on, for counting crossings once per wire (the used bands are wider).
  const hCore = ys.map(() => xs.map(() => 0)),
    vCore = xs.map(() => ys.map(() => 0));
  const ix = (x: number) => xs.indexOf(round(x)),
    iy = (y: number) => ys.indexOf(round(y));

  const routes = new Map<string, Point[]>();
  // Labels are placed as soon as their wire is routed and block the grid for later wires; guards
  // stand next to their wire where it leaves the decision.
  const labelText = new Map(
    visible
      .filter((edge) => edge.label)
      .map((edge) => [edge.id, wrapSmall(guardText(chart, edge), measure, 160)]),
  );
  const guards = new Set(
    visible.filter((edge) => edge.label && isDecision(chart, edge.source)).map((edge) => edge.id),
  );
  const labelBoxes = new Map<string, Box>();
  // Every wire's first and last stretch (port to stub) is fixed: reserve them before routing.
  const stubs = visible.flatMap((edge) => {
    const [sa, sb] = sides.get(edge.id)!,
      [pa, pb] = portPoints.get(edge.id)!;
    return [
      [pa, stub(pa, sa, stubLength.get(`${edge.id}:0`))],
      [stub(pb, sb, stubLength.get(`${edge.id}:1`)), pb],
    ];
  });
  stubs.forEach((stretch) => mark(stretch));
  // Where a stub ends its wire turns onto the grid: other wires keep off that point, or it cannot get out.
  const terminals = new Uint8Array(xs.length * ys.length);
  stubs.forEach(([a, b], index) => {
    const point = index % 2 ? a : b,
      i = ix(point.x),
      j = iy(point.y);
    if (i >= 0 && j >= 0) terminals[j * xs.length + i] = 1;
  });
  // Forward wires first; among them labelled ones, so their labels claim room beside them before
  // wires that need none fill the gaps; short wires before long ones.
  const span = (edge: FlowEdge) =>
    Math.abs(items.get(edge.target)!.row - items.get(edge.source)!.row);
  const order = visible.toSorted(
    (a, b) =>
      +!forward(a) - +!forward(b) ||
      +!labelText.has(a.id) - +!labelText.has(b.id) ||
      span(a) - span(b),
  );
  for (const edge of order) {
    const [sa, sb] = sides.get(edge.id)!,
      [pa, pb] = portPoints.get(edge.id)!;
    const from = stub(pa, sa, stubLength.get(`${edge.id}:0`)),
      to = stub(pb, sb, stubLength.get(`${edge.id}:1`));
    // The wire's own reserved stretches do not block it.
    mark([pa, from], -1);
    mark([to, pb], -1);
    const args = [
      ix(from.x),
      iy(from.y),
      ix(to.x),
      iy(to.y),
      sa === "top" || sa === "bottom" ? 2 : 1,
      sb === "top" || sb === "bottom" ? 2 : 1,
    ] as const;
    // Strictly apart from other wires if possible, else apart from their lines only (past a label or
    // another wire's terminal at a price), else sharing a line at a high price.
    const path =
      search(...args, "strict") ?? search(...args, "apart") ?? search(...args, "relaxed");
    const points = simplifyPath([pa, ...(path ?? [from, { x: to.x, y: from.y }, to]), pb]);
    routes.set(edge.id, points);
    mark(points);
    const text = labelText.get(edge.id);
    if (text) {
      const size = smallSize(text, measure),
        box = labelSpot(
          points,
          vertical ? size.width : size.height,
          vertical ? size.height : size.width,
          guards.has(edge.id),
        );
      labelBoxes.set(edge.id, box);
      block(box);
    }
  }

  // Labels a later wire had to cross move to a free spot.
  for (const [id, box] of Array.from(labelBoxes)) {
    const crossed = [...routes].some(
      ([other, route]) =>
        other !== id &&
        route.slice(1).some((point, index) => segmentHits(route[index], point, box)),
    );
    if (!crossed) continue;
    labelBoxes.delete(id);
    labelBoxes.set(id, labelSpot(routes.get(id)!, box.width, box.height, guards.has(id)));
  }

  /** A free spot beside the route for a label of this frame size; for a guard, close to the route's start first. */
  function labelSpot(points: Point[], width: number, height: number, guard = false): Box {
    const segments = longestFirst(
      points.slice(1).map((point, index) => [points[index], point] as const),
    );
    const candidates: Box[] = [];
    // In the label bands the wire crosses, then anywhere beside it.
    for (const gap of guard ? [] : [6, 16, 28])
      for (const [a, b] of segments) {
        if (Math.abs(a.x - b.x) >= 0.5) continue;
        for (let row = 0; row < rows; row++) {
          const y = rowY[row] + rowHeights[row] + gaps[row] - bands[row] / 2;
          if (!bands[row] || y < Math.min(a.y, b.y) || y > Math.max(a.y, b.y)) continue;
          candidates.push(
            { x: a.x + gap, y: y - height / 2, width, height },
            { x: a.x - gap - width, y: y - height / 2, width, height },
          );
        }
      }
    if (guard) {
      const [a, b] = points,
        d = unit(a, b),
        upright = Math.abs(d.x) < 0.5;
      for (const along of [5, 12, 22, 34])
        for (const side of [1, -1]) {
          candidates.push(
            upright
              ? {
                  x: side > 0 ? a.x + 8 : a.x - 8 - width,
                  y: d.y > 0 ? a.y + along : a.y - along - height,
                  width,
                  height,
                }
              : {
                  x: d.x > 0 ? a.x + along : a.x - along - width,
                  y: side > 0 ? a.y - 7 - height : a.y + 7,
                  width,
                  height,
                },
          );
        }
    }
    candidates.push(
      ...besideSegments(
        segments,
        width,
        height,
        [6, 16, 28],
        [0.5, 0.3, 0.7, 0.15, 0.85, 0.05, 0.95],
      ),
    );
    const free = (box: Box) =>
      !obstacles.some((other) => overlaps(grow(box, 4), other)) &&
      !heads.some((other) => overlaps(grow(box, 2), other)) &&
      !headerBoxes.some((other) => overlaps(box, other)) &&
      ![...labelBoxes.values()].some((other) => overlaps(grow(box, 3), other)) &&
      ![...routes.values()].some((route) =>
        route.slice(1).some((point, index) => segmentHits(route[index], point, grow(box, 5))),
      ) &&
      !stubs.some(([a, b]) => segmentHits(a, b, grow(box, 5))) &&
      box.x >= 2 &&
      box.y >= header &&
      box.x + box.width <= laneX[lanes.length - 1] + laneWidths[lanes.length - 1] - 2;
    const found = candidates.find(free);
    if (found) return found;
    // Nothing free: the spot with the fewest conflicts.
    const conflicts = (box: Box) =>
      obstacles.filter((other) => overlaps(grow(box, 2), other)).length * 3 +
      [...labelBoxes.values()].filter((other) => overlaps(box, other)).length * 3 +
      [...routes.values()].reduce(
        (sum, route) =>
          sum +
          route.slice(1).filter((point, index) => segmentHits(route[index], point, box)).length,
        0,
      );
    return candidates.reduce(
      (best, box) => (conflicts(box) < conflicts(best) ? box : best),
      candidates[0],
    );
  }

  /** Makes the grid avoid a box (a placed label): strictly in the first search, at a price in the others. */
  function block(box: Box) {
    const area = grow(box, 4);
    ys.forEach((y, j) =>
      xs.slice(0, -1).forEach((x, i) => {
        if (segmentHits({ x, y }, { x: xs[i + 1], y }, area)) hLabel[j][i] = 1;
      }),
    );
    xs.forEach((x, i) =>
      ys.slice(0, -1).forEach((y, j) => {
        if (segmentHits({ x, y }, { x, y: ys[j + 1] }, area)) vLabel[i][j] = 1;
      }),
    );
  }

  /** Marks a route's unit segments as used, and the grid lines closer than 6px beside them. */
  function mark(points: Point[], delta = 1) {
    for (let k = 1; k < points.length; k++) {
      const [a, b] = [points[k - 1], points[k]];
      if (Math.abs(a.y - b.y) < 0.5) {
        const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
        ys.forEach((y, j) => {
          if (Math.abs(y - a.y) < 6)
            xs.slice(0, -1).forEach((x, i) => {
              if (x >= x0 - 0.1 && xs[i + 1] <= x1 + 0.1) {
                hUsed[j][i] += delta;
                if (Math.abs(y - a.y) < 0.1) hCore[j][i] += delta;
              }
            });
        });
      } else {
        const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
        xs.forEach((x, i) => {
          if (Math.abs(x - a.x) < 6)
            ys.slice(0, -1).forEach((y, j) => {
              if (y >= y0 - 0.1 && ys[j + 1] <= y1 + 0.1) {
                vUsed[i][j] += delta;
                if (Math.abs(x - a.x) < 0.1) vCore[i][j] += delta;
              }
            });
        });
      }
    }
  }

  /**
   * Cheapest grid path from one stub to another: length, bends and crossings; never along a used line.
   * What the `tier` does not forbid is allowed at a price.
   */
  function search(
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    startDir: number,
    endDir: number,
    tier: Tier,
  ): Point[] | null {
    if (sx < 0 || sy < 0 || tx < 0 || ty < 0) return null;
    const W = xs.length,
      H = ys.length,
      key = (i: number, j: number, d: number) => (j * W + i) * 3 + d;
    const cost = new Float64Array(W * H * 3).fill(Infinity),
      back = new Int32Array(W * H * 3).fill(-1);
    // A binary heap in two flat arrays: priorities and states, swapped together.
    const values: number[] = [],
      states: number[] = [];
    const swap = (a: number, b: number) => {
      const value = values[a],
        state = states[a];
      values[a] = values[b];
      states[a] = states[b];
      values[b] = value;
      states[b] = state;
    };
    const push = (state: number, value: number) => {
      values.push(value);
      states.push(state);
      for (let i = values.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (values[p] <= values[i]) break;
        swap(p, i);
        i = p;
      }
    };
    /** Removes the top entry and returns its state; its priority is read from `values[0]` before. */
    const pop = () => {
      const top = states[0],
        lastValue = values.pop()!,
        lastState = states.pop()!;
      if (values.length) {
        values[0] = lastValue;
        states[0] = lastState;
        for (let i = 0; ;) {
          const l = 2 * i + 1,
            r = l + 1;
          let m = i;
          if (l < values.length && values[l] < values[m]) m = l;
          if (r < values.length && values[r] < values[m]) m = r;
          if (m === i) break;
          swap(m, i);
          i = m;
        }
      }
      return top;
    };
    const STEPS = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 2],
      [0, -1, 2],
    ] as const;
    const start = key(sx, sy, startDir);
    cost[start] = 0;
    push(start, 0);
    let goal = -1;
    while (values.length) {
      const value = values[0],
        state = pop();
      if (value > cost[state]) continue;
      const d = state % 3,
        cell = (state - d) / 3,
        i = cell % W,
        j = (cell - i) / W;
      if (i === tx && j === ty) {
        goal = state;
        break;
      }
      for (const [di, dj, nd] of STEPS) {
        const ni = i + di,
          nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const horizontal = nd === 1,
          si = Math.min(i, ni),
          sj = Math.min(j, nj);
        if (horizontal ? hBlocked[j][si] : vBlocked[i][sj]) continue;
        const shared = horizontal ? hUsed[j][si] : vUsed[i][sj],
          label = horizontal ? hLabel[j][si] : vLabel[i][sj];
        const foreign = terminals[nj * W + ni] === 1 && !(ni === tx && nj === ty);
        if (forbidden(tier, shared, label, foreign)) continue;
        let step =
          (horizontal ? Math.abs(xs[ni] - xs[i]) : Math.abs(ys[nj] - ys[j])) +
          (shared || foreign ? 600 : 0) +
          (label ? 250 : 0);
        if (d && d !== nd) step += BEND;
        // Crossing a used perpendicular line at the next point.
        const crossing = horizontal
          ? nj > 0 && nj < H - 1 && vCore[ni][nj - 1] > 0 && vCore[ni][nj] > 0
          : ni > 0 && ni < W - 1 && hCore[nj][ni - 1] > 0 && hCore[nj][ni] > 0;
        if (crossing) step += CROSS;
        if (ni === tx && nj === ty && nd !== endDir) step += BEND;
        const next = key(ni, nj, nd),
          total = value + step;
        if (total < cost[next]) {
          cost[next] = total;
          back[next] = state;
          push(next, total);
        }
      }
    }
    if (goal < 0) return null;
    const path: Point[] = [];
    for (let state = goal; state >= 0; state = back[state]) {
      const cell = (state - (state % 3)) / 3;
      path.push({ x: xs[cell % W], y: ys[Math.floor(cell / W)] });
    }
    return path.toReversed();
  }

  // Into the drawing: transposed back for LR.
  const flip = (point: Point): Point => (vertical ? point : { x: point.y, y: point.x });
  const flipBox = (box: Box): Box =>
    vertical ? box : { x: box.y, y: box.x, width: box.height, height: box.width };
  return { flip, flipBox, labelBoxes, labelText, routes };
}
