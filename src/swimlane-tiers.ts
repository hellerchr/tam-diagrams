/** What each search of the swimlane router may still step on, strictest first. */

/** Strict avoids all; apart keeps off used lines but prices the rest; relaxed shares lines at a price. */
export type Tier = "strict" | "apart" | "relaxed";

/**
 * Whether a search at `tier` may not enter a cell on a used line, in a label area or on a point
 * another wire ends or turns at (a stub end or a bend).
 */
export function forbidden(tier: Tier, shared: number, label: number, onPoint: boolean): boolean {
  if (tier === "strict") return !!(shared || label || onPoint);
  return tier === "apart" && !!shared;
}
