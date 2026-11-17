/**
 * The diagram on show and its file: opening a file or a draw.io file, saving, replacing one diagram
 * by another as a step of the history, and the list of diagrams on show lately.
 */

import { importDrawio, isDrawio } from "../src/drawio.ts";
import { confirmDialog, noticeDialog } from "./dialogs.ts";
import {
  type DiagramFile,
  download,
  fileInput,
  type FileHandle,
  gaveUp,
  messageOf,
  OPENED,
  pickers,
  savedAs,
  writeTo,
} from "./disk.ts";
import type { Doc } from "./document.ts";
import type { Editor } from "./editor.ts";
import { pictureOf } from "./exporting.ts";
import {
  diagramIn,
  extensionOf,
  fileStem,
  readRecents,
  Replacements,
  stemOf,
  withRecent,
} from "./files.ts";
import { NotWritten, type ServedFile } from "./served.ts";
import { STARTER } from "./starter.ts";
import { store, stored } from "./storage.ts";
import type { Look } from "./theme.ts";
import { sameType, typeInfo, typeOf } from "./types.ts";
import type { ToastAction } from "./ui.ts";

/** What the session says to the user, and the typing it takes in before a save. */
export interface Notices {
  toast(message: string, action?: ToastAction): void;
  /** Takes what is still being typed into the document, so a save holds it. */
  commit(): void;
}

/** A text file to download. */
const textFile = (text: string) => new Blob([text], { type: "text/plain" });

/**
 * Whether the diagram on show belongs in the list of recent ones: not the sample, and not a
 * diagram that draws nothing. One with an error is kept to be mended.
 */
function worthKeeping(doc: Doc): boolean {
  const { picture, source } = doc;
  if (!source.trim() || source === STARTER) return false;
  if (picture?.source !== source || doc.problem) return true;
  return picture.scene.shapes.length > 0;
}

/** The title of the diagram on show; undefined when its picture is not of its type or has none. */
function titleOf(doc: Doc): string | undefined {
  const { picture } = doc;
  if (!picture || !sameType(picture.type, typeOf(doc.source))) return undefined;
  return picture.title || undefined;
}

/** Lists what a draw.io file holds that its diagram has no place for. */
function remarks(name: string, source: string, warnings: string[]) {
  if (warnings.length)
    noticeDialog(
      "Read from draw.io, with remarks",
      `${name} reads as a ${typeInfo(typeOf(source)).name.toLowerCase()}. Some of it needs a look:`,
      warnings,
    );
}

export class Session {
  /** The file the diagram was opened from or saved to last, with what writes back to it where the browser allows. */
  file: DiagramFile | undefined;
  /** The source as it was saved or opened last: the diagram is unsaved while it differs. */
  saved = stored("saved");
  /** The diagrams that were on show lately. */
  recents = readRecents(stored("recent"));
  /** The replacements made: a step across one shows a whole other diagram, with its file. */
  private readonly swaps = new Replacements<DiagramFile>();
  private readonly doc: Doc;
  private readonly editor: Editor;
  private readonly look: Look;
  private readonly notices: Notices;
  /** What opens a file in a browser without file pickers. */
  private readonly input = fileInput((name, text) => this.opened(name, text));

  constructor(doc: Doc, editor: Editor, look: Look, notices: Notices) {
    this.doc = doc;
    this.editor = editor;
    this.look = look;
    this.notices = notices;
  }

  /** Whether the diagram changed since it was saved or opened. */
  get unsaved() {
    return this.saved !== null && this.doc.source !== this.saved;
  }

  /** Takes a source as the one saved. */
  keep(source: string) {
    this.saved = source;
    store("saved", source);
  }

  /** The name of the diagram's files without an extension: that of its file, else its title. */
  stem() {
    return this.file ? stemOf(this.file.name) : fileStem(this.doc.picture?.title);
  }

