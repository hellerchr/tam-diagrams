/**
 * Editing a state diagram source as text: adding, naming, connecting, moving and removing states,
 * the way uml-activity-edit.ts edits flowcharts. Each function returns the source with one change made.
 * A state diagram holds one statement a line, so an edit adds, replaces or drops whole lines and
 * every other line stays as it was. The layout stays automatic.
 *
 * Where a line stands matters: a state belongs to the composite state (or its region) that holds
 * the line which names it first, and `[*]` means the initial or a final state of the composite its
 * line stands in. The edits therefore choose the place of a new line by what it has to mean, and
 * leave a line that keeps a state in its place when the line that named it first goes.
 */

import type { Structure, StructureEdge, StructureNode } from "./structure.ts";
import { parseStateDiagram, type StateDiagram, type UmlState } from "./uml-state.ts";
import { accessibilityLines, scan, STYLING } from "./uml.ts";

/** What a canvas adds to a state diagram. */
export type StatePiece =
  "state" | "composite" | "start" | "end" | "choice" | "fork" | "join" | "note" | "region";

const linesOf = (source: string) => source.replace(/\r\n?/g, "\n").split("\n");

const indentOf = (line: string) => line.match(/^\s*/)![0];

// The statements as the parser of uml-state.ts reads them.
const ID = '(\\[\\*\\]|[^:\\s\\-{}"]+)(?::::[\\w-]+)?';
const ARROW = new RegExp(`^${ID}\\s*-->\\s*${ID}`, "u");
const TRANSITION = new RegExp(`^${ID}\\s*-->\\s*${ID}\\s*(?::\\s*(.*))?$`, "u");
const DESCRIPTION = new RegExp(`^${ID}\\s*:\\s*(.*)$`, "u");
const SPECIAL = new RegExp(
  `^state\\s+${ID}\\s*(?:<<\\s*(choice|fork|join)\\s*>>|\\[\\[\\s*(choice|fork|join)\\s*\\]\\])$`,
  "iu",
);
const ALIAS = new RegExp(`^state\\s+"([^"]*)"\\s+as\\s+${ID}\\s*(\\{)?$`, "u");
const DECLARE = new RegExp(`^state\\s+${ID}\\s*(\\{)?$`, "u");
const NOTE = new RegExp(`^note\\s+(left|right)\\s+of\\s+${ID}\\s*(?::\\s*(.*))?$`, "iu");
const NOTE_HEAD = new RegExp(`^(note\\s+(?:left|right)\\s+of\\s+)${ID}`, "iu");
const BARE = new RegExp(`^${ID}$`, "u");

/** An id with the `:::class` that may follow it, each on its own. */
const NAME = '(\\[\\*\\]|[^:\\s\\-{}"]+)((?::::[\\w-]+)?)';
const FIRST = new RegExp(`^${NAME}`, "u");
/** The two ends of a transition with the arrow between them, as they are written. */
const ENDS = new RegExp(`^${NAME}(\\s*-->\\s*)${NAME}`, "u");
/** What stands before the id of a statement that says something of one state. */
const BEFORE_ID: Partial<Record<Statement["kind"], RegExp>> = {
  special: /^state\s+/,
  declare: /^state\s+/,
  alias: /^state\s+"[^"]*"\s+as\s+/,
  note: /^note\s+(?:left|right)\s+of\s+/i,
  bare: /^/,
  description: /^/,
};

/** A name that can be the id of a state as it is typed. */
const PLAIN = /^[A-Za-z_]\w*$/;

/** The ids new states and composite states get when their name cannot be one. */
const GENERATED = /^(?:state|composite)\d+(?:_\d+)?$/;

/** The initial or a final state of a scope, as the parser names it: `root#initial`, `Edit#final2`. */
const PSEUDO = /^(.*)#(initial|final\d+)$/;

/** A statement of the source that says something of states. */
interface Statement {
  /** The index of its line, and of its last line: a note may run to its `end note`. */
  index: number;
  last: number;
  text: string;
  kind:
    "transition" | "special" | "alias" | "declare" | "note" | "bare" | "description" | "styling";
  /** The states it names; `[*]` is not among them. */
  ids: string[];
  /**
   * The scope the parser is in when it reads the line: `root`, a composite state, or from the
   * second region on the region. A state named first here becomes a child of that scope.
   */
  scope: string;
}

/** A `state X {` … `}` block, with the `--` lines that split it into regions. */
interface Block {
  id: string;
  open: number;
  close: number;
  separators: number[];
  /** The id of each region, first to last; empty for a block without `--`. */
  regions: string[];
}

interface Outline {
  statements: Statement[];
  blocks: Block[];
}

/** The statements and blocks of a source the parser accepts, with the ids the parser gives regions. */
function outlineOf(source: string): Outline {
  const statements: Statement[] = [],
    blocks: Block[] = [],
    stack: Block[] = [],
    accessibility = accessibilityLines();
  let note: Statement | null = null,
    regions = 0;
  const [, ...lines] = scan(source).lines;
  for (const { text, line } of lines) {
    const index = line - 1;
    if (note) {
      if (/^end\s+note$/i.test(text)) {
        note.last = index;
        note = null;
      }
      continue;
    }
    if (accessibility(text)) continue;
    if (/^direction\s+(TB|TD|BT|LR|RL)$/i.test(text)) continue;
    if (/^(hide\s+empty\s+description|scale\s+\d+\s+width)$/i.test(text)) continue;
    const top = stack.at(-1);
    if (text === "}") {
      const block = stack.pop();
      if (block) block.close = index;
      continue;
    }
    if (text === "--") {
      if (!top) continue;
      if (!top.separators.length) top.regions.push(`${top.id}#region${++regions}`);
      top.regions.push(`${top.id}#region${++regions}`);
      top.separators.push(index);
      continue;
    }
    const state = (kind: Statement["kind"], ids: string[]): Statement => {
      const statement: Statement = {
        index,
        last: index,
        text,
        kind,
        ids: ids.filter((id) => id !== "[*]"),
        scope: top ? (top.regions.at(-1) ?? top.id) : "root",
      };
      statements.push(statement);
      return statement;
    };
    let match: RegExpMatchArray | null;
    if ((match = text.match(TRANSITION))) state("transition", [match[1], match[2]]);
    else if ((match = text.match(SPECIAL))) state("special", [match[1]]);
    else if ((match = text.match(ALIAS)) || (match = text.match(DECLARE))) {
      const aliased = text.startsWith('state "'),
        id = aliased ? match[2] : match[1];
      state(aliased ? "alias" : "declare", [id]);
      if (aliased ? match[3] : match[2]) {
        const block: Block = { id, open: index, close: index, separators: [], regions: [] };
        blocks.push(block);
        stack.push(block);
      }
    } else if ((match = text.match(NOTE))) {
      const statement = state("note", [match[2]]);
      if (match[3] === undefined) note = statement;
    } else if (STYLING.test(text)) state("styling", []);
    else if (BARE.test(text) && !/^(state|note)\b/.test(text))
      state("bare", [text.replace(/:::.*$/, "")]);
    else if ((match = text.match(DESCRIPTION))) state("description", [match[1]]);
  }
  return { statements, blocks };
}

/** A source read both ways: what it means, and where its lines say so. */
interface Model {
  diagram: StateDiagram;
  lines: string[];
  outline: Outline;
}

const modelOf = (source: string): Model => ({
  diagram: parseStateDiagram(source),
  lines: linesOf(source),
  outline: outlineOf(source),
});

const parses = (source: string) => {
  try {
    parseStateDiagram(source);
    return true;
  } catch {
    return false;
  }
};

