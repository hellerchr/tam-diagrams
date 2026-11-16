/** The editor's page: the document, the canvas and the panels put together, with files, theme and autosave. */

import elkWorker from "elkjs/lib/elk-worker.min.js?url";
import type { DiagramColors } from "../src/draw.ts";
import { elkWorkerPool } from "../src/elk.ts";
import { textMeasure } from "../src/text.ts";
import type { Box, Scene } from "../src/scene.ts";
import { exportDrawio, importDrawio, isDrawio } from "../src/drawio.ts";
import {
  type Backdrop,
  confirmDialog,
  exportDialog,
  type ExportOptions,
  noticeDialog,
} from "./dialogs.ts";
import { Doc } from "./document.ts";
import { Editor } from "./editor.ts";
import {
  diagramIn,
  EXPORT_FONT,
  extensionOf,
  fileStem,
  readRecents,
  Replacements,
  stemOf,
  withBackground,
  withMargin,
  withoutHalos,
  withRecent,
} from "./files.ts";
import type { ThemeChoice } from "./menus.ts";
import { STARTER } from "./starter.ts";
import { sameType, typeInfo, typeOf } from "./types.ts";
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

/** The box around some boxes. */
function around(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x)),
    y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

/** The box around some elements of a scene; undefined when it draws none of them. */
function boxOf(scene: Scene, ids: string[]): Box | undefined {
  const boxes = scene.shapes.filter((shape) => ids.includes(shape.id)).map((shape) => shape.box);
  return boxes.length ? around(boxes) : undefined;
}

/** The document, which says when a step of its history is taken, and which way. */
class Steps extends Doc {
  /** Called before a step back or forth is taken. */
  onStep: () => void = () => {};
  /** The step of the history that is being taken, while the source changes by it. */
  step: "undo" | "redo" | undefined;

  undo() {
    if (this.canUndo) this.onStep();
    this.step = "undo";
    super.undo();
    this.step = undefined;
  }

