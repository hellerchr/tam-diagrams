// Class diagram source edits: each edit on a representative source, the text it writes, and that the result still parses.
import { test } from "vitest";
import assert from "node:assert/strict";
import { parseClassDiagram } from "../../src/uml-class.ts";
import {
  addClassMember,
  addLollipop,
  attachClass,
  classMemberIndex,
  classMembers,
  classRelationEnds,
  classRemovalSummary,
  classStereotype,
  classStructure,
  duplicateClass,
  isGeneratedClassId,
  joinClasses,
  moveClassInto,
  removeClassMember,
  renameClassId,
  reverseClassRelation,
  setClassKind,
  setClassMember,
  setClassMembers,
  setClassMultiplicity,
  setClassStereotype,
  ungroupClassPackage,
  whyNotClass,
} from "../../src/uml-class-edit.ts";

const STARTER = `classDiagram
  class Order {
    +id: string
    +total(): number
  }
  class OrderItem {
    +quantity: number
  }
  class Customer
  Customer "1" --> "*" Order : places
  Order "1" *-- "*" OrderItem`;

/** Nested namespaces, annotations in three forms, generics, notes, a lollipop, comments and blank lines. */
const SHOP = `---
title: Shop
---
classDiagram
  direction LR
  %% the sales side
  namespace Sales {
    class Order {
      <<abstract>>
      +id: string
      %% money
      +total(): number
    }
    class Status {
      <<enumeration>>
      OPEN
      PAID
    }
    namespace Billing {
      class Invoice["Tax invoice"]
      note "Printed monthly"
    }
  }

  class Payable
  <<interface>> Payable
  class Basket~Item~ { +items: List~Item~ }
  Payable : +pay(amount) bool
  Order ..|> Payable
  Basket "1" o-- "0..*" Order : holds
  Order *-- Line
  Invoice --> Order : bills
  Printable ()-- Invoice
  note for Order "Has lines<br>and a status"
  Order --> Status
  click Order href "https://example.com/order"
  style Order fill:#eee`;

/** Relations written from either end, among classes that no `class` statement declares, indented with tabs. */
const RELATIONS =
  "classDiagram\n\tAnimal <|-- Dog\n\tCar *-- Wheel\n\tWheel --* Truck\n\tDog .. Duck";

/** Packages given by dotted names and on one line, an inline annotation and members outside bodies. */
const PACKAGES = `classDiagram
  namespace app.model {
    class User <<interface>>
    class \`Access Role\`
  }
  namespace app.empty { }
  class Admin{
    +grant() }
  Admin --|> User
  User : +name
  \`Access Role\` --> User`;

/** The structure edits: read, add, connect, rename, retitle, label, relink, remove. */
const S = classStructure;

const ids = (source: string) => S.read(source).nodes.map((node) => node.id);
const node = (source: string, id: string) => S.read(source).nodes.find((item) => item.id === id);
const kinds = (source: string) => S.read(source).nodes.map((item) => item.kind);
const joins = (source: string) =>
  S.read(source).edges.map((edge) => `${edge.id} ${edge.kind}${edge.fixedLabel ? " fixed" : ""}`);

/** The lines `after` drops from `before` (`-`), then the ones it adds (`+`); asserts `after` parses. */
function diff(before: string, after: string): string[] {
  parseClassDiagram(after);
  const old = before.split("\n"),
    now = after.split("\n");
  return [
    ...old.filter((line) => !now.includes(line)).map((line) => `-${line}`),
    ...now.filter((line) => !old.includes(line)).map((line) => `+${line}`),
  ];
}

test("reads parts and joins with their kinds, groups before what they hold", () => {
  assert.deepEqual(S.read(STARTER).nodes[0], {
    id: "Order",
    label: "Order",
    parent: null,
    line: 2,
    group: false,
    kind: "class",
  });
  assert.partialDeepStrictEqual(S.read(STARTER).edges[1], {
    id: "r2",
    target: "OrderItem",
    line: 11,
    kind: "composition",
  });
  assert.equal(
    ids(SHOP).join(" "),
    "ns:Sales Order Status ns:Sales.Billing Invoice note1 Payable Basket Line interface1 note2",
  );
  assert.equal(
    kinds(SHOP).join(" "),
    "package abstract enumeration package class note interface class class lollipop note",
  );
  assert.partialDeepStrictEqual(node(SHOP, "Invoice"), {
    label: "Tax invoice",
    parent: "ns:Sales.Billing",
  });
  assert.equal(
    joins(SHOP).join(", "),
    "r1 realization, r2 aggregation, r3 composition, r4 association, r5 lollipop, note2:link anchor fixed, r6 association",
  );
  assert.deepEqual(ids(PACKAGES), [
    "ns:app",
    "ns:app.model",
    "User",
    "Access Role",
    "ns:app.empty",
    "Admin",
  ]);
});

