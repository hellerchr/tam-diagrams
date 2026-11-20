// What the diagram's Properties (DiagramProperties.svelte) offer for a block diagram's elements and connections, as
// tam-diagrams' old inspector did: the kinds, colors and counts they may take where they stand, the copy of an element
// shown as several, its box, its id and interfaces, the arranging of several, and a connection's kind, label, protocol
// and directions. An offer is tried on the source and kept when the result parses. Re-exported by diagram-props.ts.
import type { Direction } from "../../src/elk.ts";
import * as edit from "../../src/tam-edit.ts";
import type { ElementChange, ElementKind } from "../../src/tam-edit.ts";
import {
  COLORS,
  type Connection,
  ELEMENT_KINDS,
  parseTam,
  type TamDiagram,
  type TamNode,
} from "../../src/tam.ts";
import { errorText } from "../shared/errors.ts";
import type { Box } from "./diagram-hit.ts";

export type { ElementChange, ElementKind };

/** Why an edit was refused, without the line it is about. */
export const reason = (error: unknown) => errorText(error).replace(/^Line \d+: /, "");

/** Whether `make` gives a source that parses. */
function parses(make: () => string): boolean {
  try {
    parseTam(make());
    return true;
  } catch {
    return false;
  }
}

/** Why `make`'s source does not parse; undefined when it does. */
function refusal(make: () => string): string | undefined {
  try {
    parseTam(make());
    return undefined;
  } catch (error) {
    return reason(error);
  }
}

/** The colors an element takes (`:::name`), after "no color" (""). */
export const SWATCHES = ["", ...COLORS];
/** A color's name, as its swatch's tooltip says it. */
export const colorName = (color: string) =>
  color ? color[0]!.toUpperCase() + color.slice(1) : "No color";

/** The kinds the palette adds, with their names; the design level's others are only kept where they are. */
const PLAIN: Record<string, string> = {
  agent: "Agent",
  human: "Human",
  storage: "Storage",
  group: "Group",
  note: "Note",
};
/** The name of an element kind, as the palette says it. */
export const kindName = (kind: string) => PLAIN[kind] ?? kind[0]!.toUpperCase() + kind.slice(1);

/** `source` with the elements `ids` changed alike. */
export const elementsWith = (source: string, ids: string[], change: ElementChange) =>
  ids.reduce((next, id) => edit.setElement(next, id, change), source);

/** The kinds the Kind list offers the elements `ids`: the one they share (`current`), and every plain kind all of them
 *  may take where they stand. */
export const elementKinds = (source: string, ids: string[], current?: string): ElementKind[] =>
  ELEMENT_KINDS.filter(
    (kind) =>
      kind === current || (kind in PLAIN && parses(() => elementsWith(source, ids, { kind }))),
  );

/** What the nodes `ids` share by `read`; undefined where they differ. */
export function shared<T>(
  diagram: TamDiagram,
  ids: string[],
  read: (node: TamNode) => T,
): T | undefined {
  const values = new Set(
    ids.flatMap((id) => (diagram.nodes.has(id) ? [read(diagram.nodes.get(id)!)] : [])),
  );
  return values.size === 1 ? [...values][0] : undefined;
}

/** How many an element stands for: one, a stack, or two with dots between (A … B). */
export type Count = "one" | "stack" | "several";
export const countOf = (diagram: TamDiagram, node: TamNode): Count =>
  node.stack ? "stack" : diagram.nodes.has(`${node.id}#2`) ? "several" : "one";
export const countChange = (count: Count): ElementChange => ({
  stack: count === "stack",
  multiple: count === "several",
});
/** Why the elements `ids` may not stand for `count`; undefined when they may. */
export const countRefusal = (source: string, ids: string[], count: Count) =>
  refusal(() => elementsWith(source, ids, countChange(count)));

/** Where the copy of an element shown as several stands, by the boxes on show: beside or below its original. */
export function copySide(
  boxes: ReadonlyMap<string, Box>,
  id: string,
): "beside" | "below" | undefined {
  const box = boxes.get(id);
  const copy = boxes.get(`${id}#2`);
  if (!box || !copy) return undefined;
  if (Math.abs(copy.y - box.y) < 1 && copy.x > box.x) return "beside";
  if (Math.abs(copy.x - box.x) < 1 && copy.y > box.y) return "below";
  return undefined;
}

/** A source whose elements are all placed, with the copy of `id` (at `box`) beside or below it. Without a place of its
 *  own a copy stands across the diagram's direction; the other side needs one, three grid steps away. */
export function copyPlaced(placed: string, id: string, box: Box, side: "beside" | "below"): string {
  const direction: Direction = parseTam(placed).direction ?? "TB";
  const usual = direction === "TB" || direction === "BT" ? "beside" : "below";
  const gap = 30;
  const at =
    side === usual
      ? undefined
      : side === "beside"
        ? { x: box.x + box.width + gap, y: box.y }
        : { x: box.x, y: box.y + box.height + gap };
  return edit.place(placed, new Map([[`${id}#2`, at]]));
}

