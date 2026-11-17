import type { SourceError } from "../src/index.ts";
import type { DrawioError } from "../src/drawio.ts";

/** How an input is named in messages: its path as given, or `<stdin>` for `-`. */
export const inputName = (input: string) => (input === "-" ? "<stdin>" : input);

/** The message without the `Line <n>: ` prefix a source error puts in front of it. */
function bareMessage(error: SourceError | DrawioError): string {
  if (!("line" in error)) return error.message;
  const prefix = `Line ${error.line}: `;
  return error.line && error.message.startsWith(prefix)
    ? error.message.slice(prefix.length)
    : error.message;
}

/**
 * Stderr lines for a diagram error: `<name>:<line>: <message>`, or `<name>: <message>` when the
 * error has no line.
 */
export function diagramMessage(name: string, error: SourceError | DrawioError): string[] {
  const where = "line" in error && error.line ? `${name}:${error.line}` : name;
  return [`${where}: ${bareMessage(error)}`];
}

/** A read or write failure as a stderr line; node's own message names the path. */
export function ioMessage(error: unknown): string {
  return `tam-diagrams: ${error instanceof Error ? error.message : String(error)}`;
}

/** A fault of the program while drawing an input, with the stack when there is one. */
export function internalMessage(name: string, error: unknown): string {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return `tam-diagrams: internal error while drawing ${name}: ${detail}`;
}

/** What a draw.io file holds that its diagram has no place for, one stderr line each. */
export const warningLines = (name: string, warnings: string[]) =>
  warnings.map((warning) => `${name}: warning: ${warning}\n`).join("");
