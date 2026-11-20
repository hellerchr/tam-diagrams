// Parsing TAM block diagrams: elements, connections, design level, multiplicity, notes, limits and errors.
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseTam, type TamDiagram, type TamNode } from "../../src/tam.ts";
import { SourceError } from "../../src/source-error.ts";

const kinds = (source: string) =>
  parseTam(source).edges.map((edge) => `${edge.source} ${edge.kind} ${edge.target}`);

/** The node `id` of a diagram; fails when there is none. */
function node(diagram: TamDiagram, id: string): TamNode {
  const found = diagram.nodes.get(id);
  assert.ok(found, `no node ${id}`);
  return found;
}

/** The error parsing `source` throws; fails when it parses. */
function errorOf(source: string): SourceError {
  try {
    parseTam(source);
  } catch (reason) {
    assert.ok(reason instanceof SourceError, String(reason));
    return reason;
  }
  assert.fail(`parsed: ${source}`);
}

test("reads declarations with labels, nesting and modifiers", () => {
  const diagram = parseTam(`title Shop
direction LR
human user[Customer]
agent shop[Web Shop]:::blue stack {
  storage db "Orders"
}`);
  assert.partialDeepStrictEqual(diagram, {
    title: "Shop",
    direction: "LR",
    roots: ["user", "shop"],
  });
  assert.partialDeepStrictEqual(node(diagram, "user"), { kind: "human", label: "Customer" });
  assert.partialDeepStrictEqual(node(diagram, "shop"), {
    kind: "agent",
    label: "Web Shop",
    color: "blue",
    stack: true,
    children: ["db"],
  });
  assert.partialDeepStrictEqual(node(diagram, "db"), {
    kind: "storage",
    label: "Orders",
    parent: "shop",
  });
  assert.deepEqual(node(parseTam("agent a[Empty] {}\nagent b {\n}"), "a").children, []);
});

test("derives read, write and modify access from the words, in any case and number", () => {
  assert.deepEqual(
    kinds(
      "agent a\nstorage s\na -- writes --> s\na -- reads --> s\na -- reads/writes --> s\na -- read --> s\na -- Writes --> s\na -- read/write --> s",
    ),
    ["a write s", "a read s", "a modify s", "a read s", "a write s", "a modify s"],
  );
});

test("reads channels with data flow, request direction, labels and protocols", () => {
  const [plain, flow, request, both, spaced] = parseTam(
    "agent a\nagent b\na --- b\na -- sends data: events --> b\na -- calls: GET orders @HTTPS --> b\na <-- calls --> b\na --calls--> b",
  ).edges;
  assert.partialDeepStrictEqual(plain, {
    kind: "channel",
    flow: { toSource: false, toTarget: false },
  });
  assert.partialDeepStrictEqual(flow, {
    flow: { toSource: false, toTarget: true },
    label: "events",
  });
  assert.partialDeepStrictEqual(request, {
    request: { toSource: false, toTarget: true },
    label: "GET orders",
    protocol: "HTTPS",
  });
  assert.partialDeepStrictEqual(both, { request: { toSource: true, toTarget: true } });
  assert.equal(spaced?.kind, "channel");
  const [onlyProtocol, plainLink] = parseTam(
    "agent a\nagent b\na -- calls @gRPC --> b\na -- events @AMQP --- b",
  ).edges;
  assert.deepEqual(
    [onlyProtocol?.label, onlyProtocol?.protocol, plainLink?.label, plainLink?.protocol],
    [undefined, "gRPC", "events", "AMQP"],
  );
});

test("reads chains and several ends on either side", () => {
  assert.deepEqual(kinds("agent a\nagent b\nagent c\na -- calls --> b -- calls --> c"), [
    "a channel b",
    "b channel c",
  ]);
  assert.deepEqual(
    kinds(
      "agent a\nagent b\nstorage s\nstorage t\na -- writes --> s & t\na & b -- reads/writes --> s",
    ),
    ["a write s", "a write t", "a modify s", "b modify s"],
  );
});

