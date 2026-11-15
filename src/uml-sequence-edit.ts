/**
 * Editing a sequence diagram source as text: adding participants and boxes, sending, moving and
 * removing messages, naming, the way uml-activity-edit.ts edits flowcharts. Each function returns
 * the source with one change made. A sequence diagram holds one statement a line, so an edit adds,
 * drops or rewrites whole lines; every other line stays as it was. The layout stays automatic.
 *
 * A participant is the node `head:<id>`, as its head is called in the scene, a box of participants
 * the group `box<index>`, a note the node `note<number>`, a fragment (`alt`, `loop`, ...) the group
 * `block<number>`, a message the edge `m<number>`. Activation bars and destruction crosses are no
 * parts: they follow the statements around them, and `toggleActivation` sets a bar on a message.
 *
 * The columns stand in the order in which the source first names their participants, by a
 * declaration or by a message. The edits that place a participant therefore declare the ones
 * before it that only messages name, where that is needed to keep the order the picture shows.
 */

import type { Structure, StructureEdge, StructureNode } from "./structure.ts";
import { scan } from "./uml.ts";
import { type MessageEvent, parseSequenceDiagram, type SequenceDiagram } from "./uml-sequence.ts";

/** What a canvas adds to a sequence diagram. */
export type SequencePiece = "participant" | "actor" | "box" | "note";

/** The kinds of fragment that frame messages under a condition. */
export type FragmentKind = "alt" | "loop" | "opt" | "par" | "critical" | "break";

const FRAGMENTS: string[] = ["alt", "loop", "opt", "par", "critical", "break"];

const linesOf = (source: string) => source.replace(/\r\n?/g, "\n").split("\n");

const indentOf = (line: string) => line.match(/^\s*/)![0];

/** The indent of a statement one level inside a line with the given indent. */
const deeper = (indent: string) => indent + (indent.includes("\t") ? "\t" : "  ");

/** The kinds of message with the arrow each is written with, the usual one first. */
const ARROWS: [kind: string, arrow: string, name: string][] = [
  ["sync", "->>", "Synchronous message"],
  ["reply", "-->>", "Reply"],
  ["async", "-)", "Asynchronous message"],
  ["async-reply", "--)", "Asynchronous reply"],
  ["line", "->", "Line"],
  ["dotted", "-->", "Dotted line"],
  ["lost", "-x", "Lost message"],
  ["dotted-lost", "--x", "Dotted lost message"],
  ["both", "<<->>", "Both ways"],
  ["dotted-both", "<<-->>", "Both ways, dotted"],
];

/**
 * A message statement as the parser reads it, in the pieces an edit puts together again: sender
 * with the space after it, arrow, the `+` or `-` of an activation with its space, receiver, text.
 */
const MESSAGE = new RegExp(
  `^(.+?\\s*)(${ARROWS.map(([, arrow]) => arrow)
    .toSorted((a, b) => b.length - a.length)
    .map((arrow) => arrow.replace(/[()]/g, "\\$&"))
    .join("|")})(\\s*[+-]?\\s*)([^:]+?)\\s*(?::(.*))?$`,
);

/** A participant declaration: the keywords, then `id` or `id as Name`. */
const DECLARATION = /^((?:create\s+)?(?:participant|actor)\s+)(.+)$/;

/** The colour a box may open with, as the parser reads it; what follows is the label. */
const COLOR =
  /^(rgba?\([^)]*\)|#[0-9a-f]{3,8}|transparent|aqua|black|blue|fuchsia|gray|grey|green|lime|maroon|navy|olive|purple|red|silver|teal|white|yellow|orange|pink|lightblue|lightgreen|lightgrey|lightgray|lightyellow|beige|ivory|lavender|wheat|tan|khaki|coral|salmon|gold|cyan|magenta)\b\s*/i;

/** The pieces of a message line. */
interface MessageParts {
  from: string;
  arrow: string;
  sign: string;
  to: string;
  text?: string;
}

function messageParts(line: string): MessageParts | null {
  const match = line.trim().match(MESSAGE);
  if (!match) return null;
  const [, from, arrow, sign, to, text] = match;
  return { from, arrow, sign, to, text };
}

/**
 * A message line written from its pieces. Mermaid reads a message only with a colon and something
 * after it, so a text that is empty is written as the colon and one space; a line that had no
 * colon keeps none.
 */
const messageLine = (indent: string, parts: MessageParts) =>
  `${indent}${parts.from}${parts.arrow}${parts.sign}${parts.to}${parts.text === undefined ? "" : `: ${parts.text}`}`;

/** A note statement: what stands before its participants, the participants, and the colon with the text. */
const NOTE = /^(note\s+(?:left of|right of|over)\s+)([^:]+?)(\s*:)\s*(.*)$/i;

/** A statement of one participant: its activation or its destruction. */
const OWN = /^((?:activate|deactivate|destroy)\s+)(.+)$/;

/** A statement that decorates a participant: its links and properties. */
const DECORATION = /^((?:links?|properties|details)\s+)([^:]+?)(\s*:.*)$/;

/** The words a statement can open with, which an id of a participant is not to be. */
const RESERVED = new Set(
  "end loop alt else opt par and critical option break rect box note activate deactivate participant actor create destroy title autonumber link links properties details as over of left right".split(
    " ",
  ),
);

/** Whether a text can be the id of a participant as it is typed: one word, no keyword. */
const canBeId = (id: string) =>
  /^[\p{L}_][\p{L}\p{N}_]*$/u.test(id) && !RESERVED.has(id.toLowerCase());

/**
 * A text as a message, an alias or a box holds it: line breaks as `<br>`, and as entity codes what
 * the parser would read as an entity, a tag, the end of a statement or surrounding quotes.
 */
