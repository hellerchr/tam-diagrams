/**
 * The syntaxes of the source pane: one tokenizer for each diagram type, which colors a source and
 * tells the completion where the cursor stands, and the rules that indent the blocks a syntax nests.
 * A tokenizer reads what the parser of its type accepts; it colors a source, it does not check it.
 */

import {
  getIndentation,
  indentOnInput,
  indentService,
  indentString,
  type IndentContext,
  StreamLanguage,
  type StreamParser,
  StringStream,
} from "@codemirror/language";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { countColumn, type EditorState, type Extension, Prec, type Text } from "@codemirror/state";
import { type Command, EditorView } from "@codemirror/view";
import { ELEMENT_KINDS } from "../src/tam.ts";
import type { DiagramType } from "./types.ts";

/** Where a tokenizer stands in a source: what carries over from line to line, and what it knows of the line it reads. */
export interface SyntaxState {
  /** The frontmatter block before the diagram: not reached, being read, or behind. */
  front: "before" | "inside" | "after";
  /** The header line of the diagram is read. */
  header: boolean;
  /** Inside a `%%{ }%%` directive of several lines. */
  directive: boolean;
  /** Inside lines of plain text: a note of several lines, or a description for screen readers. */
  prose: "" | "note" | "acc";
  /** Inside the braces of a class, where the lines are members. */
  body: boolean;
  /** The open blocks, outermost first, by the keyword that opened each. */
  blocks: string[];
  /** The next token starts a statement. */
  start: boolean;
  /** What the statement of the line is, as far as it is read. */
  phase: string;
  /** Whether an element or a connection comes next in a line of connections. */
  want: "node" | "edge";
  /** The token before was an id, with nothing between: a shape may follow. */
  after: boolean;
  /** The line has a connection. */
  arrow: boolean;
  /** Tokens already measured, as pairs of a length and a tag. */
  plan: (string | number)[];
}

/** A colored piece of a line: where it is, its text, and its tag. */
export interface Token {
  from: number;
  to: number;
  text: string;
  tag: string;
}

const startState = (): SyntaxState => ({
  front: "before",
  header: false,
  directive: false,
  prose: "",
  body: false,
  blocks: [],
  start: true,
  phase: "",
  want: "node",
  after: false,
  arrow: false,
  plan: [],
});

/**
 * A step of a tokenizer: it reads a token and gives its tag, or null for a token without one. It
 * gives undefined where the token is not its to read, and the next step tries.
 */
type Step = (stream: StringStream, state: SyntaxState) => string | null | undefined;

/** What reading a token says of the rest of the line. */
type Then = (state: SyntaxState, stream: StringStream) => void;

/** A token a pattern reads: its tag, and what reading it says of the rest of the line. */
function rule(pattern: RegExp | string, tag: string, then?: Then): Step {
  return (stream, state) => {
    if (!stream.match(pattern)) return undefined;
    then?.(state, stream);
    return tag;
  };
}

/** The steps tried in turn: the first that reads the token reads it. */
function anyOf(steps: Step[]): Step {
  return (stream, state) => {
    for (const step of steps) {
      const tag = step(stream, state);
      if (tag !== undefined) return tag;
    }
    return undefined;
  };
}

/** The statements of a syntax: the steps tried in turn, and a sign that none reads passed over. */
function statements(steps: Step[]): (stream: StringStream, state: SyntaxState) => string | null {
  const read = anyOf(steps);
  return (stream, state) => {
    const tag = read(stream, state);
    if (tag !== undefined) return tag;
    stream.next();
    return null;
  };
}

/** A step taken only where the state allows it. */
function when(holds: (state: SyntaxState) => boolean, step: Step): Step {
  return (stream, state) => (holds(state) ? step(stream, state) : undefined);
}

/** A step taken only in a phase of the statement. */
const inPhase = (phase: string, step: Step): Step => when((state) => state.phase === phase, step);

/** A step taken only where an element, or a connection, comes next. */
const wanting = (want: SyntaxState["want"], step: Step): Step =>
  when((state) => state.want === want, step);

/** A phase that lasts one token: the phase moves on, and the step reads that token if it can. */
function turn(from: string, to: string, step: Step): Step {
  return inPhase(from, (stream, state) => {
    state.phase = to;
    return step(stream, state);
  });
}

/** The first token of a statement: the steps tried where the line starts. */
function atStart(steps: Step[]): Step {
  const read = anyOf(steps);
  return (stream, state) => {
    if (!state.start) return undefined;
    state.start = false;
    return read(stream, state);
  };
}

/** The rest of the line as one token. */
const toEnd =
  (tag: string): Step =>
  (stream) => {
    stream.skipToEnd();
    return tag;
  };

const toPhase =
  (phase: string): Then =>
  (state) => {
    state.phase = phase;
  };

const wants =
  (want: SyntaxState["want"]): Then =>
  (state) => {
    state.want = want;
  };

/** A block opens, by its keyword, and the statement goes on in a phase. */
const enter =
  (block: string, phase: string): Then =>
  (state) => {
    state.blocks.push(block);
    state.phase = phase;
  };

const leave: Then = (state) => {
  state.blocks.pop();
};

/** The brace that closes the body of a class or an entity. */
const closeBody: Then = (state) => {
  state.body = false;
  state.blocks.pop();
};

/** A connection is read: an element comes next. */
const connects: Then = (state) => {
  state.want = "node";
  state.arrow = true;
};

const QUOTED = /^"[^"]*"?/;

const DIRECTION = /^(TB|TD|BT|LR|RL)\b/i;

/** The statements of a few types that only style a picture: colored as a keyword and plain words. */
const NODE_STYLING = /^(classDef|class|style|linkStyle|click|callback|links?)(?=\s)/;

