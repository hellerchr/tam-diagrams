// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TamError, UmlError } from "../src/index";
import { diagramMessage, inputName, ioMessage } from "../cli/report";

describe("diagramMessage", () => {
  it("writes <name>:<line>: <message> without the library's `Line n:` prefix", () => {
    const error = new TamError(3, "`x` is not declared.");
    expect(error.message).toBe("Line 3: `x` is not declared.");
    expect(diagramMessage("a.tam", error)).toEqual(["a.tam:3: `x` is not declared."]);
  });

  it("writes <name>: <message> for an error of the whole source", () => {
    const error = new TamError(0, "Diagram exceeds the limit.");
    expect(diagramMessage("big.tam", error)).toEqual(["big.tam: Diagram exceeds the limit."]);
  });

  it("names stdin and keeps UML errors as they are", () => {
    const error = new UmlError(2, "Subgraph `a` is missing its `end`.");
    expect(diagramMessage(inputName("-"), error)).toEqual([
      "<stdin>:2: Subgraph `a` is missing its `end`.",
    ]);
  });

  it("shows a path as given", () => {
    expect(inputName("docs/a.tam")).toBe("docs/a.tam");
  });
});

describe("unsupported Mermaid types", () => {
  it("are reported as the library words them, on one line with no hint", () => {
    const message = "erDiagram is drawn by Mermaid, not the built-in renderer.";
    const error = new UmlError(4, message, true);
    expect(diagramMessage("a.md", error)).toEqual([`a.md:4: ${message}`]);
  });

  it("add nothing to a TAM error on the first line", () => {
    const error = new TamError(1, "Cannot read `bogus`.");
    expect(diagramMessage("a.tam", error)).toEqual(["a.tam:1: Cannot read `bogus`."]);
  });
});

describe("ioMessage", () => {
  it("prefixes the program name to the message of the failure", () => {
    expect(ioMessage(new Error("ENOENT: no such file or directory, open 'x.tam'"))).toBe(
      "tam-diagrams: ENOENT: no such file or directory, open 'x.tam'",
    );
    expect(ioMessage("odd")).toBe("tam-diagrams: odd");
  });
});
