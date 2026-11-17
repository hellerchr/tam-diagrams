/** The diagram leaving the editor as a picture, an SVG or a PNG, or as a draw.io file. */

import { exportDrawio } from "../src/drawio.ts";
import { type Backdrop, exportDialog, type ExportOptions } from "./dialogs.ts";
import { download, messageOf } from "./disk.ts";
import type { Doc } from "./document.ts";
import { EXPORT_FONT, withBackground, withMargin, withoutHalos } from "./files.ts";
import { store, stored } from "./storage.ts";
import { type Look, THEMES } from "./theme.ts";

/** The picture of a diagram as it is exported, and its size in units of the diagram. */
interface Exported {
  svg: string;
  width: number;
  height: number;
}

/**
 * The picture as it is exported: in the light colors on white or on nothing, or in the colors of
 * the editor's theme on its page color, with room around it and with fonts named that every
 * system has one of. On nothing, the labels on lines have no outline in a page color.
 */
export function pictureOf(
  doc: Doc,
  look: Look,
  backdrop: Backdrop,
  margin: number,
): Exported | undefined {
  const colors = {
      ...THEMES[backdrop === "theme" ? look.theme : "light"].diagram,
      font: EXPORT_FONT,
      rounded: look.rounded,
    },
    svg = doc.svg(colors),
    bounds = doc.picture?.scene.bounds;
  if (!svg || !bounds) return undefined;
  const roomy = withMargin(svg, margin);
  return {
    svg:
      backdrop === "transparent"
        ? withoutHalos(roomy, colors.background)
        : withBackground(roomy, colors.background),
    width: bounds.width + 2 * margin,
    height: bounds.height + 2 * margin,
  };
}

/** A picture drawn on a canvas at a scale, as PNG data. */
async function pngOf(drawn: Exported, scale: number): Promise<Blob | null> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}`;
  await image.decode();
  const sheet = document.createElement("canvas");
  sheet.width = Math.ceil(drawn.width * scale);
  sheet.height = Math.ceil(drawn.height * scale);
  sheet.getContext("2d")!.drawImage(image, 0, 0, sheet.width, sheet.height);
  return new Promise((done) => sheet.toBlob(done, "image/png"));
}

/** The scale of a PNG chosen last; 2 at first. */
const lastScale = () => {
  const scale = Number(stored("export-scale"));
  return scale === 1 || scale === 3 ? scale : 2;
};

/** The room around a picture chosen last; 16 at first. */
const lastMargin = () => {
  const margin = stored("export-margin");
  return margin === "0" || margin === "32" ? Number(margin) : 16;
};

/** The exports of the diagram on show, downloaded under the name of its files. */
export class Exports {
  private readonly doc: Doc;
  private readonly look: Look;
  private readonly toast: (message: string) => void;
  /** The name of the diagram's files without an extension. */
  private readonly stem: () => string;

  constructor(doc: Doc, look: Look, toast: (message: string) => void, stem: () => string) {
    this.doc = doc;
    this.look = look;
    this.toast = toast;
    this.stem = stem;
  }

  /** Whether the diagram draws nothing, which is then said. */
  private empty(): boolean {
    if (this.doc.picture?.scene.shapes.length) return false;
    this.toast("The diagram is empty: there is nothing to export.");
    return true;
  }

  /** Opens the export dialog for a picture of the diagram. */
  picture(format: "svg" | "png") {
    if (this.empty()) return;
    exportDialog({
      // White is what a picture is put on: the background is asked for anew every time.
      options: { format, scale: lastScale(), backdrop: "white", margin: lastMargin() },
      dark: this.look.theme === "dark",
      name: (kind) => `${this.stem()}.${kind}`,
      picture: (backdrop, margin) => pictureOf(this.doc, this.look, backdrop, margin),
      save: (options) => void this.save(options),
    });
  }

  private async save({ format, scale, backdrop, margin }: ExportOptions) {
    const drawn = pictureOf(this.doc, this.look, backdrop, margin);
    if (!drawn) return;
    store("export-scale", String(scale));
    store("export-margin", String(margin));
    if (format === "svg")
      return download(`${this.stem()}.svg`, new Blob([drawn.svg], { type: "image/svg+xml" }));
    const png = await pngOf(drawn, scale);
    if (png) download(`${this.stem()}.png`, png);
  }

  /** The diagram as a draw.io file, as it is drawn now, downloaded. */
  async drawio() {
    const shown = this.doc.picture;
    if (this.empty() || !shown) return;
    try {
      const name = `${this.stem()}.drawio`;
      const xml = await exportDrawio(shown.source, {
        scene: shown.scene,
        rounded: this.look.rounded,
      });
      download(name, new Blob([xml], { type: "application/vnd.jgraph.mxfile" }));
      this.toast(`${name} was downloaded. It opens in draw.io, drawn with the TAM shapes.`);
    } catch (reason) {
      this.toast(messageOf(reason));
    }
  }
}
