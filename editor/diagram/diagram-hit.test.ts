// The diagram editor's hits: wires before shapes, the innermost element, where a drop lands, and a source's change.
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  holderAt,
  type Hits,
  nameBox,
  overlap,
  type Part,
  partAt,
  pressed,
  textChange,
} from "./diagram-hit.ts";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const hits: Hits = {
  elements: [
    { id: "shop", box: box(0, 0, 300, 200), depth: 0, holder: true },
    { id: "api", box: box(20, 40, 100, 40), depth: 1, holder: false, parent: "shop" },
    { id: "erp", box: box(400, 40, 100, 40), depth: 0, holder: false },
  ],
  wires: [
    {
      id: "e1",
      points: [
        { x: 120, y: 60 },
        { x: 400, y: 60 },
      ],
    },
  ],
};

test("an element that holds nothing is hit before a wire over it, a label like its wire", () => {
  assert.deepEqual(partAt(hits, { x: 118, y: 61 }, 4), { type: "element", id: "api" });
  const labelled: Hits = {
    ...hits,
    wires: [
      {
        ...hits.wires[0]!,
        label: { box: box(200, 70, 40, 12), middle: { x: 260, y: 60 }, key: "e1" },
      },
    ],
  };
  assert.deepEqual(partAt(labelled, { x: 210, y: 76 }, 4), { type: "wire", id: "e1" });
});

test("a wire in reach is hit before the elements that hold others, else the innermost element", () => {
  assert.deepEqual(partAt(hits, { x: 200, y: 63 }, 4), { type: "wire", id: "e1" });
  assert.deepEqual(partAt(hits, { x: 200, y: 70 }, 4), { type: "element", id: "shop" });
  assert.deepEqual(partAt(hits, { x: 50, y: 50 }, 4), { type: "element", id: "api" });
  assert.equal(partAt(hits, { x: 350, y: 300 }, 4), undefined);
});

test("a drop lands in the innermost holder that is not moving, else in the diagram", () => {
  assert.equal(holderAt(hits, { x: 50, y: 50 }, new Set(["api"])), "shop");
  assert.equal(holderAt(hits, { x: 50, y: 50 }, new Set(["shop"])), null);
  assert.equal(holderAt(hits, { x: 450, y: 60 }, new Set()), null);
});

test("a new source is one replacement of what changed", () => {
  assert.deepEqual(textChange("agent a @10,20\n", "agent a @30,20\n"), {
    from: 9,
    to: 10,
    insert: "3",
  });
  assert.deepEqual(textChange("ab", "abab"), { from: 2, to: 2, insert: "ab" });
  assert.deepEqual(textChange("abc", "ac"), { from: 1, to: 2, insert: "" });
  assert.deepEqual(textChange("same", "same"), { from: 4, to: 4, insert: "" });
});

test("a press selects one part, adding toggles one in or out, a press on what is selected keeps it to move", () => {
  const web: Part = { type: "element", id: "web" };
  const api: Part = { type: "element", id: "api" };
  const wire: Part = { type: "wire", id: "web" }; // the same id as an element, another part
  assert.deepEqual(pressed([], web, false), [web]);
  assert.deepEqual(pressed([web], api, true), [web, api]);
  assert.deepEqual(pressed([web, api], web, true), [api]);
  assert.deepEqual(pressed([web, api], wire, true), [web, api, wire]);
  assert.deepEqual(pressed([web, wire], web, true), [wire]);
  assert.deepEqual(pressed([web, api], api, false), [web, api]);
  assert.deepEqual(pressed([web, api], wire, false), [wire]);
  assert.deepEqual(pressed([web, api], undefined, true), [web, api]);
  assert.deepEqual(pressed([web, api], undefined, false), []);
});

test("overlap is the shared box, none for boxes that only touch", () => {
  assert.deepEqual(overlap(box(0, 0, 100, 40), box(80, 20, 100, 40)), box(80, 20, 20, 20));
  assert.equal(overlap(box(0, 0, 100, 40), box(100, 0, 100, 40)), undefined);
});

test("a name is typed on its element (a container's title strip), a label on its label or at the pointer", () => {
  assert.deepEqual(nameBox(hits, { type: "element", id: "shop" }), {
    box: box(0, 0, 300, 34),
    size: 14,
    weight: 600,
  });
  assert.deepEqual(nameBox(hits, { type: "element", id: "api" }), {
    box: box(20, 40, 100, 40),
    size: 14,
    weight: 400,
  });
  assert.deepEqual(nameBox(hits, { type: "wire", id: "e1" }, { x: 200, y: 60 }), {
    box: box(140, 50, 120, 20),
    size: 12,
    weight: 400,
  });
  assert.equal(nameBox(hits, { type: "element", id: "gone" }), undefined);
});
