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
  firstOffer,
  inOrder,
  type Known,
  matching,
  option,
  ranked,
  type Step,
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

/** The types of source whose text the completion reads: all but the block diagram. */
type Mermaid = Exclude<DiagramType, "tam">;

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

const DIRECTION_LINE: Completion = option("direction", "keyword", "TB or LR", "direction ");

const END: Completion = option("end", "keyword", "closes the block");

/** A step that offers a list at a pattern, from the place of the group that is being typed. */
const offering = (pattern: RegExp, group: number, options: (cursor: Cursor) => Completion[]) =>
  matching<Cursor>(pattern, (match, cursor) =>
    result(cursor.at(match[group].length), options(cursor)),
  );

/** The ids of the source, after a word that names one. */
const ids = (cursor: Cursor) => elements(cursor.ids());

/** `for` after `note`: the note belongs to an element. */
const noteFor = (detail: string) =>
  offering(/^note\s+(\w*)$/, 1, () => [option("for", "keyword", detail, "for ")]);

/**
 * The word a line starts with, while the cursor is still in it: the step offers what a line can
 * start with. Past the word the next step tries; on an empty line nothing is offered unless asked.
 */
const atLineStart =
  (
    complete: (word: string, cursor: Cursor) => CompletionResult | null,
    word = WORD,
  ): Step<Cursor> =>
  (cursor) => {
    if (!word.test(cursor.before)) return undefined;
    return cursor.before || cursor.explicit ? complete(cursor.before, cursor) : null;
  };

/** The statements and the ids a line can start with. */
const lineStart = (cursor: Cursor, word: string, list: Completion[], ids = cursor.ids()) =>
  result(cursor.at(word.length), [...ranked(list, 30), ...elements(ids)]);

/** The directions after `direction`. */
const direction = offering(/^direction\s+(\w*)$/, 1, () => DIRECTIONS);

/** Nothing where the line is of a kind: the step ends the search. */
const none =
  (holds: (cursor: Cursor) => boolean): Step<Cursor> =>
  (cursor) =>
    holds(cursor) ? null : undefined;

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

/** A token that names an element, with what stands around it on its line. */
interface Name {
  token: Token;
  tokens: Token[];
  index: number;
  /** The keyword the line starts with; empty where it starts with something else. */
  lead: string;
  /** The token right behind it. */
  next: Token | undefined;
  /** The text in brackets or quotes right behind it, with nothing between. */
  label: string;
  /** Whether the tokenizer reads the token as a declaration. */
  defined: boolean;
}

/**
 * Takes an element in: its id, its kind and its label where the line says one. `declared` says
 * the line says what kind it is, `declares` that the line declares it.
 */
type Add = (
  id: string,
  kind: string,
  label?: string,
  declared?: boolean,
  declares?: boolean,
) => void;

