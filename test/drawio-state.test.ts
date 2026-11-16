import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arialMeasure } from "../src/arial-measure.ts";
import { exportDrawio, importDrawio } from "../src/drawio.ts";
import { type Cell, Drawing, writeDrawio } from "../src/drawio-file.ts";
import { stateDrawio } from "../src/drawio-state.ts";
import { parseUml } from "../src/index.ts";
import { STATE_EXAMPLES } from "../src/samples/uml-examples.ts";
import type { Scene } from "../src/scene.ts";
import { placeable } from "../src/uml-placed.ts";
import { parseStateDiagram, type StateDiagram } from "../src/uml-state.ts";

/** What a state machine says, apart from the order it is written in. */
function substance(diagram: StateDiagram) {
  return {
    direction: diagram.direction,
    title: diagram.title,
    states: [...diagram.states.values()]
      .map(({ id, kind, label, descriptions, parent }) => ({
        id,
        kind,
        label,
        descriptions,
        parent,
      }))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
    transitions: diagram.transitions
      .map((item) => `${item.source} --> ${item.target} : ${item.label ?? ""}`)
      .toSorted(),
    notes: diagram.notes
      .map((note) => `${note.id} ${note.side} of ${note.target}: ${note.text}`)
      .toSorted(),
  };
}

const layout = (source: string) => parseUml(source).layout(arialMeasure) as Promise<Scene>;

/** Every placed part of `first` stands in `second` where it stood, give or take 2 pixels. */
function expectSamePlaces(first: Scene, second: Scene) {
  const boxes = new Map(second.shapes.map((shape) => [shape.id, shape.box]));
  for (const id of placeable(first)) {
    const was = first.shapes.find((shape) => shape.id === id)!.box,
      now = boxes.get(id);
    expect(now, id).toBeDefined();
    expect(Math.abs(now!.x - was.x), `${id} x`).toBeLessThanOrEqual(2);
    expect(Math.abs(now!.y - was.y), `${id} y`).toBeLessThanOrEqual(2);
  }
}

const OWN: [string, string][] = [
  [
    "a crowded choice, a note on a composite, a title",
    `---
title: Checkout
---
stateDiagram-v2
  state check <<choice>>
  [*] --> Cart
  Cart --> check : pay
  Saved --> check
  check --> Paid : [card]
  check --> Invoiced : [invoice]
  check --> Cart : [failed]
  check --> Saved : [later]
  state Done {
    [*] --> Archived
    Archived --> [*]
  }
  Paid --> Done
  Invoiced --> Done
  Done --> [*]
  note left of Done : Kept for ten years
  note right of Cart
    The cart lives
    in the session.
  end note`,
  ],
  [
    "regions in two composites, LR, fork and join",
    `stateDiagram-v2
  direction LR
  state fork_state <<fork>>
  state join_state <<join>>
  [*] --> fork_state
  fork_state --> A
  fork_state --> B
  A --> join_state
  B --> join_state
  join_state --> Running
  state Running {
    [*] --> Left
    Left --> [*]
    --
    [*] --> Right
    Right --> [*]
  }
  state Paused {
    [*] --> One
    --
    [*] --> Two
  }
  Running --> Paused : pause
  Paused --> [*]`,
  ],
];

