// @vitest-environment node
// The parser's rules and the layout, checked on diagrams generated from fixed seeds (samples/fuzz.ts).
import { describe, expect, it } from "vitest";
import { parseTam } from "../src/tam.ts";
import { renderTam } from "../src/tam-layout.ts";
import { auditScene } from "../src/audit.ts";
import { generateTam, VIOLATIONS } from "../src/samples/fuzz.ts";
import { colors } from "./fixtures.ts";

describe("TAM rules on generated diagrams", () => {
  it.each(VIOLATIONS.map((violation) => [violation.name, violation] as const))(
    "rejects %s in any diagram, at the right line",
    (_name, violation) => {
      for (let seed = 1; seed <= 25; seed++) {
        const valid = generateTam(seed);
        expect(() => parseTam(valid)).not.toThrow();
        const lines = valid.split("\n");
        // Inject at top level (outside every container), at a spot that varies with the seed.
        const depths = lines.map((_, index) =>
          lines
            .slice(0, index)
            .reduce(
              (depth, line) =>
                depth + (line.trim().endsWith("{") ? 1 : line.trim() === "}" ? -1 : 0),
              0,
            ),
        );
        const free = [
          ...depths.map((depth, index) => (depth === 0 ? index : -1)).filter((index) => index >= 0),
          lines.length,
        ];
        const at = free[seed % free.length];
        const broken = [...lines.slice(0, at), ...violation.lines, ...lines.slice(at)].join("\n");
        let message = "";
        try {
          parseTam(broken);
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message, `seed ${seed}`).toMatch(violation.error);
        const line = Number(message.match(/^Line (\d+)/)?.[1]);
        expect(line, `seed ${seed}: ${message}`).toBeGreaterThan(at);
        expect(line).toBeLessThanOrEqual(at + violation.lines.length);
      }
    },
  );
});

describe("TAM layout on generated diagrams", () => {
  // A fixed sample of the stress corpus: random valid diagrams of every kind must lay out without defects.
  it("renders 40 generated diagrams without defects", async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const { scene } = await renderTam(generateTam(seed), colors);
      const defects = auditScene(scene).filter((finding) => !finding.note);
      if (defects.length)
        failures.push(
          `seed ${seed}: ${defects.map((finding) => `${finding.check} ${finding.detail}`).join("; ")}`,
        );
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
