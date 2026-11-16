// Labels placed by hand: written behind a TAM connection or on a Mermaid comment line, read back
// by the layouts, and drawn at that offset from the middle of their line wherever the line runs.
import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseUml } from "../src/index.ts";
import { labelGroups, lineMiddle, placeLabels } from "../src/label-places.ts";
import { centerOf, type Scene } from "../src/scene.ts";
import { parseTam } from "../src/tam.ts";
import { connectionOf, placeLabel, renameId, setConnection, unplace } from "../src/tam-edit.ts";
import { bestLayout, layoutPlaced } from "../src/tam-layout.ts";
import { textGroupBox } from "../src/text.ts";
import { sequenceStructure } from "../src/uml-sequence-edit.ts";
import {
  followPlaces,
  hasMarks,
  hasPlaces,
  readLabels,
  readPlaces,
  setLabel,
  setPlaces,
  unmarked,
  unplaced,
} from "../src/uml-places.ts";
import { parseError } from "./fixtures.ts";

/** Where the middle of a wire's label is drawn, relative to the middle of its line. */
const offsetOf = (scene: Scene, wire: string) => {
  const at = centerOf(textGroupBox(labelGroups(scene).get(wire)!)),
    middle = lineMiddle(scene, wire)!;
  return { x: Math.round(at.x - middle.x), y: Math.round(at.y - middle.y) };
};

const BLOCK = `agent a[A] @0,0
agent b[B] @300,0
storage s[S] @0,200
a -- calls: get @HTTP --> b @+0,-40 %% the request
a -- reads: rows --> s`;

describe("the place of a block diagram's label", () => {
  it("is read behind its connection, with signs or without", () => {
    const diagram = parseTam(BLOCK);
    expect(diagram.edges[0]).toMatchObject({ protocol: "HTTP", labelAt: { x: 0, y: -40 } });
    expect(diagram.edges[1].labelAt).toBeUndefined();
    expect(parseTam("agent a\nagent b\na --- b @12,7").edges[0].labelAt).toEqual({ x: 12, y: 7 });
    expect(connectionOf(BLOCK, "e1")).toMatchObject({ label: "get", labelAt: { x: 0, y: -40 } });
  });

  it("names one label: a statement of several connections takes none", () => {
    expect(parseError(parseTam, "agent a\nagent b\nagent c\na --- b --- c @+1,+2").message).toMatch(
      /one connection a line/,
    );
    expect(parseError(parseTam, "agent a\nagent b\na --- b @+900000,+0").message).toMatch(
      /too far out/,
    );
  });

  it("stands the label's middle that far from the middle of its line, a channel's circle", () => {
    const scene = layoutPlaced(parseTam(BLOCK), arialMeasure),
      circle = scene.shapes.find((shape) => shape.id === "e1#node")!;
    expect(lineMiddle(scene, "e1")).toEqual(centerOf(circle.box));
    expect(offsetOf(scene, "e1")).toEqual({ x: 0, y: -40 });
    // Moved with the end of its line, the label keeps its distance to the middle.
    const moved = layoutPlaced(parseTam(BLOCK.replace("@300,0", "@420,120")), arialMeasure);
    expect(offsetOf(moved, "e1")).toEqual({ x: 0, y: -40 });
    expect(lineMiddle(moved, "e1")!.x).toBeGreaterThan(lineMiddle(scene, "e1")!.x);
  });

  it("is kept by the automatic layout too", async () => {
    const source = BLOCK.replace(/ @\d+,\d+/g, ""),
      scene = await bestLayout(parseTam(source), arialMeasure);
    expect(offsetOf(scene, "e1")).toEqual({ x: 0, y: -40 });
  });

  it("is written behind the statement, before its comment, and taken away again", () => {
    const placed = placeLabel(BLOCK, "e2", { x: 30.4, y: -12 });
    expect(placed).toContain("a -- reads: rows --> s @+30,-12");
    const again = placeLabel(placed, "e1", { x: -5, y: 0 });
    expect(again).toContain("a -- calls: get @HTTP --> b @-5,+0 %% the request");
    expect(placeLabel(again, "e1", undefined)).toContain(
      "a -- calls: get @HTTP --> b %% the request",
    );
    // A statement of several connections is written out, one a line.
    const chain = "agent a\nagent b\nagent c\na --- b --- c";
    expect(placeLabel(chain, "e2", { x: 1, y: 2 })).toBe(
      "agent a\nagent b\nagent c\na --- b\nb --- c @+1,+2",
    );
  });

  it("stays through the edits of its connection, and goes with Auto layout", () => {
    expect(setConnection(BLOCK, "e1", { word: "sends data" })).toContain(
      "a -- sends data: get @HTTP --> b @+0,-40",
    );
    expect(renameId(BLOCK, "b", "server")).toContain("a -- calls: get @HTTP --> server @+0,-40");
    const auto = unplace(BLOCK);
    expect(auto).not.toMatch(/@[-+\d]/);
    expect(auto).toContain("a -- calls: get @HTTP --> b %% the request");
  });
});

