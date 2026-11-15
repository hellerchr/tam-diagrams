/**
 * The document an editor works on: a TAM source, the picture laid out from it, and its history.
 * The source is the only state; every edit is a new source.
 */

import { drawScene, type DiagramColors } from "../src/draw.ts";
import type { ElkLayout } from "../src/elk.ts";
import type { Scene } from "../src/scene.ts";
import { isPlaced, parseTam, TamError, type TamDiagram } from "../src/tam.ts";
import { bestLayout, layoutPlaced } from "../src/tam-layout.ts";
import { layoutWithin, overlapping, pin } from "../src/tam-pin.ts";
import type { Measure } from "../src/text.ts";
import { parseUml } from "../src/index.ts";
import { UmlError } from "../src/uml.ts";
import { type Flowchart, parseFlowchart } from "../src/uml-activity.ts";
import { type DiagramType, typeInfo, typeOf } from "./types.ts";

/** A source laid out: the parsed diagram and the scene drawn from it. */
export interface Picture {
  source: string;
  diagram: TamDiagram;
  scene: Scene;
  /** Whether the source places its elements; else the layout is automatic. */
  placed: boolean;
  /** Elements that lie on each other, which the notation does not allow: pairs of shape ids. */
  overlaps: [string, string][];
  /** What the source draws: a block diagram, edited on the canvas, or a UML diagram, edited as text. */
  type: DiagramType;
  /** The title the source gives the diagram. */
  title?: string;
}

/** A UML picture holds no block diagram: nothing in it is an element to select or move. */
const NO_DIAGRAM = (): TamDiagram => ({ direction: "TB", nodes: new Map(), roots: [], edges: [] });

/** Why a source shows no picture: the message, and the line it is about (0 for the whole source). */
export interface Problem {
  line: number;
  message: string;
}

const problemOf = (reason: unknown): Problem =>
  reason instanceof TamError || reason instanceof UmlError
    ? { line: reason.line, message: reason.message }
    : { line: 0, message: reason instanceof Error ? reason.message : String(reason) };

/**
 * An activity diagram as the editor sees every diagram: elements by id, what holds them, and the
 * connections between them, so that selecting, the tree and the highlights work on it as on a
 * block diagram. Nodes stand in as agents, subgraphs and lanes as groups.
 */
function flowDiagram(chart: Flowchart): TamDiagram {
  const diagram = NO_DIAGRAM();
  const add = (
    id: string,
    kind: "agent" | "group",
    label: string,
    parent: string | null,
    line: number,
  ) => diagram.nodes.set(id, { id, kind, label, parent, children: [], stack: false, line });
  for (const group of chart.subgraphs.values())
    add(group.id, "group", group.label, group.parent, group.line);
  for (const node of chart.nodes.values())
    add(node.id, "agent", node.label, node.parent, node.line);
  for (const id of chart.order) {
    const node = diagram.nodes.get(id);
    if (!node) continue;
    if (node.parent && diagram.nodes.has(node.parent))
      diagram.nodes.get(node.parent)!.children.push(id);
    else diagram.roots.push(id);
  }
  for (const edge of chart.edges)
    diagram.edges.push({
      id: edge.id,
      kind: "channel",
      source: edge.source,
      target: edge.target,
      label: edge.label,
      line: edge.line,
    });
  return diagram;
}

/** The most steps that can be undone. */
const HISTORY = 300;

export class Doc {
  /** The source as committed: what is saved, and what undo steps back from. */
  source = "";
  /** The picture on show: of the committed source, or of a preview while a gesture runs. */
  picture: Picture | undefined;
  /** Set while the committed source does not parse; the picture is then the last good one. */
  problem: Problem | undefined;
  /** Called whenever the source, the picture or the problem changed. */
  onChange: () => void = () => {};
  private undone: string[] = [];
  private redone: string[] = [];
  private run = 0;
  private readonly measure: Measure;
  private readonly elk: ElkLayout | undefined;

  constructor(measure: Measure, elk?: ElkLayout) {
    this.measure = measure;
    this.elk = elk;
  }

  /** A source laid out without waiting, which only placed sources allow; throws what the parser throws. */
  layout(source: string): Picture {
    const diagram = parseTam(source);
    const scene = layoutPlaced(diagram, this.measure);
    return {
      source,
      diagram,
      scene,
      placed: true,
      overlaps: overlapping(diagram, scene),
      type: "tam",
      title: diagram.title,
    };
  }

