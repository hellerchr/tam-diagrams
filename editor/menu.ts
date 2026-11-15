/**
 * Popup menus: a list of commands at a point or below a control, with submenus, ticks, keys and
 * movement by the arrow keys. The menu bar, the context menu and the menus of buttons are all this one.
 */

import { h, icon, isOff, setOff } from "./dom.ts";

/** A command in a menu, or a submenu when it has `items`. */
export interface MenuItem {
  name: string;
  run?: () => void;
  /** The keys that do the same, shown at the right. */
  key?: string;
  danger?: boolean;
  /** Shown but not to be picked: true, or the reason, which its tooltip says. */
  off?: string | boolean;
  /** A choice that is on or off: on shows a tick. */
  checked?: boolean;
  items?: MenuEntry[];
}

/** A row of a menu: a command, a dividing line, or nothing (so a row can be left out with `&&`). */
export type MenuEntry = MenuItem | "line" | false | null | undefined;

export interface PopupOptions {
  /** Called when the menu closed, however it did. */
  closed?: () => void;
  /** The left and right arrow keys at the top level: the menu bar goes to the menu beside. */
  step?: (by: 1 | -1) => void;
  /** Opens above the control instead of below it. */
  above?: boolean;
  /** Lines up with the right edge of the control instead of its left. */
  right?: boolean;
  /** Starts with the focus on the first row, as a menu opened by a key does. */
  first?: boolean;
}

/** Closes the menu that is open. */
let closeOpen: () => void = () => {};

/** Whether a menu is open. */
export const menuOpen = () => !!document.querySelector(".menu");

/** Closes the menu that is open, if one is. */
export const closeMenu = () => closeOpen();

/**
 * Why a row is not to be picked: its own reason, or for a submenu in which every row is off the
 * reason they share (the first, when they differ). Undefined for a row that is on.
 */
export function refusal(row: MenuItem): string | boolean | undefined {
  if (row.off || !row.items) return row.off || undefined;
  const rows = row.items.filter((item): item is MenuItem => !!item && item !== "line"),
    reasons = rows.map(refusal);
  if (!reasons.every(Boolean)) return undefined;
  return reasons.find((reason) => typeof reason === "string") ?? true;
}

/** The rows worth showing: no empty ones, and no line at an end or after another. */
function tidy(entries: MenuEntry[]): (MenuItem | "line")[] {
  const rows = entries.filter((entry): entry is MenuItem | "line" => !!entry);
  return rows.filter(
    (row, index) =>
      row !== "line" ||
      (index > 0 &&
        rows[index - 1] !== "line" &&
        rows.slice(index).some((next) => next !== "line")),
  );
}

/**
 * Opens a menu at a point of the window or at a control, and returns what closes it. A click
 * outside, Escape, or picking a command closes it; only one menu is open at a time.
 */
