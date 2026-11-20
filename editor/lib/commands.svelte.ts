// The command registry: everything the palette lists and every global shortcut. A command's keys are the keymap's
// (hotkey-table.ts) under the command's id, from which hints ("Ctrl K", "⌘K") and titles are derived.
import type { IconNode } from "lucide";
import { untrack } from "svelte";
import { hintOf, idsFor } from "./hotkeys.svelte.ts";

/** `run` gets the key event when a shortcut ran it (F8 tells a held key from a tap). */
export type Command = {
  id: string;
  label: string;
  icon?: IconNode;
  run: (event?: KeyboardEvent) => void;
  when?: () => boolean;
};

let list = $state.raw<Command[]>([]);

/** The registered commands that apply now. */
export const commands = () => list.filter((c) => c.when?.() !== false);

/** Add commands; returns their removal. Safe inside effects: it reads the list untracked, so registering never
 *  makes the caller depend on (and re-run with) the list it changes. */
export function register(added: Command[]): () => void {
  list = [...untrack(() => list), ...added];
  return () => (list = untrack(() => list).filter((c) => !added.includes(c)));
}

/** Run the command bound to the key `event` (true when one ran). */
export function runShortcut(event: KeyboardEvent): boolean {
  const ids = idsFor(event);
  const command = ids.length ? commands().find((c) => ids.includes(c.id)) : undefined;
  command?.run(event);
  return !!command;
}

/** A button title with its shortcut: "Show sidebar (Ctrl B)". */
export function titled(label: string, id: string) {
  const hint = hintOf(id);
  return hint ? `${label} (${hint})` : label;
}
