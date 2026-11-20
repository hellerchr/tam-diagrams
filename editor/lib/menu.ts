// The logic of popup menus (ui/Menus.svelte), apart from their drawing: which rows show, why a row is off, where the
// keys move the highlight, and where a menu and its submenus stand in the window.
import type { MenuEntry, MenuItem, MenuRow, MenuSub } from "./overlays.svelte.ts";

type Size = { width: number; height: number };
type Rect = { left: number; top: number; right: number; bottom: number };
/** The window a menu stays inside. */
type Room = { width: number; height: number };

/** The room kept between a menu and the window's edge, and a submenu and the window's edge. */
const MARGIN = 8;
const EDGE = 4;

/** Whether an item is a row that can be picked or opened (not a line or a heading). */
export const isRow = (item: MenuItem): item is MenuRow =>
  typeof item === "object" && "label" in item;

/** Whether a row opens a submenu. */
export const isSub = (row: MenuRow): row is MenuSub => "items" in row && !!row.items;

/** The rows worth showing: no empty ones, and no line at an end or after another. */
export function tidy(entries: readonly MenuEntry[]): MenuItem[] {
  const rows = entries.filter((entry): entry is MenuItem => !!entry);
  return rows.filter(
    (row, index) =>
      row !== "separator" ||
      (index > 0 &&
        rows[index - 1] !== "separator" &&
        rows.slice(index).some((next) => next !== "separator")),
  );
}

/** Why a row may not be picked: its own reason, or for a submenu whose rows are all off the reason they share (the
 *  first). Undefined for a row that is on. */
export function refusal(row: MenuRow): string | true | undefined {
  if (row.off || !isSub(row)) return row.off || undefined;
  const reasons = tidy(row.items).filter(isRow).map(refusal);
  if (!reasons.length || !reasons.every(Boolean)) return undefined;
  return reasons.find((reason) => typeof reason === "string") ?? true;
}

/** Whether the menu has choices: then every row keeps room for a tick. */
export const hasTicks = (items: readonly MenuItem[]) =>
  items.some((item) => isRow(item) && item.checked !== undefined);

/** The rows of `items` the keys stop on: those that are on, by index. */
const live = (items: readonly MenuItem[]) =>
  items.flatMap((item, index) => (isRow(item) && !refusal(item) ? [index] : []));

/** Where a key moves the highlight from the row at `at` (-1: none): the next or previous row that is on, wrapping,
 *  or the first or last. Undefined for a key that does not move it. */
export function moved(items: readonly MenuItem[], at: number, key: string): number | undefined {
  const rows = live(items);
  if (!rows.length) return undefined;
  if (key === "Home") return rows[0];
  if (key === "End") return rows.at(-1);
  if (key === "ArrowDown") return rows.find((index) => index > at) ?? rows[0];
  if (key === "ArrowUp") return rows.findLast((index) => index < at) ?? rows.at(-1);
  return undefined;
}

/** The next row after `at` (wrapping) that is on and whose label starts with `letter`; undefined when none does. */
export function typedTo(
  items: readonly MenuItem[],
  at: number,
  letter: string,
): number | undefined {
  const rows = live(items);
  const starts = (index: number) =>
    (items[index] as MenuRow).label.trim().toLowerCase().startsWith(letter.toLowerCase());
  return rows.find((index) => index > at && starts(index)) ?? rows.find(starts);
}

/** Where a menu of `size` opens at a point: below it (or above, ending at it), its left edge there (or its right with
 *  `alignRight`), kept inside the window; one that has no room below goes above. */
export function placed(
  at: { x: number; y: number; alignRight?: boolean; above?: boolean },
  size: Size,
  room: Room,
) {
  const x = at.alignRight ? at.x - size.width : at.x;
  let top = at.above ? at.y - size.height : at.y;
  if (!at.above && top + size.height > room.height - MARGIN) top = at.y - size.height - MARGIN;
  return {
    left: Math.max(MARGIN, Math.min(x, room.width - size.width - MARGIN)),
    top: Math.max(MARGIN, Math.min(top, room.height - size.height - MARGIN)),
  };
}

/** Where a submenu of `size` stands beside its row: to the right where there is room, else to the left, its first
 *  row level with the row (`inset`: the menu's padding). */
export function besideRow(row: Rect, size: Size, room: Room, inset = EDGE) {
  const right = row.right + inset;
  const x = right + size.width > room.width - EDGE ? row.left - inset - size.width : right;
  return {
    left: Math.max(EDGE, x),
    top: Math.max(EDGE, Math.min(row.top - inset, room.height - size.height - EDGE)),
  };
}
