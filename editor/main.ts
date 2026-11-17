/** The editor's page: the document, the canvas and the panels put together, with files, theme and autosave. */

import elkWorker from "elkjs/lib/elk-worker.min.js?url";
import { elkWorkerPool } from "../src/elk.ts";
import { textMeasure } from "../src/text.ts";
import { Doc } from "./document.ts";
import { Editor } from "./editor.ts";
import { Exports } from "./exporting.ts";
import { Follower } from "./follow.ts";
import type { Shell } from "./menus.ts";
import { ServedFile, tokenIn } from "./served.ts";
import { type Notices, Session } from "./session.ts";
import { STARTER } from "./starter.ts";
import { store, stored } from "./storage.ts";
import { FONT, Look, THEMES } from "./theme.ts";
import { sameType, typeOf } from "./types.ts";
import { Panels } from "./ui.ts";
import { View } from "./view.ts";

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

/** Keeps the page where it is: the page is the window, whatever a script brings into view. */
function holdStill() {
  const still = () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    if (document.body.scrollTop || document.body.scrollLeft) document.body.scrollTo(0, 0);
  };
  window.addEventListener("scroll", still);
  document.body.addEventListener("scroll", still);
}

/** What the page offers the panels: the session's files, the exports, and the look. */
function shellOf(
  doc: Doc,
  session: Session,
  exports: Exports,
  look: Look,
  repaint: () => void,
  notices: Notices,
): Shell {
  return {
    openFile: () => void session.openFile(),
    saveFile: () => void session.save(),
    saveFileAs: () => void session.save(true),
    exportPicture: (format) => exports.picture(format),
    exportDrawio: () => void exports.drawio(),
    copySource: () =>
      void navigator.clipboard.writeText(doc.source).then(
        () => notices.toast("Source copied."),
        () => notices.toast("The browser did not allow copying."),
      ),
    replace: (source, sure) => void session.replace(source, sure),
    recents: () => session.recents.filter((recent) => recent.source !== doc.source),
    get unsaved() {
      return session.unsaved;
    },
    get fileName() {
      return session.file?.name;
    },
    get theme() {
      return look.choice;
    },
    setTheme: (next) => {
      look.choose(next);
      repaint();
    },
    get rounded() {
      return look.rounded;
    },
    setRounded: (next) => {
      look.round(next);
      repaint();
    },
    remember: store,
    recall: stored,
  };
}

/**
 * Watches the source on show. It is kept in storage on every change, and the view follows it: a
 * whole other diagram that comes on show, by a replacement, by Undo or Redo across one, or by a first
 * line that names another type, shows whole, and the pointer selects again. Returns how to open a
 * source as the one on show.
 */
function watchSource(doc: Steps, editor: Editor, session: Session, follower: Follower) {
  /** The source on show. */
  let last = "";
  doc.onChange = () => {
    store("source", doc.source);
    if (doc.source !== last) {
      const other =
        session.crossed(last, doc.step ?? "edit") || !sameType(typeOf(last), typeOf(doc.source));
      last = doc.source;
      if (other) {
        follower.forget();
        editor.setTool("select");
        void editor.fitSoon();
      }
    }
    // The last source that reads: its picture shows under an error after a reload.
    if (follower.settle(doc)) store("valid", doc.source);
    editor.refresh();
  };
  /** Opens a source as the one on show, which no step of the history led to. */
  return async (source: string) => {
    last = source;
    await doc.open(source);
  };
}

/**
 * Opens the source the page was left with. One left with an error shows the last source that read
 * under it, a step back.
 */
async function reopen(doc: Doc, open: (source: string) => Promise<void>) {
  const last = stored("source") ?? STARTER;
  await open(last);
  const valid = stored("valid");
  if (!doc.problem || !valid?.trim() || valid === last) return;
  await open(valid);
  if (!doc.problem) await doc.apply(last);
}

async function start() {
  const app = document.getElementById("app")!,
    stage = document.getElementById("stage")!,
    canvas = document.getElementById("canvas") as HTMLCanvasElement;
  holdStill();
  const look = new Look();
  /** The token of `tam-diagrams edit`, when it opened the page on a file. */
  const token = tokenIn(location.search);
  // A file the command opens is no first visit: its diagram shows, not the sample.
  if (token) store("welcomed", "yes");
  const doc = new Steps(textMeasure(FONT), await elkWorkerPool(elkWorker).catch(() => undefined));
  const view = new View(canvas);
  const editor = new Editor(doc, view, THEMES[look.theme].diagram);
  const repaint = () => look.paint(editor, view);
  look.watch(repaint);
  const notices: Notices = {
    toast: (message, action) => panels.toast(message, action),
    commit: () => panels.commit(),
  };
  const session = new Session(doc, editor, look, notices);
  const exports = new Exports(doc, look, notices.toast, () => session.stem());
  const panels = new Panels(
    app,
    stage,
    editor,
    shellOf(doc, session, exports, look, repaint, notices),
  );
  editor.onState = () => {
    // The tab says which diagram it holds, and whether it has unsaved changes.
    document.title = `${session.unsaved ? "● " : ""}${doc.picture?.title || "Untitled"} – TAM Editor`;
    panels.update();
  };
  doc.onStep = () => panels.stepped();
  const open = watchSource(doc, editor, session, new Follower(editor));
  repaint();
  await reopen(doc, open);
  if (session.saved === null) session.keep(doc.source);
  if (token) await session.openServed(new ServedFile(token));
  // For tests and the curious: the editor on the console.
  Object.assign(window, { tamEditor: editor });
  await editor.fitSoon();
}

void start();
