import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseUml } from "../src/index.ts";
import { CLASS_EXAMPLES } from "../src/samples/uml-examples.ts";
import { parseClassDiagram } from "../src/uml-class.ts";
import {
  addClassMember,
  type ClassEdge,
  classMembers,
  classRelationEnds,
  classStereotype,
  classStructure,
  duplicateClass,
  moveClassInto,
  renameClassId,
  reverseClassRelation,
  setClassKind,
  setClassMembers,
  setClassMultiplicity,
  setClassStereotype,
  ungroupClassPackage,
} from "../src/uml-class-edit.ts";

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

/** Every way a relation is written, among classes that no `class` statement declares. */
const RELATIONS = `classDiagram
\tAnimal <|-- Dog
\tDog --|> Pet
\tCar *-- Wheel
\tWheel --* Truck
\tPond o-- Duck
\tDriver --> Car : drives
\tCar <-- Owner
\tDog ..> Food
\tDog ..|> Walker
\tWalker <|.. Cat
\tDog -- Cat
\tDog .. Duck
\tDuck "1" <--> "many" Pond: lives on`;

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

const SOURCES = [STARTER, SHOP, RELATIONS, PACKAGES, ...CLASS_EXAMPLES.map(([, source]) => source)];

const { read, add, connect, rename, label, relink, remove } = classStructure;

const ids = (source: string) => read(source).nodes.map((node) => node.id);

const relations = (source: string) =>
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

