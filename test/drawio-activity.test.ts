import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { exportDrawio, importDrawio } from "../src/drawio.ts";
import { type Cell, Drawing, writeDrawio } from "../src/drawio-file.ts";
import { activityDrawio } from "../src/drawio-activity.ts";
import { parseUml } from "../src/index.ts";
import { FLOWCHART_EXAMPLES, SWIMLANE_EXAMPLES } from "../src/samples/uml-examples.ts";
import type { Scene } from "../src/scene.ts";
import { parseFlowchart, type Flowchart } from "../src/uml-activity.ts";
import { readPlaces } from "../src/uml-places.ts";

/** What a flowchart says, apart from ids of flows and the order of its statements. */
function substance(chart: Flowchart) {
  const parent = (id: string | null) => (id ? (chart.subgraphs.get(id)?.label ?? id) : null);
  return {
    kind: chart.kind,
    direction: chart.direction,
    title: chart.title,
    nodes: [...chart.nodes.values()]
      .map((node) => `${node.id}:${node.shape}:${node.label}:${parent(node.parent)}`)
      .toSorted(),
    subgraphs: [...chart.subgraphs.values()]
      .map((subgraph) => `${subgraph.label}:${parent(subgraph.parent)}`)
      .toSorted(),
    edges: chart.edges
      .map(
        (edge) =>
          `${edge.source}>${edge.target}:${edge.stroke}:${edge.start}:${edge.end}:${edge.label ?? ""}`,
      )
      .toSorted(),
  };
}

const layout = (source: string): Promise<Scene> => parseUml(source).layout(arialMeasure);

/** Exports a source, imports the file, and checks the source that comes back. */
async function roundTrip(source: string) {
  const first = await layout(source);
  const file = await exportDrawio(source, { measure: arialMeasure, scene: first });
  const back = await importDrawio(file);
  expect(back.warnings).toEqual([]);
  expect(substance(parseFlowchart(back.source))).toEqual(substance(parseFlowchart(source)));
  const again = await layout(back.source);
  const boxes = new Map(first.shapes.map((shape) => [shape.id, shape.box]));
  const places = readPlaces(back.source);
  expect(places.size).toBeGreaterThan(0);
  const moved = [...places.keys()].filter((id) => {
    const was = boxes.get(id),
      now = again.shapes.find((shape) => shape.id === id)?.box;
    return !was || !now || Math.abs(now.x - was.x) > 2 || Math.abs(now.y - was.y) > 2;
  });
  expect(moved).toEqual([]);
  return { file, back };
}

const OWN: [string, string][] = [
  [
    "flow final, invisible links, quotes and an empty group",
    `---
title: Odds & ends
---
flowchart BT
  go@{ shape: start } --> work("Work (hard) #quot;now#quot;")
  work --> stop@{ shape: cross-circ, label: "Abort" }
  work -.- note[[Note it]]
  work ~~~ note
  subgraph empty [Nothing here]
  end
  subgraph "Anonymous"
    a1(One) --> a2(Two)
  end
  a2 --> work`,
  ],
  [
    "swimlanes in rows with a node in no lane",
    `swimlane-beta LR
  subgraph Customer
    start((Start)) --> order(Place order)
  end
  subgraph shop [Web Shop]
    check{In stock?}
  end
  order --> check
  check -->|yes| ship(Ship)
  check -->|no| done(((End)))
  ship --> done`,
  ],
];

