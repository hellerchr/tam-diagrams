// Menus, prompts, confirmations and toasts, opened from anywhere with one call and drawn by ui/Overlays.svelte.
import type { IconNode } from "lucide";
import { errorText } from "../shared/errors.ts";

/** A menu's row: an action, a submenu, a line between groups, or a group's heading (not a row the keys stop on). */
export type MenuItem = MenuAction | MenuSub | { heading: string } | "separator";
/** A row as a menu is given it: nothing (`false`, …) is left out, so a row can be written `cond && {…}`; lines at an
 *  end or after another are dropped (lib/menu.ts `tidy`). */
export type MenuEntry = MenuItem | false | null | undefined;
/** A menu row that does something. */
export type MenuAction = {
  label: string;
  icon?: IconNode;
  /** Its keys, in the column at the right. */
  hint?: string;
  /** A word or two at the right where there are no keys (an age). */
  note?: string;
  danger?: boolean;
  /** A choice that is on or off: the menu then has a tick column, and this row a tick when on. */
  checked?: boolean;
  /** Shown but not to be picked: true, or the reason, which its tooltip says. */
  off?: string | boolean;
  /** Its tooltip. */
  title?: string;
  /** Run on a second pick: the first shows this question in the row (the menu stays open). */
  confirm?: string;
  action: () => void;
};
/** A row that opens a submenu beside it (pointer, Enter or the right arrow). */
export type MenuSub = Omit<MenuAction, "action" | "confirm"> & {
  items: MenuEntry[];
  action?: undefined;
};
/** A row that can be picked or opened: an action or a submenu. */
export type MenuRow = MenuAction | MenuSub;

/** How a menu opens at its control, and what it tells it. */
export type MenuOptions = {
  /** Above the control rather than below it. */
  above?: boolean;
  /** Lined up with the control's right edge (true) or left edge (false); by default the side nearer the middle. */
  right?: boolean;
  /** Starts with the first row highlighted, as a menu opened by a key does. */
  first?: boolean;
  /** The left and right arrows at the top level (a menu bar goes to the menu beside). */
  step?: (by: 1 | -1) => void;
  /** The pointer moved outside the menus (a menu bar opens the title under it). */
  over?: (e: PointerEvent) => void;
  /** Called when the menu closed, however it did (or another took its place). */
  closed?: () => void;
};

type Anchor = { x: number; y: number; alignRight?: boolean; above?: boolean };

export type Prompt = {
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  confirm?: string;
  danger?: boolean;
  /** The input's selection when it opens, e.g. a file name without its extension; default all. */
  select?: [number, number];
  /** Without an input: a yes / no question. */
  input?: boolean;
  /** A second answer beside the confirm one ("Don't Save"), answered with `ALT`. */
  alt?: string;
  resolve(value: string | undefined): void;
};

export type Toast = {
  id: number;
  text: string;
  kind: "info" | "error";
  action?: { label: string; run(): void };
};

export const overlays = $state<{
  menu?: { items: MenuEntry[]; at: Anchor; options?: MenuOptions };
  prompt?: Prompt;
  image?: string;
  toasts: Toast[];
}>({
  toasts: [],
});

/** Show an image full size over the window; Esc or a click closes it. */
export const showImage = (src: string) => (overlays.image = src);

let lastAt: Anchor = { x: 0, y: 0 };

/** Open a menu below `anchor` (an element, or a pointer event for a context menu); one open before is closed. */
export function openMenu(anchor: Element | MouseEvent, items: MenuEntry[], options?: MenuOptions) {
  if (anchor instanceof MouseEvent) {
    anchor.preventDefault();
    lastAt = { x: anchor.clientX, y: anchor.clientY };
  } else {
    const rect = anchor.getBoundingClientRect();
    const alignRight = options?.right ?? rect.left > innerWidth / 2;
    const y = options?.above ? rect.top - 4 : rect.bottom + 4;
    lastAt = { x: alignRight ? rect.right : rect.left, y, alignRight, above: options?.above };
  }
  replaceMenu({ items, at: lastAt, options });
}

/** Open a menu where the last one was, from one of its items (a submenu: "Snooze…"). */
export const openSubmenu = (items: MenuEntry[]) => replaceMenu({ items, at: lastAt });

export const closeMenu = () => replaceMenu(undefined);

/** Puts `menu` in the place of the one open, which is told it closed. */
function replaceMenu(menu: typeof overlays.menu) {
  const before = overlays.menu;
  overlays.menu = menu;
  before?.options?.closed?.();
}

export function ask(options: Omit<Prompt, "resolve" | "input">): Promise<string | undefined> {
  return new Promise((resolve) => (overlays.prompt = { ...options, input: true, resolve }));
}

export function confirm(
  options: Omit<Prompt, "resolve" | "input" | "value" | "placeholder">,
): Promise<boolean> {
  return new Promise(
    (resolve) =>
      (overlays.prompt = { ...options, input: false, resolve: (v) => resolve(v !== undefined) }),
  );
}

/** What a prompt resolves with when its `alt` button is picked. */
export const ALT = "\0alt";

/** A question with two answers and Cancel (Save / Don't Save / Cancel): which was picked, or undefined for Cancel. */
export function choose(
  options: Omit<Prompt, "resolve" | "input" | "value" | "placeholder"> & { alt: string },
) {
  return new Promise<"confirm" | "alt" | undefined>(
    (resolve) =>
      (overlays.prompt = {
        ...options,
        input: false,
        resolve: (v) => resolve(v === undefined ? undefined : v === ALT ? "alt" : "confirm"),
      }),
  );
}

let nextToast = 0;
/** A toast with an `action` stays until it is used or dismissed; the others go by themselves. */
export function toast(text: string, kind: Toast["kind"] = "info", action?: Toast["action"]) {
  const id = ++nextToast;
  overlays.toasts.push({ id, text, kind, action });
  if (!action) setTimeout(() => dismissToast(id), kind === "error" ? 6000 : 3000);
}

export const dismissToast = (id: number) =>
  (overlays.toasts = overlays.toasts.filter((t) => t.id !== id));

/** Run an action, showing its error as a toast instead of throwing. */
export async function attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    toast(errorText(error), "error");
    return undefined;
  }
}
