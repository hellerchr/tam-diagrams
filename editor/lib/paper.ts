// The light paper diagrams are drawn on in the diagram editor while its canvas is light (View > Light canvas): the
// light twin of the theme on the page (Claude Dark: Claude Light; a theme without one: Claude Light) on white. The
// canvas wears its colors as CSS variables (`paperVars`), and the picture is drawn in the same (lib/diagrams.ts).
import { ROLES, type Theme, themeById, THEMES } from "../styles/themes.ts";

/** A dark theme's family, and the light theme of that family. */
const TWINS: [RegExp, string][] = [
  [/^repli$|^github-/, "github-light"],
  [/^ayu-/, "ayu-light"],
  [/^catppuccin-/, "catppuccin-latte"],
  [/^kanagawa-/, "kanagawa-lotus"],
  [/^rose-pine/, "rose-pine-dawn"],
  [/^tokyo-night/, "tokyo-night-light"],
  [/^vscode-/, "vscode-light-modern"],
];

/** The light theme of theme `id`'s family (itself when it is light), its page white. */
export function paperTheme(id: string): Theme {
  const theme = themeById(id);
  const name = theme.dark
    ? (TWINS.find(([family]) => family.test(theme.id))?.[1] ?? theme.id.replace("-dark", "-light"))
    : theme.id;
  const twin = THEMES.find((t) => t.id === name && !t.dark) ?? themeById("claude-light");
  return { ...twin, colors: { ...twin.colors, surface: "#ffffff" } };
}

/** The theme's colors as the CSS variables the page has them in (app.svelte.ts applyTheme), for one element. */
export function paperVars(theme: Theme): string {
  const roles = ROLES.map((role) => `--c-${role.replace("_", "-")}: ${theme.colors[role]}`);
  return [...roles, ...theme.ansi.map((color, i) => `--ansi-${i}: ${color}`)].join("; ");
}
