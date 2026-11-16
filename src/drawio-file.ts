/**
 * draw.io files: the XML of a diagram as cells, read and written without a DOM, so the command line
 * reads them too. A file holds pages (`<diagram>`), a page a graph model of cells: vertices (shapes),
 * edges (connections) and the cells inside them. drawio.ts turns diagrams into cells and back, one
 * module per diagram type.
 */

import type { Box, Point } from "./scene.ts";

/** Where a cell stands. A vertex's x and y are relative to its parent vertex, an edge's points too. */
export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * A label or mark on an edge: x runs from -1 at the edge's start to 1 at its end, y is the distance
   * across it; on a vertex x and y are fractions of the parent's size. `offset` moves it further.
   */
  relative?: boolean;
  /** An edge's bends, in its parent's coordinates. */
  points?: Point[];
  /** The ends of an edge that is not connected at them. */
  sourcePoint?: Point;
  targetPoint?: Point;
  offset?: Point;
}

/** A cell of a page: the root (`0`), a layer (`1`), a shape, a connection, or a label on one. */
export interface Cell {
  id: string;
  /** Absent only on the root. */
  parent?: string;
  /** The label: HTML when the style says `html=1`, else plain text. */
  value?: string;
  style?: string;
  vertex?: boolean;
  edge?: boolean;
  /** False for marks that no connection may start or end at. */
  connectable?: boolean;
  source?: string;
  target?: string;
  geometry?: Geometry;
  /** The cell's own properties, which draw.io shows under Edit Data: an `<object>` around the cell. */
  data?: Record<string, string>;
}

/** A page of a draw.io file. */
export interface Page {
  name: string;
  id?: string;
  cells: Cell[];
}

/** A file that is not a draw.io diagram, or one that cannot be read. */
export class DrawioError extends Error {}

// ---------------------------------------------------------------------------------------------
// XML

/** An element of an XML document; text between the tags is kept as the element's text. */
export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Character and the five predefined entity references decoded; other references stay as written. */
export const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) =>
    name[0] === "#"
      ? String.fromCodePoint(
          name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1)),
        )
      : (ENTITIES[name] ?? whole),
  );

/** Text in an attribute value: line breaks stay line breaks when it is read again. */
export const escapeAttribute = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
    .replace(/\t/g, "&#9;");

/**
 * Reads an XML document into its root element. It reads what draw.io and SVG files hold: elements,
 * attributes, text, CDATA; declarations, comments and doctypes are skipped. Throws DrawioError on
 * markup it cannot read.
 */
export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: "#document", attributes: {}, children: [], text: "" };
  const open: XmlElement[] = [root];
  let at = 0;
  const fail = (message: string): never => {
    throw new DrawioError(`The file is not readable XML: ${message}.`);
  };
  while (at < text.length) {
    const lt = text.indexOf("<", at);
    if (lt < 0) {
      open.at(-1)!.text += decodeEntities(text.slice(at));
      break;
    }
    if (lt > at) open.at(-1)!.text += decodeEntities(text.slice(at, lt));
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      at = end < 0 ? fail("a comment does not end") : end + 3;
    } else if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end < 0) fail("a CDATA section does not end");
      open.at(-1)!.text += text.slice(lt + 9, end);
      at = end + 3;
    } else if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      at = end < 0 ? fail("a declaration does not end") : end + 2;
    } else if (text.startsWith("<!", lt)) {
      // A doctype, with an internal subset in brackets perhaps.
      let depth = 0,
        index = lt + 2;
      for (; index < text.length; index++) {
        if (text[index] === "[") depth++;
        else if (text[index] === "]") depth--;
        else if (text[index] === ">" && depth <= 0) break;
      }
      at = index + 1;
    } else if (text[lt + 1] === "/") {
      const end = text.indexOf(">", lt);
      if (end < 0) fail("a closing tag does not end");
      const name = text.slice(lt + 2, end).trim();
      const element = open.pop();
      if (!element || element === root || element.name !== name)
        fail(`\`</${name}>\` closes no open \`<${name}>\``);
      at = end + 1;
    } else {
      const tag = /^<([A-Za-z_:][\w:.-]*)/.exec(text.slice(lt, lt + 200));
      if (!tag) fail(`\`${text.slice(lt, lt + 20)}\` is no tag`);
      const element: XmlElement = { name: tag![1], attributes: {}, children: [], text: "" };
      let index = lt + tag![0].length;
      const attribute = /\s*([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?>)/y;
      for (;;) {
        attribute.lastIndex = index;
        const match = attribute.exec(text);
        if (!match) fail(`the tag \`<${element.name}>\` does not end`);
        index = attribute.lastIndex;
        if (match![5]) {
          open.at(-1)!.children.push(element);
          if (match![5] === ">") open.push(element);
          break;
        }
        element.attributes[match![1]] = decodeEntities(match![3] ?? match![4]);
      }
      at = index;
    }
  }
  if (open.length > 1) fail(`\`<${open.at(-1)!.name}>\` is not closed`);
  const [first] = root.children;
  return first ?? fail("there is no element");
}

