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
    expect(offered("")).toEqual([]);
    expect(offered("", true)).toContain("agent");
    expect(offered("direction ")).toEqual(["TB", "LR", "BT", "RL"]);
    expect(offered("agent x[X]:::")).toContain("blue");
  });

  it("offers the connections the first element can make", () => {
    const agent = offered("api ");
    expect(agent[0]).toBe("-- calls -->");
    expect(agent).toEqual(expect.arrayContaining(["-- reads -->", "---", "provides IName"]));
    expect(agent).not.toContain("-. pointer .->");
    // A storage only points; a person offers no interface; a component does not talk through channels.
    expect(offered("db ")).toEqual(["-. pointer .->"]);
    expect(offered("user ")).not.toContain("provides IName");
    expect(offered("pay -")).not.toContain("-- calls -->");
    expect(offered("pay -")).toContain("-- requires IName -->");
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