describe("state machine diagrams in draw.io", () => {
  it.each([...STATE_EXAMPLES, ...OWN])("round-trips %s", async (_name, source) => {
    const first = await layout(source);
    const file = await exportDrawio(source, { measure: arialMeasure, scene: first });
    const imported = await importDrawio(file);
    expect(imported.kind).toBe("state");
    expect(imported.warnings).toEqual([]);
    const original = parseStateDiagram(source),
      back = parseStateDiagram(imported.source);
    const { level: _level, ...rest } = original;
    void rest;
    expect(substance(back)).toEqual(substance(original));
    expectSamePlaces(first, await layout(imported.source));
  });

  it("writes the TAMshapes styles", async () => {
    const file = await exportDrawio(OWN[0][1] + "\n", { measure: arialMeasure });
    // The State shape, Start of Activity, End of Activity, Decision, Note and Arrow.
    expect(file).toContain("rounded=1;whiteSpace=wrap;html=1;strokeWidth=2;arcSize=10;");
    expect(file).toContain(
      "ellipse;fillColor=#000000;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0;",
    );
    expect(file).toContain("group;aspect=fixed;rotatable=0;resizable=0;");
    expect(file).toContain(
      "ellipse;fillColor=#FFFFFF;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0;",
    );
    expect(file).toContain("rhombus;strokeWidth=2;rotatable=0;html=1;whiteSpace=wrap;");
    expect(file).toContain("shape=note2;boundedLbl=1;whiteSpace=wrap;html=1;size=10;");
    expect(file).toContain("endArrow=classic;endFill=1;");
    expect(file).toContain('tamDiagram="state"');
    // A composite state holds its parts; transitions join the cells of the states.
    expect(file).toMatch(/<mxCell id="Archived"[^>]*parent="Done"/);
    expect(file).toMatch(/source="Paid" target="Done"/);
  });

  it("writes fork and join bars with the TAMshapes style", async () => {
    const file = await exportDrawio(OWN[1][1], { measure: arialMeasure });
    expect(file).toContain(
      "rounded=0;fillColor=#000000;whiteSpace=wrap;html=1;strokeWidth=2;rotatable=0;",
    );
    expect(file).toContain("dashed=1;");
  });

  it("reads a page drawn by hand with the TAMshapes library", () => {
    const vertex = (
      id: string,
      value: string,
      style: string,
      x: number,
      y: number,
      width: number,
      height: number,
      parent = "1",
    ): Cell => ({
      id,
      parent,
      value,
      style,
      vertex: true,
      geometry: { x, y, width, height },
    });
    const edge = (id: string, source: string, target: string, value = ""): Cell => ({
      id,
      parent: "1",
      value,
      style:
        "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;startArrow=none;startFill=0;endArrow=classic;endFill=1;",
      edge: true,
      source,
      target,
      geometry: { x: 0, y: 0, width: 0, height: 0, relative: true },
    });
    const STATE = "rounded=1;whiteSpace=wrap;html=1;strokeWidth=2;arcSize=10;";
    const cells: Cell[] = [
      { id: "0" },
      { id: "1", parent: "0" },
      vertex(
        "aB3x-1",
        "",
        "ellipse;fillColor=#000000;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0;editable=0;resizable=0",
        50,
        0,
        20,
        20,
      ),
      vertex("aB3x-2", "Idle", STATE, 0, 60, 120, 60),
      vertex("aB3x-3", "Working hard", STATE, -40, 180, 400, 260),
      // Not nested in draw.io, but inside the composite's box.
      vertex("aB3x-4", "Reading", STATE, 0, 240, 120, 60),
      vertex("aB3x-5", "Writing", STATE, 200, 240, 120, 60),
      vertex("aB3x-6", "", "rhombus;strokeWidth=2;rotatable=0;editable=0", 150, 460, 20, 20),
      vertex("aB3x-7", "", "group;aspect=fixed;rotatable=0;resizable=0", 45, 500, 30, 30),
      vertex(
        "aB3x-8",
        "",
        "ellipse;fillColor=#FFFFFF;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0;editable=0",
        0,
        0,
        30,
        30,
        "aB3x-7",
      ),
      vertex(
        "aB3x-9",
        "",
        "ellipse;fillColor=#000000;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0;editable=0",
        7,
        7,
        16,
        16,
        "aB3x-7",
      ),
      vertex(
        "aB3x-10",
        "Waits for work",
        "shape=note2;boundedLbl=1;whiteSpace=wrap;html=1;size=10;spacingLeft=2;verticalAlign=top;align=left;fillColor=#FFFFFF;",
        140,
        60,
        100,
        50,
      ),
      vertex(
        "aB3x-11",
        "",
        "ellipse;fillColor=#000000;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0;",
        50,
        200,
        20,
        20,
      ),
      vertex(
        "aB3x-12",
        "A loose remark",
        "text;html=1;strokeColor=none;fillColor=none;",
        500,
        0,
        80,
        20,
      ),
      edge("e1", "aB3x-1", "aB3x-2"),
      edge("e2", "aB3x-2", "aB3x-3", "start"),
      edge("e3", "aB3x-11", "aB3x-4"),
      edge("e4", "aB3x-4", "aB3x-5", "write [ready] / lock"),
      edge("e5", "aB3x-5", "aB3x-6"),
      edge("e6", "aB3x-6", "aB3x-8", "[done]"),
      edge("e7", "aB3x-6", "aB3x-2", "[else]"),
    ];
    const drawing = new Drawing({ name: "Page-1", cells });
    expect(stateDrawio.likeness(drawing)).toBeGreaterThan(0);
    const { source, warnings } = stateDrawio.read(drawing);
    expect(warnings).toEqual(["The text “A loose remark” belongs to no state and is not read."]);
    expect(source).toBe(`stateDiagram-v2
  Idle
  state choice <<choice>>
  state "Working hard" as Working_hard {
    Reading
    Writing
    [*] --> Reading
  }
  [*] --> Idle
  choice --> [*] : [done]
  Idle --> Working_hard : start
  Reading --> Writing : write [ready] / lock
  Writing --> choice
  choice --> Idle : [else]
  note right of Idle : Waits for work
%% @root#initial 53,3
%% @Idle 0,60
%% @note1 140,60
%% @Working_hard#initial 53,203
%% @Reading 0,240
%% @Writing 200,240
%% @choice 151,461
%% @root#final1 52,507
`);
  });

  it("reads concurrent regions from dashed lines across a composite state", () => {
    const STATE = "rounded=1;whiteSpace=wrap;html=1;strokeWidth=2;arcSize=10;";
    const cells: Cell[] = [
      { id: "0" },
      { id: "1", parent: "0" },
      {
        id: "c-1",
        parent: "1",
        value: "Active",
        style: STATE,
        vertex: true,
        geometry: { x: 0, y: 0, width: 400, height: 200 },
      },
      {
        id: "c-2",
        parent: "1",
        value: "Left",
        style: STATE,
        vertex: true,
        geometry: { x: 20, y: 80, width: 120, height: 40 },
      },
      {
        id: "c-3",
        parent: "1",
        value: "Right",
        style: STATE,
        vertex: true,
        geometry: { x: 260, y: 80, width: 120, height: 40 },
      },
      {
        id: "line",
        parent: "1",
        style: "endArrow=none;dashed=1;html=1;",
        edge: true,
        geometry: {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          relative: true,
          sourcePoint: { x: 200, y: 40 },
          targetPoint: { x: 200, y: 200 },
        },
      },
    ];
    const { source } = stateDrawio.read(new Drawing({ name: "Page-1", cells }));
    const diagram = parseStateDiagram(source);
    expect(diagram.states.get("Active")!.children).toEqual(["Active#region1", "Active#region2"]);
    expect(diagram.states.get("Left")!.parent).toBe("Active#region1");
    expect(diagram.states.get("Right")!.parent).toBe("Active#region2");
  });

  it("has no likeness to a page without states", () => {
    const page = writeDrawio([{ name: "P", cells: [] }]);
    expect(page).toContain("mxfile");
    expect(
      stateDrawio.likeness(
        new Drawing({ name: "P", cells: [{ id: "0" }, { id: "1", parent: "0" }] }),
      ),
    ).toBe(0);
  });
});

