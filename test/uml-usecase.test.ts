// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseError, umlColors } from "./fixtures.ts";
import { parseUseCaseDiagram } from "../src/uml-usecase.ts";
import { USECASE_EXAMPLES } from "../src/samples/uml-examples.ts";
import { renderUml } from "../src/index.ts";
import { auditScene } from "../src/audit.ts";

const error = (source: string) => parseError(parseUseCaseDiagram, source);

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
