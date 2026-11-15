// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseError, umlColors } from "./fixtures.ts";
import { checkSource, renderSource } from "../cli/diagram.ts";
import { arialMeasure } from "../src/arial-measure.ts";
import { auditScene } from "../src/audit.ts";
import { detectUml, parseUml, renderUml } from "../src/index.ts";
import { MARKER_LENGTH, markerBounds, markerSvg } from "../src/markers.ts";
import { ER_EXAMPLES } from "../src/samples/uml-examples.ts";
import type { Scene } from "../src/scene.ts";
import {
  type Cardinality,
  CARDINALITIES,
  parseAttributes,
  parseErDiagram,
  relationshipParts,
} from "../src/uml-er.ts";

const error = (source: string) => parseError(parseErDiagram, source);

const KINDS = Object.keys(CARDINALITIES) as Cardinality[];

describe("entity relationship syntax", () => {
  it("is found by its header, with a title in front matter and a direction", () => {
    const source = "---\ntitle: Shop\n---\nerDiagram\n  direction LR\n  CUSTOMER";
    expect(detectUml(source)).toBe("er");
    expect(detectUml("erDiagram")).toBe("er");
    expect(detectUml("erDiagramX")).toBeNull();
    expect(parseErDiagram(source)).toMatchObject({ title: "Shop", direction: "LR" });
    // A `title` statement says it too; the front matter comes first.
    expect(parseErDiagram("erDiagram\n  title Order system\n  A").title).toBe("Order system");
    expect(parseErDiagram("---\ntitle: Shop\n---\nerDiagram\n  title Other\n  A").title).toBe(
      "Shop",
    );
    expect([...parseErDiagram("erDiagram\n  title-page\n  1st\n  a.b").entities.keys()]).toEqual([
      "title-page",
      "1st",
      "a.b",
    ]);
    expect(parseErDiagram("erDiagram\n  direction td").direction).toBe("TB");
    expect(parseErDiagram("erDiagram").direction).toBe("TB");
    expect(parseUml(source)).toMatchObject({ kind: "er", title: "Shop" });
  });

  it("reads entities alone, with aliases, in quotes and with hyphens", () => {
    const diagram = parseErDiagram(`erDiagram
  CUSTOMER
  p["Person"]
  q[Plain alias]
  LINE-ITEM
  "Sports club"
  "Sports club" ||--o{ p : "is joined by"
  Größe_1`);
    expect([...diagram.entities.values()].map((entity) => [entity.id, entity.label])).toEqual([
      ["CUSTOMER", "CUSTOMER"],
      ["p", "Person"],
      ["q", "Plain alias"],
      ["LINE-ITEM", "LINE-ITEM"],
      ["Sports club", "Sports club"],
      ["Größe_1", "Größe_1"],
    ]);
    expect(diagram.relationships[0]).toMatchObject({ source: "Sports club", target: "p" });
  });

  it("reads attribute blocks: type, name, keys and comment", () => {
    const diagram = parseErDiagram(`erDiagram
  CUSTOMER {
    int id PK "generated"
    string name
    string email UK
    int orderId PK, FK "both"
    varchar(255) note "with } a brace"
    string[] tags
    list~string~ aliases
  }
  EMPTY {
  }
  ONE { int id PK }
  TWO { string a
    string b }
  NONE {}
  CUSTOMER {
    date born
  }`);
    expect(
      diagram.entities
        .get("CUSTOMER")!
        .attributes.map(({ type, name, keys, comment }) => [type, name, keys.join(), comment]),
    ).toEqual([
      ["int", "id", "PK", "generated"],
      ["string", "name", "", undefined],
      ["string", "email", "UK", undefined],
      ["int", "orderId", "PK,FK", "both"],
      ["varchar(255)", "note", "", "with } a brace"],
      ["string[]", "tags", "", undefined],
      ["list<string>", "aliases", "", undefined],
      ["date", "born", "", undefined],
    ]);
    expect(diagram.entities.get("EMPTY")!.attributes).toEqual([]);
    expect(diagram.entities.get("NONE")!.attributes).toEqual([]);
    expect(diagram.entities.get("ONE")!.attributes).toMatchObject([{ name: "id", keys: ["PK"] }]);
    expect(diagram.entities.get("TWO")!.attributes.map((attribute) => attribute.name)).toEqual([
      "a",
      "b",
    ]);
    expect(diagram.entities.get("CUSTOMER")!.attributes[1].line).toBe(4);
  });

  it("reads several attributes on one line", () => {
    expect(
      parseAttributes('int id PK string name "the name" date born FK, UK', 3).map(
        ({ type, name, keys, comment }) => [type, name, keys.join(), comment],
      ),
    ).toEqual([
      ["int", "id", "PK", undefined],
      ["string", "name", "", "the name"],
      ["date", "born", "FK,UK", undefined],
    ]);
  });

  it("reads every cardinality symbol on both sides, identifying and not", () => {
    for (const left of KINDS)
      for (const right of KINDS)
        for (const [line, identifying] of [
          ["--", true],
          ["..", false],
          [".-", false],
          ["-.", false],
        ] as const) {
          const text = `A ${CARDINALITIES[left].left}${line}${CARDINALITIES[right].right} B : rel`,
            [relationship] = parseErDiagram(`erDiagram\n  ${text}`).relationships;
          expect(relationship, text).toMatchObject({
            id: "r1",
            source: "A",
            target: "B",
            sourceCardinality: left,
            targetCardinality: right,
            identifying,
            label: "rel",
          });
          // With the symbols the other way round, as Mermaid reads them, and no space but one.
          expect(
            parseErDiagram(
              `erDiagram\nA ${CARDINALITIES[left].right}${line}${CARDINALITIES[right].left}B:rel`,
            ).relationships[0],
            text,
          ).toMatchObject({ sourceCardinality: left, targetCardinality: right, identifying });
        }
  });

  it("reads the cardinalities and the line in words", () => {
    for (const kind of KINDS)
      for (const word of CARDINALITIES[kind].words) {
        const [relationship] = parseErDiagram(
          `erDiagram\n  CAR ${word} to ${word} NAMED-DRIVER : allows`,
        ).relationships;
        expect(relationship, word).toMatchObject({
          source: "CAR",
          target: "NAMED-DRIVER",
          sourceCardinality: kind,
          targetCardinality: kind,
          identifying: true,
        });
      }
    expect(
      parseErDiagram("erDiagram\n  PERSON many(0) optionally to 0+ NAMED-DRIVER : is")
        .relationships[0],
    ).toMatchObject({
      sourceCardinality: "zero-or-more",
      targetCardinality: "zero-or-more",
      identifying: false,
    });
    expect(
      parseErDiagram("erDiagram\n  A 1 to zero or one B\n  A only one -- many(1) B\n  A 1--1 B")
        .relationships,
    ).toMatchObject([
      { sourceCardinality: "only-one", targetCardinality: "zero-or-one" },
      { sourceCardinality: "only-one", targetCardinality: "one-or-more" },
      { sourceCardinality: "only-one", targetCardinality: "only-one" },
    ]);
    // Words are words: a name that starts with one is a name.
    expect(relationshipParts("A one to oneB")).toBeNull();
    expect(parseErDiagram("erDiagram\n  one ||--|| many : to").relationships[0]).toMatchObject({
      source: "one",
      target: "many",
      label: "to",
    });
  });

  it("reads labels, quoted or not, and relationships without one", () => {
    const diagram = parseErDiagram(`erDiagram
  A ||--o{ B : places
  A ||--o{ B : "is placed by"
  A ||--o{ B
  A ||--o{ B : "two<br>lines"
  A ||--o{ A : "a: colon"
  A ||--o{ B : ""
  A ||--o{ B : two words`);
    expect(diagram.relationships.map((relationship) => relationship.label)).toEqual([
      "places",
      "is placed by",
      undefined,
      "two<br>lines",
      "a: colon",
      undefined,
      "two words",
    ]);
    expect(diagram.relationships.map((relationship) => relationship.id)).toEqual([
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
      "r6",
      "r7",
    ]);
    expect(diagram.relationships[4]).toMatchObject({ source: "A", target: "A", line: 6 });
  });

  it("says where each piece of a relationship stands", () => {
    expect(relationshipParts('"A b" }o..|| C-D : "x y"')).toEqual({
      left: { text: '"A b"', start: 0 },
      leftCardinality: { text: "}o", start: 6, kind: "zero-or-more" },
      line: { text: "..", start: 8, identifying: false },
      rightCardinality: { text: "||", start: 10, kind: "only-one" },
      right: { text: "C-D", start: 13 },
      label: { text: '"x y"', start: 19 },
    });
    expect(relationshipParts("CUSTOMER")).toBeNull();
    expect(relationshipParts("A -- B")).toBeNull();
    expect(relationshipParts("A ||--|| B extra")).toBeNull();
  });

  it("ignores comments, styling and accessibility statements", () => {
    const diagram = parseErDiagram(`%% a comment first
erDiagram
  %% @CUSTOMER 10,20
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
    expect([...diagram.entities.keys()]).toEqual(["CUSTOMER", "ORDER", "link-table"]);
    expect(diagram.entities.get("ORDER")).toMatchObject({ label: "An order" });
    expect(diagram.entities.get("ORDER")!.attributes).toHaveLength(1);
  });

  it("reports errors with their lines", () => {
    expect(error("classDiagram\n  A")).toMatchObject({ line: 1 });
    expect(error("erDiagram\n  A ||--o{")).toMatchObject({ line: 2 });
    expect(error("erDiagram\n  A ||--o{").message).toMatch(/Line 2: Cannot read `A \|\|--o\{`/);
    expect(error("erDiagram\n  A -- B").message).toMatch(/cardinality at each end/);
    expect(error("erDiagram\n\n  A {\n    string\n  }")).toMatchObject({ line: 4 });
    expect(error("erDiagram\n  A {\n    string name PK,\n  }").message).toMatch(/comma between/);
    expect(error("erDiagram\n  A {\n    string name").message).toMatch(
      /Line 2: Entity `A` is missing its closing `}`/,
    );
    expect(error("erDiagram\n  }").message).toMatch(/Unmatched/);
    expect(error("erDiagram\n  A { int id } more").message).toMatch(/ends its line/);
    expect(error("erDiagram\n  A ||--o{ B :").message).toMatch(/label follows/);
    expect(error("erDiagram LR").message).toMatch(/after `erDiagram`/);
    expect(error("erDiagram\n  A u--o{ B : x")).toMatchObject({ unsupported: true });
    expect(error("erDiagram\n  ???")).toMatchObject({ line: 2 });
    const many = Array.from({ length: 201 }, (_, index) => `  E${index}`).join("\n");
    expect(error(`erDiagram\n${many}`).message).toMatch(/limited to 200 entities/);
    const wide = Array.from({ length: 61 }, (_, index) => `    int a${index}`).join("\n");
    expect(error(`erDiagram\n  A {\n${wide}\n  }`).message).toMatch(/more than 60 attributes/);
  });
});

describe("crow's foot markers", () => {
  it("reach back along the wire as far as they are drawn", () => {
    expect(MARKER_LENGTH["only-one"]).toBeLessThan(MARKER_LENGTH["zero-or-one"]);
    expect(MARKER_LENGTH["one-or-more"]).toBeLessThan(MARKER_LENGTH["zero-or-more"]);
    for (const kind of KINDS) {
      const box = markerBounds(kind, { x: 100, y: 50 }, { x: 1, y: 0 });
      // From the entity at x=100 back along the wire, and across it on both sides.
      expect(box.x + box.width).toBeCloseTo(100.7);
      expect(box.width).toBeCloseTo(MARKER_LENGTH[kind] + 1.4);
      expect(box.y + box.height / 2).toBeCloseTo(50);
      expect(box.height).toBeGreaterThan(12);
    }
  });

  it("draw bars, rings and feet for the four cardinalities", () => {
    const svg = (kind: Cardinality) =>
      markerSvg(kind, { x: 100, y: 50 }, { x: 1, y: 0 }, "#000", "#fff");
    const strokes = (kind: Cardinality) => svg(kind).match(/M/g)!.length;
    expect(strokes("only-one")).toBe(2);
    expect(svg("only-one")).not.toContain("<circle");
    expect(strokes("zero-or-one")).toBe(1);
    expect(svg("zero-or-one")).toContain('<circle cx="84.5" cy="50" r="4" fill="#fff"');
    // The foot spreads to the entity's outline on both sides of the wire.
    expect(svg("one-or-more")).toContain("M100 56.5L88 50L100 43.5");
    expect(strokes("one-or-more")).toBe(2);
    expect(svg("zero-or-more")).toContain("M100 56.5L88 50L100 43.5");
    expect(svg("zero-or-more")).toContain("<circle");
    // Pointing down, the symbol turns with the wire.
    expect(markerSvg("only-one", { x: 10, y: 80 }, { x: 0, y: 1 }, "#000", "#fff")).toContain(
      "M3.5 74L16.5 74",
    );
  });
});

/** Each symbol stands on a straight piece of its wire that is at least as long as it is. */
function straightUnder(scene: Scene, marker: Scene["markers"][number]) {
  const wire = scene.wires.find((item) => item.edge === marker.wire)!,
    first = Math.hypot(marker.tip.x - wire.points[0].x, marker.tip.y - wire.points[0].y) < 1,
    [a, b] = first ? wire.points.slice(0, 2) : wire.points.slice(-2);
  expect(Math.hypot(a.x - b.x, a.y - b.y), marker.wire).toBeGreaterThanOrEqual(
    MARKER_LENGTH[marker.kind],
  );
}

describe("entity relationship layout", () => {
  it.each(ER_EXAMPLES)(
    "draws %s without defects",
    async (_, source) => {
      const picture = await renderUml(source, umlColors, { measure: arialMeasure });
      expect(auditScene(picture.scene).filter((finding) => !finding.note)).toEqual([]);
      expect(picture.scene.fallbacks?.size ?? 0).toBe(0);
      const diagram = parseErDiagram(source);
      expect(picture.scene.shapes.map((shape) => shape.id).toSorted()).toEqual(
        [...diagram.entities.keys()].toSorted(),
      );
      expect(picture.scene.wires.map((wire) => wire.edge).toSorted()).toEqual(
        diagram.relationships.map((relationship) => relationship.id).toSorted(),
      );
      expect(picture.scene.markers).toHaveLength(2 * diagram.relationships.length);
      for (const marker of picture.scene.markers) straightUnder(picture.scene, marker);
      expect(picture.description).toBe(diagram.title ?? "Entity relationship diagram");
      expect(picture.svg).toContain('aria-roledescription="er diagram"');
    },
    60_000,
  );

  it("has at least six examples, with a schema of eight entities or more among them", () => {
    expect(ER_EXAMPLES.length).toBeGreaterThanOrEqual(6);
    const sizes = ER_EXAMPLES.map(([, source]) => parseErDiagram(source).entities.size);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(8);
    expect(Math.min(...sizes)).toBe(2);
    const all = ER_EXAMPLES.flatMap(([, source]) => parseErDiagram(source).relationships);
    for (const kind of KINDS) {
      expect(all.some((relationship) => relationship.sourceCardinality === kind)).toBe(true);
      expect(all.some((relationship) => relationship.targetCardinality === kind)).toBe(true);
    }
    expect(all.some((relationship) => relationship.source === relationship.target)).toBe(true);
    expect(all.some((relationship) => !relationship.identifying)).toBe(true);
  });

  it("ties every shape, text, wire and marker to its entity or relationship", async () => {
    const source = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER }o..o| ORDER : "last looked at"
  ORDER |o--o{ ORDER : follows
  CUSTOMER {
    int id PK "generated"
    string name
  }`;
    const { scene } = await renderUml(source, umlColors, { measure: arialMeasure });
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    const customer = scene.shapes.find((shape) => shape.id === "CUSTOMER")!;
    expect(customer).toMatchObject({ kind: "rect", container: false, fill: "page" });
    expect(customer.dividers).toHaveLength(1);
    expect(scene.shapes.find((shape) => shape.id === "ORDER")!.dividers).toEqual([]);
    const own = scene.texts.filter((text) => text.owner === "CUSTOMER");
    expect(own.map((text) => [text.text, text.role])).toEqual([
      ["CUSTOMER", "node"],
      ["int", "member"],
      ["id", "member"],
      ["PK", "member"],
      ["generated", "member"],
      ["string", "member"],
      ["name", "member"],
    ]);
    // The name of a primary key is set off; the columns line up.
    const text = (value: string) => own.find((item) => item.text === value)!;
    expect(text("id")).toMatchObject({ weight: 600, underline: true });
    expect(text("name")).toMatchObject({ weight: 400 });
    expect(text("name").underline).toBeFalsy();
    expect(text("id").x).toBe(text("name").x);
    expect(text("int").x).toBe(text("string").x);
    expect(text("generated").italic).toBe(true);
    for (const item of own) {
      expect(item.box.x).toBeGreaterThanOrEqual(customer.box.x);
      expect(item.box.x + item.box.width).toBeLessThanOrEqual(customer.box.x + customer.box.width);
    }
    expect(scene.wires.map((wire) => [wire.edge, wire.from, wire.to, !!wire.dashed])).toEqual([
      ["r1", "CUSTOMER", "ORDER", false],
      ["r2", "CUSTOMER", "ORDER", true],
      ["r3", "ORDER", "ORDER", false],
    ]);
    expect(scene.markers.map((marker) => [marker.wire, marker.kind])).toEqual([
      ["r1", "only-one"],
      ["r1", "zero-or-more"],
      ["r2", "zero-or-more"],
      ["r2", "zero-or-one"],
      ["r3", "zero-or-one"],
      ["r3", "zero-or-more"],
    ]);
    for (const marker of scene.markers) straightUnder(scene, marker);
    expect(
      scene.texts.filter((item) => item.role === "label").map((item) => [item.text, item.owner]),
    ).toEqual([
      ["places", "r1"],
      ["last looked at", "r2"],
      ["follows", "r3"],
    ]);
  });

  it("puts the one above the many, whichever way a relationship is written", async () => {
    for (const source of [
      "erDiagram\n  PARENT ||--o{ CHILD : has",
      "erDiagram\n  CHILD }o--|| PARENT : belongs",
    ]) {
      const { scene } = await renderUml(source, umlColors, { measure: arialMeasure });
      const y = (id: string) => scene.shapes.find((shape) => shape.id === id)!.box.y;
      expect(y("PARENT"), source).toBeLessThan(y("CHILD"));
    }
    const across = await renderUml(
      "erDiagram\n  direction LR\n  PARENT ||--o{ CHILD : has",
      umlColors,
      { measure: arialMeasure },
    );
    const x = (id: string) => across.scene.shapes.find((shape) => shape.id === id)!.box.x;
    expect(x("PARENT")).toBeLessThan(x("CHILD"));
  });

  it.each(["TB", "LR"])("sets the loops of one entity side by side (%s)", async (direction) => {
    const { scene } = await renderUml(
      `erDiagram
  direction ${direction}
  EMPLOYEE |o--o{ EMPLOYEE : manages
  EMPLOYEE |o..o{ EMPLOYEE : mentors
  EMPLOYEE }o--o{ EMPLOYEE : "works with"
  EMPLOYEE }o--|| DEPARTMENT : "works in"`,
      umlColors,
      { measure: arialMeasure },
    );
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    const loops = scene.markers.filter((marker) => marker.wire !== "r4");
    expect(loops).toHaveLength(6);
    // No two symbols of the loops overlap.
    for (const [index, a] of loops.entries())
      for (const b of loops.slice(index + 1)) {
        const [one, other] = [a, b].map((marker) =>
          markerBounds(marker.kind, marker.tip, marker.direction),
        );
        expect(
          one.x < other.x + other.width &&
            other.x < one.x + one.width &&
            one.y < other.y + other.height &&
            other.y < one.y + one.height,
          `${a.wire} ${a.kind} on ${b.wire} ${b.kind}`,
        ).toBe(false);
      }
    for (const marker of scene.markers) straightUnder(scene, marker);
    const box = scene.shapes.find((shape) => shape.id === "EMPLOYEE")!.box;
    for (const wire of scene.wires.filter((item) => item.from === item.to))
      for (const point of [wire.points[0], wire.points.at(-1)!]) {
        expect(point.x).toBeGreaterThanOrEqual(box.x);
        expect(point.x).toBeLessThanOrEqual(box.x + box.width);
        expect(point.y).toBeGreaterThanOrEqual(box.y);
        expect(point.y).toBeLessThanOrEqual(box.y + box.height);
      }
  });

  it("is drawn and checked by the command line", async () => {
    const source = ER_EXAMPLES[1][1];
    const svg = await renderSource(source);
    expect(svg).toContain('aria-roledescription="er diagram"');
    expect(svg).toContain("<title>Order example</title>");
    await expect(checkSource(source)).resolves.toBeUndefined();
    await expect(checkSource("erDiagram\n  A ||--o{")).rejects.toMatchObject({ line: 2 });
  });

  it("draws an empty diagram and a lone entity", async () => {
    const empty = await renderUml("erDiagram", umlColors, { measure: arialMeasure });
    expect(empty.scene.shapes).toEqual([]);
    const lone = await renderUml("erDiagram\n  CUSTOMER", umlColors, { measure: arialMeasure });
    expect(lone.scene.shapes).toHaveLength(1);
    expect(auditScene(lone.scene).filter((finding) => !finding.note)).toEqual([]);
  });
});
