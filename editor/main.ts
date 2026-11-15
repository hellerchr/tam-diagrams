/** The editor's page: the document, the canvas and the panels put together, with files, theme and autosave. */

import elkWorker from "elkjs/lib/elk-worker.min.js?url";
import type { DiagramColors } from "../src/draw.ts";
import { elkWorkerPool } from "../src/elk.ts";
import { textMeasure } from "../src/text.ts";
import type { Box } from "../src/scene.ts";
import { type Backdrop, confirmDialog, exportDialog, type ExportOptions } from "./dialogs.ts";
import { Doc } from "./document.ts";
import { Editor } from "./editor.ts";
import {
  diagramIn,
  EXPORT_FONT,
  extensionOf,
  fileStem,
  readRecents,
  stemOf,
  withBackground,
  withRecent,
} from "./files.ts";
import type { ThemeChoice } from "./menus.ts";
import { STARTER } from "./starter.ts";
import { typeInfo, typeOf } from "./types.ts";
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

/** A file of the user's disk as the browser hands it out: read, and written back to. */
interface FileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(text: string): Promise<void>; close(): Promise<void> }>;
}

/** The kinds of file a picker offers. */
interface PickerOptions {
  suggestedName?: string;
  types: { description: string; accept: Record<string, string[]> }[];
}

/** The browser's own file pickers, where it has them: they give files that can be written back to. */
const pickers = window as {
  showOpenFilePicker?: (options: PickerOptions) => Promise<FileHandle[]>;
  showSaveFilePicker?: (options: PickerOptions) => Promise<FileHandle>;
};

/** Whether a picker failed because the user closed it. */
const gaveUp = (reason: unknown) => reason instanceof DOMException && reason.name === "AbortError";

/** How much of the area two boxes cover together they share: 1 for the same box, 0 for boxes apart. */
function shared(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
    both = Math.max(0, width) * Math.max(0, height),
    all = a.width * a.height + b.width * b.height - both;
  return all > 0 ? both / all : 1;
}

