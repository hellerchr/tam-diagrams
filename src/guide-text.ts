/**
 * The reference guides as text: `guideMarkdown` writes the pages under docs/guides, `guideText`
 * the compact guide the command line prints for people and agents (`tam-diagrams guide`).
 */

import { guideOf, type GuideRow, type GuideSection } from "./reference.ts";

/** A text as Markdown: its `backticks` stay code, and a bar does not end a table cell. */
const cell = (text: string) => text.replace(/\|/g, "\\|");

/** Code in a table cell: each line a code span, with a fence long enough for the backticks in it. */
function code(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const ticks = "`".repeat(
          Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length)) + 1,
        ),
        pad = line.startsWith("`") || line.endsWith("`") ? " " : "",
        // Leading spaces would be trimmed from a code span: they are kept as non-breaking ones.
        indent = line.match(/^ */)![0].length;
      return `${"&nbsp;".repeat(indent)}${ticks}${pad}${cell(line.slice(indent))}${pad}${ticks}`;
    })
    .join("<br>");
}

/** The rows of a section as a Markdown table, headed as accepted statements or as refused ones. */
function table(rows: GuideRow[]): string[] {
  const refused = rows.every((item) => item.refused);
  return [
    "",
    refused ? "| Not accepted | Why, and what to write |" : "| You write | It means |",
    "| --- | --- |",
    ...rows.map((item) => `| ${code(item.write)} | ${cell(item.means)} |`),
  ];
}

/** A section of a guide as Markdown: its title, its paragraph, its rules, its table and its example. */
function sectionMarkdown(section: GuideSection, fence: string): string[] {
  return [
    "",
    `## ${section.title}`,
    ...(section.prose ? ["", section.prose] : []),
    ...(section.rules ? ["", ...section.rules.map((rule) => `- ${rule}`)] : []),
    ...(section.rows?.length ? table(section.rows) : []),
    ...(section.example ? ["", `\`\`\`${fence}`, section.example, "```"] : []),
  ];
}

/** The guide of a type as a Markdown page: the text of docs/guides/<type>.md. */
export function guideMarkdown(type: string): string {
  const guide = guideOf(type);
  if (!guide) throw new Error(`There is no guide for \`${type}\`.`);
  const fence = guide.type === "tam" ? "tam" : "mermaid";
  const out = [
    `# ${guide.name} guide`,
    "",
    "<!-- Written by guideMarkdown in src/guide-text.ts from src/reference.ts: change the guide there, not here. -->",
    "",
    `${guide.about}.`,
    ...guide.sections.flatMap((section) => sectionMarkdown(section, fence)),
  ];
  return `${out.join("\n")}\n`;
}

/** A row as compact text: what it means as a comment, above the statement as it is written. */
const rowText = (item: GuideRow) => [`%% ${item.means}`, item.write];

/** A section of a guide as compact text: its title, its paragraph, its rules, its rows and its example. */
function sectionText(section: GuideSection): string[] {
  return [
    "",
    `## ${section.title}`,
    ...(section.prose ? [section.prose] : []),
    ...(section.rules ?? []).map((rule) => `- ${rule}`),
    ...(section.rows ?? []).flatMap(rowText),
    ...(section.example ? [section.example] : []),
  ];
}

/**
 * The guide of a type as compact text, for the command line and for agents: everything the
 * Markdown page says, without its tables, each statement as it is written under a comment that
 * says what it means.
 */
export function guideText(type: string): string {
  const guide = guideOf(type);
  if (!guide) throw new Error(`There is no guide for \`${type}\`.`);
  const out = [`# ${guide.name} guide`, `${guide.about}.`, ...guide.sections.flatMap(sectionText)];
  return `${out.join("\n")}\n`;
}
