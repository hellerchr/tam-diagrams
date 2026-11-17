/**
 * Popup menus: a list of commands at a point or below a control, with submenus, ticks, keys and
 * movement by the arrow keys. The menu bar, the context menu and the menus of buttons are all this one.
 */

import { h, icon, isOff, setOff } from "./dom.ts";
import type { IconName } from "./icons.ts";

/** A command in a menu, or a submenu when it has `items`. */
export interface MenuItem {
  name: string;
  run?: () => void;
  /** The keys that do the same, shown at the right. */
  key?: string;
  /** A drawing before the name. */
  icon?: IconName;
  /** A word or two about the row, shown at the right where a row without keys has room. */
  note?: string;
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
  /** The arrow down on the control opens the menu, as it opens a list of choices. */
  arrow?: boolean;
  /** As wide as the control at least, as a list of choices is. */
  wide?: boolean;
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

/** Where the keys that move along a menu go from the row at `at`, which is -1 when none has the focus. */
const MOVES: Record<string, (rows: HTMLElement[], at: number) => HTMLElement | undefined> = {
  ArrowDown: (rows, at) => rows[(at + 1) % rows.length],
  ArrowUp: (rows, at) => rows[(at <= 0 ? rows.length : at) - 1],
  Home: (rows) => rows[0],
  End: (rows) => rows.at(-1),
};

/** The rows of a menu that may be picked. */
const rowsOf = (menu: HTMLElement) =>
  [...menu.querySelectorAll<HTMLElement>(":scope > button")].filter((row) => !isOff(row));

/** Whether a key types a letter that goes to the next row whose name starts with it. */
function typesLetter(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey
  );
}

/** The attributes of a row's button: its role, its tick, its submenu and the reason it is off. */
function rowAttributes(row: MenuItem, off: string | boolean | undefined) {
  const choice = row.checked !== undefined;
  return {
    class: row.danger ? "danger" : "",
    type: "button",
    role: choice ? "menuitemcheckbox" : "menuitem",
    "aria-checked": choice ? String(row.checked) : undefined,
    "aria-haspopup": row.items ? "menu" : undefined,
    "aria-expanded": row.items ? "false" : undefined,
    "data-tip": typeof off === "string" ? off : undefined,
    "data-side": "right",
  };
}

/** What a row shows: a tick where the menu has choices, a drawing, the name, then keys or a note. */
function rowContent(row: MenuItem, ticks: boolean) {
  return [
    ticks && h("span", { class: "tick" }, row.checked ? icon("check") : null),
    row.icon && icon(row.icon),
    h("span", { class: "name" }, row.name),
    row.key ? h("kbd", {}, row.key) : row.note && h("span", { class: "row-note" }, row.note),
    row.items && icon("chevron-right"),
  ];
}

/** A name too long for its row is said whole by its tooltip. */
function tipLongNames(menu: HTMLElement) {
  for (const name of menu.querySelectorAll<HTMLElement>(":scope > button > .name")) {
    const row = name.parentElement!;
    if (name.scrollWidth > name.clientWidth && !row.dataset.tip)
      row.dataset.tip = name.textContent ?? "";
  }
}

/** Places a submenu beside its row: to the right where there is room, else to the left. */
function besideRow(control: HTMLElement, sub: HTMLElement) {
  const at = control.getBoundingClientRect(),
    { width, height } = sub.getBoundingClientRect(),
    x = at.right - 2 + width > window.innerWidth - 4 ? at.left - width + 2 : at.right - 2;
  sub.style.left = `${Math.max(4, x)}px`;
  sub.style.top = `${Math.max(4, Math.min(at.top - 5, window.innerHeight - height - 4))}px`;
}

