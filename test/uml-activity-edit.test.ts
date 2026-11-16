import { describe, expect, it } from "vitest";
import { parseFlowchart } from "../src/uml-activity.ts";
import {
  activityRefusal,
  activityStructure,
  addFlowPiece,
  attachFlow,
  connectFlow,
  duplicateFlowNode,
  groupFlowNodes,
  insertFlowOnEdge,
  isGeneratedFlowId,
  joinFlow,
  labelFlowEdge,
  moveFlowInto,
  nextBranchLabel,
  removeFlow,
  renameFlow,
  renameFlowId,
  restrokeFlow,
  retitleFlow,
  reverseFlow,
  ungroupFlow,
} from "../src/uml-activity-edit.ts";
import { FLOWCHART_EXAMPLES, SWIMLANE_EXAMPLES } from "../src/samples/uml-examples.ts";

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
    // Before the styling that closes the source.
    expect(step.source.endsWith("\n  step1[Pack]\n  style wait fill:#eee")).toBe(true);
    expect(addFlowPiece(FLOW, { kind: "decision" }).source).toContain("decision1{ }");
    // A start and an end are written as their symbols: no flow makes them one yet.
    const end = addFlowPiece(FLOW, { kind: "end" });
    expect(end.source).toContain("  end1@{ shape: stop }\n");
    expect(parseFlowchart(end.source).nodes.get("end1")).toMatchObject({
      shape: "final",
      label: "",
    });
    const begin = addFlowPiece(FLOW, { kind: "start" });
    expect(begin.source).toContain("  start1@{ shape: start }\n");
    expect(parseFlowchart(begin.source).nodes.get("start1")!.shape).toBe("initial");
    expect(addFlowPiece(FLOW, { kind: "end", label: "Done {1}" }).source).toContain(
      '  end1@{ shape: stop, label: "Done {1#125;" }\n',
    );
    // Joined and named, they stay the symbol.
    const joined = connectFlow(end.source, "ship", "end1"),
      named = retitleFlow(joined, "end1", "All done");
    expect(named.id).toBe("allDone");
    expect(parseFlowchart(named.source).nodes.get("allDone")).toMatchObject({
      shape: "final",
      label: "All done",
    });
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
    const { activityStructure } = await import("../src/uml-activity-edit.ts");
    const { parseUml } = await import("../src/index.ts");
    const { arialMeasure } = await import("../src/arial-measure.ts");
    const { nodes, edges } = activityStructure.read(FLOW);
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
    const dotted = activityStructure.relink(FLOW, "e4", "dotted");
    expect(dotted).toContain("  wait -.-> check\n");
    expect(
      activityStructure.read(activityStructure.connect(FLOW, "wait", "done", "thick")).edges.at(-1),
    ).toMatchObject({
      source: "wait",
      target: "done",
      kind: "thick",
    });
  });
});

const nodesOf = (source: string) => [...parseFlowchart(source).nodes.keys()].toSorted();
const lines = (source: string) => source.split("\n");

describe("removing from an activity diagram", () => {
  it("keeps the nodes a removed edge or node shared a line with", () => {
    const pair = "flowchart TB\n  a --> b\n  b --> c[See]";
    expect(removeFlow(pair, ["e1"])).toBe("flowchart TB\n  a\n  b --> c[See]");
    const chain = "flowchart TB\n  a --> b --> c\n  d --> a";
    expect(removeFlow(chain, ["b"])).toBe("flowchart TB\n  c\n  d --> a");
    const lists =
      "flowchart LR\n  a1 & a2 & a3 --> hub((Hub)) --> b1 & b2\n  b1 --> c\n  b2 --> c\n  c --> a1";
    expect(lines(removeFlow(lists, ["e2"])).slice(1, 3)).toEqual([
      "  a1 & a3 --> hub((Hub)) --> b1 & b2",
      "  a2",
    ]);
    const hubless = removeFlow(lists, ["hub"]);
    expect(nodesOf(hubless)).toEqual(["a1", "a2", "a3", "b1", "b2", "c"]);
    expect(lines(hubless).slice(1, 3)).toEqual(["  a2", "  a3"]);
  });

  it("cuts a chain where an edge goes and leaves the rest of the line as written", () => {
    const chain = "flowchart LR\n  a[A]  -->  b -- to c -->  c{C} ==> d";
    expect(removeFlow(chain, ["e2"])).toBe("flowchart LR\n  a[A]  -->  b\n  c{C} ==> d");
    expect(removeFlow(chain, ["e1"])).toBe("flowchart LR\n  b -- to c -->  c{C} ==> d\n  a[A]");
    expect(removeFlow(chain, ["d"])).toBe("flowchart LR\n  a[A]  -->  b -- to c -->  c{C}");
    // A list in the middle of a chain that loses one edge on one side.
    expect(removeFlow("flowchart LR\n  x --> a & b --> y", ["e3"])).toBe(
      "flowchart LR\n  x --> a & b\n  b --> y",
    );
  });

  it("keeps a node in its subgraph when the line that put it there goes", () => {
    const inner = "flowchart TB\n  subgraph g [G]\n    x --> y\n  end\n  z --> x";
    const result = removeFlow(inner, ["e1"]);
    expect(result).toBe("flowchart TB\n  subgraph g [G]\n    x\n    y\n  end\n  z --> x");
    expect(parseFlowchart(result).nodes.get("x")!.parent).toBe("g");
  });

  it("removes a subgraph with its edges, its direction and what styles its parts", () => {
    const [, nested] = FLOWCHART_EXAMPLES.find(([name]) => name.includes("nested subgraphs"))!;
    expect(removeFlow(nested, ["cloud"])).toBe(
      "flowchart LR\n  client([Browser]) --> lb{{Load balancer}}\n  ops[Operations]",
    );
    const styled = `flowchart TB
  a --> b
  subgraph pay [Payment]
    direction LR
    %% the inner part
    c[Card] --> d
  end
  b --> c
  d --> e
  e --> a
  classDef hot fill:#f00
  class c,e hot
  class d hot
  style c fill:#eee
  click d callback
  linkStyle 0 stroke:red
  linkStyle 1,3,4 stroke:blue
  linkStyle default stroke:gray`;
    expect(removeFlow(styled, ["pay"])).toBe(`flowchart TB
  a --> b
  e --> a
  classDef hot fill:#f00
  class e hot
  linkStyle 0 stroke:red
  linkStyle 1 stroke:blue
  linkStyle default stroke:gray`);
    expect(removeFlow(styled, ["e1"])).toContain("  linkStyle 0,2,3 stroke:blue\n");
    expect(removeFlow(styled, ["e1"])).not.toContain("stroke:red");
    expect(removeFlow(styled, ["c"])).toContain("  class e hot\n  class d hot\n  click d");
    const all = removeFlow(styled, ["a", "b", "pay", "e"]);
    expect(all).toBe("flowchart TB\n  classDef hot fill:#f00\n  linkStyle default stroke:gray");
  });
});

