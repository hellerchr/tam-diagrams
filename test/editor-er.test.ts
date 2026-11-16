// The source pane and the panels for entity relationship diagrams: colors, indentation, completion.
import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { parseUml } from "../src/index.ts";
import { completeSource, declarationLines, idsOf } from "../editor/completion-uml.ts";
import { syntaxRows, thumbOf } from "../editor/dialogs.ts";
import { ICONS } from "../editor/icons.ts";
import { linkIcon, pieceIcon, structureOf } from "../editor/structures.ts";
import { freeText, indentChange, pastClosers, scanSource } from "../editor/syntax.ts";
import { typeInfo, typeOf, TYPES } from "../editor/types.ts";

/** The tokens of the last line of a source, as `text:tag`. */
const tokens = (source: string) =>
  scanSource("er", source)
    .lines.at(-1)!
    .map((token) => `${token.text}:${token.tag}`);

const options = (text: string, explicit = false) => {
  const state = EditorState.create({ doc: text });
  return (
    completeSource(new CompletionContext(state, text.length, explicit), typeOf(text), [])
      ?.options ?? []
  );
};

/** The labels offered at the end of a text, best first. */
const offered = (text: string, explicit = false) =>
  options(text, explicit)
    .toSorted((a, b) => (b.boost ?? 0) - (a.boost ?? 0))
    .map((item) => item.label);

const source = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  p["Person"] {
    int id PK
  }
  "Sports club" }o..|| p : "is run by"
