/**
 * Tooltips: one element for the whole page, shown beside the control under the pointer a moment
 * after it came there. A control names itself with `data-tip`, its keys with `data-key`, the side
 * with `data-side`, and why it is off with `data-why`.
 */

import { h, isOff } from "./dom.ts";

/** The pointer rests this long on a control before its tooltip shows. */
const DELAY = 400;

/** Starts the tooltips, and drops the clicks on controls that are off. */
export function installTooltips() {
  const tip = h("div", { class: "tooltip", role: "tooltip" });
  tip.hidden = true;
  document.body.append(tip);
  let timer: number | undefined, anchor: HTMLElement | undefined;
  const hide = () => {
    window.clearTimeout(timer);
    anchor = undefined;
    tip.hidden = true;
  };
  const show = (control: HTMLElement) => {
    if (!control.isConnected) return;
    const text = (isOff(control) && control.dataset.why) || control.dataset.tip;
    if (!text) return;
    tip.replaceChildren(h("span", {}, text));
    if (!isOff(control) && control.dataset.key) tip.append(h("kbd", {}, control.dataset.key));
    tip.hidden = false;
    const at = control.getBoundingClientRect(),
      { width, height } = tip.getBoundingClientRect(),
      side = control.dataset.side ?? "bottom",
      gap = 6;
    const x =
        side === "right"
          ? at.right + gap
          : side === "left"
            ? at.left - width - gap
            : at.left + at.width / 2 - width / 2,
      y =
        side === "bottom"
          ? at.bottom + gap
          : side === "top"
            ? at.top - height - gap
            : at.top + at.height / 2 - height / 2;
    // Inside the window; a tooltip below the last row of the page shows above it.
    const top = y + height > window.innerHeight - 4 ? at.top - height - gap : y;
    tip.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  };
  document.addEventListener("pointerover", (event) => {
    const control =
      (event.target as Element | null)?.closest?.<HTMLElement>("[data-tip]") ?? undefined;
    if (control === anchor) return;
    hide();
    anchor = control;
    if (control && event.pointerType !== "touch")
      timer = window.setTimeout(() => show(control), DELAY);
  });
  document.addEventListener("pointerdown", hide, true);
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
