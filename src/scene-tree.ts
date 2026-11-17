/** What holds what in a scene, read from its geometry: the scene model has no parents. */

import { areaOf, inside, type Scene, type SceneShape } from "./scene.ts";

/** What holds what in a scene: the container around each shape, and the shapes in each container. */
export interface SceneTree {
  parent: Map<string, string | undefined>;
  children: Map<string, string[]>;
}

/** Whether `outer` holds `inner` at any depth, in a tree whose parts know their parent. */
export function holdsDeep<T extends { parent?: T | null }>(outer: T, inner: T): boolean {
  for (let up = inner.parent; up; up = up.parent) if (up === outer) return true;
  return false;
}

/**
 * The containers of a scene as a tree. A scene has no parents: a shape belongs to the smallest
 * container around it that lies less deep, and to a region of its own depth.
 */
export function sceneTree(scene: Scene): SceneTree {
  const containers = scene.shapes
    .filter((shape) => shape.container)
    .toSorted((a, b) => areaOf(a.box) - areaOf(b.box));
  const parent = new Map<string, string | undefined>(),
    children = new Map<string, string[]>();
  for (const shape of scene.shapes) {
    const holder = containers.find((item) => holds(item, shape));
    parent.set(shape.id, holder?.id);
    if (holder) children.set(holder.id, [...(children.get(holder.id) ?? []), shape.id]);
  }
  return { parent, children };
}

/** Whether a container holds a shape: it lies around it, less deep or a region of its depth. */
const holds = (item: SceneShape, shape: SceneShape) =>
  item !== shape &&
  (item.depth < shape.depth ||
    (item.kind === "region" && shape.kind !== "region" && item.depth === shape.depth)) &&
  inside(shape.box, item.box, 0.5);

/** A shape and the containers around it, innermost first. */
export function chainOf(tree: SceneTree, id: string): string[] {
  const chain: string[] = [];
  for (let at: string | undefined = id; at !== undefined && !chain.includes(at);)
    (chain.push(at), (at = tree.parent.get(at)));
  return chain;
}