describe("a class diagram as a structure", () => {
  it("reads parts and joins with their kinds, groups before what they hold", () => {
    expect(read(STARTER)).toEqual({
      nodes: [
        { id: "Order", label: "Order", parent: null, line: 2, group: false, kind: "class" },
        { id: "OrderItem", label: "OrderItem", parent: null, line: 6, group: false, kind: "class" },
        { id: "Customer", label: "Customer", parent: null, line: 9, group: false, kind: "class" },
      ],
      edges: [
        {
          id: "r1",
          source: "Customer",
          target: "Order",
          label: "places",
          line: 10,
          kind: "association",
        },
        {
          id: "r2",
          source: "Order",
          target: "OrderItem",
          label: undefined,
          line: 11,
          kind: "composition",
        },
      ],
    });
    expect(
      read(SHOP).nodes.map((node) => `${node.id}:${node.kind}:${node.parent}:${node.line}`),
    ).toEqual([
      "ns:Sales:package:null:7",
      "Order:abstract:ns:Sales:8",
      "Status:enumeration:ns:Sales:14",
      "ns:Sales.Billing:package:ns:Sales:19",
      "Invoice:class:ns:Sales.Billing:20",
      "note1:note:ns:Sales.Billing:21",
      "Payable:interface:null:25",
      "Basket:class:null:27",
      "Line:class:null:31",
      "interface1:interface:null:33",
      "note2:note:null:34",
    ]);
    expect(
      read(SHOP)
        .nodes.filter((node) => node.group)
        .map((node) => node.label),
    ).toEqual(["Sales", "Billing"]);
    expect(read(SHOP).nodes.find((node) => node.id === "Invoice")!.label).toBe("Tax invoice");
    expect(relations(SHOP)).toEqual([
      "Order realization Payable",
      "Basket aggregation Order: holds",
      "Order composition Line",
      "Invoice association Order: bills",
      "interface1 lollipop Invoice",
      "note2 anchor Order",
      "Order association Status",
    ]);
    expect(relations(RELATIONS)).toEqual([
      "Animal inheritance Dog",
      "Dog inheritance Pet",
      "Car composition Wheel",
      "Wheel composition Truck",
      "Pond aggregation Duck",
      "Driver association Car: drives",
      "Car association Owner",
      "Dog dependency Food",
      "Dog realization Walker",
      "Walker realization Cat",
      "Dog link Cat",
      "Dog dashed Duck",
      "Duck association Pond: lives on",
    ]);
    expect(ids(PACKAGES)).toEqual([
      "ns:app",
      "ns:app.model",
      "User",
      "Access Role",
      "ns:app.empty",
      "Admin",
    ]);
    // Every kind a part or a join has is one the palette knows, or one of the two nothing switches.
    const pieces = new Set(classStructure.pieces.map((piece) => piece.kind)),
      links = new Set([...classStructure.links.map((link) => link.kind), "anchor", "lollipop"]);
    for (const source of SOURCES) {
      for (const node of read(source).nodes) expect(pieces.has(node.kind), node.kind).toBe(true);
      for (const edge of read(source).edges) expect(links.has(edge.kind), edge.kind).toBe(true);
    }
  });

  it("names every part as the scene names its shape, every join as its wire", async () => {
    const extended = [
      ...SOURCES,
      add(add(SHOP, { kind: "package", label: "Stock", parent: "ns:Sales" }).source, {
        kind: "note",
        label: "Free",
      }).source,
    ];
    for (const source of extended) {
      const { nodes, edges } = read(source),
        scene = await parseUml(source).layout(arialMeasure),
        shapes = new Set(scene.shapes.map((shape) => shape.id)),
        wires = new Set(scene.wires.map((wire) => wire.edge));
      for (const node of nodes) expect(shapes.has(node.id), node.id).toBe(true);
      for (const edge of edges) expect(wires.has(edge.id), edge.id).toBe(true);
      // And the scene draws nothing a part does not stand for.
      expect([...shapes].filter((id) => !id.endsWith("#empty")).toSorted()).toEqual(
        nodes.map((node) => node.id).toSorted(),
      );
      expect([...wires].toSorted()).toEqual(edges.map((edge) => edge.id).toSorted());
    }
  }, 60_000);

  it("adds classes of each kind, notes and packages", () => {
    const plain = add(STARTER, { kind: "class" });
    expect(plain.id).toBe("Class1");
    // A class stands after the last class, before the relations.
    const after = (text: string) =>
      STARTER.replace("  class Customer\n", `  class Customer\n${text}\n`);
    expect(plain.source).toBe(after("  class Class1"));
    expect(add(plain.source, { kind: "class" })).toEqual({
      source: after("  class Class1\n  class Class2"),
      id: "Class2",
    });
    // A name is the id when it can be, and a label over an id made of it when not.
    expect(add(STARTER, { kind: "class", label: "Invoice" }).source).toBe(after("  class Invoice"));
    const spaced = add(STARTER, { kind: "class", label: "order line" });
    expect(spaced.id).toBe("OrderLine");
    expect(spaced.source).toBe(after('  class OrderLine["order line"]'));
    const again = add(STARTER, { kind: "class", label: "Order" });
    expect(again.id).toBe("Order2");
    expect(read(again.source).nodes.at(-1)).toMatchObject({ id: "Order2", label: "Order" });

    for (const kind of ["interface", "abstract", "enumeration"]) {
      const added = add(STARTER, { kind, label: "Thing" });
      expect(added.source).toBe(after(`  class Thing {\n    <<${kind}>>\n  }`));
      expect(read(added.source).nodes.at(-1)).toMatchObject({ id: "Thing", kind });
    }
    expect(add(STARTER, { kind: "interface" }).id).toBe("Interface1");

    const note = add(STARTER, { kind: "note", label: 'See "RFC"\nfor <more>' });
    expect(note.id).toBe("note1");
    expect(note.source.endsWith('\n  note "See #quot;RFC#quot;<br>for #lt;more#gt;"')).toBe(true);
    expect(read(note.source).nodes.at(-1)).toMatchObject({
      kind: "note",
      label: 'See "RFC"<br>for <more>',
    });

    const group = add(STARTER, { kind: "package", label: "Core parts" });
    expect(group.id).toBe("ns:CoreParts");
    expect(group.source).toBe(after('  namespace CoreParts["Core parts"] {\n  }'));
    expect(read(group.source).nodes.at(-1)).toMatchObject({
      id: "ns:CoreParts",
      label: "Core parts",
      group: true,
      kind: "package",
    });
    expect(add(STARTER, { kind: "package" }).id).toBe("ns:Package1");
  });

  it("puts a new part where its kind stands", () => {
    // After the last class outside the namespaces, with the statements that belong to it.
    expect(changed(SHOP, add(SHOP, { kind: "class", label: "Cart" }).source)).toEqual({
      gone: [],
      added: ["  class Cart"],
    });
    expect(add(SHOP, { kind: "class", label: "Cart" }).source).toContain(
      "  class Basket~Item~ { +items: List~Item~ }\n  Payable : +pay(amount) bool\n  class Cart\n  Order ..|> Payable\n",
    );
    const marked = "classDiagram\n  class A\n  <<service>> A\n  A : +run()\n  A:::hot\n  B --> A";
    expect(add(marked, { kind: "class" }).source).toBe(
      "classDiagram\n  class A\n  <<service>> A\n  A : +run()\n  A:::hot\n  class Class1\n  B --> A",
    );
    // A package after the last package, a note after the last note.
    expect(add(SHOP, { kind: "package", label: "Stock" }).source).toContain(
      "      PAID\n    }\n    namespace Billing {",
    );
    expect(add(SHOP, { kind: "package", label: "Stock" }).source).toContain(
      "  }\n  namespace Stock {\n  }\n\n  class Payable\n",
    );
    expect(add(SHOP, { kind: "note", label: "Free" }).source).toContain(
      '  note for Order "Has lines<br>and a status"\n  note "Free"\n  Order --> Status\n',
    );
    // Where only namespaces declare classes a class follows them, and a package the classes.
    expect(add(PACKAGES, { kind: "package", label: "web" }).source).toContain(
      "  namespace app.empty { }\n  namespace web {\n  }\n  class Admin{\n",
    );
    const spaces = "classDiagram\n  namespace a {\n    class A\n  }\n  A --> B";
    expect(add(spaces, { kind: "class" }).source).toBe(
      "classDiagram\n  namespace a {\n    class A\n  }\n  class Class1\n  A --> B",
    );
    // With relations only, before the first of them and the comment above it.
    expect(add("classDiagram\n  %% pets\n  Dog --> Cat", { kind: "class" }).source).toBe(
      "classDiagram\n  class Class1\n  %% pets\n  Dog --> Cat",
    );
    expect(add("classDiagram\n", { kind: "class" }).source).toBe("classDiagram\n  class Class1\n");
    for (const source of SOURCES)
      for (const piece of classStructure.pieces) {
        const added = add(source, { kind: piece.kind });
        expect(changed(source, added.source).gone).toEqual([]);
        expect(read(added.source).nodes.find((node) => node.id === added.id)).toMatchObject({
          kind: piece.kind,
          parent: null,
        });
      }
  });

  it("gives a new package a name no package has, wherever it stands", () => {
    const outer = add(STARTER, { kind: "package" }),
      inner = add(outer.source, { kind: "package", parent: outer.id });
    expect(inner.id).toBe("ns:Package1.Package2");
    expect(inner.source).toContain(
      "  namespace Package1 {\n    namespace Package2 {\n    }\n  }\n",
    );
    expect(add(inner.source, { kind: "package" }).id).toBe("ns:Package3");
    expect(add(inner.source, { kind: "package", parent: inner.id }).id).toBe(
      "ns:Package1.Package2.Package3",
    );
    // A name that a package elsewhere has gets a number.
    expect(add(SHOP, { kind: "package", label: "Billing" }).id).toBe("ns:Billing2");
    expect(add(SHOP, { kind: "package", label: "Sales", parent: "ns:Sales.Billing" }).id).toBe(
      "ns:Sales.Billing.Sales2",
    );
  });

  it("joins a new note to the class it is added at, and a new class to nothing", () => {
    expect(
      classStructure.pieces.map((piece) => `${piece.kind}:${piece.joins ?? ""}:${piece.joinsTo}`),
    ).toEqual([
      "class::undefined",
      "interface::undefined",
      "abstract::undefined",
      "enumeration::undefined",
      "note:after:class,interface,abstract,enumeration",
      "package::undefined",
    ]);
    // The way a canvas adds a note at a class: the note, then the class joined to it.
    const note = add(STARTER, { kind: "note" });
    expect(connect(note.source, "Order", note.id)).toBe(`${STARTER}\n  note for Order "Note"`);
    // A class added beside a free note leaves the note free.
    const free = add("classDiagram", { kind: "note" }),
      beside = add(free.source, { kind: "class" });
    expect(beside.source).toBe('classDiagram\n  note "Note"\n  class Class1');
    expect(read(beside.source).edges).toEqual([]);
  });

  it("adds inside namespaces, nested ones and ones without a block of their own", () => {
    const inside = add(SHOP, { kind: "class", label: "Receipt", parent: "ns:Sales.Billing" });
    expect(changed(SHOP, inside.source)).toEqual({ gone: [], added: ["      class Receipt"] });
    expect(read(inside.source).nodes.find((node) => node.id === "Receipt")!.parent).toBe(
      "ns:Sales.Billing",
    );
    const outer = add(SHOP, { kind: "enumeration", label: "Mode", parent: "ns:Sales" });
    expect(outer.source).toContain("    }\n    class Mode {\n      <<enumeration>>\n    }\n  }\n");
    expect(read(outer.source).nodes.find((node) => node.id === "Mode")!.parent).toBe("ns:Sales");

    // A note in a namespace that stands before another note takes its number.
    const note = add(SHOP, { kind: "note", label: "First", parent: "ns:Sales" });
    expect(note.id).toBe("note2");
    expect(read(note.source).nodes.find((node) => node.id === "note2")).toMatchObject({
      label: "First",
      parent: "ns:Sales",
    });

    const nested = add(SHOP, { kind: "package", label: "Stock", parent: "ns:Sales.Billing" });
    expect(nested.id).toBe("ns:Sales.Billing.Stock");
    expect(read(nested.source).nodes.find((node) => node.id === nested.id)!.parent).toBe(
      "ns:Sales.Billing",
    );
    const deeper = add(nested.source, { kind: "class", label: "Shelf", parent: nested.id });
    expect(deeper.source).toContain("      namespace Stock {\n        class Shelf\n      }\n");

    // `namespace app.model` implies `app`, which gets a block when something is added to it.
    const implied = add(PACKAGES, { kind: "class", label: "Main", parent: "ns:app" });
    expect(implied.source.endsWith("\n  namespace app {\n    class Main\n  }")).toBe(true);
    expect(read(implied.source).nodes.find((node) => node.id === "Main")!.parent).toBe("ns:app");
    const empty = add(PACKAGES, { kind: "class", label: "Gap", parent: "ns:app.empty" });
    expect(empty.source).toContain("  namespace app.empty {\n    class Gap\n  }\n");
    expect(read(empty.source).nodes.find((node) => node.id === "Gap")!.parent).toBe("ns:app.empty");
    // A parent that is no namespace leaves the piece outside.
    expect(
      read(add(SHOP, { kind: "class", parent: "Order" }).source).nodes.find(
        (node) => node.id === "Class1",
      )!.parent,
    ).toBe(null);
    // Tabs stay tabs.
    expect(add(RELATIONS, { kind: "interface", label: "Toy" }).source).toBe(
      RELATIONS.replace("classDiagram\n", "classDiagram\n\tclass Toy {\n\t\t<<interface>>\n\t}\n"),
    );
  });

  it("connects with every kind of relation, and notes with their class", () => {
    expect(connect(STARTER, "Customer", "OrderItem")).toBe(`${STARTER}\n  Customer --> OrderItem`);
    const written: Record<string, string> = {
      association: "Customer --> OrderItem",
      inheritance: "Customer --|> OrderItem",
      composition: "Customer *-- OrderItem",
      aggregation: "Customer o-- OrderItem",
      dependency: "Customer ..> OrderItem",
      realization: "Customer ..|> OrderItem",
      link: "Customer -- OrderItem",
      dashed: "Customer .. OrderItem",
    };
    for (const [kind, text] of Object.entries(written)) {
      const joined = connect(STARTER, "Customer", "OrderItem", kind);
      expect(joined).toBe(`${STARTER}\n  ${text}`);
      expect(read(joined).edges.at(-1)).toMatchObject({
        id: "r3",
        source: "Customer",
        target: "OrderItem",
        kind,
      });
    }
    // The kinds to pick are the ones two classes can have: the line of a note is none of them.
    expect(classStructure.links.map((link) => link.kind)).toEqual(Object.keys(written));
    // A class has relations with itself.
    for (const kind of Object.keys(written)) {
      const own = connect(STARTER, "Order", "Order", kind);
      expect(read(own).edges.at(-1)).toMatchObject({ source: "Order", target: "Order", kind });
    }
    expect(connect(STARTER, "Order", "Order")).toBe(`${STARTER}\n  Order --> Order`);
    // Names that need backticks get them; a relation goes after the namespaces.
    expect(connect(PACKAGES, "Access Role", "Admin", "dependency")).toBe(
      `${PACKAGES}\n  \`Access Role\` ..> Admin`,
    );
    // A note at either end becomes the note of the class at the other.
    const note = add(STARTER, { kind: "note", label: "Paid first" });
    for (const joined of [
      connect(note.source, "Order", note.id),
      connect(note.source, note.id, "Order", "anchor"),
    ]) {
      expect(joined).toBe(`${STARTER}\n  note for Order "Paid first"`);
      expect(read(joined).edges.at(-1)).toMatchObject({
        id: "note1:link",
        source: "note1",
        target: "Order",
        kind: "anchor",
      });
    }
    expect(connect(SHOP, "note2", "Basket")).toContain(
      '  note for Basket "Has lines<br>and a status"',
    );
    // What is no class has no relation: a namespace, a lollipop, an id nothing has.
    expect(connect(SHOP, "ns:Sales", "Basket")).toBe(SHOP);
    expect(connect(SHOP, "interface1", "Basket")).toBe(SHOP);
    expect(connect(SHOP, "Order", "Nothing")).toBe(SHOP);
    expect(connect(SHOP, "Order", "Basket", "anchor")).toBe(SHOP);
  });

  it("renames by a label and keeps the id that relations use", () => {
    const renamed = rename(STARTER, "Order", "Purchase order");
    expect(changed(STARTER, renamed)).toEqual({
      gone: ["  class Order {"],
      added: ['  class Order["Purchase order"] {'],
    });
    expect(read(renamed).nodes[0]).toMatchObject({ id: "Order", label: "Purchase order" });
    expect(read(renamed).edges).toEqual(read(STARTER).edges);
    // Another name replaces the label; the id as the name takes it away.
    expect(rename(renamed, "Order", "Sale")).toContain('  class Order["Sale"] {');
    expect(rename(renamed, "Order", "Order")).toBe(STARTER);
    expect(rename(SHOP, "Invoice", "Bill")).toContain('      class Invoice["Bill"]\n');
    expect(rename(SHOP, "Basket", "Cart")).toContain('  class Basket~Item~["Cart"] { +items');
    const special = rename(STARTER, "Customer", 'A "big"\n<client> [x]');
    expect(special).toContain('  class Customer["A #quot;big#quot; #lt;client#gt; [x]"]\n');
    expect(read(special).nodes[2].label).toBe('A "big" <client> [x]');

    // A class that only relations name gets its statement after the line it first stands on.
    const undeclared = rename(RELATIONS, "Dog", "Hound");
    expect(changed(RELATIONS, undeclared)).toEqual({ gone: [], added: ['\tclass Dog["Hound"]'] });
    expect(undeclared.split("\n")[2]).toBe('\tclass Dog["Hound"]');
    expect(ids(undeclared)).toEqual(ids(RELATIONS));
    expect(relations(undeclared)).toEqual(relations(RELATIONS));

    expect(rename(SHOP, "ns:Sales", "Sales [EU]")).toContain(
      '  namespace Sales["Sales [EU#93;"] {\n',
    );
    expect(
      read(rename(SHOP, "ns:Sales", "Sales [EU]")).nodes.find((node) => node.id === "ns:Sales")!
        .label,
    ).toBe("Sales [EU]");
    expect(rename(SHOP, "ns:Sales.Billing", "Accounts")).toContain(
      '    namespace Billing["Accounts"] {\n',
    );
    expect(rename(rename(SHOP, "ns:Sales", "Vertrieb"), "ns:Sales", "Sales")).toBe(SHOP);
    expect(
      read(rename(PACKAGES, "ns:app.model", "Model")).nodes.find(
        (node) => node.id === "ns:app.model",
      )!.label,
    ).toBe("Model");
    // `app` is only implied by the dotted names: there is no statement for a label.
    expect(rename(PACKAGES, "ns:app", "Application")).toBe(PACKAGES);

    expect(rename(SHOP, "note2", "Lines only")).toContain('  note for Order "Lines only"\n');
    expect(rename(SHOP, "note1", 'Say "hi"')).toContain('      note "Say #quot;hi#quot;"\n');
    const ball = rename(SHOP, "interface1", "Print Job");
    expect(ball).toContain("  `Print Job` ()-- Invoice\n");
    expect(read(ball).nodes.find((node) => node.id === "interface1")!.label).toBe("Print Job");
    expect(rename("classDiagram\n  Shape --() Drawable : draws", "interface1", "Paintable")).toBe(
      "classDiagram\n  Shape --() Paintable : draws",
    );
    expect(rename(SHOP, "Nothing", "Name")).toBe(SHOP);
  });

  it("labels relations and keeps their multiplicities", () => {
    expect(label(STARTER, "r2", "contains")).toBe(`${STARTER} : contains`);
    expect(changed(STARTER, label(STARTER, "r1", "orders"))).toEqual({
      gone: ['  Customer "1" --> "*" Order : places'],
      added: ['  Customer "1" --> "*" Order : orders'],
    });
    expect(label(STARTER, "r1", "")).toContain('  Customer "1" --> "*" Order\n');
    expect(read(label(STARTER, "r1", "")).edges[0].label).toBeUndefined();
    const special = label(STARTER, "r1", ' uses <T>: "a|b"\nalways ');
    expect(special).toContain(
      '  Customer "1" --> "*" Order : uses #lt;T#gt;: #quot;a|b#quot;<br>always\n',
    );
    expect(read(special).edges[0].label).toBe('uses <T>: "a|b"<br>always');
    expect(label(RELATIONS, "r13", "swims in")).toContain('\tDuck "1" <--> "many" Pond : swims in');
    expect(label(SHOP, "r5", "prints")).toContain("  Printable ()-- Invoice : prints\n");
    // The line of a note carries no label.
    expect(label(SHOP, "note2:link", "about")).toBe(SHOP);
    expect(label(SHOP, "r99", "nothing")).toBe(SHOP);
  });

  it("relinks between the same ends, the first end staying the first", () => {
    expect(changed(STARTER, relink(STARTER, "r1", "aggregation"))).toEqual({
      gone: ['  Customer "1" --> "*" Order : places'],
      added: ['  Customer "1" o-- "*" Order : places'],
    });
    expect(relink(STARTER, "r2", "inheritance")).toContain('  Order "1" --|> "*" OrderItem');
    expect(relink(STARTER, "r2", "composition")).toBe(STARTER);
    expect(relink(STARTER, "r2", "anchor")).toBe(STARTER);
    expect(relink(STARTER, "r2", "nothing")).toBe(STARTER);
    // A relation written from its second end stays written that way.
    expect(relink(RELATIONS, "r1", "realization")).toContain("\tAnimal <|.. Dog\n");
    expect(relink(RELATIONS, "r1", "composition")).toContain("\tAnimal --* Dog\n");
    expect(relink(RELATIONS, "r1", "association")).toContain("\tAnimal <-- Dog\n");
    expect(relink(RELATIONS, "r4", "aggregation")).toContain("\tWheel --o Truck\n");
    expect(relink(RELATIONS, "r4", "dependency")).toContain("\tWheel <.. Truck\n");
    expect(relink(RELATIONS, "r7", "inheritance")).toContain("\tCar <|-- Owner\n");
    expect(relink(RELATIONS, "r11", "composition")).toContain("\tDog *-- Cat\n");
    expect(relink(RELATIONS, "r13", "link")).toContain('\tDuck "1" -- "many" Pond : lives on');
    for (const link of classStructure.links)
      for (const edge of read(RELATIONS).edges) {
        const now = read(relink(RELATIONS, edge.id, link.kind)).edges.find(
          (other) => other.id === edge.id,
        )!;
        expect(now).toEqual({ ...edge, kind: link.kind });
      }
    // The relation that draws a lollipop, and the line of a note, are no kind to switch.
    expect(relink(SHOP, "r5", "association")).toBe(SHOP);
    expect(relink(SHOP, "note2:link", "association")).toBe(SHOP);
  });

  it("removes classes with their relations, notes and styling", () => {
    const without = remove(SHOP, ["Order"]);
    expect(changed(SHOP, without)).toEqual({
      gone: [
        "    class Order {",
        "      <<abstract>>",
        "      +id: string",
        "      %% money",
        "      +total(): number",
        "  Order ..|> Payable",
        '  Basket "1" o-- "0..*" Order : holds',
        "  Order *-- Line",
        "  Invoice --> Order : bills",
        '  note for Order "Has lines<br>and a status"',
        "  Order --> Status",
        '  click Order href "https://example.com/order"',
        "  style Order fill:#eee",
      ],
      // `Line` stood only in a relation of the class: it stays, declared.
      added: ["  class Line"],
    });
    expect(ids(without)).toEqual(ids(SHOP).filter((id) => id !== "Order" && id !== "note2"));
    expect(relations(without)).toEqual(["interface1 lollipop Invoice"]);
    expect(without).toContain("  %% the sales side\n  namespace Sales {\n    class Status {");

    const starter = remove(STARTER, ["Order"]);
    expect(starter).toBe(
      "classDiagram\n  class OrderItem {\n    +quantity: number\n  }\n  class Customer",
    );
    // A class with its members and annotation outside its body, and one in backticks.
    const payable = remove(SHOP, ["Payable"]);
    expect(changed(SHOP, payable)).toEqual({
      gone: [
        "  class Payable",
        "  <<interface>> Payable",
        "  Payable : +pay(amount) bool",
        "  Order ..|> Payable",
      ],
      added: [],
    });
    expect(ids(remove(PACKAGES, ["Access Role"]))).toEqual(
      ids(PACKAGES).filter((id) => id !== "Access Role"),
    );
    expect(remove(PACKAGES, ["Admin"])).not.toContain("+grant() }");
    expect(remove(SHOP, ["Nothing"])).toBe(SHOP);
  });

  it("removes relations and keeps the classes they joined", () => {
    expect(remove(STARTER, ["r1"])).toBe(
      STARTER.replace('  Customer "1" --> "*" Order : places\n', ""),
    );
    const cut = remove(RELATIONS, ["r1", "r11"]);
    expect(changed(RELATIONS, cut)).toEqual({
      gone: ["\tAnimal <|-- Dog", "\tDog -- Cat"],
      added: ["\tclass Animal"],
    });
    expect(cut.split("\n")[1]).toBe("\tclass Animal");
    expect(ids(cut).toSorted()).toEqual(ids(RELATIONS).toSorted());
    expect(relations(cut)).toEqual(
      relations(RELATIONS).filter((_, index) => index !== 0 && index !== 10),
    );
    // Both ends of a lone relation stay, with their type arguments.
    expect(remove("classDiagram\n  List~T~ --> Item", ["r1"])).toBe(
      "classDiagram\n  class List~T~\n  class Item",
    );
  });

  it("removes notes, their lines and lollipops", () => {
    expect(changed(SHOP, remove(SHOP, ["note1"]))).toEqual({
      gone: ['      note "Printed monthly"'],
      added: [],
    });
    const freed = remove(SHOP, ["note2:link"]);
    expect(changed(SHOP, freed)).toEqual({
      gone: ['  note for Order "Has lines<br>and a status"'],
      added: ['  note "Has lines<br>and a status"'],
    });
    expect(read(freed).edges.some((edge) => edge.kind === "anchor")).toBe(false);
    expect(ids(freed)).toEqual(ids(SHOP));
    const ball = remove(SHOP, ["interface1"]);
    expect(changed(SHOP, ball)).toEqual({ gone: ["  Printable ()-- Invoice"], added: [] });
    expect(ids(ball)).toEqual(ids(SHOP).filter((id) => id !== "interface1"));
    // A class that only its note names stays when the note goes.
    expect(remove('classDiagram\n  note for Lone "Alone"', ["note1"])).toBe(
      "classDiagram\n  class Lone",
    );
    expect(remove('classDiagram\n  note for Lone "Alone"', ["note1:link"])).toBe(
      'classDiagram\n  note "Alone"\n  class Lone',
    );
  });

  it("removes namespaces with what they hold, nested ones too", () => {
    const inner = remove(SHOP, ["ns:Sales.Billing"]);
    expect(changed(SHOP, inner)).toEqual({
      gone: [
        "    namespace Billing {",
        '      class Invoice["Tax invoice"]',
        '      note "Printed monthly"',
        "  Invoice --> Order : bills",
        "  Printable ()-- Invoice",
      ],
      added: [],
    });
    expect(inner).toContain("      PAID\n    }\n  }\n\n  class Payable");
    // The note that is left is the first now.
    expect(ids(inner)).toEqual([
      "ns:Sales",
      "Order",
      "Status",
      "Payable",
      "Basket",
      "Line",
      "note1",
    ]);
    const outer = remove(SHOP, ["ns:Sales"]);
    expect(ids(outer)).toEqual(["Payable", "Basket", "Line"]);
    expect(relations(outer)).toEqual([]);
    expect(outer).toContain("  %% the sales side\n\n  class Payable\n");
    // A namespace that dotted names imply goes with every block below it.
    expect(ids(remove(PACKAGES, ["ns:app"]))).toEqual(["Admin"]);
    expect(ids(remove(PACKAGES, ["ns:app.model"]))).toEqual(["ns:app", "ns:app.empty", "Admin"]);
    expect(ids(remove(PACKAGES, ["ns:app.empty"]))).toEqual(
      ids(PACKAGES).filter((id) => id !== "ns:app.empty"),
    );
    // Several at once, a part and what holds it among them.
    expect(ids(remove(SHOP, ["ns:Sales", "Order", "r2", "note2", "Basket"]))).toEqual([
      "Payable",
      "Line",
    ]);
  });

  it("leaves a source the parser reads, whatever is removed or changed", () => {
    for (const source of SOURCES) {
      const { nodes, edges } = read(source);
      for (const part of [...nodes, ...edges]) {
        const without = remove(source, [part.id]);
        expect(() => parseUml(without), `${part.id}\n${without}`).not.toThrow();
      }
      for (const node of nodes) {
        const without = ids(remove(source, [node.id]));
        // Notes and lollipops are numbered anew; everything else that was not removed is still there.
        const stable = (id: string) => !/^(note|interface)\d+$/.test(id);
        const held = (id: string) => {
          for (let at = nodes.find((other) => other.id === id); at;)
            if (at.id === node.id) return true;
            else at = nodes.find((other) => other.id === at!.parent);
          return false;
        };
        expect(without.filter(stable).toSorted(), node.id).toEqual(
          nodes
            .map((other) => other.id)
            .filter((id) => stable(id) && !held(id))
            .toSorted(),
        );
        expect(() => parseUml(rename(source, node.id, 'New "name" <1>')), node.id).not.toThrow();
        expect(() =>
          parseUml(add(source, { kind: "class", parent: node.id }).source),
        ).not.toThrow();
        if (!node.group && node.kind !== "note" && !/^interface\d+$/.test(node.id)) {
          expect(() => parseUml(addClassMember(source, node.id, "+added(): void"))).not.toThrow();
          expect(() => parseUml(setClassMembers(source, node.id, ["+only"]))).not.toThrow();
          expect(() => parseUml(setClassKind(source, node.id, "interface"))).not.toThrow();
        }
      }
      for (const edge of edges) {
        expect(() => parseUml(label(source, edge.id, "a: <b>"))).not.toThrow();
        for (const link of classStructure.links)
          expect(() => parseUml(relink(source, edge.id, link.kind))).not.toThrow();
      }
      for (const piece of classStructure.pieces)
        expect(() =>
          parseUml(add(source, { kind: piece.kind, label: "New one" }).source),
        ).not.toThrow();
      expect(remove(source, [])).toBe(source.replace(/\r\n?/g, "\n"));
    }
  });
});

