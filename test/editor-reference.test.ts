// The reference guides: every row and example is real source, the guides keep up with what the
// source pane completes, and the pages under docs/guides are what the guides write.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Completion, CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseTam, parseUml, renderTam } from "../src/index.ts";
import type { Known } from "../editor/completion.ts";
import { completeSource, idsOf } from "../editor/completion-uml.ts";
import {
  type Guide,
  type GuideRow,
  type GuideSection,
  GUIDES,
  guideMarkdown,
  guideOf,
  guideText,
  rowSource,
} from "../editor/reference.ts";
import { type GuideHost, GuideSheet } from "../editor/reference-dialog.ts";
import { scanSource } from "../editor/syntax.ts";
import { type DiagramType, sameType, TYPES, typeOf } from "../editor/types.ts";

const parse = (guide: Guide, source: string) =>
  guide.type === "tam" ? parseTam(source) : parseUml(source);

/** Every row of a guide with its section. */
const rowsOf = (guide: Guide): [GuideSection, GuideRow][] =>
  guide.sections.flatMap((section) =>
    (section.rows ?? []).map((item): [GuideSection, GuideRow] => [section, item]),
  );

describe("the guides", () => {
  it("has one for every diagram type of the editor", () => {
    expect(GUIDES.map((guide) => guide.type).toSorted()).toEqual(
      TYPES.map((info) => info.type).toSorted(),
    );
  });

  it.each(GUIDES.map((guide) => [guide.type, guide] as const))(
    "%s: says what the diagram shows, its rules, its syntax, an example and what is refused",
    (_, guide) => {
      const ids = guide.sections.map((section) => section.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.slice(0, 2)).toEqual(["about", "rules"]);
      expect(ids.slice(-2)).toEqual(["example", "refused"]);
      const section = (id: string) => guide.sections.find((item) => item.id === id)!;
      expect(section("about").prose).toBeTruthy();
      expect(section("rules").rules!.length).toBeGreaterThan(4);
      expect(section("example").example).toBeTruthy();
      expect(section("refused").rows!.length).toBeGreaterThan(2);
      // Rows the parser refuses stand in sections of their own, which a table heads as such.
      for (const item of guide.sections) {
        const refused = (item.rows ?? []).filter((entry) => entry.refused).length;
        expect([0, item.rows?.length ?? 0], `${guide.type} ${item.id}`).toContain(refused);
      }
      // Tables with at least a row of syntax beyond the header and the first lines.
      expect(rowsOf(guide).filter(([, item]) => !item.refused).length).toBeGreaterThan(25);
    },
  );

  it.each(GUIDES.map((guide) => [guide.type, guide] as const))(
    "%s: every row is source the parser reads, or refuses where the row says so",
    (_, guide) => {
      for (const [section, item] of rowsOf(guide)) {
        if (item.fragment) continue;
        const source = rowSource(guide, section, item),
          read = () => parse(guide, source);
        if (item.refused) expect(read, `${guide.type} refuses:\n${source}`).toThrow();
        else {
          expect(read, `${guide.type} reads:\n${source}`).not.toThrow();
          // A row may be read under another first line of its type: the lanes of an activity.
          expect(sameType(typeOf(source), guide.type), source).toBe(true);
        }
      }
    },
  );

  it.each(GUIDES.map((guide) => [guide.type, guide] as const))(
    "%s: a refused row is refused for itself, not for the lines around it",
    (_, guide) => {
      for (const [section, item] of rowsOf(guide)) {
        // A source of its own has no lines around it.
        if (!item.refused || item.whole) continue;
        const around = rowSource(guide, section, { ...item, write: "" });
        expect(() => parse(guide, around), `${guide.type}:\n${around}`).not.toThrow();
      }
    },
  );

  it.each(GUIDES.map((guide) => [guide.type, guide] as const))(
    "%s: the example is a diagram of the type, and is drawn",
    async (_, guide) => {
      const { example } = guide.sections.find((section) => section.id === "example")!;
      expect(typeOf(example!)).toBe(guide.type);
      if (guide.type !== "tam") expect(example!.split("\n")[0]).toBe(guide.header);
      const scene =
        guide.type === "tam"
          ? (
              await renderTam(
                example!,
                {
                  background: "#fff",
                  text: "#000",
                  secondary: "#444",
                  series: ["#00f"],
                  font: "Arial",
                  dark: false,
                },
                { measure: arialMeasure },
              )
            ).scene
          : await parseUml(example!).layout(arialMeasure);
      expect(scene.shapes.length).toBeGreaterThan(3);
    },
  );
});

