// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseError, umlColors } from "./fixtures.ts";
import { parseUseCaseDiagram } from "../src/uml-usecase.ts";
import { USECASE_EXAMPLES } from "../src/samples/uml-examples.ts";
import { arialMeasure, renderUml } from "../src/index.ts";
import { auditScene, insideFraction } from "../src/audit.ts";
import { distance, type Scene, type SceneText } from "../src/scene.ts";

const error = (source: string) => parseError(parseUseCaseDiagram, source);

/**
 * The length of each other wire inside the drawn box of a label, its segments summed: a curve is
 * a polyline of pieces a few pixels long, none of which alone is as long as the curve runs there.
 */
const insideLabel = (scene: Scene, label: SceneText) =>
  scene.wires
    .filter((wire) => wire.edge !== label.owner)
    .map(({ points }) =>
      points.slice(1).reduce((sum, point, index) => {
        const from = points[index];
        return sum + insideFraction(from, point, label.box) * distance(from, point);
      }, 0),
    );

describe("use case diagram syntax", () => {
  it("reads actors, machine actors, boundaries, use cases and relations", () => {
    const diagram = parseUseCaseDiagram(`usecase-beta
  actor User, Admin
  actor svc("Billing") <<system>>
  systemBoundary shop[Shop]
    buy(Buy item)
    pay[Pay]
  end
  User --> buy
  buy ..> : include pay
  pay ..> : extend buy
  Admin --|> User
  svc -- invoice --> pay
  note for buy "main flow"`);
    expect(
      [...diagram.elements.values()].map((item) => [item.id, item.kind, item.shape, item.boundary]),
    ).toEqual([
      ["User", "actor", "figure", null],
      ["Admin", "actor", "figure", null],
      ["svc", "actor", "box", null],
      ["buy", "usecase", "ellipse", "shop"],
      ["pay", "usecase", "rect", "shop"],
    ]);
    expect(
      diagram.relations.map((relation) => [
        relation.source,
        relation.kind,
        relation.target,
        relation.label ?? "",
      ]),
    ).toEqual([
      ["User", "association", "buy", ""],
      ["buy", "include", "pay", "«include»"],
      ["pay", "extend", "buy", "«extend»"],
      ["Admin", "generalization", "User", ""],
      ["svc", "association", "pay", "invoice"],
    ]);
    expect(diagram.notes[0]).toMatchObject({ target: "buy", text: "main flow" });
  });

  it("reports errors with line numbers", () => {
    expect(error("usecase-beta\n  systemBoundary s[S]\n    a(A)").message).toBe(
      "Line 2: System boundary `s` is missing its `end`.",
    );
    expect(error("usecase-beta\n  a(A) ==> b").message).toBe(
      "Line 2: Cannot read the relation `==> b`.",
    );
    expect(error("usecase-beta\n  %% level design\n  actor A").message).toMatch(/conceptual level/);
  });

  it("draws stick figures, ellipses and straight lines without defects", async () => {
    const { scene } = await renderUml(
      "usecase-beta\n  actor User\n  systemBoundary s[Shop]\n    buy(Buy item)\n    pay(Pay)\n  end\n  User --> buy\n  buy ..> : include pay",
      umlColors,
    );
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    expect(scene.shapes.map((shape) => shape.kind).toSorted()).toEqual([
      "actor",
      "ellipse",
      "ellipse",
      "rect",
    ]);
    expect(scene.wires.every((wire) => wire.points.length === 2)).toBe(true);
    expect(scene.texts.some((text) => text.text === "«include»")).toBe(true);
  });

  it.each(USECASE_EXAMPLES)(
    "draws no kinked lines in %s: each is straight or one smooth curve",
    async (_name, source) => {
      const { scene } = await renderUml(source, umlColors);
      for (const wire of scene.wires) {
        if (wire.points.length === 2) continue;
        // One Bézier curve (quadratic, or cubic for a loop), no line segments.
        expect(wire.path).toMatch(/^M[-\d. ]+[QC][-\d. ]+$/);
      }
    },
  );

  it("keeps the labels of a crowded diagram off shapes and wires when no spot is free", async () => {
    // Top to bottom, the label spots around the «include» of editItem are all taken; the least
    // clutter by count would put «include» over editLink.
    const [, source] = USECASE_EXAMPLES.find(([name]) => name.includes("figure 2-7"))!;
    const { scene } = await renderUml(source.replace("direction LR", "direction TB"), umlColors);
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
  });

  // Arial widths differ from the estimate, so the spots that are free differ too.
  it.each(["figure 2-7", "bank (large)"])(
    "keeps the labels of %s clear top to bottom under the Arial measure",
    async (name) => {
      const [, source] = USECASE_EXAMPLES.find(([title]) => title.includes(name))!;
      const { scene } = await renderUml(source.replace("direction LR", "direction TB"), umlColors, {
        measure: arialMeasure,
      });
      expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    },
  );

  // A label's halo erases the wire under its word, so no other wire may run along a label, though
  // the audit lets one graze the box.
  const relationLabels = async (name: string) => {
    const [, source] = USECASE_EXAMPLES.find(([title]) => title.includes(name))!;
    const { scene } = await renderUml(source, umlColors, { measure: arialMeasure });
    return {
      scene,
      labels: scene.texts.filter((text) => text.role === "label" && /^«/.test(text.text)),
    };
  };

  it.each(["figure 2-7", "bank (large)"])(
    "has no other wire running along a label of %s left to right under the Arial measure",
    async (name) => {
      const { scene, labels } = await relationLabels(name);
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels)
        expect(Math.max(...insideLabel(scene, label))).toBeLessThan(label.box.height);
    },
  );

  // Where no wire is lost under a label, the label stays where it is: moving it only costs the
  // distance to its line.
  it.each([
    ["figure 2-7", "BT", "r6", 280.6004822496276, -201.33010164768348],
    ["bank (large)", "LR", "r15", 334.4716521670419, 188.60079527413748],
  ])("keeps the label of %s %s where no wire runs along it", async (name, direction, owner, x, y) => {
    const [, source] = USECASE_EXAMPLES.find(([title]) => title.includes(name))!;
    const { scene } = await renderUml(source.replace("direction LR", `direction ${direction}`), umlColors, {
      measure: arialMeasure,
    });
    const { box } = scene.texts.find((text) => text.role === "label" && text.owner === owner)!;
    expect([box.x, box.y]).toEqual([expect.closeTo(x, 6), expect.closeTo(y, 6)]);
  });

  it("puts a use case shared by two actors between them", async () => {
    // Check balance is used by the customer and, through the statement that extends it, by the teller.
    const { scene } = await renderUml(
      USECASE_EXAMPLES.find(([name]) => name.includes("bank"))![1],
      umlColors,
    );
    const y = (id: string) => {
      const { box } = scene.shapes.find((shape) => shape.id === id)!;
      return box.y + box.height / 2;
    };
    expect(y("balance")).toBeGreaterThan(y("Teller"));
    expect(y("balance")).toBeLessThan(y("Customer"));
    expect(
      scene.wires.find((wire) => wire.from === "Teller" && wire.to === "statement")!.points,
    ).toHaveLength(2);
  });
});
