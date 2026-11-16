/** TAM multiplicity after parsing: a multiple element becomes a row of copies, with dots and pointers between them. */

import type { TamDiagram, TamEdge, TamNode } from "./tam.ts";

/**
 * `...` multiplicity: the element becomes two copies with three dots between them, wrapped in an
 * invisible row. Each connection is repeated for both copies, as FMC does for channels.
 */
export function expandMultiples(diagram: TamDiagram, ids: string[]) {
  if (!ids.length) return;
  const copies = new Map<string, string[]>();
  for (const id of ids) {
    const node = diagram.nodes.get(id)!;
    const row: TamNode = {
      id: `${id}#row`,
      kind: "group",
      label: "",
      parent: node.parent,
      children: [],
      stack: false,
      passive: node.kind === "storage",
      line: node.line,
    };
    const siblings = node.parent ? diagram.nodes.get(node.parent)!.children : diagram.roots;
    siblings.splice(siblings.indexOf(id), 1, row.id);
    diagram.nodes.set(row.id, row);
    // The copy stands where the source places it (the second position), or beside its original.
    const { copyAt, ...original } = node;
    const second: TamNode = {
      ...original,
      id: `${id}#2`,
      children: [],
      origin: id,
      parent: row.id,
      at: copyAt,
    };
    if (!copyAt) delete second.at;
    const dots: TamNode = {
      id: `${id}#dots`,
      kind: "dots",
      label: "",
      parent: row.id,
      children: [],
      stack: false,
      line: node.line,
    };
    Object.assign(node, { parent: row.id, origin: id });
    row.children.push(id, dots.id, second.id);
    diagram.nodes.set(dots.id, dots);
    diagram.nodes.set(second.id, second);
    copies.set(id, [id, second.id]);
  }
  const edges: TamEdge[] = [];
  for (const edge of diagram.edges) {
    // A note remarks on the element, not on each copy.
    if (edge.kind === "anchor") {
      edges.push(edge);
      continue;
    }
    const sources = copies.get(edge.source) ?? [edge.source],
      targets = copies.get(edge.target) ?? [edge.target];
    // Two multiple ends pair up copy by copy instead of crossing.
    const pairs =
      sources.length > 1 && targets.length > 1
        ? sources.map((source, index) => [source, targets[index]])
        : sources.flatMap((source) => targets.map((target) => [source, target]));
    pairs.forEach(([source, target], index) =>
      edges.push({ ...edge, id: index ? `${edge.id}#${index + 1}` : edge.id, source, target }),
    );
  }
  diagram.edges = edges;
  // A copied element's provided or required interface is copied with it.
  for (const edge of diagram.edges.slice()) {
    if ((edge.kind !== "provided" && edge.kind !== "required") || !edge.id.includes("#")) continue;
    const original = diagram.nodes.get(edge.target)!;
    const copy: TamNode = { ...original, id: `${original.id}#copy${edge.id}`, children: [] };
    diagram.nodes.set(copy.id, copy);
    (copy.parent ? diagram.nodes.get(copy.parent)!.children : diagram.roots).push(copy.id);
    edge.target = copy.id;
  }
}

/**
 * Dots between two siblings keep them side by side: the siblings and the dots become an invisible
 * row (like the copies of `...` multiplicity), which layout keeps together in one layer.
 * `a ... b ... c` makes one row.
 */
export function rowDots(diagram: TamDiagram) {
  for (const dots of Array.from(diagram.nodes.values())) {
    if (dots.kind !== "dots" || !dots.id.startsWith("dots#")) continue;
    const parent = dots.parent ? diagram.nodes.get(dots.parent)! : null,
      siblings = parent ? parent.children : diagram.roots;
    const index = siblings.indexOf(dots.id);
    // Notes stand beside the elements they remark on and are no neighbours of the dots.
    const real = (id: string) => !["dots", "note"].includes(diagram.nodes.get(id)!.kind);
    const beforeId = siblings.slice(0, index).findLast(real),
      afterId = siblings.slice(index + 1).find(real);
    if (!beforeId || !afterId) continue;
    const before = diagram.nodes.get(beforeId)!;
    // Extend the row the left neighbour already belongs to, or start one in its place.
    let row =
      before.parent && before.parent.endsWith("#row") && before.parent.startsWith("dots#")
        ? diagram.nodes.get(before.parent)!
        : undefined;
    if (!row) {
      row = {
        id: `${dots.id}#row`,
        kind: "group",
        label: "",
        parent: dots.parent,
        children: [],
        stack: false,
        passive: before.kind === "storage" || (before.kind === "group" && before.passive),
        line: dots.line,
      };
      diagram.nodes.set(row.id, row);
      siblings.splice(siblings.indexOf(beforeId), 1, row.id);
      row.children.push(beforeId);
      before.parent = row.id;
    }
    for (const id of [dots.id, afterId]) {
      siblings.splice(siblings.indexOf(id), 1);
      row.children.push(id);
      diagram.nodes.get(id)!.parent = row.id;
    }
  }
}

/**
 * A «pointer» between two sibling storages keeps them side by side: they become an invisible row, like
 * the elements around dots, which layout keeps together in one layer. The pointer is not given to ELK,
 * which would put one storage a layer below the other; it is drawn between them after layout.
 */
export function rowPointers(diagram: TamDiagram) {
  for (const edge of diagram.edges) {
    if (edge.kind !== "dependency" || edge.label !== "«pointer»") continue;
    const a = diagram.nodes.get(edge.source)!,
      b = diagram.nodes.get(edge.target)!;
    const leaf = (node: TamNode) => node.kind === "storage" && !node.children.length;
    if (!leaf(a) || !leaf(b) || a.parent !== b.parent) continue;
    // Already in a row (around dots): they stand side by side, and the pointer is drawn between
    // them after layout. Given to ELK, it would put one a layer below the other and stretch the row.
    if (a.parent?.endsWith("#row")) {
      edge.aside = true;
      continue;
    }
    const siblings = a.parent ? diagram.nodes.get(a.parent)!.children : diagram.roots;
    const row: TamNode = {
      id: `pointer#${edge.id}#row`,
      kind: "group",
      label: "",
      parent: a.parent,
      children: [a.id, b.id],
      stack: false,
      passive: true,
      line: edge.line,
    };
    diagram.nodes.set(row.id, row);
    siblings.splice(siblings.indexOf(a.id), 1, row.id);
    siblings.splice(siblings.indexOf(b.id), 1);
    a.parent = b.parent = row.id;
    edge.aside = true;
  }
}
