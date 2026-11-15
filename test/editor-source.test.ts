import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  backspaceBlankLine,
  changeBetween,
  occurrences,
  showText,
  SourcePane,
  type SourceHost,
  tabBehindText,
} from "../editor/source.ts";
import { braceBelow, freeText, pastClosers } from "../editor/syntax.ts";
import type { DiagramType } from "../editor/types.ts";

// The pane measures its text, which this page cannot: it has nothing to measure.
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});

describe("the change between two texts", () => {
  it("is what lies between their common start and end", () => {
    expect(changeBetween("abc", "abc")).toBeUndefined();
    expect(changeBetween("a\nb\nc", "a\nB\nc")).toEqual({ from: 2, to: 3, insert: "B" });
    expect(changeBetween("a\nc", "a\nb\nc")).toEqual({ from: 2, to: 2, insert: "b\n" });
    expect(changeBetween("a\nb\nc", "a\nc")).toEqual({ from: 2, to: 4, insert: "" });
    expect(changeBetween("", "abc")).toEqual({ from: 0, to: 0, insert: "abc" });
    expect(changeBetween("abc", "")).toEqual({ from: 0, to: 3, insert: "" });
    // Whole lines, where lines are all that was added or removed.
    expect(changeBetween("agent a\nagent b\nagent c", "agent a\nagent c")).toEqual({
      from: 8,
      to: 16,
      insert: "",
    });
    expect(changeBetween("  a\n  c", "  a\n  b\n  c")).toEqual({ from: 4, to: 4, insert: "  b\n" });
    expect(changeBetween("xa", "xaba")).toEqual({ from: 2, to: 2, insert: "ba" });
    // A repeated text is not counted twice.
    expect(changeBetween("aa", "aaa")).toEqual({ from: 2, to: 2, insert: "a" });
    expect(changeBetween("abab", "ab")).toEqual({ from: 2, to: 4, insert: "" });
  });

  it("turns the one text into the other", () => {
    const texts = [
      "",
      "a",
      "agent a[A] @10,20\nagent b[B] @30,40",
      "agent a[A] @15,20\nagent b[B]",
    ];
    for (const old of texts)
      for (const text of texts) {
        const change = changeBetween(old, text);
        const made = change
          ? old.slice(0, change.from) + change.insert + old.slice(change.to)
          : old;
        expect(made).toBe(text);
      }
  });
});

describe("showing a text of the document", () => {
  const old = "agent a[A] @10,20\nagent b[B] @30,40\nagent c[C]";
  const shown = (cursor: number, text: string, follow = false) => {
    const state = EditorState.create({ doc: old, selection: EditorSelection.cursor(cursor) }),
      spec = showText(state, text, follow);
    return spec ? state.update(spec).state : state;
  };

  it("keeps the cursor where it is in the text around the change", () => {
    const moved = old.replace("@30,40", "@300,400");
    // Before the change, behind it, and on another line.
    expect(shown(5, moved).selection.main.head).toBe(5);
    expect(shown(old.length, moved).selection.main.head).toBe(moved.length);
    expect(shown(old.indexOf("agent c") + 3, moved).selection.main.head).toBe(
      moved.indexOf("agent c") + 3,
    );
    expect(shown(5, moved).doc.toString()).toBe(moved);
    expect(shown(7, old).selection.main.head).toBe(7);
  });

  it("puts the cursor where the change ends when a step of the history is followed", () => {
    // Where a line was: at the start of the line that follows it now.
    const without = old.replace("\nagent b[B] @30,40", "");
    expect(shown(0, without, true).selection.main.head).toBe(without.indexOf("agent c"));
    // Behind a line that came back.
    const state = EditorState.create({ doc: without });
    expect(state.update(showText(state, old, true)!).state.selection.main.head).toBe(
      old.indexOf("agent c"),
    );
    const renamed = old.replace("[B]", "[Billing]");
    expect(shown(0, renamed, true).selection.main.head).toBe(renamed.indexOf("]", 20));
  });
});

