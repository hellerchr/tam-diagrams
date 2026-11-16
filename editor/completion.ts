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
};

/** Whether an element of a kind acts, keeps information, or is a person. */
const acts = (kind: string) => kind !== "storage" && kind !== "package";
const talks = (kind: string) => kind === "agent" || kind === "human" || kind === "group";
const keeps = (kind: string) => kind === "storage" || kind === "group";

/**
 * The kinds of element a block diagram declares, as the editor offers them: the design level the
 * parser also reads is not offered.
 */
const KINDS = ["agent", "human", "storage", "group"];

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

/** Which elements a connection word reaches. */
function reaches(word: string): (kind: string) => boolean {
  if (/^(reads|writes|reads\/writes|pointer)\b/.test(word)) return keeps;
  if (/^(calls|sends data)\b/.test(word) || word === "") return talks;
  if (/^(create|generate)\b/.test(word)) return acts;
  return () => true;
}

/**
 * The elements a block diagram's text declares, in its order, with the element that holds each:
 * what was typed is offered before the picture of it is laid out. The line at `skip` (from 1) is
 * the one being typed, whose declaration is not finished.
 */
export function declaredIn(text: string, skip = 0): Known[] {
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
    const [, kind, id, bracketed, quoted, , brace] = match;
    if (id && index + 1 !== skip)
      found.push({
        id,
        kind,
        label: (bracketed ?? quoted)?.trim() || id,
        parent: open.at(-1) ?? null,
      });
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

/** The directions a diagram can be laid out in, the usual ones first. */
export const DIRECTIONS: Completion[] = ranked(
  [
    option("TB", "constant", "top to bottom"),
    option("LR", "constant", "left to right"),
  ],
  9,
);

/** The completions at the cursor of a block diagram source; null where nothing is to offer. */
export function completeTam(context: CompletionContext, given: Known[]): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos),
    before = line.text.slice(0, context.pos - line.from).replace(/^\s+/, ""),
    indent = line.text.match(/^\s*/)![0],
    at = (length: number) => context.pos - length;
  // What the text declares is as it was typed; what the picture knows besides stays on offer.
  const typed = declaredIn(context.state.doc.toString(), line.number),
    known = [...typed, ...given.filter((item) => !typed.some((other) => other.id === item.id))];
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
          ...KINDS.map((kind) =>
            filled(kind === "group" ? "group {\n\t${}\n}" : `${kind} \${id}[\${Name}]`, {
              label: kind,
              type: `declare-${kind}`,
              detail: ABOUT[kind],
            }),
          ),
          option("title", "keyword", "the diagram's title", "title "),
          option("direction", "keyword", "TB or LR", "direction "),
        ],
        30,
      ),
      ...inOrder(known.map(element)),
    ]);
  }
  if ((match = before.match(/^direction\s+(\w*)$/))) return result(at(match[1].length), DIRECTIONS);
  if ((match = before.match(/:::(\w*)$/)))
    return result(
      at(match[1].length),
      [...COLORS].map((color) => option(color, `color-${color}`)),
    );

  const declared = afterDeclaration(context, before, indent);
  if (declared !== undefined) return declared;

  // After the element a connection starts at: the connections it can make.
  if (
    (match = before.match(/^(\w+(?:\s*&\s*\w+)*)\s+([-<.\w]*)$/)) &&
    byId.has(match[1].split(/\s*&\s*/)[0])
  ) {
    const { kind } = byId.get(match[1].split(/\s*&\s*/)[0])!;
    return result(
      at(match[2].length),
      // In the order of the notation, not of the alphabet.
      ranked(
        CONNECTIONS.filter((item) => item.from(kind)).map((item) =>
          filled(item.text, { label: item.text.trim(), type: "connection", detail: item.about }),
        ),
        50,
      ),
      // Behind a whole arrow the elements it reaches are offered instead.
      /^(?!.*(-->|---|\.->)\s)[-<.\w/ ]*$/,
    );
  }
  const sources = (before.match(/^(\w+(?:\s*&\s*\w+)*)/)?.[1] ?? "").split(/\s*&\s*/),
    source = sources[0] || undefined;
  // The elements a connection from the first element may reach: of a kind it reaches, not the
  // element itself, nor one it holds or that holds it; those beside it in its container first.
  const reached = (can: (kind: string) => boolean) => {
    const home = source ? byId.get(source)?.parent : undefined,
      fit = known.filter(
        (item) =>
          !sources.includes(item.id) &&
          can(item.kind) &&
          !(source && (holds(byId, source, item.id) || holds(byId, item.id, source))),
      );
    return inOrder(
      [
        ...fit.filter((item) => (item.parent ?? null) === (home ?? null)),
        ...fit.filter((item) => (item.parent ?? null) !== (home ?? null)),
      ].map(element),
    );
  };
  // After the arrow: the elements the connection reaches.
  if ((match = before.match(/(?:--|<--)\s*([^-]*?)\s*(?:-->|---)\s*(?:\w+\s*&\s*)*(\w*)$/))) {
    const can = reaches(match[1].trim().toLowerCase());
    return result(at(match[2].length), reached(can));
  }
  if ((match = before.match(/-\.\s*(\w+)\s*\.->\s*(?:\w+\s*&\s*)*(\w*)$/))) {
    const can = reaches(match[1].toLowerCase());
    return result(at(match[2].length), reached(can));
  }
  if ((match = before.match(/^\w+\s+---\s*(\w*)$/)))
    return result(at(match[1].length), reached(talks));
  const kind = source ? byId.get(source)?.kind : undefined;
  // Inside a connection: its word.
  if ((match = before.match(/(?:--|<--)\s+([\w/ ]*)$/))) {
    const words = CONNECTIONS.filter(
      (item) => item.text.startsWith("-- ") && (!kind || item.from(kind)),
    ).map((item) => item.text.replace(/^-- /, ""));
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
        CONNECTIONS.filter((item) => item.text.startsWith("-. ") && (!kind || item.from(kind))).map(
          (item) => {
            const word = item.text.replace(/^-\.\s*|\s*\.->\s*$/g, "");
            return option(word, "connection", item.about, `${word} .-> `);
          },
        ),
        9,
      ),
    );
  if ((match = before.match(/&\s*(\w*)$/)))
    return result(
      at(match[1].length),
      inOrder(known.filter((item) => !sources.includes(item.id)).map(element)),
    );
  return null;
}

