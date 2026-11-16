// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { exportDrawio, importDrawio } from "../src/drawio.ts";
import { type Cell, Drawing, readDrawio, writeDrawio } from "../src/drawio-file.ts";
import { sequenceDrawio } from "../src/drawio-sequence.ts";
import { parseUml } from "../src/index.ts";
import { generateSequenceDiagram } from "../src/samples/fuzz.ts";
import { SEQUENCE_EXAMPLES } from "../src/samples/uml-examples.ts";
import type { Scene } from "../src/scene.ts";
import { readPlaces } from "../src/uml-places.ts";
import { parseSequenceDiagram } from "../src/uml-sequence.ts";

/**
 * A sequence diagram in substance: participants in lane order (name, actor or not), and its events
 * with participants by lane, `+` and `-` as the activations they stand for, and activations that
 * happen at one moment in a fixed order.
 */
function substance(source: string) {
  const diagram = parseSequenceDiagram(source);
  const places = readPlaces(source);
  const lanes = [...diagram.participants.keys()];
  if (places.size) lanes.sort((a, b) => places.get(`head:${a}`)!.x - places.get(`head:${b}`)!.x);
  const lane = (id: string) => lanes.indexOf(id);
  const events: string[] = [];
  for (const event of diagram.events) {
    switch (event.type) {
      case "message":
        events.push(
          `message ${lane(event.from)}>${lane(event.to)} ${event.dashed ? "dashed" : "solid"} ${event.head}/${event.tail} ${event.number ?? ""} ${event.text}`,
        );
        if (event.activate) events.push(`activate ${lane(event.to)}`);
        if (event.deactivate) events.push(`deactivate ${lane(event.from)}`);
        break;
      case "activate":
      case "deactivate":
      case "create":
      case "destroy":
        events.push(`${event.type} ${lane(event.who)}`);
        break;
      case "note":
        events.push(`note ${event.placement} ${event.who.map(lane).sort()} ${event.text}`);
        break;
      case "start":
      case "else":
        events.push(`${event.type} ${event.kind} ${event.text}`);
        break;
      case "end":
        events.push("end");
    }
  }
  // Activations at one moment (no other event between) may be written in any order.
  for (let index = 0; index < events.length;) {
    let end = index;
    while (end < events.length && /^(de)?activate /.test(events[end])) end++;
    if (end > index) events.splice(index, end - index, ...events.slice(index, end).sort());
    index = end + 1;
  }
  return {
    title: diagram.title,
    level: diagram.level,
    participants: lanes.map((id) => {
      const item = diagram.participants.get(id)!;
      return [item.label, item.actor, item.created, item.destroyed];
    }),
    groups: diagram.boxes.map((box) => box.label),
    events,
  };
}

/** The boxes of a scene's shapes by kind, rounded, in reading order. */
const boxes = (scene: Scene, kind: string) =>
  scene.shapes
    .filter((shape) => shape.kind === kind)
    .map((shape) => shape.box)
    .sort((a, b) => a.y - b.y || a.x - b.x);

const SOURCES: [string, string][] = [
  ...SEQUENCE_EXAMPLES,
  [
    "fragments nested, branches and notes",
    `sequenceDiagram
  title Orders; "nested"
  participant S as Shop #1
  participant B as Bank <b>
  actor C as Customer
  C->>+S: order
  loop every item
    S->>B: check
    alt fine
      B-->>S: ok
    else not fine
      note over S,B: both log it
      B--xS: refused
    end
  end
  par mail
    S-)C: mail
  and book
    S->>S: book
  end
  critical reserve
    S->>B: reserve
  option timeout
    S->>B: cancel
  end
  S-->>-C: done`,
  ],
  [
    "autonumbered with a step, created and destroyed",
    `sequenceDiagram
  %% level design
  participant A
  autonumber 10 5
  A->>A: start
  create actor U as User
  A->>+U: hello
  U-->>-A: hi
  autonumber off
  A<<-->>U: chat
  destroy U
  A-xU: bye`,
  ],
  ...[3, 5, 8, 11].map((seed): [string, string] => [
    `generated ${seed}`,
    generateSequenceDiagram(seed),
  ]),
];

