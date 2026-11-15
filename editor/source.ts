/**
 * The source pane: the TAM text in a code editor, with the notation's colors, the line of an error
 * underlined, the ids and words of the notation offered while typing, and the lines of what is
 * selected on the canvas marked.
 */

import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { setDiagnostics } from "@codemirror/lint";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { COLORS, ELEMENT_KINDS } from "../src/tam.ts";

const KINDS = new Set<string>(ELEMENT_KINDS);

const HEADERS = new Set(["title", "direction", "level"]);

/** The words of connections, longest first, and the keywords of dependencies. */
const WORDS = ["reads/writes", "sends data", "reads", "writes", "calls", "delegates", "requires"];

const DEPENDENCIES = ["use", "import", "create", "generate", "pointer"];

/** The notation as tokens: enough to color a source, not to check it. */
const tam = StreamLanguage.define<{ start: boolean; title: boolean }>({
  startState: () => ({ start: true, title: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.start = true;
      state.title = false;
    }
    if (stream.eatSpace()) return null;
    if (stream.match("%%")) {
      stream.skipToEnd();
      return "comment";
    }
    // After `title` the rest of the line is the title.
    if (state.title) {
      stream.match(/^.*?(?=%%|$)/);
      return "string";
    }
    const first = state.start;
    state.start = false;
    if (first) {
      const word = stream.match(/^[A-Za-z_]\w*/, false) as RegExpMatchArray | null;
      if (word && (KINDS.has(word[0]) || HEADERS.has(word[0]))) {
        stream.match(word[0]);
        state.title = word[0] === "title";
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
    if (stream.match(/^(<--|-->|---|--|-\.|\.->)/)) return "operator";
    if (stream.match(/^\.\.\./) || stream.match(/^[{}]/)) return "punctuation";
    for (const word of [...WORDS, ...DEPENDENCIES, "provides", "stack"])
      if (stream.match(new RegExp(`^${word.replace("/", "\\/")}\\b`, "i"))) return "typeName";
    if (stream.match(/^[A-Za-z_]\w*/)) return "variableName";
    stream.next();
    return null;
  },
});

/** The colors come from the page, so the pane follows the theme. */
const colors = HighlightStyle.define([
  { tag: tags.comment, color: "var(--text-2)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--syntax-keyword)", fontWeight: "600" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: tags.number, color: "var(--syntax-number)" },
  { tag: tags.atom, color: "var(--syntax-number)" },
  { tag: tags.meta, color: "var(--syntax-string)", fontStyle: "italic" },
  { tag: tags.typeName, color: "var(--syntax-word)" },
  { tag: tags.operator, color: "var(--text-2)" },
  { tag: tags.punctuation, color: "var(--text-2)" },
]);

const look = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    backgroundColor: "var(--field)",
    color: "var(--text)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    lineHeight: "1.55",
    scrollbarWidth: "thin",
    scrollbarColor: "var(--line-strong) transparent",
  },
  ".cm-content": { caretColor: "var(--text)" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--text-3)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--text) 5%, transparent)" },
  ".cm-selected-element": { backgroundColor: "var(--accent-soft)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
    { backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)" },
  ".cm-tooltip": {
    backgroundColor: "var(--raised)",
    color: "var(--text)",
    border: "1px solid var(--line)",
    borderRadius: "4px",
    boxShadow: "var(--shadow)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--text)",
  },
});

/** A change that comes from the document, not from typing. */
const fromDocument = Annotation.define<boolean>();

const markLines = StateEffect.define<number[]>();

const marked = Decoration.line({ class: "cm-selected-element" });

/** The lines of the elements selected on the canvas. */
const selectedLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(lines, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(markLines))
        return Decoration.set(
          effect.value
            .filter((line) => line >= 1 && line <= transaction.state.doc.lines)
            .toSorted((a, b) => a - b)
            .map((line) => marked.range(transaction.state.doc.line(line).from)),
        );
    return lines.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** What the pane asks of the editor around it. */
export interface SourceHost {
  /** The text changed by typing. */
  changed(text: string): void;
  /** The ids of the elements, to offer where an id is typed. */
  ids(): string[];
  /** The cursor came to a line by a click or a key. */
  cursorAt(line: number): void;
}

export class SourcePane {
  private readonly view: EditorView;
  /** Long lines wrap or scroll: set by `setWrap`. */
  private readonly wrapping = new Compartment();

