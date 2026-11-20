/** SAP TAM protocol boundaries: dashed lines through the channels that use one protocol. */

import { type Box, grow, overlaps, type Point, type Scene, type SceneShape } from "./scene.ts";
import { type Measure, SMALL, textBox } from "./text.ts";
import { SOCKET } from "./markers.ts";
import { fallback } from "./route.ts";
import type { TamDiagram } from "./tam.ts";

/** Shapes that mark connections rather than stand for elements. */
const MARKS = new Set<SceneShape["kind"]>(["circle", "pointer", "dots"]);

/** How far a boundary reaches out past its own channels, step by step, to find room for its name. */
const EXTENSIONS = [24, 48, 96, 160];

/** Whether an axis-aligned segment touches the closed box. */
function segmentTouches(a: Point, b: Point, box: Box): boolean {
  return (
    Math.max(a.x, b.x) >= box.x &&
    Math.min(a.x, b.x) <= box.x + box.width &&
    Math.max(a.y, b.y) >= box.y &&
    Math.min(a.y, b.y) <= box.y + box.height
  );
}

/**
 * Protocol boundaries as in the TAM standard (figure 3-11): a dashed line through the circles of the
 * channels that use one protocol, drawn under them, with the protocol's name above its right end.
 * Labels and request markers on the line cut a gap in the dashes with their halo. Channels in
 * different layers get separate boundaries.
 */
