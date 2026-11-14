// @vitest-environment node
// The command line as a real process: the bundle `npm run build` makes, built into a temporary directory.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(__dirname, "..");
const TAM = "agent web[Web Server]\nstorage db[Orders]\nweb -- reads/writes --> db";
const BAD_TAM = "agent a\nagent b\nx -- reads --> a";

let dir: string;
let bundle: string;

/** rolldown's CLI script, from its package.json `bin`, so the build runs on any platform. */
const rolldownCli = () => {
  const folder = join(root, "node_modules/rolldown");
  const { bin } = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as {
    bin: string | Record<string, string>;
  };
  return join(folder, typeof bin === "string" ? bin : bin.rolldown);
};

const run = (args: string[], input?: string) =>
  spawnSync(process.execPath, [bundle, ...args], { cwd: dir, encoding: "utf8", input });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tam-diagrams-bin-"));
  bundle = join(dir, "cli.js");
  // The bundle imports elkjs from its own location, as an installed package finds it.
  // A junction needs no privileges on Windows and is ignored on POSIX.
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "junction");
  const build = spawnSync(
    process.execPath,
    [rolldownCli(), "-c", join(root, "rolldown.config.mjs"), "-o", bundle],
    { encoding: "utf8" },
  );
  expect(build.status, `rolldown failed:\n${build.stderr}`).toBe(0);
  expect(existsSync(bundle), `rolldown wrote no bundle:\n${build.stderr}`).toBe(true);
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the built command line", () => {
  it("starts with the shebang, keeps node: and elkjs as imports and stubs nothing", () => {
    const code = readFileSync(bundle, "utf8");
    expect(code.split("\n")[0]).toBe("#!/usr/bin/env node");
    expect(code).not.toContain("__vite_browser_external");
    expect(code).toContain('from "node:fs/promises"');
    expect(code).toContain('import("elkjs/lib/elk.bundled.js")');
  });

  it("prints the usage for --help and exits 0", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^Usage:/);
  });

  it("renders stdin to an SVG on stdout that ends in a newline", () => {
    const result = run(["render", "-"], TAM);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^<svg\b[\s\S]*<\/svg>\n$/);
    expect(result.stdout).toContain("Web Server");
    expect(result.stderr).toBe("");
  }, 30_000);

  it("exits 1 and names the file and line of a broken source", () => {
    const broken = join(dir, "broken.tam");
    writeFileSync(broken, BAD_TAM);
    const result = run(["check", broken]);
    expect(result.status).toBe(1);
    expect(result.stderr.startsWith(`${broken}:3: `)).toBe(true);
    expect(result.stdout).toBe("");
  }, 30_000);

  it("exits 2 for a file that does not exist", () => {
    const result = run(["render", join(dir, "missing.tam")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^tam-diagrams: ENOENT/);
  });
});
