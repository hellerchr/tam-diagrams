// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type Measure, renderClassView, renderTam } from "../src/index";
import { colors } from "./fixtures";

const SOURCE = "agent a[Alpha]\nagent b[Beta]\na -- calls --> b";
// Same diagram, other cache key: a comment does not change the layout.
const TWIN = `${SOURCE}\n%% twin`;

const estimate: Measure = (text, size) => text.length * size * 0.58;
const doubled: Measure = (text, size, weight) => 2 * estimate(text, size, weight);

describe("renderTam with a measure", () => {
  it("lays out with the given measure", async () => {
    // Another source than the cache test below, so this call cannot seed its cache.
    const seen = new Set<string>();
    await renderTam("agent p[Gamma]\nagent q[Delta]\np -- calls --> q", colors, {
      measure: (text, size, weight) => (seen.add(text), estimate(text, size, weight)),
    });
    expect(seen).toContain("Gamma");
    expect(seen).toContain("Delta");
  });

  it("does not serve a measured layout from the cache, nor cache it", async () => {
    // The twin's layout is the unmeasured layout of SOURCE, computed before any measured call.
    const baseline = await renderTam(TWIN, colors);
    // Without a canvas the unmeasured layout uses `estimate`, so the wide one goes first: a cached
    // wide layout would then show in both later calls.
    const wide = await renderTam(SOURCE, colors, { measure: doubled });
    const narrow = await renderTam(SOURCE, colors, { measure: estimate });
    expect(wide.width).toBeGreaterThan(narrow.width);
    const unmeasured = await renderTam(SOURCE, colors);
    expect(unmeasured.width).toBe(baseline.width);
    expect(unmeasured.svg).toBe(baseline.svg);
  });
});

const CLASS_SOURCE = "classDiagram\n  class Alpha {\n    +name\n  }\n  class Beta\n  Alpha --> Beta";const CLASS_TWIN = `${CLASS_SOURCE}\n  %% twin`;

describe("renderClassView with a measure", () => {
  it("lays out with the given measure", async () => {
    // Another source than the cache test below, so this call cannot seed its cache.
    const seen = new Set<string>();
    const source = "classDiagram\n  class Gamma\n  class Delta\n  Gamma --> Delta";
    await renderClassView(source, colors, null, {
      measure: (text, size, weight) => (seen.add(text), estimate(text, size, weight)),
    });
    expect(seen).toContain("Gamma");
    expect(seen).toContain("Delta");
  });

  it("does not serve a measured layout from the cache, nor cache it", async () => {
    // The twin's layout is the unmeasured layout of CLASS_SOURCE, computed before a measured call.
    const baseline = await renderClassView(CLASS_TWIN, colors, null);
    const wide = await renderClassView(CLASS_SOURCE, colors, null, { measure: doubled });
    const narrow = await renderClassView(CLASS_SOURCE, colors, null, { measure: estimate });
    expect(wide.width).toBeGreaterThan(narrow.width);
    const unmeasured = await renderClassView(CLASS_SOURCE, colors, null);
    expect(unmeasured.width).toBe(baseline.width);
    expect(unmeasured.svg).toBe(baseline.svg);
  });
});