test("adds classes of each kind, notes and packages where their kind stands", () => {
  const after = (text: string) =>
    STARTER.replace("  class Customer\n", `  class Customer\n${text}\n`);
  assert.deepEqual(S.add(STARTER, { kind: "class" }), {
    source: after("  class Class1"),
    id: "Class1",
  });
  assert.equal(
    S.add(STARTER, { kind: "class", label: "order line" }).source,
    after('  class OrderLine["order line"]'),
  );
  assert.equal(S.add(STARTER, { kind: "class", label: "Order" }).id, "Order2");
  assert.equal(
    S.add(STARTER, { kind: "interface", label: "Thing" }).source,
    after("  class Thing {\n    <<interface>>\n  }"),
  );
  const note = S.add(STARTER, { kind: "note", label: 'See "RFC"\nfor <more>' });
  assert.deepEqual(diff(STARTER, note.source), [
    '+  note "See #quot;RFC#quot;<br>for #lt;more#gt;"',
  ]);
  assert.equal(note.id, "note1");
  assert.equal(
    S.add(STARTER, { kind: "package", label: "Core parts" }).source,
    after('  namespace CoreParts["Core parts"] {\n  }'),
  );
  // Inside a nested namespace, in one that dotted names only imply, and with tabs.
  const inside = S.add(SHOP, { kind: "class", label: "Receipt", parent: "ns:Sales.Billing" });
  assert.deepEqual(diff(SHOP, inside.source), ["+      class Receipt"]);
  assert.equal(node(inside.source, "Receipt")?.parent, "ns:Sales.Billing");
  const implied = S.add(PACKAGES, { kind: "class", label: "Main", parent: "ns:app" }).source;
  assert.ok(implied.endsWith("\n  namespace app {\n    class Main\n  }"));
  assert.equal(
    S.add(RELATIONS, { kind: "class", label: "Toy" }).source,
    RELATIONS.replace("\n", "\n\tclass Toy\n"),
  );
  assert.equal(S.add(SHOP, { kind: "package", label: "Billing" }).id, "ns:Billing2");
});

test("connects with every kind of relation, and a note with its class", () => {
  const arrows = ["-->", "--|>", "*--", "o--", "..>", "..|>", "--", ".."];
  S.links.forEach(({ kind }, index) => {
    const joined = S.connect(STARTER, "Customer", "OrderItem", kind);
    assert.equal(joined, `${STARTER}\n  Customer ${arrows[index]} OrderItem`);
    assert.partialDeepStrictEqual(S.read(joined).edges.at(-1), { id: "r3", kind });
  });
  assert.equal(
    S.connect(PACKAGES, "Access Role", "Admin", "dependency"),
    `${PACKAGES}\n  \`Access Role\` ..> Admin`,
  );
  const note = S.add(STARTER, { kind: "note", label: "Paid first" });
  assert.equal(
    S.connect(note.source, note.id, "Order", "anchor"),
    `${STARTER}\n  note for Order "Paid first"`,
  );
  // What is no class has no relation.
  assert.equal(S.connect(SHOP, "ns:Sales", "Basket"), SHOP);
  assert.equal(S.connect(SHOP, "interface1", "Basket"), SHOP);
});

