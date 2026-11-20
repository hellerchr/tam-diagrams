// Layout smoke tests: one small source per diagram kind lays out, draws and passes the layout audit, which finds faults.
import assert from "node:assert/strict";
import { test } from "vitest";
import { arialMeasure } from "../../src/arial-measure.ts";
import { auditScene } from "../../src/audit.ts";
import { type DiagramColors, drawScene } from "../../src/draw.ts";
import { renderUml, type UmlKind } from "../../src/index.ts";
import { emptyScene, type Scene } from "../../src/scene.ts";
import { renderTam } from "../../src/tam-layout.ts";

const colors: DiagramColors = {
  background: "#ffffff",
  text: "#1b1c1f",
  secondary: "#3f4146",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  font: "system-ui",
  dark: false,
};
const options = { measure: arialMeasure };

/** The faults the audit finds in a scene; notes are advice, not faults. */
const faults = (scene: Scene) => auditScene(scene).filter((finding) => !finding.note);

/** A drawn picture is well-formed SVG with its description, a sane size and nothing unescaped. */
function assertDrawn(picture: { svg: string; width: number; height: number; description: string }) {
  assert.match(picture.svg, /^<svg[^>]* viewBox="-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+"/);
  assert.ok(picture.svg.includes(`<title>${picture.description}</title>`), picture.description);
  assert.doesNotMatch(picture.svg, /NaN|undefined|<script|href=/);
  assert.ok(picture.width > 20 && picture.height > 20, `${picture.width}x${picture.height}`);
}

const TAM = `title Web server
agent browser[Web Browser] ...
agent server[Web Server] {
  agent http[HTTP Server]
  storage pages[Static HTML & CSS]
}
note cache[Cached<br>for a day]
browser -- calls @HTTP --> http
http -- reads --> pages
cache -.- pages`;

test("a TAM diagram lays out, draws its labels escaped and passes the audit", async () => {
  const picture = await renderTam(TAM, colors, options);
  assert.deepEqual(faults(picture.scene), []);
  assertDrawn(picture);
  for (const label of ["Web Browser", "HTTP Server", "Static HTML &amp; CSS", "HTTP", "for a day"])
    assert.ok(picture.svg.includes(`>${label}<`), label);
  // Multiplicity draws its dots: a stacked browser.
  assert.ok(picture.svg.includes('r="1.8"'));
});

test("a TAM diagram its source places stands where it says, without ELK", async () => {
  const picture = await renderTam(
    "agent a[Client] @0,0\nagent b[Server] @240,0\nstorage s[Data] @240,120\na -- calls --> b\nb -- reads --> s",
    colors,
    options,
  );
  assert.deepEqual(faults(picture.scene), []);
  assertDrawn(picture);
  const box = (id: string) => picture.scene.shapes.find((shape) => shape.id === id)?.box;
  assert.equal(box("b")!.x - box("a")!.x, 240);
  assert.equal(box("s")!.y - box("b")!.y, 120);
});

const UML: [UmlKind, string][] = [
  [
    "class",
    `classDiagram
  class Session {
    +id: str
    +send(text)
  }
  class Kernel {
    +run(code)
  }
  class Agent
  <<interface>> Agent
  Session "1" --> "1" Kernel : runs
  Session "1" --> "*" Agent
  Agent <|-- Kernel`,
  ],
  [
    "state",
    `stateDiagram-v2
  [*] --> First
  state First {
    [*] --> Second
    Second --> Third : go
    Third --> [*]
  }
  state check <<choice>>
  First --> check
  check --> Done : ok
  check --> First : retry
  note right of Done : finished
  Done --> [*]`,
  ],
  [
    "flowchart",
    `flowchart LR
  user([User prompt]) --> model[Model turn]
  model -->|python| kernel[(REPL kernel)]
  model -->|functions| discovery{{Function discovery}}
  discovery --> mcp[mcp.server tools]
  kernel --> result[Tool result]
  mcp --> result
  result --> model
  model --> reply([Final reply])`,
  ],
  [
    "swimlane",
    `---
title: Request processing across agents
---
swimlane-beta TB
  subgraph Consumer
    start((Start)) --> send(Send Request) --> fork@{ shape: fork }
    fork --> wait(Wait for Response)
    join@{ shape: join } --> handle(Process Response) --> stop(((End)))
    wait --> join
  end
  subgraph wse [Web Service Enabling]
    decision{ } -->|Done| reply(Send Response)
  end
  subgraph ba [Business Application]
    process(Process Request)
  end
  fork --> process
  process --> decision
  decision -->|retry| process
  reply --> join`,
  ],
  [
    "sequence",
    `sequenceDiagram
  autonumber
  actor Alice
  Alice->>+John: Hello John, how are you?
  loop Every minute
    John-->>Alice: Great!
  end
  alt is sick
    Bob->>Alice: Not so good :(
  else is well
    Bob-)Alice: Feeling fresh
  end
  Note over Alice,John: A typical interaction
  John-->>-Alice: Bye`,
  ],
  [
    "usecase",
    `---
title: Ordering
---
usecase-beta
  direction LR
  actor User
  actor Manager
  actor svc("Purchasing Service") <<actor>>
  create(Create Order)
  approve(Approve Order)
  process(Process Order)
  User -- create
  Manager -- create
  Manager -- approve
  create --> approve
  approve --> process
  process -- svc`,
  ],
  [
    "er",
    `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE-ITEM : contains
  CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
  CUSTOMER {
    string name PK
    string sector "the market"
  }
  ORDER {
    int orderNumber PK
    string customer FK
  }`,
  ],
];