describe("the source pane", () => {
  const made = (text: string, type: DiagramType = "tam") => {
    const host = {
      changed: vi.fn<(text: string, whole: boolean) => void>(),
      elements: () => [],
      completes: () => type === "tam",
      type: () => type,
      undo: vi.fn<() => void>(),
      redo: vi.fn<() => void>(),
      cursorAt: vi.fn<(line: number) => void>(),
    } satisfies SourceHost;
    const parent = document.createElement("div");
    document.body.append(parent);
    const pane = new SourcePane(parent, host);
    pane.setText(text);
    const content = parent.querySelector<HTMLElement>(".cm-content")!,
      press = (key: string, more: KeyboardEventInit = {}) =>
        content.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
            ...more,
          }),
        );
    return { host, pane, parent, press };
  };

  afterEach(() => document.body.replaceChildren());

  it("does not take a text of the document for typing", () => {
    const { host, pane } = made("agent a[A]");
    expect(pane.setText("agent a[A]\nagent b[B]")).toBe(true);
    expect(pane.setText("agent a[A]\nagent b[B]")).toBe(false);
    expect(pane.text).toBe("agent a[A]\nagent b[B]");
    expect(host.changed).not.toHaveBeenCalled();
    pane.insert("agent c[C]");
    expect(host.changed).toHaveBeenCalledWith("agent a[A]\nagent b[B]\nagent c[C]\n", true);
  });

  it("says whether typing left a whole statement or a word half typed", () => {
    const { host, parent } = made("agent a[A]"),
      view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!,
      type = (insert: string, userEvent = "input.type") =>
        view.dispatch({ changes: { from: view.state.doc.length, insert }, userEvent });
    type("\nagent b");
    expect(host.changed).toHaveBeenLastCalledWith("agent a[A]\nagent b", true);
    type("[");
    expect(host.changed).toHaveBeenLastCalledWith("agent a[A]\nagent b[", false);
    type("B]", "input.complete");
    expect(host.changed).toHaveBeenLastCalledWith("agent a[A]\nagent b[B]", true);
    type(" x", "input.paste");
    expect(host.changed).toHaveBeenLastCalledWith("agent a[A]\nagent b[B] x", true);
  });

  it("finds a text whatever its case, marks every place and selects them in turn", () => {
    const { host, pane, parent } = made("agent a[Agent]\nstorage s[S]\nAGENT b[B]"),
      bar = parent.querySelector<HTMLElement>(".find-bar")!,
      field = bar.querySelector("input")!,
      view = EditorView.findFromDOM(parent.querySelector<HTMLElement>(".cm-editor")!)!,
      key = (name: string, shiftKey = false) =>
        field.dispatchEvent(
          new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true }),
        ),
      selected = () =>
        view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    expect(bar.hidden).toBe(true);
    pane.find();
    expect(bar.hidden).toBe(false);
    field.value = "agent";
    field.dispatchEvent(new Event("input"));
    expect(bar.querySelector(".find-count")!.textContent).toBe("1 of 3");
    expect(view.state.selection.main.from).toBe(0);
    key("Enter");
    expect(view.state.selection.main.from).toBe(8);
    expect(selected()).toBe("Agent");
    key("Enter");
    key("Enter");
    expect(view.state.selection.main.from).toBe(0);
    key("Enter", true);
    expect(selected()).toBe("AGENT");
    expect(bar.querySelector(".find-count")!.textContent).toBe("3 of 3");
    field.value = "nothing";
    field.dispatchEvent(new Event("input"));
    expect(bar.querySelector(".find-count")!.textContent).toBe("None");
    key("Escape");
    expect(bar.hidden).toBe(true);
    // Looking for a text is not typing.
    expect(host.changed).not.toHaveBeenCalled();
  });

  it("steps through the document's history, and has none of its own", () => {
    const { host, pane, press } = made("agent a[A]");
    pane.setText("agent a[A]\nagent b[B]");
    expect(press("z")).toBe(false);
    expect(host.undo).toHaveBeenCalledTimes(1);
    // The text is the document's to change: the pane undoes nothing itself.
    expect(pane.text).toBe("agent a[A]\nagent b[B]");
    press("z", { shiftKey: true });
    press("Z", { shiftKey: true });
    press("y");
    expect(host.redo).toHaveBeenCalledTimes(3);
    press("z", { ctrlKey: false, metaKey: true });
    expect(host.undo).toHaveBeenCalledTimes(2);
    press("z", { ctrlKey: false });
    expect(host.undo).toHaveBeenCalledTimes(2);
    expect(host.changed).not.toHaveBeenCalled();
  });

  it("steps back only once typed text has reached the document", async () => {
    const { host, pane, press } = made("agent a[A]");
    pane.insert("agent b[B]");
    press("z");
    expect(host.undo).not.toHaveBeenCalled();
    // The document took the text and shows it.
    pane.setText(pane.text);
    await Promise.resolve();
    expect(host.undo).toHaveBeenCalledTimes(1);
  });

  it("follows a step it asked for with the cursor", () => {
    const { host, pane, press, parent } = made("agent a[A]\nagent b[B]\nagent c[C]");
    const view = EditorView.findFromDOM(parent)!;
    host.undo.mockImplementation(() => pane.setText("agent a[A]\nagent c[C]"));
    press("z");
    expect(view.state.selection.main.head).toBe("agent a[A]\n".length);
    // A change from elsewhere leaves the cursor in its text.
    pane.setText("agent a[A] @1,2\nagent c[C]");
    expect(view.state.selection.main.head).toBe("agent a[A] @1,2\n".length);
  });

  it("completes what is typed as the type its text says, before the document knows", () => {
    // The document is still a block diagram while a header is typed.
    const { parent } = made("flowchart LR\n  a[A] --> b[B]\n  a ", "tam");
    const view = EditorView.findFromDOM(parent)!;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    startCompletion(view);
    return vi.waitFor(() =>
      expect(currentCompletions(view.state).map((item) => item.label)).toContain("-->"),
    );
  });

  it("keeps its lists in a place that takes no room on the page", () => {
    const { parent } = made("agent a[A]");
    const holder = document.querySelector<HTMLElement>(".cm-tooltip-holder")!;
    expect(holder.parentElement).toBe(document.body);
    expect(holder.style.position).toBe("fixed");
    expect([holder.style.width, holder.style.height]).toEqual(["0px", "0px"]);
    expect(parent.contains(holder)).toBe(false);
  });
});

