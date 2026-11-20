// The diagram editor's edits of a TAM source (DiagramView.svelte), made by tam-diagrams' own edit functions: each takes
// the source with the picture on show and returns the new source, or why the notation refuses it. Loaded with the first
// block diagram the editor shows.
import {
  type Measure,
  parseTam,
  type Scene,
  type TamDiagram,
  textMeasure,
} from "../../src/index.ts";
import * as edit from "../../src/tam-edit.ts";
import type { ConnectionChange, ElementKind } from "../../src/tam-edit.ts";
import type { Port } from "../../src/tam-ports.ts";
import { containerInsets, leafSize } from "../../src/tam-graph.ts";
import { declaredElements, overlapping, pin } from "../../src/tam-pin.ts";
import { FONT } from "../../src/text.ts";
import { ELEMENT_KINDS, type Placement } from "../../src/tam.ts";
import { errorText } from "../shared/errors.ts";
import { type Arrangement, arrange } from "./diagram-arrange.ts";
import { wireLabels } from "./diagram-labels.ts";
import {
  connectionAt,
  elementKinds,
  elementsWith,
  wireKinds,
  wireValue,
} from "./diagram-props-tam.ts";
import {
  type Box,
  type Hits,
  holderAt,
  middle,
  type Part,
  type Point,
  shift,
} from "./diagram-hit.ts";
import { linkKindOf, type Wording } from "./palettes.ts";

export type { ElementKind };
/** The kinds of element a block diagram has. */
export const KINDS = ELEMENT_KINDS;
/** Kinds that hold other elements even while empty. */
const HOLDERS = new Set(["group", "package", "subsystem"]);

/** A block diagram's source with its picture: what the editor hits, and what its edits start from. */
export type Model = { source: string; scene: Scene; diagram: TamDiagram; hits: Hits; font: string };

