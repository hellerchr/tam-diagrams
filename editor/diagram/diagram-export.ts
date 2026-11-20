// The diagram on show leaving the editor (DiagramExport.svelte): its picture redrawn from the scene for a page (light
// colors on white or on nothing, or the theme's), with room around it, as SVG or PNG; or the source as a draw.io file.
// Loaded with the export dialog.
import type { DiagramColors } from "../../src/draw.ts";
import { drawScene } from "../../src/draw.ts";
import type { Scene } from "../../src/scene.ts";
import { themeById } from "../styles/themes.ts";

export type Format = "svg" | "png" | "drawio";
/** What is behind the picture: white, nothing (transparent), or the theme's page color. */
export type Backdrop = "white" | "none" | "theme";

/** The room around an exported picture, in the diagram's units. */
const MARGIN = 16;

/** The light colors a picture is exported in, whatever the theme on show, so it reads on a white page. */
export function lightColors(font: string): DiagramColors {
  const { colors, ansi } = themeById("claude-light");
  return {
    background: "#ffffff",
    text: colors.foreground,
    secondary: colors.muted,
    series: [4, 3, 2, 11, 13, 6, 5, 1].map((i) => ansi[i]!),
    font,
    dark: false,
  };
}

/** A picture with room around it: its area grows by a margin on every side, and so does its size. */
export function withMargin(svg: string, margin: number): string {
  const head =
    /viewBox="(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(
      svg,
    );
  if (!head || !(margin > 0)) return svg;
  const [all, x, y, width, height] = head;
  const wide = Number(width) + 2 * margin;
  const high = Number(height) + 2 * margin;
  return svg.replace(
    all,
    `viewBox="${Number(x) - margin} ${Number(y) - margin} ${wide} ${high}" width="${wide}" height="${high}"`,
  );
}

/** A picture without the halos in `color` that labels on lines are drawn with: on nothing they would show. */
export function withoutHalos(svg: string, color: string): string {
  const escaped = color.replace(/[^\w#]/g, "\\$&");
  return svg.replace(
    new RegExp(
      ` stroke="${escaped}" stroke-width="[\\d.]+" stroke-linejoin="round" paint-order="stroke"`,
      "g",
    ),
    "",
  );
}

/** A picture with a color behind it: a rectangle over its whole area, after the style and below every shape. */
export function withBackground(svg: string, color: string): string {
  const box = /viewBox="(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"/.exec(svg);
  if (!box) return svg;
  const [, x, y, width, height] = box;
  const rect = `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}"/>`;
  const at = svg.indexOf("</style>");
  if (at >= 0) return `${svg.slice(0, at + 8)}${rect}${svg.slice(at + 8)}`;
  return svg.replace(/(<svg[^>]*>)/, `$1${rect}`);
}

/** An exported picture: the SVG and its size in the diagram's units. */
export type Exported = { svg: string; width: number; height: number };

/** The scene drawn for a page: in the light colors unless the theme's (`theme`) are asked for, with room around it;
 *  `name` is what the picture says it shows. */
export function exportedPicture(
  scene: Scene,
  backdrop: Backdrop,
  theme: DiagramColors,
  name: string,
): Exported {
  const colors = backdrop === "theme" ? theme : lightColors(theme.font);
  const roomy = withMargin(drawScene(scene, colors, name), MARGIN);
  const svg =
    backdrop === "none"
      ? withoutHalos(roomy, colors.background)
      : withBackground(roomy, colors.background);
  return { svg, width: scene.bounds.width + 2 * MARGIN, height: scene.bounds.height + 2 * MARGIN };
}