/** The block and the segment of it that a region is. */
function segmentOf(outline: Outline, region: string) {
  for (const block of outline.blocks) {
    const segment = block.regions.indexOf(region);
    if (segment >= 0) return { block, segment };
  }
  return null;
}

/** The last block that opens a composite state. */
const lastBlock = (outline: Outline, id: string) =>
  outline.blocks.findLast((block) => block.id === id);

/** The indentation of the statements that stand in no block. */
const rootIndent = ({ lines, outline }: Model) =>
  outline.statements.length ? indentOf(lines[outline.statements[0].index]) : "  ";

/** One step of indentation, as the source indents. */
const indentStep = (model: Model) => {
  const indent = rootIndent(model);
  return indent.includes("\t") ? "\t" : indent || "  ";
};

/** Where a line is added: the index it is put before, and its indentation. */
interface Place {
  at: number;
  indent: string;
}

/**
 * The end of the source: after the last line with text, and before the styling (`classDef`,
 * `class`, `style`) a source closes with, with the comments that stand right above it.
 */
function rootPlace(model: Model): Place {
  const { lines, outline } = model,
    styling = new Set(
      outline.statements.filter((item) => item.kind === "styling").map((item) => item.index),
    );
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  let at = end;
  while (at > 0 && styling.has(at - 1)) at--;
  if (at < end) {
    while (at > 0 && lines[at - 1].trim().startsWith("%%")) at--;
    while (at > 0 && !lines[at - 1].trim()) at--;
    // Only the header above: the styling is all the source holds, and stays where it is.
    if (!outline.statements.some((item) => item.index < at)) at = end;
  }
  return { at, indent: rootIndent(model) };
}

/**
 * Where a note of a state is added: after the notes the state has, or else after the statement
 * that names the state first, behind its block when that statement opens one.
 */
function notePlace(model: Model, state: UmlState): Place {
  const { lines, outline } = model,
    noted = outline.statements.findLast((item) => item.kind === "note" && item.ids[0] === state.id),
    first = outline.statements.find((item) => item.index === state.line - 1),
    host = noted ?? first;
  if (!host) return rootPlace(model);
  const block = outline.blocks.find((item) => item.open === host.index);
  return { at: (block ? block.close : host.last) + 1, indent: indentOf(lines[host.index]) };
}

/**
 * Where a statement is added to a scope: at the end of the source, before the `}` of a composite
 * state, or before the `--` that ends a region. A composite state split into regions takes it in
 * its first region, which is the scope the parser calls by the name of the composite state.
 */
function placeIn(model: Model, scope: string): Place | null {
  if (scope === "root") return rootPlace(model);
  const block = lastBlock(model.outline, scope),
    found = segmentOf(model.outline, scope) ?? (block ? { block, segment: 0 } : null);
  return found ? segmentPlace(model, found.block, found.segment) : null;
}

/** Where a statement is added to one segment of a block: before the `--` or the `}` that ends it. */
function segmentPlace(model: Model, block: Block, segment: number): Place {
  const bounds = [block.open, ...block.separators, block.close],
    start = bounds[segment],
    at = bounds[segment + 1],
    first = model.lines[start + 1];
  return {
    at,
    indent:
      start + 1 < at && first.trim()
        ? indentOf(first)
        : indentOf(model.lines[block.open]) + indentStep(model),
  };
}

/**
 * The scope a part added at `parent` goes into: the last region of a composite state, the region
 * itself, the scope that holds a part which holds nothing, or `root`.
 */
function scopeAt({ diagram, outline }: Model, parent: string | null | undefined): string {
  for (let id = parent ?? null; id;) {
    const state = diagram.states.get(id);
    if (!state) break;
    if (state.kind === "region") {
      const found = segmentOf(outline, id);
      if (found) return found.segment ? id : found.block.id;
    }
    const block = lastBlock(outline, id);
    if (block) return block.regions.at(-1) ?? id;
    id = state.parent;
  }
  return "root";
}

/**
 * Text as a name, a transition's label or a note holds it: line breaks as `<br>`, and as entities
 * what the parser would read as markup. A name stands in quotes, so its quotes are entities too.
 */
