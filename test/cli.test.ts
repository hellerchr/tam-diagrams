// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../cli/main.ts";

const TAM = "agent web[Web Server]\nstorage db[Orders]\nweb -- reads/writes --> db";
const BAD_TAM = "agent a\nagent b\nx -- reads --> a";

/** An in-memory port: `files` is the file system, `stdin` the standard input. */
function memoryIo(files: Record<string, string> = {}, stdin = "") {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const io: CliIo = {
    readFile: async (path) => {
      if (!(path in files)) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return files[path];
    },
    readStdin: async () => stdin,
    writeFile: async (path, data) => {
      if (path.startsWith("readonly/"))
        throw new Error(`EACCES: permission denied, open '${path}'`);
      written[path] = data;
    },
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
  };
  return { io, written, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("render", () => {
  it("writes the SVG and a newline to stdout, nothing to stderr", async () => {
    const port = memoryIo({ "a.tam": TAM });
    expect(await main(["render", "a.tam"], port.io)).toBe(0);
    expect(port.stdout()).toMatch(/^<svg\b[\s\S]*<\/svg>\n$/);
    expect(port.stderr()).toBe("");
  });

  it("writes the file given with -o and leaves stdout empty", async () => {
    const port = memoryIo({ "a.tam": TAM });
    expect(await main(["render", "a.tam", "-o", "out/a.svg"], port.io)).toBe(0);
    expect(port.written["out/a.svg"]).toMatch(/^<svg\b[\s\S]*<\/svg>\n$/);
    expect(port.stdout()).toBe("");
  });

  it("reads stdin for -", async () => {
    const port = memoryIo({}, TAM);
    expect(await main(["render", "-"], port.io)).toBe(0);
    expect(port.stdout()).toContain("Web Server");
  });

  it("exits 1 with <name>:<line>: and writes nothing when the diagram is wrong", async () => {
    const port = memoryIo({ "bad.tam": BAD_TAM });
    expect(await main(["render", "bad.tam", "-o", "bad.svg"], port.io)).toBe(1);
    expect(port.stderr()).toMatch(/^bad\.tam:3: /);
    expect(port.stdout()).toBe("");
    expect(port.written).toEqual({});
  });

  it("names stdin in errors", async () => {
    const port = memoryIo({}, BAD_TAM);
    expect(await main(["render", "-"], port.io)).toBe(1);
    expect(port.stderr()).toMatch(/^<stdin>:3: /);
  });

  it("exits 2 for a missing input file", async () => {
    const port = memoryIo();
    expect(await main(["render", "nope.tam"], port.io)).toBe(2);
    expect(port.stderr()).toMatch(/^tam-diagrams: ENOENT.*nope\.tam/);
    expect(port.stdout()).toBe("");
  });

  it("exits 2 with nothing on stdout when the output cannot be written", async () => {
    const port = memoryIo({ "a.tam": TAM });
    expect(await main(["render", "a.tam", "-o", "readonly/a.svg"], port.io)).toBe(2);
    expect(port.stderr()).toMatch(/^tam-diagrams: EACCES/);
    expect(port.stdout()).toBe("");
  });
});

describe("check", () => {
  it("is silent and exits 0 for valid diagrams", async () => {
    const port = memoryIo({ "a.tam": TAM, "b.tam": TAM });
    expect(await main(["check", "a.tam", "b.tam"], port.io)).toBe(0);
    expect(port.stdout() + port.stderr()).toBe("");
  });

  it.each([
    ["empty", ""],
    ["comment-only", "%% nothing yet\n"],
  ])("exits 1 for an %s source, as Mermaid rejects it", async (_kind, source) => {
    const port = memoryIo({ "e.mmd": source });
    expect(await main(["check", "e.mmd"], port.io)).toBe(1);
    expect(port.stderr()).toBe("e.mmd: the diagram has no elements\n");
  });

  it("exits 1 with <name>:<line>: for a parse error", async () => {
    const port = memoryIo({ "bad.tam": BAD_TAM });
    expect(await main(["check", "bad.tam"], port.io)).toBe(1);
    expect(port.stderr()).toMatch(/^bad\.tam:3: /);
  });

  it("rejects what render rejects, such as a layout-time rule of sequence diagrams", async () => {
    const port = memoryIo({ "s.md": "sequenceDiagram\nA->>B: hi\ndeactivate B" });
    expect(await main(["check", "s.md"], port.io)).toBe(1);
    expect(port.stderr()).toMatch(/^s\.md:3: .*is not active/);
  });

  it("reports only the bad file of several and exits 1", async () => {
    const port = memoryIo({ "a.tam": TAM, "bad.tam": BAD_TAM, "b.tam": TAM });
    expect(await main(["check", "a.tam", "bad.tam", "b.tam"], port.io)).toBe(1);
    expect(port.stderr().split("\n").filter(Boolean)).toHaveLength(1);
    expect(port.stderr()).toMatch(/^bad\.tam:3: /);
  });

  it("exits with the worst code and still checks the files after a missing one", async () => {
    const port = memoryIo({ "bad.tam": BAD_TAM });
    expect(await main(["check", "nope.tam", "bad.tam"], port.io)).toBe(2);
    expect(port.stderr()).toMatch(/nope\.tam[\s\S]*bad\.tam:3: /);
  });

  it("exits 1 for an unsupported Mermaid type, worded by the library, no hint", async () => {
    const port = memoryIo({ "pie.md": 'pie\n  "a" : 1' });
    const message = "pie is drawn by Mermaid, not the built-in renderer.";
    expect(await main(["check", "pie.md"], port.io)).toBe(1);
    expect(port.stderr()).toBe(`pie.md:1: ${message}\n`);
  });
});

describe("usage", () => {
  it("prints help to stdout and exits 0", async () => {
    const port = memoryIo();
    expect(await main(["-h"], port.io)).toBe(0);
    expect(port.stdout()).toMatch(/^Usage:/);
    expect(port.stderr()).toBe("");
  });

  it.each([[[]], [["draw", "a.tam"]], [["render", "a.tam", "b.tam"]]])(
    "prints the problem and the usage to stderr and exits 2 for %j",
    async (argv) => {
      const port = memoryIo({ "a.tam": TAM, "b.tam": TAM });
      expect(await main(argv, port.io)).toBe(2);
      expect(port.stderr()).toMatch(/^tam-diagrams: .*\n\nUsage:/);
      expect(port.stdout()).toBe("");
    },
  );
});
