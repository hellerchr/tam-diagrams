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
    expect(agent).toEqual(expect.arrayContaining(["-- reads -->", "---", "-. create .->"]));
    expect(agent).not.toContain("-. pointer .->");
    // A storage only points; a component does not talk through channels.
    expect(offered("db ")).toEqual(["-. pointer .->"]);
    expect(offered("pay -")).not.toContain("-- calls -->");
    expect(offered("unknown ")).toEqual([]);
  });

  it("offers nothing of the design level, which plain block diagrams leave out", () => {
    const all = [
      ...offered("a"),
      ...offered("", true),
      ...offered("api "),
      ...offered("pay "),
      ...offered("api -- "),
      ...offered("api -. "),
    ];
    for (const word of [
      "component",
      "subsystem",
      "class",
      "package",
      "level",
      "provides IName",
      "requires IName",
      "-- requires IName -->",
      "-- delegates -->",
      "requires",
      "delegates",
      "-. use .->",
      "use",
      "import",
    ])
      expect(all).not.toContain(word);
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
    // Only the dependencies the first element can start.
    expect(offered("api -. ")).toEqual(["create", "generate"]);
    expect(offered("db -. ")).toEqual(["pointer"]);
  });
});

/** What a list offers at the end of a text: its options, where it starts, and what taking one writes. */
const listAt = (text: string, explicit = false, known = KNOWN) => {
  const state = EditorState.create({ doc: text }),
    found = completeTam(new CompletionContext(state, text.length, explicit), known);
  return {
    labels: (found?.options ?? [])
      .map((item, index) => ({ item, index }))
      .toSorted((a, b) => (b.item.boost ?? 0) - (a.item.boost ?? 0) || a.index - b.index)
      .map(({ item }) => item.label),
    /** The text after taking the option with this label: a template's fields as they are. */
    take: (label: string) => {
      const option = found!.options.find((item) => item.label === label)!;
      if (typeof option.apply !== "function")
        return text.slice(0, found!.from) + (option.apply ?? option.label);
      let taken = state;
      const view = {
        get state() {
          return taken;
        },
        dispatch(spec: Parameters<EditorState["update"]>[0]) {
          taken = taken.update(spec).state;
        },
      };
      (option.apply as (...args: unknown[]) => void)(view, option, found!.from, text.length);
      return taken.doc.toString();
    },
    found,
  };
};

describe("completing at every place of a line of a block diagram", () => {
  it("offers what may follow a declaration once a space follows it, or on asking", () => {
    // Right behind the bracket Enter ends the line: the list waits for a space, or Ctrl+Space.
    expect(listAt("agent test[TEST]").labels).toEqual([]);
    const asked = listAt("agent test[TEST]", true);
    expect(asked.labels.slice(0, 4)).toEqual(["{", ":::blue", ":::orange", ":::green"]);
    expect(asked.labels).toEqual(
      expect.arrayContaining(["stack", "...", "-- calls -->", "-- reads -->", "---"]),
    );
    expect(asked.take(":::blue")).toBe("agent test[TEST] :::blue");
    const spaced = listAt("agent test[TEST] ");
    expect(spaced.labels[0]).toBe("{");
    expect(spaced.take("stack")).toBe("agent test[TEST] stack");
    // A connection from the element starts the next line, at the declaration's indent.
    expect(listAt("  agent test[TEST] ").take("-- calls -->")).toBe(
      "  agent test[TEST]\n  test -- calls --> ",
    );
    // An arrow typed behind it is a connection from it, on the next line.
    const arrow = listAt("agent test[TEST] -- re");
    expect(arrow.labels[0]).toBe("-- calls -->");
    expect(arrow.found!.from).toBe("agent test[TEST] ".length);
    expect(arrow.take("-- reads -->")).toBe("agent test[TEST]\ntest -- reads --> ");
    expect(listAt("storage s[S] -").labels).toEqual(["-. pointer .->"]);
    // Typing a color or a word of it narrows the list to it.
    expect(listAt("agent test[TEST] st").labels).toContain("stack");
    expect(listAt("agent test[TEST]:").found!.from).toBe("agent test[TEST]".length);
  });

  it("offers after a declaration only what its kind takes and it lacks yet", () => {
    // A person holds nothing and starts no access to itself; a storage only points.
    expect(listAt("human u[U] ").labels).not.toContain("{");
    expect(listAt("storage s[S] ").labels).toEqual(
      expect.arrayContaining(["{", "stack", "-. pointer .->"]),
    );
    expect(listAt("storage s[S] ").labels).not.toContain("-- calls -->");
    const colored = listAt("agent a[A]:::red stack ").labels;
    expect(colored.some((label) => label.startsWith(":::"))).toBe(false);
    expect(colored).not.toContain("stack");
    expect(colored).not.toContain("...");
    // A group needs no id, and without one starts no connection.
    expect(listAt("group ").labels).toEqual([]);
    expect(listAt("group ", true).labels.slice(0, 2)).toEqual(["{", ":::blue"]);
    expect(listAt("group g[G] ").labels).toContain("-- calls -->");
    expect(listAt("group { ").labels).toEqual([]);
    // While the id is typed, nothing is offered: it is a new name.
    expect(listAt("agent te").labels).toEqual([]);
    expect(listAt("agent test[TEST] {").labels).toEqual([]);
  });

  it("offers the ids of the text as typed, also those the picture does not know yet", () => {
    const text = "agent test[TEST]\nstorage cache[Cache]\n";
    expect(listAt(`${text}te`).labels).toContain("test");
    expect(listAt(`${text}test `).labels[0]).toBe("-- calls -->");
    expect(listAt(`${text}test -- reads --> `).labels).toEqual(["cache", "db", "log"]);
    expect(listAt(`${text}test -- reads --> `).found!.options[0].detail).toBe("Cache");
    // A declaration being typed is no element yet.
    expect(listAt("agent tes").labels).toEqual([]);
    expect(listAt("ag").labels).toContain("agent");
  });

  it("offers the elements a connection may reach: not its own parts or containers, its neighbours first", () => {
    const text = `agent shop[Shop] {
  agent api[API]
  storage cart[Cart]
}
storage db[Orders]
agent other[Other]
`;
    expect(listAt(`${text}api -- reads --> `, false, []).labels).toEqual(["cart", "db"]);
    expect(listAt(`${text}api -- calls --> `, false, []).labels).toEqual(["other"]);
    expect(listAt(`${text}shop -- calls --> `, false, []).labels).toEqual(["other"]);
    expect(listAt(`${text}other -- reads --> `, false, []).labels).toEqual(["db", "cart"]);
  });

  it("offers kinds and ids at the start of a line, the kinds first, and colors after :::", () => {
    expect(listAt("", true).labels.slice(0, 6)).toEqual([
      "agent",
      "human",
      "storage",
      "group",
      "title",
      "direction",
    ]);
    expect(listAt("", true).labels.slice(6)).toEqual(KNOWN.map((item) => item.id));
    expect(listAt("agent a[A]:::").labels).toEqual([
      "blue",
      "orange",
      "green",
      "yellow",
      "pink",
      "purple",
      "red",
      "gray",
    ]);
  });
});
