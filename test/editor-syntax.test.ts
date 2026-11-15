import { describe, expect, it } from "vitest";
import { TAM_EXAMPLES } from "../src/samples/tam-examples.ts";
import {
  CLASS_EXAMPLES,
  ER_EXAMPLES,
  FLOWCHART_EXAMPLES,
  SEQUENCE_EXAMPLES,
  STATE_EXAMPLES,
  SWIMLANE_EXAMPLES,
  USECASE_EXAMPLES,
} from "../src/samples/uml-examples.ts";
import { indentChange, scanSource } from "../editor/syntax.ts";
import type { DiagramType } from "../editor/types.ts";

const EXAMPLES: [DiagramType, [string, string][]][] = [
  ["tam", TAM_EXAMPLES],
  ["class", CLASS_EXAMPLES],
  ["usecase", USECASE_EXAMPLES],
  ["flowchart", FLOWCHART_EXAMPLES],
  ["swimlane", SWIMLANE_EXAMPLES],
  ["state", STATE_EXAMPLES],
  ["sequence", SEQUENCE_EXAMPLES],
  ["er", ER_EXAMPLES],
];

/** The tokens of the last line of a source, as `text:tag`. */
const tokens = (type: DiagramType, source: string) =>
  scanSource(type, source)
    .lines.at(-1)!
    .map((token) => `${token.text}:${token.tag}`);

/** The texts of a source that have a tag. */
const tagged = (type: DiagramType, source: string, tag: string) =>
  scanSource(type, source)
    .lines.flat()
    .filter((token) => token.tag === tag)
    .map((token) => token.text);