describe("names and labels of an activity diagram", () => {
  const shown = (source: string, id: string) => parseFlowchart(source).nodes.get(id)!.label;
  const ODD = [
    "List<String> items",
    'x<y>z & "q"',
    'Prüfe "Lager" [A] (b) <x> {y} | z',
    "a < b and c > d",
    "50% #1; done",
    "&amp; and #35; stay",
    "/slashes/",
    "`tick`",
    "<b>bold</b>",
  ];

  it("writes what the syntax reads for itself as entity codes", () => {
    const source = "flowchart TB\n  a[One] --> b[Two]";
    expect(renameFlow(source, "b", "List<String> items")).toContain('b["List#lt;String> items"]');
    for (const text of ODD) {
      expect(shown(renameFlow(source, "b", text), "b"), text).toBe(text);
      expect(parseFlowchart(labelFlowEdge(source, "e1", text)).edges[0].label, text).toBe(text);
      const inline = labelFlowEdge("flowchart TB\n  a -- old --> b", "e1", text);
      expect(parseFlowchart(inline).edges[0].label, text).toBe(text);
      const fork = renameFlow("flowchart TB\n  a --> f@{ shape: fork }", "f", text);
      expect(shown(fork, "f"), text).toBe(text);
      const group = renameFlow("flowchart TB\n  subgraph g [G]\n    a\n  end", "g", text);
      expect(parseFlowchart(group).subgraphs.get("g")!.label, text).toBe(text);
    }
    expect(shown(renameFlow(source, "b", "two\nlines"), "b")).toBe("two<br>lines");
    expect(labelFlowEdge(source, "e1", 'say "hi" | bye')).toContain(
      'a[One] -->|"say #quot;hi#quot; #124; bye"| b[Two]',
    );
  });

  it("goes back to the bare id, or a blank shape, for an empty name", () => {
    expect(renameFlow("flowchart TB\n  a --> b[Two]", "b", "")).toBe("flowchart TB\n  a --> b");
    expect(renameFlow("flowchart TB\n  a --> b{Two?}", "b", " ")).toBe(
      "flowchart TB\n  a --> b{ }",
    );
    expect(renameFlow("flowchart TB\n  a --> b", "b", "")).toBe("flowchart TB\n  a --> b");
    const group = "flowchart TB\n  subgraph pay [Payment]\n    a\n  end";
    expect(renameFlow(group, "pay", "")).toBe(group);
  });

  it("names a node written with braces, and subgraphs of every form", () => {
    expect(renameFlow("flowchart TB\n  a --> f@{ shape: fork }", "f", "Split")).toBe(
      'flowchart TB\n  a --> f@{ shape: fork, label: "Split" }',
    );
    expect(renameFlow('flowchart TB\n  f@{ shape: fork, label: "Old" } --> a', "f", "New")).toBe(
      'flowchart TB\n  f@{ shape: fork, label: "New" } --> a',
    );
    expect(renameFlow('flowchart TB\n  subgraph "Old"\n    a\n  end', "subgraph#1", "New")).toBe(
      'flowchart TB\n  subgraph "New"\n    a\n  end',
    );
    expect(renameFlow("graph TD;\n  subgraph one;\n    a;\n  end;", "one", "Uno")).toBe(
      "graph TD;\n  subgraph one [Uno];\n    a;\n  end;",
    );
  });

  it("gives a new part an id made of its first name", () => {
    const added = addFlowPiece("flowchart TB\n  a[A]", { kind: "step" }),
      joined = connectFlow(added.source, "a", added.id);
    expect(retitleFlow(joined, added.id, "Pack parcel")).toEqual({
      source: "flowchart TB\n  a[A]\n  packParcel[Pack parcel]\n  a --> packParcel",
      id: "packParcel",
    });
    // A taken id, a name without letters of an id, and a part that has an id of its own keep theirs.
    expect(retitleFlow(joined, added.id, "A").id).toBe("step1");
    expect(retitleFlow(joined, added.id, "注文").source).toContain("step1[注文]");
    expect(retitleFlow(joined, added.id, "End").id).toBe("step1");
    expect(retitleFlow(joined, "a", "Other")).toEqual({
      source: joined.replace("a[A]", "a[Other]"),
      id: "a",
    });
    expect(retitleFlow(joined, added.id, "Größe prüfen?").source).toContain(
      "grossePrufen[Größe prüfen?]",
    );
    const decision = addFlowPiece("flowchart TB\n  a[A]", { kind: "decision" });
    expect(retitleFlow(decision.source, decision.id, "In stock?").source).toContain(
      "inStock{In stock?}",
    );
    const lane = addFlowPiece(LANES, { kind: "group" });
    expect(retitleFlow(lane.source, lane.id, "Bank")).toMatchObject({ id: "Bank" });
    expect(retitleFlow(lane.source, lane.id, "Bank").source).toContain("  subgraph Bank\n  end");
    expect(retitleFlow(lane.source, lane.id, "Bank office").source).toContain(
      "  subgraph bankOffice [Bank office]\n",
    );
    const styled =
      "flowchart TB\n  step1[Step] --> b\n  style step1 fill:#eee\n  class b,step1 hot";
    expect(retitleFlow(styled, "step1", "Go").source).toBe(
      "flowchart TB\n  go[Go] --> b\n  style go fill:#eee\n  class b,go hot",
    );
  });
});

describe("edges of an activity diagram", () => {
  const CHAIN = "flowchart LR\n  a --> b -- old text --> c ==> d\n  d --> a";

  it("changes one edge of a chain in place", () => {
    expect(labelFlowEdge(CHAIN, "e1", "first")).toBe(
      "flowchart LR\n  a -->|first| b -- old text --> c ==> d\n  d --> a",
    );
    expect(labelFlowEdge(CHAIN, "e2", "new text")).toBe(
      "flowchart LR\n  a --> b -- new text --> c ==> d\n  d --> a",
    );
    expect(labelFlowEdge(CHAIN, "e2", "")).toBe("flowchart LR\n  a --> b --> c ==> d\n  d --> a");
    expect(labelFlowEdge(CHAIN, "e2", "a (b)")).toBe(
      'flowchart LR\n  a --> b -->|"a (b)"| c ==> d\n  d --> a',
    );
    expect(restrokeFlow(CHAIN, "e2", "dotted")).toBe(
      "flowchart LR\n  a --> b -. old text .-> c ==> d\n  d --> a",
    );
    expect(restrokeFlow(CHAIN, "e3", "flow")).toBe(
      "flowchart LR\n  a --> b -- old text --> c --> d\n  d --> a",
    );
    expect(restrokeFlow(CHAIN, "e1", "flow")).toBe(CHAIN);
    expect(restrokeFlow("flowchart LR\n  a o--o b\n  c --x d", "e1", "thick")).toBe(
      "flowchart LR\n  a o==o b\n  c --x d",
    );
    expect(labelFlowEdge("flowchart LR\n  a -->|x| b;", "e1", "")).toBe("flowchart LR\n  a --> b;");
  });

  it("writes out a list only for the edge that differs", () => {
    const lists = "flowchart LR\n  a & b --> c & d --> e";
    expect(labelFlowEdge(lists, "e2", "x")).toBe(
      "flowchart LR\n  a --> c\n  a -->|x| d\n  b --> c & d --> e",
    );
    expect(parseFlowchart(labelFlowEdge(lists, "e2", "x")).edges.map((edge) => edge.label)).toEqual(
      [undefined, "x", undefined, undefined, undefined, undefined],
    );
  });

  it("puts new statements where they belong", () => {
    const styled =
      "flowchart TB\n  a --> b\n\n  %% colours\n  classDef hot fill:#f00\n  class a hot";
    expect(addFlowPiece(styled, { kind: "step" }).source).toBe(
      "flowchart TB\n  a --> b\n  step1[Step]\n\n  %% colours\n  classDef hot fill:#f00\n  class a hot",
    );
    expect(connectFlow(styled, "b", "a")).toContain("  a --> b\n  b --> a\n\n");
    // A lane goes after the last lane, before the edges between lanes.
    expect(addFlowPiece(LANES, { kind: "group", label: "Bank" }).source).toContain(
      "  end\n  subgraph lane1 [Bank]\n  end\n  order --> check",
    );
    // An edge between two parts of one subgraph stands inside it, and the edges after it count on.
    const [, nested] = FLOWCHART_EXAMPLES.find(([name]) => name.includes("nested subgraphs"))!;
    expect(connectFlow(nested, "db1", "api1")).toContain(
      "      api1[API] --> db1[(Primary DB)]\n      db1 --> api1\n    end",
    );
    expect(connectFlow(nested, "api1", "api2")).toContain(
      "    db1 -. replication .-> db2\n    api1 --> api2\n  end",
    );
    expect(connectFlow(nested, "client", "api1")).toContain(
      "  ops[Operations] --> cloud\n  client --> api1",
    );
    const numbered =
      "flowchart TB\n  subgraph g\n    a --> b\n  end\n  b --> c\n  linkStyle 0,1 stroke:red";
    expect(connectFlow(numbered, "b", "a")).toBe(
      "flowchart TB\n  subgraph g\n    a --> b\n    b --> a\n  end\n  b --> c\n  linkStyle 0,2 stroke:red",
    );
  });

  it("does not join twice what is joined", () => {
    expect(connectFlow(FLOW, "wait", "check")).toBe(FLOW);
    expect(activityStructure.connect(FLOW, "ship", "done")).toBe(FLOW);
    expect(edges(activityStructure.connect(FLOW, "ship", "done", "dotted"))).toHaveLength(8);
    expect(edges(connectFlow(FLOW, "check", "wait"))).toHaveLength(7);
    expect(edges(connectFlow(FLOW, "check", "wait", "maybe"))).toHaveLength(8);
    // A lane is no end of a flow.
    expect(connectFlow(LANES, "order", "Shop")).toBe(LANES);
  });

  it("adds to the lane given, to no lane beside loose nodes, else to the first lane", () => {
    const parent = (source: string, piece: Parameters<typeof addFlowPiece>[1]) => {
      const added = addFlowPiece(source, piece);
      return parseFlowchart(added.source).nodes.get(added.id)!.parent;
    };
    for (const kind of ["step", "decision", "start", "end"] as const)
      expect(parent(LANES, { kind, parent: "Shop" }), kind).toBe("Shop");
    expect(parent(LANES, { kind: "step", parent: null })).toBe("Customer");
    const [, loose] = SWIMLANE_EXAMPLES.find(([name]) => name.includes("loose nodes"))!;
    expect(parent(loose, { kind: "step", parent: null })).toBe(null);
    expect(parent(loose, { kind: "step", parent: "Team" })).toBe("Team");
    const added = addFlowPiece(loose, { kind: "step", parent: null });
    expect(
      parseFlowchart(connectFlow(added.source, "review", added.id)).nodes.get(added.id)!.parent,
    ).toBe(null);
  });
});

