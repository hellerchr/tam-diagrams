// Path and number formatting the file tree, tabs and chat show.
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  age,
  ancestors,
  basename,
  bytes,
  dirname,
  extname,
  isUnder,
  movedPath,
  plural,
  tildePath,
} from "./format.ts";

test("path parts", () => {
  assert.equal(basename("src/web/App.svelte"), "App.svelte");
  assert.equal(dirname("src/web/App.svelte"), "src/web");
  assert.equal(dirname("README.md"), "");
  assert.equal(extname("src/a.test.ts"), "ts");
  assert.equal(extname("Makefile"), "");
  assert.deepEqual(ancestors("a/b/c.ts"), ["a", "a/b"]);
});

test("isUnder matches whole folder names only", () => {
  assert.equal(isUnder("src/web/a.ts", "src/web"), true);
  assert.equal(isUnder("src/web", "src/web"), true);
  assert.equal(isUnder("src/website/a.ts", "src/web"), false);
});

test("movedPath follows a moved folder and leaves the rest", () => {
  assert.equal(movedPath("src/old", "src/new", "src/old/a.ts"), "src/new/a.ts");
  assert.equal(movedPath("src/old", "src/new", "src/older/a.ts"), undefined);
});

test("tildePath shortens the home folder", () =>
  assert.equal(tildePath("/home/someone/Projects/x"), "~/Projects/x"));

test("plural names one in the singular, any other count in the plural", () => {
  assert.equal(plural(1, "file"), "1 file");
  assert.equal(plural(0, "file"), "0 files");
  assert.equal(plural(3, "line"), "3 lines");
});

test("age and bytes", () => {
  const now = Date.UTC(2026, 10, 18, 12);
  assert.equal(age(now - 30_000, now), "now");
  assert.equal(age(now - 5 * 60_000, now), "5m");
  assert.equal(age(now - 3 * 3_600_000, now), "3h");
  assert.equal(age(now - 2 * 86_400_000, now), "2d");
  assert.equal(bytes(512), "512 B");
  assert.equal(bytes(1536), "1.5 KB");
});
