/**
 * Diagrams as draw.io files and back. A diagram is exported as it is laid out, drawn with the shapes
 * of the TAMshapes libraries (drawio-shapes.ts); a draw.io page is imported as a source that places
 * every part where the page shows it, so the layout made in draw.io survives. The file format is
 * drawio-file.ts; each diagram type has a module of its own: TAM block diagrams, activity diagrams
 * (flowchart and swimlane), state machine diagrams and sequence diagrams.
 */

import type { ElkLayout } from "./elk.ts";
import {
  type Cell,
  Drawing,
  DrawioError,
  formatStyle,
  LAYER,
  parseStyle,
  type Page,
  readDrawio,
  writeDrawio,
} from "./drawio-file.ts";
import { activityDrawio } from "./drawio-activity.ts";
import { sequenceDrawio } from "./drawio-sequence.ts";
import { stateDrawio } from "./drawio-state.ts";
import { tamDrawio } from "./drawio-tam.ts";
import { parseUml } from "./index.ts";
import type { Scene } from "./scene.ts";
import { parseTam } from "./tam.ts";
import { layoutDiagram } from "./tam-layout.ts";
import { type Measure, textMeasure } from "./text.ts";
import { detectUml } from "./uml.ts";

export { DrawioError, isDrawio } from "./drawio-file.ts";

/** The diagram types a draw.io file carries: TAM block diagrams and the UML types with TAM shapes. */
export type DrawioKind = "tam" | "flowchart" | "swimlane" | "state" | "sequence";

/** A diagram read from a draw.io page. */
export interface Imported {
  /** The source, every part placed where the page shows it. */
  source: string;
  kind: DrawioKind;
  /** What on the page has no place in the diagram, or was guessed: one sentence each. */
  warnings: string[];
}

/** What a diagram type does with draw.io pages. */
export interface DrawioType {
  kinds: DrawioKind[];
  /**
   * The cells that draw a source as `scene` lays it out, without the root and the layer: cells at
   * the top stand in the layer `LAYER`. Every cell carries `tam=<role>` in its style. A cell with
   * the id "0" gives the page properties of its own (`data`).
   */
  cells(source: string, scene: Scene): Cell[];
  /** How much a page looks like a diagram of this type: 0 when it cannot be one, more the likelier. */
  likeness(drawing: Drawing): number;
  /** The source a page draws; throws DrawioError when the page holds nothing of the type. */
  read(drawing: Drawing): Imported;
}

const TYPES: DrawioType[] = [tamDrawio, activityDrawio, stateDrawio, sequenceDrawio];

const typeOf = (kind: DrawioKind) => TYPES.find((type) => type.kinds.includes(kind))!;

/** What a type is called in a message. */
const NAMES: Record<DrawioKind, string> = {
  tam: "TAM block diagram",
  flowchart: "Activity diagram",
  swimlane: "Activity diagram",
  state: "State machine diagram",
  sequence: "Sequence diagram",
};

/** The kind of a source, if draw.io files carry it; throws DrawioError for the other types. */
function drawioKind(source: string): DrawioKind {
  const uml = detectUml(source);
  if (!uml) return "tam";
  if (uml === "flowchart" || uml === "swimlane" || uml === "state" || uml === "sequence")
    return uml;
  throw new DrawioError(
    "draw.io files carry TAM block diagrams, activity diagrams, state machine diagrams and sequence diagrams.",
  );
}

/** Whether a source is of a type draw.io files carry. */
export const exportsToDrawio = (source: string) => {
  try {
    drawioKind(source);
    return true;
  } catch {
    return false;
  }
};

export interface ExportOptions {
  /** The layout to draw, when the caller has one: the editor's picture. Without it the source is laid out. */
  scene?: Scene;
  /** Text metrics for the layout: arialMeasure in Node. */
  measure?: Measure;
  /** Connections bend round at their corners in draw.io; square corners without it. */
  rounded?: boolean;
  layout?: ElkLayout;
}

/** A connection's style with its corners set; a new key goes before the role, which stays last. */
function withCorners(style: string, corners: string): string {
  const parsed = parseStyle(style);
  if (parsed.has("rounded")) return formatStyle(parsed.set("rounded", corners));
  const entries = [...parsed],
    role = entries.findIndex(([key]) => key === "tam");
  entries.splice(role < 0 ? entries.length : role, 0, ["rounded", corners]);
  return formatStyle(new Map(entries));
}

/** The title of a source, for the page's name. */
function titleOf(source: string, kind: DrawioKind): string | undefined {
  try {
    return kind === "tam" ? parseTam(source).title : parseUml(source).title;
  } catch {
    return undefined;
  }
}

/**
 * A diagram as a draw.io file: one page, named after the title, that draws the diagram as it is laid
 * out. Throws the diagram's own error for a source that does not parse, DrawioError for a type
 * draw.io files do not carry.
 */
export async function exportDrawio(source: string, options: ExportOptions = {}): Promise<string> {
  const kind = drawioKind(source);
  const measure = options.measure ?? textMeasure("system-ui");
  const scene =
    options.scene ??
    (kind === "tam"
      ? await layoutDiagram(parseTam(source), measure, options.layout)
      : await parseUml(source).layout(measure, options.layout));
  // Every connection takes the corners asked for, whatever its type draws it with.
  const corners = options.rounded ? "1" : "0";
  const cells = typeOf(kind)
    .cells(source, scene)
    .map((item) =>
      item.edge && item.style !== undefined
        ? { ...item, style: withCorners(item.style, corners) }
        : item,
    );
  // A type may give the page properties of its own on a root cell of its cells.
  const own = cells.find((item) => item.id === "0");
  const page: Page = {
    name: titleOf(source, kind) || NAMES[kind],
    cells: [
      { id: "0", data: { tamDiagram: kind, ...own?.data } },
      { id: LAYER, parent: "0" },
      ...cells.filter((item) => item !== own),
    ],
  };
  return writeDrawio([page]);
}

export interface ImportOptions {
  /** The page to read: its index or name. The first page by default. */
  page?: number | string;
  /** The type to read the page as; by default the page says, or else the type it looks most like. */
  kind?: DrawioKind;
}

/**
 * The diagram on a page of a draw.io file, as a source that places its parts as the page does.
 * Throws DrawioError for a file that is no draw.io diagram or a page with nothing to read.
 */
export async function importDrawio(text: string, options: ImportOptions = {}): Promise<Imported> {
  const page = pageOf(await readDrawio(text), options.page);
  const drawing = new Drawing(page);
  if (!drawing.parts.length) throw new DrawioError(`The page “${page.name}” is empty.`);
  const said = drawing.data.tamDiagram as DrawioKind | undefined;
  const kind = options.kind ?? (said && said in NAMES ? said : undefined);
  return (kind ? typeOf(kind) : likeliest(drawing)).read(drawing);
}

/** The page asked for, by its index or its name; the first by default. */
function pageOf(pages: Page[], wanted: number | string | undefined): Page {
  const page =
    typeof wanted === "string" ? pages.find((item) => item.name === wanted) : pages[wanted ?? 0];
  if (!page) throw new DrawioError(`The file has no page ${JSON.stringify(wanted)}.`);
  return page;
}

/** The type a page that does not say looks most like. */
function likeliest(drawing: Drawing): DrawioType {
  const scored = TYPES.map((type) => ({ type, score: type.likeness(drawing) })).toSorted(
    (a, b) => b.score - a.score,
  );
  if (!scored[0].score)
    throw new DrawioError(
      `Nothing on the page “${drawing.name}” reads as a TAM block, activity, state machine or sequence diagram.`,
    );
  return scored[0].type;
}
