// draw.io files and back (drawio.ts): each type carried round trip, a page made in draw.io itself, and the forms a
// file comes in (compressed, inside an SVG); what is no draw.io file is refused.
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arialMeasure } from "../../src/arial-measure.ts";
import { exportDrawio, importDrawio, isDrawio, type DrawioKind } from "../../src/drawio.ts";
import {
  DrawioError,
  deflatePage,
  readDrawio,
  writeDrawio,
  type Cell,
} from "../../src/drawio-file.ts";
import { parseFlowchart } from "../../src/uml-activity.ts";
import { parseSequenceDiagram } from "../../src/uml-sequence.ts";
import { parseStateDiagram } from "../../src/uml-state.ts";
import { parseTam } from "../../src/tam.ts";

const SOURCES: Record<DrawioKind, string> = {
  tam: `title Order system
human customer[Customer]
agent shop[Web Shop] {
  agent api[Order API]
  storage cart[Cart]:::blue
}
storage db[Orders]
customer -- calls: place order --> api
api -- reads/writes --> cart
api -- writes --> db
`,
  flowchart: `flowchart TD
  start((Start)) --> form[Show login form]
  form --> valid{Credentials valid?}
  valid -->|yes| session[Create session]
  valid -->|no| form
  session --> done(((Logged in)))
`,
  swimlane: `swimlane-beta TB
  subgraph Team
    a(Plan sprint) --> b(Build features)
  end
  subgraph Ops
    c(Deploy) --> d(((Done)))
  end
  b --> c
`,
  state: `stateDiagram-v2
  [*] --> Idle
  Idle --> Running: prompt
  Running --> Waiting: question
  Waiting --> Running: answer
  Running --> Idle: done
`,
  sequence: `sequenceDiagram
  participant W as Web UI
  participant H as Harness
  W->>H: send message
  H-->>W: streamed text
  H->>H: run tool
`,
};

const PARSERS: Record<DrawioKind, (source: string) => unknown> = {
  tam: parseTam,
  flowchart: parseFlowchart,
  swimlane: parseFlowchart,
  state: parseStateDiagram,
  sequence: parseSequenceDiagram,
};

/** Every label and text a parsed diagram holds, sorted: what a round trip keeps whatever the ids and places. */
function names(value: unknown, found: string[] = []): string[] {
  if (value instanceof Map) for (const item of value.values()) names(item, found);
  else if (Array.isArray(value)) for (const item of value) names(item, found);
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value))
      if ((key === "label" || key === "text") && typeof item === "string") found.push(item);
      else if (key !== "parent") names(item, found);
  return found.toSorted();
}

for (const [kind, source] of Object.entries(SOURCES) as [DrawioKind, string][])
  test(`a ${kind} diagram goes to draw.io and comes back with the same names`, async () => {
    const file = await exportDrawio(source, { measure: arialMeasure });
    assert.ok(isDrawio(file));
    const back = await importDrawio(file);
    assert.equal(back.kind === "swimlane" || back.kind === "flowchart" ? kind : back.kind, kind);
    assert.deepEqual(back.warnings, []);
    const want = names(PARSERS[kind](source));
    assert.ok(want.length >= 4);
    assert.deepEqual(names(PARSERS[kind](back.source)), want);
  });

test("a page drawn in draw.io with the TAM-BD library reads as its picture shows", async () => {
  const file = readFileSync(join(__dirname, "fixtures/tam-order-system.drawio"), "utf8");
  const { source, kind, warnings } = await importDrawio(file);
  assert.equal(kind, "tam");
  assert.deepEqual(warnings, []);
  assert.match(source, /^agent web_shop\[Web Shop\] @200,40 420x260 \{$/m);
  assert.match(source, /^agent payment\[Payment\] stack @720,330 120x60$/m);
  assert.match(source, /^customer -- calls: place order @HTTPS --> order_api$/m);
  assert.ok(parseTam(source).nodes.size >= 8);
});

const CELLS: Cell[] = [
  { id: "0" },
  { id: "1", parent: "0" },
  {
    id: "a",
    value: "A",
    style: "rounded=0;",
    vertex: true,
    parent: "1",
    geometry: { x: 10, y: 20, width: 120, height: 60 },
  },
];

test("reads compressed pages and .drawio.svg files", async () => {
  const model = /<mxGraphModel[\s\S]*<\/mxGraphModel>/.exec(
    writeDrawio([{ name: "P", cells: CELLS }]),
  )![0];
  const zipped = `<mxfile host="app.diagrams.net"><diagram name="Zipped" id="z">${await deflatePage(model)}</diagram></mxfile>`;
  assert.deepEqual((await readDrawio(zipped))[0]?.cells, CELLS);
  const file = writeDrawio([{ name: "In SVG", cells: CELLS }]);
  const escaped = file
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${escaped}"><rect/></svg>`;
  assert.ok(isDrawio(svg));
  assert.equal((await readDrawio(svg))[0]?.name, "In SVG");
});

test("refuses what is no draw.io diagram", async () => {
  assert.equal(isDrawio("agent a[A]"), false);
  await assert.rejects(readDrawio("<html><body/></html>"), DrawioError);
  await assert.rejects(readDrawio("<mxfile></mxfile>"), /no pages/);
});