describe("the tokenizers of the source pane", () => {
  it.each(EXAMPLES)("read every %s example to its end", (type, examples) => {
    expect(examples.length).toBeGreaterThan(0);
    for (const [name, source] of examples) {
      const { lines, state } = scanSource(type, source);
      expect(lines.length, name).toBe(source.split("\n").length);
      // Tokens lie inside their lines, in order, and no block is left open.
      source.split("\n").forEach((text, index) => {
        let end = 0;
        for (const token of lines[index]) {
          expect(token.from, name).toBeGreaterThanOrEqual(end);
          expect(token.to, name).toBeGreaterThan(token.from);
          end = token.to;
        }
        expect(end, name).toBeLessThanOrEqual(text.length);
      });
      if (type !== "tam" && !/^(error|variant)/.test(name)) {
        expect(state.blocks, name).toEqual([]);
        expect(state.header, name).toBe(true);
        expect(state.body || state.prose || state.directive, name).toBeFalsy();
      }
    }
  });

  it("colors a block diagram", () => {
    expect(tokens("tam", "agent api[Order API]:::blue @40,60 { %% note")).toEqual([
      "agent:keyword",
      "api:variableName",
      "[Order API]:string",
      ":::blue:atom",
      "@40,60:number",
      "{:punctuation",
      "%% note:comment",
    ]);
    expect(tokens("tam", "api -- reads/writes --> db")).toEqual([
      "api:variableName",
      "--:operator",
      "reads/writes:typeName",
      "-->:operator",
      "db:variableName",
    ]);
    expect(tokens("tam", "title Order system")).toEqual(["title:keyword", "Order system:string"]);
  });

  it("colors frontmatter, comments and directives of every Mermaid type", () => {
    const source = "---\ntitle: Orders\nconfig: x\n---\n%% a comment\n%%{init: {}}%%\nclassDiagram";
    const { lines } = scanSource("class", source);
    expect(lines.map((line) => line.map((token) => `${token.text}:${token.tag}`))).toEqual([
      ["---:meta"],
      ["title:keyword", "::punctuation", "Orders:string"],
      ["config:propertyName", "::punctuation", "x:string"],
      ["---:meta"],
      ["%% a comment:comment"],
      ["%%{init: {}}%%:meta"],
      ["classDiagram:keyword"],
    ]);
    // A directive of several lines, and a description for screen readers.
    expect(
      tagged("state", "stateDiagram-v2\n%%{init: {\n'theme': 'base'\n}}%%\nA --> B", "meta"),
    ).toHaveLength(3);
    expect(
      tagged("flowchart", "flowchart LR\naccDescr {\nA picture\n}\na --> b", "string"),
    ).toEqual(["{", "A picture", "}"]);
  });

  it("colors a class diagram", () => {
    const head = "classDiagram\n";
    expect(tokens("class", `${head}class Shape["A shape"]:::big <<interface>> {`)).toEqual([
      "class:keyword",
      "Shape:variableName.definition",
      '["A shape"]:string',
      ":::big:atom",
      "<<interface>>:annotation",
      "{:punctuation",
    ]);
    expect(tokens("class", `${head}class Order {\n  +total(tax: number, n) number$`)).toEqual([
      "+:modifier",
      "total:propertyName",
      "(:punctuation",
      "tax:variableName",
      "::punctuation",
      "number:typeName",
      ",:punctuation",
      "n:variableName",
      "):punctuation",
      "number:typeName",
      "$:modifier",
    ]);
    expect(tokens("class", `${head}class Order {\n  <<service>>\n  -id: List~string~\n}`)).toEqual([
      "}:punctuation",
    ]);
    expect(tagged("class", `${head}class Order {\n  -id: List~string~\n}`, "typeName")).toEqual([
      "List",
      "string",
    ]);
    expect(tokens("class", `${head}Customer "1" o-- "*" Order : places`)).toEqual([
      "Customer:variableName",
      '"1":number',
      "o--:operator",
      '"*":number',
      "Order:variableName",
      "::punctuation",
      "places:string",
    ]);
    for (const relation of [
      "<|--",
      "*--",
      "o--",
      "-->",
      "--",
      "..>",
      "..|>",
      "<|..",
      "()--",
      "--()",
    ])
      expect(tokens("class", `${head}A ${relation} B`), relation).toEqual([
        "A:variableName",
        `${relation}:operator`,
        "B:variableName",
      ]);
    expect(tokens("class", `${head}Order : +total() number`)).toEqual([
      "Order:variableName",
      "::punctuation",
      "+:modifier",
      "total:propertyName",
      "(:punctuation",
      "):punctuation",
      "number:typeName",
    ]);
    expect(tokens("class", `${head}namespace shop.core {`)).toEqual([
      "namespace:keyword",
      "shop.core:variableName.definition",
      "{:punctuation",
    ]);
    expect(tokens("class", `${head}note for Order "kept forever"`)).toEqual([
      "note:keyword",
      "for:keyword",
      "Order:variableName",
      '"kept forever":string',
    ]);
    expect(tokens("class", `${head}direction LR`)).toEqual(["direction:keyword", "LR:atom"]);
  });

  it("colors a use case diagram", () => {
    const head = "usecase-beta\n";
    expect(tokens("usecase", `${head}actor User, svc("Purchasing Service") <<system>>`)).toEqual([
      "actor:keyword",
      "User:variableName.definition",
      ",:punctuation",
      "svc:variableName.definition",
      '("Purchasing Service"):string',
      "<<system>>:annotation",
    ]);
    expect(tokens("usecase", `${head}systemBoundary shop[Web Shop]`)).toEqual([
      "systemBoundary:keyword",
      "shop:variableName.definition",
      "[Web Shop]:string",
    ]);
    expect(tokens("usecase", `${head}create ..> : include approve`)).toEqual([
      "create:variableName",
      "..>:operator",
      "::punctuation",
      "include:keyword",
      "approve:variableName",
    ]);
    expect(tokens("usecase", `${head}Member -- pays --> checkout`)).toEqual([
      "Member:variableName",
      "--:operator",
      "pays:string",
      "-->:operator",
      "checkout:variableName",
    ]);
    expect(tokens("usecase", `${head}order --|> x`)).toEqual([
      "order:variableName",
      "--|>:operator",
      "x:variableName",
    ]);
    expect(tokens("usecase", `${head}systemBoundary s[S]\n  browse(Browse)\nend`)).toEqual([
      "end:keyword",
    ]);
  });

  it("colors a flowchart and an activity with lanes", () => {
    expect(tokens("flowchart", "flowchart LR")).toEqual(["flowchart:keyword", "LR:atom"]);
    expect(tokens("swimlane", "swimlane-beta TB")).toEqual(["swimlane-beta:keyword", "TB:atom"]);
    const head = "flowchart TB\n";
    expect(tokens("flowchart", `${head}start((Start)) --> check{In stock?}`)).toEqual([
      "start:variableName",
      "((Start)):string",
      "-->:operator",
      "check:variableName",
      "{In stock?}:string",
    ]);
    expect(tokens("flowchart", `${head}check -->|yes| ship[Ship order]:::done & x`)).toEqual([
      "check:variableName",
      "-->:operator",
      "|yes|:string",
      "ship:variableName",
      "[Ship order]:string",
      ":::done:atom",
      "&:punctuation",
      "x:variableName",
    ]);
    expect(tokens("flowchart", `${head}a -. dotted label .-> b == thick ==> c`)).toEqual([
      "a:variableName",
      "-.:operator",
      "dotted label:string",
      ".->:operator",
      "b:variableName",
      "==:operator",
      "thick:string",
      "==>:operator",
      "c:variableName",
    ]);
    for (const edge of ["-->", "---", "-.->", "==>", "--o", "--x", "<-->", "o--o", "~~~"])
      expect(tokens("flowchart", `${head}x ${edge} ox`), edge).toEqual([
        "x:variableName",
        `${edge}:operator`,
        "ox:variableName",
      ]);
    for (const shape of [
      "[a]",
      "(a)",
      "([a])",
      "[[a]]",
      "[(a)]",
      "((a))",
      "(((a)))",
      "{a}",
      "{{a}}",
    ])
      expect(tokens("flowchart", `${head}n${shape}`), shape).toEqual([
        "n:variableName",
        `${shape}:string`,
      ]);
    expect(
      tokens("flowchart", `${head}i[/Lean/] --> j[\\Left\\] --> m>Flag] --> q["a ] b"]`),
    ).toEqual([
      "i:variableName",
      "[/Lean/]:string",
      "-->:operator",
      "j:variableName",
      "[\\Left\\]:string",
      "-->:operator",
      "m:variableName",
      ">Flag]:string",
      "-->:operator",
      "q:variableName",
      '["a ] b"]:string',
    ]);
    expect(tokens("flowchart", `${head}subgraph cloud [The cloud]`)).toEqual([
      "subgraph:keyword",
      "cloud:variableName.definition",
      "[The cloud]:string",
    ]);
    expect(
      tokens("swimlane", `swimlane-beta\nsubgraph Customer Service\n  a(Ask) --> b(Answer)\nend`),
    ).toEqual(["end:keyword"]);
    expect(
      tagged("swimlane", "swimlane-beta\nsubgraph Customer Service", "variableName.definition"),
    ).toEqual(["Customer Service"]);
  });

  it("colors a state machine", () => {
    const head = "stateDiagram-v2\n";
    expect(tokens("state", `${head}state "Waiting for payment" as Waiting {`)).toEqual([
      "state:keyword",
      '"Waiting for payment":string',
      "as:keyword",
      "Waiting:variableName.definition",
      "{:punctuation",
    ]);
    expect(tokens("state", `${head}[*] --> Draft : submit [ok] / notify`)).toEqual([
      "[*]:atom",
      "-->:operator",
      "Draft:variableName",
      "::punctuation",
      "submit [ok] / notify:string",
    ]);
    expect(tokens("state", `${head}state pick <<choice>>`)).toEqual([
      "state:keyword",
      "pick:variableName.definition",
      "<<choice>>:annotation",
    ]);
    expect(tokens("state", `${head}note right of Draft : not sent yet`)).toEqual([
      "note:keyword",
      "right of:keyword",
      "Draft:variableName",
      "::punctuation",
      "not sent yet:string",
    ]);
    expect(
      scanSource("state", `${head}note left of Draft\n  two\n  lines\nend note\nDraft --> [*]`)
        .lines.slice(2)
        .map((line) => line.map((token) => `${token.text}:${token.tag}`)),
    ).toEqual([
      ["two:string"],
      ["lines:string"],
      ["end note:keyword"],
      ["Draft:variableName", "-->:operator", "[*]:atom"],
    ]);
    expect(tokens("state", `${head}Waiting : entry / start timer`)).toEqual([
      "Waiting:variableName",
      "::punctuation",
      "entry / start timer:string",
    ]);
  });

  it("colors a sequence diagram", () => {
    const head = "sequenceDiagram\n";
    expect(tokens("sequence", `${head}participant U as The User`)).toEqual([
      "participant:keyword",
      "U:variableName.definition",
      "as:keyword",
      "The User:string",
    ]);
    expect(tokens("sequence", `${head}create actor B`)).toEqual([
      "create actor:keyword",
      "B:variableName.definition",
    ]);
    expect(tokens("sequence", `${head}Alice->>+John: Is it ok?`)).toEqual([
      "Alice:variableName",
      "->>:operator",
      "+:modifier",
      "John:variableName",
      "::punctuation",
      "Is it ok?:string",
    ]);
    for (const arrow of ["->>", "-->>", "-)", "--)", "-x", "--x", "->", "-->", "<<->>", "<<-->>"])
      expect(tokens("sequence", `${head}A${arrow}B: text`).slice(0, 3), arrow).toEqual([
        "A:variableName",
        `${arrow}:operator`,
        "B:variableName",
      ]);
    expect(tokens("sequence", `${head}alt is sick`)).toEqual(["alt:keyword", "is sick:string"]);
    expect(tokens("sequence", `${head}rect rgb(191, 223, 255)`)).toEqual([
      "rect:keyword",
      "rgb(191, 223, 255):atom",
    ]);
    expect(tokens("sequence", `${head}box Purple Frontend`)).toEqual([
      "box:keyword",
      "Purple:atom",
      "Frontend:string",
    ]);
    expect(tokens("sequence", `${head}Note over A,B: they agree`)).toEqual([
      "Note:keyword",
      "over:keyword",
      "A:variableName",
      ",:punctuation",
      "B:variableName",
      "::punctuation",
      "they agree:string",
    ]);
    expect(tokens("sequence", `${head}autonumber 10 5`)).toEqual([
      "autonumber:keyword",
      "10:number",
      "5:number",
    ]);
    // The blocks that are open at the end: what the completion offers inside them.
    expect(
      scanSource("sequence", `${head}par one\n  alt x\n  end\n  critical y`).state.blocks,
    ).toEqual(["par", "critical"]);
  });

  it("moves on whatever a line holds", () => {
    const junk = '}}} ::: <<x --> ((( [[ "a |x| -. .-> end ; & @{ : ~~ o--o \\ ) ]';
    for (const [type] of EXAMPLES)
      for (const source of [junk, `x\n${junk}`, `class A {\n${junk}`, `---\n${junk}`])
        expect(() => scanSource(type, source)).not.toThrow();
  });
});

