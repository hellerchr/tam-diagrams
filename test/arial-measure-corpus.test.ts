// @vitest-environment node
import { describe, expect, it } from "vitest";
import { auditScene, arialMeasure, renderTam, renderUml } from "../src/index.ts";
import { TAM_EXAMPLES } from "../src/samples/tam-examples.ts";
import * as umlExamples from "../src/samples/uml-examples.ts";
import { colors, umlColors } from "./fixtures.ts";

const tam = TAM_EXAMPLES.filter(([name]) => !name.startsWith("error"));
const uml = Object.values(umlExamples).flat() as [string, string][];
const measure = { measure: arialMeasure };

// The sample diagrams were tuned with the canvas-less estimate; real widths move every layout.
describe("sample diagrams with the Arial width table", () => {
  it("covers the whole corpus", () => {
    expect(tam.length + uml.length).toBe(87);
  });

  it.each(tam)("lays out TAM %s without defects", async (_name, source) => {
    const { scene } = await renderTam(source, colors, measure);
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
  });

  it.each(uml)("lays out UML %s without defects", async (_name, source) => {
    const { scene } = await renderUml(source, umlColors, measure);
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
  });
});
