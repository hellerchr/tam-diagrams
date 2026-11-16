import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arialMeasure } from "../src/arial-measure.ts";
import { exportDrawio, importDrawio } from "../src/drawio.ts";
import { deflatePage, writeDrawio, type Cell } from "../src/drawio-file.ts";
import { REQUEST_STENCIL } from "../src/drawio-shapes.ts";
import { TAM_EXAMPLES } from "../src/samples/tam-examples.ts";
import { parseTam, type TamDiagram } from "../src/tam.ts";
import { holder } from "../src/tam-edit.ts";
import { layoutDiagram, layoutPlaced } from "../src/tam-layout.ts";
import { declaredElements, elementBoxes } from "../src/tam-pin.ts";

const SHOP = `title Order system
direction LR
human customer[Customer]
agent shop[Web Shop] {
  agent api[Order API]
  storage cart[Cart]:::blue
}
agent payment[Payment Service] stack
storage db[Orders]
customer -- calls: place order @HTTPS --> api
api -- reads/writes --> cart
api -- writes --> db
api <-- calls --> payment
payment -- reads --> db
`;

/** What a diagram says, whatever its ids and layout: elements and connections by label. */
function substance(diagram: TamDiagram) {
  const name = (id: string) => {
    const node = diagram.nodes.get(id)!;
    return `${node.kind}:${node.label}`;
  };
  const elements = declaredElements(diagram)
    .map((node) => {
      const parent = holder(diagram, node.id);
      return `${name(node.id)}${node.stack ? " stack" : ""}${node.color ? ` :::${node.color}` : ""}${node.copyAt || [...diagram.nodes.values()].some((other) => other.origin === node.id && other.id !== node.id) ? " ..." : ""} in ${parent ? name(parent) : "-"}`;
    })
    .toSorted();
  const connections = diagram.edges
    .filter((edge) => !edge.id.includes("#"))
    .map((edge) => {
      const end = (id: string) =>
        diagram.nodes.get(id)!.kind === "interface"
          ? `interface:${diagram.nodes.get(id)!.label}`
          : name(id);
      return [
        edge.kind,
        end(edge.source),
        end(edge.target),
        edge.label ?? "",
        edge.protocol ?? "",
        JSON.stringify(edge.flow ?? null),
        JSON.stringify(edge.request ?? null),
      ].join(" | ");
    })
    .toSorted();
  const dots = [...diagram.nodes.values()].filter(
    (node) => node.kind === "dots" && node.id.startsWith("dots#"),
  ).length;
  return { title: diagram.title, level: diagram.level, elements, connections, dots };
}

async function roundTrip(source: string) {
  const diagram = parseTam(source);
  const scene = await layoutDiagram(diagram, arialMeasure);
  const file = await exportDrawio(source, { scene });
  const imported = await importDrawio(file);
  return { diagram, scene, file, imported };
}

