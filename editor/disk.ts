/** The user's disk as the browser reaches it: file pickers, files written back, and downloads. */

import type { ServedFile } from "./served.ts";

/** A file of the user's disk as the browser hands it out: read, and written back to. */
export interface FileHandle {
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
export const pickers = window as {
  showOpenFilePicker?: (options: PickerOptions) => Promise<FileHandle[]>;
  showSaveFilePicker?: (options: PickerOptions) => Promise<FileHandle>;
};

/** The files the open picker offers: sources and Markdown texts, and draw.io files. */
export const OPENED: PickerOptions["types"] = [
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
];

/** The files the save picker offers for a source with an extension. */
export const savedAs = (extension: string): PickerOptions["types"] => [
  {
    description: extension === "mmd" ? "Mermaid diagram" : "TAM block diagram",
    accept: { "text/plain": [`.${extension}`] },
  },
];

/**
 * The file a diagram belongs to: one opened or saved in the browser, with what writes back to it
 * where the browser allows, or the one `tam-diagrams edit` serves the editor with.
 */
export interface DiagramFile {
  name: string;
  handle?: FileHandle;
  served?: ServedFile;
}

/** Whether a picker failed because the user closed it. */
export const gaveUp = (reason: unknown) =>
  reason instanceof DOMException && reason.name === "AbortError";

/** The message of what was thrown. */
export const messageOf = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);

export function download(name: string, blob: Blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Writes a text to a file of the user's disk. */
export async function writeTo(handle: FileHandle, text: string) {
  const writer = await handle.createWritable();
  await writer.write(text);
  await writer.close();
}

/**
 * The file input of a browser without file pickers: it hands the file the user chose to `chosen`,
 * by its name and text.
 */
export function fileInput(chosen: (name: string, text: string) => Promise<void>): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".tam,.mmd,.txt,.md,.drawio,.xml,.svg,text/plain";
  input.addEventListener("change", async () => {
    const [file] = input.files ?? [];
    input.value = "";
    if (file) await chosen(file.name, await file.text());
  });
  return input;
}