  /**
   * Saves the source: back to the file it came from, to a file the user picks when there is none
   * or another is asked for, or as a download in a browser without file pickers. False when
   * nothing was saved.
   */
  async save(another = false): Promise<boolean> {
    this.notices.commit();
    const text = this.doc.source,
      served = another ? undefined : this.file?.served;
    if (!text.trim()) {
      this.notices.toast("The diagram is empty: there is nothing to save.");
      return false;
    }
    try {
      if (served) await this.writeServed(served, text);
      else await this.writeOwn(text, another);
    } catch (reason) {
      if (!this.rescued(reason, text, served, another)) return false;
    }
    this.keep(text);
    this.editor.refresh();
    return true;
  }

  /** Writes the file of the edit command, in its own form; a draw.io file from the picture on show. */
  private async writeServed(served: ServedFile, text: string) {
    const { doc, look } = this,
      shown = doc.picture?.source === text && !doc.problem ? doc.picture : undefined;
    await served.save(text, {
      scene: shown?.scene,
      rounded: look.rounded,
      svg: () => pictureOf(doc, look, "white", 16)?.svg,
    });
    this.notices.toast(`Saved to ${served.name}.`);
  }

  /** Writes the file the diagram came from, or one the user picks, or downloads the source. */
  private async writeOwn(text: string, another: boolean) {
    const extension = extensionOf(text),
      name = `${this.stem()}.${extension}`;
    if (this.file?.handle && !another) await this.write(this.file.handle, text);
    else if (pickers.showSaveFilePicker)
      await this.write(
        await pickers.showSaveFilePicker({ suggestedName: name, types: savedAs(extension) }),
        text,
      );
    else this.downloaded(text, "");
  }

  private async write(handle: FileHandle, text: string) {
    await writeTo(handle, text);
    this.file = { name: handle.name, handle };
    this.notices.toast(`Saved to ${handle.name}.`);
  }

  /** Downloads the source, and says so after why. */
  private downloaded(text: string, why: string) {
    const name = `${this.stem()}.${extensionOf(text)}`;
    download(name, textFile(text));
    this.notices.toast(`${why}${name} was downloaded.`);
  }

  /** What a save that failed comes to: true when the source went to a download instead. */
  private rescued(
    reason: unknown,
    text: string,
    served: ServedFile | undefined,
    another: boolean,
  ): boolean {
    if (gaveUp(reason)) return false;
    if (served) return this.servedRescued(reason, served);
    // The browser did not let the file be written: a download always works.
    const what = this.file?.handle && !another ? this.file.name : "the file";
    this.downloaded(text, `The browser did not let ${what} be written: `);
    return true;
  }

  /** A file of the edit command that was not written is downloaded as it would have been. */
  private servedRescued(reason: unknown, served: ServedFile): boolean {
    if (!(reason instanceof NotWritten)) {
      this.notices.toast(messageOf(reason));
      return false;
    }
    download(served.name, textFile(reason.content));
    this.notices.toast(`${reason.message} ${served.name} was downloaded instead.`);
    return true;
  }

  /** Keeps the diagram on show in the list of recent ones, as it is when another takes its place. */
  private remember() {
    const { doc } = this;
    if (!worthKeeping(doc)) return;
    const title = titleOf(doc);
    this.recents = withRecent(this.recents, {
      title: title ?? typeInfo(typeOf(doc.source)).name,
      source: doc.source,
      named: !!title,
      at: Date.now(),
    });
    store("recent", JSON.stringify(this.recents));
  }

  /** Whether the diagram on show may go: it is saved, the user was asked, or agrees, or saved it. */
  private async mayGo(sure: boolean): Promise<boolean> {
    if (sure || !this.unsaved) return true;
    const answer = await confirmDialog(
      "Replace the current diagram?",
      "It has changes that were not saved. Undo brings it back until the page is reloaded.",
      "Replace",
    );
    if (answer === "cancel") return false;
    return answer !== "save" || this.save();
  }

