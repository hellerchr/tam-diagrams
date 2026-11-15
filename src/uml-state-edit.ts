/**
 * Editing a state diagram source as text: adding, naming, connecting and removing states, the way
 * uml-activity-edit.ts edits flowcharts. Each function returns the source with one change made.
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
  | "state"
  | "composite"
  | "start"
  | "end"
  | "choice"
  | "fork"
  | "join"
  | "note"
  | "region";

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

/** The initial or a final state of a scope, as the parser names it: `root#initial`, `Edit#final2`. */
const PSEUDO = /^(.*)#(initial|final\d+)$/;

/** A statement of the source that says something of states. */
interface Statement {
  /** The index of its line, and of its last line: a note may run to its `end note`. */
  index: number;
  last: number;
  text: string;
  kind:
    | "transition"
    | "special"
    | "alias"
    | "declare"
    | "note"
    | "bare"
    | "description"
    | "styling";
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

/** The end of the source: after the last line with text. */
function rootPlace(model: Model): Place {
  let at = model.lines.length;
  while (at > 0 && !model.lines[at - 1].trim()) at--;
  return { at, indent: rootIndent(model) };
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
  if (!found) return null;
  const bounds = [found.block.open, ...found.block.separators, found.block.close],
    start = bounds[found.segment],
    at = bounds[found.segment + 1],
    first = model.lines[start + 1];
  return {
    at,
    indent:
      start + 1 < at && first.trim()
        ? indentOf(first)
        : indentOf(model.lines[found.block.open]) + indentStep(model),
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
function escapeText(label: string, quoted: boolean): string {
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
  lines.splice(place.at, 0, ...texts.map((text) => place.indent + text));
  return lines;
}

/**
 * Adds a state, a composite state, a choice, a fork or join bar, a note or a region; inside a
 * composite state or region when given. Returns the id it got, empty when the diagram cannot take
 * the piece (a fork in a diagram of the conceptual level, a note without a state to stand beside).
 *
 * An initial or final state is written only as the `[*]` end of a transition, so adding a start or
 * an end changes nothing yet: it returns the id the pseudo-state gets once `connectStates` joins
 * it to a state.
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
      // A note stands beside a state: the part it is added at, or the last state of that group.
      const parent = piece.parent ? diagram.states.get(piece.parent) : undefined,
        among = [...diagram.states.values()].filter(
          (state) => state.kind === "state" && (!parent || state.parent === parent.id),
        ),
        target = isReal(parent) ? parent : among.at(-1);
      if (!target) return { source, id: "" };
      const place = rootPlace(model),
        text = escapeText(piece.label ?? "", false) || "Note";
      lines.splice(place.at, 0, `${place.indent}note right of ${target.id} : ${text}`);
      return done(`note${diagram.notes.length + 1}`);
    }
    case "region": {
      // The composite state the region is added to: the one at or around the part it is added at.
      let holder: string | null = piece.parent ?? null;
      while (holder && !lastBlock(outline, holder))
        holder = diagram.states.get(holder)?.parent ?? null;
      const inner = freshId(diagram, "state");
      if (holder) {
        const block = lastBlock(outline, holder)!,
          indent = placeIn(model, block.regions.at(-1) ?? holder)!.indent;
        lines.splice(block.close, 0, `${indent}--`, `${indent}state "State" as ${inner}`);
      } else {
        // No composite state there: a new one, in two regions.
        const place = rootPlace(model),
          step = indentStep(model),
          other = freshId(diagram, `${inner}_`);
        holder = freshId(diagram, "composite");
        lines.splice(
          place.at,
          0,
          ...[
            `state "Composite" as ${holder} {`,
            `${step}state "State" as ${other}`,
            `${step}--`,
            `${step}state "State" as ${inner}`,
            "}",
          ].map((text) => place.indent + text),
        );
      }
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

/**
 * Connects two states with a transition, labelled when a label is given. From an initial state it
 * writes `[*] --> target`, to a final state `source --> [*]`, on a line in the composite state the
 * pseudo-state belongs to; each such line is a final state of its own, as the syntax has it. A note
 * as one end moves the note beside the state at the other. What the syntax cannot say (a transition
 * out of a final state, into an initial state, from or to a region) leaves the source as it is.
 */
export function connectStates(source: string, from: string, to: string, label?: string): string {
  const model = modelOf(source),
    { diagram, lines, outline } = model;
  const isNote = (id: string) =>
    !diagram.states.has(id) && diagram.notes.some((note) => note.id === id);
  if (isNote(from) || isNote(to)) {
    const moved = isNote(to) ? moveNote(model, to, from) : moveNote(model, from, to);
    return parses(moved) ? moved : source;
  }
  const start = endOf(model, from),
    end = endOf(model, to);
  if (!start || !end || start.kind === "final" || end.kind === "initial") return source;
  const text = escapeText(label ?? "", false),
    statement = `${start.text} --> ${end.text}${text ? ` : ${text}` : ""}`,
    pseudo = start.scope ?? end.scope,
    scope =
      pseudo ??
      (start.state!.parent === end.state!.parent ? scopeAt(model, start.state!.parent) : "root");
  // A line before the one that names a state first would move the state into its scope.
  const after = (place: Place | null) =>
    !!place && [start, end].every((item) => !item.state || item.state.line - 1 < place.at);
  let place = placeIn(model, scope);
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
    } else return source;
  }
  if (place) lines.splice(place.at, 0, place.indent + statement);
  const result = lines.join("\n");
  return parses(result) ? result : source;
}

/**
 * Gives a state, a composite state or a note another name. A state keeps its id, which its
 * transitions use: the name is written as `state "Name" as id`, in place of that line when the
 * source has one, else before the line that names the state first. A note gets the name as its
 * text. Pseudo-states, choices, bars and regions show no name and stay as they are.
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
  if (alias) {
    const index = alias.index;
    lines[index] = lines[index].replace(/"[^"]*"/, () => `"${name}"`);
  } else if (name === id) return source;
  else if (declared) {
    const index = declared.index;
    lines[index] = lines[index].replace(/state\s+/, () => `state "${name}" as `);
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
 */
export const stateStructure: Structure = {
  pieces: [
    {
      kind: "state",
      name: "State",
      about: "A condition the machine stays in",
      joins: "after",
      named: true,
    },
    {
      kind: "composite",
      name: "Composite state",
      about: "A state that holds a machine of its own",
      group: true,
      named: true,
    },
    { kind: "start", name: "Start", about: "Where the machine begins", joins: "before" },
    { kind: "end", name: "End", about: "Where the machine ends", joins: "after" },
    { kind: "choice", name: "Choice", about: "A branch by guards", joins: "after" },
    { kind: "fork", name: "Fork", about: "A bar that splits into parallel paths", joins: "after" },
    {
      kind: "join",
      name: "Join",
      about: "A bar that brings parallel paths together",
      joins: "after",
    },
    { kind: "note", name: "Note", about: "A remark beside a state", joins: "after", named: true },
    {
      kind: "region",
      name: "Region",
      about: "A concurrent part of a composite state",
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
      nodes.push({
        id,
        label: state.label,
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
  connect: (source, from, to) => connectStates(source, from, to),
  rename: renameState,
  label: labelTransition,
  // A state diagram has one kind of join.
  relink: (source) => source,
  remove: (source, ids) => removeStates(source, ids),
};
