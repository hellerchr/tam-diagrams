// Activity diagrams: parsing flowcharts and swimlanes (errors, what is left to Mermaid) and the source edits of uml-activity-edit.ts.
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseFlowchart } from "../../src/uml-activity.ts";
import { UmlError } from "../../src/uml.ts";
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
} from "../../src/uml-activity-edit.ts";

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

const LOOSE = `swimlane-beta TB
  subgraph Team
    a(Plan sprint) --> b(Build features)
  end
  b --> review(Review)
  review --> c{Accepted?}`;

const STYLED = `${FLOW}\n  class ship,wait hot\n  linkStyle 1,5 stroke:red\n  click wait call f()`;

/** The edges of a source as `source>target:label`; parsing it also checks that it reads. */
const edges = (source: string) =>
  parseFlowchart(source).edges.map(
    (edge) => `${edge.source}>${edge.target}${edge.label ? `:${edge.label}` : ""}`,
  );

const parentOf = (source: string, id: string) => {
  const chart = parseFlowchart(source);
  return (chart.nodes.get(id) ?? chart.subgraphs.get(id))?.parent;
};

/** The lines of `before` that `after` no longer has, and the ones it has anew. */
function delta(before: string, after: string) {
  const old = before.split("\n"),
    now = after.split("\n");
  return {
    lost: old.filter((line) => !now.includes(line)),
    added: now.filter((line) => !old.includes(line)),
  };
}

/** The error a source fails to parse with. */
function parseError(source: string): UmlError {
  try {
    parseFlowchart(source);
  } catch (error) {
    assert.ok(error instanceof UmlError);
    return error;
  }
  throw new Error("parsed");
}

test("reads every node shape, and start and end circles as initial and final nodes", () => {
  const chart = parseFlowchart(
    "flowchart LR\n  a[A] --> b(B) --> c([C]) --> d[[D]] --> e[(E)] --> f((F)) --> g{G} --> h{{H}}\n  h --> i[/I/] --> j[\\J\\] --> k[/K\\] --> l[\\L/] --> m>M] --> n(((N))) --> o@{ shape: fork }",
  );
  assert.deepEqual(
    [...chart.nodes.values()].map((node) => node.shape),
    ["rect", "round", "stadium", "subroutine", "cylinder", "circle", "diamond", "hexagon"].concat([
      "lean-right",
      "lean-left",
      "trapezoid",
      "trapezoid-top",
      "flag",
      "double-circle",
      "bar",
    ]),
  );
  const ends = parseFlowchart(
    "flowchart TB\n  s((Start)) --> a[Act] --> e(((End)))\n  c((Hub)) --> a\n  a --> c",
  );
  assert.deepEqual(
    ["s", "e", "c"].map((id) => ends.nodes.get(id)?.shape),
    ["initial", "final", "circle"],
  );
  // A start with flows into it, an end with flows out, stay the circles Mermaid draws.
  const kept = parseFlowchart(
    "flowchart TB\n  a --> s@{ shape: start } --> b\n  e@{ shape: stop } --> b\n  a --> e",
  );
  assert.deepEqual(
    ["s", "e"].map((id) => kept.nodes.get(id)?.shape),
    ["circle", "double-circle"],
  );
});

test("reads edges with labels, strokes, ends, chains and ampersands", () => {
  const chart = parseFlowchart(
    "graph TD;\n  A -- yes --> B;\n  A -. maybe .-> C\n  A == sure ==> D\n  B & C --> E -->|done| F\n  E --o G\n  E --x H\n  E <--> I\n  E ~~~ J",
  );
  assert.deepEqual(
    chart.edges.map((edge) => [
      edge.source,
      edge.target,
      edge.stroke,
      edge.start ?? "",
      edge.end ?? "",
      edge.label ?? "",
    ]),
    [
      ["A", "B", "solid", "", "arrow", "yes"],
      ["A", "C", "dotted", "", "arrow", "maybe"],
      ["A", "D", "thick", "", "arrow", "sure"],
      ["B", "E", "solid", "", "arrow", ""],
      ["C", "E", "solid", "", "arrow", ""],
      ["E", "F", "solid", "", "arrow", "done"],
      ["E", "G", "solid", "", "circle", ""],
      ["E", "H", "solid", "", "cross", ""],
      ["E", "I", "solid", "arrow", "arrow", ""],
      ["E", "J", "invisible", "", "", ""],
    ],
  );
});