/** The kinds of node of a flowchart by the brackets of their shapes; a rectangle where none fits. */
const FLOW_KINDS: [RegExp, string][] = [
  [/^\{(?!\{)/, "uml-decision"],
  [/^\(\(\(/, "uml-final"],
  [/^\(\(/, "uml-circle"],
  // Rounded, and a stadium.
  [/^\(/, "uml-step"],
];

/** The names of a flowchart, and of an activity with lanes, which have no subgraphs to connect. */
const flowNames =
  (subgraphs: boolean) =>
  ({ token, lead, next, label }: Name, add: Add) => {
    if (lead === "subgraph") {
      // Edges may end at a subgraph, but not at a lane.
      if (subgraphs)
        add(text(token), "group", next?.tag === "string" ? unwrap(next.text) : "", true);
      return;
    }
    const kind = FLOW_KINDS.find(([shape]) => shape.test(label))?.[1] ?? "uml-rect";
    add(token.text, kind, unwrap(label), !!label);
  };

/** The kind of a state by its mark: a choice, a fork or a join, or none. */
const stateKind = (special: string) =>
  special.includes("choice") ? "uml-decision" : /fork|join/.test(special) ? "uml-bar" : "uml-state";

/** How each type takes in the elements its tokens name. */
const NAMES: Record<Mermaid, (name: Name, add: Add) => void> = {
  class: ({ token, lead, label, defined }, add) => {
    if (lead === "namespace") return;
    const name = text(token).replace(/^`|`$/g, "").replace(/~.*$/, "");
    add(name, "uml-class", unwrap(label), false, defined);
  },
  usecase: ({ token, lead, label, defined }, add) => {
    if (lead === "systemBoundary" && defined) return;
    const actor = lead === "actor" && defined;
    add(token.text, actor ? "uml-actor" : "uml-usecase", unwrap(label), actor);
  },
  flowchart: flowNames(true),
  swimlane: flowNames(false),
  state: ({ token, tokens, index, next, defined }, add) => {
    const quoted = defined && tokens[index - 2]?.tag === "string" ? tokens[index - 2].text : "",
      special = next?.tag === "annotation" ? next.text.toLowerCase() : "";
    add(token.text, stateKind(special), unwrap(quoted), !!special, !!special || defined);
  },
  er: ({ token, label, defined }, add) =>
    add(text(token).replace(/^"|"$/g, ""), "uml-class", unwrap(label), false, defined),
  sequence: ({ token, tokens, index, lead, defined }, add) => {
    const alias = tokens[index + 2]?.tag === "string" ? text(tokens[index + 2]) : "";
    add(
      text(token),
      defined && /actor$/.test(lead) ? "uml-actor" : "uml-participant",
      defined ? alias : "",
      defined,
    );
  },
};

/** The names of the tokens of a line. */
function namesOf(tokens: Token[]): Name[] {
  const lead = tokens[0]?.tag === "keyword" ? tokens[0].text : "";
  return tokens.flatMap((token, index) => {
    if (!token.tag.startsWith("variableName")) return [];
    const next = tokens[index + 1],
      label = next?.tag === "string" && next.from === token.to ? next.text : "";
    return [{ token, tokens, index, lead, next, label, defined: token.tag.endsWith("definition") }];
  });
}

/** A mention of an element on a line: whether the line says what kind it is, and whether it declares it. */
interface Mention extends Known {
  line: number;
  says: boolean;
  declares: boolean;
}

/** What a later mention says of an element: its kind and its label, and the line that declares it. */
function learn(known: Named, { kind, label, line, says, declares }: Mention) {
  if (says || (label && !known.label)) known.kind = kind;
  if (label) known.label = label;
  if ((declares || label) && !known.declared) Object.assign(known, { line, declared: true });
}

/** Takes a mention in among the elements found: the first names the element, a later one adds to it. */
function take(found: Map<string, Named>, mention: Mention) {
  const known = found.get(mention.id);
  if (known) return learn(known, mention);
  const { id, kind, label, line, declares } = mention;
  found.set(id, { id, kind, label, line, declared: declares || !!label });
}

/** Takes the elements a line of a number names in among those found. */
const adding =
  (found: Map<string, Named>, line: number): Add =>
  (id, kind, label = "", declared = false, declares = declared) =>
    take(found, { id, kind, label, line, says: declared, declares });

/** The elements a source names, read from the tokens of the text, so a source that does not parse has them too. */
function namedIn(type: DiagramType, source: string): Named[] {
  if (type === "tam") return [];
  const found = new Map<string, Named>(),
    take = NAMES[type];
  scanSource(type, source).lines.forEach((tokens, index) => {
    const add = adding(found, index + 1);
    for (const name of namesOf(tokens)) take(name, add);
  });
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

/** The members of a class, each written with a visibility: `sign`, where none is typed yet. */
const members = (sign: string) =>
  statements([
    ["attribute", `${sign}\${name}: \${Type}`, "uml-attribute", "an attribute of the class"],
    ["method", `${sign}\${name}(\${})`, "uml-method", "an operation of the class"],
    ["method with result", `${sign}\${name}(\${}) \${Type}`, "uml-method", "returns a value"],
    ["static method", `${sign}\${name}(\${})$`, "uml-method", "underlined: a static operation"],
    ["abstract method", `${sign}\${name}(\${})*`, "uml-method", "italic: an abstract operation"],
  ]);

/** Inside the braces of a class: its members. */
function memberOptions(cursor: Cursor): CompletionResult | null {
  const match = cursor.before.match(/^([+\-#~]?)(\w*)$/);
  if (!match || (!match[0] && !cursor.explicit)) return null;
  const [, sign, name] = match;
  return result(cursor.at(name.length), [
    ...ranked(members(sign ? "" : "+"), 30),
    ...(sign ? [] : MARKS),
  ]);
}

const CLASS_KEYWORDS =
  /^(class|namespace|note|direction|classDef|style|cssClass|click|callback|link|links)$/;

const CLASS_RELATIONS = arrows([
  ["<|--", "generalization: the left is the general class"],
  ["--|>", "generalization: the right is the general class"],
  ["*--", "composition: the left is the composite"],
  ["o--", "shared aggregation: the left is the aggregate"],
  ["-->", "association, navigable to the right"],
  ["--", "association, navigability unspecified"],
  ["..>", "dependency: the right is the supplier"],
  ["..|>", "realization: the right is the interface"],
  ["<|..", "realization: the left is the interface"],
  ['"1" --> "*"', "association with multiplicities", '"${1:1}" --> "${2:*}" '],
  ["()--", "provided interface in ball notation, named at the left"],
  [":", "a member of the class", ": ${member}"],
]);

const CLASSES = statements([
  ["class", "class ${Name} {\n\t${}\n}", "declare-uml-class", "a class with members"],
  [
    "interface",
    "class ${Name} {\n\t<<interface>>\n\t${}\n}",
    "declare-uml-class",
    "a class marked «interface»",
  ],
]);

const CLASS_STATEMENTS = [
  ...CLASSES,
  ...statements([
    ["namespace", "namespace ${Name} {\n\t${}\n}", "declare-package", "a package of classes"],
    ["note", 'note "${text}"', "declare-uml-note", "a note"],
    ["note for", 'note for ${Class} "${text}"', "declare-uml-note", "a note at a class"],
  ]),
  DIRECTION_LINE,
];

/** The steps of completing a class diagram, in the order they are tried. */
const CLASS_STEPS: Step<Cursor>[] = [
  matching(/<<(\w*)$/, (match, cursor) =>
    cursor.start.body || /^(class\s|<<)/.test(cursor.before)
      ? result(cursor.at(match[1].length), ANNOTATIONS)
      : undefined,
  ),
  (cursor) => (cursor.start.body ? memberOptions(cursor) : undefined),
  direction,
  noteFor("the note belongs to a class"),
  offering(/^note\s+for\s+([\p{L}\p{N}_.]*)$/u, 1, ids),
  // A namespace only declares its classes.
  atLineStart((word, cursor) =>
    cursor.start.blocks.at(-1) === "namespace"
      ? lineStart(cursor, word, CLASSES, [])
      : lineStart(cursor, word, CLASS_STATEMENTS),
  ),
  // After a class: the relations it can have. Behind a whole relation and a space the classes are offered instead.
  matching(/^(`[^`]+`|[\p{L}\p{N}_.~]+)(\s+"[^"]*")?(\s*)([-.<|>*o():]*)$/u, (match, cursor) =>
    !CLASS_KEYWORDS.test(match[1]) && (match[3] || /^[^o]/.test(match[4]))
      ? result(cursor.at(match[4].length), CLASS_RELATIONS, /^[-.<|>*o():]*$/)
      : undefined,
  ),
  // After a relation: the classes.
  matching(
    /(?:--|\.\.)(?:\|>|\*|>|\(\)|o(?=\s))?\s*(?:"[^"]*"\s*)?([\p{L}\p{N}_.]*)$/u,
    (match, cursor) =>
      cursor.before.includes(":")
        ? undefined
        : result(cursor.at(match[1].length), ids(cursor), /^[\p{L}\p{N}_.]*$/u),
  ),
];

/** An entity as an option: a name with spaces is written in quotes. */
const entity = (item: Known): Completion => ({
  ...element(item),
  ...(/^[\p{L}_][\p{L}\p{N}_-]*$/u.test(item.id) ? {} : { apply: `"${item.id}"` }),
  detail: (item.label !== item.id && item.label) || "entity",
});

const ER_RELATIONS = arrows([
  ["||--o{", "one to zero or more"],
  ["||--|{", "one to one or more"],
  ["}o--||", "zero or more to one"],
  ["}|--||", "one or more to one"],
  ["||--||", "one to one"],
  ["||--o|", "one to zero or one"],
  ["|o--o{", "zero or one to zero or more"],
  ["}o--o{", "zero or more to zero or more"],
  ["}|--|{", "one or more to one or more"],
  ["||..o{", "one to zero or more, not identifying"],
  ["}o..||", "zero or more to one, not identifying"],
  ["|o..o|", "zero or one to zero or one, not identifying"],
  ["}o..o{", "zero or more to zero or more, not identifying"],
]);

/** The cardinality behind the line of a relationship: how many of the second entity. */
const ER_ENDS = ranked(
  [
    option("o{", "connection", "zero or more", "o{ "),
    option("|{", "connection", "one or more", "|{ "),
    option("||", "connection", "exactly one", "|| "),
    option("o|", "connection", "zero or one", "o| "),
  ],
  20,
);

const ER_TYPES = ranked(
  [
    ["string", "text"],
    ["int", "a whole number"],
    ["decimal", "a number with a fixed scale"],
    ["float", "a floating point number"],
    ["boolean", "true or false"],
    ["date", "a day"],
    ["datetime", "a day and a time"],
    ["timestamp", "a moment"],
    ["uuid", "a generated identifier"],
    ["text", "long text"],
    ["json", "structured data"],
  ].map(([name, detail]) => option(name, "constant", detail, `${name} `)),
  20,
);

/** What a line inside the braces of an entity starts with: the types, then whole attributes. */
const ER_ATTRIBUTES = [
  ...ER_TYPES,
  ...ranked(
    statements([
      ["attribute", "${type} ${name}", "uml-attribute", "an attribute of the entity type"],
      ["primary key", "${type} ${name} PK", "uml-attribute", "a primary key attribute"],
      [
        "foreign key",
        "${type} ${name} FK",
        "uml-attribute",
        "references another entity type's key",
      ],
    ]),
    5,
  ),
];

const ER_KEYS = ranked(
  [
    option("PK", "keyword", "primary key"),
    option("FK", "keyword", "foreign key"),
    option("UK", "keyword", "unique key"),
  ],
  20,
);

const ER_STATEMENTS = ranked(
  [
    ...statements([
      ["entity", "${NAME} {\n\t${}\n}", "declare-uml-class", "an entity with attributes"],
      [
        "entity with alias",
        '${id}["${Name}"] {\n\t${}\n}',
        "declare-uml-class",
        "an entity shown under another name",
      ],
      [
        "relationship",
        "${A} ||--o{ ${B} : ${label}",
        "connection",
        "one-to-many: one of the first, zero or more of the second",
      ],
    ]),
    DIRECTION_LINE,
  ],
  30,
);

const ER_KEYWORDS = /^(direction|classDef|class|style|linkStyle|click|callback|link)$/;

const ER_WORD = /^[\p{L}\p{N}_.-]*$/u;

/** The entities as options. */
const entities = (cursor: Cursor) => inOrder(cursor.ids().map(entity));

/** Inside the braces of an entity: its attributes, each a type, a name and its keys. */
const ATTRIBUTE_STEPS: Step<Cursor>[] = [
  matching(/^([^\s,"]*)$/, (match, cursor) =>
    match[1] || cursor.explicit
      ? result(cursor.at(match[1].length), ER_ATTRIBUTES, /^[^\s,"]*$/)
      : null,
  ),
  // After the type and the name: the keys, several with commas between.
  matching(/^[^\s,"]+\s+[^\s,"]+\s+(?:(?:PK|FK|UK)\s*,\s*)*([A-Z]*)$/, (match, cursor) =>
    match[1] || cursor.explicit || /,\s*$/.test(cursor.before)
      ? result(cursor.at(match[1].length), ER_KEYS, /^[A-Z]*$/)
      : null,
  ),
];

/** The steps of completing an entity relationship diagram, in the order they are tried. */
const ER_STEPS: Step<Cursor>[] = [
  (cursor) => (cursor.start.body ? firstOffer(ATTRIBUTE_STEPS, cursor) : undefined),
  direction,
  atLineStart(
    (word, cursor) =>
      result(cursor.at(word.length), [...ER_STATEMENTS, ...entities(cursor)], ER_WORD),
    ER_WORD,
  ),
  none((cursor) => cursor.before.includes(":")),
  // Behind the line of a relationship: the cardinality of its second end, then the entities.
  matching(/(?:--|\.\.)([|o{]?)$/, (match, cursor) =>
    result(cursor.at(match[1].length), ER_ENDS, /^[|o{]*$/),
  ),
  matching(/(?:--|\.\.)(?:\|\||o\||\|\{|o\{)\s*("?[\p{L}\p{N}_-]*)$/u, (match, cursor) =>
    result(cursor.at(match[1].length), entities(cursor), /^"?[\p{L}\p{N}_ -]*"?$/u),
  ),
  // After an entity: the relationships it can have.
  matching(/^("[^"]+"|[\p{L}\p{N}_][\p{L}\p{N}_.-]*)\s+([|o}.-]*)$/u, (match, cursor) =>
    ER_KEYWORDS.test(match[1])
      ? undefined
      : result(cursor.at(match[2].length), ER_RELATIONS, /^[|o{}.-]*$/),
  ),
];

const USECASE_RELATIONS = arrows([
  ["-->", "association: the actor participates in the use case"],
  ["--", "undirected association"],
  ["..> : include", "always incorporates the included use case"],
  ["..> : extend", "conditionally extends the extended use case"],
  ["--|>", "generalization: specializes the right"],
  ["-- text -->", "association with a name", "-- ${text} --> "],
]);

const USECASES = statements([
  [
    "use case",
    "${id}(${Name})",
    "declare-uml-usecase",
    "behavior of the subject with a result for an actor",
  ],
]);

const USECASE_STATEMENTS = [
  ...statements([
    [
      "actor",
      "actor ${Name}",
      "declare-uml-actor",
      "a human or system role external to the subject",
    ],
  ]),
  ...USECASES,
  ...statements([
    [
      "systemBoundary",
      "systemBoundary ${id}[${Name}]\n\t${}\nend",
      "declare-group",
      "the subject that owns its use cases",
    ],
    ["note for", "note for ${id} ${text}", "declare-uml-note", "a note at an element"],
  ]),
  DIRECTION_LINE,
];

/** The steps of completing a use case diagram, in the order they are tried. */
const USECASE_STEPS: Step<Cursor>[] = [
  direction,
  noteFor("the note belongs to an element"),
  offering(/^note\s+for\s+(\w*)$/, 1, ids),
  // Inside a system boundary: its use cases; relations go outside.
  atLineStart((word, cursor) =>
    cursor.start.blocks.length
      ? lineStart(cursor, word, [...USECASES, END], [])
      : lineStart(cursor, word, USECASE_STATEMENTS),
  ),
  none((cursor) =>
    /^(actor|systemBoundary|direction|note|class|classDef|style)\s/.test(cursor.before),
  ),
  offering(/\.\.>\s*:\s*(\w*)$/, 1, () => [
    option("include", "keyword", "always incorporates the included use case", "include "),
    option("extend", "keyword", "conditionally extends the extended use case", "extend "),
  ]),
  // After a relation: the elements; a use case includes and extends use cases only.
  offering(/\.\.>\s*:\s*(?:include|extend)\s+(\w*)$/, 1, (cursor) =>
    elements(cursor.ids().filter((item) => item.kind === "uml-usecase")),
  ),
  offering(/(?:--+\|?>\s*|(?:<--+|--+[ox]?)\s+)(\w*)$/, 1, ids),
  // After an element: the relations of the syntax. Behind a label only when asked or begun.
  matching(/^\w+(\s*(?:\([^)]*\)|\[[^\]]*\]))?\s+([-.<>|ox]*)$/, (match, cursor) =>
    !match[1] || match[2] || cursor.explicit
      ? result(cursor.at(match[2].length), USECASE_RELATIONS, /^[-.<>|ox]*$/)
      : undefined,
  ),
];

const FLOW_EDGES = arrows([
  ["-->", "control flow to the next node"],
  ["-->|text|", "flow with a text, a guard after a decision node", "-->|${text}| "],
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
  ["{", "}", "uml-decision", "diamond: a decision or merge node"],
  ["((", "))", "uml-circle", "circle: the initial node where flows only leave"],
  ["(((", ")))", "uml-final", "double circle: the activity final node"],
  ["([", "])", "uml-stadium", "stadium"],
  ["[(", ")]", "uml-cylinder", "cylinder: an object node, a data store"],
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

/** The statements of a flowchart, or of an activity with lanes, whose actions are rounded. */
function flowStatements(lanes: boolean): Completion[] {
  const [open, close] = lanes ? ["(", ")"] : ["[", "]"];
  return statements([
    lanes
      ? [
          "subgraph",
          "subgraph ${Lane}\n\t${}\nend",
          "declare-group",
          "a lane: an activity partition of one agent",
        ]
      : [
          "subgraph",
          "subgraph ${id} [${Title}]\n\t${}\nend",
          "declare-group",
          "a group of activity nodes",
        ],
    ["action", `\${id}${open}\${Text}${close}`, "declare-uml-step", "an action node"],
    ["decision", "${id}{${Question}}", "declare-uml-decision", "a decision node"],
    ["initial", "${start}((${Start}))", "declare-uml-circle", "the initial node"],
    ["final", "${stop}(((${End})))", "declare-uml-final", "the activity final node"],
  ]);
}

/** Whether a token ends a node: its id, a mark behind it, or its shape. */
const endsNode = (last: Token) =>
  last.tag.startsWith("variableName") ||
  last.tag === "atom" ||
  last.tag === "meta" ||
  (last.tag === "string" && /^[^|].*[)\]}]$/.test(last.text));

/** Whether a token ends an edge: its arrow, its text between bars, or the `&` of another node. */
const endsEdge = (last: Token) =>
  last.tag === "operator" ||
  (last.tag === "string" && /^\|.*\|$/.test(last.text)) ||
  (last.tag === "punctuation" && last.text === "&");

/** After a node: the edges; after a node the source has not drawn yet, its shapes first. */
function edgesAfter(cursor: Cursor, last: Token, typed: string): CompletionResult | null {
  const fresh =
    last.tag === "variableName" &&
    !typed &&
    !cursor.elsewhere().some((item) => item.id === last.text);
  return result(
    cursor.at(typed.length),
    fresh ? [...SHAPE_OPTIONS, ...FLOW_EDGES] : FLOW_EDGES,
    /^[-=.~<>ox|&]*$/,
  );
}

/** What is being typed in a chain: the signs of an edge, or a word; and the part of the line before it. */
function typedPart(before: string) {
  const symbols = before.match(/[-=.~<>|&]*$/)![0],
    letters = symbols ? "" : before.match(/[\p{L}\p{N}_]*$/u)![0];
  return {
    symbols,
    letters,
    head: before.slice(0, before.length - symbols.length - letters.length),
  };
}

/** Inside a chain of nodes and edges: by the token before what is being typed, the edges or the nodes. */
function flowChain(cursor: Cursor): CompletionResult | null {
  const { symbols, letters, head } = typedPart(cursor.before),
    tokens = cursor.tokens(head),
    last = tokens.at(-1);
  if (!last || tokens[0].tag === "keyword") return null;
  if (endsNode(last) && (symbols || (/\s$/.test(head) && /^[ox]?$/.test(letters))))
    return edgesAfter(cursor, last, symbols + letters);
  // After an edge: the nodes.
  if (endsEdge(last) && !symbols) return result(cursor.at(letters.length), ids(cursor));
  return null;
}

/** On the header line: the direction behind the header. */
function headerDirection(cursor: Cursor): CompletionResult | null | undefined {
  if (cursor.start.header) return undefined;
  const match = cursor.before.match(/^(?:flowchart(?:-elk)?|graph|swimlane-beta)\s+(\w*)$/);
  return match ? result(cursor.at(match[1].length), DIRECTIONS) : null;
}

/** The steps of completing a flowchart, and an activity with lanes, in the order they are tried. */
const FLOW_STEPS: Step<Cursor>[] = [
  headerDirection,
  direction,
  atLineStart((word, cursor) =>
    lineStart(cursor, word, [
      ...flowStatements(cursor.type === "swimlane"),
      DIRECTION_LINE,
      ...(cursor.start.blocks.length ? [END] : []),
    ]),
  ),
  flowChain,
];

const STATE_KEYWORDS = /^(state|note|direction|hide|scale|class|classDef|style)$/i;

const STATE_WORD = /^[\w[*\]]*$/;

const STATE_STATEMENTS = [
  ...statements([
    ["state", 'state "${Name}" as ${id}', "declare-uml-state", "a state with its name"],
    [
      "composite",
      "state ${id} {\n\t${}\n}",
      "declare-uml-state",
      "a composite state with substates",
    ],
    [
      "choice",
      "state ${id} <<choice>>",
      "declare-uml-decision",
      "choice pseudostate: guards select the transition",
    ],
    [
      "fork",
      "state ${id} <<fork>>",
      "declare-uml-bar",
      "fork pseudostate: splits into concurrent transitions",
    ],
    [
      "join",
      "state ${id} <<join>>",
      "declare-uml-bar",
      "join pseudostate: synchronizes concurrent transitions",
    ],
    ["note", "note right of ${id} : ${text}", "declare-uml-note", "a note beside a state"],
  ]),
  over("[*]", "uml-circle", "the initial pseudostate", "[*] --> ", "]"),
  DIRECTION_LINE,
];

/** The start of a line of a state machine: a declaration, or the state a transition leaves. */
function stateLineStart(match: RegExpMatchArray, cursor: Cursor): CompletionResult | null {
  if (!match[1] && !cursor.explicit) return null;
  return result(
    cursor.at(match[1].length),
    [
      ...ranked(
        [
          ...STATE_STATEMENTS,
          ...(cursor.start.blocks.length
            ? [option("--", "keyword", "another orthogonal region, below")]
            : []),
        ],
        30,
      ),
      ...ids(cursor),
    ],
    STATE_WORD,
  );
}

/** After a state: its transition, or, but for the initial state, what it does. */
const stateFollowers = (state: string) =>
  arrows([
    ["-->", "transition to another state"],
    ...(state === "[*]"
      ? []
      : ([[":", "internal behavior: entry / action", ": ${description}"]] as [
          string,
          string,
          string,
        ][])),
  ]);

/** The steps of completing a state machine, in the order they are tried. */
const STATE_STEPS: Step<Cursor>[] = [
  direction,
  matching(/^note\s+(?:left|right)\s+of\s+([^\s:\-{}"]*)$/i, (match, cursor) =>
    result(cursor.at(match[1].length), ids(cursor), /^[^\s:\-{}"]*$/),
  ),
  matching(/^note\s+([\w ]*)$/i, (match, cursor) =>
    result(
      cursor.at(match[1].length),
      ranked(
        [
          option("left of", "keyword", "a note at the left of a state", "left of "),
          option("right of", "keyword", "a note at the right of a state", "right of "),
        ],
        9,
      ),
      /^[\w ]*$/,
    ),
  ),
  offering(/^state\s+\S+\s+<<(\w*)$/, 1, () => [
    option("choice", "constant", "choice pseudostate: guards select the transition", "choice>>"),
    option("fork", "constant", "fork pseudostate: splits into concurrent transitions", "fork>>"),
    option("join", "constant", "join pseudostate: synchronizes concurrent transitions", "join>>"),
  ]),
  matching(/^([\w[*]*)$/, stateLineStart),
  none((cursor) => STATE_KEYWORDS.test(cursor.before.match(/^\S+/)?.[0] ?? "")),
  // After a transition and its target: what triggers it.
  matching(/-->\s*(?:\[\*\]|[^:\s\-{}"]+)\s+(:?)$/, (match, cursor) =>
    result(
      cursor.at(match[1].length),
      arrows([[":", "trigger [guard] / effect", ": ${event}"]]),
      /^:?$/,
    ),
  ),
  // After the arrow: the states it can reach.
  matching(/-->\s*([^:\s\-{}"]*)$/, (match, cursor) =>
    result(
      cursor.at(match[1].length),
      [...ids(cursor), { ...over("[*]", "uml-final", "a final state", "[*]", "]"), boost: -61 }],
      /^[^:\s\-{}"]*$/,
    ),
  ),
  // After a state: its transition, or what it does.
  matching(/^(\[\*\]|[^:\s\-{}"]+)(\s*)([-:>]*)$/, (match, cursor) =>
    match[2] || match[3]
      ? result(cursor.at(match[3].length), stateFollowers(match[1]), /^[-:>]*$/)
      : undefined,
  ),
];

const SEQUENCE_KEYWORDS =
  /^(loop|alt|opt|par|critical|break|rect|else|and|option|box|title|note|autonumber|links?|properties|details|participant|actor|create)\s/i;

const SEQUENCE_ARROWS = arrows([
  ["->>", "synchronous message: the sender blocks for the reply", "->>"],
  ["-->>", "reply message, dashed", "-->>"],
  ["-)", "asynchronous message: the sender does not block", "-)"],
  ["--)", "asynchronous reply, dashed", "--)"],
  ["->>+", "synchronous message that activates the receiver", "->>+"],
  ["-->>-", "reply that ends the sender's activation", "-->>-"],
  ["-x", "lost message", "-x"],
  ["--x", "dashed lost message", "--x"],
  ["->", "line without an arrowhead", "->"],
  ["-->", "dashed line without an arrowhead", "-->"],
  ["<<->>", "messages both ways", "<<->>"],
  ["<<-->>", "dashed messages both ways", "<<-->>"],
]);

/** The fragments that frame messages, by the keyword of the block the cursor is in. */
const BRANCHES: Record<string, Completion> = {
  alt: option("else", "keyword", "the next operand of alt", "else "),
  par: option("and", "keyword", "the next concurrent operand", "and "),
  critical: option("option", "keyword", "the operand for a failure", "option "),
};

/** A fragment to fill in: its keyword and guard, a first operand, and the operands after it. */
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

const SEQUENCE_STATEMENTS = statements([
  [
    "participant",
    "participant ${id} as ${Name}",
    "declare-uml-participant",
    "a lifeline under a head box",
  ],
  ["actor", "actor ${id} as ${Name}", "declare-uml-actor", "a lifeline of a human agent"],
  ["note", "note over ${id}: ${text}", "declare-uml-note", "a note at a lifeline"],
  frame("alt", "condition", "alternative operands, chosen by guard", "else\n\t${}\n"),
  frame("opt", "condition", "one operand, executed if its guard holds"),
  frame("loop", "condition", "operand repeated while its guard holds"),
  frame("par", "action", "concurrent operands", "and ${action}\n\t${}\n"),
  frame("critical", "action", "atomic region", "option ${failure}\n\t${}\n"),
  frame("break", "condition", "replaces the rest of the enclosing interaction"),
  frame("rect", "rgb(240, 240, 240)", "a colored background"),
  ["box", "box ${Title}\n\t${}\nend", "declare-group", "a frame grouping participants"],
]);

/** The keywords of a sequence diagram that stand behind its statements in the list. */
const SEQUENCE_KEYWORD_OPTIONS = [
  option("activate", "keyword", "starts an execution specification", "activate "),
  option("deactivate", "keyword", "ends the execution specification", "deactivate "),
  option("autonumber", "keyword", "numbers the messages"),
  option("create", "keyword", "a participant created by a later message", "create participant "),
  option("destroy", "keyword", "the participant's lifeline ends", "destroy "),
  option("title", "keyword", "the diagram's title", "title "),
];

/** The start of a line of a sequence diagram; inside a fragment its next operand and its end too. */
function sequenceLineStart(word: string, cursor: Cursor): CompletionResult | null {
  const { blocks } = cursor.start,
    branch = BRANCHES[blocks.at(-1) ?? ""];
  return lineStart(cursor, word, [
    ...SEQUENCE_STATEMENTS,
    ...(branch ? [branch] : []),
    ...(blocks.length ? [END] : []),
    ...SEQUENCE_KEYWORD_OPTIONS,
  ]);
}

/** The steps of completing a sequence diagram, in the order they are tried. */
const SEQUENCE_STEPS: Step<Cursor>[] = [
  matching(/^note\s+(?:left\s+of|right\s+of|over)\s+(?:[^:,]+,\s*)?([^:,\s]*)$/i, (match, cursor) =>
    result(cursor.at(match[1].length), ids(cursor), /^[^:,\s]*$/),
  ),
  matching(/^note\s+([\w ]*)$/i, (match, cursor) =>
    result(
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
    ),
  ),
  matching(/^(?:activate|deactivate|destroy)\s+(\S*)$/, (match, cursor) =>
    result(cursor.at(match[1].length), ids(cursor), /^\S*$/),
  ),
  offering(/^create\s+(\w*)$/, 1, () => [
    option("participant", "keyword", "created by the next message to it", "participant "),
    option("actor", "keyword", "created by the next message to it", "actor "),
  ]),
  atLineStart(sequenceLineStart),
  none((cursor) => SEQUENCE_KEYWORDS.test(cursor.before) || cursor.before.includes(":")),
  // After a participant: the messages it can send. Behind a whole arrow the participants come next.
  matching(/^[^-<>:]+?\s*((?:<<|-)[-<>x)+]*)$/, (match, cursor) =>
    cursor.explicit || !SEQUENCE_ARROWS.some((item) => item.label === match[1])
      ? result(cursor.at(match[1].length), SEQUENCE_ARROWS, /^[-<>x)+]*$/)
      : undefined,
  ),
  matching(/^(\S+)\s+$/, (match, cursor) =>
    cursor.elsewhere().some((item) => item.id === match[1])
      ? result(cursor.at(0), SEQUENCE_ARROWS, /^[-<>x)+]*$/)
      : undefined,
  ),
  // After the arrow: the participants.
  offering(/(?:<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*[+-]?\s*(\w*)$/, 1, ids),
];

/** The steps of completing each Mermaid type. */
const STEPS: Record<Mermaid, Step<Cursor>[]> = {
  class: CLASS_STEPS,
  usecase: USECASE_STEPS,
  flowchart: FLOW_STEPS,
  swimlane: FLOW_STEPS,
  state: STATE_STEPS,
  sequence: SEQUENCE_STEPS,
  er: ER_STEPS,
};

/** Inside frontmatter: its title. */
function frontmatterTitle(cursor: Cursor): CompletionResult | null | undefined {
  if (cursor.start.front !== "inside") return undefined;
  const match = cursor.before.match(/^(\w*)$/);
  return match && (match[1] || cursor.explicit)
    ? result(cursor.at(match[1].length), [
        option("title", "keyword", "the diagram's title", "title: "),
      ])
    : null;
}

/** Inside the lines of a note: the line that closes it. The lines of a description have none. */
function noteEnd(cursor: Cursor): CompletionResult | null | undefined {
  if (!cursor.start.prose) return undefined;
  const match = cursor.before.match(/^([\w ]*)$/);
  return cursor.start.prose === "note" && match?.[1]
    ? result(
        cursor.at(match[1].length),
        [option("end note", "keyword", "closes the note")],
        /^[\w ]*$/,
      )
    : null;
}

/** Frontmatter says the title; comments and the lines of a note are free text. */
const FREE_TEXT: Step<Cursor>[] = [
  frontmatterTitle,
  none((cursor) => cursor.before.startsWith("%%") || cursor.start.directive),
  noteEnd,
];

/** The place of the cursor in a Mermaid source of a type. */
function cursorAt(context: CompletionContext, type: Mermaid): Cursor {
  const { state, pos } = context,
    line = state.doc.lineAt(pos),
    before = line.text.slice(0, pos - line.from).trimStart(),
    start = scanSource(type, state.sliceDoc(0, line.from)).state;
  return {
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
}

/** The completions at the cursor of a Mermaid source of a type; null where nothing is to offer. */
function completeUml(context: CompletionContext, type: Mermaid): CompletionResult | null {
  return firstOffer(
    [...FREE_TEXT, (cursor) => firstOffer(STEPS[type], cursor)],
    cursorAt(context, type),
  );
}

/** The diagram types by their header lines: what a source starts with. */
const HEADERS: [header: string, template: string, type: string, detail: string][] = [
  ["classDiagram", "classDiagram", "declare-uml-class", "Class diagram"],
  ["usecase-beta", "usecase-beta", "declare-uml-usecase", "Use case diagram"],
  ["flowchart", "flowchart ${TB}", "declare-uml-step", "Activity diagram"],
  ["swimlane-beta", "swimlane-beta ${TB}", "declare-uml-lanes", "Activity diagram with lanes"],
  ["stateDiagram-v2", "stateDiagram-v2", "declare-uml-state", "State machine"],
  ["sequenceDiagram", "sequenceDiagram", "declare-uml-participant", "Sequence diagram"],
  ["erDiagram", "erDiagram", "declare-uml-class", "Entity relationship diagram"],
];

const FRONTMATTER = statements([
  ["title", "---\ntitle: ${Title}\n---", "keyword", "frontmatter: the diagram's title"],
]);

/**
 * The first statement line of a source, where the word at the cursor starts it: the headers of all
 * types, frontmatter with a title before any, and in a block diagram what its own notation offers.
 */
function firstLine(
  context: CompletionContext,
  type: DiagramType,
  word: string,
  above: SyntaxState,
  own: () => CompletionResult | null,
): CompletionResult | null {
  const { state, pos } = context,
    fresh = above.front === "before",
    // The header of a source that ends here brings the first line of its statements with it.
    last = !state.sliceDoc(state.doc.lineAt(pos).to).trim();
  const headers = HEADERS.map(([label, template, kind, detail]) => ({
    ...filled(last ? `${template}\n\t\${}` : template, { label, type: kind, detail }),
    boost: 1,
  }));
  return result(
    pos - word.length,
    // Behind frontmatter a source is no block diagram.
    [
      ...headers,
      ...(type !== "tam" && fresh ? FRONTMATTER : []),
      ...(type === "tam" && fresh ? (own()?.options ?? []) : []),
    ],
    /^[\w-]*$/,
  );
}

/** The word a line starts with up to the cursor, where nothing else stands before it, and it is typed or asked for. */
function firstWord(context: CompletionContext): string | undefined {
  const line = context.state.doc.lineAt(context.pos),
    word = line.text
      .slice(0, context.pos - line.from)
      .trimStart()
      .match(/^[\w-]*$/)?.[0];
  return word || (word === "" && context.explicit) ? word : undefined;
}

/** What a source of a type offers at the cursor, whatever is typed there. */
function optionsAt(
  context: CompletionContext,
  type: DiagramType,
  known: Known[],
): CompletionResult | null {
  const own = () => (type === "tam" ? completeTam(context, known) : completeUml(context, type)),
    word = firstWord(context);
  if (word === undefined) return own();
  // Frontmatter and the first statement are the same in every Mermaid syntax; a source without a
  // header yet is read as one of them.
  const { state, pos } = context,
    above = scanSource(
      type === "tam" ? "class" : type,
      state.sliceDoc(0, state.doc.lineAt(pos).from),
    ).state;
  if (type === "tam" && above.front === "inside") return completeUml(context, "class");
  if (above.header || above.front === "inside") return own();
  return firstLine(context, type, word, above, own);
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