test("renames by a label and keeps the id; a class only relations name gets a statement", () => {
  const renamed = S.rename(STARTER, "Order", "Purchase order");
  assert.deepEqual(diff(STARTER, renamed), [
    "-  class Order {",
    '+  class Order["Purchase order"] {',
  ]);
  assert.equal(S.rename(renamed, "Order", "Order"), STARTER);
  assert.ok(
    S.rename(STARTER, "Customer", 'A "big"\n<x>').includes(
      '  class Customer["A #quot;big#quot; #lt;x#gt;"]\n',
    ),
  );
  assert.ok(S.rename(SHOP, "Basket", "Cart").includes('  class Basket~Item~["Cart"] { +items'));
  assert.deepEqual(diff(RELATIONS, S.rename(RELATIONS, "Dog", "Hound")), ['+\tclass Dog["Hound"]']);
  assert.ok(
    S.rename(SHOP, "ns:Sales", "Sales [EU]").includes('  namespace Sales["Sales [EU#93;"] {\n'),
  );
  assert.ok(S.rename(SHOP, "note2", "Lines only").includes('  note for Order "Lines only"\n'));
  assert.ok(S.rename(SHOP, "interface1", "Print Job").includes("  `Print Job` ()-- Invoice\n"));
  assert.equal(S.rename(PACKAGES, "ns:app", "Application"), PACKAGES);
});

test("labels relations and keeps their multiplicities", () => {
  assert.equal(S.label(STARTER, "r2", "contains"), `${STARTER} : contains`);
  const special = S.label(STARTER, "r1", ' uses <T>: "a|b"\nalways ');
  assert.equal(
    diff(STARTER, special)[1],
    '+  Customer "1" --> "*" Order : uses #lt;T#gt;: #quot;a|b#quot;<br>always',
  );
  assert.equal(S.read(S.label(STARTER, "r1", "")).edges[0]?.label, undefined);
  assert.equal(S.label(SHOP, "note2:link", "about"), SHOP);
});

test("relinks between the same ends, a relation written from its second end staying so", () => {
  assert.ok(
    S.relink(STARTER, "r1", "aggregation").includes('  Customer "1" o-- "*" Order : places\n'),
  );
  assert.deepEqual(diff(RELATIONS, S.relink(RELATIONS, "r1", "realization")), [
    "-\tAnimal <|-- Dog",
    "+\tAnimal <|.. Dog",
  ]);
  assert.ok(S.relink(RELATIONS, "r3", "dependency").includes("\tWheel <.. Truck\n"));
  assert.equal(S.relink(STARTER, "r2", "anchor"), STARTER);
  assert.equal(S.relink(SHOP, "r5", "association"), SHOP);
});

test("removes classes with their relations, notes and styling, relations and namespaces", () => {
  const without = diff(SHOP, S.remove(SHOP, ["Order"]));
  assert.equal(without.length, 14);
  assert.ok(
    without.includes("-      %% money") &&
      without.includes('-  click Order href "https://example.com/order"'),
  );
  assert.ok(without.includes('-  note for Order "Has lines<br>and a status"'));
  // `Line` stood only in a relation of the class: it stays, declared.
  assert.equal(without.at(-1), "+  class Line");
  assert.deepEqual(diff(RELATIONS, S.remove(RELATIONS, ["r1"])), [
    "-\tAnimal <|-- Dog",
    "+\tclass Animal",
  ]);
  assert.deepEqual(
    diff(SHOP, S.remove(SHOP, ["note2:link"])).at(-1),
    '+  note "Has lines<br>and a status"',
  );
  assert.deepEqual(ids(S.remove(SHOP, ["ns:Sales"])), ["Payable", "Basket", "Line"]);
  assert.deepEqual(ids(S.remove(PACKAGES, ["ns:app"])), ["Admin"]);
  assert.equal(S.remove(SHOP, []), SHOP);
});

test("lists and adds members, opening a body where there is none", () => {
  assert.deepEqual(classMembers(SHOP, "Order"), ["+id: string", "+total(): number"]);
  assert.deepEqual(classMembers(SHOP, "Payable"), ["+pay(amount) bool"]);
  assert.deepEqual(classMembers(PACKAGES, "Admin"), ["+grant()"]);
  assert.ok(
    addClassMember(STARTER, "Order", "-paid: boolean").includes(
      "    +total(): number\n    -paid: boolean\n  }\n",
    ),
  );
  const customer = addClassMember(STARTER, "Customer", " +name: string\n");
  assert.ok(customer.includes("\n  class Customer {\n    +name: string\n  }\n"));
  assert.equal(diff(STARTER, customer).length, 3);
  const basket = addClassMember(SHOP, "Basket", "+add(item: Item)");
  assert.ok(
    basket.includes("  class Basket~Item~ {\n    +items: List~Item~\n    +add(item: Item)\n  }\n"),
  );
  assert.deepEqual(diff(RELATIONS, addClassMember(RELATIONS, "Dog", "+bark()")), [
    "+\tclass Dog {",
    "+\t\t+bark()",
    "+\t}",
  ]);
  assert.equal(addClassMember(STARTER, "Customer", "  "), STARTER);
});

