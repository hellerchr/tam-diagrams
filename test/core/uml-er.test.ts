// Entity relationship diagrams: parsing with its errors, the crow's-foot symbols, and the source edits.
import { test } from "vitest";
import assert from "node:assert/strict";
import { markerSvg } from "../../src/markers.ts";
import { UmlError } from "../../src/uml.ts";
import {
  type Cardinality,
  CARDINALITIES,
  parseAttributes,
  parseErDiagram,
  relationshipParts,
} from "../../src/uml-er.ts";
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
  renameEntityId,
  reverseErRelationship,
  setErAttribute,
  setErAttributes,
  setErCardinality,
  setErIdentifying,
  whyNotEr,
} from "../../src/uml-er-edit.ts";

const KINDS: Cardinality[] = ["only-one", "zero-or-one", "one-or-more", "zero-or-more"];

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

/** The structure edits: read, add, connect, rename, retitle, label, relink, remove. */
const S = erStructure;

const ids = (source: string) => S.read(source).nodes.map((node) => node.id);

/** The error parsing `source` throws. */
function error(source: string): UmlError {
  try {
    parseErDiagram(source);
  } catch (reason) {
    assert.ok(reason instanceof UmlError);
    return reason;
  }
  throw new Error("parsed");
}

/** The lines `after` drops from `before` (`-`), then the ones it adds (`+`); asserts `after` parses. */
function diff(before: string, after: string): string[] {
  parseErDiagram(after);
  const old = before.split("\n"),
    now = after.split("\n");
  return [
    ...old.filter((line) => !now.includes(line)).map((line) => `-${line}`),
    ...now.filter((line) => !old.includes(line)).map((line) => `+${line}`),
  ];
}

test("reads the title from front matter or a statement, and the direction", () => {
  const titled = parseErDiagram("---\ntitle: Shop\n---\nerDiagram\n  direction LR\n  CUSTOMER");
  assert.partialDeepStrictEqual(titled, { title: "Shop", direction: "LR" });
  assert.equal(parseErDiagram("erDiagram\n  title Order system\n  A").title, "Order system");
  assert.equal(
    parseErDiagram("---\ntitle: Shop\n---\nerDiagram\n  title Other\n  A").title,
    "Shop",
  );
  assert.deepEqual(
    [...parseErDiagram("erDiagram\n  title-page\n  1st\n  a.b").entities.keys()],
    ["title-page", "1st", "a.b"],
  );
  assert.equal(parseErDiagram("erDiagram\n  direction td").direction, "TB");
});

test("reads entities alone, with aliases, in quotes and with hyphens", () => {
  const diagram = parseErDiagram(
    'erDiagram\n  CUSTOMER\n  p["Person"]\n  q[Plain alias]\n  LINE-ITEM\n  "Sports club"\n  "Sports club" ||--o{ p : "is joined by"\n  Größe_1',
  );
  assert.deepEqual(
    [...diagram.entities.values()].map((entity) => `${entity.id}=${entity.label}`),
    [
      "CUSTOMER=CUSTOMER",
      "p=Person",
      "q=Plain alias",
      "LINE-ITEM=LINE-ITEM",
      "Sports club=Sports club",
      "Größe_1=Größe_1",
    ],
  );
  assert.partialDeepStrictEqual(diagram.relationships[0], { source: "Sports club", target: "p" });
});

test("reads attribute blocks: type, name, keys and comment, also on one line", () => {
  const diagram = parseErDiagram(`erDiagram
  CUSTOMER {
    int id PK "generated"
    int orderId PK, FK "both"
    varchar(255) note "with } a brace"
    list~string~ aliases
  }
  ONE { int id PK }
  TWO { string a
    string b }
  NONE {}
  CUSTOMER {
    date born
  }`);
  const columns = (name: string) =>
    diagram.entities
      .get(name)
      ?.attributes.map(({ type, name, keys, comment }) => [type, name, keys.join(), comment]);
  assert.deepEqual(columns("CUSTOMER"), [
    ["int", "id", "PK", "generated"],
    ["int", "orderId", "PK,FK", "both"],
    ["varchar(255)", "note", "", "with } a brace"],
    ["list<string>", "aliases", "", undefined],
    ["date", "born", "", undefined],
  ]);
  assert.equal(diagram.entities.get("CUSTOMER")?.attributes[1]?.line, 4);
  assert.deepEqual(columns("ONE"), [["int", "id", "PK", undefined]]);
  assert.deepEqual(columns("TWO")?.length, 2);
  assert.deepEqual(columns("NONE"), []);
  const several = parseAttributes('int id PK string name "the name" date born FK, UK', 3);
  assert.equal(
    several.map(({ name, keys, comment }) => `${name} ${keys.join()} ${comment}`).join("; "),
    "id PK undefined; name  the name; born FK,UK undefined",
  );
});

