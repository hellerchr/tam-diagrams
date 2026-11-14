// @vitest-environment node
// Stress run over generated TAM diagrams, gated by HARNESS=1: FROM, COUNT, ELEMENTS, DIRECTION, DESIGN and OUT (JSON results).
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { generateTam } from "../src/samples/fuzz.ts";
import { renderTam } from "../src/tam-layout.ts";
import { auditScene } from "../src/audit.ts";
import { measureScene } from "../src/best.ts";
import { colors } from "./fixtures.ts";

it.runIf(process.env.HARNESS)(
  "fuzzes",
  async () => {
    const from = Number(process.env.FROM ?? 1),
      count = Number(process.env.COUNT ?? 300),
      elements = process.env.ELEMENTS ? Number(process.env.ELEMENTS) : undefined;
    const results = [];
    for (let seed = from; seed < from + count; seed++) {
      const source = generateTam(seed, {
        ...(elements ? { elements } : {}),
        ...(process.env.DIRECTION ? { direction: process.env.DIRECTION as "TB" } : {}),
        ...(process.env.DESIGN ? { design: true } : {}),
      });
      const started = performance.now();
      try {
        const { scene } = await renderTam(source, colors);
        const findings = auditScene(scene),
          metrics = measureScene(scene);
        results.push({
          seed,
          ms: Math.round(performance.now() - started),
          shapes: scene.shapes.length,
          crossings: metrics.crossings,
          bends: metrics.bends,
          defects: findings
            .filter((finding) => !finding.note)
            .map((finding) => `${finding.check}: ${finding.detail}`),
          notes: findings.filter((finding) => finding.note).length,
          fallbacks: Object.fromEntries(scene.fallbacks ?? []),
        });
      } catch (error) {
        results.push({ seed, error: String(error).slice(0, 300) });
      }
    }
    writeFileSync(process.env.OUT ?? "fuzz.json", JSON.stringify(results));
  },
  3_600_000,
);
