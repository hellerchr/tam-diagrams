// A title that is not drawn: the mark written and removed, and the heading left out of every layout that reads it.
import { test } from "vitest";
import assert from "node:assert/strict";
import { arialMeasure } from "../../src/arial-measure.ts";
import { parseUml } from "../../src/index.ts";
import type { Scene } from "../../src/scene.ts";
import { parseTam } from "../../src/tam.ts";
import { layoutDiagram } from "../../src/tam-layout.ts";
import {
  roundCorners,
  titleHidden,
  withRoundCorners,
  withSourceCorners,
  withTitleShown,
} from "../../src/title-mark.ts";

const heading = (scene: Scene) => scene.texts.find((text) => text.role === "heading")?.text;

test("the mark goes after the last line with text and comes off again, the rest as it was", () => {
  const source = "title Shop\nagent a\n\n";
  const hidden = withTitleShown(source, false);
  assert.equal(hidden, "title Shop\nagent a\n%% @title hidden\n\n");
  assert.ok(titleHidden(hidden));
  assert.equal(withTitleShown(hidden, false), hidden);
  assert.equal(withTitleShown(hidden, true), source);
  assert.equal(withTitleShown(source, true), source);
  assert.ok(titleHidden("agent a\r\n  %%  @title hidden \r\n"));
  assert.ok(!titleHidden("%% @title hiddenly"));
});

test("a block diagram that hides its title keeps it but draws no heading", async () => {
  const source = "title Shop\nagent a\nagent b\na --- b";
  assert.equal(heading(await layoutDiagram(parseTam(source), arialMeasure)), "Shop");
  const hidden = parseTam(withTitleShown(source, false));
  assert.equal(hidden.title, "Shop");
  assert.equal(heading(await layoutDiagram(hidden, arialMeasure)), undefined);
});

test("a Mermaid diagram that hides its title keeps it but draws no heading, placed by hand too", async () => {
  const sources = [
    "---\ntitle: Flow\n---\nflowchart TD\n  a --> b",
    "sequenceDiagram\n  title Flow\n  a ->> b: hi",
    "---\ntitle: Flow\n---\nclassDiagram\n  class A\n%% @A 0,0",
  ];
  for (const source of sources) {
    assert.equal(heading(await parseUml(source).layout(arialMeasure)), "Flow", source);
    const parsed = parseUml(withTitleShown(source, false));
    assert.equal(parsed.title, "Flow");
    assert.equal(heading(await parsed.layout(arialMeasure)), undefined, source);
  }
});

test("corners are square unless the source says round, and the mark comes and goes beside the title's", () => {
  const source = "title Shop\nagent a\n%% @title hidden\n";
  assert.ok(!roundCorners(source));
  const round = withRoundCorners(source, true);
  assert.equal(round, "title Shop\nagent a\n%% @title hidden\n%% @corners round\n");
  assert.ok(roundCorners(round) && titleHidden(round));
  assert.equal(withRoundCorners(round, false), source);
  assert.ok(roundCorners("flowchart TD\r\n %%@corners  round \r\n"));
  assert.ok(!roundCorners("%% @corners rounder"));
});

test("a scene takes its source's corners without changing the shared one", async () => {
  const source = "agent a\nagent b\na --- b";
  const scene = await layoutDiagram(parseTam(source), arialMeasure);
  assert.equal(withSourceCorners(scene, source), scene);
  const round = withSourceCorners(scene, withRoundCorners(source, true));
  assert.equal(round.rounded, true);
  assert.equal(scene.rounded, undefined);
});
