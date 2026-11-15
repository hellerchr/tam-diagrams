// @vitest-environment node
import { describe, expect, it } from "vitest";
import { arialMeasure, renderTam, renderUml, TamError, UmlError } from "../src/index.ts";
import { checkSource, isDiagramError, renderSource } from "../cli/diagram.ts";
import { colors, umlColors } from "./fixtures.ts";

const TAM = "agent web[Web Server]\nstorage db[Orders]\nweb -- reads/writes --> db";
const UML = "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy: start\n  Busy --> [*]";
const FONT = "Arial, Helvetica, 'Liberation Sans', sans-serif";

/** The estimate textMeasure falls back to without a canvas. */
const guess = (text: string, size: number, weight: number) =>
  text.length * size * (weight >= 600 ? 0.62 : 0.58);
const sizeOf = (svg: string) => svg.match(/viewBox="([^"]+)"/)?.[1];

/** What `run` rejects with; fails when it resolves. */
const rejection = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (reason) {
    return reason;
  }
  throw new Error("resolved");
};

describe("renderSource", () => {
  it.each([
    ["TAM", TAM],
    ["UML", UML],
  ])("draws %s with the Arial stack and no broken numbers", async (_kind, source) => {
    const svg = await renderSource(source);
    expect(svg).toMatch(/^<svg\b/);
    expect(svg).toContain(`font-family:${FONT}`);
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it("lays TAM out with the Arial width table, not the estimate", async () => {
    const drawn = { ...colors, font: FONT };
    const table = await renderTam(TAM, drawn, { measure: arialMeasure });
    const estimate = await renderTam(TAM, drawn, { measure: guess });
    expect(sizeOf(await renderSource(TAM))).toBe(sizeOf(table.svg));
    expect(sizeOf(table.svg)).not.toBe(sizeOf(estimate.svg));
  });

  it("lays UML out with the Arial width table, not the estimate", async () => {
    const drawn = { ...umlColors, font: FONT };
    const table = await renderUml(UML, drawn, { measure: arialMeasure });
    const estimate = await renderUml(UML, drawn, { measure: guess });
    expect(sizeOf(await renderSource(UML))).toBe(sizeOf(table.svg));
    expect(sizeOf(table.svg)).not.toBe(sizeOf(estimate.svg));
  });

  it("marks a Mermaid type the package does not draw as unsupported, at its line", async () => {
    const error = await rejection(() => renderSource("%% about\ngantt\n  title A plan"));
    expect(error).toBeInstanceOf(UmlError);
    expect(error).toMatchObject({ line: 2, unsupported: true });
  });

  it("throws the parser's TamError with its line", async () => {
    const error = await rejection(() => renderSource("agent a\nagent a"));
    expect(error).toBeInstanceOf(TamError);
    expect(error).toMatchObject({ line: 2 });
  });

  it("throws the parser's UmlError with its line", async () => {
    const error = await rejection(() => renderSource("flowchart TB\n  subgraph a\n    x"));
    expect(error).toBeInstanceOf(UmlError);
    expect(error).toMatchObject({ line: 2, unsupported: false });
  });

  it("marks valid Mermaid the package leaves to Mermaid as unsupported", async () => {
    const error = await rejection(() => renderSource("flowchart TB\n  a@{ shape: notch-rect }"));
    expect(error).toBeInstanceOf(UmlError);
    expect(error).toMatchObject({ unsupported: true });
  });
});

describe("checkSource", () => {
  it.each([
    ["TAM", TAM],
    ["UML", UML],
  ])("accepts %s", async (_kind, source) => {
    await expect(checkSource(source)).resolves.toBeUndefined();
  });

  it.each([
    ["an empty source", ""],
    ["a comment-only source", "%% todo\n%% later"],
    ["a title without elements", "title Shop\n"],
  ])("rejects %s with a TamError on no line", async (_kind, source) => {
    const error = await rejection(() => checkSource(source));
    expect(error).toBeInstanceOf(TamError);
    expect(error).toMatchObject({ line: 0, message: "the diagram has no elements" });
  });

  it("rejects what renderSource rejects, layout errors included", async () => {
    const source = "sequenceDiagram\nA->>B: hi\ndeactivate B";
    const [fromRender, fromCheck] = await Promise.all([
      rejection(() => renderSource(source)),
      rejection(() => checkSource(source)),
    ]);
    expect(fromCheck).toBeInstanceOf(UmlError);
    expect(fromCheck).toMatchObject({ line: 3 });
    expect(fromCheck).toEqual(fromRender);
  });
});

describe("isDiagramError", () => {
  it("is true for the two parser errors only", () => {
    expect(isDiagramError(new TamError(1, "x"))).toBe(true);
    expect(isDiagramError(new UmlError(1, "x"))).toBe(true);
    expect(isDiagramError(new Error("x"))).toBe(false);
    expect(isDiagramError("x")).toBe(false);
  });
});