async function start() {
  const app = document.getElementById("app")!,
    stage = document.getElementById("stage")!,
    canvas = document.getElementById("canvas") as HTMLCanvasElement;
  // The page is the window: nothing scrolls it, whatever a script brings into view.
  const still = () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    if (document.body.scrollTop || document.body.scrollLeft) document.body.scrollTo(0, 0);
  };
  window.addEventListener("scroll", still);
  document.body.addEventListener("scroll", still);
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
  /** The file the diagram was opened from or saved to last, with what writes back to it where the browser allows. */
  let file: { name: string; handle?: FileHandle } | undefined;
  /** The name of the diagram's files without an extension: that of its file, else its title. */
  const stem = () => (file ? stemOf(file.name) : fileStem(doc.picture?.title));
  const kinds = (extension: string): PickerOptions["types"] => [
    {
      description: extension === "mmd" ? "Mermaid diagram" : "TAM block diagram",
      accept: { "text/plain": [`.${extension}`] },
    },
  ];
  /**
   * Saves the source: back to the file it came from, to a file the user picks when there is none
   * or another is asked for, or as a download in a browser without file pickers. False when
   * nothing was saved.
   */
  const save = async (another = false): Promise<boolean> => {
    panels.commit();
    const text = doc.source,
      extension = extensionOf(text),
      name = `${stem()}.${extension}`;
    if (!text.trim()) {
      panels.toast("The diagram is empty: there is nothing to save.");
      return false;
    }
    const write = async (handle: FileHandle) => {
      const writer = await handle.createWritable();
      await writer.write(text);
      await writer.close();
      file = { name: handle.name, handle };
      panels.toast(`Saved to ${handle.name}.`);
    };
    try {
      if (file?.handle && !another) await write(file.handle);
      else if (pickers.showSaveFilePicker)
        await write(
          await pickers.showSaveFilePicker({ suggestedName: name, types: kinds(extension) }),
        );
      else download(name, new Blob([text], { type: "text/plain" }));
    } catch (reason) {
      if (gaveUp(reason)) return false;
      // The browser did not let the file be written: a download always works.
      download(name, new Blob([text], { type: "text/plain" }));
    }
    keep(text);
    editor.refresh();
    return true;
  };
  /** The diagrams that were on show lately. */
  let recents = readRecents(stored("recent"));
  /**
   * The replacements made, as the sources before and after, and whether the one before was saved: a
   * step between the two shows a whole other diagram, which is saved as it was when it left.
   */
  const swaps: [before: string, after: string, saved: boolean][] = [];
  /**
   * Shows another diagram in place of the current one. The one before stays a step of the history,
   * so Undo brings it back; with unsaved changes the user is asked first, and may save. False when
   * the diagram on show stays.
   */
  const replace = async (source: string, sure = false): Promise<boolean> => {
    if (source === doc.source) return false;
    if (!sure && unsaved()) {
      const answer = await confirmDialog(
        "Replace the current diagram?",
        "It has changes that were not saved. Undo brings it back until the page is reloaded.",
        "Replace",
      );
      if (answer === "cancel" || (answer === "save" && !(await save()))) return false;
    }
    const { picture } = doc;
    if (picture?.scene.shapes.length && picture.source === doc.source && doc.source !== STARTER) {
      recents = withRecent(recents, {
        title: picture.title || typeInfo(picture.type).name,
        source: doc.source,
      });
      store("recent", JSON.stringify(recents));
    }
    editor.select([]);
    swaps.push([doc.source, source, !unsaved()]);
    if (swaps.length > 100) swaps.shift();
    file = undefined;
    keep(source);
    await doc.apply(source);
    // A source that does not read has no picture: the one before is not shown under it.
    if (doc.problem) {
      doc.picture = undefined;
      editor.refresh();
    }
    panels.toast("The diagram was replaced.", { name: "Undo", run: () => doc.undo() });
    return true;
  };
  /** Shows the diagram of a file, or says why the file has none; the diagram on show then stays. */
  const opened = async (name: string, content: string, handle?: FileHandle) => {
    const found = diagramIn(name, content);
    if ("refusal" in found) return panels.toast(found.refusal);
    if (found.source !== doc.source && !(await replace(found.source))) return;
    // A diagram that is a part of its file is saved to a file of its own.
    file = { name, handle: found.fenced ? undefined : handle };
    keep(doc.source);
    editor.refresh();
    if (found.fenced) panels.toast(`Opened the first diagram in ${name}.`);
  };
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".tam,.mmd,.txt,.md,text/plain";
  picker.addEventListener("change", async () => {
    const [chosen] = picker.files ?? [];
    picker.value = "";
    if (chosen) await opened(chosen.name, await chosen.text());
  });
  const openFile = async () => {
    if (!pickers.showOpenFilePicker) return picker.click();
    try {
      const [handle] = await pickers.showOpenFilePicker({
        types: [
          {
            description: "Diagrams",
            accept: { "text/plain": [".tam", ".mmd", ".md", ".txt"] },
          },
        ],
      });
      await opened(handle.name, await (await handle.getFile()).text(), handle);
    } catch (reason) {
      if (!gaveUp(reason)) picker.click();
    }
  };
  /**
   * The picture as it is exported: in the light colors on white or on nothing, or in the colors of
   * the editor's theme on its page color, with fonts named that every system has one of.
   */
  const picture = (backdrop: Backdrop) => {
    const colors = {
        ...(backdrop === "theme" ? THEMES[theme()] : THEMES.light).diagram,
        font: EXPORT_FONT,
      },
      svg = doc.svg(colors),
      bounds = doc.picture?.scene.bounds;
    if (!svg || !bounds) return undefined;
    return {
      svg: backdrop === "transparent" ? svg : withBackground(svg, colors.background),
      width: bounds.width,
      height: bounds.height,
    };
  };
  const exportAs = async ({ format, scale, backdrop }: ExportOptions) => {
    const drawn = picture(backdrop);
    if (!drawn) return;
    store("export-scale", String(scale));
    store("export-backdrop", backdrop);
    if (format === "svg")
      return download(`${stem()}.svg`, new Blob([drawn.svg], { type: "image/svg+xml" }));
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}`;
    await image.decode();
    const sheet = document.createElement("canvas");
    sheet.width = Math.ceil(drawn.width * scale);
    sheet.height = Math.ceil(drawn.height * scale);
    sheet.getContext("2d")!.drawImage(image, 0, 0, sheet.width, sheet.height);
    sheet.toBlob((blob) => blob && download(`${stem()}.png`, blob), "image/png");
  };
  const panels = new Panels(app, stage, editor, {
    openFile: () => void openFile(),
    saveFile: () => void save(),
    saveFileAs: () => void save(true),
    exportPicture: (format) => {
      if (!doc.picture?.scene.shapes.length)
        return panels.toast("The diagram is empty: there is nothing to export.");
      const scale = Number(stored("export-scale")),
        backdrop = stored("export-backdrop");
      exportDialog({
        options: {
          format,
          scale: scale === 1 || scale === 3 ? scale : 2,
          backdrop: backdrop === "transparent" || backdrop === "theme" ? backdrop : "white",
        },
        dark: theme() === "dark",
        name: (kind) => `${stem()}.${kind}`,
        picture,
        save: (options) => void exportAs(options),
      });
    },
    copySource: () =>
      void navigator.clipboard.writeText(doc.source).then(
        () => panels.toast("Source copied."),
        () => panels.toast("The browser did not allow copying."),
      ),
    replace: (source, sure) => void replace(source, sure),
    recents: () => recents.filter((recent) => recent.source !== doc.source),
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
  /** The source on show, and the bounds of its picture once it was laid out. */
  let last = "",
    settled: { source: string; bounds: Box } | undefined;
  doc.onChange = () => {
    store("source", doc.source);
    const { picture } = doc;
    if (doc.source !== last) {
      // A whole other diagram came on show, by a replacement, by Undo or Redo across one, or by
      // a first line that names another type: it shows whole, and the pointer selects again.
      const swap = swaps.findLast(
          ([before, after]) =>
            (before === last && after === doc.source) || (after === last && before === doc.source),
        ),
        other = !!swap || typeOf(last) !== typeOf(doc.source);
      last = doc.source;
      // Undo across a replacement brings back a diagram that was saved, or was not.
      if (swap && (swap[1] === doc.source || swap[2])) keep(doc.source);
      else if (swap) saved = "";
      if (other) {
        settled = undefined;
        editor.setTool("select");
        void editor.fitSoon();
      }
    }
    if (
      picture &&
      !doc.problem &&
      picture.source === doc.source &&
      settled?.source !== doc.source
    ) {
      const { bounds } = picture.scene,
        before = settled?.bounds;
      // So does a diagram that lies somewhere else altogether after a step.
      if (before?.width && bounds.width && shared(before, bounds) < 0.2) editor.fit();
      settled = { source: doc.source, bounds };
    }
    editor.refresh();
  };
  applyTheme();
  last = stored("source") ?? STARTER;
  await doc.open(last);
  if (saved === null) keep(doc.source);
  // For tests and the curious: the editor on the console.
  Object.assign(window, { tamEditor: editor });
  await editor.fitSoon();
}

void start();
