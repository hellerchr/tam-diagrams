import { describe, expect, it } from "vitest";
import { arialMeasure } from "../src/arial-measure.ts";
import { parseUml } from "../src/index.ts";
import { startsOf, syntaxRows, thumbOf } from "../editor/dialogs.ts";
import { Doc } from "../editor/document.ts";
import {
  diagramIn,
  extensionOf,
  fileStem,
  readRecents,
  stemOf,
  withBackground,
  withRecent,
} from "../editor/files.ts";
import { type MenuItem, refusal } from "../editor/menu.ts";
import { STARTER } from "../editor/starter.ts";
import { TYPES, typeInfo } from "../editor/types.ts";
import { wheelZoom, ZOOM_LEVELS, zoomLevel } from "../editor/view.ts";

describe("the name a diagram is saved under", () => {
  it("keeps the letters of every script and drops what is neither a letter nor a digit", () => {
    expect(fileStem("Order system")).toBe("order-system");
    expect(fileStem('A <b>&amp; "q" & Größe')).toBe("a-b-amp-q-größe");
    expect(fileStem("受注システム 2")).toBe("受注システム-2");
    expect(fileStem("Заказы / склад")).toBe("заказы-склад");
    expect(fileStem("  ?!  ")).toBe("diagram");
    expect(fileStem(undefined)).toBe("diagram");
  });

  it("ends in mmd for a Mermaid source and in tam for a block diagram", () => {
    expect(extensionOf("classDiagram\n  class A")).toBe("mmd");
    expect(extensionOf("---\ntitle: T\n---\nstateDiagram-v2\n  [*] --> A")).toBe("mmd");
    expect(extensionOf(STARTER)).toBe("tam");
    expect(extensionOf("")).toBe("tam");
  });

  it("takes the stem of an opened file without its extension", () => {
    expect(stemOf("orders.v2.tam")).toBe("orders.v2");
    expect(stemOf("notes.md")).toBe("notes");
    expect(stemOf("a/b:c.tam")).toBe("a-b-c");
    expect(stemOf(".tam")).toBe("diagram");
  });
});

describe("the diagram in an opened file", () => {
  it("takes a source as it is, with the line ends of the editor and no byte order mark", () => {
    expect(diagramIn("win.tam", "\uFEFFtitle Windows\r\nagent a[A]\r\nagent b[B]\r\n")).toEqual({
      source: "title Windows\nagent a[A]\nagent b[B]\n",
      fenced: false,
    });
    expect(diagramIn("flow.txt", "flowchart TB\n  a --> b")).toEqual({
      source: "flowchart TB\n  a --> b",
      fenced: false,
    });
  });

  it("takes the first fence of a Markdown text that reads as a diagram", () => {
    const text = [
      "# Notes",
      "",
      "```js",
      "agent(1)",
      "```",
      "```mermaid",
      "pie title Pets",
      "```",
      "```mermaid",
      "classDiagram",
      "  class A",
      "```",
      "~~~tam",
      "agent a[A]",
      "~~~",
    ].join("\r\n");
    expect(diagramIn("notes.md", text)).toEqual({
      source: "classDiagram\n  class A\n",
      fenced: true,
    });
    expect(diagramIn("tam.md", "Text\n\n~~~tam\nagent a[A]\n~~~\n")).toEqual({
      source: "agent a[A]\n",
      fenced: true,
    });
  });

  it("refuses a file that holds no diagram, and says which", () => {
    expect(diagramIn("todo.txt", "buy milk\nand eggs\n")).toEqual({
      refusal: expect.stringContaining("todo.txt is not a diagram"),
    });
    expect(diagramIn("notes.md", "# Notes\n\n```js\nlet a\n```\n")).toHaveProperty("refusal");
    expect(diagramIn("empty.tam", " \r\n")).toEqual({ refusal: "empty.tam is empty." });
  });

  it("opens a diagram file with an error in it, to be mended in the source", () => {
    expect(diagramIn("broken.tam", "agent a[A]\nthis is wrong\n")).toEqual({
      source: "agent a[A]\nthis is wrong\n",
      fenced: false,
    });
  });
});

describe("an exported picture", () => {
  it("gets its background as a rectangle below every shape", async () => {
    const doc = new Doc(arialMeasure);
    await doc.open(STARTER);
    const colors = {
      background: "#ffffff",
      text: "#1b1c1f",
      secondary: "#3f4146",
      series: ["#2a78d6"],
      font: "Arial, sans-serif",
      dark: false,
    };
    const svg = doc.svg(colors)!,
      { x, y, width, height } = doc.picture!.scene.bounds,
      backed = withBackground(svg, "#ffffff"),
      rect = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff"/>`;
    expect(backed).toContain(`</style>${rect}`);
    expect(backed.replace(rect, "")).toBe(svg);
    // The first thing drawn: nothing of the picture lies under it.
    expect(backed.indexOf("<rect")).toBe(backed.indexOf(rect));
    expect(
      new DOMParser().parseFromString(backed, "image/svg+xml").querySelector("parsererror"),
    ).toBeNull();
  });

  it("leaves a text without a view box as it is", () => {
    expect(withBackground("<svg></svg>", "#fff")).toBe("<svg></svg>");
  });
});

