// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseError, umlColors } from "./fixtures.ts";
import { parseFlowchart } from "../src/uml-activity.ts";
import { renderUml } from "../src/index.ts";
import { auditScene } from "../src/audit.ts";
import { nodeBox } from "../src/uml-activity-layout.ts";
import { generateFlowchart } from "../src/samples/fuzz.ts";
import type { Scene } from "../src/scene.ts";

const error = (source: string) => parseError(parseFlowchart, source);
const defects = (scene: Scene) => auditScene(scene).filter((finding) => !finding.note);
/** The wire ends at a shape, as points. */
const endsAt = (scene: Scene, id: string) =>
  scene.wires.flatMap((wire) => [
    ...(wire.from === id ? [wire.points[0]] : []),
    ...(wire.to === id ? [wire.points.at(-1)!] : []),
  ]);

describe("flowchart syntax", () => {
  it("reads every node shape", () => {
    const chart = parseFlowchart(
      "flowchart LR\n  a[A] --> b(B) --> c([C]) --> d[[D]] --> e[(E)] --> f((F)) --> g{G} --> h{{H}}\n  h --> i[/I/] --> j[\\J\\] --> k[/K\\] --> l[\\L/] --> m>M] --> n(((N))) --> o@{ shape: fork }",
    );
    expect([...chart.nodes.values()].map((node) => node.shape)).toEqual([
      "rect",
      "round",
      "stadium",
      "subroutine",
      "cylinder",
      "circle",
      "diamond",
      "hexagon",
      "lean-right",
      "lean-left",
      "trapezoid",
      "trapezoid-top",
      "flag",
      "double-circle",
      "bar",
    ]);
  });

  it("reads edges with labels, chains and ampersands", () => {
    const chart = parseFlowchart(
      "graph TD;\n  A -- yes --> B;\n  A -. maybe .-> C\n  A == sure ==> D\n  B & C --> E -->|done| F\n  E --o G\n  E --x H\n  E <--> I\n  E ~~~ J",
    );
    expect(
      chart.edges.map((edge) => [
        edge.source,
        edge.target,
        edge.stroke,
        edge.start ?? "",
        edge.end ?? "",
        edge.label ?? "",
      ]),
    ).toEqual([
      ["A", "B", "solid", "", "arrow", "yes"],
      ["A", "C", "dotted", "", "arrow", "maybe"],
      ["A", "D", "thick", "", "arrow", "sure"],
      ["B", "E", "solid", "", "arrow", ""],
      ["C", "E", "solid", "", "arrow", ""],
      ["E", "F", "solid", "", "arrow", "done"],
      ["E", "G", "solid", "", "circle", ""],
      ["E", "H", "solid", "", "cross", ""],
      ["E", "I", "solid", "arrow", "arrow", ""],
      ["E", "J", "invisible", "", "", ""],
    ]);
  });

  it("makes start and end circles UML initial and final nodes", () => {
    const chart = parseFlowchart(
      "flowchart TB\n  s((Start)) --> a[Act] --> e(((End)))\n  c((Hub)) --> a\n  a --> c",
    );
    expect(["s", "e", "c"].map((id) => chart.nodes.get(id)!.shape)).toEqual([
      "initial",
      "final",
      "circle",
    ]);
  });

  it("keeps start and stop symbols that flows lead into or out of as the circles Mermaid draws", () => {
    // An initial node has no incoming flows, a final node no outgoing ones, and a circle that starts
    // more flows than an initial node has vertices stays a circle.
    const chart = parseFlowchart(
      "flowchart TB\n  a --> s@{ shape: start } --> b\n  e@{ shape: stop } --> b\n  a --> e\n  h((Hub)) --> a & b & c & d & f",
    );
    expect(["s", "e", "h"].map((id) => chart.nodes.get(id)!.shape)).toEqual([
      "circle",
      "double-circle",
      "circle",
    ]);
  });

  it("reads subgraphs and swimlanes", () => {
    const chart = parseFlowchart(
      "swimlane-beta LR\n  subgraph a [Lane A]\n    x --> y\n  end\n  subgraph b\n    z\n  end\n  y --> z",
    );
    expect(chart).toMatchObject({ kind: "swimlane", direction: "LR" });
    expect([...chart.nodes.values()].map((node) => [node.id, node.parent])).toEqual([
      ["x", "a"],
      ["y", "a"],
      ["z", "b"],
    ]);
  });

  it("reports errors and leaves unsupported syntax to Mermaid", () => {
    expect(error("flowchart TB\n  subgraph a\n    x").message).toBe(
      "Line 2: Subgraph `a` is missing its `end`.",
    );
    expect(error("flowchart TB\n  a[open --> b").message).toMatch(
      /^Line 2: `a\[` is missing its closing `\]`/,
    );
    expect(error("flowchart XY\n  a").message).toMatch(/Unknown direction/);
    expect(error("flowchart TB\n  a@{ shape: notch-rect }").unsupported).toBe(true);
    expect(
      error("swimlane-beta TB\n  subgraph a\n    subgraph b\n      x\n    end\n  end").unsupported,
    ).toBe(true);
  });

  it("renders activity diagrams and swimlanes without defects", async () => {
    for (const source of [
      "flowchart TB\n  s((Start)) --> a(Act) --> d{ok?}\n  d -->|yes| e(((End)))\n  d -->|no| a",
      "swimlane-beta TB\n  subgraph A\n    s((Start)) --> a(Act)\n  end\n  subgraph B\n    b(React) --> e(((End)))\n  end\n  a --> b",
    ]) {
      const { scene } = await renderUml(source, umlColors);
      expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    }
  });

  it("takes each wire of a small symbol at a vertex of its own", async () => {
    // ELK lays the wires out at fixed ports on the vertices (addVertexPorts), so none is moved there afterwards.
    const { scene } = await renderUml(
      "flowchart TB\n  s((Start)) --> a(Act) & b(Other) & c(Third) & d{Decide?}\n  a --> d\n  d -->|one| e(E)\n  d -->|two| f(F)\n  d -->|three| g(G)",
      umlColors,
    );
    expect(defects(scene)).toEqual([]);
    for (const id of ["s", "d"]) {
      const shape = scene.shapes.find((item) => item.id === id)!,
        { x, y, width, height } = shape.box;
      const vertices = [
        { x: x + width / 2, y },
        { x: x + width, y: y + height / 2 },
        { x: x + width / 2, y: y + height },
        { x, y: y + height / 2 },
      ];
      const used = endsAt(scene, id).map((point) =>
        vertices.findIndex((vertex) => Math.hypot(vertex.x - point.x, vertex.y - point.y) < 1.5),
      );
      expect(used.every((index) => index >= 0) && new Set(used).size === used.length).toBe(true);
    }
  });

  it("makes the side of a node across the flow long enough for the arrowheads on it", async () => {
    const box = nodeBox(
      { id: "a", label: "Act", shape: "round", parent: null, line: 1, declared: true },
      { in: 1, out: 5 },
      false,
      (text) => text.length * 7,
    );
    expect(box.height).toBeGreaterThanOrEqual(7 * 12);
    const { scene } = await renderUml(
      "flowchart LR\n  a(Act) <--> b(B) & c(C) & d(D) & e(E) & f(F)",
      umlColors,
    );
    expect(defects(scene)).toEqual([]);
  });

  it("grows a symbol with more wires than vertices, as a decision with many branches", () => {
    const box = nodeBox(
      { id: "x", label: "", shape: "flow-final", parent: null, line: 1, declared: true },
      { in: 6, out: 0 },
      true,
      (text) => text.length * 7,
    );
    expect(box).toMatchObject({ kind: "flow-final", width: 42, height: 42 });
    expect(box.centered).toBeFalsy();
  });

  it("leaves room below a group title for an arrowhead into the group", async () => {
    const { scene } = await renderUml(
      "flowchart TB\n  x(Outside) --> y(Inside)\n  subgraph g [A rather long group title]\n    y\n  end",
      umlColors,
    );
    expect(defects(scene)).toEqual([]);
  });

  it("lets a swimlane branch take the vertex facing it and writes the question at a free one", async () => {
    // [no] faces the right vertex, where a question stands by default: the wire keeps it (and so
    // does not cross [yes]), the question goes left.
    const { scene } = await renderUml(
      "swimlane-beta TB\n  subgraph Ops\n    s((Start)) --> d{Known?}\n    d -->|yes| a(Apply runbook)\n  end\n  subgraph Team\n    e(Escalate)\n  end\n  d -->|no| e",
      umlColors,
    );
    expect(defects(scene)).toEqual([]);
    const diamond = scene.shapes.find((shape) => shape.id === "d")!.box,
      no = scene.wires.find((wire) => wire.to === "e")!;
    expect(no.points[0]).toMatchObject({
      x: diamond.x + diamond.width,
      y: diamond.y + diamond.height / 2,
    });
    const question = scene.texts.find((text) => text.owner === "d")!;
    expect(question.box.x + question.box.width).toBeLessThanOrEqual(diamond.x);
  });

  // Generated diagrams that once had defects, by cause: wires crowding a symbol's side (119), a
  // question or name beside a vertex a wire took (58, 63), an arrowhead on a group title (23, 64),
  // arrowheads on a short side (10, 31, 55); in swimlanes: guards and questions placed after the
  // wires (3, 80, 150), labels inside a fan of wires (5, 91), symbols with doubled vertices (16,
  // 147), wires across port markers (18, 48).
  it.each([
    ...[10, 23, 31, 55, 58, 63, 64, 119].map((seed) => [seed, false] as const),
    ...[3, 5, 16, 18, 48, 80, 91, 147, 150].map((seed) => [seed, true] as const),
  ])("renders generated diagram %i (swimlanes: %s) without defects", async (seed, swimlanes) => {
    const { scene } = await renderUml(generateFlowchart(seed, { swimlanes }), umlColors);
    expect(defects(scene)).toEqual([]);
  });
});
