// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseError, umlColors } from "./fixtures";
import {
  type ClassView,
  foldClassDiagram,
  generics,
  parseClassDiagram,
  parseMember,
} from "../src/uml-class";
import {
  classPartAt,
  classPartBox,
  overview,
  renderClassView,
  renderUml,
  toggleClassPart,
} from "../src/index";
import { auditScene } from "../src/audit";

const error = (source: string) => parseError(parseClassDiagram, source);

describe("class diagram syntax", () => {
  it("reads classes with bodies, members, annotations, labels and generics", () => {
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
    const shape = diagram.classes.get("Shape")!;
    expect(shape).toMatchObject({ generic: "T", annotations: ["interface"] });
    expect(shape.attributes.map((member) => [member.text, member.underline])).toEqual([
      ["+String name", false],
      ["-int sides", true],
    ]);
    expect(shape.methods.map((member) => [member.text, member.italic])).toEqual([
      ["+area() : double", false],
      ["+draw(Canvas c)", true],
    ]);
    expect(diagram.classes.get("Animal")).toMatchObject({
      label: "An animal",
      annotations: ["abstract"],
    });
    expect(diagram.classes.get("Animal")!.methods[0].text).toBe("+isMammal() : bool");
    expect(diagram.classes.get("Port")!.annotations).toEqual(["service"]);
  });

  it("reads every relation kind with multiplicities and labels", () => {
    const diagram = parseClassDiagram(
      'classDiagram\n  A <|-- B\n  C "1" *-- "many" D : has\n  E o-- F\n  G <-- H\n  I -- J\n  K <.. L\n  M <|.. N\n  O .. P\n  Q <|--|> R\n  S --> T : uses',
    );
    expect(
      diagram.relations.map((relation) => [
        relation.source,
        relation.startMarker ?? "",
        relation.dashed ? ".." : "--",
        relation.endMarker ?? "",
        relation.target,
      ]),
    ).toEqual([
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
    ]);
    expect(diagram.relations[1]).toMatchObject({ startLabel: "1", endLabel: "many", label: "has" });
  });

  it("makes lollipop ends interface balls, not classes", () => {
    const diagram = parseClassDiagram("classDiagram\n  bar ()-- foo\n  Service --() Port");
    expect([...diagram.classes.keys()]).toEqual(["foo", "Service"]);
    expect(diagram.lollipops.map((ball) => ball.label)).toEqual(["bar", "Port"]);
  });

  it("nests namespaces, also by dotted names", () => {
    const diagram = parseClassDiagram(
      'classDiagram\n  namespace app.domain {\n    class Order\n    namespace model {\n      class Line\n    }\n  }\n  namespace ui["User interface"] {\n    class View\n  }',
    );
    expect(
      [...diagram.namespaces.values()].map((space) => [space.id, space.label, space.parent]),
    ).toEqual([
      ["app", "app", null],
      ["app.domain", "domain", "app"],
      ["app.domain.model", "model", "app.domain"],
      ["ui", "User interface", null],
    ]);
    expect(diagram.classes.get("Line")!.namespace).toBe("app.domain.model");
  });

  it("reads notes, direction, frontmatter titles and ignores styling", () => {
    const diagram = parseClassDiagram(
      '---\ntitle: Shop\n---\nclassDiagram\n  direction LR\n  note "General"\n  note for A "About A<br>second line"\n  classDef red fill:#f00\n  cssClass "A" red\n  style A fill:#fff\n  click A href "https://example.com"\n  A:::red',
    );
    expect(diagram).toMatchObject({ title: "Shop", direction: "LR" });
    expect(diagram.notes.map((note) => [note.text, note.target])).toEqual([
      ["General", undefined],
      ["About A<br>second line", "A"],
    ]);
  });

  it("shows type arguments with angle brackets", () => {
    expect(generics("List~List~int~~")).toBe("List<List<int>>");
    expect(generics("Map~K, V~")).toBe("Map<K, V>");
    expect(parseMember("+getDistanceMatrix() List~List~int~~").text).toBe(
      "+getDistanceMatrix() : List<List<int>>",
    );
  });

  it("reports errors with line numbers", () => {
    expect(error("classDiagram\n  class A {\n    +x").message).toBe(
      "Line 2: Class `A` is missing its closing `}`.",
    );
    expect(error("classDiagram\n  namespace N {\n    class A\n    A --> B\n  }").message).toMatch(
      /^Line 4: Relations go outside namespaces/,
    );
    expect(error("classDiagram\n  }").message).toBe("Line 2: Unmatched `}`.");
    expect(error("classDiagram\n  A ==> B").message).toBe("Line 2: Cannot read `A ==> B`.");
  });

  it("applies the TAM conceptual level rules", () => {
    expect(
      error("classDiagram\n  %% level conceptual\n  class A {\n    +name\n  }").message,
    ).toMatch(/Visibility .* belongs to the design level/);
    expect(error("classDiagram\n  %% level conceptual\n  A <|.. B").message).toBe(
      "Line 3: Interface realization belongs to the design level.",
    );
    expect(error("classDiagram\n  %% level conceptual\n  A ..> B").message).toBe(
      "Line 3: Dependencies belong to the design level.",
    );
    expect(() =>
      parseClassDiagram('classDiagram\n  %% level conceptual\n  A "1" *-- "*" B\n  A .. C'),
    ).not.toThrow();
  });
});

