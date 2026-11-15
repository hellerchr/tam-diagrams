import { beforeAll, describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseUml } from "../src/index.ts";
import { ER_EXAMPLES } from "../src/samples/uml-examples.ts";
import { CARDINALITIES, type Cardinality, parseErDiagram } from "../src/uml-er.ts";
import {
  addErAttribute,
  attachEr,
  duplicateEntity,
  erAttributes,
  erRelationshipEnds,
  erRemovalSummary,
  erStructure,
  isGeneratedErId,
  joinEntities,
  removeErAttribute,
  removeErParts,
  renameEntityId,
  reverseErRelationship,
  setErAttribute,
  setErAttributes,
  setErCardinality,
  setErIdentifying,
  whyNotEr,
} from "../src/uml-er-edit.ts";

const STARTER = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ORDER-ITEM : contains
  CUSTOMER {
    int id PK
    string name
  }
  ORDER {
    int id PK
    int customerId FK
  }`;

/** Front matter, comments, blank lines, an alias, a quoted name, styling, words, tabs and blocks on one line. */
const MIXED = `---
title: Club
---
erDiagram
\tdirection LR
\t%% the people
\tp["Person"] {
\t\tuuid id PK "generated"
\t\t%% how to reach them
\t\tstring email UK
\t}

\t"Sports club" { uuid id PK
\t\tstring name }
\tm { uuid personId PK, FK }
\tEMPTY {}
\tclassDef loud fill:#f96
\tclass p,m loud
\tstyle p fill:#eee
\tp ||--o{ m : has
\t"Sports club" one or more optionally to zero or more m : "is joined by"
\tp }o..o| "Sports club" : chairs
\tm |o--o{ m
\tGUEST 1 to many p : "is invited by"`;

const SOURCES = [STARTER, MIXED, ...ER_EXAMPLES.map(([, source]) => source)];

const { read, add, connect, rename, label, relink, remove } = erStructure;
const KINDS = Object.keys(CARDINALITIES) as Cardinality[];

const ids = (source: string) => read(source).nodes.map((node) => node.id);

const joins = (source: string) =>
  read(source).edges.map(
    (edge) => `${edge.source} ${edge.kind} ${edge.target}${edge.label ? `: ${edge.label}` : ""}`,
  );

/** The lines of `before` that `after` no longer has, and the ones it has anew. */
function changed(before: string, after: string) {
  const old = before.split("\n"),
    now = after.split("\n");
  return {
    gone: old.filter((line) => !now.includes(line)),
    added: now.filter((line) => !old.includes(line)),
  };
}

const drawn = async (source: string, hint: string) => {
  const scene = await parseUml(source).layout(arialMeasure),
    { nodes, edges } = read(source);
  expect(scene.shapes.map((shape) => shape.id).toSorted(), hint).toEqual(
    nodes.map((node) => node.id).toSorted(),
  );
  expect(scene.wires.map((wire) => wire.edge).toSorted(), hint).toEqual(
    edges.map((edge) => edge.id).toSorted(),
  );
};

describe("an entity relationship diagram as a structure", () => {
  it("reads entities and relationships with their kinds", () => {
    expect(read(STARTER).nodes).toEqual([
      { id: "CUSTOMER", label: "CUSTOMER", parent: null, line: 2, group: false, kind: "entity" },
      { id: "ORDER", label: "ORDER", parent: null, line: 2, group: false, kind: "entity" },
      {
        id: "ORDER-ITEM",
        label: "ORDER-ITEM",
        parent: null,
        line: 3,
        group: false,
        kind: "entity",
      },
    ]);
    expect(read(STARTER).edges).toEqual([
      {
        id: "r1",
        source: "CUSTOMER",
        target: "ORDER",
        label: "places",
        line: 2,
        kind: "one-to-many",
      },
      {
        id: "r2",
        source: "ORDER",
        target: "ORDER-ITEM",
        label: "contains",
        line: 3,
        kind: "one-to-one-or-more",
      },
    ]);
    expect(ids(MIXED)).toEqual(["p", "Sports club", "m", "EMPTY", "GUEST"]);
    expect(read(MIXED).nodes[0]).toMatchObject({ id: "p", label: "Person" });
    expect(joins(MIXED)).toEqual([
      "p one-to-many m: has",
      "Sports club one-or-more:zero-or-more m: is joined by",
      "p zero-or-more:zero-or-one Sports club: chairs",
      "m zero-or-one-to-many m",
      "GUEST one-to-many p: is invited by",
    ]);
  });

  it("offers the entity and the usual relationships by name", () => {
    expect(erStructure.pieces.map((piece) => [piece.kind, piece.name, piece.named])).toEqual([
      ["entity", "Entity", true],
    ]);
    expect(erStructure.links.map((link) => link.name)).toEqual([
      "One to many",
      "Many to one",
      "One to one",
      "Many to many",
      "Zero or one to many",
      "One to one or more",
      "One to zero or one",
    ]);
    for (const method of ["retitle", "join", "reverse", "copy", "reid"] as const)
      expect(erStructure[method], method).toBeTypeOf("function");
  });

  it("names every part as the scene names its shape, every join as its wire", async () => {
    for (const source of SOURCES) await drawn(source, source.slice(0, 40));
  }, 60_000);

  it("adds an entity after the last one declared, named by a number or by its name", () => {
    const first = add(STARTER, { kind: "entity" });
    expect(first.id).toBe("ENTITY1");
    expect(first.source).toBe(`${STARTER}\n  ENTITY1`);
    const second = add(first.source, { kind: "entity" });
    expect(second.id).toBe("ENTITY2");
    expect(changed(STARTER, second.source)).toEqual({
      gone: [],
      added: ["  ENTITY1", "  ENTITY2"],
    });
    // Where the entities are not in capitals, neither is the new one.
    const mixed = add(MIXED, { kind: "entity" });
    expect(mixed.id).toBe("Entity1");
    expect(changed(MIXED, mixed.source)).toEqual({ gone: [], added: ["\tEntity1"] });
    expect(mixed.source.split("\n").indexOf("\tEntity1")).toBe(
      MIXED.split("\n").indexOf("\tEMPTY {}") + 1,
    );
    expect(add(STARTER, { kind: "entity", label: "Invoice" })).toEqual({
      source: `${STARTER}\n  Invoice`,
      id: "Invoice",
    });
    expect(add(STARTER, { kind: "entity", label: 'Tax "invoice"\n2024' })).toEqual({
      source: `${STARTER}\n  Tax-invoice-2024["Tax #quot;invoice#quot; 2024"]`,
      id: "Tax-invoice-2024",
    });
    expect(add(STARTER, { kind: "entity", label: "ORDER" }).id).toBe("ORDER2");
    // A source with relationships only: at its end.
    const bare = "erDiagram\n  A ||--o{ B : has\n";
    expect(add(bare, { kind: "entity" }).source).toBe("erDiagram\n  A ||--o{ B : has\n  ENTITY1\n");
    expect(add("erDiagram", { kind: "entity" })).toEqual({
      source: "erDiagram\n  Entity1",
      id: "Entity1",
    });
    expect(add(STARTER, { kind: "note" })).toEqual({ source: STARTER, id: "" });
  });

  it("connects with every kind of relationship, after the last one", () => {
    const expected: Record<string, string> = {
      "one-to-many": "||--o{",
      "many-to-one": "}o--||",
      "one-to-one": "||--||",
      "many-to-many": "}o--o{",
      "zero-or-one-to-many": "|o--o{",
      "one-to-one-or-more": "||--|{",
      "one-to-zero-or-one": "||--o|",
    };
    for (const link of erStructure.links) {
      const made = connect(STARTER, "CUSTOMER", "ORDER-ITEM", link.kind);
      expect(changed(STARTER, made), link.kind).toEqual({
        gone: [],
        added: [`  CUSTOMER ${expected[link.kind]} ORDER-ITEM : ""`],
      });
      expect(made.split("\n")[3]).toBe(`  CUSTOMER ${expected[link.kind]} ORDER-ITEM : ""`);
      expect(joins(made)[2]).toBe(`CUSTOMER ${link.kind} ORDER-ITEM`);
    }
    expect(connect(STARTER, "ORDER", "CUSTOMER")).toContain('\n  ORDER ||--o{ CUSTOMER : ""\n');
    // To itself, and between two that are joined already.
    expect(joins(connect(STARTER, "ORDER", "ORDER"))).toContain("ORDER one-to-many ORDER");
    expect(joins(connect(STARTER, "CUSTOMER", "ORDER"))).toHaveLength(3);
    expect(connect(MIXED, "Sports club", "EMPTY").split("\n").at(-1)).toBe(
      '\t"Sports club" ||--o{ EMPTY : ""',
    );
    expect(connect(STARTER, "ORDER", "Nothing")).toBe(STARTER);
    expect(connect(STARTER, "ORDER", "CUSTOMER", "inheritance")).toBe(STARTER);
    expect(connect("erDiagram\n  A\n  B\n", "A", "B")).toBe(
      'erDiagram\n  A\n  B\n  A ||--o{ B : ""\n',
    );
  });

  it("says which join it wrote, and why two parts are not joined", () => {
    expect(joinEntities(STARTER, "CUSTOMER", "ORDER-ITEM", "many-to-many")).toEqual({
      source: connect(STARTER, "CUSTOMER", "ORDER-ITEM", "many-to-many"),
      edge: "r3",
    });
    expect(erStructure.join!(MIXED, "p", "GUEST").edge).toBe("r6");
    expect(joinEntities(STARTER, "CUSTOMER", "r1")).toEqual({ source: STARTER, edge: "" });
    expect(whyNotEr(STARTER, "CUSTOMER", "ORDER")).toBeUndefined();
    expect(whyNotEr(STARTER, "ORDER", "ORDER", "one-to-one")).toBeUndefined();
    expect(whyNotEr(STARTER, "CUSTOMER", "r1")).toMatch(/two entities/);
    expect(whyNotEr(STARTER, "CUSTOMER", "ORDER", "composition")).toMatch(/no relationship/);
  });

  it("renames by an alias and keeps the id that relationships use", () => {
    expect(changed(STARTER, rename(STARTER, "ORDER", "Purchase order"))).toEqual({
      gone: ["  ORDER {"],
      added: ['  ORDER["Purchase order"] {'],
    });
    expect(changed(MIXED, rename(MIXED, "p", "Human"))).toEqual({
      gone: ['\tp["Person"] {'],
      added: ['\tp["Human"] {'],
    });
    // A name that is the id takes the alias away; an empty one too.
    expect(changed(MIXED, rename(MIXED, "p", "p")).added).toEqual(["\tp {"]);
    expect(changed(MIXED, rename(MIXED, "p", " ")).added).toEqual(["\tp {"]);
    expect(rename(STARTER, "ORDER", "ORDER")).toBe(STARTER);
    // An entity that relationships only mention gets its own statement, after the mention.
    const item = rename(STARTER, "ORDER-ITEM", "Order item");
    expect(changed(STARTER, item)).toEqual({ gone: [], added: ['  ORDER-ITEM["Order item"]'] });
    expect(item.split("\n")[3]).toBe('  ORDER-ITEM["Order item"]');
    expect(read(item).nodes.find((node) => node.id === "ORDER-ITEM")!.label).toBe("Order item");
    expect(changed(MIXED, rename(MIXED, "Sports club", 'The "club"\nof sports')).added).toEqual([
      '\t"Sports club"["The #quot;club#quot; of sports"] { uuid id PK',
    ]);
    expect(rename(STARTER, "Nothing", "x")).toBe(STARTER);
  });

  it("labels relationships, in quotes where the label is more than a word", () => {
    expect(changed(STARTER, label(STARTER, "r1", "is placed by"))).toEqual({
      gone: ["  CUSTOMER ||--o{ ORDER : places"],
      added: ['  CUSTOMER ||--o{ ORDER : "is placed by"'],
    });
    expect(changed(STARTER, label(STARTER, "r1", "orders")).added).toEqual([
      "  CUSTOMER ||--o{ ORDER : orders",
    ]);
    expect(changed(STARTER, label(STARTER, "r1", "")).added).toEqual([
      '  CUSTOMER ||--o{ ORDER : ""',
    ]);
    expect(read(label(STARTER, "r1", "")).edges[0].label).toBeUndefined();
    expect(label(label(STARTER, "r1", ""), "r1", "")).toBe(label(STARTER, "r1", ""));
    expect(label(STARTER, "r1", "places")).toBe(STARTER);
    expect(changed(MIXED, label(MIXED, "r4", "follows")).added).toEqual(["\tm |o--o{ m : follows"]);
    expect(changed(MIXED, label(MIXED, "r2", 'two\nlines "x"')).added).toEqual([
      '\t"Sports club" one or more optionally to zero or more m : "two<br>lines #quot;x#quot;"',
    ]);
    expect(read(label(MIXED, "r2", 'two\nlines "x"')).edges[1].label).toBe('two<br>lines "x"');
    expect(label(MIXED, "r2", "is joined by")).toBe(MIXED);
    expect(label(STARTER, "r9", "x")).toBe(STARTER);
  });

  it("relinks between the same ends and keeps the line and the label", () => {
    expect(changed(STARTER, relink(STARTER, "r1", "many-to-many"))).toEqual({
      gone: ["  CUSTOMER ||--o{ ORDER : places"],
      added: ["  CUSTOMER }o--o{ ORDER : places"],
    });
    expect(relink(STARTER, "r1", "one-to-many")).toBe(STARTER);
    expect(relink(STARTER, "r1", "nothing")).toBe(STARTER);
    expect(changed(MIXED, relink(MIXED, "r3", "one-to-one")).added).toEqual([
      '\tp ||..|| "Sports club" : chairs',
    ]);
    // Words stay words.
    expect(changed(MIXED, relink(MIXED, "r2", "one-to-zero-or-one")).added).toEqual([
      '\t"Sports club" only one optionally to zero or one m : "is joined by"',
    ]);
    expect(changed(MIXED, relink(MIXED, "r5", "many-to-one")).added).toEqual([
      '\tGUEST zero or more to only one p : "is invited by"',
    ]);
  });

  it("removes entities with their relationships and styling", () => {
    const without = remove(STARTER, ["ORDER"]);
    expect(without).toBe(`erDiagram
  ORDER-ITEM
  CUSTOMER {
    int id PK
    string name
  }`);
    expect(changed(MIXED, remove(MIXED, ["m"]))).toEqual({
      gone: [
        "\tm { uuid personId PK, FK }",
        "\tp ||--o{ m : has",
        '\t"Sports club" one or more optionally to zero or more m : "is joined by"',
        "\tm |o--o{ m",
      ],
      added: [],
    });
    // A styling line goes when every entity it names does.
    expect(changed(MIXED, remove(MIXED, ["p", "m"])).gone).toEqual(
      expect.arrayContaining([
        "\tclass p,m loud",
        "\tstyle p fill:#eee",
        "\t\t%% how to reach them",
      ]),
    );
    expect(ids(remove(MIXED, ["p", "m"]))).toEqual(["Sports club", "EMPTY", "GUEST"]);
    expect(remove(MIXED, ["p", "m"]).split("\n").at(-1)).toBe("\tGUEST");
    expect(remove(MIXED, ["p"])).toContain("\tclass p,m loud");
  });

  it("removes relationships and keeps the entities they joined", () => {
    expect(remove(STARTER, ["r2"])).toBe(
      STARTER.replace("ORDER ||--|{ ORDER-ITEM : contains", "ORDER-ITEM"),
    );
    expect(changed(STARTER, remove(STARTER, ["r1"]))).toEqual({
      gone: ["  CUSTOMER ||--o{ ORDER : places"],
      added: [],
    });
    expect(ids(remove(MIXED, ["r5"]))).toEqual(ids(MIXED));
    expect(remove(STARTER, [])).toBe(STARTER);
    expect(remove(STARTER, ["nothing"])).toBe(STARTER);
  });

  it("leaves a source the parser reads, whatever is removed or changed", () => {
    for (const source of SOURCES) {
      const { nodes, edges } = read(source);
      for (const part of [...nodes, ...edges]) {
        const without = remove(source, [part.id]);
        expect(() => parseUml(without), `${part.id}\n${without}`).not.toThrow();
      }
      for (const node of nodes) {
        expect(ids(remove(source, [node.id])).toSorted(), node.id).toEqual(
          nodes
            .map((other) => other.id)
            .filter((id) => id !== node.id)
            .toSorted(),
        );
        const renamed = rename(source, node.id, 'New "name" <1>');
        expect(read(renamed).nodes.find((other) => other.id === node.id)!.label).toBe(
          'New "name" <1>',
        );
        expect(joins(renamed)).toEqual(joins(source));
        expect(erAttributes(addErAttribute(source, node.id, "int added FK"), node.id)).toEqual([
          ...erAttributes(source, node.id),
          "int added FK",
        ]);
        const only = setErAttributes(source, node.id, ["int only PK"]);
        expect(parseErDiagram(only).entities.get(node.id)!.attributes).toMatchObject([
          { type: "int", name: "only", keys: ["PK"] },
        ]);
        expect(
          parseErDiagram(setErAttributes(source, node.id, [])).entities.get(node.id),
        ).toMatchObject({
          label: node.label,
          attributes: [],
        });
        const copy = duplicateEntity(source, node.id);
        expect(ids(copy.source)).toContain(copy.id);
        expect(erAttributes(copy.source, copy.id)).toEqual(erAttributes(source, node.id));
        expect(joins(copy.source)).toEqual(joins(source));
      }
      for (const edge of edges) {
        expect(
          read(label(source, edge.id, "a: <b>")).edges.find((item) => item.id === edge.id)!.label,
        ).toBe("a: <b>");
        for (const link of erStructure.links)
          expect(
            read(relink(source, edge.id, link.kind)).edges.find((item) => item.id === edge.id),
            `${edge.id} ${link.kind}`,
          ).toMatchObject({ kind: link.kind, source: edge.source, target: edge.target });
        const turned = reverseErRelationship(source, edge.id);
        expect(read(turned).edges.find((item) => item.id === edge.id)).toMatchObject({
          source: edge.target,
          target: edge.source,
          label: edge.label,
        });
        expect(reverseErRelationship(turned, edge.id)).toBe(source.replace(/\r\n?/g, "\n"));
      }
      expect(() =>
        parseUml(add(source, { kind: "entity", label: "New one" }).source),
      ).not.toThrow();
    }
  });
});

describe("the attributes of an entity", () => {
  it("lists them as the source writes them", () => {
    expect(erAttributes(STARTER, "CUSTOMER")).toEqual(["int id PK", "string name"]);
    expect(erAttributes(STARTER, "ORDER-ITEM")).toEqual([]);
    expect(erAttributes(STARTER, "Nothing")).toEqual([]);
    expect(erAttributes(MIXED, "p")).toEqual(['uuid id PK "generated"', "string email UK"]);
    expect(erAttributes(MIXED, "Sports club")).toEqual(["uuid id PK", "string name"]);
    expect(erAttributes(MIXED, "m")).toEqual(["uuid personId PK, FK"]);
    expect(erAttributes(MIXED, "EMPTY")).toEqual([]);
  });

  it("adds an attribute to a block, opening one where there is none", () => {
    expect(changed(STARTER, addErAttribute(STARTER, "CUSTOMER", " string email UK \n"))).toEqual({
      gone: [],
      added: ["    string email UK"],
    });
    expect(addErAttribute(STARTER, "CUSTOMER", "string email UK").split("\n").slice(3, 8)).toEqual([
      "  CUSTOMER {",
      "    int id PK",
      "    string name",
      "    string email UK",
      "  }",
    ]);
    // An entity that relationships only mention is declared after its first mention.
    expect(
      addErAttribute(STARTER, "ORDER-ITEM", "int position PK").split("\n").slice(2, 6),
    ).toEqual([
      "  ORDER ||--|{ ORDER-ITEM : contains",
      "  ORDER-ITEM {",
      "    int position PK",
      "  }",
    ]);
    // Blocks on one line open over lines of their own, in the indentation of the source.
    expect(changed(MIXED, addErAttribute(MIXED, "m", "date since"))).toEqual({
      gone: ["\tm { uuid personId PK, FK }"],
      added: ["\tm {", "\t\tuuid personId PK, FK", "\t\tdate since"],
    });
    expect(changed(MIXED, addErAttribute(MIXED, "EMPTY", "int id"))).toEqual({
      gone: ["\tEMPTY {}"],
      added: ["\tEMPTY {", "\t\tint id"],
    });
    expect(changed(MIXED, addErAttribute(MIXED, "Sports club", "date founded"))).toEqual({
      gone: ['\t"Sports club" { uuid id PK', "\t\tstring name }"],
      added: ['\t"Sports club" {', "\t\tuuid id PK", "\t\tstring name", "\t\tdate founded"],
    });
    expect(addErAttribute(STARTER, "CUSTOMER", "  ")).toBe(STARTER);
    expect(addErAttribute(STARTER, "Nothing", "int id")).toBe(STARTER);
  });

  it("replaces the attributes and keeps comments", () => {
    expect(changed(MIXED, setErAttributes(MIXED, "p", ["uuid id PK", "string name", " "]))).toEqual(
      {
        gone: ['\t\tuuid id PK "generated"', "\t\tstring email UK"],
        added: ["\t\tuuid id PK", "\t\tstring name"],
      },
    );
    expect(setErAttributes(MIXED, "p", ["int a"])).toContain(
      '\tp["Person"] {\n\t\t%% how to reach them\n\t\tint a\n\t}',
    );
    expect(setErAttributes(STARTER, "CUSTOMER", ["int id PK", "string name"])).toBe(STARTER);
    expect(setErAttributes(STARTER, "ORDER-ITEM", [])).toBe(STARTER);
    // Without attributes an empty block goes.
    expect(changed(STARTER, setErAttributes(STARTER, "ORDER", []))).toEqual({
      gone: ["  ORDER {", "    int customerId FK"],
      added: ["  ORDER"],
    });
    expect(setErAttributes(STARTER, "ORDER", [])).toBe(
      STARTER.split("\n").slice(0, 7).join("\n") + "\n  ORDER",
    );
    expect(setErAttributes(MIXED, "p", [])).toContain(
      '\tp["Person"] {\n\t\t%% how to reach them\n\t}',
    );
    expect(setErAttributes(MIXED, "m", [])).toContain("\n\tm\n");
  });

  it("edits and removes one attribute where it stands", () => {
    expect(changed(STARTER, setErAttribute(STARTER, "ORDER", 1, "int customer FK"))).toEqual({
      gone: ["    int customerId FK"],
      added: ["    int customer FK"],
    });
    expect(setErAttribute(STARTER, "ORDER", 1, "int customerId FK")).toBe(STARTER);
    expect(setErAttribute(STARTER, "ORDER", 1, "onlyOneWord")).toBe(STARTER);
    expect(setErAttribute(STARTER, "ORDER", 7, "int x")).toBe(STARTER);
    expect(erAttributes(setErAttribute(STARTER, "ORDER", 0, ""), "ORDER")).toEqual([
      "int customerId FK",
    ]);
    expect(setErAttribute(STARTER, "ORDER", 0, "").split("\n")).toHaveLength(
      STARTER.split("\n").length - 1,
    );
    expect(changed(STARTER, removeErAttribute(STARTER, "CUSTOMER", 1))).toEqual({
      gone: ["    string name"],
      added: [],
    });
    expect(changed(MIXED, removeErAttribute(MIXED, "m", 0))).toEqual({
      gone: ["\tm { uuid personId PK, FK }"],
      added: ["\tm"],
    });
    expect(
      erAttributes(setErAttribute(MIXED, "Sports club", 1, "string title"), "Sports club"),
    ).toEqual(["uuid id PK", "string title"]);
    expect(removeErAttribute(STARTER, "CUSTOMER", 5)).toBe(STARTER);
  });
});

describe("the ends of a relationship", () => {
  it("reads the cardinality of each end and whether the relationship identifies", () => {
    expect(erRelationshipEnds(STARTER, "r1")).toEqual({
      from: "CUSTOMER",
      to: "ORDER",
      fromCardinality: "only-one",
      toCardinality: "zero-or-more",
      identifying: true,
    });
    expect(erRelationshipEnds(MIXED, "r2")).toEqual({
      from: "Sports club",
      to: "m",
      fromCardinality: "one-or-more",
      toCardinality: "zero-or-more",
      identifying: false,
    });
    expect(erRelationshipEnds(STARTER, "r9")).toBeUndefined();
    expect(erRelationshipEnds(STARTER, "ORDER")).toBeUndefined();
  });

  it("sets each end by itself, as a symbol or in words as the source has it", () => {
    const left = {
        "only-one": "||",
        "zero-or-one": "|o",
        "one-or-more": "}|",
        "zero-or-more": "}o",
      },
      right = { "only-one": "||", "zero-or-one": "o|", "one-or-more": "|{", "zero-or-more": "o{" };
    for (const kind of KINDS) {
      const from = setErCardinality(STARTER, "r1", "from", kind),
        to = setErCardinality(STARTER, "r1", "to", kind);
      expect(from.split("\n")[1]).toBe(`  CUSTOMER ${left[kind]}--o{ ORDER : places`);
      expect(to.split("\n")[1]).toBe(`  CUSTOMER ||--${right[kind]} ORDER : places`);
      expect(erRelationshipEnds(from, "r1")).toMatchObject({
        fromCardinality: kind,
        toCardinality: "zero-or-more",
      });
      expect(erRelationshipEnds(to, "r1")).toMatchObject({
        fromCardinality: "only-one",
        toCardinality: kind,
      });
      expect(changed(STARTER, from).gone.length).toBeLessThanOrEqual(1);
    }
    expect(setErCardinality(STARTER, "r1", "from", "only-one")).toBe(STARTER);
    expect(setErCardinality(STARTER, "r9", "from", "only-one")).toBe(STARTER);
    expect(setErCardinality(STARTER, "r1", "to", "lots" as Cardinality)).toBe(STARTER);
    expect(changed(MIXED, setErCardinality(MIXED, "r2", "to", "only-one")).added).toEqual([
      '\t"Sports club" one or more optionally to only one m : "is joined by"',
    ]);
    expect(changed(MIXED, setErCardinality(MIXED, "r5", "from", "zero-or-one")).added).toEqual([
      '\tGUEST zero or one to many p : "is invited by"',
    ]);
    expect(changed(MIXED, setErCardinality(MIXED, "r4", "to", "one-or-more")).added).toEqual([
      "\tm |o--|{ m",
    ]);
  });

  it("makes a relationship identifying or not", () => {
    expect(changed(STARTER, setErIdentifying(STARTER, "r1", false))).toEqual({
      gone: ["  CUSTOMER ||--o{ ORDER : places"],
      added: ["  CUSTOMER ||..o{ ORDER : places"],
    });
    expect(setErIdentifying(STARTER, "r1", true)).toBe(STARTER);
    expect(setErIdentifying(setErIdentifying(STARTER, "r1", false), "r1", true)).toBe(STARTER);
    expect(changed(MIXED, setErIdentifying(MIXED, "r2", true)).added).toEqual([
      '\t"Sports club" one or more to zero or more m : "is joined by"',
    ]);
    expect(changed(MIXED, setErIdentifying(MIXED, "r5", false)).added).toEqual([
      '\tGUEST 1 optionally to many p : "is invited by"',
    ]);
    expect(erRelationshipEnds(setErIdentifying(MIXED, "r3", true), "r3")!.identifying).toBe(true);
    expect(setErIdentifying(STARTER, "r9", false)).toBe(STARTER);
  });

  it("turns a relationship round, each cardinality with its entity", () => {
    expect(changed(STARTER, reverseErRelationship(STARTER, "r1"))).toEqual({
      gone: ["  CUSTOMER ||--o{ ORDER : places"],
      added: ["  ORDER }o--|| CUSTOMER : places"],
    });
    expect(changed(MIXED, reverseErRelationship(MIXED, "r3")).added).toEqual([
      '\t"Sports club" |o..o{ p : chairs',
    ]);
    expect(changed(MIXED, reverseErRelationship(MIXED, "r5")).added).toEqual([
      '\tp many to 1 GUEST : "is invited by"',
    ]);
    expect(reverseErRelationship(STARTER, "r9")).toBe(STARTER);
  });
});

describe("the ids of an entity relationship diagram", () => {
  const { retitle, reid, copy } = erStructure;

  it("gives a new entity its first name as its id", async () => {
    const added = add(STARTER, { kind: "entity" });
    expect(isGeneratedErId(added.source, added.id)).toBe(true);
    expect(retitle!(added.source, added.id, "INVOICE")).toEqual({
      source: `${STARTER}\n  INVOICE`,
      id: "INVOICE",
    });
    expect(retitle!(added.source, added.id, "Tax invoice")).toEqual({
      source: `${STARTER}\n  Tax-invoice["Tax invoice"]`,
      id: "Tax-invoice",
    });
    // A name another entity goes by stays an alias.
    expect(retitle!(added.source, added.id, "ORDER")).toEqual({
      source: `${STARTER}\n  ENTITY1["ORDER"]`,
      id: "ENTITY1",
    });
    expect(retitle!(added.source, added.id, "???")).toEqual({
      source: `${STARTER}\n  ENTITY1["???"]`,
      id: "ENTITY1",
    });
    // With a relationship already drawn to it, the id changes there too.
    const joined = attachEr(STARTER, { kind: "entity" }, "ORDER", "one-to-many");
    expect(joined).toMatchObject({ id: "ENTITY1", edge: "r3" });
    expect(changed(STARTER, joined.source).added).toEqual([
      '  ORDER ||--o{ ENTITY1 : ""',
      "  ENTITY1",
    ]);
    const named = retitle!(joined.source, "ENTITY1", "SHIPMENT");
    expect(changed(STARTER, named.source).added).toEqual([
      '  ORDER ||--o{ SHIPMENT : ""',
      "  SHIPMENT",
    ]);
    await drawn(named.source, "named");
  });

  it("knows a made-up id", () => {
    expect(isGeneratedErId(STARTER, "ORDER")).toBe(false);
    expect(isGeneratedErId(STARTER, "Nothing")).toBe(false);
    expect(isGeneratedErId(add(MIXED, { kind: "entity" }).source, "Entity1")).toBe(true);
    const twin = copy!(STARTER, "ORDER");
    expect(twin.id).toBe("ORDER2");
    expect(isGeneratedErId(twin.source, "ORDER2")).toBe(true);
    expect(isGeneratedErId(rename(twin.source, "ORDER2", "Returns"), "ORDER2")).toBe(false);
  });

  it("renames an entity wherever the source names it", async () => {
    expect(changed(STARTER, reid!(STARTER, "ORDER", "PURCHASE"))).toEqual({
      gone: [
        "  CUSTOMER ||--o{ ORDER : places",
        "  ORDER ||--|{ ORDER-ITEM : contains",
        "  ORDER {",
      ],
      added: [
        "  CUSTOMER ||--o{ PURCHASE : places",
        "  PURCHASE ||--|{ ORDER-ITEM : contains",
        "  PURCHASE {",
      ],
    });
    expect(changed(MIXED, reid!(MIXED, "p", "person"))).toEqual({
      gone: [
        '\tp["Person"] {',
        "\tclass p,m loud",
        "\tstyle p fill:#eee",
        "\tp ||--o{ m : has",
        '\tp }o..o| "Sports club" : chairs',
        '\tGUEST 1 to many p : "is invited by"',
      ],
      added: [
        '\tperson["Person"] {',
        "\tclass person,m loud",
        "\tstyle person fill:#eee",
        "\tperson ||--o{ m : has",
        '\tperson }o..o| "Sports club" : chairs',
        '\tGUEST 1 to many person : "is invited by"',
      ],
    });
    // An alias that says what the new id says goes; a name of several words stands in quotes.
    expect(changed(MIXED, reid!(MIXED, "p", "Person")).added[0]).toBe("\tPerson {");
    expect(changed(MIXED, reid!(MIXED, "m", "Club member")).added).toEqual([
      '\t"Club member" { uuid personId PK, FK }',
      '\tclass p,"Club member" loud',
      '\tp ||--o{ "Club member" : has',
      '\t"Sports club" one or more optionally to zero or more "Club member" : "is joined by"',
      '\t"Club member" |o--o{ "Club member"',
    ]);
    expect(changed(MIXED, reid!(MIXED, "Sports club", "CLUB")).added).toEqual([
      "\tCLUB { uuid id PK",
      '\tCLUB one or more optionally to zero or more m : "is joined by"',
      "\tp }o..o| CLUB : chairs",
    ]);
    for (const taken of ["CUSTOMER", "ORDER", "", "  ", 'a"b'])
      expect(renameEntityId(STARTER, "ORDER", taken), taken).toBe(STARTER);
    // A word of the syntax is a name in quotes.
    for (const word of ["style", "direction", "one", "to", "many", "u", "1st"])
      expect(changed(STARTER, renameEntityId(STARTER, "ORDER", word)).added, word).toEqual([
        `  CUSTOMER ||--o{ "${word}" : places`,
        `  "${word}" ||--|{ ORDER-ITEM : contains`,
        `  "${word}" {`,
      ]);
    expect(renameEntityId(STARTER, "Nothing", "X")).toBe(STARTER);
    for (const source of SOURCES)
      for (const node of read(source).nodes) {
        const renamed = reid!(source, node.id, "Renamed one");
        expect(ids(renamed), node.id).toEqual(
          ids(source).map((id) => (id === node.id ? "Renamed one" : id)),
        );
        expect(joins(renamed).length).toBe(joins(source).length);
        expect(reid!(renamed, "Renamed one", node.id)).toBe(source.replace(/\r\n?/g, "\n"));
      }
    await drawn(reid!(MIXED, "m", "Club member"), "quoted");
  });

  it("copies an entity with its alias and attributes, without its relationships", async () => {
    const twin = copy!(STARTER, "CUSTOMER");
    expect(twin.id).toBe("CUSTOMER2");
    expect(changed(STARTER, twin.source)).toEqual({ gone: [], added: ["  CUSTOMER2 {"] });
    expect(twin.source.split("\n").slice(3, 11)).toEqual([
      "  CUSTOMER {",
      "    int id PK",
      "    string name",
      "  }",
      "  CUSTOMER2 {",
      "    int id PK",
      "    string name",
      "  }",
    ]);
    expect(joins(twin.source)).toEqual(joins(STARTER));
    const person = copy!(MIXED, "p");
    expect(person.id).toBe("p2");
    expect(read(person.source).nodes.find((node) => node.id === "p2")!.label).toBe("Person");
    expect(erAttributes(person.source, "p2")).toEqual(erAttributes(MIXED, "p"));
    const item = copy!(STARTER, "ORDER-ITEM");
    expect(item.id).toBe("ORDER-ITEM2");
    expect(changed(STARTER, item.source).added).toEqual(["  ORDER-ITEM", "  ORDER-ITEM2"]);
    expect(copy!(MIXED, "Sports club").id).toBe("Sports-club");
    expect(copy!(STARTER, "r1")).toEqual({ source: STARTER, id: "" });
    await drawn(person.source, "copy");
  });
});

describe("what else a canvas does with an entity relationship diagram", () => {
  it("adds an entity at a part and says what it wrote", async () => {
    expect(attachEr(STARTER, { kind: "entity" }, "ORDER")).toEqual({
      ...add(STARTER, { kind: "entity" }),
      edge: "",
    });
    expect(attachEr(STARTER, { kind: "entity" }, "Nothing", "one-to-many")).toEqual({
      ...add(STARTER, { kind: "entity" }),
      edge: "",
    });
    expect(attachEr(STARTER, { kind: "note" }, "ORDER")).toEqual({
      source: STARTER,
      id: "",
      edge: "",
    });
    for (const [name, source] of ER_EXAMPLES) {
      const [host] = read(source).nodes;
      for (const link of erStructure.links) {
        const made = attachEr(source, { kind: "entity", label: "New one" }, host.id, link.kind),
          hint = `${name} ${link.kind}`,
          now = read(made.source);
        expect(changed(source, made.source).gone, hint).toEqual([]);
        expect(
          now.nodes.find((node) => node.id === made.id),
          hint,
        ).toMatchObject({
          kind: "entity",
          label: "New one",
        });
        expect(
          now.edges.find((edge) => edge.id === made.edge),
          hint,
        ).toMatchObject({
          source: host.id,
          target: made.id,
          kind: link.kind,
        });
      }
      await drawn(attachEr(source, { kind: "entity" }, host.id, "one-to-many").source, name);
    }
  }, 60_000);

  it("says what a removal takes with it", () => {
    expect(erRemovalSummary(STARTER, ["ORDER"])).toBe("ORDER with 2 relationships");
    expect(erRemovalSummary(STARTER, ["ORDER-ITEM"])).toBe("ORDER-ITEM with 1 relationship");
    expect(erRemovalSummary(STARTER, ["CUSTOMER", "ORDER", "r1"])).toBe(
      "CUSTOMER, ORDER with 1 relationship",
    );
    expect(erRemovalSummary(MIXED, ["p"])).toBe("Person with 3 relationships");
    expect(erRemovalSummary(MIXED, ["EMPTY"])).toBe("EMPTY");
    expect(erRemovalSummary(STARTER, ["r1", "r2"])).toBe("2 relationships");
    expect(erRemovalSummary(STARTER, ["r1"])).toBe("1 relationship");
    expect(erRemovalSummary(STARTER, ["nothing"])).toBe("");
  });
});

describe("what the edits write", () => {
  let mermaid: typeof import("mermaid").default;
  beforeAll(async () => {
    mermaid = (await import("mermaid")).default;
  }, 60_000);

  it("is valid Mermaid, for every edit of every example", async () => {
    for (const [name, source] of [["starter", STARTER], ...ER_EXAMPLES]) {
      const { nodes, edges } = read(source),
        [first] = nodes,
        last = nodes.at(-1)!,
        [edge] = edges,
        added = add(source, { kind: "entity" });
      const results: Record<string, string> = {
        add: added.source,
        named: erStructure.retitle!(added.source, added.id, 'Tax "invoice" <2024>').source,
        connect: connect(source, first.id, last.id),
        loop: connect(source, first.id, first.id, "zero-or-one-to-many"),
        attach: attachEr(source, { kind: "entity", label: "to" }, first.id, "many-to-many").source,
        rename: rename(source, first.id, 'A "new" name\nin <two> lines'),
        label: label(source, edge.id, 'says "this": and <that>\non two lines'),
        unlabel: label(source, edge.id, ""),
        relink: relink(source, edge.id, "one-to-zero-or-one"),
        reverse: reverseErRelationship(source, edge.id),
        cardinality: setErCardinality(source, edge.id, "from", "one-or-more"),
        line: setErIdentifying(source, edge.id, !erRelationshipEnds(source, edge.id)!.identifying),
        reid: renameEntityId(source, first.id, "Two words"),
        word: renameEntityId(source, last.id, "one"),
        attributes: setErAttributes(source, last.id, [
          'uuid id PK, FK "a } comment"',
          "string[] tags",
        ]),
        none: setErAttributes(source, first.id, []),
        copy: duplicateEntity(source, first.id).source,
        remove: remove(source, [first.id]),
        cut: remove(source, [edge.id]),
      };
      for (const [what, result] of Object.entries(results)) {
        await expect(mermaid.parse(result), `${name} ${what}\n${result}`).resolves.toBeTruthy();
        expect(() => parseUml(result), `${name} ${what}`).not.toThrow();
      }
    }
  }, 60_000);
});
