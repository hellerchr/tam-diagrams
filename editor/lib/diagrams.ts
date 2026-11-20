// TAM block diagrams and Mermaid UML (class, use case, activity, state, sequence, ER) drawn by src/tam, in the app
// theme's colors. The library and elkjs load on the first diagram (their own lazy chunk), layouts run in web
// workers, and a drawn diagram is cached by source and theme, so re-rendering a message costs nothing. The diagram
// editor (features/files/DiagramView.svelte) draws through `drawDiagram`, which also hands over the scene.
import elkWorker from "elkjs/lib/elk-worker.min.js?url";
import type * as Tam from "../../src/index.ts";
import type { DiagramColors, ElkLayout, Scene } from "../../src/index.ts";
import type { Theme } from "../styles/themes.ts";
import { type Problem, problemOf } from "./diagram-problem.ts";
import type { TamAnswer, TamAsk } from "./tam-worker.ts";
import { extname } from "./format.ts";

/** Code fence languages drawn as diagrams. */
export const isDiagram = (lang: string) => lang === "tam" || lang === "mermaid";

export type Diagram = { url: string; width: number; height: number };

let library: Promise<{ lib: typeof Tam; layout: ElkLayout | undefined }> | undefined;

/** The diagram library and its ELK worker pool, loaded on the first diagram. */
async function loadLibrary() {
  const lib = await import("../../src/index.ts");
  const layout = await lib.elkWorkerPool(elkWorker).catch(() => undefined);
  return { lib, layout };
}
const load = () => (library ??= loadLibrary());

/** The ELK layout the diagrams run in (the worker pool; undefined where there are no workers). */
export const elkLayout = async () => (await load()).layout;

/** The diagram a file holds, by its extension: a TAM block diagram (tam) or a Mermaid one (mermaid); else undefined. */
export function diagramOf(path: string) {
  const ext = extname(path).toLowerCase();
  return ext === "tam" ? "tam" : ext === "mmd" || ext === "mermaid" ? "mermaid" : undefined;
}

/** Whether a file's name says it is a draw.io file (.drawio, .drawio.svg, .drawio.xml), shown as the diagram it holds. */
export const isDrawioPath = (path: string) => /\.drawio(\.svg|\.xml)?$/i.test(path);

/** Starts loading the library when `path` is a diagram file, ahead of its first drawing (it is under the pointer). */
export const warmDiagrams = (path: string) =>
  void ((diagramOf(path) || isDrawioPath(path)) && load());

/** In the order of the palette's names (src/tam/draw.ts SERIES): blue, orange, green, yellow, pink, cyan, purple,
 *  red. A terminal palette has no orange: its yellow (3) is the warm one, its bright yellow (11) the yellow. */
const SERIES = [4, 3, 2, 11, 13, 6, 5, 1];

/** The theme's colors as the library wants them, read from the CSS variables theme.ts sets; on `paper`, its colors
 *  (lib/paper.ts) instead. */
export function colors(paper?: Theme): DiagramColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const font = v("--font-ui");
  if (paper) {
    const { surface, foreground, muted } = paper.colors;
    const series = SERIES.map((i) => paper.ansi[i]!);
    return { background: surface, text: foreground, secondary: muted, series, font, dark: false };
  }
  return {
    background: v("--c-surface"),
    text: v("--c-foreground"),
    secondary: v("--c-muted"),
    series: SERIES.map((i) => v(`--ansi-${i}`)),
    font,
    dark: document.documentElement.dataset.scheme !== "light",
  };
}

export type { Problem };

/** A source drawn for the editor: the picture with the scene behind it (boxes to hit and move), or its problem; with
 *  the kind of diagram its header says ("tam" for a block diagram, else detectUml's name; undefined: none). */
export type Drawing = Picture | { source: string; kind?: string; problem: Problem };
/** A source that drew: its picture, with the scene behind it. */
export type Picture = { source: string; kind?: string; url: string; scene: Scene };

