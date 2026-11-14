// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { type CliIo, main } from "../cli/main.ts";

// A fault of the program, not of the diagram: the library fails in a way no source can cause.
vi.mock("../cli/diagram", async (importActual) => ({
  ...(await importActual<typeof import("../cli/diagram.ts")>()),
  renderSource: async () => {
    throw new Error("layout fault");
  },
  checkSource: async () => {
    throw new Error("layout fault");
  },
}));

function memoryIo() {
  const err: string[] = [];
  const io: CliIo = {
    readFile: async (path) => {
      if (path === "nope.tam") throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return "agent a";
    },
    readStdin: async () => "",
    writeFile: async () => {},
    stdout: () => {},
    stderr: (text) => void err.push(text),
  };
  return { io, stderr: () => err.join("") };
}

describe("faults of the program", () => {
  it.each([["render"], ["check"]])("%s exits 3, not the diagram error's 1", async (command) => {
    const port = memoryIo();
    expect(await main([command, "a.tam"], port.io)).toBe(3);
    expect(port.stderr()).toMatch(/^tam-diagrams: internal error while drawing a\.tam: Error: layout fault/);
  });

  it("check still checks the files after one that crashed", async () => {
    const port = memoryIo();
    expect(await main(["check", "a.tam", "b.tam"], port.io)).toBe(3);
    expect(port.stderr()).toMatch(/a\.tam[\s\S]*internal error while drawing b\.tam/);
  });

  it("outranks an I/O error in check's worst exit code", async () => {
    const port = memoryIo();
    expect(await main(["check", "nope.tam", "a.tam"], port.io)).toBe(3);
  });
});