/**
 * What may follow a declaration: a color, `{` to open a block for a kind that holds others,
 * `stack` or `...` for several, and a connection from the element on the next line. Offered once
 * a space or a sign of one follows the declaration, or on asking: right behind the `]` Enter
 * ends the line, and a list there would take it. Undefined where no declaration ends before the
 * cursor.
 */
function afterDeclaration(
  context: CompletionContext,
  before: string,
  indent: string,
): CompletionResult | null | undefined {
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
  // A connection stands on a line of its own: taken, it starts the next line from this element.
  // The spaces behind the declaration go with it.
  const connections = id
    ? CONNECTIONS.filter((item) => item.from(kind)).map((item): Completion => ({
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
      }))
    : [];
  if (arrow)
    return connections.length
      ? {
          from: context.pos - partial.length,
          options: ranked(connections, 40),
          validFor: /^[-<>.\w/ ]*$/,
        }
      : null;
  // Behind `group ` an id may come next: what follows a group without one is offered on asking.
  if (!context.explicit && ((!partial && !/\s$/.test(head)) || !id)) return null;
  const space = /\s$/.test(head) ? "" : " ",
    several = /(^|\s)(stack|\.\.\.)(\s|$)/.test(modifiers);
  const options = [
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
    ...connections,
  ];
  return options.length
    ? {
        from: context.pos - partial.length,
        options: ranked(options, 40),
        validFor: /^[\w:.]*$/,
      }
    : null;
}
