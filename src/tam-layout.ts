/**
 * Lays out a parsed TAM block diagram with ELK and turns the result into a scene: positioned
 * shapes, wires, arrowheads, channel markers and text boxes, in three stages (tam-graph.ts,
 * tam-geometry.ts, tam-scene.ts). renderTam draws the scene as SVG and audit.ts checks it for
 * collisions.
 */

import { isPlaced, parseTam, type TamDiagram } from "./tam.ts";
import { type Measure, textMeasure } from "./text.ts";
import type { Scene } from "./scene.ts";
import { bundledElk, type ElkLayout } from "./elk.ts";
import { collectFallbacks } from "./route.ts";
import { type LayoutOptions, tamGraph } from "./tam-graph.ts";
import { tamScene } from "./tam-scene.ts";
import { tamGeometry } from "./tam-geometry.ts";
import { placeElements } from "./tam-placed.ts";
import { placedGeometry } from "./tam-placed-wires.ts";
import { bestScene, cachedLayout, COFFMAN, STRAIGHT } from "./best.ts";
import type { ElkNode } from "elkjs/lib/elk-api";
import { type DiagramColors, drawScene } from "./draw.ts";
import { placeLabels } from "./label-places.ts";
import { withSourceCorners } from "./title-mark.ts";

export type { Scene };

export type { ElkLayout };

/** Lays a parsed TAM diagram out with one strategy; bestLayout tries them all. */
export async function layoutTam(
  source: TamDiagram,
  measure: Measure,
  options: LayoutOptions = {},
): Promise<Scene> {
  const layout = options.layout ?? (await bundledElk());
  const prepared = tamGraph(source, measure, options);
  const { graph } = prepared;
  // Strategies that build an identical graph share one ELK run; the result is only read from here on.
  const key = options.memo ? JSON.stringify(graph) : "";
  let pending = options.memo?.get(key);
  if (!pending) {
    pending = layout(graph);
    options.memo?.set(key, pending);
  }
  const result = await pending;
  // Everything from here on is synchronous.
  const fallbacks = new Map<string, number>();
  collectFallbacks(fallbacks);
  const scene = tamScene(prepared, tamGeometry(prepared, result, measure), measure);
  collectFallbacks(undefined);
  scene.fallbacks = fallbacks;
  return scene;
}

/**
 * Lays out a diagram whose source places its elements (`@x,y`): they stand where it says, the wires
 * run between them, and the scene is drawn like any other. There is nothing to search or to wait
 * for, so an editor can lay a diagram out again on every move. A `draft` routes each wire once,
 * without untangling those that chose their lines alike: the same boxes, a fifth of the time, for
 * a drag's preview.
 */
export function layoutPlaced(source: TamDiagram, measure: Measure, draft = false): Scene {
  // Placed by hand, a pointer between two storages is a wire like any other: they need not share a row.
  const diagram = {
    ...source,
    edges: source.edges.map((edge) => (edge.aside ? { ...edge, aside: false } : edge)),
  };
  const prepared = tamGraph(diagram, measure, {});
  const fallbacks = new Map<string, number>();
  collectFallbacks(fallbacks);
  const geometry = placedGeometry(prepared, placeElements(prepared, measure), measure, draft);
  const scene = tamScene(prepared, geometry, measure);
  collectFallbacks(undefined);
  scene.fallbacks = fallbacks;
  return withLabels(scene, source);
}

/** A scene with the labels its source places (`@+dx,dy` behind a connection) where it says. */
function withLabels(scene: Scene, diagram: TamDiagram): Scene {
  return placeLabels(
    scene,
    new Map(
      diagram.edges.flatMap((edge) =>
        edge.labelAt && !edge.id.includes("#") ? [[edge.id, edge.labelAt] as const] : [],
      ),
    ),
  );
}

/** Lays a parsed diagram out: as its source places it (a `draft` of it: layoutPlaced), or else the best of the
 *  layouts by ELK. */
export const layoutDiagram = (
  diagram: TamDiagram,
  measure: Measure,
  layout?: ElkLayout,
  draft = false,
) =>
  isPlaced(diagram)
    ? Promise.resolve(layoutPlaced(diagram, measure, draft))
    : bestLayout(diagram, measure, layout);

/**
 * Draws a TAM block diagram as standalone SVG in the TAM/FMC notation: rectangular agents, rounded
 * storages, channel circles with request markers, access arrows, nesting, multiplicity, protocol
 * boundaries and UML interfaces on design level. Layout is layoutTam above.
 */

/** A drawn TAM diagram: the SVG, its size, its description (the title) and the scene behind it. */
export interface TamPicture {
  svg: string;
  width: number;
  height: number;
  description: string;
  scene: Scene;
}

/**
 * Layout strategies tried for every diagram; no single one wins on all graphs. The default keeps
 * storages below their agents and the author's order; the others straighten wires (Brandes-Köpf),
 * layer by data flow, or balance layers (Coffman-Graham), which removes crossings in fan-in and fan-out.
 */
export const STRATEGIES: LayoutOptions[] = [
  {},
  { elk: STRAIGHT },
  { flow: true },
  { flow: true, elk: STRAIGHT },
  { elk: COFFMAN },
  { elk: { ...COFFMAN, ...STRAIGHT } },
];

/** Crowded diagrams: every strategy again with more room, then with other random seeds. */
const RETRIES: LayoutOptions[] = [
  ...[1.5, 2, 2.5].flatMap((room) => STRATEGIES.map((strategy) => ({ ...strategy, room }))),
  ...[3, 7, 11, 13].flatMap((seed) =>
    STRATEGIES.map((strategy) => ({
      ...strategy,
      room: 1.5,
      elk: { ...strategy.elk, "elk.randomSeed": String(seed) },
    })),
  ),
];

/** Lays the diagram out with every strategy and keeps the best-scoring scene; strategies that build the same ELK graph share one run. */
export function bestLayout(
  diagram: TamDiagram,
  measure: Measure,
  layout?: ElkLayout,
): Promise<Scene> {
  const memo = new Map<string, Promise<ElkNode>>();
  // The labels a source places stand there in whichever layout wins.
  return bestScene(
    (strategy) => layoutTam(diagram, measure, { ...strategy, layout, memo }),
    STRATEGIES,
    1,
    RETRIES,
  ).then((scene) => withLabels(scene, diagram));
}

/**
 * Parses, lays out and draws a TAM source. Layouts are cached per source and font, so redrawing in
 * other colors is cheap. `measure` replaces the canvas text metrics (Node); such layouts are not
 * cached, nor is a `draft` (a drag's preview: layoutPlaced), which the drop draws again in full.
 */
export async function renderTam(
  source: string,
  colors: DiagramColors,
  options: { layout?: ElkLayout; measure?: Measure; draft?: boolean } = {},
): Promise<TamPicture> {
  const diagram = parseTam(source);
  const laidOut = await (options.measure || options.draft
    ? layoutDiagram(
        diagram,
        options.measure ?? textMeasure(colors.font),
        options.layout,
        options.draft,
      )
    : cachedLayout(`tam\u0000${colors.font}\u0000${source}`, () =>
        layoutDiagram(diagram, textMeasure(colors.font), options.layout),
      ));
  const scene = withSourceCorners(laidOut, source);
  const description = diagram.title || "TAM block diagram";
  const svg = drawScene(scene, colors, description, "tam");
  return { svg, width: scene.bounds.width, height: scene.bounds.height, description, scene };
}
