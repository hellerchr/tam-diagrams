/**
 * What the source pane offers while a diagram of any type is typed. For the Mermaid types: at the
 * start of a line the statements of the type and the ids to connect from; after an id the
 * connections of the syntax; after a connection the ids it can reach; inside a block what belongs
 * there. The ids come from the text itself, read by the tokenizer of the type, so they are there
 * while the source does not parse. On the first line the headers of all types are offered.
 */

import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  pickedCompletion,
  snippet,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import {
  completeTam,
  DIRECTIONS,
  filled,
  inOrder,
  type Known,
  option,
  ranked,
} from "./completion.ts";
import { scanSource, type SyntaxState, type Token } from "./syntax.ts";
import type { DiagramType } from "./types.ts";

/** The place of the cursor, as far as completing needs it. */
interface Cursor {
  type: DiagramType;
  /** The text of the line before the cursor, without its indentation. */
  before: string;
  /** The completion was asked for, not opened by typing. */
  explicit: boolean;
  /** The position a number of characters before the cursor. */
  at(length: number): number;
  /** Where the tokenizer stands at the start of the line: the open blocks, a class body, frontmatter. */
  start: SyntaxState;
  /** The elements the source names, without the word at the cursor. */
  ids(): Known[];
  /** The elements the other lines name. */
  elsewhere(): Known[];
  /** The tokens of a first part of the line. */
  tokens(head: string): Token[];
}

/** What a kind of element is, where it has no name of its own to show. */
const ABOUT: Record<string, string> = {
  "uml-class": "class",
  "uml-actor": "actor",
  "uml-usecase": "use case",
  "uml-rect": "node",
  "uml-step": "action",
  "uml-decision": "decision",
  "uml-circle": "circle",
  "uml-final": "final node",
  "uml-bar": "fork or join",
  "uml-state": "state",
  "uml-participant": "participant",
  group: "subgraph",
};

const WORD = /^[\p{L}\p{N}_]*$/u;

const result = (from: number, options: Completion[], validFor = WORD): CompletionResult | null =>
  options.length ? { from, options, validFor } : null;

/** A statement to fill in: its keyword, the text with its fields, its drawing and what it is. */
const statements = (list: [label: string, template: string, type: string, detail: string][]) =>
  list.map(([label, template, type, detail]) => filled(template, { label, type, detail }));

/** The connections of a syntax: what is typed, what it means, and the text with fields when it has some. */
const arrows = (list: [text: string, detail: string, template?: string][]) =>
  ranked(
    list.map(([text, detail, template]) =>
      filled(template ?? `${text} `, { label: text, type: "connection", detail }),
    ),
    50,
  );

/** The elements as options, in the order the source names them. */
const elements = (items: Known[]): Completion[] => inOrder(items.map(element));

const element = (item: Known): Completion =>
  option(
    item.id,
    item.kind,
    (item.label !== item.id && item.label.replace(/<br\s*\/?>/gi, " ")) || ABOUT[item.kind],
  );

/** An option that writes a text over what was typed and over the bracket closed behind the cursor. */
const over = (label: string, type: string, detail: string, text: string, closer: string) => ({
  label,
  type,
  detail,
  apply: (view: EditorView, completion: Completion, from: number, to: number) => {
    const end = view.state.sliceDoc(to, to + closer.length) === closer ? to + closer.length : to;
    view.dispatch({
      changes: { from, to: end, insert: text },
      selection: { anchor: from + text.length },
      annotations: pickedCompletion.of(completion),
      userEvent: "input.complete",
    });
  },
});

const DIRECTION_LINE: Completion = option("direction", "keyword", "TB, LR, BT or RL", "direction ");

const END: Completion = option("end", "keyword", "closes the block");

/** The word a line starts with, when the cursor is still in it; undefined past it, null when nothing is asked. */
function startWord(cursor: Cursor): string | null | undefined {
  if (!WORD.test(cursor.before)) return undefined;
  return cursor.before || cursor.explicit ? cursor.before : null;
}

/** The statements and the ids a line can start with. */
const lineStart = (cursor: Cursor, word: string, list: Completion[], ids = cursor.ids()) =>
  result(cursor.at(word.length), [...ranked(list, 30), ...elements(ids)]);

/** The directions after `direction`. */
function direction(cursor: Cursor): CompletionResult | null | undefined {
  const match = cursor.before.match(/^direction\s+(\w*)$/);
  return match ? result(cursor.at(match[1].length), DIRECTIONS) : undefined;
}

const text = (token: Token) => token.text.trim();

/** The name inside the brackets or quotes of a label. */
const unwrap = (label: string) =>
  label
    .trim()
    .replace(/^[([{>/\\]+|[)\]}/\\]+$/g, "")
    .trim()
    .replace(/^"(.*)"$/, "$1");

