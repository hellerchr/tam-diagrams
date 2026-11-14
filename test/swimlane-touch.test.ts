// @vitest-environment node
import { describe, expect, it } from "vitest";
import { umlColors } from "./fixtures";
import { renderUml } from "../src/index";
import type { Scene } from "../src/scene";
import { bendsOn } from "../src/wire-touch";
import { SWIMLANE_EXAMPLES } from "../src/samples/uml-examples";
import { generateFlowchart } from "../src/samples/fuzz";

/** Text widths without a font: the same estimate the browser-less tests use, scaled by `scale`. */
const estimate = (scale: number) => (text: string, size: number, weight: number) =>
  text.length * size * (weight >= 600 ? 0.62 : 0.58) * scale;

const SCALES = [0.9, 1, 1.1];

/** Bends of one wire (its interior points, not its ends at the nodes) that lie on another wire. */
const touches = (scene: Scene) =>
  scene.wires.flatMap((a) =>
    scene.wires
      .filter((b) => b.edge !== a.edge)
      .flatMap((b) =>
        bendsOn(a.points, b.points).map(
          (point) => `${a.edge} bend (${point.x},${point.y}) on ${b.edge}`,
        ),
      ),
  );

const renderScene = async (source: string, scale: number) =>
  (await renderUml(source, umlColors, { measure: estimate(scale) })).scene;

describe("wires that touch at one point", () => {
  it("do not occur where two wires between facing ports turn at one point (generated seed 17)", async () => {
    const scene = await renderScene(generateFlowchart(17, { swimlanes: true }), 0.9);
    expect(touches(scene)).toEqual([]);
  });

  it("do not occur in the swimlane samples", async () => {
    const found: string[] = [];
    for (const [name, source] of SWIMLANE_EXAMPLES)
      for (const scale of SCALES)
        for (const touch of touches(await renderScene(source, scale)))
          found.push(`${name}@${scale}: ${touch}`);
    expect(found).toEqual([]);
  }, 60_000);

  it("do not occur in generated swimlane diagrams", async () => {
    const found: string[] = [];
    for (let seed = 1; seed <= 30; seed++)
      for (const scale of SCALES)
        for (const touch of touches(
          await renderScene(generateFlowchart(seed, { swimlanes: true }), scale),
        ))
          found.push(`${seed}@${scale}: ${touch}`);
    expect(found).toEqual([]);
  }, 60_000);
});