test("replaces the members and keeps annotations and comments", () => {
  const order = setClassMembers(SHOP, "Order", ["+number: int", "+cancel()"]);
  assert.ok(
    order.includes(
      "\n      <<abstract>>\n      %% money\n      +number: int\n      +cancel()\n    }\n",
    ),
  );
  // Members outside the body move into it.
  const payable = setClassMembers(SHOP, "Payable", ["+pay()"]);
  assert.ok(
    payable.includes("  class Payable {\n    +pay()\n  }\n") &&
      !payable.includes("Payable : +pay(amount)"),
  );
  assert.equal(diff(SHOP, payable).length, 4);
  assert.equal(setClassMembers(STARTER, "Customer", []), STARTER);
});

test("edits and removes one member where it stands, and finds the member a row shows", () => {
  assert.deepEqual(diff(STARTER, setClassMember(STARTER, "Order", 1, "+total(): Money")), [
    "-    +total(): number",
    "+    +total(): Money",
  ]);
  assert.ok(
    setClassMember(SHOP, "Payable", 0, "+pay(amount: Money) bool").includes(
      "\n  Payable : +pay(amount: Money) bool\n",
    ),
  );
  assert.ok(
    setClassMember(PACKAGES, "Admin", 0, "+revoke()").includes(
      "  class Admin{\n    +revoke()\n  }\n",
    ),
  );
  assert.deepEqual(diff(STARTER, removeClassMember(STARTER, "Order", 0)), ["-    +id: string"]);
  assert.equal(setClassMember(STARTER, "Order", 0, "  "), removeClassMember(STARTER, "Order", 0));
  assert.equal(
    removeClassMember("classDiagram\n  Dog : +bark()", "Dog", 0),
    "classDiagram\n  class Dog",
  );
  assert.equal(removeClassMember(STARTER, "Order", 5), STARTER);
  // Drawn: name, age, run(), stop().
  const mixed =
    "classDiagram\n  class A {\n    +run()\n    +name\n    <<service>>\n    +stop()\n    +age\n  }";
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((row) => classMemberIndex(mixed, "A", row)).join(),
    "1,3,0,2,-1",
  );
});

test("makes a class one of another kind, whichever way its annotation is written", () => {
  assert.ok(
    setClassKind(STARTER, "Order", "interface").includes(
      "  class Order {\n    <<interface>>\n    +id: string\n",
    ),
  );
  assert.deepEqual(diff(SHOP, setClassKind(SHOP, "Payable", "class")), [
    "-  <<interface>> Payable",
  ]);
  assert.deepEqual(diff(PACKAGES, setClassKind(PACKAGES, "User", "class")), [
    "-    class User <<interface>>",
    "+    class User",
  ]);
  const api = parseClassDiagram(
    setClassKind("classDiagram\n  class Api { <<service>> }", "Api", "interface"),
  ).classes.get("Api");
  assert.deepEqual(api?.annotations, ["interface", "service"]);
  assert.equal(setClassKind(STARTER, "Customer", "nothing"), STARTER);
});

