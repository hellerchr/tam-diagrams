/** Sequence diagrams, and the column (lifeline) solver they lay out with. */

import type { MarkerKind } from "./markers.ts";
import { accessibilityLines, labelText, type Level, prepare, UmlError, unsupported } from "./uml.ts";
import { checkActivations } from "./uml-sequence-activation.ts";

/**
 * Sequence diagrams from Mermaid `sequenceDiagram` sources, drawn as in the TAM flyer and standard
 * (2.2.3): agents' lifelines under boxes with underlined names (human agents as stick figures),
 * synchronous messages with filled heads, dashed returns with open heads, grey activation bars
 * that turn white while an agent waits for an answer ("no focus of control"), notes, combined
 * fragments in frames with a keyword tab, object creation and destruction. Like swimlanes, a lane
 * layout (the column solver below): one column per agent, the messages in rows down the columns.
 */

interface Participant {
  id: string;
  label: string;
  actor: boolean;
  box: number | null;
  line: number;
  created: boolean;
  destroyed: boolean;
}

export interface MessageEvent {
  type: "message";
  id: string;
  from: string;
  to: string;
  text: string;
  dashed: boolean;
  head: MarkerKind | null;
  tail: MarkerKind | null;
  activate: boolean;
  deactivate: boolean;
  number?: number;
  line: number;
}

type SequenceEvent =
  | MessageEvent
  | { type: "activate" | "deactivate" | "create" | "destroy"; who: string; line: number }
  | {
      type: "note";
      id: string;
      placement: "left" | "right" | "over";
      who: string[];
      text: string;
      line: number;
    }
  | { type: "start"; id: string; kind: string; text: string; line: number }
  | { type: "else"; id: string; kind: string; text: string; line: number }
  | { type: "end"; id: string; line: number };

export interface SequenceDiagram {
  title?: string;
  level?: Level;
  participants: Map<string, Participant>;
  boxes: { label: string; line: number }[];
  events: SequenceEvent[];
}

const ARROWS: [string, Pick<MessageEvent, "dashed" | "head" | "tail">][] = [
  ["<<-->>", { dashed: true, head: "open", tail: "open" }],
  ["<<->>", { dashed: false, head: "arrow", tail: "arrow" }],
  ["-->>", { dashed: true, head: "open", tail: null }],
  ["->>", { dashed: false, head: "arrow", tail: null }],
  ["--x", { dashed: true, head: "cross", tail: null }],
  ["-x", { dashed: false, head: "cross", tail: null }],
  ["--)", { dashed: true, head: "open", tail: null }],
  ["-)", { dashed: false, head: "open", tail: null }],
  ["-->", { dashed: true, head: null, tail: null }],
  ["->", { dashed: false, head: null, tail: null }],
];

const MESSAGE = new RegExp(
  `^(.+?)\\s*(${ARROWS.map(([arrow]) => arrow.replace(/[()]/g, "\\$&")).join("|")})\\s*([+-]?)\\s*([^:]+?)\\s*(?::(.*))?$`,
);

const BLOCKS = new Set(["loop", "alt", "opt", "par", "critical", "break", "rect"]);

const BRANCHES: Record<string, string[]> = { else: ["alt"], and: ["par"], option: ["critical"] };

const COLOR =
  /^(rgba?\([^)]*\)|#[0-9a-f]{3,8}|transparent|aqua|black|blue|fuchsia|gray|grey|green|lime|maroon|navy|olive|purple|red|silver|teal|white|yellow|orange|pink|lightblue|lightgreen|lightgrey|lightgray|lightyellow|beige|ivory|lavender|wheat|tan|khaki|coral|salmon|gold|cyan|magenta)\b\s*/i;

