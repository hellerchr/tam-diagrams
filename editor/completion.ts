/**
 * What the source pane offers while a block diagram is typed, at every place of a line: at its
 * start the element kinds, the header lines and the ids to connect from; after an id the
 * connections its element can make; inside a connection its words; after the arrow the elements it
 * can reach; behind a declaration what may follow it (a color, a block, several, a connection
 * from it on the next line); inside `:::` the colors.
 */

import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  pickedCompletion,
  snippetCompletion,
} from "@codemirror/autocomplete";
import { COLORS, ELEMENT } from "../src/tam.ts";

/** An element of the diagram, as far as completing needs it: with the element that holds it, where known. */
export interface Known {
  id: string;
  kind: string;
  label: string;
  parent?: string | null;
}

const ABOUT: Record<string, string> = {
  agent: "active structure element: a service, a process",
  human: "human agent",
  storage: "passive structure element that stores data",
  group: "a frame around elements",
  note: "a remark, attached to an element with -.-",
};

/** Whether an element of a kind acts, keeps information, or is a person; a note does none of these. */
const acts = (kind: string) => kind !== "storage" && kind !== "package" && kind !== "note";
const talks = (kind: string) => kind === "agent" || kind === "human" || kind === "group";
const keeps = (kind: string) => kind === "storage" || kind === "group";

/**
 * The kinds of element a block diagram declares, as the editor offers them: the design level the
 * parser also reads is not offered.
 */
const KINDS = ["agent", "human", "storage", "group", "note"];

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
  if (/^(create|generate)\b/.test(word)) return acts;
  return () => true;
}

/** The element a declaration declares, held by an element or by none. */
const declared = (match: RegExpMatchArray, parent: string | null): Known => {
  const [, kind, id, bracketed, quoted] = match;
  return { id, kind, label: (bracketed ?? quoted)?.trim() || id, parent };
};

/**
 * The elements a block diagram's text declares, in its order, with the element that holds each:
 * what was typed is offered before the picture of it is laid out. The line at `skip` (from 1) is
 * the one being typed, whose declaration is not finished.
 */
function declaredIn(text: string, skip = 0): Known[] {
  const found: Known[] = [],
    open: (string | null)[] = [];
  text.split("\n").forEach((line, index) => {
    const statement = line.replace(/%%.*$/, "").trim();
    if (statement === "}") {
      open.pop();
      return;
    }
    const match = statement.match(ELEMENT);
    if (!match) return;
    const [, , id, , , , brace] = match;
    if (id && index + 1 !== skip) found.push(declared(match, open.at(-1) ?? null));
    // A block opened on the line holds what follows until its `}`; a group without an id holds for its container.
    if (brace === "{") open.push(id ?? open.at(-1) ?? null);
  });
  return found;
}