describe.each([...FLOWCHART_EXAMPLES, ...SWIMLANE_EXAMPLES])(
  "editing the example %s",
  (_, source) => {
    const chart = parseFlowchart(source),
      before = lines(source);
    /** Every line of the source that the result does not have, in order. */
    const changed = (result: string) => {
      const after = lines(result);
      let at = 0;
      return before.filter((line) => {
        const found = after.indexOf(line, at);
        if (found < 0) return true;
        at = found + 1;
        return false;
      });
    };
    const mentions = (line: string, id: string) => line.split(/[^\p{L}\p{N}_]+/u).includes(id);

    it("removes each node and nothing else", () => {
      for (const id of chart.nodes.keys()) {
        const result = removeFlow(source, [id]);
        expect(nodesOf(result), id).toEqual(nodesOf(source).filter((other) => other !== id));
        for (const node of parseFlowchart(result).nodes.values())
          expect(node.parent, `${id}: ${node.id}`).toBe(chart.nodes.get(node.id)!.parent);
        expect(parseFlowchart(result).edges.map((edge) => `${edge.source}>${edge.target}`)).toEqual(
          chart.edges
            .filter((edge) => edge.source !== id && edge.target !== id)
            .map((edge) => `${edge.source}>${edge.target}`),
        );
        // Only lines that mention the node change.
        for (const line of changed(result)) expect(mentions(line, id), `${id}: ${line}`).toBe(true);
      }
    });

    it("removes each edge and no node", () => {
      for (const edge of chart.edges) {
        const result = removeFlow(source, [edge.id]);
        expect(nodesOf(result), edge.id).toEqual(nodesOf(source));
        for (const node of parseFlowchart(result).nodes.values())
          expect(node.parent, `${edge.id}: ${node.id}`).toBe(chart.nodes.get(node.id)!.parent);
        expect(parseFlowchart(result).edges).toHaveLength(chart.edges.length - 1);
        expect(changed(result), edge.id).toEqual([before[edge.line - 1]]);
      }
    });

    it("relabels and restrokes each edge", () => {
      for (const [index, edge] of chart.edges.entries()) {
        for (const text of ["checked", 'odd "one" <b> | [x]', ""]) {
          const result = labelFlowEdge(source, edge.id, text),
            after = parseFlowchart(result);
          expect(nodesOf(result), edge.id).toEqual(nodesOf(source));
          expect(after.edges, edge.id).toHaveLength(chart.edges.length);
          expect({ ...after.edges[index], line: 0 }, edge.id).toEqual({
            ...edge,
            label: text || undefined,
            line: 0,
          });
          after.edges.forEach((other, at) => {
            if (at !== index) expect(other.label, edge.id).toBe(chart.edges[at].label);
          });
          expect(changed(result), edge.id).toEqual(
            result === source ? [] : [before[edge.line - 1]],
          );
          // An edge with an arrow of its own changes within its line.
          const alone = chart.edges.filter((other) => other.line === edge.line);
          if (!before[edge.line - 1].includes("&") || alone.length === 1)
            expect(lines(result), edge.id).toHaveLength(before.length);
        }
        const dotted = restrokeFlow(source, edge.id, "dotted"),
          after = parseFlowchart(dotted);
        expect({ ...after.edges[index], line: 0 }, edge.id).toEqual({
          ...edge,
          stroke: "dotted",
          line: 0,
        });
        expect(nodesOf(dotted), edge.id).toEqual(nodesOf(source));
        expect(changed(dotted), edge.id).toEqual(dotted === source ? [] : [before[edge.line - 1]]);
      }
    });

    it("renames each node and subgraph", () => {
      for (const id of [...chart.nodes.keys(), ...chart.subgraphs.keys()]) {
        for (const text of ["Renamed", 'List<String> "x" (y)']) {
          const result = renameFlow(source, id, text),
            after = parseFlowchart(result);
          expect(nodesOf(result), id).toEqual(nodesOf(source));
          expect((after.nodes.get(id) ?? after.subgraphs.get(id))!.label, id).toBe(text);
          expect(after.edges.map((edge) => [edge.source, edge.target, edge.label])).toEqual(
            chart.edges.map((edge) => [edge.source, edge.target, edge.label]),
          );
          for (const node of after.nodes.values()) {
            expect(node.parent).toBe(chart.nodes.get(node.id)!.parent);
            if (node.id !== id) expect(node.label).toBe(chart.nodes.get(node.id)!.label);
          }
          const lost = changed(result);
          expect(lost, id).toHaveLength(1);
          expect(lines(result), id).toHaveLength(before.length);
          expect(mentions(lost[0], id), id).toBe(true);
        }
      }
    });
  },
);

/** The lines of `before` that `after` no longer has, and the ones it has anew. */
function delta(before: string, after: string) {
  const old = lines(before),
    now = lines(after);
  return {
    lost: old.filter((line) => !now.includes(line)),
    added: now.filter((line) => !old.includes(line)),
  };
}

const parentOf = (source: string, id: string) => {
  const chart = parseFlowchart(source);
  return (chart.nodes.get(id) ?? chart.subgraphs.get(id))?.parent;
};

const STYLED = `${FLOW}\n  class ship,wait hot\n  linkStyle 1,5 stroke:red\n  click wait call f()`;

