/**
 * The settings of a whole Mermaid diagram, as the editor's Properties show them when nothing is
 * selected: the title, the way the layout runs, the TAM level and, in a sequence diagram, whether
 * the messages are numbered. Each is read from the source and changed in place, every other line
 * as it was; a setting the source does not say yet is added in the usual spot, right below the
 * diagram's first line. A change the diagram type does not allow is refused with the message its
 * parser gives.
 */

import { endedLines, indentOf } from "./source-text.ts";
import type { Direction } from "./elk.ts";
import { overlaps, type Point } from "./scene.ts";
import { type Level, scan, UmlError, type UmlKind, detectUml } from "./uml.ts";
import { parseFlowchart } from "./uml-activity.ts";
import { parseClassDiagram } from "./uml-class.ts";
import { parseErDiagram } from "./uml-er.ts";
import { parseSequenceDiagram } from "./uml-sequence.ts";
import { parseStateDiagram } from "./uml-state.ts";
import { parseUseCaseDiagram } from "./uml-usecase.ts";

/** The settings a diagram type has besides its title, which every type has. */
interface UmlSettings {
  /** The way the layout runs when the source does not say; none for a type whose layout has one way. */
  direction?: Direction;
  /** Whether the type reads the `%% level` comment. */
  level: boolean;
  /** Whether the messages can be numbered: `autonumber`. */
  numbering: boolean;
}

const SETTINGS: Record<UmlKind, UmlSettings> = {
  class: { direction: "TB", level: true, numbering: false },
  state: { direction: "TB", level: true, numbering: false },
  er: { direction: "TB", level: false, numbering: false },
  usecase: { direction: "LR", level: true, numbering: false },
  flowchart: { direction: "TB", level: true, numbering: false },
  swimlane: { direction: "TB", level: true, numbering: false },
  // Lifelines always run down.
  sequence: { level: true, numbering: true },
};

/** The settings of a diagram type. */
export const umlSettings = (kind: UmlKind): UmlSettings => SETTINGS[kind];

/** What a source says of its whole diagram. */
export interface UmlHeader {
  title?: string;
  direction?: Direction;
  level?: Level;
  /** Whether the messages of a sequence diagram are numbered. */
  numbered?: boolean;
}

/** A change of the settings of a diagram: an empty title or level removes it. */
export interface UmlHeaderChange {
  title?: string;
  direction?: Direction;
  level?: Level | "";
  numbered?: boolean;
}

const DIRECTION = /^direction\s+(TB|TD|BT|LR|RL)$/i;
const LEVEL = /^%%\s*level\s*:?\s*(conceptual|design)\s*$/i;
const AUTONUMBER = /^autonumber(?:\s+(off|\d+)(?:\s+(\d+))?)?$/;
/** The title as a statement, which sequence and entity relationship diagrams read. */
const TITLE: Partial<Record<UmlKind, RegExp>> = {
  sequence: /^title(\s*:?\s+)(.+)$/,
  er: /^title(\s+)(.+)$/,
};
/** The first line of an activity diagram, and the word after it that says the way it runs. */
const ACTIVITY_HEADER = /^(\s*(?:flowchart(?:-elk)?|graph|swimlane-beta))(?:([ \t]+)([^\s;]+))?/;

/** A diagram parsed by the parser of its type: what it says of itself. */
function parsed(source: string): { kind: UmlKind; header: UmlHeader } {
  const kind = detectUml(source);
  if (!kind) throw new UmlError(0, "Unknown diagram type.");
  return { kind, header: HEADERS[kind](source) };
}

/** What the title, direction and level of a parsed diagram are. */
const said = ({ title, direction, level }: UmlHeader): UmlHeader => ({ title, direction, level });

/** How each diagram type reads what a source says of its whole diagram. */
const HEADERS: Record<UmlKind, (source: string) => UmlHeader> = {
  class: (source) => said(parseClassDiagram(source)),
  state: (source) => said(parseStateDiagram(source)),
  usecase: (source) => said(parseUseCaseDiagram(source)),
  er: (source) => {
    const { title, direction } = parseErDiagram(source);
    return { title, direction };
  },
  flowchart: (source) => said(parseFlowchart(source)),
  swimlane: (source) => said(parseFlowchart(source)),
  sequence: (source) => {
    const { title, level } = parseSequenceDiagram(source);
    const numbered = scan(source).lines.some(
      ({ text }) => AUTONUMBER.test(text) && !/\soff$/.test(text),
    );
    return { title, level, numbered };
  },
};

