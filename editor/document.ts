/**
 * The document an editor works on: a TAM source, the picture laid out from it, and its history.
 * The source is the only state; every edit is a new source.
 */

import { drawScene, type DiagramColors } from "../src/draw.ts";
import type { ElkLayout } from "../src/elk.ts";
import type { Scene } from "../src/scene.ts";
import { isPlaced, parseTam, TamError, type TamDiagram } from "../src/tam.ts";
import { bestLayout, layoutPlaced } from "../src/tam-layout.ts";
import { pin } from "../src/tam-pin.ts";
import type { Measure } from "../src/text.ts";

/** A source laid out: the parsed diagram and the scene drawn from it. */
export interface Picture {
  source: string;
  diagram: TamDiagram;
  scene: Scene;
  /** Whether the source places its elements; else the layout is automatic. */
  placed: boolean;
}

/** Why a source shows no picture: the message, and the line it is about (0 for the whole source). */
export interface Problem {
  line: number;
  message: string;
}

const problemOf = (reason: unknown): Problem =>
  reason instanceof TamError
    ? { line: reason.line, message: reason.message }
    : { line: 0, message: reason instanceof Error ? reason.message : String(reason) };

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
    return { source, diagram, scene: layoutPlaced(diagram, this.measure), placed: true };
  }

  /** Shows a source's picture: at once when it is placed, after the automatic layout else. */
  private async show(source: string): Promise<void> {
    const run = ++this.run;
    try {
      const diagram = parseTam(source);
      this.problem = undefined;
      if (isPlaced(diagram) || !diagram.nodes.size) {
        this.picture = {
          source,
          diagram,
          scene: layoutPlaced(diagram, this.measure),
          placed: true,
        };
        this.onChange();
        return;
      }
      // The source shows at once, the picture when it is laid out; a later edit overtakes this one.
      this.onChange();
      const scene = await bestLayout(diagram, this.measure, this.elk);
      if (run !== this.run) return;
      this.picture = { source, diagram, scene, placed: false };
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
    if (this.problem || !picture || picture.source !== this.source) return undefined;
    if (picture.placed && allPlaced(picture.diagram)) return this.source;
    return pin(this.source, picture.scene, this.measure);
  }

  /** The picture as a standalone SVG. */
  svg(colors: DiagramColors): string | undefined {
    const { picture } = this;
    return (
      picture &&
      drawScene(picture.scene, colors, picture.diagram.title || "TAM block diagram", "tam")
    );
  }
}

/** Whether the source places every element it declares, so none is left to the rows below the others. */
function allPlaced(diagram: TamDiagram): boolean {
  for (const node of diagram.nodes.values()) {
    if (node.id.endsWith("#row") || ["dots", "interface", "channel"].includes(node.kind)) continue;
    if (!node.at && !node.children.length) return false;
  }
  return true;
}
