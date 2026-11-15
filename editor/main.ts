/** The editor's page: the document, the canvas and the panels put together, with files, theme and autosave. */

import elkWorker from "elkjs/lib/elk-worker.min.js?url";
import type { DiagramColors } from "../src/draw.ts";
import { elkWorkerPool } from "../src/elk.ts";
import { textMeasure } from "../src/text.ts";
import { confirmDialog } from "./dialogs.ts";
import { Doc } from "./document.ts";
import { Editor } from "./editor.ts";
import type { ThemeChoice } from "./menus.ts";
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
    accent: "#1f6fd6",
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
    accent: "#4c94f0",
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
  // The theme is light, dark, or whichever the system is in.
  const system = matchMedia("(prefers-color-scheme: dark)");
  let choice: ThemeChoice = (stored("theme") as ThemeChoice | null) ?? "system";
  const theme = () => (choice === "system" ? (system.matches ? "dark" : "light") : choice);
  const doc = new Doc(textMeasure(FONT), await elkWorkerPool(elkWorker).catch(() => undefined));
  const view = new View(canvas);
  const editor = new Editor(doc, view, THEMES[theme()].diagram);
  const applyTheme = () => {
    const { diagram, dots, accent } = THEMES[theme()];
    document.documentElement.dataset.theme = theme();
    // The page color of the diagram, for the small pictures of it elsewhere on the page.
    document.documentElement.style.setProperty("--page", diagram.background);
    editor.colors = diagram;
    editor.accent = accent;
    view.colors = { page: diagram.background, dots };
    editor.refresh();
  };
  system.addEventListener("change", applyTheme);
  /** The source as it was saved or opened last: the diagram is unsaved while it differs. */
  let saved = stored("saved");
  const unsaved = () => saved !== null && doc.source !== saved;
  const keep = (source: string) => {
    saved = source;
    store("saved", source);
  };
  const name = () =>
    (doc.picture?.title ?? "diagram")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "diagram";
  const save = () => {
    download(`${name()}.tam`, new Blob([doc.source], { type: "text/plain" }));
    keep(doc.source);
    editor.refresh();
  };
  /**
   * Shows another diagram in place of the current one. The one before stays a step of the history,
   * so Undo brings it back; with unsaved changes the user is asked first.
   */
  const replace = async (source: string, sure = false) => {
    if (source === doc.source) return;
    if (
      !sure &&
      unsaved() &&
      !(await confirmDialog(
        "Replace the current diagram?",
        "It has changes that were not saved. Undo brings it back for as long as this page is open.",
        "Replace",
      ))
    )
      return;
    editor.select([]);
    keep(source);
    await doc.apply(source);
    await editor.fitSoon();
    panels.toast("The diagram was replaced.", { name: "Undo", run: () => doc.undo() });
  };
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".tam,.mmd,.txt,.md,text/plain";
  picker.addEventListener("change", async () => {
    const [file] = picker.files ?? [];
    picker.value = "";
    if (file) await replace(await file.text());
  });
  const panels = new Panels(app, stage, editor, {
    openFile: () => picker.click(),
    saveFile: save,
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
    replace: (source, sure) => void replace(source, sure),
    get unsaved() {
      return unsaved();
    },
    get theme() {
      return choice;
    },
    setTheme: (next) => {
      choice = next;
      store("theme", next);
      applyTheme();
    },
    remember: store,
    recall: stored,
  });
  editor.onState = () => {
    // The tab says which diagram it holds, and whether it has unsaved changes.
    document.title = `${unsaved() ? "● " : ""}${doc.picture?.title || "Untitled"} – TAM Editor`;
    panels.update();
  };
  doc.onChange = () => {
    store("source", doc.source);
    editor.refresh();
  };
  window.addEventListener("keydown", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "s") save();
    else if (key === "o") picker.click();
    else if (key === "n" && event.altKey) panels.chooser();
    else return;
    event.preventDefault();
  });
  applyTheme();
  const first = stored("source") === null;
  await doc.open(stored("source") ?? STARTER);
  if (saved === null) keep(doc.source);
  // For tests and the curious: the editor on the console.
  Object.assign(window, { tamEditor: editor });
  await editor.fitSoon();
  // A first visit starts with the choice of what to draw.
  if (first) panels.chooser();
}

void start();
