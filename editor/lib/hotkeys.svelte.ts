// Hotkeys: the keymap table (hotkey-table.ts) with the person's overrides on top, stored in this browser (a Mac and
// a PC want different keys), and key events matched against it (keyspec.ts). A lookup from key to ids is rebuilt
// only when the keymap changes; a key press costs one Map lookup.
import { HOTKEYS } from "./hotkey-table.ts";
import { eventKey, eventSpec as toSpec, prettyKeys as pretty, specKey } from "./keyspec.ts";
import { load, save } from "./storage.ts";

const KEY = "h2.hotkeys";

/** This is a Mac (or iPad): `Mod` means Cmd, and hints use ⌘⌥⇧⌃. */
export const isMac = /Mac|iPhone|iPad/.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform,
);

const overrides = $state<Record<string, string[]>>(load(KEY, {}));
$effect.root(() => {
  $effect(() => save(KEY, $state.snapshot(overrides)));
});

/** The default keys of `id` on this platform. */
export const defaultKeys = (id: string): string[] => {
  const def = HOTKEYS[id];
  return def ? ((isMac ? def.mac : undefined) ?? def.pc) : [];
};

/** The key bound to `id` now, as a list of at most one (reactive; older overrides may hold more). */
export const keysOf = (id: string): string[] => (overrides[id] ?? defaultKeys(id)).slice(0, 1);

/** The keymap's label for `id`. */
export const labelOf = (id: string) => HOTKEYS[id]?.label ?? id;

/** Bind `id` to `keys` (the defaults again when they match). */
export function setKeys(id: string, keys: string[]) {
  const unique = [...new Set(keys)];
  if (unique.join(" ") === defaultKeys(id).join(" ")) delete overrides[id];
  else overrides[id] = unique;
}

/** Back to the platform default. */
export const resetKeys = (id: string) => void delete overrides[id];

/** Whether `id` has the person's own keys. */
export const isCustom = (id: string) => id in overrides;

/** A version that changes with every override, for effects that rebuild key bindings. */
export const keymapVersion = () => JSON.stringify(overrides);

/** A key event as a spec (`Mod-Shift-a`) on this platform, for recording; undefined for a modifier alone. */
export const eventSpec = (event: KeyboardEvent) => toSpec(event, isMac);

/** A spec as the person reads it on this platform: "Ctrl Shift A", "⇧⌘A". */
export const prettyKeys = (spec: string) => pretty(spec, isMac);

const lookup = $derived.by(() => {
  const byKey = new Map<string, string[]>();
  for (const id of Object.keys(HOTKEYS))
    for (const spec of keysOf(id)) {
      const k = specKey(spec, isMac);
      byKey.set(k, [...(byKey.get(k) ?? []), id]);
    }
  return byKey;
});

/** The ids bound to the key `event`. */
export const idsFor = (event: KeyboardEvent): string[] => lookup.get(eventKey(event)) ?? [];

/** The other ids bound to `spec`. */
export const conflicts = (spec: string, id: string) =>
  (lookup.get(specKey(spec, isMac)) ?? []).filter((other) => other !== id);

/** The first key of `id` for a hint, "" without one. */
export const hintOf = (id: string) => {
  const first = keysOf(id)[0];
  return first ? prettyKeys(first) : "";
};