/** Draws `source` (a ```tam or ```mermaid fence's language) in the theme's colors, or on `paper`, for the editor; a
 *  `draft` (a drag's preview) routes a placed block diagram's wires once, without untangling them. A placed block
 *  diagram is drawn in the editor's worker where there is one (tam-worker.ts), so the page follows the pointer
 *  meanwhile. */
export async function drawDiagram(
  source: string,
  lang: string,
  paper?: Theme,
  draft = false,
): Promise<Drawing> {
  const { lib, layout } = await load();
  const kind = lib.detectUml(source) ?? (lang === "tam" ? "tam" : undefined);
  const palette = colors(paper);
  const aside =
    kind === "tam" && placedSource(lib, source)
      ? await drawAside(source, palette, draft)
      : undefined;
  if (aside)
    return "problem" in aside
      ? { source, kind, problem: aside.problem }
      : { source, kind, url: lib.svgUrl(aside.svg), scene: aside.scene };
  try {
    const options = { layout, draft };
    const picture =
      kind === "tam"
        ? await lib.renderTam(source, palette, options)
        : await lib.renderUml(source, palette, options);
    return { source, kind, url: lib.svgUrl(picture.svg), scene: picture.scene };
  } catch (error) {
    return { source, kind, problem: problemOf(error) };
  }
}

/** Whether a block diagram's source places its elements: its layout routes every wire here, the work the worker takes
 *  off the page. An automatic layout runs in the ELK workers already (several strategies at once). */
function placedSource(lib: typeof Tam, source: string): boolean {
  try {
    return lib.isPlaced(lib.parseTam(source));
  } catch {
    return false;
  }
}

/** The editor's block diagram worker: started on the first block diagram, which is drawn here while it loads; null
 *  where there are no workers or it failed. */
let tamWorker: Worker | null | undefined;
let tamReady = false;
let asked = 0;
/** What the worker answers a source with. */
type Drawn = Exclude<TamAnswer, { ready: true }>;
const answers = new Map<number, (answer: Drawn | undefined) => void>();

/** A block diagram drawn in the worker; undefined where there is none, or it is still loading (the caller draws it
 *  here). */
function drawAside(
  source: string,
  palette: DiagramColors,
  draft: boolean,
): Promise<Drawn | undefined> {
  tamWorker ??= startTamWorker();
  const worker = tamWorker;
  if (!worker || !tamReady) return Promise.resolve(undefined);
  const id = ++asked;
  return new Promise((done) => {
    answers.set(id, done);
    worker.postMessage({ id, source, colors: palette, draft } satisfies TamAsk);
  });
}

/** Starts the worker; one that fails gives way to drawing here, what it was asked for too. */
function startTamWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  const worker = new Worker(new URL("./tam-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<TamAnswer>) => {
    if ("ready" in data) return void (tamReady = true);
    answers.get(data.id)?.(data);
    answers.delete(data.id);
  };
  worker.onerror = () => {
    tamWorker = null;
    worker.terminate();
    for (const done of answers.values()) done(undefined);
    answers.clear();
  };
  return worker;
}

const cache = new Map<string, Promise<Diagram | undefined>>();
const CACHE_SIZE = 50;

/** The diagram for a fenced `source`, or undefined when it is not one this library draws (pie, gantt, …) or is
 *  invalid: the caller then keeps the code block. */
export function renderDiagram(source: string, lang: string): Promise<Diagram | undefined> {
  const palette = colors();
  const key = `${lang}\0${palette.background}\0${palette.text}\0${source}`;
  let found = cache.get(key);
  if (!found) {
    found = load().then(async ({ lib, layout }) => {
      try {
        const options = { layout };
        const picture =
          lang === "tam" && !lib.detectUml(source)
            ? await lib.renderTam(source, palette, options)
            : await lib.renderUml(source, palette, options);
        return { url: lib.svgUrl(picture.svg), width: picture.width, height: picture.height };
      } catch {
        return undefined;
      }
    });
    cache.set(key, found);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  return found;
}
