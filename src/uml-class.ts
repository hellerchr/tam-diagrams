import type { Direction } from "./elk.ts";
import type { MarkerKind } from "./markers.ts";
import type { Box, Scene } from "./scene.ts";
import {
  accessibilityLines,
  labelText,
  type Level,
  prepare,
  STYLING,
  UmlError,
  unsupported,
} from "./uml.ts";

/**
 * Class diagrams from Mermaid `classDiagram` sources, drawn in the TAM style (TAM standard 2.1.2 and
 * the flyer): classes with name, attribute and operation compartments; generalization and
 * realization with hollow triangles (one shared triangle per parent where the layout allows),
 * composition and aggregation with diamonds, navigable associations with open arrows,
 * multiplicities beside the ends; namespaces as nested grey packages; lollipop interfaces.
 */

export interface ClassMember {
  text: string;
  method: boolean;
  underline: boolean;
  italic: boolean;
  visibility: string;
}

export interface UmlClass {
  id: string;
  label: string;
  generic?: string;
  annotations: string[];
  attributes: ClassMember[];
  methods: ClassMember[];
  namespace: string | null;
  line: number;
}

export interface Namespace {
  id: string;
  label: string;
  parent: string | null;
  line: number;
}

export interface Relation {
  id: string;
  source: string;
  target: string;
  dashed: boolean;
  startMarker?: MarkerKind;
  endMarker?: MarkerKind;
  label?: string;
  startLabel?: string;
  endLabel?: string;
  line: number;
}

export interface ClassNote {
  id: string;
  text: string;
  target?: string;
  namespace: string | null;
  line: number;
}

/** A lollipop interface (`Name ()-- Class`): a ball on a line from the class, named beside it. */
export interface Lollipop {
  id: string;
  label: string;
  line: number;
}

export interface ClassDiagram {
  direction: Direction;
  title?: string;
  level?: Level;
  classes: Map<string, UmlClass>;
  namespaces: Map<string, Namespace>;
  relations: Relation[];
  notes: ClassNote[];
  lollipops: Lollipop[];
  /** `click A href "url"` and `link A "url"`: where each class points, such as its source file. */
  links: Map<string, string>;
}

const NAME = "(`[^`]+`|[\\p{L}\\p{N}_.]+(?:~[^~]+~)?)";

const RELATION = new RegExp(
  `^${NAME}\\s*(?:"([^"]*)"\\s*)?(<\\||\\*|o|<|\\(\\))?(--|\\.\\.)(\\|>|\\*|o|>|\\(\\))?\\s*(?:"([^"]*)"\\s*)?${NAME}\\s*(?::\\s*(.*))?$`,
  "u",
);

const CLASS = new RegExp(
  `^class\\s+${NAME}(?:\\s*\\[\\s*"([^"]*)"\\s*\\])?(?::::[\\w-]+)?(?:\\s*<<\\s*([^>]+?)\\s*>>)?\\s*(\\{.*)?$`,
  "u",
);

const MEMBER = new RegExp(`^${NAME}\\s*:\\s*(.*)$`, "u");

const ANNOTATION = new RegExp(`^<<\\s*([^>]+?)\\s*>>\\s*${NAME}$`, "u");

const NAMESPACE = /^namespace\s+([\p{L}\p{N}_.]+)(?:\s*\[\s*"?([^\]"]*)"?\s*\])?\s*\{\s*(\})?$/u;

const LINK = new RegExp(
  `^(?:click\\s+${NAME}\\s+href\\s+"([^"]*)"|link\\s+${NAME}\\s+"([^"]*)")`,
  "u",
);

const MARKERS: Record<string, MarkerKind> = {
  "<|": "triangle",
  "|>": "triangle",
  "*": "filled-diamond",
  o: "diamond",
  "<": "open",
  ">": "open",
  "()": "circle",
};

