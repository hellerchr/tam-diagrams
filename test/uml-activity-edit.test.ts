import { describe, expect, it } from "vitest";
import { parseFlowchart } from "../src/uml-activity.ts";
import {
  addFlowPiece,
  connectFlow,
  labelFlowEdge,
  removeFlow,
  renameFlow,
} from "../src/uml-activity-edit.ts";

const FLOW = `flowchart TB
  start((Start)) --> check{In stock?}
  check -->|yes| ship[Ship order]
  check -->|no| wait[Wait for supply]
  wait --> check
  subgraph part [A part]
    x[Inside] --> y[Also inside]
  end
  ship --> done(((End))) & x
  style wait fill:#eee`;

const LANES = `swimlane-beta TB
  subgraph Customer
    start((Start)) --> order(Place Order)
  end
  subgraph Shop
    check(Check Order) --> ship(Ship Goods)
  end
  order --> check`;

const edges = (source: string) =>
  parseFlowchart(source).edges.map(
    (edge) => `${edge.source}>${edge.target}${edge.label ? `:${edge.label}` : ""}`,
  );

describe("editing an activity diagram as text", () => {
  it("adds steps, decisions, start, end and groups", () => {
    const step = addFlowPiece(FLOW, { kind: "step", label: "Pack" });
    expect(step.id).toBe("step1");
    expect(step.source.endsWith("\n  step1[Pack]")).toBe(true);
    expect(addFlowPiece(FLOW, { kind: "decision" }).source).toContain("decision1{ }");
    expect(addFlowPiece(FLOW, { kind: "end" }).source).toContain("end1(((End)))");
    const inside = addFlowPiece(FLOW, { kind: "step", label: "In", parent: "part" });
    expect(parseFlowchart(inside.source).nodes.get("step1")!.parent).toBe("part");
    const group = addFlowPiece(FLOW, { kind: "group", label: "More" });
    expect(parseFlowchart(group.source).subgraphs.get("group1")!.label).toBe("More");
    // In a swimlane a node stands in a lane, a new lane beside the others.
    const lane = addFlowPiece(LANES, { kind: "step", label: "Pay" });
    expect(parseFlowchart(lane.source).nodes.get("step1")).toMatchObject({
      parent: "Customer",
      shape: "round",
    });
    expect(
      parseFlowchart(addFlowPiece(LANES, { kind: "group", label: "Bank" }).source).subgraphs.size,
    ).toBe(3);
  });

  it("connects and labels", () => {
    expect(edges(connectFlow(FLOW, "wait", "done"))).toContain("wait>done");
    expect(edges(connectFlow(FLOW, "wait", "done", "give up"))).toContain("wait>done:give up");
    const labelled = labelFlowEdge(FLOW, "e4", "again");
    expect(labelled).toContain("  wait -->|again| check\n");
    expect(edges(labelFlowEdge(FLOW, "e2", ""))).toContain("check>ship");
    // An edge of a line that holds two: the line is written out, declarations kept.
    const split = labelFlowEdge(FLOW, "e7", "also");
    expect(split).toContain("  ship --> done(((End)))\n  ship -->|also| x\n");
  });

  it("renames nodes and subgraphs where they are declared", () => {
    expect(renameFlow(FLOW, "check", "Available?")).toContain("check{Available?}");
    expect(renameFlow(FLOW, "done", "Finished")).toContain("done(((Finished)))");
    expect(renameFlow(FLOW, "part", "Inner [1]")).toContain('subgraph part ["Inner [1]"]');
    expect(renameFlow(LANES, "Customer", "Client")).toContain("subgraph Customer [Client]");
    // A node that is only mentioned gets its name where it first stands.
    expect(renameFlow("flowchart LR\n  a --> b", "b", "Bee")).toBe("flowchart LR\n  a --> b[Bee]");
    expect(parseFlowchart(renameFlow(FLOW, "ship", "Send (fast)")).nodes.get("ship")!.label).toBe(
      "Send (fast)",
    );
  });

  it("removes nodes with their edges, edges, and subgraphs with what they hold", () => {
    const without = removeFlow(FLOW, ["wait"]);
    expect(edges(without)).toEqual(["start>check", "check>ship:yes", "x>y", "ship>done", "ship>x"]);
    expect(without).not.toContain("style wait");
    // The decision declared on a removed node's line keeps its declaration elsewhere.
    expect(parseFlowchart(removeFlow(FLOW, ["start"])).nodes.get("check")!.label).toBe("In stock?");
    expect(edges(removeFlow(FLOW, ["e7"]))).not.toContain("ship>x");
    expect(parseFlowchart(removeFlow(FLOW, ["e7"])).nodes.get("done")!.shape).toBe("final");
    const ungrouped = parseFlowchart(removeFlow(FLOW, ["part"]));
    expect(ungrouped.subgraphs.size).toBe(0);
    expect(ungrouped.nodes.has("x")).toBe(false);
    expect(edges(removeFlow(LANES, ["order"]))).toEqual(["check>ship"]);
  });
});

describe("an activity diagram as a structure", () => {
  it("reads parts and joins under the ids of the scene, and edits through one interface", async () => {
    const { flowStructure } = await import("../src/uml-activity-edit.ts");
    const { parseUml } = await import("../src/index.ts");
    const { arialMeasure } = await import("../src/arial-measure.ts");
    const { nodes, edges } = flowStructure.read(FLOW);
    expect(nodes.map((node) => `${node.id}:${node.kind}:${node.parent}`)).toEqual([
      "start:start:null",
      "check:decision:null",
      "ship:step:null",
      "wait:step:null",
      "part:group:null",
      "x:step:part",
      "y:step:part",
      "done:end:null",
    ]);
    // Every part is a shape of the scene, every join a wire.
    const scene = await parseUml(FLOW).layout(arialMeasure),
      shapes = new Set(scene.shapes.map((shape) => shape.id)),
      wires = new Set(scene.wires.map((wire) => wire.edge));
    for (const node of nodes) expect(shapes.has(node.id), node.id).toBe(true);
    for (const edge of edges) expect(wires.has(edge.id), edge.id).toBe(true);
    const dotted = flowStructure.relink(FLOW, "e4", "dotted");
    expect(dotted).toContain("  wait -.-> check\n");
    expect(
      flowStructure.read(flowStructure.connect(FLOW, "wait", "done", "thick")).edges.at(-1),
    ).toMatchObject({
      source: "wait",
      target: "done",
      kind: "thick",
    });
  });
});