  /** Shows a source's picture: at once when it is placed, after the automatic layout else. */
  private async show(source: string): Promise<void> {
    const run = ++this.run;
    try {
      const type = typeOf(source);
      if (type !== "tam") {
        // A UML source: parsed and laid out by its own type; the picture is to look at.
        const parsed = parseUml(source);
        // An activity diagram's nodes and edges are selected and changed on the canvas.
        const diagram =
          type === "flowchart" || type === "swimlane"
            ? flowDiagram(parseFlowchart(source))
            : NO_DIAGRAM();
        this.problem = undefined;
        this.onChange();
        const scene = await parsed.layout(this.measure, this.elk);
        if (run !== this.run) return;
        this.picture = {
          source,
          diagram,
          scene,
          placed: false,
          overlaps: [],
          type: parsed.kind,
          title: parsed.title,
        };
        this.onChange();
        return;
      }
      const diagram = parseTam(source);
      this.problem = undefined;
      if (isPlaced(diagram) || !diagram.nodes.size) {
        this.picture = this.layout(source);
        this.onChange();
        return;
      }
      // The source shows at once, the picture when it is laid out; a later edit overtakes this one.
      this.onChange();
      const scene = await bestLayout(diagram, this.measure, this.elk);
      if (run !== this.run) return;
      this.picture = {
        source,
        diagram,
        scene,
        placed: false,
        overlaps: [],
        type: "tam",
        title: diagram.title,
      };
    } catch (reason) {
      if (run !== this.run) return;
      this.problem = problemOf(reason);
    }
    this.onChange();
  }

  /** Replaces the source; the step can be undone. A source that does not parse is kept as text. */
  apply(source: string): Promise<void> {
    if (source === this.source) return this.show(source);
    this.undone.push(this.source);
    if (this.undone.length > HISTORY) this.undone.shift();
    this.redone = [];
    this.source = source;
    return this.show(source);
  }

  /** Replaces the source when it parses and says why not else; for edits made on the canvas. */
  tryApply(source: string): Problem | undefined {
    try {
      parseTam(source);
    } catch (reason) {
      return problemOf(reason);
    }
    void this.apply(source);
    return undefined;
  }

  /** Starts over with another source: no history. */
  open(source: string): Promise<void> {
    this.undone = [];
    this.redone = [];
    this.source = source;
    this.picture = undefined;
    return this.show(source);
  }

  /** Shows a placed source without committing it: the state of a gesture under way. False when it does not parse. */
  preview(source: string): boolean {
    try {
      this.picture = this.layout(source);
    } catch {
      return false;
    }
    this.run++;
    this.onChange();
    return true;
  }

  /** Ends a preview without committing it. */
  cancel() {
    void this.show(this.source);
  }

  get canUndo() {
    return this.undone.length > 0;
  }

  get canRedo() {
    return this.redone.length > 0;
  }

  undo() {
    const source = this.undone.pop();
    if (source === undefined) return;
    this.redone.push(this.source);
    this.source = source;
    void this.show(source);
  }

  redo() {
    const source = this.redone.pop();
    if (source === undefined) return;
    this.undone.push(this.source);
    this.source = source;
    void this.show(source);
  }

  /**
   * The committed source with every element placed where the picture shows it: what a gesture on
   * the canvas starts from. Undefined while there is no picture of the committed source.
   */
  placedSource(): string | undefined {
    const { picture } = this;
    if (this.problem || !picture || picture.source !== this.source || picture.type !== "tam")
      return undefined;
    if (picture.placed && allPlaced(picture.diagram)) return this.source;
    return pin(this.source, picture.scene, this.measure);
  }

  /** Lays some elements of the placed source out automatically among themselves: see `layoutWithin`. */
  layoutWithin(source: string, ids: string[]): Promise<string> {
    return layoutWithin(source, ids, this.measure, this.elk);
  }

  /**
   * A source drawn as a standalone SVG without becoming the document: the small pictures the
   * chooser of diagram types shows. Undefined when the source does not parse.
   */
  async sketch(source: string, colors: DiagramColors): Promise<string | undefined> {
    try {
      const type = typeOf(source);
      if (type !== "tam") {
        const scene = await parseUml(source).layout(this.measure, this.elk);
        return drawScene(scene, colors, typeInfo(type).name, `${type} diagram`);
      }
      const diagram = parseTam(source);
      const scene = isPlaced(diagram)
        ? layoutPlaced(diagram, this.measure)
        : await bestLayout(diagram, this.measure, this.elk);
      return drawScene(scene, colors, typeInfo(type).name, "tam");
    } catch {
      return undefined;
    }
  }

  /** The picture as a standalone SVG. */
  svg(colors: DiagramColors): string | undefined {
    const { picture } = this;
    return (
      picture &&
      drawScene(
        picture.scene,
        colors,
        picture.title || typeInfo(picture.type).name,
        picture.type === "tam" ? "tam" : `${picture.type} diagram`,
      )
    );
  }
}

/** Whether the source places every element it declares, so none is left to the rows below the others. */
function allPlaced(diagram: TamDiagram): boolean {
  for (const node of diagram.nodes.values()) {
    if (node.id.endsWith("#row") || ["dots", "interface", "channel"].includes(node.kind)) continue;
    // A copy stands beside its original when the source does not place it.
    if (node.origin && node.origin !== node.id) continue;
    if (!node.at && !node.children.length) return false;
  }
  return true;
}
