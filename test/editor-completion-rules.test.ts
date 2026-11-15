import { describe, expect, it } from "vitest";
import {
  type Completion,
  CompletionContext,
  hasNextSnippetField,
  nextSnippetField,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { filled, type Known, option } from "../editor/completion.ts";
import { completeSource, continues, declarationLines } from "../editor/completion-uml.ts";
import { typeOf, TYPES } from "../editor/types.ts";

const KNOWN: Known[] = [
  { id: "user", kind: "human", label: "User" },
  { id: "api", kind: "agent", label: "Order API" },
  { id: "worker", kind: "agent", label: "Worker" },
  { id: "db", kind: "storage", label: "Orders" },
];

/** What is offered at the end of a text; the type is the one its header says. */
const complete = (text: string, explicit = false) =>
  completeSource(
    new CompletionContext(EditorState.create({ doc: text }), text.length, explicit),
    typeOf(text),
    typeOf(text) === "tam" ? KNOWN : [],
  );

/** The labels offered, best first: as the list shows them before anything is typed. */
const ordered = (text: string, explicit = false) =>
  (complete(text, explicit)?.options ?? [])
    .map((item, index) => ({ item, index }))
    .toSorted((a, b) => (b.item.boost ?? 0) - (a.item.boost ?? 0) || a.index - b.index)
    .map(({ item }) => item.label);

/** Whether a list stays open, as it is, once more was typed behind where it starts. */
const stays = (text: string, typed: string) => {
  const found = complete(text)!,
    { validFor } = found,
    state = EditorState.create({ doc: text + typed });
  if (typeof validFor !== "function") throw new Error("no rule");
  return validFor(state.sliceDoc(found.from), found.from, state.doc.length, state);
};

const starter = (type: string) => TYPES.find((item) => item.type === type)!.starter;

describe("the order of a completion list", () => {
  it("has the usual directions first", () => {
    for (const text of [
      "direction ",
      "flowchart ",
      "swimlane-beta ",
      "classDiagram\n  direction ",
      "stateDiagram-v2\n  direction ",
      "usecase-beta\n  direction ",
    ])
      expect(ordered(text), text).toEqual(["TB", "LR", "BT", "RL"]);
  });

  it("has the statements before the elements, and the elements as the source declares them", () => {
    const block = ordered("agent z[Z]\n", true);
    expect(block.slice(0, 3)).toEqual(["agent", "human", "storage"]);
    expect(block.slice(-4)).toEqual(["user", "api", "worker", "db"]);
    expect(block.indexOf("level")).toBeLessThan(block.indexOf("user"));
    expect(ordered("api -- reads --> ")).toEqual(["db"]);
    expect(ordered("db -- x --> ")).toEqual(["user", "api", "worker"]);

    const flow = ordered(`${starter("flowchart")}\n  `, true);
    expect(flow.slice(0, 2)).toEqual(["subgraph", "action"]);
    expect(flow.slice(-5)).toEqual(["start", "check", "ship", "wait", "done"]);
    expect(ordered(`${starter("flowchart")}\n  wait --> `)).toEqual([
      "start",
      "check",
      "ship",
      "wait",
      "done",
    ]);
    expect(ordered(`${starter("class")}\n  Order --> `)).toEqual([
      "Order",
      "OrderItem",
      "Customer",
    ]);
    expect(ordered(`${starter("state")}\n  Draft --> `)).toEqual([
      "Draft",
      "Submitted",
      "Approved",
      "[*]",
    ]);
    expect(ordered(`${starter("sequence")}\n  U->>`)).toEqual(["U", "S", "P"]);
    const usecase = ordered(`${starter("usecase")}\n  `, true);
    expect(usecase[0]).toBe("actor");
    expect(usecase.slice(-5)).toEqual(["User", "Admin", "browse", "order", "manage"]);
  });
});

describe("a completion list where nothing is left to complete", () => {
  it("closes behind a whole id, so that Enter starts a new line", () => {
    expect(complete(`${starter("flowchart")}\n  ship --> check`)).toBeNull();
    expect(complete(`${starter("flowchart")}\n  ship --> chec`)).not.toBeNull();
    expect(complete(`${starter("sequence")}\n  P-->>S`)).toBeNull();
    expect(complete(`${starter("class")}\n  Order --> Customer`)).toBeNull();
    expect(complete(`${starter("state")}\n  Draft --> Approved`)).toBeNull();
    expect(complete(`${starter("usecase")}\n  User --> manage`)).toBeNull();
    expect(complete("agent z[Z]\napi -- reads --> db")).toBeNull();
    expect(complete("agent z[Z]\napi")).toBeNull();
  });

  it("closes behind a whole header, direction or keyword that is written as it is", () => {
    for (const text of [
      "flowchart LR",
      "swimlane-beta TB",
      "direction RL",
      "classDiagram\n  direction LR",
      "classDiagram\n  class A",
      "flowchart TB\n  subgraph s\n    a --> b\n  end",
      "sequenceDiagram\n  autonumber",
    ])
      expect(complete(text), text).toBeNull();
    // A header in front of statements is whole; at the end of the source it brings a first line.
    expect(complete("classDiagram")?.options.map((item) => item.label)).toContain("classDiagram");
  });

  it("closes as soon as the id is whole, while the list was open", () => {
    const text = `${starter("flowchart")}\n  ship --> `;
    expect(stays(text, "che")).toBe(true);
    expect(stays(text, "check")).toBe(false);
    expect(stays("flowchart ", "L")).toBe(true);
    expect(stays("flowchart ", "LR")).toBe(false);
  });

  it("shows when it is asked for", () => {
    expect(complete(`${starter("flowchart")}\n  ship --> check`, true)).not.toBeNull();
  });

  it("stays where the option writes more than what is typed", () => {
    expect(complete("agent z[Z]\ndirection")?.options.map((item) => item.label)).toContain(
      "direction",
    );
    expect(complete("flowchart")).not.toBeNull();
  });
});

describe("the list behind a connection", () => {
  it("gives way to the elements once the connection and a space are typed", () => {
    const text = `${starter("class")}\n  Customer `;
    expect(stays(text, "--")).toBe(true);
    expect(stays(text, "-->")).toBe(true);
    expect(stays(text, "--> ")).toBe(false);
    expect(complete(`${text}--> `)?.options.map((item) => item.label)).toEqual([
      "Order",
      "OrderItem",
      "Customer",
    ]);
    expect(stays("agent z[Z]\napi ", "-- calls")).toBe(true);
    expect(stays("agent z[Z]\napi ", "-- calls --> ")).toBe(false);
    expect(stays("agent z[Z]\napi ", "--- ")).toBe(false);
  });

  it("writes a connection as text, which leaves the cursor behind it", () => {
    for (const [text, label, written] of [
      [`${starter("flowchart")}\n  ship `, "-->", "--> "],
      [`${starter("class")}\n  Order `, "<|--", "<|-- "],
      [`${starter("state")}\n  Draft `, "-->", "--> "],
      [`${starter("usecase")}\n  User `, "-->", "--> "],
      ["agent z[Z]\napi ", "-- calls -->", "-- calls --> "],
    ]) {
      const found = complete(text)?.options.find((item) => item.label === label);
      expect(found?.apply, text).toBe(written);
      expect(continues(found!), text).toBe(true);
    }
    const arrow = complete(`${starter("sequence")}\n  U-`)?.options.find(
      (item) => item.label === "->>",
    );
    expect(arrow?.apply).toBeUndefined();
    expect(continues(arrow!)).toBe(true);
  });

  it("opens the next list after a connection or a keyword, not after an element", () => {
    expect(continues(option("direction", "keyword", "", "direction "))).toBe(true);
    expect(continues(option("check", "uml-decision"))).toBe(false);
    expect(continues(option("end", "keyword"))).toBe(false);
  });
});

describe("a statement with fields", () => {
  /** A completion written into an empty source: the text, and the selection after a number of Tabs. */
  const applied = (completion: Completion, tabs = 0) => {
    let state = EditorState.create({ doc: "" });
    const view = {
      get state() {
        return state;
      },
      dispatch(spec: Parameters<EditorState["update"]>[0]) {
        state = state.update(spec).state;
      },
    };
    (completion.apply as (...args: unknown[]) => void)(view, completion, 0, 0);
    for (let tab = 0; tab < tabs; tab++)
      nextSnippetField({ state, dispatch: (transaction) => (state = transaction.state) });
    const { from, to } = state.selection.main;
    return { text: state.doc.toString(), from, to, more: hasNextSnippetField(state) };
  };

  it("is written as text when it has no field", () => {
    expect(filled("--> ", { label: "-->" }).apply).toBe("--> ");
    expect(filled("end", { label: "end" }).apply).toBeUndefined();
  });

  it("starts with its first field selected", () => {
    expect(applied(filled("${id}{${Question}}", { label: "decision" }))).toEqual({
      text: "id{Question}",
      from: 0,
      to: 2,
      more: true,
    });
  });

  it("ends with a stop behind its text: Tab after the last field goes there", () => {
    const decision = filled("${id}{${Question}}", { label: "decision" });
    expect(applied(decision, 1)).toMatchObject({ from: 3, to: 11, more: true });
    expect(applied(decision, 2)).toMatchObject({ from: 12, to: 12, more: false });
    const block = filled("subgraph ${id}\n\t${}\nend", { label: "subgraph" });
    expect(applied(block, 2)).toMatchObject({ text: "subgraph id\n  \nend", from: 18, to: 18 });
  });

  it("has no stop behind a field that ends it, which would take in what is typed there", () => {
    expect(applied(filled("actor ${Name}", { label: "actor" }))).toEqual({
      text: "actor Name",
      from: 6,
      to: 10,
      more: false,
    });
    expect(applied(filled("${id}(${Name})", { label: "use case" }), 2)).toMatchObject({
      from: 8,
      to: 8,
    });
  });
});

describe("the line that declares an element", () => {
  it("is the line with its text and shape, not its first mention", () => {
    const lines = declarationLines(
      "flowchart",
      "flowchart TB\n  a[A] --> b\n  b[B] --> c\n  c --> a",
    );
    expect([...lines]).toEqual([
      ["a", 2],
      ["b", 3],
      ["c", 3],
    ]);
  });

  it("is the statement that declares it, in every type", () => {
    expect(
      declarationLines("class", "classDiagram\n  A --> B\n  class B {\n    +x\n  }\n  class A").get(
        "B",
      ),
    ).toBe(3);
    expect(
      declarationLines("sequence", "sequenceDiagram\n  A->>B: hi\n  participant B as Bob").get("B"),
    ).toBe(3);
    expect(
      declarationLines("state", 'stateDiagram-v2\n  [*] --> A\n  state "The A" as A').get("A"),
    ).toBe(3);
    expect(
      declarationLines("usecase", "usecase-beta\n  User --> pay\n  actor User\n  pay(Pay)").get(
        "pay",
      ),
    ).toBe(4);
    expect(
      declarationLines("usecase", "usecase-beta\n  User --> pay\n  actor User").get("User"),
    ).toBe(3);
    for (const info of TYPES)
      if (info.type !== "tam")
        expect(declarationLines(info.type, info.starter).size, info.type).toBeGreaterThan(2);
  });
});
