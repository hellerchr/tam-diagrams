/** Picking the best layout: scene metrics, the ELK strategies tried, the score, and the layout cache. */

import { type Scene, segmentsCross } from "./scene";
import { around, auditScene, type Segment, segmentsOf, SpatialGrid } from "./audit";

/** Layout quality of a scene: what bestScene scores, lower is better. */
export interface Metrics {
  crossings: number;
  bends: number;
  length: number;
  detour: number;
  width: number;
  height: number;
  defects: number;
  notes: number;
}

/** Layout quality measures: crossings between different connections, bends, wire length, detours, size and audit results. */
export function measureScene(scene: Scene): Metrics {
  const segments = segmentsOf(scene, true),
    grid = new SpatialGrid<Segment>(32);
  for (const segment of segments) grid.add(around(segment.a, segment.b), segment);
  let crossings = 0;
  for (const segment of segments)
    for (const other of grid.near(around(segment.a, segment.b))) {
      if (
        other.index > segment.index &&
        other.wire.edge !== segment.wire.edge &&
        segmentsCross(segment.a, segment.b, other.a, other.b, true)
      )
        crossings++;
    }
  const straight = scene.wires.filter((wire) => !wire.path);
  const bends = straight.reduce((sum, wire) => sum + Math.max(0, wire.points.length - 2), 0);
  const length = segments.reduce((sum, { a, b }) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0);
  // Wire length beyond 2.5 times the direct distance between its ends: loops around the diagram.
  const detour = straight.reduce((sum, wire) => {
    const total = wire.points
      .slice(1)
      .reduce(
        (inner, point, index) =>
          inner + Math.hypot(point.x - wire.points[index].x, point.y - wire.points[index].y),
        0,
      );
    const direct =
      Math.abs(wire.points.at(-1)!.x - wire.points[0].x) +
      Math.abs(wire.points.at(-1)!.y - wire.points[0].y);
    return sum + Math.max(0, total - 2.5 * direct - 60);
  }, 0);
  const findings = auditScene(scene);
  return {
    crossings,
    bends,
    length: Math.round(length),
    detour: Math.round(detour),
    width: scene.bounds.width,
    height: scene.bounds.height,
    defects: findings.filter((finding) => !finding.note).length,
    notes: findings.filter((finding) => finding.note).length,
  };
}

/**
 * Several ELK configurations per diagram, keeping the best-scoring scene: no single configuration
 * wins on all graphs. Every diagram type (TAM and UML) chooses its layout through here.
 */

export const STRAIGHT = {
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.nodePlacement.favorStraightEdges": "true",
};

export const COFFMAN = { "elk.layered.layering.strategy": "COFFMAN_GRAHAM" };

/** The default keeps the author's order; the others straighten wires (Brandes-Köpf) or balance layers (Coffman-Graham). */
export const STRATEGIES: Record<string, string>[] = [
  {},
  STRAIGHT,
  COFFMAN,
  { ...COFFMAN, ...STRAIGHT },
];

/** Behavior diagrams read in source order: edges written against it are the ones turned back in cycles. */
const ORDER = { "elk.layered.cycleBreaking.strategy": "MODEL_ORDER" };

export const FLOW_STRATEGIES: Record<string, string>[] = [
  ORDER,
  { ...ORDER, ...STRAIGHT },
  {},
  STRAIGHT,
  COFFMAN,
];

/**
 * Lower is better: defects first, then crossings, bends, wire length, detours, width beyond a reading
 * column, and area, so of two equally clean layouts the more compact one wins.
 */
function layoutScore(metrics: Metrics, index = 0): number {
  return (
    metrics.defects * 10_000 +
    metrics.notes * 150 +
    metrics.crossings * 400 +
    metrics.bends * 20 +
    metrics.length * 0.02 +
    metrics.detour * 0.3 +
    Math.max(0, metrics.width - 1100) * 0.5 +
    metrics.width * metrics.height * 0.0003 +
    index
  );
}

/**
 * Builds the scene with every strategy and keeps the best one. The strategies run at once: with a pool
 * of ELK workers their layouts overlap in time. While the best still has defects, `retries` (more room,
 * other seeds) run in rounds until one is clean; a scene that needed them records an `escalation` fallback.
 * `bias` is what each later strategy must gain over an earlier one, so preferred configurations come first.
 */
export async function bestScene<T = Record<string, string>>(
  build: (variant: T) => Promise<Scene>,
  strategies: T[] = STRATEGIES as T[],
  bias = 1,
  retries: T[] = [],
): Promise<Scene> {
  const score = async (variant: T, index: number) => {
    const scene = await build(variant),
      metrics = measureScene(scene);
    return { scene, score: layoutScore(metrics, index * bias), defects: metrics.defects };
  };
  const results = await Promise.all(strategies.map(score));
  let best = results.reduce((winner, item) => (item.score < winner.score ? item : winner));
  const escalated = best.defects > 0;
  // What made the retries necessary: the defect classes of the best first layout.
  const causes = escalated
    ? [
        ...new Set(
          auditScene(best.scene)
            .filter((finding) => !finding.note)
            .map((finding) => finding.check),
        ),
      ]
    : [];
  // Retries run in rounds as wide as the first pass, so a pool of ELK workers lays a round out at once.
  for (let start = 0; start < retries.length && best.defects; start += strategies.length) {
    const round = await Promise.all(
      retries
        .slice(start, start + strategies.length)
        .map((variant, index) => score(variant, strategies.length + start + index)),
    );
    for (const item of round) if (item.score < best.score) best = item;
  }
  if (escalated) {
    const fired = (best.scene.fallbacks ??= new Map());
    fired.set("escalation", 1);
    for (const cause of causes) fired.set(`escalation:${cause}`, 1);
  }
  return best.scene;
}

// Layouts depend on the source and the font only, so switching themes redraws without laying out again.
const layouts = new Map<string, Promise<Scene>>();

/** The layout for `key`, built once; the most recent 128 are kept, failures are not. */
export function cachedLayout(key: string, build: () => Promise<Scene>): Promise<Scene> {
  let scene = layouts.get(key);
  if (!scene) {
    scene = build();
    scene.catch(() => layouts.delete(key));
    layouts.set(key, scene);
    if (layouts.size > 128) layouts.delete(layouts.keys().next().value!);
  }
  return scene;
}
