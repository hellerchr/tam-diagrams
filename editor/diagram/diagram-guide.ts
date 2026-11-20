// What the guide sheet (GuidePanel.svelte) decides about a guide of src/tam/reference.ts, as the old editor's
// reference-dialog.ts did: what a filter keeps of it, how many rows that is, which rows are written into the source and
// which take the whole width, what the section links say, where the arrow keys go, and what is said when a row is of
// another type's syntax. Library-free, so it is tested on its own.
import type { Guide, GuideRow, GuideSection } from "../../src/reference-rows.ts";

/** What the filter keeps of a section: its prose and rules, its rows and its example (undefined: not kept). */
export type ShownSection = {
  section: GuideSection;
  prose?: string;
  rules: string[];
  rows: GuideRow[];
  example?: string;
};

/** The words of a filter, lowercased. */
export const wordsOf = (filter: string) => filter.toLowerCase().split(/\s+/).filter(Boolean);

/** The sections of `guide` with what has every one of `words` (a section whose title has them shows whole); the
 *  sections with nothing left go. */
export function narrowGuide(guide: Guide, words: string[]): ShownSection[] {
  const has = (text: string) => words.every((word) => text.toLowerCase().includes(word));
  return guide.sections.flatMap((section) => {
    const whole = has(section.title);
    const keep = (text: string | undefined) => (text && (whole || has(text)) ? text : undefined);
    const rows = (section.rows ?? []).filter(
      (item) => whole || has(`${item.write}\n${item.means}`),
    );
    const part = {
      section,
      prose: keep(section.prose),
      rules: section.rules?.filter((rule) => whole || has(rule)) ?? [],
      rows,
      example: keep(section.example),
    };
    return whole || part.prose || part.rules.length || rows.length || part.example ? [part] : [];
  });
}

/** How many rows the filter found, said beside it; nothing while there is no filter. */
export const rowCount = (words: string[], found: number) =>
  !words.length ? "" : found ? `${found} ${found === 1 ? "row" : "rows"}` : "Nothing";

/** Whether a row is written into the source: a statement the parser reads is; a sign on its own or a refused one is
 *  only copied. */
export const writes = (item: GuideRow) => !item.fragment && !item.refused;

/** Whether a row takes the whole width: code of several lines, or of one long line. */
export const wideRow = (item: GuideRow) => item.write.includes("\n") || item.write.length > 20;

/** Whether every row of a section is refused: the section of what the parser refuses. */
export const refusedSection = (section: GuideSection) =>
  !!section.rows?.length && section.rows.every((item) => item.refused);

/** The link to a section says it in a word: its id, capitalized. */
export const linkLabel = (id: string) => id[0]!.toUpperCase() + id.slice(1);

/** The name of a diagram inside a sentence. */
const lower = (name: string) => (name.startsWith("TAM") ? name : name.toLowerCase());
/** A name with its article: "a class diagram", "an activity diagram". */
const article = (name: string) => `${/^[aeio]/i.test(name) ? "an" : "a"} ${name}`;

/** What is said when a row of the guide named `guide` is to be written into a source of another type (`current`, the
 *  name of its guide; undefined: a source of no type yet). */
export const otherSyntax = (guide: string, current: string | undefined) =>
  `This is ${lower(guide)} syntax; the diagram on show is ${current ? article(lower(current)) : "of no type yet"}.`;

/** Where a key goes from the row at `at` of `count` rows on show (-1: not on a row; `filter`: on the filter): up and
 *  down, to the first and the last. Down from the filter goes to the first row, up from the first row to the filter
 *  ("filter"); undefined: nowhere. */
export function stopAfter(
  key: string,
  at: number,
  count: number,
  filter: boolean,
): number | "filter" | undefined {
  if (key === "ArrowDown") return (at >= 0 || filter) && at + 1 < count ? at + 1 : undefined;
  if (at < 0) return undefined;
  if (key === "ArrowUp") return at > 0 ? at - 1 : "filter";
  if (key === "Home") return 0;
  return key === "End" ? count - 1 : undefined;
}