  redo() {
    if (this.canRedo) this.onStep();
    this.step = "redo";
    super.redo();
    this.step = undefined;
  }
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
  /** Whether connections bend round at their corners: a choice remembered across visits. */
  let rounded = stored("rounded") === "1";
  const doc = new Steps(textMeasure(FONT), await elkWorkerPool(elkWorker).catch(() => undefined));
  const view = new View(canvas);
  const editor = new Editor(doc, view, THEMES[theme()].diagram);
  const applyTheme = () => {
    const { diagram, dots, accent } = THEMES[theme()];
    document.documentElement.dataset.theme = theme();
    // The page color of the diagram, for the small pictures of it elsewhere on the page.
    document.documentElement.style.setProperty("--page", diagram.background);
    editor.colors = { ...diagram, rounded };
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
    const asDownload = (why: string) => {
      download(name, new Blob([text], { type: "text/plain" }));
      panels.toast(`${why}${name} was downloaded.`);
    };
    try {
      if (file?.handle && !another) await write(file.handle);
      else if (pickers.showSaveFilePicker)
        await write(
          await pickers.showSaveFilePicker({ suggestedName: name, types: kinds(extension) }),
        );
      else asDownload("");
    } catch (reason) {
      if (gaveUp(reason)) return false;
      // The browser did not let the file be written: a download always works.
      asDownload(
        `The browser did not let ${file?.handle && !another ? file.name : "the file"} be written: `,
      );
    }
    keep(text);
    editor.refresh();
    return true;
  };
  /** The diagrams that were on show lately. */
  let recents = readRecents(stored("recent"));
  /** The replacements made: a step across one shows a whole other diagram, with its file. */
  const swaps = new Replacements<{ name: string; handle?: FileHandle }>();
  /** Keeps the diagram on show in the list of recent ones, as it is when another takes its place. */
  const remember = () => {
    const { picture } = doc,
      { source } = doc,
      type = typeOf(source),
      shown = picture?.source === source && !doc.problem;
    // Not the sample, and not a diagram that draws nothing; one with an error is kept to be mended.
    if (!source.trim() || source === STARTER || (shown && !picture.scene.shapes.length)) return;
    const title = picture && sameType(picture.type, type) ? picture.title : undefined;
    recents = withRecent(recents, {
      title: title || typeInfo(type).name,
      source,
      named: !!title,
      at: Date.now(),
    });
    store("recent", JSON.stringify(recents));
  };
  /**
   * Shows another diagram in place of the current one. The one before stays a step of the history,
   * so Undo brings it back; with unsaved changes the user is asked first, and may save. `notice`
   * says what happened where "replaced" does not. False when the diagram on show stays.
   */
  const replace = async (source: string, sure = false, notice?: string): Promise<boolean> => {
    if (source === doc.source) return false;
    if (!sure && unsaved()) {
      const answer = await confirmDialog(
        "Replace the current diagram?",
        "It has changes that were not saved. Undo brings it back until the page is reloaded.",
        "Replace",
      );
      if (answer === "cancel" || (answer === "save" && !(await save()))) return false;
    }
    remember();
    editor.select([]);
    // The file and the saved state of the diagram that goes stay with it: see `doc.onChange`.
    swaps.add(doc.source, source, { file, saved: !unsaved() });
    await doc.apply(source);
    // A source that does not read has no picture: the one before is not shown under it.
    if (doc.problem) {
      doc.picture = undefined;
      editor.refresh();
    }
    panels.toast(notice ?? "The diagram was replaced.", { name: "Undo", run: () => doc.undo() });
    return true;
  };
  /**
   * Shows the diagram of a draw.io file as a source that places its parts as the file does. The
   * file stays as it is: saving writes a source file beside it. What the file holds that a diagram
   * has no place for is listed.
   */
  const openedDrawio = async (name: string, content: string) => {
    let imported;
    try {
      imported = await importDrawio(content);
    } catch (reason) {
      return panels.toast(`${name}: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
    const { source, warnings } = imported;
    const notice = `Opened ${name} from draw.io.`;
    if (source === doc.source) panels.toast(notice);
    else if (!(await replace(source, false, notice))) return;
    file = { name: `${stemOf(name.replace(/\.drawio(\.\w+)?$/i, ""))}.${extensionOf(source)}` };
    editor.refresh();
    if (warnings.length)
      noticeDialog(
        "Read from draw.io, with remarks",
        `${name} reads as a ${typeInfo(typeOf(source)).name.toLowerCase()}. Some of it needs a look:`,
        warnings,
      );
  };
  /** Shows the diagram of a file, or says why the file has none; the diagram on show then stays. */
  const opened = async (name: string, content: string, handle?: FileHandle) => {
    if (isDrawio(content)) return openedDrawio(name, content);
    const found = diagramIn(name, content);
    if ("refusal" in found) return panels.toast(found.refusal);
    const notice = found.fenced ? `Opened the first diagram in ${name}.` : `Opened ${name}.`;
    if (found.source === doc.source) panels.toast(notice);
    else if (!(await replace(found.source, false, notice))) return;
    // A diagram that is a part of its file is saved to a file of its own.
    file = { name, handle: found.fenced ? undefined : handle };
    keep(doc.source);
    editor.refresh();
  };
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".tam,.mmd,.txt,.md,.drawio,.xml,.svg,text/plain";
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
          {
            description: "draw.io diagrams",
            accept: {
              "application/vnd.jgraph.mxfile": [".drawio", ".xml"],
              "image/svg+xml": [".svg"],
            },
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
   * the editor's theme on its page color, with room around it and with fonts named that every
   * system has one of. On nothing, the labels on lines have no outline in a page color.
   */
  const picture = (backdrop: Backdrop, margin: number) => {
    const colors = {
        ...(backdrop === "theme" ? THEMES[theme()] : THEMES.light).diagram,
        font: EXPORT_FONT,
        rounded,
      },
      svg = doc.svg(colors),
      bounds = doc.picture?.scene.bounds;
    if (!svg || !bounds) return undefined;
    const roomy = withMargin(svg, margin);
    return {
      svg:
        backdrop === "transparent"
          ? withoutHalos(roomy, colors.background)
          : withBackground(roomy, colors.background),
      width: bounds.width + 2 * margin,
      height: bounds.height + 2 * margin,
    };
  };
  const exportAs = async ({ format, scale, backdrop, margin }: ExportOptions) => {
    const drawn = picture(backdrop, margin);
    if (!drawn) return;
    store("export-scale", String(scale));
    store("export-margin", String(margin));
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
  /** The diagram as a draw.io file, as it is drawn now, downloaded. */
  const exportToDrawio = async () => {
    const shown = doc.picture;
    if (!shown?.scene.shapes.length)
      return panels.toast("The diagram is empty: there is nothing to export.");
    try {
      const name = `${stem()}.drawio`;
      const xml = await exportDrawio(shown.source, { scene: shown.scene, rounded });
      download(name, new Blob([xml], { type: "application/vnd.jgraph.mxfile" }));
      panels.toast(`${name} was downloaded. It opens in draw.io, drawn with the TAM shapes.`);
    } catch (reason) {
      panels.toast(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const panels = new Panels(app, stage, editor, {
    openFile: () => void openFile(),
    saveFile: () => void save(),
    saveFileAs: () => void save(true),
    exportPicture: (format) => {
      if (!doc.picture?.scene.shapes.length)
        return panels.toast("The diagram is empty: there is nothing to export.");
      const scale = Number(stored("export-scale")),
        margin = stored("export-margin");
      exportDialog({
        // White is what a picture is put on: the background is asked for anew every time.
        options: {
          format,
          scale: scale === 1 || scale === 3 ? scale : 2,
          backdrop: "white",
          margin: margin === "0" || margin === "32" ? Number(margin) : 16,
        },
        dark: theme() === "dark",
        name: (kind) => `${stem()}.${kind}`,
        picture,
        save: (options) => void exportAs(options),
      });
    },
    exportDrawio: () => void exportToDrawio(),
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
    get fileName() {
      return file?.name;
    },
    get theme() {
      return choice;
    },
    setTheme: (next) => {
      choice = next;
      store("theme", next);
      applyTheme();
    },
    get rounded() {
      return rounded;
    },
    setRounded: (next) => {
      rounded = next;
      store("rounded", next ? "1" : "0");
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
  doc.onStep = () => panels.stepped();
  /** The source on show, and its picture once it was laid out. */
  let last = "",
    settled: { source: string; scene: Scene } | undefined;
  /**
   * Keeps the view on what an edit changed. A diagram that lies somewhere else altogether shows
   * whole again. Else the view stays, but for the least move that keeps in view a selected element
   * that was in view or is new; and a diagram that showed whole and no longer fits is fitted again
   * when no element moved.
   */
  const follow = (was: Scene, now: Scene) => {
    const { view } = editor;
    if (
      was.shapes.length &&
      now.shapes.length &&
      was.bounds.width &&
      now.bounds.width &&
      shared(was.bounds, now.bounds) < 0.2
    )
      return editor.fit();
    const ids = editor.selectedElements,
      box = boxOf(now, ids),
      old = boxOf(was, ids),
      moved =
        !!box &&
        (!old ||
          old.x !== box.x ||
          old.y !== box.y ||
          old.width !== box.width ||
          old.height !== box.height);
    if (box && moved) {
      if (!old || view.shows(old)) view.reveal(box);
    } else if (view.isFitted && now.shapes.length && !view.shows(now.bounds)) editor.fit();
  };
  doc.onChange = () => {
    store("source", doc.source);
    const { picture } = doc;
    if (doc.source !== last) {
      // A whole other diagram came on show, by a replacement, by Undo or Redo across one, or by
      // a first line that names another type: it shows whole, and the pointer selects again.
      const kept = swaps.cross(
          last,
          doc.source,
          { file, saved: saved === null || saved === last },
          doc.step ?? "edit",
        ),
        other = !!kept || !sameType(typeOf(last), typeOf(doc.source));
      last = doc.source;
      // The diagram that comes has its file again, and is saved or is not, as when it left.
      if (kept) {
        file = kept.file;
        if (kept.saved) keep(doc.source);
        else saved = "";
      }
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
      const before = settled?.scene,
        { scene } = picture;
      settled = { source: doc.source, scene };
      // The last source that reads: its picture shows under an error after a reload.
      store("valid", doc.source);
      // What the edit selects is selected once the edit is through.
      if (before)
        queueMicrotask(() => {
          if (doc.picture?.scene === scene) follow(before, scene);
        });
    }
    editor.refresh();
  };
  applyTheme();
  last = stored("source") ?? STARTER;
  await doc.open(last);
  const valid = stored("valid");
  if (doc.problem && valid?.trim() && valid !== last) {
    // The source was left with an error: the last one that read shows under it, a step back.
    const source = last;
    last = valid;
    await doc.open(valid);
    if (!doc.problem) await doc.apply(source);
  }
  if (saved === null) keep(doc.source);
  // For tests and the curious: the editor on the console.
  Object.assign(window, { tamEditor: editor });
  await editor.fitSoon();
}

void start();