describe("restructuring an activity diagram", () => {
  it("turns a flow round, in place where it is a statement of its own", () => {
    expect(delta(FLOW, reverseFlow(FLOW, "e1"))).toEqual({
      lost: ["  start((Start)) --> check{In stock?}"],
      added: ["  check{In stock?} --> start((Start))"],
    });
    // The label, the stroke and the end marks stay with the arrow.
    expect(delta(FLOW, reverseFlow(FLOW, "e2"))).toEqual({
      lost: ["  check -->|yes| ship[Ship order]"],
      added: ["  ship[Ship order] -->|yes| check"],
    });
    expect(reverseFlow("flowchart LR\n  a -. maybe .-o b", "e1")).toBe(
      "flowchart LR\n  b -. maybe .-o a",
    );
    expect(reverseFlow("flowchart LR\n  a==>b", "e1")).toBe("flowchart LR\n  b ==> a");
    // Out of a chain and out of a list, where it stood; the rest as it was written.
    expect(reverseFlow("flowchart LR\n  a[A] --> b --> c[C] --> d", "e2")).toBe(
      "flowchart LR\n  a[A] --> b\n  c[C] --> b\n  c --> d",
    );
    expect(reverseFlow("flowchart LR\n  a --> b[B] --> c", "e1")).toBe(
      "flowchart LR\n  b[B] --> a\n  b --> c",
    );
    expect(delta(FLOW, reverseFlow(FLOW, "e7"))).toEqual({
      lost: ["  ship --> done(((End))) & x"],
      added: ["  ship --> done(((End)))", "  x --> ship"],
    });
    // Inside its subgraph, and `linkStyle` counts the same edges.
    const inner = reverseFlow(STYLED, "e5");
    expect(inner).toContain("    y[Also inside] --> x[Inside]\n");
    expect(inner).toContain("linkStyle 1,5 stroke:red");
    const list = "flowchart LR\n  a & b --> c\n  c --> d\n  linkStyle 0,1,2 stroke:red";
    expect(reverseFlow(list, "e1")).toBe(
      "flowchart LR\n  c --> a\n  b --> c\n  c --> d\n  linkStyle 0,1,2 stroke:red",
    );
    expect(edges(reverseFlow(LANES, "e3"))).toEqual(["start>order", "check>ship", "check>order"]);
    // A flow of a node to itself, and what is no flow.
    expect(reverseFlow("flowchart LR\n  a --> a", "e1")).toBe("flowchart LR\n  a --> a");
    expect(reverseFlow(FLOW, "e99")).toBe(FLOW);
    expect(reverseFlow(FLOW, "ship")).toBe(FLOW);
    expect(activityStructure.reverse!(FLOW, "e4")).toContain("  check --> wait\n");
  });

  it("copies a node beside it, without its flows", () => {
    const copy = duplicateFlowNode(FLOW, "check");
    expect(copy.id).toBe("check2");
    expect(delta(FLOW, copy.source)).toEqual({ lost: [], added: ["  check2{In stock?}"] });
    expect(copy.source.endsWith("  check2{In stock?}\n  style wait fill:#eee")).toBe(true);
    expect(duplicateFlowNode(copy.source, "check").id).toBe("check3");
    expect(duplicateFlowNode(copy.source, "check2").id).toBe("check3");
    // In its subgraph or lane, with the shape it has.
    const inner = duplicateFlowNode(FLOW, "y");
    expect(inner.source).toContain("    x[Inside] --> y[Also inside]\n    y2[Also inside]\n  end");
    const lane = duplicateFlowNode(LANES, "ship");
    expect(parseFlowchart(lane.source).nodes.get("ship2")).toMatchObject({
      parent: "Shop",
      shape: "round",
      label: "Ship Goods",
    });
    // A node written by its id alone shows that id, and so does its copy.
    expect(duplicateFlowNode("flowchart LR\n  a --> b:::hot", "b").source).toBe(
      "flowchart LR\n  a --> b:::hot\n  b2[b]:::hot",
    );
    expect(duplicateFlowNode("flowchart LR\n  f@{ shape: fork } --> a", "f").source).toContain(
      "\n  f2@{ shape: fork }",
    );
    expect(duplicateFlowNode(FLOW, "part")).toEqual({ source: FLOW, id: "" });
    expect(duplicateFlowNode(FLOW, "nothing")).toEqual({ source: FLOW, id: "" });
    // The first name of a copy becomes its id.
    expect(isGeneratedFlowId(copy.source, "check2")).toBe(true);
    expect(isGeneratedFlowId(copy.source, "check")).toBe(false);
    expect(isGeneratedFlowId(FLOW, "nothing")).toBe(false);
    expect(isGeneratedFlowId("no diagram", "a")).toBe(false);
    expect(retitleFlow(copy.source, "check2", "Paid for?")).toMatchObject({ id: "paidFor" });
    expect(retitleFlow(copy.source, "check2", "Paid for?").source).toContain(
      "  paidFor{Paid for?}",
    );
    expect(retitleFlow(copy.source, "check", "Paid for?").id).toBe("check");
    expect(activityStructure.copy!(FLOW, "wait").id).toBe("wait2");
  });

  it("gives a node or a subgraph another id at every mention", () => {
    const renamed = renameFlowId(STYLED, "wait", "hold");
    expect(delta(STYLED, renamed)).toEqual({
      lost: [
        "  check -->|no| wait[Wait for supply]",
        "  wait --> check",
        "  style wait fill:#eee",
        "  class ship,wait hot",
        "  click wait call f()",
      ],
      added: [
        "  check -->|no| hold[Wait for supply]",
        "  hold --> check",
        "  style hold fill:#eee",
        "  class ship,hold hot",
        "  click hold call f()",
      ],
    });
    expect(renameFlowId("flowchart LR\n  a --> b & a", "a", "z")).toBe(
      "flowchart LR\n  z --> b & z",
    );
    // A subgraph keeps its name, also one that was named by its id.
    expect(renameFlowId(FLOW, "part", "inner")).toContain("  subgraph inner [A part]\n");
    expect(renameFlowId(LANES, "Customer", "Client")).toContain("  subgraph Client [Customer]\n");
    expect(
      renameFlowId('flowchart LR\n  subgraph "My group"\n    a\n  end', "subgraph#1", "mine"),
    ).toBe("flowchart LR\n  subgraph mine [My group]\n    a\n  end");
    const edged = "flowchart LR\n  subgraph g [G]\n    a\n  end\n  b --> g";
    expect(renameFlowId(edged, "g", "h")).toBe(
      "flowchart LR\n  subgraph h [G]\n    a\n  end\n  b --> h",
    );
    // An id that is none, that is a word of the syntax, or that is taken.
    for (const id of ["two words", "end", "subgraph", "check", "part", "", "a[b]", "x-->y"])
      expect(renameFlowId(FLOW, "wait", id), id).toBe(FLOW);
    expect(renameFlowId(FLOW, "nothing", "z")).toBe(FLOW);
    expect(renameFlowId("flowchart LR\n  subgraph\n    a\n  end", "subgraph#1", "z")).toBe(
      "flowchart LR\n  subgraph\n    a\n  end",
    );
    expect(renameFlowId(FLOW, "wait", "warte-zeit")).toContain("warte-zeit --> check");
    expect(activityStructure.reid!(FLOW, "wait", "hold")).toContain("hold --> check");
  });

  it("moves a node into a subgraph or lane and out of it", () => {
    // Into a lane further down: its flow in the lane it leaves is written behind that lane.
    expect(moveFlowInto(LANES, "order", "Shop")).toBe(
      `swimlane-beta TB
  subgraph Customer
    start((Start))
  end
  start --> order
  subgraph Shop
    check(Check Order) --> ship(Ship Goods)
    order(Place Order)
  end
  order --> check`,
    );
    // Into a lane further up: the declaration moves, the flow stays where it is.
    expect(moveFlowInto(LANES, "check", "Customer")).toBe(
      `swimlane-beta TB
  subgraph Customer
    start((Start)) --> order(Place Order)
    check(Check Order)
  end
  subgraph Shop
    check --> ship(Ship Goods)
  end
  order --> check`,
    );
    for (const [id, lane] of [
      ["order", "Shop"],
      ["check", "Customer"],
      ["start", "Shop"],
      ["ship", "Customer"],
    ]) {
      const moved = moveFlowInto(LANES, id, lane);
      expect(parentOf(moved, id), id).toBe(lane);
      expect(edges(moved).toSorted(), id).toEqual(edges(LANES).toSorted());
      // And back.
      const back = moveFlowInto(moved, id, parentOf(LANES, id)!);
      expect(parentOf(back, id), id).toBe(parentOf(LANES, id));
      expect(nodesOf(back)).toEqual(nodesOf(LANES));
    }
    // A node of the root that flows only mention gets its declaration there.
    const inside = moveFlowInto(STYLED, "wait", "part");
    expect(delta(STYLED, inside)).toEqual({
      lost: ["  check -->|no| wait[Wait for supply]"],
      added: ["  check -->|no| wait", "    wait[Wait for supply]"],
    });
    expect(inside).toContain("    x[Inside] --> y[Also inside]\n    wait[Wait for supply]\n  end");
    expect(moveFlowInto("flowchart LR\n  a --> b\n  subgraph g\n  end", "b", "g")).toBe(
      "flowchart LR\n  a --> b\n  subgraph g\n    b\n  end",
    );
    // Out to the root: its flows inside go with it, the node at their other end stays.
    const out = moveFlowInto(STYLED, "x", null);
    expect(delta(STYLED, out)).toEqual({
      lost: ["    x[Inside] --> y[Also inside]"],
      added: ["    y[Also inside]", "  x[Inside] --> y"],
    });
    expect(parentOf(out, "x")).toBeNull();
    expect(parentOf(out, "y")).toBe("part");
    expect(out).toContain("linkStyle 1,5 stroke:red");
    expect(parseFlowchart(out).edges[4]).toMatchObject({ source: "x", target: "y" });
    // A node on a line of its own takes that line along.
    const alone =
      "flowchart LR\n  subgraph g\n    a[A]\n    b\n  end\n  subgraph h\n  end\n  a --> b";
    expect(moveFlowInto(alone, "a", "h")).toBe(
      "flowchart LR\n  subgraph g\n    b\n  end\n  subgraph h\n    a[A]\n  end\n  a --> b",
    );
    expect(moveFlowInto(alone, "a", null)).toBe(
      "flowchart LR\n  subgraph g\n    b\n  end\n  a[A]\n  subgraph h\n  end\n  a --> b",
    );
    // Into the subgraph around its own, and into one inside it.
    const nested =
      "flowchart LR\n  subgraph outer\n    subgraph inner\n      a --> b\n    end\n    c\n  end";
    const up = moveFlowInto(nested, "a", "outer");
    expect(parentOf(up, "a")).toBe("outer");
    expect(parentOf(up, "b")).toBe("inner");
    expect(up).toBe(
      "flowchart LR\n  subgraph outer\n    subgraph inner\n      b\n    end\n    a --> b\n    c\n  end",
    );
    expect(parentOf(moveFlowInto(nested, "c", "inner"), "c")).toBe("inner");
    // A chain and a list keep the flows of the others.
    const chain =
      "flowchart LR\n  subgraph g\n    a --> b[B] --> c & d\n  end\n  subgraph h\n  end";
    const b = moveFlowInto(chain, "b", "h");
    expect(parentOf(b, "b")).toBe("h");
    for (const id of ["a", "c", "d"]) expect(parentOf(b, id), id).toBe("g");
    expect(edges(b).toSorted()).toEqual(edges(chain).toSorted());
    // What cannot be.
    expect(moveFlowInto(LANES, "order", "Customer")).toBe(LANES);
    expect(moveFlowInto(FLOW, "wait", null)).toBe(FLOW);
    expect(moveFlowInto(FLOW, "wait", "nothing")).toBe(FLOW);
    expect(moveFlowInto(FLOW, "part", null)).toBe(FLOW);
    expect(moveFlowInto(FLOW, "nothing", "part")).toBe(FLOW);
    // A swimlane keeps its nodes in lanes, unless it has nodes outside them already.
    expect(moveFlowInto(LANES, "order", null)).toBe(LANES);
    const [, loose] = SWIMLANE_EXAMPLES.find(([name]) => name.includes("loose nodes"))!;
    expect(parentOf(moveFlowInto(loose, "a", null), "a")).toBeNull();
    expect(parentOf(moveFlowInto(loose, "review", "Team"), "review")).toBe("Team");
    expect(activityStructure.moveInto!(LANES, "order", "Shop")).toBe(
      moveFlowInto(LANES, "order", "Shop"),
    );
  });

  it("takes a subgraph away and keeps what it holds", () => {
    const flat = ungroupFlow(STYLED, "part");
    expect(delta(STYLED, flat)).toEqual({
      lost: ["  subgraph part [A part]", "    x[Inside] --> y[Also inside]", "  end"],
      added: ["  x[Inside] --> y[Also inside]"],
    });
    expect(edges(flat)).toEqual(edges(STYLED));
    // Its direction, its style and the flows to it go with it; the edges are counted anew.
    const whole = `flowchart TB
  subgraph g [G]
    direction LR
    subgraph h
      b --> c
    end
    d
  end
  a --> g
  g --> e --> b
  style g fill:#eee
  class g,a hot
  linkStyle 0,1,3 stroke:red`;
    expect(ungroupFlow(whole, "g")).toBe(`flowchart TB
  subgraph h
    b --> c
  end
  d
  a
  e --> b
  class a hot
  linkStyle 0,1 stroke:red`);
    expect(parentOf(ungroupFlow(whole, "h"), "b")).toBe("g");
    // A lane leaves its nodes outside the lanes; the last lane with nodes stays.
    const customer = ungroupFlow(LANES, "Customer");
    expect(customer).toBe(
      "swimlane-beta TB\n  start((Start)) --> order(Place Order)\n  subgraph Shop\n    check(Check Order) --> ship(Ship Goods)\n  end\n  order --> check",
    );
    expect(ungroupFlow(customer, "Shop")).toBe(customer);
    expect(ungroupFlow("swimlane-beta TB\n  subgraph A\n  end", "A")).toBe("swimlane-beta TB");
    // A node another subgraph mentions further down stays where the subgraph stood.
    const shared =
      "flowchart LR\n  subgraph g\n    a --> b\n  end\n  subgraph h\n    b --> c\n  end";
    const freed = ungroupFlow(shared, "g");
    expect(parentOf(freed, "b")).toBeNull();
    expect(parentOf(freed, "c")).toBe("h");
    expect(edges(freed).toSorted()).toEqual(edges(shared).toSorted());
    expect(ungroupFlow(FLOW, "wait")).toBe(FLOW);
    expect(ungroupFlow(FLOW, "nothing")).toBe(FLOW);
    expect(activityStructure.ungroup!(FLOW, "part")).not.toContain("subgraph");
  });

  it("wraps nodes in a new subgraph", () => {
    // The statements about them alone go into it, where the first of them stood.
    const loop = groupFlowNodes(STYLED, ["check", "wait"], "Loop");
    expect(loop.id).toBe("group1");
    expect(loop.source).toContain(
      "  check -->|yes| ship[Ship order]\n  subgraph group1 [Loop]\n    check -->|no| wait[Wait for supply]\n    wait --> check\n  end\n  subgraph part",
    );
    expect(edges(loop.source)).toEqual(edges(STYLED));
    expect(loop.source).toContain("linkStyle 1,5 stroke:red");
    // Nodes no such statement mentions get a line each, with the shape they are declared with.
    const shipping = groupFlowNodes(FLOW, ["ship", "done"], "Shipping & more");
    expect(delta(FLOW, shipping.source)).toEqual({
      lost: ["  check -->|yes| ship[Ship order]", "  ship --> done(((End))) & x"],
      added: [
        '  subgraph group1 ["Shipping & more"]',
        "    ship[Ship order]",
        "    done(((End)))",
        "  check -->|yes| ship",
        "  ship --> done & x",
      ],
    });
    for (const id of ["ship", "done"]) expect(parentOf(shipping.source, id)).toBe("group1");
    // Inside the subgraph they stand in.
    const inner = groupFlowNodes(FLOW, ["x", "y"], "Inner");
    expect(inner.source).toContain(
      "  subgraph part [A part]\n    subgraph group1 [Inner]\n      x[Inside] --> y[Also inside]\n    end\n  end",
    );
    expect(parentOf(inner.source, "group1")).toBe("part");
    const one = groupFlowNodes(FLOW, ["x"], "One");
    expect(parentOf(one.source, "x")).toBe("group1");
    expect(parentOf(one.source, "y")).toBe("part");
    expect(parentOf(one.source, "group1")).toBe("part");
    // Nodes that stand apart move into a subgraph of the root.
    const apart = groupFlowNodes(FLOW, ["wait", "y", "part", "nothing"], "Mixed");
    expect(parentOf(apart.source, "wait")).toBe(apart.id);
    expect(parentOf(apart.source, "y")).toBe(apart.id);
    expect(parentOf(apart.source, "x")).toBe("part");
    expect(parentOf(apart.source, apart.id)).toBeNull();
    expect(edges(apart.source).toSorted()).toEqual(edges(FLOW).toSorted());
    // In a swimlane the subgraph is a lane.
    const lane = groupFlowNodes(LANES, ["order", "check"], "Desk");
    expect(lane.id).toBe("lane1");
    expect(parseFlowchart(lane.source).subgraphs.get("lane1")).toMatchObject({
      label: "Desk",
      parent: null,
    });
    for (const id of ["order", "check"]) expect(parentOf(lane.source, id)).toBe("lane1");
    expect(edges(lane.source).toSorted()).toEqual(edges(LANES).toSorted());
    expect(groupFlowNodes(FLOW, ["part", "nothing"], "None")).toEqual({ source: FLOW, id: "" });
    expect(groupFlowNodes(FLOW, [], "None")).toEqual({ source: FLOW, id: "" });
  });

  it("adds a piece joined to a node in one statement", () => {
    const step = attachFlow(FLOW, { kind: "step", label: "Pack" }, "ship");
    expect(step).toMatchObject({ id: "step1", edge: "e8" });
    expect(delta(FLOW, step.source)).toEqual({ lost: [], added: ["  ship --> step1[Pack]"] });
    // Its first name, written in the flow.
    expect(retitleFlow(step.source, "step1", "Pack parcel")).toMatchObject({ id: "packParcel" });
    expect(retitleFlow(step.source, "step1", "Pack parcel").source).toContain(
      "  ship --> packParcel[Pack parcel]\n",
    );
    expect(attachFlow(FLOW, { kind: "decision" }, "ship").source).toContain(
      "  ship --> decision1{ }\n",
    );
    // An end is the small symbol from the start, a start leads.
    const end = attachFlow(FLOW, { kind: "end" }, "wait");
    expect(end.source).toContain("  wait --> end1(((End)))\n");
    expect(parseFlowchart(end.source).nodes.get("end1")!.shape).toBe("final");
    const start = attachFlow(LANES, { kind: "start" }, "check");
    expect(start).toMatchObject({ id: "start1", edge: "e3" });
    expect(start.source).toContain(
      "    check(Check Order) --> ship(Ship Goods)\n    start1((Start)) --> check\n  end",
    );
    expect(parseFlowchart(start.source).nodes.get("start1")).toMatchObject({
      shape: "initial",
      parent: "Shop",
    });
    // In the subgraph of the node, and the edges after it count on.
    const inner = attachFlow(STYLED, { kind: "step" }, "y");
    expect(inner).toMatchObject({ id: "step1", edge: "e6" });
    expect(inner.source).toContain("    y --> step1[Step]\n  end");
    expect(inner.source).toContain("linkStyle 1,6 stroke:red");
    expect(parentOf(inner.source, "step1")).toBe("part");
    // Beside a node in no lane.
    const [, loose] = SWIMLANE_EXAMPLES.find(([name]) => name.includes("loose nodes"))!;
    expect(parentOf(attachFlow(loose, { kind: "step" }, "review").source, "step1")).toBeNull();
    expect(parentOf(attachFlow(loose, { kind: "step" }, "a").source, "step1")).toBe("Team");
    // What cannot be.
    const none = (source: string) => ({ source, id: "", edge: "" });
    expect(attachFlow(FLOW, { kind: "group" }, "ship")).toEqual(none(FLOW));
    expect(attachFlow(FLOW, { kind: "step" }, "nothing")).toEqual(none(FLOW));
    expect(attachFlow(LANES, { kind: "step" }, "Shop")).toEqual(none(LANES));
    expect(attachFlow(FLOW, { kind: "step" }, "part").source).toContain("  part --> step1[Step]\n");
  });

  it("says which flow it wrote", () => {
    expect(joinFlow(FLOW, "wait", "done")).toMatchObject({ edge: "e8" });
    const inner = joinFlow(FLOW, "y", "x");
    expect(inner.edge).toBe("e6");
    expect(parseFlowchart(inner.source).edges[5]).toMatchObject({ source: "y", target: "x" });
    expect(joinFlow(FLOW, "wait", "check")).toEqual({ source: FLOW, edge: "" });
    expect(activityStructure.join!(FLOW, "y", "x", "dotted").edge).toBe("e6");
    expect(parseFlowchart(joinFlow(FLOW, "y", "x", "flow", "back").source).edges[5].label).toBe(
      "back",
    );
  });

  it("puts a new node into a flow", () => {
    // Within its chain: the label stays on the first half.
    const picked = insertFlowOnEdge(STYLED, "e2", { kind: "step", label: "Pick" });
    expect(picked.id).toBe("step1");
    expect(delta(STYLED, picked.source)).toEqual({
      lost: ["  check -->|yes| ship[Ship order]", "  linkStyle 1,5 stroke:red"],
      added: ["  check -->|yes| step1[Pick] --> ship[Ship order]", "  linkStyle 1,6 stroke:red"],
    });
    expect(
      insertFlowOnEdge("flowchart LR\n  a --> b --> c", "e1", { kind: "decision" }).source,
    ).toBe("flowchart LR\n  a --> decision1{ } --> b --> c");
    // The second half has the stroke of the first.
    expect(
      insertFlowOnEdge("flowchart LR\n  a -. maybe .-> b", "e1", { kind: "step" }).source,
    ).toBe("flowchart LR\n  a -. maybe .-> step1[Step] -.-> b");
    expect(insertFlowOnEdge("flowchart LR\n  a ==> b", "e1", { kind: "step" }).source).toBe(
      "flowchart LR\n  a ==> step1[Step] ==> b",
    );
    // A circle or a cross at its end moves to the second half, a line without a head stays one.
    expect(insertFlowOnEdge("flowchart LR\n  a o--o|x| b", "e1", { kind: "step" }).source).toBe(
      "flowchart LR\n  a o-->|x| step1[Step] --o b",
    );
    expect(insertFlowOnEdge("flowchart LR\n  a -- x --x b", "e1", { kind: "step" }).source).toBe(
      "flowchart LR\n  a -- x --> step1[Step] --x b",
    );
    expect(insertFlowOnEdge("flowchart LR\n  a --- b", "e1", { kind: "step" }).source).toBe(
      "flowchart LR\n  a --- step1[Step] --- b",
    );
    // Out of a list.
    const listed = insertFlowOnEdge(FLOW, "e7", { kind: "step" });
    expect(delta(FLOW, listed.source)).toEqual({
      lost: ["  ship --> done(((End))) & x"],
      added: ["  ship --> done(((End)))", "  ship --> step1[Step] --> x"],
    });
    // Inside a subgraph the node stands there; between two lanes in the lane the flow leaves.
    expect(parentOf(insertFlowOnEdge(FLOW, "e5", { kind: "step" }).source, "step1")).toBe("part");
    const lane = insertFlowOnEdge(LANES, "e3", { kind: "step", label: "Pay" });
    expect(lane.source).toBe(
      `swimlane-beta TB
  subgraph Customer
    start((Start)) --> order(Place Order)
    step1(Pay)
  end
  subgraph Shop
    check(Check Order) --> ship(Ship Goods)
  end
  order --> step1 --> check`,
    );
    const [, loose] = SWIMLANE_EXAMPLES.find(([name]) => name.includes("loose nodes"))!;
    expect(parentOf(insertFlowOnEdge(loose, "e3", { kind: "step" }).source, "step1")).toBeNull();
    expect(insertFlowOnEdge(FLOW, "e99", { kind: "step" })).toEqual({ source: FLOW, id: "" });
    expect(insertFlowOnEdge(FLOW, "e1", { kind: "group" })).toEqual({ source: FLOW, id: "" });
  });

  it("offers yes and no for the flows out of a decision", () => {
    const fresh = "flowchart LR\n  a --> d{Ok?}";
    expect(nextBranchLabel(fresh, "d")).toBe("yes");
    const one = connectFlow(fresh, "d", "a");
    expect(nextBranchLabel(one, "d")).toBe("yes");
    expect(nextBranchLabel(labelFlowEdge(one, "e2", "Yes"), "d")).toBe("no");
    expect(nextBranchLabel(labelFlowEdge(one, "e2", "no"), "d")).toBe("yes");
    expect(nextBranchLabel(FLOW, "check")).toBeUndefined();
    expect(nextBranchLabel(labelFlowEdge(one, "e2", "else"), "d")).toBeUndefined();
    expect(nextBranchLabel(FLOW, "ship")).toBeUndefined();
    expect(nextBranchLabel(FLOW, "nothing")).toBeUndefined();
    expect(nextBranchLabel("no diagram", "d")).toBeUndefined();
  });
});