/** An element a source names, and the line that says what it is. */
interface Named extends Known {
  /** The line that declares the element, or gives it its text; its first mention where none does. From 1. */
  line: number;
  /** Whether that line declares it. */
  declared: boolean;
}

/** The elements a source names, read from the tokens of the text, so a source that does not parse has them too. */
function namedIn(type: DiagramType, source: string): Named[] {
  const found = new Map<string, Named>();
  let line = 0;
  const add = (id: string, kind: string, label = "", declared = false, declares = declared) => {
    const known = found.get(id);
    if (!known) found.set(id, { id, kind, label, line, declared: declares || !!label });
    else {
      if (declared || (label && !known.label)) known.kind = kind;
      if (label) known.label = label;
      if ((declares || label) && !known.declared) Object.assign(known, { line, declared: true });
    }
  };
  for (const tokens of scanSource(type, source).lines) {
    line++;
    const lead = tokens[0]?.tag === "keyword" ? tokens[0].text : "";
    tokens.forEach((token, index) => {
      if (!token.tag.startsWith("variableName")) return;
      const next = tokens[index + 1],
        label = next?.tag === "string" && next.from === token.to ? next.text : "",
        defined = token.tag.endsWith("definition");
      if (type === "class") {
        if (lead === "namespace") return;
        const name = text(token).replace(/^`|`$/g, "").replace(/~.*$/, "");
        add(name, "uml-class", unwrap(label), false, defined);
      } else if (type === "usecase") {
        if (lead === "systemBoundary" && defined) return;
        const actor = lead === "actor" && defined;
        add(token.text, actor ? "uml-actor" : "uml-usecase", unwrap(label), actor);
      } else if (type === "flowchart" || type === "swimlane") {
        if (lead === "subgraph") {
          // Edges may end at a subgraph, but not at a lane.
          if (type === "flowchart")
            add(text(token), "group", next?.tag === "string" ? unwrap(next.text) : "", true);
          return;
        }
        const kind = /^\{(?!\{)/.test(label)
          ? "uml-decision"
          : label.startsWith("(((")
            ? "uml-final"
            : label.startsWith("((")
              ? "uml-circle"
              : /^\((?!\[)/.test(label) || label.startsWith("([")
                ? "uml-step"
                : "uml-rect";
        add(token.text, kind, unwrap(label), !!label);
      } else if (type === "state") {
        const quoted = defined && tokens[index - 2]?.tag === "string" ? tokens[index - 2].text : "",
          special = next?.tag === "annotation" ? next.text.toLowerCase() : "";
        add(
          token.text,
          special.includes("choice")
            ? "uml-decision"
            : /fork|join/.test(special)
              ? "uml-bar"
              : "uml-state",
          unwrap(quoted),
          !!special,
          !!special || defined,
        );
      } else if (type === "sequence") {
        const alias = tokens[index + 2]?.tag === "string" ? text(tokens[index + 2]) : "";
        add(
          text(token),
          defined && /actor$/.test(lead) ? "uml-actor" : "uml-participant",
          defined ? alias : "",
          defined,
        );
      }
    });
  }
  return [...found.values()];
}

/**
 * The elements a source names, in the order it names them: the classes, the actors and use cases,
 * the nodes, the states or the participants, each with its kind and its label where the source
 * says one. Read from the tokens of the text, so a source that does not parse has them too.
 */
export function idsOf(type: DiagramType, source: string): Known[] {
  return namedIn(type, source).map(({ id, kind, label }) => ({ id, kind, label }));
}

/**
 * The line of each element of a source, by its id: the line that declares the element or gives it
 * its text and shape, which is the one to show for it; the line of its first mention where the
 * source only mentions it. Lines count from 1.
 */
export function declarationLines(type: DiagramType, source: string): Map<string, number> {
  return new Map(namedIn(type, source).map((item) => [item.id, item.line]));
}

const ANNOTATIONS = ["interface", "abstract", "enumeration", "service"].map((name) =>
  option(name, "constant", `«${name}»`, `${name}>>`),
);

/** What a line inside a class starts with besides a member: its visibility, or the kind of the class. */
const MARKS = ranked(
  [
    option("+", "keyword", "public"),
    option("-", "keyword", "private"),
    option("#", "keyword", "protected"),
    option("~", "keyword", "package"),
    ...["interface", "abstract", "enumeration"].map((name) =>
      option(`<<${name}>>`, "constant", "what kind of class it is"),
    ),
  ],
  20,
);

const CLASS_KEYWORDS =
  /^(class|namespace|note|direction|classDef|style|cssClass|click|callback|link|links)$/;

const CLASS_RELATIONS = arrows([
  ["<|--", "inheritance: the left is the base class"],
  ["--|>", "inheritance: the right is the base class"],
  ["*--", "composition: the left is made of the right"],
  ["o--", "aggregation: the left has the right"],
  ["-->", "association: the left knows the right"],
  ["--", "association, known both ways"],
  ["..>", "dependency: the left uses the right"],
  ["..|>", "realization: the right is the interface"],
  ["<|..", "realization: the left is the interface"],
  ['"1" --> "*"', "association with multiplicities", '"${1:1}" --> "${2:*}" '],
  ["()--", "interface as a ball, named at the left"],
  [":", "a member of the class", ": ${member}"],
]);

/** The completions of a class diagram. */
function completeClass(cursor: Cursor): CompletionResult | null {
  const { before, start } = cursor;
  let match: RegExpMatchArray | null;
  if ((match = before.match(/<<(\w*)$/)) && (start.body || /^(class\s|<<)/.test(before)))
    return result(cursor.at(match[1].length), ANNOTATIONS);
  // Inside the braces of a class: its members.
  if (start.body) {
    if (!(match = before.match(/^([+\-#~]?)(\w*)$/))) return null;
    if (!match[0] && !cursor.explicit) return null;
    const sign = match[1] ? "" : "+";
    return result(cursor.at(match[2].length), [
      ...ranked(
        statements([
          ["attribute", `${sign}\${name}: \${Type}`, "uml-attribute", "a value of the class"],
          ["method", `${sign}\${name}(\${})`, "uml-method", "an operation of the class"],
          ["method with result", `${sign}\${name}(\${}) \${Type}`, "uml-method", "returns a value"],
          ["static method", `${sign}\${name}(\${})$`, "uml-method", "underlined: of the class"],
          ["abstract method", `${sign}\${name}(\${})*`, "uml-method", "italic: for subclasses"],
        ]),
        30,
      ),
      ...(match[1] ? [] : MARKS),
    ]);
  }
  const found = direction(cursor);
  if (found !== undefined) return found;
  if ((match = before.match(/^note\s+(\w*)$/)))
    return result(cursor.at(match[1].length), [
      option("for", "keyword", "the note belongs to a class", "for "),
    ]);
  if ((match = before.match(/^note\s+for\s+([\p{L}\p{N}_.]*)$/u)))
    return result(cursor.at(match[1].length), elements(cursor.ids()));
  const word = startWord(cursor);
  if (word === null) return null;
  if (word !== undefined) {
    const classes = statements([
      ["class", "class ${Name} {\n\t${}\n}", "declare-uml-class", "a class with members"],
      [
        "interface",
        "class ${Name} {\n\t<<interface>>\n\t${}\n}",
        "declare-uml-class",
        "a class marked «interface»",
      ],
    ]);
    // A namespace only declares its classes.
    if (start.blocks.at(-1) === "namespace") return lineStart(cursor, word, classes, []);
    return lineStart(cursor, word, [
      ...classes,
      ...statements([
        ["namespace", "namespace ${Name} {\n\t${}\n}", "declare-package", "a package of classes"],
        ["note", 'note "${text}"', "declare-uml-note", "a note"],
        ["note for", 'note for ${Class} "${text}"', "declare-uml-note", "a note at a class"],
      ]),
      DIRECTION_LINE,
    ]);
  }
  // After a class: the relations it can have.
  if (
    (match = before.match(/^(`[^`]+`|[\p{L}\p{N}_.~]+)(\s+"[^"]*")?(\s*)([-.<|>*o():]*)$/u)) &&
    !CLASS_KEYWORDS.test(match[1]) &&
    (match[3] || /^[^o]/.test(match[4]))
  )
    // Behind a whole relation and a space the classes are offered instead.
    return result(cursor.at(match[4].length), CLASS_RELATIONS, /^[-.<|>*o():]*$/);
  // After a relation: the classes.
  if (
    (match = before.match(
      /(?:--|\.\.)(?:\|>|\*|>|\(\)|o(?=\s))?\s*(?:"[^"]*"\s*)?([\p{L}\p{N}_.]*)$/u,
    )) &&
    !before.includes(":")
  )
    return result(cursor.at(match[1].length), elements(cursor.ids()), /^[\p{L}\p{N}_.]*$/u);
  return null;
}

const USECASE_RELATIONS = arrows([
  ["-->", "association: who takes part in what"],
  ["--", "association without an arrow"],
  ["..> : include", "always does the other use case too"],
  ["..> : extend", "adds to the other use case, at times"],
  ["--|>", "generalization: is a kind of"],
  ["-- text -->", "association with a name", "-- ${text} --> "],
]);

/** The completions of a use case diagram. */
function completeUsecase(cursor: Cursor): CompletionResult | null {
  const { before, start } = cursor;
  let match: RegExpMatchArray | null;
  const found = direction(cursor);
  if (found !== undefined) return found;
  if ((match = before.match(/^note\s+(\w*)$/)))
    return result(cursor.at(match[1].length), [
      option("for", "keyword", "the note belongs to an element", "for "),
    ]);
  if ((match = before.match(/^note\s+for\s+(\w*)$/)))
    return result(cursor.at(match[1].length), elements(cursor.ids()));
  const word = startWord(cursor);
  if (word === null) return null;
  if (word !== undefined) {
    const usecase = statements([
      [
        "use case",
        "${id}(${Name})",
        "declare-uml-usecase",
        "something the system does for an actor",
      ],
    ]);
    // Inside a system boundary: its use cases; relations go outside.
    if (start.blocks.length) return lineStart(cursor, word, [...usecase, END], []);
    return lineStart(cursor, word, [
      ...statements([
        ["actor", "actor ${Name}", "declare-uml-actor", "a person or a system that takes part"],
      ]),
      ...usecase,
      ...statements([
        [
          "systemBoundary",
          "systemBoundary ${id}[${Name}]\n\t${}\nend",
          "declare-group",
          "the system its use cases belong to",
        ],
        ["note for", "note for ${id} ${text}", "declare-uml-note", "a note at an element"],
      ]),
      DIRECTION_LINE,
    ]);
  }
  if (/^(actor|systemBoundary|direction|note|class|classDef|style)\s/.test(before)) return null;
  if ((match = before.match(/\.\.>\s*:\s*(\w*)$/)))
    return result(cursor.at(match[1].length), [
      option("include", "keyword", "always does the other use case too", "include "),
      option("extend", "keyword", "adds to the other use case, at times", "extend "),
    ]);
  // After a relation: the elements; a use case includes and extends use cases only.
  if ((match = before.match(/\.\.>\s*:\s*(?:include|extend)\s+(\w*)$/)))
    return result(
      cursor.at(match[1].length),
      elements(cursor.ids().filter((item) => item.kind === "uml-usecase")),
    );
  if ((match = before.match(/(?:--+\|?>\s*|(?:<--+|--+[ox]?)\s+)(\w*)$/)))
    return result(cursor.at(match[1].length), elements(cursor.ids()));
  // After an element: the relations of the syntax. Behind a label only when asked or begun.
  if (
    (match = before.match(/^\w+(\s*(?:\([^)]*\)|\[[^\]]*\]))?\s+([-.<>|ox]*)$/)) &&
    (!match[1] || match[2] || cursor.explicit)
  )
    return result(cursor.at(match[2].length), USECASE_RELATIONS, /^[-.<>|ox]*$/);
  return null;
}

const FLOW_EDGES = arrows([
  ["-->", "flow to the next node"],
  ["-->|text|", "flow with a text, as after a decision", "-->|${text}| "],
  ["---", "line without an arrow"],
  ["-.->", "dotted flow"],
  ["==>", "thick flow"],
  ["-- text -->", "flow with a text", "-- ${text} --> "],
  ["<-->", "flow both ways"],
  ["--o", "line to a circle"],
  ["--x", "line to a cross"],
  ["~~~", "invisible link: only places the nodes"],
  ["&", "and another node of the same edge"],
]);

/** The shapes a node can have, by their brackets. */
const FLOW_SHAPES: [open: string, close: string, type: string, detail: string][] = [
  ["[", "]", "uml-rect", "rectangle: an action"],
  ["(", ")", "uml-step", "rounded: an action"],
  ["{", "}", "uml-decision", "diamond: a decision or a merge"],
  ["((", "))", "uml-circle", "circle: the initial node where flows only leave"],
  ["(((", ")))", "uml-final", "double circle: the final node"],
  ["([", "])", "uml-stadium", "stadium"],
  ["[(", ")]", "uml-cylinder", "cylinder: an object, a database"],
  ["[[", "]]", "uml-rect", "subroutine"],
  ["{{", "}}", "uml-hexagon", "hexagon"],
  ["[/", "/]", "uml-rect", "leaning right: input or output"],
  ["[\\", "\\]", "uml-rect", "leaning left"],
  ["[/", "\\]", "uml-rect", "trapezoid"],
  ["[\\", "/]", "uml-rect", "trapezoid, wide at the top"],
  [">", "]", "uml-rect", "flag"],
];

/** The shapes as options: each writes its brackets right behind the id, with the text to fill in. */
const SHAPE_OPTIONS = ranked(
  FLOW_SHAPES.map(([open, close, type, detail]) => ({
    label: `${open} ${close}`,
    type,
    detail,
    apply: (view: EditorView, completion: Completion, from: number, to: number) => {
      const gap = view.state.sliceDoc(Math.max(0, from - 40), from).match(/[ \t]*$/)![0].length;
      snippet(`${open}\${Text}${close}`)(view, completion, from - gap, to);
    },
  })),
  90,
);

/** The completions of a flowchart, and of an activity with lanes. */
function completeFlow(cursor: Cursor): CompletionResult | null {
  const { before, start } = cursor,
    lanes = cursor.type === "swimlane";
  let match: RegExpMatchArray | null;
  if (!start.header)
    return (match = before.match(/^(?:flowchart(?:-elk)?|graph|swimlane-beta)\s+(\w*)$/))
      ? result(cursor.at(match[1].length), DIRECTIONS)
      : null;
  const found = direction(cursor);
  if (found !== undefined) return found;
  const word = startWord(cursor);
  if (word === null) return null;
  if (word !== undefined) {
    const [open, close] = lanes ? ["(", ")"] : ["[", "]"];
    return lineStart(cursor, word, [
      ...statements([
        lanes
          ? [
              "subgraph",
              "subgraph ${Lane}\n\t${}\nend",
              "declare-group",
              "a lane: who does its steps",
            ]
          : [
              "subgraph",
              "subgraph ${id} [${Title}]\n\t${}\nend",
              "declare-group",
              "a frame around nodes",
            ],
        ["action", `\${id}${open}\${Text}${close}`, "declare-uml-step", "a step of the flow"],
        ["decision", "${id}{${Question}}", "declare-uml-decision", "a branch of the flow"],
        ["initial", "${start}((${Start}))", "declare-uml-circle", "the initial node"],
        ["final", "${stop}(((${End})))", "declare-uml-final", "the final node"],
      ]),
      DIRECTION_LINE,
      ...(start.blocks.length ? [END] : []),
    ]);
  }
  // What is being typed: the signs of an edge, or a word; and the tokens of the line before it.
  const symbols = before.match(/[-=.~<>|&]*$/)![0],
    letters = symbols ? "" : before.match(/[\p{L}\p{N}_]*$/u)![0],
    head = before.slice(0, before.length - symbols.length - letters.length),
    tokens = cursor.tokens(head),
    last = tokens.at(-1);
  if (!last || tokens[0].tag === "keyword") return null;
  const node =
    last.tag.startsWith("variableName") ||
    last.tag === "atom" ||
    last.tag === "meta" ||
    (last.tag === "string" && /^[^|].*[)\]}]$/.test(last.text));
  // After a node: the edges; after a node the source has not drawn yet, its shapes first.
  if (node && (symbols || (/\s$/.test(head) && /^[ox]?$/.test(letters)))) {
    const fresh =
      last.tag === "variableName" &&
      !symbols &&
      !letters &&
      !cursor.elsewhere().some((item) => item.id === last.text);
    return result(
      cursor.at(symbols.length + letters.length),
      fresh ? [...SHAPE_OPTIONS, ...FLOW_EDGES] : FLOW_EDGES,
      /^[-=.~<>ox|&]*$/,
    );
  }
  // After an edge: the nodes.
  const edge =
    last.tag === "operator" ||
    (last.tag === "string" && /^\|.*\|$/.test(last.text)) ||
    (last.tag === "punctuation" && last.text === "&");
  if (edge && !symbols) return result(cursor.at(letters.length), elements(cursor.ids()));
  return null;
}

const STATE_KEYWORDS = /^(state|note|direction|hide|scale|class|classDef|style)$/i;

const STATE_WORD = /^[\w[*\]]*$/;

/** The completions of a state machine. */
function completeState(cursor: Cursor): CompletionResult | null {
  const { before, start } = cursor;
  let match: RegExpMatchArray | null;
  const found = direction(cursor);
  if (found !== undefined) return found;
  if ((match = before.match(/^note\s+(?:left|right)\s+of\s+([^\s:\-{}"]*)$/i)))
    return result(cursor.at(match[1].length), elements(cursor.ids()), /^[^\s:\-{}"]*$/);
  if ((match = before.match(/^note\s+([\w ]*)$/i)))
    return result(
      cursor.at(match[1].length),
      ranked(
        [
          option("left of", "keyword", "a note at the left of a state", "left of "),
          option("right of", "keyword", "a note at the right of a state", "right of "),
        ],
        9,
      ),
      /^[\w ]*$/,
    );
  if ((match = before.match(/^state\s+\S+\s+<<(\w*)$/)))
    return result(cursor.at(match[1].length), [
      option("choice", "constant", "a diamond: the guards decide", "choice>>"),
      option("fork", "constant", "a bar: one transition becomes several", "fork>>"),
      option("join", "constant", "a bar: several transitions become one", "join>>"),
    ]);
  // The start of a line: a declaration, or the state a transition leaves.
  if ((match = before.match(/^([\w[*]*)$/))) {
    if (!match[1] && !cursor.explicit) return null;
    return result(
      cursor.at(match[1].length),
      [
        ...ranked(
          [
            ...statements([
              ["state", 'state "${Name}" as ${id}', "declare-uml-state", "a state with its name"],
              [
                "composite",
                "state ${id} {\n\t${}\n}",
                "declare-uml-state",
                "a state with states inside",
              ],
              [
                "choice",
                "state ${id} <<choice>>",
                "declare-uml-decision",
                "a diamond: the guards decide",
              ],
              [
                "fork",
                "state ${id} <<fork>>",
                "declare-uml-bar",
                "a bar: one transition becomes several",
              ],
              [
                "join",
                "state ${id} <<join>>",
                "declare-uml-bar",
                "a bar: several transitions become one",
              ],
              [
                "note",
                "note right of ${id} : ${text}",
                "declare-uml-note",
                "a note beside a state",
              ],
            ]),
            over("[*]", "uml-circle", "the initial state: where it starts", "[*] --> ", "]"),
            DIRECTION_LINE,
            ...(start.blocks.length
              ? [option("--", "keyword", "a region of its own below, at the same time")]
              : []),
          ],
          30,
        ),
        ...elements(cursor.ids()),
      ],
      STATE_WORD,
    );
  }
  const lead = before.match(/^\S+/)?.[0] ?? "";
  if (STATE_KEYWORDS.test(lead)) return null;
  // After a transition and its target: what triggers it.
  if ((match = before.match(/-->\s*(?:\[\*\]|[^:\s\-{}"]+)\s+(:?)$/)))
    return result(
      cursor.at(match[1].length),
      arrows([[":", "event [guard] / action", ": ${event}"]]),
      /^:?$/,
    );
  // After the arrow: the states it can reach.
  if ((match = before.match(/-->\s*([^:\s\-{}"]*)$/)))
    return result(
      cursor.at(match[1].length),
      [
        ...elements(cursor.ids()),
        { ...over("[*]", "uml-final", "the final state: where it ends", "[*]", "]"), boost: -61 },
      ],
      /^[^:\s\-{}"]*$/,
    );
  // After a state: its transition, or what it does.
  if ((match = before.match(/^(\[\*\]|[^:\s\-{}"]+)(\s*)([-:>]*)$/)) && (match[2] || match[3]))
    return result(
      cursor.at(match[3].length),
      arrows([
        ["-->", "transition to another state"],
        ...(match[1] === "[*]"
          ? []
          : ([[":", "what the state does: entry / action", ": ${description}"]] as [
              string,
              string,
              string,
            ][])),
      ]),
      /^[-:>]*$/,
    );
  return null;
}

const SEQUENCE_KEYWORDS =
  /^(loop|alt|opt|par|critical|break|rect|else|and|option|box|title|note|autonumber|links?|properties|details|participant|actor|create)\s/i;

const SEQUENCE_ARROWS = arrows([
  ["->>", "call: a message that waits for its answer", "->>"],
  ["-->>", "reply, dashed", "-->>"],
  ["-)", "asynchronous message: does not wait", "-)"],
  ["--)", "asynchronous reply, dashed", "--)"],
  ["->>+", "call that activates the receiver", "->>+"],
  ["-->>-", "reply that ends the sender's activation", "-->>-"],
  ["-x", "message that gets lost", "-x"],
  ["--x", "dashed message that gets lost", "--x"],
  ["->", "line without an arrowhead", "->"],
  ["-->", "dashed line without an arrowhead", "-->"],
  ["<<->>", "messages both ways", "<<->>"],
  ["<<-->>", "dashed messages both ways", "<<-->>"],
]);

/** The fragments that frame messages, by the keyword of the block the cursor is in. */
const BRANCHES: Record<string, Completion> = {
  alt: option("else", "keyword", "the other case of the alternative", "else "),
  par: option("and", "keyword", "what happens at the same time", "and "),
  critical: option("option", "keyword", "what happens when it fails", "option "),
};

/** The completions of a sequence diagram. */
function completeSequence(cursor: Cursor): CompletionResult | null {
  const { before, start } = cursor;
  let match: RegExpMatchArray | null;
  const ids = () => elements(cursor.ids());
  if ((match = before.match(/^note\s+(?:left\s+of|right\s+of|over)\s+(?:[^:,]+,\s*)?([^:,\s]*)$/i)))
    return result(cursor.at(match[1].length), ids(), /^[^:,\s]*$/);
  if ((match = before.match(/^note\s+([\w ]*)$/i)))
    return result(
      cursor.at(match[1].length),
      ranked(
        [
          option("over", "keyword", "a note across one or two lifelines", "over "),
          option("left of", "keyword", "a note at the left of a lifeline", "left of "),
          option("right of", "keyword", "a note at the right of a lifeline", "right of "),
        ],
        9,
      ),
      /^[\w ]*$/,
    );
  if ((match = before.match(/^(?:activate|deactivate|destroy)\s+(\S*)$/)))
    return result(cursor.at(match[1].length), ids(), /^\S*$/);
  if ((match = before.match(/^create\s+(\w*)$/)))
    return result(cursor.at(match[1].length), [
      option("participant", "keyword", "created by the next message to it", "participant "),
      option("actor", "keyword", "created by the next message to it", "actor "),
    ]);
  const word = startWord(cursor);
  if (word === null) return null;
  if (word !== undefined) {
    const frame = (
      keyword: string,
      field: string,
      detail: string,
      branch = "",
    ): [string, string, string, string] => [
      keyword,
      `${keyword} \${${field}}\n\t\${}\n${branch}end`,
      "declare-uml-frame",
      detail,
    ];
    const branch = BRANCHES[start.blocks.at(-1) ?? ""];
    return lineStart(cursor, word, [
      ...statements([
        [
          "participant",
          "participant ${id} as ${Name}",
          "declare-uml-participant",
          "a lifeline under a box",
        ],
        ["actor", "actor ${id} as ${Name}", "declare-uml-actor", "a lifeline under a person"],
        ["note", "note over ${id}: ${text}", "declare-uml-note", "a note at a lifeline"],
        frame("alt", "condition", "one case or the other", "else\n\t${}\n"),
        frame("opt", "condition", "only when the condition holds"),
        frame("loop", "condition", "again and again"),
        frame("par", "action", "at the same time", "and ${action}\n\t${}\n"),
        frame("critical", "action", "must not be interrupted", "option ${failure}\n\t${}\n"),
        frame("break", "condition", "leaves the sequence"),
        frame("rect", "rgb(240, 240, 240)", "a colored background"),
        ["box", "box ${Title}\n\t${}\nend", "declare-group", "participants that belong together"],
      ]),
      ...(branch ? [branch] : []),
      ...(start.blocks.length ? [END] : []),
      option("activate", "keyword", "the participant starts working", "activate "),
      option("deactivate", "keyword", "the participant is done", "deactivate "),
      option("autonumber", "keyword", "numbers the messages"),
      option("create", "keyword", "a participant that appears later", "create participant "),
      option("destroy", "keyword", "the participant's lifeline ends", "destroy "),
      option("title", "keyword", "the diagram's title", "title "),
    ]);
  }
  if (SEQUENCE_KEYWORDS.test(before) || before.includes(":")) return null;
  // After a participant: the messages it can send. Behind a whole arrow the participants come next.
  if (
    (match = before.match(/^[^-<>:]+?\s*((?:<<|-)[-<>x)+]*)$/)) &&
    (cursor.explicit || !SEQUENCE_ARROWS.some((item) => item.label === match![1]))
  )
    return result(cursor.at(match[1].length), SEQUENCE_ARROWS, /^[-<>x)+]*$/);
  if (
    (match = before.match(/^(\S+)\s+$/)) &&
    cursor.elsewhere().some((item) => item.id === match![1])
  )
    return result(cursor.at(0), SEQUENCE_ARROWS, /^[-<>x)+]*$/);
  // After the arrow: the participants.
  if ((match = before.match(/(?:<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*[+-]?\s*(\w*)$/)))
    return result(cursor.at(match[1].length), ids());
  return null;
}

/** The completions at the cursor of a Mermaid source of a type; null where nothing is to offer. */
export function completeUml(
  context: CompletionContext,
  type: Exclude<DiagramType, "tam">,
): CompletionResult | null {
  const { state, pos } = context,
    line = state.doc.lineAt(pos),
    before = line.text.slice(0, pos - line.from).trimStart(),
    start = scanSource(type, state.sliceDoc(0, line.from)).state;
  const cursor: Cursor = {
    type,
    before,
    explicit: context.explicit,
    at: (length) => pos - length,
    start,
    ids() {
      // Without the word being typed, which names nothing yet; the id of a state may hold signs too.
      const word = type === "state" ? '[^:\\s\\-{}"]*' : "[\\p{L}\\p{N}_.]*",
        typed = before.match(new RegExp(`${word}$`, "u"))![0].length,
        rest = line.text.slice(pos - line.from).match(new RegExp(`^${word}`, "u"))![0].length;
      return idsOf(type, state.sliceDoc(0, pos - typed) + state.sliceDoc(pos + rest));
    },
    elsewhere: () => idsOf(type, state.sliceDoc(0, line.from) + state.sliceDoc(line.to)),
    tokens: (head) => scanSource(type, head, start).lines[0],
  };
  let match: RegExpMatchArray | null;
  // Frontmatter says the title; comments and the lines of a note are free text.
  if (start.front === "inside")
    return (match = before.match(/^(\w*)$/)) && (match[1] || context.explicit)
      ? result(pos - match[1].length, [
          option("title", "keyword", "the diagram's title", "title: "),
        ])
      : null;
  if (before.startsWith("%%") || start.directive) return null;
  if (start.prose)
    return start.prose === "note" && (match = before.match(/^([\w ]*)$/)) && match[1]
      ? result(
          pos - match[1].length,
          [option("end note", "keyword", "closes the note")],
          /^[\w ]*$/,
        )
      : null;
  switch (type) {
    case "class":
      return completeClass(cursor);
    case "usecase":
      return completeUsecase(cursor);
    case "flowchart":
    case "swimlane":
      return completeFlow(cursor);
    case "state":
      return completeState(cursor);
    case "sequence":
      return completeSequence(cursor);
  }
}

/** The diagram types by their header lines: what a source starts with. */
const HEADERS: [header: string, template: string, type: string, detail: string][] = [
  ["classDiagram", "classDiagram", "declare-uml-class", "Class diagram"],
  ["usecase-beta", "usecase-beta", "declare-uml-usecase", "Use case diagram"],
  ["flowchart", "flowchart ${TB}", "declare-uml-step", "Activity diagram"],
  ["swimlane-beta", "swimlane-beta ${TB}", "declare-uml-lanes", "Activity with lanes"],
  ["stateDiagram-v2", "stateDiagram-v2", "declare-uml-state", "State machine"],
  ["sequenceDiagram", "sequenceDiagram", "declare-uml-participant", "Sequence diagram"],
];

/** What a source of a type offers at the cursor, whatever is typed there. */
function optionsAt(
  context: CompletionContext,
  type: DiagramType,
  known: Known[],
): CompletionResult | null {
  const { state, pos } = context,
    line = state.doc.lineAt(pos),
    before = line.text.slice(0, pos - line.from).trimStart(),
    word = before.match(/^[\w-]*$/)?.[0],
    own = () => (type === "tam" ? completeTam(context, known) : completeUml(context, type));
  if (word === undefined || (!word && !context.explicit)) return own();
  // Frontmatter and the first statement are the same in every Mermaid syntax; a source without a
  // header yet is read as one of them.
  const above = scanSource(type === "tam" ? "class" : type, state.sliceDoc(0, line.from)).state;
  if (type === "tam" && above.front === "inside") return completeUml(context, "class");
  const first = !above.header && above.front !== "inside";
  if (!first) return own();
  // The header of a source that ends here brings the first line of its statements with it.
  const last = !state.sliceDoc(line.to).trim();
  const headers = HEADERS.map(([label, template, kind, detail]) => ({
    ...filled(last ? `${template}\n\t\${}` : template, { label, type: kind, detail }),
    boost: 1,
  }));
  const title =
    type !== "tam" && above.front === "before"
      ? statements([
          ["title", "---\ntitle: ${Title}\n---", "keyword", "frontmatter: the diagram's title"],
        ])
      : [];
  return result(
    pos - word.length,
    // Behind frontmatter a source is no block diagram.
    [
      ...headers,
      ...title,
      ...(type === "tam" && above.front === "before" ? (own()?.options ?? []) : []),
    ],
    /^[\w-]*$/,
  );
}

/**
 * The completions at the cursor of a source of any type. A block diagram is completed from its
 * elements, the other types from their text. On the first statement line, where the type is still
 * to say, the headers of all types are offered too.
 *
 * Nothing is offered where the text before the cursor is already an option that would write just
 * that text: the list closes, and Enter starts a new line. Asked for, the list shows there too.
 */
export function completeSource(
  context: CompletionContext,
  type: DiagramType,
  known: Known[],
): CompletionResult | null {
  const found = optionsAt(context, type, known);
  if (!found) return null;
  const written = new Set(
    found.options
      .filter((item) => item.apply === undefined || item.apply === item.label)
      .map((item) => item.label),
  );
  if (!context.explicit && written.has(context.state.sliceDoc(found.from, context.pos)))
    return null;
  const { validFor } = found;
  return {
    ...found,
    validFor: (typed, from, to, state) =>
      !written.has(typed) &&
      (validFor instanceof RegExp ? validFor.test(typed) : !!validFor?.(typed, from, to, state)),
  };
}

/**
 * Whether the list opens again right after an option was taken: after a connection, whose other
 * end comes next, and after a keyword that is followed by a name or a value.
 */
export const continues = (completion: Completion): boolean =>
  completion.type === "connection" ||
  completion.label === "[*]" ||
  (typeof completion.apply === "string" && completion.apply.endsWith(" "));
