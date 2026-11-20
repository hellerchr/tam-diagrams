// What the diagram editor's right panel (DiagramSide.svelte) says under its source, as the old editor's ui.ts did:
// the strip of a problem of the source, and the strip of two elements that lie on each other, which TAM does not
// allow; and the code inside such a sentence. Library-free, so it is tested on its own.

/** A sentence in bits, every other one code: the text between backticks. */
export type ProseBit = { text: string; code: boolean };

/** The bits of `text`, whose code stands between backticks. */
export const proseBits = (text: string): ProseBit[] =>
  text
    .split("`")
    .map((bit, i) => ({ text: bit, code: i % 2 === 1 }))
    .filter((bit) => bit.text);

/** What the problem strip says: the line, then the problem. */
export const problemText = (problem: { line: number; message: string }) =>
  problem.line ? `Line ${problem.line}: ${problem.message}` : problem.message;

/** What the overlap strip says of the first two elements that lie on each other, by their names. */
export const overlapText = ([a, b]: [string, string]) =>
  `“${a}” and “${b}” overlap. TAM places all elements apart.`;

/** An element's name as the strip says it: on one line. */
export const oneLine = (name: string) => name.replace(/<br\s*\/?>/gi, " ");
