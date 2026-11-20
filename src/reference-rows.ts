/**
 * The rows of the syntax guides (reference.ts): what a guide is made of, and the helpers its data is written with.
 * Ported from tam-diagrams' editor/reference.ts.
 */

import type { UmlKind } from "./uml.ts";

/** A diagram type with a guide: TAM block diagrams and the Mermaid UML kinds. */
export type GuideType = "tam" | UmlKind;

/** A line of a guide's table: what is written in the source, and what it means. */
export interface GuideRow {
  /** The statement, or several lines of statements, as they stand in a source. */
  write: string;
  /** What it means; `backticks` mark code. */
  means: string;
  /** The lines that stand before the statement for it to be read; the section's, where the row has none. */
  context?: string;
  /** The lines that stand after the statement for it to be read: what closes a block it opens. */
  after?: string;
  /** The first line the row is read under, where it is not its section's or its guide's. */
  header?: string;
  /** The row is a source of its own: the header of the type is not put before it. */
  whole?: boolean;
  /** The row is no statement, such as an operator or a list of words on its own: it is not parsed. */
  fragment?: boolean;
  /** The parser refuses the statement; the meaning says why, and what to write instead. */
  refused?: boolean;
}

/** A part of a guide under its title: a paragraph, a list of rules, a table of rows, an example, or several of them. */
export interface GuideSection {
  /** The name of the section in links: unique in its guide. */
  id: string;
  title: string;
  /** A paragraph; `backticks` mark code. */
  prose?: string;
  /** The rules of the notation, one sentence or two each; `backticks` mark code. */
  rules?: string[];
  /**
   * The first line the rows of the section are read under, where it is not the guide's: the
   * lanes of an activity diagram are read under `swimlane-beta`.
   */
  header?: string;
  /** The lines that stand before each row of the section, where the row says nothing else. */
  context?: string;
  rows?: GuideRow[];
  /** A whole diagram of the type. */
  example?: string;
}

/** The guide of a diagram type. */
export interface Guide {
  type: GuideType;
  /** The name of the diagram, as the guide's title says it. */
  name: string;
  /** What the diagram shows, in one line, for the list of all guides. */
  about: string;
  /** The first line of a source of the type; empty for a block diagram, which has none. */
  header: string;
  sections: GuideSection[];
}

/** A row of a table. */
export const row = (write: string, means: string, more: Partial<GuideRow> = {}): GuideRow => ({
  write,
  means,
  ...more,
});

/** A row the parser refuses. */
export const no = (write: string, means: string, more: Partial<GuideRow> = {}): GuideRow =>
  row(write, means, { ...more, refused: true });

/** A row that is no statement of its own. */
export const part = (write: string, means: string): GuideRow =>
  row(write, means, { fragment: true });

/** The first lines every Mermaid type shares: a title in frontmatter, and comments. */
export const front = (header: string, body: string, level?: string): GuideRow[] => [
  row("---\ntitle: Order system\n---", "The title, in a frontmatter block before the first line.", {
    after: `${header}\n${body}`,
    whole: true,
  }),
  ...(level
    ? [
        row("%% level conceptual", level, {
          whole: true,
          after: `${header}\n${body}`,
        }),
      ]
    : []),
  row("%% a remark", "A comment: a line of its own that starts with `%%`."),
];

/** How the text of a label is written, in every Mermaid type. */
export const TEXT =
  "`<br>` breaks a line. `#quot;` writes a quote, `#35;` the character with that number. Angle brackets show as written, as in `autofix/<id>`, except HTML formatting tags such as `<b>`: they format the text, and `#lt;b>` shows one.";

/**
 * The section on the lines that place the parts of a Mermaid diagram by hand: `id` is a part of
 * the lines in `context` (the pair `at`), `what` says which parts take a place and under which id. `edge` is the
 * id of the first connection, whose label is placed: a letter of the type and a count.
 */
export const place = (
  [id, context]: [string, string],
  what: string,
  edge: string,
  more: GuideRow[] = [],
): GuideSection => ({
  id: "positions",
  title: "Positions",
  prose: `Without positions the diagram lays itself out. Moving a part in the editor writes a position for every part, as comment lines at the end of the source, so the source stays valid Mermaid. ${what}`,
  context,
  rows: [
    row(
      `%% @${id} 120,40`,
      "The part with this id stands with its top left corner at x 120, y 40, in pixels, y down. A part without such a line stays where the layout puts it; without any such line the layout is automatic again.",
    ),
    row(
      `%% @label:${edge} +20,-14`,
      `The label of the connection \`${edge}\`, the first in the source (\`${edge.replace(/\d+$/, "")}2\` the second, and so on), stands with its middle 20 right of and 14 above the middle of its line, which it keeps to when the line moves. Dragging a label in the editor writes it.`,
    ),
    ...more,
  ],
});