describe("TAM block diagrams as draw.io files", () => {
  it("draws with the TAMshapes shapes", async () => {
    const { file } = await roundTrip(SHOP);
    // Agents are rectangles and storages rounded rectangles, as TAM-BD draws them.
    expect(file).toMatch(
      /<mxCell id="api" value="Order API" style="rounded=0;whiteSpace=wrap;html=1;strokeWidth=2;[^"]*tam=agent;"/,
    );
    expect(file).toMatch(
      /<mxCell id="db" value="Orders" style="rounded=1;whiteSpace=wrap;html=1;strokeWidth=2;arcSize=40;[^"]*tam=storage;"/,
    );
    // A channel is a connector with a circle on it and the request marker beside the circle.
    expect(file).toMatch(
      /style="ellipse;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0;[^"]*tam=circle;" vertex="1" connectable="0" parent="e1"/,
    );
    expect(file).toContain(`shape=${REQUEST_STENCIL}`);
    // The human agent holds a stick figure; the stack has its outline behind it.
    expect(file).toContain('id="customer#figure"');
    expect(file).toContain('id="payment#stack"');
    // The protocol's boundary is a dashed line with its name.
    expect(file).toMatch(/value="HTTPS" style="dashed=1;dashPattern=5 5;[^"]*tam=protocol;"/);
    // Parts of a container stand in it.
    expect(file).toMatch(/<mxCell id="api"[^>]*parent="shop"/);
    expect(file).toMatch(/<mxCell id="0">|<object tamDiagram="tam"/);
  });

  it("reads its own file back as the same diagram, every element where it was", async () => {
    const { diagram, scene, imported } = await roundTrip(SHOP);
    expect(imported.kind).toBe("tam");
    expect(imported.warnings).toEqual([]);
    const again = parseTam(imported.source);
    expect(substance(again)).toEqual(substance(diagram));
    expect(imported.source).toContain("direction LR");
    expect(imported.source).toMatch(/^human customer\[Customer\] @/m);
    // Laid out by hand, every element stands where the first layout put it.
    const before = elementBoxes(diagram, scene),
      after = elementBoxes(again, layoutPlaced(again, arialMeasure));
    for (const [id, box] of before) {
      const moved = after.get(id)!;
      expect(Math.abs(moved.x - box.x), id).toBeLessThanOrEqual(2);
      expect(Math.abs(moved.y - box.y), id).toBeLessThanOrEqual(2);
      expect(Math.abs(moved.width - box.width), id).toBeLessThanOrEqual(2);
      expect(Math.abs(moved.height - box.height), id).toBeLessThanOrEqual(2);
    }
  });

  it.each(TAM_EXAMPLES.filter(([name]) => !name.startsWith("error:")))(
    "round-trips %s",
    async (_name, source) => {
      const { diagram, scene, imported } = await roundTrip(source);
      expect(imported.warnings).toEqual([]);
      // Dots the layout does not draw (their neighbours do not stand side by side) are not on the page.
      const drawn = scene.shapes.filter(
        (shape) => shape.kind === "dots" && /^dots#\d+$/.test(shape.id),
      ).length;
      expect(substance(parseTam(imported.source))).toEqual({ ...substance(diagram), dots: drawn });
    },
  );

  it("reads a page exported once more as the page before", async () => {
    const { imported } = await roundTrip(SHOP);
    const second = await importDrawio(
      await exportDrawio(imported.source, { measure: arialMeasure }),
    );
    expect(second.source).toBe(imported.source);
  });
});

describe("corners of connections in draw.io", () => {
  it("draws connections square, or round when asked", async () => {
    const square = await exportDrawio(SHOP, { measure: arialMeasure }),
      round = await exportDrawio(SHOP, { measure: arialMeasure, rounded: true });
    const corners = (file: string) =>
      [...file.matchAll(/edge="1"/g)].length &&
      [...file.matchAll(/<mxCell[^>]*style="([^"]*)"[^>]*edge="1"/g)].map((m) =>
        /(^|;)rounded=1;/.test(m[1]),
      );
    expect(corners(square)).not.toContain(true);
    expect(corners(round)).not.toContain(false);
    // The corners change nothing the import reads.
    expect((await importDrawio(round)).source).toBe((await importDrawio(square)).source);
  });
});

