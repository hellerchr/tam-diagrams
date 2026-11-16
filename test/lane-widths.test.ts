// The widths of the lanes of an activity with lanes: written as comment lines, read by the
// layout, never less than the nodes of a lane need, and dragged on the canvas.
import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseUml } from "../src/index.ts";
import type { Scene } from "../src/scene.ts";
import { swimlaneStructure } from "../src/uml-activity-edit.ts";
import { laneFrame } from "../src/uml-placed.ts";
import {
  followPlaces,
  hasMarks,
  hasPlaces,
  readLanes,
  readPlaces,
  setLabel,
  setLane,
  setPlaces,
  unmarked,
  unplaced,
} from "../src/uml-places.ts";
import { editorAt } from "./editor-at.ts";

const LANES = `swimlane-beta TB
  subgraph Customer
    start((Start)) --> order(Place Order)
    receive(Receive Goods) --> stop(((End)))
  end
  subgraph Shop
    check(Check Order) --> ship(Ship Goods)
  end
  order --> check
  ship --> receive`;

/** The widths of the lanes of a scene, by id. */
const widths = (scene: Scene) => {
  const lanes = laneFrame(scene)!;
  return new Map(lanes.ids.map((id, index) => [id, lanes.bounds[index + 1] - lanes.bounds[index]]));
};

/** Whether every node of a lane stands inside it, across the lanes. */
const inLanes = (scene: Scene, parents: Map<string, string>) => {
  const lanes = laneFrame(scene)!,
    size = lanes.across === "x" ? "width" : "height";
  return scene.shapes.every((shape) => {
    const lane = lanes.ids.indexOf(parents.get(shape.id));
    return (
      lane < 0 ||
      (shape.box[lanes.across] >= lanes.bounds[lane] &&
        shape.box[lanes.across] + shape.box[size] <= lanes.bounds[lane + 1])
    );
  });
};

const parents = new Map(
  swimlaneStructure
    .read(LANES)
    .nodes.flatMap((node) => (node.parent ? [[node.id, node.parent]] : [])),
);

describe("the width of a lane", () => {
  it("is a comment line of the block at the end, after places and labels", () => {
    const source = setLane(
      setLabel(setPlaces(LANES, { order: { x: 10, y: 20 } }), "e1", { x: 0, y: -10 }),
      "Customer",
      260.4,
    );
    expect(source.endsWith("%% @order 10,20\n%% @label:e1 +0,-10\n%% @lane:Customer 260\n")).toBe(
      true,
    );
    expect(readLanes(source)).toEqual(new Map([["Customer", 260]]));
    expect(readPlaces(source)).toEqual(new Map([["order", { x: 10, y: 20 }]]));
    const wide = setLane(LANES, "Shop", 300);
    expect(hasPlaces(wide)).toBe(false);
    expect(hasMarks(wide)).toBe(true);
    // The automatic layout takes the widths; Auto layout takes them away.
    expect(unplaced(source)).toBe(`${LANES}\n%% @lane:Customer 260\n`);
    expect(unmarked(source)).toBe(`${LANES}\n`);
    expect(setLane(wide, "Shop", undefined)).toBe(`${LANES}\n`);
  });

  it("is the width the layout gives the lane, its nodes in the middle of it", async () => {
    const plain = await parseUml(LANES).layout(arialMeasure),
      wide = await parseUml(setLane(LANES, "Customer", 400)).layout(arialMeasure);
    expect(laneFrame(plain)!.ids).toEqual(["Customer", "Shop"]);
    expect(widths(wide).get("Customer")).toBe(400);
    expect(widths(wide).get("Shop")).toBe(widths(plain).get("Shop"));
    expect(inLanes(wide, parents)).toBe(true);
    const order = wide.shapes.find((shape) => shape.id === "order")!.box;
    expect(order.x + order.width / 2).toBeGreaterThan(150);
  });

  it("is never less than its nodes need: they stay inside it", async () => {
    const plain = await parseUml(LANES).layout(arialMeasure),
      narrow = await parseUml(setLane(LANES, "Customer", 20)).layout(arialMeasure);
    expect(widths(narrow).get("Customer")).toBeGreaterThan(20);
    expect(widths(narrow).get("Customer")).toBeLessThanOrEqual(widths(plain).get("Customer")!);
    expect(inLanes(narrow, parents)).toBe(true);
  });

  it("is a lane's height where the lanes lie one above the other", async () => {
    const across = LANES.replace("swimlane-beta TB", "swimlane-beta LR"),
      scene = await parseUml(setLane(across, "Shop", 260)).layout(arialMeasure);
    expect(laneFrame(scene)!.across).toBe("y");
    expect(widths(scene).get("Shop")).toBe(260);
    expect(inLanes(scene, parents)).toBe(true);
  });

  it("keeps placed nodes in their lane", async () => {
    const placed = setPlaces(LANES, { check: { x: 400, y: 120 } }),
      scene = await parseUml(setLane(placed, "Customer", 380)).layout(arialMeasure);
    expect(widths(scene).get("Customer")).toBe(380);
    expect(inLanes(scene, parents)).toBe(true);
  });

  it("goes with its lane when the lane goes", () => {
    const before = setLane(LANES, "Shop", 300),
      after = before
        .replace("  subgraph Shop\n    check(Check Order) --> ship(Ship Goods)\n  end\n", "")
        .replace("  order --> check\n  ship --> receive", "");
    expect(readLanes(followPlaces(swimlaneStructure.read, before, after)).size).toBe(0);
    expect(readLanes(followPlaces(swimlaneStructure.read, before, `${before}\n`))).toEqual(
      new Map([["Shop", 300]]),
    );
  });
});