describe("activity diagrams to draw.io and back", () => {
  for (const [name, source] of [...FLOWCHART_EXAMPLES, ...SWIMLANE_EXAMPLES, ...OWN])
    it(`round-trips ${name}`, async () => {
      await roundTrip(source);
    });

  it("draws with the shapes of TAM-AD", async () => {
    const { file } = await roundTrip(SWIMLANE_EXAMPLES[1][1]);
    // Action, Start of Activity, Decision or Merge, Fork or Join, Swimlane.
    expect(file).toContain("rounded=1;whiteSpace=wrap;html=1;strokeWidth=2;arcSize=40;");
    expect(file).toContain(
      "ellipse;fillColor=#000000;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0;",
    );
    expect(file).toContain("rhombus;strokeWidth=2;rotatable=0;");
    expect(file).toContain(
      "rounded=0;fillColor=#000000;whiteSpace=wrap;html=1;strokeWidth=2;rotatable=0;",
    );
    expect(file).toMatch(
      /shape=partialRectangle;whiteSpace=wrap;top=0;bottom=0;fillColor=none;dashed=1;dashPattern=5 5;strokeWidth=2;strokeColor=#666666;verticalAlign=top;fontStyle=1;/,
    );
    expect(file).toContain("endArrow=classic;endFill=1;");
    expect(file).toContain("tam=flow-final;");
    // The nodes stand in their lanes.
    const drawing = new Drawing({ name: "", cells: parseCells(file) });
    expect(drawing.cells.get("create")!.parent).toBe("Updater");
    expect(drawing.cells.get("persistPages")!.parent).toBe("Renderer");
  });

  it("draws Mermaid's other shapes with draw.io's own, tagged with the variant", async () => {
    const { file } = await roundTrip(FLOWCHART_EXAMPLES[2][1]);
    for (const style of [
      "shape=cylinder3;",
      "shape=process;",
      "shape=hexagon;",
      "shape=parallelogram;",
      "shape=trapezoid;",
      "shape=step;",
      "shape=endState;",
    ])
      expect(file).toContain(style);
    expect(file).toContain("flipH=1;");
    expect(file).toContain("tam=lean-left;");
  });

  it("nests the nodes of a subgraph in its cell", async () => {
    const { file } = await roundTrip(FLOWCHART_EXAMPLES[4][1]);
    const drawing = new Drawing({ name: "", cells: parseCells(file) });
    expect(drawing.cells.get("api1")!.parent).toBe("eu");
    expect(drawing.cells.get("eu")!.parent).toBe("cloud");
    expect(drawing.style(drawing.cells.get("cloud")!).get("container")).toBe("1");
  });
});

/** The cells of a written file, read without the async reader. */
function parseCells(file: string): Cell[] {
  const cells: Cell[] = [];
  for (const match of file.matchAll(
    /<mxCell id="([^"]*)"(?: value="[^"]*")?(?: style="([^"]*)")?[^>]*?(?: parent="([^"]*)")/g,
  ))
    cells.push({ id: match[1], style: match[2], parent: match[3], vertex: true });
  return cells;
}

// ---------------------------------------------------------------------------------------------
// A page drawn by hand with the TAM-AD library

const v = (
  id: string,
  style: string,
  x: number,
  y: number,
  width: number,
  height: number,
  value = "",
  parent = "1",
): Cell => ({
  id,
  parent,
  value,
  style,
  vertex: true,
  geometry: { x, y, width, height },
});
const e = (
  id: string,
  source: string,
  target: string,
  value = "",
  style = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=classic;endFill=1;",
): Cell => ({
  id,
  parent: "1",
  value,
  style,
  edge: true,
  source,
  target,
  geometry: { x: 0, y: 0, width: 0, height: 0, relative: true },
});

const ACTION = "rounded=1;whiteSpace=wrap;html=1;strokeWidth=2;arcSize=40;";
const START =
  "ellipse;fillColor=#000000;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0;editable=0;resizable=0";
const DECISION = "rhombus;strokeWidth=2;rotatable=0;editable=0";
const BAR =
  "rounded=0;fillColor=#000000;whiteSpace=wrap;html=1;strokeWidth=2;rotatable=0;editable=0";
const OBJECT = "rounded=0;whiteSpace=wrap;html=1;strokeWidth=2;";
const LANE =
  "shape=partialRectangle;whiteSpace=wrap;top=0;bottom=0;fillColor=none;dashed=1;dashPattern=5 5;strokeWidth=2;strokeColor=#666666;verticalAlign=top;fontStyle=1;spacing=0;";
const WHITE =
  "ellipse;fillColor=#FFFFFF;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0;editable=0";
const BLACK =
  "ellipse;fillColor=#000000;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0;editable=0";
const LINE =
  "edgeStyle=none;strokeWidth=2;html=1;aspect=fixed;startArrow=none;startFill=0;endArrow=none;endFill=0;";
const TEXT =
  "text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;";

/** An End of Activity group and an End of Flow group, as TAM-AD drops them on a page. */
function endOfActivity(id: string, x: number, y: number): Cell[] {
  return [
    { ...v(id, "group;aspect=fixed;rotatable=0;resizable=0", x, y, 30, 30), connectable: true },
    v(`${id}-1`, WHITE, 0, 0, 30, 30, "", id),
    v(`${id}-2`, BLACK, 7, 7, 16, 16, "", id),
  ];
}
function endOfFlow(id: string, x: number, y: number): Cell[] {
  const line = (n: number, from: { x: number; y: number }, to: { x: number; y: number }): Cell => ({
    id: `${id}-${n}`,
    parent: id,
    style: LINE,
    edge: true,
    geometry: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      relative: true,
      sourcePoint: from,
      targetPoint: to,
    },
  });
  return [
    { ...v(id, "group;aspect=fixed;rotatable=0", x, y, 30, 30), connectable: true },
    v(`${id}-1`, WHITE, 0, 0, 30, 30, "", id),
    line(2, { x: 5, y: 5 }, { x: 25, y: 25 }),
    line(3, { x: 25, y: 5 }, { x: 5, y: 25 }),
  ];
}

