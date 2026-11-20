// A draft of a placed layout (a drag's preview, and what pin reads back): the elements where the full layout puts them.
import { test } from "vitest";
import assert from "node:assert/strict";
import { arialMeasure } from "../../src/arial-measure.ts";
import { EXAMPLES } from "../../src/examples.ts";
import { parseTam } from "../../src/tam.ts";
import { layoutDiagram, layoutPlaced } from "../../src/tam-layout.ts";
import { elementBoxes, pin } from "../../src/tam-pin.ts";

// Small ones with containers, channels and labels, which the wires go round and between.
const NAMES = new Set([
  "Containers as connection ends",
  "Hub with many labelled channels",
  "Parallel channels and chains",
]);

test("a draft places the elements of examples where the full layout does, and draws every wire", async () => {
  for (const [name, source] of EXAMPLES.tam.filter(([name]) => NAMES.has(name))) {
    const placed = parseTam(
      pin(source, await layoutDiagram(parseTam(source), arialMeasure), arialMeasure),
    );
    const full = layoutPlaced(placed, arialMeasure);
    const draft = layoutPlaced(placed, arialMeasure, true);
    assert.deepEqual(elementBoxes(placed, draft), elementBoxes(placed, full), name);
    assert.deepEqual(
      draft.wires.map((wire) => wire.edge),
      full.wires.map((wire) => wire.edge),
      name,
    );
  }
});
