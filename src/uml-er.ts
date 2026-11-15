import type { Direction } from "./elk.ts";
import { accessibilityLines, labelText, prepare, UmlError, unsupported } from "./uml.ts";

/**
 * Entity relationship diagrams from Mermaid `erDiagram` sources, drawn in crow's foot notation:
 * entities as boxes with their name over one row per attribute (type, name, keys, comment), and
 * relationships as lines whose ends say how many of each entity take part: solid when the
 * relationship identifies the entity it leads to, dashed when it does not.
 */

/** How many of an entity take part in a relationship; also the marker drawn at that end. */
export type Cardinality = "only-one" | "zero-or-one" | "one-or-more" | "zero-or-more";

/** A key an attribute is part of: primary, foreign or unique. */
export type ErKey = "PK" | "FK" | "UK";

export interface ErAttribute {
  type: string;
  name: string;
  keys: ErKey[];
  comment?: string;
  line: number;
}

export interface ErEntity {
  /** The name the source calls it by, without quotes. */
  id: string;
  /** The name it shows: its alias when it has one. */
  label: string;
  attributes: ErAttribute[];
  line: number;
}

export interface ErRelationship {
  id: string;
  source: string;
  target: string;
  /** How many of the first entity belong to one of the second, drawn at the first. */
  sourceCardinality: Cardinality;
  /** How many of the second entity belong to one of the first, drawn at the second. */
  targetCardinality: Cardinality;
  /** Whether the second entity cannot exist without the first: a solid line. */
  identifying: boolean;
  label?: string;
  line: number;
}

export interface ErDiagram {
  direction: Direction;
  title?: string;
  entities: Map<string, ErEntity>;
  relationships: ErRelationship[];
}

/** An entity's name as a statement writes it: a word that may hold hyphens and dots, or anything in quotes. */
export const ER_NAME = '(?:"[^"]+"|[\\p{L}\\p{N}_][\\p{L}\\p{N}_.-]*)';

/** The ways each cardinality is written: as a symbol before the line, after it, and in words. */
export const CARDINALITIES: Record<Cardinality, { left: string; right: string; words: string[] }> =
  {
    "only-one": { left: "||", right: "||", words: ["only one", "one", "1"] },
    "zero-or-one": { left: "|o", right: "o|", words: ["zero or one", "one or zero"] },
    "one-or-more": {
      left: "}|",
      right: "|{",
      words: ["one or more", "one or many", "many(1)", "1+"],
    },
    "zero-or-more": {
      left: "}o",
      right: "o{",
      words: ["zero or more", "zero or many", "many(0)", "many", "0+"],
    },
  };

const SYMBOLS = new Map<string, Cardinality>(
  Object.entries(CARDINALITIES).flatMap(([kind, { left, right }]) => [
    [left, kind as Cardinality],
    [right, kind as Cardinality],
  ]),
);
/** The cardinalities in words, the longest first so `one or more` is not read as `one`. */
const WORDS = Object.entries(CARDINALITIES)
  .flatMap(([kind, { words }]) => words.map((word) => [word, kind as Cardinality] as const))
  .toSorted((a, b) => b[0].length - a[0].length);

/** The ways the line of a relationship is written, the longest first. */
const LINES: [string, boolean][] = [
  ["optionally to", false],
  ["to", true],
  ["--", true],
  ["..", false],
  [".-", false],
  ["-.", false],
];

/** A piece of a statement: its text and where it starts, counted from the statement's start. */
export interface Span {
  text: string;
  start: number;
}

/** A relationship statement in its pieces, each where the statement writes it. */
export interface RelationshipParts {
  left: Span;
  leftCardinality: Span & { kind: Cardinality };
  line: Span & { identifying: boolean };
  rightCardinality: Span & { kind: Cardinality };
  right: Span;
  /** The text after the colon as written, quotes and all; undefined without a colon. */
  label?: Span;
}

const NAME_AT = new RegExp(`^${ER_NAME}`, "u");

/**
 * Reads a relationship statement (`A ||--o{ B : places`, `A one or more to zero or one B`) piece
 * by piece; null for a statement that is none. Symbols stand with or without spaces around them,
 * words need them.
 */