describe("the members of a class", () => {
  it("lists them as the source writes them", () => {
    expect(classMembers(STARTER, "Order")).toEqual(["+id: string", "+total(): number"]);
    expect(classMembers(STARTER, "Customer")).toEqual([]);
    expect(classMembers(STARTER, "Nothing")).toEqual([]);
    // Annotations and comments are no members; members outside the body and on a line with a brace are.
    expect(classMembers(SHOP, "Order")).toEqual(["+id: string", "+total(): number"]);
    expect(classMembers(SHOP, "Status")).toEqual(["OPEN", "PAID"]);
    expect(classMembers(SHOP, "Payable")).toEqual(["+pay(amount) bool"]);
    expect(classMembers(SHOP, "Basket")).toEqual(["+items: List~Item~"]);
    expect(classMembers(PACKAGES, "Admin")).toEqual(["+grant()"]);
    expect(classMembers(PACKAGES, "User")).toEqual(["+name"]);
  });

  it("adds a member to a body, opening one where there is none", () => {
    expect(changed(STARTER, addClassMember(STARTER, "Order", "-paid: boolean"))).toEqual({
      gone: [],
      added: ["    -paid: boolean"],
    });
    expect(addClassMember(STARTER, "Order", "-paid: boolean")).toContain(
      "    +total(): number\n    -paid: boolean\n  }\n  class OrderItem",
    );
    const opened = addClassMember(STARTER, "Customer", " +name: string\n");
    expect(changed(STARTER, opened)).toEqual({
      gone: ["  class Customer"],
      added: ["  class Customer {", "    +name: string"],
    });
    expect(opened).toContain("  class Customer {\n    +name: string\n  }\n  Customer");
    expect(parseClassDiagram(opened).classes.get("Customer")!.attributes[0].text).toBe(
      "+name: string",
    );
    // A body on one line, and one that closes on the line of its last member, open over lines.
    const basket = addClassMember(SHOP, "Basket", "+add(item: Item)");
    expect(basket).toContain(
      "  class Basket~Item~ {\n    +items: List~Item~\n    +add(item: Item)\n  }\n  Payable",
    );
    expect(classMembers(basket, "Basket")).toEqual(["+items: List~Item~", "+add(item: Item)"]);
    const admin = addClassMember(PACKAGES, "Admin", "+revoke()");
    expect(admin).toContain("  class Admin{\n    +grant()\n    +revoke()\n  }\n  Admin --|> User");
    // A label, an annotation on the statement and a namespace around it stay.
    expect(addClassMember(SHOP, "Invoice", "+number")).toContain(
      '      class Invoice["Tax invoice"] {\n        +number\n      }\n      note',
    );
    expect(addClassMember(PACKAGES, "User", "+email")).toContain(
      "    class User <<interface>> {\n      +email\n    }\n",
    );
    expect(classMembers(addClassMember(PACKAGES, "User", "+email"), "User")).toEqual([
      "+email",
      "+name",
    ]);
    // A class that only relations name is declared after the line it first stands on.
    const dog = addClassMember(RELATIONS, "Dog", "+bark()");
    expect(dog.split("\n").slice(0, 5)).toEqual([
      "classDiagram",
      "\tAnimal <|-- Dog",
      "\tclass Dog {",
      "\t\t+bark()",
      "\t}",
    ]);
    expect(ids(dog)).toEqual(ids(RELATIONS));
    // A closing brace would end the body: a member does not end in one.
    expect(classMembers(addClassMember(STARTER, "Customer", "+tags: Set{}"), "Customer")).toEqual([
      "+tags: Set{",
    ]);
    expect(addClassMember(STARTER, "Customer", "  ")).toBe(STARTER);
    expect(addClassMember(STARTER, "Nothing", "+x")).toBe(STARTER);
  });

  it("replaces the members and keeps annotations and comments", () => {
    const order = setClassMembers(SHOP, "Order", ["+number: int", "+cancel()"]);
    expect(changed(SHOP, order)).toEqual({
      gone: ["      +id: string", "      +total(): number"],
      added: ["      +number: int", "      +cancel()"],
    });
    expect(order).toContain(
      "    class Order {\n      <<abstract>>\n      %% money\n      +number: int\n      +cancel()\n    }\n",
    );
    expect(read(order).nodes.find((node) => node.id === "Order")!.kind).toBe("abstract");
    // Members outside the body move into it.
    const payable = setClassMembers(SHOP, "Payable", ["+pay()", "+refund()"]);
    expect(changed(SHOP, payable)).toEqual({
      gone: ["  class Payable", "  Payable : +pay(amount) bool"],
      added: ["  class Payable {", "    +pay()", "    +refund()"],
    });
    expect(classMembers(payable, "Payable")).toEqual(["+pay()", "+refund()"]);
    expect(read(payable).nodes.find((node) => node.id === "Payable")!.kind).toBe("interface");
    // None leaves the body empty; none for a class without members changes nothing.
    expect(setClassMembers(STARTER, "OrderItem", [])).toContain("  class OrderItem {\n  }\n");
    expect(setClassMembers(STARTER, "Customer", [])).toBe(STARTER);
    expect(setClassMembers(STARTER, "Customer", ["", " "])).toBe(STARTER);
    for (const source of SOURCES)
      for (const node of read(source).nodes) {
        const members = classMembers(source, node.id),
          again = setClassMembers(source, node.id, members);
        expect(classMembers(again, node.id)).toEqual(members);
        expect(ids(again)).toEqual(ids(source));
      }
  });

  it("makes a class one of another kind", () => {
    expect(setClassKind(STARTER, "Order", "interface")).toContain(
      "  class Order {\n    <<interface>>\n    +id: string\n",
    );
    expect(setClassKind(STARTER, "Customer", "enumeration")).toContain(
      "  class Customer {\n    <<enumeration>>\n  }\n",
    );
    expect(setClassKind(STARTER, "Customer", "class")).toBe(STARTER);
    expect(setClassKind(STARTER, "Customer", "nothing")).toBe(STARTER);
    const kinds = (source: string, id: string) =>
      parseClassDiagram(source).classes.get(id)!.annotations;
    // Whichever way the annotation is written, it goes.
    expect(changed(SHOP, setClassKind(SHOP, "Order", "class"))).toEqual({
      gone: ["      <<abstract>>"],
      added: [],
    });
    expect(changed(SHOP, setClassKind(SHOP, "Payable", "class"))).toEqual({
      gone: ["  <<interface>> Payable"],
      added: [],
    });
    expect(changed(PACKAGES, setClassKind(PACKAGES, "User", "class"))).toEqual({
      gone: ["    class User <<interface>>"],
      added: ["    class User"],
    });
    expect(kinds(setClassKind(SHOP, "Status", "interface"), "Status")).toEqual(["interface"]);
    expect(kinds(setClassKind(SHOP, "Payable", "abstract"), "Payable")).toEqual(["abstract"]);
    expect(kinds(setClassKind(PACKAGES, "User", "abstract"), "User")).toEqual(["abstract"]);
    expect(
      read(setClassKind(RELATIONS, "Walker", "interface")).nodes.find(
        (node) => node.id === "Walker",
      )!.kind,
    ).toBe("interface");
    // Another annotation is not a kind, and stays.
    const service = "classDiagram\n  class Api { <<service>> }";
    expect(kinds(setClassKind(service, "Api", "interface"), "Api")).toEqual([
      "interface",
      "service",
    ]);
    expect(setClassKind(service, "Api", "class")).toBe(service);
  });

  it("reads and sets the stereotype, which is no member", () => {
    const service = "classDiagram\n  class Api {\n    <<service>>\n  }";
    expect(classStereotype(service, "Api")).toBe("service");
    expect(classMembers(service, "Api")).toEqual([]);
    expect(classStereotype(STARTER, "Order")).toBe("");
    expect(classStereotype(STARTER, "Nothing")).toBe("");
    // What makes a class an interface or abstract is its kind, not its stereotype.
    expect(classStereotype(SHOP, "Order")).toBe("");
    expect(classStereotype(SHOP, "Payable")).toBe("");

    const typed = setClassStereotype(STARTER, "Order", " <<service>> ");
    expect(changed(STARTER, typed)).toEqual({ gone: [], added: ["    <<service>>"] });
    expect(typed).toContain("  class Order {\n    <<service>>\n    +id: string\n");
    expect(classStereotype(typed, "Order")).toBe("service");
    expect(classMembers(typed, "Order")).toEqual(classMembers(STARTER, "Order"));
    expect(setClassStereotype(typed, "Order", "service")).toBe(typed);
    expect(setClassStereotype(typed, "Order", "«entity»")).toBe(
      typed.replace("<<service>>", "<<entity>>"),
    );
    expect(setClassStereotype(typed, "Order", "")).toBe(STARTER);
    expect(setClassStereotype(STARTER, "Order", " ")).toBe(STARTER);
    expect(setClassStereotype(STARTER, "Customer", "entity")).toContain(
      "  class Customer {\n    <<entity>>\n  }\n",
    );
    // The members of the panel go and come without the stereotype.
    expect(classStereotype(setClassMembers(typed, "Order", ["+only"]), "Order")).toBe("service");

    // Beside the annotation of the kind, which stays.
    const both = setClassStereotype(SHOP, "Order", "aggregate");
    expect(changed(SHOP, both)).toEqual({ gone: [], added: ["      <<aggregate>>"] });
    expect(classStereotype(both, "Order")).toBe("aggregate");
    expect(read(both).nodes.find((node) => node.id === "Order")!.kind).toBe("abstract");
    expect(setClassStereotype(both, "Order", "")).toBe(SHOP);
    expect(setClassKind(both, "Order", "class")).toContain(
      "    class Order {\n      <<aggregate>>\n      +id: string\n",
    );
    // However it is written.
    const forms = "classDiagram\n  class A <<service>>\n  <<entity>> B\n  class B";
    expect(setClassStereotype(forms, "A", "")).toContain("  class A\n");
    expect(setClassStereotype(forms, "B", "")).toBe(forms.replace("  <<entity>> B\n", ""));
    // Typed among the members it is the stereotype, and goes from there.
    const listed = setClassMembers(STARTER, "Customer", ["<<service>>", "+name"]);
    expect(classStereotype(listed, "Customer")).toBe("service");
    expect(classMembers(listed, "Customer")).toEqual(["+name"]);
    expect(setClassMembers(listed, "Customer", ["+name", "+age"])).toContain(
      "  class Customer {\n    <<service>>\n    +name\n    +age\n  }\n",
    );
    expect(setClassStereotype(listed, "Customer", "")).toContain(
      "  class Customer {\n    +name\n  }\n",
    );
    expect(setClassStereotype(forms, "A", "y")).toContain("  class A {\n    <<y>>\n  }\n");
    expect(classStereotype(setClassStereotype(forms, "B", "y"), "B")).toBe("y");
    // A stereotype that names a kind makes the class that kind.
    const made = setClassStereotype(service, "Api", "interface");
    expect(parseClassDiagram(made).classes.get("Api")!.annotations).toEqual(["interface"]);
    expect(classStereotype(made, "Api")).toBe("");
    expect(setClassStereotype(STARTER, "Nothing", "x")).toBe(STARTER);
    for (const source of SOURCES)
      for (const node of read(source).nodes) {
        if (node.group || node.kind === "note" || /^interface\d+$/.test(node.id)) continue;
        const set = setClassStereotype(source, node.id, "thing");
        expect(classStereotype(set, node.id), node.id).toBe("thing");
        expect(classMembers(set, node.id)).toEqual(classMembers(source, node.id));
        expect(read(set).nodes).toEqual(
          read(set).nodes.map((other, index) => ({
            ...read(source).nodes[index],
            line: other.line,
          })),
        );
        expect(classStereotype(setClassStereotype(set, node.id, ""), node.id)).toBe("");
      }
  });
});

