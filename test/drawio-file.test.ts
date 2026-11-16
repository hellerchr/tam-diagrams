import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deflatePage,
  Drawing,
  DrawioError,
  formatStyle,
  htmlToText,
  isDrawio,
  parseStyle,
  parseXml,
  readDrawio,
  shapeOf,
  textToHtml,
  writeDrawio,
  type Cell,
} from "../src/drawio-file.ts";
import { Ids, markOnEdge, edgeRoute, paletteColor, labelAt } from "../src/drawio-shapes.ts";

const CELLS: Cell[] = [
  { id: "0", data: { tamDiagram: "tam" } },
  { id: "1", parent: "0" },
  {
    id: "shop",
    parent: "1",
    value: "Web &lt;Shop&gt;",
    style: "rounded=0;html=1;container=1;",
    vertex: true,
    geometry: { x: 40, y: 40, width: 300, height: 200 },
  },
  {
    id: "api",
    parent: "shop",
    value: "Order<br>API",
    style: "rounded=0;html=1;",
    vertex: true,
    geometry: { x: 20, y: 40, width: 120, height: 60 },
  },
  {
    id: "db",
    parent: "1",
    value: 'Orders "main"',
    style: "rounded=1;arcSize=40;",
    vertex: true,
    geometry: { x: 420, y: 80, width: 120, height: 60 },
    data: { note: "line one\nline two" },
  },
  {
    id: "e1",
    parent: "1",
    style: "endArrow=classic;exitX=1;exitY=0.5;exitPerimeter=0;",
    edge: true,
    source: "api",
    target: "db",
    geometry: { x: 0, y: 0, width: 0, height: 0, relative: true, points: [{ x: 380, y: 110 }] },
  },
  {
    id: "c1",
    parent: "e1",
    style: "ellipse;",
    vertex: true,
    connectable: false,
    geometry: { x: 0, y: 0, width: 20, height: 20, relative: true, offset: { x: -10, y: -10 } },
  },
];