const SEQUENCE = `sequenceDiagram
  participant U as User
  participant S as Shop
  participant P as Payment
  U->>S: place order
  S->>P: charge
  P-->>S: paid`;

describe("the place of a Mermaid diagram's label", () => {
  it("is a comment line of the block at the end, apart from the places of parts", () => {
    const source = setPlaces(setLabel(SEQUENCE, "m2", { x: 12.2, y: -30 }), {
      "head:U": { x: 0, y: 0 },
    });
    expect(source.endsWith("%% @head:U 0,0\n%% @label:m2 +12,-30\n")).toBe(true);
    expect(readLabels(source)).toEqual(new Map([["m2", { x: 12, y: -30 }]]));
    expect(readPlaces(source)).toEqual(new Map([["head:U", { x: 0, y: 0 }]]));
    const labelled = setLabel(SEQUENCE, "m2", { x: 1, y: 2 });
    expect(hasPlaces(labelled)).toBe(false);
    expect(hasMarks(labelled)).toBe(true);
    // The automatic layout is made from the source without places and labels.
    expect(unplaced(source)).toBe(`${SEQUENCE}\n`);
    expect(unmarked(source)).toBe(`${SEQUENCE}\n`);
    expect(setLabel(labelled, "m2", undefined)).toBe(`${SEQUENCE}\n`);
  });

  it("stands a message's label that far from the middle of its arrow", async () => {
    const plain = await parseUml(SEQUENCE).layout(arialMeasure),
      placed = await parseUml(setLabel(SEQUENCE, "m2", { x: 20, y: -25 })).layout(arialMeasure);
    expect(offsetOf(placed, "m2")).toEqual({ x: 20, y: -25 });
    // The other labels stay where they were.
    expect(textGroupBox(labelGroups(placed).get("m1")!)).toEqual(
      textGroupBox(labelGroups(plain).get("m1")!),
    );
  });

  it.each([
    ["flowchart", "flowchart TB\n  a[A] -->|yes| b[B]\n  a -->|no| c[C]", "e2"],
    ["state", "stateDiagram-v2\n  A --> B : go\n  B --> A : back", "t1"],
    ["class", 'classDiagram\n  class A\n  class B\n  A "1" --> "*" B : has', "r1"],
    ["er", "erDiagram\n  A ||--o{ B : has", "r1"],
    ["swimlane", "swimlane-beta TB\n  subgraph L\n    a(A) -->|go| b(B)\n  end", "e1"],
  ])("stands a %s label where its line says", async (_, source, edge) => {
    const placed = await parseUml(setLabel(source, edge, { x: 40, y: 10 })).layout(arialMeasure);
    expect(offsetOf(placed, edge)).toEqual({ x: 40, y: 10 });
  });

  it("goes with its join when an edit changes the ids of the joins", () => {
    const before = setLabel(SEQUENCE, "m2", { x: 5, y: 5 }),
      // The first message goes: the one that was m2 is m1 now.
      after = before.replace("  U->>S: place order\n", "");
    expect(readLabels(followPlaces(sequenceStructure.read, before, after))).toEqual(
      new Map([["m1", { x: 5, y: 5 }]]),
    );
    // Its label changed, a join between the same parts keeps the place.
    const relabelled = before.replace("charge", "bill");
    expect(readLabels(followPlaces(sequenceStructure.read, before, relabelled))).toEqual(
      new Map([["m2", { x: 5, y: 5 }]]),
    );
    // A join that is gone takes its label's place with it.
    const gone = before.replace("  S->>P: charge\n", "");
    expect(readLabels(followPlaces(sequenceStructure.read, before, gone)).size).toBe(0);
  });

  it("leaves a scene without placed labels as it is", async () => {
    const scene = await parseUml(SEQUENCE).layout(arialMeasure);
    expect(placeLabels(scene, new Map())).toBe(scene);
    expect(placeLabels(scene, new Map([["nothing", { x: 1, y: 1 }]]))).toBe(scene);
  });
});