describe("sequence diagrams as draw.io files", () => {
  it.each(SOURCES)("%s goes to draw.io and back", async (_, source) => {
    const xml = await exportDrawio(source, { measure: arialMeasure });
    const imported = await importDrawio(xml);
    expect(imported.kind).toBe("sequence");
    expect(imported.warnings).toEqual([]);
    expect(substance(imported.source)).toEqual(substance(source));
    // Laid out again, the source draws the same picture: heads where they were, bars, notes and frames too.
    const first = await parseUml(source).layout(arialMeasure),
      again = await parseUml(imported.source).layout(arialMeasure);
    for (const shape of first.shapes.filter((item) => item.id.startsWith("head:"))) {
      const head = again.shapes.find(
        (item) => item.id.startsWith("head:") && Math.abs(item.box.x - shape.box.x) <= 2,
      );
      expect(head, shape.id).toBeDefined();
      expect(Math.abs(head!.box.y - shape.box.y)).toBeLessThanOrEqual(2);
    }
    for (const kind of ["activation", "note", "frame", "destroy", "badge"]) {
      const before = boxes(first, kind),
        after = boxes(again, kind);
      expect(after.length, kind).toBe(before.length);
      before.forEach((box, index) => {
        for (const key of ["x", "y", "width", "height"] as const)
          expect(Math.abs(after[index][key] - box[key]), `${kind} ${key}`).toBeLessThanOrEqual(2);
      });
    }
  });

  it("draws with the TAM-SeqD, TAM-BD and TAM-Ann shapes", async () => {
    const xml = await exportDrawio(SEQUENCE_EXAMPLES[3][1], { measure: arialMeasure });
    expect(xml).toContain("tamDiagram");
    // The agent's box of a lifeline, its dashed line, and the activation bars.
    expect(xml).toContain("rounded=0;whiteSpace=wrap;html=1;strokeWidth=2;fillColor=#FFFFFF;");
    expect(xml).toMatch(
      /dashed=1;dashPattern=5 5;strokeWidth=2;strokeColor=#666666;startArrow=none;endArrow=none;/,
    );
    expect(xml).toContain(
      "rounded=0;whiteSpace=wrap;html=1;strokeWidth=2;fillColor=#E6E6E6;tam=activation;",
    );
    // A synchronous call, a reply, an asynchronous message, a lost one.
    expect(xml).toMatch(/value="getData\(\)" style="[^"]*endArrow=classic;endFill=1;/);
    expect(xml).toMatch(
      /value="Data" style="[^"]*dashed=1;dashPattern=4 4;endArrow=open;endFill=0;/,
    );
    expect(xml).toMatch(
      /value="updateStaticPages\(\)" style="html=1;rounded=0;edgeStyle=none;endArrow=open;endFill=0;/,
    );
    expect(xml).toMatch(/value="delete" style="[^"]*endArrow=cross;/);
    // A fragment, its condition and branch line; a destruction.
    expect(xml).toMatch(/value="alt" style="shape=umlFrame;/);
    expect(xml).toContain('value="[Cancel OR Timeout]"');
    expect(xml).toMatch(/style="html=1;endArrow=none;startArrow=none;dashed=1;[^"]*tam=branch;"/);
    expect(xml).toContain("shape=umlDestroy;");
    // Messages connect to the bars they leave and reach.
    expect(xml).toMatch(/value="getData\(\)"[^>]*source="dyn#bar\d"[^>]*target="data#bar\d"/);

    const actors = await exportDrawio(SEQUENCE_EXAMPLES[5][1], { measure: arialMeasure });
    // An actor is the TAM-BD Human figure; notes are TAM-Ann notes.
    expect(actors).toContain(
      "group;strokeWidth=2;rotatable=0;editable=0;fillColor=none;tam=human;",
    );
    expect(actors).toContain("shape=note2;boundedLbl=1;");
  });

  it("reads a page drawn by hand with the TAMshapes library", async () => {
    const result = sequenceDrawio.read(new Drawing({ name: "Page-1", cells: HAND_DRAWN }));
    expect(result.warnings).toEqual([]);
    expect(result.source).toBe(`sequenceDiagram
  actor Customer
  participant Shop
  participant Bank
  activate Customer
  Customer->>+Shop: order
  alt card ok
    Shop->>+Bank: charge
    Bank-->>-Shop: done
  else card refused
    note right of Bank: Bank logs it
  end
  Shop-)Customer: receipt
  Shop-->>-Customer: thanks
  deactivate Customer
%% @head:Customer 50,10
%% @head:Shop 200,30
%% @head:Bank 400,30
`);
    expect(() => parseUml(result.source)).not.toThrow();
  });

  it("reads draw.io's own lifelines, actors and frames", async () => {
    const page = writeDrawio([{ name: "Login flow", cells: BUILT_IN }]);
    const result = await importDrawio(page);
    expect(result.kind).toBe("sequence");
    expect(result.warnings).toEqual([
      "The frame “ref login” is no fragment a sequence diagram has (loop, alt, opt, par, critical, break); its messages are read without it.",
      "The shape “Legend” is no part of a sequence diagram and is left out.",
    ]);
    expect(result.source).toBe(`sequenceDiagram
  title Login flow
  actor User
  participant App_server as App server
  User->>+App_server: log in
  loop 3 times
    App_server->>App_server: check
  end
  App_server-->>-User: welcome
%% @head:User 40,20
%% @head:App_server 200,20
`);
  });

  it("looks like a sequence diagram only with lifelines, bars or frames", async () => {
    const [page] = await readDrawio(writeDrawio([{ name: "p", cells: BUILT_IN }]));
    expect(sequenceDrawio.likeness(new Drawing(page))).toBeGreaterThan(0);
    expect(sequenceDrawio.likeness(new Drawing({ name: "p", cells: HAND_DRAWN }))).toBeGreaterThan(
      0,
    );
    const plain: Cell[] = [
      {
        id: "a",
        parent: "1",
        vertex: true,
        value: "A",
        style: "rounded=0;html=1;",
        geometry: { x: 0, y: 0, width: 120, height: 60 },
      },
    ];
    expect(sequenceDrawio.likeness(new Drawing({ name: "p", cells: plain }))).toBe(0);
  });
});

