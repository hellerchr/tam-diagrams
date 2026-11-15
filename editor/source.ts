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
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { setDiagnostics } from "@codemirror/lint";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  type TransactionSpec,
} from "@codemirror/state";
import {
  type Command,
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
import { completeSource, continues } from "./completion-uml.ts";
import { h, iconButton } from "./dom.ts";
import { newlineAfterBlock, syntaxOf, typingRules } from "./syntax.ts";
import { type DiagramType, typeOf } from "./types.ts";

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
  // The pane fills its place below the find bar, when that shows.
  "&": {
    flex: "1 1 0",
    minHeight: "0",
    fontSize: "12px",
    backgroundColor: "var(--field)",
    color: "var(--text)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    lineHeight: "1.55",
    // The signs of the syntax show as they are typed, not drawn together into arrows.
    fontVariantLigatures: "none",
    scrollbarWidth: "thin",
    scrollbarColor: "var(--line-strong) transparent",
  },
  // Room below the last line, for what lies over the foot of the pane.
  ".cm-content": { caretColor: "var(--text)", paddingBottom: "32px" },
  ".cm-found": { backgroundColor: "color-mix(in srgb, var(--warning) 28%, transparent)" },
  ".cm-found-here": { backgroundColor: "color-mix(in srgb, var(--warning) 60%, transparent)" },
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
    fontVariantLigatures: "none",
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

const markFound = StateEffect.define<{ from: number; to: number; here: boolean }[]>();

const found = Decoration.mark({ class: "cm-found" }),
  foundHere = Decoration.mark({ class: "cm-found cm-found-here" });

/** The places of the text that the find bar looks for, the one it stands on marked stronger. */
const foundPlaces = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(places, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(markFound))
        return Decoration.set(
          effect.value.map(({ from, to, here }) => (here ? foundHere : found).range(from, to)),
        );
    return places.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Where a text occurs in another, whatever the case of its letters: the start of each occurrence. */
export function occurrences(text: string, sought: string): number[] {
  const places: number[] = [];
  if (!sought) return places;
  const all = text.toLowerCase(),
    part = sought.toLowerCase();
  for (let at = all.indexOf(part); at >= 0; at = all.indexOf(part, at + part.length))
    places.push(at);
  return places;
}

/**
 * Backspace at the end of a line that holds only spaces removes the line: the cursor is back at
 * the end of the line above, as before Enter was pressed there. Left to the other bindings
 * anywhere else.
 */
export const backspaceBlankLine: Command = (view) => {
  const { state } = view,
    range = state.selection.main,
    line = state.doc.lineAt(range.head);
  if (state.selection.ranges.length > 1 || !range.empty || range.head !== line.to) return false;
  if (line.number === 1 || !line.text || line.text.trim()) return false;
  view.dispatch({
    changes: { from: line.from - 1, to: line.to },
    selection: { anchor: line.from - 1 },
    userEvent: "delete.backward",
    scrollIntoView: true,
  });
  return true;
};

/**
 * The smallest change that turns one text into another: what lies between the start and the end
 * the two have in common. Where lines were only added or only removed, the change is whole lines:
 * it starts at the start of a line. Undefined when the texts are the same.
 */
export function changeBetween(
  old: string,
  text: string,
): { from: number; to: number; insert: string } | undefined {
  if (old === text) return undefined;
  const most = Math.min(old.length, text.length);
  let start = 0;
  while (start < most && old[start] === text[start]) start++;
  let end = 0;
  while (end < most - start && old[old.length - 1 - end] === text[text.length - 1 - end]) end++;
  // Text that is only added or removed may be said to start earlier, when it ends as the text before it does.
  const longer = old.length > text.length ? old : text,
    length = longer.length - end - start;
  if (most === start + end && longer.slice(start, start + length).includes("\n")) {
    let back = 0;
    while (
      start - back > 0 &&
      longer[start - back - 1] !== "\n" &&
      longer[start - back - 1] === longer[start - back + length - 1]
    )
      back++;
    if (start - back === 0 || longer[start - back - 1] === "\n") {
      start -= back;
      end += back;
    }
  }
  return { from: start, to: old.length - end, insert: text.slice(start, text.length - end) };
}

/**
 * The change that shows a text of the document in the pane: only what differs is replaced, so the
 * cursor, the marked lines and the view stay where they are around it. With `follow` the cursor
 * goes to where the change ends: the place a step of the history changed. Undefined when the pane
 * shows the text already.
 */
export function showText(
  state: EditorState,
  text: string,
  follow = false,
): TransactionSpec | undefined {
  const change = changeBetween(state.doc.toString(), text);
  if (!change) return undefined;
  return {
    changes: change,
    ...(follow
      ? {
          selection: EditorSelection.cursor(change.from + change.insert.length),
          scrollIntoView: true,
        }
      : {}),
    annotations: fromDocument.of(true),
  };
}

/**
 * Tab behind text on a line writes nothing: it leaves a word that is selected, such as the last
 * field of a statement just filled in, with the cursor behind it. Tab indents at the start of a
 * line and with lines selected, which is left to the binding after this one.
 */
export const tabBehindText: Command = (view) => {
  const { state } = view,
    range = state.selection.main,
    line = state.doc.lineAt(range.from);
  if (state.selection.ranges.length > 1 || range.to > line.to) return false;
  if (!state.sliceDoc(line.from, range.from).trim()) return false;
  if (!range.empty) view.dispatch({ selection: { anchor: range.to } });
  return true;
};

/** The hanging indent of a line that starts with some columns of space, made once per number of columns. */
const HANGING = new Map<number, Decoration>();

const hanging = (columns: number) => {
  let made = HANGING.get(columns);
  if (!made) {
    made = Decoration.line({
      attributes: { style: `text-indent: -${columns}ch; padding-left: calc(${columns}ch + 6px)` },
    });
    HANGING.set(columns, made);
  }
  return made;
};

/**
 * The lines that wrap continue two columns further in than they start, so the start of each
 * statement stands out. Every line of the text has its indent, whether it is in view or not: what
 * is in view changes with the heights of the lines, which must not change the lines in turn.
 */
const hangingIndent = StateField.define<DecorationSet>({
  create: (state) => indents(state),
  update: (lines, transaction) => (transaction.docChanged ? indents(transaction.state) : lines),
  provide: (field) => EditorView.decorations.from(field),
});

function indents(state: EditorState): DecorationSet {
  const lines = [];
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    lines.push(hanging(line.text.length - line.text.trimStart().length + 2).range(line.from));
  }
  return Decoration.set(lines);
}

