/**
 * Layout by hand for the diagrams that lay themselves out: a pass over the finished automatic
 * scene that stands every part where the source places it (uml-places.ts). A part keeps the size
 * the automatic layout gave it and takes its position from its place; containers fit what they
 * hold, lanes keep their nodes, and the wires of what moved are laid again (uml-placed-wires.ts).
 * The pass does not ask what type the diagram is: it reads the scene.
 */

import {
  around,
  type Box,
  grow,
  inside,
  overlaps,
  type Point,
  type Scene,
  type SceneShape,
  type SceneText,
} from "./scene.ts";
import { chainOf, sceneTree, type SceneTree, shiftTexts } from "./scene-tree.ts";
import { finishBounds, type Measure, textGroupBox } from "./text.ts";
import { type LineStyle, rewire } from "./uml-placed-wires.ts";
import { readPlaces, unplaced } from "./uml-places.ts";

export { chainOf, sceneTree, type SceneTree } from "./scene-tree.ts";

/** How a placed scene is made: the style of its wires, where the scene does not say. */
export interface PlaceOptions {
  /** Wires with corners between the sides of boxes, or straight and curved lines between outlines. */
  lines?: LineStyle;
}

/** The lifelines of a sequence diagram hang on shapes with this prefix: its participants. */
const HEAD = "head:";

/** Whether a scene is a sequence diagram's: its participants stand in a row above their lifelines. */
const isSequence = (scene: Scene) =>
  scene.shapes.some((shape) => shape.id.startsWith(HEAD)) &&
  scene.lines.some((line) => line.tone === "boundary");

/**
 * The shapes of a scene that take a place: every part that holds nothing, and a container while
 * it is empty. In a sequence diagram only the participants do.
 */
export function placeable(scene: Scene, tree: SceneTree = sceneTree(scene)): string[] {
  if (isSequence(scene))
    return scene.shapes.filter((shape) => shape.id.startsWith(HEAD)).map((shape) => shape.id);
  return scene.shapes
    .filter((shape) =>
      shape.container
        ? !tree.children.get(shape.id)?.length && shape.kind !== "region"
        : !shape.passable,
    )
    .map((shape) => shape.id);
}

/** The shapes that take a place inside a container, at any depth; the shape itself when it takes one. */
export function placeableIn(
  scene: Scene,
  id: string,
  tree: SceneTree = sceneTree(scene),
): string[] {
  const all = new Set(placeable(scene, tree));
  return [...all].filter((item) => chainOf(tree, item).includes(id));
}

/** Where each shape that takes a place stands in a scene, in whole numbers: what pinning writes. */
export function placesOf(scene: Scene): Map<string, Point> {
  const boxes = new Map(scene.shapes.map((shape) => [shape.id, shape.box]));
  return new Map(
    placeable(scene).map((id) => {
      const box = boxes.get(id)!;
      return [id, { x: Math.round(box.x), y: Math.round(box.y) }];
    }),
  );
}

/** A copy of a scene whose shapes, wires, markers, lines and texts can be changed. */
function copyOf(scene: Scene): Scene {
  return {
    ...scene,
    shapes: scene.shapes.map((shape) => ({
      ...shape,
      box: { ...shape.box },
      dividers: shape.dividers && [...shape.dividers],
    })),
    wires: scene.wires.map((wire) => ({ ...wire, points: wire.points.map((p) => ({ ...p })) })),
    markers: scene.markers.map((marker) => ({ ...marker, tip: { ...marker.tip } })),
    lines: scene.lines.map((line) => ({ ...line, points: line.points.map((p) => ({ ...p })) })),
    texts: scene.texts.map((text) => ({ ...text, box: { ...text.box } })),
    bounds: { ...scene.bounds },
  };
}

/** Moves a shape with its dividers. */
function shiftShape(shape: SceneShape, dx: number, dy: number) {
  shape.box = { ...shape.box, x: shape.box.x + dx, y: shape.box.y + dy };
  if (shape.dividers) shape.dividers = shape.dividers.map((y) => y + dy);
}

