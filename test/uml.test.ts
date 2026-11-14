import { beforeAll, describe, expect, it } from "vitest";
import * as examples from "../src/samples/uml-examples.ts";
import { parseUml, renderUml } from "../src/index.ts";
import { auditScene } from "../src/audit.ts";
import { emptyScene } from "../src/scene.ts";

const light = {
  background: "#ffffff",
  text: "#1b1c1f",
  secondary: "#3f4146",
  series: [],
  font: "system-ui",
  dark: false,
};
const dark = {
  background: "#151618",
  text: "#ecedef",
  secondary: "#c3c4c6",
  series: [],
  font: "system-ui",
  dark: true,
};
const corpus = Object.values(examples).flat() as [string, string][];

describe("UML corpus", () => {
  it.each(corpus)("renders %s without defects", async (_name, source) => {
    const { svg, scene, width, height, description } = await renderUml(source, light);
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsed.querySelector("title")?.textContent).toBe(description);
    expect(width).toBeGreaterThan(20);
    expect(height).toBeGreaterThan(20);
    expect(svg).not.toMatch(/NaN|undefined|<script|href=/);
  });

  describe("is valid Mermaid", () => {
    let mermaid: typeof import("mermaid").default;
    // Mermaid's first import, cold on a busy CI runner, took 13 s: longer than one test's 5 s.
    beforeAll(async () => {
      mermaid = (await import("mermaid")).default;
    }, 60_000);

    it.each(corpus)("%s is valid Mermaid", async (_name, source) => {
      await expect(mermaid.parse(source)).resolves.toBeTruthy();
    });
  });

  it("renders the dark theme with light ink", async () => {
    const { svg } = await renderUml(corpus[0][1], dark);
    expect(svg).toContain("#151618");
    expect(svg).not.toContain('fill="#ffffff"');
  });
});

describe("audit", () => {
  const base = () => {
    const scene = emptyScene();
    scene.shapes.push({
      id: "a",
      kind: "rect",
      box: { x: 0, y: 0, width: 60, height: 30 },
      container: false,
      depth: 0,
      fill: "page",
    });
    scene.shapes.push({
      id: "b",
      kind: "rect",
      box: { x: 160, y: 0, width: 60, height: 30 },
      container: false,
      depth: 0,
      fill: "page",
    });
    scene.wires.push({
      edge: "w",
      points: [
        { x: 60, y: 15 },
        { x: 160, y: 15 },
      ],
      ends: ["a", "b"],
      home: [],
      from: "a",
      to: "b",
    });
    scene.bounds = { x: -20, y: -20, width: 260, height: 120 };
    return scene;
  };
  const checks = (scene: ReturnType<typeof emptyScene>) =>
    auditScene(scene).map((finding) => finding.check);

  it("finds markers whose anchor is off their wire end", () => {
    for (const kind of ["arrow", "open", "triangle", "cross", "circle"] as const) {
      const scene = base();
      scene.markers.push({ kind, tip: { x: 160, y: 15 }, direction: { x: 1, y: 0 }, wire: "w" });
      expect(checks(scene)).not.toContain("marker-off-end");
      scene.markers[0].tip = { x: 154, y: 15 };
      expect(checks(scene)).toContain("marker-off-end");
    }
  });

  it("finds sequence number badges on bars, lines, wires and markers", () => {
    const scene = base();
    scene.shapes.push({
      id: "badge:x",
      kind: "badge",
      box: { x: 100, y: 40, width: 18, height: 18 },
      container: false,
      depth: 0,
      fill: "ink",
      passable: true,
    });
    expect(checks(scene)).not.toContain("badge-overlap");
    scene.shapes.push({
      id: "bar",
      kind: "activation",
      box: { x: 112, y: 35, width: 10, height: 40 },
      container: false,
      depth: 0,
      fill: "strong",
      passable: true,
    });
    expect(checks(scene)).toContain("badge-overlap");
    scene.shapes.pop();
    scene.lines.push({
      points: [
        { x: 116, y: 0 },
        { x: 116, y: 80 },
      ],
      dashed: true,
      tone: "boundary",
      width: 1,
    });
    expect(checks(scene)).toContain("badge-overlap");
  });
});

describe("size limit", () => {
  it.each([
    ["with a trailing newline", "\n"],
    ["without one", ""],
  ])("counts statement lines: 600 pass %s, 601 fail", (_name, ending) => {
    const lines = (count: number) => ["stateDiagram-v2", ...Array(count - 1).fill("A --> B")];
    expect(parseUml(lines(600).join("\n") + ending).kind).toBe("state");
    expect(() => parseUml(lines(601).join("\n") + ending)).toThrow("limit of 600 lines");
  });
});
