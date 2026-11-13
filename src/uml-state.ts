import type { Direction } from "./elk";
import {
  accessibilityLines,
  labelText,
  type Level,
  prepare,
  STYLING,
  UmlError,
  unsupported,
} from "./uml";

/**
 * State machine diagrams from Mermaid `stateDiagram-v2` sources, drawn as in the TAM flyer and
 * standard (2.2.4): rounded states, a filled dot for the initial state and a bullseye for each final
 * state, transitions labelled `event [guard] / action`, composite states as grey containers with a
 * name compartment, concurrent regions split by dashed lines, choice diamonds, fork/join bars and
 * notes beside states.
 */

type StateKind = "state" | "initial" | "final" | "choice" | "fork" | "join" | "region";

export interface UmlState {
  id: string;
  kind: StateKind;
  label: string;
  descriptions: string[];
  parent: string | null;
  children: string[];
  line: number;
}

interface Transition {
  id: string;
  source: string;
  target: string;
  label?: string;
  line: number;
}

export interface StateNote {
  id: string;
  target: string;
  side: "left" | "right";
  text: string;
  line: number;
}

export interface StateDiagram {
  direction: Direction;
  title?: string;
  level?: Level;
  states: Map<string, UmlState>;
  roots: string[];
  transitions: Transition[];
  notes: StateNote[];
}

const ID = '(\\[\\*\\]|[^:\\s\\-{}"]+)(?::::[\\w-]+)?';

const TRANSITION = new RegExp(`^${ID}\\s*-->\\s*${ID}\\s*(?::\\s*(.*))?$`, "u");

const DESCRIPTION = new RegExp(`^${ID}\\s*:\\s*(.*)$`, "u");

const SPECIAL = new RegExp(
  `^state\\s+${ID}\\s*(?:<<\\s*(choice|fork|join)\\s*>>|\\[\\[\\s*(choice|fork|join)\\s*\\]\\])$`,
  "iu",
);

const ALIAS = new RegExp(`^state\\s+"([^"]*)"\\s+as\\s+${ID}\\s*(\\{)?$`, "u");

const DECLARE = new RegExp(`^state\\s+${ID}\\s*(\\{)?$`, "u");

const NOTE = new RegExp(`^note\\s+(left|right)\\s+of\\s+${ID}\\s*(?::\\s*(.*))?$`, "iu");