test("reads and sets the stereotype, which is no member", () => {
  assert.equal(classStereotype(SHOP, "Payable"), "interface");
  assert.equal(classStereotype(PACKAGES, "User"), "interface");
  const typed = setClassStereotype(STARTER, "Order", " <<service>> ");
  assert.deepEqual(diff(STARTER, typed), ["+    <<service>>"]);
  assert.deepEqual(classMembers(typed, "Order"), classMembers(STARTER, "Order"));
  assert.equal(
    setClassStereotype(typed, "Order", "«entity»"),
    typed.replace("<<service>>", "<<entity>>"),
  );
  assert.equal(setClassStereotype(typed, "Order", ""), STARTER);
  // One takes the place of the one there; an empty one makes an interface a plain class.
  assert.deepEqual(diff(SHOP, setClassStereotype(SHOP, "Order", "service")), [
    "-      <<abstract>>",
    "+      <<service>>",
  ]);
  const plain = setClassStereotype(SHOP, "Payable", "");
  assert.deepEqual(diff(SHOP, plain), ["-  <<interface>> Payable"]);
  assert.equal(node(plain, "Payable")?.kind, "class");
  const two =
    "classDiagram\n  class A <<service>> {\n    <<abstract>>\n    +x\n  }\n  <<entity>> A";
  assert.equal(
    setClassStereotype(two, "A", "boundary"),
    "classDiagram\n  class A <<boundary>> {\n    +x\n  }",
  );
});

test("gives a new part its first name as its id", () => {
  const added = S.add(STARTER, { kind: "class" }),
    named = S.retitle!(S.connect(added.source, "Order", added.id), added.id, "Invoice");
  assert.equal(named.id, "Invoice");
  assert.deepEqual(diff(STARTER, named.source), ["+  class Invoice", "+  Order --> Invoice"]);
  const spaced = S.retitle!(added.source, added.id, "line item");
  assert.equal(spaced.id, "LineItem");
  assert.equal(spaced.source, added.source.replace("class Class1", 'class LineItem["line item"]'));
  // A name that is taken is the label of the id it has.
  const taken = S.retitle!(added.source, added.id, "Order");
  assert.equal(taken.id, "Class1");
  assert.equal(taken.source, added.source.replace("class Class1", 'class Class1["Order"]'));
  const inner = S.add(SHOP, { kind: "package", parent: "ns:Sales" }),
    stock = S.retitle!(inner.source, inner.id, "Stock room");
  assert.equal(stock.id, "ns:Sales.StockRoom");
  assert.ok(diff(SHOP, stock.source).includes('+    namespace StockRoom["Stock room"] {'));
});

test("renames a class or namespace wherever the source names it, and refuses ids that cannot be", () => {
  const billable = diff(SHOP, renameClassId(SHOP, "Payable", "Billable"));
  assert.ok(
    billable.includes("+  <<interface>> Billable") &&
      billable.includes("+  Billable : +pay(amount) bool"),
  );
  assert.equal(billable.length, 8);
  const sale = renameClassId(SHOP, "Order", "Sale");
  assert.equal(diff(SHOP, sale).length, 18);
  assert.equal(parseClassDiagram(sale).links.get("Sale"), "https://example.com/order");
  assert.ok(
    diff(PACKAGES, renameClassId(PACKAGES, "User", "End User")).includes(
      "+    class `End User` <<interface>>",
    ),
  );
  assert.ok(
    renameClassId(SHOP, "Basket", "Cart").includes("  class Cart~Item~ { +items: List~Item~ }\n"),
  );
  // A label that says what the new id says goes.
  assert.ok(
    renameClassId(S.rename(STARTER, "Order", "Purchase"), "Order", "Purchase").includes(
      "  class Purchase {\n",
    ),
  );
  for (const name of ["Customer", "", "note1", "ns:x", "class", "a`b"])
    assert.equal(renameClassId(STARTER, "Order", name), STARTER);
  assert.equal(renameClassId(SHOP, "Basket", "My Basket"), SHOP);
  assert.ok(
    diff(SHOP, renameClassId(SHOP, "ns:Sales.Billing", "Accounts")).includes(
      "+    namespace Accounts {",
    ),
  );
  const core = diff(PACKAGES, renameClassId(PACKAGES, "ns:app", "core"));
  assert.deepEqual(core.slice(2), ["+  namespace core.model {", "+  namespace core.empty { }"]);
  assert.equal(renameClassId(PACKAGES, "ns:app.model", "empty"), PACKAGES);
});