/** A scene has a shape for every part and a wire for every join, and nothing else. */
async function inScene(source: string) {
  const { nodes, edges } = read(source),
    scene = await parseUml(source).layout(arialMeasure);
  expect(
    scene.shapes
      .map((shape) => shape.id)
      .filter((id) => !id.endsWith("#empty"))
      .toSorted(),
  ).toEqual(nodes.map((node) => node.id).toSorted());
  expect(scene.wires.map((wire) => wire.edge).toSorted()).toEqual(
    edges.map((edge) => edge.id).toSorted(),
  );
}

/** The joins without their lines. */
const joins = (source: string) => read(source).edges.map(({ line: _line, ...rest }) => rest);

describe("the ids of a class diagram", () => {
  const { retitle } = classStructure;

  it("gives a new part its first name as its id", async () => {
    const added = add(STARTER, { kind: "class" }),
      joined = connect(added.source, "Order", added.id),
      named = retitle!(joined, added.id, "Invoice");
    expect(named.id).toBe("Invoice");
    expect(named.source).toBe(
      `${STARTER.replace("  class Customer\n", "  class Customer\n  class Invoice\n")}\n  Order --> Invoice`,
    );
    await inScene(named.source);
    const face = add(named.source, { kind: "interface" }),
      payable = retitle!(connect(face.source, "Invoice", face.id), face.id, "Payable");
    expect(payable.id).toBe("Payable");
    expect(payable.source).toContain("  class Payable {\n    <<interface>>\n  }\n");
    expect(payable.source).toContain("\n  Invoice --> Payable");
    expect(payable.source).not.toContain("Interface1");
    // Several words are one id, shown under the name.
    expect(retitle!(added.source, added.id, "line item")).toEqual({
      source: added.source.replace("class Class1", 'class LineItem["line item"]'),
      id: "LineItem",
    });
    // A package, at the top and inside another.
    const group = add(STARTER, { kind: "package" });
    expect(retitle!(group.source, group.id, "billing")).toEqual({
      source: group.source.replace("namespace Package1 {", "namespace billing {"),
      id: "ns:billing",
    });
    const inner = add(SHOP, { kind: "package", parent: "ns:Sales" }),
      stock = retitle!(inner.source, inner.id, "Stock room");
    expect(stock.id).toBe("ns:Sales.StockRoom");
    expect(stock.source).toContain('    namespace StockRoom["Stock room"] {\n    }\n  }\n');
    await inScene(stock.source);
    // A name that is taken, or has no word for an id, is the label of the id it has.
    expect(retitle!(added.source, added.id, "Order")).toEqual({
      source: added.source.replace("class Class1", 'class Class1["Order"]'),
      id: "Class1",
    });
    expect(retitle!(added.source, added.id, "<?>")).toEqual({
      source: added.source.replace("class Class1", 'class Class1["#lt;?#gt;"]'),
      id: "Class1",
    });
    expect(retitle!(inner.source, inner.id, "Billing")).toEqual({
      source: inner.source.replace("namespace Package1 {", 'namespace Package1["Billing"] {'),
      id: "ns:Sales.Package1",
    });
    expect(retitle!(added.source, added.id, "Class1")).toEqual(added);
    // A note has no id to give: it gets its text.
    const note = add(STARTER, { kind: "note" });
    expect(retitle!(note.source, note.id, "Paid first")).toEqual({
      source: `${STARTER}\n  note "Paid first"`,
      id: "note1",
    });
    expect(retitle!(STARTER, "Nothing", "Name")).toEqual({ source: STARTER, id: "Nothing" });
    for (const source of SOURCES)
      for (const piece of classStructure.pieces.filter((piece) => piece.kind !== "note")) {
        const fresh = add(source, { kind: piece.kind }),
          titled = retitle!(fresh.source, fresh.id, "Brand new");
        expect(titled.id).toBe(piece.group ? "ns:BrandNew" : "BrandNew");
        expect(read(titled.source).nodes.find((node) => node.id === titled.id)).toMatchObject({
          label: "Brand new",
          kind: piece.kind,
        });
        expect(changed(source, titled.source).gone).toEqual([]);
      }
  });

  it("renames a class wherever the source names it", async () => {
    const purchase = renameClassId(STARTER, "Order", "Purchase");
    expect(changed(STARTER, purchase)).toEqual({
      gone: [
        "  class Order {",
        '  Customer "1" --> "*" Order : places',
        '  Order "1" *-- "*" OrderItem',
      ],
      added: [
        "  class Purchase {",
        '  Customer "1" --> "*" Purchase : places',
        '  Purchase "1" *-- "*" OrderItem',
      ],
    });
    // Relations, the note, the styling lines; not the text that only looks like it.
    const sale = renameClassId(SHOP, "Order", "Sale");
    expect(changed(SHOP, sale)).toEqual({
      gone: [
        "    class Order {",
        "  Order ..|> Payable",
        '  Basket "1" o-- "0..*" Order : holds',
        "  Order *-- Line",
        "  Invoice --> Order : bills",
        '  note for Order "Has lines<br>and a status"',
        "  Order --> Status",
        '  click Order href "https://example.com/order"',
        "  style Order fill:#eee",
      ],
      added: [
        "    class Sale {",
        "  Sale ..|> Payable",
        '  Basket "1" o-- "0..*" Sale : holds',
        "  Sale *-- Line",
        "  Invoice --> Sale : bills",
        '  note for Sale "Has lines<br>and a status"',
        "  Sale --> Status",
        '  click Sale href "https://example.com/order"',
        "  style Sale fill:#eee",
      ],
    });
    expect(parseClassDiagram(sale).links.get("Sale")).toBe("https://example.com/order");
    await inScene(sale);
    // The annotation and the member written outside the body.
    const billable = renameClassId(SHOP, "Payable", "Billable");
    expect(changed(SHOP, billable).added).toEqual([
      "  class Billable",
      "  <<interface>> Billable",
      "  Billable : +pay(amount) bool",
      "  Order ..|> Billable",
    ]);
    expect(read(billable).nodes.find((node) => node.id === "Billable")!.kind).toBe("interface");
    expect(classMembers(billable, "Billable")).toEqual(["+pay(amount) bool"]);
    // Type arguments stay, backticks come and go, a class may stand at both ends.
    expect(renameClassId(SHOP, "Basket", "Cart")).toContain(
      "  class Cart~Item~ { +items: List~Item~ }\n",
    );
    expect(renameClassId("classDiagram\n  List~T~ --> Item", "List", "Bag")).toBe(
      "classDiagram\n  Bag~T~ --> Item",
    );
    const role = renameClassId(PACKAGES, "Access Role", "Role");
    expect(role).toContain("    class Role\n");
    expect(role).toContain("  Role --> User");
    const user = renameClassId(PACKAGES, "User", "End User");
    expect(changed(PACKAGES, user).added).toEqual([
      "    class `End User` <<interface>>",
      "  Admin --|> `End User`",
      "  `End User` : +name",
      "  `Access Role` --> `End User`",
    ]);
    expect(read(user).nodes.find((node) => node.id === "End User")).toMatchObject({
      kind: "interface",
      parent: "ns:app.model",
    });
    expect(renameClassId("classDiagram\n  Circle --> Circle : next", "Circle", "Ring")).toBe(
      "classDiagram\n  Ring --> Ring : next",
    );
    // The ball of a lollipop is no class, whatever it is called.
    expect(renameClassId(SHOP, "Printable", "Paper")).toBe(SHOP);
    // An id that is taken, cannot be written or is a word of the syntax is refused.
    for (const name of [
      "Customer",
      "Order",
      "",
      " ",
      "note1",
      "interface2",
      "ns:x",
      "class",
      "a`b",
    ])
      expect(renameClassId(STARTER, "Order", name), name).toBe(STARTER);
    expect(renameClassId(STARTER, "Nothing", "Something")).toBe(STARTER);
    // A name in backticks has no type arguments, and a note names its class without a space.
    expect(renameClassId(SHOP, "Basket", "My Basket")).toBe(SHOP);
    expect(renameClassId(SHOP, "Order", "Big Order")).toBe(SHOP);
    for (const source of SOURCES) {
      const { nodes } = read(source),
        classes = nodes.filter(
          (node) => !node.group && node.kind !== "note" && !/^interface\d+$/.test(node.id),
        );
      for (const node of classes) {
        const renamed = renameClassId(source, node.id, "Renamed9"),
          swap = (id: string) => (id === node.id ? "Renamed9" : id);
        expect(ids(renamed).toSorted(), node.id).toEqual(ids(source).map(swap).toSorted());
        expect(joins(renamed)).toEqual(
          joins(source).map((edge) => ({
            ...edge,
            source: swap(edge.source),
            target: swap(edge.target),
          })),
        );
        expect(read(renamed).nodes.find((other) => other.id === "Renamed9")).toMatchObject({
          kind: node.kind,
          parent: node.parent,
          label: node.label === node.id ? "Renamed9" : node.label,
        });
        expect(classMembers(renamed, "Renamed9")).toEqual(classMembers(source, node.id));
      }
      await inScene(renameClassId(source, classes[0].id, "Renamed9"));
    }
  });

  it("renames a namespace in every statement that opens it", async () => {
    const sales = renameClassId(SHOP, "ns:Sales", "Vertrieb");
    expect(changed(SHOP, sales)).toEqual({
      gone: ["  namespace Sales {"],
      added: ["  namespace Vertrieb {"],
    });
    expect(ids(sales)).toEqual(ids(SHOP).map((id) => id.replace("ns:Sales", "ns:Vertrieb")));
    await inScene(sales);
    for (const name of ["Accounts", "ns:Accounts", "ns:Sales.Accounts", "Sales.Accounts"])
      expect(changed(SHOP, renameClassId(SHOP, "ns:Sales.Billing", name))).toEqual({
        gone: ["    namespace Billing {"],
        added: ["    namespace Accounts {"],
      });
    // A label stays; a namespace written as part of a dotted name is renamed there.
    expect(renameClassId(rename(SHOP, "ns:Sales", "Our sales"), "ns:Sales", "Shop")).toContain(
      '  namespace Shop["Our sales"] {\n',
    );
    const core = renameClassId(PACKAGES, "ns:app", "core");
    expect(changed(PACKAGES, core)).toEqual({
      gone: ["  namespace app.model {", "  namespace app.empty { }"],
      added: ["  namespace core.model {", "  namespace core.empty { }"],
    });
    expect(ids(core)).toEqual(ids(PACKAGES).map((id) => id.replace("ns:app", "ns:core")));
    expect(renameClassId(PACKAGES, "ns:app.model", "domain")).toContain(
      "  namespace app.domain {\n",
    );
    const nested = "classDiagram\n  namespace a {\n    namespace b.c {\n      class X\n    }\n  }";
    expect(renameClassId(nested, "ns:a.b", "d")).toContain("    namespace d.c {\n");
    expect(renameClassId(nested, "ns:a", "z")).toContain("  namespace z {\n    namespace b.c {\n");
    // A name a namespace beside it has, and one that is no single name, is refused.
    expect(renameClassId(PACKAGES, "ns:app.model", "empty")).toBe(PACKAGES);
    for (const name of ["Sales", "a b", "a.b", "", "x-y"])
      expect(renameClassId(SHOP, "ns:Sales", name), name).toBe(SHOP);
    expect(renameClassId(SHOP, "ns:Nothing", "Thing")).toBe(SHOP);
  });
});

