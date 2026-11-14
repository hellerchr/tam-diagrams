// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseError, umlColors } from "./fixtures.ts";
import {
  parseSequenceDiagram,
  type MessageEvent,
  type SequenceDiagram,
} from "../src/uml-sequence.ts";
import { checkActivations } from "../src/uml-sequence-activation.ts";
import { layoutSequenceDiagram } from "../src/uml-sequence-layout.ts";
import { arialMeasure, parseUml, renderUml, UmlError } from "../src/index.ts";
import { auditScene } from "../src/audit.ts";
import { generateSequenceDiagram } from "../src/samples/fuzz.ts";
import { SEQUENCE_EXAMPLES } from "../src/samples/uml-examples.ts";

const error = (source: string) => parseError(parseSequenceDiagram, source);
const messages = (source: string) =>
  parseSequenceDiagram(source).events.filter(
    (event): event is MessageEvent => event.type === "message",
  );

describe("sequence diagram syntax", () => {
  it("reads participants, actors, aliases and every arrow", () => {
    const diagram = parseSequenceDiagram(
      "sequenceDiagram\n  participant A as Alice\n  actor B as Bob\n  A->B: a\n  A-->B: b\n  A->>B: c\n  A-->>B: d\n  A-xB: e\n  A--xB: f\n  A-)B: g\n  A--)B: h\n  A<<->>B: i\n  A<<-->>B: j",
    );
    expect(
      [...diagram.participants.values()].map((item) => [item.id, item.label, item.actor]),
    ).toEqual([
      ["A", "Alice", false],
      ["B", "Bob", true],
    ]);
    expect(
      messages(
        "sequenceDiagram\n  A->B: a\n  A-->B: b\n  A->>B: c\n  A-->>B: d\n  A-xB: e\n  A-)B: g\n  A<<->>B: i",
      ).map((event) => [event.text, event.dashed, event.head, event.tail]),
    ).toEqual([
      ["a", false, null, null],
      ["b", true, null, null],
      ["c", false, "arrow", null],
      ["d", true, "open", null],
      ["e", false, "cross", null],
      ["g", false, "open", null],
      ["i", false, "arrow", "arrow"],
    ]);
  });

  it("reads activations, notes, fragments, numbering, creation and destruction", () => {
    const diagram = parseSequenceDiagram(`sequenceDiagram
  autonumber 10 5
  A->>+B: call
  B-->>-A: done
  note over A,B: both
  alt ok
    A->>B: yes
  else not ok
    A->>B: no
  end
  create participant C
  A->>C: new
  destroy C
  A-xC: bye`);
    expect(diagram.events.map((event) => event.type)).toEqual([
      "message",
      "message",
      "note",
      "start",
      "message",
      "else",
      "message",
      "end",
      "create",
      "message",
      "destroy",
      "message",
    ]);
    expect(
      messages(`sequenceDiagram\n  autonumber 10 5\n  A->>+B: call\n  B-->>-A: done`).map(
        (event) => [event.number, event.activate, event.deactivate],
      ),
    ).toEqual([
      [10, true, false],
      [15, false, true],
    ]);
    expect(diagram.participants.get("C")).toMatchObject({ created: true, destroyed: true });
  });

  it("reports errors with line numbers and leaves unsupported syntax to Mermaid", () => {
    expect(error("sequenceDiagram\n  loop forever\n  A->>B: x").message).toBe(
      "Line 2: `loop` is missing its `end`.",
    );
    expect(error("sequenceDiagram\n  A->>B: x\n  else").message).toMatch(
      /^Line 3: `else` belongs inside `alt`/,
    );
    expect(error('sequenceDiagram\n  participant A@{ "type": "database" }').unsupported).toBe(true);
    expect(
      error("sequenceDiagram\n  %% level conceptual\n  create participant A\n  B->>A: x").message,
    ).toMatch(/creation belongs to the design level/);
  });
});

