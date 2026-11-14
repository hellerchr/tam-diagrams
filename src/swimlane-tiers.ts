/** What each search of the swimlane router may still step on, strictest first. */

/** Strict avoids all; apart keeps off used lines but prices the rest; relaxed shares lines at a price. */
export type Tier = "strict" | "apart" | "relaxed";

/** Whether a search at `tier` may not enter a cell on a used line, in a label area or at a terminal. */
export function forbidden(tier: Tier, shared: number, label: number, foreign: boolean): boolean {
  if (tier === "strict") return !!(shared || label || foreign);
  return tier === "apart" && !!shared;
}
