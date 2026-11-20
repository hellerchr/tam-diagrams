// Key specs: events match their specs per platform (Mod is Cmd on a Mac), recording gives back a spec that matches,
// and hints read as the platform writes them.
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  addsToSelection,
  eventKey,
  eventSpec,
  type KeyLike,
  prettyKeys,
  specKey,
} from "./keyspec.ts";

const press = (code: string, key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  code,
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

test("Mod is Ctrl on Linux and Windows, Cmd on a Mac", () => {
  const ctrlK = press("KeyK", "k", { ctrlKey: true });
  const cmdK = press("KeyK", "k", { metaKey: true });
  assert.equal(eventKey(ctrlK), specKey("Mod-k", false));
  assert.notEqual(eventKey(cmdK), specKey("Mod-k", false));
  assert.equal(eventKey(cmdK), specKey("Mod-k", true));
  assert.equal(eventKey(ctrlK), specKey("Ctrl-k", true));
});

test("a click adds to a selection with Shift or Mod; a Mac's Ctrl+click is its context menu, not an add", () => {
  const click = (mods: Partial<KeyLike>) => press("", "", mods);
  for (const mac of [true, false])
    assert.equal(addsToSelection(click({ shiftKey: true }), mac), true);
  assert.equal(addsToSelection(click({ metaKey: true }), true), true);
  assert.equal(addsToSelection(click({ ctrlKey: true }), true), false);
  assert.equal(addsToSelection(click({ ctrlKey: true }), false), true);
  assert.equal(addsToSelection(click({}), false), false);
});

test("Option+letter on a Mac and shifted punctuation match by physical key", () => {
  assert.equal(
    eventKey(press("KeyV", "√", { metaKey: true, altKey: true })),
    specKey("Mod-Alt-v", true),
  );
  assert.equal(
    eventKey(press("Slash", "?", { ctrlKey: true, shiftKey: true })),
    specKey("Mod-Shift-/", false),
  );
  assert.equal(eventKey(press("Digit1", "¡", { altKey: true })), specKey("Alt-1", true));
  assert.equal(eventKey(press("Minus", "-", { ctrlKey: true })), specKey("Mod--", false));
  assert.equal(eventKey(press("F6", "F6", { shiftKey: true })), specKey("Shift-F6", false));
  assert.equal(
    eventKey(press("ArrowDown", "ArrowDown", { altKey: true })),
    specKey("Alt-ArrowDown", true),
  );
});

test("a recorded key is a spec that matches it again", () => {
  for (const [event, mac] of [
    [press("KeyH", "h", { ctrlKey: true, altKey: true }), false],
    [press("KeyT", "†", { ctrlKey: true }), true],
    [press("KeyB", "b", { metaKey: true, altKey: true }), true],
    [press("Backquote", "`", { ctrlKey: true }), false],
  ] as const) {
    const spec = eventSpec(event, mac)!;
    assert.equal(specKey(spec, mac), eventKey(event), spec);
  }
  assert.equal(eventSpec(press("ShiftLeft", "Shift", { shiftKey: true }), false), undefined);
  assert.equal(
    eventSpec(press("KeyA", "a", { metaKey: true, shiftKey: true }), true),
    "Mod-Shift-a",
  );
});

test("hints read as the platform writes them", () => {
  assert.equal(prettyKeys("Mod-Shift-a", false), "Ctrl Shift A");
  assert.equal(prettyKeys("Mod-Shift-a", true), "⇧⌘A");
  assert.equal(prettyKeys("Ctrl-Alt-h", true), "⌃⌥H");
  assert.equal(prettyKeys("Mod-Backspace", true), "⌘⌫");
  assert.equal(prettyKeys("Alt-ArrowUp", false), "Alt ↑");
  assert.equal(prettyKeys("Mod--", false), "Ctrl -");
});

test("Option+Space on a Mac, which types a no-break space, matches Alt-Space (code completion)", () => {
  assert.equal(eventKey(press("Space", "\u00a0", { altKey: true })), specKey("Alt-Space", true));
  assert.equal(eventKey(press("Space", " ", { ctrlKey: true })), specKey("Ctrl-Space", false));
});