/**
 * Pages made in the real draw.io with the TAMshapes libraries (test/fixtures/drawio/make builds them),
 * and the sources they stand for.
 */
const REAL: [string, string][] = [
  [
    // A TAM-BD Human with a TAM-Ann text and border below; lifelines renamed and stretched; bars
    // dropped by eye; message exchanges laid over a bar; a text above a plain connector; loose ends.
    "checkout",
    `sequenceDiagram
  title Checkout
  actor Customer
  participant Web_Shop as Web Shop
  participant Payment
  participant Stock
  activate Customer
  Customer->>+Web_Shop: checkout
  Web_Shop->>+Payment: authorize(card)
  Payment-->>-Web_Shop: approved
  Web_Shop->>+Stock: reserve(items)
  Stock-->>-Web_Shop: reserved
  note right of Stock: checks stock levels
  deactivate Customer
  Web_Shop-)+Customer: mail sent
  deactivate Customer
  Web_Shop-->>-Customer: done
%% @head:Customer 90,40
%% @head:Web_Shop 200,40
%% @head:Payment 360,40
%% @head:Stock 560,40
`,
  ],
  [
    // draw.io's actor lifeline and lifeline among TAM-SeqD ones, a UML frame for a loop, messages
    // connected to draw.io's lifelines, an R2L exchange, a TAM-AD arrow from an exchange's bar.
    "login",
    `sequenceDiagram
  actor User
  participant App
  participant Auth_Service as Auth Service
  participant User_DB as User DB
  User->>+App: open login
  loop until valid
    App->>+Auth_Service: verify(pw)
    Auth_Service->>User_DB: lookup
    User_DB-->>Auth_Service: user row
    Auth_Service-->>-App: token
  end
  App->>+User: confirm 2FA
  User-->>-App: code
  App-)-User: welcome
  note over App,Auth_Service: session stored
%% @head:User 50,40
%% @head:App 160,40
%% @head:Auth_Service 330,40
%% @head:User_DB 480,40
`,
  ],
  [
    // A title in a text, draw.io's UML actor over a hand-drawn dashed line, the TAM-BD Human dropped
    // into a lifeline's box, an alt frame split by a TAM-Ann border, a message drawn backwards.
    "support",
    `sequenceDiagram
  title Support ticket
  actor Customer
  participant Ticket_System as Ticket System
  actor Support_Agent as Support Agent
  participant Mailer
  Customer-)+Ticket_System: open ticket
  Ticket_System-)+Support_Agent: assign
  note right of Mailer: sends mails in batches
  deactivate Ticket_System
  alt solved
    Support_Agent->>+Ticket_System: close()
    Ticket_System-->>-Support_Agent: ok
  else escalate
    Support_Agent->>Mailer: notify team
  end
  Ticket_System-)+Customer: ticket closed
  deactivate Support_Agent
  deactivate Customer
%% @head:Customer 45,40
%% @head:Ticket_System 160,40
%% @head:Support_Agent 320,40
%% @head:Mailer 520,40
`,
  ],
  [
    // TAM-SeqD exchanges from callers with no bar of their own, whose white bars are their
    // activations; exchanges stretched across 400 and 600px; one nested in a stretched-down one.
    "exchanges",
    `sequenceDiagram
  participant Shop
  participant Billing
  participant Warehouse
  Shop->>+Billing: invoice(order)
  activate Shop
  Billing->>+Warehouse: check(stock)
  Warehouse-->>-Billing: in stock
  Billing-->>-Shop: invoice
  deactivate Shop
  Warehouse->>+Shop: ready(order)
  activate Warehouse
  Shop-->>-Warehouse: ok
  deactivate Warehouse
  Shop-)+Warehouse: picked up
  deactivate Warehouse
%% @head:Shop 40,40
%% @head:Billing 240,40
%% @head:Warehouse 640,40
`,
  ],
  [
    // Messages connected to bars without fixed points: draw.io's own lifelines and bars with its
    // sequence router (dragged to a height, or left halfway; a self call), and a straight edge from
    // the bar of a TAM-SeqD exchange to one of draw.io's bars.
    "floating",
    `sequenceDiagram
  participant Browser
  participant API
  participant Cache
  participant DB
  activate Browser
  Browser->>+API: GET /page
  API->>+Cache: get(key)
  Cache-->>API: evicted
  Cache-->>-API: miss
  API->>+DB: query
  DB-->>API: rows
  deactivate DB
  API-->>-Browser: page
  Browser->>Browser: render
  deactivate Browser
%% @head:Browser 40,40
%% @head:API 240,40
%% @head:Cache 390,40
%% @head:DB 640,40
`,
  ],
];

