/**
 * The lanes of an activity with lanes as its scene draws them: the frame around them, the lines
 * between them and their titles, read back for the layout by hand (uml-placed.ts) and for an
 * editor that resizes them (`laneFrame`).
 */

import { around, type Box, type Point, type Scene, type SceneText } from "./scene.ts";
import { textGroupBox } from "./text.ts";

/** The lanes of a swimlane diagram, read from its frame and the lines between its lanes. */
export interface Lanes {
  /** The axis the lanes lie side by side along. */
  across: "x" | "y";
  /** The borders of the lanes along that axis, the frame's edges included. */
  bounds: number[];
  frame: Box;
  /** The frame's line and the separators, by their index in the scene's lines. */
  frameLine: number;
  separators: number[];
}

/** The texts of a scene that are the titles of lanes. */
export const laneTitles = (scene: Scene) =>
  scene.texts.filter((text) => text.owner?.startsWith("lane:"));

/** The index of the line that frames the lanes: the one closed line of four sides. */
const frameLineOf = (scene: Scene) =>
  scene.lines.findIndex(
    ({ points }) =>
      points.length === 5 && points[0]!.x === points[4]!.x && points[0]!.y === points[4]!.y,
  );

/**
 * The axis the lanes lie side by side along: across the line between the first two, or, for a
 * single lane, the axis its title lies nearer the middle of the frame on.
 */
function acrossOf(first: Point[] | undefined, title: Box, frame: Box): "x" | "y" {
  if (first) return Math.abs(first[0]!.x - first[1]!.x) < 0.5 ? "x" : "y";
  return Math.abs(title.x + title.width / 2 - frame.x - frame.width / 2) <
    Math.abs(title.y + title.height / 2 - frame.y - frame.height / 2)
    ? "x"
    : "y";
}

/** The lanes of a scene of an activity with lanes; undefined for a scene without. */
export function lanesOf(scene: Scene): Lanes | undefined {
  const titles = laneTitles(scene);
  if (!titles.length || scene.shapes.some((shape) => shape.container)) return undefined;
  const frameLine = frameLineOf(scene);
  if (frameLine < 0) return undefined;
  const corners = scene.lines[frameLine]!.points,
    frame = around(corners.map((point) => ({ ...point, width: 0, height: 0 })));
  const separators = scene.lines.flatMap((line, index) =>
    index !== frameLine && line.points.length === 2 ? [index] : [],
  );
  const first = separators.length ? scene.lines[separators[0]!]!.points : undefined;
  const title = textGroupBox(titles.filter((text) => text.owner === titles[0]!.owner));
  const across = acrossOf(first, title, frame);
  const size = across === "x" ? "width" : "height";
  return {
    across,
    bounds: [
      frame[across],
      ...separators.map((index) => scene.lines[index]!.points[0]![across]),
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
  for (const text of laneTitles(scene)) {
    const id = text.owner!.slice(5);
    titles.set(id, [...(titles.get(id) ?? []), text]);
  }
  const ids = bounds.slice(1).map((): string | undefined => undefined);
  for (const [id, texts] of titles) {
    const box = textGroupBox(texts),
      middle = box[across] + box[size] / 2,
      lane = bounds.findIndex(
        (_, index) => index < bounds.length - 1 && middle < bounds[index + 1]!,
      );
    if (lane >= 0) ids[lane] = id;
  }
  return { across, bounds, ids, frame };
}
