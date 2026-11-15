/**
 * What enters and leaves the editor as files: the name a diagram is saved under, the diagram in a
 * file that is opened, the picture as it is exported, and the list of diagrams opened lately.
 */

import { parseTam } from "../src/tam.ts";
import { detectUml } from "../src/uml.ts";

/**
 * The fonts an exported picture names: the ones `system-ui` stands for on the usual systems, so a
 * viewer without that keyword still finds a font close to the one the labels were measured with.
 */
export const EXPORT_FONT =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif";

/**
 * A title as the stem of a file name: lower case, with a hyphen for every run of what is neither a
 * letter nor a digit. Letters of every script stay.
 */
export function fileStem(title: string | undefined): string {
  return (
    (title ?? "")
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/, "") || "diagram"
  );
}

/** The extension of a source: `mmd` for one in Mermaid's syntax, `tam` for a block diagram. */
export const extensionOf = (source: string) => (detectUml(source) ? "mmd" : "tam");

/** A file's name without its extension, and without what no file system takes in a name. */
export function stemOf(name: string): string {
  return (
    name
      .replace(/\.[^./\\]*$/, "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
      .trim() || "diagram"
  );
}

/** Whether a text reads as a diagram: it starts as a Mermaid diagram the editor draws, or it is a TAM source. */
function isDiagram(text: string): boolean {
  if (!text.trim()) return false;
  if (detectUml(text)) return true;
  try {
    parseTam(text);
    return true;
  } catch {
    return false;
  }
}

/** The diagram found in a file, or why there is none. */
export type Opened =
  | {
      source: string;
      /** Whether the source is a part of the file: a fence of a Markdown text. */
      fenced: boolean;
    }
  | { refusal: string };

/**
 * The diagram in a file that is opened: the whole text when it reads as a diagram, else the first
 * `tam` or `mermaid` fence of a Markdown text that does. Line ends are those of the editor, and a
 * byte order mark is dropped. A `.tam` or `.mmd` file is taken as it is, to be mended in the source.
 */
export function diagramIn(name: string, content: string): Opened {
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) return { refusal: `${name} is empty.` };
  if (isDiagram(text)) return { source: text, fenced: false };
  const fences = text.matchAll(
    /^[ \t]*(`{3,}|~{3,})[ \t]*(?:tam|mermaid)\b[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm,
  );
  for (const [, , body] of fences) if (isDiagram(body)) return { source: body, fenced: true };
  if (/\.(tam|mmd)$/i.test(name)) return { source: text, fenced: false };
  return {
    refusal: `${name} is not a diagram: it holds neither a TAM source nor a Mermaid diagram the editor draws.`,
  };
}

/** A picture with a color behind it: a rectangle over its whole area, below everything else. */
export function withBackground(svg: string, color: string): string {
  const box = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"/);
  if (!box) return svg;
  const [, x, y, width, height] = box,
    rect = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}"/>`;
  // After the style, which comes before the first shape; a picture without one gets it first.
  const at = svg.indexOf("</style>");
  if (at >= 0) return `${svg.slice(0, at + 8)}${rect}${svg.slice(at + 8)}`;
  return svg.replace(/(<svg[^>]*>)/, `$1${rect}`);
}

/** A diagram that was on show lately: its title and its source. */
export interface Recent {
  title: string;
  source: string;
}

/** The most diagrams the list of recent ones keeps. */
const RECENT = 5;

/** The list of recent diagrams with one more at its head: one entry per title, the newest first. */
export function withRecent(list: Recent[], entry: Recent): Recent[] {
  if (!entry.source.trim()) return list;
  return [
    entry,
    ...list.filter((other) => other.title !== entry.title && other.source !== entry.source),
  ].slice(0, RECENT);
}

/** The list of recent diagrams as it was stored; empty when nothing readable was. */
export function readRecents(stored: string | null): Recent[] {
  try {
    const list: unknown = JSON.parse(stored ?? "[]");
    return Array.isArray(list)
      ? list
          .filter(
            (item): item is Recent =>
              typeof item?.title === "string" && typeof item?.source === "string",
          )
          .slice(0, RECENT)
      : [];
  } catch {
    return [];
  }
}