/** The tags of the tokens that are the syntax itself: its keywords, its operators and its signs. */
const SYNTAX = new Set(["keyword", "operator", "annotation", "modifier", "atom", "punctuation"]);

/** The first words of the types, which a first line offers in every type. */
const HEADER =
  /^(classDiagram|usecase-beta|flowchart|swimlane-beta|stateDiagram-v2|sequenceDiagram|erDiagram)$/;

/** The tokens of a source that are syntax, as `tag text`; a block diagram's connection words too. */
const syntaxOf = (type: DiagramType, source: string): string[] =>
  scanSource(type, source)
    .lines.flat()
    .filter((token) => SYNTAX.has(token.tag) || (type === "tam" && token.tag === "typeName"))
    .map((token) => `${token.tag} ${token.text.trim()}`);

/** The elements a block diagram source declares. */
const declared = (source: string): Known[] =>
  [
    ...source.matchAll(
      /^\s*(agent|human|storage|component|subsystem|class|package|group)\s+(\w+)/gm,
    ),
  ].map(([, kind, id]) => ({ id, kind, label: id }));

/** The text a completion leaves when it is taken at the end of a source, from `from` on. */
function taken(completion: Completion, source: string, from: number): string {
  if (typeof completion.apply !== "function")
    return source.slice(0, from) + (completion.apply ?? completion.label);
  let state = EditorState.create({ doc: source });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      state = state.update(spec).state;
    },
  };
  (completion.apply as (...args: unknown[]) => void)(view, completion, from, source.length);
  return state.doc.toString();
}

describe("the guides and the completion", () => {
  it.each(GUIDES.map((guide) => [guide.type, guide] as const))(
    "%s: every keyword and operator the source pane completes stands in the guide",
    (_, guide) => {
      const { type } = guide;
      // What the guide writes: the tokens of its rows and example, and the code of its texts.
      const written = new Set<string>(),
        said = new Set<string>();
      const say = (text: string | undefined) => {
        for (const [, span] of (text ?? "").matchAll(/`([^`]+)`/g)) {
          said.add(span);
          for (const word of span.split(/\s+/)) said.add(word);
        }
      };
      const sources: string[] = [];
      for (const section of guide.sections) {
        say(section.prose);
        section.rules?.forEach(say);
        if (section.example) sources.push(section.example);
        for (const item of section.rows ?? []) {
          say(item.means);
          if (item.fragment) {
            said.add(item.write);
            for (const word of item.write.split(/\s+/)) said.add(word);
          } else if (!item.refused) sources.push(rowSource(guide, section, item));
        }
      }
      for (const source of sources) for (const token of syntaxOf(type, source)) written.add(token);

      // What the pane offers: asked at every place of every row, typed and by Ctrl+Space.
      const seen = new Set<string>(),
        missing = new Set<string>();
      for (const source of sources) {
        const known = type === "tam" ? declared(source) : [],
          ids = new Set(
            type === "tam"
              ? known.map((item) => item.id)
              : idsOf(type, source).map((item) => item.id),
          );
        for (let at = guide.header.length; at <= source.length; at++) {
          const before = source.slice(0, at),
            state = EditorState.create({ doc: before });
          for (const explicit of [false, true]) {
            const found = completeSource(new CompletionContext(state, at, explicit), type, known);
            for (const option of found?.options ?? []) {
              if (ids.has(option.label) || HEADER.test(option.label)) continue;
              const key = `${option.type} ${option.label} ${option.detail}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const after = taken(option, before, found!.from),
                old = new Set(syntaxOf(type, before));
              for (const token of syntaxOf(type, after)) {
                const text = token.slice(token.indexOf(" ") + 1);
                // A color is named in the guide without the signs before it.
                if (old.has(token) || written.has(token) || said.has(text.replace(/^:::/, "")))
                  continue;
                missing.add(`${token}, offered as "${option.label}"`);
              }
            }
          }
        }
      }
      expect(seen.size, "options were offered").toBeGreaterThan(15);
      expect([...missing]).toEqual([]);
    },
  );
});