describe("sequence diagrams drawn in draw.io itself", () => {
  it.each(REAL)("reads %s as its picture shows", async (name, expected) => {
    const file = readFileSync(
      new URL(`fixtures/drawio/sequence-${name}.drawio`, import.meta.url),
      "utf8",
    );
    const result = await importDrawio(file);
    expect(result.kind).toBe("sequence");
    expect(result.warnings).toEqual([]);
    expect(result.source).toBe(expected);
    await expect(parseUml(result.source).layout(arialMeasure)).resolves.toBeDefined();
  });
});

const AGENT =
  "rounded=0;recursiveResize=0;resizeHeight=0;fillColor=#FFFFFF;whiteSpace=wrap;html=1;strokeWidth=2;";
const LINE =
  "edgeStyle=elbowEdgeStyle;dashed=1;dashPattern=5 5;strokeWidth=2;strokeColor=#666666;arcSize=0;startArrow=none;endArrow=none;startSize=0;endSize=0;html=1;endFill=0;align=left;resizeWidth=0;connectable=0;allowArrows=0;bendable=0;noJump=1;";
const CONTAINER =
  "html=1;noLabel=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;spacingLeft=4;spacingRight=4;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;connectable=0;allowArrows=0;expand=0;dropTarget=0;noLabel=1;";
const BAR =
  "rounded=0;resizeWidth=0;whiteSpace=wrap;html=1;strokeWidth=2;fillColor=#E6E6E6;align=right;connectable=0;";
const SYNC =
  "rounded=0;orthogonalLoop=1;jettySize=auto;html=1;dashed=0;endArrow=classic;endFill=1;";
const REPLY =
  "rounded=0;orthogonalLoop=1;jettySize=auto;html=1;dashed=1;dashPattern=4 4;endArrow=open;endFill=0;";
const ASYNC =
  "rounded=0;orthogonalLoop=1;jettySize=auto;html=1;dashed=0;startArrow=none;endArrow=open;endFill=0;";
const HUMAN_LINE =
  "edgeStyle=none;strokeWidth=2;html=1;startArrow=none;startFill=0;endArrow=none;endFill=0;";

/** A lifeline as the TAM-SeqD library makes it: an invisible container, the agent's box, the dashed line. */
function lifeline(id: string, label: string, x: number, y: number): Cell[] {
  return [
    {
      id: `${id}-c`,
      parent: "1",
      vertex: true,
      value: "",
      style: CONTAINER,
      geometry: { x, y, width: 120, height: 360 },
    },
    {
      id: `${id}-h`,
      parent: `${id}-c`,
      vertex: true,
      value: label,
      style: AGENT,
      geometry: { x: 0, y: 0, width: 120, height: 60 },
    },
    {
      id: `${id}-l`,
      parent: `${id}-c`,
      edge: true,
      source: `${id}-h`,
      style: LINE,
      geometry: {
        x: 0,
        y: 0,
        width: 0,
        height: 300,
        sourcePoint: { x: 60, y: 60 },
        targetPoint: { x: 60, y: 360 },
      },
    },
  ];
}