/** Places the first menu at its point or at its control, inside the window, whichever corner it was asked for near. */
function placeMenu(
  menu: HTMLElement,
  anchor: { x: number; y: number } | HTMLElement,
  options: PopupOptions,
) {
  const { width, height } = menu.getBoundingClientRect(),
    { x, y } = anchor instanceof HTMLElement ? atControl(menu, anchor, options) : anchor;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`;
}

/** Where a menu opens at a control: below or above it, lined up with its left or right edge. */
function atControl(menu: HTMLElement, control: HTMLElement, options: PopupOptions) {
  const { width, height } = menu.getBoundingClientRect(),
    at = control.getBoundingClientRect(),
    least = options.wide ? at.width : 0;
  if (options.wide) menu.style.minWidth = `${at.width}px`;
  return {
    x: options.right ? at.right - Math.max(width, least) : at.left,
    y: options.above ? at.top - height - 2 : at.bottom + 2,
  };
}

/** A menu that is open, with the submenus open from it. */
class Popup {
  private readonly options: PopupOptions;
  /** What had the focus before the menu opened: it gets it back. */
  private readonly before = document.activeElement as HTMLElement | null;
  /** The open menus: the first, then the submenu of each. */
  private readonly open: HTMLElement[] = [];
  private timer: number | undefined;

  constructor(options: PopupOptions) {
    this.options = options;
  }

  /** The handlers the window calls while the menu is open, bound to it. */
  private readonly outside = (event: Event) => this.pressed(event);
  private readonly key = (event: KeyboardEvent) => this.keyDown(event);
  readonly close = () => this.closeAll();

  private closeAll() {
    if (!this.open.length) return;
    window.clearTimeout(this.timer);
    this.open.splice(0).forEach((menu) => menu.remove());
    window.removeEventListener("pointerdown", this.outside, true);
    window.removeEventListener("keydown", this.key, true);
    window.removeEventListener("blur", this.close);
    window.removeEventListener("resize", this.close);
    closeOpen = () => {};
    if (document.activeElement === document.body || !document.activeElement) this.before?.focus();
    this.options.closed?.();
  }

  /** Opens the first menu with its rows at its anchor, and takes the keys and the presses outside. */
  show(entries: MenuEntry[], anchor: { x: number; y: number } | HTMLElement) {
    const menu = this.build(0, entries, (menu) => placeMenu(menu, anchor, this.options));
    menu.focus({ preventScroll: true });
    if (this.options.first) rowsOf(menu)[0]?.focus({ preventScroll: true });
    window.addEventListener("pointerdown", this.outside, true);
    window.addEventListener("keydown", this.key, true);
    window.addEventListener("blur", this.close);
    window.addEventListener("resize", this.close);
  }

  /** A press outside the menus closes them. */
  private pressed(event: Event) {
    if (!this.open.some((menu) => menu.contains(event.target as Node))) this.close();
  }

  /** Closes the menus from `level` on, and marks the rows of the one left as not expanded. */
  private closeFrom(level: number) {
    this.open.splice(level).forEach((menu) => menu.remove());
    this.open
      .at(-1)
      ?.querySelectorAll('[aria-expanded="true"]')
      .forEach((row) => row.setAttribute("aria-expanded", "false"));
  }

  /** Makes the menu at `level` with its rows, in place of any open there, and places it. */
  private build(level: number, list: MenuEntry[], place: (menu: HTMLElement) => void) {
    this.closeFrom(level);
    const rows = tidy(list),
      ticks = rows.some((row) => row !== "line" && row.checked !== undefined);
    const menu = h("div", { class: "menu", role: "menu", tabindex: "-1" });
    menu.addEventListener("pointerenter", () => window.clearTimeout(this.timer));
    menu.addEventListener("contextmenu", (event) => event.preventDefault());
    for (const row of rows) menu.append(row === "line" ? h("hr") : this.row(level, row, ticks));
    document.body.append(menu);
    this.open[level] = menu;
    place(menu);
    tipLongNames(menu);
    return menu;
  }

  /** The button of a row: the pointer resting on it opens its submenu, a click runs it. */
  private row(level: number, row: MenuItem, ticks: boolean) {
    const off = refusal(row),
      control = h("button", rowAttributes(row, off), ...rowContent(row, ticks));
    setOff(control, off);
    const enter = () => this.enter(level, row, control, off);
    control.addEventListener("pointerenter", () => this.hover(level, control, enter));
    control.addEventListener("click", () => {
      if (isOff(control)) return;
      if (row.items) return (enter(), rowsOf(this.open[level + 1])[0]?.focus());
      this.close();
      row.run?.();
    });
    return control;
  }

  /** The row is entered: its submenu opens beside it, and any other submenu closes. */
  private enter(
    level: number,
    row: MenuItem,
    control: HTMLElement,
    off: string | boolean | undefined,
  ) {
    if (!row.items || off) return this.closeFrom(level + 1);
    if (control.getAttribute("aria-expanded") === "true") return;
    this.build(level + 1, row.items, (sub) => besideRow(control, sub));
    control.setAttribute("aria-expanded", "true");
  }

  /** The pointer came onto a row. On its way to a submenu it crosses other rows: they wait a moment before they take over. */
  private hover(level: number, control: HTMLElement, enter: () => void) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(
      () => {
        if (!control.isConnected) return;
        if (!isOff(control)) control.focus({ preventScroll: true });
        enter();
      },
      this.open.length > level + 1 ? 220 : 60,
    );
  }

  /** The keys are the menu's while it is open: none reaches the canvas. */
  private keyDown(event: KeyboardEvent) {
    event.stopPropagation();
    const focused = document.activeElement as HTMLElement | null,
      level = Math.max(
        0,
        this.open.findIndex((menu) => menu.contains(focused)),
      ),
      rows = rowsOf(this.open[level]),
      move = MOVES[event.key];
    if (move) return focusRow(event, move(rows, rows.indexOf(focused as HTMLElement)));
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      return this.close();
    }
    if (event.key === "ArrowRight") return this.right(event, focused);
    if (event.key === "ArrowLeft") return this.left(event, level);
    if (typesLetter(event)) this.typeAhead(event, focused, level);
  }

  /** The right arrow opens the submenu of the row, or at the top goes to the menu beside. */
  private right(event: KeyboardEvent, focused: HTMLElement | null) {
    event.preventDefault();
    if (focused?.getAttribute("aria-haspopup")) focused.click();
    else this.options.step?.(1);
  }

  /** The left arrow closes a submenu, back to its row, or at the top goes to the menu beside. */
  private left(event: KeyboardEvent, level: number) {
    event.preventDefault();
    if (level === 0) return this.options.step?.(-1);
    const parent = this.open[level - 1].querySelector<HTMLElement>('[aria-expanded="true"]');
    this.closeFrom(level);
    parent?.focus();
  }

  /** A letter goes to the next row whose name starts with it. */
  private typeAhead(event: KeyboardEvent, focused: HTMLElement | null, level: number) {
    const letter = event.key.toLowerCase(),
      all = [...this.open[level].querySelectorAll<HTMLElement>(":scope > button")],
      from = all.indexOf(focused as HTMLElement),
      next = [...all.slice(from + 1), ...all.slice(0, from + 1)].find(
        (row) =>
          !isOff(row) &&
          row.querySelector(".name")?.textContent?.trim().toLowerCase().startsWith(letter),
      );
    if (next) focusRow(event, next);
  }
}

/** Puts the focus on a row by a key, which then does nothing else. */
function focusRow(event: KeyboardEvent, row: HTMLElement | undefined) {
  event.preventDefault();
  row?.focus();
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
  const menu = new Popup(options);
  menu.show(entries, anchor);
  closeOpen = menu.close;
  return menu.close;
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
    /** The press under way began on the control while its menu was open: it closes the menu. */
    closing = false;
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
        control.setAttribute("aria-expanded", "false");
        options.closed?.();
      },
    });
  };
  // The press that closes the menu, on its own control, does not open it again. It is seen here
  // before the menu sees it as a press outside and closes.
  window.addEventListener(
    "pointerdown",
    (event) => {
      closing = !!close && event.target instanceof Node && control.contains(event.target);
    },
    true,
  );
  control.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || closing) return;
    event.preventDefault();
    open();
  });
  openByKeys(control, !!options.arrow, () => !!close, open);
  return {
    open,
    close: () => close?.(),
    get isOpen() {
      return !!close;
    },
  };
}

/**
 * Makes the keyboard open a control's menu with the focus on its first row: Enter and Space, which
 * click it, and the arrow down where it shows a choice, as it opens a list.
 */
function openByKeys(
  control: HTMLElement,
  arrow: boolean,
  isOpen: () => boolean,
  open: (first: boolean) => void,
) {
  control.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" || isOpen() || !arrow) return;
    event.preventDefault();
    event.stopPropagation();
    open(true);
  });
  control.addEventListener("click", (event) => {
    // A click without a pointer comes from the keyboard.
    if (event.detail === 0) open(true);
  });
}

/** One of the things to choose from in a `choiceButton`. */
export interface Choice<Value extends string> {
  value: Value;
  name: string;
}

/** A control that shows one choice of a list and opens the list as a menu: see `choiceButton`. */
export interface ChoiceButton<Value extends string> {
  readonly element: HTMLButtonElement;
  /** Shows the choices on offer and the one that is set; the empty value shows as "Mixed". */
  show(choices: Choice<Value>[], current: Value | ""): void;
}

/**
 * A list to choose one of, in the look of the other controls: a field that names the choice that
 * is set and opens the choices as a menu, with a tick at that one. A click, Enter, Space or the
 * arrow down opens it; `write` takes what is picked.
 */
export function choiceButton<Value extends string>(
  write: (value: Value) => void,
): ChoiceButton<Value> {
  let choices: Choice<Value>[] = [],
    current: Value | "" = "";
  const name = h("span", { class: "name" }),
    element = h(
      "button",
      { class: "field choice", type: "button", role: "combobox" },
      name,
      icon("chevron"),
    );
  menuButton(
    element,
    () =>
      choices.map((choice) => ({
        name: choice.name,
        checked: choice.value === current,
        run: () => {
          if (choice.value !== current) write(choice.value);
        },
      })),
    { arrow: true, wide: true },
  );
  return {
    element,
    show(list, value) {
      choices = list;
      current = value;
      name.textContent =
        value === "" ? "Mixed" : (list.find((choice) => choice.value === value)?.name ?? value);
      name.classList.toggle("mixed", value === "");
    },
  };
}
