import { describe, expect, it } from "vitest";
import { mix, roundedPath } from "../src/draw.ts";
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

describe("rounded connectors", () => {
  it("bends a polyline round at its corners, and leaves straight runs straight", () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toBe("M0 0L90 0Q100 0 100 10L100 100");
    // A short leg takes half its length; a point on a straight run is no corner.
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 8 },
      ]),
    ).toBe("M0 0L50 0L96 0Q100 0 100 4L100 8");
  });

  it("rounds the wires of a picture when the colors ask for it, and only then", async () => {
    // Placed apart diagonally, so the wires turn corners.
    const source =
      "agent a[A] @0,0\nagent b[B] @240,160\nstorage s[S] @0,320\na -- calls --> b\nb -- reads --> s";
    const square = (await renderTam(source, colors)).svg,
      rounded = (await renderTam(source, { ...colors, rounded: true })).svg;
    const wires = (svg: string) =>
      [...svg.matchAll(/<path d="([^"]*)" fill="none" stroke="[^"]*" stroke-width="1\.3"/g)].map(
        (m) => m[1],
      );
    expect(wires(square).some((d) => d.includes("Q"))).toBe(false);
    expect(wires(rounded).some((d) => d.includes("Q"))).toBe(true);
    expect(wires(rounded)).toHaveLength(wires(square).length);
  });
});