const bar = (id: string, x: number, y: number, height: number): Cell => ({
  id,
  parent: "1",
  vertex: true,
  value: "",
  style: BAR,
  geometry: { x: x - 10, y, width: 20, height },
});

const message = (
  id: string,
  style: string,
  value: string,
  from: string,
  to: string,
  y: number,
  x1: number,
  x2: number,
): Cell => ({
  id,
  parent: "1",
  edge: true,
  value,
  style,
  source: from || undefined,
  target: to || undefined,
  geometry: {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    relative: true,
    ...(from ? {} : { sourcePoint: { x: x1, y } }),
    ...(to ? {} : { targetPoint: { x: x2, y } }),
  },
});

/** Ends pinned to a bar's side at a height, as draw.io writes them. */
const pinned = (style: string, side: "exit" | "entry", fx: number, fy: number) =>
  `${style}${side}X=${fx};${side}Y=${fy};${side}Dx=0;${side}Dy=0;`;

/**
 * A customer (the TAM-BD Human figure with a text below) ordering at a shop that charges a bank, drawn
 * with the TAMshapes library: lifelines at x 60, 260 and 460, bars of 20, messages connected to the
 * bars or loose near a lifeline, an alt frame, a note.
 */
const HAND_DRAWN: Cell[] = [
  {
    id: "hum",
    parent: "1",
    vertex: true,
    connectable: false,
    value: "",
    style: "group;strokeWidth=2;rotatable=0;editable=0;fillColor=none;",
    geometry: { x: 50, y: 10, width: 20, height: 40 },
  },
  {
    id: "hum-1",
    parent: "hum",
    vertex: true,
    value: "",
    style: "ellipse;strokeWidth=2;whiteSpace=wrap;html=1;",
    geometry: { x: 4, y: 0, width: 12, height: 12 },
  },
  ...[
    [10, 12, 10, 26],
    [10, 18, 20, 12],
    [10, 18, 0, 12],
    [10, 26, 0, 40],
    [10, 26, 20, 40],
  ].map(([x1, y1, x2, y2], index): Cell => ({
    id: `hum-l${index}`,
    parent: "hum",
    edge: true,
    style: HUMAN_LINE,
    geometry: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      sourcePoint: { x: x1, y: y1 },
      targetPoint: { x: x2, y: y2 },
    },
  })),
  {
    id: "hum-t",
    parent: "1",
    vertex: true,
    value: "Customer",
    style: "text;html=1;align=center;verticalAlign=middle;",
    geometry: { x: 20, y: 52, width: 80, height: 20 },
  },
  {
    id: "hum-line",
    parent: "1",
    edge: true,
    style: LINE,
    geometry: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      sourcePoint: { x: 60, y: 75 },
      targetPoint: { x: 60, y: 420 },
    },
  },
  ...lifeline("Xq1-a", "Shop", 200, 30),
  ...lifeline("Xq1-b", "Bank", 400, 30),
  bar("b0", 60, 100, 300),
  bar("b1", 260, 120, 260),
  bar("b2", 460, 200, 60),
  message("e1", pinned(SYNC, "exit", 1, 0.067), "order", "b0", "b1", 120, 0, 0),
  {
    id: "f1",
    parent: "1",
    vertex: true,
    value: "alt",
    style: "shape=umlFrame;whiteSpace=wrap;html=1;pointerEvents=0;",
    geometry: { x: 180, y: 160, width: 420, height: 180 },
  },
  {
    id: "f1-g",
    parent: "1",
    vertex: true,
    value: "[card ok]",
    style: "text;html=1;align=left;",
    geometry: { x: 250, y: 162, width: 80, height: 16 },
  },
  message(
    "e2",
    pinned(pinned(SYNC, "exit", 1, 0.308), "entry", 0, 0),
    "charge",
    "b1",
    "b2",
    200,
    0,
    0,
  ),
  message("e3", REPLY, "done", "", "", 255, 452, 272),
  {
    id: "f1-s",
    parent: "1",
    edge: true,
    style: "endArrow=none;dashed=1;html=1;",
    geometry: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      sourcePoint: { x: 180, y: 280 },
      targetPoint: { x: 600, y: 280 },
    },
  },
  {
    id: "f1-h",
    parent: "1",
    vertex: true,
    value: "[card refused]",
    style: "text;html=1;align=left;",
    geometry: { x: 186, y: 284, width: 100, height: 16 },
  },
  {
    id: "n1",
    parent: "1",
    vertex: true,
    value: "Bank logs it",
    style: "shape=note2;boundedLbl=1;whiteSpace=wrap;html=1;size=10;",
    geometry: { x: 490, y: 295, width: 100, height: 30 },
  },
  message("e4", ASYNC, "receipt", "", "", 350, 255, 75),
  message(
    "e5",
    pinned(pinned(REPLY, "exit", 0, 1), "entry", 1, 0.933),
    "thanks",
    "b1",
    "b0",
    380,
    0,
    0,
  ),
];