test("reads every cardinality symbol on both sides, identifying and not", () => {
  const lines: Record<string, boolean> = { "--": true, "..": false, ".-": false };
  for (const left of KINDS)
    for (const right of KINDS)
      for (const [line, identifying] of Object.entries(lines)) {
        const text = `A ${CARDINALITIES[left].left}${line}${CARDINALITIES[right].right} B : rel`;
        const expected = {
          source: "A",
          target: "B",
          sourceCardinality: left,
          targetCardinality: right,
          identifying,
        };
        const [relationship] = parseErDiagram(`erDiagram\n  ${text}`).relationships;
        assert.partialDeepStrictEqual(relationship, { ...expected, label: "rel" }, text);
        // With the symbols the other way round, as Mermaid reads them, and no space but one.
        const mirrored = `erDiagram\nA ${CARDINALITIES[left].right}${line}${CARDINALITIES[right].left}B:rel`;
        assert.partialDeepStrictEqual(parseErDiagram(mirrored).relationships[0], expected, text);
      }
});

test("reads the cardinalities and the line in words", () => {
  for (const kind of KINDS)
    for (const word of CARDINALITIES[kind].words) {
      const [relationship] = parseErDiagram(
        `erDiagram\n  CAR ${word} to ${word} NAMED-DRIVER : allows`,
      ).relationships;
      const expected = {
        source: "CAR",
        sourceCardinality: kind,
        targetCardinality: kind,
        identifying: true,
      };
      assert.partialDeepStrictEqual(relationship, expected, word);
    }
  const optional = parseErDiagram("erDiagram\n  PERSON many(0) optionally to 0+ NAMED-DRIVER : is")
    .relationships[0];
  assert.partialDeepStrictEqual(optional, {
    sourceCardinality: "zero-or-more",
    targetCardinality: "zero-or-more",
    identifying: false,
  });
  // Words are words: a name that starts with one is a name.
  assert.equal(relationshipParts("A one to oneB"), null);
  const named = parseErDiagram("erDiagram\n  one ||--|| many : to").relationships[0];
  assert.partialDeepStrictEqual(named, { source: "one", target: "many", label: "to" });
});

test("reads labels, quoted or not, and says where each piece of a relationship stands", () => {
  const diagram = parseErDiagram(
    'erDiagram\n  A ||--o{ B : places\n  A ||--o{ B : "is placed by"\n  A ||--o{ B\n  A ||--o{ A : "a: colon"\n  A ||--o{ B : ""\n  A ||--o{ B : two words',
  );
  assert.deepEqual(
    diagram.relationships.map((relationship) => `${relationship.id} ${relationship.label}`),
    ["r1 places", "r2 is placed by", "r3 undefined", "r4 a: colon", "r5 undefined", "r6 two words"],
  );
  assert.partialDeepStrictEqual(diagram.relationships[3], { source: "A", target: "A", line: 5 });
  assert.deepEqual(relationshipParts('"A b" }o..|| C-D : "x y"'), {
    left: { text: '"A b"', start: 0 },
    leftCardinality: { text: "}o", start: 6, kind: "zero-or-more" },
    line: { text: "..", start: 8, identifying: false },
    rightCardinality: { text: "||", start: 10, kind: "only-one" },
    right: { text: "C-D", start: 13 },
    label: { text: '"x y"', start: 19 },
  });
  assert.equal(relationshipParts("A -- B"), null);
  assert.equal(relationshipParts("A ||--|| B extra"), null);
});

