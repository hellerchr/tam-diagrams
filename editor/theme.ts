/** The editor's look: its light and dark colors, which of them shows, and the corners of connections. */

import type { DiagramColors } from "../src/draw.ts";
import type { Editor } from "./editor.ts";
import { store, stored } from "./storage.ts";
import type { View } from "./view.ts";

/** How the page follows light and dark: one of them, or the system's choice. */
export type ThemeChoice = "light" | "dark" | "system";

/** The font the labels are measured and drawn with. */
export const FONT = "system-ui, sans-serif";

const SERIES = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
];

/** The colors of a theme: of the diagram, of the dots on the canvas, and of selections. */
export interface Theme {
  diagram: DiagramColors;
  dots: string;
  accent: string;
}

export const THEMES: Record<"light" | "dark", Theme> = {
  light: {
    diagram: {
      background: "#ffffff",
      text: "#1b1c1f",
      secondary: "#3f4146",
      series: SERIES,
      font: FONT,
      dark: false,
    },
    dots: "#d3d6db",
    accent: "#1f6fd6",
  },
  dark: {
    diagram: {
      background: "#1b1c1f",
      text: "#e9eaec",
      secondary: "#b9bcc2",
      series: SERIES,
      font: FONT,
      dark: true,
    },
    dots: "#3a3d43",
    accent: "#4c94f0",
  },
};

/**
 * The look the user chose, remembered across visits: light, dark, or whichever the system is in,
 * and whether connections bend round at their corners.
 */
export class Look {
  choice: ThemeChoice = (stored("theme") as ThemeChoice | null) ?? "system";
  rounded = stored("rounded") === "1";
  private readonly system = matchMedia("(prefers-color-scheme: dark)");

  /** The theme that shows. */
  get theme(): "light" | "dark" {
    if (this.choice !== "system") return this.choice;
    return this.system.matches ? "dark" : "light";
  }

  /** Calls `changed` whenever the system switches between light and dark. */
  watch(changed: () => void) {
    this.system.addEventListener("change", changed);
  }

  choose(next: ThemeChoice) {
    this.choice = next;
    store("theme", next);
  }

  round(next: boolean) {
    this.rounded = next;
    store("rounded", next ? "1" : "0");
  }

  /** Colors the page, the canvas and the editor's picture in the theme that shows. */
  paint(editor: Editor, view: View) {
    const { diagram, dots, accent } = THEMES[this.theme];
    document.documentElement.dataset.theme = this.theme;
    // The page color of the diagram, for the small pictures of it elsewhere on the page.
    document.documentElement.style.setProperty("--page", diagram.background);
    editor.colors = { ...diagram, rounded: this.rounded };
    editor.accent = accent;
    view.colors = { page: diagram.background, dots };
    editor.refresh();
  }
}