export function parseSequenceDiagram(source: string): SequenceDiagram {
  const prepared = prepare(source);
  if (prepared.kind !== "sequence")
    throw new UmlError(prepared.headerLine, "Not a sequence diagram.");
  const diagram: SequenceDiagram = {
    title: prepared.title,
    level: prepared.level,
    participants: new Map(),
    boxes: [],
    events: [],
  };
  const blocks: { id: string; kind: string; line: number }[] = [];
  let box: number | null = null,
    boxLine = 0,
    numbering: { next: number; step: number } | null = null,
    blockCount = 0,
    notes = 0,
    messages = 0;
  let creating: string | null = null;

  const participant = (raw: string, line: number, actor = false, label?: string): Participant => {
    const id = raw.trim();
    let item = diagram.participants.get(id);
    if (!item) {
      if (diagram.participants.size >= 40)
        throw new UmlError(line, "Sequence diagrams are limited to 40 participants.");
      item = { id, label: id, actor, box, line, created: false, destroyed: false };
      diagram.participants.set(id, item);
    }
    if (label !== undefined) item.label = label;
    return item;
  };

  const accessibility = accessibilityLines();
  for (const { text, line } of prepared.lines) {
    if (accessibility(text)) continue;
    let match: RegExpMatchArray | null;
    if ((match = text.match(/^title\s*:?\s+(.+)$/))) {
      diagram.title = labelText(match[1]);
      continue;
    }
    if (/^(links?|properties|details)\s/.test(text)) continue;
    if ((match = text.match(/^autonumber(?:\s+(off|\d+)(?:\s+(\d+))?)?$/))) {
      numbering =
        match[1] === "off"
          ? null
          : { next: match[1] ? Number(match[1]) : 1, step: match[2] ? Number(match[2]) : 1 };
      continue;
    }
    if ((match = text.match(/^(create\s+)?(participant|actor)\s+(.+)$/))) {
      const spec = match[3].trim();
      if (/@\{/.test(spec)) unsupported(line, 'Participant types (`@{ "type": ... }`)');
      const alias = spec.match(/^(.+?)\s+as\s+(.+)$/);
      const item = participant(
        alias ? alias[1] : spec,
        line,
        match[2] === "actor",
        alias ? labelText(alias[2]) : undefined,
      );
      item.actor = match[2] === "actor";
      if (match[1]) {
        item.created = true;
        creating = item.id;
        diagram.events.push({ type: "create", who: item.id, line });
      }
      continue;
    }
    if ((match = text.match(/^destroy\s+(.+)$/))) {
      const item = participant(match[1], line);
      item.destroyed = true;
      diagram.events.push({ type: "destroy", who: item.id, line });
      continue;
    }
    if ((match = text.match(/^box(?:\s+(.*))?$/))) {
      if (box !== null) throw new UmlError(line, "Boxes cannot be nested.");
      const label = (match[1] ?? "").replace(COLOR, "").trim();
      diagram.boxes.push({ label: labelText(label), line });
      box = diagram.boxes.length - 1;
      boxLine = line;
      continue;
    }
    if ((match = text.match(/^(activate|deactivate)\s+(.+)$/))) {
      const item = participant(match[2], line);
      diagram.events.push({ type: match[1] as "activate" | "deactivate", who: item.id, line });
      continue;
    }
    if ((match = text.match(/^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i))) {
      const who = match[2].split(",").map((name) => participant(name, line).id);
      if (who.length > 2 || (who.length > 1 && !/^over$/i.test(match[1])))
        throw new UmlError(line, "A note spans at most two participants, with `over`.");
      diagram.events.push({
        type: "note",
        id: `note${++notes}`,
        placement: match[1].toLowerCase().split(" ")[0] as "left" | "right" | "over",
        who,
        text: labelText(match[3]),
        line,
      });
      continue;
    }
    if (text === "end") {
      if (blocks.length) {
        diagram.events.push({ type: "end", id: blocks.pop()!.id, line });
        continue;
      }
      if (box !== null) {
        box = null;
        continue;
      }
      throw new UmlError(line, "Unmatched `end`.");
    }
    if (
      (match = text.match(/^(\w+)(?:\s+(.*))?$/)) &&
      (BLOCKS.has(match[1]) || BRANCHES[match[1]]) &&
      !MESSAGE.test(text)
    ) {
      const [, keyword, rest = ""] = match;
      if (BRANCHES[keyword]) {
        const open = blocks.at(-1);
        if (!open || !BRANCHES[keyword].includes(open.kind))
          throw new UmlError(
            line,
            `\`${keyword}\` belongs inside ${BRANCHES[keyword].map((kind) => `\`${kind}\``).join(" or ")}.`,
          );
        diagram.events.push({
          type: "else",
          id: open.id,
          kind: keyword,
          text: labelText(rest),
          line,
        });
        continue;
      }
      const id = `block${++blockCount}`;
      blocks.push({ id, kind: keyword, line });
      diagram.events.push({
        type: "start",
        id,
        kind: keyword,
        text: keyword === "rect" ? "" : labelText(rest),
        line,
      });
      continue;
    }
    if (/^par_over\b/.test(text)) unsupported(line, "`par_over`");
    if ((match = text.match(MESSAGE))) {
      const [, from, arrow, sign, to, message = ""] = match;
      if (/[|\\/]/.test(arrow + to.slice(0, 2))) unsupported(line, "Half arrows");
      const spec = ARROWS.find(([item]) => item === arrow)![1];
      const source = participant(from, line),
        target = participant(to, line);
      const event: MessageEvent = {
        type: "message",
        id: `m${++messages}`,
        from: source.id,
        to: target.id,
        text: labelText(message),
        ...spec,
        activate: sign === "+",
        deactivate: sign === "-",
        line,
      };
      if (numbering) {
        event.number = numbering.next;
        numbering.next += numbering.step;
      }
      diagram.events.push(event);
      if (creating && (target.id === creating || source.id === creating)) creating = null;
      continue;
    }
    if (/[|\\/]-|-[|\\/]/.test(text)) unsupported(line, "Half arrows");
    throw new UmlError(line, `Cannot read \`${text}\`.`);
  }
  if (blocks.length)
    throw new UmlError(blocks.at(-1)!.line, `\`${blocks.at(-1)!.kind}\` is missing its \`end\`.`);
  if (box !== null) throw new UmlError(boxLine, "The box is missing its `end`.");
  if (diagram.level === "conceptual") {
    const created = diagram.events.find(
      (event) => event.type === "create" || event.type === "destroy",
    );
    if (created)
      throw new UmlError(
        created.line,
        `Object ${created.type === "create" ? "creation" : "destruction"} belongs to the design level in TAM.`,
      );
  }
  checkActivations(diagram.events);
  return diagram;
}