describe("the places a text occurs", () => {
  it("are found whatever the case, one after the other", () => {
    expect(occurrences("Agent agent AGENT", "agent")).toEqual([0, 6, 12]);
    expect(occurrences("aaaa", "aa")).toEqual([0, 2]);
    expect(occurrences("abc", "")).toEqual([]);
    expect(occurrences("abc", "x")).toEqual([]);
  });
});

describe("Backspace on a line of spaces", () => {
  const run = (doc: string, anchor: number, head = anchor) => {
    const view = new EditorView({
      state: EditorState.create({ doc, selection: EditorSelection.range(anchor, head) }),
    });
    const handled = backspaceBlankLine(view);
    return { handled, doc: view.state.doc.toString(), head: view.state.selection.main.head };
  };

  it("removes the line, as if Enter had not been pressed", () => {
    expect(run("agent a {\n  agent b[B]\n  \n}", 25)).toEqual({
      handled: true,
      doc: "agent a {\n  agent b[B]\n}",
      head: 22,
    });
    expect(run("a\n    ", 6)).toEqual({ handled: true, doc: "a", head: 1 });
  });

  it("is left to the other bindings on any other line", () => {
    // A line with text, an empty line, the first line, a cursor inside the spaces, a selection.
    expect(run("a\n  b", 5).handled).toBe(false);
    expect(run("a\n", 2).handled).toBe(false);
    expect(run("  ", 2).handled).toBe(false);
    expect(run("a\n    ", 4).handled).toBe(false);
    expect(run("a\n    ", 2, 6).handled).toBe(false);
  });
});

describe("Tab behind text", () => {
  const run = (doc: string, anchor: number, head = anchor) => {
    const view = new EditorView({
      state: EditorState.create({ doc, selection: EditorSelection.range(anchor, head) }),
    });
    const handled = tabBehindText(view);
    return { handled, doc: view.state.doc.toString(), ...view.state.selection.main };
  };

  it("leaves a selected word with the cursor behind it", () => {
    expect(run("  actor Name", 8, 12)).toMatchObject({ handled: true, from: 12, to: 12 });
    expect(run("  actor Name", 12)).toMatchObject({ handled: true, doc: "  actor Name" });
  });

  it("leaves indenting to the start of a line and to selected lines", () => {
    expect(run("  actor Name", 0).handled).toBe(false);
    expect(run("  actor Name", 2).handled).toBe(false);
    expect(run("a\nb", 0, 3).handled).toBe(false);
    expect(run("", 0).handled).toBe(false);
  });
});

