// The diagram editor's window keys (DiagramBar.svelte), as tam-diagrams' editor had them (ui.ts shortcuts): F10 and
// Alt alone go to the menu bar, Alt with a menu's first letter opens it (the letters are underlined while Alt is held),
// Ctrl+Alt+N starts a new diagram, and the canvas's zoom keys: + and − (with or without Ctrl or Shift), 1 fits the
// diagram, 2 the selection, Ctrl+0 shows it at 100%, ? opens Keyboard and mouse. They act while the focus is in the
// diagram's window (or nowhere), never under a dialog; the canvas's keys not while a field or a menu has the keys.
import { isEditable } from "../lib/keys.ts";
import { overlays } from "../lib/overlays.svelte.ts";

/** What the keys reach. */
export type BarKeysHost = {
  /** The diagram's window: the keys act while the focus is in it. */
  shell: () => HTMLElement | null | undefined;
  /** Opens the menu whose title starts with `letter`; false when none does (or it is off). */
  mnemonic: (letter: string) => boolean;
  /** One of the bar's menus is open (the keys are then the menu's, and these). */
  barMenuOpen: () => boolean;
  /** Puts the focus on the menu bar, or back where it was when the bar has it. */
  focusBar: () => void;
  /** Alt is held alone: the menus' letters show. */
  alt: (held: boolean) => void;
  newDiagram: () => void;
  help: () => void;
  zoomStep: (inward: boolean) => void;
  zoomTo: (zoom: number) => void;
  fit: () => void;
  fitSelection: () => void;
};

/** The modifiers held with a key: `C` for Ctrl or Cmd, `A` for Alt, `S` for Shift, in that order. */
const modifiers = (e: KeyboardEvent) =>
  (e.ctrlKey || e.metaKey ? "C" : "") + (e.altKey ? "A" : "") + (e.shiftKey ? "S" : "");

const dialogOpen = () => !!document.querySelector('[role="dialog"], dialog[open]');

/** A key of the canvas: what it does, or undefined when the key is not one. */
function canvasKey(host: BarKeysHost, key: string, held: string): (() => void) | undefined {
  if (["+", "=", "-"].includes(key) && ["", "C", "S", "CS"].includes(held))
    return () => host.zoomStep(key !== "-");
  if (key === "0" && held === "C") return () => host.zoomTo(1);
  if (key === "1" && !held) return host.fit;
  if (key === "2" && !held) return host.fitSelection;
  if (key === "?" && (held === "S" || !held)) return host.help;
  return undefined;
}

/** A key of the window that is not the canvas's: a new diagram, or F10 to the menu bar. */
function windowKey(host: BarKeysHost, e: KeyboardEvent, held: string): (() => void) | undefined {
  if (e.code === "KeyN" && (held === "CA" || held === "CAS")) return host.newDiagram;
  if (e.key === "F10" && !held) return host.focusBar;
  return undefined;
}

/** The window's key handlers, for the capture phase: Alt held alone, then released, goes to the menu bar. */
export function barKeys(host: BarKeysHost) {
  let alone = false;
  const within = () => {
    const active = document.activeElement;
    return (
      !active || active === document.body || !!host.shell()?.contains(active) || host.barMenuOpen()
    );
  };
  const done = (e: Event, run: () => void) => {
    e.preventDefault();
    e.stopPropagation();
    run();
  };
  const released = () => {
    alone = false;
    host.alt(false);
  };

  function keydown(e: KeyboardEvent) {
    if (!within() || dialogOpen()) return;
    const held = modifiers(e);
    alone = e.key === "Alt" && held === "A";
    host.alt(alone);
    if (e.key === "Alt") return e.preventDefault();
    const letter = /^Key([A-Z])$/.exec(e.code)?.[1];
    if (held === "A" && letter) return host.mnemonic(letter.toLowerCase()) && done(e, () => {});
    const canvas = !isEditable(e.target) && !overlays.menu;
    const run = windowKey(host, e, held) ?? (canvas ? canvasKey(host, e.key, held) : undefined);
    if (run) done(e, run);
  }

  function keyup(e: KeyboardEvent) {
    if (e.key !== "Alt") return;
    const was = alone;
    released();
    if (!was || dialogOpen()) return;
    e.preventDefault();
    host.focusBar();
  }

  return { keydown, keyup, released };
}