export function protocolBoundaries(
  diagram: TamDiagram,
  scene: Scene,
  centers: Map<string, Point>,
  labels: Map<string, Box[]>,
  vertical: boolean,
  measure: Measure,
) {
  // Elements, as opposed to the marks drawn on connections (circles, request pointers, dots).
  const elements = scene.shapes.filter((shape) => !shape.container && !MARKS.has(shape.kind));
  const byName = new Map<string, string[]>();
  for (const edge of diagram.edges)
    if (edge.protocol && centers.has(edge.id))
      byName.set(edge.protocol, [...(byName.get(edge.protocol) ?? []), edge.id]);
  const level = (point: Point) => (vertical ? point.y : point.x),
    along = (point: Point) => (vertical ? point.x : point.y);
  const make = (a: number, l: number) => (vertical ? { x: a, y: l } : { x: l, y: a });
  const occupied = [
    ...scene.shapes.filter((shape) => !shape.container).map((shape) => shape.box),
    ...scene.texts.map((item) => item.box),
  ];
  for (const [name, ids] of byName) {
    const clusters: string[][] = [];
    for (const id of ids.toSorted((a, b) => level(centers.get(a)!) - level(centers.get(b)!))) {
      const last = clusters.at(-1);
      // A boundary is one straight line: only channels on exactly one level share it.
      // One line per level, broken where an element stands between two of its channels.
      const blocked = (a: Point, b: Point) =>
        elements.some((shape) => segmentTouches(a, b, shape.box));
      if (
        last &&
        Math.abs(level(centers.get(id)!) - level(centers.get(last.at(-1)!)!)) < 1 &&
        !blocked(centers.get(last.at(-1)!)!, centers.get(id)!)
      )
        last.push(id);
      else clusters.push([id]);
    }
    for (const cluster of clusters) {
      // One straight line: every point on the first channel's level.
      const points = cluster
        .map((id) => centers.get(id)!)
        .toSorted((a, b) => along(a) - along(b))
        .map((point) => make(along(point), level(centers.get(cluster[0])!)));
      // The line reaches past the channel markers and labels on both sides.
      const boxes = cluster.flatMap((id) => labels.get(`${id}#node`) ?? []);
      // As in the standard's figures, the line reaches well past the outermost channels, but each end
      // stops before the first element, foreign channel or label in its way; it always clears its own channels' labels.
      const ownLow = Math.min(
        along(points[0]) - 24,
        ...boxes.map((box) => (vertical ? box.x : box.y) - 8),
      );
      const ownHigh = Math.max(
        along(points.at(-1)!) + 24,
        ...boxes.map((box) => (vertical ? box.x + box.width : box.y + box.height) + 8),
      );
      const line = level(points[0]),
        owners = new Set(cluster.map((id) => `${id}#node`));
      const obstacles = [
        ...elements.map((shape) => shape.box),
        ...scene.shapes
          .filter((shape) => MARKS.has(shape.kind) && !owners.has(shape.id))
          .map((shape) => shape.box),
        ...scene.texts
          .filter((item) => !item.owner || !owners.has(item.owner))
          .map((item) => item.box),
        // Boundaries already drawn near this level: lines of two protocols never run into each other.
        ...scene.lines
          .filter(
            (line) =>
              line.clear && Math.abs(line.points[0][vertical ? "y" : "x"] - level(points[0])) < 12,
          )
          .map(({ points: trace }) => {
            const xs = trace.map((point) => point.x),
              ys = trace.map((point) => point.y);
            return {
              x: Math.min(...xs) - 4,
              y: Math.min(...ys) - 4,
              width: Math.max(...xs) - Math.min(...xs) + 8,
              height: Math.max(...ys) - Math.min(...ys) + 8,
            };
          }),
        // Wires of other connections that cross the line: a boundary never reaches across them.
        ...scene.wires
          .filter((item) => !cluster.includes(item.edge))
          .flatMap((item) =>
            item.points.slice(1).map((point, index) => {
              const previous = item.points[index];
              return {
                x: Math.min(previous.x, point.x) - 1,
                y: Math.min(previous.y, point.y) - 1,
                width: Math.abs(point.x - previous.x) + 2,
                height: Math.abs(point.y - previous.y) + 2,
              };
            }),
          ),
      ].filter(
        (box) =>
          (vertical ? box.y : box.x) < line + 3 &&
          (vertical ? box.y + box.height : box.x + box.width) > line - 3,
      );
      const start = (box: Box) => (vertical ? box.x : box.y),
        stop = (box: Box) => (vertical ? box.x + box.width : box.y + box.height);
      const first = along(points[0]),
        last = along(points.at(-1)!);
      const low = Math.min(
        first - 12,
        Math.max(
          ownLow - 20,
          ...obstacles.filter((box) => stop(box) <= first - 9).map((box) => stop(box) + 8),
        ),
      );
      const high = Math.max(
        last + 12,
        Math.min(
          ownHigh + 20,
          ...obstacles.filter((box) => start(box) >= last + 9).map((box) => start(box) - 8),
        ),
      );
      // Above the right end of the line as in the standard; else above the left end, or below either end.
      // When no spot is free, the line reaches further out until one is.
      const width = measure(name, SMALL, 400);
      const placesAt = (first: Point, last: Point) => {
        /** Above and below the right end, then the left end, `offset` from the line. */
        const endsAt = (offset: number) => [
          { x: last.x - width, y: last.y - offset },
          { x: first.x, y: first.y - offset },
          { x: last.x - width, y: last.y + offset },
          { x: first.x, y: first.y + offset },
        ];
        return vertical
          ? [
              ...[10, 18, 27].flatMap(endsAt),
              { x: last.x + 6, y: last.y },
              { x: first.x - width - 6, y: first.y },
              // Dense diagrams: above or below the line between two of its channels, or further out at the ends.
              ...points.slice(1).flatMap((point, index) =>
                [10, -10, 20, -20].map((offset) => ({
                  x: (points[index].x + point.x) / 2 - width / 2,
                  y: point.y + offset,
                })),
              ),
              ...[36, 46].flatMap(endsAt),
            ]
          : [
              { x: last.x + 5, y: last.y - width / 2 - 4 },
              { x: first.x + 5, y: first.y + width / 2 + 4 },
              { x: last.x - 5 - width, y: last.y - 8 },
              { x: first.x - 5 - width, y: first.y + 8 },
            ];
      };
      /** The label's box at each place, best first. */
      const labelsAt = (first: Point, last: Point) =>
        placesAt(first, last).map((place) => ({
          place,
          box: textBox(name, place.x, place.y, SMALL, 400, "start", measure),
        }));
      const borders = scene.shapes
        .filter((shape) => shape.container)
        .flatMap((shape) => {
          const { x, y, width: w, height: h } = shape.box;
          return [
            [
              { x, y },
              { x: x + w, y },
            ],
            [
              { x, y: y + h },
              { x: x + w, y: y + h },
            ],
            [
              { x, y },
              { x, y: y + h },
            ],
            [
              { x: x + w, y },
              { x: x + w, y: y + h },
            ],
          ] as Point[][];
        });
      const free = (box: Box) =>
        !occupied.some((other) => overlaps(box, other)) &&
        !scene.wires.some((item) =>
          item.points
            .slice(1)
            .some((point, index) => segmentTouches(item.points[index], point, box)),
        ) &&
        !borders.some(([a, b]) => segmentTouches(a, b, box));
      let trace: Point[] = [],
        chosen: { place: { x: number; y: number }; box: Box } | undefined;
      // Extensions are tried on each side separately; a side extends only where nothing is in the way.
      const reaches = [
        [0, 0],
        ...EXTENSIONS.flatMap((extra) => [
          [0, extra],
          [extra, 0],
          [extra, extra],
        ]),
      ];
      for (const [left, right] of reaches) {
        if (left && obstacles.some((box) => stop(box) > low - left && start(box) < low)) continue;
        if (right && obstacles.some((box) => start(box) < high + right && stop(box) > high))
          continue;
        trace = [
          make(low - left, level(points[0])),
          ...points,
          make(high + right, level(points.at(-1)!)),
        ];
        chosen = labelsAt(trace[0], trace.at(-1)!).find((candidate) =>
          free(grow(candidate.box, 2)),
        );
        if (chosen) {
          if (left || right) fallback("protocol-line-extended");
          break;
        }
      }
      if (!chosen) {
        fallback("protocol-name-scan");
        // Still no spot: scan above and below the whole line and as far beyond as it could reach.
        trace = [make(low, level(points[0])), ...points, make(high, level(points.at(-1)!))];
        chosen = scanName(
          name,
          { low, high, level: level(points[0]), vertical, width },
          measure,
          free,
        );
      }
      if (!chosen) {
        fallback("protocol-name-least-cover");
        // No free spot: keep the line at its own reach and put the name where it covers the least.
        trace = [make(low, level(points[0])), ...points, make(high, level(points.at(-1)!))];
        const covered = (box: Box) =>
          occupied.reduce(
            (sum, other) =>
              sum +
              Math.max(
                0,
                Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x),
              ) *
                Math.max(
                  0,
                  Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y),
                ),
            0,
          ) +
          400 *
            scene.wires.filter((item) =>
              item.points
                .slice(1)
                .some((point, index) => segmentTouches(item.points[index], point, box)),
            ).length;
        chosen = labelsAt(trace[0], trace.at(-1)!).reduce((best, candidate) =>
          covered(candidate.box) < covered(best.box) ? candidate : best,
        );
      }
      // The line passes behind a channel's filled circle; at an assembly's open socket it breaks instead, as wires
      // break where they cross, so the joint stays readable.
      const joints = cluster
        .filter((id) => diagram.edges.find((edge) => edge.id === id)?.kind === "assembly")
        .map((id) => along(centers.get(id)!))
        .toSorted((x, y) => x - y);
      let from = Math.min(along(trace[0]), along(trace.at(-1)!));
      const to = Math.max(along(trace[0]), along(trace.at(-1)!)),
        gap = SOCKET + 3;
      for (const joint of [...joints, Infinity]) {
        const end = Math.min(to, joint - gap);
        if (end - from > 2)
          scene.lines.push({
            points: [make(from, level(trace[0])), make(end, level(trace[0]))],
            dashed: true,
            tone: "boundary",
            width: 1.2,
            clear: true,
            ends: [...owners],
          });
        from = Math.max(from, joint + gap);
      }
      occupied.push(chosen.box);
      scene.texts.push({
        text: name,
        x: chosen.place.x,
        y: chosen.place.y,
        size: SMALL,
        weight: 400,
        anchor: "start",
        tone: "secondary",
        italic: true,
        halo: "background",
        box: chosen.box,
        role: "protocol",
      });
    }
  }
}