/** `List~int~` as `List<int>`: a tilde before a name opens a type argument list, any other closes one. */
export function generics(text: string): string {
  return text.replace(/~/g, (_, index: number) =>
    /[\p{L}\p{N}_(?[]/u.test(text[index + 1] ?? "") ? "<" : ">",
  );
}

/** A member line as Mermaid shows it: methods as `name(params) : Return`, `$` underlined, `*` italic. */
export function parseMember(raw: string): ClassMember {
  const input = raw.trim();
  const method = input.includes("(") ? parseMethod(input) : undefined;
  if (method) return method;
  const visibility = /^[#+~-]/.test(input) ? input[0] : "";
  const classifier = /[$*]$/.test(input) ? input.slice(-1) : "";
  const body = input.slice(visibility ? 1 : 0, classifier ? -1 : undefined).trim();
  return {
    text: `${visibility}${generics(body)}`,
    method: false,
    underline: classifier === "$",
    italic: classifier === "*",
    visibility,
  };
}

/** A method member, `name(params)` with its return type; undefined for a line that reads as none. */
function parseMethod(input: string): ClassMember | undefined {
  const match = input.match(/^([#+~-])?(.+)\((.*)\)([\s$*])?(.*)$/);
  if (!match) return undefined;
  let [, visibility = "", name, parameters, classifier = "", returns] = match;
  classifier = classifier.trim();
  // A return type may follow a colon of its own (`total(): Money`), which is not part of it.
  returns = returns.trim().replace(/^:\s*/, "");
  if (!classifier && /[$*]$/.test(returns)) {
    classifier = returns.slice(-1);
    returns = returns.slice(0, -1).trim();
  }
  const text = `${visibility}${generics(name.trim())}(${generics(parameters.trim())})${returns ? ` : ${generics(returns)}` : ""}`;
  return {
    text,
    method: true,
    underline: classifier === "$",
    italic: classifier === "*",
    visibility,
  };
}

const plainName = (raw: string) => raw.replace(/^`|`$/g, "");

const splitName = (raw: string) => {
  const name = plainName(raw),
    index = name.indexOf("~");
  return index > 0 && !raw.startsWith("`")
    ? { id: name.slice(0, index), generic: name.slice(index + 1).replace(/~$/, "") }
    : { id: name };
};

export function parseClassDiagram(source: string): ClassDiagram {
  const prepared = prepare(source);
  if (prepared.kind !== "class") throw new UmlError(prepared.headerLine, "Not a class diagram.");
  const diagram: ClassDiagram = {
    direction: "TB",
    title: prepared.title,
    level: prepared.level,
    classes: new Map(),
    namespaces: new Map(),
    relations: [],
    notes: [],
    lollipops: [],
    links: new Map(),
  };
  const namespaces: string[] = [];
  let body: UmlClass | null = null;

  const ensure = (raw: string, line: number, declare = false): UmlClass => {
    const { id, generic } = splitName(raw);
    let item = diagram.classes.get(id);
    if (!item) {
      if (diagram.classes.size >= 200)
        throw new UmlError(line, "Class diagrams are limited to 200 classes.");
      item = { id, label: id, annotations: [], attributes: [], methods: [], namespace: null, line };
      diagram.classes.set(id, item);
    }
    if (generic) item.generic = generic;
    if (declare && namespaces.length) item.namespace = namespaces.at(-1)!;
    return item;
  };
  const addMember = (item: UmlClass, text: string, line: number) => {
    const annotation = text.match(/^<<\s*(.+?)\s*>>$/);
    if (annotation) {
      item.annotations.push(annotation[1]);
      return;
    }
    const member = parseMember(text);
    if (!member.text) return;
    (member.method ? item.methods : item.attributes).push(member);
    if (item.attributes.length + item.methods.length > 60)
      throw new UmlError(line, `Class \`${item.id}\` has more than 60 members.`);
  };

  const accessibility = accessibilityLines();
  for (const { text, line } of prepared.lines) {
    if (body) {
      if (text === "}") {
        body = null;
        continue;
      }
      if (text.endsWith("}")) {
        addMember(body, text.slice(0, -1), line);
        body = null;
        continue;
      }
      addMember(body, text, line);
      continue;
    }
    if (accessibility(text)) continue;
    let match: RegExpMatchArray | null;
    if ((match = text.match(/^direction\s+(TB|TD|BT|LR|RL)$/i))) {
      diagram.direction = match[1].toUpperCase().replace("TD", "TB") as Direction;
      continue;
    }
    if (text === "}") {
      if (!namespaces.pop()) throw new UmlError(line, "Unmatched `}`.");
      continue;
    }
    if ((match = text.match(NAMESPACE))) {
      const qualified = namespaces.length ? `${namespaces.at(-1)}.${match[1]}` : match[1];
      // Dotted names nest: `namespace a.b` is `b` inside `a`, as in Mermaid.
      const parts = qualified.split(".");
      parts.forEach((part, index) => {
        const id = parts.slice(0, index + 1).join(".");
        if (!diagram.namespaces.has(id))
          diagram.namespaces.set(id, {
            id,
            label: part,
            parent: index ? parts.slice(0, index).join(".") : null,
            line,
          });
      });
      if (match[2]?.trim()) diagram.namespaces.get(qualified)!.label = labelText(match[2]);
      if (!match[3]) namespaces.push(qualified);
      continue;
    }
    if ((match = text.match(CLASS))) {
      const item = ensure(match[1], line, true);
      if (match[2] !== undefined) item.label = labelText(match[2]);
      if (match[3]) item.annotations.push(match[3]);
      const opens = match[4]?.trim();
      if (opens) {
        const inner = opens.slice(1).trim();
        if (inner === "") body = item;
        else if (inner.endsWith("}")) {
          if (inner.slice(0, -1).trim()) addMember(item, inner.slice(0, -1), line);
        } else {
          addMember(item, inner, line);
          body = item;
        }
      }
      continue;
    }
    if ((match = text.match(ANNOTATION))) {
      ensure(match[2], line).annotations.push(match[1]);
      continue;
    }
    if ((match = text.match(/^note\s+for\s+(\S+)\s+"([\s\S]*)"$/u))) {
      const target = ensure(match[1], line);
      diagram.notes.push({
        id: `note${diagram.notes.length + 1}`,
        text: labelText(`"${match[2]}"`),
        target: target.id,
        namespace: namespaces.at(-1) ?? null,
        line,
      });
      continue;
    }
    if ((match = text.match(/^note\s+"([\s\S]*)"$/u))) {
      diagram.notes.push({
        id: `note${diagram.notes.length + 1}`,
        text: labelText(`"${match[1]}"`),
        namespace: namespaces.at(-1) ?? null,
        line,
      });
      continue;
    }
    if ((match = text.match(RELATION))) {
      if (namespaces.length)
        throw new UmlError(
          line,
          "Relations go outside namespaces; a namespace only declares its classes.",
        );
      const [, left, startLabel, startMarker, operator, endMarker, endLabel, right, label] = match;
      // A lollipop end is an interface ball, not a class, when the other end is plain (as in Mermaid).
      const lollipop = (name: string) => {
        const id = `interface${diagram.lollipops.length + 1}`;
        diagram.lollipops.push({ id, label: splitName(name).id, line });
        return id;
      };
      const ballStart = startMarker === "()" && !endMarker,
        ballEnd = endMarker === "()" && !startMarker;
      const source = ballStart ? lollipop(left) : ensure(left, line).id,
        target = ballEnd ? lollipop(right) : ensure(right, line).id;
      diagram.relations.push({
        id: `r${diagram.relations.length + 1}`,
        source,
        target,
        dashed: operator === "..",
        startMarker: startMarker && !ballStart ? MARKERS[startMarker] : undefined,
        endMarker: endMarker && !ballEnd ? MARKERS[endMarker] : undefined,
        label: label?.trim() ? labelText(label) : undefined,
        startLabel: startLabel?.trim() || undefined,
        endLabel: endLabel?.trim() || undefined,
        line,
      });
      continue;
    }
    if ((match = text.match(MEMBER))) {
      addMember(ensure(match[1], line), match[2], line);
      continue;
    }
    if (new RegExp(`^${NAME}:::[\\w-]+$`, "u").test(text)) {
      ensure(text.replace(/:::.*$/, ""), line);
      continue;
    }
    if ((match = text.match(LINK))) {
      diagram.links.set(splitName(match[1] ?? match[3]).id, match[2] ?? match[4]);
      continue;
    }
    if (STYLING.test(text)) continue;
    if (/^title\b/.test(text)) unsupported(line, "A `title` statement");
    throw new UmlError(line, `Cannot read \`${text}\`.`);
  }
  if (body) throw new UmlError(body.line, `Class \`${body.id}\` is missing its closing \`}\`.`);
  if (namespaces.length)
    throw new UmlError(
      diagram.namespaces.get(namespaces.at(-1)!)!.line,
      `Namespace \`${namespaces.at(-1)}\` is missing its closing \`}\`.`,
    );
  if (diagram.level === "conceptual") checkConceptual(diagram);
  return diagram;
}

/** What the interactive viewer folds away: packages drawn as one box, classes shown without members. */
export interface ClassView {
  collapsed: ReadonlySet<string>;
  bare: ReadonlySet<string>;
}

/**
 * The diagram as the viewer shows it: each collapsed namespace (outermost wins) becomes one class
 * (id `ns:<namespace>`, drawn as a folder) listing the number of classes inside; relations
 * into it end on that box, one per pair and kind; classes in `bare` lose their members. Shape ids
 * stay the namespace's `ns:` id or the class id, so a clicked shape names what it shows.
 */
export function foldClassDiagram(diagram: ClassDiagram, view: ClassView): ClassDiagram {
  const folded = new Map<string, string>();
  const outermost = (id: string | null): string | null => {
    let found: string | null = null;
    for (let at = id; at; at = diagram.namespaces.get(at)?.parent ?? null)
      if (view.collapsed.has(at)) found = at;
    return found;
  };
  const classes = new Map<string, UmlClass>(),
    namespaces = new Map<string, Namespace>();
  for (const space of diagram.namespaces.values())
    if (!outermost(space.parent)) {
      if (!view.collapsed.has(space.id)) namespaces.set(space.id, space);
    }
  const counts = new Map<string, number>();
  for (const item of diagram.classes.values()) {
    const into = outermost(item.namespace);
    if (into) {
      folded.set(item.id, `ns:${into}`);
      counts.set(into, (counts.get(into) ?? 0) + 1);
      continue;
    }
    classes.set(item.id, view.bare.has(item.id) ? { ...item, attributes: [], methods: [] } : item);
  }
  for (const [id, count] of counts) {
    const space = diagram.namespaces.get(id)!;
    classes.set(`ns:${id}`, {
      id: `ns:${id}`,
      label: space.label,
      annotations: [],
      attributes: [
        {
          text: `${count} ${count === 1 ? "class" : "classes"}`,
          method: false,
          underline: false,
          italic: true,
          visibility: "",
        },
      ],
      methods: [],
      namespace: space.parent,
      line: space.line,
    });
  }
  const end = (id: string) => folded.get(id) ?? id;
  const seen = new Set<string>();
  const relations: Relation[] = [];
  for (const relation of diagram.relations) {
    const source = end(relation.source),
      target = end(relation.target);
    if (source === target && source !== relation.source) continue;
    const moved = source !== relation.source || target !== relation.target;
    const key = `${source}\u0000${target}\u0000${relation.dashed}\u0000${relation.startMarker}\u0000${relation.endMarker}`;
    if (moved && seen.has(key)) continue;
    seen.add(key);
    relations.push(
      moved
        ? {
            ...relation,
            source,
            target,
            label: undefined,
            startLabel: undefined,
            endLabel: undefined,
          }
        : relation,
    );
  }
  const notes = diagram.notes.filter(
    (note) => !outermost(note.namespace) && (!note.target || !folded.has(note.target)),
  );
  return { ...diagram, classes, namespaces, relations, notes };
}

/** A class or package of a drawn class diagram: what a click on the picture hits. */
export interface ClassPart {
  kind: "class" | "package";
  /** The class id, or the namespace id (without `ns:`). */
  id: string;
  name: string;
  /** Collapsed packages and classes without members, which a click opens. */
  folded: boolean;
  /** A class's `click … href` target. */
  link?: string;
}

/** The class or package drawn at `point` (scene coordinates): the innermost shape containing it. */
export function classPartAt(
  diagram: ClassDiagram,
  view: ClassView,
  scene: Scene,
  point: { x: number; y: number },
): ClassPart | null {
  const inside = scene.shapes.filter(
    (shape) =>
      point.x >= shape.box.x &&
      point.x <= shape.box.x + shape.box.width &&
      point.y >= shape.box.y &&
      point.y <= shape.box.y + shape.box.height &&
      (diagram.classes.has(shape.id) || diagram.namespaces.has(shape.id.slice(3))),
  );
  // Leaves before containers, inner containers before outer ones.
  const shape = inside.toSorted(
    (a, b) => Number(a.container) - Number(b.container) || b.depth - a.depth,
  )[0];
  if (!shape) return null;
  // `ns:` shapes are packages: open ones are containers, collapsed ones folders standing in for them.
  if (shape.id.startsWith("ns:")) {
    const id = shape.id.slice(3);
    return {
      kind: "package",
      id,
      name: diagram.namespaces.get(id)?.label ?? diagram.classes.get(shape.id)?.label ?? id,
      folded: !shape.container,
    };
  }
  const item = diagram.classes.get(shape.id)!;
  return {
    kind: "class",
    id: item.id,
    name: item.label,
    folded: view.bare.has(item.id),
    ...(diagram.links.has(item.id) ? { link: diagram.links.get(item.id) } : {}),
  };
}

/** Where a part is drawn now: a class, an open package or a collapsed one. */
export function classPartBox(scene: Scene, part: Pick<ClassPart, "kind" | "id">): Box | null {
  const id = part.kind === "package" ? `ns:${part.id}` : part.id;
  return scene.shapes.find((shape) => shape.id === id)?.box ?? null;
}

/** The view a full window opens with: a large diagram as an overview of its packages and class names. */
export function overview(diagram: ClassDiagram): ClassView {
  const large = diagram.classes.size > 25;
  // The first level with more than one package: below a single root package that holds no classes.
  const spaces = [...diagram.namespaces.values()];
  let level = spaces.filter((space) => !space.parent);
  while (
    level.length === 1 &&
    ![...diagram.classes.values()].some((item) => item.namespace === level[0].id)
  ) {
    const parent = level[0].id;
    const next = spaces.filter((space) => space.parent === parent);
    if (!next.length) break;
    level = next;
  }
  return {
    collapsed: new Set(large && level.length > 1 ? level.map((space) => space.id) : []),
    bare: new Set(large ? diagram.classes.keys() : []),
  };
}

/** The view after clicking `part`: a package opens or closes, a class shows or hides its members. */
export function toggleClassPart(view: ClassView, part: ClassPart): ClassView {
  const flip = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };
  return part.kind === "package"
    ? { ...view, collapsed: flip(view.collapsed, part.id) }
    : { ...view, bare: flip(view.bare, part.id) };
}

/** TAM 2.1.2: visibility, interfaces, realization, templates and dependencies belong to the design level. */
function checkConceptual(diagram: ClassDiagram) {
  for (const item of diagram.classes.values()) {
    const visible = [...item.attributes, ...item.methods].find((member) => member.visibility);
    if (visible)
      throw new UmlError(
        item.line,
        `Visibility (\`${visible.text}\`) belongs to the design level; remove \`%% level conceptual\` or the marker.`,
      );
    if (item.annotations.some((annotation) => /^interface$/i.test(annotation)))
      throw new UmlError(
        item.line,
        `Interfaces such as \`${item.id}\` belong to the design level.`,
      );
    if (item.generic)
      throw new UmlError(
        item.line,
        `Templates such as \`${item.id}~${item.generic}~\` belong to the design level.`,
      );
  }
  if (diagram.lollipops.length)
    throw new UmlError(diagram.lollipops[0].line, "Interfaces belong to the design level.");
  for (const relation of diagram.relations) {
    const markers = new Set([relation.startMarker, relation.endMarker]);
    if (relation.dashed && markers.has("triangle"))
      throw new UmlError(relation.line, "Interface realization belongs to the design level.");
    if (relation.dashed && markers.has("open"))
      throw new UmlError(relation.line, "Dependencies belong to the design level.");
  }
}
