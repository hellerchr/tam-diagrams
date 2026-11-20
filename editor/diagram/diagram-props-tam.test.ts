// What the Properties offer a block diagram's elements and connections beyond kinds and words (diagram-props.test.ts):
// the copy of an element shown as several, the numbers of its box, its id, interfaces at the design level only, the
// kinds of connection a design diagram keeps, and laying out a selection.
import assert from "node:assert/strict";
import { test } from "vitest";
import { parseTam } from "../../src/index.ts";
import { canLayOut, laidOutWithin, layoutScope } from "./diagram-props-layout.ts";
import {
  allowsInterface,
  boxText,
  copyPlaced,
  copySide,
  designLevel,
  idRenamed,
  interfaceAdded,
  typedNumber,
  wireKinds,
  wireWith,
} from "./diagram-props-tam.ts";

const box = (x: number, y: number) => ({ x, y, width: 80, height: 40 });

test("the copy of an element shown as several stands beside or below it, or elsewhere", () => {
  assert.equal(
    copySide(
      new Map([
        ["a", box(0, 0)],
        ["a#2", box(120, 0)],
      ]),
      "a",
    ),
    "beside",
  );
  assert.equal(
    copySide(
      new Map([
        ["a", box(0, 0)],
        ["a#2", box(0, 70)],
      ]),
      "a",
    ),
    "below",
  );
  assert.equal(
    copySide(
      new Map([
        ["a", box(0, 0)],
        ["a#2", box(50, 70)],
      ]),
      "a",
    ),
    undefined,
  );
  assert.equal(copySide(new Map([["a", box(0, 0)]]), "a"), undefined);
});

test("the copy stands across the direction without a place of its own, the other side with one", () => {
  const source = "agent a[A] @0,0 ...\n";
  const beside = copyPlaced(source, "a", box(0, 0), "beside");
  assert.equal(parseTam(beside).nodes.get("a#2")?.at, undefined);
  const below = copyPlaced(source, "a", box(0, 0), "below");
  assert.deepEqual(parseTam(below).nodes.get("a#2")?.at, { x: 0, y: 70 });
  // Back beside, the place goes again.
  assert.equal(
    parseTam(copyPlaced(below, "a", box(0, 0), "beside")).nodes.get("a#2")?.at,
    undefined,
  );
});

test("a box shows to a tenth; only a number typed changes it", () => {
  assert.equal(boxText({ x: 10.04, y: 2.25, width: 80, height: 40 }, "y"), "2.3");
  assert.equal(boxText(undefined, "x"), "");
  assert.equal(typedNumber(" 12.5 "), 12.5);
  assert.equal(typedNumber(""), undefined);
  assert.equal(typedNumber("1e"), undefined);
});

test("an id changes everywhere it is named, and a taken one is refused", () => {
  const source = "agent a[A]\nagent b[B]\na -- calls --> b\n";
  assert.equal(idRenamed(source, "a", " api "), "agent api[A]\nagent b[B]\napi -- calls --> b\n");
  assert.throws(() => idRenamed(source, "a", "b"), /`b` is taken, or is no id/);
});

test("interfaces are offered at the design level, at elements that take one", () => {
  assert.equal(designLevel(parseTam("agent a\n")), false);
  assert.equal(designLevel(parseTam("level design\nagent a\n")), true);
  assert.equal(designLevel(parseTam("component c\n")), true);
  assert.equal(allowsInterface("component c\nstorage s\n", "c"), true);
  assert.equal(
    interfaceAdded("component c\n", "c", "requires", "IOrders"),
    "component c\nc requires IOrders\n",
  );
});

test("a design kind of connection stays on show for one of it, and is offered to no other", () => {
  const plain = "agent a\nagent b\na -- calls --> b\n";
  const id = (s: string) => parseTam(s).edges[0]!.id;
  const values = (s: string) => wireKinds(s, id(s)).map((w) => w.value);
  assert.ok(!values(plain).includes("dependency:use"));
  assert.ok(values(plain).includes("dependency:create"));
  const used = wireWith(plain, id(plain), { word: "dependency", label: "use" });
  assert.ok(values(used).includes("dependency:use"));
  assert.ok(!values(used).includes("dependency:import"));
});

test("one element that holds others lays out its parts, several lay out among themselves", async () => {
  const source =
    "agent a[A] @0,0\nagent box[Box] @200,0 300x200 {\n  agent b[B] @210,40\n  agent c[C] @400,40\n}\nb -- calls --> c\n";
  const diagram = parseTam(source);
  assert.deepEqual(layoutScope(diagram, ["box"]), { scope: ["b", "c"], inside: "box" });
  assert.equal(canLayOut(diagram, ["a"]), false);
  assert.equal(canLayOut(diagram, ["a", "b"]), true);
  const next = parseTam(await laidOutWithin(source, ["box"], "Arial"));
  // The container fits its parts again; what is outside stays.
  assert.equal(next.nodes.get("box")?.at, undefined);
  assert.deepEqual(next.nodes.get("a")?.at, { x: 0, y: 0 });
  assert.ok(next.nodes.get("b")?.at && next.nodes.get("c")?.at);
});
