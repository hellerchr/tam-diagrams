/**
 * Tooltips: one element for the whole page, shown beside the control under the pointer a moment
 * after it came there. A control names itself with `data-tip`, its keys with `data-key`, the side
 * with `data-side`, and why it is off with `data-why`.
 */

import { h, isOff } from "./dom.ts";

/** The pointer rests this long on a control before its tooltip shows. */
const DELAY = 400;

/** The gap between a tooltip and its control. */
const GAP = 6;

/** Where a tooltip stands across, by the side of its control it is on. */
const ACROSS: Record<string, (at: DOMRect, width: number) => number> = {
  right: (at) => at.right + GAP,
  left: (at, width) => at.left - width - GAP,
};

/** Where a tooltip stands down the page, by the side of its control it is on. */
const DOWN: Record<string, (at: DOMRect, height: number) => number> = {
  bottom: (at) => at.bottom + GAP,
  top: (at, height) => at.top - height - GAP,
};

/** Writes a control's tooltip: why it is off, or what it does with its keys. False when it has none. */
function fill(tip: HTMLElement, control: HTMLElement): boolean {
  const off = isOff(control),
    text = (off && control.dataset.why) || control.dataset.tip;
  if (!text) return false;
  tip.replaceChildren(h("span", {}, text));
  if (!off && control.dataset.key) tip.append(h("kbd", {}, control.dataset.key));
  return true;
}

/** Places a tooltip at the side of its control, inside the window; one below the last row of the page shows above it. */
function place(tip: HTMLElement, control: HTMLElement) {
  const at = control.getBoundingClientRect(),
    { width, height } = tip.getBoundingClientRect(),
    side = control.dataset.side ?? "bottom",
    x = ACROSS[side]?.(at, width) ?? at.left + at.width / 2 - width / 2,
    y = DOWN[side]?.(at, height) ?? at.top + at.height / 2 - height / 2,
    top = y + height > window.innerHeight - 4 ? at.top - height - GAP : y;
  tip.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
  tip.style.top = `${Math.max(4, top)}px`;
}

/** The one tooltip of the page, and the control it is for. */
class Tooltip {
  // As a popover it lies over everything, an open dialog too.
  private readonly tip = h("div", { class: "tooltip", role: "tooltip", popover: "manual" });
  private timer: number | undefined;
  private anchor: HTMLElement | undefined;

  constructor() {
    this.tip.hidden = true;
    document.body.append(this.tip);
  }

  /** Hides the tooltip. With `stay`, its control keeps it hidden until the pointer left it and came back. */
  hide(stay = false) {
    const { tip } = this;
    window.clearTimeout(this.timer);
    if (!stay) this.anchor = undefined;
    if (tip.hidePopover && tip.matches(":popover-open")) tip.hidePopover();
    tip.hidden = true;
  }

  /** The pointer came onto an element: the tooltip of the control it is in shows a moment later. */
  over(event: PointerEvent) {
    const control =
      (event.target as Element | null)?.closest?.<HTMLElement>("[data-tip], [data-why]") ??
      undefined;
    if (control === this.anchor) return;
    this.hide();
    this.anchor = control;
    if (control && event.pointerType !== "touch")
      this.timer = window.setTimeout(() => this.show(control), DELAY);
  }

  private show(control: HTMLElement) {
    const { tip } = this;
    if (!control.isConnected || !fill(tip, control)) return;
    // Measured at the corner of the window, where nothing narrows it.
    tip.style.left = tip.style.top = "0px";
    tip.hidden = false;
    if (tip.showPopover && !tip.matches(":popover-open")) tip.showPopover();
    place(tip, control);
  }
}

/** Starts the tooltips, and drops the clicks on controls that are off. */
export function installTooltips() {
  const tooltip = new Tooltip(),
    hide = () => tooltip.hide();
  document.addEventListener("pointerover", (event) => tooltip.over(event));
  // A press on a control puts its tooltip away for as long as the pointer stays on it.
  document.addEventListener("pointerdown", () => tooltip.hide(true), true);
  document.addEventListener("keydown", hide, true);
  document.addEventListener("wheel", hide, { capture: true, passive: true });
  document.documentElement.addEventListener("pointerleave", hide);
  // A control that is off takes no click, whatever listens on it.
  document.addEventListener(
    "click",
    (event) => {
      if (!isOff(event.target as Element | null)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}