describe("state machine diagrams made in draw.io", () => {
  const fixture = (name: string) => readFileSync(join(__dirname, "fixtures/drawio", name), "utf8");

  /** Imports a fixture, checks it reads as a state machine without warnings and lays out. */
  async function read(name: string) {
    const imported = await importDrawio(fixture(name));
    expect(imported.kind).toBe("state");
    expect(imported.warnings).toEqual([]);
    await layout(imported.source);
    return imported.source;
  }

  it("reads a diagram drawn with the TAMshapes libraries as its picture shows it", async () => {
    // Made in draw.io by fixtures/drawio/make/state-order.js: SD States, TAM-AD Start and End of
    // Activity, a Decision, Arrows connected floating and at fixed points, a composite state drawn
    // as a big State with the states dropped onto it, a self transition, a note beside a state, the
    // label of an arrow typed into a TAM-Ann Text beside it, and an arrow whose end was dropped
    // just short of the final state.
    expect(await read("state-order.drawio")).toBe(`---
title: Order
---
stateDiagram-v2
  Idle
  Shipped
  state Checkout {
    Address
    Payment
    state choice <<choice>>
    [*] --> Address
    choice --> [*] : [paid]
  }
  [*] --> Idle
  Shipped --> [*] : deliver
  Idle --> Checkout : checkout [cart not empty] / reserve
  Address --> Payment : next [valid] / save
  Payment --> Payment : decline / retry
  Payment --> choice : submit
  choice --> Address : [failed]
  Checkout --> Shipped : ship / notify
  note right of Idle : Waits for the customer
%% @root#initial 93,23
%% @Idle 40,80
%% @note1 210,85
%% @Checkout#initial 93,243
%% @Address 40,290
%% @Payment 260,290
%% @Checkout#final1 92,432
%% @choice 311,431
%% @Shipped 40,580
%% @root#final2 92,727
`);
  });

  it("reads TAMshapes mixed with draw.io's own UML shapes", async () => {
    // Made by fixtures/drawio/make/state-server.js: draw.io's UML 2.5 initial state, state with the
    // collapse symbol, rounded state, Join/Fork Node and choice (filled in the outline's color), the
    // older UML palette's final state in red, a TAM-AD Fork or Join turned upright, draw.io's
    // default edges and TAM-AD Arrows, a label added on an edge as a cell of its own, and a note
    // joined to its state by a dashed line.
    expect(await read("state-server.drawio")).toBe(`---
title: Server
---
stateDiagram-v2
  direction LR
  state "Loading config" as Loading_config
  Booting
  state fork <<fork>>
  state join <<join>>
  Ready
  Serving
  state "Warming cache" as Warming_cache
  state choice <<choice>>
  [*] --> Booting
  choice --> [*] : [invalid] / log
  Booting --> fork : start
  fork --> Loading_config
  fork --> Warming_cache
  Loading_config --> join
  Warming_cache --> join
  join --> Ready
  Ready --> Ready : tick / refresh
  Ready --> choice : request
  choice --> Serving : [valid]
  Serving --> Ready : done
  note left of Ready : Accepts requests
%% @note1 560,10
%% @Loading_config 340,50
%% @root#initial 28,143
%% @Booting 90,120
%% @fork 283,104
%% @join 520,104
%% @Ready 580,130
%% @Serving 790,120
%% @Warming_cache 340,190
%% @choice 641,266
%% @root#final1 642,367
`);
  });

  it("reads concurrent regions parted by a TAM-Ann border", async () => {
    // Made by fixtures/drawio/make/state-phone.js: a composite state with its name set bold at the
    // top, parted by a Border Vertical; the older UML palette's start state in one region, TAM-AD's
    // in the other; a UML state; self transitions on both sides of a state; an arrow routed round
    // the left with its label in a text beside it; the UML 2.5 final state.
    expect(await read("state-phone.drawio")).toBe(`---
title: Phone call
---
stateDiagram-v2
  Dialing
  Ended
  state Active {
    Talking
    [*] --> Talking
    --
    Recording
    [*] --> Recording
    Recording --> [*] : stop [disk full]
  }
  [*] --> Dialing
  Ended --> [*]
  Dialing --> Dialing : digit / append
  Dialing --> Active : answered / start timer
  Talking --> Talking : speak
  Active --> Ended : hang up
  Dialing --> Ended : busy
  note right of Dialing : Digits are collected until the number is complete
%% @root#initial 113,23
%% @Dialing 60,80
%% @note1 230,70
%% @Active#initial 133,268
%% @Active#region2#initial 403,268
%% @Talking 80,330
%% @Recording 340,320
%% @Active#region2#final1 402,417
%% @Ended 60,540
%% @root#final2 112,667
`);
  });

  it("parts a state's name from the behaviors typed below it", async () => {
    // Made by fixtures/drawio/make/state-behaviors.js: TAMshapes States with lines typed after the
    // name (Enter writes a <div>, Shift+Enter a <br>), one with draw.io's Insert Horizontal Rule
    // after the name, one named on two lines; draw.io's UML 2.5 state; the older UML palette's
    // Composite State and the UML 2.5 State with compartments, both swimlanes with texts below
    // the header; States parted by a Horizontal Line and by a draw.io Line drawn across them; and
    // an empty State with its name and behavior in texts above and below a line.
    expect(await read("state-behaviors.drawio")).toBe(`---
title: State behaviors
---
stateDiagram-v2
  Idle
  Idle : entry / reset
  Idle : exit / save
  state "Waiting for<br>payment" as Waiting_for_payment
  Counting
  Counting : entry / start
  Counting : do / count
  Counting : exit / stop
  Printing
  Printing : do / print
  Locked
  Locked : entry / lock
  Locked : exit / unlock
  Sending
  Sending : entry / connect
  Sending : timeout / resend
  Ringing
  Ringing : ring bell
  Ringing : flash light
  Muted
  Muted : volume zero
  Paused
  Paused : do / wait
  [*] --> Idle
  Paused --> [*]
  Idle --> Counting : start
  Counting --> Waiting_for_payment : stop
  Waiting_for_payment --> Printing : paid
  Printing --> Sending : printed
  Counting --> Locked : lock
  Locked --> Ringing : alarm
  Sending --> Muted : sent
  Ringing --> Muted : mute
  Ringing --> Paused : pause
%% @root#initial 113,23
%% @Idle 60,80
%% @Waiting_for_payment 260,80
%% @Counting 60,200
%% @Printing 260,200
%% @Locked 40,330
%% @Sending 260,310
%% @Ringing 60,480
%% @Muted 280,480
%% @Paused 60,620
%% @root#final1 112,747
`);
  });

  it("reads the lines of a label without a rule as the name up to the first behavior", () => {
    const cells: Cell[] = [
      { id: "0" },
      { id: "1", parent: "0" },
      ...[
        ["s-1", "Read and/or<br>write"],
        ["s-2", "Busy<div>tick [on] / count</div><div>more</div>"],
        ["s-3", "Off<br>entry/reset"],
      ].map(([id, value], index): Cell => ({
        id,
        parent: "1",
        value,
        style: "rounded=1;whiteSpace=wrap;html=1;strokeWidth=2;arcSize=10;",
        vertex: true,
        geometry: { x: 0, y: index * 100, width: 120, height: 60 },
      })),
    ];
    const { source } = stateDrawio.read(new Drawing({ name: "Page-1", cells }));
    expect(source).toContain(`  state "Read and/or<br>write" as Read_and_or_write
  Busy
  Busy : tick [on] / count
  Busy : more
  Off
  Off : entry/reset
`);
  });

  it("gives a note to the state its line joins, and the nearest only to a note without one", async () => {
    // Made by fixtures/drawio/make/state-notes.js: TAM-Ann Notes, each nearer another state than
    // the one its line joins: a dashed line dragged onto both, draw.io's default edge from a note
    // with its end dropped beside a state, a dashed line with both ends dropped, and a draw.io Line
    // dragged from a state and dropped inside a note; and a note without a line.
    expect(await read("state-notes.drawio")).toBe(`---
title: Job notes
---
stateDiagram-v2
  Idle
  Busy
  Error
  Done
  [*] --> Idle
  Done --> [*]
  Idle --> Busy : work
  Busy --> Error : fail
  Error --> Idle : reset
  Busy --> Done : finish
  note left of Error : Checked every minute
  note left of Idle : Ready for work
  note right of Busy : Logs the failure
  note left of Done : Kept for a week
  note right of Done : Archived nightly
%% @root#initial 93,23
%% @Idle 40,80
%% @note1 190,60
%% @note2 -150,85
%% @note3 440,150
%% @note4 -150,250
%% @Busy 40,220
%% @Error 300,220
%% @Done 40,360
%% @note5 300,370
%% @root#final1 92,487
`);
  });

  it("joins an arrow dropped short of a state to it, and says so", () => {
    const STATE = "rounded=1;whiteSpace=wrap;html=1;strokeWidth=2;arcSize=10;";
    const box = (
      id: string,
      value: string,
      x: number,
      y: number,
      width = 120,
      height = 60,
    ): Cell => ({
      id,
      parent: "1",
      value,
      style: STATE,
      vertex: true,
      geometry: { x, y, width, height },
    });
    const cells: Cell[] = [
      { id: "0" },
      { id: "1", parent: "0" },
      box("s-1", "Idle", 0, 0),
      box("s-2", "Busy", 0, 160, 400, 140),
      box("s-3", "Working", 40, 190),
      // Dropped 14 pixels above Idle, and inside Busy 12 pixels short of Working.
      ...[
        ["s-4", "s-2", { x: 60, y: -14 }, "back"],
        ["s-5", "s-1", { x: 100, y: 178 }, "go"],
      ].map(([id, source, targetPoint, value]): Cell => ({
        id: id as string,
        parent: "1",
        value: value as string,
        style: "endArrow=classic;html=1;",
        edge: true,
        source: source as string,
        geometry: {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          relative: true,
          targetPoint: targetPoint as { x: number; y: number },
        },
      })),
    ];
    const { source, warnings } = stateDrawio.read(new Drawing({ name: "Page-1", cells }));
    expect(source).toContain("Busy --> Idle : back");
    expect(source).toContain("Idle --> Working : go");
    expect(warnings).toEqual([
      "The connection “back” ends short of “Idle” and is read as joined to it.",
      "The connection “go” ends short of “Working” and is read as joined to it.",
    ]);
  });

  it("reads a diagram drawn with the tam-drawio plugin's activity palette", async () => {
    // The plugin's State is a plain box, its Start a black circle, its End of Activity a shape of
    // its own, its Fork or Join a thick line and its flows elbow edges.
    const STATE = "rounded=0;whiteSpace=wrap;html=1;strokeWidth=2;fillColor=default;";
    const START = "ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#000000;aspect=fixed;";
    const END = "shape=endactivity;strokeWidth=2;fillColor=#000000;aspect=fixed;";
    const DECISION = "rhombus;html=1;strokeWidth=2;aspect=fixed;";
    const BAR = "line;strokeWidth=13;html=1;fillColor=default;";
    const FLOW =
      "edgeStyle=elbowEdgeStyle;html=1;labelBackgroundColor=none;rounded=1;elbow=vertical;endArrow=classic;endFill=1;align=center;";
    const vertex = (
      id: string,
      value: string,
      style: string,
      [x, y, width, height]: number[],
    ): Cell => ({ id, parent: "1", value, style, vertex: true, geometry: { x, y, width, height } });
    const flow = (id: string, source: string, target: string, value = ""): Cell => ({
      id,
      parent: "1",
      value,
      style: FLOW,
      edge: true,
      source,
      target,
      geometry: { x: 0, y: 0, width: 0, height: 0, relative: true },
    });
    const cells: Cell[] = [
      { id: "0" },
      { id: "1", parent: "0" },
      vertex("Qx7-1", "", START, [85, 0, 30, 30]),
      vertex("Qx7-2", "Idle", STATE, [55, 70, 90, 40]),
      vertex("Qx7-3", "", BAR, [40, 150, 120, 10]),
      vertex("Qx7-4", "Download", STATE, [0, 200, 90, 40]),
      vertex("Qx7-5", "Unpack", STATE, [110, 200, 90, 40]),
      vertex("Qx7-6", "", BAR, [40, 280, 120, 10]),
      vertex("Qx7-7", "", DECISION, [85, 320, 30, 30]),
      vertex("Qx7-8", "", END, [85, 400, 30, 30]),
      flow("Qx7-9", "Qx7-1", "Qx7-2"),
      flow("Qx7-10", "Qx7-2", "Qx7-3", "update / notify"),
      flow("Qx7-11", "Qx7-3", "Qx7-4"),
      flow("Qx7-12", "Qx7-3", "Qx7-5"),
      flow("Qx7-13", "Qx7-4", "Qx7-6"),
      flow("Qx7-14", "Qx7-5", "Qx7-6"),
      flow("Qx7-15", "Qx7-6", "Qx7-7"),
      flow("Qx7-16", "Qx7-7", "Qx7-8", "[ok]"),
      flow("Qx7-17", "Qx7-7", "Qx7-2", "[failed]"),
    ];
    const file = writeDrawio([{ name: "Page-1", cells }]);
    const { kind, source, warnings } = await importDrawio(file);
    expect(kind).toBe("state");
    expect(warnings).toEqual([]);
    expect(source).toBe(`stateDiagram-v2
  Idle
  state fork <<fork>>
  Download
  Unpack
  state join <<join>>
  state choice <<choice>>
  [*] --> Idle
  choice --> [*] : [ok]
  Idle --> fork : update / notify
  fork --> Download
  fork --> Unpack
  Download --> join
  Unpack --> join
  join --> choice
  choice --> Idle : [failed]
%% @root#initial 93,8
%% @Idle 55,70
%% @fork 54,153
%% @Download 0,200
%% @Unpack 110,200
%% @join 54,283
%% @choice 91,326
%% @root#final1 92,407
`);
    await layout(source);
  });
});
