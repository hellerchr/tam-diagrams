import assert from "node:assert/strict";
import { test } from "vitest";
import { type HintState, hintText, modeTip, selectionText, typedZoom } from "./diagram-status.ts";

const state = (more: Partial<HintState> = {}): HintState => ({
  problem: false,
  picture: true,
  structural: false,
  editable: true,
  plural: "Block diagrams",
  tool: "select",
  elements: 0,
  wires: 0,
  ...more,
});

test("the hint follows the first state that applies", () => {
  assert.equal(
    hintText(state({ problem: true })),
    "The source has an error: the diagram shows as it last was",
  );
  assert.equal(
    hintText(state({ problem: true, picture: false, structural: true })),
    "The source has an error: the diagram shows once it is mended",
  );
  assert.match(hintText(state({ structural: true, elements: 1 })), /^Click a shape to add it here/);
  assert.match(hintText(state({ structural: true, elements: 2 })), /the layout is automatic$/);
  assert.match(
    hintText(state({ editable: false, plural: "Class diagrams" })),
    /^Class diagrams are edited as text/,
  );
  assert.match(hintText(state({ doing: "resize", elements: 1 })), /^Edges line up/);
  // A gesture without a hint of its own leaves the tool's.
  assert.match(hintText(state({ doing: "pan" })), /^Drag a shape onto the canvas/);
});

test("the select tool's hint says what the selection can do", () => {
  assert.match(hintText(state({ elements: 1 })), /^Drag to move · drag a dot/);
  assert.match(hintText(state({ wires: 1 })), /^Drag an end to another element/);
  assert.match(hintText(state({ elements: 1, wires: 1 })), /^Drag to move them together/);
});

test("the other tools' hints", () => {
  assert.equal(hintText(state({ tool: "pan" })), "Drag to move the view · Ctrl + wheel zooms");
  assert.equal(hintText(state({ tool: "connect" })), "Drag from one element to another");
  assert.match(hintText(state({ tool: "agent" })), /Shift-click to place several$/);
  assert.match(hintText(state({ tool: "agent", sticky: true })), /Escape to stop$/);
});

test("what is selected, counted", () => {
  assert.equal(selectionText(0, 0), "");
  assert.equal(selectionText(1, 0), "1 element");
  assert.equal(selectionText(2, 1), "2 elements, 1 connection");
  assert.equal(selectionText(0, 3), "3 connections");
});

test("the layout mode's tooltip names the notation's places", () => {
  assert.match(modeTip(true, false), /\(@x,y\)/);
  assert.match(modeTip(true, true), /\(%% @id x,y\)/);
  assert.match(modeTip(false, true), /^No element is placed/);
});

test("a zoom typed in percent", () => {
  assert.equal(typedZoom("150"), 1.5);
  assert.equal(typedZoom(" 50% "), 0.5);
  assert.equal(typedZoom("12,5"), 0.125);
  assert.equal(typedZoom("0"), undefined);
  assert.equal(typedZoom("abc"), undefined);
});
