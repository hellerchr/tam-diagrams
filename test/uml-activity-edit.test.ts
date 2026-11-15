import { describe, expect, it } from "vitest";
import { parseFlowchart } from "../src/uml-activity.ts";
import {
  addFlowPiece,
  connectFlow,
  flowStructure,
  labelFlowEdge,
  removeFlow,
  renameFlow,
  restrokeFlow,
  retitleFlow,
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
    expect(flowStructure.connect(FLOW, "ship", "done")).toBe(FLOW);
    expect(edges(flowStructure.connect(FLOW, "ship", "done", "dotted"))).toHaveLength(8);
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