/** The lanes of a swimlane diagram, read from its frame and the lines between its lanes. */
interface Lanes {
  /** The axis the lanes lie side by side along. */
  across: "x" | "y";
  /** The borders of the lanes along that axis, the frame's edges included. */
  bounds: number[];
  frame: Box;
  /** The frame's line and the separators, by their index in the scene's lines. */
  frameLine: number;
  separators: number[];
}

/** Nodes keep this far from the border of their lane, and from the lane's title. */
const LANE_PAD = 16;

function lanesOf(scene: Scene): Lanes | undefined {
  const titles = scene.texts.filter((text) => text.owner?.startsWith("lane:"));
  if (!titles.length || scene.shapes.some((shape) => shape.container)) return undefined;
  const frameLine = scene.lines.findIndex(
    ({ points }) =>
      points.length === 5 && points[0].x === points[4].x && points[0].y === points[4].y,
  );
  if (frameLine < 0) return undefined;
  const corners = scene.lines[frameLine].points,
    frame = around(corners.map((point) => ({ ...point, width: 0, height: 0 })));
  const separators = scene.lines.flatMap((line, index) =>
    index !== frameLine && line.points.length === 2 ? [index] : [],
  );
  const first = separators.length ? scene.lines[separators[0]].points : undefined;
  const title = textGroupBox(titles.filter((text) => text.owner === titles[0].owner));
  const across: "x" | "y" = first
    ? Math.abs(first[0].x - first[1].x) < 0.5
      ? "x"
      : "y"
    : Math.abs(title.x + title.width / 2 - frame.x - frame.width / 2) <
        Math.abs(title.y + title.height / 2 - frame.y - frame.height / 2)
      ? "x"
      : "y";
  const size = across === "x" ? "width" : "height";
  return {
    across,
    bounds: [
      frame[across],
      ...separators.map((index) => scene.lines[index].points[0][across]),
      frame[across] + frame[size],
    ].toSorted((a, b) => a - b),
    frame,
    frameLine,
    separators,
  };
}

/** The lanes of an activity with lanes as an editor resizes them. */
export interface LaneFrame {
  /** The axis the lanes lie side by side along: their widths are taken along it. */
  across: "x" | "y";
  /** The borders of the lanes along that axis, the frame's edges included. */
  bounds: number[];
  /** The id of each lane, by its place among the lanes; undefined for the lane without a name. */
  ids: (string | undefined)[];
  /** The box of the frame around all lanes. */
  frame: Box;
}

/**
 * The lanes of a scene of an activity with lanes, with the ids of their subgraphs, which their
 * titles carry (`lane:<id>`); undefined for a scene without lanes.
 */
export function laneFrame(scene: Scene): LaneFrame | undefined {
  const lanes = lanesOf(scene);
  if (!lanes) return undefined;
  const { across, bounds, frame } = lanes,
    size = across === "x" ? "width" : "height";
  const titles = new Map<string, SceneText[]>();
  for (const text of scene.texts)
    if (text.owner?.startsWith("lane:"))
      titles.set(text.owner.slice(5), [...(titles.get(text.owner.slice(5)) ?? []), text]);
  const ids = bounds.slice(1).map((): string | undefined => undefined);
  for (const [id, texts] of titles) {
    const box = textGroupBox(texts),
      middle = box[across] + box[size] / 2,
      lane = bounds.findIndex(
        (_, index) => index < bounds.length - 1 && middle < bounds[index + 1],
      );
    if (lane >= 0) ids[lane] = id;
  }
  return { across, bounds, ids, frame };
}

/** A node's box kept inside the lane its middle lay in, and below the lane titles. */
function inLane(lanes: Lanes, scene: Scene, was: Box, box: Box): Box {
  const { across, bounds, frame } = lanes,
    along = across === "x" ? "y" : "x",
    size = across === "x" ? "width" : "height",
    alongSize = across === "x" ? "height" : "width";
  const middle = was[across] + was[size] / 2,
    lane = Math.max(
      0,
      bounds.findLastIndex((bound, index) => index < bounds.length - 1 && bound <= middle),
    );
  const low = bounds[lane] + LANE_PAD,
    high = bounds[lane + 1] - LANE_PAD - box[size];
  const titles = scene.texts.filter((text) => text.owner?.startsWith("lane:")),
    head = Math.max(...titles.map((text) => text.box[along] + text.box[alongSize]), frame[along]);
  return {
    ...box,
    [across]: high < low ? (low + high) / 2 : Math.min(Math.max(box[across], low), high),
    [along]: Math.max(box[along], head + LANE_PAD),
  };
}

