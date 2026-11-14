/** Swimlane activity diagrams: lanes, rows and a grid router of their own. */

import type { Flowchart } from "./uml-activity.ts";
import { addText, finishBounds, FONT, LINE, type Measure } from "./text.ts";
import { emptyScene, type Scene, unit } from "./scene.ts";
import { drawNode, MARKERS } from "./uml-activity-layout.ts";
import type { Placement } from "./elk.ts";
import { hugLabels, smallLines } from "./labels.ts";
import { attachEnds, spreadVertices, straightenScene } from "./wires.ts";
import { placeSwimlanes } from "./swimlane-place.ts";
import { routeSwimlanes } from "./swimlane-routes.ts";

export async function layoutSwimlanes(original: Flowchart, measure: Measure): Promise<Scene> {
  const placed = placeSwimlanes(original, measure);
  const {
    bottom,
    boxOf,
    chart,
    items,
    labelBox,
    laneWidths,
    laneX,
    lanes,
    titles,
    vertical,
    visible,
  } = placed;
  const { flip, flipBox, labelBoxes, labelText, routes } = routeSwimlanes(placed, measure);
  const scene = emptyScene();
  const total = laneX[lanes.length - 1] + laneWidths[lanes.length - 1];
  const frame = flipBox({ x: 0, y: 0, width: total, height: bottom });
  scene.lines.push({
    points: [
      { x: frame.x, y: frame.y },
      { x: frame.x + frame.width, y: frame.y },
      { x: frame.x + frame.width, y: frame.y + frame.height },
      { x: frame.x, y: frame.y + frame.height },
      { x: frame.x, y: frame.y },
    ],
    tone: "ink",
    width: 1.2,
  });
  laneX.slice(1).forEach((x) =>
    scene.lines.push({
      points: [flip({ x, y: 0 }), flip({ x, y: bottom })],
      dashed: true,
      tone: "ink",
      width: 1.1,
    }),
  );
  lanes.forEach((_, index) => {
    const lines = titles[index];
    if (!lines.length) return;
    if (vertical)
      lines.forEach((line, row) =>
        addText(
          scene,
          measure,
          line,
          laneX[index] + laneWidths[index] / 2,
          10 + LINE / 2 + row * LINE,
          { size: FONT, weight: 600, role: "title", owner: `lane:${index}` },
        ),
      );
    else
      lines.forEach((line, row) =>
        addText(
          scene,
          measure,
          line,
          14,
          laneX[index] + laneWidths[index] / 2 + (row - (lines.length - 1) / 2) * LINE,
          { size: FONT, weight: 600, anchor: "start", role: "title", owner: `lane:${index}` },
        ),
      );
  });
  for (const item of items.values()) {
    const box = flipBox(boxOf(item)),
      node = chart.nodes.get(item.id)!;
    const side = item.side && flipBox(labelBox(item, item.side));
    drawNode(scene, measure, item.id, { ...item.size, later: false }, box, 0, node.label, side);
  }
  const placement: Placement = {
    boxes: new Map(),
    routes: new Map(),
    edgeLabels: new Map(),
    nodeLabels: new Map(),
    ancestors: new Map(),
    nodes: new Map(),
    edges: new Map(),
  };
  for (const edge of visible) {
    const points = routes.get(edge.id)!.map(flip);
    placement.routes.set(edge.id, points);
    scene.wires.push({
      edge: edge.id,
      points,
      dashed: edge.stroke === "dotted",
      thick: edge.stroke === "thick",
      ends: [edge.source, edge.target],
      home: [],
      from: edge.source,
      to: edge.target,
    });
    if (edge.start)
      scene.markers.push({
        kind: MARKERS[edge.start],
        tip: points[0],
        direction: unit(points[1], points[0]),
        wire: edge.id,
      });
    if (edge.end)
      scene.markers.push({
        kind: MARKERS[edge.end],
        tip: points.at(-1)!,
        direction: unit(points.at(-2)!, points.at(-1)!),
        wire: edge.id,
      });
  }
  // Labels go in before the wires are straightened, so they move with their wires.
  for (const [id, box] of labelBoxes) {
    const shown = flipBox(box);
    smallLines(
      scene,
      measure,
      labelText.get(id)!,
      shown.x + shown.width / 2,
      shown.y + shown.height / 2,
      { role: "label", owner: id },
    );
  }
  spreadVertices(scene);
  attachEnds(scene);
  straightenScene(scene);
  attachEnds(scene);
  hugLabels(scene);
  finishBounds(scene, measure, chart.title);
  return scene;
}