  constructor(parent: HTMLElement, host: SourceHost) {
    const complete = (context: CompletionContext): CompletionResult | null => {
      const line = context.state.doc.lineAt(context.pos),
        before = line.text.slice(0, context.pos - line.from),
        word = context.matchBefore(/[\w/]*/);
      if (!word || (word.from === word.to && !context.explicit)) return null;
      const options = (labels: string[], type: string) => labels.map((label) => ({ label, type }));
      // At the start of a line a declaration or a connection begins.
      if (/^\s*[\w/]*$/.test(before))
        return {
          from: word.from,
          options: [
            ...options([...ELEMENT_KINDS, ...HEADERS], "keyword"),
            ...options(host.ids(), "variable"),
          ],
        };
      if (/:::\w*$/.test(before))
        return { from: word.from, options: options([...COLORS], "constant") };
      if (/(--|<--)\s*[\w/ ]*$/.test(before) && !/-->|---/.test(before))
        return { from: word.from, options: options(WORDS, "type") };
      if (/-\.\s*\w*$/.test(before))
        return { from: word.from, options: options(DEPENDENCIES, "type") };
      return { from: word.from, options: options(host.ids(), "variable") };
    };
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          indentUnit.of("  "),
          EditorState.tabSize.of(2),
          tam,
          syntaxHighlighting(colors),
          autocompletion({ override: [complete], icons: false }),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          selectedLines,
          this.wrapping.of([]),
          look,
          EditorView.contentAttributes.of({ "aria-label": "Diagram source", spellcheck: "false" }),
          EditorView.updateListener.of((update) => {
            const typed = update.transactions.some(
              (transaction) => !transaction.annotation(fromDocument),
            );
            if (update.docChanged && typed) host.changed(update.state.doc.toString());
            // A click or a key moved the cursor: the element declared there is selected.
            else if (update.selectionSet && typed && update.view.hasFocus)
              host.cursorAt(update.state.doc.lineAt(update.state.selection.main.head).number);
          }),
        ],
      }),
    });
  }

  get text() {
    return this.view.state.doc.toString();
  }

  get focused() {
    return this.view.hasFocus;
  }

  /** Shows a text that came from the document: an edit on the canvas, undo, a file. True when it replaced another, and the marked lines with it. */
  setText(text: string): boolean {
    if (text === this.text) return false;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      annotations: fromDocument.of(true),
    });
    return true;
  }

  /** Underlines the line of a problem; line 0 is about the whole source. */
  setProblem(problem: { line: number; message: string } | undefined) {
    const { state } = this.view,
      line =
        problem && problem.line >= 1 && problem.line <= state.doc.lines
          ? state.doc.line(problem.line)
          : undefined;
    this.view.dispatch(
      setDiagnostics(
        state,
        problem && line
          ? [
              {
                from: line.from + (line.text.length - line.text.trimStart().length),
                to:
                  Math.max(line.to, line.from + 1) > state.doc.length ? state.doc.length : line.to,
                severity: "error",
                message: problem.message.replace(/^Line \d+: /, ""),
              },
            ]
          : [],
      ),
    );
  }

  /** Marks the lines of the selected elements and brings the first into view, unless the user is typing here. */
  setSelectedLines(lines: number[]) {
    this.view.dispatch({
      effects: [
        markLines.of(lines),
        ...(lines.length && !this.focused && lines[0] <= this.view.state.doc.lines
          ? [EditorView.scrollIntoView(this.view.state.doc.line(lines[0]).from, { y: "nearest" })]
          : []),
      ],
      annotations: fromDocument.of(true),
    });
  }

  /** Wraps long lines at the edge of the pane, or lets them run on and scroll. */
  setWrap(on: boolean) {
    this.view.dispatch({ effects: this.wrapping.reconfigure(on ? EditorView.lineWrapping : []) });
  }

  /** Puts the cursor on a line and the focus in the pane. */
  focusLine(number: number) {
    const { doc } = this.view.state,
      line = doc.line(Math.min(Math.max(1, number), doc.lines));
    this.view.dispatch({
      selection: EditorSelection.cursor(line.to),
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      annotations: fromDocument.of(true),
    });
    this.view.focus();
  }

  /**
   * Adds statements as lines of their own, as if typed: below the line of the cursor, or at the end
   * while the cursor has not left the start. The added lines are selected, to type over.
   */
  insert(text: string) {
    const { state } = this.view,
      head = state.selection.main.head,
      line = head === 0 ? state.doc.line(state.doc.lines) : state.doc.lineAt(head),
      // An empty line takes the statements; any other gets them below it.
      blank = !line.text.trim(),
      from = blank ? line.from : line.to,
      lead = blank ? "" : "\n",
      tail = blank && line.to < state.doc.length ? "" : line.to === state.doc.length ? "\n" : "";
    this.view.dispatch({
      changes: { from, to: blank ? line.to : from, insert: `${lead}${text}${tail}` },
      selection: EditorSelection.range(from + lead.length, from + lead.length + text.length),
      effects: EditorView.scrollIntoView(from + lead.length, { y: "center" }),
    });
    this.view.focus();
  }
}