/** The elements under `element`, at any depth, with this name. */
function* descendants(element: XmlElement, name: string): Generator<XmlElement> {
  for (const child of element.children) {
    if (child.name === name) yield child;
    yield* descendants(child, name);
  }
}

// ---------------------------------------------------------------------------------------------
// Styles and labels

/**
 * A cell's style as keys and values. A word without `=` names a style or a shape (`ellipse`,
 * `rhombus`, `text`, `group`): it is a key with the value "".
 */
export type Style = Map<string, string>;

export function parseStyle(style: string | undefined): Style {
  const result: Style = new Map();
  for (const part of (style ?? "").split(";")) {
    const item = part.trim();
    if (!item) continue;
    const equals = item.indexOf("=");
    if (equals < 0) result.set(item, "");
    else result.set(item.slice(0, equals).trim(), item.slice(equals + 1).trim());
  }
  return result;
}

/** A style as draw.io writes it; keys with the value "" are written as words, undefined ones not at all. */
export function formatStyle(
  entries: Record<string, string | number | boolean | undefined> | Style,
): string {
  const pairs = entries instanceof Map ? [...entries] : Object.entries(entries);
  return pairs
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([key, value]) =>
      value === ""
        ? key
        : `${key}=${value === true ? 1 : typeof value === "number" ? round(value) : value}`,
    )
    .map((item) => `${item};`)
    .join("");
}

/** The words of a style without `=`: draw.io reads the first as the named style of the cell. */
const STYLE_WORDS = new Set([
  "ellipse",
  "rhombus",
  "triangle",
  "text",
  "group",
  "swimlane",
  "edgeLabel",
  "label",
  "line",
  "image",
  "rectangle",
  "rounded",
  "shape",
]);