const textOf = (label: string) =>
  label
    .trim()
    .replace(/[#;]/g, (character) => (character === "#" ? "#35;" : "#59;"))
    .replace(/&(?=\w+#59;)/g, "#amp;")
    .replace(/\s*\n\s*/g, "<br>")
    .replace(/<(?=\/?[a-z])(?!br\s*\/?>)/gi, "#lt;")
    .replace(/^"([\s\S]*)"$/, "#quot;$1#quot;");

/** The id of the participant a node id stands for, when the diagram has it. */
function participantOf(diagram: SequenceDiagram, node: string): string | null {
  const id = node.startsWith("head:") ? node.slice(5) : node;
  return diagram.participants.has(id) ? id : null;
}

/** The index of the box a node id stands for, when the diagram has it. */
function boxOf(diagram: SequenceDiagram, node: string | null | undefined): number | null {
  const match = node?.match(/^box(\d+)$/);
  return match && diagram.boxes[Number(match[1])] ? Number(match[1]) : null;
}

/** The message with an edge id. */
const messageOf = (diagram: SequenceDiagram, edge: string) =>
  diagram.events.find(
    (event): event is MessageEvent => event.type === "message" && event.id === edge,
  );

/** The index of the `end` line that closes the box opened on a line (from 1). */
function boxEnd(source: string, diagram: SequenceDiagram, line: number): number {
  const fragments = new Set(
    diagram.events.filter((event) => event.type === "end").map((event) => event.line),
  );
  const end = scan(source).lines.find(
    (item) => item.line > line && item.text === "end" && !fragments.has(item.line),
  );
  return (end?.line ?? line) - 1;
}

/** A declaration of a participant: where it stands, its keywords, and the name it gives. */
interface Declaration {
  index: number;
  keywords: string;
  id: string;
  alias?: string;
  created: boolean;
}

/** The participant declarations of a source, in order. */
function declarations(source: string): Declaration[] {
  return scan(source).lines.flatMap(({ text, line }): Declaration[] => {
    const match = text.match(DECLARATION);
    if (!match) return [];
    const spec = match[2].trim(),
      alias = spec.match(/^(.+?)\s+as\s+(.+)$/);
    return [
      {
        index: line - 1,
        keywords: match[1],
        id: (alias ? alias[1] : spec).trim(),
        alias: alias?.[2],
        created: /^create\b/.test(match[1]),
      },
    ];
  });
}

/** An id no participant has yet. */
function freshId(diagram: SequenceDiagram, base: string): string {
  for (let count = 1; ; count++) {
    const id = `${base}${count}`;
    if (!diagram.participants.has(id)) return id;
  }
}

/** The indent of the statements that stand in no box and no fragment: that of the first one. */
function topIndent(source: string, lines: string[]): string {
  const first = scan(source).lines[1];
  return first ? indentOf(lines[first.line - 1]) : "  ";
}

/** A box line with a label; a label that opens with a colour word gets `transparent` before it. */
function boxLine(indent: string, colour: string, label: string): string {
  const text = textOf(label),
    shade = colour || (COLOR.test(text) ? "transparent" : "");
  return `${indent}box${shade ? ` ${shade}` : ""}${text ? ` ${text}` : ""}`;
}

const parses = (source: string) => {
  try {
    parseSequenceDiagram(source);
    return true;
  } catch {
    return false;
  }
};

/** The ids of the participants in the order of their columns. */
const columns = (diagram: SequenceDiagram) => [...diagram.participants.keys()];

/**
 * Where a participant is declared so that it stands after the ones declared before a line: after
 * the last declaration before that line, behind the box that one stands in, or else before the
 * first statement that says something of the sequence.
 */
function declarePlace(
  source: string,
  diagram: SequenceDiagram,
  lines: string[],
  limit = Infinity,
): { at: number; indent: string } {
  const last = declarations(source).findLast((item) => !item.created && item.index < limit);
  if (last) {
    const around = diagram.boxes
      .map((box) => ({ open: box.line - 1, end: boxEnd(source, diagram, box.line) }))
      .find((box) => box.open < last.index && last.index < box.end);
    return {
      at: (around ? around.end : last.index) + 1,
      indent: indentOf(lines[around ? around.open : last.index]),
    };
  }
  const statements = scan(source).lines,
    first = statements
      .slice(1)
      .find((item) => !/^(title|autonumber|accTitle|accDescr)\b/.test(item.text));
  return {
    at: first ? first.line - 1 : (statements[0]?.line ?? lines.length),
    indent: first ? indentOf(lines[first.line - 1]) : topIndent(source, lines),
  };
}

/** The declaration that names a participant first and so sets its column, when it has one. */
function pinOf(source: string, diagram: SequenceDiagram, who: string): Declaration | undefined {
  const line = diagram.participants.get(who)?.line;
  return declarations(source).find(
    (item) => item.id === who && !item.created && item.index + 1 === line,
  );
}

/**
 * The source with a participant declared before everything else that names it: a participant that
 * a message names first is declared where declarations stand, after the participants of the
 * columns before it, which are declared there too when messages name them first. The columns keep
 * their order.
 */
function pinned(source: string, who: string): string {
  const diagram = parseSequenceDiagram(source),
    item = diagram.participants.get(who);
  if (!item || item.created || pinOf(source, diagram, who)) return source;
  const lines = linesOf(source),
    order = columns(diagram),
    place = declarePlace(source, diagram, lines, item.line - 1),
    late = order
      .slice(0, order.indexOf(who) + 1)
      .filter((id) => diagram.participants.get(id)!.line - 1 >= place.at);
  lines.splice(place.at, 0, ...late.map((id) => `${place.indent}participant ${id}`));
  return lines.join("\n");
}

/**
 * Adds a participant or an actor beside another: in the column after the participant `after`, or
 * before the participant `before`, and in the box that one stands in. Its declaration is written
 * beside the declaration of the other, which is declared first when only messages name it.
 * Without another participant it is added as `addSequencePiece` adds it, as the last one. Returns
 * the id of the node it got.
 */
export function insertParticipant(
  source: string,
  piece: { kind: "participant" | "actor"; label?: string; after?: string; before?: string },
): { source: string; id: string } {
  const read = parseSequenceDiagram(source),
    following = piece.after !== undefined && participantOf(read, piece.after) !== null,
    who = participantOf(read, (following ? piece.after : piece.before) ?? "");
  if (who === null) return addSequencePiece(source, { kind: piece.kind, label: piece.label });
  const id = freshId(read, piece.kind),
    name = textOf(piece.label ?? "") || (piece.kind === "actor" ? "Actor" : "Participant"),
    text = `${piece.kind} ${id} as ${name}`;
  let lines: string[], at: number;
  if (read.participants.get(who)!.created) {
    // A participant a message creates: before its `create`, or after the message that creates it.
    const create = read.events.findIndex((event) => event.type === "create" && event.who === who),
      made = read.events.find(
        (event, index) =>
          index > create && event.type === "message" && (event.to === who || event.from === who),
      );
    lines = linesOf(source);
    at = following ? (made ?? read.events[create]).line : read.events[create].line - 1;
    lines.splice(at, 0, indentOf(lines[read.events[create].line - 1]) + text);
  } else {
    const ready = pinned(source, who),
      pin = pinOf(ready, parseSequenceDiagram(ready), who)!;
    lines = linesOf(ready);
    at = pin.index + (following ? 1 : 0);
    lines.splice(at, 0, indentOf(lines[pin.index]) + text);
  }
  const result = lines.join("\n");
  return parses(result) ? { source: result, id: `head:${id}` } : { source, id: "" };
}

/**
 * Moves a participant one place to the left (`-1`) or to the right (`1`): it changes places with
 * the participant of the column beside it, or steps over the border of a box, into the box beside
 * it or out of the one it stands in, as a message steps into a fragment. A box it leaves empty
 * goes. The participants involved are declared first when only messages name them. The source
 * stays as it is at the first and the last column, and for a participant that a message creates.
 */
export function moveParticipant(source: string, id: string, delta: -1 | 1): string {
  const before = parseSequenceDiagram(source),
    who = participantOf(before, id),
    order = columns(before);
  if (who === null || before.participants.get(who)!.created) return source;
  const beside = order[order.indexOf(who) + delta];
  if (beside && before.participants.get(beside)!.created) return source;
  // The later of the two first: declaring it declares the columns before it as well.
  const ready = pinned(pinned(source, delta === 1 && beside ? beside : who), who),
    diagram = parseSequenceDiagram(ready),
    lines = linesOf(ready),
    borders = diagram.boxes.flatMap((box) => [
      { index: box.line - 1, type: "open" as const, id: "" },
      { index: boxEnd(ready, diagram, box.line), type: "close" as const, id: "" },
    ]),
    stops = [
      ...borders,
      ...columns(diagram).flatMap((item) => {
        const pin = pinOf(ready, diagram, item);
        return pin ? [{ index: pin.index, type: "pin" as const, id: item }] : [];
      }),
    ].toSorted((a, b) => a.index - b.index),
    here = stops.find((stop) => stop.id === who)!,
    there = stops[stops.indexOf(here) + delta];
  if (!there) return source;
  const own = lines[here.index].trim(),
    wanted = columns(diagram);
  if (there.type === "pin") {
    lines[here.index] = indentOf(lines[here.index]) + lines[there.index].trim();
    lines[there.index] = indentOf(lines[there.index]) + own;
    const at = wanted.indexOf(who);
    [wanted[at], wanted[at + delta]] = [wanted[at + delta], wanted[at]];
  } else {
    // Into the box: as deep as its participants; out of it: as deep as the box.
    const enters = (there.type === "open") === (delta === 1),
      box = diagram.boxes.findIndex(
        (item) =>
          item.line - 1 === there.index || boxEnd(ready, diagram, item.line) === there.index,
      ),
      open = diagram.boxes[box].line - 1,
      member = declarations(ready).find(
        (item) => item.index > open && item.index < boxEnd(ready, diagram, open + 1),
      ),
      outer = indentOf(lines[open]),
      indent = enters ? (member ? indentOf(lines[member.index]) : deeper(outer)) : outer;
    lines.splice(there.index + (delta === 1 ? 1 : 0), 0, indent + own);
    lines.splice(here.index + (delta === 1 ? 0 : 1), 1);
  }
  let result = lines.join("\n");
  try {
    const moved = parseSequenceDiagram(result);
    if (columns(moved).join("\n") !== wanted.join("\n")) return source;
    // The box the participant was the last to stand in.
    const members = (read: SequenceDiagram, box: number) =>
      [...read.participants.values()].filter((item) => item.box === box).length;
    const empty = moved.boxes.findIndex(
      (_, box) => !members(moved, box) && members(diagram, box) > 0,
    );
    if (empty >= 0) {
      const rest = linesOf(result),
        end = boxEnd(result, moved, moved.boxes[empty].line);
      rest.splice(end, 1);
      rest.splice(moved.boxes[empty].line - 1, 1);
      result = rest.join("\n");
    }
    return parses(result) ? result : source;
  } catch {
    return source;
  }
}

/**
 * Frames participants in a new box: participants of columns that stand side by side and in no box
 * yet. Their declarations are brought together where the first of them stands, between a `box`
 * line and its `end`; those that only messages name are declared first. Returns the id of the box,
 * empty with the source unchanged when the participants cannot be framed.
 */
export function boxParticipants(
  source: string,
  ids: string[],
  label: string,
): { source: string; id: string } {
  const before = parseSequenceDiagram(source),
    order = columns(before),
    none = { source, id: "" },
    found = [...new Set(ids.map((id) => participantOf(before, id)))],
    members = found
      .filter((who): who is string => who !== null)
      .toSorted((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!members.length || members.length < found.length) return none;
  const first = order.indexOf(members[0]);
  if (
    members.some((who, offset) => {
      const item = before.participants.get(who)!;
      return order[first + offset] !== who || item.created || item.box !== null;
    })
  )
    return none;
  const ready = members.reduce(pinned, source),
    diagram = parseSequenceDiagram(ready),
    lines = linesOf(ready),
    pins = members.map((who) => pinOf(ready, diagram, who));
  if (pins.some((pin) => !pin)) return none;
  const taken = new Set(pins.map((pin) => pin!.index)),
    at = pins[0]!.index,
    indent = indentOf(lines[at]),
    box = [
      boxLine(indent, "", label || "Group"),
      ...pins.map((pin) => deeper(indent) + lines[pin!.index].trim()),
      `${indent}end`,
    ],
    result = lines
      .flatMap((line, index) => (index === at ? box : taken.has(index) ? [] : [line]))
      .join("\n");
  try {
    const boxed = parseSequenceDiagram(result),
      number = boxed.participants.get(members[0])!.box;
    if (
      number === null ||
      columns(boxed).join("\n") !== order.join("\n") ||
      [...boxed.participants.values()].some(
        (item) => (item.box === number) !== members.includes(item.id),
      )
    )
      return none;
    return { source: result, id: `box${number}` };
  } catch {
    return none;
  }
}

/**
 * Adds a participant or an actor after the last one declared, or at the top when participants are
 * only named by messages; inside a box when `parent` is one, and in the column after a participant
 * when `parent` is one. A box frames the participant `parent`; without one it comes with a first
 * participant, since a box without one is not drawn. A note stands over the participant `parent`,
 * as the last statement of the diagram. Returns the id of the node it got, empty with the source
 * unchanged when the piece has no place: a note without a participant, a box around a participant
 * that stands in one.
 */
export function addSequencePiece(
  source: string,
  piece: { kind: SequencePiece; label?: string; parent?: string | null },
): { source: string; id: string } {
  const diagram = parseSequenceDiagram(source),
    lines = linesOf(source),
    beside = participantOf(diagram, piece.parent?.startsWith("head:") ? piece.parent : "");
  if (piece.kind === "note") {
    if (beside === null) return { source, id: "" };
    let end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) end--;
    lines.splice(
      end,
      0,
      `${topIndent(source, lines)}note over ${beside}: ${textOf(piece.label ?? "") || "Note"}`,
    );
    const notes = diagram.events.filter((event) => event.type === "note").length;
    return { source: lines.join("\n"), id: `note${notes + 1}` };
  }
  if (beside !== null)
    return piece.kind === "box"
      ? boxParticipants(source, [beside], piece.label ?? "")
      : insertParticipant(source, { kind: piece.kind, label: piece.label, after: beside });
  const id = freshId(diagram, piece.kind === "actor" ? "actor" : "participant"),
    label = textOf(piece.label ?? "");
  const parent = piece.kind === "box" ? null : boxOf(diagram, piece.parent);
  let at: number, indent: string;
  if (parent !== null) {
    const open = diagram.boxes[parent].line - 1;
    at = boxEnd(source, diagram, open + 1);
    const member = declarations(source).findLast((item) => item.index > open && item.index < at);
    indent = member ? indentOf(lines[member.index]) : deeper(indentOf(lines[open]));
  } else ({ at, indent } = declarePlace(source, diagram, lines));
  if (piece.kind === "box") {
    lines.splice(
      at,
      0,
      boxLine(indent, "", label || "Group"),
      `${deeper(indent)}participant ${id} as Participant`,
      `${indent}end`,
    );
    return {
      source: lines.join("\n"),
      id: `box${diagram.boxes.filter((box) => box.line - 1 < at).length}`,
    };
  }
  const keyword = piece.kind === "actor" ? "actor" : "participant",
    name = label || (piece.kind === "actor" ? "Actor" : "Participant");
  lines.splice(at, 0, `${indent}${keyword} ${id} as ${name}`);
  return { source: lines.join("\n"), id: `head:${id}` };
}

/** The note with a node id. */
const noteOf = (diagram: SequenceDiagram, id: string) =>
  diagram.events.find((event) => event.type === "note" && event.id === id);

/**
 * Sends a message from one participant to another, or to itself, and returns the source with the
 * id the message has in it: messages are numbered in the order of the source, so one written in
 * the middle takes the number of the one that stood there. The message stands after the message
 * with the edge id `after`, in the fragment that one stands in, or else as the last statement of
 * the diagram, in no fragment. Its text is `message` unless a label is given.
 *
 * A note as one end is put over the participant at the other, and no message is returned. Parts
 * that are no participants are not sent to: the source stays as it is, with no message.
 */
export function connectSequence(
  source: string,
  from: string,
  to: string,
  kind?: string,
  options: { label?: string; after?: string; sign?: "+" | "-" | "" } = {},
): { source: string; edge: string } {
  const diagram = parseSequenceDiagram(source),
    lines = linesOf(source),
    sender = participantOf(diagram, from),
    receiver = participantOf(diagram, to),
    note = noteOf(diagram, sender === null ? from : to),
    host = sender ?? receiver;
  if (note && host !== null && (sender === null) !== (receiver === null)) {
    const index = note.line - 1,
      parts = lines[index].trim().match(NOTE);
    if (!parts) return { source, edge: "" };
    lines[index] = `${indentOf(lines[index])}${parts[1]}${host}${parts[3]} ${parts[4]}`;
    const moved = lines.join("\n");
    return { source: parses(moved) ? moved : source, edge: "" };
  }
  if (sender === null || receiver === null) return { source, edge: "" };
  const arrow = ARROWS.find(([name]) => name === (kind ?? "sync"))?.[1] ?? "->>",
    parts = {
      from: sender,
      arrow,
      sign: options.sign ?? "",
      to: receiver,
      text: textOf(options.label ?? "message"),
    };
  const anchor = options.after ? messageOf(diagram, options.after) : undefined;
  let at = lines.length;
  if (anchor) at = anchor.line;
  else while (at > 0 && !lines[at - 1].trim()) at--;
  lines.splice(
    at,
    0,
    messageLine(anchor ? indentOf(lines[anchor.line - 1]) : topIndent(source, lines), parts),
  );
  const result = lines.join("\n");
  try {
    const made = parseSequenceDiagram(result).events.find(
      (event) => event.type === "message" && event.line === at + 1,
    );
    return made?.type === "message" ? { source: result, edge: made.id } : { source, edge: "" };
  } catch {
    return { source, edge: "" };
  }
}

/** Sends a message as `connectSequence` does, and returns the source alone. */
export function insertMessage(
  source: string,
  from: string,
  to: string,
  options: { kind?: string; label?: string; after?: string } = {},
): string {
  return connectSequence(source, from, to, options.kind, options).source;
}

/**
 * Answers a message: a reply (`-->>`) from its receiver back to its sender, right after it and in
 * its fragment, with the text `reply`. It closes the activation bar the message opens with `+`
 * when nothing closes that yet. Returns the source with the id of the reply in it.
 */
export function replyTo(source: string, edge: string): { source: string; edge: string } {
  const diagram = parseSequenceDiagram(source),
    message = messageOf(diagram, edge);
  if (!message) return { source, edge: "" };
  const index = diagram.events.indexOf(message),
    open = message.activate && !bars(diagram.events).some(([opener]) => opener === index);
  return connectSequence(source, `head:${message.to}`, `head:${message.from}`, "reply", {
    label: "reply",
    after: edge,
    sign: open ? "-" : "",
  });
}

/**
 * Where a message stands: the innermost fragment that holds it, and its place among the messages
 * of the diagram, from 0. Null for an edge the diagram does not have.
 */
export function messageContext(
  source: string,
  edge: string,
): { fragment: string | null; index: number } | null {
  const open: string[] = [];
  let index = 0;
  for (const event of parseSequenceDiagram(source).events) {
    if (event.type === "start") open.push(event.id);
    else if (event.type === "end") open.pop();
    else if (event.type === "message") {
      if (event.id === edge) return { fragment: open.at(-1) ?? null, index };
      index++;
    }
  }
  return null;
}

/**
 * Moves a message one statement up (`-1`) or down (`1`): it changes places with the message, note
 * or activation beside it, or steps over the line that opens, divides or closes a fragment, into or
 * out of it. The source stays as it is where that is not defined: beside a declaration, a box or
 * the header, for the message that creates or destroys a participant, and when the activations
 * would no longer match.
 */
export function moveMessage(source: string, edge: string, delta: -1 | 1): string {
  const diagram = parseSequenceDiagram(source),
    lines = linesOf(source),
    message = messageOf(diagram, edge);
  if (!message) return source;
  const statements = scan(source).lines,
    at = statements.findIndex((item) => item.line === message.line),
    eventAt = (position: number) =>
      diagram.events.find((event) => event.line === statements[position]?.line);
  const beside = eventAt(at + delta),
    bound = (position: number) => {
      const event = eventAt(position);
      return event?.type === "create" || event?.type === "destroy";
    };
  // A `create` or `destroy` and the message below it belong together.
  if (!beside || bound(at + delta) || bound(at - 1) || (delta === -1 && bound(at - 2)))
    return source;
  const here = message.line - 1,
    there = beside.line - 1,
    own = lines[here].trim();
  let indent = indentOf(lines[here]);
  if (beside.type === "start" || beside.type === "end") {
    const border = indentOf(lines[there]);
    if ((beside.type === "start") === (delta === 1)) {
      // Into the fragment: as deep as the statement it comes to stand beside, when there is one.
      const next = statements[at + 2 * delta],
        inner = next ? indentOf(lines[next.line - 1]) : "";
      indent = inner.length > border.length ? inner : deeper(border);
    } else indent = border;
  }
  lines[here] = lines[there];
  lines[there] = indent + own;
  const moved = lines.join("\n");
  try {
    parseSequenceDiagram(moved);
  } catch {
    return source;
  }
  return moved;
}

/**
 * Gives a participant, a box, a note or a fragment another name. A participant keeps its id, which
 * the messages name it by: the name is the alias of its declaration (`participant id as Name`),
 * and a participant that only messages name is declared where it first stands, so the columns keep
 * their order. An empty name removes the alias, which leaves the id as the name. A note gets the
 * name as its text, and keeps the text it has when the name is empty. A fragment gets it as its
 * condition, the text after its keyword; the keyword it is labelled with (`alt is sick`) is not
 * part of the condition and is left out when the name opens with it. A `rect` has none.
 */
export function renameSequence(source: string, id: string, label: string): string {
  const diagram = parseSequenceDiagram(source),
    lines = linesOf(source),
    text = textOf(label);
  const note = noteOf(diagram, id),
    fragment = diagram.events.find((event) => event.type === "start" && event.id === id);
  if (note || fragment) {
    const index = (note ?? fragment)!.line - 1,
      statement = lines[index].trim(),
      parts = statement.match(NOTE),
      keyword = statement.match(/^\w+/)![0],
      condition =
        text === keyword
          ? ""
          : text.startsWith(`${keyword} `)
            ? text.slice(keyword.length + 1)
            : text;
    if (note ? !parts || !text : keyword === "rect") return source;
    lines[index] =
      indentOf(lines[index]) +
      (note
        ? `${parts![1]}${parts![2]}${parts![3]} ${text}`
        : `${keyword}${condition ? ` ${condition.trim()}` : ""}`);
    const result = lines.join("\n");
    try {
      const read = parseSequenceDiagram(result);
      return read.events.length === diagram.events.length ? result : source;
    } catch {
      return source;
    }
  }
  const box = boxOf(diagram, id);
  if (box !== null) {
    const index = diagram.boxes[box].line - 1,
      rest = lines[index].trim().replace(/^box\s*/, "");
    lines[index] = boxLine(indentOf(lines[index]), rest.match(COLOR)?.[0].trim() ?? "", label);
    return lines.join("\n");
  }
  const who = participantOf(diagram, id);
  if (who === null) return source;
  const declared = declarations(source).filter((item) => item.id === who),
    // The last alias is the one that shows.
    found = declared.findLast((item) => item.alias !== undefined) ?? declared[0],
    named = (keywords: string, name: string) =>
      `${keywords}${name}${text && text !== name ? ` as ${text}` : ""}`;
  if (found) {
    lines[found.index] = indentOf(lines[found.index]) + named(found.keywords, who);
    return lines.join("\n");
  }
  if (!text || text === who) return source;
  // Declared before the line that first names it, after those the same line names before it.
  const first = diagram.participants.get(who)!.line,
    together = [...diagram.participants.values()].filter((item) => item.line === first),
    indent = indentOf(lines[first - 1]);
  lines.splice(
    first - 1,
    0,
    ...together
      .slice(0, together.findIndex((item) => item.id === who) + 1)
      .map(
        (item) =>
          `${indent}${item.id === who ? named("participant ", who) : `participant ${item.id}`}`,
      ),
  );
  return lines.join("\n");
}

/** Gives a message another text; an empty one leaves the colon with a space, which Mermaid needs to read the message. */
export function labelMessage(source: string, edge: string, label: string): string {
  const diagram = parseSequenceDiagram(source),
    lines = linesOf(source),
    message = messageOf(diagram, edge),
    parts = message && messageParts(lines[message.line - 1]);
  if (!message || !parts) return source;
  lines[message.line - 1] = messageLine(indentOf(lines[message.line - 1]), {
    ...parts,
    text: textOf(label),
  });
  return lines.join("\n");
}

/** Makes a message one of another kind: another arrow, with its text and its activation kept. */
export function relinkMessage(source: string, edge: string, kind: string): string {
  const diagram = parseSequenceDiagram(source),
    lines = linesOf(source),
    message = messageOf(diagram, edge),
    parts = message && messageParts(lines[message.line - 1]),
    arrow = ARROWS.find(([name]) => name === kind)?.[1];
  if (!message || !parts || !arrow) return source;
  lines[message.line - 1] = messageLine(indentOf(lines[message.line - 1]), {
    ...parts,
    text: parts.text?.trim(),
    arrow,
  });
  return lines.join("\n");
}

/**
 * The activation bars as pairs of events: the one that opens a bar (`activate`, or a message with
 * `+`) and the one that closes it (`deactivate`, or a message with `-`), by index.
 */
function bars(events: SequenceDiagram["events"]): [number, number][] {
  const open = new Map<string, number[]>(),
    pairs: [number, number][] = [];
  const push = (who: string, index: number) => open.set(who, [...(open.get(who) ?? []), index]);
  const pop = (who: string, index: number) => {
    const opener = open.get(who)?.pop();
    if (opener !== undefined) pairs.push([opener, index]);
  };
  events.forEach((event, index) => {
    if (event.type === "activate") push(event.who, index);
    else if (event.type === "deactivate") pop(event.who, index);
    else if (event.type === "message") {
      if (event.activate) push(event.to, index);
      if (event.deactivate) pop(event.from, index);
    }
  });
  return pairs;
}

/**
 * Removes participants with their messages, boxes with their participants, notes and messages, by
 * id; of a fragment it removes the frame and keeps what the fragment holds, as `unwrapFragment`
 * does. With a participant go its declarations, its activations, its destruction and the notes on
 * it alone; a note over two keeps the other. Every other participant stays in its column: one that
 * loses the line which names it first, and with it its place or all that names it, is declared
 * there (`participant John`). What a removal would leave without sense goes too:
 * the other end of an activation bar whose one end is removed (the `+` or `-` of a message, or the
 * `activate` or `deactivate` line), a fragment that held something removed and holds no message or
 * note any more, a box that keeps no participant, the `create` of a participant that no message
 * creates any more, and a `destroy` that no message follows.
 */
export function removeSequence(source: string, ids: Iterable<string>): string {
  const all = [...ids],
    frames = all
      .filter((id) => /^block\d+$/.test(id))
      .toSorted((a, b) => Number(b.slice(5)) - Number(a.slice(5)));
  // Frames first, the last one first: that leaves the ids of everything else as they are.
  if (frames.length)
    return removeSequence(
      frames.reduce(unwrapFragment, source),
      all.filter((id) => !frames.includes(id)),
    );
  const diagram = parseSequenceDiagram(source),
    lines = linesOf(source),
    named = new Set(all),
    events = diagram.events;
  const participants = [...diagram.participants.values()],
    gone = new Set<string>(),
    dropped = new Set<number>(),
    rewritten = new Map<number, string>();
  for (const id of named) {
    const who = id.startsWith("head:") ? participantOf(diagram, id) : null,
      box = boxOf(diagram, id);
    if (who !== null) gone.add(who);
    if (box !== null) for (const item of participants) if (item.box === box) gone.add(item.id);
  }
  diagram.boxes.forEach((box, number) => {
    const members = participants.filter((item) => item.box === number);
    if (named.has(`box${number}`) || (members.length && members.every((item) => gone.has(item.id))))
      dropped.add(box.line - 1).add(boxEnd(source, diagram, box.line));
  });

  // The events that go, by index.
  const removed = new Set<number>();
  events.forEach((event, index) => {
    if (event.type === "message") {
      if (named.has(event.id) || gone.has(event.from) || gone.has(event.to)) removed.add(index);
    } else if (event.type === "note") {
      const left = event.who.filter((who) => !gone.has(who));
      if (!left.length || named.has(event.id)) removed.add(index);
      else if (left.length < event.who.length) {
        const line = lines[event.line - 1],
          match = line.match(/^(\s*note\s+over\s+)[^:]+?(\s*:.*)$/i);
        if (match) rewritten.set(event.line - 1, `${match[1]}${left.join(",")}${match[2]}`);
      }
    } else if ("who" in event && gone.has(event.who)) removed.add(index);
  });

  // A bar that loses one end loses the other: a statement goes, a message keeps all but its sign.
  const unsigned = new Set<number>();
  for (const pair of bars(events)) {
    if (removed.has(pair[0]) === removed.has(pair[1])) continue;
    const other = removed.has(pair[0]) ? pair[1] : pair[0];
    if (events[other].type === "message") unsigned.add(other);
    else removed.add(other);
  }

  // A participant no message creates any more stands at the top; a destruction needs its message.
  const stays = (index: number) => !removed.has(index);
  events.forEach((event, index) => {
    if (!stays(index) || (event.type !== "create" && event.type !== "destroy")) return;
    const follows = events.some(
      (other, at) =>
        at > index &&
        stays(at) &&
        other.type === "message" &&
        (other.to === event.who || (event.type === "destroy" && other.from === event.who)),
    );
    if (follows) return;
    if (event.type === "destroy") removed.add(index);
    else rewritten.set(event.line - 1, lines[event.line - 1].replace(/^(\s*)create\s+/, "$1"));
  });

  // Fragments that held something removed and hold no message or note any more.
  const opened: number[] = [],
    emptied: [number, number][] = [];
  events.forEach((event, index) => {
    if (event.type === "start") opened.push(index);
    if (event.type !== "end") return;
    const start = opened.pop()!,
      inside = events.slice(start + 1, index).map((_, offset) => start + 1 + offset);
    const border = (at: number) => ["start", "else", "end"].includes(events[at].type);
    if (
      inside.some((at) => removed.has(at) && !border(at)) &&
      inside.every((at) => removed.has(at) || border(at))
    ) {
      for (let line = events[start].line - 1; line < event.line; line++) dropped.add(line);
      emptied.push([events[start].line - 1, event.line - 1]);
    }
  });

  for (const index of removed) dropped.add(events[index].line - 1);
  for (const item of declarations(source)) if (gone.has(item.id)) dropped.add(item.index);
  // What only decorates a participant: its links and properties.
  for (const { text, line } of scan(source).lines) {
    const match = text.match(/^(?:links?|properties|details)\s+([^:]+?)\s*:/);
    if (match && gone.has(match[1])) dropped.add(line - 1);
  }
  for (const index of unsigned) {
    const at = events[index].line - 1,
      parts = messageParts(lines[at]);
    if (parts && !dropped.has(at))
      rewritten.set(
        at,
        messageLine(indentOf(lines[at]), {
          ...parts,
          sign: parts.sign.replace(/[+-]/, ""),
          text: parts.text?.trim(),
        }),
      );
  }
  // The participants each line names, in the order it names them.
  const mentions = new Map<number, string[]>(),
    mention = (index: number, ...who: string[]) =>
      mentions.set(index, [...(mentions.get(index) ?? []), ...who]);
  for (const item of declarations(source)) mention(item.index, item.id);
  for (const event of events) {
    if (event.type === "message") mention(event.line - 1, event.from, event.to);
    else if (event.type === "note") mention(event.line - 1, ...event.who);
    else if ("who" in event && event.type !== "create") mention(event.line - 1, event.who);
  }
  // Where each participant that stays is named first: as the source stands, and once the lines go.
  const staying = participants.filter((item) => !gone.has(item.id)),
    place = (who: string, kept: boolean): [number, number] => {
      for (const [index, list] of [...mentions].toSorted((a, b) => a[0] - b[0]))
        if (list.includes(who) && !(kept && dropped.has(index))) return [index, list.indexOf(who)];
      return [Infinity, 0];
    },
    earlier = (a: [number, number], b: [number, number]) =>
      a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  // A participant that would be gone, or stand behind one of a later column, is declared in its
  // place. From the last column on: each is measured against where the later ones come to stand.
  const declared = new Map<number, string[]>(),
    stands = new Map<string, [number, number]>();
  staying.toReversed().forEach((item, behind) => {
    const first = place(item.id, false),
      left = place(item.id, true),
      later = staying.slice(staying.length - behind);
    stands.set(item.id, left);
    if (!dropped.has(first[0])) return;
    if (left[0] !== Infinity && !later.some((other) => earlier(stands.get(other.id)!, left)))
      return;
    // As deep as the outermost fragment that goes around it.
    const outer = Math.min(
      first[0],
      ...emptied.filter(([from, to]) => from <= first[0] && first[0] <= to).map(([from]) => from),
    );
    stands.set(item.id, first);
    declared.set(first[0], [
      `${indentOf(lines[outer])}participant ${item.id}`,
      ...(declared.get(first[0]) ?? []),
    ]);
  });
  return lines
    .flatMap((line, index) => [
      ...(declared.get(index) ?? []),
      ...(dropped.has(index) ? [] : [rewritten.get(index) ?? line]),
    ])
    .join("\n");
}

/** A statement with one participant id written as another, wherever it stands as an id. */
function withParticipant(text: string, from: string, to: string): string {
  const swap = (id: string) => (id.trim() === from ? id.replace(from, () => to) : id);
  let match: RegExpMatchArray | null;
  if ((match = text.match(DECORATION))) return match[1] + swap(match[2]) + match[3];
  if ((match = text.match(DECLARATION))) {
    const alias = match[2].match(/^(.+?)(\s+as\s+.+)$/);
    return match[1] + (alias ? swap(alias[1]) + alias[2] : swap(match[2]));
  }
  if ((match = text.match(OWN))) return match[1] + swap(match[2]);
  if ((match = text.match(NOTE)))
    return (
      match[1] + match[2].split(",").map(swap).join(",") + text.slice((match[1] + match[2]).length)
    );
  if ((match = text.match(MESSAGE))) {
    const [, sender, arrow, sign, receiver] = match;
    return (
      swap(sender) +
      arrow +
      sign +
      swap(receiver) +
      text.slice((sender + arrow + sign + receiver).length)
    );
  }
  return text;
}

/**
 * Gives a participant another id, on every line that mentions it: its declarations, its messages,
 * its notes, its activations and its links. The source stays as it is when the id cannot be one or
 * another participant has it.
 */
export function renameParticipantId(source: string, id: string, newId: string): string {
  const diagram = parseSequenceDiagram(source),
    who = participantOf(diagram, id),
    lines = linesOf(source);
  if (who === null || !canBeId(newId) || diagram.participants.has(newId)) return source;
  const fragments = new Set(
    diagram.events.flatMap((event) =>
      event.type === "start" || event.type === "else" ? [event.line] : [],
    ),
  );
  for (const { text, line } of scan(source).lines.slice(1))
    if (!fragments.has(line) && !/^(title|autonumber|accTitle|accDescr|box|end)\b/.test(text))
      lines[line - 1] = indentOf(lines[line - 1]) + withParticipant(text, who, newId);
  const result = lines.join("\n"),
    wanted = columns(diagram).map((item) => (item === who ? newId : item));
  try {
    return columns(parseSequenceDiagram(result)).join("\n") === wanted.join("\n") ? result : source;
  } catch {
    return source;
  }
}

/** A name as an id: its words run together, each after the first with a capital. */
function idFrom(name: string): string {
  const words = name.replace(/<br\s*\/?>/gi, " ").match(/[\p{L}\p{N}_]+/gu) ?? [];
  return words
    .map((word, index) => (index ? word[0].toUpperCase() + word.slice(1) : word))
    .join("");
}

/**
 * Gives a part that was just added its first name. A participant that was added under a generated
 * id (`participant1`, `actor1`) takes its id from the name, on every line that mentions it: the
 * name itself where it can be an id (`participant Cart`), else its words run together
 * (`participant WebShop as Web shop`). Where that gives no id, or one that is taken, and for every
 * other part, the name is written as `renameSequence` writes it. Returns the id the part has
 * afterwards.
 */
export function retitleSequence(
  source: string,
  id: string,
  name: string,
): { source: string; id: string } {
  const who = participantOf(parseSequenceDiagram(source), id.startsWith("head:") ? id : ""),
    title = name.trim(),
    wanted = canBeId(title) ? title : idFrom(title);
  if (who !== null && /^(?:participant|actor)\d+$/.test(who) && wanted.length <= 24) {
    const renamed = renameParticipantId(source, id, wanted);
    if (renamed !== source)
      return { source: renameSequence(renamed, `head:${wanted}`, name), id: `head:${wanted}` };
  }
  return { source: renameSequence(source, id, name), id };
}

/** The lines strictly between two others, one step less indented where they stand deeper than the first. */
function dedent(lines: string[], open: number, close: number) {
  const outer = indentOf(lines[open]),
    inside = lines.slice(open + 1, close).find((line) => line.trim()),
    inner = inside ? indentOf(inside) : outer;
  if (inner.length > outer.length && inner.startsWith(outer))
    for (let index = open + 1; index < close; index++)
      if (lines[index].startsWith(inner)) lines[index] = outer + lines[index].slice(inner.length);
}

/**
 * Takes the frame of a fragment away and keeps what it holds: the line that opens it, the lines
 * that divide it (`else`, `and`, `option`) and its `end` go, the statements between them stand one
 * step less indented.
 */
export function unwrapFragment(source: string, id: string): string {
  const diagram = parseSequenceDiagram(source),
    lines = linesOf(source),
    own = diagram.events.filter((event) => "id" in event && event.id === id),
    start = own.find((event) => event.type === "start"),
    end = own.find((event) => event.type === "end");
  if (!start || !end) return source;
  dedent(lines, start.line - 1, end.line - 1);
  const cut = new Set(own.map((event) => event.line - 1)),
    result = lines.filter((_, index) => !cut.has(index)).join("\n");
  return parses(result) ? result : source;
}

/**
 * Frames messages in a new fragment: a run of messages that follow one another, with the notes,
 * activations and whole fragments between them. The line that opens the fragment stands before the
 * first message, its `end` after the last, the lines between one step deeper. Returns the id of
 * the fragment, empty with the source unchanged when the messages are no such run: when another
 * message stands between them, or when they stand in different fragments.
 */
export function wrapMessages(
  source: string,
  edges: string[],
  kind: FragmentKind,
  label: string,
): { source: string; id: string } {
  const diagram = parseSequenceDiagram(source),
    { events } = diagram,
    lines = linesOf(source),
    none = { source, id: "" },
    chosen = new Set(edges),
    at = events.flatMap((event, index) =>
      event.type === "message" && chosen.has(event.id) ? [index] : [],
    );
  if (!at.length || at.length < chosen.size || !FRAGMENTS.includes(kind)) return none;
  let first = at[0],
    last = at.at(-1)!;
  // The statement that creates or destroys a participant belongs to the message below it.
  if (["create", "destroy"].includes(events[first - 1]?.type)) first--;
  let depth = 0;
  for (let index = first; index <= last; index++) {
    const event = events[index];
    if (event.type === "message" && !chosen.has(event.id)) return none;
    if (event.type === "start") depth++;
    else if (event.type === "end" && --depth < 0) return none;
    else if (event.type === "else" && !depth) return none;
  }
  // The fragments that open in the run close with it.
  for (; depth && events[last + 1]?.type === "end"; depth--) last++;
  if (depth) return none;
  const open = events[first].line - 1,
    close = events[last].line - 1,
    indent = indentOf(lines[open]),
    text = textOf(label),
    step = deeper(indent).slice(indent.length);
  for (let index = open; index <= close; index++)
    if (lines[index].trim()) lines[index] = step + lines[index];
  lines.splice(close + 1, 0, `${indent}end`);
  lines.splice(open, 0, `${indent}${kind}${text ? ` ${text}` : ""}`);
  const result = lines.join("\n");
  try {
    const wrapped = parseSequenceDiagram(result),
      made = wrapped.events.find((event) => event.type === "start" && event.line === open + 1),
      boxes = (read: SequenceDiagram) => [...read.participants.values()].map((item) => item.box);
    if (!made || !("id" in made) || boxes(wrapped).join() !== boxes(diagram).join()) return none;
    return { source: result, id: made.id };
  } catch {
    return none;
  }
}

/**
 * Sets or takes away the activation bar a message opens on its receiver. Without one, the message
 * gets the `+` and the reply to it (the next dashed message from its receiver back to its sender)
 * the `-` that closes the bar; without a reply the bar stays open to the end. With one, both ends
 * go: the `+` of the message or the `activate` line after it, and the `-` or the `deactivate`
 * line that closes the bar. On a message that closes a bar with `-`, that bar goes the same way.
 */
export function toggleActivation(source: string, edge: string): string {
  const diagram = parseSequenceDiagram(source),
    { events } = diagram,
    lines = linesOf(source),
    message = messageOf(diagram, edge);
  if (!message) return source;
  const index = events.indexOf(message),
    pairs = bars(events),
    cut = new Set<number>();
  /** Writes a message with another sign, or drops the statement that stands for one. */
  const sign = (at: number, mark: "+" | "-" | "") => {
    const event = events[at],
      parts = event.type === "message" ? messageParts(lines[event.line - 1]) : null;
    if (!parts) cut.add(event.line - 1);
    else
      lines[event.line - 1] = messageLine(indentOf(lines[event.line - 1]), {
        ...parts,
        sign: parts.sign.replace(/[+-]/, "") + mark,
        text: parts.text?.trim(),
      });
  };
  const next = events[index + 1],
    stated = next?.type === "activate" && next.who === message.to ? index + 1 : -1;
  if (message.activate || stated >= 0) {
    const opener = message.activate ? index : stated,
      closer = pairs.find((pair) => pair[0] === opener)?.[1];
    sign(opener, "");
    if (closer !== undefined) sign(closer, "");
  } else if (message.deactivate) {
    sign(index, "");
    const opener = pairs.find((pair) => pair[1] === index)?.[0];
    if (opener !== undefined) sign(opener, "");
  } else {
    sign(index, "+");
    const reply = events.findIndex(
      (event, at) =>
        at > index &&
        event.type === "message" &&
        event.dashed &&
        event.from === message.to &&
        event.to === message.from &&
        !event.activate &&
        !event.deactivate,
    );
    if (reply >= 0 && message.from !== message.to) sign(reply, "-");
  }
  const result = lines.filter((_, at) => !cut.has(at)).join("\n");
  return parses(result) ? result : source;
}

/** Numbers the messages (`autonumber`, as the first statement) or takes the numbers away. */
export function setAutonumber(source: string, on: boolean): string {
  const lines = linesOf(source),
    statements = scan(source).lines,
    numbering = statements.filter((item) => /^autonumber\b/.test(item.text));
  if (on && numbering.length && !numbering.some((item) => /\boff$/.test(item.text))) return source;
  const cut = new Set(numbering.map((item) => item.line - 1)),
    first = statements.slice(1).find((item) => !/^(title|accTitle|accDescr)\b/.test(item.text)),
    at = first ? first.line - 1 : lines.length,
    result = lines
      .flatMap((line, index) => [
        ...(on && index === at ? [`${topIndent(source, lines)}autonumber`] : []),
        ...(cut.has(index) ? [] : [line]),
      ])
      .concat(on && at >= lines.length ? [`${topIndent(source, lines)}autonumber`] : [])
      .join("\n");
  return parses(result) ? result : source;
}

/**
 * What a removal takes with it, in words: the names of the participants that go, and how many
 * messages, notes, fragments and boxes go with them, as in `Alice, 8 messages, 2 fragments`.
 * Empty when the removal changes nothing.
 */
export function removalSummary(source: string, ids: Iterable<string>): string {
  const before = parseSequenceDiagram(source),
    after = parseSequenceDiagram(removeSequence(source, ids)),
    count = (diagram: SequenceDiagram, type: string) =>
      diagram.events.filter((event) => event.type === type).length,
    lost = (type: string, word: string, size = count(before, type) - count(after, type)) =>
      size > 0 ? [`${size} ${word}${size > 1 ? "s" : ""}`] : [];
  return [
    ...[...before.participants.values()]
      .filter((item) => !after.participants.has(item.id))
      .map((item) => item.label.replace(/<br>/g, " ")),
    ...lost("message", "message"),
    ...lost("note", "note"),
    ...lost("start", "fragment"),
    ...lost("", "box", before.boxes.length - after.boxes.length),
  ].join(", ");
}

/**
 * Sequence diagrams as a structure a canvas edits. The parts are the participants, the boxes that
 * group them, the notes and the fragments, a group each that holds the notes and fragments inside
 * it; the joins are the messages. A fragment is no piece to add: `wrapMessages` frames messages in
 * one, and its kind is `fragment`.
 */
export const sequenceStructure: Structure = {
  pieces: [
    { kind: "participant", name: "Participant", about: "An agent with a lifeline", named: true },
    { kind: "actor", name: "Actor", about: "A human agent with a lifeline", named: true },
    { kind: "box", name: "Box", about: "A group of participants", group: true, named: true },
    {
      kind: "note",
      name: "Note",
      about: "A remark over a participant",
      joins: "after",
      joinsTo: ["participant", "actor"],
      named: true,
    },
  ],
  links: ARROWS.map(([kind, , name]) => ({ kind, name })),
  read(source) {
    const diagram = parseSequenceDiagram(source),
      lines = linesOf(source),
      nodes: StructureNode[] = [],
      boxes = new Set<number>();
    // A box stands before the first participant it holds; one that holds none is not drawn.
    for (const item of diagram.participants.values()) {
      if (item.box !== null && !boxes.has(item.box)) {
        boxes.add(item.box);
        nodes.push({
          id: `box${item.box}`,
          label: diagram.boxes[item.box].label,
          parent: null,
          line: diagram.boxes[item.box].line,
          group: true,
          kind: "box",
        });
      }
      nodes.push({
        id: `head:${item.id}`,
        label: item.label,
        parent: item.box === null ? null : `box${item.box}`,
        line: item.line,
        group: false,
        kind: item.actor ? "actor" : "participant",
      });
    }
    // Notes and fragments in the order of the source, each in the fragment that holds it.
    const open: string[] = [];
    for (const event of diagram.events) {
      if (event.type === "end") open.pop();
      if (event.type !== "note" && event.type !== "start") continue;
      nodes.push({
        id: event.id,
        label: event.type === "note" ? event.text : `${event.kind} ${event.text}`.trim(),
        parent: open.at(-1) ?? null,
        line: event.line,
        group: event.type === "start",
        kind: event.type === "note" ? "note" : "fragment",
      });
      if (event.type === "start") open.push(event.id);
    }
    const edges = diagram.events.flatMap((event): StructureEdge[] => {
      if (event.type !== "message") return [];
      const arrow = messageParts(lines[event.line - 1])?.arrow;
      return [
        {
          id: event.id,
          source: `head:${event.from}`,
          target: `head:${event.to}`,
          label: event.text || undefined,
          line: event.line,
          kind: ARROWS.find(([, text]) => text === arrow)?.[0] ?? "sync",
        },
      ];
    });
    return { nodes, edges };
  },
  add: (source, piece) => addSequencePiece(source, { ...piece, kind: piece.kind as SequencePiece }),
  connect: (source, from, to, kind) => connectSequence(source, from, to, kind).source,
  rename: renameSequence,
  retitle: retitleSequence,
  label: labelMessage,
  relink: relinkMessage,
  remove: (source, ids) => removeSequence(source, ids),
};