describe("an activity diagram with lanes and without", () => {
  const PLAIN = `---
title: Shipping
---
%% level design
flowchart LR
  start((Start)) --> ship[Ship order]
  %% the usual way
  ship --> done(((End)))`;

  it("takes its first lane under a `swimlane-beta` header, keeping the title, the direction and the comments", () => {
    const { source, id } = activityStructure.add(PLAIN, { kind: "lane", label: "Shop" });
    expect(id).toBe("lane1");
    expect(source).toBe(`---
title: Shipping
---
%% level design
swimlane-beta LR
  start((Start)) --> ship[Ship order]
  %% the usual way
  ship --> done(((End)))
  subgraph lane1 [Shop]
  end`);
    const chart = parseFlowchart(source);
    expect([chart.kind, chart.direction, chart.title, chart.level]).toEqual([
      "swimlane",
      "LR",
      "Shipping",
      "design",
    ]);
    // The nodes outside the new lane stand in the lane without a name.
    expect(chart.nodes.get("ship")!.parent).toBeNull();
    // The places of a layout without lanes go with the header, both ways: the lanes lay out anew.
    const placed = `${PLAIN}\n%% @start 0,0\n%% @ship 120,0\n`,
      lanes = activityStructure.add(placed, { kind: "lane" }).source;
    expect(lanes).not.toContain("%% @");
    expect(activityStructure.remove(`${lanes}\n%% @ship 40,40\n`, ["lane1"])).toBe(`${PLAIN}\n`);
    // Other edits keep them.
    expect(activityStructure.add(placed, { kind: "step" }).source).toContain("%% @ship 120,0");
  });

  it("is a flowchart again once its last lane goes, removed or ungrouped", () => {
    const laned = activityStructure.add(PLAIN, { kind: "lane", label: "Shop" }).source;
    expect(activityStructure.remove(laned, ["lane1"])).toBe(PLAIN);
    const holding = activityStructure.moveInto!(laned, "ship", "lane1");
    expect(parseFlowchart(holding).nodes.get("ship")!.parent).toBe("lane1");
    const flat = activityStructure.ungroup!(holding, "lane1");
    expect(flat.split("\n")[4]).toBe("flowchart LR");
    expect(parseFlowchart(flat).nodes.get("ship")!.parent).toBeNull();
    // With other lanes left the header stays.
    expect(activityStructure.remove(LANES, ["Shop"]).split("\n")[0]).toBe("swimlane-beta TB");
    expect(activityStructure.ungroup!(LANES, "Shop").split("\n")[0]).toBe("swimlane-beta TB");
    // A `graph` header becomes `flowchart` with lanes gone, a `swimlane-beta` one without lanes stays one.
    const graph = activityStructure.add("graph TD\n  a --> b", { kind: "lane" }).source;
    expect(graph.split("\n")[0]).toBe("swimlane-beta TD");
    expect(activityStructure.remove(graph, ["lane1"])).toBe("flowchart TD\n  a --> b");
    expect(activityStructure.remove("swimlane-beta TB\n  a --> b", ["b"])).toBe(
      "swimlane-beta TB\n  a",
    );
  });

  it("does not mix lanes and groups", () => {
    expect(activityRefusal(LANES, "group")).toMatch(/^Lanes and groups do not mix: .*add a lane/);
    expect(activityRefusal(FLOW, "lane")).toMatch(/^Lanes and groups do not mix: .*ungroup/);
    for (const kind of ["step", "decision", "start", "end", "lane"])
      expect(activityRefusal(LANES, kind), kind).toBeUndefined();
    for (const kind of ["step", "decision", "start", "end", "group"])
      expect(activityRefusal(FLOW, kind), kind).toBeUndefined();
    expect(activityRefusal(PLAIN, "lane")).toBeUndefined();
    expect(activityRefusal(PLAIN, "group")).toBeUndefined();
    expect(activityRefusal("flowchart TB\n  a -->", "lane")).toBeUndefined();
    expect(activityStructure.refusal).toBe(activityRefusal);
    // What is refused is not added.
    expect(activityStructure.add(LANES, { kind: "group" })).toEqual({ source: LANES, id: "" });
    expect(activityStructure.add(FLOW, { kind: "lane" })).toEqual({ source: FLOW, id: "" });
    // A `swimlane-beta` source without lanes takes a group as a flowchart.
    const grouped = activityStructure.add("swimlane-beta TB\n  a --> b", { kind: "group" });
    expect(grouped.source).toBe("flowchart TB\n  a --> b\n  subgraph group1 [Group]\n  end");
  });
});

