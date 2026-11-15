import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseUml } from "../src/index.ts";
import { CLASS_EXAMPLES } from "../src/samples/uml-examples.ts";
import { parseClassDiagram } from "../src/uml-class.ts";
import {
  addClassMember,
  classMembers,
  classStructure,
  setClassKind,
  setClassMembers,
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
      "interface1 link Invoice",
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
    // Every kind a part or a join has is one the palette knows.
    const pieces = new Set(classStructure.pieces.map((piece) => piece.kind)),
      links = new Set(classStructure.links.map((link) => link.kind));
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
    expect(plain.source).toBe(`${STARTER}\n  class Class1`);
    expect(add(plain.source, { kind: "class" }).id).toBe("Class2");
    // A name is the id when it can be, and a label over an id made of it when not.
    expect(add(STARTER, { kind: "class", label: "Invoice" }).source).toBe(
      `${STARTER}\n  class Invoice`,
    );
    const spaced = add(STARTER, { kind: "class", label: "order line" });
    expect(spaced.id).toBe("OrderLine");
    expect(spaced.source.endsWith('\n  class OrderLine["order line"]')).toBe(true);
    const again = add(STARTER, { kind: "class", label: "Order" });
    expect(again.id).toBe("Order2");
    expect(read(again.source).nodes.at(-1)).toMatchObject({ id: "Order2", label: "Order" });

    for (const kind of ["interface", "abstract", "enumeration"]) {
      const added = add(STARTER, { kind, label: "Thing" });
      expect(added.source).toBe(`${STARTER}\n  class Thing {\n    <<${kind}>>\n  }`);
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
    expect(group.source.endsWith('\n  namespace CoreParts["Core parts"] {\n  }')).toBe(true);
    expect(read(group.source).nodes.at(-1)).toMatchObject({
      id: "ns:CoreParts",
      label: "Core parts",
      group: true,
      kind: "package",
    });
    expect(add(STARTER, { kind: "package" }).id).toBe("ns:Package1");
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
    expect(read(add(SHOP, { kind: "class", parent: "Order" }).source).nodes.at(-1)!.parent).toBe(
      null,
    );
    // Tabs stay tabs.
    expect(add(RELATIONS, { kind: "interface", label: "Toy" }).source).toBe(
      `${RELATIONS}\n\tclass Toy {\n\t\t<<interface>>\n\t}`,
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
    expect(classStructure.links.map((link) => link.kind)).toEqual([
      ...Object.keys(written),
      "anchor",
    ]);
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
    for (const link of classStructure.links.slice(0, -1))
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
    expect(relations(without)).toEqual(["interface1 link Invoice"]);
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
});