describe("free text", () => {
  it("is the text of a message, a note, a label, a title and a comment", () => {
    const head = "sequenceDiagram\n  participant A\n";
    expect(freeText("sequence", head, "  A->>B: Not so good :")).toBe(true);
    expect(freeText("sequence", head, "  note over A: hi ")).toBe(true);
    expect(freeText("sequence", head, "  box Team ")).toBe(true);
    expect(freeText("sequence", head, "  alt is ")).toBe(true);
    expect(freeText("sequence", head, "  participant C as The ")).toBe(true);
    expect(freeText("sequence", head, "  %% a comment ")).toBe(true);
    expect(freeText("state", "stateDiagram-v2\n", "  A --> B : go ")).toBe(true);
    expect(freeText("state", "stateDiagram-v2\n", "  A : entry / ")).toBe(true);
    expect(freeText("class", "classDiagram\n", "  A --> B : has ")).toBe(true);
    expect(freeText("tam", "", "title Orders ")).toBe(true);
    expect(freeText("tam", "agent a[A]\n", "agent b[B] %% why ")).toBe(true);
    expect(freeText("class", "---\n", "title: My ")).toBe(true);
  });

  it("is not where the syntax reads brackets", () => {
    expect(freeText("flowchart", "flowchart TB\n", "  ship")).toBe(false);
    expect(freeText("class", "classDiagram\n  class A {\n", "    +total")).toBe(false);
    expect(freeText("class", "classDiagram\n", "  class A ")).toBe(false);
    expect(freeText("state", "stateDiagram-v2\n", "  state A ")).toBe(false);
    expect(freeText("sequence", "sequenceDiagram\n", "  A->>B")).toBe(false);
    expect(freeText("usecase", "usecase-beta\n", "  pay")).toBe(false);
    expect(freeText("tam", "", "agent a")).toBe(false);
    expect(freeText("tam", "title Orders\n", "group ")).toBe(false);
  });
});

describe("Enter before closing brackets", () => {
  it("starts the new line behind the brackets that end a statement", () => {
    expect(pastClosers("flowchart", "  ship[Ship order]", 17)).toBe(18);
    expect(pastClosers("flowchart", "  stop(((End)))", 12)).toBe(15);
    expect(pastClosers("flowchart", "  ask{Why}", 9)).toBe(10);
    expect(pastClosers("flowchart", '  a -->|"yes"|', 12)).toBe(14);
    expect(pastClosers("tam", "agent a[A]", 9)).toBe(10);
    expect(pastClosers("class", "    +total()", 11)).toBe(12);
  });

  it("breaks the line anywhere else, and between the braces of a new block", () => {
    expect(pastClosers("flowchart", "  ship[Ship order] --> x", 17)).toBeUndefined();
    expect(pastClosers("flowchart", "  ship[Ship order]", 18)).toBeUndefined();
    expect(pastClosers("class", "  class A {}", 11)).toBeUndefined();
    expect(pastClosers("tam", "group {}", 7)).toBeUndefined();
    expect(pastClosers("state", "  state A {}", 11)).toBeUndefined();
    // Before a brace on a line of its own a line is put in above it.
    expect(pastClosers("class", "  }", 2)).toBeUndefined();
  });
});

describe("a closing brace typed above the one that is there", () => {
  const at = (type: DiagramType, doc: string) =>
    braceBelow(
      type,
      EditorState.create({
        doc: doc.replace("|", ""),
        selection: EditorSelection.cursor(doc.indexOf("|")),
      }),
    );

  it("goes to that brace, when every block is closed already", () => {
    const doc = "classDiagram\n  class A {\n    +x: int\n    |\n  }\n  A --> B";
    const below = at("class", doc)!,
      text = doc.replace("|", "");
    expect(text.slice(0, below.from) + text.slice(below.to)).toBe(
      "classDiagram\n  class A {\n    +x: int\n  }\n  A --> B",
    );
    expect(below.cursor).toBe("classDiagram\n  class A {\n    +x: int\n  }".length);
    expect(at("tam", "group {\n  |\n}")).toEqual({ from: 8, to: 11, cursor: 9 });
  });

  it("is written where a block is still open, and where no brace follows", () => {
    expect(at("class", "classDiagram\n  class A {\n    |\n  class B {\n  }")).toBeUndefined();
    expect(at("class", "classDiagram\n  class A {\n    +x|\n  }")).toBeUndefined();
    expect(at("class", "classDiagram\n  class A {\n  }\n  |\n  A --> B")).toBeUndefined();
    expect(at("flowchart", "flowchart TB\n  |\n  }")).toBeUndefined();
    expect(at("tam", "group {\n}\n|")).toBeUndefined();
  });
});