describe("lanes of a swimlane", () => {
  it("are parts of their own kind", () => {
    expect(activityStructure.pieces.map((piece) => piece.kind)).toEqual([
      "step",
      "decision",
      "start",
      "end",
      "lane",
      "group",
    ]);
    expect(activityStructure.pieces[4]).toMatchObject({ name: "Lane", group: true });
    expect(activityStructure.pieces[5]).toMatchObject({ name: "Group", group: true });
    const kinds = (source: string) =>
      activityStructure
        .read(source)
        .nodes.filter((node) => node.group)
        .map((node) => node.kind);
    expect(kinds(LANES)).toEqual(["lane", "lane"]);
    expect(kinds(FLOW)).toEqual(["group"]);
    const lane = activityStructure.add(LANES, { kind: "lane" });
    expect(lane.id).toBe("lane1");
    expect(lane.source).toContain("  end\n  subgraph lane1 [Lane]\n  end\n  order --> check");
    expect(activityStructure.retitle!(lane.source, "lane1", "Bank")).toMatchObject({ id: "Bank" });
  });

  it("take a piece when they hold nothing, and leave one beside a node in no lane where it is", () => {
    const empty = addFlowPiece(LANES, { kind: "lane", label: "Bank" }),
      three = addFlowPiece(empty.source, { kind: "lane", label: "Carrier" });
    for (const kind of ["step", "decision", "start", "end"] as const) {
      const added = addFlowPiece(three.source, { kind, parent: "lane1" });
      expect(parentOf(added.source, added.id), kind).toBe("lane1");
      expect(
        lines(added.source)[lines(added.source).indexOf("  subgraph lane1 [Bank]") + 1],
      ).toMatch(new RegExp(`^    ${added.id}\\W`));
    }
    // A diagram of lanes alone.
    const only = "swimlane-beta TB\n  subgraph A\n  end\n  subgraph B\n  end\n  subgraph C\n  end";
    const second = addFlowPiece(only, { kind: "step", label: "Do", parent: "B" });
    expect(second.source).toBe(
      "swimlane-beta TB\n  subgraph A\n  end\n  subgraph B\n    step1(Do)\n  end\n  subgraph C\n  end",
    );
    expect(parentOf(addFlowPiece(only, { kind: "step" }).source, "step1")).toBe("A");
    // Beside the nodes outside the lanes.
    const [, loose] = SWIMLANE_EXAMPLES.find(([name]) => name.includes("loose nodes"))!;
    for (const kind of ["step", "decision", "start", "end"] as const) {
      const added = addFlowPiece(loose, { kind, parent: null });
      expect(parentOf(added.source, added.id), kind).toBeNull();
      const joined = joinFlow(added.source, "review", added.id);
      expect(parentOf(joined.source, added.id), kind).toBeNull();
      expect(parentOf(joined.source, "review")).toBeNull();
    }
  });
});