test("ignores comments, styling and accessibility statements", () => {
  const diagram = parseErDiagram(`%% a comment first
erDiagram
  accTitle: Shop
  accDescr {
    Customers and
    their orders
  }
  classDef important fill:#f96
  CUSTOMER:::important
  ORDER["An order"]:::important, other {
    int id
    %% between attributes
  }
  class CUSTOMER important
  style ORDER fill:#eee
  link-table ||--o{ ORDER : has`);
  assert.deepEqual([...diagram.entities.keys()], ["CUSTOMER", "ORDER", "link-table"]);
  assert.equal(diagram.entities.get("ORDER")?.label, "An order");
  assert.equal(diagram.entities.get("ORDER")?.attributes.length, 1);
});

test("reports errors with their lines", () => {
  assert.equal(error("classDiagram\n  A").line, 1);
  assert.match(error("erDiagram\n  A ||--o{").message, /^Line 2: Cannot read `A \|\|--o\{`/);
  assert.match(error("erDiagram\n  A -- B").message, /cardinality at each end/);
  assert.equal(error("erDiagram\n\n  A {\n    string\n  }").line, 4);
  assert.match(error("erDiagram\n  A {\n    string name PK,\n  }").message, /comma between/);
  assert.match(
    error("erDiagram\n  A {\n    string name").message,
    /^Line 2: Entity `A` is missing its closing `}`/,
  );
  assert.match(error("erDiagram\n  }").message, /Unmatched/);
  assert.match(error("erDiagram\n  A { int id } more").message, /ends its line/);
  assert.match(error("erDiagram\n  A ||--o{ B :").message, /label follows/);
  assert.match(error("erDiagram LR").message, /after `erDiagram`/);
  assert.equal(error("erDiagram\n  A u--o{ B : x").unsupported, true);
  const many = Array.from({ length: 201 }, (_, index) => `  E${index}`).join("\n");
  assert.match(error(`erDiagram\n${many}`).message, /limited to 200 entities/);
});

test("draws bars, rings and feet for the four cardinalities, turning with the wire", () => {
  const svg = (kind: Cardinality) =>
    markerSvg(kind, { x: 100, y: 50 }, { x: 1, y: 0 }, "#000", "#fff");
  const strokes = (kind: Cardinality) => svg(kind).match(/M/g)?.length;
  assert.equal(strokes("only-one"), 2);
  assert.ok(!svg("only-one").includes("<circle"));
  assert.equal(strokes("zero-or-one"), 1);
  assert.ok(svg("zero-or-one").includes('<circle cx="84.5" cy="50" r="4" fill="#fff"'));
  // The foot spreads to the entity's outline on both sides of the wire.
  assert.ok(svg("one-or-more").includes("M100 56.5L88 50L100 43.5"));
  assert.ok(svg("zero-or-more").includes("<circle"));
  assert.ok(
    markerSvg("only-one", { x: 10, y: 80 }, { x: 0, y: 1 }, "#000", "#fff").includes(
      "M3.5 74L16.5 74",
    ),
  );
});

test("reads entities and relationships with their kinds, and offers the usual ones by name", () => {
  assert.partialDeepStrictEqual(S.read(STARTER).nodes[2], {
    id: "ORDER-ITEM",
    line: 3,
    group: false,
    kind: "entity",
  });
  const [edge] = S.read(STARTER).edges;
  assert.deepEqual(edge, {
    id: "r1",
    source: "CUSTOMER",
    target: "ORDER",
    label: "places",
    line: 2,
    kind: "one-to-many",
  });
  assert.deepEqual(ids(MIXED), ["p", "Sports club", "m", "EMPTY", "GUEST"]);
  const kinds = S.read(MIXED).edges.map((item) => item.kind);
  assert.equal(
    kinds.join(" "),
    "one-to-many one-or-more:zero-or-more zero-or-more:zero-or-one zero-or-one-to-many one-to-many",
  );
  assert.equal(S.pieces.map((piece) => piece.kind).join(), "entity");
  assert.equal(
    S.links.map((link) => link.name).join(", "),
    "One to many, Many to one, One to one, Many to many, Zero or one to many, One to one or more, One to zero or one",
  );
});