/** What a source says of its whole diagram, with the defaults of its type; throws as its parser does. */
export function umlHeader(source: string): UmlHeader {
  return parsed(source).header;
}

/** A title as YAML reads it: plain where that is safe, else in quotes. */
function yamlTitle(name: string): string {
  if (/^[\p{L}\p{N}][^:#"']*$/u.test(name)) return name;
  return !/["\\]/.test(name) ? `"${name}"` : `'${name.replace(/'/g, "''")}'`;
}

/** The frontmatter block at the start of a source: the indexes of its two `---` lines. */
function frontmatter(lines: string[]): { open: number; close: number } | undefined {
  const open = lines.findIndex((text) => text.trim());
  if (open < 0 || lines[open].trim() !== "---") return undefined;
  const close = lines.findIndex((text, index) => index > open && text.trim() === "---");
  return close > open ? { open, close } : undefined;
}

/**
 * A source with another title, written in a frontmatter block: changed where the block says it,
 * else added as the block's first line, else in a block of its own before the diagram. An empty
 * title removes it, and the block with it when nothing else is in it. Reads no more than the
 * frontmatter, so a source with an error takes a title too.
 */
export function withTitle(source: string, title: string): string {
  const name = title.trim().replace(/\s+/g, " "),
    { lines, ended } = endedLines(source),
    front = frontmatter(lines),
    line = name && `title: ${yamlTitle(name)}`;
  if (front) retitleFront(lines, front, line);
  else if (line) lines.unshift("---", line, "---");
  return lines.join("\n") + (ended ? "\n" : "");
}

/**
 * Writes a title line into a frontmatter block, in place of the one there or as its first line;
 * none removes it, and the block with it when nothing else is in it.
 */
function retitleFront(lines: string[], front: { open: number; close: number }, line: string) {
  const at = lines.findIndex(
    (text, index) => index > front.open && index < front.close && /^title:/.test(text),
  );
  if (at >= 0) lines.splice(at, 1, ...(line ? [line] : []));
  else if (line) lines.splice(front.open + 1, 0, line);
  const after = frontmatter(lines)!;
  // A block with nothing in it goes.
  if (after.close === after.open + 1) lines.splice(after.open, 2);
}

/** The statement lines of a source outside every block (`{ … }`), as indexes into its lines. */
function topLevel(source: string): { index: number; text: string }[] {
  const statements = scan(source).lines;
  let depth = 0;
  const top: { index: number; text: string }[] = [];
  for (const { text, line } of statements.slice(1)) {
    if (text.startsWith("}")) depth = Math.max(0, depth - 1);
    if (!depth) top.push({ index: line - 1, text });
    if (text.endsWith("{")) depth++;
  }
  return top;
}

/** The settings that stand below the diagram's first line, in the order they stand there. */
const ORDER = ["title", "direction", "level", "autonumber"] as const;

/** A source's lines, read for an edit of its settings. */
function linesAround(source: string, kind: UmlKind): SettingLines {
  const { lines, ended } = endedLines(source),
    top = topLevel(source);
  return {
    lines,
    ended,
    header: scan(source).lines[0].line - 1,
    top,
    indent: indentOf(lines[top[0]?.index ?? -1] ?? "") || "  ",
    kind,
  };
}

/** A source's lines, with what an edit of its settings needs to know of them. */
interface SettingLines {
  lines: string[];
  /** Whether the source ends with a line break. */
  ended: boolean;
  /** The index of the diagram's first line. */
  header: number;
  /** The statements outside every block. */
  top: { index: number; text: string }[];
  /** The indentation of a setting's line. */
  indent: string;
  kind: UmlKind;
}

/** Where a line stands in `ORDER`, -1 for a line that is no setting. */
const rankOf = (kind: UmlKind, text: string) =>
  ORDER.findIndex((_, index) =>
    [TITLE[kind] ?? /^$/, DIRECTION, LEVEL, AUTONUMBER][index].test(text.trim()),
  );

/** Adds a setting's line below the first line, after the settings that come before it. */
function addSetting(at: SettingLines, setting: (typeof ORDER)[number], text: string) {
  const { lines, kind } = at,
    before = (line: string) =>
      rankOf(kind, line) >= 0 && rankOf(kind, line) < ORDER.indexOf(setting);
  let index = at.header + 1;
  while (index < lines.length && before(lines[index])) index++;
  lines.splice(index, 0, `${at.indent}${text}`);
}

/** Replaces the lines at some indexes, each with its indent, or removes them; false when there are none. */
function replaceLines({ lines }: SettingLines, found: number[], text: string | undefined) {
  for (const index of found.toReversed())
    lines.splice(index, 1, ...(text ? [`${indentOf(lines[index])}${text}`] : []));
  return found.length > 0;
}

/** The source the lines make. */
const sourceOf = ({ lines, ended }: SettingLines) => lines.join("\n") + (ended ? "\n" : "");

/** The names of the diagram types, as a sentence says them of all diagrams of the type. */
const PLURALS: Record<UmlKind, string> = {
  class: "Class diagrams",
  state: "State machine diagrams",
  er: "Entity relationship diagrams",
  usecase: "Use case diagrams",
  flowchart: "Activity diagrams",
  swimlane: "Activity diagrams",
  sequence: "Sequence diagrams",
};

/**
 * Sets the title, the way the layout runs, the level and the numbering of the messages of a
 * Mermaid diagram: each is changed on the lines that say it, every other line as it was. One that
 * is not said yet is added below the diagram's first line, after the settings that come before it
 * there; a direction that is the type's default when unsaid is not added. Throws a UmlError when
 * the type has no such setting, or when its parser refuses the source this makes.
 */
export function setUmlHeader(source: string, change: UmlHeaderChange): string {
  const { kind } = parsed(source),
    settings = SETTINGS[kind];
  refuseUnknown(kind, change);
  let next = change.title === undefined ? source : retitle(source, kind, change.title);
  if (change.direction !== undefined)
    next = redirect(next, kind, change.direction, settings.direction!);
  if (change.level !== undefined) next = relevel(next, kind, change.level);
  if (change.numbered !== undefined) next = renumber(next, kind, change.numbered);
  parsed(next);
  return next;
}

/** Throws a UmlError for a change of a setting the diagram type does not have. */
function refuseUnknown(kind: UmlKind, change: UmlHeaderChange) {
  const settings = SETTINGS[kind],
    plural = PLURALS[kind];
  if (change.direction !== undefined && !settings.direction)
    throw new UmlError(0, `${plural} have no direction: their lifelines always run down.`);
  if (change.level !== undefined && !settings.level)
    throw new UmlError(0, `${plural} have no TAM level.`);
  if (change.numbered !== undefined && !settings.numbering)
    throw new UmlError(0, `${plural} have no numbered messages.`);
}

/** A source at another level, or at none with an empty one. */
function relevel(source: string, kind: UmlKind, level: Level | ""): string {
  const at = linesAround(source, kind),
    // The comment may stand before the first line too.
    found = at.lines.flatMap((text, index) => (LEVEL.test(text.trim()) ? [index] : [])),
    text = level && `%% level ${level}`;
  if (!replaceLines(at, found, text || undefined) && text) addSetting(at, "level", text);
  return sourceOf(at);
}

/** A source whose messages are numbered or not. */
function renumber(source: string, kind: UmlKind, numbered: boolean): string {
  const at = linesAround(source, kind),
    found = at.top.filter(({ text }) => AUTONUMBER.test(text)).map(({ index }) => index);
  if (!numbered) replaceLines(at, found, undefined);
  else if (!found.length) addSetting(at, "autonumber", "autonumber");
  return sourceOf(at);
}

/**
 * A source whose layout runs another way: an activity diagram says it after its first word
 * (`flowchart LR`), the other types on a `direction` line outside every block.
 */
function redirect(source: string, kind: UmlKind, direction: Direction, usual: Direction): string {
  const at = linesAround(source, kind);
  if (kind === "flowchart" || kind === "swimlane") {
    const line = at.lines[at.header],
      [whole, word, gap, said] = line.match(ACTIVITY_HEADER)!;
    if (said || direction !== usual)
      at.lines[at.header] = `${word}${gap ?? " "}${direction}${line.slice(whole.length)}`;
  } else {
    const found = at.top.filter(({ text }) => DIRECTION.test(text)).map(({ index }) => index),
      text = `direction ${direction}`;
    if (!replaceLines(at, found, text) && direction !== usual) addSetting(at, "direction", text);
  }
  return sourceOf(at);
}

/** Whether a source's frontmatter says a title. */
function frontTitle(source: string): boolean {
  const { lines } = endedLines(source),
    front = frontmatter(lines);
  return !!front && lines.slice(front.open + 1, front.close).some((text) => /^title:/.test(text));
}

/**
 * A source with another title: a title statement, where the type reads one, is changed in place
 * and a title in the frontmatter with it; without a statement the frontmatter says it.
 */
function retitle(source: string, kind: UmlKind, title: string): string {
  const statement = TITLE[kind],
    name = title.trim().replace(/\s+/g, " ");
  const at = linesAround(source, kind),
    found = statement ? at.top.filter(({ text }) => statement.test(text)) : [];
  if (!found.length) return withTitle(source, name);
  for (const { index, text } of found.toReversed()) {
    const [, gap] = text.match(statement!)!;
    replaceLines(at, [index], name ? `title${gap}${name}` : undefined);
  }
  const kept = sourceOf(at);
  return frontTitle(kept) ? withTitle(kept, name) : kept;
}

/** The room between two boxes that a turn keeps, where they had as much. */
const GAP = 20;

/** The axes of a direction: the way the flow runs and the way across it, as unit steps. */
const AXES: Record<Direction, { along: Point; across: Point }> = {
  TB: { along: { x: 0, y: 1 }, across: { x: 1, y: 0 } },
  BT: { along: { x: 0, y: -1 }, across: { x: 1, y: 0 } },
  LR: { along: { x: 1, y: 0 }, across: { x: 0, y: 1 } },
  RL: { along: { x: -1, y: 0 }, across: { x: 0, y: 1 } },
};

/**
 * Places turned with the direction of the diagram: what stood further along the old way stands
 * further along the new one, and what stood beside it stands beside it still. A place is a box's
 * top left corner, so the boxes turn about their centers, with the sizes given. Boxes that stood
 * `GAP` apart or more and would come closer once turned (a wide box turned beside another) move
 * apart evenly, until all of them are that far apart again. The turned places start at the top
 * left corner the old ones did.
 */
export function turnPlaces(
  places: ReadonlyMap<string, Point>,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  from: Direction,
  to: Direction,
): Map<string, Point> {
  if (from === to || !places.size) return new Map(places);
  const old = AXES[from],
    now = AXES[to];
  const parts = [...places].map(([id, at]) => {
    const { width = 0, height = 0 } = sizes.get(id) ?? {},
      center = { x: at.x + width / 2, y: at.y + height / 2 },
      along = center.x * old.along.x + center.y * old.along.y,
      across = center.x * old.across.x + center.y * old.across.y;
    return {
      id,
      width,
      height,
      before: { x: at.x, y: at.y, width, height },
      center: {
        x: along * now.along.x + across * now.across.x,
        y: along * now.along.y + across * now.across.y,
      },
    };
  });
  const boxes = (spread: number) =>
    parts.map(({ center, width, height }) => ({
      x: center.x * spread - width / 2,
      y: center.y * spread - height / 2,
      width,
      height,
    }));
  const apart = parts.flatMap((a, i) =>
    parts
      .slice(i + 1)
      .flatMap((b, j) => (overlaps(a.before, b.before, -GAP) ? [] : [[i, i + 1 + j]])),
  );
  // Spread out in steps until the boxes that lay apart lie apart again.
  let spread = 1,
    turned = boxes(spread);
  while (spread < 4 && apart.some(([i, j]) => overlaps(turned[i], turned[j], -GAP))) {
    spread += 0.125;
    turned = boxes(spread);
  }
  const least = (all: { x: number; y: number }[]) => ({
    x: Math.min(...all.map((p) => p.x)),
    y: Math.min(...all.map((p) => p.y)),
  });
  const before = least([...places.values()]),
    after = least(turned);
  return new Map(
    parts.map(({ id }, index) => [
      id,
      {
        x: Math.round(turned[index].x - after.x + before.x),
        y: Math.round(turned[index].y - after.y + before.y),
      },
    ]),
  );
}
