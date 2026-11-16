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
  agent: "active structure element: a service, a process",
  human: "human agent",
  storage: "passive structure element that stores data",
  component: "design level: a unit with provided and required interfaces",
  subsystem: "design level: a group of components",
  class: "design level: a class",
  package: "a package of a package diagram",
  group: "a frame around elements",
  note: "a remark, attached to an element with -.-",
};

/**
 * The kinds the editor offers: block diagrams are drawn at TAM's conceptual level. A source that
 * declares components, subsystems, classes or packages still reads and draws.
 */
const CONCEPTUAL = new Set(["agent", "human", "storage", "group", "note"]);

/** Whether an element of a kind acts, keeps information, or is a person; a note does none of these. */
const acts = (kind: string) => kind !== "storage" && kind !== "package" && kind !== "note";
const talks = (kind: string) => kind === "agent" || kind === "human" || kind === "group";
const keeps = (kind: string) => kind === "storage" || kind === "group";

/** The connections of the notation: what is typed after the first element, who can start one, and what it says. */
const CONNECTIONS: { text: string; about: string; from: (kind: string) => boolean }[] = [
  { text: "-- calls --> ", about: "request/response channel", from: talks },
  { text: "-- sends data --> ", about: "data flow channel", from: talks },
  { text: "<-- calls --> ", about: "bidirectional request/response channel", from: talks },
  { text: "--- ", about: "channel without direction", from: talks },
  { text: "-- reads --> ", about: "read access to a storage", from: acts },
  { text: "-- writes --> ", about: "write access to a storage", from: acts },
  { text: "-- reads/writes --> ", about: "modifying (read/write) access", from: acts },
  { text: "-. pointer .-> ", about: "reference to another storage", from: keeps },
  { text: "-. create .-> ", about: "creates at run time", from: acts },
  { text: "-. generate .-> ", about: "generates", from: acts },
];

/** The dotted line that attaches a note to an element: from a note, or to one where the diagram has notes. */
const ANCHOR = { text: "-.- ", about: "attaches a note to an element" };

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

/** Options in the order given, not of the alphabet: the first is the best, each next one a step below it. */
export const ranked = (options: Completion[], top: number): Completion[] =>
  options.map((item, index) => ({ ...item, boost: Math.max(top - index, -99) }));

/** The elements of a source as options, in the order the source declares them, below the statements of its syntax. */
export const inOrder = (options: Completion[]): Completion[] =>
  options.map((item, index) => ({ ...item, boost: -Math.min(index, 60) }));

/**
 * An option that writes a text with fields to fill in (`${name}`): Tab goes from field to field,
 * and from the last one to the end of the text, unless the text ends with that field. A text
 * without fields is written as it is, with the cursor behind it.
 */
export function filled(template: string, completion: Completion): Completion {
  if (!template.includes("${"))
    return template === completion.label ? completion : { ...completion, apply: template };
  // A stop right behind a field would take in what is typed at the end of that field. Behind a
  // block, the last stop is a line of its own: what is typed next is the next statement.
  return snippetCompletion(
    /\$\{[^{}]*\}$/.test(template)
      ? template
      : /\n(end|\})$/.test(template)
        ? `${template}\n\${}`
        : `${template}\${}`,
    completion,
  );
}

/** The directions a diagram can be laid out in, the usual ones first. */
export const DIRECTIONS: Completion[] = ranked(
  [
    option("TB", "constant", "top to bottom"),
    option("LR", "constant", "left to right"),
    option("BT", "constant", "bottom to top"),
    option("RL", "constant", "right to left"),
  ],
  9,
);

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
    // The statements of the notation first, then the elements in the order of the source.
    return result(at(match[1].length), [
      ...ranked(
        [
          ...ELEMENT_KINDS.filter((kind) => CONCEPTUAL.has(kind)).map((kind) =>
            filled(
              kind === "group"
                ? "group {\n\t${}\n}"
                : kind === "note"
                  ? "note ${id}[${Text}]"
                  : `${kind} \${id}[\${Name}]`,
              {
                label: kind,
                type: `declare-${kind}`,
                detail: ABOUT[kind],
              },
            ),
          ),
          option("title", "keyword", "the diagram's title", "title "),
          option("direction", "keyword", "TB, LR, BT or RL", "direction "),
        ],
        30,
      ),
      ...inOrder(known.map(element)),
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
    const anchors =
      kind === "note" || known.some((item) => item.kind === "note")
        ? [{ ...ANCHOR, from: () => true }]
        : [];
    return result(
      at(match[2].length),
      // In the order of the notation, not of the alphabet.
      ranked(
        [...CONNECTIONS, ...anchors]
          .filter((item) => item.from(kind))
          .map((item) =>
            filled(item.text, {
              label: item.text.replace(/\$\{(\w+)\}/g, "$1").trim(),
              type: "connection",
              detail: item.about,
            }),
          ),
        50,
      ),
      // Behind a whole arrow the elements it reaches are offered instead.
      /^(?!.*(-->|---|\.->|-\.-)\s)[-<.\w/ ]*$/,
    );
  }
  const source = before.match(/^(\w+)/)?.[1],
    others = known.filter((item) => item.id !== source),
    reached = (can: (kind: string) => boolean) =>
      inOrder(others.filter((item) => can(item.kind)).map(element));
  // After the arrow: the elements the connection reaches.
  if ((match = before.match(/(?:--|<--)\s*([^-]*?)\s*(?:-->|---)\s*(?:\w+\s*&\s*)*(\w*)$/))) {
    const can = reaches(match[1].trim().toLowerCase());
    return result(at(match[2].length), reached(can));
  }
  if ((match = before.match(/-\.\s*(\w+)\s*\.->\s*(?:\w+\s*&\s*)*(\w*)$/))) {
    const can = reaches(match[1].toLowerCase());
    return result(at(match[2].length), reached(can));
  }
  // After `-.-`: an element reaches the notes, a note the elements.
  if ((match = before.match(/^\w+\s+-\.-\s*(\w*)$/))) {
    const note = source !== undefined && byId.get(source)?.kind === "note";
    return result(
      at(match[1].length),
      reached((kind) => (kind === "note") !== note),
    );
  }
  if ((match = before.match(/^\w+\s+---\s*(\w*)$/)))
    return result(at(match[1].length), reached(talks));
  // Inside a connection: its word.
  if ((match = before.match(/(?:--|<--)\s+([\w/ ]*)$/))) {
    const kind = source ? byId.get(source)?.kind : undefined;
    const words = CONNECTIONS.filter(
      (item) => item.text.startsWith("-- ") && (!kind || item.from(kind)),
    ).map((item) => item.text.replace(/^-- /, "").replace(/\s*\$\{IName\}/, ""));
    return result(
      at(match[1].length),
      ranked(
        words.map((text) => option(text.replace(/\s*-->\s*$/, ""), "connection", undefined, text)),
        50,
      ),
      /^[\w/ ]*$/,
    );
  }
  if ((match = before.match(/-\.\s*(\w*)$/)))
    return result(
      at(match[1].length),
      ranked(
        ["use", "import", "create", "generate", "pointer"].map((word) =>
          option(word, "connection", undefined, `${word} .-> `),
        ),
        9,
      ),
    );
  if ((match = before.match(/&\s*(\w*)$/)))
    return result(at(match[1].length), inOrder(others.map(element)));
  return null;
}
