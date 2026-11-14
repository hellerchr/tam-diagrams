import type { Direction } from "./elk.ts";
import type { MarkerKind } from "./markers.ts";
import { accessibilityLines, labelText, type Level, prepare, UmlError, unsupported } from "./uml.ts";

/**
 * Use case diagrams from Mermaid `usecase-beta` sources, drawn as in the TAM flyer and standard
 * (2.2.1): human actors as stick figures, machine actors as «actor» boxes, use cases as ellipses
 * inside the system boundary, associations as straight lines (one smooth curve around anything in
 * the way), «include» and «extend» as dashed dependencies, generalization with a hollow triangle.
 */

export interface UseCaseElement {
  id: string;
  kind: "actor" | "usecase";
  shape: "figure" | "box" | "ellipse" | "rect";
  label: string;
  stereotype?: string;
  boundary: string | null;
  line: number;
}

export interface Boundary {
  id: string;
  label: string;
  line: number;
}

export interface UseCaseRelation {
  id: string;
  source: string;
  target: string;
  line: number;
  label?: string;
  kind: "association" | "include" | "extend" | "generalization";
  start?: MarkerKind;
  end?: MarkerKind;
}

export interface UseCaseNote {
  id: string;
  target: string;
  text: string;
  line: number;
}

export interface UseCaseDiagram {
  direction: Direction;
  title?: string;
  level?: Level;
  elements: Map<string, UseCaseElement>;
  boundaries: Map<string, Boundary>;
  relations: UseCaseRelation[];
  notes: UseCaseNote[];
}

const NAME = String.raw`(?:(\w+)(?:\s*\(\s*("[^"]*"|[^)]*)\s*\)|\s*\[\s*("[^"]*"|[^\]]*)\s*\])?|("[^"]*"))`;

const METADATA = String.raw`(?:\s*@\{[^}]*\})?`;

const STEREOTYPE = String.raw`(?:\s*<<\s*([^>]+?)\s*>>)?`;

const CLASSES = String.raw`(?:\s*:::[\w,-]+)?`;

const ENTITY = new RegExp(`^${NAME}${METADATA}${STEREOTYPE}${CLASSES}`);

/** Arrows, longest first; `-- text -->` forms are handled before. */
const ARROWS: [RegExp, Pick<UseCaseRelation, "kind" | "start" | "end">, boolean][] = [
  [/^\.\.>\s*:\s*include\b/i, { kind: "include", end: "open" }, false],
  [/^\.\.>\s*:\s*extend\b/i, { kind: "extend", end: "open" }, false],
  [/^--\|>/, { kind: "generalization", end: "triangle" }, false],
  [/^--+>/, { kind: "association", end: "open" }, false],
  [/^<--+/, { kind: "association", end: "open" }, true],
  [/^--o/, { kind: "association", end: "circle" }, false],
  [/^o--/, { kind: "association", end: "circle" }, true],
  [/^--x/, { kind: "association", end: "cross" }, false],
  [/^x--/, { kind: "association", end: "cross" }, true],
  [/^--+/, { kind: "association" }, false],
];