/** The lanes as long as what stands in them: the frame and the lines between the lanes drawn again. */
function fitLanes(scene: Scene, auto: Scene, lanes: Lanes) {
  const { across, frame } = lanes,
    along = across === "x" ? "y" : "x",
    alongSize = across === "x" ? "height" : "width";
  const reach = (from: Scene) =>
    Math.max(
      ...from.shapes.map((shape) => shape.box[along] + shape.box[alongSize]),
      ...from.wires.flatMap((wire) => wire.points.map((point) => point[along])),
      ...from.texts
        .filter((text) => text.role !== "heading")
        .map((text) => text.box[along] + text.box[alongSize]),
    );
  // The room the automatic layout left after the last node stays.
  const end = reach(scene) + Math.max(LANE_PAD, frame[along] + frame[alongSize] - reach(auto)),
    start = frame[along];
  const point = (acrossAt: number, alongAt: number): Point =>
    across === "x" ? { x: acrossAt, y: alongAt } : { x: alongAt, y: acrossAt };
  const low = lanes.bounds[0],
    high = lanes.bounds.at(-1)!;
  scene.lines[lanes.frameLine].points = [
    point(low, start),
    point(high, start),
    point(high, end),
    point(low, end),
    point(low, start),
  ];
  for (const index of lanes.separators) {
    const at = scene.lines[index].points[0][across];
    scene.lines[index].points = [point(at, start), point(at, end)];
  }
}

/** An unplaced part keeps this far from the placed ones it is moved away from. */
const FREE = 16;

/** The spot nearest to where a box lies at which it keeps FREE from every one of `taken`. */
function freeSpot(box: Box, taken: Box[]): Box {
  const free = (spot: Box) => !taken.some((other) => overlaps(grow(spot, FREE), other));
  if (free(box)) return box;
  const step = 10;
  for (let ring = 1; ring < 400; ring++) {
    const spots: Box[] = [];
    for (let k = -ring; k <= ring; k++)
      for (const [dx, dy] of [
        [k, -ring],
        [k, ring],
        [-ring, k],
        [ring, k],
      ])
        spots.push({ ...box, x: box.x + dx * step, y: box.y + dy * step });
    const found = spots
      .filter(free)
      .toSorted(
        (a, b) => Math.hypot(a.x - box.x, a.y - box.y) - Math.hypot(b.x - box.x, b.y - box.y),
      )[0];
    if (found) return found;
  }
  return box;
}

/** A container's title keeps this far from its sides. */
const TITLE_PAD = 12;

/**
 * A scene with its parts where `places` says, by the id of their shapes: the top left corner of
 * each box. A part moves with its texts and dividers; a part without a place stays where the
 * automatic layout put it, or moves off a placed one it would lie on. Containers take the bounds
 * of what they hold with the room the automatic layout gave them around it, the nodes of a lane
 * stay in their lane, and the wires between parts that moved are laid again with their markers,
 * end texts and labels. A place that is the rounded automatic position means that position: a
 * scene whose parts all stand where the layout put them is that scene.
 */
