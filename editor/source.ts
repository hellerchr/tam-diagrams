/**
 * The source pane: the text of a diagram in a code editor, with the colors of its type's syntax, the
 * line of an error underlined, the statements, ids and connections of the syntax offered while
 * typing, and the lines of what is selected on the canvas marked.
 */

import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  type CompletionContext,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
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
  tooltips,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Known } from "./completion.ts";
import { completeSource } from "./completion-uml.ts";
import { newlineAfterBlock, syntaxOf } from "./syntax.ts";
import type { DiagramType } from "./types.ts";

/** The colors come from the page, so the pane follows the theme. */
const colors = HighlightStyle.define([
  { tag: tags.comment, color: "var(--text-2)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--syntax-keyword)", fontWeight: "600" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: tags.number, color: "var(--syntax-number)" },
  { tag: tags.atom, color: "var(--syntax-number)" },
  { tag: tags.meta, color: "var(--syntax-string)", fontStyle: "italic" },
  { tag: tags.typeName, color: "var(--syntax-word)" },
  { tag: tags.annotation, color: "var(--syntax-number)", fontStyle: "italic" },
  { tag: tags.modifier, color: "var(--syntax-keyword)" },
  { tag: tags.operator, color: "var(--text-2)" },
  { tag: tags.punctuation, color: "var(--text-2)" },
]);

/** The selector of the drawing of a UML element in the completion list, as an element and as a statement that declares one. */
const drawing = (name: string) =>
  `.cm-completionIcon-uml-${name}, .cm-completionIcon-declare-uml-${name}`;

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
  // The completion list: a drawing of the kind, the name with what was typed marked, and what it is at the right.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    borderRadius: "8px",
    overflow: "hidden",
    padding: "4px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fontSize: "12px",
    maxHeight: "18em",
    minWidth: "min(24em, 90vw)",
    maxWidth: "min(40em, 90vw)",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "0 8px",
    height: "24px",
    borderRadius: "4px",
    lineHeight: "24px",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent-soft)",
    color: "var(--text)",
  },
  ".cm-completionLabel": { flex: "none" },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    color: "var(--accent)",
    fontWeight: "600",
  },
  ".cm-completionDetail": {
    flex: "1",
    minWidth: "0",
    marginLeft: "16px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "right",
    fontFamily: "system-ui, sans-serif",
    fontStyle: "normal",
    color: "var(--text-2)",
  },
  // The kinds as small drawings: the shapes of the notation, a line for a connection, a dot of a color.
  ".cm-completionIcon": {
    flex: "none",
    boxSizing: "border-box",
    width: "16px",
    height: "10px",
    padding: "0",
    margin: "0",
    opacity: "1",
    border: "1.5px solid var(--text-2)",
    "&:after": { content: '""' },
  },
  ".cm-completionIcon-storage, .cm-completionIcon-declare-storage": { borderRadius: "5px" },
  ".cm-completionIcon-human, .cm-completionIcon-declare-human": {
    width: "10px",
    margin: "0 3px",
    borderRadius: "50% 50% 2px 2px",
  },
  ".cm-completionIcon-group, .cm-completionIcon-declare-group": { borderStyle: "dashed" },
  ".cm-completionIcon-package, .cm-completionIcon-declare-package": {
    borderTopWidth: "3px",
  },
  ".cm-completionIcon-component, .cm-completionIcon-subsystem, .cm-completionIcon-class, .cm-completionIcon-declare-component, .cm-completionIcon-declare-subsystem, .cm-completionIcon-declare-class":
    { borderLeftWidth: "4px" },
  '[class*="cm-completionIcon-declare-"]': { borderColor: "var(--syntax-keyword)" },
  ".cm-completionIcon-connection": {
    height: "0",
    border: "none",
    borderTop: "1.5px solid var(--syntax-word)",
  },
  ".cm-completionIcon-keyword, .cm-completionIcon-constant": {
    width: "6px",
    height: "6px",
    margin: "0 5px",
    border: "none",
    borderRadius: "50%",
    backgroundColor: "var(--syntax-keyword)",
  },
  ".cm-completionIcon-constant": { backgroundColor: "var(--syntax-number)" },
  // The elements of the UML types, drawn in one color: that of a keyword where the option declares one.
  '[class*="cm-completionIcon-"][class*="uml-"]': {
    color: "var(--text-2)",
    borderColor: "currentColor",
  },
  '[class*="cm-completionIcon-"][class*="declare-uml-"]': { color: "var(--syntax-keyword)" },
  [drawing("class")]: {
    height: "12px",
    background: "linear-gradient(currentColor, currentColor) 0 3px / 100% 1.5px no-repeat",
  },
  [drawing("actor")]: { width: "10px", margin: "0 3px", borderRadius: "50% 50% 2px 2px" },
  [drawing("usecase")]: { borderRadius: "50%" },
  [`${drawing("step")}, ${drawing("state")}`]: { borderRadius: "4px" },
  [drawing("stadium")]: { borderRadius: "5px" },
  [drawing("cylinder")]: { borderRadius: "8px / 3px" },
  [drawing("hexagon")]: { borderLeftWidth: "3px", borderRightWidth: "3px", borderRadius: "3px" },
  [drawing("decision")]: {
    width: "9px",
    height: "9px",
    margin: "0 3.5px",
    transform: "rotate(45deg)",
  },
  [`${drawing("circle")}, ${drawing("final")}, ${drawing("method")}`]: {
    width: "10px",
    height: "10px",
    margin: "0 3px",
    border: "none",
    borderRadius: "50%",
    backgroundColor: "currentColor",
  },
  [drawing("final")]: {
    border: "1.5px solid currentColor",
    background: "radial-gradient(circle, currentColor 2px, transparent 2.5px)",
  },
  [`${drawing("method")}, ${drawing("attribute")}`]: {
    width: "8px",
    height: "8px",
    margin: "0 4px",
  },
  [drawing("bar")]: {
    height: "4px",
    border: "none",
    borderRadius: "1px",
    backgroundColor: "currentColor",
  },
  // A lifeline: the box of a participant and the dashed line below it.
  [drawing("participant")]: {
    position: "relative",
    width: "12px",
    height: "6px",
    margin: "0 2px 7px",
    "&:after": {
      position: "absolute",
      left: "3.75px",
      top: "4.5px",
      height: "7px",
      borderLeft: "1.5px dashed currentColor",
    },
  },
  // A fragment: a frame with the tab of its keyword.
  [drawing("frame")]: {
    height: "12px",
    background: "linear-gradient(currentColor, currentColor) 0 0 / 6px 3.5px no-repeat",
  },
  [drawing("note")]: {
    height: "12px",
    background: "linear-gradient(225deg, currentColor 3.5px, transparent 3.5px)",
  },
  [drawing("lanes")]: {
    height: "12px",
    background: "linear-gradient(currentColor, currentColor) 50% 0 / 1.5px 100% no-repeat",
  },
  '[class*="cm-completionIcon-color-"]': {
    width: "10px",
    height: "10px",
    margin: "0 3px",
    border: "none",
    borderRadius: "50%",
  },
  ".cm-completionIcon-color-blue": { backgroundColor: "#2a78d6" },
  ".cm-completionIcon-color-orange": { backgroundColor: "#eb6834" },
  ".cm-completionIcon-color-green": { backgroundColor: "#1baf7a" },
  ".cm-completionIcon-color-yellow": { backgroundColor: "#eda100" },
  ".cm-completionIcon-color-pink": { backgroundColor: "#e87ba4" },
  ".cm-completionIcon-color-purple": { backgroundColor: "#6250d6" },
  ".cm-completionIcon-color-red": { backgroundColor: "#e34948" },
  ".cm-completionIcon-color-gray": { backgroundColor: "#9a9da3" },
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
  /** The elements of the diagram, to offer where one is named. */
  elements(): Known[];
  /** Whether the source is a block diagram, completed from its notation. */
  completes(): boolean;
  /** The type of diagram the source draws: its colors and completions follow it. */
  type(): DiagramType;
  /** Steps back and forth in the document's history, which holds typed and canvas edits alike. */
  undo(): void;
  redo(): void;
  /** The cursor came to a line by a click or a key. */
  cursorAt(line: number): void;
}