/** A protocol's line along its level, from `low` to `high`, with the width of its name. */
interface NameLine {
  low: number;
  high: number;
  level: number;
  vertical: boolean;
  width: number;
}

/**
 * The first free place for a protocol's name above or below its line, nearest the line first, as
 * far beyond its ends as the line could reach: past a wire that stops the line, too, rather than on
 * it. Undefined where none is free.
 */
function scanName(name: string, line: NameLine, measure: Measure, free: (box: Box) => boolean) {
  const { low, high, level, vertical, width } = line,
    reach = EXTENSIONS.at(-1)!;
  const gap = (box: Box) =>
    vertical
      ? Math.max(0, low - box.x - box.width, box.x - high)
      : Math.max(0, low - box.y - box.height, box.y - high);
  for (const offset of [12, -12, 20, -20, 30, -30]) {
    const places = [];
    for (let at = low - width - reach; at <= high + reach; at += 8) {
      const place = vertical
        ? { x: at, y: level + offset }
        : { x: level + (offset > 0 ? 6 : -6 - width), y: at };
      places.push({ place, box: textBox(name, place.x, place.y, SMALL, 400, "start", measure) });
    }
    const found = places
      .toSorted((p, q) => gap(p.box) - gap(q.box))
      .find((candidate) => free(grow(candidate.box, 2)));
    if (found) return found;
  }
  return undefined;
}