/** How a place is brought into view: where in the pane it comes to stand, and how far from its edges at least. */
interface Reveal {
  x: string;
  y: string;
  xMargin: number;
  yMargin: number;
}

/**
 * Scrolls the pane, and nothing else, so that a place of the text shows. The heights of lines far
 * from view are estimates, so the place is looked at once more after the pane moved.
 */
function reveal(view: EditorView, pos: number, options: Reveal, again = true) {
  view.requestMeasure({
    read(view) {
      const at = Math.min(pos, view.state.doc.length),
        block = view.lineBlockAt(at),
        scroller = view.scrollDOM,
        box = scroller.getBoundingClientRect(),
        gutters = scroller.querySelector<HTMLElement>(".cm-gutters")?.offsetWidth ?? 0;
      return {
        at: view.coordsAtPos(at),
        line: { top: view.documentTop + block.top, bottom: view.documentTop + block.bottom },
        top: box.top + options.yMargin,
        bottom: box.top + scroller.clientHeight - options.yMargin,
        left: box.left + gutters + options.xMargin,
        right: box.left + scroller.clientWidth - options.xMargin,
      };
    },
    write({ at, line, top, bottom, left, right }, view) {
      const scroller = view.scrollDOM,
        before = scroller.scrollTop,
        // The place itself where it is drawn, else the line it is in.
        { top: start, bottom: end } = at ?? line,
        y =
          options.y === "nearest" ? (start < top ? "start" : end > bottom ? "end" : "") : options.y;
      if (y === "center") scroller.scrollTop += (start + end) / 2 - (top + bottom) / 2;
      else if (y === "start") scroller.scrollTop += start - top;
      else if (y === "end") scroller.scrollTop += end - bottom;
      if (at && at.left < left) scroller.scrollLeft += at.left - left;
      else if (at && at.right > right) scroller.scrollLeft += at.right - right;
      if (again && (!at || Math.abs(scroller.scrollTop - before) > 1))
        reveal(view, pos, options, false);
    },
  });
}

