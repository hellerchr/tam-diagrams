// Exports of a diagram (diagram-export.ts) and the files they write beside it (diagram-files.ts).
import { test } from "vitest";
import assert from "node:assert/strict";
import { arialMeasure } from "../../src/arial-measure.ts";
import { parseTam } from "../../src/tam.ts";
import { layoutPlaced } from "../../src/tam-layout.ts";
import {
  exportedPicture,
  lightColors,
  withBackground,
  withMargin,
  withoutHalos,
} from "./diagram-export.ts";
import { besidePath, convertedPaths } from "./diagram-files.ts";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 10 100 50" width="100" height="50"><style>t{}</style><path/></svg>';

test("room around a picture grows its area and its size", () => {
  assert.match(withMargin(SVG, 16), /viewBox="-16 -6 132 82" width="132" height="82"/);
  assert.equal(withMargin(SVG, 0), SVG);
});

test("a backdrop goes after the style, below every shape", () => {
  assert.match(
    withBackground(SVG, "#ffffff"),
    /<\/style><rect x="0" y="10" width="100" height="50" fill="#ffffff"\/><path\/>/,
  );
});

test("on nothing, labels lose their halo in the page color", () => {
  const label =
    '<text stroke="#ffffff" stroke-width="4" stroke-linejoin="round" paint-order="stroke">a</text>';
  assert.equal(withoutHalos(label, "#ffffff"), "<text>a</text>");
});

test("a picture is exported in light colors on white unless the theme's are asked for", () => {
  const scene = layoutPlaced(parseTam("agent a[Shop] @0,0 120x60\n"), arialMeasure);
  const dark = { ...lightColors("sans-serif"), background: "#101010", text: "#eeeeee", dark: true };
  const light = exportedPicture(scene, "white", dark, "shop");
  assert.match(light.svg, /fill="#ffffff"/);
  assert.doesNotMatch(light.svg, /#101010/);
  assert.equal(light.width, scene.bounds.width + 32);
  assert.match(exportedPicture(scene, "theme", dark, "shop").svg, /fill="#101010"/);
});

test("exports and converted sources are named after the file beside them", () => {
  assert.equal(besidePath("docs/order.tam", "svg"), "docs/order.svg");
  assert.equal(besidePath("flow.mmd", "drawio"), "flow.drawio");
  assert.deepEqual(convertedPaths("a/b.drawio.svg", "tam").slice(0, 2), ["a/b.tam", "a/b-2.tam"]);
  assert.equal(convertedPaths("x.xml", "mmd")[0], "x.mmd");
});