describe("draw.io files", () => {
  it("writes cells and reads them back as they were", async () => {
    const text = writeDrawio([{ name: "Shop & more", cells: CELLS }]);
    expect(isDrawio(text)).toBe(true);
    expect(text).toContain('<diagram name="Shop &amp; more"');
    // Properties stand on an <object> around the cell; draw.io shows them under Edit Data.
    expect(text).toContain(
      '<object label="Orders &quot;main&quot;" note="line one&#10;line two" id="db">',
    );
    const [page] = await readDrawio(text);
    expect(page.name).toBe("Shop & more");
    expect(page.cells).toEqual(CELLS);
  });

  it("adds the root and the layer a page needs", async () => {
    const [page] = await readDrawio(writeDrawio([{ name: "P", cells: CELLS.slice(2) }]));
    expect(page.cells.slice(0, 2)).toEqual([{ id: "0" }, { id: "1", parent: "0" }]);
  });

  it("reads compressed pages, bare graph models and .drawio.svg files", async () => {
    const model = writeDrawio([{ name: "P", cells: CELLS }]).match(
      /<mxGraphModel[\s\S]*<\/mxGraphModel>/,
    )![0];
    const compressed = `<?xml version="1.0"?>\n<mxfile host="app.diagrams.net"><diagram name="Zipped" id="z">${await deflatePage(model)}</diagram></mxfile>`;
    expect(isDrawio(compressed)).toBe(true);
    const [zipped] = await readDrawio(compressed);
    expect(zipped.name).toBe("Zipped");
    expect(zipped.cells).toEqual(CELLS);

    const [bare] = await readDrawio(model);
    expect(bare.cells.map((cell) => cell.id)).toEqual(CELLS.map((cell) => cell.id));

    const file = writeDrawio([{ name: "In SVG", cells: CELLS }]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${file.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}"><rect/></svg>`;
    expect(isDrawio(svg)).toBe(true);
    const [embedded] = await readDrawio(svg);
    expect(embedded.name).toBe("In SVG");
    expect(embedded.cells).toEqual(CELLS);
  });

  it("refuses what is no draw.io diagram", async () => {
    expect(isDrawio("agent a[A]")).toBe(false);
    await expect(readDrawio("<html><body/></html>")).rejects.toThrow(DrawioError);
    await expect(readDrawio("<mxfile><diagram>")).rejects.toThrow(/not closed/);
    await expect(readDrawio('<mxfile><diagram name="x">!!!</diagram></mxfile>')).rejects.toThrow(
      DrawioError,
    );
    await expect(readDrawio("<mxfile></mxfile>")).rejects.toThrow(/no pages/);
  });

  it("reads XML with declarations, comments, CDATA and both quotes", () => {
    const root = parseXml(
      `<?xml version="1.0"?><!-- c --><!DOCTYPE x [<!ENTITY y "z">]><a b='1' c="&#65;&#x42;&amp;"><![CDATA[<raw>]]>t&lt;</a>`,
    );
    expect(root).toEqual({
      name: "a",
      attributes: { b: "1", c: "AB&" },
      children: [],
      text: "<raw>t<",
    });
  });
});

describe("styles and labels", () => {
  it("reads styles with words and keys, and writes them back", () => {
    const style = parseStyle("ellipse;whiteSpace=wrap;html=1;aspect=fixed;");
    expect(shapeOf(style)).toBe("ellipse");
    expect(style.get("aspect")).toBe("fixed");
    expect(formatStyle(style)).toBe("ellipse;whiteSpace=wrap;html=1;aspect=fixed;");
    expect(shapeOf(parseStyle("shape=stencil(abc);html=1"))).toBe("stencil");
    expect(shapeOf(parseStyle("rounded=1;arcSize=40"))).toBe("rect");
    expect(formatStyle({ a: 1, b: undefined, c: true, d: false, e: 0.123456 })).toBe(
      "a=1;c=1;e=0.12;",
    );
  });

  it("turns HTML labels into lines of text and back", () => {
    expect(htmlToText("Order<br>API")).toBe("Order\nAPI");
    expect(htmlToText("<div>Order</div><div><b>API</b>&nbsp;v2</div>")).toBe("Order\nAPI v2");
    expect(htmlToText('<span style="x">a &amp; b</span>')).toBe("a & b");
    expect(textToHtml("a < b\nc & d")).toBe("a &lt; b<br>c &amp; d");
  });
});

describe("a page to read from", () => {
  const drawing = new Drawing({ name: "P", cells: CELLS });

  it("gives every vertex its box on the page", () => {
    expect(drawing.box(drawing.cells.get("api")!)).toEqual({
      x: 60,
      y: 80,
      width: 120,
      height: 60,
    });
    expect(drawing.label(drawing.cells.get("api")!)).toBe("Order\nAPI");
    expect(drawing.label(drawing.cells.get("shop")!)).toBe("Web <Shop>");
    expect(drawing.data).toEqual({ tamDiagram: "tam" });
  });

  it("follows edges from their pinned ends through their bends", () => {
    const path = drawing.path(drawing.cells.get("e1")!);
    // Out of api's right side at its middle, to the bend, into db's side that faces it.
    expect(path).toEqual([
      { x: 180, y: 110 },
      { x: 380, y: 110 },
      { x: 420, y: 110 },
    ]);
    // The circle stands in the middle of the edge, its corner moved by the offset.
    expect(drawing.box(drawing.cells.get("c1")!)).toEqual({
      x: 290,
      y: 100,
      width: 20,
      height: 20,
    });
  });
});

describe("cells from a scene", () => {
  it("pins an edge's ends and keeps only the bends that turn", () => {
    const from = { x: 0, y: 0, width: 100, height: 50 },
      to = { x: 200, y: 100, width: 100, height: 50 };
    const route = edgeRoute(
      [
        { x: 100, y: 25 },
        { x: 120, y: 25 },
        { x: 150, y: 25 },
        { x: 150, y: 125 },
        { x: 200, y: 125 },
      ],
      from,
      to,
    );
    expect(route.style).toMatchObject({ exitX: 1, exitY: 0.5, entryX: 0, entryY: 0.5 });
    expect(route.geometry.points).toEqual([
      { x: 150, y: 25 },
      { x: 150, y: 125 },
    ]);
  });

  it("puts a mark on an edge where the scene draws it, and reads it back there", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const geometry = markOnEdge(path, { x: 100, y: 25 }, { width: 20, height: 20 });
    // 125 of the path's 200: 0.625 along it, 0.25 from its middle.
    expect(geometry.x).toBeCloseTo(0.25, 5);
    const drawing = new Drawing({
      name: "P",
      cells: [
        { id: "1", parent: "0" },
        {
          id: "e",
          parent: "1",
          edge: true,
          geometry: {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            relative: true,
            sourcePoint: path[0],
            targetPoint: path[2],
            points: [path[1]],
          },
        },
        { id: "m", parent: "e", vertex: true, geometry },
      ],
    });
    expect(drawing.box(drawing.cells.get("m")!)).toEqual({ x: 90, y: 15, width: 20, height: 20 });
    const label = labelAt({ x: 0, y: 0, width: 0, height: 0, relative: true }, path, {
      x: 120,
      y: 50,
    });
    expect(label.x).toBeCloseTo(0.5, 5);
    expect(label.offset).toEqual({ x: 20, y: 0 });
  });

  it("makes ids from labels where a cell's own id does not do", () => {
    const ids = new Ids(["agent"]);
    expect(ids.of("api", "Order API", "agent")).toBe("api");
    expect(ids.of("api", "Order API", "agent")).toBe("Order_API");
    expect(ids.of("x-1", "Order API", "agent")).toBe("Order_API1");
    expect(ids.of("7", "", "agent")).toBe("agent1");
    expect(ids.of("8", "3 Kühe", "storage")).toBe("storage_3_Kuhe");
  });

  it("names the palette color nearest a fill", () => {
    expect(paletteColor(parseStyle("fillColor=#dae8fc"))).toBe("blue");
    expect(paletteColor(parseStyle("fillColor=#ffe6cc"))).toBe("orange");
    expect(paletteColor(parseStyle("fillColor=#E6E6E6"))).toBeUndefined();
    expect(paletteColor(parseStyle("fillColor=#ffffff"))).toBeUndefined();
    expect(paletteColor(parseStyle("fillColor=none"))).toBeUndefined();
  });
});

