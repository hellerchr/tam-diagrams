/**
 * Entity relationship diagrams: measuring entities with their attribute columns and laying them
 * out with ELK, relationships as orthogonal lines with a crow's foot symbol at each end.
 */

import { bestScene, STRATEGIES } from "./best.ts";
import {
  type ElkLayout,
  type Graph,
  type GraphEdge,
  type GraphNode,
  layoutGraph,
  type Placement,
} from "./elk.ts";
import { hugLabels, smallSize, wrapSmall } from "./labels.ts";
import { MARKER_LENGTH } from "./markers.ts";
import { type Box, emptyScene, type Scene } from "./scene.ts";
import { addText, breaks, finishBounds, FONT, LINE, type Measure, SMALL, wrap } from "./text.ts";
import type { Cardinality, ErAttribute, ErDiagram, ErEntity } from "./uml-er.ts";
import { addWire, attachEnds, straightenScene } from "./wires.ts";

const PAD = 10,
  ROW = 18,
  /** Room between two columns of attributes. */
  GAP = 14,
  /** How far apart the loops of one entity leave and enter it, so the symbols at their ends stand side by side. */
  LOOP_STEP = 18,
  /** How far apart a graph layout sets the ends of nested loops. */
  LOOP_NEST = 8;

/** The columns of an entity's attributes, in the order they are drawn. */
const COLUMNS = ["type", "name", "keys", "comment"] as const;
type Column = (typeof COLUMNS)[number];

/** What an attribute shows in a column. */
const cell = (attribute: ErAttribute, column: Column): string =>
  column === "keys" ? attribute.keys.join(", ") : (attribute[column] ?? "");

/** The weight an attribute's cell is set in: the name of a primary key stands out. */
const weightOf = (attribute: ErAttribute, column: Column) =>
  column === "name" && attribute.keys.includes("PK") ? 600 : 400;

interface EntityBox {
  width: number;
  height: number;
  header: number;
  name: string[];
  /** Where each column starts, from the left side of the box; undefined for a column without text. */
  columns: Partial<Record<Column, number>>;
}

function measureEntity(entity: ErEntity, measure: Measure): EntityBox {
  const name = breaks(entity.label).flatMap((line) => wrap(line, 260, FONT, 600, measure));
  const header = 8 + name.length * LINE + 8;
  const columns: Partial<Record<Column, number>> = {};
  let x = PAD;
  for (const column of COLUMNS) {
    const width = Math.max(
      0,
      ...entity.attributes.map((attribute) =>
        cell(attribute, column)
          ? measure(cell(attribute, column), SMALL, weightOf(attribute, column))
          : 0,
      ),
    );
    if (!width) continue;
    columns[column] = x;
    x += Math.ceil(width) + GAP;
  }
  const rows = x > PAD ? x - GAP + PAD + 2 : 0;
  return {
    width: Math.ceil(
      Math.max(90, rows, ...name.map((line) => measure(line, FONT, 600) + 2 * PAD + 4)),
    ),
    height: header + (entity.attributes.length ? 5 + entity.attributes.length * ROW + 5 : 0),
    header,
    name,
    columns,
  };
}

const many = (cardinality: Cardinality) =>
  cardinality === "one-or-more" || cardinality === "zero-or-more";

/**
 * Moves the ends of the loops of an entity with several further apart along its outline, so the
 * symbols at their ends stand side by side. `loops` are its loops from the innermost outward, as
 * a graph layout routes them: in vertical layouts from the top side around the top right corner
 * into the right side, each further one beginning further left and ending further down; in
 * horizontal ones as arches on the top side, each further one wider on both sides.
 */
function spreadLoops(placement: Placement, loops: string[], box: Box, upright: boolean) {
  const extra = LOOP_STEP - LOOP_NEST,
    outer = loops.length - 1;
  loops.forEach((id, index) => {
    const route = placement.routes.get(id);
    if (!route || route.length !== (upright ? 5 : 4)) return;
    const points = route.map((point) => ({ ...point }));
    if (upright) {
      points[0].x = points[1].x = Math.max(box.x + 8, points[0].x - index * extra);
      points[3].y = points[4].y = Math.min(box.y + box.height - 8, points[4].y + index * extra);
    } else {
      // The outermost arch keeps its left end; the others move right, and every right end with them.
      points[0].x = points[1].x = points[0].x + (outer - index) * extra;
      points[2].x = points[3].x = Math.min(
        box.x + box.width - 8,
        points[3].x + (outer + index) * extra,
      );
    }
    placement.routes.set(id, points);
  });
}

/** The room an entity's side needs for the ends of its loops: nothing for fewer than two. */
const loopRoom = (count: number) => (count > 1 ? 2 * (count - 1) * LOOP_STEP + 80 : 0);

