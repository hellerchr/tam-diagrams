// Rows the diagram editor's context menus share (diagram-menus.ts, diagram-uml-menus.ts): deleting the selection,
// fitting the view.
import type { MenuItem } from "../lib/overlays.svelte.ts";
import { keys } from "./diagram-bar-view.ts";
import type { Workbench } from "./diagram-workbench.svelte.ts";

/** Deleting the selection, last in every menu of a right click on it. */
export const removal = (ws: Workbench): MenuItem => ({
  label: "Delete",
  hint: "Del",
  danger: true,
  action: ws.ed.remove,
});

/** Fitting the view, in the menu of a right click on nothing. */
export const fits = (ws: Workbench): MenuItem[] => [
  { label: "Fit diagram", hint: "1", action: ws.fit },
  { label: "100%", hint: keys("Mod-0"), action: () => ws.zoomTo(1) },
];
