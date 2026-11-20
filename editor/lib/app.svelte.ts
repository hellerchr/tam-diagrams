/**
 * The look of the page: the theme whose colors it shows, as CSS variables on the root, which the
 * diagram is drawn in and the panels are styled with. The editor follows the system's light or
 * dark preference unless the user picked one (`tam-editor:theme`).
 */

import { MATCH, syntaxOf } from "../styles/syntax.ts";
import { ROLES, themeById } from "../styles/themes.ts";

/** The theme on show and the colors of code in it, by id: what the canvas redraws on. */
export const applied = $state({ theme: "", syntax: "" });

/** Puts theme `id`'s colors on the page, code in syntax theme `syntax` (MATCH: the theme's own). */
export function applyTheme(id: string, syntax = MATCH) {
  const theme = themeById(id);
  const style = document.documentElement.style;
  for (const role of ROLES) style.setProperty(`--c-${role.replace("_", "-")}`, theme.colors[role]);
  theme.ansi.forEach((color, i) => style.setProperty(`--ansi-${i}`, color));
  const code = syntaxOf(theme, syntax);
  for (const [role, color] of Object.entries(code.colors))
    style.setProperty(`--syn-${role}`, color);
  document.documentElement.dataset.scheme = theme.dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.colors.canvas);
  applied.theme = theme.id;
  applied.syntax = code.id || `ansi:${theme.id}`;
}