describe("sequence diagram rendering", () => {
  it("draws lifelines, bars that turn white while waiting, and frames without defects", async () => {
    const { scene } = await renderUml(
      "sequenceDiagram\n  activate A\n  A->>+B: call\n  B-->>-A: answer\n  deactivate A\n  loop again\n    A->>B: ping\n  end",
      umlColors,
    );
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
    expect(scene.lines.filter((line) => line.dashed).length).toBeGreaterThanOrEqual(2);
    const bars = scene.shapes.filter((shape) => shape.kind === "activation");
    expect(bars.map((bar) => bar.fill)).toEqual(["strong", "page", "strong"]);
    expect(scene.shapes.some((shape) => shape.kind === "frame")).toBe(true);
    expect(scene.markers.map((marker) => marker.kind)).toEqual(["arrow", "open", "arrow"]);
  });

  it("centers the cross of a lost message where the message meets the lifeline", async () => {
    const { scene } = await renderUml(
      "sequenceDiagram\n  participant A\n  participant B\n  A-xB: lost\n  B--xA: dotted lost",
      umlColors,
    );
    const lifelines = scene.lines.filter((line) => line.dashed).map((line) => line.points[0].x);
    const crosses = scene.markers.filter((marker) => marker.kind === "cross");
    expect(crosses).toHaveLength(2);
    for (const cross of crosses) {
      const wire = scene.wires.find((item) => item.edge === cross.wire)!;
      expect(cross.tip).toEqual(wire.points.at(-1));
      expect(lifelines.some((x) => Math.abs(x - cross.tip.x) < 0.01)).toBe(true);
    }
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
  });

  it("keeps sequence number badges just outside the bar or lifeline they leave", async () => {
    const { scene } = await renderUml(
      [
        "sequenceDiagram",
        "  autonumber",
        "  Alice->>+John: Hello",
        "  Alice->>+John: Nested",
        "  John-->>-Alice: Reply from the nested bar",
        "  John-->>-Alice: Reply",
        "  rect rgb(200, 150, 255)",
        "  Alice ->>+ John: Is it ok?",
        "  John -->>- Alice: Yes",
        "  end",
        "  John->>John: Think",
      ].join("\n"),
      umlColors,
    );
    const badges = scene.shapes.filter((shape) => shape.kind === "badge"),
      bars = scene.shapes.filter((shape) => shape.kind === "activation");
    expect(badges).toHaveLength(7);
    for (const badge of badges) {
      for (const bar of bars)
        expect(
          badge.box.x >= bar.box.x + bar.box.width + 3 ||
            badge.box.x + badge.box.width <= bar.box.x - 3 ||
            badge.box.y >= bar.box.y + bar.box.height ||
            badge.box.y + badge.box.height <= bar.box.y,
        ).toBe(true);
      for (const line of scene.lines.filter((item) => item.dashed))
        expect(Math.abs(line.points[0].x - (badge.box.x + badge.box.width / 2))).toBeGreaterThan(
          badge.box.width / 2 + 3,
        );
    }
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
  });

  // Generated diagrams that once had defects: a fragment's tab over the bar of the lifeline before
  // its first one (1034), a self message's label over the next lifeline's bar (1015).
  it.each([1015, 1034])("renders generated diagram %i without defects", async (seed) => {
    const { scene } = await renderUml(generateSequenceDiagram(seed), umlColors);
    expect(auditScene(scene).filter((finding) => !finding.note)).toEqual([]);
  });
});

// What `run` throws, or "drawn" when it does not.
const outcome = async (run: () => unknown) => {
  try {
    await run();
    return "drawn";
  } catch (reason) {
    return (reason as Error).message;
  }
};

// What `run` throws; fails when it does not.
const rejection = async (run: () => unknown) => {
  try {
    await run();
  } catch (reason) {
    return reason as UmlError;
  }
  throw new Error("resolved");
};
// Drops every opening of a bar, so the closings of a parsed diagram close bars never opened.
const withoutOpenings = (diagram: SequenceDiagram) => {
  diagram.events = diagram.events.filter((event) => event.type !== "activate");
  for (const event of diagram.events) if (event.type === "message") event.activate = false;
  return diagram;
};

describe("activation errors", () => {
  const sources = [...SEQUENCE_EXAMPLES.map(([, source]) => source)];
  for (let seed = 1; seed <= 12; seed++) sources.push(generateSequenceDiagram(seed));

  it.each(sources.map((source, index) => [index, source] as const))(
    "parses and renders sequence source %i alike",
    async (_index, source) => {
      expect(await outcome(() => parseUml(source))).toBe("drawn");
      expect(await outcome(() => renderUml(source, umlColors))).toBe("drawn");
    },
  );

  it.each([
    ["deactivate without a message", "A->>B: hi\ndeactivate B", "Line 3: `B` is not active."],
    ["activation already closed", "activate A\ndeactivate A\ndeactivate A", "Line 4"],
    ["`-` on a plain sender", "A->>-B: hi", "Line 2: `A` is not active."],
    ["`-` on a self message", "A->>-A: hi", "Line 2: `A` is not active."],
    ["`-` after the bar closed", "A->>+B: a\nB-->>-A: b\nB-->>-A: c", "Line 4"],
    ["`-` on a created participant's sender", "create participant B\nA->>-B: new", "Line 3"],
    ["deactivate inside a fragment", "alt x\nA->>B: m\ndeactivate B\nend", "Line 4"],
  ])("parseUml rejects %s as renderUml does", async (_name, body, message) => {
    const source = `sequenceDiagram\n${body}`;
    const parsed = await outcome(() => parseUml(source));
    expect(parsed).toContain(message);
    expect(parsed).toContain("is not active");
    expect(parsed).toBe(await outcome(() => renderUml(source, umlColors)));
  });

  // The parser runs checkActivations, so a parsed source never reaches the layout's own throws.
  it.each([
    ["a `deactivate` event", "activate B\ndeactivate B", 3],
    ["a `-` on a plain message", "A->>+B: a\nB-->>-A: b", 3],
    ["a `-` on a self message", "A->>+A: a\nA->>-A: b", 3],
    ["a `-` on a creating message", "activate A\ncreate participant B\nA->>-B: new", 4],
  ])("the layout and checkActivations reject %s alike", async (_name, body, line) => {
    const diagram = withoutOpenings(parseSequenceDiagram(`sequenceDiagram\n${body}`));
    const checked = await rejection(() => checkActivations(diagram.events));
    const laidOut = await rejection(() => layoutSequenceDiagram(diagram, arialMeasure));
    expect(checked).toBeInstanceOf(UmlError);
    expect(laidOut).toBeInstanceOf(UmlError);
    expect(laidOut.line).toBe(line);
    expect([laidOut.line, laidOut.message]).toEqual([checked.line, checked.message]);
  });
});