test("reads subgraphs, swimlanes and the directions, shorthands too", () => {
  const chart = parseFlowchart(
    "swimlane-beta <\n  subgraph a [Lane A]\n    x --> y\n  end\n  subgraph b\n    z\n  end\n  y --> z",
  );
  assert.equal(chart.kind, "swimlane");
  assert.equal(chart.direction, "RL");
  assert.equal(chart.subgraphs.get("a")?.label, "Lane A");
  assert.deepEqual(
    [...chart.nodes.values()].map((node) => [node.id, node.parent]),
    [
      ["x", "a"],
      ["y", "a"],
      ["z", "b"],
    ],
  );
  const body = "\n  a --> b";
  for (const [word, direction] of [
    [">", "LR"],
    ["^", "BT"],
    ["v", "TB"],
    ["td", "TB"],
    ["", "TB"],
  ] as const)
    assert.equal(parseFlowchart(`graph ${word}${body}`).direction, direction, word);
  // A `direction` in a subgraph does not turn the chart, and takes only the long forms.
  assert.equal(
    parseFlowchart("graph TB\n  subgraph s\n    direction LR\n    a --> b\n  end").direction,
    "TB",
  );
  assert.throws(
    () => parseFlowchart("graph TB\n  subgraph s\n    direction <\n    a --> b\n  end"),
    UmlError,
  );
});

test("reports errors with their lines and leaves unsupported syntax to Mermaid", () => {
  const cases: [string, number, RegExp][] = [
    ["flowchart TB\n  subgraph a\n    x", 2, /^Line 2: Subgraph `a` is missing its `end`\.$/],
    ["flowchart TB\n  a[open --> b", 2, /^Line 2: `a\[` is missing its closing `\]`/],
    [
      "graph XY\n  a",
      1,
      /^Line 1: Unknown direction `XY`; use TB, TD, BT, LR, RL or one of < > \^ v\.$/,
    ],
    ["flowchart TB\n  a --> b\n  end", 3, /^Line 3: Unmatched `end`\.$/],
    ["flowchart TB\n  a -->", 2, /has no target/],
  ];
  for (const [source, line, message] of cases) {
    const error = parseError(source);
    assert.equal(error.line, line, source);
    assert.match(error.message, message);
    assert.equal(error.unsupported, false);
  }
  for (const [source, line] of [
    ["flowchart TB\n  a@{ shape: notch-rect }", 2],
    ["swimlane-beta TB\n  subgraph a\n    subgraph b\n      x\n    end\n  end", 3],
    ["swimlane-beta TB\n  subgraph a\n    x\n  end\n  x --> a", 5],
    ["flowchart TB\n  d{D} --> d", 2],
  ] as const) {
    const error = parseError(source);
    assert.equal(error.unsupported, true, source);
    assert.equal(error.line, line, source);
  }
});

test("adds pieces where they belong: before closing styles, in a subgraph, in a lane", () => {
  const end = addFlowPiece(FLOW, { kind: "end", label: "Done {1}", parent: "part" });
  assert.ok(
    end.source.endsWith(
      '\n    end1@{ shape: stop, label: "Done {1#125;" }\n  end\n  ship --> done(((End))) & x\n  style wait fill:#eee',
    ),
  );
  const read = parseFlowchart(end.source).nodes.get("end1");
  assert.deepEqual([read?.shape, read?.label, read?.parent], ["final", "Done {1}", "part"]);
  // A swimlane takes a node in its first lane, a lane after the last one.
  assert.equal(parentOf(addFlowPiece(LANES, { kind: "step" }).source, "step1"), "Customer");
  assert.ok(
    addFlowPiece(LANES, { kind: "group", label: "Bank" }).source.includes(
      "  end\n  subgraph lane1 [Bank]\n  end\n  order --> check",
    ),
  );
  assert.equal(parentOf(addFlowPiece(LOOSE, { kind: "step", parent: null }).source, "step1"), null);
});

test("connects nodes once, in their subgraph, and counts linkStyle on", () => {
  const numbered =
    "flowchart TB\n  subgraph g\n    a --> b\n  end\n  b --> c\n  linkStyle 0,1 stroke:red";
  const joined = joinFlow(numbered, "b", "a", "flow", "back");
  assert.equal(
    joined.source,
    "flowchart TB\n  subgraph g\n    a --> b\n    b -->|back| a\n  end\n  b --> c\n  linkStyle 0,2 stroke:red",
  );
  assert.equal(joined.edge, "e2");
  assert.equal(connectFlow(FLOW, "wait", "check"), FLOW);
  assert.equal(connectFlow(LANES, "order", "Shop"), LANES);
});

