// @vitest-environment node
import { describe, expect, it } from "vitest";
import { umlColors } from "./fixtures";
import { renderUml } from "../src/index";
import { auditScene } from "../src/audit";
import { forbidden, type Tier } from "../src/swimlane-tiers";
import { generateFlowchart } from "../src/samples/fuzz";
import { SWIMLANE_EXAMPLES } from "../src/samples/uml-examples";

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

describe("a wire whose stub end sits close to a neighbouring shape", () => {
  it("is routed around the shapes instead of drawn straight through them", async () => {
    // Seed 70, e25: every grid segment out of the target's stub end is within CLEAR of a neighbour.
    const scene = await render(70, 1);
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    // The route the last-resort search finds: strict tier, no reservations (x = 768 otherwise).
    expect(scene.wires.find((wire) => wire.edge === "e25")!.points).toEqual([
      { x: 1422.5, y: 825 },
      { x: 856, y: 825 },
      { x: 856, y: 352 },
      { x: 773, y: 352 },
      { x: 773, y: 326 },
      { x: 792, y: 326 },
    ]);
  });

  it("does not change a wire that finds a route within the clearance", async () => {
    // Seed 2, e2: dropping the clearance at stub ends from the first search would run it at y = 222.5.
    const scene = await render(2, 1);
    expect(scene.wires.find((wire) => wire.edge === "e2")!.points).toEqual([
      { x: 459.5, y: 195 },
      { x: 459.5, y: 221 },
      { x: 92, y: 221 },
      { x: 92, y: 244 },
    ]);
  });

  it("is searched again past the points other wires turn at when the route it found crosses one", async () => {
    // Seed 40377, e18: the last-resort route found first bends at x = 1069, on such a point.
    const scene = await render(40377, 1);
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    expect(scene.wires.find((wire) => wire.edge === "e18")!.points).toEqual([
      { x: 1391.5, y: 251 },
      { x: 1391.5, y: 272 },
      { x: 1076, y: 272 },
      { x: 1076, y: 279.5 },
      { x: 975, y: 279.5 },
      { x: 975, y: 251 },
    ]);
  });
});

describe("swimlane routes found without reservations", () => {
  it("are kept exactly as found when they pass through no point another wire turns at", async () => {
    const source = SWIMLANE_EXAMPLES.find(([name]) => name === "swimlane: two lanes ping-pong")![1];
    const { scene } = await renderUml(source, umlColors, { measure: estimate(1.1) });
    // Searching with the points reserved from the start would run this wire at y = 449 instead.
    expect(scene.wires.find((wire) => wire.edge === "e9")!.points).toEqual([
      { x: 122.5, y: 430 },
      { x: 122.5, y: 454.5 },
      { x: 358.5, y: 454.5 },
      { x: 358.5, y: 476 },
    ]);
  });
});

describe("the router's tiers", () => {
  // Cells: on a used line, in a label area, on a point another wire turns or ends at.
  const cells: [number, number, boolean][] = [
    [1, 0, false],
    [0, 1, false],
    [0, 0, true],
  ];
  const verdicts = (tier: Tier) =>
    cells.map(([shared, label, onPoint]) => forbidden(tier, shared, label, onPoint));

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
