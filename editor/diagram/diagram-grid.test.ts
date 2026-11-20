// The canvas's dot grid: its step at a zoom, and where its dots stand.
import assert from "node:assert/strict";
import { test } from "vitest";
import { gridBox, gridDots, gridPlace, gridStale, gridStep, gridTile } from "./diagram-grid.ts";

test("the dots stand 20 apart, five times wider while they would come nearer than 14 pixels", () => {
  assert.equal(gridStep(1), 20);
  assert.equal(gridStep(0.7), 20);
  assert.equal(gridStep(0.69), 100);
  assert.equal(gridStep(0.1), 500);
});

test("the dots cover the stage from the view's origin, every fifth one strong", () => {
  const dots = gridDots({ x: 10, y: 5, zoom: 1 }, 50, 30).filter((d) => d.x >= 0 && d.y >= 0);
  assert.deepEqual(
    dots.map((d) => [d.x, d.y]),
    [
      [10, 5],
      [10, 25],
      [30, 5],
      [30, 25],
      [50, 5],
      [50, 25],
    ],
  );
  assert.deepEqual(
    dots.map((d) => d.strong),
    [true, false, false, false, false, false],
  );
});

test("the grid drawn from the origin at one zoom, placed under a view, stands where the view's own grid does", () => {
  const views = [
    { x: 10, y: 5, zoom: 1 },
    { x: -237.4, y: 1999.6, zoom: 0.37 },
    { x: 81, y: -3, zoom: 2.5 },
  ];
  for (const view of views) {
    for (const drawn of [view.zoom, view.zoom / 1.2, view.zoom * 1.2]) {
      const place = gridPlace(view, drawn);
      const box = gridBox({ width: 400, height: 300 }, drawn);
      const shown = gridDots({ x: 0, y: 0, zoom: drawn }, box.width, box.height).map((d) => ({
        ...d,
        x: place.x + d.x * place.scale,
        y: place.y + d.y * place.scale,
      }));
      // Scaled dots land within a pixel of the view's (each rounded to a pixel where it was drawn).
      for (const dot of gridDots({ ...view, zoom: view.zoom }, 400, 300).filter(
        (d) => d.x >= 0 && d.y >= 0,
      )) {
        if (gridStep(drawn) !== gridStep(view.zoom)) continue;
        const near = shown.find(
          (d) => Math.abs(d.x - dot.x) <= 1.5 && Math.abs(d.y - dot.y) <= 1.5,
        );
        assert.ok(near, `${JSON.stringify(view)} drawn at ${drawn}: a dot at ${dot.x},${dot.y}`);
        assert.equal(near.strong, dot.strong);
      }
      // The canvas covers the stage while it is scaled within its bounds.
      if (!gridStale(view.zoom, drawn)) {
        assert.ok(place.x <= 0 && place.y <= 0);
        assert.ok(
          place.x + box.width * place.scale >= 400 && place.y + box.height * place.scale >= 300,
        );
      }
    }
  }
});

test("the grid is scaled at most down to its room and up before its dots blur", () => {
  assert.ok(!gridStale(1, 1) && !gridStale(0.85, 1) && !gridStale(1.4, 1));
  assert.ok(gridStale(0.7, 1) && gridStale(1.6, 1));
});

test("a tile of the grid holds five steps of dots each way, half a step in, the first strong", () => {
  const tile = gridTile(1, "#888");
  assert.equal(tile.size, 100);
  assert.equal(tile.offset, -10);
  const svg = decodeURIComponent(tile.url.slice('url("data:image/svg+xml,'.length, -2));
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="(\d)"/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
  ]);
  assert.equal(rects.length, 25);
  assert.match(svg, /fill="#888"/);
  assert.deepEqual(rects[0], [9, 9, 2]);
  assert.deepEqual(rects[1], [9.5, 29.5, 1]);
});