/** The shape a style draws: `shape=…`, or the named style that sets it; "rect" for none. */
export function shapeOf(style: Style): string {
  const shape = style.get("shape");
  if (shape) return shape.replace(/\(.*$/s, "");
  for (const [key, value] of style) if (value === "" && STYLE_WORDS.has(key)) return key;
  return "rect";
}

/** Whether a flag of a style is on: `1`, `true`, or the word alone. */
export const isOn = (style: Style, key: string) => {
  const value = style.get(key);
  return value === "1" || value === "true" || value === "";
};

/** Text as the value of a cell with `html=1`: escaped, lines joined with `<br>`. */
export const textToHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

/**
 * The text of an HTML label: a line for each `<br>`, block element or line break, tags dropped,
 * entities decoded, `&nbsp;` as a space, and spaces in each line collapsed.
 */
export function htmlToText(html: string): string {
  // Block elements end a line unless one ends there already; each <br> ends one.
  const BLOCK = "\u0001";
  return decodeEntities(
    html
      .replace(/\r\n?/g, "\n")
      .replace(/\n/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(div|p|li|h[1-6]|tr)\b[^>]*>/gi, BLOCK)
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/[ \t]*\u0001[\s\u0001]*/g, (run) =>
        run.includes("\n") ? run.replace(/\u0001/g, "") : BLOCK,
      )
      .replace(/\u0001/g, "\n"),
  )
    .split("\n")
    .map((line) => line.replace(/[\s\u00a0]+/g, " ").trim())
    .filter((line, index, lines) => line || (index > 0 && index < lines.length - 1))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

/** A number as a file writes it: at most two decimals. */
const round = (value: number) => String(Math.round(value * 100) / 100);

// ---------------------------------------------------------------------------------------------
// Writing

function geometryXml(geometry: Geometry, indent: string): string {
  const { x, y, width, height, relative, points, sourcePoint, targetPoint, offset } = geometry;
  const attributes = [
    x ? ` x="${round(x)}"` : "",
    y ? ` y="${round(y)}"` : "",
    width ? ` width="${round(width)}"` : "",
    height ? ` height="${round(height)}"` : "",
    relative ? ` relative="1"` : "",
  ].join("");
  const point = (p: Point, as?: string) =>
    `<mxPoint x="${round(p.x)}" y="${round(p.y)}"${as ? ` as="${as}"` : ""} />`;
  const inner = [
    sourcePoint ? `${indent}  ${point(sourcePoint, "sourcePoint")}` : "",
    targetPoint ? `${indent}  ${point(targetPoint, "targetPoint")}` : "",
    points?.length
      ? `${indent}  <Array as="points">\n${points.map((p) => `${indent}    ${point(p)}`).join("\n")}\n${indent}  </Array>`
      : "",
    offset ? `${indent}  ${point(offset, "offset")}` : "",
  ].filter(Boolean);
  return inner.length
    ? `${indent}<mxGeometry${attributes} as="geometry">\n${inner.join("\n")}\n${indent}</mxGeometry>`
    : `${indent}<mxGeometry${attributes} as="geometry" />`;
}

function cellXml(cell: Cell): string {
  const indent = "        ";
  const attribute = (name: string, value: string | undefined) =>
    value === undefined ? "" : ` ${name}="${escapeAttribute(value)}"`;
  const flags = [
    attribute("style", cell.style),
    cell.vertex ? ` vertex="1"` : "",
    cell.edge ? ` edge="1"` : "",
    cell.connectable === false ? ` connectable="0"` : "",
    attribute("parent", cell.parent),
    attribute("source", cell.source),
    attribute("target", cell.target),
  ].join("");
  const body = cell.geometry ? `\n${geometryXml(cell.geometry, `${indent}  `)}\n${indent}` : "";
  const closing = body ? `>${body}</mxCell>` : " />";
  if (!cell.data)
    return `${indent}<mxCell${attribute("id", cell.id)}${attribute("value", cell.value)}${flags}${closing}`;
  // Properties go on an <object> around the cell, which then carries the id and the label.
  const data = Object.entries(cell.data)
    .map(([name, value]) => attribute(name, value))
    .join("");
  const inner = body ? `\n${geometryXml(cell.geometry!, `${indent}    `)}\n${indent}  ` : "";
  return `${indent}<object${attribute("label", cell.value)}${data}${attribute("id", cell.id)}>\n${indent}  <mxCell${flags}${inner ? `>${inner}</mxCell>` : " />"}\n${indent}</object>`;
}

/** The root and the layer every page starts with; cells with no parent of their own go in the layer. */
export const LAYER = "1";

/**
 * A draw.io file of the pages, uncompressed so it reads in a diff. The root and layer cells are added
 * when a page does not have them; `data` on the root cell is the page's own properties.
 */
export function writeDrawio(pages: Page[], host = "tam-diagrams"): string {
  const page = (item: Page, index: number) => {
    const cells = [...item.cells];
    if (!cells.some((cell) => cell.id === "0")) cells.unshift({ id: "0" });
    if (!cells.some((cell) => cell.id === LAYER))
      cells.splice(cells.findIndex((cell) => cell.id === "0") + 1, 0, { id: LAYER, parent: "0" });
    return [
      `  <diagram name="${escapeAttribute(item.name)}" id="${escapeAttribute(item.id ?? `page-${index + 1}`)}">`,
      `    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">`,
      `      <root>`,
      ...cells.map(cellXml),
      `      </root>`,
      `    </mxGraphModel>`,
      `  </diagram>`,
    ].join("\n");
  };
  return `<mxfile host="${escapeAttribute(host)}">\n${pages.map(page).join("\n")}\n</mxfile>\n`;
}

// ---------------------------------------------------------------------------------------------
// Reading

const number = (value: string | undefined) => {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) ? parsed : 0;
};

const pointOf = (element: XmlElement): Point => ({
  x: number(element.attributes.x),
  y: number(element.attributes.y),
});

