// @vitest-environment node
import { describe, expect, it } from "vitest";
import { umlColors } from "./fixtures";
import { renderUml } from "../src/index";
import { auditScene } from "../src/audit";
import { forbidden, type Tier } from "../src/swimlane-tiers";
import { generateFlowchart } from "../src/samples/fuzz";

/** Text widths without a font: the same estimate the browser-less tests use, scaled by `scale`. */
const estimate = (scale: number) => (text: string, size: number, weight: number) =>
  text.length * size * (weight >= 600 ? 0.62 : 0.58) * scale;

const render = async (seed: number, scale: number) => {
  const source = generateFlowchart(seed, { swimlanes: true });
  return (await renderUml(source, umlColors, { measure: estimate(scale) })).scene;
};

describe("swimlane routing", () => {
  it("keeps two wires apart when a route that shares no line exists", async () => {
    const scene = await render(17, 0.9);
    expect(scene.wires.map((wire) => wire.edge)).toEqual(expect.arrayContaining(["e21", "e23"]));
    const overlaps = auditScene(scene).filter((finding) => finding.check === "wire-overlap");
    expect(overlaps).toEqual([]);
  });

  it("shares no line in generated swimlane diagrams", async () => {
    const found: string[] = [];
    for (let seed = 1; seed <= 30; seed++)
      for (const scale of [0.9, 1, 1.1])
        for (const finding of auditScene(await render(seed, scale)))
          if (finding.check === "wire-overlap") found.push(`${seed}@${scale}: ${finding.detail}`);
    expect(found).toEqual([]);
  }, 60_000);
});

describe("the router's tiers", () => {
  // Cells: on a used line, in a label area, at a foreign terminal.
  const cells: [number, number, boolean][] = [
    [1, 0, false],
    [0, 1, false],
    [0, 0, true],
  ];
  const verdicts = (tier: Tier) =>
    cells.map(([shared, label, foreign]) => forbidden(tier, shared, label, foreign));

  it("forbid every such cell in strict, but not a free one", () => {
    expect(verdicts("strict")).toEqual([true, true, true]);
    expect(forbidden("strict", 0, 0, false)).toBe(false);
  });

  it("forbid only the cells on a used line in apart", () => {
    expect(verdicts("apart")).toEqual([true, false, false]);
  });

  it("forbid nothing in relaxed", () => {
    expect(verdicts("relaxed")).toEqual([false, false, false]);
  });
});
