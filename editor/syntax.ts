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
import { countColumn, type EditorState, type Extension, Prec } from "@codemirror/state";
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

const DIRECTION = /^(TB|TD|BT|LR|RL)\b/i;

/** The statements that only style a picture: colored as a keyword and plain words. */
const STYLING = /^(classDef|style|linkStyle|cssClass|click|callback|links?|properties|details)\b/;

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

/** The marks a Mermaid element may carry after its name: a class, a stereotype, metadata. */
function mark(stream: StringStream): string | null {
  if (stream.match(/^:::[\w,-]+/)) return "atom";
  if (stream.match(/^<<[^>]*(>>)?/)) return "annotation";
  if (stream.match(/^@\{[^}]*\}?/)) return "meta";
  return null;
}

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
  const read = (stream: StringStream, state: SyntaxState): string | null => {
    const fence = stream.sol() && /^\s*---\s*$/.test(stream.string);
    if (state.front === "inside" || (state.front === "before" && fence))
      return frontmatter(stream, state, fence);
    if (stream.eatSpace()) {
      state.after = false;
      return null;
    }
    state.front = "after";
    if (state.directive) {
      stream.skipToEnd();
      if (/\}%%\s*$/.test(stream.string)) state.directive = false;
      return "meta";
    }
    // A comment is a line of its own: the parsers do not cut one off the end of a statement.
    if (state.start && stream.match("%%")) {
      const directive = stream.peek() === "{";
      stream.skipToEnd();
      if (!directive) return "comment";
      state.directive = !/\}%%\s*$/.test(stream.string);
      return "meta";
    }
    if (state.plan.length) {
      const length = state.plan.shift() as number;
      stream.pos = Math.min(stream.string.length, stream.pos + length);
      return state.plan.shift() as string;
    }
    if (!state.header) {
      state.header = true;
      if (stream.match(header)) {
        state.phase = directed ? "header" : "";
        return "keyword";
      }
    }
    if (state.phase === "header") {
      state.phase = "";
      if (stream.match(DIRECTION) || stream.match(/^[<>^v](?=\s|;|$)/)) return "atom";
    }
    if (state.prose && state.phase === "") {
      if (state.prose === "note" && stream.match(/^end\s+note\b/i)) {
        state.prose = "";
        return "keyword";
      }
      if (state.prose === "acc" && stream.string.includes("}")) state.prose = "";
      stream.skipToEnd();
      return "string";
    }
    if (state.start && !state.body && stream.match(/^acc(Title|Descr)(?=\s*[:{])/)) {
      state.start = false;
      state.phase = "colon";
      if (/^\s*accDescr\s*\{[^}]*$/.test(stream.string)) state.prose = "acc";
      return "keyword";
    }
    if (state.phase === "colon") {
      state.phase = "text";
      if (stream.eat(":")) return "punctuation";
    }
    if (state.phase === "text") {
      stream.skipToEnd();
      return "string";
    }
    if (state.phase === "plain") {
      if (stream.match(/^"[^"]*"?/)) return "string";
      if (!stream.match(/^[\w-]+/)) stream.next();
      return null;
    }
    if (state.phase === "direction") {
      state.phase = "plain";
      if (stream.match(DIRECTION)) return "atom";
    }
    if (state.start && !state.body && stream.match(/^direction(?=\s|$)/)) {
      state.start = false;
      state.phase = "direction";
      return "keyword";
    }
    return statement(stream, state);
  };
  return {
    startState,
    token(stream, state) {
      if (stream.sol())
        Object.assign(state, {
          start: true,
          phase: "",
          want: "node",
          after: false,
          arrow: false,
          plan: [],
        });
      const from = stream.pos,
        tag = read(stream, state);
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

/** A styling statement at the start of a line: its keyword, and the rest as plain words. */
function styling(stream: StringStream, state: SyntaxState, words = STYLING): boolean {
  if (!stream.match(words)) return false;
  state.phase = "plain";
  return true;
}

const CLASS_NAME = /^(`[^`]+`|[\p{L}\p{N}_.]+(~[^~]+~)?)/u;

const CLASS_RELATION = /^(<\||\*|o|<|\(\))?(--|\.\.)(\|>|\*|o|>|\(\))?/;

/** A member of a class: its visibility, name, parameters and types. */
function member(stream: StringStream, state: SyntaxState): string | null {
  if (state.body && stream.eat("}")) {
    state.body = false;
    state.blocks.pop();
    return "punctuation";
  }
  if (state.phase === "" || state.phase === "member-start") {
    state.start = false;
    state.phase = "member";
    if (stream.match(/^[+\-#~]/)) return "modifier";
  }
  if (stream.match(/^<<[^>]*(>>)?/)) return "annotation";
  if (stream.eat("(")) {
    state.phase = "member-parameters";
    return "punctuation";
  }
  if (stream.eat(")")) {
    state.phase = "member-type";
    return "punctuation";
  }
  if (stream.eat(":")) {
    state.phase = state.phase === "member-parameters" ? "member-parameter-type" : "member-type";
    return "punctuation";
  }
  if (stream.eat(",")) {
    if (state.phase === "member-parameter-type") state.phase = "member-parameters";
    return "punctuation";
  }
  // `$` marks a static member and `*` an abstract one, at its end.
  if (stream.match(/^[$*](?=\s*\}?\s*$)/)) return "modifier";
  if (stream.match(/^[~[\]<>]/)) return "punctuation";
  if (stream.match(/^[\p{L}\p{N}_.]+/u))
    return state.phase === "member"
      ? "propertyName"
      : state.phase === "member-parameters"
        ? "variableName"
        : "typeName";
  stream.next();
  return null;
}

/** The statements of a class diagram: classes with their bodies, namespaces, notes, relations. */
function classStatement(stream: StringStream, state: SyntaxState): string | null {
  if (state.body || state.phase.startsWith("member")) return member(stream, state);
  if (state.start) {
    state.start = false;
    if (stream.match(/^class(?=\s)/)) {
      state.phase = "declare";
      return "keyword";
    }
    if (stream.match(/^namespace(?=\s)/)) {
      state.phase = "namespace";
      return "keyword";
    }
    if (stream.match(/^note(?=\s)/)) {
      state.phase = "note";
      return "keyword";
    }
    if (styling(stream, state)) return "keyword";
  }
  if (stream.eat("{")) {
    state.blocks.push(state.phase === "declare" ? "class" : "namespace");
    if (state.phase === "declare") {
      state.body = true;
      state.phase = "";
    }
    return "punctuation";
  }
  if (stream.eat("}")) {
    state.blocks.pop();
    return "punctuation";
  }
  const marked = mark(stream);
  if (marked) return marked;
  if (state.phase === "declare" || state.phase === "namespace") {
    if (stream.match(/^\[[^\]]*\]?/)) return "string";
    if (stream.match(CLASS_NAME)) return "variableName.definition";
  }
  if (state.phase === "note") {
    state.phase = "note-text";
    if (stream.match(/^for(?=\s)/)) {
      state.phase = "note-for";
      return "keyword";
    }
  }
  if (state.phase === "note-for" && stream.match(/^\S+/)) {
    state.phase = "note-text";
    return "variableName";
  }
  if (state.phase === "note-text") {
    if (stream.match(/^"[^"]*"?/)) return "string";
    stream.next();
    return null;
  }
  // A quoted text beside a relation is the multiplicity of its end.
  if (stream.match(/^"[^"]*"?/)) return "number";
  const name = () => {
    if (!stream.match(CLASS_NAME)) return null;
    state.want = "edge";
    return "variableName";
  };
  const relation = () => {
    if (!stream.match(CLASS_RELATION)) return null;
    state.want = "node";
    state.arrow = true;
    return "operator";
  };
  // After a class a relation comes first, so that `o--` is not read as a class named `o`.
  const tag = state.want === "node" ? (name() ?? relation()) : (relation() ?? name());
  if (tag) return tag;
  if (stream.eat(":")) {
    // After a relation its label; after a class alone one of its members.
    state.phase = state.arrow ? "text" : "member-start";
    return "punctuation";
  }
  stream.next();
  return null;
}

const STATE_ID = /^[^:\s\-{}"]+/;

/** The statements of a state machine: states, composites, transitions, notes. */
function stateStatement(stream: StringStream, state: SyntaxState): string | null {
  if (state.start) {
    state.start = false;
    if (stream.match(/^state(?=\s)/)) {
      state.phase = "declare";
      return "keyword";
    }
    if (stream.match(/^note(?=\s)/i)) {
      state.phase = "note";
      // Without a text on its line, the note is the lines up to `end note`.
      if (/^\s*note\s+(left|right)\s+of\s+[^:]+$/i.test(stream.string)) state.prose = "note";
      return "keyword";
    }
    if (
      stream.match(/^hide\s+empty\s+description(?=\s*$)/i) ||
      stream.match(/^scale\s+\d+\s+width(?=\s*$)/i)
    )
      return "keyword";
    if (styling(stream, state, /^(classDef|class|style|linkStyle|click|callback|links?)(?=\s)/))
      return "keyword";
    // Two dashes alone divide the regions of a composite state.
    if (stream.match(/^--(?=\s*$)/)) return "punctuation";
  }
  if (stream.match("[*]")) return "atom";
  if (stream.match(/^\[\[\s*\w*\s*\]\]/)) return "annotation";
  if (stream.match("-->")) {
    state.arrow = true;
    return "operator";
  }
  if (stream.eat("{")) {
    state.blocks.push("state");
    return "punctuation";
  }
  if (stream.eat("}")) {
    state.blocks.pop();
    return "punctuation";
  }
  if (stream.match(/^"[^"]*"?/)) {
    if (state.phase === "declare") state.phase = "declare-as";
    return "string";
  }
  const marked = mark(stream);
  if (marked) return marked;
  if (state.phase === "declare-as" && stream.match(/^as(?=\s)/)) {
    state.phase = "declare";
    return "keyword";
  }
  if (state.phase === "note" && stream.match(/^(left|right)\s+of(?=\s|$)/i)) {
    state.phase = "note-of";
    return "keyword";
  }
  if (stream.eat(":")) {
    state.phase = "text";
    return "punctuation";
  }
  if (stream.match(STATE_ID))
    return state.phase === "declare" ? "variableName.definition" : "variableName";
  stream.next();
  return null;
}

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

/** The statements of a flowchart and of an activity with lanes: subgraphs, and chains of nodes and edges. */
function flowStatement(stream: StringStream, state: SyntaxState): string | null {
  const after = state.after;
  state.after = false;
  if (stream.eat(";")) {
    Object.assign(state, { start: true, phase: "", want: "node" });
    return "punctuation";
  }
  if (state.start) {
    state.start = false;
    if (stream.match(/^end(?=\s*(;|$))/)) {
      state.blocks.pop();
      return "keyword";
    }
    if (stream.match(/^subgraph(?=\s|$)/)) {
      state.blocks.push("subgraph");
      state.phase = "subgraph";
      return "keyword";
    }
    if (styling(stream, state, /^(classDef|class|style|linkStyle|click|callback|links?)(?=\s)/))
      return "keyword";
  }
  if (state.phase === "subgraph") {
    if (stream.match(/^"[^"]*"?/) || stream.match(/^\[[^\]]*\]?/)) return "string";
    if (stream.match(/^[^\s[]+(?=\s*\[)/) || stream.match(/^[^;"[]+?(?=\s*(?:;|$))/))
      return "variableName.definition";
  }
  if (after && flowShape(stream)) return "string";
  const marked = mark(stream);
  if (marked) return marked;
  if (stream.eat("&")) {
    state.want = "node";
    return "punctuation";
  }
  const node = () => {
    if (!stream.match(FLOW_ID)) return false;
    state.want = "edge";
    state.after = true;
    return true;
  };
  if (state.want === "node" && node()) return "variableName";
  const labelled = stream.match(FLOW_LABELLED, false) as RegExpMatchArray | null;
  if (labelled) {
    stream.pos += labelled[1].length;
    state.plan = [labelled[2].length, "string", labelled[3].length, "operator"];
    state.want = "node";
    return "operator";
  }
  if (stream.match(/^~{3,}/) || stream.match(FLOW_EDGE)) {
    state.want = "node";
    return "operator";
  }
  if (stream.match(/^\|[^|]*\|?/)) return "string";
  if (node()) return "variableName";
  stream.next();
  return null;
}

const SEQUENCE_ARROW = /^(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)/;

const SEQUENCE_MESSAGE =
  /^(.+?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:>)-][^:]*?)\s*(?::(.*))?$/;

const SEQUENCE_COLOR =
  /^(rgba?\([^)]*\)|#[0-9a-f]{3,8}|transparent|aqua|black|blue|fuchsia|gray|grey|green|lime|maroon|navy|olive|purple|red|silver|teal|white|yellow|orange|pink|lightblue|lightgreen|lightgrey|lightgray|lightyellow|beige|ivory|lavender|wheat|tan|khaki|coral|salmon|gold|cyan|magenta)\b/i;

/** The statements of a sequence diagram: participants, messages, notes, and the fragments that frame them. */
function sequenceStatement(stream: StringStream, state: SyntaxState): string | null {
  if (state.start) {
    state.start = false;
    if (stream.match(/^(create\s+)?(participant|actor)(?=\s)/)) {
      state.phase = "participant";
      return "keyword";
    }
    if (stream.match(/^(destroy|activate|deactivate)(?=\s)/)) {
      state.phase = "ids";
      return "keyword";
    }
    if (stream.match(/^box(?=\s|$)/)) {
      state.blocks.push("box");
      state.phase = "box";
      return "keyword";
    }
    if (stream.match(/^end(?=\s*$)/)) {
      state.blocks.pop();
      return "keyword";
    }
    if (stream.match(/^note(?=\s)/i)) {
      state.phase = "note";
      return "keyword";
    }
    if (stream.match(/^autonumber(?=\s|$)/)) {
      state.phase = "autonumber";
      return "keyword";
    }
    if (stream.match(/^title(?=\s|:)/)) {
      state.phase = "colon";
      return "keyword";
    }
    if (styling(stream, state, /^(links?|properties|details)(?=\s)/)) return "keyword";
    const rest = stream.string.slice(stream.pos),
      message = rest.match(SEQUENCE_MESSAGE);
    // A line that reads as a message is one, whatever word it starts with.
    const block =
      !message &&
      (stream.match(
        /^(loop|alt|opt|par|critical|break|rect|else|and|option)(?=\s|$)/,
      ) as RegExpMatchArray | null);
    if (block) {
      if (!/^(else|and|option)$/.test(block[1])) state.blocks.push(block[1]);
      state.phase = block[1] === "rect" ? "color" : "text";
      return "keyword";
    }
    if (message) {
      const [, from, arrow, sign, to] = message;
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
  }
  if (state.phase === "participant") {
    state.phase = "alias";
    if (stream.match(/^.+?(?=\s+as\s|\s*$)/)) return "variableName.definition";
  }
  if (state.phase === "alias" && stream.match(/^as(?=\s)/)) {
    state.phase = "text";
    return "keyword";
  }
  if (state.phase === "note" && stream.match(/^(left\s+of|right\s+of|over)(?=\s|$)/i)) {
    state.phase = "ids";
    return "keyword";
  }
  if (state.phase === "box") {
    state.phase = "text";
    if (stream.match(SEQUENCE_COLOR)) return "atom";
    stream.skipToEnd();
    return "string";
  }
  if (state.phase === "color") {
    stream.skipToEnd();
    return "atom";
  }
  if (state.phase === "autonumber") {
    if (stream.match(/^\d+/)) return "number";
    if (stream.match(/^off\b/)) return "atom";
  }
  if (stream.eat(",")) return "punctuation";
  if (stream.eat(":")) {
    state.phase = "text";
    return "punctuation";
  }
  if (state.phase === "ids" && stream.match(/^[^,:]+?(?=\s*(?:[,:]|$))/)) return "variableName";
  if (stream.match(SEQUENCE_ARROW)) {
    state.arrow = true;
    return "operator";
  }
  if (stream.match(/^[^\s:,\-<]+/)) return "variableName";
  stream.next();
  return null;
}

const USECASE_LABELLED = /^(<--|o--|x--|--)\s+(?!>)([^-\s][^-]*?)\s+(-->|--o|--x|--)(?!-)/;

const USECASE_ARROW = /^(--\|>|--+>|<--+|--o|o--|--x|x--|--+)/;

/** The statements of a use case diagram: actors, use cases, system boundaries and their relations. */
function usecaseStatement(stream: StringStream, state: SyntaxState): string | null {
  if (state.start) {
    state.start = false;
    if (stream.match(/^end(?=\s*$)/)) {
      state.blocks.pop();
      return "keyword";
    }
    if (stream.match(/^systemBoundary(?=\s)/)) {
      state.blocks.push("systemBoundary");
      state.phase = "declare";
      return "keyword";
    }
    if (stream.match(/^actor(?=\s)/)) {
      state.phase = "declare";
      return "keyword";
    }
    if (stream.match(/^note\s+for(?=\s)/)) {
      state.phase = "note";
      return "keyword";
    }
    if (styling(stream, state, /^(classDef|class|style)(?=\s)/)) return "keyword";
  }
  if (state.phase === "note" && stream.match(/^\w+/)) {
    state.phase = "text";
    return "variableName";
  }
  if (state.phase === "include") {
    if (stream.eat(":")) return "punctuation";
    state.phase = "";
    if (stream.match(/^(include|extend)\b/i)) return "keyword";
  }
  // The name of an element, in the brackets of its shape or in quotes.
  if (
    stream.match(/^\(\s*("[^"]*"|[^)]*)\s*\)?/) ||
    stream.match(/^\[\s*("[^"]*"|[^\]]*)\s*\]?/) ||
    stream.match(/^"[^"]*"?/)
  )
    return "string";
  const marked = mark(stream);
  if (marked) return marked;
  if (stream.eat(",")) {
    state.want = "node";
    return "punctuation";
  }
  const element = () => {
    if (!stream.match(/^\w+/)) return null;
    state.want = "edge";
    return state.phase === "declare" && !state.arrow ? "variableName.definition" : "variableName";
  };
  const id = state.want === "node" ? element() : null;
  if (id) return id;
  if (stream.match(/^\.\.>/)) {
    Object.assign(state, { phase: "include", want: "node", arrow: true });
    return "operator";
  }
  const labelled = stream.match(USECASE_LABELLED, false) as RegExpMatchArray | null;
  if (labelled) {
    stream.pos += labelled[1].length;
    state.plan = [labelled[2].length, "string", labelled[3].length, "operator"];
    Object.assign(state, { want: "node", arrow: true });
    return "operator";
  }
  if (stream.match(USECASE_ARROW)) {
    Object.assign(state, { want: "node", arrow: true });
    return "operator";
  }
  const other = element();
  if (other) return other;
  stream.next();
  return null;
}

const ER_NAME = /^("[^"]*"?|[\p{L}\p{N}_][\p{L}\p{N}_.-]*)/u;

/** The cardinalities of a relationship's ends, as symbols and in words, and the ways its line is written. */
const ER_CARDINALITY =
  /^(\|\||\|o|o\||\}\||\|\{|\}o|o\{|(?:one or zero|zero or one|one or more|one or many|many\(1\)|1\+|zero or more|zero or many|many\(0\)|0\+|many|only one|one|1)(?![\p{L}\p{N}_]))/u;

const ER_LINE = /^(--|\.\.|\.-|-\.|(?:optionally to|to)(?![\p{L}\p{N}_]))/u;

const ER_KEY = /^(PK|FK|UK)(?![\p{L}\p{N}_])/u;

/** An attribute in the block of an entity: its type, its name, its keys and its comment. */
function erAttribute(stream: StringStream, state: SyntaxState): string | null {
  state.start = false;
  if (stream.eat("}")) {
    state.body = false;
    state.blocks.pop();
    return "punctuation";
  }
  if (stream.match(/^"[^"]*"?/)) {
    state.phase = "";
    return "string";
  }
  if (stream.eat(",")) return "punctuation";
  if (state.phase === "attribute-keys" && stream.match(ER_KEY)) return "modifier";
  if (stream.match(/^[^\s,"}]+/)) {
    const name = state.phase === "attribute-name";
    state.phase = name ? "attribute-keys" : "attribute-name";
    return name ? "propertyName" : "typeName";
  }
  stream.next();
  return null;
}

/** The statements of an entity relationship diagram: entities with their attributes, and relationships. */
function erStatement(stream: StringStream, state: SyntaxState): string | null {
  if (state.body) return erAttribute(stream, state);
  const first = state.start;
  if (first) {
    state.start = false;
    if (styling(stream, state, /^(classDef|class|style|linkStyle|click|callback|link)(?=\s)/))
      return "keyword";
  }
  const marked = mark(stream);
  if (marked) return marked;
  // The alias of an entity, in brackets behind its name.
  if (state.after && stream.match(/^\[[^\]]*\]?/)) return "string";
  state.after = false;
  const name = () => {
    if (!stream.match(ER_NAME)) return null;
    state.want = "edge";
    state.after = true;
    // A line that only names an entity declares it.
    return first &&
      /^\s*("[^"]*"|[^\s"[{:]+)\s*(\[[^\]]*\]?)?\s*(:::[\w,-]*)?\s*(\{.*)?$/.test(stream.string)
      ? "variableName.definition"
      : "variableName";
  };
  const relation = () => {
    if (stream.match(ER_LINE)) {
      state.arrow = true;
      return "operator";
    }
    if (!stream.match(ER_CARDINALITY)) return null;
    // The cardinality behind the line is the last piece before the second entity.
    if (state.arrow) state.want = "node";
    return "operator";
  };
  // After an entity a cardinality comes before a brace, so that `}o` is not read as the end of a block.
  const edge = state.want === "edge" ? relation() : null;
  if (edge) return edge;
  if (stream.eat("{")) {
    state.blocks.push("entity");
    state.body = true;
    state.phase = "";
    return "punctuation";
  }
  if (stream.eat("}")) {
    state.blocks.pop();
    return "punctuation";
  }
  const tag = state.want === "node" ? (name() ?? relation()) : name();
  if (tag) return tag;
  if (stream.eat(":")) {
    state.phase = "text";
    return "punctuation";
  }
  stream.next();
  return null;
}

const KINDS = new Set<string>(ELEMENT_KINDS);

const TAM_HEADERS = new Set(["title", "direction", "level"]);

/** The words of connections, longest first, and the keywords of dependencies. */
const TAM_WORDS = [
  ...["reads/writes", "sends data", "reads", "writes", "calls", "delegates", "requires"],
  ...["use", "import", "create", "generate", "pointer", "provides", "stack"],
].map((word) => new RegExp(`^${word.replace("/", "\\/")}\\b`, "i"));

/** The notation of block diagrams as tokens. */
const tam: StreamParser<SyntaxState> = {
  startState,
  token(stream, state) {
    if (stream.sol()) {
      state.start = true;
      state.phase = "";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("%%")) {
      stream.skipToEnd();
      return "comment";
    }
    // After `title` the rest of the line is the title.
    if (state.phase === "title") {
      stream.match(/^.*?(?=%%|$)/);
      return "string";
    }
    const first = state.start;
    state.start = false;
    if (first) {
      const word = stream.match(/^[A-Za-z_]\w*/, false) as RegExpMatchArray | null;
      if (word && (KINDS.has(word[0]) || TAM_HEADERS.has(word[0]))) {
        stream.match(word[0]);
        if (word[0] === "title") state.phase = "title";
        return "keyword";
      }
    }
    if (stream.match(/^\[[^\]]*\]/) || stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^:::\w+/)) return "atom";
    if (
      stream.match(/^@\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?/) ||
      stream.match(/^\d+(\.\d+)?x\d+(\.\d+)?/)
    )
      return "number";
    if (stream.match(/^@\s*[^-\s][^-]*?(?=\s*-->|\s*---|$)/)) return "meta";
    if (stream.match(/^(<--|-->|---|-\.-(?!>)|--|-\.|\.->)/)) return "operator";
    if (stream.match(/^\.\.\./) || stream.match(/^[{}]/)) return "punctuation";
    for (const word of TAM_WORDS) if (stream.match(word)) return "typeName";
    if (stream.match(/^[A-Za-z_]\w*/)) return "variableName";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "%%" }, indentOnInput: /^\s*\}$/ },
};

const boundary = "(?![\\w-])";

/** The tokenizer of each diagram type. */
const TOKENIZERS: Record<DiagramType, StreamParser<SyntaxState>> = {
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

/** Whether a line opens a block of its syntax: the lines after it stand one step further in. */
function opens(type: DiagramType, line: string): boolean {
  switch (type) {
    case "tam":
    case "class":
    case "er":
      return /\{\s*$/.test(line);
    case "state":
      return /\{\s*$/.test(line) || /^\s*note\s+(left|right)\s+of\s+[^:]+$/i.test(line);
    case "flowchart":
    case "swimlane":
      return /^\s*subgraph(\s|$)/.test(line);
    case "sequence":
      return /^\s*(loop|alt|opt|par|critical|break|rect|box|else|and|option)(\s+[^-<\s]|\s*$)/.test(
        line,
      );
    case "usecase":
      return /^\s*systemBoundary\s/.test(line);
  }
}

/** Whether a line closes a block of its syntax: it stands one step further out than the lines before it. */
function closes(type: DiagramType, line: string): boolean {
  switch (type) {
    case "tam":
    case "class":
    case "er":
      return /^\s*\}/.test(line);
    case "state":
      return /^\s*(\}|end\s+note\s*$)/i.test(line);
    case "flowchart":
    case "swimlane":
    case "usecase":
      return /^\s*end\s*;?\s*$/.test(line);
    case "sequence":
      return /^\s*(end\s*$|(else|and|option)(\s+[^-<\s]|\s*$))/.test(line);
  }
}

/**
 * How many steps a line stands further in than the line before it: one more after a line that opens
 * a block, one less when the line itself closes one.
 */
export function indentChange(type: DiagramType, before: string, line: string): number {
  return (opens(type, before) ? 1 : 0) - (closes(type, line) ? 1 : 0);
}

const HEADER =
  /^\s*(classDiagram(-v2)?|stateDiagram(-v2)?|flowchart(-elk)?|graph|swimlane-beta|usecase-beta|sequenceDiagram|erDiagram)(?![\w-])/;

/**
 * The indentation of a line: that of the line before it, moved by the blocks the two open and
 * close. The statements under a Mermaid header stand one step in, unless the source keeps them at
 * the margin.
 */
function indenter(type: DiagramType) {
  return (context: IndentContext, pos: number): number => {
    const { doc } = context.state,
      line = doc.lineAt(pos);
    // The line before: the text up to the break of a new line, else the last line with text above.
    let before = line.text.slice(0, pos - line.from),
      number = line.number;
    while (!before.trim() && number > 1) before = doc.line(--number).text;
    if (!before.trim()) return 0;
    let steps = indentChange(type, before, context.textAfterPos(pos));
    const indent = (text: string) =>
      countColumn(text, context.state.tabSize, text.length - text.trimStart().length);
    if (type !== "tam" && HEADER.test(before)) {
      let next = line.number + 1;
      while (next <= doc.lines && !doc.line(next).text.trim()) next++;
      if (next > doc.lines || indent(doc.line(next).text) > indent(before)) steps++;
    }
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
  const block = type === "tam" || type === "class" || type === "state" || type === "er";
  if (block && rest.startsWith("}") && /\{\s*$/.test(line.slice(0, column))) return undefined;
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
  if (type !== "tam" && type !== "class" && type !== "state" && type !== "er") return undefined;
  const range = state.selection.main,
    line = state.doc.lineAt(range.head);
  if (!range.empty || line.text.trim() || line.number === state.doc.lines) return undefined;
  let next = state.doc.line(line.number + 1);
  while (!next.text.trim() && next.number < state.doc.lines) next = state.doc.line(next.number + 1);
  if (!/^\s*\}/.test(next.text)) return undefined;
  // Every block of the source is closed already: one more brace would close none.
  const text = state.doc.toString(),
    count = (sign: string) => text.split(sign).length - 1;
  if (count("{") !== count("}")) return undefined;
  return { from: line.from, to: next.from, cursor: line.from + next.text.indexOf("}") + 1 };
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
