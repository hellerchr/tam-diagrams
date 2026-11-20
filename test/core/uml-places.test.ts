// Places, label offsets and lane widths written in sources: read, set, removed, followed across edits, and drawn on a scene.
import { test } from "vitest";
import assert from "node:assert/strict";
import { arialMeasure } from "../../src/arial-measure.ts";
import { parseUml } from "../../src/index.ts";
import {
  labelGroups,
  labelKey,
  labelOffset,
  lineMiddle,
  placeLabels,
} from "../../src/label-places.ts";
import { centerOf } from "../../src/scene.ts";
import type { Scene } from "../../src/scene.ts";
import { parseTam } from "../../src/tam.ts";
import { connectionOf, placeLabel, renameId, setConnection, unplace } from "../../src/tam-edit.ts";
import { textGroupBox } from "../../src/text.ts";
import { classStructure } from "../../src/uml-class-edit.ts";
import { sequenceStructure } from "../../src/uml-sequence-edit.ts";
import { stateStructure } from "../../src/uml-state-edit.ts";
import {
  followPlaces,
  hasMarks,
  hasPlaces,
  prunePlaces,
  readLabels,
  readLanes,
  readPlaces,
  removePlaces,
  renamePlace,
  setLabel,
  setLane,
  setPlaces,
  unmarked,
  unplaced,
} from "../../src/uml-places.ts";

const SOURCE = `classDiagram
  class Order
  class Customer
  Customer --> Order`;

/** The readers of the structures, bound for followPlaces. */
const readClass = (source: string) => classStructure.read(source),
  readState = (source: string) => stateStructure.read(source),
  readSequence = (source: string) => sequenceStructure.read(source);

const SEQUENCE = `sequenceDiagram
  participant U as User
  participant S as Shop
  participant P as Payment
  U->>S: place order
  S->>P: charge
  P-->>S: paid`;

/** The one layout of this file: the sequence with the label of its second message placed. */
const PLACED = await parseUml(setLabel(SEQUENCE, "m2", { x: 20, y: -25 })).layout(arialMeasure);

/** Where the middle of a wire's label is drawn, relative to the middle of its line. */
const offsetOf = (scene: Scene, wire: string) => {
  const group = labelGroups(scene).get(wire);
  assert.ok(group);
  return labelOffset(scene, wire, textGroupBox(group));
};

test("places are read from their comment lines wherever they stand, the later line counting", () => {
  const source = `classDiagram
%% @Order 120,80
  class Order
  %%   @ns:billing   40 , -300
  class Customer
%% @Review#initial 10.5,10
%% a comment @ 1,2
%% @Order 130,90`;
  assert.deepEqual(
    [...readPlaces(source)],
    [
      ["Order", { x: 130, y: 90 }],
      ["ns:billing", { x: 40, y: -300 }],
      ["Review#initial", { x: 10.5, y: 10 }],
    ],
  );
  assert.equal(hasPlaces(source), true);
  assert.equal(hasPlaces(SOURCE), false);
  assert.equal(readPlaces(SOURCE).size, 0);
  // The lines are comments to the parser.
  assert.equal(parseUml(source).kind, "class");
});

test("places are written as one block at the end, every other line left as it is", () => {
  const placed = setPlaces(SOURCE, { Order: { x: 120.4, y: 80 } });
  assert.equal(placed, `${SOURCE}\n%% @Order 120,80\n`);
  const both = setPlaces(placed, new Map([["Customer", { x: -5, y: 7 }]]));
  assert.equal(both, `${SOURCE}\n%% @Order 120,80\n%% @Customer -5,7\n`);
  // A place set again keeps its line's place in the block; lines elsewhere come to the block.
  assert.equal(
    setPlaces(both, { Order: { x: 1, y: 2 } }),
    `${SOURCE}\n%% @Order 1,2\n%% @Customer -5,7\n`,
  );
  const scattered = `classDiagram\n%% @Order 1,2\n  class Order\n  %% a note\n  class Customer\n`;
  assert.equal(
    setPlaces(scattered, { Customer: { x: 3, y: 4 } }),
    `classDiagram\n  class Order\n  %% a note\n  class Customer\n%% @Order 1,2\n%% @Customer 3,4\n`,
  );
});

test("places are removed, renamed and pruned to the parts that are left", () => {
  const placed = setPlaces(SOURCE, { Order: { x: 1, y: 2 }, Customer: { x: 3, y: 4 } });
  assert.equal(removePlaces(placed, ["Order"]), `${SOURCE}\n%% @Customer 3,4\n`);
  assert.equal(removePlaces(placed), `${SOURCE}\n`);
  assert.equal(removePlaces(SOURCE), SOURCE);
  assert.deepEqual(
    [...readPlaces(renamePlace(placed, "Order", "Purchase")).keys()],
    ["Purchase", "Customer"],
  );
  assert.equal(renamePlace(placed, "Missing", "Other"), placed);
  assert.deepEqual([...readPlaces(prunePlaces(placed, ["Customer", "Else"])).keys()], ["Customer"]);
  assert.equal(prunePlaces(placed, ["Customer", "Order"]), placed);
});

