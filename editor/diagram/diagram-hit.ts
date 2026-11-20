// The plain geometry and text math of the diagram editor (DiagramView.svelte): what the pointer is over in a picture,
// which element a dragged one lands in, and a new source as the one small change to the buffer. No tam-diagrams here,
// so Node tests it.

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
/** Something of a diagram that can be selected: an element or a connection, by id. */
export type Part = { type: "element" | "wire"; id: string };
/** An element as the editor hits it: its box, how deep it is nested, whether it may hold others, and what holds it
 *  (null: the diagram). */
export type HitElement = {
  id: string;
  box: Box;
  depth: number;
  holder: boolean;
  parent?: string | null;
};
/** The label of a connection where the picture draws it: the box around its lines, the middle of the line it is
 *  placed from, and the key the source places it by. */
export type WireLabel = { box: Box; middle: Point; key: string };
/** A diagram's elements and wires (with their labels and a channel's circle) where the picture draws them. */
export type Hits = {
  elements: HitElement[];
  wires: { id: string; points: Point[]; label?: WireLabel; circle?: Box }[];
};

/** Whether `point` lies in `box`. */
export const inBox = (box: Box, point: Point) =>
  point.x >= box.x &&
  point.x <= box.x + box.width &&
  point.y >= box.y &&
  point.y <= box.y + box.height;

/** The distance from `p` to the segment from `a` to `b`. */
function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t =
    dx || dy
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
      : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** The innermost element at `point` that `accept` takes. */
function innermost(
  hits: Hits,
  point: Point,
  accept: (element: HitElement) => boolean,
): HitElement | undefined {
  let found: HitElement | undefined;
  for (const element of hits.elements)
    if (inBox(element.box, point) && accept(element) && (!found || element.depth > found.depth))
      found = element;
  return found;
}

/** Whether an element holds others in the picture. */
const holdsAny = (hits: Hits, id: string) => hits.elements.some((e) => e.parent === id);

/** The wire whose label lies at `point`, else whose line passes nearest to it within `reach`. */
export function wireAt(hits: Hits, point: Point, reach: number): Hits["wires"][number] | undefined {
  const labelled = hits.wires.find((w) => w.label && inBox(grown(w.label.box, 2), point));
  if (labelled) return labelled;
  let nearest: { wire: Hits["wires"][number]; away: number } | undefined;
  for (const wire of hits.wires)
    for (let i = 1; i < wire.points.length; i++) {
      const away = toSegment(point, wire.points[i - 1]!, wire.points[i]!);
      if (away <= reach && (!nearest || away < nearest.away)) nearest = { wire, away };
    }
  return nearest?.wire;
}

/** The part at `point`, as the old editor found it: an element that holds nothing first, then a connection's label or
 *  the line within `reach` (lines run over the elements that hold others), then the innermost element. */
export function partAt(hits: Hits, point: Point, reach: number): Part | undefined {
  const leaf = innermost(hits, point, (e) => !holdsAny(hits, e.id));
  if (leaf) return { type: "element", id: leaf.id };
  const wire = wireAt(hits, point, reach);
  if (wire) return { type: "wire", id: wire.id };
  const element = innermost(hits, point, () => true);
  return element && { type: "element", id: element.id };
}

/** The element under `point` a dragged element would drop into (null: the diagram): the innermost that holds others,
 *  or with `leaves` any; never one of `except`. */
export const elementAt = (hits: Hits, point: Point, except: ReadonlySet<string>, leaves: boolean) =>
  innermost(hits, point, (e) => !except.has(e.id) && (leaves || e.holder))?.id ?? null;

/** The selection after a press on `part` (undefined: the background). Adding toggles the part in or out and keeps the
 *  rest; otherwise a press on a selected part keeps the selection (to move it all), else it is the part alone. */
export function pressed(selection: Part[], part: Part | undefined, adding: boolean): Part[] {
  if (!part) return adding ? selection : [];
  const other = (s: Part) => s.type !== part.type || s.id !== part.id;
  const rest = selection.filter(other);
  if (rest.length < selection.length) return adding ? rest : selection;
  return adding ? [...selection, part] : [part];
}

/** The element that would hold something dropped at `point` (null: the diagram itself), never one of `moving`. */
export const holderAt = (hits: Hits, point: Point, moving: ReadonlySet<string>) =>
  innermost(hits, point, (e) => e.holder && !moving.has(e.id))?.id ?? null;

/** `box` moved by `delta`. */
export const shift = (box: Box, delta: Point): Box => ({
  ...box,
  x: box.x + delta.x,
  y: box.y + delta.y,
});

/** The middle of `box`. */
export const middle = (box: Box): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** `box` grown by `by` on every side. */
export const grown = (box: Box, by: number): Box => ({
  x: box.x - by,
  y: box.y - by,
  width: box.width + 2 * by,
  height: box.height + 2 * by,
});

/** Where two boxes overlap; undefined when they do not. */
export function overlap(a: Box, b: Box): Box | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

/** The one replacement that turns `before` into `after`: what lies between their common start and end. */
export function textChange(
  before: string,
  after: string,
): { from: number; to: number; insert: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  const room = Math.min(before.length, after.length) - start;
  while (end < room && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

/** Where the name of a part is typed, and in what font, as the old editor's label editor had it: on an element (a
 *  container's title strip), 14 px, bold for a container; on a connection's label, else at `at` (or the middle of its
 *  line), 12 px. Undefined for a part not drawn. */
export function nameBox(
  hits: Hits,
  part: Part,
  at?: Point,
): { box: Box; size: number; weight: number } | undefined {
  if (part.type === "element") {
    const box = hits.elements.find((e) => e.id === part.id)?.box;
    const held = hits.elements.some((e) => e.parent === part.id);
    return (
      box && {
        box: held ? { ...box, height: Math.min(box.height, 34) } : box,
        size: 14,
        weight: held ? 600 : 400,
      }
    );
  }
  const wires = hits.wires.filter((w) => w.id.replace(/#\d+$/, "") === part.id);
  const label = wires.find((w) => w.label)?.label?.box;
  const spot = at ?? wires[0]?.points[Math.floor(wires[0].points.length / 2)];
  const box = label ?? (spot && { x: spot.x - 60, y: spot.y - 10, width: 120, height: 20 });
  return box && { box, size: 12, weight: 400 };
}

/** Whether something other than a lane's region is drawn at `p` in a scene: a shape or a text, where a new part has no
 *  place. */
export const drawnAt = (
  scene: { shapes: { kind: string; box: Box }[]; texts: { box: Box }[] },
  p: Point,
) =>
  scene.shapes.some((s) => s.kind !== "region" && inBox(s.box, p)) ||
  scene.texts.some((t) => inBox(t.box, p));