export function parseUseCaseDiagram(source: string): UseCaseDiagram {
  const prepared = prepare(source);
  if (prepared.kind !== "usecase")
    throw new UmlError(prepared.headerLine, "Not a use case diagram.");
  const diagram: UseCaseDiagram = {
    direction: "LR",
    title: prepared.title,
    level: prepared.level,
    elements: new Map(),
    boundaries: new Map(),
    relations: [],
    notes: [],
  };
  let boundary: Boundary | null = null;

  const element = (
    match: RegExpMatchArray,
    offset: number,
    line: number,
    actor: boolean,
  ): UseCaseElement => {
    const [id, paren, bracket, quoted] = [
      match[offset],
      match[offset + 1],
      match[offset + 2],
      match[offset + 3],
    ];
    const key = id ?? labelText(quoted);
    const label =
      paren !== undefined
        ? labelText(paren)
        : bracket !== undefined
          ? labelText(bracket)
          : quoted !== undefined
            ? labelText(quoted)
            : undefined;
    let item = diagram.elements.get(key);
    if (!item) {
      if (diagram.elements.size >= 200)
        throw new UmlError(line, "Use case diagrams are limited to 200 elements.");
      item = {
        id: key,
        kind: actor ? "actor" : "usecase",
        shape: actor ? "figure" : bracket !== undefined ? "rect" : "ellipse",
        label: label ?? key,
        boundary: boundary?.id ?? null,
        line,
      };
      diagram.elements.set(key, item);
    } else {
      if (actor && item.kind !== "actor")
        throw new UmlError(line, `\`${key}\` is already a use case.`);
      if (label !== undefined) item.label = label;
      if (boundary && !item.boundary) item.boundary = boundary.id;
    }
    const stereotype = match[offset + 4];
    if (stereotype) {
      item.stereotype = stereotype;
      if (item.kind === "actor" && !/^human$/i.test(stereotype)) item.shape = "box";
    }
    return item;
  };
  /** A relation tail after an element: an arrow and the other element. */
  const tail = (from: UseCaseElement, rest: string, line: number) => {
    let text = rest.trim();
    if (!text) return;
    text = text.replace(/^\w+@(?=[-<.ox])/, "");
    let label: string | undefined,
      spec: Pick<UseCaseRelation, "kind" | "start" | "end"> | undefined,
      backward = false;
    const labelled = text.match(/^(<--|o--|x--|--)\s+(?!>)([^-]+?)\s+(-->|--o|--x|--)(?!-)/);
    if (labelled) {
      label = labelText(labelled[2]);
      const left = labelled[1],
        right = labelled[3];
      spec = {
        kind: "association",
        start:
          left === "<--"
            ? "open"
            : left === "o--"
              ? "circle"
              : left === "x--"
                ? "cross"
                : undefined,
        end:
          right === "-->"
            ? "open"
            : right === "--o"
              ? "circle"
              : right === "--x"
                ? "cross"
                : undefined,
      };
      text = text.slice(labelled[0].length);
    } else {
      const arrow = ARROWS.find(([pattern]) => pattern.test(text));
      if (!arrow) throw new UmlError(line, `Cannot read the relation \`${rest.trim()}\`.`);
      const consumed = text.match(arrow[0])![0];
      spec = arrow[1];
      backward = arrow[2];
      text = text.slice(consumed.length);
    }
    const match = text.trim().match(ENTITY);
    if (!match || match[0].length !== text.trim().length)
      throw new UmlError(line, `Cannot read \`${text.trim()}\` as an element.`);
    const to = element(match, 1, line, false);
    const [source, target] = backward ? [to, from] : [from, to];
    diagram.relations.push({
      id: `r${diagram.relations.length + 1}`,
      source: source.id,
      target: target.id,
      line,
      label,
      ...spec,
      ...(spec.kind === "include" || spec.kind === "extend" ? { label: `«${spec.kind}»` } : {}),
    });
  };

  const accessibility = accessibilityLines();
  for (const { text, line } of prepared.lines) {
    if (accessibility(text)) continue;
    let match: RegExpMatchArray | null;
    if ((match = text.match(/^direction\s+(TB|TD|BT|LR|RL)$/))) {
      diagram.direction = match[1].replace("TD", "TB") as Direction;
      continue;
    }
    if (/^(classDef|class|style)\b/.test(text)) continue;
    if (/^json\b/.test(text)) unsupported(line, "A JSON element");
    if (text === "end") {
      if (!boundary) throw new UmlError(line, "Unmatched `end`.");
      boundary = null;
      continue;
    }
    if ((match = text.match(new RegExp(`^systemBoundary\\s+${NAME}${METADATA}${CLASSES}$`)))) {
      if (boundary) throw new UmlError(line, "System boundaries cannot be nested.");
      const id = match[1] ?? labelText(match[4]);
      const label =
        match[2] !== undefined
          ? labelText(match[2])
          : match[3] !== undefined
            ? labelText(match[3])
            : match[4] !== undefined
              ? labelText(match[4])
              : id;
      if (diagram.boundaries.has(id))
        throw new UmlError(line, `System boundary \`${id}\` is already declared.`);
      boundary = { id, label, line };
      diagram.boundaries.set(id, boundary);
      continue;
    }
    if ((match = text.match(/^note\s+for\s+(\w+)\s+(.+)$/))) {
      const target = diagram.elements.get(match[1]);
      if (!target) throw new UmlError(line, `Unknown element \`${match[1]}\`.`);
      diagram.notes.push({
        id: `note${diagram.notes.length + 1}`,
        target: target.id,
        text: labelText(match[2]),
        line,
      });
      continue;
    }
    if ((match = text.match(/^actor\s+(.*)$/))) {
      // `actor a, b("B") <<system>>` or `actor a --> uc`
      let rest = match[1];
      let first: UseCaseElement | null = null;
      for (;;) {
        const item = rest.match(ENTITY);
        if (!item) throw new UmlError(line, `Cannot read the actor \`${rest}\`.`);
        const actor = element(item, 1, line, true);
        first ??= actor;
        rest = rest.slice(item[0].length).trim();
        if (rest.startsWith(",")) {
          rest = rest.slice(1).trim();
          continue;
        }
        break;
      }
      if (rest) {
        if (boundary) throw new UmlError(line, "Relations go outside system boundaries.");
        tail(first, rest, line);
      }
      continue;
    }
    if ((match = text.match(ENTITY))) {
      const item = element(match, 1, line, false);
      const rest = text.slice(match[0].length);
      if (rest.trim() && boundary)
        throw new UmlError(line, "Relations go outside system boundaries.");
      tail(item, rest, line);
      continue;
    }
    throw new UmlError(line, `Cannot read \`${text}\`.`);
  }
  if (boundary)
    throw new UmlError(boundary.line, `System boundary \`${boundary.id}\` is missing its \`end\`.`);
  if (diagram.level === "design")
    throw new UmlError(
      0,
      "Use case diagrams belong to the conceptual level in TAM; remove `%% level design`.",
    );
  return diagram;
}
