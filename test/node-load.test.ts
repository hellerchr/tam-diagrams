// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { colors } from "./fixtures";

const run = promisify(execFile);
const sourceUrl = (file: string) =>
  pathToFileURL(fileURLToPath(new URL(`../src/${file}`, import.meta.url))).href;

/** Renders the first TAM and the first UML sample straight from the sources, as a Node user would. */
const smokeScript = `
const { renderTam, renderUml } = await import(${JSON.stringify(sourceUrl("index.ts"))});
const { TAM_EXAMPLES } = await import(${JSON.stringify(sourceUrl("samples/tam-examples.ts"))});
const { CLASS_EXAMPLES } = await import(${JSON.stringify(sourceUrl("samples/uml-examples.ts"))});
const colors = ${JSON.stringify(colors)};
const measure = (text, size, weight) => text.length * size * (weight >= 600 ? 0.62 : 0.58);
const print = (kind, svg) =>
  console.log(JSON.stringify({ kind, length: svg.length, head: svg.slice(0, 80) }));
print("tam", (await renderTam(TAM_EXAMPLES[0][1], colors)).svg);
print("uml", (await renderUml(CLASS_EXAMPLES[0][1], colors, { measure })).svg);
`;

/** Node's own notices about type stripping are not errors; anything else on stderr is. */
const isNodeNotice = (line: string) =>
  /ExperimentalWarning|--trace-warnings/.test(line) || line.trim() === "";

describe("Node loads the TypeScript sources", () => {
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "tam-diagrams-node-load-"));
  });
  afterAll(() => rm(directory, { recursive: true, force: true }));

  // Cold start: Node strips and loads about forty modules and ELK.
  it("renders a TAM and a UML sample with plain node", async () => {
    const script = join(directory, "smoke.mjs");
    await writeFile(script, smokeScript);
    const { stdout, stderr } = await run(process.execPath, [script], { timeout: 55_000 });
    expect(stderr.split("\n").filter((line) => !isNodeNotice(line))).toEqual([]);
    const pictures = stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(pictures.map((picture) => picture.kind)).toEqual(["tam", "uml"]);
    for (const picture of pictures) {
      expect(picture.length).toBeGreaterThan(500);
      expect(picture.head).toContain("<svg");
    }
  }, 60_000);
});