/** A number of an element's box as its field shows it, to a tenth. */
export const boxText = (box: Box | undefined, side: keyof Box) =>
  box ? String(Math.round(box[side] * 10) / 10) : "";
/** The number typed in a field of the box; undefined for none. */
export function typedNumber(text: string): number | undefined {
  const value = Number(text);
  return text.trim() && Number.isFinite(value) ? value : undefined;
}

/** `source` with the element `id` called `next` in its declaration and every connection that names it; throws when
 *  the id is taken or is no id. */
export function idRenamed(source: string, id: string, next: string): string {
  const to = next.trim();
  const renamed = edit.renameId(source, id, to);
  if (renamed === source) throw new Error(`\`${to}\` is taken, or is no id.`);
  return renamed;
}

/** Whether a diagram has design level parts already: it says `level design`, or has components, subsystems, classes,
 *  packages or interfaces, or joins by delegation, an assembly or a «use» or «import» dependency. Only such a diagram
 *  offers interfaces. */
export const designLevel = (diagram: TamDiagram) =>
  diagram.level === "design" ||
  [...diagram.nodes.values()].some((node) =>
    ["component", "subsystem", "class", "package", "interface"].includes(node.kind),
  ) ||
  diagram.edges.some(
    (e) =>
      e.kind === "delegation" ||
      e.kind === "assembly" ||
      (e.kind === "dependency" && /«(use|import)»/.test(e.label ?? "")),
  );

/** Whether the element `id` may provide or require an interface. */
export const allowsInterface = (source: string, id: string) =>
  parses(() => edit.addInterface(source, id, "provides", "I"));
export const interfaceAdded = edit.addInterface;

/** A kind of connection the Kind list offers: a word, a dependency with its keyword; `design` ones only stay. */
export type Wire = {
  value: string;
  name: string;
  design?: boolean;
  change: { word: Connection["word"]; label?: string };
};
const wire = (value: Connection["word"], name: string, design = false): Wire => ({
  value,
  name,
  design,
  change: { word: value },
});
/** Every kind of connection, in the order the list has them. */
export const WIRES: Wire[] = [
  wire("calls", "Request (calls)"),
  wire("sends data", "Data flow (sends data)"),
  wire("---", "Channel, no direction"),
  wire("reads", "Read access"),
  wire("writes", "Write access"),
  wire("reads/writes", "Read and write access"),
  wire("requires", "Requires an interface", true),
  wire("delegates", "Delegates to a part", true),
  ...["use", "import", "create", "generate", "pointer"].map((keyword) => ({
    value: `dependency:${keyword}`,
    name: `Dependency «${keyword}»`,
    design: keyword === "use" || keyword === "import",
    change: { word: "dependency" as const, label: keyword },
  })),
  wire("anchor", "Attaches a note"),
];

/** The kind in `WIRES` a connection is. */
export const wireValue = (connection: Connection) =>
  connection.word === "dependency" ? `dependency:${connection.label}` : connection.word;

/** The connection behind the wire `id`; undefined for an interface's line or a source that does not read. */
export function connectionAt(source: string, id: string): Connection | undefined {
  try {
    return edit.connectionOf(source, id);
  } catch {
    return undefined;
  }
}

/** Whether the connection `id` may change so between the elements it joins. */
export const allowsWire = (source: string, id: string, change: edit.ConnectionChange) =>
  parses(() => edit.setConnection(source, id, change));

/** The kinds the connection `id` is offered: its own, and every plain one it may take between its ends. */
export function wireKinds(source: string, id: string): Wire[] {
  const own = connectionAt(source, id);
  const current = own && wireValue(own);
  return WIRES.filter(
    (kind) => kind.value === current || (!kind.design && allowsWire(source, id, kind.change)),
  );
}

/** Words of a channel, which goes by a protocol. */
const CHANNELS = new Set(["calls", "sends data", "---", "requires"]);

/** What the connection `id` shows besides its kind: its Text group (not a note's line), a label (not a dependency's,
 *  whose keyword is its kind), a protocol (a channel), Both ways where it goes so or may, and whether it may turn. */
export function wireFields(source: string, id: string, connection: Connection) {
  const { word } = connection;
  return {
    text: word !== "anchor" && word !== "dependency",
    label: word !== "dependency" && word !== "anchor",
    protocol: CHANNELS.has(word),
    both: word !== "anchor" && (connection.both || allowsWire(source, id, { both: true })),
    reverse: allowsWire(source, id, { reverse: true }),
  };
}

/** `source` with the connection `id` changed. */
export const wireWith = (source: string, id: string, change: edit.ConnectionChange) =>
  edit.setConnection(source, id, change);