describe("edges where draw.io draws them", () => {
  // drawio-points.json holds the points draw.io itself computes for every edge of the fixtures
  // (make/points.js run in draw.io). Messages on draw.io's own lifelines are routed by the
  // sequence module, which knows how draw.io draws those.
  it("starts and ends every edge of the fixtures within 3px of draw.io", async () => {
    const fixtures = join(__dirname, "fixtures/drawio");
    const truth: Record<string, Record<string, number[][]>> = JSON.parse(
      readFileSync(join(fixtures, "drawio-points.json"), "utf8"),
    );
    const off: string[] = [];
    let checked = 0;
    for (const [file, edges] of Object.entries(truth)) {
      const [page] = await readDrawio(readFileSync(join(fixtures, file), "utf8"));
      const drawing = new Drawing(page);
      const lifeline = (id: string | undefined) => {
        for (let cell = id ? drawing.cells.get(id) : undefined; cell; cell = drawing.parentOf(cell))
          if (shapeOf(drawing.style(cell)) === "umlLifeline") return true;
        return false;
      };
      for (const [id, points] of Object.entries(edges)) {
        const edge = drawing.cells.get(id)!;
        if (lifeline(edge.source) || lifeline(edge.target)) continue;
        if (drawing.style(edge).get("edgeStyle") === "sequenceEdgeStyle") continue;
        checked++;
        const path = drawing.path(edge);
        const miss = (ours: { x: number; y: number }, theirs: number[]) =>
          Math.hypot(ours.x - theirs[0], ours.y - theirs[1]);
        if (Math.max(miss(path[0], points[0]), miss(path.at(-1)!, points.at(-1)!)) > 3)
          off.push(`${file} ${id}`);
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(off).toEqual([]);
  });
});