const HAND: Cell[] = [
  { id: "0" },
  { id: "1", parent: "0" },
  v("Qx7-1", LANE, 0, 0, 220, 520, "Customer"),
  v("Qx7-2", LANE, 220, 0, 220, 520, "Shop"),
  v("Qx7-3", START, 100, 40, 20, 20),
  v("Qx7-4", ACTION, 50, 90, 120, 60, "Place order"),
  v("Qx7-5", DECISION, 320, 190, 20, 20),
  v("Qx7-6", TEXT, 345, 185, 80, 30, "In stock?"),
  v("Qx7-7", BAR, 270, 260, 120, 10),
  v("Qx7-8", ACTION, 260, 300, 140, 60, "Pack goods"),
  v("Qx7-9", OBJECT, 260, 400, 140, 40, "Parcel"),
  ...endOfActivity("Qx7-10", 315, 470),
  ...endOfFlow("Qx7-11", 95, 300),
  e("Qx7-20", "Qx7-3", "Qx7-4"),
  e("Qx7-21", "Qx7-4", "Qx7-5"),
  e("Qx7-22", "Qx7-5", "Qx7-7", "yes"),
  e("Qx7-23", "Qx7-5", "Qx7-11-1", "[no]"),
  e("Qx7-24", "Qx7-7", "Qx7-8"),
  e("Qx7-25", "Qx7-8", "Qx7-9"),
  // Connected to the black ellipse inside the group: the end node all the same.
  e("Qx7-26", "Qx7-9", "Qx7-10-2"),
  v("Qx7-30", "shape=note2;whiteSpace=wrap;html=1;", 460, 40, 100, 40, "Remember"),
];

