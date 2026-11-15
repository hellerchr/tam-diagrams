/**
 * Editing a sequence diagram source as text: adding participants and boxes, sending, moving and
 * removing messages, naming, the way uml-activity-edit.ts edits flowcharts. Each function returns
 * the source with one change made. A sequence diagram holds one statement a line, so an edit adds,
 * drops or rewrites whole lines; every other line stays as it was. The layout stays automatic.
 *
 * A participant is the node `head:<id>`, as its head is called in the scene, a box of participants
 * the group `box<index>`, a message the edge `m<number>`. Notes, fragments (`alt`, `loop`, ...),
 * activation bars and destruction crosses are no parts: they follow the statements around them.
 */

import type { Structure, StructureEdge, StructureNode } from "./structure.ts";
import { scan } from "./uml.ts";
import { type MessageEvent, parseSequenceDiagram, type SequenceDiagram } from "./uml-sequence.ts";

/** What a canvas adds to a sequence diagram. */
export type SequencePiece = "participant" | "actor" | "box";

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

/** A message line written from its pieces; without text, without the colon. */
const messageLine = (indent: string, parts: MessageParts) =>
  `${indent}${parts.from}${parts.arrow}${parts.sign}${parts.to}${parts.text ? `: ${parts.text}` : ""}`;

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

/**
 * Adds a participant or an actor after the last one declared, or at the top when participants are
 * only named by messages; inside a box when one is given. A box comes with a first participant,
 * since a box without one is not drawn. Returns the id of the node it got.
 */
export function addSequencePiece(
  source: string,
  piece: { kind: SequencePiece; label?: string; parent?: string | null },
): { source: string; id: string } {
  const diagram = parseSequenceDiagram(source),
    lines = linesOf(source),
    statements = scan(source).lines;
  const id = freshId(diagram, piece.kind === "actor" ? "actor" : "participant"),
    label = textOf(piece.label ?? "");
  const parent = piece.kind === "box" ? null : boxOf(diagram, piece.parent);
  let at: number, indent: string;
  if (parent !== null) {
    const open = diagram.boxes[parent].line - 1;
    at = boxEnd(source, diagram, open + 1);
    const member = declarations(source).findLast((item) => item.index > open && item.index < at);
    indent = member ? indentOf(lines[member.index]) : deeper(indentOf(lines[open]));
  } else {
    const last = declarations(source).findLast((item) => !item.created);
    if (last) {
      // After the box the last declaration stands in, so that the new one stands in none.
      const around = diagram.boxes
        .map((box) => ({ open: box.line - 1, end: boxEnd(source, diagram, box.line) }))
        .find((box) => box.open < last.index && last.index < box.end);
      at = (around ? around.end : last.index) + 1;
      indent = indentOf(lines[around ? around.open : last.index]);
    } else {
      // Before the first statement that says something of the sequence.
      const first = statements
        .slice(1)
        .find((item) => !/^(title|autonumber|accTitle|accDescr)\b/.test(item.text));
      at = first ? first.line - 1 : (statements[0]?.line ?? lines.length);
      indent = first ? indentOf(lines[first.line - 1]) : topIndent(source, lines);
    }
  }
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

/**
 * Sends a message from one participant to another: after the message with the edge id `after`, in
 * the fragment that one stands in, or else as the last statement of the diagram, in no fragment.
 * Its text is `message` unless a label is given.
 */
export function insertMessage(
  source: string,
  from: string,
  to: string,
  options: { kind?: string; label?: string; after?: string } = {},
): string {
  const diagram = parseSequenceDiagram(source),
    lines = linesOf(source),
    sender = participantOf(diagram, from),
    receiver = participantOf(diagram, to);
  if (sender === null || receiver === null) return source;
  const arrow = ARROWS.find(([kind]) => kind === (options.kind ?? "sync"))?.[1] ?? "->>",
    parts = {
      from: sender,
      arrow,
      sign: "",
      to: receiver,
      text: textOf(options.label ?? "message"),
    };
  const anchor = options.after ? messageOf(diagram, options.after) : undefined;
  if (anchor) {
    lines.splice(anchor.line, 0, messageLine(indentOf(lines[anchor.line - 1]), parts));
    return lines.join("\n");
  }
  let at = lines.length;
  while (at > 0 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, messageLine(topIndent(source, lines), parts));
  return lines.join("\n");
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
 * Gives a participant or a box another name. A participant keeps its id, which the messages name
 * it by: the name is the alias of its declaration (`participant id as Name`), and a participant
 * that only messages name is declared where it first stands, so the columns keep their order. An
 * empty name removes the alias, which leaves the id as the name.
 */
export function renameSequence(source: string, id: string, label: string): string {
  const diagram = parseSequenceDiagram(source),
    lines = linesOf(source),
    text = textOf(label);
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

/** Gives a message another text; an empty one removes it, which this parser reads as a message without text. */
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
 * Removes participants with their messages, boxes with their participants, and messages, by id.
 * With a participant go its declarations, its activations, its destruction and the notes on it
 * alone; a note over two keeps the other. What a removal would leave without sense goes too:
 * the other end of an activation bar whose one end is removed (the `+` or `-` of a message, or the
 * `activate` or `deactivate` line), a fragment that held something removed and holds no message or
 * note any more, a box that keeps no participant, the `create` of a participant that no message
 * creates any more, and a `destroy` that no message follows.
 */
export function removeSequence(source: string, ids: Iterable<string>): string {
  const diagram = parseSequenceDiagram(source),
    lines = linesOf(source),
    named = new Set(ids),
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
      if (!left.length) removed.add(index);
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
  const opened: number[] = [];
  events.forEach((event, index) => {
    if (event.type === "start") opened.push(index);
    if (event.type !== "end") return;
    const start = opened.pop()!,
      inside = events.slice(start + 1, index).map((_, offset) => start + 1 + offset);
    const border = (at: number) => ["start", "else", "end"].includes(events[at].type);
    if (
      inside.some((at) => removed.has(at) && !border(at)) &&
      inside.every((at) => removed.has(at) || border(at))
    )
      for (let line = events[start].line - 1; line < event.line; line++) dropped.add(line);
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
  // Bottom up, so the lines above keep their numbers.
  for (let index = lines.length - 1; index >= 0; index--) {
    if (dropped.has(index)) lines.splice(index, 1);
    else if (rewritten.has(index)) lines[index] = rewritten.get(index)!;
  }
  return lines.join("\n");
}

/** Sequence diagrams as a structure a canvas edits. */
export const sequenceStructure: Structure = {
  pieces: [
    { kind: "participant", name: "Participant", about: "An agent with a lifeline", named: true },
    { kind: "actor", name: "Actor", about: "A human agent with a lifeline", named: true },
    { kind: "box", name: "Box", about: "A group of participants", group: true, named: true },
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
  connect: (source, from, to, kind) => insertMessage(source, from, to, { kind }),
  rename: renameSequence,
  label: labelMessage,
  relink: relinkMessage,
  remove: (source, ids) => removeSequence(source, ids),
};