export function parseStateDiagram(source: string): StateDiagram {
  const prepared = prepare(source);
  if (prepared.kind !== "state") throw new UmlError(prepared.headerLine, "Not a state diagram.");
  const diagram: StateDiagram = {
    direction: "TB",
    title: prepared.title,
    level: prepared.level,
    states: new Map(),
    roots: [],
    transitions: [],
    notes: [],
  };
  // Open composites and the region each statement goes into.
  const stack: { state: UmlState; region: UmlState | null; line: number }[] = [];
  let note: StateNote | null = null,
    finals = 0,
    regions = 0;
  const scope = () => {
    const top = stack.at(-1);
    return top ? (top.region ?? top.state) : null;
  };
  const add = (state: UmlState) => {
    if (diagram.states.size >= 300)
      throw new UmlError(state.line, "State diagrams are limited to 300 states.");
    diagram.states.set(state.id, state);
    if (state.parent) diagram.states.get(state.parent)!.children.push(state.id);
    else diagram.roots.push(state.id);
  };
  const ensure = (id: string, line: number, kind: StateKind = "state"): UmlState => {
    let state = diagram.states.get(id);
    if (!state) {
      state = {
        id,
        kind,
        label: id,
        descriptions: [],
        parent: scope()?.id ?? null,
        children: [],
        line,
      };
      add(state);
    } else if (kind !== "state") state.kind = kind;
    return state;
  };
  /** `[*]` is the initial state of the current scope as a source and a new final state as a target. */
  const end = (raw: string, line: number, target: boolean): string => {
    if (raw !== "[*]") return ensure(raw, line).id;
    const parent = scope();
    if (!target) return ensure(`${parent?.id ?? "root"}#initial`, line, "initial").id;
    const final: UmlState = {
      id: `${parent?.id ?? "root"}#final${++finals}`,
      kind: "final",
      label: "",
      descriptions: [],
      parent: parent?.id ?? null,
      children: [],
      line,
    };
    add(final);
    return final.id;
  };

  const accessibility = accessibilityLines();
  for (const { text, line } of prepared.lines) {
    if (note) {
      if (/^end\s+note$/i.test(text)) {
        diagram.notes.push(note);
        note = null;
      } else note.text += `${note.text ? "<br>" : ""}${labelText(text)}`;
      continue;
    }
    if (accessibility(text)) continue;
    let match: RegExpMatchArray | null;
    if ((match = text.match(/^direction\s+(TB|TD|BT|LR|RL)$/i))) {
      if (!stack.length)
        diagram.direction = match[1].toUpperCase().replace("TD", "TB") as Direction;
      continue;
    }
    if (/^(hide\s+empty\s+description|scale\s+\d+\s+width)$/i.test(text)) continue;
    if (text === "}") {
      const top = stack.pop();
      if (!top) throw new UmlError(line, "Unmatched `}`.");
      continue;
    }
    if (text === "--") {
      const top = stack.at(-1);
      if (!top)
        throw new UmlError(line, "Concurrent regions (`--`) belong inside a composite state.");
      // The statements so far form the first region; each `--` starts the next.
      const region = (at: number): UmlState => ({
        id: `${top.state.id}#region${++regions}`,
        kind: "region",
        label: "",
        descriptions: [],
        parent: top.state.id,
        children: [],
        line: at,
      });
      if (!top.region) {
        const first = region(top.line);
        const moved = top.state.children.splice(0);
        add(first);
        for (const id of moved) {
          diagram.states.get(id)!.parent = first.id;
          first.children.push(id);
        }
      }
      const next = region(line);
      add(next);
      top.region = next;
      continue;
    }
    if ((match = text.match(TRANSITION))) {
      const [, from, to, label] = match;
      const source = end(from, line, false),
        target = end(to, line, true);
      diagram.transitions.push({
        id: `t${diagram.transitions.length + 1}`,
        source,
        target,
        label: label?.trim() ? labelText(label) : undefined,
        line,
      });
      continue;
    }
    if ((match = text.match(SPECIAL))) {
      ensure(match[1], line, (match[2] ?? match[3]).toLowerCase() as StateKind);
      continue;
    }
    if ((match = text.match(ALIAS)) || (match = text.match(DECLARE))) {
      const aliased = match[0].startsWith('state "');
      const id = aliased ? match[2] : match[1],
        opens = aliased ? match[3] : match[2];
      if (id === "[*]") throw new UmlError(line, "`[*]` cannot be declared as a state.");
      const state = ensure(id, line);
      if (aliased) state.label = labelText(match[1]);
      if (opens) {
        if (stack.some((item) => item.state === state))
          throw new UmlError(line, `\`${id}\` cannot contain itself.`);
        stack.push({ state, region: null, line });
      }
      continue;
    }
    if ((match = text.match(NOTE))) {
      const target = ensure(match[2], line);
      const item: StateNote = {
        id: `note${diagram.notes.length + 1}`,
        target: target.id,
        side: match[1].toLowerCase() as "left" | "right",
        text: match[3] !== undefined ? labelText(match[3]) : "",
        line,
      };
      if (match[3] !== undefined) diagram.notes.push(item);
      else note = item;
      continue;
    }
    if (STYLING.test(text)) continue;
    if (new RegExp(`^${ID}$`, "u").test(text) && !/^(state|note)\b/.test(text)) {
      if (text !== "[*]") ensure(text.replace(/:::.*$/, ""), line);
      continue;
    }
    if ((match = text.match(DESCRIPTION))) {
      if (match[1] === "[*]") throw new UmlError(line, "`[*]` has no description.");
      const state = ensure(match[1], line);
      if (match[2].trim()) state.descriptions.push(labelText(match[2]));
      continue;
    }
    throw new UmlError(line, `Cannot read \`${text}\`.`);
  }
  if (note) throw new UmlError(note.line, "The note is missing its `end note`.");
  if (stack.length)
    throw new UmlError(
      stack.at(-1)!.line,
      `\`${stack.at(-1)!.state.id}\` is missing its closing \`}\`.`,
    );
  // Empty regions (a trailing `--`) are dropped.
  for (const state of Array.from(diagram.states.values())) {
    if (state.kind === "region" && !state.children.length) {
      diagram.states.delete(state.id);
      const parent = diagram.states.get(state.parent!)!;
      parent.children.splice(parent.children.indexOf(state.id), 1);
    }
  }
  for (const state of diagram.states.values()) {
    if (state.kind !== "state" && state.kind !== "region" && state.children.length)
      throw new UmlError(state.line, `The ${state.kind} \`${state.id}\` cannot contain states.`);
    if (state.children.length && state.descriptions.length)
      throw new UmlError(
        state.line,
        `The composite state \`${state.id}\` has a name only, no description.`,
      );
  }
  // UML has no self transitions on a choice (it is left at once); Mermaid draws them as written.
  const looped = diagram.transitions.find(
    (transition) =>
      transition.source === transition.target &&
      diagram.states.get(transition.source)?.kind === "choice",
  );
  if (looped) unsupported(looped.line, "A self transition on a choice");
  if (diagram.level === "design")
    throw new UmlError(
      0,
      "State machine diagrams belong to the conceptual level in TAM; remove `%% level design`.",
    );
  if (diagram.level === "conceptual") {
    const forbidden = [...diagram.states.values()].find(
      (state) => state.kind === "fork" || state.kind === "join",
    );
    if (forbidden)
      throw new UmlError(
        forbidden.line,
        `TAM state machines have no ${forbidden.kind} bars; use an activity diagram for parallel flows.`,
      );
  }
  return diagram;
}