test("turns a relation round, and reads and sets the multiplicities of its ends", () => {
  const turned = reverseClassRelation(STARTER, "r1");
  assert.deepEqual(diff(STARTER, turned).at(-1), '+  Order "*" --> "1" Customer : places');
  assert.equal(reverseClassRelation(turned, "r1"), STARTER);
  assert.ok(reverseClassRelation(RELATIONS, "r1").includes("\tDog <|-- Animal\n"));
  assert.equal(reverseClassRelation(SHOP, "r5"), SHOP);
  assert.partialDeepStrictEqual(classRelationEnds(STARTER, "r1"), {
    from: "Customer",
    fromMultiplicity: "1",
    toMultiplicity: "*",
  });
  assert.equal(classRelationEnds(SHOP, "note2:link"), undefined);
  assert.ok(
    setClassMultiplicity(STARTER, "r1", "from", "0..1").includes(
      '  Customer "0..1" --> "*" Order : places\n',
    ),
  );
  assert.ok(
    setClassMultiplicity(STARTER, "r1", "to", "").includes('  Customer "1" --> Order : places\n'),
  );
  const tight = setClassMultiplicity(
    setClassMultiplicity("classDiagram\n  A-->B", "r1", "from", "1"),
    "r1",
    "to",
    "many",
  );
  assert.deepEqual(diff("classDiagram\n  A-->B", tight), ["-  A-->B", '+  A "1" --> "many" B']);
  assert.equal(setClassMultiplicity(STARTER, "r1", "from", "1"), STARTER);
});

test("copies a class with its members and stereotype, without its relations", () => {
  const order = duplicateClass(STARTER, "Order");
  assert.equal(order.id, "Order2");
  assert.deepEqual(diff(STARTER, order.source), ["+  class Order2 {"]);
  assert.deepEqual(classMembers(order.source, "Order2"), classMembers(STARTER, "Order"));
  const payable = duplicateClass(SHOP, "Payable").source;
  assert.ok(
    payable.includes(
      "  class Payable\n  class Payable2 {\n    <<interface>>\n    +pay(amount) bool\n  }\n",
    ),
  );
  const invoice = node(duplicateClass(SHOP, "Invoice").source, "Invoice2");
  assert.partialDeepStrictEqual(invoice, { label: "Tax invoice", parent: "ns:Sales.Billing" });
  assert.equal(duplicateClass(PACKAGES, "Access Role").id, "AccessRole");
  assert.deepEqual(duplicateClass(SHOP, "note1"), { source: SHOP, id: "" });
});

test("moves a class or note into a namespace and out of it", () => {
  const into = moveClassInto(SHOP, "Payable", "ns:Sales");
  assert.deepEqual(diff(SHOP, into), ["-  class Payable", "+    class Payable"]);
  assert.partialDeepStrictEqual(node(into, "Payable"), { parent: "ns:Sales", kind: "interface" });
  const out = moveClassInto(SHOP, "Order", null);
  assert.ok(
    out.includes(
      "  class Order {\n    <<abstract>>\n    +id: string\n    %% money\n    +total(): number\n  }\n  Order ..|>",
    ),
  );
  assert.equal(node(out, "Order")?.parent, null);
  assert.ok(
    moveClassInto(PACKAGES, "Admin", "ns:app").includes(
      "  namespace app {\n    class Admin{\n      +grant() }\n  }",
    ),
  );
  assert.deepEqual(diff(SHOP, moveClassInto(SHOP, "note1", null)), [
    '-      note "Printed monthly"',
    '+  note "Printed monthly"',
  ]);
  assert.equal(moveClassInto(SHOP, "Order", "ns:Sales"), SHOP);
  assert.equal(moveClassInto(SHOP, "ns:Sales.Billing", null), SHOP);
});

test("removes a package and keeps what it holds", () => {
  const inner = ungroupClassPackage(SHOP, "ns:Sales.Billing");
  assert.equal(diff(SHOP, inner).length, 5);
  assert.ok(
    inner.includes(
      '      PAID\n    }\n    class Invoice["Tax invoice"]\n    note "Printed monthly"\n  }\n',
    ),
  );
  assert.equal(node(inner, "Invoice")?.parent, "ns:Sales");
  assert.deepEqual(diff(PACKAGES, ungroupClassPackage(PACKAGES, "ns:app.model")), [
    "-  namespace app.model {",
    "+  namespace app {",
  ]);
  assert.equal(ungroupClassPackage(SHOP, "Order"), SHOP);
});

