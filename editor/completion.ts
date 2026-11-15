/**
 * What the source pane offers while a block diagram is typed: at the start of a line the element
 * kinds and the ids to connect from; after an id the connections its element can make; inside a
 * connection its words; after the arrow the elements it can reach.
 */

import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { COLORS, ELEMENT_KINDS } from "../src/tam.ts";

/** An element of the diagram, as far as completing needs it. */
export interface Known {
  id: string;
  kind: string;
  label: string;
}

const ABOUT: Record<string, string> = {
  agent: "does something: a service, a process",
  human: "a person who uses the system",
  storage: "keeps information",
  component: "design level: a part with interfaces",
  subsystem: "design level: a group of components",
  class: "design level: a class",
  package: "a package of a package diagram",
  group: "a frame around elements",
};

/** Whether an element of a kind acts, keeps information, or is a person. */
const acts = (kind: string) => kind !== "storage" && kind !== "package";
const talks = (kind: string) => kind === "agent" || kind === "human" || kind === "group";
const keeps = (kind: string) => kind === "storage" || kind === "group";
const design = (kind: string) => kind === "component" || kind === "subsystem" || kind === "class";

/** The connections of the notation: what is typed after the first element, who can start one, and what it says. */
const CONNECTIONS: { text: string; about: string; from: (kind: string) => boolean }[] = [
  { text: "-- calls --> ", about: "request", from: talks },
  { text: "-- sends data --> ", about: "data flow", from: talks },
  { text: "<-- calls --> ", about: "requests both ways", from: talks },
  { text: "--- ", about: "channel without direction", from: talks },
  { text: "-- reads --> ", about: "read access to a storage", from: acts },
  { text: "-- writes --> ", about: "write access to a storage", from: acts },
  { text: "-- reads/writes --> ", about: "read and write access", from: acts },
  {
    text: "-- requires ${IName} --> ",
    about: "requires the interface of",
    from: (kind) => acts(kind) && kind !== "human",
  },
  { text: "-- delegates --> ", about: "passes on to a part", from: acts },
  {
    text: "provides ${IName}",
    about: "offers an interface",
    from: (kind) => acts(kind) && kind !== "human",
  },
  {
    text: "requires ${IName}",
    about: "needs an interface",
    from: (kind) => acts(kind) && kind !== "human",
  },
  { text: "-. pointer .-> ", about: "a storage refers to another", from: keeps },
  { text: "-. create .-> ", about: "creates at run time", from: acts },
  { text: "-. generate .-> ", about: "generates", from: acts },
  { text: "-. use .-> ", about: "dependency", from: (kind) => design(kind) || kind === "package" },
  { text: "-. import .-> ", about: "package import", from: (kind) => kind === "package" },
];

/** Which elements a connection word reaches. */
function reaches(word: string): (kind: string) => boolean {
  if (/^(reads|writes|reads\/writes|pointer)\b/.test(word)) return keeps;
  if (/^(calls|sends data)\b/.test(word) || word === "") return talks;
  if (/^requires\b/.test(word)) return (kind) => acts(kind) && kind !== "human";
  if (/^(create|generate|delegates)\b/.test(word)) return acts;
  return () => true;
}

/** An option of a completion list: what is shown, the kind its drawing stands for, what it is, and the text it writes when that is not its label. */
export const option = (
  label: string,
  type: string,
  detail?: string,
  apply?: string,
): Completion => ({
  label,
  type,
  ...(detail ? { detail } : {}),
  ...(apply ? { apply } : {}),
});

/** The directions a diagram can be laid out in. */
export const DIRECTIONS: Completion[] = [
  option("TB", "constant", "top to bottom"),
  option("LR", "constant", "left to right"),
  option("BT", "constant", "bottom to top"),
  option("RL", "constant", "right to left"),
];

