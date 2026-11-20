// Which side of its line a connection's label stands on, and where it stands on the other.
import assert from "node:assert/strict";
import { test } from "vitest";
import { labelSide } from "./diagram-labels.ts";

const label = (x: number, y: number) => ({
  box: { x: x - 30, y: y - 8, width: 60, height: 16 },
  middle: { x: 100, y: 50 },
  key: "e1",
});

test("a label over its line stands under it as in a mirror, one beside an upright line on its other side", () => {
  assert.deepEqual(labelSide(label(104, 25)), { side: "above", flipped: { x: 4, y: 25 } });
  assert.deepEqual(labelSide(label(100, 80)), { side: "below", flipped: { x: 0, y: -30 } });
  assert.deepEqual(labelSide(label(160, 52)), { side: "right", flipped: { x: -60, y: 2 } });
  assert.deepEqual(labelSide(label(40, 50)), { side: "left", flipped: { x: 60, y: 0 } });
});