test("labels and lanes are lines of the block after the places; unplaced keeps the lanes", () => {
  const source = setLane(
    setPlaces(setLabel(SEQUENCE, "m2", { x: 12.2, y: -30 }), { "head:U": { x: 0, y: 0 } }),
    "Shop",
    180.6,
  );
  assert.ok(source.endsWith("%% @head:U 0,0\n%% @label:m2 +12,-30\n%% @lane:Shop 181\n"));
  assert.deepEqual(readLabels(source), new Map([["m2", { x: 12, y: -30 }]]));
  assert.deepEqual(readPlaces(source), new Map([["head:U", { x: 0, y: 0 }]]));
  assert.deepEqual(readLanes(source), new Map([["Shop", 181]]));
  assert.equal(unplaced(source), `${SEQUENCE}\n%% @lane:Shop 181\n`);
  assert.equal(unmarked(source), `${SEQUENCE}\n`);
  assert.equal(setLane(unplaced(source), "Shop", undefined), `${SEQUENCE}\n`);
  const labelled = setLabel(SEQUENCE, "m2", { x: 1, y: 2 });
  assert.equal(hasPlaces(labelled), false);
  assert.equal(hasMarks(labelled), true);
  assert.equal(setLabel(labelled, "m2", undefined), `${SEQUENCE}\n`);
});

test("followed across a structure edit, places drop with their parts and pass to new ids", () => {
  const read = readClass,
    before = setPlaces(SOURCE, { Order: { x: 1, y: 2 }, Customer: { x: 3, y: 4 } });
  const removed = classStructure.remove(before, ["Customer"]);
  assert.deepEqual(
    [...readPlaces(followPlaces(read, before, removed))],
    [["Order", { x: 1, y: 2 }]],
  );
  const added = classStructure.add(before, { kind: "class" });
  const followed = followPlaces(read, before, added.source);
  assert.deepEqual(followed.trimEnd().split("\n").slice(-2), ["%% @Order 1,2", "%% @Customer 3,4"]);
  assert.ok(read(followed).nodes.some((node) => node.id === added.id));
  // A renamed part keeps its place, and the places of its other drawings.
  const drawn = `${before}%% @Order#2 5,6\n%% @stranger 7,8\n`;
  const renamed = drawn.replaceAll("Order", "Purchase").replaceAll("@Purchase", "@Order");
  assert.deepEqual(
    [...readPlaces(followPlaces(read, drawn, renamed))],
    [
      ["Purchase", { x: 1, y: 2 }],
      ["Customer", { x: 3, y: 4 }],
      ["Purchase#2", { x: 5, y: 6 }],
      ["stranger", { x: 7, y: 8 }],
    ],
  );
});

test("followed places stay with the part when counted ids pass on: notes, final states", () => {
  const notes = `${SOURCE}\n  note for Order "first"\n  note for Customer "second"`;
  const before = setPlaces(notes, { note1: { x: 10, y: 10 }, note2: { x: 500, y: 10 } });
  const after = classStructure.remove(before, ["note1"]);
  assert.deepEqual(
    [...readPlaces(followPlaces(readClass, before, after))],
    [["note1", { x: 500, y: 10 }]],
  );
  const machine = "stateDiagram-v2\n  [*] --> A\n  A --> [*]\n  A --> B\n  B --> [*]";
  const [first, second] = stateStructure
    .read(machine)
    .nodes.map((node) => node.id)
    .filter((id) => id.includes("final"));
  assert.ok(first && second);
  const placed = setPlaces(machine, { [first]: { x: 1, y: 1 }, [second]: { x: 9, y: 9 } });
  // Without the first transition to an end, the end that is left is the one B leads to.
  const cut = placed.replace("  A --> [*]\n", "");
  const left = stateStructure.read(cut).nodes.find((node) => node.id.includes("final"));
  assert.ok(left);
  assert.deepEqual(readPlaces(followPlaces(readState, placed, cut)).get(left.id), { x: 9, y: 9 });
});

test("a followed label goes with its join when the ids of the joins change", () => {
  const read = readSequence,
    before = setLabel(SEQUENCE, "m2", { x: 5, y: 5 });
  // The first message goes: the one that was m2 is m1 now.
  const after = before.replace("  U->>S: place order\n", "");
  assert.deepEqual(
    readLabels(followPlaces(read, before, after)),
    new Map([["m1", { x: 5, y: 5 }]]),
  );
  // A join between the same parts keeps it through a new label; a join that is gone takes it along.
  const relabelled = before.replace("charge", "bill");
  assert.deepEqual(
    readLabels(followPlaces(read, before, relabelled)),
    new Map([["m2", { x: 5, y: 5 }]]),
  );
  assert.equal(
    readLabels(followPlaces(read, before, before.replace("  S->>P: charge\n", ""))).size,
    0,
  );
});