test("labels and restrokes an edge in place, writing out a list only for it", () => {
  const chain = "flowchart LR\n  a --> b -- old text --> c ==> d";
  assert.equal(
    labelFlowEdge(chain, "e2", 'say "hi" | bye'),
    'flowchart LR\n  a --> b -->|"say #quot;hi#quot; #124; bye"| c ==> d',
  );
  assert.equal(
    parseFlowchart(labelFlowEdge(chain, "e2", 'say "hi" | bye')).edges[1]?.label,
    'say "hi" | bye',
  );
  assert.equal(
    restrokeFlow(chain, "e2", "dotted"),
    "flowchart LR\n  a --> b -. old text .-> c ==> d",
  );
  assert.equal(
    labelFlowEdge("flowchart LR\n  a & b --> c & d", "e2", "x"),
    "flowchart LR\n  a --> c\n  a -->|x| d\n  b --> c & d",
  );
});

test("renames nodes and subgraphs where they are declared, as typed", () => {
  assert.equal(renameFlow("flowchart LR\n  a --> b", "b", "Bee"), "flowchart LR\n  a --> b[Bee]");
  assert.equal(
    renameFlow("flowchart TB\n  a --> f@{ shape: fork }", "f", "Split"),
    'flowchart TB\n  a --> f@{ shape: fork, label: "Split" }',
  );
  assert.ok(renameFlow(FLOW, "part", "Inner [1]").includes('subgraph part ["Inner [1]"]'));
  const odd = renameFlow(FLOW, "done", 'List<String> "Lager" [A] (b) {y} | z\nmore');
  assert.equal(
    parseFlowchart(odd).nodes.get("done")?.label,
    'List<String> "Lager" [A] (b) {y} | z<br>more',
  );
  assert.equal(parseFlowchart(odd).nodes.get("done")?.shape, "final");
});

test("retitles a generated id after its first name", () => {
  const styled = "flowchart TB\n  step1[Step] --> b\n  style step1 fill:#eee\n  class b,step1 hot";
  assert.equal(isGeneratedFlowId(styled, "step1"), true);
  assert.equal(isGeneratedFlowId(styled, "b"), false);
  assert.deepEqual(retitleFlow(styled, "step1", "Größe prüfen?"), {
    source:
      "flowchart TB\n  grossePrufen[Größe prüfen?] --> b\n  style grossePrufen fill:#eee\n  class b,grossePrufen hot",
    id: "grossePrufen",
  });
  assert.equal(retitleFlow(styled, "step1", "End").id, "step1");
});

test("removes nodes, edges and subgraphs with what styles them, keeping what shared their lines", () => {
  const chain = "flowchart LR\n  a[A]  -->  b -- to c -->  c{C} ==> d";
  assert.equal(removeFlow(chain, ["e2"]), "flowchart LR\n  a[A]  -->  b\n  c{C} ==> d");
  assert.equal(removeFlow(chain, ["b"]), "flowchart LR\n  c{C} ==> d\n  a[A]");
  const styled = `flowchart TB
  a --> b
  subgraph pay [Payment]
    direction LR
    c[Card] --> d
  end
  b --> c
  d --> e
  class c,e hot
  style c fill:#eee
  click d callback
  linkStyle 0 stroke:red
  linkStyle 1,3 stroke:blue`;
  assert.equal(
    removeFlow(styled, ["pay"]),
    "flowchart TB\n  a --> b\n  e\n  class e hot\n  linkStyle 0 stroke:red",
  );
});

test("reverses a flow in place, or out of its chain", () => {
  assert.deepEqual(delta(FLOW, reverseFlow(FLOW, "e2")), {
    lost: ["  check -->|yes| ship[Ship order]"],
    added: ["  ship[Ship order] -->|yes| check"],
  });
  assert.equal(
    reverseFlow("flowchart LR\n  a[A] --> b --> c[C] -.-o d", "e2"),
    "flowchart LR\n  a[A] --> b\n  c[C] --> b\n  c -.-o d",
  );
});

test("copies a node beside it, and gives a part another id at every mention", () => {
  const copy = duplicateFlowNode(FLOW, "y");
  assert.equal(copy.id, "y2");
  assert.deepEqual(delta(FLOW, copy.source), { lost: [], added: ["    y2[Also inside]"] });
  assert.equal(parentOf(copy.source, "y2"), "part");
  assert.deepEqual(delta(STYLED, renameFlowId(STYLED, "wait", "hold")).added, [
    "  check -->|no| hold[Wait for supply]",
    "  hold --> check",
    "  style hold fill:#eee",
    "  class ship,hold hot",
    "  click hold call f()",
  ]);
  assert.ok(renameFlowId(LANES, "Customer", "Client").includes("  subgraph Client [Customer]\n"));
  assert.equal(renameFlowId(FLOW, "wait", "check"), FLOW);
});

