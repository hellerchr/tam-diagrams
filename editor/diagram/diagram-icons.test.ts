// Tests of the diagram editor's icons: the old markup read into icon nodes (attributes, the panel fill, the scale to
// lucide's grid, a mirrored crow's foot), and the drawings picked for UML pieces and joins as the old editor did.
import assert from "node:assert/strict";
import { test } from "vitest";
import { fromSvg, ICONS } from "./diagram-icons.ts";
import { linkIconName, pieceIconName } from "./diagram-uml-icons.ts";

test("old markup becomes icon nodes with its attributes, scaled, with a 1.5 px line and the panel's fill", () => {
  const [circle, path] = fromSvg(
    '<circle cx="7" cy="10" r="1.700" fill="var(--panel, #fff)"/><path d="M1 10h18" />',
  );
  assert.equal(circle![0], "circle");
  assert.equal(circle![1].cx, "7");
  assert.equal(circle![1].fill, "var(--d-panel, var(--c-popover))");
  assert.equal(circle![1].transform, "scale(1.2)");
  assert.equal(circle![1]["vector-effect"], "non-scaling-stroke");
  assert.deepEqual([path![0], path![1].d], ["path", "M1 10h18"]);
});

test("a crow's foot's right end is the left one mirrored", () => {
  const ends = ICONS["er-one-to-many"].map(([, attrs]) => attrs.transform);
  assert.deepEqual(ends, [
    "scale(1.2)",
    "scale(1.2)",
    "scale(1.2) translate(20 0) scale(-1 1)",
    "scale(1.2) translate(20 0) scale(-1 1)",
  ]);
});

test("pieces and joins are drawn by the words their kinds contain, the most telling first", () => {
  assert.equal(pieceIconName("abstract-class"), "uml-abstract");
  assert.equal(pieceIconName("lollipop"), "uml-step");
  assert.equal(pieceIconName("fork"), "uml-lane");
  assert.equal(pieceIconName("systemBoundary"), "uml-system");
  assert.equal(linkIconName("one-to-many"), "er-one-to-many");
  assert.equal(linkIconName("dotted"), "uml-dashed-link");
  assert.equal(linkIconName("include"), "uml-dashed");
  assert.equal(linkIconName("association"), "uml-arrow");
});