describe("what styles a part, when the part goes", () => {
  it("drops the node from `class` and `style`, its `click`, and counts `linkStyle` anew", () => {
    const styled = `flowchart TB
  a[A] --> b[B] --> c[C]
  b --> d
  classDef hot fill:#f00
  class a,b hot
  class c hot
  style b stroke:#000
  click b call open()
  linkStyle 0,2 stroke:red
  linkStyle 1 stroke:blue
  linkStyle default stroke:grey`;
    expect(delta(styled, removeFlow(styled, ["b"]))).toEqual({
      lost: [
        "  a[A] --> b[B] --> c[C]",
        "  b --> d",
        "  class a,b hot",
        "  style b stroke:#000",
        "  click b call open()",
        "  linkStyle 0,2 stroke:red",
        "  linkStyle 1 stroke:blue",
      ],
      added: ["  a[A]", "  c[C]", "  d", "  class a hot"],
    });
    // A node that is all a statement styles takes the statement along.
    expect(removeFlow(styled, ["c"])).not.toContain("class c hot");
    expect(removeFlow(styled, ["c"])).toContain("  linkStyle 0,1 stroke:red\n");
    expect(removeFlow(styled, ["c"])).not.toContain("stroke:blue");
    // An edge that goes: the ones after it count one less.
    const cut = removeFlow(styled, ["e1"]);
    expect(cut).toContain("  linkStyle 1 stroke:red\n  linkStyle 0 stroke:blue\n");
    expect(cut).toContain("  class a,b hot\n");
    expect(removeFlow(styled, ["e3"])).toContain(
      "  linkStyle 0 stroke:red\n  linkStyle 1 stroke:blue",
    );
    expect(removeFlow(styled, ["a", "c", "d"])).toContain("  class b hot\n  style b stroke:#000\n");
    // A subgraph with what it holds and what styles either.
    const grouped = `flowchart TB
  subgraph g [G]
    a --> b
  end
  x --> g
  b --> y
  class g,x,a hot
  style g fill:#eee
  linkStyle 1,2 stroke:red`;
    expect(removeFlow(grouped, ["g"])).toBe("flowchart TB\n  x\n  y\n  class x hot");
  });
});

