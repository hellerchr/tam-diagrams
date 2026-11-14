import { describe, expect, it } from "vitest";
import { mix } from "../src/draw.ts";
import { renderTam } from "../src/tam-layout.ts";
import { colors } from "./fixtures.ts";

describe("mix", () => {
  it.each([
    ["#fff", "#ffffff"],
    ["#FFF", "#ffffff"],
    ["#1a3", "#11aa33"],
    ["#1A3", "#11AA33"],
  ])("reads %s like %s", (short, long) => {
    expect(mix(short, "#000000", 0.3)).toBe(mix(long, "#000000", 0.3));
    expect(mix("#202020", short, 0.3)).toBe(mix("#202020", long, 0.3));
  });

  it("keeps reading #rrggbb in either case", () => {
    expect(mix("#FFFFFF", "#000000", 0.5)).toBe("#808080");
    expect(mix("#ffffff", "#000000", 0.5)).toBe("#808080");
  });

  it.each(["#fff8", "#ffffff80", "rgb(255, 255, 255)", "white", "#ggg", " #ffffff", ""])(
    "rejects the color `%s` it cannot mix",
    (color) => {
      const message = `Cannot mix the color \`${color}\`: colors are mixed as #rgb or #rrggbb.`;
      expect(() => mix(color, "#000000", 0.5)).toThrow(new Error(message));
      expect(() => mix("#000000", color, 0.5)).toThrow(new Error(message));
    },
  );

  it("names the first color it cannot mix", () => {
    expect(() => mix("white", "black", 0.5)).toThrow("`white`");
    expect(() => mix("#fff", "black", 0.5)).toThrow("`black`");
  });

  it("draws a diagram with a #rgb page color without NaN", async () => {
    const picture = await renderTam("agent a[A]\nagent b[B]\na -- calls --> b", {
      ...colors,
      background: "#fff",
      text: "#111",
    });
    expect(picture.svg).not.toContain("NaN");
  });
});