test("a placed label stands its offset from the middle of its line; others and no offsets leave the scene", () => {
  assert.deepEqual(offsetOf(PLACED, "m2"), { x: 20, y: -25 });
  assert.equal(placeLabels(PLACED, new Map()), PLACED);
  assert.equal(placeLabels(PLACED, new Map([["nothing", { x: 1, y: 1 }]])), PLACED);
  const m1 = labelGroups(PLACED).get("m1");
  assert.ok(m1);
  const moved = placeLabels(PLACED, new Map([["m1", { x: 0, y: -300 }]]));
  assert.deepEqual(offsetOf(moved, "m1"), { x: 0, y: -300 });
  assert.deepEqual(offsetOf(moved, "m2"), { x: 20, y: -25 });
  // The bounds grow to the label that moved out; the scene placed from is left as it was.
  assert.ok(moved.bounds.y < PLACED.bounds.y);
  assert.deepEqual(offsetOf(PLACED, "m1"), labelOffset(PLACED, "m1", textGroupBox(m1)));
  const middle = lineMiddle(PLACED, "m1");
  assert.ok(middle);
  assert.ok(Math.abs(centerOf(textGroupBox(m1)).x - middle.x) < 1);
  assert.equal(lineMiddle(PLACED, "nothing"), undefined);
  assert.equal(labelKey("e1#node"), "e1");
  assert.equal(labelKey("e2#2"), "e2");
});

const BLOCK = `agent a[A] @0,0
agent b[B] @300,0
storage s[S] @0,200
a -- calls: get @HTTP --> b @+0,-40 %% the request
a -- reads: rows --> s`;

test("a TAM label's place is read behind its connection, one connection a line, not too far", () => {
  const diagram = parseTam(BLOCK);
  assert.equal(diagram.edges[0]?.protocol, "HTTP");
  assert.deepEqual(diagram.edges[0]?.labelAt, { x: 0, y: -40 });
  assert.equal(diagram.edges[1]?.labelAt, undefined);
  assert.deepEqual(parseTam("agent a\nagent b\na --- b @12,7").edges[0]?.labelAt, { x: 12, y: 7 });
  assert.deepEqual(connectionOf(BLOCK, "e1")?.labelAt, { x: 0, y: -40 });
  assert.throws(
    () => parseTam("agent a\nagent b\nagent c\na --- b --- c @+1,+2"),
    /one connection a line/,
  );
  assert.throws(() => parseTam("agent a\nagent b\na --- b @+900000,+0"), /too far out/);
});

test("a TAM label's place is written before the comment, kept by edits, dropped by Auto layout", () => {
  const placed = placeLabel(BLOCK, "e2", { x: 30.4, y: -12 });
  assert.ok(placed.includes("a -- reads: rows --> s @+30,-12"));
  const again = placeLabel(placed, "e1", { x: -5, y: 0 });
  assert.ok(again.includes("a -- calls: get @HTTP --> b @-5,+0 %% the request"));
  assert.ok(
    placeLabel(again, "e1", undefined).includes("a -- calls: get @HTTP --> b %% the request"),
  );
  // A statement of several connections is written out, one a line.
  assert.equal(
    placeLabel("agent a\nagent b\nagent c\na --- b --- c", "e2", { x: 1, y: 2 }),
    "agent a\nagent b\nagent c\na --- b\nb --- c @+1,+2",
  );
  assert.ok(
    setConnection(BLOCK, "e1", { word: "sends data" }).includes(
      "a -- sends data: get @HTTP --> b @+0,-40",
    ),
  );
  assert.ok(renameId(BLOCK, "b", "server").includes("a -- calls: get @HTTP --> server @+0,-40"));
  const auto = unplace(BLOCK);
  assert.doesNotMatch(auto, /@[-+\d]/);
  assert.ok(auto.includes("a -- calls: get @HTTP --> b %% the request"));
});

test("a reads/writes loop's middle lies between its two arcs, halfway along, not at an end", async () => {
  const { layoutPlaced } = await import("../../src/tam-layout.ts");
  const scene = layoutPlaced(
    parseTam("agent f @0,0\nstorage r @300,0\nf -- reads/writes: ops --> r"),
    arialMeasure,
  );
  const [a, b] = scene.wires.filter((wire) => wire.edge === "e1").map((wire) => wire.points);
  const middle = lineMiddle(scene, "e1")!;
  assert.ok(Math.abs(middle.x - (a![0]!.x + a!.at(-1)!.x) / 2) < 1, JSON.stringify(middle));
  assert.ok(
    middle.y > Math.min(a![0]!.y, b![0]!.y) && middle.y < Math.max(a![0]!.y, b![0]!.y),
    JSON.stringify(middle),
  );
});