/** The end of a `%%{ }%%` directive. */
const DIRECTIVE_END = /\}%%\s*$/;

/** A note of a state machine without a text on its line: the note is the lines up to `end note`. */
const NOTE_BLOCK = /^\s*note\s+(left|right)\s+of\s+[^:]+$/i;

/** The lines of a frontmatter block: its fences, and keys with their values. */
function frontmatter(stream: StringStream, state: SyntaxState, fence: boolean): string | null {
  if (fence) {
    stream.skipToEnd();
    state.front = state.front === "before" ? "inside" : "after";
    return "meta";
  }
  if (stream.eatSpace()) return null;
  if (state.start) {
    state.start = false;
    const key = stream.match(/^[\w-]+(?=\s*:)/) as RegExpMatchArray | null;
    if (key) return key[0] === "title" ? "keyword" : "propertyName";
  }
  if (stream.eat(":")) return "punctuation";
  stream.skipToEnd();
  return "string";
}

/** The frontmatter block, where a source starts with one. */
function frontLines(stream: StringStream, state: SyntaxState): string | null | undefined {
  const fence = stream.sol() && /^\s*---\s*$/.test(stream.string);
  if (state.front === "inside" || (state.front === "before" && fence))
    return frontmatter(stream, state, fence);
  return undefined;
}

/** Space between tokens, which parts an id from a shape; past it the frontmatter is behind. */
function space(stream: StringStream, state: SyntaxState): null | undefined {
  if (stream.eatSpace()) {
    state.after = false;
    return null;
  }
  state.front = "after";
  return undefined;
}

/** The lines of a directive after its first. */
function directiveLine(stream: StringStream, state: SyntaxState): string | undefined {
  if (!state.directive) return undefined;
  stream.skipToEnd();
  if (DIRECTIVE_END.test(stream.string)) state.directive = false;
  return "meta";
}

/** A comment, or the first line of a directive. A comment is a line of its own: the parsers do not cut one off the end of a statement. */
function comment(stream: StringStream, state: SyntaxState): string | undefined {
  if (!state.start || !stream.match("%%")) return undefined;
  const directive = stream.peek() === "{";
  stream.skipToEnd();
  if (!directive) return "comment";
  state.directive = !DIRECTIVE_END.test(stream.string);
  return "meta";
}

/** A token measured already, by the step that read the piece of the line it is in. */
function planned(stream: StringStream, state: SyntaxState): string | undefined {
  if (!state.plan.length) return undefined;
  const length = state.plan.shift() as number;
  stream.pos = Math.min(stream.string.length, stream.pos + length);
  return state.plan.shift() as string;
}

/** The header line of a type, the first statement of a source; `directed` where a direction follows it. */
function headerLine(header: RegExp, directed: boolean): Step {
  return (stream, state) => {
    if (state.header) return undefined;
    state.header = true;
    if (!stream.match(header)) return undefined;
    state.phase = directed ? "header" : "";
    return "keyword";
  };
}

/** The lines of a note of several lines, and of a description for screen readers. */
function proseLine(stream: StringStream, state: SyntaxState): string | undefined {
  if (!state.prose || state.phase !== "") return undefined;
  if (state.prose === "note" && stream.match(/^end\s+note\b/i)) {
    state.prose = "";
    return "keyword";
  }
  if (state.prose === "acc" && stream.string.includes("}")) state.prose = "";
  stream.skipToEnd();
  return "string";
}

/** Plain words: what follows the keyword of a styling statement. */
function plainWord(stream: StringStream): string | null {
  if (stream.match(QUOTED)) return "string";
  if (!stream.match(/^[\w-]+/)) stream.next();
  return null;
}

/** A statement every Mermaid type has, at the start of a line outside the body of a class or an entity. */
function shared(step: Step): Step {
  return (stream, state) => {
    if (!state.start || state.body) return undefined;
    const tag = step(stream, state);
    if (tag !== undefined) state.start = false;
    return tag;
  };
}

/** A title or a description for screen readers. */
const accessibility = shared(
  rule(/^acc(Title|Descr)(?=\s*[:{])/, "keyword", (state, stream) => {
    state.phase = "colon";
    if (/^\s*accDescr\s*\{[^}]*$/.test(stream.string)) state.prose = "acc";
  }),
);

/** What every Mermaid type reads first, in this order: frontmatter, space, directives, comments, and tokens already measured. */
const MERMAID_LINES: Step[] = [frontLines, space, directiveLine, comment, planned];

/** What the statements of every Mermaid type share, read after the header, in this order. */
const MERMAID_STATEMENTS: Step[] = [
  turn("header", "", anyOf([rule(DIRECTION, "atom"), rule(/^[<>^v](?=\s|;|$)/, "atom")])),
  proseLine,
  accessibility,
  turn("colon", "text", rule(":", "punctuation")),
  inPhase("text", toEnd("string")),
  inPhase("plain", plainWord),
  turn("direction", "plain", rule(DIRECTION, "atom")),
  shared(rule(/^direction(?=\s|$)/, "keyword", toPhase("direction"))),
];

/** What a line starts as: a statement, with nothing of it read. */
const lineStart = (): Partial<SyntaxState> => ({
  start: true,
  phase: "",
  want: "node",
  after: false,
  arrow: false,
  plan: [],
});

/**
 * A tokenizer of a Mermaid syntax: frontmatter, comments, directives, the header and the statements
 * all types share are read here, the statements of the type by `statement`.
 */
function mermaid(
  header: RegExp,
  directed: boolean,
  statement: (stream: StringStream, state: SyntaxState) => string | null,
  electric?: RegExp,
): StreamParser<SyntaxState> {
  const read = anyOf([
    ...MERMAID_LINES,
    headerLine(header, directed),
    ...MERMAID_STATEMENTS,
    statement,
  ]);
  return {
    startState,
    token(stream, state) {
      if (stream.sol()) Object.assign(state, lineStart());
      const from = stream.pos,
        tag = read(stream, state) ?? null;
      // Whatever the line holds, the tokenizer moves on.
      if (stream.pos === from) stream.next();
      return tag;
    },
    languageData: {
      commentTokens: { line: "%%" },
      ...(electric ? { indentOnInput: electric } : {}),
    },
  };
}

/** The marks a Mermaid element may carry after its name: a class, a stereotype, metadata. */
const mark = anyOf([
  rule(/^:::[\w,-]+/, "atom"),
  rule(/^<<[^>]*(>>)?/, "annotation"),
  rule(/^@\{[^}]*\}?/, "meta"),
]);

