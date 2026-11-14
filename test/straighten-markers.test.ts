// @vitest-environment node
import { describe, expect, it } from "vitest";
import { umlColors } from "./fixtures";
import { renderUml } from "../src/index";
import { auditScene } from "../src/audit";
import { followLabelClear, markersClear } from "../src/marker-clear";
import { emptyScene, type Box, type Point, type Scene, type SceneText } from "../src/scene";
import { generateFlowchart } from "../src/samples/fuzz";

/** Text widths without a font: the same estimate the browser-less tests use, scaled by `scale`. */
const estimate = (scale: number) => (text: string, size: number, weight: number) =>
  text.length * size * (weight >= 600 ? 0.62 : 0.58) * scale;

const render = async (seed: number, scale: number) => {
  const source = generateFlowchart(seed, { swimlanes: true });
  return (await renderUml(source, umlColors, { measure: estimate(scale) })).scene;
};

const markerChecks = (scene: Scene) =>
  auditScene(scene).filter(
    (finding) =>
      !finding.note && (finding.check === "wire-on-marker" || finding.check === "marker-on-text"),
  );

describe("straightening keeps the wire's own arrowhead clear", () => {
  it("keeps another wire off the arrow of a straightened wire", async () => {
    expect(markerChecks(await render(20, 0.9))).toEqual([]);
  });

  it("keeps text out from under the arrow of a straightened wire", async () => {
    expect(markerChecks(await render(22, 1))).toEqual([]);
  });

  it("leaves no marker finding across generated swimlane diagrams", async () => {
    const found: string[] = [];
    for (let seed = 1; seed <= 30; seed++)
      for (const scale of [0.9, 1, 1.1])
        for (const finding of markerChecks(await render(seed, scale)))
          found.push(`${seed}@${scale}: ${finding.check} ${finding.detail}`);
    expect(found).toEqual([]);
  }, 60_000);
});

/** A scene with wire `a` running right to x = 100, ending in an arrow, and nothing else. */
const withArrow = (): Scene => {
  const scene = emptyScene();
  scene.wires.push({
    edge: "a",
    points: [
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ],
    ends: [],
    home: [],
  });
  scene.markers.push({
    kind: "arrow",
    tip: { x: 100, y: 50 },
    direction: { x: 1, y: 0 },
    wire: "a",
  });
  return scene;
};

const wire = (edge: string, ...points: Point[]) => ({ edge, points, ends: [], home: [] });

const text = (box: Box, role: SceneText["role"] = "label"): SceneText => ({
  text: "label",
  x: box.x,
  y: box.y,
  size: 12,
  weight: 400,
  anchor: "start",
  tone: "text",
  box,
  role,
});

/** `markersClear` for wire `a` and the audit's marker checks on its marker reach one verdict. */
const verdict = (scene: Scene) => {
  const clear = markersClear(scene, scene.wires[0]);
  expect(clear).toBe(!markerChecks(scene).some((finding) => /of a( |$)/.test(finding.detail)));
  return clear;
};

describe("markersClear", () => {
  it("accepts a marker with nothing near it", () => {
    expect(verdict(withArrow())).toBe(true);
  });

  it("rejects a marker covered by text, but not by a heading", () => {
    const scene = withArrow();
    scene.texts.push(text({ x: 92, y: 44, width: 20, height: 12 }, "heading"));
    expect(verdict(scene)).toBe(true);
    scene.texts.push(text({ x: 92, y: 44, width: 20, height: 12 }));
    expect(verdict(scene)).toBe(false);
  });

  it("rejects a marker another connection's wire touches", () => {
    const scene = withArrow();
    scene.wires.push(wire("b", { x: 95, y: 20 }, { x: 95, y: 49 }));
    expect(verdict(scene)).toBe(false);
    scene.wires[1].points = [
      { x: 95, y: 20 },
      { x: 95, y: 30 },
    ];
    expect(verdict(scene)).toBe(true);
  });

  it("ignores other connections' markers", () => {
    const scene = withArrow();
    scene.wires.push(wire("b", { x: 0, y: 90 }, { x: 100, y: 90 }));
    scene.markers.push({
      kind: "arrow",
      tip: { x: 100, y: 90 },
      direction: { x: 1, y: 0 },
      wire: "b",
    });
    scene.texts.push(text({ x: 92, y: 84, width: 20, height: 12 }));
    expect(verdict(scene)).toBe(true);
    expect(markersClear(scene, scene.wires[1])).toBe(false);
  });
});

describe("followLabelClear", () => {
  it("moves the label off its own marker, then accepts", () => {
    const scene = withArrow();
    scene.texts.push({ ...text({ x: 92, y: 44, width: 20, height: 12 }), owner: "a" });
    expect(markersClear(scene, scene.wires[0])).toBe(false);
    expect(followLabelClear(scene, scene.wires[0])).toBe(true);
    expect(markersClear(scene, scene.wires[0])).toBe(true);
    expect(scene.texts[0].box.x).not.toBe(92);
  });

  it("puts the label back when the marker stays blocked", () => {
    const scene = withArrow();
    scene.wires.push(wire("b", { x: 95, y: 20 }, { x: 95, y: 49 }));
    const label = { ...text({ x: 10, y: 120, width: 20, height: 12 }), owner: "a" };
    scene.texts.push(label);
    expect(followLabelClear(scene, scene.wires[0])).toBe(false);
    expect(scene.texts[0]).toMatchObject({ x: 10, y: 120, box: { x: 10, y: 120 } });
  });
});
