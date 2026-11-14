// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseCommand, UsageError, USAGE } from "../cli/args";

describe("parseCommand", () => {
  it.each([
    [["render", "a.tam"], { kind: "render", input: "a.tam" }],
    [["render", "-"], { kind: "render", input: "-" }],
    [["render", "a.tam", "-o", "a.svg"], { kind: "render", input: "a.tam", output: "a.svg" }],
    [["render", "-o", "a.svg", "a.tam"], { kind: "render", input: "a.tam", output: "a.svg" }],
    [["render", "a.tam", "--output=a.svg"], { kind: "render", input: "a.tam", output: "a.svg" }],
    [["render", "-", "-o", "a.svg"], { kind: "render", input: "-", output: "a.svg" }],
    [["check", "a.tam"], { kind: "check", inputs: ["a.tam"] }],
    [["check", "-"], { kind: "check", inputs: ["-"] }],
    [["check", "a.tam", "b.md", "-"], { kind: "check", inputs: ["a.tam", "b.md", "-"] }],
    [["render", "--", "-x"], { kind: "render", input: "-x" }],
    [["-h"], { kind: "help" }],
    [["--help"], { kind: "help" }],
  ])("reads %j", (argv, expected) => {
    expect(parseCommand(argv)).toEqual(expected);
  });

  it.each([
    ["no arguments", [], /missing command/],
    ["an unknown command", ["draw", "a.tam"], /unknown command `draw`/],
    ["an unknown option", ["render", "a.tam", "--dark"], /--dark/],
    ["render without an input", ["render"], /exactly one input/],
    ["render with two inputs", ["render", "a.tam", "b.tam"], /exactly one input/],
    ["-o without a file name", ["render", "a.tam", "-o"], /-o/],
    ["-o -", ["render", "a.tam", "-o", "-"], /stdout/],
    ["-o with check", ["check", "a.tam", "-o", "a.svg"], /render only/],
    ["check without an input", ["check"], /at least one input/],
    ["stdin read twice", ["check", "-", "a.tam", "-"], /stdin/],
  ])("rejects %s", (_name, argv, message) => {
    expect(() => parseCommand(argv)).toThrow(UsageError);
    expect(() => parseCommand(argv)).toThrow(message);
  });

  it("lets help win over other argument errors, but not after --", () => {
    expect(parseCommand(["render", "--bogus", "-h"])).toEqual({ kind: "help" });
    expect(parseCommand(["check", "-o", "x", "--help"])).toEqual({ kind: "help" });
    expect(() => parseCommand(["draw", "--", "-h"])).toThrow(UsageError);
  });

  it("does not take the value of -o or --output for a help request", () => {
    expect(parseCommand(["render", "a.tam", "-o-h"])).toEqual({
      kind: "render",
      input: "a.tam",
      output: "-h",
    });
    expect(parseCommand(["render", "a.tam", "--output=--help"])).toMatchObject({
      output: "--help",
    });
    // parseArgs finds `-o -h` ambiguous, which is a usage error, not a request for help.
    expect(() => parseCommand(["render", "a.tam", "-o", "-h"])).toThrow(UsageError);
    expect(() => parseCommand(["render", "a.tam", "--output", "--help"])).toThrow(UsageError);
  });

  it("describes both commands and the exit codes in the usage text", () => {
    expect(USAGE).toMatch(/render <file \| ->/);
    expect(USAGE).toMatch(/check <file \| ->/);
    expect(USAGE).toMatch(/0 success, 1 diagram error, 2 usage or I\/O error/);
  });
});