const CLASS_NAME = /^(`[^`]+`|[\p{L}\p{N}_.]+(~[^~]+~)?)/u;

const CLASS_RELATION = /^(<\||\*|o|<|\(\))?(--|\.\.)(\|>|\*|o|>|\(\))?/;

/** The phase a sign of a member moves to, from the phase it is read in. */
const MEMBER_SIGNS = new Map<string, (phase: string) => string>([
  ["(", () => "member-parameters"],
  [")", () => "member-type"],
  [":", (phase) => (phase === "member-parameters" ? "member-parameter-type" : "member-type")],
  [",", (phase) => (phase === "member-parameter-type" ? "member-parameters" : phase)],
]);

/** The tag of a word of a member in a phase: a type, where the phase is none of these. */
const MEMBER_WORDS = new Map([
  ["member", "propertyName"],
  ["member-parameters", "variableName"],
]);

/** The sign that moves a member on: to its parameters, their types, its type. */
function memberSign(stream: StringStream, state: SyntaxState): string | undefined {
  const next = MEMBER_SIGNS.get(stream.peek() ?? "");
  if (!next) return undefined;
  stream.next();
  state.phase = next(state.phase);
  return "punctuation";
}

/** The start of a member: its visibility. */
function memberStart(stream: StringStream, state: SyntaxState): string | undefined {
  state.start = false;
  state.phase = "member";
  return stream.match(/^[+\-#~]/) ? "modifier" : undefined;
}

/** A member of a class: its visibility, name, parameters and types. */
const member = statements([
  when((state) => state.body, rule("}", "punctuation", closeBody)),
  when((state) => state.phase === "" || state.phase === "member-start", memberStart),
  rule(/^<<[^>]*(>>)?/, "annotation"),
  memberSign,
  // `$` marks a static member and `*` an abstract one, at its end.
  rule(/^[$*](?=\s*\}?\s*$)/, "modifier"),
  rule(/^[~[\]<>]/, "punctuation"),
  (stream, state) =>
    stream.match(/^[\p{L}\p{N}_.]+/u) ? (MEMBER_WORDS.get(state.phase) ?? "typeName") : undefined,
]);

/** The text of a note: quoted text, and the signs between passed over. */
function noteText(stream: StringStream): string | null {
  if (stream.match(QUOTED)) return "string";
  stream.next();
  return null;
}

/** A brace that opens a class, whose lines are members, or a namespace. */
const openClassBlock: Then = (state) => {
  const declared = state.phase === "declare";
  state.blocks.push(declared ? "class" : "namespace");
  if (!declared) return;
  state.body = true;
  state.phase = "";
};

const className = rule(CLASS_NAME, "variableName", wants("edge"));

const classRelation = rule(CLASS_RELATION, "operator", connects);

/** A class or a relation. After a class a relation comes first, so that `o--` is not read as a class named `o`. */
const classElement: Step = (stream, state) =>
  state.want === "node"
    ? (className(stream, state) ?? classRelation(stream, state))
    : (classRelation(stream, state) ?? className(stream, state));

/** The statements of a class diagram: classes with their bodies, namespaces, notes, relations. */
const classStatement = statements([
  when((state) => state.body || state.phase.startsWith("member"), member),
  atStart([
    rule(/^class(?=\s)/, "keyword", toPhase("declare")),
    rule(/^namespace(?=\s)/, "keyword", toPhase("namespace")),
    rule(/^note(?=\s)/, "keyword", toPhase("note")),
    rule(
      /^(classDef|style|linkStyle|cssClass|click|callback|links?|properties|details)\b/,
      "keyword",
      toPhase("plain"),
    ),
  ]),
  rule("{", "punctuation", openClassBlock),
  rule("}", "punctuation", leave),
  mark,
  when(
    (state) => state.phase === "declare" || state.phase === "namespace",
    anyOf([rule(/^\[[^\]]*\]?/, "string"), rule(CLASS_NAME, "variableName.definition")]),
  ),
  turn("note", "note-text", rule(/^for(?=\s)/, "keyword", toPhase("note-for"))),
  inPhase("note-for", rule(/^\S+/, "variableName", toPhase("note-text"))),
  inPhase("note-text", noteText),
  // A quoted text beside a relation is the multiplicity of its end.
  rule(QUOTED, "number"),
  classElement,
  // After a relation its label; after a class alone one of its members.
  rule(":", "punctuation", (state) => {
    state.phase = state.arrow ? "text" : "member-start";
  }),
]);

const STATE_ID = /^[^:\s\-{}"]+/;

/** The statements of a state machine: states, composites, transitions, notes. */
const stateStatement = statements([
  atStart([
    rule(/^state(?=\s)/, "keyword", toPhase("declare")),
    rule(/^note(?=\s)/i, "keyword", (state, stream) => {
      state.phase = "note";
      if (NOTE_BLOCK.test(stream.string)) state.prose = "note";
    }),
    rule(/^hide\s+empty\s+description(?=\s*$)/i, "keyword"),
    rule(/^scale\s+\d+\s+width(?=\s*$)/i, "keyword"),
    rule(NODE_STYLING, "keyword", toPhase("plain")),
    // Two dashes alone divide the regions of a composite state.
    rule(/^--(?=\s*$)/, "punctuation"),
  ]),
  rule("[*]", "atom"),
  rule(/^\[\[\s*\w*\s*\]\]/, "annotation"),
  rule("-->", "operator", (state) => {
    state.arrow = true;
  }),
  rule("{", "punctuation", (state) => state.blocks.push("state")),
  rule("}", "punctuation", leave),
  rule(QUOTED, "string", (state) => {
    if (state.phase === "declare") state.phase = "declare-as";
  }),
  mark,
  inPhase("declare-as", rule(/^as(?=\s)/, "keyword", toPhase("declare"))),
  inPhase("note", rule(/^(left|right)\s+of(?=\s|$)/i, "keyword", toPhase("note-of"))),
  rule(":", "punctuation", toPhase("text")),
  (stream, state) =>
    stream.match(STATE_ID)
      ? state.phase === "declare"
        ? "variableName.definition"
        : "variableName"
      : undefined,
]);

const FLOW_ID = /^[\p{L}\p{N}_!#$%&'*+.`?\\/]+(?:-(?![->.])[\p{L}\p{N}_!#$%&'*+.`?\\/]*)*/u;

/** The brackets of the node shapes with what closes each, longest opening first. */
const FLOW_SHAPES: [string, string[]][] = [
  ["(((", [")))"]],
  ["((", ["))"]],
  ["([", ["])"]],
  ["[[", ["]]"]],
  ["[(", [")]"]],
  ["[/", ["/]", "\\]"]],
  ["[\\", ["\\]", "/]"]],
  ["{{", ["}}"]],
  ["(", [")"]],
  ["[", ["]"]],
  ["{", ["}"]],
  [">", ["]"]],
];

/** An edge with its text inside: `-- text -->`, `== text ==>`, `-. text .->`. */
const FLOW_LABELLED =
  /^([<ox]?(?:--|==|-\.))(?![->.=])\s*([^-=.>|\s][^]*?)\s*(-{2,}[->ox]?|={2,}[=>ox]?|\.+-[>ox]?)(?=\s|$|[\p{L}\p{N}_"])/u;

const FLOW_EDGE = /^[<ox]?(-{2,}|={2,}|-\.+-)[->ox=]?(?=\s|$|\||[\p{L}\p{N}_"])/u;

/** The shape and text right after a node's id, to the bracket that closes it. */
function flowShape(stream: StringStream): boolean {
  for (const [open, closes] of FLOW_SHAPES) {
    if (!stream.match(open)) continue;
    const rest = stream.string.slice(stream.pos),
      quoted = rest.match(/^\s*"[^"]*"/);
    // The earliest closing bracket ends the text, as the parser reads it.
    let end = -1;
    for (const close of closes) {
      const at = rest.indexOf(close, quoted ? quoted[0].length : 0);
      if (at >= 0 && (end < 0 || at + close.length < end)) end = at + close.length;
    }
    stream.pos += end < 0 ? rest.length : end;
    return true;
  }
  return false;
}

/**
 * An edge with a text inside, matched by a pattern of three groups: the start of the edge, the
 * text, its end. The start is the token read; the text and the end are planned behind it.
 */
function labelled(pattern: RegExp, then: Then): Step {
  return (stream, state) => {
    const edge = stream.match(pattern, false) as RegExpMatchArray | null;
    if (!edge) return undefined;
    stream.pos += edge[1].length;
    state.plan = [edge[2].length, "string", edge[3].length, "operator"];
    then(state, stream);
    return "operator";
  };
}

/** A node of a flowchart: its shape may follow it right behind. */
const flowNode = rule(FLOW_ID, "variableName", (state) => {
  state.want = "edge";
  state.after = true;
});

/** What a statement of a flowchart starts with, read before the shape of a node. */
const flowLead = anyOf([
  rule(";", "punctuation", (state) =>
    Object.assign(state, { start: true, phase: "", want: "node" }),
  ),
  atStart([
    rule(/^end(?=\s*(;|$))/, "keyword", leave),
    rule(/^subgraph(?=\s|$)/, "keyword", enter("subgraph", "subgraph")),
    rule(NODE_STYLING, "keyword", toPhase("plain")),
  ]),
  inPhase(
    "subgraph",
    anyOf([
      rule(QUOTED, "string"),
      rule(/^\[[^\]]*\]?/, "string"),
      rule(/^[^\s[]+(?=\s*\[)/, "variableName.definition"),
      rule(/^[^;"[]+?(?=\s*(?:;|$))/, "variableName.definition"),
    ]),
  ),
]);

/** The chain of nodes and edges of a flowchart statement. */
const flowChain = statements([
  mark,
  rule("&", "punctuation", wants("node")),
  wanting("node", flowNode),
  labelled(FLOW_LABELLED, wants("node")),
  rule(/^~{3,}/, "operator", wants("node")),
  rule(FLOW_EDGE, "operator", wants("node")),
  rule(/^\|[^|]*\|?/, "string"),
  flowNode,
]);

/** The statements of a flowchart and of an activity with lanes: subgraphs, and chains of nodes and edges. */
function flowStatement(stream: StringStream, state: SyntaxState): string | null {
  const after = state.after;
  state.after = false;
  const lead = flowLead(stream, state);
  if (lead !== undefined) return lead;
  return after && flowShape(stream) ? "string" : flowChain(stream, state);
}

const SEQUENCE_ARROW = /^(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)/;

const SEQUENCE_MESSAGE =
  /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:>)-][^:]*?)\s*(?::(.*))?$/;

const SEQUENCE_COLOR =
  /^(rgba?\([^)]*\)|#[0-9a-f]{3,8}|transparent|aqua|black|blue|fuchsia|gray|grey|green|lime|maroon|navy|olive|purple|red|silver|teal|white|yellow|orange|pink|lightblue|lightgreen|lightgrey|lightgray|lightyellow|beige|ivory|lavender|wheat|tan|khaki|coral|salmon|gold|cyan|magenta)\b/i;

/** A fragment that frames messages, or the keyword of its next operand. */
function fragment(stream: StringStream, state: SyntaxState): string | undefined {
  const block = stream.match(
    /^(loop|alt|opt|par|critical|break|rect|else|and|option)(?=\s|$)/,
  ) as RegExpMatchArray | null;
  if (!block) return undefined;
  if (!/^(else|and|option)$/.test(block[1])) state.blocks.push(block[1]);
  state.phase = block[1] === "rect" ? "color" : "text";
  return "keyword";
}

/** A message, its sender read as the token, its arrow, activation sign and receiver planned behind it. */
function message(stream: StringStream, state: SyntaxState, line: RegExpMatchArray): string {
  const [, from, arrow, sign, to] = line;
  state.plan = [
    ...[arrow.length, "operator"],
    ...(sign ? [1, "modifier"] : []),
    ...[to.length, "variableName"],
  ];
  state.phase = "colon";
  state.arrow = true;
  stream.pos += from.length;
  return "variableName";
}

/** A line that reads as a message is one, whatever word it starts with; else it may be a fragment. */
function messageOrFragment(stream: StringStream, state: SyntaxState): string | undefined {
  const line = stream.string.slice(stream.pos).match(SEQUENCE_MESSAGE);
  return line ? message(stream, state, line) : fragment(stream, state);
}

/** The statements of a sequence diagram: participants, messages, notes, and the fragments that frame them. */
const sequenceStatement = statements([
  atStart([
    rule(/^(create\s+)?(participant|actor)(?=\s)/, "keyword", toPhase("participant")),
    rule(/^(destroy|activate|deactivate)(?=\s)/, "keyword", toPhase("ids")),
    rule(/^box(?=\s|$)/, "keyword", enter("box", "box")),
    rule(/^end(?=\s*$)/, "keyword", leave),
    rule(/^note(?=\s)/i, "keyword", toPhase("note")),
    rule(/^autonumber(?=\s|$)/, "keyword", toPhase("autonumber")),
    rule(/^title(?=\s|:)/, "keyword", toPhase("colon")),
    rule(/^(links?|properties|details)(?=\s)/, "keyword", toPhase("plain")),
    messageOrFragment,
  ]),
  turn("participant", "alias", rule(/^.+?(?=\s+as\s|\s*$)/, "variableName.definition")),
  inPhase("alias", rule(/^as(?=\s)/, "keyword", toPhase("text"))),
  inPhase("note", rule(/^(left\s+of|right\s+of|over)(?=\s|$)/i, "keyword", toPhase("ids"))),
  turn("box", "text", anyOf([rule(SEQUENCE_COLOR, "atom"), toEnd("string")])),
  inPhase("color", toEnd("atom")),
  inPhase("autonumber", anyOf([rule(/^\d+/, "number"), rule(/^off\b/, "atom")])),
  rule(",", "punctuation"),
  rule(":", "punctuation", toPhase("text")),
  inPhase("ids", rule(/^[^,:]+?(?=\s*(?:[,:]|$))/, "variableName")),
  rule(SEQUENCE_ARROW, "operator", (state) => {
    state.arrow = true;
  }),
  rule(/^[^\s:,\-<]+/, "variableName"),
]);

const USECASE_LABELLED = /^(<--|o--|x--|--)\s+(?!>)([^-\s][^-]*?)\s+(-->|--o|--x|--)(?!-)/;

const USECASE_ARROW = /^(--\|>|--+>|<--+|--o|o--|--x|x--|--+)/;

/** An actor or a use case: declared by the statement it starts, else named. */
function usecaseElement(stream: StringStream, state: SyntaxState): string | undefined {
  if (!stream.match(/^\w+/)) return undefined;
  state.want = "edge";
  return state.phase === "declare" && !state.arrow ? "variableName.definition" : "variableName";
}

/** The statements of a use case diagram: actors, use cases, system boundaries and their relations. */
const usecaseStatement = statements([
  atStart([
    rule(/^end(?=\s*$)/, "keyword", leave),
    rule(/^systemBoundary(?=\s)/, "keyword", enter("systemBoundary", "declare")),
    rule(/^actor(?=\s)/, "keyword", toPhase("declare")),
    rule(/^note\s+for(?=\s)/, "keyword", toPhase("note")),
    rule(/^(classDef|class|style)(?=\s)/, "keyword", toPhase("plain")),
  ]),
  inPhase("note", rule(/^\w+/, "variableName", toPhase("text"))),
  inPhase("include", rule(":", "punctuation")),
  turn("include", "", rule(/^(include|extend)\b/i, "keyword")),
  // The name of an element, in the brackets of its shape or in quotes.
  rule(/^\(\s*("[^"]*"|[^)]*)\s*\)?/, "string"),
  rule(/^\[\s*("[^"]*"|[^\]]*)\s*\]?/, "string"),
  rule(QUOTED, "string"),
  mark,
  rule(",", "punctuation", wants("node")),
  wanting("node", usecaseElement),
  rule(/^\.\.>/, "operator", (state) =>
    Object.assign(state, { phase: "include", want: "node", arrow: true }),
  ),
  labelled(USECASE_LABELLED, connects),
  rule(USECASE_ARROW, "operator", connects),
  usecaseElement,
]);

const ER_NAME = /^("[^"]*"?|[\p{L}\p{N}_][\p{L}\p{N}_.-]*)/u;

/** The cardinalities of a relationship's ends, as symbols and in words, and the ways its line is written. */
const ER_CARDINALITY =
  /^(\|\||\|o|o\||\}\||\|\{|\}o|o\{|(?:one or zero|zero or one|one or more|one or many|many\(1\)|1\+|zero or more|zero or many|many\(0\)|0\+|many|only one|one|1)(?![\p{L}\p{N}_]))/u;

const ER_LINE = /^(--|\.\.|\.-|-\.|(?:optionally to|to)(?![\p{L}\p{N}_]))/u;

const ER_KEY = /^(PK|FK|UK)(?![\p{L}\p{N}_])/u;

/** A line that only names an entity, which declares it. */
const ER_DECLARATION = /^\s*("[^"]*"|[^\s"[{:]+)\s*(\[[^\]]*\]?)?\s*(:::[\w,-]*)?\s*(\{.*)?$/;

/** A word of an attribute: its type first, then its name. */
function attributeWord(stream: StringStream, state: SyntaxState): string | undefined {
  if (!stream.match(/^[^\s,"}]+/)) return undefined;
  const name = state.phase === "attribute-name";
  state.phase = name ? "attribute-keys" : "attribute-name";
  return name ? "propertyName" : "typeName";
}

/** An attribute in the block of an entity: its type, its name, its keys and its comment. */
const erAttribute = statements([
  rule("}", "punctuation", closeBody),
  rule(QUOTED, "string", toPhase("")),
  rule(",", "punctuation"),
  inPhase("attribute-keys", rule(ER_KEY, "modifier")),
  attributeWord,
]);

/** The alias of an entity, in brackets right behind its name. */
function erAlias(stream: StringStream, state: SyntaxState): string | undefined {
  if (state.after && stream.match(/^\[[^\]]*\]?/)) return "string";
  state.after = false;
  return undefined;
}

const erName = rule(ER_NAME, "variableName", (state) => {
  state.want = "edge";
  state.after = true;
});

/** The line of a relationship, or the cardinality of one of its ends. */
const erRelation = anyOf([
  rule(ER_LINE, "operator", (state) => {
    state.arrow = true;
  }),
  // The cardinality behind the line is the last piece before the second entity.
  rule(ER_CARDINALITY, "operator", (state) => {
    if (state.arrow) state.want = "node";
  }),
]);

/** The tokens of a statement of an entity relationship diagram outside the block of an entity. */
const erTokens = statements([
  atStart([
    rule(
      /^(classDef|class|style|linkStyle|click|callback|link)(?=\s)/,
      "keyword",
      toPhase("plain"),
    ),
  ]),
  mark,
  erAlias,
  // After an entity a cardinality comes before a brace, so that `}o` is not read as the end of a block.
  wanting("edge", erRelation),
  rule("{", "punctuation", (state) => {
    state.blocks.push("entity");
    state.body = true;
    state.phase = "";
  }),
  rule("}", "punctuation", leave),
  (stream, state) =>
    state.want === "node"
      ? (erName(stream, state) ?? erRelation(stream, state))
      : erName(stream, state),
  rule(":", "punctuation", toPhase("text")),
]);

/** The statements of an entity relationship diagram: entities with their attributes, and relationships. */
function erStatement(stream: StringStream, state: SyntaxState): string | null {
  if (state.body) {
    state.start = false;
    return erAttribute(stream, state);
  }
  // A line that only names an entity declares it.
  const declares = state.start && ER_DECLARATION.test(stream.string),
    tag = erTokens(stream, state);
  return declares && tag === "variableName" ? "variableName.definition" : tag;
}

/** The words a block diagram's line starts with: the kinds of element, and the header lines. */
const TAM_KEYWORDS = new Set<string>([...ELEMENT_KINDS, "title", "direction", "level"]);

/** The words of connections, longest first, and the keywords of dependencies. */
const TAM_WORDS = [
  ...["reads/writes", "sends data", "reads", "writes", "calls", "delegates", "requires"],
  ...["use", "import", "create", "generate", "pointer", "provides", "stack"],
].map((word) => new RegExp(`^${word.replace("/", "\\/")}\\b`, "i"));

/** The keyword a line of a block diagram starts with; after `title` the rest of the line is the title. */
function tamKeyword(stream: StringStream, state: SyntaxState): string | undefined {
  const word = stream.match(/^[A-Za-z_]\w*/, false) as RegExpMatchArray | null;
  if (!word || !TAM_KEYWORDS.has(word[0])) return undefined;
  stream.match(word[0]);
  if (word[0] === "title") state.phase = "title";
  return "keyword";
}

/** The tokens of a line of a block diagram. */
const tamTokens = statements([
  (stream) => (stream.eatSpace() ? null : undefined),
  rule("%%", "comment", (_, stream) => stream.skipToEnd()),
  inPhase("title", (stream) => {
    stream.match(/^.*?(?=%%|$)/);
    return "string";
  }),
  atStart([tamKeyword]),
  rule(/^\[[^\]]*\]/, "string"),
  rule(/^"[^"]*"/, "string"),
  rule(/^:::\w+/, "atom"),
  // A position, of an element or, signed, of a connection's label behind it.
  rule(/^@\s*[-+]?\d+(\.\d+)?\s*,\s*[-+]?\d+(\.\d+)?(?=\s|%%|$)/, "number"),
  rule(/^\d+(\.\d+)?x\d+(\.\d+)?/, "number"),
  rule(/^@\s*[^-\s][^-]*?(?=\s*-->|\s*---|$)/, "meta"),
  rule(/^(<--|-->|---|-\.-(?!>)|--|-\.|\.->)/, "operator"),
  rule(/^\.\.\./, "punctuation"),
  rule(/^[{}]/, "punctuation"),
  (stream) => (TAM_WORDS.some((word) => stream.match(word)) ? "typeName" : undefined),
  rule(/^[A-Za-z_]\w*/, "variableName"),
]);

/** The notation of block diagrams as tokens. */
const tam: StreamParser<SyntaxState> = {
  startState,
  token(stream, state) {
    if (stream.sol()) {
      state.start = true;
      state.phase = "";
    }
    return tamTokens(stream, state);
  },
  languageData: { commentTokens: { line: "%%" }, indentOnInput: /^\s*\}$/ },
};

const boundary = "(?![\\w-])";

/** The tokenizer of each diagram type. */
export const TOKENIZERS: Record<DiagramType, StreamParser<SyntaxState>> = {
  tam,
  class: mermaid(new RegExp(`^classDiagram(-v2)?${boundary}`), false, classStatement, /^\s*\}$/),
  state: mermaid(new RegExp(`^stateDiagram(-v2)?${boundary}`), false, stateStatement, /^\s*\}$/),
  flowchart: mermaid(new RegExp(`^(flowchart(-elk)?|graph)${boundary}`), true, flowStatement),
  swimlane: mermaid(new RegExp(`^swimlane-beta${boundary}`), true, flowStatement),
  sequence: mermaid(new RegExp(`^sequenceDiagram${boundary}`), false, sequenceStatement),
  usecase: mermaid(new RegExp(`^usecase-beta${boundary}`), false, usecaseStatement),
  er: mermaid(new RegExp(`^erDiagram${boundary}`), false, erStatement, /^\s*\}$/),
};

/**
 * The tokens of a source, line by line, and where the tokenizer stands after it. With `from`, the
 * source continues one read before: the text of a line after the lines above it.
 */
export function scanSource(
  type: DiagramType,
  source: string,
  from?: SyntaxState,
): { lines: Token[][]; state: SyntaxState } {
  const tokenizer = TOKENIZERS[type],
    state: SyntaxState = from
      ? { ...from, blocks: [...from.blocks], plan: [...from.plan] }
      : startState();
  const lines = source.split(/\r\n?|\n/).map((text) => {
    const tokens: Token[] = [],
      stream = new StringStream(text, 2, 2);
    while (!stream.eol()) {
      stream.start = stream.pos;
      const tag = tokenizer.token(stream, state);
      if (tag)
        tokens.push({
          from: stream.start,
          to: stream.pos,
          text: text.slice(stream.start, stream.pos),
          tag,
        });
    }
    return tokens;
  });
  return { lines, state };
}

/** How the blocks of a syntax are written: the lines that open one and close one, and whether braces hold them. */
interface Blocks {
  opens: RegExp;
  closes: RegExp;
  braces?: boolean;
}

const BRACES: Blocks = { opens: /\{\s*$/, closes: /^\s*\}/, braces: true };

const SUBGRAPHS: Blocks = { opens: /^\s*subgraph(\s|$)/, closes: /^\s*end\s*;?\s*$/ };

/** The blocks of each syntax. */
const BLOCKS: Record<DiagramType, Blocks> = {
  tam: BRACES,
  class: BRACES,
  er: BRACES,
  state: {
    opens: new RegExp(`\\{\\s*$|${NOTE_BLOCK.source}`, "i"),
    closes: /^\s*(\}|end\s+note\s*$)/i,
    braces: true,
  },
  flowchart: SUBGRAPHS,
  swimlane: SUBGRAPHS,
  sequence: {
    opens: /^\s*(loop|alt|opt|par|critical|break|rect|box|else|and|option)(\s+[^-<\s]|\s*$)/,
    closes: /^\s*(end\s*$|(else|and|option)(\s+[^-<\s]|\s*$))/,
  },
  usecase: { opens: /^\s*systemBoundary\s/, closes: SUBGRAPHS.closes },
};

/** Whether a line closes a block of its syntax: it stands one step further out than the lines before it. */
const closes = (type: DiagramType, line: string) => BLOCKS[type].closes.test(line);

/**
 * How many steps a line stands further in than the line before it: one more after a line that opens
 * a block, one less when the line itself closes one.
 */
export function indentChange(type: DiagramType, before: string, line: string): number {
  return (BLOCKS[type].opens.test(before) ? 1 : 0) - (closes(type, line) ? 1 : 0);
}

const HEADER =
  /^\s*(classDiagram(-v2)?|stateDiagram(-v2)?|flowchart(-elk)?|graph|swimlane-beta|usecase-beta|sequenceDiagram|erDiagram)(?![\w-])/;

/** The text before a place: the line up to it, else the last line with text above; empty where there is none. */
function textBefore(doc: Text, pos: number): string {
  const line = doc.lineAt(pos);
  let before = line.text.slice(0, pos - line.from),
    number = line.number;
  while (!before.trim() && number > 1) before = doc.line(--number).text;
  return before.trim() ? before : "";
}

/**
 * Whether the statements below a header line stand one step in: the next line with text after
 * the line of a number does, or there is none.
 */
function indentedBelow(
  doc: Text,
  number: number,
  header: string,
  indent: (text: string) => number,
): boolean {
  let next = number + 1;
  while (next <= doc.lines && !doc.line(next).text.trim()) next++;
  return next > doc.lines || indent(doc.line(next).text) > indent(header);
}

/**
 * The indentation of a line: that of the line before it, moved by the blocks the two open and
 * close. The statements under a Mermaid header stand one step in, unless the source keeps them at
 * the margin.
 */
function indenter(type: DiagramType) {
  return (context: IndentContext, pos: number): number => {
    const { doc } = context.state,
      before = textBefore(doc, pos);
    if (!before) return 0;
    const indent = (text: string) =>
      countColumn(text, context.state.tabSize, text.length - text.trimStart().length);
    let steps = indentChange(type, before, context.textAfterPos(pos));
    if (
      type !== "tam" &&
      HEADER.test(before) &&
      indentedBelow(doc, doc.lineAt(pos).number, before, indent)
    )
      steps++;
    return Math.max(0, indent(before) + steps * context.unit);
  };
}

const LANGUAGES = new Map<DiagramType, Extension>();

/** The syntax of a diagram type for the source pane: its colors, its comment sign and its indentation. */
export function syntaxOf(type: DiagramType): Extension {
  let language = LANGUAGES.get(type);
  if (!language) {
    language = [
      // Before the tokenizer's own answer, which is to keep the indentation of the line above.
      Prec.high(indentService.of(indenter(type))),
      StreamLanguage.define(TOKENIZERS[type]),
      indentOnInput(),
    ];
    LANGUAGES.set(type, language);
  }
  return language;
}

/**
 * Whether the text at a place is free text, which the syntax does not read: the text of a message,
 * of a note, of a label behind a colon, a title, a comment. `above` is the source before the line,
 * `before` the line up to the place.
 */
export function freeText(type: DiagramType, above: string, before: string): boolean {
  const start = above ? scanSource(type, above.replace(/\r?\n$/, "")).state : undefined,
    { lines, state } = scanSource(type, before, start);
  return (
    lines[0].at(-1)?.tag === "comment" ||
    state.phase === "text" ||
    state.phase === "title" ||
    !!state.prose ||
    state.directive ||
    state.front === "inside"
  );
}

/** The signs that close a bracket or a text, which typing the opening one adds behind the cursor. */
const CLOSERS = /^[)\]}|"']+\s*$/;

/**
 * Where Enter starts its new line when the cursor stands at a column of a line: behind the closing
 * brackets that are all that follows it, since a statement is one line. Undefined where Enter
 * breaks the line at the cursor: anywhere else, and between the braces of a block just opened.
 */
export function pastClosers(type: DiagramType, line: string, column: number): number | undefined {
  const rest = line.slice(column);
  if (!CLOSERS.test(rest) || !line.slice(0, column).trim()) return undefined;
  if (BLOCKS[type].braces && rest.startsWith("}") && /\{\s*$/.test(line.slice(0, column)))
    return undefined;
  return column + rest.trimEnd().length;
}

/**
 * What typing `}` on an empty line does where the brace that closes the block is already below it,
 * put there when the block was opened: the range of the empty lines to remove, so that the cursor
 * comes to stand behind that brace. Undefined where a brace is to be written.
 */
export function braceBelow(
  type: DiagramType,
  state: EditorState,
): { from: number; to: number; cursor: number } | undefined {
  if (!BLOCKS[type].braces) return undefined;
  const range = state.selection.main,
    line = state.doc.lineAt(range.head);
  if (!range.empty || line.text.trim() || line.number === state.doc.lines) return undefined;
  const next = nextWithText(state.doc, line.number);
  if (!/^\s*\}/.test(next.text) || !balanced(state.doc.toString())) return undefined;
  return { from: line.from, to: next.from, cursor: line.from + next.text.indexOf("}") + 1 };
}

/** The first line with text below the line of a number, else the last line. */
function nextWithText(doc: Text, number: number) {
  let next = doc.line(number + 1);
  while (!next.text.trim() && next.number < doc.lines) next = doc.line(next.number + 1);
  return next;
}

/** Whether every block of a source is closed already: one more brace would close none. */
function balanced(text: string): boolean {
  const count = (sign: string) => text.split(sign).length - 1;
  return count("{") === count("}");
}

/**
 * What typing does besides writing: no bracket or quote is closed by itself inside free text, and
 * a `}` typed above the one that already closes its block goes to that one.
 */
export function typingRules(type: () => DiagramType): Extension {
  return Prec.high(
    EditorView.inputHandler.of((view, from, to, text, insert) => {
      const { state } = view;
      if (text === "}") {
        const below = braceBelow(type(), state);
        if (!below) return false;
        view.dispatch({
          changes: { from: below.from, to: below.to },
          selection: { anchor: below.cursor },
          userEvent: "input.type",
          scrollIntoView: true,
        });
        return true;
      }
      if (text.length !== 1 || !"([{\"'`".includes(text)) return false;
      const line = state.doc.lineAt(from);
      if (!freeText(type(), state.sliceDoc(0, line.from), state.sliceDoc(line.from, from)))
        return false;
      view.dispatch(insert());
      return true;
    }),
  );
}

/**
 * Enter. Before closing brackets that end the line, the new line starts behind them. At the end of
 * a line that closes a block (`end`, `else`, `}`), the line moves out to where its block began,
 * then the new line follows as usual.
 */
export function newlineAfterBlock(type: () => DiagramType): Command {
  return (view) => {
    let { state } = view;
    const cursor = state.selection.main,
      at = state.doc.lineAt(cursor.head),
      past = cursor.empty ? pastClosers(type(), at.text, cursor.head - at.from) : undefined;
    if (past !== undefined && at.from + past !== cursor.head) {
      view.dispatch({ selection: { anchor: at.from + past } });
      state = view.state;
    }
    const range = state.selection.main,
      line = state.doc.lineAt(range.head);
    if (range.empty && range.head === line.to && closes(type(), line.text)) {
      const want = getIndentation(state, line.from),
        have = line.text.length - line.text.trimStart().length;
      if (want !== null && indentString(state, want) !== line.text.slice(0, have))
        view.dispatch({
          changes: { from: line.from, to: line.from + have, insert: indentString(state, want) },
        });
    }
    return insertNewlineAndIndent(view);
  };
}