export function relationshipParts(text: string): RelationshipParts | null {
  let at = 0;
  const space = () => {
    const from = at;
    while (/\s/.test(text[at] ?? "")) at++;
    return at > from;
  };
  const name = (): Span | null => {
    const match = text.slice(at).match(NAME_AT);
    if (!match) return null;
    const span = { text: match[0], start: at };
    at += match[0].length;
    return span;
  };
  /** One of the spellings at the cursor; one in words stands clear of the words around it. */
  const word = <T>(spellings: readonly (readonly [string, T])[]) => {
    const joined = (index: number) => /[\p{L}\p{N}_]/u.test(text[index] ?? "");
    for (const [spelling, value] of spellings) {
      if (!text.startsWith(spelling, at)) continue;
      const wordy = /^[\p{L}\p{N}]/u.test(spelling);
      if (wordy && (joined(at - 1) || joined(at + spelling.length))) continue;
      const span = { text: spelling, start: at, value };
      at += spelling.length;
      return span;
    }
    return null;
  };
  const cardinality = () => {
    const symbol = text.slice(at, at + 2),
      kind = SYMBOLS.get(symbol);
    if (kind) {
      const span = { text: symbol, start: at, kind };
      at += 2;
      return span;
    }
    const found = word(WORDS);
    return found && { text: found.text, start: found.start, kind: found.value };
  };
  const left = name();
  if (!left) return null;
  space();
  const leftCardinality = cardinality();
  if (!leftCardinality) return null;
  space();
  const found = word(LINES);
  if (!found) return null;
  const line = { text: found.text, start: found.start, identifying: found.value };
  space();
  const rightCardinality = cardinality();
  if (!rightCardinality) return null;
  // A cardinality in words stands a space away from the name after it.
  if (!space() && !SYMBOLS.has(rightCardinality.text)) return null;
  const right = name();
  if (!right) return null;
  space();
  const parts: RelationshipParts = { left, leftCardinality, line, rightCardinality, right };
  if (at === text.length) return parts;
  if (text[at] !== ":") return null;
  at++;
  space();
  return { ...parts, label: { text: text.slice(at), start: at } };
}

/** An entity statement: its name, its alias in brackets, the classes that style it and its block. */
export const ER_ENTITY = new RegExp(
  `^(${ER_NAME})(\\s*\\[\\s*(?:"([^"]*)"|([^\\]"]*?))\\s*\\])?(\\s*:::\\s*[\\w-]+(?:\\s*,\\s*[\\w-]+)*)?\\s*(\\{.*)?$`,
  "u",
);

/** Where the `}` that closes an entity's block stands in a line, outside quotes; -1 without one. */
export function blockEnd(text: string): number {
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '"') quoted = !quoted;
    else if (text[index] === "}" && !quoted) return index;
  }
  return -1;
}

/** The id a name in the source stands for: without its quotes. */
export const erId = (raw: string) => raw.replace(/^"|"$/g, "");

/** `string~T~` as `string<T>`, the way Mermaid shows generic attribute types. */
const generic = (text: string) => text.replace(/~([^~]*)~/g, "<$1>");

const KEY = /^(?:PK|FK|UK)$/;

/**
 * The attributes a line of an entity's block declares: each a type, a name, then its keys
 * (`PK`, `FK`, `UK`, several with commas between) and a comment in quotes. Throws for a line
 * that does not read so.
 */
export function parseAttributes(text: string, line: number): ErAttribute[] {
  const tokens = text.match(/"[^"]*"|,|[^\s,"]+/g) ?? [];
  const attributes: ErAttribute[] = [];
  let at = 0;
  const wordAt = (index: number) => {
    const token = tokens[index];
    return token !== undefined && token !== "," && !token.startsWith('"') ? token : undefined;
  };
  while (at < tokens.length) {
    const type = wordAt(at),
      name = wordAt(at + 1);
    if (!type || !name)
      throw new UmlError(
        line,
        `An attribute is a type and a name, then its keys and a comment in quotes: \`${text}\`.`,
      );
    at += 2;
    const keys: ErKey[] = [];
    while (KEY.test(tokens[at] ?? "")) {
      keys.push(tokens[at] as ErKey);
      at++;
      if (tokens[at] !== ",") break;
      if (!KEY.test(tokens[at + 1] ?? ""))
        throw new UmlError(line, "A comma between keys is followed by `PK`, `FK` or `UK`.");
      at++;
    }
    const comment = tokens[at]?.startsWith('"') ? tokens[at++].slice(1, -1) : undefined;
    attributes.push({
      type: generic(type),
      name,
      keys: [...new Set(keys)],
      ...(comment !== undefined ? { comment } : {}),
      line,
    });
  }
  return attributes;
}

/**
 * Statements that only style the picture, which the renderer ignores. A keyword ends at a space:
 * `link-table` is an entity.
 */