describe("TAM block diagrams drawn by hand in draw.io", () => {
  const AGENT = "rounded=0;whiteSpace=wrap;html=1;strokeWidth=2;",
    STORAGE = "rounded=1;whiteSpace=wrap;html=1;strokeWidth=2;arcSize=40;",
    CONNECTOR =
      "edgeStyle=elbowEdgeStyle;elbow=vertical;rounded=1;startArrow=none;endArrow=none;html=1;endFill=0;",
    ARROW = "edgeStyle=elbowEdgeStyle;elbow=vertical;rounded=1;endArrow=classic;html=1;endFill=1;",
    CIRCLE =
      "ellipse;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0;connectable=0;deletable=0;";
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
    value,
    style,
    vertex: true,
    parent,
    geometry: { x, y, width, height },
  });
  const edge = (
    id: string,
    source: string | undefined,
    target: string | undefined,
    style: string,
    value = "",
    loose: { from?: { x: number; y: number }; to?: { x: number; y: number } } = {},
  ): Cell => ({
    id,
    value,
    style,
    edge: true,
    parent: "1",
    ...(source ? { source } : {}),
    ...(target ? { target } : {}),
    geometry: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      relative: true,
      ...(loose.from ? { sourcePoint: loose.from } : {}),
      ...(loose.to ? { targetPoint: loose.to } : {}),
    },
  });
  const mark = (id: string, parent: string, style: string, size: number, x = 0): Cell => ({
    id,
    style,
    vertex: true,
    parent,
    geometry: {
      x,
      y: 0,
      width: size,
      height: size,
      relative: true,
      offset: { x: -size / 2, y: -size / 2 },
    },
  });
  const figure = (owner: string): Cell[] => [
    {
      id: `${owner}-g`,
      style: "group;strokeWidth=2;rotatable=0;editable=0;fillColor=none;",
      vertex: true,
      connectable: false,
      parent: owner,
      geometry: { x: 0, y: 0, width: 20, height: 40, relative: true, offset: { x: 20, y: 10 } },
    },
    vertex(
      `${owner}-h`,
      "",
      "ellipse;strokeWidth=2;whiteSpace=wrap;html=1;",
      4,
      0,
      12,
      12,
      `${owner}-g`,
    ),
    ...[
      [10, 12, 10, 26],
      [10, 18, 20, 12],
      [10, 18, 0, 12],
      [10, 26, 0, 40],
      [10, 26, 20, 40],
    ].map(([x1, y1, x2, y2], index): Cell => ({
      id: `${owner}-l${index}`,
      style: "edgeStyle=none;strokeWidth=2;html=1;startArrow=none;endArrow=none;",
      edge: true,
      parent: `${owner}-g`,
      geometry: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        sourcePoint: { x: x1, y: y1 },
        targetPoint: { x: x2, y: y2 },
      },
    })),
  ];

  const cells: Cell[] = [
    // A container drawn around its parts, without draw.io nesting them.
    vertex("Xk2-1", "Web Shop", AGENT + "verticalAlign=top;fillColor=#E6E6E6;", 200, 0, 400, 220),
    vertex("Xk2-2", "Order API", AGENT, 240, 60, 120, 60),
    vertex("Xk2-3", "Cart", STORAGE + "fillColor=#dae8fc;", 440, 60, 120, 60),
    // A human agent: a box with the TAMshapes figure in it.
    vertex("Xk2-4", "Customer", AGENT + "verticalAlign=bottom;", 0, 60, 60, 60),
    ...figure("Xk2-4"),
    vertex("Xk2-5", "Orders", STORAGE, 240, 300, 120, 60),
    vertex("Xk2-6", "Payment", AGENT, 700, 60, 120, 60),
    // Its stack: an unnamed outline behind it.
    vertex("Xk2-7", "", AGENT, 705, 65, 120, 60),
    vertex("Xk2-8", "Worker", AGENT, 700, 300, 120, 60),
    vertex("Xk2-9", "Worker", AGENT, 900, 300, 120, 60),
    // Dots between the two workers.
    {
      id: "dots",
      style: "group;",
      vertex: true,
      connectable: false,
      parent: "1",
      geometry: { x: 838, y: 328, width: 45, height: 5 },
    },
    ...[0, 20, 40].map((x, index) =>
      vertex(
        `dot${index}`,
        "",
        "ellipse;whiteSpace=wrap;html=1;aspect=fixed;strokeColor=none;fillColor=#000000;",
        x,
        0,
        5,
        5,
        "dots",
      ),
    ),
    // A request channel: the R points right, toward the API.
    edge("Xk2-10", "Xk2-4", "Xk2-2", CONNECTOR, "place order"),
    mark("Xk2-11", "Xk2-10", CIRCLE, 20),
    mark(
      "Xk2-12",
      "Xk2-10",
      `shape=${REQUEST_STENCIL};whiteSpace=wrap;html=1;;connectable=0;allowArrows=0;rotatable=1;rotation=-90;editable=1;expand=0;aspect=fixed;`,
      30,
    ),
    // An arrow into a storage writes; drawn from the storage to the agent it reads.
    edge("Xk2-13", "Xk2-2", "Xk2-5", ARROW),
    edge("Xk2-14", "Xk2-5", "Xk2-6", ARROW),
    // Two arrows between the API and the cart: a modifying access.
    edge("Xk2-15", "Xk2-2", "Xk2-3", ARROW),
    edge("Xk2-16", "Xk2-3", "Xk2-2", ARROW),
    // A data flow channel: a circle standing alone between two lines.
    vertex(
      "Xk2-17",
      "",
      "ellipse;whiteSpace=wrap;html=1;aspect=fixed;strokeWidth=2;rotatable=0",
      650,
      200,
      20,
      20,
    ),
    edge("Xk2-18", "Xk2-6", "Xk2-17", CONNECTOR),
    edge("Xk2-19", "Xk2-17", "Xk2-8", ARROW),
    // A protocol boundary through the request channel's circle.
    edge(
      "Xk2-20",
      undefined,
      undefined,
      "edgeStyle=elbowEdgeStyle;dashed=1;dashPattern=5 5;strokeWidth=2;strokeColor=#666666;startArrow=none;endArrow=none;",
      "HTTPS",
      { from: { x: 150, y: 40 }, to: { x: 150, y: 140 } },
    ),
    // Something TAM has no word for.
    vertex("Xk2-21", "Cloud", "ellipse;shape=cloud;whiteSpace=wrap;html=1;", 0, 400, 120, 80),
  ];

  it("reads the shapes of the TAM-BD library", async () => {
    const file = writeDrawio([{ name: "Shop by hand", cells }]);
    const { source, kind, warnings } = await importDrawio(file);
    expect(kind).toBe("tam");
    expect(warnings).toEqual([
      "The shape cloud “Cloud” has no meaning in a TAM block diagram; it is left out.",
    ]);
    const diagram = parseTam(source);
    expect(diagram.title).toBe("Shop by hand");
    expect(substance(diagram)).toEqual({
      title: "Shop by hand",
      level: undefined,
      dots: 1,
      elements: [
        "agent:Payment stack in -",
        "agent:Web Shop in -",
        "agent:Worker in -",
        "agent:Worker in -",
        "human:Customer in -",
        "agent:Order API in agent:Web Shop",
        "storage:Cart :::blue in agent:Web Shop",
        "storage:Orders in -",
      ].toSorted(),
      connections: [
        'channel | human:Customer | agent:Order API | place order | HTTPS | null | {"toSource":false,"toTarget":true}',
        "write | agent:Order API | storage:Orders |  |  | null | null",
        "read | agent:Payment | storage:Orders |  |  | null | null",
        "modify | agent:Order API | storage:Cart |  |  | null | null",
        'channel | agent:Payment | agent:Worker |  |  | {"toSource":false,"toTarget":true} | null',
      ].toSorted(),
    });
    // The dots stand between the two workers.
    expect(source).toMatch(
      /agent worker\[Worker\] @700,300 120x60\n\.\.\.\nagent worker1\[Worker\] @900,300 120x60/,
    );
  });

  it("reads compressed files as draw.io saves them", async () => {
    const plain = writeDrawio([{ name: "Zipped", cells }]);
    const model = plain.match(/<mxGraphModel[\s\S]*<\/mxGraphModel>/)![0];
    const zipped = `<mxfile host="app.diagrams.net"><diagram id="a" name="Zipped">${await deflatePage(model)}</diagram></mxfile>`;
    expect((await importDrawio(zipped)).source).toBe(
      (await importDrawio(plain)).source.replace("Shop by hand", "Zipped"),
    );
  });

  it("takes the direction of a request from the marker's rotation", async () => {
    const page = (rotation: number) =>
      writeDrawio([
        {
          name: "Page-1",
          cells: [
            vertex("a", "A", AGENT, 0, 0, 120, 60),
            vertex("b", "B", AGENT, 300, 0, 120, 60),
            edge("c", "a", "b", CONNECTOR),
            mark("c-1", "c", CIRCLE, 20),
            mark("c-2", "c", `shape=${REQUEST_STENCIL};rotation=${rotation};`, 30),
          ],
        },
      ]);
    expect((await importDrawio(page(-90))).source).toContain("a -- calls --> b");
    expect((await importDrawio(page(90))).source).toContain("b -- calls --> a");
  });
});

