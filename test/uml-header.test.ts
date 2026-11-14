// @vitest-environment node
import { describe, expect, it } from "vitest";
import { detectUml, parseTam, parseUml, renderTam, renderUml, UmlError } from "../src/index";
import { scan } from "../src/uml";
import { colors, umlColors } from "./fixtures";

const rejection = async (run: () => unknown) => {
  try {
    await run();
  } catch (reason) {
    return reason as UmlError;
  }
  throw new Error("resolved");
};

const GENERIC = "This diagram type is drawn by Mermaid, not the built-in renderer.";

describe("Mermaid types this package does not draw", () => {
  const sources: [string, string, string, number][] = [
    ["erDiagram", "erDiagram\n  A ||--o{ B : has", "erDiagram", 1],
    ["pie with data", 'pie\n  "a" : 1', "pie", 1],
    ["pie title", "pie title Pets", "pie", 1],
    ["pie showData", "pie showData", "pie", 1],
    ["gitGraph direction", "gitGraph LR:", "gitGraph", 1],
    ["gantt after frontmatter", "---\ntitle: Plan\n---\ngantt\n  title Plan", "gantt", 4],
    ["erDiagram after a directive", "%%{init: {}}%%\n\nerDiagram", "erDiagram", 3],
    ["erDiagram after a multi-line directive", "%%{\n  init: {}\n}%%\nerDiagram", "erDiagram", 4],
    ["architecture-beta", "architecture-beta", "architecture-beta", 1],
    ["xychart-beta", "xychart-beta", "xychart-beta", 1],
    ["C4Context", "C4Context", "C4Context", 1],
    ["info", "info", "info", 1],
    ["erDiagram over 400 lines", "erDiagram" + "\n  A ||--o{ B : has".repeat(500), "erDiagram", 1],
    ["erDiagram over 20,000 characters", "erDiagram\n" + "x".repeat(30_000), "erDiagram", 1],
  ];

  it.each(sources)("raises the unsupported UmlError for %s", async (_name, source, word, line) => {
    const runs = [
      () => parseTam(source),
      () => renderTam(source, colors),
      () => parseUml(source),
      () => renderUml(source, umlColors),
    ];
    for (const run of runs) {
      const error = await rejection(run);
      expect(error).toBeInstanceOf(UmlError);
      expect(error).toMatchObject({ unsupported: true, line });
      const message = `${word} is drawn by Mermaid, not the built-in renderer.`;
      expect(error.message).toBe(`Line ${line}: ${message}`);
    }
    expect(detectUml(source)).toBeNull();
  });

  it("keeps the general message for a source that names no Mermaid type", async () => {
    const error = await rejection(() => parseUml("agent a"));
    expect(error).toMatchObject({ unsupported: true, line: 0 });
    expect(error.message).toBe(GENERIC);
  });
});

describe("a TAM source whose first element is named like a Mermaid keyword", () => {
  it.each(["graph", "flowchart", "pie", "pie2", "info", "block"])(
    "stays TAM when `%s` starts a connection",
    async (id) => {
      const source = `${id} -- calls --> api\nagent ${id}\nagent api`;
      expect(detectUml(source)).toBeNull();
      expect(parseTam(source).edges).toHaveLength(1);
      expect((await renderTam(source, colors)).svg).toContain("<svg");
    },
  );
});

describe("a TAM source whose first statement continues after the id", () => {
  const sources: [string, string][] = [
    ["pie provides", "pie provides IPie\ncomponent pie"],
    ["info requires", "info requires IStock\ncomponent info"],
    ["timeline provides", "timeline provides ITime\ncomponent timeline"],
    ["C4Context requires", "C4Context requires ICtx\ncomponent C4Context"],
    ["gantt &", "gantt & api -- reads --> db\nagent gantt\nagent api\nstorage db"],
    ["graph &", "graph & api -- reads --> db\nagent graph\nagent api\nstorage db"],
    ["graph provides", "graph provides IG\ncomponent graph"],
  ];

  it.each(sources)("stays TAM for `%s`", (name, source) => {
    expect(detectUml(source)).toBeNull();
    expect(parseTam(source).nodes.has(name.split(" ")[0])).toBe(true);
  });

  it("keeps a reverse link TAM and a bare `<` a flowchart direction", async () => {
    const link = "info <-- calls --> api\nagent info\nagent api";
    expect(detectUml(link)).toBeNull();
    expect(parseTam(link).edges).toHaveLength(1);
    for (const header of ["graph <", "flowchart <"]) {
      const source = `${header}\n  a --> b`;
      expect(detectUml(source)).toBe("flowchart");
      // `<` is Mermaid's right-to-left: a drawn flowchart, neither TAM nor an unsupported type.
      expect((await renderUml(source, umlColors)).kind).toBe("flowchart");
    }
  });
});

describe("a multi-line %%{ }%% directive", () => {
  const directive = '%%{\n  init: { "theme": "dark" }\n}%%\n';

  it("is skipped before a sequence diagram, which is then drawn", async () => {
    for (const head of [directive, '%%{init: { "theme": "dark" }}%%\n']) {
      const source = `${head}sequenceDiagram\n  A->>B: hi`;
      expect(detectUml(source)).toBe("sequence");
      expect((await renderUml(source, umlColors)).svg).toContain("<svg");
    }
  });

  it("skips nothing when no line closes it", () => {
    const source = "%%{\n  init: {}\nsequenceDiagram\n  A->>B: hi";
    expect(detectUml(source)).toBeNull();
    expect(scan(source).lines).toEqual([
      { text: "init: {}", line: 2 },
      { text: "sequenceDiagram", line: 3 },
      { text: "A->>B: hi", line: 4 },
    ]);
  });

  it("is not opened by a plain comment before a later directive", () => {
    const source = "%% about\nsequenceDiagram\n  A->>B: hi\n%%{init: {}}%%";
    expect(detectUml(source)).toBe("sequence");
    expect(scan(source).lines.map((item) => item.line)).toEqual([2, 3]);
  });

  it("does not hide a statement that follows its closing line", () => {
    const source = `${directive}%% a comment\nflowchart TB\n  a --> b`;
    expect(detectUml(source)).toBe("flowchart");
  });
});

describe("flowchart headers", () => {
  it.each(["graph TD", "graph TD;", "graph;", "flowchart LR", "flowchart-elk TB", "graph"])(
    "reads %j as a flowchart header",
    (header) => {
      expect(detectUml(`${header}\n  a --> b`)).toBe("flowchart");
    },
  );

  it.each(["graph -- calls --> api", "flowchart[x]", "graph.x", "flowchart  <-- a", "graph <== a"])(
    "does not read %j as a header",
    (line) => {
      expect(detectUml(line)).toBeNull();
    },
  );
});
