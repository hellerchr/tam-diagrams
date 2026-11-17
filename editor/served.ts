/**
 * The file of `tam-diagrams edit <file>`: the command serves the editor with a token in its address,
 * and the file at `/api/file`, read with GET and written with PUT. The file is written back in the
 * form it has: a source as the source, a Markdown text with its diagram's fence replaced and every
 * other line kept, a draw.io file as a draw.io file of the picture on show.
 */

import { escapeAttribute } from "../src/drawio-file.ts";
import { type ExportOptions, exportDrawio, importDrawio, isDrawio } from "../src/drawio.ts";
import { detectUml } from "../src/uml.ts";
import { diagramFence, diagramIn, withEditorLines } from "./files.ts";

/** The header that carries the token on every request to the file. */
export const TOKEN_HEADER = "x-tam-token";

/** The token the edit command put in the page's address; undefined for a page it did not open. */
export const tokenIn = (search: string) => new URLSearchParams(search).get("token") || undefined;

/** The forms a served file has, each written back as it is. */
export type Form = "source" | "markdown" | "drawio" | "drawio-svg";

/** The form of a file that has no text yet, by its name. */
function formOf(name: string): Form {
  if (/\.svg$/i.test(name)) return "drawio-svg";
  if (/\.(drawio|xml)$/i.test(name)) return "drawio";
  if (/\.(md|markdown)$/i.test(name)) return "markdown";
  return "source";
}

/** Whether a draw.io file is an SVG picture that carries the diagram, rather than an mxfile. */
const isSvg = (text: string) =>
  /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg\b/.test(text);

/** A source that ends with a line end, as the body of a fence does. */
const ended = (source: string) => (!source || source.endsWith("\n") ? source : `${source}\n`);

/** What the editor shows of the file: the diagram's source, what it says on opening, and remarks. */
export interface Opening {
  source: string;
  notice: string;
  /** What a draw.io page holds that the diagram has no place for. */
  warnings: string[];
}

/**
 * What a draw.io file is written from: the picture on show (`scene`) with its corners, and the
 * picture as an SVG for a `.drawio.svg`.
 */
export type Drawing = ExportOptions & { svg?: () => string | undefined };

/** A file the server did not write, because it has gone or refused: with what it was to be sent. */
export class NotWritten extends Error {
  readonly content: string;

  constructor(message: string, content: string) {
    super(message);
    this.content = content;
  }
}

/** Where the diagram's fence lies in a Markdown text: where its body starts, and how long it is. */
interface Fence {
  at: number;
  length: number;
}

/** The served file: read once at the start, written on every Save. */
export class ServedFile {
  /** The file's name, without its folder. */
  name = "";
  form: Form = "source";
  /** A Markdown text as it was read or written last, with the editor's line ends. */
  private text = "";
  private fence: Fence | undefined;
  /** Whether the file had Windows line ends and a byte order mark, which a source and Markdown keep. */
  private crlf = false;
  private bom = false;

  private readonly token: string;
  /** The server's address; the page's own by default. */
  private readonly base: string;
  private readonly request: typeof fetch;

  constructor(
    token: string,
    base = "",
    request: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.token = token;
    this.base = base;
    this.request = request;
  }

  private call(method: "GET" | "PUT", body?: string) {
    return this.request(`${this.base}/api/file`, {
      method,
      headers: { [TOKEN_HEADER]: this.token, "content-type": "text/plain; charset=utf-8" },
      body,
    });
  }

  /** Reads the file and gives its diagram; throws when the server or the file has none. */
  async open(): Promise<Opening> {
    const response = await this.call("GET");
    if (!response.ok) throw new Error(await response.text());
    const { name, text } = (await response.json()) as { name: string; text: string | null };
    this.name = name;
    this.crlf = !!text?.includes("\r\n");
    this.bom = !!text?.startsWith("\uFEFF");
    if (text === null || !text.trim()) return this.blank(name, text);
    if (isDrawio(text)) return this.openDrawio(name, text);
    return this.openText(name, text);
  }

  /** A file that does not exist yet, or holds nothing: its form is told by its name. */
  private blank(name: string, text: string | null): Opening {
    this.form = formOf(name);
    const notice =
      text === null ? `${name} is new: the first save writes it.` : `${name} is empty.`;
    return { source: "", notice, warnings: [] };
  }

  private async openDrawio(name: string, text: string): Promise<Opening> {
    this.form = isSvg(text) ? "drawio-svg" : "drawio";
    const { source, warnings } = await importDrawio(text);
    return { source, notice: `Opened ${name} from draw.io.`, warnings };
  }

  /** A source, or a Markdown text whose fence of the diagram is kept to be written back into. */
  private openText(name: string, text: string): Opening {
    const found = diagramIn(name, text);
    if ("refusal" in found) throw new Error(found.refusal);
    this.form = found.fenced ? "markdown" : "source";
    if (!found.fenced) return { source: found.source, notice: `Opened ${name}.`, warnings: [] };
    this.text = withEditorLines(text);
    const fence = diagramFence(this.text)!;
    this.fence = { at: fence.at, length: fence.source.length };
    return { source: found.source, notice: `Opened the first diagram in ${name}.`, warnings: [] };
  }

  /**
   * The Markdown text with the diagram in its fence, every other line as it was; a file that had
   * none gets one fence that holds the diagram.
   */
  private inFence(source: string): { text: string; fence: Fence } {
    const body = ended(source);
    if (!this.fence) {
      const head = `\`\`\`${detectUml(source) ? "mermaid" : "tam"}\n`;
      return { text: `${head}${body}\`\`\`\n`, fence: { at: head.length, length: body.length } };
    }
    const { at, length } = this.fence;
    return {
      text: this.text.slice(0, at) + body + this.text.slice(at + length),
      fence: { at, length: body.length },
    };
  }

  /** A source or Markdown text with the line ends and byte order mark the file had. */
  private withFileLines(text: string): string {
    return `${this.bom ? "\uFEFF" : ""}${this.crlf ? text.replace(/\n/g, "\r\n") : text}`;
  }

  /** A draw.io file of the picture, as an mxfile or as an SVG of the picture that carries one. */
  private async drawio(source: string, drawing: Drawing): Promise<string> {
    const xml = await exportDrawio(source, drawing);
    if (this.form === "drawio") return xml;
    const svg = drawing.svg?.();
    if (!svg) throw new Error("The diagram has no picture to write into the SVG file.");
    return svg.replace(/<svg\b/, `<svg content="${escapeAttribute(xml)}"`);
  }

  /**
   * Writes the diagram back to the file in the file's form. Throws the diagram's own error when it
   * cannot be drawn into a draw.io file, and NotWritten, with what was to be written, when the
   * server has gone or refused.
   */
  async save(source: string, drawing: Drawing = {}): Promise<void> {
    const markdown = this.form === "markdown" ? this.inFence(source) : undefined;
    const content =
      this.form === "drawio" || this.form === "drawio-svg"
        ? await this.drawio(source, drawing)
        : this.withFileLines(markdown?.text ?? source);
    let response: Response;
    try {
      response = await this.call("PUT", content);
    } catch {
      throw new NotWritten(
        `The edit command has stopped, so ${this.name} was not written.`,
        content,
      );
    }
    if (!response.ok)
      throw new NotWritten(`${this.name} was not written: ${await response.text()}`, content);
    if (markdown) ({ text: this.text, fence: this.fence } = markdown);
  }
}
