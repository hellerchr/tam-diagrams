// The ports of a placed layout: named in a connection's ends, kept by the edits, taken by the wires; preferred by those
// that name none.
import { test } from "vitest";
import assert from "node:assert/strict";
import { arialMeasure } from "../../src/arial-measure.ts";
import type { Point, Scene } from "../../src/scene.ts";
import { parseTam } from "../../src/tam.ts";
import { connect, setConnection } from "../../src/tam-edit.ts";
import { layoutPlaced } from "../../src/tam-layout.ts";
import {
  type Port,
  portCount,
  portPoint,
  portsAlong,
  portText,
  sidePorts,
  splitEnd,
} from "../../src/tam-ports.ts";

/** Where a connection's wire starts and ends: a channel's runs to its circle and on from it. */
const ends = (scene: Scene, edge: string): [Point, Point] => {
  const wires = scene.wires.filter((wire) => wire.edge === edge);
  return [wires[0]!.points[0]!, wires.at(-1)!.points.at(-1)!];
};
const boxOf = (scene: Scene, id: string) => scene.shapes.find((shape) => shape.id === id)!.box;
const near = (p: Point, q: Point) => Math.abs(p.x - q.x) < 1.5 && Math.abs(p.y - q.y) < 1.5;

test("an end names its port behind its id: a side's letter and a percent along it, the middle unsaid", () => {
  assert.deepEqual(splitEnd("api:L25"), { id: "api", port: { side: "left", at: 25 } });
  assert.deepEqual(splitEnd("api:R"), { id: "api", port: { side: "right", at: 50 } });
  assert.deepEqual(splitEnd("api:T7"), { id: "api", port: { side: "top", at: 7 } });
  assert.deepEqual(splitEnd("api"), { id: "api" });
  // One digit 1 to 3 is the quarter it was when every side had three ports.
  assert.deepEqual(splitEnd("api:L1"), { id: "api", port: { side: "left", at: 25 } });
  assert.deepEqual(splitEnd("api:B3"), { id: "api", port: { side: "bottom", at: 75 } });
  assert.equal(portText({ side: "bottom", at: 75 }), ":B75");
  assert.equal(portText({ side: "top", at: 50 }), ":T");
  const edge = parseTam("agent a\nagent b\na:R -- calls --> b:L17").edges[0]!;
  assert.deepEqual(
    [edge.sourcePort, edge.targetPort],
    [
      { side: "right", at: 50 },
      { side: "left", at: 17 },
    ],
  );
});

test("a side has more ports the longer it is: about one every 24 pixels, the middle and the quarters among them", () => {
  assert.deepEqual([40, 96, 140, 200, 300, 400].map(portCount), [3, 3, 3, 7, 11, 15]);
  // The middle and the quarters first, as wires take them; then the others outward from the middle.
  const box = { x: 0, y: 0, width: 200, height: 40 };
  assert.deepEqual(
    sidePorts(box, "top").map((port) => port.at),
    [50, 25, 75, 38, 63, 13, 88],
  );
  assert.deepEqual(portsAlong(box, "left"), [20, 10, 30]);
});

test("the edits keep a port with its element: turned round, at another element it goes, and it may be set", () => {
  const source = "agent a\nagent b\nagent c\na:R -- calls --> b:L25";
  const last = (text: string) => text.split("\n").at(-1);
  assert.equal(last(setConnection(source, "e1", { reverse: true })), "b:L25 -- calls --> a:R");
  assert.equal(last(setConnection(source, "e1", { to: "c" })), "a:R -- calls --> c");
  assert.equal(
    last(setConnection(source, "e1", { toPort: null, fromPort: { side: "top", at: 75 } })),
    "a:T75 -- calls --> b",
  );
  // An access is written from the agent: the storage's port goes with the storage.
  const drawn = connect("agent a\nstorage db", "db", "a", { fromPort: { side: "top", at: 25 } });
  assert.equal(last(drawn), "a -- reads --> db:T25");
});

test("a wire ends at the ports its connection names, around what stands between them too", () => {
  const port = (side: Port["side"], at: Port["at"]): Port => ({ side, at });
  const cases: [string, Port, Port][] = [
    ["agent a @0,0\nagent b @300,0\na:R75 --- b:L25", port("right", 75), port("left", 25)],
    ["agent a @0,0\nagent b @300,200\na:B1 --- b:T3", port("bottom", 25), port("top", 75)],
    [
      "agent a @0,0\nagent x @150,0\nagent b @300,0\na:R --- b:L75",
      port("right", 50),
      port("left", 75),
    ],
    ["agent a @0,0\nagent b @300,0\na:T25 --- b:T75", port("top", 25), port("top", 75)],
    // A long side's port: the ninth of eleven along a 300 high container's right side.
    [
      "group a @0,0 200x300 {\n  agent i @40,40\n}\nagent b @400,100\na:R75 --- b:L",
      port("right", 75),
      port("left", 50),
    ],
  ];
  for (const [source, from, to] of cases) {
    const scene = layoutPlaced(parseTam(source), arialMeasure);
    const edge = parseTam(source).edges.at(-1)!.id;
    const [p, q] = ends(scene, edge);
    assert.ok(
      near(p, portPoint(boxOf(scene, "a"), from)),
      `${source}: starts at ${JSON.stringify(p)}`,
    );
    assert.ok(near(q, portPoint(boxOf(scene, "b"), to)), `${source}: ends at ${JSON.stringify(q)}`);
  }
});

test("wires that leave one side take its three ports, not spots squeezed beside the middle", () => {
  // Elements on either side leave the three wires only the bottom.
  const source =
    "agent a @0,0 120x40\nagent l @-104,0\nagent r @128,0\nagent b @-200,200\nagent c @200,200\nagent d @12,300\n" +
    "a -- calls --> b\na -- calls --> c\na -- calls --> d";
  const scene = layoutPlaced(parseTam(source), arialMeasure);
  const a = boxOf(scene, "a");
  const starts = ["e1", "e2", "e3"].map((edge) => ends(scene, edge)[0]);
  const ports = [25, 50, 75].map((at) => portPoint(a, { side: "bottom", at }));
  for (const port of ports)
    assert.ok(
      starts.some((start) => near(start, port)),
      JSON.stringify(starts),
    );
});

test("a reads/writes access between elements side by side runs straight, as arcs, though no port lines up", () => {
  // The diagram runs down: leaving sideways costs, and a straight line here is at none of the storage's ports.
  for (const y of [150, 166, 170, 250]) {
    const source =
      `group g @0,0 300x500 {\n  agent bla[Bla] @20,${y}\n}\n` +
      "storage database[Database] @360,150 123x157 {\n  storage p[Person] @380,190\n}\nbla -- reads/writes --> database";
    const wires = layoutPlaced(parseTam(source), arialMeasure).wires.filter(
      (wire) => wire.edge === "e1",
    );
    // Two arcs, each drawn through its nine points; a bent loop is two lines with corners.
    assert.deepEqual(
      wires.map((wire) => wire.points.length),
      [9, 9],
      `Bla at y ${y}`,
    );
  }
});