test("knows a made-up id until it has a name", () => {
  for (const { source, id } of ["class", "interface", "package"].map((kind) =>
    S.add(STARTER, { kind }),
  ))
    assert.ok(isGeneratedClassId(source, id), id);
  assert.equal(
    isGeneratedClassId(S.add(STARTER, { kind: "class", label: "Invoice" }).source, "Invoice"),
    false,
  );
  const copy = duplicateClass(STARTER, "Order");
  assert.ok(isGeneratedClassId(copy.source, "Order2"));
  assert.equal(isGeneratedClassId(copy.source, "Order"), false);
  assert.equal(
    isGeneratedClassId('classDiagram\n  class Vector\n  class Vector2["Plane vector"]', "Vector2"),
    false,
  );
});

test("adds a lollipop interface to a class", () => {
  const ball = addLollipop(STARTER, "Order", "Printable");
  assert.deepEqual(ball, { source: `${STARTER}\n  Printable ()-- Order`, id: "interface1" });
  assert.partialDeepStrictEqual(node(ball.source, "interface1"), {
    kind: "lollipop",
    label: "Printable",
  });
  assert.equal(
    addLollipop(STARTER, "Order", "Print job").source,
    `${STARTER}\n  \`Print job\` ()-- Order`,
  );
  assert.deepEqual(S.add(STARTER, { kind: "lollipop", label: "Printable", parent: "Order" }), ball);
  assert.equal(S.remove(ball.source, [ball.id]), STARTER);
  assert.deepEqual(addLollipop(SHOP, "ns:Sales", "X"), { source: SHOP, id: "" });
});

test("adds a piece at a part and says what it wrote", () => {
  const joined = attachClass(STARTER, { kind: "class", label: "Invoice" }, "Order", "composition");
  assert.equal(joined.edge, "r3");
  assert.deepEqual(diff(STARTER, joined.source), ["+  class Invoice", "+  Order *-- Invoice"]);
  const note = attachClass(STARTER, { kind: "note", label: "Paid first" }, "Order");
  assert.deepEqual(note, {
    source: `${STARTER}\n  note for Order "Paid first"`,
    id: "note1",
    edge: "note1:link",
  });
  const inside = attachClass(
    SHOP,
    { kind: "interface", label: "Billable" },
    "Invoice",
    "realization",
  );
  assert.partialDeepStrictEqual(node(inside.source, "Billable"), {
    kind: "interface",
    parent: "ns:Sales.Billing",
  });
  const pkg = S.add(SHOP, { kind: "package", parent: "ns:Sales.Billing" });
  assert.deepEqual(attachClass(SHOP, { kind: "package" }, "Invoice"), { ...pkg, edge: "" });
});

test("says which join it wrote, and why two parts are not joined", () => {
  const joined = joinClasses(STARTER, "Customer", "OrderItem", "dependency");
  assert.deepEqual(joined, { source: `${STARTER}\n  Customer ..> OrderItem`, edge: "r3" });
  assert.deepEqual(joinClasses(SHOP, "ns:Sales", "Order"), { source: SHOP, edge: "" });
  assert.equal(whyNotClass(SHOP, "Order", "Payable"), undefined);
  assert.equal(whyNotClass(SHOP, "note1", "Order"), undefined);
  assert.match(whyNotClass(SHOP, "ns:Sales", "Order") ?? "", /package/i);
  assert.match(whyNotClass(SHOP, "Order", "interface1") ?? "", /lollipop/i);
  assert.match(whyNotClass(SHOP, "note1", "note2") ?? "", /another note/);
  assert.match(whyNotClass(SHOP, "Order", "Payable", "nonsense") ?? "", /kind/);
});

test("says what a removal takes with it", () => {
  assert.equal(
    classRemovalSummary(SHOP, ["ns:Sales"]),
    "Package Sales with 3 classes, 1 package, 6 relations and 2 notes",
  );
  assert.equal(
    classRemovalSummary(STARTER, ["Order", "Customer", "r1"]),
    "Order, Customer with 1 relation",
  );
  assert.equal(classRemovalSummary(SHOP, ["Invoice"]), "Tax invoice with 2 relations");
  assert.equal(classRemovalSummary(SHOP, ["r1", "r2", "note1"]), "2 relations and 1 note");
  assert.equal(classRemovalSummary(SHOP, ["Nothing"]), "");
});
