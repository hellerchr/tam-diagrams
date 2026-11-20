// The worker that draws the diagram editor's block diagrams (diagrams.ts drawDiagram): laying a large one out and
// routing its wires takes tens of milliseconds a drag's move and hundreds a full layout, which here leave the page free
// to follow the pointer. It lays out and draws as the page would (src/tam renderTam, its text measured with the same
// system fonts; a `draft` routes once, without untangling), and answers each source with the picture's SVG and scene,
// or the source's problem.
import { renderTam } from "../../src/tam-layout.ts";
import type { DiagramColors } from "../../src/draw.ts";
import { type Problem, problemOf } from "./diagram-problem.ts";

/** A source to draw, and the answer. */
export type TamAsk = { id: number; source: string; colors: DiagramColors; draft: boolean };
export type TamAnswer =
  | { ready: true }
  | { id: number; svg: string; scene: Awaited<ReturnType<typeof renderTam>>["scene"] }
  | { id: number; problem: Problem };

self.onmessage = async ({ data }: MessageEvent<TamAsk>) => {
  const { id, source, colors, draft } = data;
  try {
    const picture = await renderTam(source, colors, { draft });
    self.postMessage({ id, svg: picture.svg, scene: picture.scene } satisfies TamAnswer);
  } catch (error) {
    self.postMessage({ id, problem: problemOf(error) } satisfies TamAnswer);
  }
};

// Loaded: the page draws here from now on.
self.postMessage({ ready: true } satisfies TamAnswer);