describe("the diagrams on show lately", () => {
  it("keeps five, the newest first, one per title", () => {
    let list = readRecents(null);
    for (const title of ["a", "b", "c", "d", "e", "f"])
      list = withRecent(list, { title, source: `title ${title}` });
    expect(list.map((recent) => recent.title)).toEqual(["f", "e", "d", "c", "b"]);
    list = withRecent(list, { title: "d", source: "title d\nagent x[X]" });
    expect(list.map((recent) => recent.title)).toEqual(["d", "f", "e", "c", "b"]);
    expect(list[0].source).toBe("title d\nagent x[X]");
    expect(withRecent(list, { title: "empty", source: "  " })).toBe(list);
    expect(readRecents(JSON.stringify(list))).toEqual(list);
  });

  it("reads nothing from what is not a list of diagrams", () => {
    expect(readRecents("{")).toEqual([]);
    expect(readRecents('{"title":"a"}')).toEqual([]);
    expect(readRecents('[{"title":"a"},{"title":"b","source":"agent b[B]"},null]')).toEqual([
      { title: "b", source: "agent b[B]" },
    ]);
  });
});

describe("zooming the view", () => {
  it("zooms by at most a fifth for a notch of the wheel, and smoothly for a pinch", () => {
    expect(wheelZoom(-100)).toBeCloseTo(1.2);
    expect(wheelZoom(100)).toBeCloseTo(1 / 1.2);
    expect(wheelZoom(-1000)).toBeCloseTo(1.2);
    // A wheel that reports lines.
    expect(wheelZoom(-3, 1)).toBeCloseTo(1.2);
    expect(wheelZoom(-2)).toBeCloseTo(Math.exp(0.02));
    expect(wheelZoom(2) * wheelZoom(-2)).toBeCloseTo(1);
    expect(wheelZoom(0)).toBe(1);
  });

  it("steps to the next round level, from a zoom between two as from one of them", () => {
    expect(zoomLevel(0.78, 1)).toBe(1);
    expect(zoomLevel(0.78, -1)).toBe(0.75);
    expect(zoomLevel(1, 1)).toBe(1.25);
    expect(zoomLevel(1, -1)).toBe(0.75);
    expect(zoomLevel(1.004, 1)).toBe(1.25);
    expect(zoomLevel(8, 1)).toBe(8);
    expect(zoomLevel(0.1, -1)).toBe(0.1);
    // In and out again comes back to where it was.
    for (const level of ZOOM_LEVELS.slice(1, -1))
      expect(zoomLevel(zoomLevel(level, 1), -1)).toBe(level);
  });
});

describe("a menu row that is off", () => {
  const row = (name: string, off?: string | boolean): MenuItem => ({ name, off, run: () => {} });

  it("says its own reason", () => {
    expect(refusal(row("Cut", "Select an element"))).toBe("Select an element");
    expect(refusal(row("Cut"))).toBeUndefined();
  });

  it("is a submenu in which every row is off, with the reason they share", () => {
    const why = "Select two or more elements";
    expect(refusal({ name: "Align", items: [row("Left", why), "line", row("Right", why)] })).toBe(
      why,
    );
    expect(refusal({ name: "Align", items: [row("Left", why), row("Right")] })).toBeUndefined();
    expect(refusal({ name: "Put in", items: [] })).toBe(true);
    expect(
      refusal({ name: "Outer", items: [{ name: "Inner", items: [row("Left", true)] }, false] }),
    ).toBe(true);
  });
});

describe("the help and the chooser", () => {
  it("shows for every Mermaid type a syntax sheet whose rows, read as one source, are a diagram of the type", async () => {
    for (const info of TYPES) {
      if (info.type === "tam") continue;
      const source = syntaxRows(info.type).join("\n"),
        parsed = parseUml(source);
      expect(parsed.kind, info.name).toBe(info.type);
      const scene = await parsed.layout(arialMeasure);
      expect(scene.shapes.length, info.name).toBeGreaterThan(1);
      expect(source).not.toContain("…");
    }
  });

  it("draws a picture for the card of every type", async () => {
    const doc = new Doc(arialMeasure),
      colors = {
        background: "#ffffff",
        text: "#1b1c1f",
        secondary: "#3f4146",
        series: ["#2a78d6"],
        font: "Arial, sans-serif",
        dark: false,
      };
    for (const info of TYPES)
      expect(await doc.sketch(thumbOf(info), colors), info.name).toContain("<svg");
  });

  it("starts a block diagram from an empty one, the sample, a recent one or an example", () => {
    const tam = typeInfo("tam"),
      [example] = tam.examples,
      starts = startsOf(tam, [
        { title: "Mine", source: "agent mine[Mine]" },
        { title: "A class", source: "classDiagram\n  class A" },
        { title: "Seen before", source: example[1] },
      ]);
    expect(starts.slice(0, 3).map((start) => [start.name, start.tag])).toEqual([
      ["Empty diagram", undefined],
      ["Order system (sample)", undefined],
      ["Mine", "Recent"],
    ]);
    expect(starts[0].source).toBe("");
    expect(starts[1].source).toBe(STARTER);
    // A recent diagram that is an example shows once, as the example.
    expect(starts.filter((start) => start.source === example[1])).toHaveLength(1);
    expect(starts).toHaveLength(3 + tam.examples.length);
    const classes = startsOf(typeInfo("class"), [
      { title: "A class", source: "classDiagram\n  class A" },
    ]);
    expect(classes.slice(0, 2).map((start) => start.name)).toEqual([
      "Small starter diagram",
      "A class",
    ]);
  });
});