describe("the relations of a class diagram", () => {
  it("turns a relation round, each multiplicity with its class", () => {
    const turned = reverseClassRelation(STARTER, "r1");
    expect(changed(STARTER, turned)).toEqual({
      gone: ['  Customer "1" --> "*" Order : places'],
      added: ['  Order "*" --> "1" Customer : places'],
    });
    expect(reverseClassRelation(turned, "r1")).toBe(STARTER);
    expect(reverseClassRelation(RELATIONS, "r1")).toContain("\tDog <|-- Animal\n");
    expect(reverseClassRelation(RELATIONS, "r2")).toContain("\tPet --|> Dog\n");
    expect(reverseClassRelation(RELATIONS, "r6")).toContain("\tCar --> Driver : drives\n");
    expect(reverseClassRelation(RELATIONS, "r13")).toContain(
      '\tPond "many" <--> "1" Duck : lives on',
    );
    expect(reverseClassRelation(SHOP, "r2")).toContain('  Order "0..*" o-- "1" Basket : holds\n');
    // The relation that draws a lollipop, the line of a note and what is no relation stay.
    expect(reverseClassRelation(SHOP, "r5")).toBe(SHOP);
    expect(reverseClassRelation(SHOP, "note2:link")).toBe(SHOP);
    expect(reverseClassRelation(SHOP, "r99")).toBe(SHOP);
    for (const source of SOURCES)
      for (const edge of read(source).edges) {
        if (edge.kind === "lollipop" || edge.kind === "anchor") continue;
        const turned = reverseClassRelation(source, edge.id),
          before = classRelationEnds(source, edge.id)!;
        expect(joins(turned), edge.id).toEqual(
          joins(source).map((other) =>
            other.id === edge.id ? { ...other, source: other.target, target: other.source } : other,
          ),
        );
        expect(classRelationEnds(turned, edge.id)).toEqual({
          from: before.to,
          to: before.from,
          fromMultiplicity: before.toMultiplicity,
          toMultiplicity: before.fromMultiplicity,
        });
        expect(ids(turned).toSorted()).toEqual(ids(source).toSorted());
      }
  });

  it("reads the ends of a relation and sets their multiplicities", () => {
    expect(classRelationEnds(STARTER, "r1")).toEqual({
      from: "Customer",
      to: "Order",
      fromMultiplicity: "1",
      toMultiplicity: "*",
    });
    expect(classRelationEnds(SHOP, "r3")).toEqual({
      from: "Order",
      to: "Line",
      fromMultiplicity: "",
      toMultiplicity: "",
    });
    expect(classRelationEnds(SHOP, "r5")).toMatchObject({ from: "interface1", to: "Invoice" });
    expect(classRelationEnds(SHOP, "note2:link")).toBeUndefined();
    expect(classRelationEnds(SHOP, "r99")).toBeUndefined();

    expect(changed(STARTER, setClassMultiplicity(STARTER, "r1", "from", "0..1"))).toEqual({
      gone: ['  Customer "1" --> "*" Order : places'],
      added: ['  Customer "0..1" --> "*" Order : places'],
    });
    expect(setClassMultiplicity(STARTER, "r1", "to", ' "1..*" ')).toContain(
      '  Customer "1" --> "1..*" Order : places\n',
    );
    expect(setClassMultiplicity(STARTER, "r1", "to", "")).toContain(
      '  Customer "1" --> Order : places\n',
    );
    expect(setClassMultiplicity(STARTER, "r1", "from", " ")).toContain(
      '  Customer --> "*" Order : places\n',
    );
    // Where there was none, and where the relation is written without spaces.
    const plain = connect(STARTER, "Customer", "OrderItem");
    expect(setClassMultiplicity(plain, "r3", "to", "*")).toBe(
      `${STARTER}\n  Customer --> "*" OrderItem`,
    );
    expect(setClassMultiplicity(plain, "r3", "from", "1")).toBe(
      `${STARTER}\n  Customer "1" --> OrderItem`,
    );
    const tight = setClassMultiplicity(
      setClassMultiplicity("classDiagram\n  A-->B", "r1", "from", "1"),
      "r1",
      "to",
      "many",
    );
    expect(classRelationEnds(tight, "r1")).toEqual({
      from: "A",
      to: "B",
      fromMultiplicity: "1",
      toMultiplicity: "many",
    });
    // The kind and the label stay through it, and the multiplicities through a change of kind.
    expect(read(setClassMultiplicity(STARTER, "r1", "to", "2")).edges[0]).toEqual(
      read(STARTER).edges[0],
    );
    expect(classRelationEnds(relink(STARTER, "r1", "aggregation"), "r1")).toEqual(
      classRelationEnds(STARTER, "r1"),
    );
    // The value it has, and what is no relation: nothing changes.
    expect(setClassMultiplicity(STARTER, "r1", "from", "1")).toBe(STARTER);
    expect(setClassMultiplicity(STARTER, "r2", "to", "*")).toBe(STARTER);
    expect(setClassMultiplicity(SHOP, "note2:link", "to", "1")).toBe(SHOP);
    expect(setClassMultiplicity(SHOP, "r99", "to", "1")).toBe(SHOP);
  });

  it("marks the joins that have no kind to choose and no label to edit", () => {
    const edges: ClassEdge[] = read(SHOP).edges,
      kinds = new Set(classStructure.links.map((link) => link.kind));
    expect(edges.filter((edge) => !kinds.has(edge.kind)).map((edge) => edge.id)).toEqual([
      "r5",
      "note2:link",
    ]);
    expect(edges.filter((edge) => edge.fixedLabel).map((edge) => edge.id)).toEqual(["note2:link"]);
    for (const edge of edges)
      for (const link of classStructure.links) {
        const relinked = relink(SHOP, edge.id, link.kind);
        if (!kinds.has(edge.kind)) expect(relinked).toBe(SHOP);
        else
          expect(read(relinked).edges.find((other) => other.id === edge.id)!.kind).toBe(link.kind);
      }
  });
});

