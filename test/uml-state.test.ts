// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseError, umlColors } from "./fixtures.ts";
import { parseStateDiagram } from "../src/uml-state.ts";
import { renderUml } from "../src/index.ts";
import { auditScene } from "../src/audit.ts";
import { generateStateDiagram } from "../src/samples/fuzz.ts";

const error = (source: string) => parseError(parseStateDiagram, source);

describe("state diagram syntax", () => {
  it("reads states, aliases, descriptions and transitions with labels", () => {
    const diagram = parseStateDiagram(`stateDiagram-v2
  state "Waiting for payment" as Waiting
  Waiting : entry / start timer
  [*] --> Waiting
  Waiting --> Paid : payment [ok] / ship
  Paid --> [*]
  Waiting --> [*]`);
    expect(diagram.states.get("Waiting")).toMatchObject({
      label: "Waiting for payment",
      descriptions: ["entry / start timer"],
    });
    expect(
      diagram.transitions.map((transition) => [
        transition.source,
        transition.target,
        transition.label,
      ]),
    ).toEqual([
      ["root#initial", "Waiting", undefined],
      ["Waiting", "Paid", "payment [ok] / ship"],
      ["Paid", "root#final1", undefined],
      ["Waiting", "root#final2", undefined],
    ]);
  });

  it("gives each composite and region its own initial state", () => {
    const diagram = parseStateDiagram(`stateDiagram-v2
  [*] --> Active
  state Active {
    [*] --> A1
    --
    [*] --> B1
    B1 --> [*]
  }`);
    const active = diagram.states.get("Active")!;
    expect(active.children.map((id) => diagram.states.get(id)!.kind)).toEqual(["region", "region"]);
    const [first, second] = active.children.map((id) => diagram.states.get(id)!);
    expect(first.children).toEqual(["Active#initial", "A1"]);
    expect(second.children).toEqual([`${second.id}#initial`, "B1", `${second.id}#final1`]);
  });

  it("reads choice, fork and join pseudo-states and notes", () => {
    const diagram = parseStateDiagram(`stateDiagram-v2
  state c <<choice>>
  state f <<fork>>
  state j [[join]]
  note right of c : decide
  note left of f
    two lines
    of text
  end note`);
    expect(["c", "f", "j"].map((id) => diagram.states.get(id)!.kind)).toEqual([
      "choice",
      "fork",
      "join",
    ]);
    expect(diagram.notes.map((note) => [note.target, note.side, note.text])).toEqual([
      ["c", "right", "decide"],
      ["f", "left", "two lines<br>of text"],
    ]);
  });

  it("reports errors with line numbers", () => {
    expect(error("stateDiagram-v2\n  state A {\n    B --> C").message).toBe(
      "Line 2: `A` is missing its closing `}`.",
    );
    expect(error("stateDiagram-v2\n  A --> B\n  --").message).toBe(
      "Line 3: Concurrent regions (`--`) belong inside a composite state.",
    );
    expect(error("stateDiagram-v2\n  note right of A\n  text").message).toBe(
      "Line 2: The note is missing its `end note`.",
    );
    expect(error("stateDiagram-v2\n  A ==> B").message).toBe("Line 2: Cannot read `A ==> B`.");
    expect(error("stateDiagram-v2\n  state A {\n    B --> C\n  }\n  A : busy").message).toBe(
      "Line 2: The composite state `A` has a name only, no description.",
    );
  });

  it("applies TAM: state machines are conceptual and have no fork or join bars", () => {
    expect(error("stateDiagram-v2\n  %% level design\n  A --> B").message).toMatch(
      /belong to the conceptual level/,
    );
    expect(error("stateDiagram-v2\n  %% level conceptual\n  state f <<fork>>").message).toMatch(
      /^Line 3: TAM state machines have no fork bars/,
    );
  });
});

describe("state diagram rendering", () => {
  it("draws initial and final states, rounded states and labelled transitions", async () => {
    const { scene } = await renderUml(
      "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy : work\n  Busy --> Idle : done\n  Busy --> [*]",
      umlColors,
    );
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    expect(scene.shapes.map((shape) => shape.kind).toSorted()).toEqual([
      "final",
      "initial",
      "round",
      "round",
    ]);
    expect(scene.markers.every((marker) => marker.kind === "arrow")).toBe(true);
    // The machine reads top to bottom from its initial state.
    const y = (id: string) => scene.shapes.find((shape) => shape.id === id)!.box.y;
    expect(y("root#initial")).toBeLessThan(y("Idle"));
    expect(y("Idle")).toBeLessThan(y("Busy"));
  });

  it("separates concurrent regions with dashed lines in source order", async () => {
    const { scene } = await renderUml(
      "stateDiagram-v2\n  state Active {\n    [*] --> A\n    --\n    [*] --> B\n    --\n    [*] --> C\n  }",
      umlColors,
    );
    expect(scene.lines.filter((line) => line.dashed)).toHaveLength(2);
    const x = (id: string) => scene.shapes.find((shape) => shape.id === id)!.box.x;
    expect(x("A")).toBeLessThan(x("B"));
    expect(x("B")).toBeLessThan(x("C"));
  });

  it("stands a note beside a choice whose vertices all take wires in the corner", async () => {
    const { scene } = await renderUml(
      "stateDiagram-v2\n  state c <<choice>>\n  [*] --> c\n  c --> A\n  c --> B : left\n  c --> D : right\n  note left of c : decide here",
      umlColors,
    );
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    const choice = scene.shapes.find((shape) => shape.id === "c")!.box,
      note = scene.shapes.find((shape) => shape.kind === "note")!.box;
    expect(note.y + note.height).toBeLessThan(choice.y);
  });

  // Generated machines that once had defects: wires moved onto a choice's vertices after layout
  // (43, 53, 100, 103, 126), arrowheads on a short side (55), a note on a fully wired choice (1069).
  it.each([43, 53, 55, 100, 103, 126, 1069])(
    "renders generated machine %i without defects",
    async (seed) => {
      const { scene } = await renderUml(generateStateDiagram(seed), umlColors);
      expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    },
  );
});