/** Whether one element holds another, at any depth. */
function holds(byId: Map<string, Known>, outer: string, id: string): boolean {
  for (let at = byId.get(id)?.parent; at; at = byId.get(at)?.parent) if (at === outer) return true;
  return false;
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

/** A step of completing: what to offer at a place, null for nothing, undefined where the place is not its to complete. */
export type Step<Place> = (place: Place) => CompletionResult | null | undefined;

/** A step taken where the text of the line before the cursor matches a pattern. */
export const matching =
  <Place extends { before: string }>(
    pattern: RegExp,
    complete: (match: RegExpMatchArray, place: Place) => CompletionResult | null | undefined,
  ): Step<Place> =>
  (place) => {
    const match = place.before.match(pattern);
    return match ? complete(match, place) : undefined;
  };

/** What the first step that completes a place offers, the steps tried in their order; null where none does. */
export function firstOffer<Place>(steps: Step<Place>[], place: Place): CompletionResult | null {
  for (const step of steps) {
    const found = step(place);
    if (found !== undefined) return found;
  }
  return null;
}

/** The directions a diagram can be laid out in, the usual ones first. */
export const DIRECTIONS: Completion[] = ranked(
  [option("TB", "constant", "top to bottom"), option("LR", "constant", "left to right")],
  9,
);

/** The place of the cursor in a block diagram source, as far as completing needs it. */
interface TamPlace {
  context: CompletionContext;
  /** The text of the line before the cursor, without its indentation. */
  before: string;
  /** The indentation of the line. */
  indent: string;
  /** The elements on offer: what the text declares as it was typed, and what the picture knows besides. */
  known: Known[];
  byId: Map<string, Known>;
  /** The elements a connection on the line starts at, joined with `&`. */
  sources: string[];
  /** The first of them, which says what the connection can be. */
  source: string | undefined;
}

const tamResult = (from: number, options: Completion[], validFor = /^[\w/]*$/) =>
  options.length ? { from, options, validFor } : null;

/** The position a number of characters before the cursor. */
const at = (place: TamPlace, length: number) => place.context.pos - length;

const tamElement = (item: Known) =>
  option(item.id, item.kind, item.label.replace(/<br\s*\/?>/gi, " ") || item.kind);

/** The kind of the element a connection on the line starts at; undefined before there is one. */
const sourceKind = (place: TamPlace) =>
  place.source ? place.byId.get(place.source)?.kind : undefined;

/** What a declaration of a kind writes, with the fields to fill in, where it is not `kind id[Name]`. */
const TEMPLATES: Record<string, string> = {
  group: "group {\n\t${}\n}",
  note: "note ${id}[${Text}]",
};

/** The statements of the notation: the declarations and the header lines. */
const TAM_STATEMENTS = [
  ...KINDS.map((kind) =>
    filled(TEMPLATES[kind] ?? `${kind} \${id}[\${Name}]`, {
      label: kind,
      type: `declare-${kind}`,
      detail: ABOUT[kind],
    }),
  ),
  option("title", "keyword", "the diagram's title", "title "),
  option("direction", "keyword", "TB or LR", "direction "),
];

/**
 * The elements a connection from the first element may reach: of a kind it reaches, not the
 * element itself, nor one it holds or that holds it; those beside it in its container first.
 */
function reached(place: TamPlace, can: (kind: string) => boolean): Completion[] {
  const { known, byId, sources, source } = place,
    home = (source ? byId.get(source)?.parent : undefined) ?? null,
    fit = known.filter(
      (item) =>
        !sources.includes(item.id) &&
        can(item.kind) &&
        !(source && (holds(byId, source, item.id) || holds(byId, item.id, source))),
    ),
    beside = (item: Known) => (item.parent ?? null) === home;
  return inOrder([...fit.filter(beside), ...fit.filter((item) => !beside(item))].map(tamElement));
}

/**
 * The start of a line: a declaration, a header line, or the element a connection starts at. The
 * statements of the notation first, then the elements in the order of the source.
 */
function lineStart(match: RegExpMatchArray, place: TamPlace) {
  if (!match[1] && !place.context.explicit) return null;
  return tamResult(at(place, match[1].length), [
    ...ranked(TAM_STATEMENTS, 30),
    ...inOrder(place.known.map(tamElement)),
  ]);
}

/** After the element a connection starts at: the connections it can make, in the order of the notation. */
function connectionsFrom(match: RegExpMatchArray, place: TamPlace) {
  const from = place.byId.get(match[1].split(/\s*&\s*/)[0]);
  if (!from) return undefined;
  const anchors =
    from.kind === "note" || place.known.some((item) => item.kind === "note")
      ? [{ ...ANCHOR, from: () => true }]
      : [];
  return tamResult(
    at(place, match[2].length),
    ranked(
      [...CONNECTIONS, ...anchors]
        .filter((item) => item.from(from.kind))
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

/** After the arrow: the elements the connection reaches, by its word. */
const arrowTargets = (match: RegExpMatchArray, place: TamPlace) =>
  tamResult(at(place, match[2].length), reached(place, reaches(match[1].trim().toLowerCase())));

/** After `-.-`: an element reaches the notes, a note the elements. */
function anchored(match: RegExpMatchArray, place: TamPlace) {
  const note = sourceKind(place) === "note";
  return tamResult(
    at(place, match[1].length),
    reached(place, (kind) => (kind === "note") !== note),
  );
}

/** Inside a connection: its word, of those the element it starts at can say. */
function connectionWords(match: RegExpMatchArray, place: TamPlace) {
  const kind = sourceKind(place),
    words = CONNECTIONS.filter(
      (item) => item.text.startsWith("-- ") && (!kind || item.from(kind)),
    ).map((item) => item.text.replace(/^-- /, ""));
  return tamResult(
    at(place, match[1].length),
    ranked(
      words.map((text) => option(text.replace(/\s*-->\s*$/, ""), "connection", undefined, text)),
      50,
    ),
    /^[\w/ ]*$/,
  );
}

/** Inside a dotted connection: its word. */
function dottedWords(match: RegExpMatchArray, place: TamPlace) {
  const kind = sourceKind(place);
  return tamResult(
    at(place, match[1].length),
    ranked(
      CONNECTIONS.filter((item) => item.text.startsWith("-. ") && (!kind || item.from(kind))).map(
        (item) => {
          const word = item.text.replace(/^-\.\s*|\s*\.->\s*$/g, "");
          return option(word, "connection", item.about, `${word} .-> `);
        },
      ),
      9,
    ),
  );
}

/** The steps of completing a block diagram, in the order they are tried. */
const TAM_STEPS: Step<TamPlace>[] = [
  matching(/^(\w*)$/, lineStart),
  matching(/^direction\s+(\w*)$/, (match, place) =>
    tamResult(at(place, match[1].length), DIRECTIONS),
  ),
  matching(/:::(\w*)$/, (match, place) =>
    tamResult(
      at(place, match[1].length),
      [...COLORS].map((color) => option(color, `color-${color}`)),
    ),
  ),
  (place) => afterDeclaration(place),
  matching(/^(\w+(?:\s*&\s*\w+)*)\s+([-<.\w]*)$/, connectionsFrom),
  matching(/(?:--|<--)\s*([^-]*?)\s*(?:-->|---)\s*(?:\w+\s*&\s*)*(\w*)$/, arrowTargets),
  matching(/-\.\s*(\w+)\s*\.->\s*(?:\w+\s*&\s*)*(\w*)$/, arrowTargets),
  matching(/^\w+\s+-\.-\s*(\w*)$/, anchored),
  matching(/^\w+\s+---\s*(\w*)$/, (match, place) =>
    tamResult(at(place, match[1].length), reached(place, talks)),
  ),
  matching(/(?:--|<--)\s+([\w/ ]*)$/, connectionWords),
  matching(/-\.\s*(\w*)$/, dottedWords),
  matching(/&\s*(\w*)$/, (match, place) =>
    tamResult(
      at(place, match[1].length),
      inOrder(place.known.filter((item) => !place.sources.includes(item.id)).map(tamElement)),
    ),
  ),
];

/** The completions at the cursor of a block diagram source; null where nothing is to offer. */
export function completeTam(context: CompletionContext, given: Known[]): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos),
    before = line.text.slice(0, context.pos - line.from).replace(/^\s+/, ""),
    // What the text declares is as it was typed; what the picture knows besides stays on offer.
    typed = declaredIn(context.state.doc.toString(), line.number),
    known = [...typed, ...given.filter((item) => !typed.some((other) => other.id === item.id))],
    sources = (before.match(/^(\w+(?:\s*&\s*\w+)*)/)?.[1] ?? "").split(/\s*&\s*/);
  const place: TamPlace = {
    context,
    before,
    indent: line.text.match(/^\s*/)![0],
    known,
    byId: new Map(known.map((item) => [item.id, item])),
    sources,
    source: sources[0] || undefined,
  };
  return firstOffer(TAM_STEPS, place);
}

/** The declaration that ends before the cursor, and what is typed behind it: a word, or an arrow begun. */
function declarationBefore(before: string) {
  // An arrow begun behind a declaration is a connection from the element, which the next line takes.
  const arrow = before.match(/^(.*?[\s\]"])([-<][-<>.\w/ ]*)$/),
    partial = arrow?.[2] ?? before.match(/[\w:.]*$/)![0],
    head = before.slice(0, before.length - partial.length);
  // The id is typed while no space, bracket or quote ends it.
  if (!/[\s\]"]$/.test(head)) return undefined;
  const match = head.trim().match(ELEMENT);
  if (!match) return undefined;
  const [, kind, id, , , modifiers, brace] = match;
  if ((!id && kind !== "group") || brace) return undefined;
  return { arrow: !!arrow, partial, head, kind, id: id as string | undefined, modifiers };
}

/**
 * The connections from a declared element, each on the line after its declaration: taken, it
 * starts the next line from this element. The spaces behind the declaration go with it.
 */
function nextLineConnections(kind: string, id: string, head: string, indent: string) {
  return CONNECTIONS.filter((item) => item.from(kind)).map((item): Completion => ({
    ...option(item.text.trim(), "connection", `${item.about}, on the next line`),
    apply: (view, completion, from, to) => {
      const start = from - (head.length - head.trimEnd().length),
        insert = `\n${indent}${id} ${item.text}`;
      view.dispatch({
        changes: { from: start, to, insert },
        selection: { anchor: start + insert.length },
        annotations: pickedCompletion.of(completion),
        userEvent: "input.complete",
      });
    },
  }));
}

/**
 * What may follow a declaration on its line: `{` to open a block for a kind that holds others, a
 * color, and `stack` or `...` for several. `space` goes before each, where the declaration does
 * not end with one.
 */
function followers(
  kind: string,
  id: string | undefined,
  modifiers: string,
  space: string,
): Completion[] {
  const several = /(^|\s)(stack|\.\.\.)(\s|$)/.test(modifiers);
  return [
    // A human holds nothing; every other kind may open a block.
    ...(kind === "human"
      ? []
      : [
          // The lines of a template take the indent of the line it is written on.
          filled(`${space}{\n\t\${}\n}`, {
            label: "{",
            type: "keyword",
            detail: `a block: what ${id ?? "the group"} holds`,
          }),
        ]),
    ...(modifiers.includes(":::")
      ? []
      : [...COLORS].map((color) =>
          option(`:::${color}`, `color-${color}`, undefined, `${space}:::${color}`),
        )),
    ...(several || !["agent", "human", "storage"].includes(kind)
      ? []
      : [
          option("stack", "keyword", "several, drawn as a stack", `${space}stack`),
          option("...", "keyword", "several, drawn as two with dots between", `${space}...`),
        ]),
  ];
}

/** Options ranked below one another, from where the typed part starts; null where there are none. */
const rankedResult = (from: number, options: Completion[], validFor: RegExp) =>
  options.length ? { from, options: ranked(options, 40), validFor } : null;

/**
 * What may follow a declaration: a color, `{` to open a block for a kind that holds others,
 * `stack` or `...` for several, and a connection from the element on the next line. Offered once
 * a space or a sign of one follows the declaration, or on asking: right behind the `]` Enter
 * ends the line, and a list there would take it. Undefined where no declaration ends before the
 * cursor.
 */
function afterDeclaration(place: TamPlace): CompletionResult | null | undefined {
  const found = declarationBefore(place.before);
  if (!found) return undefined;
  const { arrow, partial, head, kind, id, modifiers } = found,
    spaced = /\s$/.test(head),
    from = place.context.pos - partial.length,
    connections = id ? nextLineConnections(kind, id, head, place.indent) : [];
  if (arrow) return rankedResult(from, connections, /^[-<>.\w/ ]*$/);
  // Behind `group ` an id may come next: what follows a group without one is offered on asking.
  if (!place.context.explicit && ((!partial && !spaced) || !id)) return null;
  return rankedResult(
    from,
    [...followers(kind, id, modifiers, spaced ? "" : " "), ...connections],
    /^[\w:.]*$/,
  );
}