/** Lays an entity relationship diagram out and returns its scene. */
export async function layoutErDiagram(
  diagram: ErDiagram,
  measure: Measure,
  options: { layout?: ElkLayout } = {},
): Promise<Scene> {
  const vertical = diagram.direction === "TB" || diagram.direction === "BT";
  const boxes = new Map(
    [...diagram.entities.values()].map((entity) => [entity.id, measureEntity(entity, measure)]),
  );
  // An entity with many relationships grows along the sides where they arrive, so their symbols keep apart.
  const degree = new Map<string, number>();
  for (const relationship of diagram.relationships)
    if (relationship.source !== relationship.target)
      for (const end of [relationship.source, relationship.target])
        degree.set(end, (degree.get(end) ?? 0) + 1);
  const loops = new Map<string, string[]>();
  for (const relationship of diagram.relationships)
    if (relationship.source === relationship.target)
      loops.set(relationship.source, [...(loops.get(relationship.source) ?? []), relationship.id]);
  const roots: GraphNode[] = [...diagram.entities.values()].map((entity) => {
    const box = boxes.get(entity.id)!,
      room = ((degree.get(entity.id) ?? 0) + 1) * 16 + 8,
      looped = loops.get(entity.id)?.length ?? 0;
    // Several loops end side by side on the top side, and in vertical layouts on the right side too.
    return {
      id: entity.id,
      width: Math.max(box.width, vertical ? room : 0, loopRoom(looped)),
      height: Math.max(
        box.height,
        vertical ? 0 : room,
        vertical && looped > 1 ? looped * LOOP_STEP + 10 : 0,
      ),
    };
  });
  const labels = new Map(
    diagram.relationships
      .filter((relationship) => relationship.label)
      .map((relationship) => [relationship.id, wrapSmall(relationship.label!, measure)]),
  );
  const edges: GraphEdge[] = diagram.relationships.map((relationship) => ({
    id: relationship.id,
    source: relationship.source,
    target: relationship.target,
    // The entity there is one of stands above the many that belong to it, whichever way it is written.
    reversed: many(relationship.sourceCardinality) && !many(relationship.targetCardinality),
    label: labels.has(relationship.id)
      ? smallSize(labels.get(relationship.id)!, measure)
      : undefined,
    // A loop holds the symbols of both its ends.
    room:
      relationship.source === relationship.target
        ? Math.max(
            MARKER_LENGTH[relationship.sourceCardinality],
            MARKER_LENGTH[relationship.targetCardinality],
          )
        : undefined,
  }));

  const build = async ({ elk, scale }: { elk: Record<string, string>; scale: number }) => {
    const graph: Graph = { direction: diagram.direction, children: roots, edges };
    const placement = await layoutGraph(graph, {
      layout: options.layout,
      elk,
      // Room between the layers for the symbols at both ends of a line, and beside the ends for them.
      spacing: { port: 26 * scale, layer: 64 * scale, node: 40 * scale, edgeNode: 30 * scale },
    });
    for (const [id, own] of loops) {
      const box = placement.boxes.get(id);
      if (box && own.length > 1) spreadLoops(placement, own, box, vertical);
    }
    const scene = emptyScene();
    for (const entity of diagram.entities.values()) {
      const box = placement.boxes.get(entity.id),
        size = boxes.get(entity.id)!;
      if (!box) continue;
      // An entity without attributes is just its name, centred in the box.
      const bare = !entity.attributes.length;
      scene.shapes.push({
        id: entity.id,
        kind: "rect",
        box,
        container: false,
        depth: 0,
        fill: "page",
        dividers: bare ? [] : [box.y + size.header],
      });
      let y = box.y + 8 + (bare ? (box.height - size.header) / 2 : 0);
      for (const line of size.name) {
        addText(scene, measure, line, box.x + box.width / 2, y + LINE / 2, {
          size: FONT,
          weight: 600,
          role: "node",
          owner: entity.id,
        });
        y += LINE;
      }
      entity.attributes.forEach((attribute, index) => {
        const middle = box.y + size.header + 5 + ROW / 2 + index * ROW;
        for (const column of COLUMNS) {
          const text = cell(attribute, column),
            x = size.columns[column];
          if (!text || x === undefined) continue;
          const primary = column === "name" && attribute.keys.includes("PK");
          addText(scene, measure, text, box.x + x, middle, {
            size: SMALL,
            anchor: "start",
            weight: weightOf(attribute, column),
            underline: primary,
            italic: column === "comment",
            tone: column === "name" ? "text" : "secondary",
            role: "member",
            owner: entity.id,
          });
        }
      });
    }
    const shapes = new Map(scene.shapes.map((shape) => [shape.id, shape]));
    for (const relationship of diagram.relationships)
      addWire(
        scene,
        placement,
        {
          id: relationship.id,
          source: relationship.source,
          target: relationship.target,
          dashed: !relationship.identifying,
          startMarker: relationship.sourceCardinality,
          endMarker: relationship.targetCardinality,
          label: labels.get(relationship.id),
        },
        shapes,
        measure,
      );
    attachEnds(scene);
    straightenScene(scene);
    hugLabels(scene);
    finishBounds(scene, measure, diagram.title);
    return scene;
  };
  // Each strategy at normal spacing, then again with more room for dense diagrams.
  return bestScene(build, [
    ...STRATEGIES.map((elk) => ({ elk, scale: 1 })),
    ...STRATEGIES.slice(0, 2).map((elk) => ({ elk, scale: 1.5 })),
  ]);
}