describe("the activity guide", () => {
  it("is the guide of activity diagrams with lanes and without, and reads its lanes under `swimlane-beta`", () => {
    const guide = guideOf("flowchart")!;
    expect(guideOf("swimlane")).toBe(guide);
    expect(GUIDES.filter((item) => item.name.startsWith("Activity"))).toEqual([guide]);
    const lanes = guide.sections.find((section) => section.id === "lanes")!;
    expect(lanes.rules!.join(" ")).toContain("Lanes and groups do not mix");
    for (const item of lanes.rows!)
      expect(typeOf(rowSource(guide, lanes, item)), item.write).toBe("swimlane");
    const refused = guide.sections.find((section) => section.id === "refused")!;
    expect(
      refused.rows!.filter((item) => typeOf(rowSource(guide, refused, item)) === "swimlane"),
    ).toHaveLength(2);
  });
});

describe("the guides as pages", () => {
  const folder = join(process.cwd(), "docs", "guides"),
    page = (type: string) => join(folder, `${type}.md`);

  // `UPDATE_GUIDES=1 npx vitest run test/editor-reference.test.ts` writes the pages anew.
  it.each(GUIDES.map((guide) => guide.type))(
    "docs/guides/%s.md is what the guide writes",
    (type) => {
      if (process.env.UPDATE_GUIDES) {
        mkdirSync(folder, { recursive: true });
        writeFileSync(page(type), guideMarkdown(type));
      }
      expect(existsSync(page(type)), `${page(type)} exists`).toBe(true);
      expect(readFileSync(page(type), "utf8")).toBe(guideMarkdown(type));
    },
  );

  it("writes a page with a table for the rows and a fence for the example", () => {
    const text = guideMarkdown("tam");
    expect(text).toMatch(/^# TAM block diagram guide\n/);
    expect(text).toContain(
      "| `a -- calls --> b` | A request/response channel: `a` is the client, `b` the server. |",
    );
    expect(text).toContain("```tam\ntitle Order system\n");
    expect(guideMarkdown("flowchart")).toContain("| `a -->\\|yes\\| b` |");
    expect(guideMarkdown("class")).toContain("| `` class `Order Item` `` |");
    expect(guideOf("nothing")).toBeUndefined();
    expect(guideMarkdown("flowchart")).toContain("## Lanes");
    expect(() => guideMarkdown("nothing")).toThrow();
  });

  it("writes a compact text: each statement as written, under a comment that says what it means", () => {
    const text = guideText("tam");
    expect(text).toMatch(/^# TAM block diagram guide\nCompositional structure of a system/);
    expect(text).toContain(
      "%% A request/response channel: `a` is the client, `b` the server.\na -- calls --> b\n",
    );
    expect(text).toContain(
      "agent shop[Web Shop] {\n  agent api[Order API]\n  storage cart[Cart]\n}\n",
    );
    expect(text).toContain("## Example\ntitle Order system\n");
    expect(text).not.toMatch(/&nbsp;|<br>&|\| --- \||<!--/);
    expect(guideText("swimlane")).toBe(guideText("flowchart"));
    expect(() => guideText("nothing")).toThrow();
  });

  it.each(GUIDES.map((guide) => [guide.type, guide] as const))(
    "keeps all of the %s guide in its compact text, in fewer tokens",
    (type, guide) => {
      const text = guideText(type);
      expect(text).toContain(`${guide.about}.`);
      for (const section of guide.sections) {
        expect(text).toContain(`## ${section.title}\n`);
        for (const part of [section.prose, ...(section.rules ?? []), section.example])
          if (part) expect(text).toContain(part);
      }
      for (const [, item] of rowsOf(guide))
        expect(text).toContain(`%% ${item.means}\n${item.write}\n`);
      // Words, numbers and marks, roughly as a tokenizer splits them: markup such as `&nbsp;` costs.
      const tokens = (page: string) => (page.match(/[A-Za-z]+|\d+|[^\sA-Za-z\d]/g) ?? []).length;
      expect(tokens(text)).toBeLessThan(tokens(guideMarkdown(type)) * 0.85);
    },
  );
});

describe("the guide sheet", () => {
  /** A sheet in the page, with what it asked of its host. */
  const sheetOf = (type: DiagramType) => {
    const asked: string[] = [];
    const host: GuideHost = {
      type: () => type,
      insert: (text) => asked.push(`insert ${text}`),
      example: (source) => asked.push(`example ${source.split("\n")[0]}`),
      notify: (message) => asked.push(`notify ${message}`),
      shown: (open) => asked.push(open ? "open" : "closed"),
    };
    const sheet = new GuideSheet(host);
    document.body.append(sheet.element);
    return { sheet, asked };
  };
  const all = (sheet: GuideSheet, selector: string) => [
    ...sheet.element.querySelectorAll<HTMLElement>(selector),
  ];
  const shown = (sheet: GuideSheet, selector: string) =>
    all(sheet, selector).filter((item) => !item.hidden && !item.closest("[hidden]"));
  const press = (target: HTMLElement, key: string) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const type = (sheet: GuideSheet, text: string) => {
    const field = sheet.element.querySelector("input")!;
    field.value = text;
    field.dispatchEvent(new Event("input"));
    return field;
  };

  afterEach(() => document.body.replaceChildren());

  it.each(GUIDES.map((guide) => [guide.type, guide] as const))(
    "%s: shows every section, with a link to each, and the code as it is written",
    (_, guide) => {
      const { sheet } = sheetOf(guide.type);
      sheet.open();
      expect(sheet.type).toBe(guide.type);
      expect(all(sheet, "section").map((item) => item.id)).toEqual(
        guide.sections.map((section) => `guide-${section.id}`),
      );
      expect(all(sheet, ".guide-link").length).toBe(guide.sections.length);
      // Coloring leaves every character of a row and of the example where it was.
      expect(all(sheet, ".guide-row > code").map((item) => item.textContent)).toEqual(
        rowsOf(guide).map(([, item]) => item.write),
      );
      expect(sheet.element.querySelector(".guide-example code")!.textContent).toBe(
        guide.sections.find((section) => section.id === "example")!.example,
      );
      expect(sheet.element.querySelector(".guide-example .tok-keyword")).not.toBeNull();
    },
  );

  it("opens the guide of the diagram on show, takes the focus and gives it back", () => {
    const { sheet, asked } = sheetOf("state");
    const before = document.body.appendChild(document.createElement("button"));
    before.focus();
    expect(sheet.isOpen).toBe(false);
    sheet.toggle();
    expect([sheet.isOpen, sheet.type]).toEqual([true, "state"]);
    expect(document.activeElement).toBe(sheet.element.querySelector("input"));
    // The same key closes it; Escape does too.
    sheet.toggle();
    expect(sheet.isOpen).toBe(false);
    expect(document.activeElement).toBe(before);
    sheet.open("class");
    expect(sheet.type).toBe("class");
    // Another guide than the diagram's is on show: the key brings the diagram's.
    sheet.toggle();
    expect(sheet.type).toBe("state");
    press(document.activeElement as HTMLElement, "Escape");
    expect(sheet.isOpen).toBe(false);
    expect(asked).toEqual(["open", "closed", "open", "closed"]);
  });

  it("lists all guides, and opens the one that is picked", () => {
    const { sheet } = sheetOf("tam");
    sheet.open("all");
    expect(sheet.type).toBeUndefined();
    const entries = all(sheet, ".guide-entry");
    expect(entries.map((entry) => entry.querySelector("strong")!.textContent)).toEqual(
      GUIDES.map((guide) => guide.name),
    );
    expect(shown(sheet, "input")).toEqual([]);
    entries[2].click();
    expect(sheet.type).toBe(GUIDES[2].type);
    expect(shown(sheet, "input").length).toBe(1);
  });

  it("narrows the rows to what the filter says, across the sections", () => {
    const { sheet } = sheetOf("tam");
    sheet.open();
    const rows = shown(sheet, ".guide-row").length;
    const field = type(sheet, "protocol");
    const left = shown(sheet, ".guide-row");
    expect(left.length).toBeGreaterThan(3);
    expect(left.length).toBeLessThan(rows / 4);
    for (const item of left) expect(item.dataset.text).toContain("protocol");
    expect(shown(sheet, "section").length).toBeGreaterThan(2);
    expect(sheet.element.querySelector(".guide-count")!.textContent).toBe(`${left.length} rows`);
    // Every word is asked for; a section's title brings the whole section.
    type(sheet, "calls bidirectional");
    expect(shown(sheet, ".guide-row").map((item) => item.dataset.text!.split("\n")[0])).toEqual([
      "a <-- calls --> b",
    ]);
    type(sheet, "dependencies");
    expect(shown(sheet, ".guide-row").length).toBe(3);
    type(sheet, "no such thing");
    expect(shown(sheet, "section")).toEqual([]);
    expect(sheet.element.querySelector(".guide-count")!.textContent).toBe("Nothing");
    // Escape clears the filter first, and closes the sheet then.
    press(field, "Escape");
    expect([sheet.isOpen, field.value, shown(sheet, ".guide-row").length]).toEqual([
      true,
      "",
      rows,
    ]);
    press(field, "Escape");
    expect(sheet.isOpen).toBe(false);
  });

  it("goes from row to row by the arrow keys, and writes a row into the source by Enter", () => {
    const { sheet, asked } = sheetOf("tam");
    sheet.open();
    const field = sheet.element.querySelector("input")!,
      rows = shown(sheet, ".guide-row");
    // One row is the stop of Tab.
    expect(rows.filter((item) => item.tabIndex === 0)).toEqual([rows[0]]);
    press(field, "ArrowDown");
    expect(document.activeElement).toBe(rows[0]);
    press(rows[0], "ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
    expect(rows.filter((item) => item.tabIndex === 0)).toEqual([rows[1]]);
    press(rows[1], "End");
    expect(document.activeElement).toBe(rows.at(-1));
    press(rows.at(-1)!, "Home");
    press(rows[0], "ArrowUp");
    expect(document.activeElement).toBe(field);
    asked.length = 0;
    press(rows[0], "Enter");
    expect(asked).toEqual(["insert title Order system"]);
    // A row the parser refuses, and a sign on its own, are not written.
    press(sheet.element.querySelector<HTMLElement>(".refused .guide-row")!, "Enter");
    expect(asked.length).toBe(1);
    expect(
      all(sheet, ".refused .guide-acts button").every((item) => item.dataset.tip === "Copy"),
    ).toBe(true);
    // A key pressed in the sheet does not reach the canvas.
    let reached = 0;
    const count = () => reached++;
    window.addEventListener("keydown", count);
    press(rows[0], "Delete");
    window.removeEventListener("keydown", count);
    expect(reached).toBe(0);
  });

  it("writes only into a diagram of the guide's type, and hands the example to the window", () => {
    const { sheet, asked } = sheetOf("class");
    sheet.open("state");
    asked.length = 0;
    press(shown(sheet, ".guide-row")[0], "Enter");
    expect(asked).toEqual([
      "notify This is state machine diagram syntax; the diagram on show is a class diagram.",
    ]);
    const open = all(sheet, ".guide-example button").find(
      (item) => item.textContent === "Open as diagram",
    )!;
    open.click();
    expect(asked.at(-1)).toBe("example stateDiagram-v2");
  });
});