/**
 * draw.io's own UML shapes: a lifeline with an actor, one with a box, an activation inside it, frames;
 * the messages to the actor's lifeline meet it where the file keeps their ends. And a shape that is
 * no part of a sequence diagram.
 */
const BUILT_IN: Cell[] = [
  {
    id: "legend",
    parent: "1",
    vertex: true,
    value: "Legend",
    style: "ellipse;whiteSpace=wrap;html=1;",
    geometry: { x: 400, y: 300, width: 80, height: 40 },
  },
  {
    id: "u",
    parent: "1",
    vertex: true,
    value: "User",
    style:
      "shape=umlLifeline;participant=umlActor;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;verticalAlign=top;spacingTop=36;outlineConnect=0;portConstraint=eastwest;",
    geometry: { x: 40, y: 20, width: 20, height: 300 },
  },
  {
    id: "s",
    parent: "1",
    vertex: true,
    value: "App server",
    style:
      "shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;outlineConnect=0;portConstraint=eastwest;",
    geometry: { x: 200, y: 20, width: 100, height: 300 },
  },
  {
    id: "s-a",
    parent: "s",
    vertex: true,
    value: "",
    style:
      "html=1;points=[];perimeter=orthogonalPerimeter;outlineConnect=0;targetShapes=umlLifeline;portConstraint=eastwest;",
    geometry: { x: 45, y: 60, width: 10, height: 180 },
  },
  {
    id: "m1",
    parent: "1",
    edge: true,
    value: "log in",
    style:
      "html=1;verticalAlign=bottom;endArrow=block;curved=0;rounded=0;entryX=0;entryY=0;entryDx=0;entryDy=0;",
    source: "u",
    target: "s-a",
    geometry: { x: 0, y: 0, width: 0, height: 0, relative: true, sourcePoint: { x: 50, y: 80 } },
  },
  {
    id: "fr",
    parent: "1",
    vertex: true,
    value: "loop",
    style: "shape=umlFrame;whiteSpace=wrap;html=1;pointerEvents=0;",
    geometry: { x: 150, y: 100, width: 220, height: 100 },
  },
  {
    id: "fr-t",
    parent: "fr",
    vertex: true,
    value: "[3 times]",
    style: "text;html=1;",
    geometry: { x: 65, y: 2, width: 60, height: 16 },
  },
  {
    id: "m2",
    parent: "1",
    edge: true,
    value: "check",
    style:
      "html=1;align=left;spacingLeft=2;endArrow=block;rounded=0;edgeStyle=orthogonalEdgeStyle;curved=0;exitX=1;exitY=0.333;entryX=1;entryY=0.5;",
    source: "s-a",
    target: "s-a",
    geometry: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      relative: true,
      points: [
        { x: 280, y: 140 },
        { x: 280, y: 170 },
      ],
    },
  },
  {
    id: "ref",
    parent: "1",
    vertex: true,
    value: "ref login",
    style: "shape=umlFrame;whiteSpace=wrap;html=1;pointerEvents=0;",
    geometry: { x: 20, y: 330, width: 120, height: 40 },
  },
  {
    id: "m3",
    parent: "1",
    edge: true,
    value: "welcome",
    style:
      "html=1;verticalAlign=bottom;endArrow=open;dashed=1;endSize=8;curved=0;rounded=0;exitX=0;exitY=1;exitDx=0;exitDy=0;",
    source: "s-a",
    target: "u",
    geometry: { x: 0, y: 0, width: 0, height: 0, relative: true, targetPoint: { x: 50, y: 260 } },
  },
];
