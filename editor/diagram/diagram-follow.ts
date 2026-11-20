// The source and the picture of a diagram following each other (Editor.svelte, DiagramView.svelte): the source lines
// of the selected parts, the part a line declares, and where a guide's statement goes in the source. Generic over
// anything with ids and lines: a TAM diagram's elements and connections, a UML structure's parts and joins. No
// CodeMirror here, so Node tests it.
import type { Part } from "./diagram-hit.ts";

/** A diagram's parts and joins with the source line that declares each, from 1. */
export type Lined = {
  nodes: readonly { id: string; line: number }[];
  edges: readonly { id: string; line: number }[];
};

/** The lines that declare the selected parts, in order, each once. */
export function linesOf(lined: Lined | undefined, selection: readonly Part[]): number[] {
  if (!lined || !selection.length) return [];
  const lines = new Set<number>();
  for (const part of selection) {
    const found = (part.type === "element" ? lined.nodes : lined.edges).find(
      (item) => item.id === part.id,
    );
    if (found) lines.add(found.line);
  }
  return [...lines].toSorted((a, b) => a - b);
}

/** The part a line declares: an element, else a connection; undefined for any other line. */
export function partAtLine(lined: Lined | undefined, line: number): Part | undefined {
  const node = lined?.nodes.find((item) => item.line === line);
  if (node) return { type: "element", id: node.id };
  const edge = lined?.edges.find((item) => item.line === line);
  return edge && { type: "wire", id: edge.id };
}

/**
 * Where statements are written into a source, as if typed: on the cursor's line when it is blank, else on a new line
 * below it, or at the end while the cursor is at the start. The change, and the range of the written text to select.
 */
export function insertion(
  doc: string,
  head: number,
  text: string,
): { from: number; to: number; insert: string; select: [number, number] } {
  const at = head > 0 ? head : doc.length;
  const start = doc.lastIndexOf("\n", at - 1) + 1;
  const newline = doc.indexOf("\n", at);
  const end = newline < 0 ? doc.length : newline;
  const blank = !doc.slice(start, end).trim();
  const from = blank ? start : end;
  const lead = blank ? "" : "\n";
  // A last line gets its newline; a blank line in the middle keeps the one it has.
  const tail = end === doc.length ? "\n" : "";
  return {
    from,
    to: blank ? end : from,
    insert: `${lead}${text}${tail}`,
    select: [from + lead.length, from + lead.length + text.length],
  };
}
