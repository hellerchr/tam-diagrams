/**
 * What the editing modules of the UML diagram types share: the source as lines, the indentation of
 * a line, texts written the way Mermaid reads them, and ids that no part has yet.
 */

/** A source as its lines, whatever line breaks it uses. */
export const linesOf = (source: string) => source.replace(/\r\n?/g, "\n").split("\n");

/** A source as lines without the empty one after a last line break, and whether it ends with one. */
export function endedLines(source: string) {
  const text = source.replace(/\r\n?/g, "\n"),
    ended = text.endsWith("\n");
  return { lines: (ended ? text.slice(0, -1) : text).split("\n"), ended };
}

/** A text on one line: its line breaks as spaces, trimmed. */
export const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ").trim();

/** The white space a line starts with. */
export const indentOf = (line: string) => line.match(/^\s*/)![0];

/** One more level of indentation, in the style of the source: a tab where it indents with tabs. */
export const stepOf = (lines: string[]) =>
  lines.some((line) => line.startsWith("\t")) ? "\t" : "  ";

/**
 * A text as the source holds it between quotes or brackets: line breaks as `<br>` (or a space, in a
 * name), and the characters the syntax reads for itself as Mermaid's entity codes.
 */
export const entityCoded = (text: string, breaks = "<br>") =>
  text
    .trim()
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/\s*\n\s*/g, breaks);

/** A text as a line of a block, such as a member or an attribute: one line, which a closing brace does not end. */
export const blockLineText = (text: string) => oneLine(text).replace(/[\s}]+$/, "");

/** Where a statement is added at the end: after the last line with text. */
export function rootEnd(lines: string[]): number {
  let at = lines.length;
  while (at > 0 && !lines[at - 1].trim()) at--;
  return at;
}

/** The first id that is free of a base with a number, counted from `from`: `State1`, `State2`. */
export function numberedId(taken: (id: string) => boolean, base: string, from = 1): string {
  for (let count = from; ; count++) {
    const id = `${base}${count}`;
    if (!taken(id)) return id;
  }
}

/** A piece's id: its name as one word when it has one that is free, else the name or the base with a number. */
export function freshId(taken: (id: string) => boolean, base: string, name: string): string {
  if (name && !taken(name)) return name;
  return numberedId(taken, name || base, name ? 2 : 1);
}

/** A count with its word: `1 class`, `3 classes`; nothing for none. */
export const counted = (count: number, one: string, many = `${one}s`) =>
  count > 0 ? [`${count} ${count > 1 ? many : one}`] : [];

/** Words in a row: `a`, `a and b`, `a, b and c`. */
export const listed = (words: string[]) =>
  words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : (words[0] ?? "");

/**
 * The lines strictly between two others, one step less indented where they stand deeper than the
 * first: what a block holds once the lines that open and close it go.
 */
export function dedent(lines: string[], open: number, close: number) {
  const outer = indentOf(lines[open]),
    inside = lines.slice(open + 1, close).find((line) => line.trim()),
    inner = inside ? indentOf(inside) : outer;
  if (inner.length <= outer.length || !inner.startsWith(outer)) return;
  for (let index = open + 1; index < close; index++)
    if (lines[index].startsWith(inner)) lines[index] = outer + lines[index].slice(inner.length);
}

/** Whether a part can go by a new id: another one, one the syntax reads, and one no part has. */
export const canTakeId = (
  has: (id: string) => boolean,
  id: string,
  name: string,
  readable: boolean,
) => has(id) && !!name && name !== id && readable && !has(name);

/**
 * Whether the parts of a diagram are another diagram's with one id changed: the new id is there,
 * the old one is gone, and there are as many of each kind as before.
 */
export const renamedOnly = (
  has: (id: string) => boolean,
  id: string,
  name: string,
  before: number[],
  after: number[],
) => has(name) && !has(id) && before.every((count, index) => count === after[index]);

/** The parts a part may be a copy of, by its id: those with that id without the number of 2 or more it ends with. */
export function originalsOf<T extends { id: string }>(id: string, parts: Iterable<T>): T[] {
  const numbered = id.match(/^(.*?)(\d+)$/);
  if (!numbered || Number(numbered[2]) < 2) return [];
  return [...parts].filter(
    (other) => other.id !== id && other.id.replace(/\d+$/, "") === numbered[1],
  );
}