function readGeometry(element: XmlElement): Geometry {
  const { attributes } = element;
  const geometry: Geometry = {
    x: number(attributes.x),
    y: number(attributes.y),
    width: number(attributes.width),
    height: number(attributes.height),
  };
  if (attributes.relative === "1") geometry.relative = true;
  for (const child of element.children) {
    if (child.name === "mxPoint") {
      const as = child.attributes.as;
      if (as === "sourcePoint" || as === "targetPoint" || as === "offset")
        geometry[as] = pointOf(child);
    } else if (child.name === "Array" && child.attributes.as === "points")
      geometry.points = child.children.filter((p) => p.name === "mxPoint").map(pointOf);
  }
  return geometry;
}

/** The cells of a graph model: `<mxCell>`s, and `<object>`/`<UserObject>`s around one. */
function readCells(model: XmlElement): Cell[] {
  const root = model.children.find((child) => child.name === "root");
  if (!root) return [];
  const cells: Cell[] = [];
  for (const element of root.children) {
    const wrapped = element.name === "object" || element.name === "UserObject";
    const node = wrapped ? element.children.find((child) => child.name === "mxCell") : element;
    if (!node || node.name !== "mxCell") continue;
    const { attributes } = node;
    const cell: Cell = { id: (wrapped ? element : node).attributes.id ?? "" };
    if (attributes.parent !== undefined) cell.parent = attributes.parent;
    const value = wrapped ? element.attributes.label : attributes.value;
    if (value !== undefined) cell.value = value;
    if (attributes.style !== undefined) cell.style = attributes.style;
    if (attributes.vertex === "1") cell.vertex = true;
    if (attributes.edge === "1") cell.edge = true;
    if (attributes.connectable === "0") cell.connectable = false;
    if (attributes.source !== undefined) cell.source = attributes.source;
    if (attributes.target !== undefined) cell.target = attributes.target;
    const geometry = node.children.find((child) => child.name === "mxGeometry");
    if (geometry) cell.geometry = readGeometry(geometry);
    if (wrapped) {
      const data = Object.fromEntries(
        Object.entries(element.attributes).filter(([key]) => key !== "id" && key !== "label"),
      );
      if (Object.keys(data).length) cell.data = data;
    }
    cells.push(cell);
  }
  return cells;
}