describe("a page drawn with the TAM-AD library", () => {
  it("reads as a swimlane activity", async () => {
    const back = await importDrawio(writeDrawio([{ name: "Ordering", cells: HAND }]));
    expect(back.kind).toBe("swimlane");
    expect(back.warnings).toEqual([
      "The note “Remember” is left out: activity diagrams have no notes in this syntax (Mermaid flowcharts have none).",
    ]);
    const source = back.source.replace(/^%%.*\n/gm, "");
    expect(source).toBe(`---
title: Ordering
---
swimlane-beta TB
  subgraph Customer [Customer]
    start@{ shape: start }
    Place_order(Place order)
    flowEnd@{ shape: cross-circ }
  end
  subgraph Shop [Shop]
    In_stock{In stock?}
    fork@{ shape: fork }
    Pack_goods(Pack goods)
    Parcel[(Parcel)]
    stop@{ shape: stop }
  end
  start --> Place_order
  Place_order --> In_stock
  In_stock -->|yes| fork
  In_stock -->|no| flowEnd
  fork --> Pack_goods
  Pack_goods --> Parcel
  Parcel --> stop
`);
    // Each node keeps its share of its lane's width and its height on the page; the lanes are as
    // wide as the layout makes them. The import sizes the nodes with another measure than Arial,
    // so the middles are near, not exact.
    const scene = await layout(back.source);
    const middle = (id: string) => {
      const box = scene.shapes.find((shape) => shape.id === id)!.box;
      return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    };
    const column = (ids: string[]) => {
      const xs = ids.map((id) => middle(id).x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(10);
    };
    column(["start", "Place_order"]);
    column(["In_stock", "fork", "Pack_goods", "Parcel", "stop"]);
    expect(middle("start").x).toBeLessThan(middle("In_stock").x);
    const ys = ["start", "Place_order", "In_stock", "fork", "Pack_goods", "Parcel", "stop"].map(
      (id) => middle(id).y,
    );
    const page = [50, 120, 200, 265, 330, 420, 485];
    expect(
      ys.every((y, index) => Math.abs(y - page[index]) <= 1),
      `${ys}`,
    ).toBe(true);
  });

  it("reads unconnected pages as flowcharts and says what it leaves out", async () => {
    const cells: Cell[] = [
      { id: "0" },
      { id: "1", parent: "0" },
      v("a", ACTION, 0, 0, 120, 60, "Alpha"),
      v("b", ACTION, 0, 120, 120, 60, "Beta"),
      e("ab", "a", "b"),
      {
        ...e("loose", "b", ""),
        target: undefined,
        geometry: {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          relative: true,
          targetPoint: { x: 300, y: 300 },
        },
      },
    ];
    const back = await importDrawio(writeDrawio([{ name: "Page-1", cells }]), {
      kind: "flowchart",
    });
    expect(back.kind).toBe("flowchart");
    expect(back.source.split("\n").slice(0, 4)).toEqual([
      "flowchart TB",
      "  a(Alpha)",
      "  b(Beta)",
      "  a --> b",
    ]);
    expect(back.warnings).toEqual([
      "A flow from “Beta” is not connected to a node at both ends and is left out.",
    ]);
  });

  it("scores pages by the shapes only activities have", () => {
    const drawing = new Drawing({ name: "P", cells: HAND });
    expect(activityDrawio.likeness(drawing)).toBeGreaterThan(10);
    const plain = new Drawing({
      name: "P",
      cells: [{ id: "0" }, { id: "1", parent: "0" }, v("x", "ellipse;", 0, 0, 40, 40)],
    });
    expect(activityDrawio.likeness(plain)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Pages made in the real draw.io with the TAM-AD library (see test/fixtures/drawio/README.md)

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures/drawio", name), "utf8");

/** Imports a fixture, checks it lays out with every node placed, and gives its source unplaced. */
async function importFixture(name: string) {
  const back = await importDrawio(fixture(name));
  const chart = parseFlowchart(back.source);
  const places = readPlaces(back.source);
  expect([...chart.nodes.keys()].filter((id) => !places.has(id))).toEqual([]);
  await layout(back.source);
  return { ...back, unplaced: back.source.replace(/^%%.*\n/gm, "") };
}

describe("pages made in draw.io with the TAM-AD library", () => {
  it("reads a decision with guards typed on its arrows and a loose last arrow", async () => {
    const back = await importFixture("activity-decision.drawio");
    expect(back.kind).toBe("flowchart");
    expect(back.unplaced).toBe(`---
title: Order handling
---
flowchart TB
  start@{ shape: start }
  Receive_order(Receive order)
  Check_stock(Check stock)
  In_stock{In stock?}
  Ship_goods(Ship goods)
  Cancel_order(Cancel order)
  decision{}
  Close_order(Close order)
  stop@{ shape: stop }
  start --> Receive_order
  Receive_order --> Check_stock
  Check_stock --> In_stock
  In_stock -->|yes| Ship_goods
  In_stock -->|no| Cancel_order
  Ship_goods --> decision
  Cancel_order --> decision
  decision --> Close_order
  Close_order --> stop
`);
    expect(back.warnings).toEqual([
      "A flow from “Close order” is not attached to “stop”, only drawn up to it; it is read as connected.",
    ]);
  });

  it("reads lanes side by side, typed names, and guards written as texts beside the arrows", async () => {
    const back = await importFixture("activity-lanes.drawio");
    expect(back.kind).toBe("swimlane");
    expect(back.unplaced).toBe(`---
title: Purchase request
---
swimlane-beta TB
  subgraph Employee [Employee]
    start@{ shape: start }
    Fill_in_request(Fill in request)
    flowEnd@{ shape: cross-circ }
  end
  subgraph Manager [Manager]
    Review_request(Review request)
    decision{}
  end
  subgraph Purchasing [Purchasing]
    Order_item(Order item)
    Receive_item(Receive item)
    stop@{ shape: stop }
  end
  start --> Fill_in_request
  Fill_in_request --> Review_request
  Review_request --> decision
  decision -->|rejected| flowEnd
  decision -->|approved| Order_item
  Order_item --> Receive_item
  Receive_item --> stop
`);
    expect(back.warnings).toEqual([]);
    // Each node stays in the column of its lane, in the order of the page from top to bottom.
    const scene = await layout(back.source);
    const box = (id: string) => scene.shapes.find((shape) => shape.id === id)!.box;
    expect(box("start").x).toBeLessThan(box("Review_request").x);
    expect(box("Review_request").x).toBeLessThan(box("Order_item").x);
    expect(box("Order_item").y).toBeLessThan(box("Receive_item").y);
  });

  it("reads a fork and a join, an object node, a loop back and a note", async () => {
    const back = await importFixture("activity-fork-loop.drawio");
    expect(back.kind).toBe("flowchart");
    expect(back.unplaced).toBe(`---
title: Prepare release
---
flowchart TB
  start@{ shape: start }
  Plan_release(Plan release)
  fork@{ shape: fork }
  Build_app(Build app)
  Write_notes(Write notes)
  Update_docs(Update docs)
  Release_notes[(Release notes)]
  fork1@{ shape: fork }
  Run_tests(Run tests)
  Tests_passed{Tests passed?}
  Publish(Publish)
  stop@{ shape: stop }
  start --> Plan_release
  Plan_release --> fork
  fork --> Build_app
  fork --> Write_notes
  fork --> Update_docs
  Write_notes --> Release_notes
  Release_notes --> fork1
  Build_app --> fork1
  Update_docs --> fork1
  fork1 --> Run_tests
  Run_tests --> Tests_passed
  Tests_passed -->|yes| Publish
  Tests_passed -->|no| Plan_release
  Publish --> stop
`);
    expect(back.warnings).toEqual([
      "The note “Tests run on CI” is left out: activity diagrams have no notes in this syntax (Mermaid flowcharts have none).",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// A page drawn with the activity palette of the tam-drawio plugin

const PLUGIN = {
  action: "rounded=1;whiteSpace=wrap;html=1;strokeWidth=2;arcSize=37",
  start: "ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#000000;aspect=fixed;",
  end: "shape=endactivity;strokeWidth=2;fillColor=#000000;aspect=fixed;",
  decision: "rhombus;html=1;strokeWidth=2;aspect=fixed;",
  flow: "edgeStyle=elbowEdgeStyle;html=1;labelBackgroundColor=none;rounded=1;elbow=vertical;endArrow=classic;endFill=1;align=center;",
  bar: "line;strokeWidth=13;html=1;fillColor=default;",
  flowEnd:
    "shape=sumEllipse;perimeter=ellipsePerimeter;whiteSpace=wrap;html=1;backgroundOutline=1;strokeWidth=2;aspect=fixed;",
};

describe("a page drawn with the tam-drawio plugin", () => {
  it("reads its activity shapes", async () => {
    const flow = (id: string, source: string, target: string, value = "") =>
      e(id, source, target, value, PLUGIN.flow);
    const cells: Cell[] = [
      { id: "0" },
      { id: "1", parent: "0" },
      v("tq-1", PLUGIN.start, 105, 0, 30, 30),
      v("tq-2", PLUGIN.action, 75, 60, 90, 40, "Receive call"),
      v("tq-3", PLUGIN.decision, 105, 130, 30, 30),
      v("tq-4", TEXT, 140, 130, 80, 20, "Known caller?"),
      v("tq-5", PLUGIN.bar, 60, 200, 120, 10),
      v("tq-6", PLUGIN.action, 0, 240, 90, 40, "Log call"),
      v("tq-7", PLUGIN.action, 150, 240, 90, 40, "Open ticket"),
      v("tq-8", PLUGIN.bar, 60, 320, 120, 10),
      v("tq-9", PLUGIN.end, 105, 370, 30, 30),
      v("tq-10", PLUGIN.flowEnd, 250, 135, 20, 20),
      flow("tq-f1", "tq-1", "tq-2"),
      flow("tq-f2", "tq-2", "tq-3"),
      flow("tq-f3", "tq-3", "tq-5", "[yes]"),
      flow("tq-f4", "tq-3", "tq-10", "[no]"),
      flow("tq-f5", "tq-5", "tq-6"),
      flow("tq-f6", "tq-5", "tq-7"),
      flow("tq-f7", "tq-6", "tq-8"),
      flow("tq-f8", "tq-7", "tq-8"),
      flow("tq-f9", "tq-8", "tq-9"),
    ];
    const back = await importDrawio(writeDrawio([{ name: "Calls", cells }]));
    expect(back.kind).toBe("flowchart");
    expect(back.warnings).toEqual([]);
    expect(back.source.replace(/^%%.*\n/gm, "")).toBe(`---
title: Calls
---
flowchart TB
  start@{ shape: start }
  Receive_call(Receive call)
  Known_caller{Known caller?}
  flowEnd@{ shape: cross-circ }
  fork@{ shape: fork }
  Log_call(Log call)
  Open_ticket(Open ticket)
  fork1@{ shape: fork }
  stop@{ shape: stop }
  start --> Receive_call
  Receive_call --> Known_caller
  Known_caller -->|yes| fork
  Known_caller -->|no| flowEnd
  fork --> Log_call
  fork --> Open_ticket
  Log_call --> fork1
  Open_ticket --> fork1
  fork1 --> stop
`);
    await layout(back.source);
  });
});
