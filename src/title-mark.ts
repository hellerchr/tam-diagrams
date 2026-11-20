/**
 * The marks a source sets its whole diagram with, besides its header: `%% @title hidden` keeps the
 * title (the picture's description, the draw.io page's name) but draws no heading above the
 * picture; `%% @corners round` bends the connections round at their corners (square without it).
 * Comment lines, as the places of uml-places.ts are, so TAM and Mermaid sources read them alike and
 * stay valid Mermaid.
 */

import type { Scene } from "./scene.ts";
import { endedLines } from "./source-text.ts";

/** A mark's line, and whether a source has it. */
const mark = (name: string, value: string) => {
  const line = new RegExp(`^[ \\t]*%%[ \\t]*@${name}[ \\t]+${value}[ \\t]*$`);
  const any = new RegExp(line.source, "m");
  return {
    text: `%% @${name} ${value}`,
    line,
    in: (source: string) => any.test(source.replace(/\r/g, "")),
  };
};

const HIDDEN = mark("title", "hidden");
const ROUND = mark("corners", "round");

/** `source` with mark `m` (`on`) or without: it goes, or comes after the last line with text. */
function withMark(source: string, m: ReturnType<typeof mark>, on: boolean): string {
  if (on === m.in(source)) return source;
  const { lines, ended } = endedLines(source);
  const rest = lines.filter((line) => !m.line.test(line));
  if (on) rest.splice(rest.findLastIndex((line) => line.trim()) + 1, 0, m.text);
  return rest.join("\n") + (ended ? "\n" : "");
}

/** Whether `source` hides its title. */
export const titleHidden = (source: string) => HIDDEN.in(source);

/** `source` drawing its title (`shown`) or not. */
export const withTitleShown = (source: string, shown: boolean) => withMark(source, HIDDEN, !shown);

/** Whether `source` bends its connections round at their corners. */
export const roundCorners = (source: string) => ROUND.in(source);

/** `source` with round corners (`round`) or square ones. */
export const withRoundCorners = (source: string, round: boolean) => withMark(source, ROUND, round);

/** `scene` drawn with the corners `source` asks for (a laid-out scene is cached and shared, so it is not changed). */
export const withSourceCorners = (scene: Scene, source: string): Scene =>
  roundCorners(source) ? { ...scene, rounded: true } : scene;