test("adds an entity after the last one declared, named by a number or by its name", () => {
  assert.deepEqual(S.add(STARTER, { kind: "entity" }), {
    source: `${STARTER}\n  ENTITY1`,
    id: "ENTITY1",
  });
  // Where the entities are not in capitals, neither is the new one.
  const mixed = S.add(MIXED, { kind: "entity" });
  assert.equal(mixed.id, "Entity1");
  assert.equal(
    mixed.source.split("\n").indexOf("\tEntity1"),
    MIXED.split("\n").indexOf("\tEMPTY {}") + 1,
  );
  const tax = S.add(STARTER, { kind: "entity", label: 'Tax "invoice"\n2024' });
  assert.deepEqual(diff(STARTER, tax.source), [
    '+  Tax-invoice-2024["Tax #quot;invoice#quot; 2024"]',
  ]);
  assert.equal(S.add(STARTER, { kind: "entity", label: "ORDER" }).id, "ORDER2");
  assert.deepEqual(S.add(STARTER, { kind: "note" }), { source: STARTER, id: "" });
});

test("connects with every kind of relationship, says which join it wrote and why not", () => {
  const symbols = ["||--o{", "}o--||", "||--||", "}o--o{", "|o--o{", "||--|{", "||--o|"];
  S.links.forEach((link, index) => {
    const made = S.connect(STARTER, "CUSTOMER", "ORDER-ITEM", link.kind);
    assert.deepEqual(diff(STARTER, made), [`+  CUSTOMER ${symbols[index]} ORDER-ITEM : ""`]);
    assert.equal(S.read(made).edges[2]?.kind, link.kind);
  });
  assert.equal(
    S.connect(MIXED, "Sports club", "EMPTY").split("\n").at(-1),
    '\t"Sports club" ||--o{ EMPTY : ""',
  );
  assert.equal(joinEntities(MIXED, "p", "GUEST").edge, "r6");
  assert.deepEqual(joinEntities(STARTER, "CUSTOMER", "r1"), { source: STARTER, edge: "" });
  assert.equal(whyNotEr(STARTER, "ORDER", "ORDER", "one-to-one"), undefined);
  assert.match(whyNotEr(STARTER, "CUSTOMER", "r1") ?? "", /two entities/);
  assert.match(whyNotEr(STARTER, "CUSTOMER", "ORDER", "composition") ?? "", /no relationship/);
});

test("renames by an alias and labels relationships, in quotes where needed", () => {
  assert.deepEqual(diff(STARTER, S.rename(STARTER, "ORDER", "Purchase order")), [
    "-  ORDER {",
    '+  ORDER["Purchase order"] {',
  ]);
  assert.deepEqual(diff(MIXED, S.rename(MIXED, "p", "p")), ['-\tp["Person"] {', "+\tp {"]);
  // An entity that relationships only mention gets its own statement, after the mention.
  assert.equal(
    S.rename(STARTER, "ORDER-ITEM", "Order item").split("\n")[3],
    '  ORDER-ITEM["Order item"]',
  );
  assert.equal(
    diff(STARTER, S.label(STARTER, "r1", "is placed by"))[1],
    '+  CUSTOMER ||--o{ ORDER : "is placed by"',
  );
  assert.equal(diff(STARTER, S.label(STARTER, "r1", ""))[1], '+  CUSTOMER ||--o{ ORDER : ""');
  assert.equal(diff(MIXED, S.label(MIXED, "r4", "follows"))[1], "+\tm |o--o{ m : follows");
  assert.equal(S.read(S.label(MIXED, "r2", 'two\nlines "x"')).edges[1]?.label, 'two<br>lines "x"');
});

test("relinks between the same ends, words staying words", () => {
  assert.equal(
    diff(STARTER, S.relink(STARTER, "r1", "many-to-many"))[1],
    "+  CUSTOMER }o--o{ ORDER : places",
  );
  assert.equal(
    diff(MIXED, S.relink(MIXED, "r3", "one-to-one"))[1],
    '+\tp ||..|| "Sports club" : chairs',
  );
  assert.equal(
    diff(MIXED, S.relink(MIXED, "r5", "many-to-one"))[1],
    '+\tGUEST zero or more to only one p : "is invited by"',
  );
  assert.equal(S.relink(STARTER, "r1", "nothing"), STARTER);
});

