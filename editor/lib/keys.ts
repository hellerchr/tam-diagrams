// Keyboard helpers shared by every list and shortcut.

type List = {
  count: number;
  active: number;
  move: (index: number) => void;
  pick: () => void;
  close?: () => void;
  tab?: boolean;
};

/**
 * Arrow keys move through a list (wrapping), Enter (and Tab when `tab`) picks, Escape closes. Returns whether the
 * key was used; the caller then prevents its default.
 */
export function listKey(event: KeyboardEvent, list: List): boolean {
  const n = Math.max(list.count, 1);
  if (event.key === "ArrowDown") list.move((list.active + 1) % n);
  else if (event.key === "ArrowUp") list.move((list.active - 1 + n) % n);
  else if (event.key === "Enter" || (list.tab && event.key === "Tab")) list.pick();
  else if (event.key === "Escape" && list.close) list.close();
  else return false;
  return true;
}

/** The event's target takes typing (a field, the editor, a terminal): plain keys there are not shortcuts. */
export const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || !!target.closest("input, textarea, select"));
