import { describe, expect, it } from "vitest";
import { parseTam } from "../src/tam";
import { renderTam } from "../src/tam-layout";
import { TAM_EXAMPLES } from "../src/samples/tam-examples";
import { auditScene } from "../src/audit";
import { colors } from "./fixtures";

const kinds = (source: string) =>
  parseTam(source).edges.map((edge) => `${edge.source} ${edge.kind} ${edge.target}`);

describe("TAM block diagram syntax", () => {
  it("reads declarations with labels, nesting and modifiers", () => {
    const diagram = parseTam(`title Shop
direction LR
human user[Customer]
agent shop[Web Shop]:::blue stack {
  storage db "Orders"
}`);
    expect(diagram).toMatchObject({ title: "Shop", direction: "LR", roots: ["user", "shop"] });
    expect(diagram.nodes.get("user")).toMatchObject({ kind: "human", label: "Customer" });
    expect(diagram.nodes.get("shop")).toMatchObject({
      kind: "agent",
      label: "Web Shop",
      color: "blue",
      stack: true,
      children: ["db"],
    });
    expect(diagram.nodes.get("db")).toMatchObject({
      kind: "storage",
      label: "Orders",
      parent: "shop",
    });
  });

  it("derives read, write and modify access from the arrow and the element kinds", () => {
    expect(
      kinds(
        "agent a\nstorage s\na -- writes --> s\na -- reads --> s\na -- reads --> s\na -- reads/writes --> s",
      ),
    ).toEqual(["a write s", "a read s", "a read s", "a modify s"]);
  });

  it("reads channels with data flow, request direction, labels and protocols", () => {
    const [plain, flow, request, both] = parseTam(
      "agent a\nagent b\na --- b\na <-- sends data: events --> b\na -- calls: GET @HTTP --> b\na <-- calls --> b",
    ).edges;
    expect(plain).toMatchObject({ kind: "channel", flow: { toSource: false, toTarget: false } });
    expect(flow).toMatchObject({ flow: { toSource: true, toTarget: true }, label: "events" });
    expect(request).toMatchObject({
      request: { toSource: false, toTarget: true },
      label: "GET",
      protocol: "HTTP",
    });
    expect(both).toMatchObject({ request: { toSource: true, toTarget: true } });
  });

  it("reads design-level interfaces, connectors and dependencies", () => {
    const diagram = parseTam(`level design
component web[Web] {
  component cart[Cart]
}
component pay[Payments]
storage a
storage b
web -- requires IPay --> pay
pay -- requires IHook --> web
web -- delegates --> cart
web -. create .-> pay
a -. pointer .-> b
pay provides IRefund
cart requires IStock`);
    expect(
      diagram.edges.map((edge) => [
        edge.kind,
        edge.source,
        edge.target.replace(/#.*/, ""),
        edge.label,
      ]),
    ).toEqual([
      ["assembly", "web", "pay", "IPay"],
      ["assembly", "pay", "web", "IHook"],
      ["delegation", "web", "cart", undefined],
      ["dependency", "web", "pay", "«create»"],
      ["dependency", "a", "b", "«pointer»"],
      ["provided", "pay", "pay", undefined],
      ["required", "cart", "cart", undefined],
    ]);
    expect(
      [...diagram.nodes.values()]
        .filter((node) => node.kind === "interface")
        .map((node) => node.label),
    ).toEqual(["IRefund", "IStock"]);
  });

  it("expands `...` multiplicity into two copies with their connections", () => {
    const diagram = parseTam(
      "agent hub\nagent app[App] ...\nstorage db[DB] ...\nhub -- calls --> app\napp -- reads/writes --> db",
    );
    expect(diagram.roots).toEqual(["hub", "app#row", "db#row"]);
    expect(diagram.nodes.get("app#row")!.children).toEqual(["app", "app#dots", "app#2"]);
    expect(diagram.nodes.get("app#2")).toMatchObject({ label: "App", origin: "app" });
    // A single end fans out; two multiple ends pair up copy by copy.
    expect(
      kinds(
        "agent hub\nagent app ...\nstorage db ...\nhub -- calls --> app\napp -- reads/writes --> db",
      ),
    ).toEqual(["hub channel app", "hub channel app#2", "app modify db", "app#2 modify db#2"]);
  });

  it.each([
    [
      "storage db {\n  agent cache\n}",
      "Line 2: Storage `db` cannot contain the active element `cache`",
    ],
    ["human u {\n  agent a\n}", "Line 1: Human agent `u` cannot contain elements."],
    [
      "component c {\n  agent a\n}",
      "Component `c` can contain components, classes and storages, not the agent `a`.",
    ],
    [
      "package p {\n  storage s\n}",
      "Package `p` can contain packages, classes, components and subsystems",
    ],
    ["agent a\nstorage s\na -- calls --> s", "Line 3: `s` is a storage: agents read or write it"],
    [
      "agent a\nstorage s\ns -- reads --> a",
      "Line 3: `s` is a storage and does not act; write the access from",
    ],
    ["agent a\nstorage s\na -- reads @HTTP --> s", "Line 3:"],
    ["agent a\nstorage s\na <-- reads --> s", "Line 3:"],
    ["agent a\nagent b\na -- fetches --> b", "Line 3: `fetches` is no connection word"],
    [
      "agent a {\n  agent b\n}\na -- calls --> b",
      "`a` contains `b`, and a container stands for its parts, so the two are never connected",
    ],
    [
      "level design\ncomponent a {\n  component b\n}\na --- b",
      "a container passes on to its part with `a -- delegates --> b`",
    ],
    ["agent a\nagent b\na -- delegates --> b", "Line 3:"],
    ["agent a\nagent b\na -R-> b", "Line 3: Cannot read connection"],
    ["agent a\nagent b\na --x b", "Line 3: Cannot read connection"],
    ["agent a\nagent b\na --> b", "Line 3:"],
    ["agent a\nagent b\na -. pointer .-> b", "A «pointer» dependency connects two storages."],
    ["agent a\nagent b\na -. owns .-> b", "Line 3:"],
    ["agent a\na -- calls --> b", "Line 2: Unknown element `b`."],
    ["agent a\nagent a", "Line 2: `a` is already declared on line 1."],
    ["agent a {\n  agent b", "Line 1: `a` is missing its closing `}`."],
    ["agent a\nagent b\na ~> b", "Line 3: Cannot read connection"],
    ["level conceptual\ncomponent c", "Line 2: Components belong to the design level"],
    ["component c ...", "Only agents and storages can be shown as multiple"],
    ["agent a:::teal", "Unknown color `teal`"],
    ["direction up", "Unknown direction `up`"],
  ])("rejects invalid TAM: %s", (source, message) => {
    expect(() => parseTam(source)).toThrow(message);
  });

  it("reads Mermaid-style chains, several ends and empty containers", () => {
    expect(
      kinds(
        "agent a\nagent b\nagent c\nstorage s\nstorage t\na -- calls: call --> b\nb -- calls: call --> c\na -- writes --> s & t\nb -- writes --> s & t",
      ),
    ).toEqual(["a channel b", "b channel c", "a write s", "a write t", "b write s", "b write t"]);
    expect(
      parseTam(
        "agent a\nagent b\na -- calls: call @HTTP --> b\nb -- calls: call @HTTP --> a",
      ).edges.map((edge) => [edge.label, edge.protocol]),
    ).toEqual([
      ["call", "HTTP"],
      ["call", "HTTP"],
    ]);
    expect(parseTam("agent a[Empty] {}\nagent b {\n}").nodes.get("a")!.children).toEqual([]);
  });

  it("reads labels and protocols inside the link, plain links, several ends and dependency keywords", () => {
    const diagram = parseTam(
      "agent a\nagent b\nagent c\nstorage s\na -- calls: GET orders @HTTPS --> b\na -- calls @gRPC --> c\nb -- events @AMQP --- c\na & b -- reads/writes --> s",
    );
    expect(
      diagram.edges.map((edge) => [edge.kind, edge.source, edge.target, edge.label, edge.protocol]),
    ).toEqual([
      ["channel", "a", "b", "GET orders", "HTTPS"],
      ["channel", "a", "c", undefined, "gRPC"],
      ["channel", "b", "c", "events", "AMQP"],
      ["modify", "a", "s", undefined, undefined],
      ["modify", "b", "s", undefined, undefined],
    ]);
    expect(kinds("agent a\nagent b\nagent c\na -- calls --> b -- calls --> c")).toEqual([
      "a channel b",
      "b channel c",
    ]);
    expect(kinds("agent a\nagent b\na -- sends data --> b\na <-- sends data --> b")).toEqual([
      "a channel b",
      "a channel b",
    ]);
    expect(
      kinds(
        "storage a\nstorage b\ncomponent x\ncomponent y\na -. pointer .-> b\nx -. use .-> y\nx -. import .-> y\nx -. generate .-> y",
      ),
    ).toEqual(["a dependency b", "x dependency y", "x dependency y", "x dependency y"]);
  });

  it("reads the words without case, singular or plural, and Mermaid spacing", () => {
    expect(
      kinds(
        "agent a\nagent b\nstorage s\na -- read --> s\na -- Writes --> s\na -- read/write --> s\na --calls--> b\na -.use.-> b",
      ),
    ).toEqual(["a read s", "a write s", "a modify s", "a channel b", "a dependency b"]);
    // An interface an assembly connector already draws is not drawn a second time.
    expect(
      kinds(
        "component x\ncomponent y\nx -- requires IData --> y\ny provides IData\nx requires IData\ny provides IOther",
      ),
    ).toEqual(["x assembly y", "y provided y#provides#2"]);
    expect(() => parseTam("agent a\nagent b\na --> b")).toThrow("`a --> b` has no connection word");
    expect(() => parseTam("agent a\nagent b\na -. use: x .-> b")).toThrow(
      "A dependency carries only its keyword",
    );
  });

  it("reads standalone dots, blank labels and protocols on assembly connectors", () => {
    const diagram = parseTam(
      "agent group1[Clients] {\n  human a[]\n  ...\n  human b[ ]\n}\ncomponent x\ncomponent y\nx -- requires IApi @HTTP --> y",
    );
    // The dots and their neighbours form an invisible row so layout keeps them side by side.
    const [row] = diagram.nodes.get("group1")!.children;
    expect(diagram.nodes.get(row)!.children.map((id) => diagram.nodes.get(id)!.kind)).toEqual([
      "human",
      "dots",
      "human",
    ]);
    expect([diagram.nodes.get("a")!.label, diagram.nodes.get("b")!.label]).toEqual(["", ""]);
    expect(diagram.edges[0]).toMatchObject({ kind: "assembly", label: "IApi", protocol: "HTTP" });
    expect(parseTam("component x\ncomponent y\nx -- requires --> y").edges[0]).toMatchObject({
      kind: "assembly",
      label: undefined,
    });
  });

  it("limits diagram size", () => {
    expect(() => parseTam("agent a\n".repeat(401))).toThrow("exceeds the limit");
  });
});

describe("TAM block diagram rendering", () => {
  it.each(TAM_EXAMPLES.filter(([name]) => !name.startsWith("error")))(
    "renders %s as standalone SVG",
    async (_name, source) => {
      const { svg, width, height, description, scene } = await renderTam(source, colors);
      // No overlapping text, no wires through elements or text, no detached arrowheads, nothing clipped.
      expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      expect(parsed.querySelector("parsererror")).toBeNull();
      expect(parsed.documentElement.getAttribute("viewBox")).toMatch(/^-?\d+ -?\d+ \d+ \d+$/);
      expect(width).toBeGreaterThan(50);
      expect(height).toBeGreaterThan(40);
      expect(parsed.querySelector("title")?.textContent).toBe(description);
      expect(svg).not.toMatch(/NaN|undefined|<script|href=/);
      // Every declared label is drawn.
      for (const node of parseTam(source).nodes.values()) {
        if (node.label && node.kind !== "interface")
          for (const word of node.label.split(/<br>|\s+/))
            expect(parsed.documentElement.textContent).toContain(word);
      }
    },
  );

  it("draws the TAM notation: request markers, channel circles, protocol boundaries, multiplicity dots", async () => {
    const { svg } = await renderTam(
      "direction TB\nagent a[Client] ...\nagent b[Server]\na -- calls: call @HTTP --> b",
      colors,
    );
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect([...parsed.querySelectorAll("text")].map((text) => text.textContent)).toEqual(
      expect.arrayContaining(["Client", "Server", "call", "R", "HTTP"]),
    );
    expect(parsed.querySelectorAll('circle[r="8"]')).toHaveLength(2);
    // The marker is an "R" with one triangle beside each circle, off the circle.
    expect(parsed.querySelectorAll('path[d$="Z"]').length).toBeGreaterThanOrEqual(2);
    expect(parsed.querySelectorAll('circle[r="1.8"]')).toHaveLength(3);
    expect(parsed.querySelectorAll('path[stroke-dasharray="6 4"]')).toHaveLength(1);
  });

  it("lays out connections between the same two elements in one direction", async () => {
    const { scene } = await renderTam(
      "agent a\nagent b\na -- calls: inbound --> b\nb -- calls: outbound --> a",
      colors,
    );
    const circles = scene.shapes
      .filter((shape) => shape.kind === "circle")
      .map((shape) => ({
        x: shape.box.x + shape.box.width / 2,
        y: shape.box.y + shape.box.height / 2,
      }));
    // Side by side on one level, not one above the other.
    expect(Math.abs(circles[0].y - circles[1].y)).toBeLessThan(1);
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
  });

  it("straightens connections between overlapping elements", async () => {
    const { scene } = await renderTam(
      "agent a[A wide agent on top]\nagent b[Below]\nstorage s[Storage]\na -- calls --> b\nb -- reads/writes --> s",
      colors,
    );
    expect(scene.wires.filter((wire) => !wire.path).every((wire) => wire.points.length === 2)).toBe(
      true,
    );
  });

  it("escapes labels", async () => {
    const { svg } = await renderTam('agent a[<b> & "x"]', colors);
    expect(svg).toContain("&lt;b&gt; &amp;");
  });
});