`;

describe("the type of an entity relationship diagram in the editor", () => {
  it("is one of the types, edited on the canvas, with a starter and examples that draw", () => {
    const info = typeInfo("er");
    expect(TYPES.map((item) => item.type)).toContain("er");
    expect(info).toMatchObject({ name: "ER diagram", icon: "er", mode: "structure" });
    expect(typeOf(info.starter)).toBe("er");
    expect(info.examples.length).toBeGreaterThanOrEqual(5);
    for (const [, example] of [
      ["starter", info.starter],
      ["thumb", thumbOf(info)],
      ...info.examples,
    ])
      expect(() => parseUml(example)).not.toThrow();
    expect(() => parseUml(syntaxRows("er").join("\n"))).not.toThrow();
    for (const snippet of info.snippets)
      expect(() => parseUml(`erDiagram\n${snippet.text}`), snippet.name).not.toThrow();
  });

  it("shows only valid Mermaid: the starter, the card, the syntax sheet and the snippets", async () => {
    const mermaid = (await import("mermaid")).default,
      info = typeInfo("er");
    for (const text of [
      info.starter,
      thumbOf(info),
      syntaxRows("er").join("\n"),
      ...info.snippets.map((snippet) => `erDiagram\n${snippet.text}`),
    ])
      await expect(mermaid.parse(text), text).resolves.toBeTruthy();
  }, 60_000);

  it("draws its pieces and its relationships in the palette", () => {
    const structure = structureOf("er")!;
    expect(structure.pieces.map((piece) => pieceIcon(piece.kind))).toEqual(["uml-entity"]);
    const icons = structure.links.map((link) => linkIcon(link.kind));
    expect(icons).toEqual([
      "er-one-to-many",
      "er-many-to-one",
      "er-one-to-one",
      "er-many-to-many",
      "er-zero-or-one-to-many",
      "er-one-to-one-or-more",
      "er-one-to-zero-or-one",
    ]);
    // Each is a drawing of its own.
    expect(new Set(icons.map((name) => ICONS[name])).size).toBe(icons.length);
    for (const name of ["uml-entity", "er", ...icons] as const)
      expect(ICONS[name]).toContain("<svg");
  });
});

describe("the tokenizer of an entity relationship diagram", () => {
  it("colors entities, aliases and relationships", () => {
    expect(tokens("erDiagram")).toEqual(["erDiagram:keyword"]);
    expect(tokens("erDiagram\n  direction LR")).toEqual(["direction:keyword", "LR:atom"]);
    expect(tokens("erDiagram\nCUSTOMER")).toEqual(["CUSTOMER:variableName.definition"]);
    expect(tokens('erDiagram\np["Person"]:::loud {')).toEqual([
      "p:variableName.definition",
      '["Person"]:string',
      ":::loud:atom",
      "{:punctuation",
    ]);
    expect(tokens("erDiagram\nCUSTOMER ||--o{ LINE-ITEM : places orders")).toEqual([
      "CUSTOMER:variableName",
      "||:operator",
      "--:operator",
      "o{:operator",
      "LINE-ITEM:variableName",
      "::punctuation",
      "places orders:string",
    ]);
    expect(tokens('erDiagram\n"Sports club"}o..o|p')).toEqual([
      '"Sports club":variableName',
      "}o:operator",
      "..:operator",
      "o|:operator",
      "p:variableName",
    ]);
    expect(tokens("erDiagram\nCAR one or more optionally to many(0) one : x")).toEqual([
      "CAR:variableName",
      "one or more:operator",
      "optionally to:operator",
      "many(0):operator",
      "one:variableName",
      "::punctuation",
      "x:string",
    ]);
    expect(tokens("erDiagram\n%% @CUSTOMER 10,20")).toEqual(["%% @CUSTOMER 10,20:comment"]);
    expect(tokens("erDiagram\nstyle CUSTOMER fill:#eee")[0]).toBe("style:keyword");
  });

  it("colors the attributes of a block: type, name, keys and comment", () => {
    const head = "erDiagram\nCUSTOMER {\n";
    expect(tokens(`${head}  int id PK, FK "the key"`)).toEqual([
      "int:typeName",
      "id:propertyName",
      "PK:modifier",
      ",:punctuation",
      "FK:modifier",
      '"the key":string',
    ]);
    expect(tokens(`${head}  varchar(255) name`)).toEqual([
      "varchar(255):typeName",
      "name:propertyName",
    ]);
    // A type or a name that reads like a key is none.
    expect(tokens(`${head}  PK FK UK`)).toEqual(["PK:typeName", "FK:propertyName", "UK:modifier"]);
    expect(tokens(`${head}  int id\n}`)).toEqual(["}:punctuation"]);
    const { state } = scanSource("er", `${head}  int id`);
    expect(state).toMatchObject({ body: true, blocks: ["entity"] });
    expect(scanSource("er", `${head}  int id\n}\nA`).state).toMatchObject({
      body: false,
      blocks: [],
    });
    expect(scanSource("er", "erDiagram\nA { int id }").state).toMatchObject({
      body: false,
      blocks: [],
    });
  });

  it("indents the lines of a block and knows free text", () => {
    expect(indentChange("er", "CUSTOMER {", "")).toBe(1);
    expect(indentChange("er", "int id PK", "}")).toBe(-1);
    expect(indentChange("er", "CUSTOMER ||--o{ ORDER : places", "")).toBe(0);
    expect(freeText("er", "erDiagram\n", "  A ||--o{ B : pla")).toBe(true);
    expect(freeText("er", "erDiagram\n", "  A ||--o{ B")).toBe(false);
    expect(pastClosers("er", "CUSTOMER {}", 10)).toBeUndefined();
  });
});

describe("completing an entity relationship diagram", () => {
  it("finds the entities in the text, with their aliases and where they are declared", () => {
    expect(idsOf("er", source)).toEqual([
      { id: "CUSTOMER", kind: "uml-class", label: "" },
      { id: "ORDER", kind: "uml-class", label: "" },
      { id: "p", kind: "uml-class", label: "Person" },
      { id: "Sports club", kind: "uml-class", label: "" },
    ]);
    expect([...declarationLines("er", source)]).toEqual([
      ["CUSTOMER", 2],
      ["ORDER", 2],
      ["p", 3],
      ["Sports club", 6],
    ]);
    expect(declarationLines("er", `${source}  ORDER {\n  }`).get("ORDER")).toBe(7);
  });

  it("offers the header, and statements and entities at the start of a line", () => {
    expect(offered("er")).toContain("erDiagram");
    expect(offered(`${source}  `)).toEqual([]);
    expect(offered(`${source}  `, true)).toEqual([
      "entity",
      "entity with alias",
      "relationship",
      "direction",
      "CUSTOMER",
      "ORDER",
      "p",
      "Sports club",
    ]);
    expect(offered(`${source}  d`)).toContain("direction");
    expect(offered(`${source}  direction `)).toEqual(["TB", "LR"]);
    // A name of several words is written in quotes.
    const club = options(`${source}  S`).find((item) => item.label === "Sports club")!;
    expect(club.apply).toBe('"Sports club"');
    expect(options(`${source}  `, true).find((item) => item.label === "p")).toMatchObject({
      detail: "Person",
    });
  });

  it("offers the relationships after an entity, and the entities after a relationship", () => {
    expect(offered(`${source}  CUSTOMER `).slice(0, 5)).toEqual([
      "||--o{",
      "||--|{",
      "}o--||",
      "}|--||",
      "||--||",
    ]);
    expect(offered(`${source}  CUSTOMER |`)).toContain("||..o{");
    expect(offered(`${source}  "Sports club" }`)).toContain("}o--o{");
    expect(options(`${source}  CUSTOMER `)[0]).toMatchObject({
      type: "connection",
      apply: "||--o{ ",
    });
    expect(offered(`${source}  CUSTOMER ||--`)).toEqual(["o{", "|{", "||", "o|"]);
    expect(offered(`${source}  CUSTOMER ||--o{ `)).toEqual([
      "CUSTOMER",
      "ORDER",
      "p",
      "Sports club",
    ]);
    expect(offered(`${source}  CUSTOMER }o..|| O`)).toContain("ORDER");
    expect(offered(`${source}  CUSTOMER ||--o{ ORDER : `)).toEqual([]);
    expect(offered(`${source}  style `)).toEqual([]);
  });

  it("offers types, then keys, inside the block of an entity", () => {
    const inside = `${source}  ORDER {\n    `;
    expect(offered(inside)).toEqual([]);
    expect(offered(inside, true).slice(0, 4)).toEqual(["string", "int", "decimal", "float"]);
    expect(offered(inside, true)).toEqual(
      expect.arrayContaining(["uuid", "attribute", "primary key", "foreign key"]),
    );
    expect(offered(`${inside}da`)).toEqual(expect.arrayContaining(["date", "datetime"]));
    expect(offered(`${inside}int id `, true)).toEqual(["PK", "FK", "UK"]);
    expect(offered(`${inside}int id P`)).toEqual(["PK", "FK", "UK"]);
    expect(offered(`${inside}int id PK, `)).toEqual(["PK", "FK", "UK"]);
    expect(offered(`${inside}int id `)).toEqual([]);
    expect(offered(`${inside}int `)).toEqual([]);
    expect(offered(`${inside}int id PK "a comm`)).toEqual([]);
  });
});