const base64Bytes = (text: string) => {
  const binary = atob(text.replace(/\s+/g, ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

/** A compressed page as draw.io writes it: base64 of raw deflate of the URI-encoded XML. */
async function inflatePage(text: string): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = base64Bytes(text);
  } catch {
    throw new DrawioError("A page of the file is neither XML nor compressed XML.");
  }
  try {
    const stream = new Response(bytes as BodyInit).body!.pipeThrough(
      new DecompressionStream("deflate-raw"),
    );
    const inflated = await new Response(stream).text();
    try {
      return decodeURIComponent(inflated);
    } catch {
      return inflated;
    }
  } catch {
    throw new DrawioError("A compressed page of the file cannot be decompressed.");
  }
}

/** Compresses a page as draw.io does; for tests and for files that should be small. */
export async function deflatePage(xml: string): Promise<string> {
  const stream = new Response(encodeURIComponent(xml)).body!.pipeThrough(
    new CompressionStream("deflate-raw"),
  );
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Whether a text looks like a draw.io file: an mxfile, a bare graph model, or an SVG that carries one. */
export const isDrawio = (text: string) =>
  /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<(mxfile|mxGraphModel)\b/.test(
    text,
  ) ||
  (/<svg\b/.test(text) && /\bcontent="[^"]*(?:&lt;|<)mxfile/.test(text));

/**
 * The pages of a draw.io file: an `.drawio` file (compressed or not), a bare graph model, or an
 * `.drawio.svg` with the diagram in its `content` attribute. Throws DrawioError for anything else.
 */
export async function readDrawio(text: string): Promise<Page[]> {
  let document = parseXml(text.replace(/^\uFEFF/, ""));
  if (document.name === "svg") {
    const content = document.attributes.content;
    if (!content) throw new DrawioError("The SVG file carries no draw.io diagram.");
    document = parseXml(content);
  }
  if (document.name === "mxGraphModel") return [{ name: "Page-1", cells: readCells(document) }];
  if (document.name !== "mxfile")
    throw new DrawioError(`The file is no draw.io diagram: it starts with \`<${document.name}>\`.`);
  const pages: Page[] = [];
  for (const diagram of descendants(document, "diagram")) {
    let model = diagram.children.find((child) => child.name === "mxGraphModel");
    if (!model && diagram.text.trim()) {
      const xml = await inflatePage(diagram.text.trim());
      model = parseXml(xml);
      if (model.name !== "mxGraphModel")
        throw new DrawioError("A compressed page of the file holds no graph model.");
    }
    pages.push({
      name: diagram.attributes.name ?? `Page-${pages.length + 1}`,
      ...(diagram.attributes.id ? { id: diagram.attributes.id } : {}),
      cells: model ? readCells(model) : [],
    });
  }
  if (!pages.length) throw new DrawioError("The draw.io file has no pages.");
  return pages;
}

// ---------------------------------------------------------------------------------------------
// A page to read from

/**
 * A page as an importer reads it: cells by id, their children, styles and labels as text, and every
 * vertex's box and every edge's path in page coordinates, whatever the cells are nested in.
 */
export class Drawing {
  readonly name: string;
  readonly cells: Map<string, Cell>;
  /** The page's own properties: the data of its root cell. */
  readonly data: Record<string, string>;
  private readonly kids = new Map<string, Cell[]>();
  private readonly styles = new Map<string, Style>();
  private readonly boxes = new Map<string, Box>();
  private readonly paths = new Map<string, Point[]>();

  constructor(page: Page) {
    this.name = page.name;
    this.cells = new Map(page.cells.map((cell) => [cell.id, cell]));
    this.data = this.cells.get("0")?.data ?? {};
    for (const cell of page.cells) {
      if (cell.parent === undefined) continue;
      const list = this.kids.get(cell.parent) ?? [];
      list.push(cell);
      this.kids.set(cell.parent, list);
    }
  }

  /** The cells inside a cell, in the order of the file (back to front). */
  children(id: string): Cell[] {
    return this.kids.get(id) ?? [];
  }

  /** Every cell below a cell, depth first. */
  descendants(id: string): Cell[] {
    return this.children(id).flatMap((cell) => [cell, ...this.descendants(cell.id)]);
  }

  /** Vertices and edges on the page: everything but the root and its layers. */
  get parts(): Cell[] {
    return [...this.cells.values()].filter((cell) => cell.vertex || cell.edge);
  }

  style(cell: Cell): Style {
    let style = this.styles.get(cell.id);
    if (!style) this.styles.set(cell.id, (style = parseStyle(cell.style)));
    return style;
  }

  /** A cell's label as text, lines separated by `\n`. */
  label(cell: Cell): string {
    const value = cell.value ?? "";
    return this.style(cell).get("html") === "1"
      ? htmlToText(value)
      : value.replace(/\r\n?/g, "\n").trim();
  }

  /** Whether a cell is a layer or the root: the cells everything else stands in. */
  isLayer(cell: Cell | undefined): boolean {
    return (
      !cell || cell.parent === undefined || cell.parent === "0" || (!cell.vertex && !cell.edge)
    );
  }

  /** The parent of a cell that is itself drawn: a vertex or an edge, not a layer. */
  parentOf(cell: Cell): Cell | undefined {
    const parent = cell.parent === undefined ? undefined : this.cells.get(cell.parent);
    return this.isLayer(parent) ? undefined : parent;
  }

  /** The origin a cell's coordinates are relative to: its parent vertex's corner, or the page's. */
  private origin(cell: Cell): Point {
    const parent = this.parentOf(cell);
    if (!parent?.vertex) return { x: 0, y: 0 };
    const box = this.box(parent);
    return { x: box.x, y: box.y };
  }

  /** A vertex's box on the page. */
  box(cell: Cell): Box {
    const known = this.boxes.get(cell.id);
    if (known) return known;
    // A cycle in the parents of a broken file ends here.
    this.boxes.set(cell.id, { x: 0, y: 0, width: 0, height: 0 });
    const geometry = cell.geometry ?? { x: 0, y: 0, width: 0, height: 0 };
    const parent = this.parentOf(cell);
    let box: Box;
    if (geometry.relative && parent?.edge) {
      // A mark on an edge: x along the edge from -1 to 1, y across it, then the offset; that is the
      // mark's corner (mxGraphView.getPoint).
      const along = this.along(this.path(parent), (geometry.x + 1) / 2);
      const offset = geometry.offset ?? { x: 0, y: 0 };
      box = {
        x: along.point.x + along.normal.x * geometry.y + offset.x,
        y: along.point.y + along.normal.y * geometry.y + offset.y,
        width: geometry.width,
        height: geometry.height,
      };
    } else if (geometry.relative && parent?.vertex) {
      const outer = this.box(parent),
        offset = geometry.offset ?? { x: 0, y: 0 };
      box = {
        x: outer.x + geometry.x * outer.width + offset.x,
        y: outer.y + geometry.y * outer.height + offset.y,
        width: geometry.width,
        height: geometry.height,
      };
    } else {
      const origin = this.origin(cell);
      box = {
        x: origin.x + geometry.x,
        y: origin.y + geometry.y,
        width: geometry.width,
        height: geometry.height,
      };
    }
    this.boxes.set(cell.id, box);
    return box;
  }

  /**
   * An edge's path on the page: its start, bends and end. A connected end is where the style pins it
   * (`exitX`, `entryY`, …); a floating one is where draw.io puts it: on the shape's outline, toward
   * the next point of the edge (its first bend, or the other end), straight across the shape for an
   * orthogonal edge when the next point lies within its span (mxPerimeter).
   */
  path(edge: Cell): Point[] {
    const known = this.paths.get(edge.id);
    if (known) return known;
    this.paths.set(edge.id, []);
    const geometry = edge.geometry ?? { x: 0, y: 0, width: 0, height: 0 };
    const origin = this.origin(edge);
    const shift = (p: Point) => ({ x: p.x + origin.x, y: p.y + origin.y });
    const bends = (geometry.points ?? []).map(shift);
    const style = this.style(edge);
    const orthogonal =
      isOn(style, "orthogonal") ||
      /^(orthogonal|elbow|entityRelation|segment|isometric)EdgeStyle$/.test(
        style.get("edgeStyle") ?? "",
      );
    const terminalOf = (id: string | undefined) => {
      const terminal = id ? this.cells.get(id) : undefined;
      return terminal?.vertex ? terminal : undefined;
    };
    /** An end that does not float: pinned to its shape, or loose on the page. */
    const fixed = (id: string | undefined, loose: Point | undefined, side: "exit" | "entry") => {
      const terminal = terminalOf(id);
      if (!terminal) return loose ? shift(loose) : undefined;
      const fx = style.get(`${side}X`),
        fy = style.get(`${side}Y`);
      if (fx === undefined || fy === undefined) return undefined;
      const box = this.box(terminal);
      return {
        x: box.x + Number(fx) * box.width + number(style.get(`${side}Dx`)),
        y: box.y + Number(fy) * box.height + number(style.get(`${side}Dy`)),
      };
    };
    const center = (id: string | undefined) => {
      const terminal = terminalOf(id);
      if (!terminal) return undefined;
      const box = this.box(terminal);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const pinnedStart = fixed(edge.source, geometry.sourcePoint, "exit"),
      pinnedEnd = fixed(edge.target, geometry.targetPoint, "entry");
    const edgeStyle = style.get("edgeStyle") ?? "";
    const boxOf = (id: string | undefined, pinned: Point | undefined) => {
      const terminal = terminalOf(id);
      return pinned
        ? { x: pinned.x, y: pinned.y, width: 0, height: 0 }
        : terminal && this.box(terminal);
    };
    const sourceBox = boxOf(edge.source, pinnedStart),
      targetBox = boxOf(edge.target, pinnedEnd);
    // An elbow edge without bends of its own bends where draw.io's elbow router puts them, and its
    // ends follow its bends; so do the ends of other edges, the target's after the source's.
    let routed = bends;
    if (!bends.length && edgeStyle === "elbowEdgeStyle" && sourceBox && targetBox)
      routed = elbow(sourceBox, targetBox, style.get("elbow") === "vertical");
    // draw.io's orthogonal router leaves a shape from the middle of a side; the others leave it
    // where the line toward the next point crosses its outline.
    const floating = (id: string | undefined, toward: Point | undefined) => {
      const terminal = terminalOf(id)!;
      const box = this.box(terminal);
      if (!toward) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      if (edgeStyle === "orthogonalEdgeStyle") return facing(box, toward);
      return perimeter(box, toward, shapeOf(this.style(terminal)), orthogonal);
    };
    const middle = (box: Box | undefined) =>
      box && { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const start =
      pinnedStart ??
      (terminalOf(edge.source)
        ? floating(edge.source, routed[0] ?? pinnedEnd ?? middle(targetBox))
        : undefined);
    const finish =
      pinnedEnd ??
      (terminalOf(edge.target)
        ? floating(edge.target, routed.at(-1) ?? start ?? middle(sourceBox))
        : undefined);
    // An orthogonal edge without bends of its own makes an L or a Z between its ends; between two
    // floating ends of shapes that share no span, draw.io leaves the source above or below and
    // makes one L into the side of the target.
    let ends = { start, finish };
    if (!bends.length && edgeStyle === "orthogonalEdgeStyle" && start && finish) {
      const apart =
        !pinnedStart &&
        !pinnedEnd &&
        sourceBox &&
        targetBox &&
        terminalOf(edge.source) &&
        terminalOf(edge.target) &&
        !sharesSpan(sourceBox, targetBox, "x") &&
        !sharesSpan(sourceBox, targetBox, "y");
      if (apart) {
        // The vertical leg stands at the upper shape: down out of the source's bottom into the
        // side of a target below it, or out of the source's side up into a target above.
        const s = sourceBox,
          t = targetBox;
        if (t.y > s.y) {
          const leave = { x: s.x + s.width / 2, y: s.y + s.height },
            enter = { x: t.x > s.x ? t.x : t.x + t.width, y: t.y + t.height / 2 };
          ends = { start: leave, finish: enter };
          routed = [{ x: leave.x, y: enter.y }];
        } else {
          const leave = { x: t.x > s.x ? s.x + s.width : s.x, y: s.y + s.height / 2 },
            enter = { x: t.x + t.width / 2, y: t.y + t.height };
          ends = { start: leave, finish: enter };
          routed = [{ x: enter.x, y: leave.y }];
        }
      } else routed = route(start, finish, sourceBox, targetBox);
    }
    const path = [
      ...(ends.start ? [ends.start] : []),
      ...routed,
      ...(ends.finish ? [ends.finish] : []),
    ];
    this.paths.set(edge.id, path);
    return path;
  }

  /** The point at a share (0 to 1) of a path's length, and the normal draw.io moves a label along with its y. */
  along(path: Point[], share: number): { point: Point; normal: Point } {
    if (path.length < 2) return { point: path[0] ?? { x: 0, y: 0 }, normal: { x: 0, y: -1 } };
    const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
    let left = Math.max(0, Math.min(1, share)) * lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
      if (left <= lengths[i] || i === lengths.length - 1) {
        const a = path[i],
          b = path[i + 1],
          length = lengths[i] || 1,
          t = Math.min(1, left / length);
        const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
        return {
          point: { x: a.x + d.x * t * length, y: a.y + d.y * t * length },
          normal: { x: d.y, y: -d.x },
        };
      }
      left -= lengths[i];
    }
    return { point: path.at(-1)!, normal: { x: 0, y: -1 } };
  }
}

/** The middle of the side of a box that faces a point. */
function facing(box: Box, toward: Point): Point {
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const dx = (toward.x - cx) / (box.width || 1),
    dy = (toward.y - cy) / (box.height || 1);
  return sideMiddle(box, toward, Math.abs(dy) > Math.abs(dx));
}

/** The middle of the top or bottom side (`vertical`) or of the left or right side toward a point. */
function sideMiddle(box: Box, toward: Point, vertical: boolean): Point {
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  return vertical
    ? { x: cx, y: toward.y < cy ? box.y : box.y + box.height }
    : { x: toward.x < cx ? box.x : box.x + box.width, y: cy };
}

/** Whether two boxes overlap along an axis: they share a span of x or of y. */
const sharesSpan = (a: Box, b: Box, axis: "x" | "y") => {
  const size = axis === "x" ? "width" : "height";
  return Math.min(a[axis] + a[size], b[axis] + b[size]) > Math.max(a[axis], b[axis]);
};

/** The side of a box a point lies on: whether an edge leaves it across (left, right) or along. */
function across(box: Box | undefined, point: Point): boolean | undefined {
  if (!box) return undefined;
  const left = Math.abs(point.x - box.x),
    right = Math.abs(point.x - box.x - box.width),
    top = Math.abs(point.y - box.y),
    bottom = Math.abs(point.y - box.y - box.height);
  return Math.min(left, right) < Math.min(top, bottom);
}

/**
 * The bends of an orthogonal edge without bends of its own between two points: an L from the side
 * it leaves to the side it enters, or a Z halfway when both are sides of one kind.
 */
function route(start: Point, end: Point, from: Box | undefined, to: Box | undefined): Point[] {
  if (Math.abs(start.x - end.x) < 0.5 || Math.abs(start.y - end.y) < 0.5) return [];
  const leaves = across(from, start) ?? true,
    enters = across(to, end) ?? leaves;
  if (leaves && enters) {
    const x = (start.x + end.x) / 2;
    return [
      { x, y: start.y },
      { x, y: end.y },
    ];
  }
  if (!leaves && !enters) {
    const y = (start.y + end.y) / 2;
    return [
      { x: start.x, y },
      { x: end.x, y },
    ];
  }
  return [leaves ? { x: end.x, y: start.y } : { x: start.x, y: end.y }];
}

/**
 * The bends of an elbow edge between two boxes, as draw.io's elbow router puts them
 * (mxEdgeStyle.SideToSide, and TopToBottom for `elbow=vertical`): halfway across the gap between
 * the boxes, at the height (or the x) of each box's middle. A bend that falls inside a box is left
 * out; where fewer than two are left, one stands in the middle of the span between the boxes.
 */
function elbow(from: Box, to: Box, vertical: boolean): Point[] {
  const inside = (box: Box, point: Point) =>
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height;
  const outside = (point: Point) => !inside(from, point) && !inside(to, point);
  /** The middle of the gap between the boxes along an axis, or of the span they share. */
  const middle = (axis: "x" | "y") => {
    const size = axis === "x" ? "width" : "height";
    const low = Math.max(from[axis], to[axis]),
      high = Math.min(from[axis] + from[size], to[axis] + to[size]);
    return high + (low - high) / 2;
  };
  if (vertical) {
    const y = middle("y");
    const points = [
      { x: from.x + from.width / 2, y },
      { x: to.x + to.width / 2, y },
    ].filter(outside);
    if (points.length < 2) {
      const extra = { x: middle("x"), y };
      if (outside(extra) && !points.some((point) => point.x === extra.x)) points.push(extra);
    }
    return points;
  }
  const x = middle("x");
  const points = [
    { x, y: from.y + from.height / 2 },
    { x, y: to.y + to.height / 2 },
  ].filter(outside);
  if (points.length < 2) {
    const extra = { x, y: middle("y") };
    if (outside(extra) && !points.some((point) => point.y === extra.y)) points.push(extra);
  }
  return points;
}

/**
 * Where an edge toward `next` leaves a shape, as draw.io's perimeters put it: on an ellipse or a
 * rhombus along the line from the middle, on a rectangle too, and for an orthogonal edge straight
 * across when `next` lies within the shape's span (mxPerimeter.RectanglePerimeter).
 */
function perimeter(box: Box, next: Point, shape: string, orthogonal: boolean): Point {
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const dx = next.x - cx,
    dy = next.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  if (shape === "ellipse" || shape === "doubleEllipse" || shape === "rhombus") {
    const a = box.width / 2 || 1,
      b = box.height / 2 || 1;
    const t =
      shape === "rhombus"
        ? 1 / (Math.abs(dx) / a + Math.abs(dy) / b)
        : 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
    return { x: exact(cx + dx * t), y: exact(cy + dy * t) };
  }
  const alpha = Math.atan2(dy, dx),
    t = Math.atan2(box.height, box.width);
  const point =
    alpha < -Math.PI + t || alpha > Math.PI - t
      ? { x: box.x, y: cy - (box.width * Math.tan(alpha)) / 2 }
      : alpha < -t
        ? { x: cx - box.height / (2 * Math.tan(alpha)), y: box.y }
        : alpha < t
          ? { x: box.x + box.width, y: cy + (box.width * Math.tan(alpha)) / 2 }
          : { x: cx + box.height / (2 * Math.tan(alpha)), y: box.y + box.height };
  if (orthogonal) {
    if (next.x >= box.x && next.x <= box.x + box.width) point.x = next.x;
    else if (next.y >= box.y && next.y <= box.y + box.height) point.y = next.y;
    if (next.x < box.x) point.x = box.x;
    else if (next.x > box.x + box.width) point.x = box.x + box.width;
    if (next.y < box.y) point.y = box.y;
    else if (next.y > box.y + box.height) point.y = box.y + box.height;
  }
  return { x: exact(point.x), y: exact(point.y) };
}

/** A coordinate without the dust of floating point. */
const exact = (value: number) => Math.round(value * 1e6) / 1e6;
