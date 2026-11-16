import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { completeTam, type Known } from "../editor/completion.ts";

const KNOWN: Known[] = [
  { id: "user", kind: "human", label: "User" },
  { id: "api", kind: "agent", label: "Order API" },
  { id: "worker", kind: "agent", label: "Worker" },
  { id: "db", kind: "storage", label: "Orders" },
  { id: "log", kind: "storage", label: "Log" },
  { id: "pay", kind: "component", label: "Payments" },
];

/** The labels offered at the end of a text. */
const offered = (text: string, explicit = false) => {
  const state = EditorState.create({ doc: text });
  return (
    completeTam(new CompletionContext(state, text.length, explicit), KNOWN)?.options.map(
      (item) => item.label,
    ) ?? []
  );
};

describe("completing a block diagram source", () => {
  it("offers kinds, header lines and ids at the start of a line", () => {
    expect(offered("a")).toEqual(expect.arrayContaining(["agent", "api", "storage", "title"]));
    // Only the conceptual kinds are offered.
    expect(offered("", true)).not.toContain("component");
    expect(offered("", true)).not.toContain("level");
    expect(offered("")).toEqual([]);
    expect(offered("", true)).toContain("agent");
    expect(offered("direction ")).toEqual(["TB", "LR", "BT", "RL"]);
    expect(offered("agent x[X]:::")).toContain("blue");
  });

  it("offers the connections the first element can make", () => {
    const agent = offered("api ");
    expect(agent[0]).toBe("-- calls -->");
    expect(agent).toEqual(expect.arrayContaining(["-- reads -->", "---"]));
    expect(agent).not.toContain("-. pointer .->");
    // Block diagrams are drawn at the conceptual level: no interfaces, delegation or package dependencies.
    expect(agent).not.toContain("provides IName");
    expect(agent).not.toContain("-- delegates -->");
    expect(offered("pay -")).not.toContain("-- requires IName -->");
    // A storage only points; a component, read from the source, does not talk through channels.
    expect(offered("db ")).toEqual(["-. pointer .->"]);
    expect(offered("pay -")).not.toContain("-- calls -->");
    expect(offered("unknown ")).toEqual([]);
  });

  it("offers the elements a connection reaches", () => {
    expect(offered("api -- reads --> ")).toEqual(["db", "log"]);
    expect(offered("api -- calls: get @HTTP --> ")).toEqual(["user", "worker"]);
    expect(offered("api --- w")).toEqual(["user", "worker"]);
    expect(offered("db -. pointer .-> ")).toEqual(["log"]);
    // Further ends of the same connection are of the same kind.
    expect(offered("api -- writes --> db & ")).toEqual(["db", "log"]);
  });

  it("offers the words inside a connection", () => {
    expect(offered("api -- ")).toEqual(
      expect.arrayContaining(["calls", "sends data", "reads", "reads/writes"]),
    );
    expect(offered("api -. ")).toEqual(["use", "import", "create", "generate", "pointer"]);
  });
});

describe("completing notes", () => {
  const NOTED: Known[] = [...KNOWN, { id: "busy", kind: "note", label: "Busy at noon" }];
  const offeredWith = (text: string) => {
    const state = EditorState.create({ doc: text });
    return (
      completeTam(new CompletionContext(state, text.length, false), NOTED)?.options.map(
        (item) => item.label,
      ) ?? []
    );
  };

  it("offers the note among the kinds, and the dotted line that attaches it", () => {
    expect(offered("n")).toContain("note");
    // A note connects only by its dotted line, to elements; an element reaches the notes by it.
    expect(offeredWith("busy ")).toEqual(["-.-"]);
    expect(offeredWith("api ")).toContain("-.-");
    expect(offered("api ")).not.toContain("-.-");
    expect(offeredWith("busy -.- ")).toEqual(["user", "api", "worker", "db", "log", "pay"]);
    expect(offeredWith("api -.- ")).toEqual(["busy"]);
  });
});