describe("dragging a lane's border on the canvas", () => {
  /** The far border of a lane in the picture on show, halfway down the lanes. */
  const border = (scene: Scene, index: number) => {
    const lanes = laneFrame(scene)!;
    return { x: lanes.bounds[index + 1], y: lanes.frame.y + lanes.frame.height / 2 };
  };

  it("gives the lane between the lines the width it is dragged to, in one step to undo", async () => {
    const { doc, drag, settled } = await editorAt(LANES),
      before = widths(doc.picture!.scene),
      at = border(doc.picture!.scene, 0);
    await drag(at, { x: at.x + 100, y: at.y });
    await settled();
    const width = before.get("Customer")! + 100;
    expect(doc.source).toBe(`${LANES}\n%% @lane:Customer ${width}\n`);
    expect(widths(doc.picture!.scene).get("Customer")).toBe(width);
    // The outer edge is the last lane's.
    const edge = border(doc.picture!.scene, 1);
    await drag(edge, { x: edge.x + 60, y: edge.y });
    await settled();
    expect(readLanes(doc.source).get("Shop")).toBe(before.get("Shop")! + 60);
    doc.undo();
    doc.undo();
    await settled();
    expect(doc.source).toBe(LANES);
    doc.redo();
    await settled();
    expect(readLanes(doc.source)).toEqual(new Map([["Customer", width]]));
  });

  it("writes the width the nodes need when the lane is dragged narrower", async () => {
    const { doc, drag, settled } = await editorAt(LANES),
      at = border(doc.picture!.scene, 0);
    await drag(at, { x: 30, y: at.y });
    await settled();
    const written = readLanes(doc.source).get("Customer")!;
    expect(written).toBeGreaterThan(30);
    expect(widths(doc.picture!.scene).get("Customer")).toBe(written);
    expect(inLanes(doc.picture!.scene, parents)).toBe(true);
  });

  it("moves the placed nodes of the lanes after the border with it", async () => {
    const placed = setPlaces(LANES, { check: { x: 230, y: 120 }, order: { x: 40, y: 120 } });
    const { doc, drag, settled } = await editorAt(placed),
      at = border(doc.picture!.scene, 0);
    await drag(at, { x: at.x + 80, y: at.y });
    await settled();
    expect(readPlaces(doc.source).get("check")).toEqual({ x: 310, y: 120 });
    expect(readPlaces(doc.source).get("order")).toEqual({ x: 40, y: 120 });
    expect(inLanes(doc.picture!.scene, parents)).toBe(true);
  });
});