  /**
   * Shows another diagram in place of the current one. The one before stays a step of the history,
   * so Undo brings it back; with unsaved changes the user is asked first, and may save. `notice`
   * says what happened where "replaced" does not. False when the diagram on show stays.
   */
  async replace(source: string, sure = false, notice?: string): Promise<boolean> {
    const { doc, editor } = this;
    if (source === doc.source || !(await this.mayGo(sure))) return false;
    this.remember();
    editor.select([]);
    // The file and the saved state of the diagram that goes stay with it: see `crossed`.
    this.swaps.add(doc.source, source, { file: this.file, saved: !this.unsaved });
    await doc.apply(source);
    // A source that does not read has no picture: the one before is not shown under it.
    if (doc.problem) {
      doc.picture = undefined;
      editor.refresh();
    }
    this.notices.toast(notice ?? "The diagram was replaced.", {
      name: "Undo",
      run: () => doc.undo(),
    });
    return true;
  }

  /** Shows the diagram of a file that is opened, and says so; false when the diagram on show stays. */
  private async show(source: string, notice: string, sure = false): Promise<boolean> {
    if (source !== this.doc.source) return this.replace(source, sure, notice);
    this.notices.toast(notice);
    return true;
  }

  /**
   * A step of the history from the source `last` to the one on show. True when it crossed a
   * replacement: the diagram that comes has its file again, and is saved or is not, as when it left.
   */
  crossed(last: string, how: "edit" | "undo" | "redo"): boolean {
    const kept = this.swaps.cross(
      last,
      this.doc.source,
      { file: this.file, saved: this.saved === null || this.saved === last },
      how,
    );
    if (!kept) return false;
    this.file = kept.file;
    if (kept.saved) this.keep(this.doc.source);
    else this.saved = "";
    return true;
  }

  /**
   * Shows the diagram of a draw.io file as a source that places its parts as the file does. The
   * file stays as it is: saving writes a source file beside it. What the file holds that a diagram
   * has no place for is listed.
   */
  private async openedDrawio(name: string, content: string) {
    let imported;
    try {
      imported = await importDrawio(content);
    } catch (reason) {
      return this.notices.toast(`${name}: ${messageOf(reason)}`);
    }
    const { source, warnings } = imported;
    if (!(await this.show(source, `Opened ${name} from draw.io.`))) return;
    this.file = {
      name: `${stemOf(name.replace(/\.drawio(\.\w+)?$/i, ""))}.${extensionOf(source)}`,
    };
    this.editor.refresh();
    remarks(name, source, warnings);
  }

  /**
   * Shows the diagram of the file `tam-diagrams edit` serves the editor with, in place of the one
   * on show, which Undo brings back; Save then writes back to the file. A file that does not exist
   * yet starts an empty diagram.
   */
  async openServed(served: ServedFile) {
    let opening;
    try {
      opening = await served.open();
    } catch (reason) {
      return this.notices.toast(`The file of the edit command did not open: ${messageOf(reason)}`);
    }
    const { source, notice, warnings } = opening;
    if (!(await this.show(source, notice, true))) return;
    this.file = { name: served.name, served };
    this.keep(this.doc.source);
    this.editor.refresh();
    remarks(served.name, source, warnings);
  }

  /** Shows the diagram of a file, or says why the file has none; the diagram on show then stays. */
  private async opened(name: string, content: string, handle?: FileHandle) {
    if (isDrawio(content)) return this.openedDrawio(name, content);
    const found = diagramIn(name, content);
    if ("refusal" in found) return this.notices.toast(found.refusal);
    const notice = found.fenced ? `Opened the first diagram in ${name}.` : `Opened ${name}.`;
    if (!(await this.show(found.source, notice))) return;
    // A diagram that is a part of its file is saved to a file of its own.
    this.file = { name, handle: found.fenced ? undefined : handle };
    this.keep(this.doc.source);
    this.editor.refresh();
  }

  /** Asks for a file and shows its diagram. */
  async openFile() {
    if (!pickers.showOpenFilePicker) return this.input.click();
    try {
      const [handle] = await pickers.showOpenFilePicker({ types: OPENED });
      await this.opened(handle.name, await (await handle.getFile()).text(), handle);
    } catch (reason) {
      if (!gaveUp(reason)) this.input.click();
    }
  }
}
