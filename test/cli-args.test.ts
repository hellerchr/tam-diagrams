// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseCommand, UsageError, USAGE } from "../cli/args.ts";

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
    [
      ["convert", "a.drawio", "-o", "a.tam"],
      { kind: "convert", input: "a.drawio", output: "a.tam" },
    ],
    [["render", "a.tam", "--rounded"], { kind: "render", input: "a.tam", rounded: true }],
    [["convert", "--rounded", "a.tam"], { kind: "convert", input: "a.tam", rounded: true }],
    [["edit"], { kind: "edit" }],
    [["edit", "a.tam"], { kind: "edit", file: "a.tam" }],
    [
      ["edit", "notes.md", "--port", "5577", "--no-open"],
      { kind: "edit", file: "notes.md", port: 5577, noOpen: true },
    ],
    [["edit", "--port=8080"], { kind: "edit", port: 8080 }],
    [["edit", "--", "-a.tam"], { kind: "edit", file: "-a.tam" }],
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
    ["-o with check", ["check", "a.tam", "-o", "a.svg"], /render and convert only/],
    ["convert with two inputs", ["convert", "a.drawio", "b.drawio"], /exactly one input/],
    ["--rounded with check", ["check", "a.tam", "--rounded"], /render and convert only/],
    ["check without an input", ["check"], /at least one input/],
    ["stdin read twice", ["check", "-", "a.tam", "-"], /stdin/],
    ["edit with two files", ["edit", "a.tam", "b.tam"], /one file at most/],
    ["edit of stdin", ["edit", "-"], /not stdin/],
    ["-o with edit", ["edit", "a.tam", "-o", "a.svg"], /render and convert only/],
    ["--rounded with edit", ["edit", "a.tam", "--rounded"], /render and convert only/],
    ["--port without a number", ["edit", "a.tam", "--port"], /--port/],
    ["--port that is no number", ["edit", "--port", "web"], /1 to 65535/],
    ["--port 0", ["edit", "--port", "0"], /1 to 65535/],
    ["--port beyond 65535", ["edit", "--port", "70000"], /1 to 65535/],
    ["--port with render", ["render", "a.tam", "--port", "80"], /edit only/],
    ["--no-open with check", ["check", "a.tam", "--no-open"], /edit only/],
  ])("rejects %s", (_name, argv, message) => {
    expect(() => parseCommand(argv)).toThrow(UsageError);
    expect(() => parseCommand(argv)).toThrow(message);
  });

  it("lets help win over other argument errors, but not after --", () => {
    expect(parseCommand(["render", "--bogus", "-h"])).toEqual({ kind: "help" });
    expect(parseCommand(["check", "-o", "x", "--help"])).toEqual({ kind: "help" });
    expect(parseCommand(["edit", "--port", "x", "-h"])).toEqual({ kind: "help" });
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
    expect(USAGE).toMatch(/convert <file \| ->/);
    expect(USAGE).toMatch(/edit \[<file>\] \[--port <n>\]/);
    expect(USAGE).toMatch(/--no-open/);
    expect(USAGE).toMatch(/0 success, 1 diagram error, 2 usage or I\/O error/);
  });
});