const scenes = new Map<UmlKind, Scene>();
for (const [kind, source] of UML)
  test(`a ${kind} diagram lays out, draws and passes the audit`, async () => {
    const picture = await renderUml(source, colors, options);
    assert.equal(picture.kind, kind);
    assert.deepEqual(faults(picture.scene), []);
    assertDrawn(picture);
    scenes.set(kind, picture.scene);
  });

test("a class diagram its source places stands where it says", async () => {
  const source = `classDiagram
  class Order
  class Item
  Order --> Item : holds
%% @Order 0,0
%% @Item 300,0`;
  const picture = await renderUml(source, colors, options);
  assert.deepEqual(faults(picture.scene), []);
  const box = (id: string) => picture.scene.shapes.find((shape) => shape.id === id)?.box;
  assert.ok(box("Order") && box("Item"));
  assert.equal(box("Item")!.x - box("Order")!.x, 300);
  assert.equal(box("Item")!.y, box("Order")!.y);
});

test("the dark theme draws light ink on its own background", () => {
  const scene = scenes.get("class");
  assert.ok(scene);
  const dark = {
    ...colors,
    background: "#151618",
    text: "#ecedef",
    secondary: "#c3c4c6",
    dark: true,
  };
  const svg = drawScene(scene, dark, "Dark");
  assert.ok(svg.includes("#151618"));
  assert.ok(!svg.includes('fill="#ffffff"'));
});

/** Two boxes joined by a straight wire `w`, the base the audit's own tests break. */
function twoBoxes(): Scene {
  const scene = emptyScene();
  for (const [id, x] of [
    ["a", 0],
    ["b", 160],
  ] as const)
    scene.shapes.push({
      id,
      kind: "rect",
      box: { x, y: 0, width: 60, height: 30 },
      container: false,
      depth: 0,
      fill: "page",
    });
  const points = [
    { x: 60, y: 15 },
    { x: 160, y: 15 },
  ];
  scene.wires.push({ edge: "w", points, ends: ["a", "b"], home: [], from: "a", to: "b" });
  scene.bounds = { x: -20, y: -20, width: 260, height: 120 };
  return scene;
}
const checks = (scene: Scene) => auditScene(scene).map((finding) => finding.check);

test("the audit finds a marker whose anchor is off its wire end", () => {
  for (const kind of ["arrow", "open", "triangle", "cross", "circle"] as const) {
    const scene = twoBoxes();
    scene.markers.push({ kind, tip: { x: 160, y: 15 }, direction: { x: 1, y: 0 }, wire: "w" });
    assert.ok(!checks(scene).includes("marker-off-end"), kind);
    scene.markers[0]!.tip = { x: 154, y: 15 };
    assert.ok(checks(scene).includes("marker-off-end"), kind);
  }
});

test("the audit finds a sequence number badge on a bar or a line", () => {
  const scene = twoBoxes();
  const shape = { container: false, depth: 0, passable: true } as const;
  scene.shapes.push({
    ...shape,
    id: "badge:x",
    kind: "badge",
    box: { x: 100, y: 40, width: 18, height: 18 },
    fill: "ink",
  });
  assert.ok(!checks(scene).includes("badge-overlap"));
  scene.shapes.push({
    ...shape,
    id: "bar",
    kind: "activation",
    box: { x: 112, y: 35, width: 10, height: 40 },
    fill: "strong",
  });
  assert.ok(checks(scene).includes("badge-overlap"));
  scene.shapes.pop();
  const line = [
    { x: 116, y: 0 },
    { x: 116, y: 80 },
  ];
  scene.lines.push({ points: line, dashed: true, tone: "boundary", width: 1 });
  assert.ok(checks(scene).includes("badge-overlap"));
});