describe("TAM block diagrams made in draw.io", () => {
  const fixture = (name: string) => readFileSync(join(__dirname, "fixtures/drawio", name), "utf8");

  it("reads a diagram drawn with the TAM-BD library as its picture shows it", async () => {
    // Made in draw.io by fixtures/drawio/make/tam-order-system.js: a container drawn behind its
    // parts, a stack made by copying an agent, channels with their R, a protocol border named by
    // a text, the TAM-BD modifying access set between an agent and a storage, a channel through a
    // circle that stands alone, and a note joined to a storage by a dashed line.
    const { source, warnings } = await importDrawio(fixture("tam-order-system.drawio"));
    expect(source).toBe(`human customer[Customer] @40,110 60x60
agent web_shop[Web Shop] @200,40 420x260 {
  agent order_api[Order API] @240,110 120x60
  storage cart[Cart]:::blue @470,110 120x60
}
agent payment[Payment] stack @720,330 120x60
note note1[Remember VAT] @40,400 100x100
storage orders[Orders] @240,400 120x60
agent worker[Worker] @700,520 120x60
...
agent worker1[Worker] @900,520 120x60
customer -- calls: place order @HTTPS --> order_api
order_api -- calls --> payment
note1 -.- orders
payment -- sends data --> worker
order_api -- writes --> orders
payment -- reads --> orders
order_api -- reads/writes --> cart
`);
    expect(warnings).toEqual([]);
    expect(() => parseTam(source)).not.toThrow();
  });

  it("reads nesting, figures, loose ends and labels that are texts of their own", async () => {
    // Made by fixtures/drawio/make/tam-landscape.js: three levels of containers drawn around
    // their parts, a storage of storages with dots, the TAM-BD figure dropped on an agent and
    // standing alone above its name, an arrow ending beside a storage, labels as texts and as
    // label cells, and shapes the syntax has no word for.
    const { source, warnings } = await importDrawio(fixture("tam-landscape.drawio"));
    expect(source).toBe(`title Landscape
human admin[Admin] @40,40 80x70
human end_user[End User] @70,300 20x40
agent landscape[Landscape] @300,20 520x330 {
  agent app_server[App Server] @330,60 300x260 {
    agent runtime[Runtime] @350,100 260x190 {
      agent worker[Worker] @370,150 100x50
      storage cache[Cache] @490,150 100x50
    }
  }
  storage database[Database] @660,60 140x250 {
    storage tables[Tables] @680,110 100x50
    ...
    storage index[Index] @680,230 100x50
  }
}
storage jobs[Jobs] @300,420 120x60
group plugins[Plugins] @500,420 150x90
agent monitor[Monitor] @860,400 160x160
admin -- calls: deploy --> worker
end_user -- calls --> app_server
worker -- reads/writes --> cache
runtime -- writes: store rows --> tables
runtime -- writes: update index --> index
runtime -- writes --> jobs
`);
    expect(warnings).toEqual([
      "“Jobs” is drawn as a queue, which the syntax has no word for; it is read as a storage.",
      "“Plugins” is drawn as a structure variance, which the syntax has no word for; it is read as a group.",
      "“Monitor” is drawn as an L-shaped agent, which the syntax has no word for; it is read as an agent.",
    ]);
    expect(() => parseTam(source)).not.toThrow();
  });

  it("reads the shapes of the tam-drawio plugin, its R pointing the way the picture shows", async () => {
    // The plugin's own sample: twelve agents and eight request channels, straight, S-shaped and
    // routed, each named by a text beside it.
    const { source, warnings } = await importDrawio(
      fixture("tam-drawio-plugin-channels.drawio.svg"),
    );
    const diagram = parseTam(source);
    expect([...diagram.nodes.values()].filter((node) => node.kind === "agent")).toHaveLength(12);
    const at = (id: string) => diagram.nodes.get(id)!.at!;
    // Each request goes the way its R points, read off the picture: left to right, down, from the
    // lower middle agent up to the upper right one, and from the right one to the lower middle one.
    const calls = diagram.edges.map((edge) => {
      const [a, b] = [at(edge.source), at(edge.target)];
      return `${edge.label}: ${a.x},${a.y} -> ${b.x},${b.y}`;
    });
    expect(calls.toSorted()).toEqual(
      [
        "Horizontal: -650,120 -> -380,120",
        "Vertical: -650,220 -> -650,380",
        "Vertical S: -450,380 -> -380,120",
        "Horizontal S: -190,240 -> -450,380",
        "Horizontal: -650,545 -> -380,545",
        "Vertical: -650,645 -> -650,805",
        "Vertical S: -380,545 -> -450,805",
        "Horizontal S: -190,665 -> -450,805",
      ].toSorted(),
    );
    expect(diagram.edges.every((edge) => edge.kind === "channel" && edge.request?.toTarget)).toBe(
      true,
    );
    expect(warnings).toEqual([
      "The text “old Channels” names nothing on the page; it is left out.",
      "The text “Smart Channels” names nothing on the page; it is left out.",
    ]);
  });
});
