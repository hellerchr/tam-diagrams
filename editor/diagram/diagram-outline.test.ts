// Tests of the diagram outline's tree: nesting in the source's order, what is left out, the rows as elements open
// and close and a search finds, what opens around a selection, and how far the view pans to show an element.
import assert from "node:assert/strict";
import { test } from "vitest";
import { lookOf } from "./diagram-outline-look.ts";
import {
  around,
  panTo,
  parentsIn,
  partTree,
  type TamNode,
  tamTree,
  treeRows,
  within,
} from "./diagram-outline.ts";

const nodes = new Map<string, TamNode>([
  ["shop", { kind: "agent", label: "Shop", children: ["api", "cart"] }],
  ["api", { kind: "agent", label: "API", children: [] }],
  ["cart", { kind: "storage", label: "", children: [] }],
  ["erp", { kind: "agent", label: "ERP", children: [] }],
  ["erp#2", { kind: "agent", label: "ERP", children: [], origin: "erp" }],
  ["top#row", { kind: "group", label: "", children: ["erp"] }],
]);
const ids = (items: { id: string; children: unknown[] }[]): unknown[] =>
  items.map((item) => (item.children.length ? [item.id, ids(item.children as never)] : item.id));

test("a block diagram's tree nests in the source's order, passes rows through and leaves out copies and undrawn", () => {
  const tree = tamTree(nodes, ["shop", "top#row", "erp#2"], (id) => id !== "cart");
  assert.deepEqual(ids(tree), [["shop", ["api"]], "erp"]);
});

test("a UML diagram's parts nest under their groups; a part whose group is not drawn stands at the top", () => {
  const parts = [
    { id: "sys", kind: "boundary", label: "System", parent: null },
    { id: "a", kind: "usecase", label: "A", parent: "sys" },
    { id: "b", kind: "usecase", label: "B", parent: "gone" },
    { id: "u", kind: "actor", label: "User", parent: null },
  ];
  assert.deepEqual(ids(partTree(parts, (id) => id !== "gone")), [["sys", ["a"]], "b", "u"]);
});

const tree = tamTree(nodes, ["shop", "erp"], () => true);
const texts = (item: { label: string; id: string }) => [item.label, item.id];

test("a closed element hides what it holds and counts it; a search finds inside closed ones and keeps their holders", () => {
  const closed = treeRows(tree, new Set(["shop"]), "", texts);
  assert.deepEqual(
    closed.map((row) => [row.item.id, row.depth, row.folded, row.count]),
    [
      ["shop", 0, true, 2],
      ["erp", 0, false, 0],
    ],
  );
  const found = treeRows(tree, new Set(["shop"]), " CART ", texts);
  assert.deepEqual(
    found.map((row) => [row.item.id, row.depth, row.folded]),
    [
      ["shop", 0, false],
      ["cart", 1, false],
    ],
  );
  assert.deepEqual(treeRows(tree, new Set(), "nothing", texts), []);
});

test("collapse all closes what holds others; a selection opens what is around it; within is the element and its parts", () => {
  assert.deepEqual(parentsIn(tree), ["shop"]);
  assert.deepEqual(around(tree, ["cart"]), ["shop"]);
  assert.deepEqual(around(tree, ["shop", "erp"]), []);
  assert.deepEqual(within(tree[0]!), ["shop", "api", "cart"]);
});

test("the view pans by the least that brings a box into the frame, and not at all when it is in", () => {
  const frame = { x: 24, y: 24, width: 500, height: 300 };
  assert.equal(panTo({ x: 100, y: 100, width: 50, height: 50 }, frame), undefined);
  assert.deepEqual(panTo({ x: -40, y: 100, width: 50, height: 50 }, frame), { x: 64, y: 0 });
  assert.deepEqual(panTo({ x: 100, y: 300, width: 50, height: 50 }, frame), { x: 0, y: -26 });
  assert.equal(panTo({ x: 0, y: 0, width: 900, height: 900 }, frame), undefined);
});

test("a row shows a block element by its kind and a UML part as its piece; a made-up id is no name", () => {
  const item = (id: string, kind: string, label = "") => ({ id, kind, label, children: [] });
  assert.deepEqual(lookOf(item("cart", "storage")), {
    icon: "storage",
    name: "cart",
    kind: "Storage",
    tip: "Storage cart",
  });
  assert.equal(lookOf(item("n1", "note", "A<br>note")).icon, "uml-note");
  const structure = { pieces: [{ kind: "initial", name: "Initial", about: "" }] } as never;
  assert.deepEqual(lookOf(item("root#initial", "initial"), structure), {
    icon: "uml-start",
    name: "Initial",
    kind: "Initial",
    tip: "Initial",
  });
  assert.equal(lookOf(item("Draft", "state", "Draft"), structure).tip, "State Draft");
});