export function placeScene(
  auto: Scene,
  places: ReadonlyMap<string, Point>,
  measure: Measure,
  options: PlaceOptions = {},
): Scene {
  const tree = sceneTree(auto),
    units = placeable(auto, tree);
  if (isSequence(auto) || !units.some((id) => places.has(id))) return auto;
  const scene = copyOf(auto);
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape])),
    before = new Map(auto.shapes.map((shape) => [shape.id, shape.box]));
  const lanes = lanesOf(auto);

  // Parts with a place first; then the others, off the placed ones.
  const target = new Map<string, Box>();
  for (const id of units) {
    const at = places.get(id),
      box = before.get(id)!;
    if (!at) continue;
    const next = {
      ...box,
      x: Math.round(box.x) === at.x ? box.x : at.x,
      y: Math.round(box.y) === at.y ? box.y : at.y,
    };
    target.set(id, lanes ? inLane(lanes, auto, box, next) : next);
  }
  const taken = [...target.values()];
  for (const id of units) {
    if (target.has(id)) continue;
    const spot = freeSpot(before.get(id)!, taken);
    target.set(id, lanes ? inLane(lanes, auto, before.get(id)!, spot) : spot);
    taken.push(target.get(id)!);
  }
  let changed = false;
  for (const [id, box] of target) {
    const was = before.get(id)!,
      dx = box.x - was.x,
      dy = box.y - was.y;
    if (!dx && !dy) continue;
    changed = true;
    shiftShape(shapes.get(id)!, dx, dy);
    shiftTexts(
      scene.texts.filter((text) => text.owner === id),
      dx,
      dy,
    );
  }
  if (!changed) return auto;

  // Containers, innermost first: around what they hold, with the room they had around it.
  const depthOf = (id: string) => chainOf(tree, id).length;
  const holders = scene.shapes
    .filter((shape) => tree.children.get(shape.id)?.length)
    .toSorted((a, b) => depthOf(b.id) - depthOf(a.id));
  for (const shape of holders) {
    const held = tree.children.get(shape.id)!,
      was = before.get(shape.id)!,
      inner = around(held.map((id) => before.get(id)!)),
      now = around(held.map((id) => shapes.get(id)!.box));
    const titles = scene.texts.filter((text) => text.owner === shape.id),
      least = titles.length ? textGroupBox(titles).width + 2 * TITLE_PAD : 0;
    let x = now.x - (inner.x - was.x),
      width = now.width + (was.width - inner.width);
    if (width < least) {
      x -= (least - width) / 2;
      width = least;
    }
    const box = {
      x,
      y: now.y - (inner.y - was.y),
      width,
      height: now.height + (was.height - inner.height),
    };
    fitContainer(scene, shape, was, box);
  }
  tileRegions(scene, auto, tree);

  const style = options.lines ?? styleOf(auto);
  rewire(scene, auto, tree, measure, style);
  if (lanes) fitLanes(scene, auto, lanes);

  const heading = scene.texts.find((text) => text.role === "heading");
  scene.texts = scene.texts.filter((text) => text.role !== "heading");
  finishBounds(scene, measure, heading?.text);
  return scene;
}

/** Gives a container another box: its title keeps its place across it, its dividers their depth. */
function fitContainer(scene: Scene, shape: SceneShape, was: Box, box: Box) {
  const titles = scene.texts.filter((text) => text.owner === shape.id);
  if (titles.length) {
    // A title in the middle stays there; one moved to a side keeps its distance to that side.
    const group = textGroupBox(titles),
      middle = group.x + group.width / 2 - was.x - was.width / 2;
    const dx =
      Math.abs(middle) < 1
        ? box.x + box.width / 2 - was.x - was.width / 2
        : middle < 0
          ? box.x - was.x
          : box.x + box.width - was.x - was.width;
    shiftTexts(titles, dx, box.y - was.y);
  }
  if (shape.dividers) shape.dividers = shape.dividers.map((y) => y + box.y - was.y);
  shape.box = box;
}

/**
 * The regions of a composite state lie side by side and fill it: each as long as the longest, the
 * borders between them halfway between what they hold, and the lines between them drawn there.
 */
