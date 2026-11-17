import { describe, expect, it } from "vitest";
import { labelText } from "../src/uml.ts";
import { parseSequenceDiagram } from "../src/uml-sequence.ts";
import { parseFlowchart } from "../src/uml-activity.ts";
import { parseStateDiagram } from "../src/uml-state.ts";

describe("a Mermaid label's text", () => {
  it("keeps what HTML formatting tags hold and drops the tags, as Mermaid shows them", () => {
    expect(labelText("<b>bold</b> and <i>slanted</i>")).toBe("bold and slanted");
    expect(labelText('<span style="color:red">red</span>')).toBe("red");
    expect(labelText("two<br>lines")).toBe("two<br>lines");
  });

  it("shows anything else in angle brackets as written", () => {
    expect(labelText("create_branch autofix/<id>")).toBe("create_branch autofix/<id>");
    expect(labelText("Map<K,V> of <token>")).toBe("Map<K,V> of <token>");
    expect(labelText("a < b and c > d")).toBe("a < b and c > d");
  });

  it("keeps a placeholder in a message, a node and a transition", () => {
    const sequence = parseSequenceDiagram("sequenceDiagram\n  a->>b: push autofix/<id>");
    expect(JSON.stringify(sequence.events)).toContain("push autofix/<id>");
    const flow = parseFlowchart("flowchart TB\n  a[Fetch <url>] --> b");
    expect(flow.nodes.get("a")!.label).toBe("Fetch <url>");
    const state = parseStateDiagram("stateDiagram-v2\n  A --> B : on <event>");
    expect(JSON.stringify(state)).toContain("on <event>");
  });
});
