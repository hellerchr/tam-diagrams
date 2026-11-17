/**
 * The document an editor works on: a TAM source, the picture laid out from it, and its history.
 * The source is the only state; every edit is a new source.
 */

import { drawScene, type DiagramColors } from "../src/draw.ts";
import type { ElkLayout } from "../src/elk.ts";
import { overlaps, type Scene } from "../src/scene.ts";
import { isPlaced, parseTam, TamError, type TamDiagram } from "../src/tam.ts";
import { bestLayout, layoutPlaced } from "../src/tam-layout.ts";
import { layoutWithin, overlapping, pin } from "../src/tam-pin.ts";
import type { Measure } from "../src/text.ts";
import { parseUml, umlRole } from "../src/index.ts";
import { UmlError } from "../src/uml.ts";
import { keepAutomatic, placesOf } from "../src/uml-placed.ts";
import { hasPlaces, prunePlaces, setPlaces } from "../src/uml-places.ts";
import type { StructureEdge, StructureNode } from "../src/structure.ts";
import { structureOf } from "./structures.ts";
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
  /** In a diagram with a structure: its parts and joins by id, with the kinds they are. */
  parts?: Map<string, StructureNode>;
  joins?: Map<string, StructureEdge>;
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
 * A diagram with a structure as the editor sees every diagram: elements by id, what holds them,
 * and the connections between them, so that selecting, the tree and the highlights work on it as
 * on a block diagram. Parts stand in as agents, groups as groups.
 */
function structureDiagram(nodes: StructureNode[], edges: StructureEdge[]): TamDiagram {
  const diagram = NO_DIAGRAM();
  for (const node of nodes)
    diagram.nodes.set(node.id, {
      id: node.id,
      kind: node.group ? "group" : "agent",
      label: node.label,
      parent: node.parent,
      children: [],
      stack: false,
      line: node.line,
    });
  for (const node of nodes) {
    const parent = node.parent ? diagram.nodes.get(node.parent) : undefined;
    if (parent) parent.children.push(node.id);
    else diagram.roots.push(node.id);
  }
  for (const edge of edges)
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

/** The parts of a scene placed by hand that lie on each other: pairs of shape ids. */
function lyingOn(scene: Scene): [string, string][] {
  const parts = scene.shapes.filter(
    (shape) => !shape.container && !shape.passable && shape.kind !== "region",
  );
  return parts.flatMap((a, index) =>
    parts
      .slice(index + 1)
      .filter((b) => overlaps(a.box, b.box, 0.5))
      .map((b): [string, string] => [a.id, b.id]),
  );
}

/** Steps of one run made within this many milliseconds of each other are undone together. */
const RUN = 1200;

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
  /** The picture of a UML source shown last that was no preview: what cancelling a preview returns to. */
  private shown: Picture | undefined;
  /** The run the last step belonged to, and when it was made. */
  private lastRun: string | undefined;
  private lastTime = 0;
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

  /**
   * The picture of a UML source: parsed and laid out by its own type, with the parts and joins of
   * its structure, which are selected and changed on the canvas. Throws what the parser throws;
   * `ready` is called once the source is known to parse, before the layout.
   */
  private async umlPicture(source: string, ready: () => void = () => {}): Promise<Picture> {
    const type = typeOf(source),
      parsed = parseUml(source);
    const structure = structureOf(type)?.read(source),
      diagram = structure ? structureDiagram(structure.nodes, structure.edges) : NO_DIAGRAM();
    ready();
    const scene = await parsed.layout(this.measure, this.elk),
      placed = hasPlaces(source);
    // Its parts are moved from where the automatic layout shows them.
    if (!placed && structure) keepAutomatic(source, this.measure, scene);
    return {
      source,
      diagram,
      scene,
      placed,
      overlaps: placed ? lyingOn(scene) : [],
      type: parsed.kind,
      title: parsed.title,
      parts: new Map(structure?.nodes.map((node) => [node.id, node])),
      joins: new Map(structure?.edges.map((edge) => [edge.id, edge])),
    };
  }

  /** Shows a source's picture: at once when it is placed, after the automatic layout else. */
  private async show(source: string): Promise<void> {
    const run = ++this.run;
    try {
      const type = typeOf(source);
      if (type !== "tam") {
        const picture = await this.umlPicture(source, () => {
          this.problem = undefined;
          this.onChange();
        });
        if (run !== this.run) return;
        this.picture = picture;
        this.shown = picture;
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
  apply(source: string, run?: string): Promise<void> {
    if (source === this.source) return this.show(source);
    // Steps of one run made in quick succession, such as presses of an arrow key, are one step.
    const now = performance.now(),
      joined = !!run && run === this.lastRun && now - this.lastTime < RUN;
    this.lastRun = run;
    this.lastTime = now;
    if (!joined) this.undone.push(this.source);
    if (this.undone.length > HISTORY) this.undone.shift();
    this.redone = [];
    this.source = source;
    return this.show(source);
  }

  /** Replaces the source when it parses and says why not else; for edits made on the canvas. */
  tryApply(source: string, run?: string): Problem | undefined {
    try {
      parseTam(source);
    } catch (reason) {
      return problemOf(reason);
    }
    void this.apply(source, run);
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
    if (typeOf(source) !== "tam") return this.previewUml(source);
    try {
      this.picture = this.layout(source);
    } catch {
      return false;
    }
    this.run++;
    this.onChange();
    return true;
  }

  /**
   * Shows a placed UML source without committing it. Its picture comes a moment later: the layout
   * by hand starts from the automatic scene that is kept, so it waits for no layout engine.
   */
  private previewUml(source: string): boolean {
    try {
      parseUml(source);
    } catch {
      return false;
    }
    const run = ++this.run;
    void this.umlPicture(source).then(
      (picture) => {
        if (run !== this.run) return;
        this.picture = picture;
        this.onChange();
      },
      () => {},
    );
    return true;
  }

  /**
   * Shows the picture on show with another scene, without committing anything: a drag that changes
   * only where something is drawn, such as a label, shows at once without a layout.
   */
  previewScene(scene: Scene) {
    if (!this.picture) return;
    this.run++;
    this.picture = { ...this.picture, scene };
    this.onChange();
  }

  /** Ends a preview without committing it. */
  cancel() {
    // The picture of the committed source is at hand unless the source changed since.
    if (this.shown?.source === this.source && !this.problem) {
      this.run++;
      this.picture = this.shown;
      this.onChange();
    } else void this.show(this.source);
  }

  get canUndo() {
    return this.undone.length > 0;
  }

  get canRedo() {
    return this.redone.length > 0;
  }

  undo() {
    this.travel(this.undone, this.redone);
  }

  redo() {
    this.travel(this.redone, this.undone);
  }

  /** Steps through the history: the source comes from one stack, and the one it replaces goes on the other. */
  private travel(from: string[], to: string[]) {
    const source = from.pop();
    if (source === undefined) return;
    to.push(this.source);
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

  /**
   * The committed source of a diagram with a structure with every part placed where the picture
   * shows it (`%% @id x,y`), and without the places of parts that are gone: what moving a part
   * starts from. Undefined while there is no picture of the committed source.
   */
  pinnedSource(): string | undefined {
    const { picture } = this;
    if (this.problem || !picture || picture.source !== this.source || !picture.parts?.size)
      return undefined;
    return setPlaces(
      prunePlaces(
        this.source,
        picture.scene.shapes.map((shape) => shape.id),
      ),
      placesOf(picture.scene),
    );
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
        return drawScene(scene, colors, typeInfo(type).name, umlRole(type));
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
        picture.type === "tam" ? "tam" : umlRole(picture.type),
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
