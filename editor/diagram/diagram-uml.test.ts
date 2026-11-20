// The UML canvas's edits on laid-out pictures: places after a move start from the automatic layout, a part dropped on
// a group moves in, a dragged participant or message changes its order, a piece added at a part is joined to it.
import assert from "node:assert/strict";
import { test } from "vitest";
import { arialMeasure, parseUml } from "../../src/index.ts";
import { readPlaces } from "../../src/uml-places.ts";
import { uml } from "./diagram-uml.ts";

const drawn = async (source: string) =>
  uml.modelOf(source, await parseUml(source).layout(arialMeasure), "Arial")!;
const boxOf = (m: Awaited<ReturnType<typeof drawn>>, id: string) =>
  m.hits.elements.find((e) => e.id === id)!.box;

const CLASSES = `classDiagram
namespace Shop {
  class Order
  class Item
}
class Customer
Customer --> Order
Order *-- Item
`;

test("the first move places every part where the picture shows it, and the moved one by the step", async () => {
  const m = await drawn(CLASSES);
  assert.deepEqual(
    m.hits.elements.map((e) => [e.id, e.parent, e.holder]),
    [
      ["ns:Shop", null, true],
      ["Order", "ns:Shop", false],
      ["Item", "ns:Shop", false],
      ["Customer", null, false],
    ],
  );
  const places = readPlaces(uml.moved(m, ["Customer"], { x: 30, y: 10.4 }));
  const at = (id: string) => ({ x: Math.round(boxOf(m, id).x), y: Math.round(boxOf(m, id).y) });
  assert.deepEqual(places.get("Customer"), { x: at("Customer").x + 30, y: at("Customer").y + 10 });
  assert.deepEqual(places.get("Order"), at("Order"));
  assert.deepEqual(places.get("Item"), at("Item"));
  // A moved package takes what it holds.
  assert.deepEqual(readPlaces(uml.moved(m, ["ns:Shop"], { x: 5, y: 0 })).get("Item"), {
    ...at("Item"),
    x: at("Item").x + 5,
  });
});

test("a part dropped on a group moves in, and out again onto the empty canvas", async () => {
  const m = await drawn(CLASSES);
  const into = {
    x: boxOf(m, "Order").x - boxOf(m, "Customer").x,
    y: boxOf(m, "Order").y - boxOf(m, "Customer").y,
  };
  assert.equal(uml.dropHolder(m, ["Customer"], into), "ns:Shop");
  assert.match(
    uml.moved(m, ["Customer"], into, "ns:Shop"),
    /namespace Shop \{\n {2}class Order\n {2}class Item\n {2}class Customer\n\}/,
  );
  assert.equal(uml.dropHolder(m, ["Order"], { x: 0, y: 0 }), undefined);
  assert.equal(uml.dropHolder(m, ["Order"], { x: 400, y: 0 }), null);
});

const SEQUENCE = `sequenceDiagram
participant A
participant B
participant C
A->>B: one
B->>C: two
C-->>A: three
`;

test("a dragged participant or message of a sequence diagram changes its order", async () => {
  const m = await drawn(SEQUENCE);
  const column = boxOf(m, "head:B").x - boxOf(m, "head:A").x;
  assert.match(
    uml.moved(m, ["head:A"], { x: column * 2.2, y: 30 }),
    /participant B\nparticipant C\nparticipant A\n/,
  );
  assert.match(
    uml.moved(m, ["head:C"], { x: -column * 1.2, y: 0 }),
    /participant A\nparticipant C\nparticipant B\n/,
  );
  assert.equal(uml.moved(m, ["head:B"], { x: column * 0.3, y: 0 }), m.source);
  const moved = uml.messageMoved(m, "m1", 50);
  assert.match(moved.source, /B->>C: two\nA->>B: one\n/);
  assert.equal(moved.edge, "m2");
});

test("a piece added at a part is joined to it; one dropped on nothing stands alone", async () => {
  const m = await drawn("flowchart TD\na[Begin] --> b[Done]\n");
  const joined = uml.added(m, "step", { target: "b" });
  assert.match(joined.source, new RegExp(`b --> ${joined.id}\\n`));
  const alone = uml.added(m, "step", { target: null });
  assert.doesNotMatch(alone.source, /--> step/);
  assert.equal(uml.pieceTarget(m, "step", { x: -500, y: -500 }), null);
  const middle = { x: boxOf(m, "b").x + 5, y: boxOf(m, "b").y + 5 };
  assert.equal(uml.pieceTarget(m, "step", middle), "b");
});