export const ER_STYLING = /^(classDef|class|style|linkStyle|click|callback|link)(?=\s|$)/;

/** Parses an `erDiagram` source; throws UmlError with the line of what it cannot read. */
export function parseErDiagram(source: string): ErDiagram {
  const prepared = prepare(source);
  if (prepared.kind !== "er")
    throw new UmlError(prepared.headerLine, "Not an entity relationship diagram.");
  const diagram: ErDiagram = {
    direction: "TB",
    title: prepared.title,
    entities: new Map(),
    relationships: [],
  };
  if (prepared.rest)
    throw new UmlError(
      prepared.headerLine,
      `Cannot read \`${prepared.rest}\` after \`erDiagram\`.`,
    );
  let body: ErEntity | null = null;

  const ensure = (raw: string, line: number): ErEntity => {
    const id = erId(raw);
    let entity = diagram.entities.get(id);
    if (!entity) {
      if (diagram.entities.size >= 200)
        throw new UmlError(line, "Entity relationship diagrams are limited to 200 entities.");
      entity = { id, label: id, attributes: [], line };
      diagram.entities.set(id, entity);
    }
    return entity;
  };
  const addAttributes = (entity: ErEntity, text: string, line: number) => {
    entity.attributes.push(...parseAttributes(text, line));
    if (entity.attributes.length > 60)
      throw new UmlError(line, `Entity \`${entity.id}\` has more than 60 attributes.`);
  };

  const accessibility = accessibilityLines();
  for (const { text, line } of prepared.lines) {
    if (body) {
      const close = blockEnd(text);
      if (close < 0) {
        addAttributes(body, text, line);
        continue;
      }
      if (text.slice(close + 1).trim()) throw new UmlError(line, "A closing `}` ends its line.");
      addAttributes(body, text.slice(0, close), line);
      body = null;
      continue;
    }
    if (accessibility(text)) continue;
    let match: RegExpMatchArray | null;
    if ((match = text.match(/^direction\s+(TB|TD|BT|LR|RL)$/i))) {
      diagram.direction = match[1].toUpperCase().replace("TD", "TB") as Direction;
      continue;
    }
    if (ER_STYLING.test(text)) continue;
    // A title in the front matter comes first.
    if ((match = text.match(/^title\s+(.+)$/))) {
      diagram.title ??= labelText(match[1]);
      continue;
    }
    if ((match = text.match(ER_ENTITY))) {
      const entity = ensure(match[1], line),
        alias = match[3] ?? match[4];
      if (alias?.trim()) entity.label = labelText(alias);
      const opens = match[6];
      if (opens !== undefined) {
        const inner = opens.slice(1),
          close = blockEnd(inner);
        if (close < 0) {
          addAttributes(entity, inner, line);
          body = entity;
        } else {
          if (inner.slice(close + 1).trim())
            throw new UmlError(line, "A closing `}` ends its line.");
          addAttributes(entity, inner.slice(0, close), line);
        }
      }
      continue;
    }
    const parts = relationshipParts(text);
    if (parts) {
      // Mermaid asks for a label: an empty one in quotes says there is none.
      const label = parts.label ? labelText(parts.label.text) : "";
      if (parts.label && !parts.label.text.trim())
        throw new UmlError(line, "A relationship's label follows its colon.");
      diagram.relationships.push({
        id: `r${diagram.relationships.length + 1}`,
        source: ensure(parts.left.text, line).id,
        target: ensure(parts.right.text, line).id,
        sourceCardinality: parts.leftCardinality.kind,
        targetCardinality: parts.rightCardinality.kind,
        identifying: parts.line.identifying,
        ...(label ? { label } : {}),
        line,
      });
      continue;
    }
    if (text === "}") throw new UmlError(line, "Unmatched `}`.");
    if (new RegExp(`^${ER_NAME}\\s+u\\s*(--|\\.\\.)`, "u").test(text))
      unsupported(line, "A relationship to a parent (`u`)");
    if (new RegExp(`^${ER_NAME}\\s*\\S`, "u").test(text))
      throw new UmlError(
        line,
        `Cannot read \`${text}\`: a relationship is written \`A ||--o{ B : label\`, with a cardinality at each end of \`--\` or \`..\`.`,
      );
    throw new UmlError(line, `Cannot read \`${text}\`.`);
  }
  if (body) throw new UmlError(body.line, `Entity \`${body.id}\` is missing its closing \`}\`.`);
  return diagram;
}
