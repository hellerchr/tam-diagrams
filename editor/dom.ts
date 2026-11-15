/** What the panels are built from: elements, icons, icon buttons, and controls that say why they are off. */

import { ICONS, type IconName } from "./icons.ts";

type Child = Node | string | false | null | undefined;

/** An element with attributes, listeners (`on...`) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (name.startsWith("on") && typeof value === "function")
      element.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    else if (name === "class") element.className = String(value);
    else if (name === "value") (element as HTMLInputElement).value = String(value);
    else element.setAttribute(name, value === true ? "" : String(value));
  }
  element.append(...children.filter((child): child is Node | string => !!child));
  return element;
}

/** An icon: one of the drawings in icons.ts, parsed as an image of its own, not as markup of the page. */
export function icon(name: IconName): HTMLElement {
  const holder = h("span", { class: "icon", "aria-hidden": "true" });
  const svg = new DOMParser().parseFromString(ICONS[name], "image/svg+xml").documentElement;
  holder.append(document.importNode(svg, true));
  return holder;
}

/** What a tooltip says about a control: its name, the keys that do the same, and the side it shows on. */
export interface Tip {
  tip: string;
  key?: string;
  side?: "top" | "right" | "bottom" | "left";
}

/** The attributes that give a control its tooltip and its name for screen readers. */
export const tipped = ({ tip, key, side }: Tip) => ({
  "data-tip": tip,
  "data-key": key,
  "data-side": side,
  "aria-label": tip,
});

/** A button that shows only an icon; its name is in its tooltip. */
export function iconButton(
  name: IconName,
  tip: Tip,
  run: (event: MouseEvent) => void,
  kind = "button",
): HTMLButtonElement {
  return h("button", { class: kind, type: "button", ...tipped(tip), onClick: run }, icon(name));
}

/**
 * Turns a control off, with the reason as its tooltip, or on again. The control stays in the page's
 * tab order and under the pointer, so the reason can be read; clicks on it are dropped.
 */
export function setOff(control: HTMLElement, reason: string | boolean | undefined) {
  if (reason) {
    control.setAttribute("aria-disabled", "true");
    if (typeof reason === "string") control.dataset.why = reason;
    else delete control.dataset.why;
  } else {
    control.removeAttribute("aria-disabled");
    delete control.dataset.why;
  }
}

/** Whether a control was turned off with `setOff`. */
export const isOff = (control: Element | null) => !!control?.closest('[aria-disabled="true"]');

/** Text with its `backticked` parts as code. */
export function prose(text: string): (Node | string)[] {
  return text
    .split(/`([^`]+)`/)
    .map((part, index) => (index % 2 ? h("code", {}, part) : part))
    .filter((part) => part !== "");
}
