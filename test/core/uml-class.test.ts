// Class diagrams: parsing, errors with their lines, the TAM conceptual level, and folding and overview of explorable diagrams.
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  type ClassView,
  foldClassDiagram,
  generics,
  overview,
  parseClassDiagram,
  parseMember,
  toggleClassPart,
} from "../../src/uml-class.ts";
import { UmlError } from "../../src/uml.ts";

/** The error parsing `source` throws. */
function error(source: string): UmlError {
  try {
    parseClassDiagram(source);
  } catch (reason) {
    assert.ok(reason instanceof UmlError);
    return reason;
  }
  throw new Error("parsed");
}

const EXPLORABLE = `classDiagram
  namespace shop.orders {
    class Order {
      +items list
      +add(item)
    }
    class Item {
      +name str
    }
  }
  namespace shop.billing {
    class Invoice {
      +total() float
    }
  }
  class Report
  Order --> Item
  Invoice ..> Order : bills
  Report ..> Invoice
  Report ..> Order
  click Order href "src/orders.py#L3"
  link Invoice "src/billing.py#L1"`;

test("reads classes with bodies, members, annotations, labels and generics", () => {
  const diagram = parseClassDiagram(`classDiagram
  class Shape~T~ {
    <<interface>>
    +String name
    -int sides$
    +area() double
    +draw(Canvas c)*
  }
  class Animal["An animal"]
  Animal : +int age
  Animal : +isMammal() bool
  <<abstract>> Animal
  class Port <<service>>`);
  const shape = diagram.classes.get("Shape");
  assert.ok(shape);
  assert.equal(shape.generic, "T");
  assert.deepEqual(shape.annotations, ["interface"]);
  assert.deepEqual(
    shape.attributes.map((member) => [member.text, member.underline]),
    [
      ["+String name", false],
      ["-int sides", true],
    ],
  );
  assert.deepEqual(
    shape.methods.map((member) => [member.text, member.italic]),
    [
      ["+area() : double", false],
      ["+draw(Canvas c)", true],
    ],
  );
  const animal = diagram.classes.get("Animal");
  assert.ok(animal);
  assert.equal(animal.label, "An animal");
  assert.deepEqual(animal.annotations, ["abstract"]);
  assert.equal(animal.methods[0]?.text, "+isMammal() : bool");
  assert.deepEqual(diagram.classes.get("Port")?.annotations, ["service"]);
});

test("reads every relation kind with multiplicities and labels", () => {
  const diagram = parseClassDiagram(
    'classDiagram\n  A <|-- B\n  C "1" *-- "many" D : has\n  E o-- F\n  G <-- H\n  I -- J\n  K <.. L\n  M <|.. N\n  O .. P\n  Q <|--|> R\n  S --> T : uses',
  );
  assert.deepEqual(
    diagram.relations.map((relation) => [
      relation.source,
      relation.startMarker ?? "",
      relation.dashed ? ".." : "--",
      relation.endMarker ?? "",
      relation.target,
    ]),
    [
      ["A", "triangle", "--", "", "B"],
      ["C", "filled-diamond", "--", "", "D"],
      ["E", "diamond", "--", "", "F"],
      ["G", "open", "--", "", "H"],
      ["I", "", "--", "", "J"],
      ["K", "open", "..", "", "L"],
      ["M", "triangle", "..", "", "N"],
      ["O", "", "..", "", "P"],
      ["Q", "triangle", "--", "triangle", "R"],
      ["S", "", "--", "open", "T"],
    ],
  );
  assert.partialDeepStrictEqual(diagram.relations[1], {
    startLabel: "1",
    endLabel: "many",
    label: "has",
  });
});

test("makes lollipop ends interface balls, not classes", () => {
  const diagram = parseClassDiagram("classDiagram\n  bar ()-- foo\n  Service --() Port");
  assert.deepEqual([...diagram.classes.keys()], ["foo", "Service"]);
  assert.deepEqual(
    diagram.lollipops.map((ball) => ball.label),
    ["bar", "Port"],
  );
});

test("nests namespaces, also by dotted names", () => {
  const diagram = parseClassDiagram(
    'classDiagram\n  namespace app.domain {\n    class Order\n    namespace model {\n      class Line\n    }\n  }\n  namespace ui["User interface"] {\n    class View\n  }',
  );
  assert.deepEqual(
    [...diagram.namespaces.values()].map((space) => [space.id, space.label, space.parent]),
    [
      ["app", "app", null],
      ["app.domain", "domain", "app"],
      ["app.domain.model", "model", "app.domain"],
      ["ui", "User interface", null],
    ],
  );
  assert.equal(diagram.classes.get("Line")?.namespace, "app.domain.model");
});

test("reads notes, direction, frontmatter titles and ignores styling", () => {
  const diagram = parseClassDiagram(
    '---\ntitle: Shop\n---\nclassDiagram\n  direction LR\n  note "General"\n  note for A "About A<br>second line"\n  classDef red fill:#f00\n  cssClass "A" red\n  style A fill:#fff\n  click A href "https://example.com"\n  A:::red',
  );
  assert.equal(diagram.title, "Shop");
  assert.equal(diagram.direction, "LR");
  assert.deepEqual(
    diagram.notes.map((note) => [note.text, note.target]),
    [
      ["General", undefined],
      ["About A<br>second line", "A"],
    ],
  );
});

