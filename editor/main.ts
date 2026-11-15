/** The editor's page: the document, the canvas and the panels put together, with files, theme and autosave. */

import elkWorker from "elkjs/lib/elk-worker.min.js?url";
import type { DiagramColors } from "../src/draw.ts";
import { elkWorkerPool } from "../src/elk.ts";
import { textMeasure } from "../src/text.ts";
import { Doc } from "./document.ts";
import { Editor } from "./editor.ts";
import { STARTER } from "./starter.ts";
import { Panels } from "./ui.ts";
import { View } from "./view.ts";

const FONT = "system-ui, sans-serif";

const SERIES = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
];

const THEMES: Record<"light" | "dark", { diagram: DiagramColors; dots: string; accent: string }> = {
  light: {
    diagram: {
      background: "#ffffff",
      text: "#1b1c1f",
      secondary: "#3f4146",
      series: SERIES,
      font: FONT,
      dark: false,
    },
    dots: "#d3d6db",
    accent: "#2a78d6",
  },
  dark: {
    diagram: {
      background: "#1b1c1f",
      text: "#e9eaec",
      secondary: "#b9bcc2",
      series: SERIES,
      font: FONT,
      dark: true,
    },
    dots: "#3a3d43",
    accent: "#5b9ff0",
  },
};

const STORE = "tam-editor";

const stored = (key: string) => {
  try {
    return localStorage.getItem(`${STORE}:${key}`);
  } catch {
    return null;
  }
};

const store = (key: string, value: string) => {
  try {
    localStorage.setItem(`${STORE}:${key}`, value);
  } catch {
    // Without storage the diagram lives as long as the page.
  }
};

function download(name: string, blob: Blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function start() {
  const app = document.getElementById("app")!,
    stage = document.getElementById("stage")!,
    canvas = document.getElementById("canvas") as HTMLCanvasElement;
  let theme: "light" | "dark" =
    (stored("theme") as "light" | "dark" | null) ??
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const doc = new Doc(textMeasure(FONT), await elkWorkerPool(elkWorker).catch(() => undefined));
  const view = new View(canvas);
  const editor = new Editor(doc, view, THEMES[theme].diagram);
  const applyTheme = () => {
    document.documentElement.dataset.theme = theme;
    editor.colors = THEMES[theme].diagram;
    editor.accent = THEMES[theme].accent;
    view.colors = { page: THEMES[theme].diagram.background, dots: THEMES[theme].dots };
    store("theme", theme);
    editor.refresh();
  };
  const name = () =>
    (doc.picture?.diagram.title ?? "diagram")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "diagram";
  const open = async (source: string) => {
    editor.select([]);
    await doc.open(source);
    await editor.fitSoon();
  };
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".tam,.txt,.md,text/plain";
  picker.addEventListener("change", async () => {
    const [file] = picker.files ?? [];
    picker.value = "";
    if (file) await open(await file.text());
  });
  const panels = new Panels(app, stage, editor, {
    newDiagram: () => void open(""),
    openFile: () => picker.click(),
    saveFile: () => download(`${name()}.tam`, new Blob([doc.source], { type: "text/plain" })),
    exportSvg: () => {
      const svg = doc.svg(editor.colors);
      if (svg) download(`${name()}.svg`, new Blob([svg], { type: "image/svg+xml" }));
    },
    exportPng: async () => {
      const svg = doc.svg(editor.colors),
        bounds = doc.picture?.scene.bounds;
      if (!svg || !bounds) return;
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const sheet = document.createElement("canvas"),
        scale = 2;
      sheet.width = Math.ceil(bounds.width * scale);
      sheet.height = Math.ceil(bounds.height * scale);
      const context = sheet.getContext("2d")!;
      context.fillStyle = editor.colors.background;
      context.fillRect(0, 0, sheet.width, sheet.height);
      context.drawImage(image, 0, 0, sheet.width, sheet.height);
      sheet.toBlob((blob) => blob && download(`${name()}.png`, blob), "image/png");
    },
    copySource: () =>
      void navigator.clipboard.writeText(doc.source).then(
        () => panels.toast("Source copied."),
        () => panels.toast("The browser did not allow copying."),
      ),
    openExample: (source) => void open(source),
    remember: store,
    recall: stored,
    toggleTheme: () => {
      theme = theme === "light" ? "dark" : "light";
      applyTheme();
    },
  });
  editor.onState = () => panels.update();
  doc.onChange = () => {
    store("source", doc.source);
    editor.refresh();
  };
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      download(`${name()}.tam`, new Blob([doc.source], { type: "text/plain" }));
    }
  });
  applyTheme();
  await open(stored("source") ?? STARTER);
  // For tests and the curious: the editor on the console.
  Object.assign(window, { tamEditor: editor });
}

void start();
