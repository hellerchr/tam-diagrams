// Key specs in CodeMirror's spelling (`Mod-Shift-a`: Mod is Cmd on a Mac and Ctrl elsewhere): parsing, matching key
// events, recording them, and showing them as the platform does ("Ctrl Shift A", "⌘⇧A"). Pure, `mac` passed in, so
// hotkeys.svelte.ts and the tests share it. Events match by the physical key for letters, digits and punctuation, so
// Option+letter on a Mac (which types `√`, `ø`…) and Shift+/ (which types `?`) still match their keys.

type Keys = { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key: string };
/** The fields of a KeyboardEvent the specs read. */
export type KeyLike = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

const MODS = /^((?:(?:Ctrl|Alt|Shift|Mod|Meta|Cmd)-)*)(.+)$/;

function parse(spec: string, mac: boolean): Keys {
  const [, mods = "", key = spec] = MODS.exec(spec) ?? [];
  const has = (m: string) => mods.split("-").includes(m);
  return {
    ctrl: has("Ctrl") || (!mac && has("Mod")),
    alt: has("Alt"),
    shift: has("Shift"),
    meta: has("Meta") || has("Cmd") || (mac && has("Mod")),
    key,
  };
}

const canon = (k: Keys) => `${+k.ctrl}${+k.alt}${+k.shift}${+k.meta}:${k.key.toLowerCase()}`;

const CODES: Record<string, string> = {
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  Space: "Space",
};

/** The key's name in a spec: the physical key for letters, digits and punctuation, else `event.key`. */
function keyName(event: KeyLike) {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5);
  return CODES[event.code] ?? (event.key === " " ? "Space" : event.key);
}

/** One string for a spec, equal to `eventKey` of the events it matches. */
export const specKey = (spec: string, mac: boolean) => canon(parse(spec, mac));

/** One string for a key event (see `specKey`). */
export const eventKey = (e: KeyLike) =>
  canon({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, key: keyName(e) });

/** Whether a click adds to a selection: Shift, or Mod (Cmd on a Mac, where Ctrl+click is the context menu; else Ctrl). */
export const addsToSelection = (
  e: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
  mac: boolean,
) => e.shiftKey || (mac ? e.metaKey : e.ctrlKey);

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "CapsLock", "OS"]);

/** A key event as a spec (`Mod-Shift-a`), for recording; undefined for a modifier alone. */
export function eventSpec(event: KeyLike, mac: boolean): string | undefined {
  if (MODIFIER_KEYS.has(event.key)) return undefined;
  const mods = [
    (mac ? event.metaKey : event.ctrlKey) && "Mod",
    mac && event.ctrlKey && "Ctrl",
    !mac && event.metaKey && "Meta",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
  ].filter(Boolean);
  return [...mods, keyName(event)].join("-");
}

const NAMES: Record<string, [string, string]> = {
  ArrowUp: ["↑", "↑"],
  ArrowDown: ["↓", "↓"],
  ArrowLeft: ["←", "←"],
  ArrowRight: ["→", "→"],
  Enter: ["Enter", "↩"],
  Backspace: ["Backspace", "⌫"],
  Delete: ["Delete", "⌦"],
  Escape: ["Esc", "⎋"],
  Tab: ["Tab", "⇥"],
  Space: ["Space", "Space"],
};

/** A spec as the person reads it: `Mod-Shift-a` → "Ctrl Shift A", or on a Mac "⇧⌘A" (Apple's order ⌃⌥⇧⌘). */
export function prettyKeys(spec: string, mac: boolean): string {
  const k = parse(spec, mac);
  const key = NAMES[k.key]?.[+mac] ?? (k.key.length === 1 ? k.key.toUpperCase() : k.key);
  if (mac)
    return `${k.ctrl ? "⌃" : ""}${k.alt ? "⌥" : ""}${k.shift ? "⇧" : ""}${k.meta ? "⌘" : ""}${key}`;
  return [k.ctrl && "Ctrl", k.alt && "Alt", k.shift && "Shift", k.meta && "Meta", key]
    .filter(Boolean)
    .join(" ");
}