describe("the indentation of the source pane", () => {
  it("steps in after a line that opens a block and out at one that closes it", () => {
    expect(indentChange("tam", "agent shop[Web Shop] {", "")).toBe(1);
    expect(indentChange("tam", "agent api[API]", "}")).toBe(-1);
    expect(indentChange("class", "class Order {", "}")).toBe(0);
    expect(indentChange("class", "+id: string", "+total()")).toBe(0);
    expect(indentChange("state", "state Active {", "")).toBe(1);
    expect(indentChange("state", "note left of A", "")).toBe(1);
    expect(indentChange("state", "note left of A : text", "")).toBe(0);
    expect(indentChange("state", "lines", "end note")).toBe(-1);
    expect(indentChange("flowchart", "subgraph one [One]", "")).toBe(1);
    expect(indentChange("flowchart", "check{In stock?}", "")).toBe(0);
    expect(indentChange("swimlane", "a --> b", "end")).toBe(-1);
    expect(indentChange("flowchart", "a --> b", "endpoint --> b")).toBe(0);
    expect(indentChange("usecase", "systemBoundary shop[Shop]", "")).toBe(1);
    expect(indentChange("usecase", "browse(Browse)", "end")).toBe(-1);
    expect(indentChange("sequence", "alt is sick", "")).toBe(1);
    expect(indentChange("sequence", "A->>B: x", "else is well")).toBe(-1);
    expect(indentChange("sequence", "else is well", "")).toBe(1);
    expect(indentChange("sequence", "box Frontend", "end")).toBe(0);
    expect(indentChange("sequence", "alt->>B: a message", "")).toBe(0);
    expect(indentChange("sequence", "A->>B: x", "and ->> B: a message")).toBe(0);
  });
});