export function escapeText(label: string, quoted: boolean): string {
  const text = label
    .trim()
    .replace(/[#&](?=\w+;)/g, (mark) => (mark === "#" ? "#35;" : "#amp;"))
    .replace(/<(?=\/?[a-z])(?!br\s*\/?>)/gi, "#lt;")
    .replace(/\\n/g, "#92;n")
    .replace(/\s*\n\s*/g, "<br>");
  return quoted || /^".*"$/.test(text) ? text.replace(/"/g, "#quot;") : text;
}

/** A state on a line of its own; with `state` before an id the parser would read as a keyword. */
const declareText = (id: string) =>
  /^(state|note|end|direction|hide|scale|accTitle|accDescr)\b/i.test(id) || STYLING.test(id)
    ? `state ${id}`
    : id;

/** An id no state has yet. */
function freshId(diagram: StateDiagram, base: string): string {
  for (let count = 1; ; count++) {
    const id = `${base}${count}`;
    if (!diagram.states.has(id)) return id;
  }
}

/** The id and the declaration of a new state: its name as the id when the name can be one. */
function newState(diagram: StateDiagram, label: string | undefined, base: string, open = false) {
  const name = label?.trim() || (base === "state" ? "State" : "Composite"),
    plain =
      !!label?.trim() &&
      /^[A-Za-z_]\w*$/.test(name) &&
      !/^note\d+$/.test(name) &&
      !diagram.states.has(name),
    id = plain ? name : freshId(diagram, base),
    text = plain
      ? open
        ? `state ${id}`
        : declareText(id)
      : `state "${escapeText(name, true)}" as ${id}`;
  return { id, text: open ? `${text} {` : text };
}

const isPseudo = (state: UmlState | undefined) =>
  state?.kind === "initial" || state?.kind === "final";

/** A state that can be named, joined and noted: not a region, not `[*]`. */
const isReal = (state: UmlState | undefined): state is UmlState =>
  !!state && state.kind !== "region" && !isPseudo(state);

/**
 * Puts statements where a part added at `parent` belongs. A plain state as the parent becomes a
 * composite state: its declaration opens a block, or a block is opened after the line that names
 * it first.
 */
function insertAt(model: Model, parent: string | null | undefined, texts: string[]): string[] {
  const { diagram, lines, outline } = model,
    state = parent ? diagram.states.get(parent) : undefined;
  if (state?.kind === "state" && !lastBlock(outline, state.id)) {
    const own = (kind: Statement["kind"]) =>
      outline.statements.filter((item) => item.kind === kind && item.ids[0] === state.id);
    const declared = own("alias").at(-1) ?? own("declare")[0],
      first = outline.statements.find((item) => item.index === state.line - 1),
      host = declared ?? first;
    if (host) {
      const indent = indentOf(lines[host.index]),
        inner = texts.map((text) => indent + indentStep(model) + text);
      if (declared) {
        lines[host.index] = `${lines[host.index].trimEnd()} {`;
        lines.splice(host.index + 1, 0, ...inner, `${indent}}`);
      } else lines.splice(host.last + 1, 0, `${indent}state ${state.id} {`, ...inner, `${indent}}`);
      return lines;
    }
  }
  const place = placeIn(model, scopeAt(model, parent)) ?? rootPlace(model);
  lines.splice(place.at, 0, ...texts.map((text) => (text ? place.indent + text : "")));
  return lines;
}

/**
 * Adds a state, a composite state, a choice or a fork or join bar, inside the composite state or
 * region `parent` when given, and returns the id it got. The id is empty and the source unchanged
 * when the diagram cannot take the piece: a fork in a diagram of the conceptual level, a note or a
 * region without the part it belongs to.
 *
 * A note stands beside a state, so its `parent` is that state (a state, a composite state, a
 * choice or a bar): the note is written after the line that names the state first. A region is a
 * part of a composite state, so its `parent` is that composite state or one of its regions.
 *
 * An initial or final state is written only as the `[*]` end of a transition, so adding a start or
 * an end changes nothing yet: it returns the id the pseudo-state gets once `connectState` joins it
 * to a state of the scope `parent`. A caller adds it with `add(source, {kind, parent})` and then
 * joins it: `connect(made, at)` for a start, `connect(at, made)` for an end. With a composite state
 * as both `parent` and `at`, the transition is written beside the composite state (`[*] -->
 * Composite`, `Composite --> [*]`), and the pseudo-state is the one of the scope that holds it;
 * `connectState` returns the transition, whose end is then the pseudo-state to select.
 */
export function addStatePiece(
  source: string,
  piece: { kind: StatePiece; label?: string; parent?: string | null },
): { source: string; id: string } {
  const model = modelOf(source),
    { diagram, lines, outline } = model,
    done = (id: string) => {
      const result = lines.join("\n");
      return parses(result) ? { source: result, id } : { source, id: "" };
    };
  switch (piece.kind) {
    case "start":
      return { source, id: `${scopeAt(model, piece.parent)}#initial` };
    case "end": {
      // Final states are numbered in the order of the source: the one more before where its line goes.
      const scope = scopeAt(model, piece.parent),
        place = placeIn(model, scope) ?? rootPlace(model),
        before = diagram.transitions.filter(
          (item) => diagram.states.get(item.target)?.kind === "final" && item.line - 1 < place.at,
        );
      return { source, id: `${scope}#final${before.length + 1}` };
    }
    case "choice":
    case "fork":
    case "join": {
      const id = freshId(diagram, piece.kind);
      insertAt(model, piece.parent, [`state ${id} <<${piece.kind}>>`]);
      return done(id);
    }
    case "composite": {
      const { id, text } = newState(diagram, piece.label, "composite", true);
      insertAt(model, piece.parent, [text, "}"]);
      return done(id);
    }
    case "note": {
      const target = piece.parent ? diagram.states.get(piece.parent) : undefined;
      if (!isReal(target)) return { source, id: "" };
      const place = notePlace(model, target),
        text = escapeText(piece.label ?? "", false) || "Note";
      lines.splice(place.at, 0, `${place.indent}note right of ${target.id} : ${text}`);
      // Notes are numbered in the order of the source.
      return done(`note${diagram.notes.filter((note) => note.line - 1 < place.at).length + 1}`);
    }
    case "region": {
      const parent = piece.parent ? diagram.states.get(piece.parent) : undefined,
        holder = parent?.kind === "region" ? parent.parent : (parent?.id ?? null),
        block = holder ? lastBlock(outline, holder) : undefined;
      if (!holder || !block) return { source, id: "" };
      const inner = freshId(diagram, "state"),
        indent = placeIn(model, block.regions.at(-1) ?? holder)!.indent;
      lines.splice(block.close, 0, `${indent}--`, `${indent}state "State" as ${inner}`);
      const result = lines.join("\n");
      if (!parses(result)) return { source, id: "" };
      return { source: result, id: lastBlock(outlineOf(result), holder)!.regions.at(-1)! };
    }
    default: {
      const { id, text } = newState(diagram, piece.label, "state");
      insertAt(model, piece.parent, [text]);
      return done(id);
    }
  }
}

/** An end of a transition to write: a state, or the `[*]` of a scope. */
interface End {
  text: string;
  /** The state, when it is one that is named. */
  state?: UmlState;
  /** The scope whose initial or final state it is. */
  scope?: string;
  kind?: "initial" | "final";
}

function endOf({ diagram }: Model, id: string): End | null {
  const state = diagram.states.get(id);
  if (isReal(state)) return { text: id, state };
  const match = diagram.states.get(id)?.kind === "region" ? null : id.match(PSEUDO);
  if (!match) return null;
  return {
    text: "[*]",
    scope: match[1],
    kind: match[2] === "initial" ? "initial" : "final",
  };
}

/** Moves a note beside another state. */
function moveNote(model: Model, note: string, target: string): string {
  const { diagram, lines, outline } = model,
    found = diagram.notes.find((item) => item.id === note),
    statement = found && outline.statements.find((item) => item.index === found.line - 1),
    state = diagram.states.get(target),
    head = statement?.text.match(NOTE_HEAD);
  if (!found || !statement || !head || !isReal(state) || found.target === target)
    return lines.join("\n");
  const indent = indentOf(lines[statement.index]),
    text = head[1] + target + statement.text.slice(head[0].length);
  // Before the line that names its state first, the note would name it first: then it moves to the end.
  if (state.line - 1 < statement.index) {
    lines[statement.index] = indent + text;
    return lines.join("\n");
  }
  const place = rootPlace(model),
    rest = lines
      .slice(statement.index + 1, statement.last + 1)
      .map((line) => place.indent + (line.startsWith(indent) ? line.slice(indent.length) : line));
  lines.splice(place.at, 0, place.indent + text, ...rest);
  lines.splice(statement.index, statement.last - statement.index + 1);
  return lines.join("\n");
}

/** Whether a scope is a composite state itself or one of its regions. */
const scopeWithin = (outline: Outline, scope: string, id: string) =>
  scope === id || segmentOf(outline, scope)?.block.id === id;

/**
 * Connects two states with a transition, labelled when a label is given, and returns the source
 * with the id the transition has in it: transitions are numbered in the order of the source, so
 * one written in the middle takes the number of the one that stood there.
 *
 * From an initial state it writes `[*] --> target`, to a final state `source --> [*]`, on a line
 * in the composite state the pseudo-state belongs to. The syntax has no way to name a final state:
 * each `--> [*]` line is a final state of its own, so a transition drawn to a final state that is
 * there already gets a new one beside it, and the transition returned is how a caller finds it.
 * With a composite state as one end and a pseudo-state of its own scope as the other, the line
 * stands beside the composite state, in the scope that holds it: `[*] --> Composite`,
 * `Composite --> [*]`.
 *
 * A transition that is there already, between the same states with the same label (to any final
 * state of the same scope), is not written twice: the source stays as it is and the transition
 * returned is the one there. A note as one end moves the note beside the state at the other, and
 * no transition is returned. What the syntax cannot say (a transition out of a final state, into
 * an initial state, from or to a region) leaves the source as it is, with no transition.
 */
export function connectState(
  source: string,
  from: string,
  to: string,
  label?: string,
): { source: string; edge: string } {
  const model = modelOf(source),
    { diagram, lines, outline } = model,
    refused = { source, edge: "" };
  const isNote = (id: string) =>
    !diagram.states.has(id) && diagram.notes.some((note) => note.id === id);
  if (isNote(from) || isNote(to)) {
    const moved = isNote(to) ? moveNote(model, to, from) : moveNote(model, from, to);
    return { source: parses(moved) ? moved : source, edge: "" };
  }
  const start = endOf(model, from),
    end = endOf(model, to);
  if (!start || !end || start.kind === "final" || end.kind === "initial") return refused;
  return writeTransition(source, model, start, end, label);
}

/**
 * Writes the transition between two ends where it has to stand, as `connectState` says. An end can
 * be a state the source does not name yet: it then stands in the scope its `parent` says, named
 * first by the transition.
 */
function writeTransition(
  source: string,
  model: Model,
  start: End,
  end: End,
  label?: string,
): { source: string; edge: string } {
  const { diagram, lines, outline } = model,
    refused = { source, edge: "" };
  const text = escapeText(label ?? "", false),
    statement = `${start.text} --> ${end.text}${text ? ` : ${text}` : ""}`,
    other = start.state ?? end.state;
  let pseudo = start.scope ?? end.scope;
  // The pseudo-state of a composite state's own scope, joined to that composite state.
  if (pseudo && other && scopeWithin(outline, pseudo, other.id))
    pseudo = scopeAt(model, other.parent);
  const scope =
    pseudo ??
    (start.state!.parent === end.state!.parent ? scopeAt(model, start.state!.parent) : "root");
  // A line before the one that names a state first would move the state into its scope.
  const after = (place: Place | null) =>
    !!place && [start, end].every((item) => !item.state || item.state.line - 1 < place.at);
  let place = placeIn(model, scope),
    written: number;
  if (!after(place)) {
    const block = lastBlock(outline, scope),
      root = rootPlace(model);
    if (!pseudo) place = root;
    else if (block && (!block.separators.length || !end.scope)) {
      // The composite state is opened once more at the end, where every state is named already.
      lines.splice(
        root.at,
        0,
        `${root.indent}state ${scope} {`,
        root.indent + indentStep(model) + statement,
        `${root.indent}}`,
      );
      place = null;
      written = root.at + 1;
    } else return refused;
  }
  if (place) lines.splice(place.at, 0, place.indent + statement);
  written ??= place!.at;
  const result = lines.join("\n");
  if (!parses(result)) return refused;
  const read = parseStateDiagram(result),
    made = read.transitions.find((item) => item.line - 1 === written);
  if (!made) return refused;
  // The same transition as one that is there: the same ends, a final state of the same scope.
  const landed = read.states.get(made.target),
    twin = diagram.transitions.find((item) => {
      const target = diagram.states.get(item.target);
      return (
        item.source === made.source &&
        (item.label ?? "") === (made.label ?? "") &&
        (item.target === made.target ||
          (landed?.kind === "final" && target?.kind === "final" && target.parent === landed.parent))
      );
    });
  return twin ? { source, edge: twin.id } : { source: result, edge: made.id };
}

/** Connects two states as `connectState` does, and returns the source alone. */
export const connectStates = (source: string, from: string, to: string, label?: string) =>
  connectState(source, from, to, label).source;

/**
 * Adds a piece joined to a part, in as few lines as the syntax has for it, and returns the id of
 * the piece and of the transition that joins it. A state that follows a state or an initial state
 * is named by its transition alone, `Processing --> Shipped`, in the scope of the part it follows;
 * a name of several words needs its `state "Name" as Id` line before that. A start or an end is
 * the `[*]` of its transition; a note is its own line and has no transition. Every other piece is
 * added beside the part as `addStatePiece` adds it and joined as `connectState` joins it: a
 * composite state, a choice and a bar need a line that says what they are. The id is empty and
 * the source unchanged for what cannot be: a piece at a region, a state after a final state.
 */
export function attachState(
  source: string,
  piece: { kind: StatePiece; label?: string },
  at: string,
): { source: string; id: string; edge: string } {
  const model = modelOf(source),
    { diagram, outline } = model,
    anchor = diagram.states.get(at),
    none = { source, id: "", edge: "" };
  if (piece.kind === "note" || piece.kind === "region") {
    const added = addStatePiece(source, { ...piece, parent: at });
    return { ...added, edge: "" };
  }
  if (!anchor || anchor.kind === "region") return none;
  const composite =
    anchor.kind === "state" && (!!anchor.children.length || !!lastBlock(outline, at));
  if (piece.kind === "start" || piece.kind === "end") {
    if (!isReal(anchor)) return none;
    const made = addStatePiece(source, {
        kind: piece.kind,
        parent: composite ? at : anchor.parent,
      }),
      joined =
        piece.kind === "start"
          ? connectState(source, made.id, at)
          : connectState(source, at, made.id),
      edge = joined.edge
        ? parseStateDiagram(joined.source).transitions.find((item) => item.id === joined.edge)
        : undefined;
    if (!edge) return none;
    return { ...joined, id: piece.kind === "start" ? edge.source : edge.target };
  }
  const start = endOf(model, at);
  if (!start || start.kind === "final") return none;
  if (piece.kind === "state") {
    const title = piece.label?.trim() ?? "",
      free = (id: string | null): id is string => !!id && canBeId(id) && !diagram.states.has(id),
      word = PLAIN.test(title) && free(title) ? title : null,
      id = word ?? (free(idOf(title)) ? idOf(title)! : freshId(diagram, "state")),
      fresh: UmlState = {
        id,
        kind: "state",
        label: title || id,
        descriptions: [],
        parent: anchor.parent,
        children: [],
        line: 0,
      },
      joined = writeTransition(source, model, start, { text: id, state: fresh });
    if (joined.edge) {
      const read = parseStateDiagram(joined.source),
        line = read.transitions.find((item) => item.id === joined.edge)!.line - 1,
        lines = linesOf(joined.source);
      if (title && !word)
        lines.splice(
          line,
          0,
          `${indentOf(lines[line])}state "${escapeText(title, true)}" as ${id}`,
        );
      const result = lines.join("\n"),
        after = homes(read);
      // The new state stands where the part it follows stands, and every other state where it stood.
      if (
        parses(result) &&
        after.get(id) === homeOf(diagram, at) &&
        [...homes(diagram)].every(([other, home]) => after.get(other) === home)
      )
        return { source: result, id, edge: joined.edge };
    }
  }
  // Declared beside the part it follows, and joined in a line of its own.
  const added = addStatePiece(source, { ...piece, parent: anchor.parent });
  if (!added.id) return none;
  const joined = connectState(added.source, at, added.id);
  return joined.edge ? { ...joined, id: added.id } : none;
}

/**
 * Why a state diagram refuses an edit, in words for the person who tried it: a piece added at a
 * part (or at none), or a transition between two parts. Undefined for an edit the diagram takes,
 * and for one it refuses for a reason that has no words here.
 */
export function whyNotState(
  source: string,
  action: { add: StatePiece; at?: string | null } | { connect: [from: string, to: string] },
): string | undefined {
  let diagram: StateDiagram, outline: Outline;
  try {
    ({ diagram, outline } = modelOf(source));
  } catch {
    return "The source has an error.";
  }
  const kindOf = (id: string | null | undefined) => (id ? diagram.states.get(id)?.kind : undefined),
    note = (id: string) => !diagram.states.has(id) && diagram.notes.some((item) => item.id === id);
  if ("connect" in action) {
    const [from, to] = action.connect;
    if (note(from) || note(to))
      return note(from) && note(to)
        ? "A note stands beside a state, not beside a note."
        : undefined;
    if (kindOf(from) === "region" || kindOf(to) === "region")
      return "A region is no end of a transition: join a state inside it.";
    if (kindOf(from) === "final") return "No transition leaves a final state.";
    if (kindOf(to) === "initial") return "No transition leads into an initial state.";
    return undefined;
  }
  const at = kindOf(action.at),
    real = isReal(diagram.states.get(action.at ?? ""));
  switch (action.add) {
    case "region": {
      const holder = at === "region" ? diagram.states.get(action.at!)!.parent : action.at;
      return holder && lastBlock(outline, holder)
        ? undefined
        : "A region is a part of a composite state: select a composite state first.";
    }
    case "note":
      return real ? undefined : "A note stands beside a state: select a state first.";
    case "start":
      return at === "final" || at === "initial"
        ? "A start leads to a state, not to another start or an end."
        : undefined;
    case "end":
      return at === "final" || at === "initial"
        ? "An end follows a state, not a start or another end."
        : undefined;
    case "fork":
    case "join":
      return diagram.level === "conceptual"
        ? "A state machine of the conceptual level has no fork or join bars."
        : at === "final"
          ? "Nothing follows a final state."
          : undefined;
    default:
      return at === "final" ? "Nothing follows a final state." : undefined;
  }
}

/**
 * Gives a state, a composite state or a note another name. A state keeps its id, which its
 * transitions use: the name is written as `state "Name" as id`, in place of that line when the
 * source has one or of the line that holds the id alone, else before the line that names the
 * state first. A name that is the id, or an
 * empty one, needs no such line: the state is then written by its id alone. A note gets the name
 * as its text. Pseudo-states, choices, bars and regions show no name and stay as they are.
 */
export function renameState(source: string, id: string, label: string): string {
  const { diagram, lines, outline } = modelOf(source),
    state = diagram.states.get(id),
    done = () => {
      const result = lines.join("\n");
      return parses(result) ? result : source;
    };
  if (!state) {
    const note = diagram.notes.find((item) => item.id === id),
      statement = note && outline.statements.find((item) => item.index === note.line - 1),
      head = statement?.text.match(NOTE_HEAD);
    if (!statement || !head) return source;
    lines.splice(
      statement.index,
      statement.last - statement.index + 1,
      `${indentOf(lines[statement.index])}${head[0]} : ${escapeText(label, false)}`.trimEnd(),
    );
    return done();
  }
  if (state.kind !== "state") return source;
  const name = escapeText(label, true) || id,
    own = (kind: Statement["kind"]) =>
      outline.statements.filter((item) => item.kind === kind && item.ids[0] === id),
    alias = own("alias").at(-1),
    declared = own("declare")[0];
  if (alias && name === id) {
    for (const item of own("alias"))
      lines[item.index] =
        indentOf(lines[item.index]) + (item.text.endsWith("{") ? `state ${id} {` : declareText(id));
  } else if (alias) {
    const index = alias.index;
    lines[index] = lines[index].replace(/"[^"]*"/, () => `"${name}"`);
  } else if (name === id) return source;
  else if (declared) {
    const index = declared.index;
    lines[index] = lines[index].replace(/state\s+/, () => `state "${name}" as `);
  } else if (own("bare")[0]) {
    const index = own("bare")[0].index;
    lines[index] = `${indentOf(lines[index])}state "${name}" as ${id}`;
  } else {
    const index = state.line - 1;
    lines.splice(index, 0, `${indentOf(lines[index])}state "${name}" as ${id}`);
  }
  return done();
}

/** Gives a transition another label, the text after its colon; an empty one removes it. */
export function labelTransition(source: string, edge: string, label: string): string {
  const { diagram, lines } = modelOf(source),
    found = diagram.transitions.find((item) => item.id === edge);
  if (!found) return source;
  const index = found.line - 1,
    statement = lines[index].trim(),
    arrow = statement.match(ARROW);
  if (!arrow) return source;
  const text = escapeText(label, false),
    colon = statement.slice(arrow[0].length).match(/^\s*:\s*/)?.[0] ?? " : ";
  lines[index] = indentOf(lines[index]) + arrow[0] + (text ? colon + text : "");
  const result = lines.join("\n");
  return parses(result) ? result : source;
}

/**
 * Removes states with their transitions, descriptions and notes, composite states and regions with
 * what they hold, notes, and transitions, by id. An initial or final state goes with the
 * transitions that write it. A state that stays, and was named first on a line that goes, is
 * named on a line of its own there, so that it stays in its composite state.
 */
export function removeStates(source: string, ids: Iterable<string>): string {
  const { diagram, lines, outline } = modelOf(source),
    named = new Set(ids),
    gone = new Set<string>(),
    cut = new Set<number>();
  const drop = (from: number, to: number) => {
    for (let index = from; index <= to; index++) cut.add(index);
  };
  const take = (id: string) => {
    const state = diagram.states.get(id);
    if (!state || gone.has(id)) return;
    gone.add(id);
    state.children.forEach(take);
    const found = state.kind === "region" ? segmentOf(outline, id) : null;
    if (found) {
      // A region goes with one of the `--` beside it: the one before, for the first the one after.
      const bounds = [found.block.open, ...found.block.separators, found.block.close];
      drop(bounds[found.segment] + 1, bounds[found.segment + 1] - 1);
      cut.add(bounds[found.segment || 1]);
    }
    for (const block of outline.blocks) if (block.id === id) drop(block.open, block.close);
  };
  for (const id of named) {
    if (diagram.states.has(id)) {
      take(id);
      continue;
    }
    const note = diagram.notes.find((item) => item.id === id),
      statement = note && outline.statements.find((item) => item.index === note.line - 1);
    if (statement) drop(statement.index, statement.last);
  }
  for (const transition of diagram.transitions)
    if (named.has(transition.id) || gone.has(transition.source) || gone.has(transition.target))
      cut.add(transition.line - 1);
  for (const statement of outline.statements) {
    const styled = statement.kind === "styling" && statement.text.match(/^(?:style|class)\s+(\S+)/);
    if (statement.ids.some((id) => gone.has(id)) || (styled && gone.has(styled[1])))
      drop(statement.index, statement.last);
  }
  // The states that stay but lose the line that put them where they are.
  const kept = new Map<number, string[]>();
  for (const state of diagram.states.values()) {
    const first = state.line - 1;
    if (gone.has(state.id) || !isReal(state) || !cut.has(first)) continue;
    const origin = outline.statements.find((item) => item.index === first),
      next = outline.statements.find((item) => !cut.has(item.index) && item.ids.includes(state.id));
    if (origin && next?.scope !== origin.scope)
      kept.set(first, [...(kept.get(first) ?? []), indentOf(lines[first]) + declareText(state.id)]);
  }
  const result = lines
    .flatMap((line, index) => kept.get(index) ?? (cut.has(index) ? [] : [line]))
    .join("\n");
  return parses(result) ? result : source;
}

/** A statement with one state id written as another, wherever it stands as an id. */
function withId(statement: Statement, from: string, to: string): string {
  const { text, kind } = statement,
    swap = (id: string) => (id === from ? to : id);
  if (kind === "transition") {
    const ends = text.match(ENDS);
    if (!ends) return text;
    const [all, first, firstClass, arrow, second, secondClass] = ends;
    return swap(first) + firstClass + arrow + swap(second) + secondClass + text.slice(all.length);
  }
  if (kind === "styling") {
    const styled = text.match(/^((?:class|style)\s+)(\S+)(.*)$/);
    return styled ? styled[1] + styled[2].split(",").map(swap).join(",") + styled[3] : text;
  }
  const head = text.match(BEFORE_ID[kind] ?? /^/)![0],
    rest = text.slice(head.length),
    found = rest.match(FIRST);
  if (found?.[1] !== from) return text;
  const tail = rest.slice(from.length);
  return kind === "bare" ? declareText(to) + tail : head + to + tail;
}

/** Whether a text can be the id of a state: one word the parser reads as an id and nothing else. */
const canBeId = (id: string) =>
  new RegExp(`^${NAME}$`, "u").test(id) &&
  !/[#*[\]]/.test(id) &&
  !id.includes(":::") &&
  !/^note\d+$/.test(id) &&
  declareText(id) === id;

/**
 * Gives a state another id, on every line that mentions it: its declaration, its transitions, its
 * descriptions and notes, and the `class` and `style` lines that name it. The source stays as it
 * is when the id cannot be one or another state has it.
 */
export function renameStateId(source: string, id: string, newId: string): string {
  const { diagram, lines, outline } = modelOf(source);
  if (!isReal(diagram.states.get(id)) || !canBeId(newId) || diagram.states.has(newId))
    return source;
  for (const statement of outline.statements)
    if (statement.kind === "styling" || statement.ids.includes(id))
      lines[statement.index] = indentOf(lines[statement.index]) + withId(statement, id, newId);
  const result = lines.join("\n");
  try {
    const read = parseStateDiagram(result);
    return read.states.has(newId) && !read.states.has(id) ? result : source;
  } catch {
    return source;
  }
}

/** An id made of the words of a name, as the ids of states are written: `Processing order` gives `ProcessingOrder`. */
function idOf(name: string): string | null {
  const words =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss")
      .match(/[A-Za-z0-9]+/g) ?? [];
  let id = "";
  for (const word of words) {
    const next = id + word[0].toUpperCase() + word.slice(1);
    if (id && next.length > 40) break;
    id = next;
  }
  return PLAIN.test(id) && canBeId(id) ? id : null;
}

/**
 * Whether a state has an id it was given without being asked: the id a new state is added under
 * (`state1`, `composite1`), or the id of a copy that still carries the name it was copied with
 * (`Draft2` beside `Draft`). The first name such a state gets is to become its id.
 */
function generated(diagram: StateDiagram, id: string): boolean {
  if (GENERATED.test(id)) return true;
  const state = diagram.states.get(id),
    numbered = id.match(/^(.*?)(\d+)$/);
  if (!state || !numbered || Number(numbered[2]) < 2) return false;
  return [...diagram.states.values()].some(
    (other) =>
      other.id !== id &&
      isReal(other) &&
      other.id.replace(/\d+$/, "") === numbered[1] &&
      (state.label === id || state.label === other.label),
  );
}

/**
 * Whether a state still has the id it was added or copied under, so that the first name it gets
 * is to become its id: what `retitleState` asks before it changes an id. A canvas asks it of the
 * copy `duplicateState` returns, and of what a composite state's copy holds.
 */
export function isGeneratedStateId(source: string, id: string): boolean {
  try {
    return generated(parseStateDiagram(source), id);
  } catch {
    return false;
  }
}

/**
 * Gives a part that was just added or copied its first name. A state or composite state that
 * still has the id it was added or copied under (`state1`, `composite1`, `Draft2` beside `Draft`)
 * takes an id made of the name, on every line that mentions it: a name of one word is the id
 * (`Paid`), a longer one gives the id its words and stays as the name (`state "Processing order"
 * as ProcessingOrder`). Where the name gives no id, or one another state has, the id stays and the
 * name is written as `renameState` writes it. Returns the id the part has afterwards.
 */
export function retitleState(
  source: string,
  id: string,
  name: string,
): { source: string; id: string } {
  const { diagram } = modelOf(source),
    title = name.trim();
  if (diagram.states.get(id)?.kind === "state" && title && generated(diagram, id)) {
    const next = PLAIN.test(title) ? title : idOf(title),
      renamed = next ? renameStateId(source, id, next) : source;
    if (next && renamed !== source) return { source: renameState(renamed, next, name), id: next };
  }
  return { source: renameState(source, id, name), id };
}

/** The description of a state, the text of its `State : text` lines, one line each. */
export function stateDescription(source: string, id: string): string {
  return parseStateDiagram(source).states.get(id)?.descriptions.join("\n") ?? "";
}

/**
 * Gives a state another description: one `State : text` line for each line of the text, in place
 * of the ones it has, or else after the line that names the state first. An empty text removes
 * them. A composite state has a name only, and stays as it is.
 */
export function setStateDescription(source: string, id: string, text: string): string {
  const { diagram, lines, outline } = modelOf(source),
    state = diagram.states.get(id);
  if (state?.kind !== "state" || state.children.length || lastBlock(outline, id)) return source;
  const old = outline.statements.filter(
      (item) => item.kind === "description" && item.ids[0] === id,
    ),
    first = outline.statements.find((item) => item.index === state.line - 1),
    at = old[0]?.index ?? (first ? first.last + 1 : lines.length),
    indent = indentOf(lines[old[0]?.index ?? first?.index ?? 0]),
    written = text
      .split("\n")
      .map((line) => escapeText(line, false))
      .filter(Boolean)
      .map((line) => `${indent}${id} : ${line}`);
  // A description that names the state first keeps it in its composite state: the id stays there.
  if (!written.length && old[0] && old[0].index === state.line - 1)
    written.push(indent + declareText(id));
  const cut = new Set(old.map((item) => item.index)),
    result = lines
      .flatMap((line, index) => [
        ...(index === at ? written : []),
        ...(cut.has(index) ? [] : [line]),
      ])
      .concat(at >= lines.length ? written : [])
      .join("\n");
  return parses(result) ? result : source;
}

/** Puts a note on the other side of its state. */
export function setNoteSide(source: string, note: string, side: "left" | "right"): string {
  const { diagram, lines } = modelOf(source),
    found = diagram.notes.find((item) => item.id === note);
  if (!found || found.side === side) return source;
  const index = found.line - 1;
  lines[index] = lines[index].replace(
    /^(\s*note\s+)(?:left|right)/i,
    (_, head: string) => head + side,
  );
  const result = lines.join("\n");
  return parses(result) ? result : source;
}

/** Lines with the indentation of the first one replaced by another. */
function reindent(texts: string[], indent: string): string[] {
  const base = indentOf(texts.find((text) => text.trim()) ?? "");
  return texts.map((text) =>
    text.trim() ? indent + (text.startsWith(base) ? text.slice(base.length) : text.trim()) : "",
  );
}

/**
 * The lines that are a state's own, as ranges of line indexes: its declarations, its descriptions
 * and the blocks it holds its states in. Its transitions and notes are not among them.
 */
function ownRanges({ outline }: Model, id: string): [number, number][] {
  const blocks = outline.blocks.filter((block) => block.id === id),
    within = (index: number) => blocks.some((block) => block.open < index && index <= block.close);
  return outline.statements
    .filter(
      (item) =>
        ["alias", "declare", "special", "bare", "description"].includes(item.kind) &&
        item.ids[0] === id &&
        !within(item.index),
    )
    .map((item): [number, number] => [
      item.index,
      blocks.find((block) => block.open === item.index)?.close ?? item.last,
    ]);
}

/**
 * Where a state stands, in words that stay the same when regions and final states are numbered
 * anew: `root`, the composite state that holds it, or that with the place of its region.
 */
function homeOf(diagram: StateDiagram, id: string): string {
  const parent = diagram.states.get(diagram.states.get(id)?.parent ?? "");
  if (!parent) return "root";
  if (parent.kind !== "region") return parent.id;
  const holder = diagram.states.get(parent.parent!)!;
  return `${holder.id}/${holder.children.indexOf(parent.id)}`;
}

/** The states that can be named, each with where it stands. */
const homes = (diagram: StateDiagram) =>
  new Map(
    [...diagram.states.values()]
      .filter(isReal)
      .map((state) => [state.id, homeOf(diagram, state.id)]),
  );

/**
 * Adds a copy of a state beside it, in the same composite state: its name, its kind and its
 * descriptions, and for a composite state the states and transitions it holds, each state under a
 * new id. Transitions to and from the state and its notes are not copied. Returns the id of the
 * copy, empty for what cannot be copied (a pseudo-state, a region, a note).
 */
export function duplicateState(source: string, id: string): { source: string; id: string } {
  const model = modelOf(source),
    { diagram, lines, outline } = model,
    state = diagram.states.get(id),
    none = { source, id: "" };
  if (!isReal(state)) return none;
  // The state and the states it holds, each with the id of its copy: the next number that is free.
  const names = new Map<string, string>(),
    taken = new Set(diagram.states.keys());
  const name = (old: string) => {
    const base = old.replace(/\d+$/, "");
    for (let count = 2; ; count++)
      if (!taken.has(`${base}${count}`)) {
        taken.add(`${base}${count}`);
        return `${base}${count}`;
      }
  };
  const collect = (item: UmlState) => {
    if (isReal(item)) names.set(item.id, name(item.id));
    for (const child of item.children) collect(diagram.states.get(child)!);
  };
  collect(state);
  const copy = names.get(id)!,
    statements = new Map(outline.statements.map((item) => [item.index, item])),
    texts: string[] = [];
  for (const [from, to] of ownRanges(model, id)) {
    const range = lines.slice(from, to + 1).map((line, offset) => {
      const statement = statements.get(from + offset);
      if (!statement || statement.kind === "styling") return line;
      let text = statement.text;
      for (const [old, fresh] of names)
        if (statement.ids.includes(old)) text = withId({ ...statement, text }, old, fresh);
      return indentOf(line) + text;
    });
    texts.push(...reindent(range, ""));
  }
  if (!texts.length) texts.push(declareText(copy));
  const place = placeIn(model, scopeAt(model, state.parent)) ?? rootPlace(model);
  lines.splice(place.at, 0, ...texts.map((text) => (text ? place.indent + text : text)));
  const result = lines.join("\n");
  try {
    const read = parseStateDiagram(result);
    return homeOf(read, copy) === homeOf(diagram, id) ? { source: result, id: copy } : none;
  } catch {
    return none;
  }
}

/** The first line a scope can take a statement on, with its indentation. */
function startIn(model: Model, scope: string): Place | null {
  const { lines, outline } = model;
  if (scope === "root") {
    const first = outline.statements[0];
    return first ? { at: first.index, indent: indentOf(lines[first.index]) } : rootPlace(model);
  }
  const block = outline.blocks.find((item) => item.id === scope),
    found = segmentOf(outline, scope) ?? (block ? { block, segment: 0 } : null),
    end = placeIn(model, scope);
  if (!found || !end) return null;
  return {
    at: [found.block.open, ...found.block.separators][found.segment] + 1,
    indent: end.indent,
  };
}

/** The initial and final states of a diagram, each as its kind and where it stands, in order. */
const pseudoHomes = (diagram: StateDiagram) =>
  [...diagram.states.values()]
    .filter(isPseudo)
    .map((state) => `${state.kind}@${homeOf(diagram, state.id)}`)
    .toSorted()
    .join(" ");

/**
 * Moves a state with what it holds into a composite state or one of its regions, or with null out
 * of every composite state. A state stands where the line that names it first stands, so its own
 * lines (its declaration, its descriptions, its block) are moved to where they come before every
 * line that names it. That is the end of the block the composite state has (its last one when the
 * source opens it several times), else the start of that block. Where a line before the block
 * names the state, the block moves up to stand right before that line, and where that would take
 * another state along, the lines that name the state move behind the block instead; only when
 * neither can be is the composite state opened once more at the top. Out of every composite state
 * the state goes to the end of the source, else right before the composite state that names it.
 * A plain state that takes one becomes a composite state. The source stays as it is when the state
 * is there already, when the composite state is the state or inside it, and when no place leaves
 * every other state where it is.
 */
export function moveStateInto(source: string, id: string, into: string | null): string {
  const model = modelOf(source),
    { diagram, lines, outline } = model,
    state = diagram.states.get(id),
    target = into === null ? null : diagram.states.get(into);
  if (!isReal(state) || (into !== null && target?.kind !== "state" && target?.kind !== "region"))
    return source;
  for (let at = into; at; at = diagram.states.get(at)?.parent ?? null) if (at === id) return source;
  // Where the state is to stand, as `homeOf` says it: in the last region of a composite state.
  const regions = target?.children.filter((child) => diagram.states.get(child)?.kind === "region"),
    wanted = !target
      ? "root"
      : target.kind === "region"
        ? `${target.parent}/${diagram.states.get(target.parent!)!.children.indexOf(target.id)}`
        : regions?.length
          ? `${target.id}/${target.children.indexOf(regions.at(-1)!)}`
          : target.id,
    before = homes(diagram),
    pseudo = pseudoHomes(diagram);
  if (before.get(id) === wanted) return source;
  const ranges = ownRanges(model, id),
    own = new Set(
      ranges.flatMap(([from, to]) => lines.slice(from, to + 1).map((_, at) => from + at)),
    ),
    texts = ranges.length
      ? ranges.flatMap(([from, to]) => reindent(lines.slice(from, to + 1), ""))
      : [declareText(id)],
    rest = lines.filter((_, index) => !own.has(index)).join("\n");
  if (!parses(rest)) return source;
  const pruned = modelOf(rest),
    holder = !target ? null : target.kind === "region" ? target.parent! : target.id,
    blocksOf = (from: Outline) => from.blocks.filter((block) => block.id === holder);
  // The block of the composite state that takes the state, and the region of it, by its place:
  // regions are numbered through the source, so their ids change when lines go.
  const region = target?.kind === "region" ? segmentOf(outline, target.id) : null,
    block = region ? blocksOf(pruned.outline)[blocksOf(outline).indexOf(region.block)] : undefined,
    home = block ?? blocksOf(pruned.outline).at(-1),
    segmentIn = (found: Block) => (region ? region.segment : found.separators.length),
    scope = !holder
      ? "root"
      : home
        ? (home.regions[segmentIn(home)] ?? holder)
        : scopeAt(pruned, holder),
    inside = (place: Place) => texts.map((text) => (text.trim() ? place.indent + text : ""));
  const put = (place: Place | null, wrap?: string) => {
    if (!place) return null;
    const fresh = linesOf(rest),
      step = indentStep(pruned),
      inner = wrap ? [`state ${wrap} {`, ...texts.map((text) => step + text), "}"] : texts;
    fresh.splice(place.at, 0, ...inner.map((text) => (text.trim() ? place.indent + text : "")));
    return fresh.join("\n");
  };
  // The first line that names the state, and the blocks around that line from the inside out.
  const named = pruned.outline.statements.find((item) => item.ids.includes(id)),
    above = named
      ? [
          named.index,
          ...pruned.outline.blocks
            .filter((item) => item.open < named.index && named.index <= item.close)
            .map((item) => item.open)
            .toSorted((a, b) => b - a),
        ]
      : [];
  /** The block moved up to stand before a line, with the state at the end of its region. */
  const raised = (found: Block, before: number) => {
    const fresh = linesOf(rest);
    fresh.splice(before, 0, ...fresh.splice(found.open, found.close - found.open + 1));
    const text = fresh.join("\n");
    if (!parses(text)) return null;
    const moved = modelOf(text),
      now = moved.outline.blocks.find((item) => item.open === before);
    if (!now) return null;
    const place = segmentPlace(moved, now, segmentIn(now));
    fresh.splice(place.at, 0, ...inside(place));
    return fresh.join("\n");
  };
  /** The lines that name the state before the block moved behind it, with the state in the block. */
  const lowered = (found: Block) => {
    const opening = pruned.outline.statements.find((item) => item.index === found.open),
      early = pruned.outline.statements.filter(
        (item) => item.ids.includes(id) && item.index < found.open && item.scope === opening?.scope,
      );
    if (!early.length) return null;
    const fresh = linesOf(rest),
      cut = new Set(
        early.flatMap((item) =>
          fresh.slice(item.index, item.last + 1).map((_, at) => item.index + at),
        ),
      ),
      place = segmentPlace(pruned, found, segmentIn(found));
    return fresh
      .flatMap((line, index) => [
        ...(index === place.at ? inside(place) : []),
        ...(cut.has(index) ? [] : [line]),
        ...(index === found.close ? [...cut].map((at) => fresh[at]) : []),
      ])
      .join("\n");
  };
  const candidates: (() => string | null)[] = [
    () =>
      !holder || pruned.diagram.states.has(holder)
        ? insertAt(modelOf(rest), !holder ? null : region ? scope : holder, texts).join("\n")
        : null,
    ...(holder
      ? [
          () => put(startIn(pruned, scope)),
          ...(home
            ? [
                ...above.filter((line) => line < home.open).map((line) => () => raised(home, line)),
                () => lowered(home),
              ]
            : []),
          () => (target?.kind === "state" ? put(startIn(pruned, "root"), holder) : null),
        ]
      : [
          ...above.map((line) => () => put({ at: line, indent: indentOf(pruned.lines[line]) })),
          () => put(startIn(pruned, "root")),
        ]),
  ];
  for (const candidate of candidates) {
    const result = candidate();
    if (!result) continue;
    try {
      const read = parseStateDiagram(result),
        after = homes(read);
      if (
        after.get(id) === wanted &&
        after.size === before.size &&
        read.transitions.length === diagram.transitions.length &&
        pseudoHomes(read) === pseudo &&
        [...before].every(([other, home]) => other === id || after.get(other) === home)
      )
        return result;
    } catch {
      // This place does not read: the next one.
    }
  }
  return source;
}

/**
 * Takes a composite state away and keeps what it holds: the lines of its blocks stand where the
 * blocks stood, one step less indented, in the composite state around it. The composite state
 * goes with its transitions, its notes and the `--` between its regions; the initial and final
 * states it held are then those of the scope around it.
 */
export function ungroupComposite(source: string, id: string): string {
  const { diagram, lines, outline } = modelOf(source),
    blocks = outline.blocks.filter((block) => block.id === id);
  if (diagram.states.get(id)?.kind !== "state" || !blocks.length) return source;
  const cut = new Set<number>();
  for (const block of blocks) {
    const outer = indentOf(lines[block.open]),
      inside = lines.slice(block.open + 1, block.close).find((line) => line.trim()),
      inner = inside ? indentOf(inside) : outer;
    for (const index of [block.open, block.close, ...block.separators]) cut.add(index);
    if (inner.length > outer.length && inner.startsWith(outer))
      for (let index = block.open + 1; index < block.close; index++)
        if (lines[index].startsWith(inner)) lines[index] = outer + lines[index].slice(inner.length);
  }
  const open = lines.filter((_, index) => !cut.has(index)).join("\n");
  if (!parses(open)) return source;
  const result = parseStateDiagram(open).states.has(id) ? removeStates(open, [id]) : open;
  try {
    const read = homes(parseStateDiagram(result)),
      before = homes(diagram);
    return !read.has(id) && read.size === before.size - 1 ? result : source;
  } catch {
    return source;
  }
}

/**
 * Turns a transition round: its ends change places, its label stays. An initial state at its
 * start becomes a final state at its end and the other way round, as `[*]` reads. The source
 * stays as it is where the syntax cannot say the result.
 */
export function reverseTransition(source: string, edge: string): string {
  const { diagram, lines } = modelOf(source),
    found = diagram.transitions.find((item) => item.id === edge);
  if (!found || found.source === found.target) return source;
  const index = found.line - 1,
    text = lines[index].trim(),
    ends = text.match(ENDS);
  if (!ends) return source;
  const [all, first, firstClass, arrow, second, secondClass] = ends;
  lines[index] =
    indentOf(lines[index]) +
    second +
    secondClass +
    arrow +
    first +
    firstClass +
    text.slice(all.length);
  const result = lines.join("\n");
  try {
    const read = parseStateDiagram(result),
      before = homes(diagram),
      after = homes(read);
    return [...before].every(([id, home]) => after.get(id) === home) ? result : source;
  } catch {
    return source;
  }
}

/** What a part that carries no name of its own is called: a pseudo-state, a choice, a bar. */
const UNNAMED: Partial<Record<UmlState["kind"], string>> = {
  initial: "Start",
  final: "End",
  choice: "Choice",
  fork: "Fork",
  join: "Join",
};

/** The kinds of part a transition can end at or start from: states and the parts that stand for one. */
const STATES = ["state", "composite", "choice", "fork", "join"];

/** The kinds of part a new state follows: those, and the start of a machine. */
const FOLLOWED = [...STATES, "start"];

const KINDS: Record<UmlState["kind"], string> = {
  state: "state",
  initial: "start",
  final: "end",
  choice: "choice",
  fork: "fork",
  join: "join",
  region: "region",
};

/**
 * State diagrams as a structure a canvas edits. The parts are the states under the ids of their
 * shapes: states and composite states by their own id, the initial and final states of a scope as
 * `root#initial`, `Edit#final2` (final states numbered through the whole source in the order of
 * their transitions), the regions of a composite state as `Active#region1`, notes as `note1`.
 * A part that carries no name is labelled by what it is: `Start`, `End`, `Choice`, `Fork`, `Join`,
 * `Region 2`; `rename` leaves such a part as it is.
 */
export const stateStructure: Structure = {
  pieces: [
    {
      kind: "state",
      name: "State",
      about: "Simple state, optionally with internal behavior",
      joins: "after",
      joinsTo: FOLLOWED,
      named: true,
    },
    {
      kind: "composite",
      name: "Composite state",
      about: "State with substates in one or more regions",
      group: true,
      named: true,
    },
    {
      kind: "start",
      name: "Initial",
      about: "Initial pseudostate of the enclosing region",
      joins: "before",
      joinsTo: STATES,
    },
    {
      kind: "end",
      name: "Final state",
      about: "Completes the enclosing region",
      joins: "after",
      joinsTo: STATES,
    },
    {
      kind: "choice",
      name: "Choice",
      about: "Choice pseudostate: the outgoing transition is selected by guards",
      joins: "after",
      joinsTo: FOLLOWED,
    },
    {
      kind: "fork",
      name: "Fork",
      about: "Fork pseudostate: splits a transition into concurrent ones",
      joins: "after",
      joinsTo: FOLLOWED,
    },
    {
      kind: "join",
      name: "Join",
      about: "Join pseudostate: merges concurrent transitions into one",
      joins: "after",
      joinsTo: FOLLOWED,
    },
    {
      kind: "note",
      name: "Note",
      about: "Comment beside a state",
      joins: "after",
      joinsTo: STATES,
      named: true,
    },
    {
      kind: "region",
      name: "Region",
      about: "Orthogonal region of a composite state",
      group: true,
    },
  ],
  links: [{ kind: "transition", name: "Transition" }],
  read(source) {
    const { diagram, outline } = modelOf(source),
      nodes: StructureNode[] = [];
    const collect = (id: string) => {
      const state = diagram.states.get(id)!,
        holds = state.kind === "state" && (!!state.children.length || !!lastBlock(outline, id));
      const regions = state.parent ? diagram.states.get(state.parent)!.children : [];
      nodes.push({
        id,
        label:
          state.kind === "region"
            ? `Region ${regions.indexOf(id) + 1}`
            : (UNNAMED[state.kind] ?? state.label),
        parent: state.parent,
        line: state.line,
        group: holds || state.kind === "region",
        kind: holds ? "composite" : KINDS[state.kind],
      });
      state.children.forEach(collect);
    };
    diagram.roots.forEach(collect);
    for (const note of diagram.notes)
      nodes.push({
        id: note.id,
        label: note.text,
        parent: diagram.states.get(note.target)?.parent ?? null,
        line: note.line,
        group: false,
        kind: "note",
      });
    return {
      nodes,
      edges: diagram.transitions.map((item): StructureEdge => ({
        id: item.id,
        source: item.source,
        target: item.target,
        label: item.label,
        line: item.line,
        kind: "transition",
      })),
    };
  },
  add: (source, piece) => addStatePiece(source, { ...piece, kind: piece.kind as StatePiece }),
  connect: (source, from, to) => connectState(source, from, to).source,
  rename: renameState,
  retitle: retitleState,
  label: labelTransition,
  // A state diagram has one kind of join.
  relink: (source) => source,
  remove: (source, ids) => removeStates(source, ids),
};
