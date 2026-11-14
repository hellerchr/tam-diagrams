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

const io: CliIo = {
  readFile: async () => "agent a",
  readStdin: async () => "",
  writeFile: async () => {},
  stdout: () => {},
  stderr: () => {},
};

describe("faults of the program", () => {
  it.each([["render"], ["check"]])("%s does not turn them into an exit code", async (command) => {
    await expect(main([command, "a.tam"], io)).rejects.toThrow("layout fault");
  });
});