export class SourcePane {
  private readonly view: EditorView;
  private readonly host: SourceHost;
  /** Long lines wrap or scroll: set by `setWrap`. */
  private readonly wrapping = new Compartment();
  /** The syntax of the diagram type: set by `setType`. */
  private readonly syntax = new Compartment();
  /** The diagram type whose syntax the pane has. */
  private type: DiagramType;

  constructor(parent: HTMLElement, host: SourceHost) {
    this.host = host;
    this.type = host.type();
    // A block diagram is completed from its elements; the other types from their text.
    const complete = (context: CompletionContext) =>
      completeSource(context, host.type(), host.completes() ? host.elements() : []);
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
          this.syntax.of(syntaxOf(this.type)),
          syntaxHighlighting(colors),
          closeBrackets(),
          // The list reaches past the pane, which would cut it off.
          tooltips({ parent: document.body }),
          autocompletion({ override: [complete], icons: true, closeOnBlur: true }),
          keymap.of([
            // Tab takes the completion on offer, as Enter does; else it indents.
            { key: "Tab", run: acceptCompletion },
            { key: "Enter", run: newlineAfterBlock(() => this.type) },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
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
    this.setType(this.host.type());
    if (text === this.text) return false;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      annotations: fromDocument.of(true),
    });
    return true;
  }

  /** Gives the pane the syntax of a diagram type: its colors, its comments and its indentation. */
  setType(type: DiagramType) {
    if (type === this.type) return;
    this.type = type;
    this.view.dispatch({
      effects: this.syntax.reconfigure(syntaxOf(type)),
      annotations: fromDocument.of(true),
    });
  }

  /** Underlines the line of a problem; line 0 is about the whole source. */
  setProblem(problem: { line: number; message: string } | undefined) {
    // The document is read anew whenever this is called: the moment its type may have changed.
    this.setType(this.host.type());
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