describe.each([...FLOWCHART_EXAMPLES, ...SWIMLANE_EXAMPLES])(
  "restructuring the example %s",
  (_, source) => {
    const chart = parseFlowchart(source),
      before = lines(source),
      real = [...chart.subgraphs.keys()],
      signed = (text: string) =>
        parseFlowchart(text)
          .edges.map((edge) => `${edge.source}>${edge.target}:${edge.label ?? ""}:${edge.stroke}`)
          .toSorted();
    /** Every line of the source that the result does not have as it was written. */
    const lost = (result: string) => {
      const now = lines(result);
      return before.filter((line) => {
        const at = now.indexOf(line);
        if (at < 0) return true;
        now.splice(at, 1);
        return false;
      });
    };
    const mentions = (line: string, id: string) => line.split(/[^\p{L}\p{N}_]+/u).includes(id);
    const others = (result: string, but: string[]) => {
      const after = parseFlowchart(result);
      for (const node of chart.nodes.values())
        if (!but.includes(node.id))
          expect(after.nodes.get(node.id)?.parent, node.id).toBe(node.parent);
      for (const group of chart.subgraphs.values())
        if (!but.includes(group.id))
          expect(after.subgraphs.get(group.id)?.parent, group.id).toBe(group.parent);
    };
    /** Every part is a shape of the scene, every join a wire. */
    const drawn = async (result: string, hint: string) => {
      const { parseUml } = await import("../src/index.ts"),
        { arialMeasure } = await import("../src/arial-measure.ts");
      const scene = await parseUml(result).layout(arialMeasure),
        shapes = new Set(scene.shapes.map((shape) => shape.id)),
        wires = new Set(scene.wires.map((wire) => wire.edge)),
        read = activityStructure.read(result);
      for (const node of read.nodes)
        if (!node.group) expect(shapes.has(node.id), `${hint} ${node.id}`).toBe(true);
      // A flow that only says where its ends stand is not drawn.
      for (const edge of parseFlowchart(result).edges)
        if (edge.stroke !== "invisible")
          expect(wires.has(edge.id), `${hint} ${edge.id}`).toBe(true);
      expect(read.edges).toHaveLength(parseFlowchart(result).edges.length);
    };

    it("turns each flow round", async () => {
      for (const [index, edge] of chart.edges.entries()) {
        const result = reverseFlow(source, edge.id);
        if (edge.source === edge.target) {
          expect(result).toBe(source);
          continue;
        }
        let after: ReturnType<typeof parseFlowchart> | undefined;
        try {
          after = parseFlowchart(result);
        } catch {
          // What turning it makes is no diagram: a loop on a symbol, a flow into a lane.
        }
        if (!after || result === source) continue;
        expect(nodesOf(result), edge.id).toEqual(nodesOf(source));
        expect(signed(result), edge.id).toEqual(
          chart.edges
            .map((other, at) =>
              at === index
                ? `${edge.target}>${edge.source}:${edge.label ?? ""}:${edge.stroke}`
                : `${other.source}>${other.target}:${other.label ?? ""}:${other.stroke}`,
            )
            .toSorted(),
        );
        others(result, []);
        expect(lost(result), edge.id).toEqual([before[edge.line - 1]]);
        // Turned back, the flows are the ones there were.
        const made = after.edges.find(
          (other) =>
            other.source === edge.target && other.target === edge.source && other.line >= edge.line,
        );
        if (made) expect(signed(reverseFlow(result, made.id)), edge.id).toEqual(signed(source));
      }
      const [first] = chart.edges;
      if (first && reverseFlow(source, first.id) !== source) {
        try {
          parseFlowchart(reverseFlow(source, first.id));
        } catch {
          return;
        }
        await drawn(reverseFlow(source, first.id), "reverse");
      }
    });

    it("copies each node and gives each part another id", async () => {
      for (const node of chart.nodes.values()) {
        const copy = duplicateFlowNode(source, node.id);
        expect(copy.id, node.id).not.toBe("");
        const made = parseFlowchart(copy.source).nodes.get(copy.id)!;
        expect(made.parent, node.id).toBe(node.parent);
        expect(made.label, node.id).toBe(node.label);
        expect(lost(copy.source), node.id).toEqual([]);
        expect(lines(copy.source)).toHaveLength(before.length + 1);
        expect(signed(copy.source)).toEqual(signed(source));
        others(copy.source, []);
      }
      for (const id of [...chart.nodes.keys(), ...real]) {
        const result = renameFlowId(source, id, "zz9");
        if (id.startsWith("subgraph#") && result === source) continue;
        const after = parseFlowchart(result);
        expect(after.nodes.has("zz9") || after.subgraphs.has("zz9"), id).toBe(true);
        expect(after.nodes.has(id) || after.subgraphs.has(id), id).toBe(false);
        expect((after.nodes.get("zz9") ?? after.subgraphs.get("zz9"))!.label, id).toBe(
          chart.nodes.has(id) && chart.nodes.get(id)!.label === id
            ? "zz9"
            : (chart.nodes.get(id) ?? chart.subgraphs.get(id))!.label,
        );
        expect(after.edges).toHaveLength(chart.edges.length);
        expect(lines(result)).toHaveLength(before.length);
        for (const line of lost(result)) expect(mentions(line, id), `${id}: ${line}`).toBe(true);
        expect(
          renameFlowId(result, "zz9", id) === source ||
            id.includes(" ") ||
            id.startsWith("subgraph#"),
        ).toBe(true);
      }
      const [first] = chart.nodes.keys();
      await drawn(duplicateFlowNode(source, first).source, "copy");
      await drawn(renameFlowId(source, first, "zz9"), "id");
    });

    it("moves each node into each subgraph and out", async () => {
      let last = source;
      for (const node of chart.nodes.values())
        for (const into of [null, ...real]) {
          const result = moveFlowInto(source, node.id, into);
          if (
            node.parent === into ||
            (into === null && chart.kind === "swimlane" && result === source)
          ) {
            expect(result, `${node.id} into ${into}`).toBe(source);
            continue;
          }
          expect(result, `${node.id} into ${into}`).not.toBe(source);
          const after = parseFlowchart(result);
          expect(after.nodes.get(node.id)!.parent, `${node.id} into ${into}`).toBe(into);
          expect(after.nodes.get(node.id)!.label).toBe(node.label);
          expect(nodesOf(result)).toEqual(nodesOf(source));
          expect(signed(result), `${node.id} into ${into}`).toEqual(signed(source));
          others(result, [node.id]);
          // Only lines that mention the node change.
          for (const line of lost(result))
            expect(mentions(line, node.id), `${node.id} into ${into}: ${line}`).toBe(true);
          last = result;
        }
      if (last !== source) await drawn(last, "move");
    });

    it("takes each subgraph away and wraps nodes in a new one", async () => {
      for (const id of real) {
        const result = ungroupFlow(source, id),
          held = [...chart.nodes.values()].filter((node) => node.parent === id);
        if (chart.kind === "swimlane" && real.length === 1 && held.length) {
          expect(result).toBe(source);
          continue;
        }
        const after = parseFlowchart(result),
          { parent } = chart.subgraphs.get(id)!;
        expect(after.subgraphs.has(id), id).toBe(false);
        expect(nodesOf(result), id).toEqual(nodesOf(source));
        for (const node of held) expect(after.nodes.get(node.id)!.parent, node.id).toBe(parent);
        others(result, [
          id,
          ...held.map((node) => node.id),
          ...real.filter((other) => chart.subgraphs.get(other)!.parent === id),
        ]);
        expect(after.edges).toHaveLength(
          chart.edges.filter((edge) => edge.source !== id && edge.target !== id).length,
        );
        await drawn(result, `ungroup ${id}`);
      }
      for (const edge of chart.edges) {
        const ids = [edge.source, edge.target].filter((id) => chart.nodes.has(id));
        if (!ids.length) continue;
        const made = groupFlowNodes(source, ids, "Both of them");
        expect(made.id, edge.id).not.toBe("");
        const after = parseFlowchart(made.source);
        expect(after.subgraphs.get(made.id)!.label).toBe("Both of them");
        for (const id of ids) expect(after.nodes.get(id)!.parent, `${edge.id} ${id}`).toBe(made.id);
        expect(nodesOf(made.source)).toEqual(nodesOf(source));
        expect(signed(made.source), edge.id).toEqual(signed(source));
        others(made.source, ids);
        for (const id of ids) expect(after.nodes.get(id)!.label).toBe(chart.nodes.get(id)!.label);
      }
      const [first] = chart.edges;
      if (first && chart.nodes.has(first.source))
        await drawn(groupFlowNodes(source, [first.source, first.target], "Both").source, "group");
    });

    it("adds a piece at each node and into each flow", async () => {
      for (const node of chart.nodes.values())
        for (const kind of ["step", "start"] as const) {
          const made = attachFlow(source, { kind, label: "Fresh one" }, node.id);
          let after: ReturnType<typeof parseFlowchart>;
          try {
            after = parseFlowchart(made.source);
          } catch {
            continue;
          }
          if (!made.id) continue;
          expect(after.nodes.get(made.id)!.parent, node.id).toBe(node.parent);
          expect(
            after.edges.find((edge) => edge.id === made.edge),
            node.id,
          ).toMatchObject(
            kind === "start"
              ? { source: made.id, target: node.id }
              : { source: node.id, target: made.id },
          );
          expect(lost(made.source), node.id).toEqual([]);
          expect(lines(made.source)).toHaveLength(before.length + 1);
          others(made.source, []);
          const named = retitleFlow(made.source, made.id, "Fresh one");
          expect(named.id).toBe("freshOne");
          expect(lines(named.source)).toHaveLength(before.length + 1);
        }
      for (const edge of chart.edges) {
        const made = insertFlowOnEdge(source, edge.id, { kind: "step", label: "Between" });
        if (!made.id) {
          // A flow that ends at a subgraph of a swimlane cannot be, and none of the examples has one.
          expect(chart.nodes.has(edge.source) && chart.nodes.has(edge.target), edge.id).toBe(false);
          continue;
        }
        const after = parseFlowchart(made.source);
        expect(after.edges, edge.id).toHaveLength(chart.edges.length + 1);
        expect(
          after.edges.some(
            (other) =>
              other.source === edge.source &&
              other.target === made.id &&
              other.label === edge.label,
          ),
          edge.id,
        ).toBe(true);
        expect(
          after.edges.some((other) => other.source === made.id && other.target === edge.target),
          edge.id,
        ).toBe(true);
        others(made.source, []);
        if (chart.kind === "swimlane" && [...chart.nodes.values()].every((node) => node.parent))
          expect(after.nodes.get(made.id)!.parent, edge.id).not.toBeNull();
        expect(lost(made.source), edge.id).toEqual([before[edge.line - 1]]);
      }
      const [first] = chart.edges,
        [node] = chart.nodes.keys();
      if (first) await drawn(insertFlowOnEdge(source, first.id, { kind: "step" }).source, "insert");
      await drawn(attachFlow(source, { kind: "end" }, node).source, "attach");
    });
  },
);
