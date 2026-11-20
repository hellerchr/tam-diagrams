// The history of the editor's source: canvas edits are steps, typing within a statement joins one.
import { describe, expect, it } from "vitest";
import { History } from "../editor/history.ts";

describe("the history of the source", () => {
  it("undoes and redoes edits one by one, and a new edit drops what was undone", () => {
    const history = new History("a");
    history.edit("b");
    history.edit("c");
    expect(history.step(false)).toBe("b");
    expect(history.step(false)).toBe("a");
    expect(history.canUndo).toBe(false);
    expect(history.step(true)).toBe("b");
    history.edit("d");
    expect(history.canRedo).toBe(false);
    expect(history.step(false)).toBe("b");
  });

  it("joins typing within a statement into one step, but not into the edit before it", () => {
    const history = new History("x");
    history.edit("x a");
    history.edit("x ag", true);
    history.edit("x age", true);
    history.edit("x agent", true);
    expect(history.step(false)).toBe("x a");
    expect(history.step(false)).toBe("x");
  });

  it("takes no step for a source that did not change", () => {
    const history = new History("a");
    history.edit("a");
    expect(history.canUndo).toBe(false);
  });
});