export function popup(
  entries: MenuEntry[],
  anchor: { x: number; y: number } | HTMLElement,
  options: PopupOptions = {},
): () => void {
  closeOpen();
  const before = document.activeElement as HTMLElement | null;
  /** The open menus: the first, then the submenu of each. */
  const open: HTMLElement[] = [];
  let timer: number | undefined;
  const close = () => {
    if (!open.length) return;
    window.clearTimeout(timer);
    open.splice(0).forEach((menu) => menu.remove());
    window.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", close);
    window.removeEventListener("resize", close);
    closeOpen = () => {};
    if (document.activeElement === document.body || !document.activeElement) before?.focus();
    options.closed?.();
  };
  const outside = (event: Event) => {
    if (!open.some((menu) => menu.contains(event.target as Node))) close();
  };
  const closeFrom = (level: number) => {
    open.splice(level).forEach((menu) => menu.remove());
    open
      .at(-1)
      ?.querySelectorAll('[aria-expanded="true"]')
      .forEach((row) => row.setAttribute("aria-expanded", "false"));
  };
  const rowsOf = (menu: HTMLElement) =>
    [...menu.querySelectorAll<HTMLElement>(":scope > button")].filter((row) => !isOff(row));
  const build = (level: number, list: MenuEntry[], place: (menu: HTMLElement) => void) => {
    closeFrom(level);
    const rows = tidy(list),
      ticks = rows.some((row) => row !== "line" && row.checked !== undefined);
    const menu = h("div", { class: "menu", role: "menu", tabindex: "-1" });
    menu.addEventListener("pointerenter", () => window.clearTimeout(timer));
    menu.addEventListener("contextmenu", (event) => event.preventDefault());
    for (const row of rows) {
      if (row === "line") {
        menu.append(h("hr"));
        continue;
      }
      const off = refusal(row);
      const control = h(
        "button",
        {
          class: row.danger ? "danger" : "",
          type: "button",
          role: row.checked === undefined ? "menuitem" : "menuitemcheckbox",
          "aria-checked": row.checked === undefined ? undefined : String(row.checked),
          "aria-haspopup": row.items ? "menu" : undefined,
          "aria-expanded": row.items ? "false" : undefined,
          "data-tip": typeof off === "string" ? off : undefined,
          "data-side": "right",
        },
        ticks && h("span", { class: "tick" }, row.checked ? icon("check") : null),
        h("span", { class: "name" }, row.name),
        row.key && h("kbd", {}, row.key),
        row.items && icon("chevron-right"),
      );
      setOff(control, off);
      const enter = () => {
        if (!row.items || off) return closeFrom(level + 1);
        if (control.getAttribute("aria-expanded") === "true") return;
        build(level + 1, row.items, (sub) => {
          // Beside its row: to the right where there is room, else to the left.
          const at = control.getBoundingClientRect(),
            { width, height } = sub.getBoundingClientRect(),
            x = at.right - 2 + width > window.innerWidth - 4 ? at.left - width + 2 : at.right - 2;
          sub.style.left = `${Math.max(4, x)}px`;
          sub.style.top = `${Math.max(4, Math.min(at.top - 5, window.innerHeight - height - 4))}px`;
        });
        control.setAttribute("aria-expanded", "true");
      };
      control.addEventListener("pointerenter", () => {
        window.clearTimeout(timer);
        // A pointer on its way to a submenu crosses other rows: they wait a moment before they take over.
        timer = window.setTimeout(
          () => {
            if (!control.isConnected) return;
            if (!isOff(control)) control.focus({ preventScroll: true });
            enter();
          },
          open.length > level + 1 ? 220 : 60,
        );
      });
      control.addEventListener("click", () => {
        if (isOff(control)) return;
        if (row.items) return (enter(), rowsOf(open[level + 1])[0]?.focus());
        close();
        row.run?.();
      });
      menu.append(control);
    }
    document.body.append(menu);
    open[level] = menu;
    place(menu);
    // A name too long for its row is said whole by its tooltip.
    for (const name of menu.querySelectorAll<HTMLElement>(":scope > button > .name")) {
      const row = name.parentElement!;
      if (name.scrollWidth > name.clientWidth && !row.dataset.tip)
        row.dataset.tip = name.textContent ?? "";
    }
    return menu;
  };
  const key = (event: KeyboardEvent) => {
    // The keys are the menu's while it is open: none reaches the canvas.
    event.stopPropagation();
    const focused = document.activeElement as HTMLElement | null,
      level = Math.max(
        0,
        open.findIndex((menu) => menu.contains(focused)),
      ),
      rows = rowsOf(open[level]),
      at = rows.indexOf(focused as HTMLElement);
    const go = (row: HTMLElement | undefined) => {
      event.preventDefault();
      row?.focus();
    };
    switch (event.key) {
      case "Escape":
      case "Tab":
        event.preventDefault();
        return close();
      case "ArrowDown":
        return go(rows[(at + 1) % rows.length]);
      case "ArrowUp":
        return go(rows[(at <= 0 ? rows.length : at) - 1]);
      case "Home":
        return go(rows[0]);
      case "End":
        return go(rows.at(-1));
      case "ArrowRight":
        event.preventDefault();
        if (focused?.getAttribute("aria-haspopup")) focused.click();
        else options.step?.(1);
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (level > 0) {
          const parent = open[level - 1].querySelector<HTMLElement>('[aria-expanded="true"]');
          closeFrom(level);
          parent?.focus();
        } else options.step?.(-1);
        return;
    }
    // A letter goes to the next row whose name starts with it.
    if (
      event.key.length !== 1 ||
      event.key === " " ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    const letter = event.key.toLowerCase(),
      all = [...open[level].querySelectorAll<HTMLElement>(":scope > button")],
      from = all.indexOf(focused as HTMLElement),
      next = [...all.slice(from + 1), ...all.slice(0, from + 1)].find(
        (row) =>
          !isOff(row) &&
          row.querySelector(".name")?.textContent?.trim().toLowerCase().startsWith(letter),
      );
    if (next) go(next);
  };
  const menu = build(0, entries, (menu) => {
    const { width, height } = menu.getBoundingClientRect();
    let x: number, y: number;
    if (anchor instanceof HTMLElement) {
      const at = anchor.getBoundingClientRect();
      x = options.right ? at.right - width : at.left;
      y = options.above ? at.top - height - 2 : at.bottom + 2;
    } else ({ x, y } = anchor);
    // Inside the window, whichever corner it was asked for near.
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`;
  });
  menu.focus({ preventScroll: true });
  if (options.first) rowsOf(menu)[0]?.focus({ preventScroll: true });
  window.addEventListener("pointerdown", outside, true);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", close);
  window.addEventListener("resize", close);
  closeOpen = close;
  return close;
}

/**
 * Makes a control open a menu: a press opens it, a press while it is open closes it, and the control
 * says which with `aria-expanded`. Returns what opens the menu from elsewhere.
 */
export function menuButton(
  control: HTMLElement,
  items: () => MenuEntry[],
  options: PopupOptions = {},
): { open: (first?: boolean) => void; close: () => void; readonly isOpen: boolean } {
  let close: (() => void) | undefined,
    closedAt = 0;
  control.setAttribute("aria-haspopup", "menu");
  control.setAttribute("aria-expanded", "false");
  const open = (first = false) => {
    if (close || isOff(control)) return;
    control.setAttribute("aria-expanded", "true");
    close = popup(items(), control, {
      ...options,
      first,
      closed: () => {
        close = undefined;
        closedAt = performance.now();
        control.setAttribute("aria-expanded", "false");
        options.closed?.();
      },
    });
  };
  // The press that closed the menu, on its own control, does not open it again.
  control.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || performance.now() - closedAt < 50) return;
    event.preventDefault();
    open();
  });
  control.addEventListener("click", (event) => {
    // A click without a pointer comes from the keyboard.
    if (event.detail === 0) open(true);
  });
  return {
    open,
    close: () => close?.(),
    get isOpen() {
      return !!close;
    },
  };
}
