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

/** A file's text with the line ends of the editor, and without a byte order mark. */
export const withEditorLines = (content: string) =>
  content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

/**
 * The first `tam` or `mermaid` fence of a Markdown text that reads as a diagram: its body, which
 * ends with its last line end, and where in the text the body starts.
 */
export function diagramFence(text: string): { source: string; at: number } | undefined {
  const fences = text.matchAll(
    /^[ \t]*(`{3,}|~{3,})[ \t]*(?:tam|mermaid)\b[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm,
  );
  for (const fence of fences)
    if (isDiagram(fence[2]))
      return { source: fence[2], at: fence.index + fence[0].indexOf("\n") + 1 };
  return undefined;
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
  const text = withEditorLines(content);
  if (!text.trim()) return { refusal: `${name} is empty.` };
  if (isDiagram(text)) return { source: text, fenced: false };
  const fence = diagramFence(text);
  if (fence) return { source: fence.source, fenced: true };
  if (/\.(tam|mmd)$/i.test(name)) return { source: text, fenced: false };
  return {
    refusal: `${name} is not a diagram: it holds neither a TAM source nor a Mermaid diagram the editor draws.`,
  };
}

/**
 * A picture with room around it: its area grows by a margin on every side, and so does the size it
 * is shown at.
 */
export function withMargin(svg: string, margin: number): string {
  const head = svg.match(
    /viewBox="(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/,
  );
  if (!head || !(margin > 0)) return svg;
  const [all, x, y, width, height] = head,
    wide = Number(width) + 2 * margin,
    high = Number(height) + 2 * margin;
  return svg.replace(
    all,
    `viewBox="${Number(x) - margin} ${Number(y) - margin} ${wide} ${high}" width="${wide}" height="${high}"`,
  );
}

/**
 * A picture without the halos of a color: the outline in the color of the page that a label on a
 * line is drawn with, so the line stops short of it. With nothing behind the picture there is no
 * such color, and the labels stand on the lines as they are.
 */
export function withoutHalos(svg: string, color: string): string {
  return svg.replaceAll(
    new RegExp(
      ` stroke="${color.replace(/[^\w#]/g, "\\$&")}" stroke-width="[\\d.]+" stroke-linejoin="round" paint-order="stroke"`,
      "g",
    ),
    "",
  );
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

/** A short name for a text that two different texts hardly ever share: its FNV-1a hash in base 36. */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(36);
}

/** A diagram that was on show lately: its title, its source, and when it left. */
export interface Recent {
  title: string;
  source: string;
  /** Whether the diagram has a title of its own; one without goes by the name of its type. */
  named?: boolean;
  /** When it was on show last, in milliseconds since 1970. */
  at?: number;
}

/** The most diagrams the list of recent ones keeps. */
const RECENT = 5;

/**
 * What makes two recent diagrams the same one: the type and the title where the diagram has one,
 * and its text where it has none, so that several untitled diagrams of a type are all kept.
 */
const recentKey = (recent: Recent) =>
  `${detectUml(recent.source) ?? "tam"}:${recent.named === false ? shortHash(recent.source) : recent.title}`;

/** The list of recent diagrams with one more at its head: one entry per diagram, the newest first. */
export function withRecent(list: Recent[], entry: Recent): Recent[] {
  if (!entry.source.trim()) return list;
  const key = recentKey(entry);
  return [
    entry,
    ...list.filter((other) => recentKey(other) !== key && other.source !== entry.source),
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

/** How long ago a moment was, in a word or two: "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ageOf(at: number | undefined, now = Date.now()): string {
  if (!at) return "";
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / (60 * 24))} d ago`;
}

/** What belongs to a diagram besides its source: the file it came from, and whether it was saved. */
export interface Kept<File> {
  file: File | undefined;
  saved: boolean;
}

/**
 * The replacements of one diagram by another, each a step of the history. The file of a diagram
 * and whether it was saved belong to the diagram: a step across a replacement, back or forth,
 * leaves them with the diagram that goes and brings back those of the diagram that comes.
 */
export class Replacements<File> {
  /** The replacements in their order: those taken, then those undone, which Redo takes again. */
  private steps: { before: string; after: string; left: Kept<File>; right: Kept<File> }[] = [];
  /** How many of the replacements are taken and not undone. */
  private taken = 0;

  /** Notes that the diagram `before`, with what belongs to it, is being replaced by `after`. */
  add(before: string, after: string, kept: Kept<File>) {
    this.steps.length = this.taken;
    this.steps.push({ before, after, left: kept, right: { file: undefined, saved: true } });
    if (this.steps.length > 100) this.steps.shift();
    this.taken = this.steps.length;
  }

  /**
   * A step of the history from one source to another: an edit, Undo or Redo. When it crosses a
   * replacement, `now` is kept with the diagram that goes, and what belongs to the diagram that
   * comes is returned; undefined for a step within one diagram. Undo crosses the replacement
   * taken last, Redo the one undone last, so that two replacements between the same sources are
   * told apart. An edit ends what Redo could take again.
   */
  cross(
    from: string,
    to: string,
    now: Kept<File>,
    how: "edit" | "undo" | "redo" = "edit",
  ): Kept<File> | undefined {
    const step = this.steps[how === "redo" ? this.taken : this.taken - 1],
      crossed =
        !!step &&
        (how === "undo"
          ? step.after === from && step.before === to
          : step.before === from && step.after === to);
    if (!crossed) {
      if (how === "edit") this.steps.length = this.taken;
      return undefined;
    }
    if (how === "undo") {
      this.taken--;
      step.right = now;
      return step.left;
    }
    if (how === "redo") this.taken++;
    step.left = now;
    return step.right;
  }
}