/**
 * What is brought into view is brought there by scrolling the pane alone: nothing around the pane
 * moves, whatever else on the page could scroll.
 */
const scrollPane = EditorView.scrollHandler.of((view, range, options) => {
  reveal(view, range.head, options);
  return true;
});

/**
 * Where the lists and hints of the pane are put: a place of no size at the corner of the window,
 * so they can reach past the pane without making the page any larger.
 */
function tooltipHolder(): HTMLElement {
  const holder = document.createElement("div");
  holder.className = "cm-tooltip-holder";
  Object.assign(holder.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "0",
    height: "0",
    overflow: "visible",
    zIndex: "50",
  });
  document.body.append(holder);
  return holder;
}

/** What the pane asks of the editor around it. */
export interface SourceHost {
  /**
   * The text changed by typing. `whole` says that the change left a whole statement: it ended a
   * line, took a completion, or was pasted or added, and is not a word half typed.
   */
  changed(text: string, whole: boolean): void;
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
  /** The syntax of the diagram type: set by `setType`. */
  private readonly syntax = new Compartment();
  /** The diagram type whose syntax the pane has. */
  private type: DiagramType;
  /** Typed text is on its way to the document, which takes it after a pause. */
  private pending = false;
  /** The steps of the history asked for while typed text was on its way: taken once it arrived. */
  private waiting: (() => void)[] = [];
  /** A step of the history is being taken from the pane: the cursor follows the change. */
  private stepping = false;
  /** The user works in the pane: a key or a press went to it last, not to something else on the page. */
  private active = false;
  /** When Tab was last pressed anywhere on the page: the focus that comes right after came by it. */
  private tabbed = -Infinity;
  /** The find bar: a field above the text, and how many places of the text it found. */
  private readonly finder: {
    bar: HTMLElement;
    field: HTMLInputElement;
    count: HTMLElement;
  };

