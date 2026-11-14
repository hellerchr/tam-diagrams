import {
  arialMeasure,
  detectUml,
  renderTam,
  renderUml,
  TamError,
  UmlError,
  type DiagramColors,
} from "../src/index.ts";

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

/** Draws a diagram source as SVG: UML if it starts with a supported Mermaid header, else TAM. */
export async function renderSource(source: string): Promise<string> {
  const options = { measure: arialMeasure };
  const picture = detectUml(source)
    ? await renderUml(source, CLI_COLORS, options)
    : await renderTam(source, CLI_COLORS, options);
  return picture.svg;
}

/**
 * Throws what renderSource would throw for this source. Layout is part of it: some rules, such as a
 * sequence diagram's `deactivate` of an inactive participant, fire only while laying out.
 */
export async function checkSource(source: string): Promise<void> {
  await renderSource(source);
}

/** Whether an error is a problem in the diagram source rather than a fault of the program. */
export const isDiagramError = (error: unknown): error is TamError | UmlError =>
  error instanceof TamError || error instanceof UmlError;