test("reads design-level interfaces, connectors and dependencies", () => {
  const diagram = parseTam(`level design
component web[Web] {
  component cart[Cart]
}
component pay[Payments]
storage a
storage b
web -- requires IPay @HTTP --> pay
pay -- requires --> web
web -- delegates --> cart
web -. create .-> pay
a -. pointer .-> b
web -.use.-> pay
pay provides IRefund
cart requires IStock`);
  assert.deepEqual(
    diagram.edges.map((edge) => [
      edge.kind,
      edge.source,
      edge.target.replace(/#.*/, ""),
      edge.label,
      edge.protocol,
    ]),
    [
      ["assembly", "web", "pay", "IPay", "HTTP"],
      ["assembly", "pay", "web", undefined, undefined],
      ["delegation", "web", "cart", undefined, undefined],
      ["dependency", "web", "pay", "«create»", undefined],
      ["dependency", "a", "b", "«pointer»", undefined],
      ["dependency", "web", "pay", "«use»", undefined],
      ["provided", "pay", "pay", undefined, undefined],
      ["required", "cart", "cart", undefined, undefined],
    ],
  );
  assert.deepEqual(
    [...diagram.nodes.values()]
      .filter((item) => item.kind === "interface")
      .map((item) => item.label),
    ["IRefund", "IStock"],
  );
  // An interface an assembly connector already draws is not drawn a second time.
  assert.deepEqual(
    kinds(
      "component x\ncomponent y\nx -- requires IData --> y\ny provides IData\nx requires IData\ny provides IOther",
    ),
    ["x assembly y", "y provided y#provides#2"],
  );
});

test("expands `...` multiplicity into two copies with their connections", () => {
  const source =
    "agent hub\nagent app[App] ...\nstorage db[DB] ...\nhub -- calls --> app\napp -- reads/writes --> db";
  const diagram = parseTam(source);
  assert.deepEqual(diagram.roots, ["hub", "app#row", "db#row"]);
  assert.deepEqual(node(diagram, "app#row").children, ["app", "app#dots", "app#2"]);
  assert.partialDeepStrictEqual(node(diagram, "app#2"), { label: "App", origin: "app" });
  // A single end fans out; two multiple ends pair up copy by copy.
  assert.deepEqual(kinds(source), [
    "hub channel app",
    "hub channel app#2",
    "app modify db",
    "app#2 modify db#2",
  ]);
});

test("puts standalone dots and their neighbours in a row, and reads blank labels", () => {
  const diagram = parseTam("agent group1[Clients] {\n  human a[]\n  ...\n  human b[ ]\n}");
  const [row] = node(diagram, "group1").children;
  assert.ok(row);
  assert.deepEqual(
    node(diagram, row).children.map((id) => node(diagram, id).kind),
    ["human", "dots", "human"],
  );
  assert.deepEqual([node(diagram, "a").label, node(diagram, "b").label], ["", ""]);
});

test("reads notes, their places and the dotted lines that attach them", () => {
  const diagram = parseTam(`agent shop[Web Shop] {
  agent api[Order API]
  note check[Check stock<br>first] @300,40 140x60
}
note [A free remark]
check -.- api
shop -.- check`);
  assert.partialDeepStrictEqual(node(diagram, "check"), {
    kind: "note",
    label: "Check stock<br>first",
    parent: "shop",
    at: { x: 300, y: 40, width: 140, height: 60 },
  });
  assert.partialDeepStrictEqual(node(diagram, "note#1"), { kind: "note", label: "A free remark" });
  assert.deepEqual(
    diagram.edges.map((edge) => [edge.kind, edge.source, edge.target]),
    [
      ["anchor", "check", "api"],
      ["anchor", "shop", "check"],
    ],
  );
  // A note attached to an element shown as several is attached once.
  assert.deepEqual(kinds("agent w[Worker] ...\nnote n[Pool]\nn -.- w"), ["n anchor w"]);
});

test("notes take part in no rule of the notation", () => {
  // In a storage or a package, beside dots, in a group of storages, which stays one.
  const diagram = parseTam(`level conceptual
storage db[DB] {
  storage t[Tables]
  note n1[Partitioned]
}
group g {
  storage a[A]
  note n2[Shared]
}
agent w1[Worker]
note n3[Up to ten]
...
agent w2[Worker]
n3 -.- w1`);
  assert.equal(node(diagram, "g").passive, true);
  assert.doesNotThrow(() => parseTam("package p[P] {\n  note n[About P]\n}\nn -.- p"));
});

/** Invalid sources, the line the error names (0: none) and a part of its message. */
const INVALID: [string, number, string | RegExp][] = [
  ["storage db {\n  agent cache\n}", 2, "Storage `db` cannot contain the active element `cache`"],
  ["human u {\n  agent a\n}", 1, "Human agent `u` cannot contain elements."],
  [
    "component c {\n  agent a\n}",
    2,
    "can contain components, classes and storages, not the agent `a`.",
  ],
  [
    "package p {\n  storage s\n}",
    2,
    "Package `p` can contain packages, classes, components and subsystems",
  ],
  ["agent a\nstorage s\na -- calls --> s", 3, "`s` is a storage: agents read or write it"],
  [
    "agent a\nstorage s\ns -- reads --> a",
    3,
    "`s` is a storage and does not act; write the access from",
  ],
  ["agent a\nstorage s\na -- reads @HTTP --> s", 3, ""],
  ["agent a\nstorage s\na <-- reads --> s", 3, ""],
  ["agent a\nagent b\na -- fetches --> b", 3, "`fetches` is no connection word"],
  [
    "agent a {\n  agent b\n}\na -- calls --> b",
    4,
    "a container stands for its parts, so the two are never connected",
  ],
  [
    "level design\ncomponent a {\n  component b\n}\na --- b",
    5,
    "a container passes on to its part with `a -- delegates --> b`",
  ],
  ["agent a\nagent b\na -- delegates --> b", 3, ""],
  ["agent a\nagent b\na -R-> b", 3, "Cannot read connection"],
  ["agent a\nagent b\na ~> b", 3, "Cannot read connection"],
  ["agent a\nagent b\na --> b", 3, "`a --> b` has no connection word"],
  ["agent a\nagent b\na -. pointer .-> b", 3, "A «pointer» dependency connects two storages."],
  ["agent a\nagent b\na -. owns .-> b", 3, ""],
  ["agent a\nagent b\na -. use: x .-> b", 3, "A dependency carries only its keyword"],
  ["agent a\na -- calls --> b", 2, "Unknown element `b`."],
  ["agent a\nagent a", 2, "`a` is already declared on line 1."],
  ["agent a {\n  agent b", 1, "`a` is missing its closing `}`."],
  ["level conceptual\ncomponent c", 2, "Components belong to the design level"],
  ["component c ...", 1, "Only agents and storages can be shown as multiple"],
  ["agent a\n...\nstorage s", 2, /stands between elements of one kind/],
  ["agent a:::teal", 1, "Unknown color `teal`"],
  ["direction up", 1, "Unknown direction `up`"],
  ["note n[N] {\n}", 1, "A note holds nothing"],
  [
    "note n[N]\nagent a[A]\nn -- calls --> a",
    3,
    "`n` is a note: it is attached to an element with `n -.- a`",
  ],
  ["agent a[A]\nagent b[B]\na -.- b", 3, "needs one note and one element"],
  ["note n[N]\nnote m[M]\nn -.- m", 3, "needs one note and one element"],
  ["note n[N] stack", 1, "Only agents and storages"],
];

test("rejects invalid sources with the line at fault", () => {
  for (const [source, line, message] of INVALID) {
    const error = errorOf(source);
    assert.equal(error.line, line, `${source}: ${error.message}`);
    if (line) assert.ok(error.message.startsWith(`Line ${line}: `), error.message);
    if (typeof message === "string")
      assert.ok(error.message.includes(message), `${source}: ${error.message}`);
    else assert.match(error.message, message);
  }
});

test("accepts exactly 400 lines, with a trailing newline or without, and rejects 401", () => {
  const lines = (count: number, ending: string) =>
    Array.from({ length: count }, () => "%% note").join("\n") + ending;
  for (const ending of ["\n", ""]) {
    assert.equal(parseTam(lines(400, ending)).nodes.size, 0);
    assert.throws(() => parseTam(lines(401, ending)), /exceeds the limit/);
  }
  // A lone-CR source counts its lines like its LF twin.
  const lf = "agent a\n".repeat(401);
  assert.equal(errorOf(lf.replaceAll("\n", "\r")).message, errorOf(lf).message);
});

test("reads CRLF and lone-CR sources, with comments, like their LF versions", () => {
  const lf = "title Shop %% the title\nagent a[A] %% note\nstorage s[S]\na -- reads --> s %% edge";
  const expected = parseTam(lf);
  assert.partialDeepStrictEqual(expected, { title: "Shop", roots: ["a", "s"] });
  for (const ending of ["\r\n", "\r"]) {
    const actual = parseTam(lf.replaceAll("\n", ending));
    assert.deepEqual([...actual.nodes], [...expected.nodes]);
    assert.deepEqual(actual.edges, expected.edges);
  }
});
