import type { TamError, UmlError } from "../src/index";

/** How an input is named in messages: its path as given, or `<stdin>` for `-`. */
export const inputName = (input: string) => (input === "-" ? "<stdin>" : input);

/** The message without the `Line <n>: ` prefix both error classes put in front of it. */
function bareMessage(error: TamError | UmlError): string {
  const prefix = `Line ${error.line}: `;
  return error.line && error.message.startsWith(prefix)
    ? error.message.slice(prefix.length)
    : error.message;
}

/**
 * Stderr lines for a diagram error: `<name>:<line>: <message>`, or `<name>: <message>` when the
 * error has no line.
 */
export function diagramMessage(name: string, error: TamError | UmlError): string[] {
  const where = error.line ? `${name}:${error.line}` : name;
  return [`${where}: ${bareMessage(error)}`];
}

/** A read or write failure as a stderr line; node's own message names the path. */
export function ioMessage(error: unknown): string {
  return `tam-diagrams: ${error instanceof Error ? error.message : String(error)}`;
}
