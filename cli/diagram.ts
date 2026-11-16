import {
  arialMeasure,
  detectUml,
  parseTam,
  renderTam,
  renderUml,
  TamError,
  UmlError,
  type DiagramColors,
} from "../src/index.ts";
import { isPlaced, layoutPlaced, overlapping } from "../src/edit.ts";
import { DrawioError, exportDrawio, importDrawio, isDrawio } from "../src/drawio.ts";

// Light theme with 6-digit hex only: the renderers mix colors as #rrggbb. The font and arialMeasure
// belong together, since the measure is valid only for the Arial/Helvetica metric family. Arial
// leads the stack because a browser takes the first installed font, and Helvetica's widths differ
// from the table outside ASCII (€, ′, Ĩ).
const CLI_COLORS: DiagramColors = {
  background: "#ffffff",
  text: "#1b1c1f",
  secondary: "#3f4146",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  font: "Arial, Helvetica, 'Liberation Sans', sans-serif",
  dark: false,
};

/**
 * Draws a diagram source as SVG: UML if it starts with a supported Mermaid header, else TAM. A
 * source with no elements, such as an empty or comment-only file, is an error here, as in Mermaid;
 * the library itself draws it as an empty picture, which suits a live preview.
 */
export async function renderSource(
  source: string,
  style: { rounded?: boolean } = {},
): Promise<string> {
  const options = { measure: arialMeasure },
    colors = { ...CLI_COLORS, rounded: !!style.rounded };
  if (detectUml(source)) return (await renderUml(source, colors, options)).svg;
  if (parseTam(source).nodes.size === 0) throw new TamError(0, "the diagram has no elements");
  return (await renderTam(source, colors, options)).svg;
}

/**
 * Throws what renderSource would throw for this source. Layout is part of it: some rules, such as a
 * sequence diagram's `deactivate` of an inactive participant, fire only while laying out.
 */
export async function checkSource(source: string): Promise<void> {
  await renderSource(source);
  if (detectUml(source)) return;
  // Placed by hand, elements may lie on each other, which the TAM standard (3.3.5) does not allow.
  const diagram = parseTam(source);
  if (!isPlaced(diagram)) return;
  const [pair] = overlapping(diagram, layoutPlaced(diagram, arialMeasure));
  if (!pair) return;
  const [a, b] = pair.map((id) => diagram.nodes.get(id)!);
  throw new TamError(
    Math.max(a.line, b.line),
    `\`${a.origin ?? a.id}\` and \`${b.origin ?? b.id}\` overlap; elements stand apart.`,
  );
}

/**
 * The source of an input: the text itself, or the diagram a draw.io file draws, with what of the
 * file has no place in the diagram.
 */
export async function sourceOf(text: string): Promise<{ source: string; warnings: string[] }> {
  if (!isDrawio(text)) return { source: text, warnings: [] };
  const { source, warnings } = await importDrawio(text);
  return { source, warnings };
}

/**
 * The other form of an input: a draw.io file gives the source of its diagram, a source the draw.io
 * file that draws it with the TAM shapes, laid out as render lays it out.
 */
export async function convertSource(
  text: string,
  style: { rounded?: boolean } = {},
): Promise<{ output: string; warnings: string[] }> {
  if (isDrawio(text)) {
    const { source, warnings } = await sourceOf(text);
    return { output: source, warnings };
  }
  await renderSource(text);
  return {
    output: await exportDrawio(text, { measure: arialMeasure, rounded: !!style.rounded }),
    warnings: [],
  };
}

/** Whether an error is a problem in the diagram source rather than a fault of the program. */
export const isDiagramError = (error: unknown): error is TamError | UmlError | DrawioError =>
  error instanceof TamError || error instanceof UmlError || error instanceof DrawioError;
