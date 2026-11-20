/**
 * The syntax guides of the diagram types, ported from tam-diagrams' editor/reference.ts: for each type what the
 * diagram shows, the rules of its notation, every statement its parser reads, one whole example, and what is
 * refused. Pure data (the rows in reference-*.ts), loaded only when a guide opens; reference.test.ts parses every
 * row and example, so a guide says nothing the parser does not do.
 */

import type { Guide, GuideRow, GuideSection } from "./reference-rows.ts";
import { STATE, SEQUENCE } from "./reference-state-sequence.ts";
import { CLASS, ER } from "./reference-structure.ts";
import { TAM } from "./reference-tam.ts";
import { FLOWCHART, USECASE } from "./reference-usecase-activity.ts";
import { detectUml } from "./uml.ts";

export type { Guide, GuideRow, GuideSection } from "./reference-rows.ts";

/** The guides, in the order they are listed. */
export const GUIDES: Guide[] = [TAM, CLASS, USECASE, FLOWCHART, STATE, SEQUENCE, ER];

/** Kinds of source whose guide is another type's: an activity diagram with lanes is an activity diagram. */
const GUIDED: Record<string, string> = { swimlane: "flowchart" };

/** The guide of a diagram type; undefined for a type that has none. */
export const guideOf = (type: string): Guide | undefined =>
  GUIDES.find((guide) => guide.type === (GUIDED[type] ?? type));

/** The type of guide a source of a file's language (tam or mermaid) wants; undefined while its header names none. */
export const guideTypeOf = (lang: string, source: string): string | undefined =>
  lang === "tam" ? "tam" : (detectUml(source) ?? undefined);

/**
 * The source a row is read in: the lines before it, the row, the lines after it, under the header of its type. This
 * is what the tests parse.
 */
export function rowSource(guide: Guide, section: GuideSection, item: GuideRow): string {
  // A source of its own stands without the lines its section puts before a statement.
  const before = item.context ?? (item.whole ? undefined : section.context);
  const lines = [before, item.write, item.after].filter((text): text is string => !!text);
  const header = item.header ?? section.header ?? guide.header;
  if (header && !item.whole) lines.unshift(header);
  return lines.join("\n");
}
