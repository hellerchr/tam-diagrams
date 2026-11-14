/**
 * tam-diagrams: SAP TAM block diagrams (```tam) and the UML class, use case, activity, state machine
 * and sequence diagrams of Mermaid, laid out with ELK and drawn as standalone SVG in one style.
 * Depends only on elkjs. See README.md.
 */
import { cachedLayout } from "./best.ts";
import type { ElkLayout } from "./elk.ts";
import { type DiagramColors, drawScene } from "./draw.ts";
import { type Measure, textMeasure } from "./text.ts";
import { type Scene } from "./scene.ts";
import { detectUml, UmlError, type UmlKind } from "./uml.ts";
import { rejectUnsupported } from "./uml-header.ts";
import { layoutStateDiagram } from "./uml-state-layout.ts";
import { parseStateDiagram } from "./uml-state.ts";
import { parseFlowchart } from "./uml-activity.ts";
import { layoutFlowchart } from "./uml-activity-layout.ts";
import { layoutSwimlanes } from "./uml-swimlanes.ts";
import { layoutSequenceDiagram } from "./uml-sequence-layout.ts";
import { parseSequenceDiagram } from "./uml-sequence.ts";
import {
  type ClassDiagram,
  type ClassView,
  foldClassDiagram,
  overview,
  parseClassDiagram,
} from "./uml-class.ts";
import { layoutClassDiagram } from "./uml-class-layout.ts";
import { parseUseCaseDiagram } from "./uml-usecase.ts";
import { layoutUseCaseDiagram } from "./uml-usecase-layout.ts";

export { parseTam, TamError, type TamDiagram } from "./tam.ts";
export { renderTam, type TamPicture } from "./tam-layout.ts";
export { detectUml, UmlError, type UmlKind } from "./uml.ts";
export { drawScene, type DiagramColors } from "./draw.ts";
export { textMeasure, type Measure } from "./text.ts";
export { arialMeasure } from "./arial-measure.ts";
export { type Scene } from "./scene.ts";
export { auditScene, type Finding } from "./audit.ts";
export { measureScene, type Metrics } from "./best.ts";
export { bundledElk, elkWorkerPool, type ElkLayout } from "./elk.ts";
export {
  classPartAt,
  classPartBox,
  overview,
  toggleClassPart,
  type ClassDiagram,
  type ClassPart,
  type ClassView,
} from "./uml-class.ts";

/** A rendered SVG as an image source; SVG is shown in an image context, never inserted into the page. */
export const svgUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/*
 * The UML diagram types of Mermaid this package draws in the style of TAM block diagrams: class, use
 * case, activity (flowchart, swimlane), state machine and sequence diagrams. Other sources raise an
 * `unsupported` UmlError so the caller can fall back to Mermaid.js.
 */

export interface UmlPicture {
  svg: string;
  width: number;
  height: number;
  description: string;
  scene: Scene;
  kind: UmlKind;
}

/** A parsed UML source, ready to lay out. */
export interface ParsedUml {
  kind: UmlKind;
  title?: string;
  layout(measure: Measure, layout?: ElkLayout): Promise<Scene>;
}

/** What each diagram type is called: the SVG's description when the source has no title. */
const UML_NAMES: Record<UmlKind, string> = {
  class: "Class diagram",
  state: "State machine diagram",
  flowchart: "Activity diagram",
  swimlane: "Activity diagram",
  usecase: "Use case diagram",
  sequence: "Sequence diagram",
};

/** Parses a source of any supported type; throws UmlError on errors and on unsupported syntax. */
export function parseUml(source: string): ParsedUml {
  const kind = detectUml(source);
  switch (kind) {
    case "class": {
      const diagram = parseClassDiagram(source);
      return {
        kind,
        title: diagram.title,
        layout: (measure, layout) => layoutClassDiagram(diagram, measure, { layout }),
      };
    }
    case "usecase": {
      const diagram = parseUseCaseDiagram(source);
      return {
        kind,
        title: diagram.title,
        layout: (measure) => layoutUseCaseDiagram(diagram, measure),
      };
    }
    case "state": {
      const diagram = parseStateDiagram(source);
      return {
        kind,
        title: diagram.title,
        layout: (measure, layout) => layoutStateDiagram(diagram, measure, { layout }),
      };
    }
    case "sequence": {
      const diagram = parseSequenceDiagram(source);
      return {
        kind,
        title: diagram.title,
        layout: (measure) => layoutSequenceDiagram(diagram, measure),
      };
    }
    case "swimlane": {
      const chart = parseFlowchart(source);
      return { kind, title: chart.title, layout: (measure) => layoutSwimlanes(chart, measure) };
    }
    case "flowchart": {
      const chart = parseFlowchart(source);
      return {
        kind,
        title: chart.title,
        layout: (measure, layout) => layoutFlowchart(chart, measure, { layout }),
      };
    }
    case null:
      rejectUnsupported(source);
      throw new UmlError(
        0,
        "This diagram type is drawn by Mermaid, not the built-in renderer.",
        true,
      );
  }
}

/** A laid-out scene drawn as a picture: the SVG, its size and description. */
function picture(scene: Scene, colors: DiagramColors, description: string, kind: UmlKind) {
  return {
    svg: drawScene(scene, colors, description, `${kind} diagram`),
    width: scene.bounds.width,
    height: scene.bounds.height,
    description,
    scene,
    kind,
  };
}

/**
 * Lays out and draws a UML source. `measure` replaces the canvas text metrics (tests); such layouts
 * are not cached.
 */
export async function renderUml(
  source: string,
  colors: DiagramColors,
  options: { layout?: ElkLayout; measure?: Measure } = {},
): Promise<UmlPicture> {
  const parsed = parseUml(source);
  const scene = await (options.measure
    ? parsed.layout(options.measure, options.layout)
    : cachedLayout(`uml\u0000${colors.font}\u0000${source}`, () =>
        parsed.layout(textMeasure(colors.font), options.layout),
      ));
  return picture(scene, colors, parsed.title || UML_NAMES[parsed.kind], parsed.kind);
}

/** A class diagram drawn in one view of an interactive viewer, with what hit tests need. */
export interface ClassPicture extends UmlPicture {
  /** The diagram as drawn: collapsed packages folded into single classes. */
  diagram: ClassDiagram;
  view: ClassView;
  /** Classes and packages of the whole source, for "show all". */
  all: ClassView;
}

/**
 * A class diagram with some packages collapsed and some classes without members (`view`; by
 * default the overview of a large diagram). Layouts are cached per source and view. `measure`
 * replaces the canvas text metrics (Node); such layouts are not cached.
 */
export async function renderClassView(
  source: string,
  colors: DiagramColors,
  view: ClassView | null,
  options: { layout?: ElkLayout; measure?: Measure } = {},
): Promise<ClassPicture> {
  const full = parseClassDiagram(source);
  const shown = view ?? overview(full);
  const diagram = foldClassDiagram(full, shown);
  const key = [
    "uml-class-view",
    colors.font,
    source,
    [...shown.collapsed].sort().join(","),
    [...shown.bare].sort().join(","),
  ].join("\u0000");
  const scene = await (options.measure
    ? layoutClassDiagram(diagram, options.measure, { layout: options.layout })
    : cachedLayout(key, () =>
        layoutClassDiagram(diagram, textMeasure(colors.font), { layout: options.layout }),
      ));
  return {
    ...picture(scene, colors, full.title || UML_NAMES.class, "class"),
    diagram,
    view: shown,
    all: { collapsed: new Set(), bare: new Set() },
  };
}