/** The model of a drawn TAM source; undefined when it does not parse. */
export function modelOf(source: string, scene: Scene, font: string): Model | undefined {
  let diagram: TamDiagram;
  try {
    diagram = parseTam(source);
  } catch {
    return undefined;
  }
  const depth = (id: string): number => {
    const parent = diagram.nodes.get(id)?.parent;
    return parent ? depth(parent) + 1 : 0;
  };
  const boxes = new Map(scene.shapes.map((shape) => [shape.id, shape.box]));
  const elements = declaredElements(diagram).flatMap((node) => {
    const box = boxes.get(node.id);
    const holder = node.children.length > 0 || HOLDERS.has(node.kind);
    return box
      ? [{ id: node.id, box, depth: depth(node.id), holder, parent: node.parent ?? null }]
      : [];
  });
  const labels = wireLabels(scene);
  const circles = new Map(
    scene.shapes.filter((s) => s.kind === "circle").map((s) => [s.id.replace(/#node$/, ""), s.box]),
  );
  const wires = scene.wires.map((wire) => ({
    id: wire.edge,
    points: wire.points,
    label: labels.get(wire.edge),
    circle: circles.get(wire.edge),
  }));
  return { source, scene, diagram, hits: { elements, wires }, font };
}

const measures = new Map<string, Measure>();
/** The text measure of a font, made once. */
function measureOf(font: string): Measure {
  let measure = measures.get(font);
  if (!measure) measures.set(font, (measure = textMeasure(font)));
  return measure;
}

const pinned = new WeakMap<Model, string>();
/** The source with every element placed where the picture shows it, so places can change; as it is when it places all.
 *  Once per model: a drag asks on every move. */
export function placed(m: Model): string {
  const loose = declaredElements(m.diagram).some((node) => !node.at && !node.children.length);
  if (!loose) return m.source;
  let source = pinned.get(m);
  if (source === undefined) pinned.set(m, (source = pin(m.source, m.scene, measureOf(m.font))));
  return source;
}

const round = (box: Placement): Placement => ({
  x: Math.round(box.x),
  y: Math.round(box.y),
  ...(box.width === undefined
    ? {}
    : { width: Math.round(box.width), height: Math.round(box.height ?? 0) }),
});

/** `make`'s source when it parses, else why not (the editor says it and leaves the source as it was). */
export function attempt(make: () => string): { source: string } | { refused: string } {
  try {
    const source = make();
    parseTam(source);
    return { source };
  } catch (error) {
    return { refused: errorText(error).replace(/^Line \d+: /, "") };
  }
}

/** The elements `ids` with every element they hold, at any depth. */
function withInner(diagram: TamDiagram, ids: string[]): Set<string> {
  const all = new Set<string>();
  const add = (id: string) => {
    if (all.has(id) || !diagram.nodes.has(id)) return;
    all.add(id);
    diagram.nodes.get(id)!.children.forEach(add);
  };
  ids.forEach(add);
  return all;
}

/** A placed `source` with the elements `ids`, and what they hold, moved by `delta`. */
function shifted(source: string, ids: string[], delta: Point): string {
  const diagram = parseTam(source);
  const places = new Map<string, Placement>();
  for (const id of withInner(diagram, ids)) {
    const at = diagram.nodes.get(id)?.at;
    if (at) places.set(id, round({ ...at, x: at.x + delta.x, y: at.y + delta.y }));
  }
  return edit.place(source, places);
}

/** Moves elements, with what they hold, by `delta`; into `holder` when given (null: out into the diagram). */
export function moved(m: Model, ids: string[], delta: Point, holder?: string | null): string {
  const source = shifted(placed(m), ids, delta);
  return holder === undefined ? source : edit.moveInto(source, ids, holder);
}

/** The elements of `ids` that no other of them holds: what moves as one. */
function outermost(m: Model, ids: string[]): string[] {
  const chosen = new Set(ids);
  const held = (id: string): boolean => {
    const parent = m.diagram.nodes.get(id)?.parent;
    return !!parent && (chosen.has(parent) || held(parent));
  };
  return ids.filter((id) => !held(id));
}

/** Puts elements into `holder` (null: out into the diagram) as the old outline's drop did: those not in it already
 *  stand in a row below it, on the 10 grid, so nothing lies on anything, and it takes them in. */
export function nested(m: Model, ids: string[], holder: string | null): string {
  const outer = outermost(m, ids).filter(
    (id) => (m.diagram.nodes.get(id)?.parent ?? null) !== holder,
  );
  if (!outer.length) throw new Error("Nothing moves.");
  const into = holder ? boxesOf(m, [holder]).get(holder) : m.scene.bounds;
  const boxes = boxesOf(m, outer);
  const grid = (value: number) => Math.round(value / 10) * 10;
  let source = placed(m);
  let x = (into?.x ?? 0) + 20;
  for (const id of outer) {
    const box = boxes.get(id);
    if (!box || !into) continue;
    source = shifted(source, [id], {
      x: grid(x - box.x),
      y: grid(into.y + into.height + 10 - box.y),
    });
    x += box.width + 20;
  }
  return edit.moveInto(source, outer, holder);
}

/** The boxes the picture shows the elements `ids` in. */
const boxesOf = (m: Model, ids: string[]) =>
  new Map(
    m.hits.elements
      .filter((element) => ids.includes(element.id))
      .map((element) => [element.id, element.box]),
  );

/** Aligns the elements `ids` on a side or middle of the box around them, or spreads them with even gaps. */
export function arranged(m: Model, ids: string[], how: Arrangement): string {
  let source = placed(m);
  for (const [id, step] of arrange(boxesOf(m, outermost(m, ids)), how))
    source = shifted(source, [id], step);
  return source;
}

/** Makes the elements `ids` as wide, or as high, as the largest of them. */
export function sameSize(m: Model, ids: string[], side: "width" | "height"): string {
  const boxes = boxesOf(m, ids);
  const most = Math.max(...[...boxes.values()].map((box) => box[side]));
  return edit.place(
    placed(m),
    new Map([...boxes].map(([id, box]) => [id, round({ ...box, [side]: most })])),
  );
}

/** Lets the containers among `ids` fit what they hold, and the others take the size of their names. */
export function fitted(m: Model, ids: string[]): string {
  const boxes = [...boxesOf(m, ids)];
  const fit = (id: string, box: Box) =>
    m.diagram.nodes.get(id)?.children.length ? undefined : round({ x: box.x, y: box.y });
  return edit.place(placed(m), new Map(boxes.map(([id, box]) => [id, fit(id, box)])));
}

/** Whether the diagram is laid out by hand: some element has a place. */
const byHand = (diagram: TamDiagram) => [...diagram.nodes.values()].some((node) => node.at);

/** The elements `ids` as a source of their own, with the connections among them: what copying puts on the clipboard. */
export const copied = (m: Model, ids: string[]) => edit.copyOf(m.source, outermost(m, ids));

/** Adds the elements of a copied `text` with ids of their own, their top left at `at` in a diagram laid out by hand (or
 *  a step beside where they were); undefined when the text holds no elements. */
export function pasted(
  m: Model,
  text: string,
  at?: Point,
): { source: string; ids: string[] } | undefined {
  const fragment = text.replace(/\r\n?/g, "\n").trim();
  let pieces: TamDiagram;
  try {
    pieces = parseTam(fragment);
  } catch {
    return undefined;
  }
  if (!pieces.nodes.size) return undefined;
  if (!byHand(m.diagram)) return edit.paste(m.source, fragment, { placed: false });
  const spots = [...pieces.nodes.values()].flatMap((node) => (node.at ? [node.at] : []));
  const beside = spots.length
    ? { x: Math.min(...spots.map((p) => p.x)) + 24, y: Math.min(...spots.map((p) => p.y)) + 24 }
    : undefined;
  const spot = at ?? beside;
  return edit.paste(placed(m), fragment, { at: spot && round(spot), placed: true });
}

/** Copies the elements `ids`, with what they hold, a step beside them. */
export const duplicated = (m: Model, ids: string[]) =>
  edit.duplicate(byHand(m.diagram) ? placed(m) : m.source, outermost(m, ids), { x: 24, y: 24 });

/** Copies of the elements `ids`, with what they hold, `delta` from them (a drag with Ctrl), with the copies' ids. */
export const copiedBy = (m: Model, ids: string[], delta: Point) =>
  edit.duplicate(placed(m), outermost(m, ids), { x: Math.round(delta.x), y: Math.round(delta.y) });

/** Puts the elements `ids` in a new group, with the id it got. */
export const grouped = (m: Model, ids: string[]) => edit.wrap(m.source, ids, { kind: "group" });

/** The source without any places: laid out automatically again. */
export const laidOut = (m: Model) => edit.unplace(m.source);

/** The holder elements moved by `delta` land in when it is another than theirs (null: the diagram), else undefined. */
export function dropHolder(m: Model, ids: string[], delta: Point): string | null | undefined {
  const box = m.hits.elements.find((element) => element.id === ids[0])?.box;
  if (!box) return undefined;
  const target = holderAt(m.hits, middle(shift(box, delta)), withInner(m.diagram, ids));
  return target === holderOf(m, ids) ? undefined : target;
}

/** The least box an element may be resized to: a leaf as large as its name needs (its top left where it stands), a
 *  container around its parts with the room its title and border keep. */
export function leastBox(m: Model, id: string): Box | undefined {
  const node = m.diagram.nodes.get(id);
  const box = m.hits.elements.find((e) => e.id === id)?.box;
  if (!node || !box) return undefined;
  const container = node.children.length > 0;
  const lines = node.label ? node.label.split(/<br\s*\/?>/i) : [];
  const measure = measureOf(m.font);
  const textWidth = Math.max(0, ...lines.map((line) => measure(line, FONT, container ? 600 : 400)));
  if (!container)
    return {
      x: box.x,
      y: box.y,
      ...leafSize({ ...node, at: undefined }, lines, textWidth, measure),
    };
  const parts = m.hits.elements.filter((e) => e.parent === id).map((e) => e.box);
  if (!parts.length) return undefined;
  const { top, side, minimum } = containerInsets(node, lines, textWidth, measure);
  const x = Math.min(...parts.map((b) => b.x)) - side;
  const right = Math.max(...parts.map((b) => b.x + b.width)) + side;
  const y = Math.min(...parts.map((b) => b.y)) - top;
  const bottom = Math.max(...parts.map((b) => b.y + b.height)) + side;
  return { x, y, width: Math.max(minimum, right - x), height: bottom - y };
}

/** Gives an element the box `box`. */
export const resized = (m: Model, id: string, box: Box, natural = false) =>
  edit.place(placed(m), new Map([[id, round(natural ? { x: box.x, y: box.y } : box)]]));

/** The holder the elements `ids` are in now, when they share one (null: the diagram itself). */
export function holderOf(m: Model, ids: string[]): string | null | undefined {
  const holders = new Set(ids.map((id) => m.diagram.nodes.get(id)?.parent ?? null));
  return holders.size === 1 ? [...holders][0] : undefined;
}

/** The name a new element of a kind gets until one is typed; a group gets none (the old editor's NAMES). */
const NAMES: Record<string, string> = { human: "User", group: "" };
const nameOf = (kind: ElementKind) => NAMES[kind] ?? kind[0]!.toUpperCase() + kind.slice(1);

/**
 * Adds an element of `kind` into `holder`, its top left at `at`: every element is placed where it shows first, so the
 * diagram is laid out by hand from then on; a group gets its size. Without `at` a diagram laid out automatically stays
 * so and puts it where its layout does. With the id it got.
 */
export function added(m: Model, kind: ElementKind, at: Point | undefined, holder: string | null) {
  const label = nameOf(kind) || undefined;
  if (!at && !byHand(m.diagram)) return edit.addElement(m.source, { kind, label, parent: holder });
  const size = kind === "group" ? { width: 160, height: 100 } : {};
  return edit.addElement(placed(m), {
    kind,
    label,
    at: at && { ...round(at), ...size },
    parent: holder,
  });
}

/**
 * Connects two elements as `asked` (a palette kind's wording) where the notation takes it, turned round when it is
 * written from the other end, else with what fits the two; with why the kind asked for was not drawn. Throws the
 * refusal when the two take no connection at all.
 */
export function connected(
  m: Model,
  from: string,
  to: string,
  asked?: Wording,
): { source: string; replaced?: string } {
  const fitted = edit.fitConnection(m.source, from, to, asked);
  if (!fitted) throw new Error("These two elements take no connection.");
  return {
    source: edit.connect(m.source, fitted.from, fitted.to, fitted.change),
    replaced: fitted.replaced,
  };
}

/** The id of the connection a source states last: the one `connected` just added. */
export const lastEdge = (source: string) =>
  parseTam(source).edges.findLast((edge) => !edge.id.includes("#"))?.id;

/** The connection `id` drawn as another kind (a palette kind's wording). */
export const relinked = (m: Model, id: string, wording: Wording) =>
  edit.setConnection(m.source, id, wording);

/** The palette kind of the connection `id`, when it is one the palette offers. */
export function linkOf(m: Model, id: string): string | undefined {
  const connection = edit.connectionOf(m.source, id);
  return connection && linkKindOf(connection.word, connection.both);
}

/** The pairs of elements that lie on each other in the picture, which the notation does not allow. */
export const overlaps = (m: Model) => overlapping(m.diagram, m.scene);
export const removed = (m: Model, parts: Part[]) =>
  edit.remove(
    m.source,
    parts.map((part) => part.id),
  );
export const rekinded = (m: Model, id: string, kind: ElementKind) =>
  edit.setElement(m.source, id, { kind });
export const reversed = (m: Model, id: string) =>
  edit.setConnection(m.source, id, { reverse: true });

/** The source with `part` named `label`; an element whose id was made up when it was added takes one from the name. */
export function renamed(m: Model, part: Part, label: string): string {
  if (part.type === "wire") return edit.setConnection(m.source, part.id, { label });
  const source = edit.setElement(m.source, part.id, { label });
  return edit.isGeneratedId(part.id) && label.trim()
    ? edit.renameId(source, part.id, edit.idFor(source, label))
    : source;
}

/** The name `part` has now. */
export const labelOf = (m: Model, part: Part) =>
  (part.type === "wire"
    ? m.diagram.edges.find((edge) => edge.id === part.id)?.label
    : m.diagram.nodes.get(part.id)?.label) ?? "";

/** The kind of the element `id`. */
export const kindOf = (m: Model, id: string) => m.diagram.nodes.get(id)?.kind;

/** The elements and connections with the lines that declare them, for the source to follow (diagram-follow.ts). */
export const linedOf = (m: Model) => ({
  nodes: declaredElements(m.diagram),
  edges: m.diagram.edges,
});

/** Why `make`'s source is refused, or undefined when the notation takes it. */
const refusal = (make: () => string) => {
  const result = attempt(make);
  return "refused" in result ? result.refused : undefined;
};

/** Why `from` may not be connected to `to` (the kind asked is no condition: what fits them is drawn instead). */
export const connectRefusal = (m: Model, from: string, to: string, asked?: Wording) =>
  refusal(() => connected(m, from, to, asked).source);

/** A new element at `at` (its top left) connected from `from`: a storage for an access, else an agent; its id. */
export function connectedNew(
  m: Model,
  from: string,
  at: Point,
  asked?: Wording,
): { source: string; id: string } {
  const kind: ElementKind = asked && /reads|writes/.test(asked.word) ? "storage" : "agent";
  const made = edit.addElement(placed(m), { kind, label: nameOf(kind), at: round(at) });
  const fitted = edit.fitConnection(made.source, from, made.id, asked);
  return {
    source: fitted ? edit.connect(made.source, fitted.from, fitted.to, fitted.change) : made.source,
    id: made.id,
  };
}

/** The elements a connection joins; undefined for an interface's line. */
export function endsOf(m: Model, id: string): { from: string; to: string } | undefined {
  const connection = edit.connectionOf(m.source, id);
  return connection && { from: connection.from, to: connection.to };
}

/** Where a connection's end goes: on the element `to`, at its `port` there (tam-ports.ts; none: the layout chooses). */
export type Reattach = { end: "from" | "to"; to: string; port?: Port };

/** The connection `id` with an end on another element, or another port of its own; a port places every element. */
export const reattached = (m: Model, id: string, { end, to, port }: Reattach) =>
  edit.setConnection(
    port ? placed(m) : m.source,
    id,
    end === "from" ? { from: to, fromPort: port ?? null } : { to, toPort: port ?? null },
  );

/** Why the connection `id` may not end where `at` says. */
export const reattachRefusal = (m: Model, id: string, at: Reattach) =>
  refusal(() => reattached(m, id, at));

/** `source` with the ends of the connection `edge` at the ports chosen for their elements, by id (tam-ports.ts). */
export function ported(source: string, edge: string, ports: ReadonlyMap<string, Port>): string {
  const connection = edit.connectionOf(source, edge);
  if (!connection) return source;
  return edit.setConnection(source, edge, {
    fromPort: ports.get(connection.from),
    toPort: ports.get(connection.to),
  });
}

/** The elements `ids` put in a new element of `kind` that holds them, with the id it got. */
export const wrapped = (m: Model, ids: string[], kind: ElementKind) =>
  edit.wrap(m.source, ids, { kind, label: nameOf(kind) || undefined });

/** Why the elements `ids` may not go in a new element of `kind`. */
export const wrapRefusal = (m: Model, ids: string[], kind: ElementKind) =>
  refusal(() => wrapped(m, ids, kind).source);

/** The element `id` taken apart: what it held stays where it stood. */
export const unwrapped = (m: Model, id: string) => edit.unwrap(m.source, id);

/** The elements `ids` taken out of `inside` into what holds it; `inside` goes when it is left holding and joining
 *  nothing. */
export function takenOut(m: Model, ids: string[], inside: string): string {
  const moved = edit.moveInto(placed(m), ids, edit.holder(m.diagram, inside));
  const diagram = parseTam(moved);
  const box = diagram.nodes.get(inside);
  const idle =
    !!box &&
    !box.children.length &&
    !diagram.edges.some((e) => e.source === inside || e.target === inside);
  return idle ? edit.remove(moved, [inside]) : moved;
}

/** The kinds the elements `ids` may change to, with the one the single element is (the context menu's Change kind). */
export const kindsFor = (m: Model, ids: string[]) => {
  const current = ids.length === 1 ? m.diagram.nodes.get(ids[0]!)?.kind : undefined;
  return { kinds: elementKinds(m.source, ids, current), current };
};

/** The elements `ids` changed to `kind`. */
export const rekindedAll = (m: Model, ids: string[], kind: ElementKind) =>
  elementsWith(m.source, ids, { kind });

/** The kinds the connection `id` may change to, with the one it is; undefined for an interface's line. */
export function wiresFor(m: Model, id: string) {
  const connection = connectionAt(m.source, id);
  return (
    connection && { kinds: wireKinds(m.source, id), current: wireValue(connection), connection }
  );
}

/** The connection `id` changed (its kind, its direction). */
export const wireChanged = (m: Model, id: string, change: ConnectionChange) =>
  edit.setConnection(m.source, id, change);

/** Whether the connection `id` may change so. */
export const allowsWireChange = (m: Model, id: string, change: ConnectionChange) =>
  !refusal(() => wireChanged(m, id, change));

/** Whether some element has a place: the diagram is laid out by hand. */
export const placedByHand = (m: Model) => byHand(m.diagram);

/** Whether the label of the connection `id` stands where the source places it. */
export const labelPlaced = (m: Model, id: string) => !!edit.connectionOf(m.source, id)?.labelAt;

/** The label of the connection `id` placed `offset` from the middle of its line; back where the layout puts it
 *  without one. */
export const labelMoved = (m: Model, id: string, offset: Point | undefined) =>
  edit.placeLabel(m.source, id, offset);