describe("class diagram rendering", () => {
  it("draws compartments, markers and multiplicities without defects", async () => {
    const { svg, scene } = await renderUml(
      'classDiagram\n  class Order {\n    +id: UUID\n    +total() Money\n  }\n  Order "1" *-- "1..*" Line : contains\n  Order ..> Clock',
      umlColors,
    );
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    expect(scene.shapes.find((shape) => shape.id === "Order")!.dividers).toHaveLength(2);
    expect(scene.markers.map((marker) => marker.kind).toSorted()).toEqual([
      "filled-diamond",
      "open",
    ]);
    expect(
      scene.texts
        .filter((text) => text.role === "end")
        .map((text) => text.text)
        .toSorted(),
    ).toEqual(["1", "1..*"]);
    expect(svg).toContain("+total() : Money");
  });

  it("joins generalizations of one parent under one triangle", async () => {
    const { scene } = await renderUml(
      "classDiagram\n  Animal <|-- Duck\n  Animal <|-- Fish\n  Animal <|-- Zebra",
      umlColors,
    );
    expect(scene.markers.map((marker) => marker.kind)).toEqual(["triangle"]);
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
  });

  it("draws self associations as corner loops beside the class", async () => {
    const { scene } = await renderUml(
      'classDiagram\n  Employee "0..1" --> "*" Employee : manages',
      umlColors,
    );
    expect(scene.wires[0].points).toHaveLength(5);
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
  });
});

describe("explorable class diagrams", () => {
  const source = `classDiagram
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

  it("reads click and link targets", () => {
    const diagram = parseClassDiagram(source);
    expect([...diagram.links]).toEqual([
      ["Order", "src/orders.py#L3"],
      ["Invoice", "src/billing.py#L1"],
    ]);
  });

  it("folds a collapsed package into one box and merges its relations", () => {
    const diagram = parseClassDiagram(source);
    const folded = foldClassDiagram(diagram, {
      collapsed: new Set(["shop.orders"]),
      bare: new Set(["Invoice"]),
    });
    expect([...folded.classes.keys()].sort()).toEqual(["Invoice", "Report", "ns:shop.orders"]);
    expect(folded.classes.get("ns:shop.orders")!.attributes[0].text).toBe("2 classes");
    expect([...folded.namespaces.keys()]).toEqual(["shop", "shop.billing"]);
    expect(folded.classes.get("Invoice")!.methods).toEqual([]);
    // Order --> Item is inside the package and disappears; the labelled use loses its label.
    expect(folded.relations.map((r) => [r.source, r.target, r.label])).toEqual([
      ["Invoice", "ns:shop.orders", undefined],
      ["Report", "Invoice", undefined],
      ["Report", "ns:shop.orders", undefined],
    ]);
  });

  it("opens large diagrams as an overview of the first level with several packages", () => {
    const many = `classDiagram\n  namespace root.a {\n${Array.from({ length: 15 }, (_, n) => `    class A${n}`).join("\n")}\n  }\n  namespace root.b {\n${Array.from({ length: 15 }, (_, n) => `    class B${n}`).join("\n")}\n  }`;
    const view = overview(parseClassDiagram(many));
    expect([...view.collapsed].sort()).toEqual(["root.a", "root.b"]);
    expect(view.bare.size).toBe(30);
    expect(overview(parseClassDiagram(source)).collapsed.size).toBe(0);
  });

  it("finds the clicked class or package and toggles it", async () => {
    let view: ClassView = { collapsed: new Set(["shop.billing"]), bare: new Set() };
    const picture = await renderClassView(source, umlColors, view);
    expect(auditScene(picture.scene).filter((finding) => !finding.note)).toEqual([]);
    const center = (part: { kind: "class" | "package"; id: string }) => {
      const box = classPartBox(picture.scene, part)!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const order = classPartAt(
      picture.diagram,
      view,
      picture.scene,
      center({ kind: "class", id: "Order" }),
    );
    expect(order).toEqual({
      kind: "class",
      id: "Order",
      name: "Order",
      folded: false,
      link: "src/orders.py#L3",
    });
    const billing = classPartAt(
      picture.diagram,
      view,
      picture.scene,
      center({ kind: "package", id: "shop.billing" }),
    );
    expect(billing).toMatchObject({ kind: "package", id: "shop.billing", folded: true });
    expect(picture.scene.shapes.find((shape) => shape.id === "ns:shop.billing")!.kind).toBe(
      "folder",
    );
    view = toggleClassPart(toggleClassPart(view, billing!), order!);
    expect([...view.collapsed]).toEqual([]);
    expect([...view.bare]).toEqual(["Order"]);
    const opened = await renderClassView(source, umlColors, view);
    expect(opened.diagram.classes.has("Invoice")).toBe(true);
    expect(opened.diagram.classes.get("Order")!.attributes).toEqual([]);
  });
});
