// What the diagram's Properties offer: the settings each type has, the refusals shown rather than applied, and the
// kinds, words and switches an element or a connection takes where it stands.
import assert from "node:assert/strict";
import { test } from "vitest";
import { parseTam } from "../../src/tam.ts";
import { headerOf, headerRefusal, withHeader } from "./diagram-props.ts";
import {
  connectionAt,
  countRefusal,
  elementKinds,
  elementsWith,
  kindName,
  shared,
  wireFields,
  wireKinds,
} from "./diagram-props-tam.ts";

const TAM =
  "agent a[A]\nagent b[B]\nstorage s[S]\nnote n[hi]\na -- calls --> b\na -- reads --> s\nn -.- a\n";
const edge = (source: string, index: number) => parseTam(source).edges[index]!.id;
const values = (source: string, index: number) =>
  wireKinds(source, edge(source, index)).map((w) => w.value);

test("a block diagram has a title and a direction, and no level to choose (it is drawn conceptual)", () => {
  const header = headerOf("title Shop\ndirection LR\nagent a\n", "tam");
  assert.deepEqual(header, {
    kind: "tam",
    title: "Shop",
    titleShown: true,
    rounded: false,
    direction: "LR",
    has: { direction: true, level: false, numbering: false },
  });
  assert.equal(
    withHeader("agent a\n", "tam", { title: "Shop", direction: "RL" }),
    "title Shop\ndirection RL\nagent a\n",
  );
  assert.equal(withHeader("title Shop\nagent a\n", "tam", { title: "" }), "agent a\n");
  const hidden = withHeader("title Shop\nagent a\n", "tam", { titleShown: false });
  assert.equal(hidden, "title Shop\nagent a\n%% @title hidden\n");
  assert.equal(headerOf(hidden, "tam")?.titleShown, false);
  assert.equal(
    headerOf(withHeader("flowchart TD\n  a --> b\n", "mermaid", { titleShown: false }), "mermaid")
      ?.titleShown,
    false,
  );
  const round = withHeader("agent a\n", "tam", { rounded: true });
  assert.equal(round, "agent a\n%% @corners round\n");
  assert.equal(headerOf(round, "tam")?.rounded, true);
  assert.equal(
    headerOf(withHeader("flowchart TD\n  a --> b\n", "mermaid", { rounded: true }), "mermaid")
      ?.rounded,
    true,
  );
});

test("a level the elements break is refused with the notation's reason, and not applied", () => {
  const source = "agent a\ncomponent c\n";
  assert.match(headerRefusal(source, "tam", { level: "conceptual" }) ?? "", /design level/);
  assert.equal(headerRefusal(source, "tam", { level: "design" }), undefined);
  assert.throws(() => withHeader(source, "tam", { level: "conceptual" }));
});

test("each Mermaid type has the settings its notation has", () => {
  const has = (source: string) => headerOf(source, "mermaid")?.has;
  assert.deepEqual(has("sequenceDiagram\n  A->>B: hi\n"), {
    direction: false,
    level: true,
    numbering: true,
  });
  assert.deepEqual(has("classDiagram\n  class A\n"), {
    direction: true,
    level: true,
    numbering: false,
  });
  assert.deepEqual(has("erDiagram\n  A ||--o{ B : has\n"), {
    direction: true,
    level: false,
    numbering: false,
  });
  assert.equal(headerOf("flowchart LR\n  a --> b\n", "mermaid")?.direction, "LR");
  assert.equal(headerOf("not a diagram\n", "mermaid"), undefined);
});

test("a Mermaid header changes in place; a setting the type lacks is refused", () => {
  assert.equal(
    withHeader("flowchart TD\n  a --> b\n", "mermaid", { direction: "LR" }),
    "flowchart LR\n  a --> b\n",
  );
  const numbered = withHeader("sequenceDiagram\n  A->>B: hi\n", "mermaid", { numbered: true });
  assert.equal(headerOf(numbered, "mermaid")?.numbered, true);
  assert.match(
    headerRefusal("sequenceDiagram\n  A->>B: hi\n", "mermaid", { direction: "LR" }) ?? "",
    /no direction/,
  );
  assert.match(
    headerRefusal("erDiagram\n  A ||--o{ B : has\n", "mermaid", { level: "design" }) ?? "",
    /no TAM level/,
  );
  assert.match(
    headerRefusal("stateDiagram-v2\n  [*] --> A\n", "mermaid", { level: "design" }) ?? "",
    /conceptual level/,
  );
});

test("a connection is offered only the words its ends take", () => {
  // Two agents: channels, not accesses; an agent and a storage: accesses, not channels; a note's line: only that.
  const agents = values(TAM, 0);
  assert.ok(agents.includes("calls") && agents.includes("sends data") && !agents.includes("reads"));
  const access = values(TAM, 1);
  assert.ok(access.includes("reads") && access.includes("writes") && !access.includes("calls"));
  assert.deepEqual(values(TAM, 2), ["anchor"]);
});

test("a connection shows a protocol on a channel, both ways on a request or data flow, and reverse where it may", () => {
  const fields = (index: number) =>
    wireFields(TAM, edge(TAM, index), connectionAt(TAM, edge(TAM, index))!);
  assert.deepEqual(fields(0), {
    text: true,
    label: true,
    protocol: true,
    both: true,
    reverse: true,
  });
  // An access is written from the agent: it cannot be turned round; both ways it reads and writes.
  assert.deepEqual(fields(1), {
    text: true,
    label: true,
    protocol: false,
    both: true,
    reverse: false,
  });
  // A note's line says nothing.
  assert.deepEqual(fields(2), {
    text: false,
    label: false,
    protocol: false,
    both: false,
    reverse: true,
  });
});

test("an element is offered the palette's kinds the notation takes where it stands, and a design kind only its own", () => {
  assert.deepEqual(elementKinds(TAM, ["s"], "storage"), ["storage"]);
  assert.ok(!elementKinds(TAM, ["a"], "agent").includes("storage"));
  assert.deepEqual(elementKinds("agent a\nagent b\n", ["a", "b"], "agent"), [
    "agent",
    "human",
    "storage",
    "group",
    "note",
  ]);
  assert.deepEqual(elementKinds("component c\n", ["c"], "component"), [
    "agent",
    "human",
    "storage",
    "component",
    "group",
    "note",
  ]);
  assert.ok(!elementKinds("agent a\nagent b\n", ["a"], "agent").includes("component"));
  assert.equal(kindName("storage"), "Storage");
  assert.equal(kindName("subsystem"), "Subsystem");
});

test("only agents and storages stand for several; several elements change as one edit", () => {
  assert.match(countRefusal(TAM, ["n"], "stack") ?? "", /agents and storages/);
  assert.equal(countRefusal(TAM, ["a"], "stack"), undefined);
  assert.match(countRefusal(TAM, ["a", "n"], "several") ?? "", /agents and storages/);
  const colored = elementsWith(TAM, ["a", "b"], { color: "blue" });
  const nodes = parseTam(colored).nodes;
  assert.equal(nodes.get("a")?.color, "blue");
  assert.equal(nodes.get("b")?.color, "blue");
  assert.equal(
    shared(parseTam(colored), ["a", "b", "s"], (node) => node.color),
    undefined,
  );
});
