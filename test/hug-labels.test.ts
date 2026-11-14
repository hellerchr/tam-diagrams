// @vitest-environment node
import { describe, expect, it } from "vitest";
import { umlColors } from "./fixtures.ts";
import { renderUml } from "../src/index.ts";
import { auditScene } from "../src/audit.ts";
import { hugLabels } from "../src/labels.ts";
import { emptyScene, type Box, type SceneText } from "../src/scene.ts";
import { generateStateDiagram } from "../src/samples/fuzz.ts";

/** Text widths without a font: the same estimate the browser-less tests use, scaled by `scale`. */
const estimate = (scale: number) => (text: string, size: number, weight: number) =>
  text.length * size * (weight >= 600 ? 0.62 : 0.58) * scale;

const defects = async (source: string, scale: number) => {
  const { scene } = await renderUml(source, umlColors, { measure: estimate(scale) });
  return auditScene(scene).filter((finding) => !finding.note);
};

const text = (box: Box, owner?: string): SceneText => ({
  text: "t",
  x: box.x,
  y: box.y,
  size: 12,
  weight: 400,
  anchor: "start",
  tone: "text",
  box,
  role: owner ? "label" : "node",
  owner,
});

describe("hugging connection labels", () => {
  it("falls back to the start of the wire when text fills every spot along it", () => {
    const scene = emptyScene();
    scene.wires.push({
      edge: "w",
      points: [
        { x: 0, y: 100 },
        { x: 200, y: 100 },
      ],
      ends: [],
      home: [],
    });
    scene.texts.push(text({ x: 80, y: 20, width: 40, height: 12 }, "w"));
    scene.texts.push(text({ x: 25, y: 40, width: 200, height: 120 }));
    hugLabels(scene);
    expect(scene.texts[0].box).toEqual({ x: -20, y: 82, width: 40, height: 12 });
  });

  it("falls back to the end of the wire when text fills every spot along it", () => {
    const scene = emptyScene();
    scene.wires.push({
      edge: "w",
      points: [
        { x: 0, y: 100 },
        { x: 200, y: 100 },
      ],
      ends: [],
      home: [],
    });
    scene.texts.push(text({ x: 80, y: 20, width: 40, height: 12 }, "w"));
    scene.texts.push(text({ x: -25, y: 40, width: 200, height: 120 }));
    hugLabels(scene);
    expect(scene.texts[0].box).toEqual({ x: 180, y: 82, width: 40, height: 12 });
  });

  it("puts the label at the middle of the wire when that spot and the wire's ends are free", () => {
    const scene = emptyScene();
    scene.wires.push({
      edge: "w",
      points: [
        { x: 0, y: 100 },
        { x: 200, y: 100 },
      ],
      ends: [],
      home: [],
    });
    scene.texts.push(text({ x: 80, y: 20, width: 40, height: 12 }, "w"));
    hugLabels(scene);
    expect(scene.texts[0].box).toEqual({ x: 80, y: 82, width: 40, height: 12 });
  });

  /** A long horizontal segment from (0, 100) to (200, 100), then a short one down to (200, 140). */
  const bentWire = () => {
    const scene = emptyScene();
    scene.wires.push({
      edge: "w",
      points: [
        { x: 0, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 140 },
      ],
      ends: [],
      home: [],
    });
    scene.texts.push(text({ x: 80, y: 20, width: 40, height: 12 }, "w"));
    return scene;
  };

  it("prefers a free inner point of a shorter segment to the end of a longer one", () => {
    const scene = bentWire();
    // Fills every inner point of the long segment but leaves its end at (200, 100) free.
    scene.texts.push(text({ x: 0, y: 60, width: 175, height: 80 }));
    hugLabels(scene);
    expect(scene.texts[0].box).toEqual({ x: 208, y: 114, width: 40, height: 12 });
  });

  it("tries the ends longest segment first, the far end of a segment before its start", () => {
    const scene = bentWire();
    // Every inner point of both segments is filled; both ends of the long segment and the far end
    // of the short one stay free.
    scene.texts.push(text({ x: 25, y: 60, width: 150, height: 80 }));
    scene.texts.push(text({ x: 150, y: 104, width: 100, height: 26 }));
    hugLabels(scene);
    expect(scene.texts[0].box).toEqual({ x: 180, y: 82, width: 40, height: 12 });
  });

  it("finds a free spot for a generated state diagram's label where the inner spots collide", async () => {
    expect(await defects(generateStateDiagram(30), 1.1)).toEqual([]);
  });

  it("leaves no wire through a label across generated state diagrams", async () => {
    const found: string[] = [];
    for (let seed = 1; seed <= 30; seed++)
      for (const scale of [1, 1.1])
        for (const finding of await defects(generateStateDiagram(seed), scale))
          if (finding.check === "wire-through-text")
            found.push(`${seed}@${scale}: ${finding.detail}`);
    expect(found).toEqual([]);
  }, 60_000);
});