test("shows type arguments with angle brackets and the return type after one colon", () => {
  assert.equal(generics("List~List~int~~"), "List<List<int>>");
  assert.equal(generics("Map~K, V~"), "Map<K, V>");
  assert.equal(
    parseMember("+getDistanceMatrix() List~List~int~~").text,
    "+getDistanceMatrix() : List<List<int>>",
  );
  for (const written of ["+total(): Money", "+total() : Money", "+total() Money", "+total():Money"])
    assert.equal(parseMember(written).text, "+total() : Money", written);
  assert.equal(parseMember("+f(): Promise<void>").text, "+f() : Promise<void>");
  assert.equal(parseMember("+f(a: int, b: int): int").text, "+f(a: int, b: int) : int");
  assert.partialDeepStrictEqual(parseMember("+count(): int$"), {
    text: "+count() : int",
    underline: true,
  });
  assert.partialDeepStrictEqual(parseMember("+draw()* : void"), {
    text: "+draw() : void",
    italic: true,
  });
  assert.equal(parseMember("+run():").text, "+run()");
  // An attribute keeps its colon.
  assert.equal(parseMember("+id: string").text, "+id: string");
});

test("reports errors with line numbers", () => {
  const open = error("classDiagram\n  class A {\n    +x");
  assert.equal(open.message, "Line 2: Class `A` is missing its closing `}`.");
  assert.equal(open.line, 2);
  assert.match(
    error("classDiagram\n  namespace N {\n    class A\n    A --> B\n  }").message,
    /^Line 4: Relations go outside namespaces/,
  );
  assert.equal(error("classDiagram\n  }").message, "Line 2: Unmatched `}`.");
  assert.equal(error("classDiagram\n  A ==> B").message, "Line 2: Cannot read `A ==> B`.");
});

test("applies the TAM conceptual level rules", () => {
  assert.match(
    error("classDiagram\n  %% level conceptual\n  class A {\n    +name\n  }").message,
    /Visibility .* belongs to the design level/,
  );
  assert.equal(
    error("classDiagram\n  %% level conceptual\n  A <|.. B").message,
    "Line 3: Interface realization belongs to the design level.",
  );
  assert.equal(
    error("classDiagram\n  %% level conceptual\n  A ..> B").message,
    "Line 3: Dependencies belong to the design level.",
  );
  assert.doesNotThrow(() =>
    parseClassDiagram('classDiagram\n  %% level conceptual\n  A "1" *-- "*" B\n  A .. C'),
  );
});

test("reads click and link targets", () => {
  assert.deepEqual(
    [...parseClassDiagram(EXPLORABLE).links],
    [
      ["Order", "src/orders.py#L3"],
      ["Invoice", "src/billing.py#L1"],
    ],
  );
});

test("folds a collapsed package into one box and merges its relations", () => {
  const folded = foldClassDiagram(parseClassDiagram(EXPLORABLE), {
    collapsed: new Set(["shop.orders"]),
    bare: new Set(["Invoice"]),
  });
  assert.deepEqual([...folded.classes.keys()].toSorted(), ["Invoice", "Report", "ns:shop.orders"]);
  assert.equal(folded.classes.get("ns:shop.orders")?.attributes[0]?.text, "2 classes");
  assert.deepEqual([...folded.namespaces.keys()], ["shop", "shop.billing"]);
  assert.deepEqual(folded.classes.get("Invoice")?.methods, []);
  // Order --> Item is inside the package and disappears; the labelled use loses its label.
  assert.deepEqual(
    folded.relations.map((relation) => [relation.source, relation.target, relation.label]),
    [
      ["Invoice", "ns:shop.orders", undefined],
      ["Report", "Invoice", undefined],
      ["Report", "ns:shop.orders", undefined],
    ],
  );
});

test("opens large diagrams as an overview of the first level with several packages", () => {
  const classes = (prefix: string) =>
    Array.from({ length: 15 }, (_, n) => `    class ${prefix}${n}`).join("\n");
  const many = `classDiagram\n  namespace root.a {\n${classes("A")}\n  }\n  namespace root.b {\n${classes("B")}\n  }`;
  const view = overview(parseClassDiagram(many));
  assert.deepEqual([...view.collapsed].toSorted(), ["root.a", "root.b"]);
  assert.equal(view.bare.size, 30);
  assert.equal(overview(parseClassDiagram(EXPLORABLE)).collapsed.size, 0);
});

test("toggles a clicked package open and a clicked class bare", () => {
  let view: ClassView = { collapsed: new Set(["shop.billing"]), bare: new Set() };
  view = toggleClassPart(view, {
    kind: "package",
    id: "shop.billing",
    name: "billing",
    folded: true,
  });
  view = toggleClassPart(view, { kind: "class", id: "Order", name: "Order", folded: false });
  assert.deepEqual([...view.collapsed], []);
  assert.deepEqual([...view.bare], ["Order"]);
  const opened = foldClassDiagram(parseClassDiagram(EXPLORABLE), view);
  assert.ok(opened.classes.has("Invoice"));
  assert.deepEqual(opened.classes.get("Order")?.attributes, []);
});
