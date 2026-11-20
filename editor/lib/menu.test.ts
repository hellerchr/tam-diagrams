import assert from "node:assert/strict";
import { test } from "vitest";
import { besideRow, hasTicks, moved, placed, refusal, tidy, typedTo } from "./menu.ts";
import type { MenuEntry, MenuItem } from "./overlays.svelte.ts";

const row = (label: string, more: object = {}): MenuItem => ({ label, action: () => {}, ...more });

test("tidy drops empty rows and lines at an end or after another", () => {
  const items = tidy([
    "separator",
    row("A"),
    false,
    "separator",
    null,
    "separator",
    row("B"),
    "separator",
    undefined,
  ]);
  assert.deepEqual(
    items.map((i) => (typeof i === "object" && "label" in i ? i.label : i)),
    ["A", "separator", "B"],
  );
  assert.deepEqual(tidy(["separator", false]), []);
});

test("a submenu whose rows are all off is off with their reason", () => {
  assert.equal(refusal({ label: "A", action: () => {} }), undefined);
  assert.equal(
    refusal({ label: "A", off: "Select an element", action: () => {} }),
    "Select an element",
  );
  const sub = (items: MenuEntry[]) => refusal({ label: "S", items });
  assert.equal(sub([row("x", { off: true }), row("y", { off: "Select two" })]), "Select two");
  assert.equal(sub([row("x", { off: true }), row("y")]), undefined);
  assert.equal(sub([row("x", { off: true })]), true);
  // An empty submenu has nothing to refuse: it is left as it is.
  assert.equal(sub([]), undefined);
  assert.equal(refusal({ label: "S", off: "Off itself", items: [row("y")] }), "Off itself");
});

test("ticks: a menu with a choice in it, on or off", () => {
  assert.equal(hasTicks([row("a"), row("b", { checked: false })]), true);
  assert.equal(hasTicks([row("a"), "separator"]), false);
});

test("the keys move over the rows that are on, wrapping", () => {
  const items: MenuItem[] = [
    { heading: "H" },
    row("a"),
    "separator",
    row("b", { off: "no" }),
    row("c"),
  ];
  assert.equal(moved(items, -1, "ArrowDown"), 1);
  assert.equal(moved(items, 1, "ArrowDown"), 4);
  assert.equal(moved(items, 4, "ArrowDown"), 1);
  assert.equal(moved(items, -1, "ArrowUp"), 4);
  assert.equal(moved(items, 1, "ArrowUp"), 4);
  assert.equal(moved(items, 4, "Home"), 1);
  assert.equal(moved(items, 1, "End"), 4);
  assert.equal(moved(items, 1, "x"), undefined);
  assert.equal(moved([row("a", { off: true })], -1, "ArrowDown"), undefined);
});

test("a letter goes to the next row it starts, past those that are off", () => {
  const items: MenuItem[] = [
    row("Save"),
    row("Save as…", { off: true }),
    row("Select all"),
    row("Open"),
  ];
  assert.equal(typedTo(items, -1, "s"), 0);
  assert.equal(typedTo(items, 0, "S"), 2);
  assert.equal(typedTo(items, 2, "s"), 0);
  assert.equal(typedTo(items, 0, "z"), undefined);
});

test("a menu stays inside the window, below its point or above it", () => {
  const room = { width: 1000, height: 800 };
  const size = { width: 200, height: 300 };
  assert.deepEqual(placed({ x: 10, y: 40 }, size, room), { left: 10, top: 40 });
  assert.deepEqual(placed({ x: 990, y: 40, alignRight: true }, size, room), { left: 790, top: 40 });
  assert.deepEqual(placed({ x: 900, y: 40 }, size, room), { left: 792, top: 40 });
  // No room below: it goes above the point.
  assert.deepEqual(placed({ x: 10, y: 700 }, size, room), { left: 10, top: 392 });
  // Above a control in the status bar: it ends at the point.
  assert.deepEqual(placed({ x: 10, y: 770, above: true }, size, room), { left: 10, top: 470 });
});

test("a submenu stands beside its row, on the left where the right has no room", () => {
  const room = { width: 1000, height: 800 };
  const size = { width: 200, height: 300 };
  const rect = { left: 100, right: 300, top: 50, bottom: 80 };
  assert.deepEqual(besideRow(rect, size, room), { left: 304, top: 46 });
  assert.deepEqual(besideRow({ ...rect, left: 700, right: 900 }, size, room), {
    left: 496,
    top: 46,
  });
  assert.deepEqual(besideRow({ ...rect, top: 700 }, size, room), { left: 304, top: 496 });
});