  constructor(parent: HTMLElement, host: SourceHost) {
    this.host = host;
    this.type = host.type();
    // What is typed is read as the type its text says, which the document learns only after a pause.
    const typed = () => typeOf(this.view.state.doc.toString());
    // A block diagram is completed from its elements; the other types from their text.
    const complete = (context: CompletionContext) =>
      completeSource(context, typed(), host.completes() ? host.elements() : []);
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        extensions: [
          lineNumbers(),
          drawSelection(),
          highlightActiveLine(),
          indentUnit.of("  "),
          EditorState.tabSize.of(2),
          this.syntax.of(syntaxOf(this.type)),
          syntaxHighlighting(colors),
          typingRules(typed),
          closeBrackets(),
          // The list reaches past the pane, which would cut it off.
          tooltips({ position: "fixed", parent: tooltipHolder() }),
          autocompletion({
            override: [complete],
            icons: true,
            closeOnBlur: true,
            activateOnCompletion: continues,
          }),
          keymap.of([
            // Tab takes the completion on offer, as Enter does; else it indents.
            { key: "Tab", run: acceptCompletion },
            { key: "Tab", run: tabBehindText },
            { key: "Enter", run: newlineAfterBlock(typed) },
            { key: "Mod-f", run: () => (this.find(), true), preventDefault: true },
            ...closeBracketsKeymap,
            { key: "Backspace", run: backspaceBlankLine },
            ...defaultKeymap,
            indentWithTab,
          ]),
          scrollPane,
          EditorView.domEventHandlers({
            keydown: (event) => {
              this.active = true;
              // The pane has no history of its own: the document's holds typed and canvas edits alike.
              const key = event.key.toLowerCase();
              if (!(event.ctrlKey || event.metaKey) || event.altKey || (key !== "z" && key !== "y"))
                return false;
              return this.step(
                key === "z" && !event.shiftKey ? () => host.undo() : () => host.redo(),
              );
            },
            mousedown: (_, view) => {
              this.active = true;
              view.setTabFocusMode(false);
            },
            // A pane the focus came to by Tab lets Tab go on to the next control, until something is typed or pressed in it.
            focus: (_, view) => {
              if (performance.now() - this.tabbed < 100) view.setTabFocusMode(true);
            },
            blur: () => {
              this.active = false;
            },
          }),
          selectedLines,
          foundPlaces,
          // A line cut at the pane's edge hides what it says: long lines wrap.
          EditorView.lineWrapping,
          hangingIndent,
          look,
          EditorView.contentAttributes.of({ "aria-label": "Diagram source", spellcheck: "false" }),
          EditorView.updateListener.of((update) => {
            const own = update.transactions.filter(
              (transaction) => !transaction.annotation(fromDocument),
            );
            if (own.some((transaction) => transaction.docChanged)) {
              this.pending = true;
              this.active = true;
              update.view.setTabFocusMode(false);
              // A line that was ended, a completion, and text that came whole leave a statement.
              const whole = own.some((transaction) => {
                if (
                  transaction.isUserEvent("input.complete") ||
                  transaction.isUserEvent("input.paste") ||
                  transaction.isUserEvent("input.drop")
                )
                  return true;
                let lines = false;
                transaction.changes.iterChanges((_from, _to, _start, _end, inserted) => {
                  lines ||= inserted.lines > 1;
                });
                return lines;
              });
              host.changed(update.state.doc.toString(), whole);
              if (!this.finder.bar.hidden) this.seek(0, false);
            }
            // A click or a key moved the cursor: the element declared there is selected.
            else if (update.selectionSet && own.length && update.view.hasFocus)
              host.cursorAt(update.state.doc.lineAt(update.state.selection.main.head).number);
          }),
        ],
      }),
    });
    this.finder = this.findBar(parent);
    // What happens outside the pane: a press there ends the work in it, and Tab may bring the focus to it.
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!(event.target instanceof Node && this.view.dom.contains(event.target)))
          this.active = false;
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Tab") this.tabbed = performance.now();
      },
      true,
    );
  }

  /**
   * Takes a step of the document's history, with the cursor following to where the text changed.
   * While typed text is on its way to the document the step waits for it, so that it steps back
   * from what is on show.
   */
  private step(run: () => void): boolean {
    if (this.pending) this.waiting.push(run);
    else {
      this.stepping = true;
      try {
        run();
      } finally {
        this.stepping = false;
      }
    }
    return true;
  }

  /** Builds the find bar: a field, how many places it found, and the ways to the one before and after. */
  private findBar(parent: HTMLElement) {
    const field = h("input", {
        class: "field",
        type: "text",
        spellcheck: "false",
        placeholder: "Find in the source…",
        "aria-label": "Find in the source",
      }),
      count = h("span", { class: "find-count", role: "status" }),
      close = () => {
        bar.hidden = true;
        this.view.dispatch({ effects: markFound.of([]), annotations: fromDocument.of(true) });
        this.view.focus();
      },
      bar = h(
        "div",
        { class: "find-bar", role: "search" },
        field,
        count,
        iconButton(
          "arrow-up",
          { tip: "The one before", key: "Shift+Enter" },
          () => this.seek(-1),
          "button small",
        ),
        iconButton(
          "arrow-down",
          { tip: "The next", key: "Enter" },
          () => this.seek(1),
          "button small",
        ),
        iconButton("close", { tip: "Close", key: "Esc" }, close, "button small"),
      );
    bar.hidden = true;
    field.addEventListener("input", () => this.seek(0));
    bar.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
      else if (event.key === "Enter" && event.target === field) this.seek(event.shiftKey ? -1 : 1);
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") field.select();
      else return;
      event.preventDefault();
      event.stopPropagation();
    });
    parent.prepend(bar);
    return { bar, field, count };
  }

  /** Opens the find bar with what is selected in it, or what was looked for last. */
  find() {
    const { bar, field } = this.finder,
      { state } = this.view,
      range = state.selection.main,
      chosen = state.sliceDoc(range.from, range.to);
    bar.hidden = false;
    if (chosen && !chosen.includes("\n")) field.value = chosen;
    field.focus();
    field.select();
    this.seek(0);
  }

  /**
   * Marks every place the text of the find bar occurs and selects one of them: the first from the
   * cursor on (0), the next (1) or the one before (-1), going round at the ends. With `select`
   * off the places are only marked, as after typing in the pane.
   */
  private seek(step: -1 | 0 | 1, select = true) {
    const { field, count } = this.finder,
      { state } = this.view,
      sought = field.value,
      places = occurrences(state.doc.toString(), sought),
      range = state.selection.main,
      here = places.indexOf(range.from),
      // The place selected now is where the others are counted from.
      at = !places.length
        ? -1
        : step === 0
          ? Math.max(
              0,
              places.findIndex((place) => place >= range.from),
            )
          : here >= 0
            ? (here + step + places.length) % places.length
            : step > 0
              ? Math.max(
                  0,
                  places.findIndex((place) => place >= range.from),
                )
              : (places.findLastIndex((place) => place < range.from) + places.length) %
                places.length;
    count.textContent = !sought ? "" : places.length ? `${at + 1} of ${places.length}` : "None";
    this.view.dispatch({
      effects: [
        markFound.of(
          places.map((from, index) => ({
            from,
            to: from + sought.length,
            here: select && index === at,
          })),
        ),
        ...(select && at >= 0 ? [EditorView.scrollIntoView(places[at], { y: "center" })] : []),
      ],
      ...(select && at >= 0
        ? { selection: EditorSelection.range(places[at], places[at] + sought.length) }
        : {}),
      annotations: fromDocument.of(true),
    });
  }

  get text() {
    return this.view.state.doc.toString();
  }

  get focused() {
    return this.view.hasFocus;
  }

  /** The line the cursor is on, from 1. */
  get cursorLine() {
    const { state } = this.view;
    return state.doc.lineAt(state.selection.main.head).number;
  }

  /**
   * Shows a text that came from the document: an edit on the canvas, a step of the history, a file.
   * It is not typing, so the host does not hear of it. Only what differs is replaced: the cursor,
   * the view and the marked lines stay around it. True when the text was another.
   */
  setText(text: string): boolean {
    this.setType(this.host.type());
    // The document has what was typed: the steps that waited for it are taken, once this call is through.
    this.pending = false;
    const waiting = this.waiting.splice(0);
    if (waiting.length) queueMicrotask(() => waiting.forEach((run) => this.step(run)));
    const change = showText(this.view.state, text, this.stepping);
    if (!change) return false;
    this.view.dispatch(change);
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

  /** Marks the lines of what is selected on the canvas and brings the first into view, unless the user works here. */
  setSelectedLines(lines: number[]) {
    this.view.dispatch({
      effects: [
        markLines.of(lines),
        ...(lines.length && !this.active && lines[0] >= 1 && lines[0] <= this.view.state.doc.lines
          ? [EditorView.scrollIntoView(this.view.state.doc.line(lines[0]).from, { y: "nearest" })]
          : []),
      ],
      annotations: fromDocument.of(true),
    });
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
    this.active = true;
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
      userEvent: "input.complete",
    });
    this.active = true;
    this.view.focus();
  }
}