test("removes entities with their relationships and styling, and relationships alone", () => {
  assert.equal(
    S.remove(STARTER, ["ORDER"]),
    "erDiagram\n  ORDER-ITEM\n  CUSTOMER {\n    int id PK\n    string name\n  }",
  );
  const both = diff(MIXED, S.remove(MIXED, ["p", "m"]));
  for (const line of ["-\tclass p,m loud", "-\tstyle p fill:#eee", "-\t\t%% how to reach them"])
    assert.ok(both.includes(line), line);
  assert.ok(S.remove(MIXED, ["p"]).includes("\tclass p,m loud"));
  assert.equal(
    S.remove(STARTER, ["r2"]),
    STARTER.replace("ORDER ||--|{ ORDER-ITEM : contains", "ORDER-ITEM"),
  );
  assert.deepEqual(ids(S.remove(MIXED, ["r5"])), ids(MIXED));
});

test("lists, adds and replaces attributes, opening blocks written on one line", () => {
  assert.deepEqual(erAttributes(MIXED, "p"), ['uuid id PK "generated"', "string email UK"]);
  assert.deepEqual(erAttributes(MIXED, "Sports club"), ["uuid id PK", "string name"]);
  assert.deepEqual(diff(STARTER, addErAttribute(STARTER, "CUSTOMER", " string email UK \n")), [
    "+    string email UK",
  ]);
  const item = addErAttribute(STARTER, "ORDER-ITEM", "int position PK");
  assert.ok(
    item.includes(
      "  ORDER ||--|{ ORDER-ITEM : contains\n  ORDER-ITEM {\n    int position PK\n  }\n",
    ),
  );
  assert.deepEqual(diff(MIXED, addErAttribute(MIXED, "Sports club", "date founded")), [
    '-\t"Sports club" { uuid id PK',
    "-\t\tstring name }",
    '+\t"Sports club" {',
    "+\t\tuuid id PK",
    "+\t\tstring name",
    "+\t\tdate founded",
  ]);
  assert.ok(
    setErAttributes(MIXED, "p", ["int a"]).includes(
      '\tp["Person"] {\n\t\t%% how to reach them\n\t\tint a\n\t}',
    ),
  );
  // Without attributes an empty block goes.
  assert.deepEqual(diff(STARTER, setErAttributes(STARTER, "ORDER", [])), [
    "-  ORDER {",
    "-    int customerId FK",
    "+  ORDER",
  ]);
});

test("edits and removes one attribute where it stands", () => {
  assert.deepEqual(diff(STARTER, setErAttribute(STARTER, "ORDER", 1, "int customer FK")), [
    "-    int customerId FK",
    "+    int customer FK",
  ]);
  assert.equal(setErAttribute(STARTER, "ORDER", 1, "onlyOneWord"), STARTER);
  assert.deepEqual(erAttributes(setErAttribute(STARTER, "ORDER", 0, ""), "ORDER"), [
    "int customerId FK",
  ]);
  assert.deepEqual(diff(MIXED, removeErAttribute(MIXED, "m", 0)), [
    "-\tm { uuid personId PK, FK }",
    "+\tm",
  ]);
  assert.equal(removeErAttribute(STARTER, "CUSTOMER", 5), STARTER);
});

test("reads and sets the ends of a relationship, and whether it identifies", () => {
  const ends = {
    from: "Sports club",
    fromCardinality: "one-or-more",
    toCardinality: "zero-or-more",
    identifying: false,
  };
  assert.partialDeepStrictEqual(erRelationshipEnds(MIXED, "r2"), ends);
  assert.equal(erRelationshipEnds(STARTER, "ORDER"), undefined);
  assert.equal(
    setErCardinality(STARTER, "r1", "from", "zero-or-one").split("\n")[1],
    "  CUSTOMER |o--o{ ORDER : places",
  );
  assert.equal(
    setErCardinality(STARTER, "r1", "to", "one-or-more").split("\n")[1],
    "  CUSTOMER ||--|{ ORDER : places",
  );
  const words = diff(MIXED, setErCardinality(MIXED, "r5", "from", "zero-or-one"));
  assert.equal(words[1], '+\tGUEST zero or one to many p : "is invited by"');
  assert.equal(
    diff(STARTER, setErIdentifying(STARTER, "r1", false))[1],
    "+  CUSTOMER ||..o{ ORDER : places",
  );
  assert.equal(
    diff(MIXED, setErIdentifying(MIXED, "r5", false))[1],
    '+\tGUEST 1 optionally to many p : "is invited by"',
  );
  assert.equal(setErIdentifying(STARTER, "r1", true), STARTER);
});

