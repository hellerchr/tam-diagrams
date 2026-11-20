// The tree of the diagram editor's outline (DiagramOutline.svelte), as the old editor's outline.ts built it: the
// elements of a block diagram, or the parts of a UML one, each under what holds it in the order the source declares
// them; the rows it shows as elements open and close and a search finds; and how far the view pans to show one.
// No tam-diagrams here, so Node tests it.
import type { Box, Point } from "./diagram-hit.ts";

/** An element of the tree with what it holds. */
export type TreeItem = { id: string; kind: string; label: string; children: TreeItem[] };

/** A block diagram's element as the tree reads it. */
export type TamNode = { kind: string; label: string; children: string[]; origin?: string };

/** A UML part as the tree reads it. */
export type PartNode = { id: string; kind: string; label: string; parent: string | null };

/** A block diagram's elements from `roots` down, as they are drawn (`shown`): a row of a layout is passed through,
 *  a copy a layout makes (its `origin` another id) left out. */
export function tamTree(
  nodes: ReadonlyMap<string, TamNode>,
  roots: string[],
  shown: (id: string) => boolean,
): TreeItem[] {
  return roots.flatMap((id) => {
    const node = nodes.get(id);
    if (!node) return [];
    if (id.endsWith("#row")) return tamTree(nodes, node.children, shown);
    if (!shown(id) || (node.origin && node.origin !== id)) return [];
    return [
      { id, kind: node.kind, label: node.label, children: tamTree(nodes, node.children, shown) },
    ];
  });
}

/** A UML diagram's parts as drawn (`shown`), each under its group, in the order of `parts`. */
export function partTree(parts: PartNode[], shown: (id: string) => boolean): TreeItem[] {
  const drawn = parts.filter((part) => shown(part.id));
  const ids = new Set(drawn.map((part) => part.id));
  const under = (parent: string | null, seen: number): TreeItem[] =>
    seen > drawn.length
      ? []
      : drawn
          .filter((part) => (part.parent && ids.has(part.parent) ? part.parent : null) === parent)
          .map((part) => ({
            id: part.id,
            kind: part.kind,
            label: part.label,
            children: under(part.id, seen + 1),
          }));
  return under(null, 0);
}

/** An element of the tree with everything inside it, as ids. */
export const within = (item: TreeItem): string[] => [item.id, ...item.children.flatMap(within)];

/** The ids of every element that holds others: what Collapse all closes. */
export const parentsIn = (items: TreeItem[]): string[] =>
  items.flatMap((item) => (item.children.length ? [item.id, ...parentsIn(item.children)] : []));

/** The ids of the elements around the `selected` ones, at any depth: what opens to show them. */
export function around(items: TreeItem[], selected: string[], path: string[] = []): string[] {
  return items.flatMap((item) => [
    ...(selected.includes(item.id) ? path : []),
    ...around(item.children, selected, [...path, item.id]),
  ]);
}

/** A row of the tree as it shows: its element, how deep, whether it holds others and is closed, and how many
 *  elements a closed one holds. */
export type TreeRow = {
  item: TreeItem;
  depth: number;
  parent: boolean;
  folded: boolean;
  count: number;
};

/** The rows that show: the elements a search finds (`texts` gives the words each is found by; an element shows when
 *  one inside it is found, and a search opens everything), else everything not inside a closed one. */
export function treeRows(
  items: TreeItem[],
  folded: ReadonlySet<string>,
  words: string,
  texts: (item: TreeItem) => string[],
) {
  const query = words.trim().toLowerCase();
  const found = (item: TreeItem): boolean =>
    !query ||
    texts(item).some((text) => text.toLowerCase().includes(query)) ||
    item.children.some(found);
  const rows: TreeRow[] = [];
  const visit = (item: TreeItem, depth: number) => {
    if (!found(item)) return;
    const parent = item.children.length > 0;
    const closed = !query && folded.has(item.id);
    rows.push({ item, depth, parent, folded: closed, count: within(item).length - 1 });
    if (!closed) for (const child of item.children) visit(child, depth + 1);
  };
  for (const item of items) visit(item, 0);
  return rows;
}

/** How far the view pans for `box` (on the screen) to lie inside `frame`; undefined when it does already. */
export function panTo(box: Box, frame: Box): Point | undefined {
  const x = panAlong(box.x, box.width, frame.x, frame.width);
  const y = panAlong(box.y, box.height, frame.y, frame.height);
  return x || y ? { x, y } : undefined;
}

/** How far a stretch from `at` of `length` moves along one axis to lie in the frame's stretch from `from` of `room`. */
function panAlong(at: number, length: number, from: number, room: number): number {
  // A stretch longer than the frame that covers it already stays where it is.
  if (length > room && at <= from && at + length >= from + room) return 0;
  if (at < from || length > room) return from - at;
  return at + length > from + room ? from + room - at - length : 0;
}
