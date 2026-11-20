// The picture viewer's pan and zoom math, through its exports.
import assert from "node:assert/strict";
import { test } from "vitest";
import { center, fit, MAX_ZOOM, MIN_ZOOM, parsePercent, wheelFactor, zoomAt } from "./zoom.ts";

test("fit centres the whole picture at the largest scale the area allows", () => {
  assert.deepEqual(fit({ width: 200, height: 100 }, { width: 1000, height: 1000 }, 100), {
    x: 100,
    y: 300,
    zoom: 4,
  });
  assert.deepEqual(fit({ width: 100, height: 400 }, { width: 400, height: 200 }), {
    x: 175,
    y: 0,
    zoom: 0.5,
  });
});

test("fit and center stay within the zoom limits", () => {
  assert.equal(fit({ width: 1, height: 1 }, { width: 10_000, height: 10_000 }).zoom, MAX_ZOOM);
  assert.equal(center({ width: 10, height: 10 }, { width: 10, height: 10 }, 0).zoom, MIN_ZOOM);
});

test("zoomAt keeps the point under the cursor in place", () => {
  const view = { x: 10, y: 20, zoom: 1 };
  const next = zoomAt(view, 3, 110, 70);
  // The picture point (100, 50) sat at (110, 70) and still does.
  assert.deepEqual(next, { x: -190, y: -80, zoom: 3 });
  assert.equal(next.x + 100 * next.zoom, 110);
  assert.equal(next.y + 50 * next.zoom, 70);
});

test("zoomAt clamps and then keeps the point", () => {
  const next = zoomAt({ x: 0, y: 0, zoom: 1 }, 1000, 50, 50);
  assert.equal(next.zoom, MAX_ZOOM);
  assert.equal(next.x + (50 / 1) * next.zoom, 50);
});

test("wheelFactor zooms in on a wheel up, finer for a mouse than a pinch, a line as 16 pixels", () => {
  const wheel = (deltaY: number, o: { ctrlKey?: boolean; deltaMode?: number } = {}) =>
    wheelFactor({ deltaY, deltaMode: o.deltaMode ?? 0, ctrlKey: o.ctrlKey ?? false });
  assert.ok(wheel(-100) > 1);
  assert.ok(wheel(100) < 1);
  assert.ok(wheel(-10, { ctrlKey: true }) > wheel(-10));
  assert.equal(wheel(3, { deltaMode: 1 }), wheel(48));
});

test("parsePercent reads a typed zoom", () => {
  assert.equal(parsePercent("150"), 1.5);
  assert.equal(parsePercent(" 80 % "), 0.8);
  assert.equal(parsePercent("100000"), MAX_ZOOM);
  assert.equal(parsePercent("abc"), undefined);
  assert.equal(parsePercent("0"), undefined);
});