test("turns a relationship round, each cardinality with its entity", () => {
  assert.equal(
    diff(STARTER, reverseErRelationship(STARTER, "r1"))[1],
    "+  ORDER }o--|| CUSTOMER : places",
  );
  assert.equal(
    diff(MIXED, reverseErRelationship(MIXED, "r5"))[1],
    '+\tp many to 1 GUEST : "is invited by"',
  );
  assert.equal(reverseErRelationship(reverseErRelationship(MIXED, "r3"), "r3"), MIXED);
});

test("gives a new entity its first name as its id, also where a relationship names it", () => {
  const added = S.add(STARTER, { kind: "entity" });
  assert.ok(isGeneratedErId(added.source, added.id));
  const tax = S.retitle!(added.source, added.id, "Tax invoice");
  assert.deepEqual(tax, { source: `${STARTER}\n  Tax-invoice["Tax invoice"]`, id: "Tax-invoice" });
  assert.deepEqual(S.retitle!(added.source, added.id, "ORDER"), {
    source: `${STARTER}\n  ENTITY1["ORDER"]`,
    id: "ENTITY1",
  });
  const joined = attachEr(STARTER, { kind: "entity" }, "ORDER", "one-to-many");
  assert.equal(joined.edge, "r3");
  const named = S.retitle!(joined.source, "ENTITY1", "SHIPMENT");
  assert.deepEqual(diff(STARTER, named.source), ['+  ORDER ||--o{ SHIPMENT : ""', "+  SHIPMENT"]);
  assert.equal(isGeneratedErId(named.source, "SHIPMENT"), false);
  const lone = attachEr(STARTER, { kind: "entity" }, "Nothing", "one-to-many");
  assert.deepEqual(lone, { ...S.add(STARTER, { kind: "entity" }), edge: "" });
});

test("renames an entity wherever the source names it, in quotes where needed", () => {
  assert.deepEqual(diff(MIXED, renameEntityId(MIXED, "p", "person")).slice(6), [
    '+\tperson["Person"] {',
    "+\tclass person,m loud",
    "+\tstyle person fill:#eee",
    "+\tperson ||--o{ m : has",
    '+\tperson }o..o| "Sports club" : chairs',
    '+\tGUEST 1 to many person : "is invited by"',
  ]);
  // An alias that says what the new id says goes.
  assert.equal(diff(MIXED, renameEntityId(MIXED, "p", "Person"))[6], "+\tPerson {");
  const club = diff(MIXED, renameEntityId(MIXED, "Sports club", "CLUB"));
  assert.deepEqual(club.slice(3), [
    "+\tCLUB { uuid id PK",
    '+\tCLUB one or more optionally to zero or more m : "is joined by"',
    "+\tp }o..o| CLUB : chairs",
  ]);
  // A word of the syntax is a name in quotes.
  assert.equal(
    renameEntityId(STARTER, "ORDER", "one").split("\n")[2],
    '  "one" ||--|{ ORDER-ITEM : contains',
  );
  for (const taken of ["CUSTOMER", "", 'a"b'])
    assert.equal(renameEntityId(STARTER, "ORDER", taken), STARTER, taken);
});

test("copies an entity with its alias and attributes, without its relationships", () => {
  const twin = duplicateEntity(STARTER, "CUSTOMER");
  assert.equal(twin.id, "CUSTOMER2");
  assert.deepEqual(twin.source.split("\n").slice(7, 11), [
    "  CUSTOMER2 {",
    "    int id PK",
    "    string name",
    "  }",
  ]);
  const person = duplicateEntity(MIXED, "p");
  assert.equal(S.read(person.source).nodes.find((node) => node.id === "p2")?.label, "Person");
  assert.ok(isGeneratedErId(person.source, "p2"));
  assert.equal(duplicateEntity(MIXED, "Sports club").id, "Sports-club");
  assert.deepEqual(duplicateEntity(STARTER, "r1"), { source: STARTER, id: "" });
});

test("says what a removal takes with it", () => {
  assert.equal(
    erRemovalSummary(STARTER, ["CUSTOMER", "ORDER", "r1"]),
    "CUSTOMER, ORDER with 1 relationship",
  );
  assert.equal(erRemovalSummary(MIXED, ["p"]), "Person with 3 relationships");
  assert.equal(erRemovalSummary(STARTER, ["r1", "r2"]), "2 relationships");
  assert.equal(erRemovalSummary(STARTER, ["nothing"]), "");
});