/** The completions at the cursor of a block diagram source; null where nothing is to offer. */
export function completeTam(context: CompletionContext, known: Known[]): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos),
    before = line.text.slice(0, context.pos - line.from).replace(/^\s+/, ""),
    at = (length: number) => context.pos - length;
  const byId = new Map(known.map((item) => [item.id, item]));
  const element = (item: Known) =>
    option(item.id, item.kind, item.label.replace(/<br\s*\/?>/gi, " ") || item.kind);
  const result = (from: number, options: Completion[], validFor = /^[\w/]*$/) =>
    options.length ? { from, options, validFor } : null;
  let match: RegExpMatchArray | null;

  // The start of a line: a declaration, a header line, or the element a connection starts at.
  if ((match = before.match(/^(\w*)$/))) {
    if (!match[1] && !context.explicit) return null;
    return result(at(match[1].length), [
      ...ELEMENT_KINDS.map((kind) =>
        snippetCompletion(kind === "group" ? "group {\n\t${}\n}" : `${kind} \${id}[\${Name}]`, {
          label: kind,
          type: `declare-${kind}`,
          detail: ABOUT[kind],
          boost: 2,
        }),
      ),
      option("title", "keyword", "the diagram's title", "title "),
      option("direction", "keyword", "TB, LR, BT or RL", "direction "),
      option("level", "keyword", "conceptual or design", "level "),
      ...known.map(element),
    ]);
  }
  if ((match = before.match(/^direction\s+(\w*)$/))) return result(at(match[1].length), DIRECTIONS);
  if ((match = before.match(/^level\s+(\w*)$/)))
    return result(at(match[1].length), [
      option("conceptual", "constant", "agents, storages, channels"),
      option("design", "constant", "components and interfaces too"),
    ]);
  if ((match = before.match(/:::(\w*)$/)))
    return result(
      at(match[1].length),
      [...COLORS].map((color) => option(color, `color-${color}`)),
    );

  // After the element a connection starts at: the connections it can make.
  if (
    (match = before.match(/^(\w+(?:\s*&\s*\w+)*)\s+([-<.\w]*)$/)) &&
    byId.has(match[1].split(/\s*&\s*/)[0])
  ) {
    const { kind } = byId.get(match[1].split(/\s*&\s*/)[0])!;
    return result(
      at(match[2].length),
      CONNECTIONS.filter((item) => item.from(kind)).map((item, index) =>
        snippetCompletion(item.text, {
          label: item.text.replace(/\$\{(\w+)\}/g, "$1").trim(),
          type: "connection",
          detail: item.about,
          // In the order of the notation, not of the alphabet.
          boost: 50 - index,
        }),
      ),
      /^[-<.\w/ ]*$/,
    );
  }
  const source = before.match(/^(\w+)/)?.[1],
    others = known.filter((item) => item.id !== source);
  // After the arrow: the elements the connection reaches.
  if ((match = before.match(/(?:--|<--)\s*([^-]*?)\s*(?:-->|---)\s*(?:\w+\s*&\s*)*(\w*)$/))) {
    const can = reaches(match[1].trim().toLowerCase());
    return result(at(match[2].length), others.filter((item) => can(item.kind)).map(element));
  }
  if ((match = before.match(/-\.\s*(\w+)\s*\.->\s*(?:\w+\s*&\s*)*(\w*)$/))) {
    const can = reaches(match[1].toLowerCase());
    return result(at(match[2].length), others.filter((item) => can(item.kind)).map(element));
  }
  if ((match = before.match(/^\w+\s+---\s*(\w*)$/)))
    return result(at(match[1].length), others.filter((item) => talks(item.kind)).map(element));
  // Inside a connection: its word.
  if ((match = before.match(/(?:--|<--)\s+([\w/ ]*)$/))) {
    const kind = source ? byId.get(source)?.kind : undefined;
    const words = CONNECTIONS.filter(
      (item) => item.text.startsWith("-- ") && (!kind || item.from(kind)),
    ).map((item) => item.text.replace(/^-- /, "").replace(/\s*\$\{IName\}/, ""));
    return result(
      at(match[1].length),
      words
        .map((text, index) => option(text.replace(/\s*-->\s*$/, ""), "connection", undefined, text))
        .map((item, index) => ({ ...item, boost: 50 - index })),
      /^[\w/ ]*$/,
    );
  }
  if ((match = before.match(/-\.\s*(\w*)$/)))
    return result(
      at(match[1].length),
      ["use", "import", "create", "generate", "pointer"].map((word) =>
        option(word, "connection", undefined, `${word} .-> `),
      ),
    );
  if ((match = before.match(/&\s*(\w*)$/))) return result(at(match[1].length), others.map(element));
  return null;
}
