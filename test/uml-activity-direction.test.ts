import { beforeAll, describe, expect, it } from "vitest";
import { parseError, umlColors } from "./fixtures.ts";
import { type Measure, detectUml, renderUml } from "../src/index.ts";
import { parseFlowchart } from "../src/uml-activity.ts";

const estimate: Measure = (text, size) => text.length * size * 0.58;
const BODY = "  a[Start] --> b[Middle] --> c[End]\n  a --> d[Side]";
// Mermaid's flowchart database reads these header words as these long forms.
const SHORTHANDS = [
  ["<", "RL"],
  [">", "LR"],
  ["^", "BT"],
  ["v", "TB"],
] as const;
const HEADERS = ["graph", "flowchart", "flowchart-elk"];
const MESSAGE = (word: string) =>
  `Line 1: Unknown direction \`${word}\`; use TB, TD, BT, LR, RL or one of < > ^ v.`;

describe("flowchart direction shorthands", () => {
  it.each(SHORTHANDS)("reads `graph %s` as %s", (short, long) => {
    expect(parseFlowchart(`graph ${short}\n${BODY}`).direction).toBe(long);
    expect(parseFlowchart(`graph ${short};\n${BODY}`).direction).toBe(long);
  });

  it.each(HEADERS)("reads the shorthands after `%s`", (header) => {
    for (const [short, long] of SHORTHANDS)
      expect(parseFlowchart(`${header} ${short}\n${BODY}`).direction).toBe(long);
  });

  it.each(SHORTHANDS)("draws `graph %s` like `graph %s`'s long form", async (short, long) => {
    const drawn = await renderUml(`graph ${short}\n${BODY}`, umlColors, { measure: estimate });
    const reference = await renderUml(`graph ${long}\n${BODY}`, umlColors, { measure: estimate });
    expect(drawn.kind).toBe("flowchart");
    expect(drawn.svg).toBe(reference.svg);
  });

  it("reads a shorthand on a swimlane header the same way", () => {
    const source = "swimlane-beta <\n  subgraph a\n    x --> y\n  end";
    expect(parseFlowchart(source)).toMatchObject({ kind: "swimlane", direction: "RL" });
  });

  it("is detected as a flowchart, not rejected as another Mermaid type", () => {
    for (const header of HEADERS)
      for (const [short] of SHORTHANDS)
        expect(detectUml(`${header} ${short}\n${BODY}`)).toBe("flowchart");
  });

  it("leaves `graph<` without a space to TAM, as before", () => {
    expect(detectUml(`graph<\n${BODY}`)).toBeNull();
  });
});

describe("flowchart direction words that stay unknown", () => {
  it.each([["XY"], ["V"], ["<>"], ["constructor"], ["vv"]])("rejects `%s`", (word) => {
    const error = parseError(parseFlowchart, `graph ${word}\n${BODY}`);
    expect(error.message).toBe(MESSAGE(word.toUpperCase()));
  });

  it("still reads the long forms in either case", () => {
    expect(parseFlowchart(`graph td\n${BODY}`).direction).toBe("TB");
    expect(parseFlowchart(`graph rl\n${BODY}`).direction).toBe("RL");
    expect(parseFlowchart(`graph\n${BODY}`).direction).toBe("TB");
  });

  it("keeps a `direction` statement in a subgraph to the long forms, as Mermaid does", () => {
    const body = (word: string) =>
      `graph TB\n  subgraph s\n    direction ${word}\n    a --> b\n  end`;
    expect(parseFlowchart(body("LR")).direction).toBe("TB");
    expect(parseFlowchart(body("TD")).direction).toBe("TB");
    expect(() => parseFlowchart(body("<"))).toThrow();
  });
});

describe("flowchart direction shorthands are valid Mermaid", () => {
  let mermaid: typeof import("mermaid").default;
  // Mermaid's first import, cold on a busy CI runner, took 13 s: longer than one test's 5 s.
  beforeAll(async () => {
    mermaid = (await import("mermaid")).default;
  }, 60_000);

  it.each(SHORTHANDS)("accepts `graph %s`", async (short) => {
    await expect(mermaid.parse(`graph ${short}\n${BODY}`)).resolves.toBeTruthy();
  });

  it("rejects the words this package keeps unknown", async () => {
    for (const word of ["V", "<>", "XY"])
      await expect(mermaid.parse(`graph ${word}\n${BODY}`)).rejects.toBeTruthy();
    await expect(
      mermaid.parse("graph TB\n  subgraph s\n    direction <\n    a --> b\n  end"),
    ).rejects.toBeTruthy();
  });
});