function tileRegions(scene: Scene, auto: Scene, tree: SceneTree) {
  const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape])),
    before = new Map(auto.shapes.map((shape) => [shape.id, shape.box]));
  for (const [holder, held] of tree.children) {
    const regions = held.filter((id) => shapes.get(id)!.kind === "region");
    if (regions.length < 2) continue;
    const first = before.get(regions[0])!,
      second = before.get(regions[1])!,
      axis: "x" | "y" = Math.abs(first.x - second.x) >= Math.abs(first.y - second.y) ? "x" : "y",
      across = axis === "x" ? "y" : "x",
      size = axis === "x" ? "width" : "height",
      acrossSize = axis === "x" ? "height" : "width";
    const order = regions.toSorted((a, b) => before.get(a)![axis] - before.get(b)![axis]),
      all = around(order.map((id) => shapes.get(id)!.box));
    // The lines between the regions, in the order of the regions they part.
    const separators = auto.lines
      .map((line, index) => ({ line, index }))
      .filter(
        ({ line }) =>
          line.points.length === 2 &&
          Math.abs(line.points[0][axis] - line.points[1][axis]) < 0.5 &&
          inside({ ...line.points[0], width: 0, height: 0 }, before.get(holder)!, 1) &&
          order.some((id, k) => {
            const next = order[k + 1] && before.get(order[k + 1])!,
              box = before.get(id)!;
            return (
              !!next &&
              line.points[0][axis] >= box[axis] + box[size] - 1 &&
              line.points[0][axis] <= next[axis] + 1
            );
          }),
      )
      .toSorted((a, b) => a.line.points[0][axis] - b.line.points[0][axis]);
    order.forEach((id, k) => {
      const shape = shapes.get(id)!,
        next = order[k + 1] && shapes.get(order[k + 1])!;
      const box = { ...shape.box, [across]: all[across], [acrossSize]: all[acrossSize] };
      shape.box = box;
      if (!next) return;
      const gap = before.get(order[k + 1])![axis] - before.get(id)![axis] - before.get(id)![size],
        border = (box[axis] + box[size] + next.box[axis]) / 2;
      // Each region reaches to half the gap before the border, the next one from half after it.
      const start = box[axis];
      shape.box = { ...box, [size]: border - gap / 2 - start };
      const end = next.box[axis] + next.box[size];
      next.box = { ...next.box, [axis]: border + gap / 2, [size]: end - border - gap / 2 };
      const separator = separators[k];
      if (separator) {
        const point = (at: number): Point =>
          axis === "x" ? { x: border, y: at } : { x: at, y: border };
        scene.lines[separator.index].points = [
          point(all[across]),
          point(all[across] + all[acrossSize]),
        ];
      }
    });
  }
}

/** The style of a scene's wires: straight or curved lines where one runs at a slant or along a path. */
function styleOf(scene: Scene): LineStyle {
  const slanted = scene.wires.some(
    (wire) =>
      !!wire.path ||
      wire.points
        .slice(1)
        .some(
          (point, index) =>
            Math.abs(point.x - wire.points[index].x) > 0.5 &&
            Math.abs(point.y - wire.points[index].y) > 0.5,
        ),
  );
  return slanted ? "straight" : "orthogonal";
}

/** The automatic scenes of the sources laid out last, by measure and by the source without its places. */
const automatic = new WeakMap<Measure, Map<string, Promise<Scene>>>();

/** How many automatic scenes are kept for each measure. */
const KEPT = 8;

/**
 * Keeps the automatic scene of a source for the layouts by hand that follow: an editor that shows
 * it moves its parts from exactly where they stand.
 */
export function keepAutomatic(source: string, measure: Measure, scene: Scene) {
  const scenes = automatic.get(measure) ?? new Map<string, Promise<Scene>>();
  automatic.set(measure, scenes);
  const key = unplaced(source);
  scenes.delete(key);
  scenes.set(key, Promise.resolve(scene));
  if (scenes.size > KEPT) scenes.delete(scenes.keys().next().value!);
}

/**
 * The layout of a source that places its parts: its automatic layout, then `placeScene`. The
 * automatic scene is kept by the source without its places, so that moving a part lays nothing
 * out again and every layout of one source starts from the same scene.
 */
export function placedLayout<Layout>(
  source: string,
  layout: (measure: Measure, elk?: Layout) => Promise<Scene>,
  options: PlaceOptions = {},
): (measure: Measure, elk?: Layout) => Promise<Scene> {
  return async (measure, elk) => {
    const scenes = automatic.get(measure) ?? new Map<string, Promise<Scene>>();
    automatic.set(measure, scenes);
    const key = unplaced(source);
    let scene = scenes.get(key);
    if (scene) scenes.delete(key);
    else scene = layout(measure, elk);
    // The scene used last is the last to go.
    scenes.set(key, scene);
    if (scenes.size > KEPT) scenes.delete(scenes.keys().next().value!);
    try {
      return placeScene(await scene, readPlaces(source), measure, options);
    } catch (reason) {
      if (scenes.get(key) === scene) scenes.delete(key);
      throw reason;
    }
  };
}