describe("the places of the parts of a class diagram", () => {
  it("copies a class with its members and stereotype, without its relations", async () => {
    const order = duplicateClass(STARTER, "Order");
    expect(order.id).toBe("Order2");
    expect(order.source).toBe(
      STARTER.replace(
        "  }\n  class OrderItem",
        "  }\n  class Order2 {\n    +id: string\n    +total(): number\n  }\n  class OrderItem",
      ),
    );
    expect(duplicateClass(order.source, "Order").id).toBe("Order3");
    expect(duplicateClass(STARTER, "Customer")).toEqual({
      source: STARTER.replace("  class Customer\n", "  class Customer\n  class Customer2\n"),
      id: "Customer2",
    });
    // In its namespace, with its label; the annotation and members written outside its body.
    const invoice = duplicateClass(SHOP, "Invoice");
    expect(changed(SHOP, invoice.source)).toEqual({
      gone: [],
      added: ['      class Invoice2["Tax invoice"]'],
    });
    expect(read(invoice.source).nodes.find((node) => node.id === "Invoice2")).toMatchObject({
      label: "Tax invoice",
      parent: "ns:Sales.Billing",
    });
    const payable = duplicateClass(SHOP, "Payable");
    expect(payable.source).toContain(
      "  class Payable\n  class Payable2 {\n    <<interface>>\n    +pay(amount) bool\n  }\n  <<interface>> Payable\n",
    );
    const abstract = duplicateClass(SHOP, "Order");
    expect(abstract.source).toContain(
      "    class Order2 {\n      <<abstract>>\n      +id: string\n      +total(): number\n    }\n    class Status {",
    );
    expect(duplicateClass(SHOP, "Basket").source).toContain(
      "  class Basket2~Item~ {\n    +items: List~Item~\n  }\n",
    );
    // A class that only relations name is declared first; a name in backticks is one word.
    const dog = duplicateClass(RELATIONS, "Dog");
    expect(dog.source.split("\n").slice(1, 4)).toEqual([
      "\tAnimal <|-- Dog",
      "\tclass Dog",
      "\tclass Dog2",
    ]);
    const role = duplicateClass(PACKAGES, "Access Role");
    expect(role.id).toBe("AccessRole");
    expect(role.source).toContain("    class `Access Role`\n    class AccessRole\n  }\n");
    // What is no class has no copy.
    for (const id of ["ns:Sales", "note1", "interface1", "Nothing"])
      expect(duplicateClass(SHOP, id)).toEqual({ source: SHOP, id: "" });
    for (const source of SOURCES) {
      for (const node of read(source).nodes) {
        if (node.group || node.kind === "note" || /^interface\d+$/.test(node.id)) continue;
        const copy = duplicateClass(source, node.id),
          made = read(copy.source).nodes.find((other) => other.id === copy.id);
        expect(made, node.id).toMatchObject({
          kind: node.kind,
          parent: node.parent,
          label: node.label === node.id ? copy.id : node.label,
        });
        expect(classMembers(copy.source, copy.id)).toEqual(classMembers(source, node.id));
        expect(classStereotype(copy.source, copy.id)).toBe(classStereotype(source, node.id));
        expect(joins(copy.source)).toEqual(joins(source));
        expect(ids(copy.source).toSorted()).toEqual([...ids(source), copy.id].toSorted());
      }
      await inScene(
        duplicateClass(source, read(source).nodes.find((node) => !node.group)!.id).source,
      );
    }
  });

  it("moves a class into a namespace and out of it", async () => {
    const into = moveClassInto(SHOP, "Payable", "ns:Sales");
    expect(changed(SHOP, into)).toEqual({
      gone: ["  class Payable"],
      added: ["    class Payable"],
    });
    expect(into).toContain("    }\n    class Payable\n  }\n\n  <<interface>> Payable\n");
    expect(read(into).nodes.find((node) => node.id === "Payable")).toMatchObject({
      parent: "ns:Sales",
      kind: "interface",
    });
    expect(moveClassInto(into, "Payable", null)).toContain(
      "  Payable : +pay(amount) bool\n  class Payable\n  Order ..|> Payable\n",
    );
    // A body moves with its class and is indented as its new place.
    const out = moveClassInto(SHOP, "Order", null);
    expect(out).toContain(
      "  Payable : +pay(amount) bool\n  class Order {\n    <<abstract>>\n    +id: string\n    %% money\n    +total(): number\n  }\n  Order ..|> Payable\n",
    );
    expect(out).toContain("  namespace Sales {\n    class Status {\n");
    expect(read(out).nodes.find((node) => node.id === "Order")!.parent).toBe(null);
    const deeper = moveClassInto(SHOP, "Order", "Sales.Billing");
    expect(deeper).toContain(
      '      note "Printed monthly"\n      class Order {\n        <<abstract>>\n        +id: string\n        %% money\n        +total(): number\n      }\n    }\n',
    );
    expect(joins(deeper)).toEqual(joins(SHOP));
    await inScene(deeper);
    // A class that only relations name is declared there, also in a namespace without a block.
    const line = moveClassInto(SHOP, "Line", "ns:Sales");
    expect(changed(SHOP, line)).toEqual({ gone: [], added: ["    class Line"] });
    expect(read(line).nodes.find((node) => node.id === "Line")!.parent).toBe("ns:Sales");
    const implied = moveClassInto(PACKAGES, "Admin", "ns:app");
    expect(implied).toContain("  namespace app {\n    class Admin{\n      +grant() }\n  }");
    expect(read(implied).nodes.find((node) => node.id === "Admin")!.parent).toBe("ns:app");
    expect(classMembers(implied, "Admin")).toEqual(["+grant()"]);
    // A note moves the same way.
    const freed = moveClassInto(SHOP, "note1", null);
    expect(changed(SHOP, freed)).toEqual({
      gone: ['      note "Printed monthly"'],
      added: ['  note "Printed monthly"'],
    });
    expect(read(freed).nodes.filter((node) => node.kind === "note")).toMatchObject([
      { label: "Has lines<br>and a status", parent: null },
      { label: "Printed monthly", parent: null },
    ]);
    expect(
      read(moveClassInto(SHOP, "note2", "ns:Sales")).nodes.filter((node) => node.kind === "note"),
    ).toMatchObject([
      { label: "Printed monthly", parent: "ns:Sales.Billing" },
      { label: "Has lines<br>and a status", parent: "ns:Sales" },
    ]);
    // Where it is already, a namespace there is none of, what is no class or note: nothing changes.
    expect(moveClassInto(SHOP, "Order", "ns:Sales")).toBe(SHOP);
    expect(moveClassInto(SHOP, "Payable", null)).toBe(SHOP);
    expect(moveClassInto(SHOP, "Payable", "ns:Nothing")).toBe(SHOP);
    expect(moveClassInto(SHOP, "Nothing", "ns:Sales")).toBe(SHOP);
    expect(moveClassInto(SHOP, "ns:Sales.Billing", null)).toBe(SHOP);
    expect(moveClassInto(SHOP, "interface1", "ns:Sales")).toBe(SHOP);
    for (const source of [...SOURCES, add(STARTER, { kind: "package" }).source]) {
      const { nodes } = read(source),
        groups = [null, ...nodes.filter((node) => node.group).map((node) => node.id)];
      for (const node of nodes) {
        if (node.group || node.kind === "note" || /^interface\d+$/.test(node.id)) continue;
        for (const group of groups) {
          const moved = moveClassInto(source, node.id, group),
            now = read(moved);
          expect(
            now.nodes.find((other) => other.id === node.id),
            `${node.id} ${group}`,
          ).toMatchObject({ parent: group, label: node.label, kind: node.kind });
          expect(ids(moved).toSorted()).toEqual(ids(source).toSorted());
          expect(joins(moved)).toEqual(joins(source));
          expect(classMembers(moved, node.id)).toEqual(classMembers(source, node.id));
        }
      }
    }
  });

  it("removes a package and keeps what it holds", async () => {
    const inner = ungroupClassPackage(SHOP, "ns:Sales.Billing");
    expect(changed(SHOP, inner)).toEqual({
      gone: [
        "    namespace Billing {",
        '      class Invoice["Tax invoice"]',
        '      note "Printed monthly"',
      ],
      added: ['    class Invoice["Tax invoice"]', '    note "Printed monthly"'],
    });
    expect(inner).toContain(
      '      PAID\n    }\n    class Invoice["Tax invoice"]\n    note "Printed monthly"\n  }\n',
    );
    expect(ids(inner)).toEqual([
      "ns:Sales",
      "Order",
      "Status",
      "Invoice",
      "note1",
      "Payable",
      "Basket",
      "Line",
      "interface1",
      "note2",
    ]);
    expect(joins(inner)).toEqual(joins(SHOP));
    await inScene(inner);
    // What it held stands one level out, a namespace among it.
    const outer = ungroupClassPackage(SHOP, "ns:Sales");
    expect(outer).toContain(
      "  %% the sales side\n  class Order {\n    <<abstract>>\n    +id: string\n    %% money\n",
    );
    expect(outer).toContain('  namespace Billing {\n    class Invoice["Tax invoice"]\n');
    expect(
      read(outer)
        .nodes.map((node) => `${node.id}:${node.parent}`)
        .slice(0, 5),
    ).toEqual([
      "Order:null",
      "Status:null",
      "ns:Billing:null",
      "Invoice:ns:Billing",
      "note1:ns:Billing",
    ]);
    await inScene(outer);
    // A namespace written as part of a dotted name leaves that name.
    const model = ungroupClassPackage(PACKAGES, "ns:app.model");
    expect(changed(PACKAGES, model)).toEqual({
      gone: ["  namespace app.model {"],
      added: ["  namespace app {"],
    });
    expect(read(model).nodes.find((node) => node.id === "User")!.parent).toBe("ns:app");
    const app = ungroupClassPackage(PACKAGES, "ns:app");
    expect(changed(PACKAGES, app)).toEqual({
      gone: ["  namespace app.model {", "  namespace app.empty { }"],
      added: ["  namespace model {", "  namespace empty { }"],
    });
    expect(ids(app)).toEqual(["ns:model", "User", "Access Role", "ns:empty", "Admin"]);
    expect(ungroupClassPackage(PACKAGES, "ns:app.empty")).toContain("  namespace app { }\n");
    // Its label goes with it.
    expect(
      ungroupClassPackage(rename(SHOP, "ns:Sales.Billing", "Accounts"), "ns:Sales.Billing"),
    ).toBe(inner);
    expect(
      ungroupClassPackage('classDiagram\n  namespace a.b["Bee"] {\n    class X\n  }', "ns:a.b"),
    ).toBe("classDiagram\n  namespace a {\n    class X\n  }");
    expect(ungroupClassPackage(SHOP, "Order")).toBe(SHOP);
    expect(ungroupClassPackage(SHOP, "ns:Nothing")).toBe(SHOP);
    for (const source of SOURCES)
      for (const group of read(source).nodes.filter((node) => node.group)) {
        const open = ungroupClassPackage(source, group.id),
          stable = (id: string) => !id.startsWith("ns:") && !/^note\d+$/.test(id);
        expect(ids(open).filter(stable).toSorted(), group.id).toEqual(
          ids(source).filter(stable).toSorted(),
        );
        expect(read(open).nodes.filter((node) => node.group)).toHaveLength(
          read(source).nodes.filter((node) => node.group).length - 1,
        );
        expect(joins(open)).toEqual(joins(source));
        await inScene(open);
      }
  });
});