test("moves a node into a subgraph or lane and out", () => {
  // Into a lane further down: its flow in the lane it leaves stays behind that lane.
  assert.equal(
    moveFlowInto(LANES, "order", "Shop"),
    "swimlane-beta TB\n  subgraph Customer\n    start((Start))\n  end\n  start --> order\n  subgraph Shop\n    check(Check Order) --> ship(Ship Goods)\n    order(Place Order)\n  end\n  order --> check",
  );
  const out = moveFlowInto(STYLED, "x", null);
  assert.deepEqual(delta(STYLED, out), {
    lost: ["    x[Inside] --> y[Also inside]"],
    added: ["    y[Also inside]", "  x[Inside] --> y"],
  });
  assert.equal(parentOf(out, "y"), "part");
  // A swimlane keeps its nodes in lanes.
  assert.equal(moveFlowInto(LANES, "order", null), LANES);
});

test("ungroups a subgraph and wraps nodes in a new one", () => {
  const whole =
    "flowchart TB\n  subgraph g [G]\n    direction LR\n    d\n  end\n  a --> g\n  g --> e\n  style g fill:#eee\n  class g,a hot\n  linkStyle 0,1 stroke:red";
  assert.equal(ungroupFlow(whole, "g"), "flowchart TB\n  d\n  a\n  e\n  class a hot");
  const shipping = groupFlowNodes(STYLED, ["ship", "done"], "Shipping & more");
  assert.equal(shipping.id, "group1");
  assert.deepEqual(delta(STYLED, shipping.source).added, [
    '  subgraph group1 ["Shipping & more"]',
    "    ship[Ship order]",
    "    done(((End)))",
    "  check -->|yes| ship",
    "  ship --> done & x",
  ]);
  assert.deepEqual(edges(shipping.source), edges(STYLED));
});

test("attaches a piece to a node and puts one into a flow", () => {
  const start = attachFlow(LANES, { kind: "start" }, "check");
  assert.equal(start.edge, "e3");
  assert.ok(
    start.source.includes(
      "    check(Check Order) --> ship(Ship Goods)\n    start1((Start)) --> check\n  end",
    ),
  );
  assert.equal(parseFlowchart(start.source).nodes.get("start1")?.shape, "initial");
  assert.deepEqual(
    delta(STYLED, insertFlowOnEdge(STYLED, "e2", { kind: "step", label: "Pick" }).source),
    {
      lost: ["  check -->|yes| ship[Ship order]", "  linkStyle 1,5 stroke:red"],
      added: ["  check -->|yes| step1[Pick] --> ship[Ship order]", "  linkStyle 1,6 stroke:red"],
    },
  );
  // The second half takes the stroke and the end mark.
  assert.equal(
    insertFlowOnEdge("flowchart LR\n  a -. x .-o b", "e1", { kind: "step" }).source,
    "flowchart LR\n  a -. x .-> step1[Step] -.-o b",
  );
});

test("offers yes and no for the flows out of a decision", () => {
  const one = "flowchart LR\n  a --> d{Ok?}\n  d --> a";
  assert.equal(nextBranchLabel(one, "d"), "yes");
  assert.equal(nextBranchLabel(`${one}\n  d -->|Yes| b`, "d"), "no");
  assert.equal(nextBranchLabel(`${one}\n  d -->|else| b`, "d"), undefined);
});

test("turns a flowchart into a swimlane with its first lane and back, and does not mix lanes and groups", () => {
  const plain =
    "---\ntitle: Shipping\n---\n%% level design\nflowchart LR\n  start((Start)) --> ship[Ship order]";
  const laned = activityStructure.add(`${plain}\n%% @ship 120,0`, { kind: "lane", label: "Shop" });
  assert.equal(
    laned.source,
    `${plain.replace("flowchart", "swimlane-beta")}\n  subgraph lane1 [Shop]\n  end`,
  );
  assert.equal(activityStructure.remove(laned.source, ["lane1"]), plain);
  assert.match(activityRefusal(LANES, "group") ?? "", /^Lanes and groups do not mix: .*add a lane/);
  assert.equal(activityRefusal(LANES, "step"), undefined);
  assert.deepEqual(activityStructure.add(FLOW, { kind: "lane" }), { source: FLOW, id: "" });
});

test("reads parts and joins as a structure", () => {
  const { nodes, edges: joins } = activityStructure.read(FLOW);
  assert.deepEqual(
    nodes.map((node) => `${node.id}:${node.kind}:${node.parent}`),
    [
      "start:start:null",
      "check:decision:null",
      "ship:step:null",
      "wait:step:null",
      "part:group:null",
      "x:step:part",
      "y:step:part",
      "done:end:null",
    ],
  );
  assert.equal(joins.length, 7);
  assert.ok(activityStructure.relink(FLOW, "e4", "dotted").includes("  wait -.-> check\n"));
});
